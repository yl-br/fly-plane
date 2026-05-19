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
 *   • Enemies          – hostile enemy aircraft that the bullet-system targets.
 *                        Streams in/out around the plane. Each enemy flies
 *                        in a fixed heading; the player flies through the
 *                        formation and picks them off.
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
   Enemies
   ───────
   Hostile enemy aircraft. Replaces the old hot-air balloons —
   same external interface (getActive / remove / update, with
   each item exposing `group`, `radius`, and `color`) so the
   BulletSystem and ExplosionSystem keep working unchanged.

   Each enemy is a small dark-gray fighter with a colored
   accent stripe + engine glow (the accent is also what the
   explosion uses on a hit). They fly in straight lines at a
   fixed heading and speed; when one drifts more than ~1500
   units from the plane, it's recycled to a new spot ahead.

   Gameplay is identical to the old balloon setup: fly into
   the formation, shoot them down.
═══════════════════════════════════════════════════════════ */

/** Build a single enemy-aircraft mesh tinted by `accentColor`. */
function buildEnemyAircraft(accentColor) {
  const group = new THREE.Group();

  // Materials
  const bodyMat   = new THREE.MeshStandardMaterial({ color: 0x2a2a32, roughness: 0.4, metalness: 0.65 });
  const darkMat   = new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.5, metalness: 0.5 });
  const accentMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.3, metalness: 0.5 });
  const eyeMat    = new THREE.MeshStandardMaterial({
    color: 0xff2233, emissive: 0xaa0011, emissiveIntensity: 0.7, roughness: 0.2,
  });
  const glowMat   = new THREE.MeshBasicMaterial({
    color: accentColor, transparent: true, opacity: 0.9,
  });

  // Fuselage — sleek tapered body. Wider at the front so the nose
  // cone reads as menacing rather than dainty.
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.4, 4.0, 10), bodyMat);
  fuse.rotation.x = Math.PI / 2;
  group.add(fuse);

  // Sharp nose cone
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.4, 10), darkMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, 0, -2.7);
  group.add(nose);

  // Red glowing "eye" on the nose — the signature menacing element.
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), eyeMat);
  eye.position.set(0, 0.18, -2.0);
  group.add(eye);

  // Swept-back delta wings (triangular, no curve). Sharp shapes
  // make them read as predatory next to the player's friendlier
  // rounded wings.
  function makeWing(side) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(side * 2.8, 2.2);
    shape.lineTo(side * 0.5, 2.2);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.10, bevelEnabled: false });
    const m   = new THREE.Mesh(geo, bodyMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, -0.05, 0.4);
    return m;
  }
  group.add(makeWing(1));
  group.add(makeWing(-1));

  // Accent stripes along each wing (matches the explosion color).
  [-1, 1].forEach(s => {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.25), accentMat);
    stripe.position.set(s * 1.2, 0.01, 1.1);
    group.add(stripe);
  });

  // Wing-tip glow lights (additive-feeling via basic material)
  [-1, 1].forEach(s => {
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), glowMat);
    tip.position.set(s * 2.7, 0.02, 2.0);
    group.add(tip);
  });

  // Vertical tail fin + accent
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 1.1), bodyMat);
  fin.position.set(0, 0.55, 1.7);
  group.add(fin);
  const finStripe = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.4, 0.45), accentMat);
  finStripe.position.set(0, 0.85, 1.5);
  group.add(finStripe);

  // Engine exhaust glow at the back
  const exhaust = new THREE.Mesh(new THREE.CircleGeometry(0.34, 14), glowMat);
  exhaust.rotation.y = Math.PI;
  exhaust.position.set(0, 0, 2.05);
  group.add(exhaust);

  // Scale to roughly match the player's plane silhouette so they
  // read as peers in the air.
  group.scale.setScalar(1.4);
  return group;
}

export class Enemies {
  constructor(scene, planePosition) {
    this.scene  = scene;
    // Accent palette for the squadron — also used as the explosion
    // color when one is shot down. Same palette as the old balloon
    // colors so the explosion variety is preserved.
    this.colors = [0xff3333, 0x33cc44, 0x3388ff, 0xffcc22, 0xcc44ff, 0xff8822, 0x22ddcc];

    this.enemies     = [];
    this.targetCount = 28;
    this.recycleDist = 1500;

    // Initial spawn — 360° around the plane so the player has
    // contacts in every direction at game start.
    for (let i = 0; i < this.targetCount; i++) {
      this._spawn(planePosition, null, /* initial */ true);
    }
  }

