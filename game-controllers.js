/**
 * game-controllers.js
 * ───────────────────
 * Active per-frame systems that drive the plane and the visuals.
 * Each takes references to what it needs and exposes an update().
 *
 *   • FlightController  – physics: throttle, boost, pitch/roll/yaw, gravity/lift.
 *                         Owns `velocity` (read by streaks + HUD).
 *                         Snap-accelerates when throttle changes fast.
 *   • CameraController  – chase camera with FOV punch, dolly-back, shake.
 *                         kickFov(amount) lets the game punch the lens
 *                         (uses max() so a small kick can't cancel a big one).
 *   • ExhaustSystem     – particle puffs from the engines + plane-glow pulsing.
 *   • StreakSystem      – speed-line streaks at high boost.
 *   • BulletSystem      – fires red bullets while input.fire is held.
 *                         Hit-tests against balloons; tracks score.
 *                         Calls onHit(balloon) when a bullet connects.
 *   • ExplosionSystem   – particle burst at a position in a given color.
 *   • HUDController     – pushes values to the DOM HUD overlay.
 *                         Auto-creates a SCORE row if index.html doesn't have one.
 */

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';

/* ═══════════════════════════════════════════════════════════
   FlightController
═══════════════════════════════════════════════════════════ */
export class FlightController {
  constructor(plane, helper) {
    this.plane  = plane;
    this.helper = helper;

    this.velocity      = new THREE.Vector3(0, 0, -50);
    this.throttleLevel = 0.5;
    this._prevThrottle = 0.5;

    // Exposed state (read by CameraController + HUD)
    this.speed        = 50;     // current scalar speed
    this.speedNorm    = 0;      // 0..1 across (MIN_SPEED .. MAX_SPEED + BOOST_BONUS)
    this.acceleration = 0;      // d(speed)/dt, signed
  }

  update(dt, input) {
    const MAX_SPEED   = 80;
    const MIN_SPEED   = 20;
    const PITCH_RATE  = 0.8;
    const ROLL_RATE   = 1.2;
    const YAW_RATE    = 0.4;
    const GRAVITY     = 9.8;
    const LIFT_FACTOR = 0.35;
    const BOOST_BONUS = 80;

    // ── SPEED FORCE ──
    // Read from helper, but fall back to raw button if helper somehow missing
    const force =
      (this.helper && this.helper.getSpeedForce && this.helper.getSpeedForce()) ||
      (input.speed ? 1 : 0);

    this.throttleLevel = input.throttle;

    // ── Throttle delta ──
    // Track per-frame change in throttle so the plane can snap-accelerate
    // when the user pushes the stick. dt-normalised so the kick magnitude
    // doesn't depend on framerate.
    const throttleDelta = input.throttle - this._prevThrottle;
    this._prevThrottle  = input.throttle;
    const throttleRate  = Math.abs(throttleDelta) / Math.max(dt, 0.005);  // /sec

    // Throttle drives a target speed, boost adds a big bonus on top.
    const targetSpeed = MIN_SPEED
                      + (MAX_SPEED - MIN_SPEED) * this.throttleLevel
                      + BOOST_BONUS * force;

    const prevSpeed = this.velocity.length();

    // Stronger base responsiveness so even a slow throttle move produces
    // a visible speed change. Boost and rapid throttle flicks crank it
    // even higher so the plane "snaps" toward the new target.
    const responsiveness = 3.5 + force * 5.0 + Math.min(15, throttleRate * 1.5);
    const k = Math.min(1, responsiveness * dt);
    const newSpeed = prevSpeed + (targetSpeed - prevSpeed) * k;

    // Rotation
    const e = new THREE.Euler().copy(this.plane.rotation);
    e.order = 'YXZ';
    e.x += input.pitch * PITCH_RATE * dt;
    e.x = Math.max(-Math.PI * 0.45, Math.min(Math.PI * 0.45, e.x));
    e.z -= input.roll * ROLL_RATE * dt;
    e.z = Math.max(-Math.PI * 0.55, Math.min(Math.PI * 0.55, e.z));
    e.y -= input.roll * YAW_RATE * dt * 0.4;
    e.y -= input.yaw  * YAW_RATE * dt;
    this.plane.rotation.set(e.x, e.y, e.z, 'YXZ');

    // Forward velocity in plane's local -Z, at the NEW speed.
    // (Previously this overwrote with the old speed, throwing away thrust.)
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.plane.quaternion);
    this.velocity.copy(fwd.multiplyScalar(newSpeed));

