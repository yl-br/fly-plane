/**
 * game-board.js
 * ─────────────
 * Visual world pieces. These are passive scene objects — they don't
 * read input or run physics. The controllers in game-controllers.js
 * drive their state each frame.
 *
 *   • buildAirplane()  – constructs the airplane mesh (a THREE.Group)
 *   • Terrain          – tile-streaming heightmap ground
 *   • Clouds           – drifting cloud field that follows the plane
 *   • Balloons         – colored hot-air balloons; the bullet-system targets
 *                        them. Streams in/out around the plane.
 */

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';

/* ═══════════════════════════════════════════════════════════
   Helper – build the airplane mesh
═══════════════════════════════════════════════════════════ */
export function buildAirplane() {
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
export class Terrain {
  constructor(scene) {
    this.scene    = scene;
    this.tileSize = 400;
    this.tiles    = new Map();
    this._mat = new THREE.MeshStandardMaterial({ color: 0x2a5c2a, roughness: 0.95 });
  }
  _key(tx, tz) { return `${tx},${tz}`; }

  /**
   * World-space Y of the ground at (x, z). Uses the same heightmap
   * formula as _makeTile, so it works everywhere — even on tiles that
   * haven't streamed in yet. Used by the game's collision check.
   */
  getHeightAt(x, z) {
    const dy = Math.sin(x * 0.015) * 6
             + Math.cos(z * 0.013) * 5
             + Math.sin((x + z) * 0.008) * 8;
    return -80 + dy;
  }

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
   Clouds
═══════════════════════════════════════════════════════════ */
export class Clouds {
  constructor(scene) {
    this.group = new THREE.Group();
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
      this.group.add(clump);
    }
    scene.add(this.group);
  }

  update(planePosition) {
    this.group.position.x = planePosition.x;
    this.group.position.z = planePosition.z;
    this.group.children.forEach((c, i) => { c.rotation.y += 0.00008 * (i % 2 ? -1 : 1); });
  }
}

/* ═══════════════════════════════════════════════════════════
   Balloons
   ─────────
   Hot-air balloons in a palette of colors. Each balloon has a
   collision radius so the BulletSystem can hit-test against it.
   Balloons drift gently and bob up and down. When one falls more
   than ~1500 units from the plane, it's recycled to a new spot
   ahead of the plane so the world stays populated.
═══════════════════════════════════════════════════════════ */
export class Balloons {
  constructor(scene, planePosition) {
    this.scene  = scene;
    this.colors = [0xff3333, 0x33cc44, 0x3388ff, 0xffcc22, 0xcc44ff, 0xff8822, 0x22ddcc];

    // Shared geometries — never disposed (page reload cleans up)
    this._geo = {
      body:   new THREE.SphereGeometry(8, 14, 12),
      basket: new THREE.BoxGeometry(3, 2, 3),
      rope:   new THREE.CylinderGeometry(0.06, 0.06, 6, 4),
    };

    // Shared materials. One body material per color.
    this._bodyMats = this.colors.map(c => new THREE.MeshStandardMaterial({
      color: c, roughness: 0.45, metalness: 0.05,
    }));
    this._basketMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9 });
    this._ropeMat   = new THREE.MeshBasicMaterial({ color: 0x222222 });

    this.balloons    = [];
    this.targetCount = 28;
    this.recycleDist = 1500;

    // Initial spawn — 360° around the plane so the player has things
    // in every direction at game start.
    for (let i = 0; i < this.targetCount; i++) {
      this._spawn(planePosition, null, /* initial */ true);
    }
  }

  _spawn(planePos, planeQuat, initial = false) {
    const colorIdx = Math.floor(Math.random() * this.colors.length);

    const group = new THREE.Group();

    const body = new THREE.Mesh(this._geo.body, this._bodyMats[colorIdx]);
    body.scale.y = 1.25;                      // teardrop-ish
    body.position.y = 0;
    group.add(body);

    const basket = new THREE.Mesh(this._geo.basket, this._basketMat);
    basket.position.y = -12;
    group.add(basket);

    [-1, 1].forEach(sx => [-1, 1].forEach(sz => {
      const rope = new THREE.Mesh(this._geo.rope, this._ropeMat);
      rope.position.set(sx * 1.4, -7, sz * 1.4);
      group.add(rope);
    }));

    // Position. Initial = anywhere within radius. Recycle = ahead of
    // the plane in a forward cone so the player flies into them.
    let angle, dist;
    if (initial || !planeQuat) {
      angle = Math.random() * Math.PI * 2;
      dist  = 200 + Math.random() * 700;
    } else {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(planeQuat);
      const baseAngle = Math.atan2(fwd.x, fwd.z);
      angle = baseAngle + (Math.random() - 0.5) * Math.PI * 1.1;   // ±~100°
      dist  = 600 + Math.random() * 500;
    }
    group.position.set(
      planePos.x + Math.sin(angle) * dist,
      30 + Math.random() * 160,
      planePos.z + Math.cos(angle) * dist,
    );

    this.scene.add(group);

    this.balloons.push({
      group,
      color:    this.colors[colorIdx],
      radius:   13,                                  // collision radius (forgiving)
      drift:    new THREE.Vector3((Math.random() - 0.5) * 1.2, 0, (Math.random() - 0.5) * 1.2),
      bobPhase: Math.random() * Math.PI * 2,
      bobAmp:   0.5 + Math.random() * 0.8,
    });
  }

  /** Remove a balloon (called by the bullet system on hit) and respawn one ahead. */
  remove(balloon, planePos, planeQuat) {
    this.scene.remove(balloon.group);
    // Geometries and materials are shared — don't dispose them.
    const idx = this.balloons.indexOf(balloon);
    if (idx >= 0) this.balloons.splice(idx, 1);
    this._spawn(planePos, planeQuat);
  }

  update(dt, planePos, planeQuat) {
    // Drift + bob
    for (const b of this.balloons) {
      b.bobPhase += dt * 0.6;
      b.group.position.x += b.drift.x * dt;
      b.group.position.y += Math.sin(b.bobPhase) * b.bobAmp * dt;
      b.group.position.z += b.drift.z * dt;
    }

    // Recycle far-away balloons
    const r2 = this.recycleDist * this.recycleDist;
    for (let i = this.balloons.length - 1; i >= 0; i--) {
      const b = this.balloons[i];
      const dx = b.group.position.x - planePos.x;
      const dz = b.group.position.z - planePos.z;
      if (dx * dx + dz * dz > r2) {
        this.scene.remove(b.group);
        this.balloons.splice(i, 1);
        this._spawn(planePos, planeQuat);
      }
    }
  }

  /** Read-only view of the active balloons (for collision tests). */
  getActive() { return this.balloons; }
}