  _spawn(planePos, planeQuat, initial = false) {
    const color = this.colors[Math.floor(Math.random() * this.colors.length)];
    const group = buildEnemyAircraft(color);

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

    // Heading: random direction in the XZ plane. The mesh's nose
    // points at local -Z, so rotation.y = heading orients the plane
    // to face that direction (heading=0 → facing -Z).
    const heading = Math.random() * Math.PI * 2;
    group.rotation.y = heading;
    // A subtle constant bank in a random direction so they don't all
    // look perfectly level — adds visual texture from the cockpit.
    group.rotation.z = (Math.random() - 0.5) * 0.25;

    this.scene.add(group);

    this.enemies.push({
      group,
      color,
      radius:   8,                                    // collision radius (forgiving)
      heading,
      speed:    10 + Math.random() * 10,              // 10–20 units/sec
      bobPhase: Math.random() * Math.PI * 2,
      bobAmp:   0.3 + Math.random() * 0.6,
    });
  }

  /** Remove an enemy (called by the bullet system on hit) and respawn one ahead. */
  remove(enemy, planePos, planeQuat) {
    this.scene.remove(enemy.group);
    // Each enemy owns its meshes' materials (per-color tinting),
    // but they're shared inside one mesh tree — Three.js will GC
    // them when the group is removed and dereferenced. We don't
    // explicitly dispose because the materials are cheap and the
    // page reload on restart cleans everything up anyway.
    const idx = this.enemies.indexOf(enemy);
    if (idx >= 0) this.enemies.splice(idx, 1);
    this._spawn(planePos, planeQuat);
  }

  update(dt, planePos, planeQuat) {
    // Fly forward along each enemy's heading + gentle altitude bob.
    for (const e of this.enemies) {
      const dx = -Math.sin(e.heading) * e.speed * dt;
      const dz = -Math.cos(e.heading) * e.speed * dt;
      e.group.position.x += dx;
      e.group.position.z += dz;
      e.bobPhase += dt * 0.6;
      e.group.position.y += Math.sin(e.bobPhase) * e.bobAmp * dt;
    }

    // Recycle far-away enemies — same logic as the old balloon stream.
    const r2 = this.recycleDist * this.recycleDist;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const dx = e.group.position.x - planePos.x;
      const dz = e.group.position.z - planePos.z;
      if (dx * dx + dz * dz > r2) {
        this.scene.remove(e.group);
        this.enemies.splice(i, 1);
        this._spawn(planePos, planeQuat);
      }
    }
  }

  /** Read-only view of the active enemies (for collision tests). */
  getActive() { return this.enemies; }
}

/* ═══════════════════════════════════════════════════════════
   Moon
   ────
   Far-off landing destination. A big gray cratered sphere with
   a glowing landing pad on top. Fixed in world-space (unlike
   clouds/enemies, which stream around the player) so flying
   toward it actually gets you closer — it functions as a real
   navigable landmark.

   Visibility: all moon materials have `fog: false`, so the
   scene fog (which fully obscures things past ~900 units) does
   not swallow the moon when you're far away. A tall vertical
   beacon helps spot the landing pad from anywhere on the map.

   Landing rules — see `checkContact()`:
     • Plane within the pad cylinder near the pad surface
         → 'landing'  (mission complete)
     • Plane touching the moon body anywhere else
         → 'crash'    (normal crash sequence)
     • Otherwise → null
═══════════════════════════════════════════════════════════ */
export class Moon {
  constructor(scene) {
    this.scene = scene;

    this.radius    = 150;
    this.padRadius = 40;
    this.padHeight = 4;

    // Fixed location: high in the sky, ahead of the player's spawn,
    // so they fly toward it. Altitude 300 forces a deliberate climb
    // (terrain sits at y≈-80, plane cruises around y≈0–30).
    this.position = new THREE.Vector3(0, 300, -1500);

    this.group = new THREE.Group();
    this.group.position.copy(this.position);

    // ── Moon body — gray sphere with vertex-displaced surface ──
    const moonMat = new THREE.MeshStandardMaterial({
      color: 0xc0c0c8, roughness: 0.95, metalness: 0.05, fog: false,
    });
    const moonGeo = new THREE.SphereGeometry(this.radius, 48, 32);
    const mp = moonGeo.attributes.position;
    for (let i = 0; i < mp.count; i++) {
      const x = mp.getX(i), y = mp.getY(i), z = mp.getZ(i);
      // Layered noise so the surface looks pitted rather than smoothly bumpy.
      const noise = Math.sin(x * 0.08) * Math.cos(y * 0.07) * 4
                  + Math.sin(z * 0.11) * Math.cos(x * 0.05) * 2;
      const r = Math.sqrt(x*x + y*y + z*z);
      const s = (r + noise) / r;
      mp.setXYZ(i, x * s, y * s, z * s);
    }
    moonGeo.computeVertexNormals();
    this.group.add(new THREE.Mesh(moonGeo, moonMat));

    // ── Crater patches — darker circles painted onto the surface ──
    // Restrict phi to avoid covering the pad area at the top pole.
    const craterMat = new THREE.MeshStandardMaterial({
      color: 0x808088, roughness: 1, metalness: 0, fog: false,
    });
    for (let i = 0; i < 16; i++) {
      const cr     = 6 + Math.random() * 18;
      const crater = new THREE.Mesh(new THREE.CircleGeometry(cr, 14), craterMat);
      const theta  = Math.random() * Math.PI * 2;
      const phi    = 0.25 + Math.random() * (Math.PI - 0.5);
      const surf   = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
      );
      crater.position.copy(surf.multiplyScalar(this.radius + 0.3));
      crater.lookAt(0, 0, 0);
      crater.rotateY(Math.PI);   // face outward
      this.group.add(crater);
    }