    // Gravity / lift
    const lift = Math.max(0, newSpeed * LIFT_FACTOR - GRAVITY);
    this.velocity.y -= (GRAVITY - lift) * dt * 0.3;

    this.plane.position.addScaledVector(this.velocity, dt);
    // (Hard floor removed — the game now detects ground collision and
    // triggers game-over instead of silently bouncing the plane off
    // an invisible plane at y=-60.)
    if (Math.abs(input.roll) < 0.05) this.plane.rotation.z *= 0.97;

    // ── Expose physics for camera & HUD ──
    const finalSpeed = this.velocity.length();
    this.acceleration = (finalSpeed - prevSpeed) / Math.max(dt, 0.005);
    this.speed        = finalSpeed;
    const SPEED_RANGE = (MAX_SPEED + BOOST_BONUS) - MIN_SPEED;
    this.speedNorm    = Math.max(0, Math.min(1, (finalSpeed - MIN_SPEED) / SPEED_RANGE));
  }
}

/* ═══════════════════════════════════════════════════════════
   CameraController
═══════════════════════════════════════════════════════════ */
export class CameraController {
  constructor(camera, plane, helper, flight) {
    this.camera = camera;
    this.plane  = plane;
    this.helper = helper;
    this.flight = flight;            // ← read real speed/accel from physics

    // Extreme close-up — camera sits right on the plane's shoulder so it
    // dominates the frame. The plane's tail (after the 1.4× group scale)
    // is at z ≈ +2.66, so 3.5 puts us less than a unit behind it.
    this._camOffset    = new THREE.Vector3(0, 1.4, 3.5);
    this._camTarget    = new THREE.Vector3();
    this._fovBase      = 65;
    this._fovKick      = 0;
    this._smoothAccel  = 0;          // low-pass filtered acceleration

    // Direction-change tilt: smoothed input that decays back to 0 when
    // the stick is released, plus a smoothed "up" vector so the horizon
    // banks during turns and eases back to level on release.
    this._tiltRoll  = 0;
    this._tiltPitch = 0;
    this._camUp     = new THREE.Vector3(0, 1, 0);
  }

  /** Punch the FOV. Multiple kicks coalesce — the bigger one wins. */
  kickFov(amount) { this._fovKick = Math.max(this._fovKick, amount); }

  update(input) {
    const force = this.helper.getSpeedForce();

    // Pull live physics off the flight controller. Falls back gracefully
    // if for any reason the controller hasn't populated them yet.
    const speedNorm = this.flight ? (this.flight.speedNorm || 0) : 0;
    const accel     = this.flight ? (this.flight.acceleration || 0) : 0;

    // Smooth the accel signal so the camera reacts to sustained pushes,
    // not single-frame spikes.
    this._smoothAccel += (accel - this._smoothAccel) * 0.15;

    // ── Direction-change tilt: track the stick ──
    // Roll & pitch inputs ease toward their target each frame and decay
    // back to 0 the moment the stick releases, so the camera always
    // returns to the default chase view between maneuvers.
    const rIn = input ? (input.roll  || 0) : 0;
    const pIn = input ? (input.pitch || 0) : 0;
    this._tiltRoll  += (rIn - this._tiltRoll)  * 0.10;
    this._tiltPitch += (pIn - this._tiltPitch) * 0.10;

    // ── Camera POSITION reacts to plane's force of movement ──
    // 1) Sustained dolly back proportional to actual speed — kept small
    //    so the close-up framing holds together at full throttle.
    // 2) Extra punch from positive acceleration; slight pull-in on decel.
    const speedDolly = speedNorm * 3;
    const accelDolly = Math.max(-3, Math.min(10, this._smoothAccel * 0.03));

    const offset = this._camOffset.clone();
    // Lean the camera laterally into a roll and nudge it on pitch.
    // Lateral gain stays modest at this distance so a hard bank doesn't
    // swing the camera around the plane and lose it off-frame.
    offset.x += this._tiltRoll  * 1.8;
    offset.y += this._tiltPitch * 0.6;
    offset.z += speedDolly + accelDolly;
    offset.applyQuaternion(this.plane.quaternion);
    const desired = this.plane.position.clone().add(offset);

    // More lag the faster we go — chase camera trails behind on heavy accel.
    const lerp = 0.07 - speedNorm * 0.03;
    this.camera.position.lerp(desired, Math.max(0.02, lerp));

    // ── FOV: base + speed widening + accel punch + manual kicks ──
    this._fovKick *= 0.92;
    const accelFov = Math.max(-4, Math.min(15, this._smoothAccel * 0.05));
    const targetFov = this._fovBase + speedNorm * 22 + accelFov + this._fovKick;
    this.camera.fov += (targetFov - this.camera.fov) * 0.18;
    this.camera.updateProjectionMatrix();

    // Shake scales with both boost button AND raw speed, plus extra
    // jitter when accelerating hard.
    const shake = Math.max(force * 0.10, speedNorm * 0.12)
                + Math.max(0, this._smoothAccel) * 0.0008;
    if (shake > 0.02) {
      this.camera.position.x += (Math.random() - 0.5) * shake;
      this.camera.position.y += (Math.random() - 0.5) * shake;
    }

    // ── Bank the horizon during a turn ──
    // Mix world-up with the plane's local up, weighted by how hard we're
    // rolling. The smoothed _tiltRoll guarantees a clean ease-back to
    // level as soon as the stick is released.
    const tiltAmt = Math.min(1, Math.abs(this._tiltRoll) * 1.4);
    const planeUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.plane.quaternion);
    const targetUp = new THREE.Vector3(0, 1, 0).lerp(planeUp, tiltAmt).normalize();
    this._camUp.lerp(targetUp, 0.10);
    this.camera.up.copy(this._camUp);

