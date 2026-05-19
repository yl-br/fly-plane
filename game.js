/**
 * game.js — main orchestrator.
 *
 * Owns the renderer, scene, camera, JoystickHelper, and the controller
 * stack from game-controllers.js. The visual world pieces (airplane,
 * terrain, clouds, enemies) live in game-board.js.
 *
 * Wires helper events → camera FOV punches:
 *   speedStart    →  fov +12   (any button or throttle past max)
 *   throttleKick  →  fov + clamp(delta * 35, 4..15)   (rapid throttle push)
 *
 * Bullet → enemy hits trigger an explosion in the enemy's accent color
 * and bump the score; HUDController shows the score (auto-creating
 * the row if index.html didn't pre-declare one).
 *
 * Background music (music.js) fades in on the first user gesture,
 * tracks the helper's speedForce for intensity, and crossfades to a
 * sparser minor outro on game-over. Press M to mute.
 *
 * If you don't see "[Game] JoystickHelper attached" in the browser
 * console, you're running the wrong file. Replace whatever you have
 * with this one.
 */

import * as THREE         from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { JoystickHelper } from './joystick-helper.js';
import { KeyboardController } from './keyboard.js';

import { buildAirplane, Terrain, Clouds, Enemies, Moon } from './game-board.js';
import { CrashEffects } from './effects.js';
import {
  FlightController,
  CameraController,
  ExhaustSystem,
  StreakSystem,
  BulletSystem,
  ExplosionSystem,
  HUDController,
} from './game-controllers.js';
import { getOrCreatePilot, saveScore } from './nickname.js';
import { Leaderboard } from './leaderboard.js';
import { Music }       from './music.js';
import { Mars }        from './mars.js';

export class AirplaneGame {
  constructor(canvas, hud, joystick) {
    this.canvas   = canvas;
    this.hud      = hud;
    this.joystick = joystick;
    // Standalone keyboard input — runs in parallel with the joystick,
    // not as a fallback inside it, so it can never be shadowed by an
    // idle gamepad that the OS happens to have registered.
    this.keyboard = new KeyboardController();
    this.helper   = new JoystickHelper(joystick);
    this.running  = false;
    this.crashing = false;
    this.crashTimer = 0;
    this.gameOver = false;

    // Mars-interstitial state. Latches so the 3-second cinematic only
    // triggers once even though the crash block keeps running while
    // it's on screen.
    this.showingMars = false;

    // Lunar-landing state — mirrors the crash sequence: contact starts
    // a brief settling animation, then the mission-complete overlay
    // appears. missionComplete latches so we don't fire the overlay
    // twice if checkContact() returns 'landing' on consecutive frames.
    this.landing         = false;
    this.landingTimer    = 0;
    this.missionComplete = false;

    this.clock    = new THREE.Clock();

    // ── Pilot identity (random callsign, one per page-load) ──
    this.pilot = getOrCreatePilot();
    if (this.hud.pilot) this.hud.pilot.textContent = this.pilot.name;
    console.log(`[Game] Pilot: ${this.pilot.name}`);

    // Leaderboard view — DOM-only; storage lives in nickname.js.
    this.leaderboard = new Leaderboard();

    // Mars interstitial — DOM overlay shown for 3 seconds after a
    // crash, between the fireball and the game-over screen.
    this.mars = new Mars();

    // ── Background music ──
    // Procedural, no asset files. Silent until the first user gesture
    // (browser policy), then fades in. setIntensity() in the loop ties
    // the mix to the helper's speedForce. Press M to mute.
    this.music = new Music();
    this.music.armOnFirstGesture();

    // Wire restart button (defined in index.html). A full reload is
    // the simplest reliable reset — every system, particle, tile, and
    // enemy goes back to a known clean state.
    const restartBtn = document.getElementById('restart-btn');
    if (restartBtn) restartBtn.addEventListener('click', () => window.location.reload());

    console.log('[Game] JoystickHelper attached:', !!this.helper);
    this._init();
  }

  /* ── Setup ──────────────────────────────────────────────── */

