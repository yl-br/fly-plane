/**
 * game.js
 * Core 3-D flight game built on Three.js.
 * Import and call  new AirplaneGame(canvas, hud, joystick)  to start.
 */

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';

/* ═══════════════════════════════════════════════════════════
   Helper – build the airplane mesh from primitives
═══════════════════════════════════════════════════════════ */
function buildAirplane() {
  const group = new THREE.Group();

  const metalMat = new THREE.MeshStandardMaterial({
    color: 0xd0dce8, metalness: 0.6, roughness: 0.3,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0xff4422, metalness: 0.4, roughness: 0.4,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x88ccff, metalness: 0.1, roughness: 0.05,
    transparent: true, opacity: 0.6,
  });
  const engineMat = new THREE.MeshStandardMaterial({
    color: 0x222233, metalness: 0.8, roughness: 0.2,
  });

  // ── Fuselage ──────────────────────────────────────────
  const fuseGeo = new THREE.CylinderGeometry(0.28, 0.18, 3.2, 12);
  const fuse    = new THREE.Mesh(fuseGeo, metalMat);
  fuse.rotation.x = Math.PI / 2;
  group.add(fuse);

  // Nose cone
  const noseGeo = new THREE.ConeGeometry(0.28, 0.9, 12);
  const nose    = new THREE.Mesh(noseGeo, accentMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, 0, -2.05);
  group.add(nose);

  // Tail cone
  const tailGeo = new THREE.ConeGeometry(0.18, 0.6, 12);
  const tail    = new THREE.Mesh(tailGeo, metalMat);
  tail.rotation.x = Math.PI / 2;
  tail.position.set(0, 0, 1.9);
  group.add(tail);

  // Cockpit bubble
  const cockpitGeo = new THREE.SphereGeometry(0.22, 10, 8,
    0, Math.PI * 2, 0, Math.PI * 0.55);
  const cockpit   = new THREE.Mesh(cockpitGeo, glassMat);
  cockpit.position.set(0, 0.26, -0.5);
  group.add(cockpit);

  // ── Main wings ───────────────────────────────────────
  function makeWing(side) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(side * 2.6,  0.3);
    shape.lineTo(side * 2.2, -0.1);
    shape.lineTo(0.1 * side, -0.15);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.06, bevelEnabled: false,
    });
    const mesh = new THREE.Mesh(geo, metalMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, -0.04, 0.1);
    return mesh;
  }
  group.add(makeWing( 1));
  group.add(makeWing(-1));

  // Wing accent stripe
  [-1, 1].forEach(s => {
    const stripeGeo = new THREE.BoxGeometry(1.2, 0.02, 0.3);
    const stripe    = new THREE.Mesh(stripeGeo, accentMat);
    stripe.position.set(s * 0.8, -0.02, 0.1);
    group.add(stripe);
  });

  // ── Horizontal stabilisers ───────────────────────────
  [-1, 1].forEach(s => {
    const stabGeo = new THREE.BoxGeometry(1.4, 0.05, 0.5);
    const stab    = new THREE.Mesh(stabGeo, metalMat);
    stab.position.set(s * 0.7, 0, 1.55);
    group.add(stab);
  });

  // ── Vertical stabiliser ──────────────────────────────
  const vStabGeo = new THREE.BoxGeometry(0.05, 0.7, 0.6);
  const vStab    = new THREE.Mesh(vStabGeo, accentMat);
  vStab.position.set(0, 0.38, 1.55);
  group.add(vStab);

  // ── Jet engines (underwing pods) ─────────────────────
  [-1, 1].forEach(s => {
    const podGeo  = new THREE.CylinderGeometry(0.12, 0.1, 0.9, 10);
    const pod     = new THREE.Mesh(podGeo, engineMat);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(s * 1.1, -0.18, 0);
    group.add(pod);

    // Intake ring
    const ringGeo = new THREE.TorusGeometry(0.12, 0.02, 8, 16);
    const ring    = new THREE.Mesh(ringGeo, accentMat);
    ring.position.set(s * 1.1, -0.18, -0.46);
    group.add(ring);
  });

  // ── Exhaust glow ─────────────────────────────────────
  [-1, 1].forEach(s => {
    const glowGeo = new THREE.CircleGeometry(0.1, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xff8800, transparent: true, opacity: 0.85,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.rotation.y = Math.PI;
    glow.position.set(s * 1.1, -0.18, 0.47);
    glow.userData.isExhaust = true;
    group.add(glow);
  });

  group.scale.setScalar(1.4);
  return group;
}