    this._camTarget.lerp(this.plane.position, 0.12);
    this.camera.lookAt(this._camTarget);

    // ── Over-bank the horizon ──
    // The up-vector blend above already matches the plane's bank (max ≈
    // 31° given the flight clamp). Adding ~20° on top exaggerates the
    // lean so left/right maneuvers really feel committed. Sign: positive
    // _tiltRoll = banking right = camera rolls clockwise from the viewer's
    // perspective = negative rotation around camera-local +Z.
    this.camera.rotateZ(-this._tiltRoll * 0.35);
  }
}

/* ═══════════════════════════════════════════════════════════
   ExhaustSystem
═══════════════════════════════════════════════════════════ */
export class ExhaustSystem {
  constructor(scene, plane, helper, flight) {
    this.scene  = scene;
    this.plane  = plane;
    this.helper = helper;
    this.flight = flight;

    this._exhaust      = [];
    this._exhaustTimer = 0;
  }

  _spawn() {
    const force = this.helper.getSpeedForce();
    const baseMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.0, 0.4 + force * 0.55, force * 0.6),
      transparent: true, opacity: 0.7 + force * 0.3,
    });
    const geo = new THREE.SphereGeometry(0.25, 4, 4);

    [-1, 1].forEach(s => {
      const p = new THREE.Mesh(geo, baseMat.clone());
      const wp = new THREE.Vector3(s * 1.54, -0.25, 0.65);
      this.plane.localToWorld(wp);
      p.position.copy(wp);
      p.userData.life = 1;
      p.userData.vel  = this.flight.velocity.clone().multiplyScalar(0.01)
        .add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5));
      this.scene.add(p);
      this._exhaust.push(p);
    });
  }

  update(dt) {
    const force = this.helper.getSpeedForce();
    const interval = 0.04 - force * 0.025;
    this._exhaustTimer += dt;
    if (this._exhaustTimer > interval) { this._exhaustTimer = 0; this._spawn(); }

    for (let i = this._exhaust.length - 1; i >= 0; i--) {
      const p = this._exhaust[i];
      p.userData.life -= dt * 2.5;
      p.material.opacity = p.userData.life * 0.7;
      p.scale.setScalar(1 + (1 - p.userData.life) * 2);
      p.position.add(p.userData.vel);
      if (p.userData.life <= 0) {
        this.scene.remove(p); p.geometry.dispose(); p.material.dispose();
        this._exhaust.splice(i, 1);
      }
    }

    if (this.plane.userData.exhausts) {
      const tScale = 1 + force * 2.0;
      const tOpac  = Math.min(1, 0.85 + force * 0.4);
      this.plane.userData.exhausts.forEach(m => {
        m.scale.setScalar(m.scale.x + (tScale - m.scale.x) * 0.18);
        m.material.opacity += (tOpac - m.material.opacity) * 0.18;
        m.material.color.setRGB(1, 0.5 + force * 0.45, force * 0.6);
      });
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   StreakSystem
═══════════════════════════════════════════════════════════ */
export class StreakSystem {
  constructor(scene, plane, helper, flight) {
    this.scene  = scene;
    this.plane  = plane;
    this.helper = helper;
    this.flight = flight;

    this._streaks = [];
  }

  update(dt) {
    const force = this.helper.getSpeedForce();
    if (force > 0.2) {
      const spawn = Math.floor(force * 8);
      for (let i = 0; i < spawn; i++) {
        if (Math.random() > force) continue;
        const length = 4 + Math.random() * 6;
        const streak = new THREE.Mesh(
          new THREE.CylinderGeometry(0.04, 0.04, length, 4),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }),
        );
        const a = Math.random() * Math.PI * 2;
        const r = 4 + Math.random() * 9;
        const off = new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, -25 - Math.random() * 25);
        off.applyQuaternion(this.plane.quaternion);
        streak.position.copy(this.plane.position).add(off);
        streak.quaternion.copy(this.plane.quaternion);
        streak.rotateX(Math.PI / 2);
        streak.userData.life = 0.5 + Math.random() * 0.4;
        streak.userData.maxLife = streak.userData.life;
        streak.userData.peak = 0.5 + Math.random() * 0.4;
        this.scene.add(streak);
        this._streaks.push(streak);
      }
    }
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.plane.quaternion);
    const speed = this.flight.velocity.length();
    for (let i = this._streaks.length - 1; i >= 0; i--) {
      const s = this._streaks[i];
      s.userData.life -= dt;
      s.position.addScaledVector(fwd, -speed * dt * 1.4);
      const t = s.userData.life / s.userData.maxLife;
      s.material.opacity = (1 - Math.abs(2 * t - 1)) * s.userData.peak * force;
      if (s.userData.life <= 0) {
        this.scene.remove(s); s.geometry.dispose(); s.material.dispose();
        this._streaks.splice(i, 1);
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   BulletSystem
   ────────────
   Fires twin red bullets from the engine pods while input.fire is
   held, on a fixed cooldown. Each frame: advances bullets, expires
   old ones, hit-tests against balloons. Emits onHit(balloon) when a
   bullet connects so the game can spawn an explosion + remove the
   balloon. Tracks `score` (number of balloons popped).
═══════════════════════════════════════════════════════════ */
export class BulletSystem {
  constructor(scene, plane) {
    this.scene = scene;
    this.plane = plane;

    this.bullets    = [];
    this.cooldown   = 0;
    this.fireRate   = 0.11;     // seconds between volleys (~9 volleys/sec → 18 bullets/sec)
    this.bulletSpeed = 700;     // world units / sec
    this.bulletLife  = 2.0;     // seconds
    this.score      = 0;
    this.onHit      = null;     // (balloon) => void

    // Shared resources — one per system, never disposed
    this._geo  = new THREE.SphereGeometry(0.45, 6, 6);
    this._mat  = new THREE.MeshBasicMaterial({ color: 0xff2222 });
    this._haloGeo = new THREE.SphereGeometry(0.95, 6, 6);
    this._haloMat = new THREE.MeshBasicMaterial({
      color: 0xff5544, transparent: true, opacity: 0.45,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
  }

  _fire() {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.plane.quaternion);
    const velocity = fwd.clone().multiplyScalar(this.bulletSpeed);

    // Twin guns — one per engine pod
    [-1, 1].forEach(side => {
      const bullet = new THREE.Mesh(this._geo, this._mat);
      // Local position: at engine pod, just ahead of it.
      const start = new THREE.Vector3(side * 1.1, -0.18, -1.0);
      this.plane.localToWorld(start);
      bullet.position.copy(start);

      // Glow halo (additive). Material is shared.
      const halo = new THREE.Mesh(this._haloGeo, this._haloMat);
      bullet.add(halo);

      bullet.userData.life     = this.bulletLife;
      bullet.userData.velocity = velocity.clone();
      this.scene.add(bullet);
      this.bullets.push(bullet);
    });
  }

  update(dt, input, balloons) {
    this.cooldown -= dt;
    if (input.fire && this.cooldown <= 0) {
      this._fire();
      this.cooldown = this.fireRate;
    }

    const active = balloons ? balloons.getActive() : null;

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.position.addScaledVector(b.userData.velocity, dt);
      b.userData.life -= dt;

      // Hit-test
      let hit = null;
      if (active) {
        for (const balloon of active) {
          const d2 = b.position.distanceToSquared(balloon.group.position);
          if (d2 < balloon.radius * balloon.radius) { hit = balloon; break; }
        }
      }

      if (hit) {
        this.scene.remove(b);
        // Geometry and material are shared — don't dispose.
        this.bullets.splice(i, 1);
        this.score++;
        if (this.onHit) this.onHit(hit);
      } else if (b.userData.life <= 0) {
        this.scene.remove(b);
        this.bullets.splice(i, 1);
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   ExplosionSystem
   ───────────────
   Bursts of glowing spheres at a given position and color.
   Particles fan out, decay, and self-clean. Triggered by the
   BulletSystem hit callback in game.js.
═══════════════════════════════════════════════════════════ */
export class ExplosionSystem {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this._geo = new THREE.SphereGeometry(0.7, 5, 5);
  }

  trigger(position, color = 0xffaa44) {
    const COUNT = 16;
    for (let i = 0; i < COUNT; i++) {
      // Each particle gets its own material (its color may shift / fade).
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 1.0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const p = new THREE.Mesh(this._geo, mat);
      p.position.copy(position);
      p.userData.vel = new THREE.Vector3(
        (Math.random() - 0.5),
        (Math.random() - 0.5),
        (Math.random() - 0.5),
      ).normalize().multiplyScalar(14 + Math.random() * 22);
      p.userData.life    = 0.55 + Math.random() * 0.45;
      p.userData.maxLife = p.userData.life;
      this.scene.add(p);
      this.particles.push(p);
    }
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.userData.life -= dt;
      p.position.addScaledVector(p.userData.vel, dt);
      p.userData.vel.multiplyScalar(0.93);                  // air drag
      const t = p.userData.life / p.userData.maxLife;
      p.material.opacity = Math.max(0, t);
      p.scale.setScalar(1 + (1 - t) * 1.6);
      if (p.userData.life <= 0) {
        this.scene.remove(p);
        p.material.dispose();                                // unique mat per particle
        this.particles.splice(i, 1);
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   HUDController
═══════════════════════════════════════════════════════════ */
export class HUDController {
  constructor(hud, plane, helper, joystick, flight, bullets) {
    this.hud      = hud;
    this.plane    = plane;
    this.helper   = helper;
    this.joystick = joystick;
    this.flight   = flight;
    this.bullets  = bullets;

    // If index.html doesn't include a Score row, create one and
    // append it to the top-left panel so we keep the visual style.
    if (!hud.score) this._createScoreRow();
  }

  _createScoreRow() {
    const panel = document.getElementById('panel-tl');
    if (!panel) return;
    const row = document.createElement('div');
    row.className = 'hud-row';
    row.innerHTML =
      '<span class="hud-label">Score</span>' +
      '<span class="hud-value" id="hud-score" style="color:#ffdd44;text-shadow:0 0 10px #ffaa22aa">0</span>';
    panel.appendChild(row);
    this.hud.score = row.querySelector('#hud-score');
  }

  update(input) {
    const v        = this.flight.velocity;
    const speed    = Math.round(v.length());
    const altitude = Math.round(this.plane.position.y + 80);
    const heading  = ((Math.atan2(v.x, -v.z) * 180 / Math.PI) + 360) % 360;
    const force    = this.helper.getSpeedForce();

    this.hud.speed.textContent      = `${speed} km/h`;
    this.hud.altitude.textContent   = `${altitude} m`;
    this.hud.heading.textContent    = `${Math.round(heading)}°`;
    this.hud.throttle.style.height  = `${Math.round(input.throttle * 100)}%`;
    this.hud.inputLabel.textContent = this.joystick.getStatusLabel();

    if (this.hud.boost)      this.hud.boost.style.height = `${Math.round(force * 100)}%`;
    if (this.hud.boostLabel) this.hud.boostLabel.classList.toggle('active', force > 0.1);
    if (this.hud.score && this.bullets) {
      this.hud.score.textContent = String(this.bullets.score);
    }
  }
}
