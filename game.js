/**
 * game.js — main orchestrator.
 *
 * Owns the renderer, scene, camera, JoystickHelper, and the controller
 * stack from game-controllers.js. The visual world pieces (airplane,
 * terrain, clouds, balloons) live in game-board.js.
 *
 * Wires helper events → camera FOV punches:
 *   speedStart    →  fov +12   (any button or throttle past max)
 *   throttleKick  →  fov + clamp(delta * 35, 4..15)   (rapid throttle push)
 *
 * Bullet → balloon hits trigger an explosion in the balloon's color
 * and bump the score; HUDController shows the score (auto-creating
 * the row if index.html didn't pre-declare one).
 *
 * If you don't see "[Game] JoystickHelper attached" in the browser
 * console, you're running the wrong file. Replace whatever you have
 * with this one.
 */

import * as THREE         from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { JoystickHelper } from './joystick-helper.js';

import { buildAirplane, Terrain, Clouds, Balloons } from './game-board.js';
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

export class AirplaneGame {
  constructor(canvas, hud, joystick) {
    this.canvas   = canvas;
    this.hud      = hud;
    this.joystick = joystick;
    this.helper   = new JoystickHelper(joystick);
    this.running  = false;
    this.crashing = false;
    this.crashTimer = 0;
    this.gameOver = false;
    this.clock    = new THREE.Clock();

    // ── Pilot identity (random callsign, one per page-load) ──
    this.pilot = getOrCreatePilot();
    if (this.hud.pilot) this.hud.pilot.textContent = this.pilot.name;
    console.log(`[Game] Pilot: ${this.pilot.name}`);

    // Leaderboard view — DOM-only; storage lives in nickname.js.
    this.leaderboard = new Leaderboard();

    // Wire restart button (defined in index.html). A full reload is
    // the simplest reliable reset — every system, particle, tile, and
    // balloon goes back to a known clean state.
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
    this.balloons = new Balloons(this.scene, this.plane.position);

    // ── Controllers ──
    this.flight     = new FlightController(this.plane, this.helper);
    this.cameraCtrl = new CameraController(this.camera, this.plane, this.helper, this.flight);
    this.exhaust    = new ExhaustSystem(this.scene, this.plane, this.helper, this.flight);
    this.streaks    = new StreakSystem(this.scene, this.plane, this.helper, this.flight);
    this.explosions = new ExplosionSystem(this.scene);
    this.crashFx    = new CrashEffects(this.scene);
    this.bullets    = new BulletSystem(this.scene, this.plane);
    this.hudCtrl    = new HUDController(this.hud, this.plane, this.helper, this.joystick, this.flight, this.bullets);

    // Bullet hit → explosion in balloon's color + remove balloon
    // (BulletSystem already incremented score before this fires.)
    this.bullets.onHit = balloon => {
      this.explosions.trigger(balloon.group.position, balloon.color);
      this.balloons.remove(balloon, this.plane.position, this.plane.quaternion);
      console.log(`[Game] hit! score=${this.bullets.score}`);
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
      if (this.crashTimer <= 0 && !this.gameOver) this._showGameOver();
      return;
    }

    const input = this.joystick.update();
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

    // 2) Move the world & balloons (so collision tests are current)
    this.balloons.update(dt, this.plane.position, this.plane.quaternion);

    // 3) Bullets fire / advance / hit-test against balloons
    this.bullets.update(dt, input, this.balloons);

    // 4) Effects
    this.cameraCtrl.update(input);
    this.exhaust.update(dt);
    this.streaks.update(dt);
    this.explosions.update(dt);
    this.clouds.update(this.plane.position);
    this.terrain.update(this.plane.position);

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

    if (overlay) overlay.classList.add('visible');
    console.log(`[Game] Game over. Score=${score}, rank=${rank}`);
  }
}