  _init() {
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setSize(W, H, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x87ceeb, 200, 900);
    this.scene.background = new THREE.Color(0x87ceeb);

    this.camera = new THREE.PerspectiveCamera(65, W / H, 0.5, 2000);
    this.camera.position.set(0, 4, 14);

    this.scene.add(new THREE.AmbientLight(0xffeedd, 0.5));
    const sun = new THREE.DirectionalLight(0xfff5e0, 1.4);
    sun.position.set(80, 120, -60);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xaaddff, 0.4);
    fill.position.set(-1, 0.5, 1);
    this.scene.add(fill);

    // ── World pieces ──
    this.plane = buildAirplane();
    this.scene.add(this.plane);
    this.terrain  = new Terrain(this.scene);
    this.clouds   = new Clouds(this.scene);
    this.enemies  = new Enemies(this.scene, this.plane.position);
    this.moon     = new Moon(this.scene);

    // ── Controllers ──
    this.flight     = new FlightController(this.plane, this.helper);
    this.cameraCtrl = new CameraController(this.camera, this.plane, this.helper, this.flight);
    this.exhaust    = new ExhaustSystem(this.scene, this.plane, this.helper, this.flight);
    this.streaks    = new StreakSystem(this.scene, this.plane, this.helper, this.flight);
    this.explosions = new ExplosionSystem(this.scene);
    this.crashFx    = new CrashEffects(this.scene);
    this.bullets    = new BulletSystem(this.scene, this.plane);
    this.hudCtrl    = new HUDController(this.hud, this.plane, this.helper, this.joystick, this.flight, this.bullets);

    // Bullet hit → explosion in the enemy's accent color + remove enemy
    // (BulletSystem already incremented score before this fires.)
    this.bullets.onHit = enemy => {
      this.explosions.trigger(enemy.group.position, enemy.color);
      this.enemies.remove(enemy, this.plane.position, this.plane.quaternion);
      console.log(`[Game] enemy down! score=${this.bullets.score}`);
    };

    // ── Helper events → camera lens punches ──
    this.helper.on('speedStart', () => {
      this.cameraCtrl.kickFov(12);
      console.log('[Game] speedStart  → boost engaged');
    });
    this.helper.on('speedEnd', () => console.log('[Game] speedEnd  → boost released'));

    // Rapid throttle pushes punch the FOV. Bigger flick → bigger punch
    // (clamped so even a max-flick doesn't blow out the lens).
    this.helper.on('throttleKick', delta => {
      const punch = Math.min(15, Math.max(4, delta * 35));
      this.cameraCtrl.kickFov(punch);
      console.log(`[Game] throttleKick Δ=${delta.toFixed(2)} → fov +${punch.toFixed(1)}`);
    });

