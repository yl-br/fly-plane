/**
 * game.js — must use the JoystickHelper.
 *
 * If you don't see "[Game] JoystickHelper attached" in the browser console,
 * you're running the wrong file.  Replace whatever you have with this one.
 */

import * as THREE         from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { JoystickHelper } from './joystick-helper.js';

/* ═══════════════════════════════════════════════════════════
   Helper – build the airplane mesh
═══════════════════════════════════════════════════════════ */
function buildAirplane() {
  const group = new THREE.Group();

  const metalMat  = new THREE.MeshStandardMaterial({ color: 0xd0dce8, metalness: 0.6, roughness: 0.3 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xff4422, metalness: 0.4, roughness: 0.4 });
  const glassMat  = new THREE.MeshStandardMaterial({ color: 0x88ccff, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.6 });
  const engineMat = new THREE.MeshStandardMaterial({ color: 0x222233, metalness: 0.8, roughness: 0.2 });

  // Fuselage
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.18, 3.2, 12), metalMat);
  fuse.rotation.x = Math.PI / 2;
  group.add(fuse);

  // Nose cone
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 12), accentMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, 0, -2.05);
  group.add(nose);

  // Tail cone
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.6, 12), metalMat);
  tail.rotation.x = Math.PI / 2;
  tail.position.set(0, 0, 1.9);
  group.add(tail);

  // Cockpit
  const cockpit = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    glassMat,
  );
  cockpit.position.set(0, 0.26, -0.5);
  group.add(cockpit);

  // Wings
  function makeWing(side) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(side * 2.6,  0.3);
    shape.lineTo(side * 2.2, -0.1);
    shape.lineTo(0.1 * side, -0.15);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false });
    const m   = new THREE.Mesh(geo, metalMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, -0.04, 0.1);
    return m;
  }
  group.add(makeWing(1));
  group.add(makeWing(-1));

  // Wing stripes
  [-1, 1].forEach(s => {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.02, 0.3), accentMat);
    stripe.position.set(s * 0.8, -0.02, 0.1);
    group.add(stripe);
  });

  // H-stabilisers
  [-1, 1].forEach(s => {
    const stab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.5), metalMat);
    stab.position.set(s * 0.7, 0, 1.55);
    group.add(stab);
  });

  // V-stabiliser
  const vStab = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.7, 0.6), accentMat);
  vStab.position.set(0, 0.38, 1.55);
  group.add(vStab);

  // Engine pods + intake rings
  [-1, 1].forEach(s => {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.9, 10), engineMat);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(s * 1.1, -0.18, 0);
    group.add(pod);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 8, 16), accentMat);
    ring.position.set(s * 1.1, -0.18, -0.46);
    group.add(ring);
  });

  // Exhaust glows (tagged so we can pulse them)
  const exhausts = [];
  [-1, 1].forEach(s => {
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(0.1, 16),
      new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.85 }),
    );
    glow.rotation.y = Math.PI;
    glow.position.set(s * 1.1, -0.18, 0.47);
    glow.userData.isExhaust = true;
    group.add(glow);
    exhausts.push(glow);
  });

  group.userData.exhausts = exhausts;
  group.scale.setScalar(1.4);
  return group;
}