/* ═══════════════════════════════════════════════════════════
   Helper – infinite terrain tiles
═══════════════════════════════════════════════════════════ */
class Terrain {
  constructor(scene) {
    this.scene    = scene;
    this.tileSize = 400;
    this.tiles    = new Map();
    this._mat = new THREE.MeshStandardMaterial({
      color:     0x2a5c2a,
      roughness: 0.95,
      metalness: 0.0,
      wireframe: false,
    });
  }

  _key(tx, tz) { return `${tx},${tz}`; }

  _makeTile(tx, tz) {
    const S  = this.tileSize;
    const G  = 32;
    const geo = new THREE.PlaneGeometry(S, S, G, G);
    geo.rotateX(-Math.PI / 2);

    // Gentle height noise
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + tx * S;
      const z = pos.getZ(i) + tz * S;
      const h = Math.sin(x * 0.015) * 6
              + Math.cos(z * 0.013) * 5
              + Math.sin((x + z) * 0.008) * 8;
      pos.setY(i, h);
    }
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, this._mat);
    mesh.receiveShadow = true;
    mesh.position.set(tx * S, -80, tz * S);
    this.scene.add(mesh);
    this.tiles.set(this._key(tx, tz), mesh);
  }

  update(playerPos) {
    const S  = this.tileSize;
    const R  = 2; // tiles in each direction
    const cx = Math.round(playerPos.x / S);
    const cz = Math.round(playerPos.z / S);

    // Add missing tiles
    for (let dx = -R; dx <= R; dx++) {
      for (let dz = -R; dz <= R; dz++) {
        const k = this._key(cx + dx, cz + dz);
        if (!this.tiles.has(k)) this._makeTile(cx + dx, cz + dz);
      }
    }

    // Remove far tiles
    for (const [k, mesh] of this.tiles) {
      const [tx, tz] = k.split(',').map(Number);
      if (Math.abs(tx - cx) > R + 1 || Math.abs(tz - cz) > R + 1) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        this.tiles.delete(k);
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   Main Game Class
═══════════════════════════════════════════════════════════ */
export class AirplaneGame {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object}            hud     - DOM refs { speed, altitude, heading, throttle, inputLabel }
   * @param {JoystickController} joystick
   */
  constructor(canvas, hud, joystick) {
    this.canvas   = canvas;
    this.hud      = hud;
    this.joystick = joystick;
    this.running  = false;
    this.clock    = new THREE.Clock();

    // Flight state
    this.velocity      = new THREE.Vector3(0, 0, -60); // initial forward speed
    this.angularRate   = new THREE.Euler(0, 0, 0, 'YXZ');
    this.throttleLevel = 0.5;

    // Camera spring
    this._camOffset = new THREE.Vector3(0, 3, 14);
    this._camTarget = new THREE.Vector3();

    this._init();
  }

  /* ── Scene setup ──────────────────────────────────────── */

  _init() {
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setSize(W, H, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping       = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x87ceeb, 200, 900);
    this.scene.background = new THREE.Color(0x87ceeb);

    // Camera
    this.camera = new THREE.PerspectiveCamera(65, W / H, 0.5, 2000);
    this.camera.position.set(0, 4, 14);

    // Lighting
    const ambient = new THREE.AmbientLight(0xffeedd, 0.5);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff5e0, 1.4);
    sun.position.set(80, 120, -60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far  = 600;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -250;
    sun.shadow.camera.right = sun.shadow.camera.top   =  250;
    this.scene.add(sun);

    const fillLight = new THREE.DirectionalLight(0xaaddff, 0.4);
    fillLight.position.set(-1, 0.5, 1);
    this.scene.add(fillLight);

    // Airplane
    this.plane = buildAirplane();
    this.plane.castShadow = true;
    this.scene.add(this.plane);

    // Terrain
    this.terrain = new Terrain(this.scene);

    // Clouds
    this._buildClouds();

    // Stars (high altitude)
    this._buildStars();

    // Exhaust particles
    this._exhaust = [];
    this._exhaustTimer = 0;

    // Resize observer
    const ro = new ResizeObserver(() => this._onResize());
    ro.observe(this.canvas.parentElement);

    this.running = true;
    this._loop();
  }

  /* ── Cloud system ─────────────────────────────────────── */

  _buildClouds() {
    this.clouds = new THREE.Group();
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, transparent: true, opacity: 0.88,
      roughness: 1, metalness: 0,
    });

    for (let i = 0; i < 80; i++) {
      const clump = new THREE.Group();
      const puffs = 3 + Math.floor(Math.random() * 4);
      for (let p = 0; p < puffs; p++) {
        const r   = 8 + Math.random() * 14;
        const geo = new THREE.SphereGeometry(r, 7, 5);
        const m   = new THREE.Mesh(geo, cloudMat);
        m.position.set(
          (Math.random() - 0.5) * r * 1.6,
          (Math.random() - 0.5) * r * 0.4,
          (Math.random() - 0.5) * r * 1.2,
        );
        clump.add(m);
      }
      clump.position.set(
        (Math.random() - 0.5) * 1600,
        20 + Math.random() * 180,
        (Math.random() - 0.5) * 1600,
      );
      this.clouds.add(clump);
    }
    this.scene.add(this.clouds);
  }

  /* ── Stars ─────────────────────────────────────────────── */

  _buildStars() {
    const geo = new THREE.BufferGeometry();
    const n   = 1200;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 4000;
      pos[i * 3 + 1] = 400 + Math.random() * 1200;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 4000;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat   = new THREE.PointsMaterial({ color: 0xffffff, size: 0.9 });
    this.stars  = new THREE.Points(geo, mat);
    this.scene.add(this.stars);
  }

  /* ── Exhaust particles ─────────────────────────────────── */

  _spawnExhaust() {
    const geo = new THREE.SphereGeometry(0.25, 4, 4);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff6600, transparent: true, opacity: 0.7,
    });

    // One particle per engine pod
    [-1, 1].forEach(s => {
      const p = new THREE.Mesh(geo, mat.clone());
      const worldPos = new THREE.Vector3(s * 1.54, -0.25, 0.65);
      this.plane.localToWorld(worldPos);
      p.position.copy(worldPos);
      p.userData.life = 1;
      p.userData.vel  = this.velocity.clone().multiplyScalar(0.01)
        .add(new THREE.Vector3(
          (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 0.5,
        ));
      this.scene.add(p);
      this._exhaust.push(p);
    });
  }

  _updateExhaust(dt) {
    this._exhaustTimer += dt;
    if (this._exhaustTimer > 0.04) {
      this._exhaustTimer = 0;
      this._spawnExhaust();
    }

    for (let i = this._exhaust.length - 1; i >= 0; i--) {
      const p = this._exhaust[i];
      p.userData.life -= dt * 2.5;
      p.material.opacity = p.userData.life * 0.7;
      p.scale.setScalar(1 + (1 - p.userData.life) * 2);
      p.position.add(p.userData.vel);

      if (p.userData.life <= 0) {
        this.scene.remove(p);
        p.geometry.dispose();
        p.material.dispose();
        this._exhaust.splice(i, 1);
      }
    }
  }

  /* ── Flight physics ─────────────────────────────────────── */

  _updateFlight(dt, input) {
    const MAX_SPEED   = 200;
    const MIN_SPEED   = 20;
    const PITCH_RATE  = 0.8;
    const ROLL_RATE   = 1.2;
    const YAW_RATE    = 0.4;
    const GRAVITY     = 9.8;
    const LIFT_FACTOR = 0.35;

    // ── Throttle ────────────────────────────────────────
    this.throttleLevel = input.throttle;
    const targetSpeed  = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * this.throttleLevel;
    const currentSpeed = this.velocity.length();
    const thrustDelta  = (targetSpeed - currentSpeed) * 1.5 * dt;
    if (currentSpeed > 0.1) {
      this.velocity.multiplyScalar(1 + thrustDelta / currentSpeed);
    }

    // ── Rotation inputs ─────────────────────────────────
    const euler = new THREE.Euler().copy(this.plane.rotation);
    euler.order = 'YXZ';

    // Pitch (X)
    euler.x += input.pitch * PITCH_RATE * dt;
    euler.x = Math.max(-Math.PI * 0.45, Math.min(Math.PI * 0.45, euler.x));

    // Roll (Z)
    euler.z -= input.roll * ROLL_RATE * dt;
    euler.z = Math.max(-Math.PI * 0.55, Math.min(Math.PI * 0.55, euler.z));

    // Natural roll-to-yaw coupling
    euler.y -= input.roll * YAW_RATE * dt * 0.4;

    // Explicit yaw
    euler.y -= input.yaw * YAW_RATE * dt;

    // Gravity & lift
    const lift = Math.max(0, currentSpeed * LIFT_FACTOR - GRAVITY);
    const gravEffect = GRAVITY - lift;

    this.plane.rotation.set(euler.x, euler.y, euler.z, 'YXZ');

    // ── Forward velocity in plane's local Z ─────────────
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(this.plane.quaternion);
    this.velocity.copy(forward.multiplyScalar(currentSpeed || MIN_SPEED));

    // Apply gravity drag on Y
    this.velocity.y -= gravEffect * dt * 0.3;

    // Move the plane
    this.plane.position.addScaledVector(this.velocity, dt);

    // Floor clamp
    const MIN_ALT = -60;
    if (this.plane.position.y < MIN_ALT) {
      this.plane.position.y = MIN_ALT;
      this.velocity.y = Math.max(0, this.velocity.y);
    }

    // Roll auto-level when no input
    if (Math.abs(input.roll) < 0.05) {
      this.plane.rotation.z *= 0.97;
    }
  }

  /* ── Camera spring-arm ─────────────────────────────────── */

  _updateCamera() {
    // Offset behind & above in local space
    const offset = this._camOffset.clone();
    offset.applyQuaternion(this.plane.quaternion);
    const desired = this.plane.position.clone().add(offset);

    // Smooth lerp
    this.camera.position.lerp(desired, 0.07);
    this._camTarget.lerp(this.plane.position, 0.12);
    this.camera.lookAt(this._camTarget);
  }

  /* ── Clouds – billboard-drift ──────────────────────────── */

  _updateClouds() {
    // Keep clouds centred around player on XZ
    this.clouds.position.x = this.plane.position.x;
    this.clouds.position.z = this.plane.position.z;

    // Slowly rotate for parallax drift feeling
    this.clouds.children.forEach((c, i) => {
      c.rotation.y += 0.00008 * (i % 2 === 0 ? 1 : -1);
    });
  }

  /* ── HUD update ────────────────────────────────────────── */

  _updateHUD(input) {
    const speed    = Math.round(this.velocity.length());
    const altitude = Math.round(this.plane.position.y + 80);
    const heading  = ((Math.atan2(this.velocity.x, -this.velocity.z)
                       * 180 / Math.PI) + 360) % 360;

    this.hud.speed.textContent    = `${speed} km/h`;
    this.hud.altitude.textContent = `${altitude} m`;
    this.hud.heading.textContent  = `${Math.round(heading)}°`;
    this.hud.throttle.style.height = `${Math.round(input.throttle * 100)}%`;
    this.hud.inputLabel.textContent = this.joystick.getStatusLabel();
  }

  /* ── Resize ────────────────────────────────────────────── */

  _onResize() {
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    this.renderer.setSize(W, H, false);
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
  }

  /* ── Main loop ─────────────────────────────────────────── */

  _loop() {
    if (!this.running) return;
    requestAnimationFrame(() => this._loop());

    const dt    = Math.min(this.clock.getDelta(), 0.05); // cap at 50 ms
    const input = this.joystick.update();

    this._updateFlight(dt, input);
    this._updateCamera();
    this._updateExhaust(dt);
    this._updateClouds();
    this.terrain.update(this.plane.position);
    this._updateHUD(input);

    this.renderer.render(this.scene, this.camera);
  }

  stop() { this.running = false; }
}