    new ResizeObserver(() => this._onResize()).observe(this.canvas.parentElement);
    this.running = true;
    this._loop();
  }

  /* ── Resize / Loop ──────────────────────────────────────── */

  _onResize() {
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    this.renderer.setSize(W, H, false);
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Combine keyboard state into the joystick's state object in place.
   *
   *   Axes (roll/pitch/yaw)  – keyboard wins when actively pressed,
   *                            otherwise the gamepad's analog value
   *                            stays. Pressing a key always takes
   *                            precedence over an idle stick.
   *   Buttons                – OR; either source can fire/boost/etc.
   *   Throttle               – the gamepad's scroller wins when a pad
   *                            is connected (it's an absolute slider,
   *                            not a ramp). With no pad the keyboard
   *                            owns it.
   */
  _mergeKeyboardInto(targetState, kbState) {
    if (kbState.roll  !== 0) targetState.roll  = kbState.roll;
    if (kbState.pitch !== 0) targetState.pitch = kbState.pitch;
    if (kbState.yaw   !== 0) targetState.yaw   = kbState.yaw;

    targetState.boost = targetState.boost || kbState.boost;
    targetState.brake = targetState.brake || kbState.brake;
    targetState.speed = targetState.speed || kbState.speed;
    targetState.fire  = targetState.fire  || kbState.fire;

    if (!this.joystick.connected) targetState.throttle = kbState.throttle;
  }

  _loop() {
    if (!this.running) return;
    requestAnimationFrame(() => this._loop());

    const dt    = Math.min(this.clock.getDelta(), 0.05);

    // ── Crash sequence ──
    // After impact we skip physics/input entirely and only advance the
    // explosion + render, so the player sees the fireball play out.
    // When the timer expires we reveal the game-over overlay.
    if (this.crashing) {
      this.crashTimer -= dt;
      this.crashFx.update(dt);
      this.explosions.update(dt);
      // Small camera jitter on initial impact, fading over ~0.4s.
      const shake = Math.max(0, Math.min(1, (this.crashTimer - 1.0) / 0.4)) * 0.5;
      if (shake > 0) {
        this.camera.position.x += (Math.random() - 0.5) * shake;
        this.camera.position.y += (Math.random() - 0.5) * shake;
      }
      this.renderer.render(this.scene, this.camera);
      // Fireball finished → show the 3-second Mars cinematic, then the
      // game-over overlay. `showingMars` latches so this only fires
      // once even though we keep returning into this branch every
      // frame while Mars is on screen.
      if (this.crashTimer <= 0 && !this.showingMars && !this.gameOver) {
        this._showMars();
      }
      return;
    }

    // ── Lunar-landing sequence ──
    // Mirror of the crash block, but for the success path: skip physics
    // and gently lerp the plane onto the pad with a level orientation.
    // When the timer expires we reveal the mission-complete overlay.
    if (this.landing) {
      this.landingTimer -= dt;
      const target = this.moon.padTop.clone();
      target.y += 1.5;                                  // sit just above the pad
      this.plane.position.lerp(target, 0.15);
      // Slerp toward identity so the plane settles level on the pad.
      const level = new THREE.Quaternion();
      this.plane.quaternion.slerp(level, 0.10);
      this.moon.update(dt);
      this.renderer.render(this.scene, this.camera);
      if (this.landingTimer <= 0 && !this.missionComplete) this._showLandingComplete();
      return;
    }

    const input = this.joystick.update();
    this.keyboard.update();
    // Overlay keyboard input onto the joystick's state. Helper, flight,
    // HUD and bullets all read joystick.state (via the `input` ref),
    // so writing the merge into that same object is the cheapest way
    // to keep every downstream system unchanged.
    this._mergeKeyboardInto(input, this.keyboard.state);
    this.helper.update(dt);

    // 1) Move the plane
    this.flight.update(dt, input);

    // 1b) Ground collision — start the crash sequence (explosion now,
    // game-over overlay a moment later).
    const p = this.plane.position;
    const groundY = this.terrain.getHeightAt(p.x, p.z);
    if (p.y < groundY + 1.5) {
      this._triggerCrash();
      return;
    }

    // 1c) Moon contact — landing on the pad triggers the mission-
    // complete path; touching the moon body anywhere else is a normal
    // crash. Landing zone takes priority over the sphere intersect
    // so a clean top-down approach is always rewarded.
    const moonContact = this.moon.checkContact(this.plane.position);
    if (moonContact === 'landing') {
      this._triggerLanding();
      return;
    }
    if (moonContact === 'crash') {
      this._triggerCrash();
      return;
    }

    // 2) Move the world & enemies (so collision tests are current)
    this.enemies.update(dt, this.plane.position, this.plane.quaternion);

    // 3) Bullets fire / advance / hit-test against enemies
    this.bullets.update(dt, input, this.enemies);

    // 4) Effects
    this.cameraCtrl.update(input);
    this.exhaust.update(dt);
    this.streaks.update(dt);
    this.explosions.update(dt);
    this.clouds.update(this.plane.position);
    this.terrain.update(this.plane.position);
    this.moon.update(dt);

    // 4b) Music intensity tracks the boost. speedForce already smooths
    // 0..1 nicely; the music's own smoothing layer keeps mix fades
    // from feeling abrupt on quick throttle jabs.
    this.music.setIntensity(this.helper.getSpeedForce());

    // 5) HUD
    this.hudCtrl.update(input);

    this.renderer.render(this.scene, this.camera);
  }

  stop() { this.running = false; }

  /**
   * Begin the crash sequence: spawn the explosion at the plane's
   * current position, hide the plane, and start a timer that will
   * reveal the game-over overlay once the fireball has played out.
   */
  _triggerCrash() {
    if (this.crashing) return;
    this.crashing   = true;
    this.crashTimer = 1.4;                        // seconds until game-over overlay
    this.crashFx.trigger(this.plane.position);
    this.plane.visible = false;                   // it just blew up
    console.log('[Game] Ground impact — crash sequence started.');
  }

  /**
   * Show the 3-second Mars cinematic, then chain into the game-over
   * overlay. The main loop keeps running (still in the `crashing`
   * branch, returning early each frame) underneath the overlay; the
   * overlay's own z-index covers the now-static crash scene.
   */
  _showMars() {
    if (this.showingMars) return;
    this.showingMars = true;
    this.mars.onComplete = () => this._showGameOver();
    this.mars.show(3);
    console.log('[Game] Crash → Mars interstitial (3s).');
  }

  /** Reveal the game-over overlay and stop the loop. */
  _showGameOver() {
    if (this.gameOver) return;
    this.gameOver = true;
    this.running  = false;

    const overlay = document.getElementById('game-over');
    const finalEl = document.getElementById('final-score');
    const pilotEl = document.getElementById('final-pilot');
    const score   = this.bullets ? this.bullets.score : 0;

    if (finalEl) finalEl.textContent = String(score);
    if (pilotEl) pilotEl.textContent = this.pilot.name;

    // Persist this run and render the leaderboard. Even a 0-score
    // is saved — players like seeing every attempt land somewhere.
    const { scores, rank } = saveScore(this.pilot.name, score);
    this.leaderboard.render(scores, rank);

    // Crossfade music to the sparser minor outro under the overlay.
    this.music.onGameOver();

    if (overlay) overlay.classList.add('visible');
    console.log(`[Game] Game over. Score=${score}, rank=${rank}`);
  }

  /**
   * Begin the lunar-landing sequence: stop the plane's velocity so it
   * doesn't drift off the pad, then let the loop's `landing` block
   * settle it visually onto the pad before the overlay appears.
   */
  _triggerLanding() {
    if (this.landing || this.crashing) return;
    this.landing      = true;
    this.landingTimer = 1.5;                      // seconds before overlay appears
    this.flight.velocity.set(0, 0, 0);            // park the plane on the pad
    console.log('[Game] Lunar contact — touchdown sequence started.');
  }

  /**
   * Reveal the mission-complete overlay. Reuses the #game-over DOM
   * with a .victory class that swaps the title/subtitle colors from
   * red to gold — keeps the markup small at the cost of needing to
   * reset the text content here.
   *
   * Scoring: base score + a flat lunar-landing bonus. Saving the
   * total (rather than the base) means a successful landing actually
   * climbs the leaderboard, which is the point.
   */
  _showLandingComplete() {
    if (this.missionComplete) return;
    this.missionComplete = true;
    this.running         = false;

    const baseScore = this.bullets ? this.bullets.score : 0;
    const bonus     = 500;
    const total     = baseScore + bonus;

    const overlay = document.getElementById('game-over');
    const titleEl = overlay ? overlay.querySelector('h1')   : null;
    const subEl   = overlay ? overlay.querySelector('.sub') : null;
    const finalEl = document.getElementById('final-score');
    const pilotEl = document.getElementById('final-pilot');

    if (overlay) overlay.classList.add('victory');
    if (titleEl) titleEl.textContent = 'Lunar Landing';
    if (subEl)   subEl.textContent   = `Touchdown · ${baseScore} + ${bonus} bonus`;
    if (finalEl) finalEl.textContent = String(total);
    if (pilotEl) pilotEl.textContent = this.pilot.name;

    // Save the bonused total so a successful landing actually shows
    // up at the top of the leaderboard.
    const { scores, rank } = saveScore(this.pilot.name, total);
    this.leaderboard.render(scores, rank);

    // Reuse onGameOver()'s mix change — opens the filter for a clear
    // track under the overlay. Same audio behavior, different mood.
    this.music.onGameOver();

    if (overlay) overlay.classList.add('visible');
    console.log(`[Game] LUNAR LANDING. base=${baseScore} bonus=${bonus} total=${total} rank=${rank}`);
  }
}