/* ═══════════════════════════════════════════════════════════
   Terrain
═══════════════════════════════════════════════════════════ */
class Terrain {
  constructor(scene) {
    this.scene    = scene;
    this.tileSize = 400;
    this.tiles    = new Map();
    this._mat = new THREE.MeshStandardMaterial({ color: 0x2a5c2a, roughness: 0.95 });
  }
  _key(tx, tz) { return `${tx},${tz}`; }
  _makeTile(tx, tz) {
    const S = this.tileSize, G = 32;
    const geo = new THREE.PlaneGeometry(S, S, G, G);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + tx * S;
      const z = pos.getZ(i) + tz * S;
      pos.setY(i, Math.sin(x * 0.015) * 6 + Math.cos(z * 0.013) * 5 + Math.sin((x + z) * 0.008) * 8);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this._mat);
    mesh.position.set(tx * S, -80, tz * S);
    this.scene.add(mesh);
    this.tiles.set(this._key(tx, tz), mesh);
  }
  update(p) {
    const S = this.tileSize, R = 2;
    const cx = Math.round(p.x / S), cz = Math.round(p.z / S);
    for (let dx = -R; dx <= R; dx++)
      for (let dz = -R; dz <= R; dz++) {
        const k = this._key(cx + dx, cz + dz);
        if (!this.tiles.has(k)) this._makeTile(cx + dx, cz + dz);
      }
    for (const [k, mesh] of this.tiles) {
      const [tx, tz] = k.split(',').map(Number);
      if (Math.abs(tx - cx) > R + 1 || Math.abs(tz - cz) > R + 1) {
        this.scene.remove(mesh); mesh.geometry.dispose(); this.tiles.delete(k);
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   Main Game
═══════════════════════════════════════════════════════════ */
export class AirplaneGame {
  constructor(canvas, hud, joystick) {
    this.canvas   = canvas;
    this.hud      = hud;
    this.joystick = joystick;
    this.helper   = new JoystickHelper(joystick);
    this.running  = false;
    this.clock    = new THREE.Clock();

    this.velocity      = new THREE.Vector3(0, 0, -60);
    this.throttleLevel = 0.5;

    this._camOffset = new THREE.Vector3(0, 3, 14);
    this._camTarget = new THREE.Vector3();
    this._fovBase   = 65;
    this._fovKick   = 0;
    this._streaks   = [];

    this.helper.on('speedStart', () => {
      this._fovKick = 12;                      // bigger kick
      console.log('[Game] speedStart  → boost engaged');
    });
    this.helper.on('speedEnd', () => console.log('[Game] speedEnd  → boost released'));

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

    this.camera = new THREE.PerspectiveCamera(this._fovBase, W / H, 0.5, 2000);
    this.camera.position.set(0, 4, 14);

    this.scene.add(new THREE.AmbientLight(0xffeedd, 0.5));
    const sun = new THREE.DirectionalLight(0xfff5e0, 1.4);
    sun.position.set(80, 120, -60);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xaaddff, 0.4);
    fill.position.set(-1, 0.5, 1);
    this.scene.add(fill);

    this.plane = buildAirplane();
    this.scene.add(this.plane);
    this.terrain = new Terrain(this.scene);
    this._buildClouds();
    this._exhaust = [];
    this._exhaustTimer = 0;

    new ResizeObserver(() => this._onResize()).observe(this.canvas.parentElement);
    this.running = true;
    this._loop();
  }

  _buildClouds() {
    this.clouds = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.88, roughness: 1 });
    for (let i = 0; i < 80; i++) {
      const clump = new THREE.Group();
      const puffs = 3 + Math.floor(Math.random() * 4);
      for (let p = 0; p < puffs; p++) {
        const r = 8 + Math.random() * 14;
        const m = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 5), mat);
        m.position.set((Math.random() - 0.5) * r * 1.6, (Math.random() - 0.5) * r * 0.4, (Math.random() - 0.5) * r * 1.2);
        clump.add(m);
      }
      clump.position.set((Math.random() - 0.5) * 1600, 20 + Math.random() * 180, (Math.random() - 0.5) * 1600);
      this.clouds.add(clump);
    }
    this.scene.add(this.clouds);
  }

  /* ── Exhaust ────────────────────────────────────────────── */

  _spawnExhaust() {
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
      p.userData.vel  = this.velocity.clone().multiplyScalar(0.01)
        .add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5));
      this.scene.add(p);
      this._exhaust.push(p);
    });
  }

  _updateExhaust(dt) {
    const force = this.helper.getSpeedForce();
    const interval = 0.04 - force * 0.025;
    this._exhaustTimer += dt;
    if (this._exhaustTimer > interval) { this._exhaustTimer = 0; this._spawnExhaust(); }

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

  /* ── Speed streaks ──────────────────────────────────────── */

  _updateStreaks(dt) {
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
    const speed = this.velocity.length();
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

  /* ── Flight ─────────────────────────────────────────────── */

  _updateFlight(dt, input) {
    const MAX_SPEED   = 200;
    const MIN_SPEED   = 20;
    const PITCH_RATE  = 0.8;
    const ROLL_RATE   = 1.2;
    const YAW_RATE    = 0.4;
    const GRAVITY     = 9.8;
    const LIFT_FACTOR = 0.35;

    // ── SPEED FORCE ──
    // Read from helper, but fall back to raw button if helper somehow missing
    const force =
      (this.helper && this.helper.getSpeedForce && this.helper.getSpeedForce()) ||
      (input.speed ? 1 : 0);

    const BOOST_BONUS = 280;             // ← *much* bigger — unmissable
    this.throttleLevel = input.throttle;

    const targetSpeed = MIN_SPEED
                      + (MAX_SPEED - MIN_SPEED) * this.throttleLevel
                      + BOOST_BONUS * force;
    const currentSpeed = this.velocity.length();
    // Boost makes the plane *snap* toward the target
    const responsiveness = 1.5 + force * 5.0;
    const thrustDelta    = (targetSpeed - currentSpeed) * responsiveness * dt;
    if (currentSpeed > 0.1) this.velocity.multiplyScalar(1 + thrustDelta / currentSpeed);

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

    // Forward velocity in plane's local Z
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.plane.quaternion);
    this.velocity.copy(fwd.multiplyScalar(currentSpeed || MIN_SPEED));

    // Gravity / lift
    const lift = Math.max(0, currentSpeed * LIFT_FACTOR - GRAVITY);
    this.velocity.y -= (GRAVITY - lift) * dt * 0.3;

    this.plane.position.addScaledVector(this.velocity, dt);
    if (this.plane.position.y < -60) { this.plane.position.y = -60; this.velocity.y = Math.max(0, this.velocity.y); }
    if (Math.abs(input.roll) < 0.05) this.plane.rotation.z *= 0.97;
  }

  /* ── Camera ─────────────────────────────────────────────── */

  _updateCamera() {
    const force = this.helper.getSpeedForce();

    const offset = this._camOffset.clone();
    offset.z += force * 6;                              // bigger dolly back
    offset.applyQuaternion(this.plane.quaternion);
    const desired = this.plane.position.clone().add(offset);

    const lerp = 0.07 - force * 0.025;                  // more lag
    this.camera.position.lerp(desired, Math.max(0.02, lerp));

    this._fovKick *= 0.92;
    const targetFov = this._fovBase + force * 22 + this._fovKick;
    this.camera.fov += (targetFov - this.camera.fov) * 0.18;
    this.camera.updateProjectionMatrix();

    if (force > 0.05) {
      const k = force * 0.10;
      this.camera.position.x += (Math.random() - 0.5) * k;
      this.camera.position.y += (Math.random() - 0.5) * k;
    }

    this._camTarget.lerp(this.plane.position, 0.12);
    this.camera.lookAt(this._camTarget);
  }

  _updateClouds() {
    this.clouds.position.x = this.plane.position.x;
    this.clouds.position.z = this.plane.position.z;
    this.clouds.children.forEach((c, i) => { c.rotation.y += 0.00008 * (i % 2 ? -1 : 1); });
  }

  /* ── HUD ────────────────────────────────────────────────── */

  _updateHUD(input) {
    const speed    = Math.round(this.velocity.length());
    const altitude = Math.round(this.plane.position.y + 80);
    const heading  = ((Math.atan2(this.velocity.x, -this.velocity.z) * 180 / Math.PI) + 360) % 360;
    const force    = this.helper.getSpeedForce();

    this.hud.speed.textContent     = `${speed} km/h`;
    this.hud.altitude.textContent  = `${altitude} m`;
    this.hud.heading.textContent   = `${Math.round(heading)}°`;
    this.hud.throttle.style.height = `${Math.round(input.throttle * 100)}%`;
    this.hud.inputLabel.textContent = this.joystick.getStatusLabel();

    if (this.hud.boost)      this.hud.boost.style.height = `${Math.round(force * 100)}%`;
    if (this.hud.boostLabel) this.hud.boostLabel.classList.toggle('active', force > 0.1);
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
    const input = this.joystick.update();
    this.helper.update(dt);

    this._updateFlight(dt, input);
    this._updateCamera();
    this._updateExhaust(dt);
    this._updateStreaks(dt);
    this._updateClouds();
    this.terrain.update(this.plane.position);
    this._updateHUD(input);

    this.renderer.render(this.scene, this.camera);
  }

  stop() { this.running = false; }
}