    // ── Landing pad — flat metal cylinder on top of the moon ──
    const padMat = new THREE.MeshStandardMaterial({
      color: 0x445566, roughness: 0.4, metalness: 0.5, fog: false,
    });
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(this.padRadius, this.padRadius * 1.05, this.padHeight, 36),
      padMat,
    );
    pad.position.y = this.radius + this.padHeight / 2;
    this.group.add(pad);

    // ── Pad markings — bright yellow ring inside the pad surface ──
    const rimMat = new THREE.MeshBasicMaterial({
      color: 0xffdd44, transparent: true, opacity: 0.9,
      side: THREE.DoubleSide, fog: false,
    });
    const padRim = new THREE.Mesh(
      new THREE.RingGeometry(this.padRadius * 0.85, this.padRadius * 0.95, 48),
      rimMat,
    );
    padRim.rotation.x = -Math.PI / 2;
    padRim.position.y = this.radius + this.padHeight + 0.12;
    this.group.add(padRim);

    // ── Outer cyan glow ring around the pad (pulsing) ──
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x00ffcc, transparent: true, opacity: 0.6,
      side: THREE.DoubleSide, fog: false,
    });
    const glow = new THREE.Mesh(
      new THREE.RingGeometry(this.padRadius * 0.95, this.padRadius * 1.15, 48),
      glowMat,
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = this.radius + this.padHeight + 0.05;
    this._glow = glow;
    this.group.add(glow);

    // ── Vertical beacon — tall glowing pillar so you can spot
    //    the landing zone from anywhere on the map. ──
    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0x00ffcc, transparent: true, opacity: 0.5, fog: false,
    });
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 0.8, 120, 8),
      beaconMat,
    );
    beacon.position.y = this.radius + this.padHeight + 60;
    this._beacon = beacon;
    this.group.add(beacon);

    scene.add(this.group);

    // World-space top of the pad — used both for landing-zone tests
    // and for parking the plane on touchdown.
    this.padTop = new THREE.Vector3(
      this.position.x,
      this.position.y + this.radius + this.padHeight,
      this.position.z,
    );

    this._t = 0;
  }

  /** Pulse the glow ring + beacon for visibility. Call each frame. */
  update(dt) {
    this._t += dt;
    const pulse = 0.5 + 0.5 * Math.sin(this._t * 2.2);
    if (this._glow)   this._glow.material.opacity   = 0.35 + pulse * 0.35;
    if (this._beacon) this._beacon.material.opacity = 0.25 + pulse * 0.30;
  }

  /**
   * Tests the plane against the moon and the landing pad.
   *
   * Returns:
   *   'landing' — plane is within the pad cylinder near the pad surface
   *   'crash'   — plane is touching the moon body anywhere else
   *    null     — no contact
   *
   * The landing band is generous in Y (a few units above and below the
   * pad surface) so a normal descent gets caught even at frame rates
   * where the plane moves several units per frame.
   */
  checkContact(planePos) {
    const dx = planePos.x - this.position.x;
    const dy = planePos.y - this.position.y;
    const dz = planePos.z - this.position.z;

    const horiz  = Math.sqrt(dx * dx + dz * dz);
    const padTop = this.position.y + this.radius + this.padHeight;

    // Landing zone first — overrides the crash test, so a clean
    // top-down approach is always read as a landing even if the
    // sphere-intersect test would also trigger.
    if (horiz < this.padRadius && planePos.y < padTop + 5 && planePos.y > padTop - 3) {
      return 'landing';
    }

    // Sphere intersection — touching the moon body anywhere else.
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < this.radius + 3) return 'crash';

    return null;
  }
}
