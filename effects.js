/**
 * effects.js
 * ──────────
 * Visual effects that aren't part of the regular gameplay loop.
 *
 *   • CrashEffects  – big, dramatic plane-impact explosion. Bigger and
 *                     longer-lived than ExplosionSystem (which is for
 *                     balloon pops).
 *
 *                     Composition:
 *                       1 flash sphere     bright additive pop at the impact
 *                       40 fire particles  red/orange/yellow, additive, gravity
 *                       22 smoke particles dark gray, rise and expand, slow fade
 *                       1 shockwave ring   ground-plane expanding ring
 *
 *                     Usage:
 *                       const fx = new CrashEffects(scene);
 *                       fx.trigger(planePosition);     // once on impact
 *                       fx.update(dt);                  // every frame after
 */

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';

export class CrashEffects {
  constructor(scene) {
    this.scene      = scene;
    this.particles  = [];
    this.shockwaves = [];

    // Shared geometries — never disposed (page reload cleans up)
    this._fireGeo  = new THREE.SphereGeometry(1.2, 6, 6);
    this._smokeGeo = new THREE.SphereGeometry(1.5, 6, 6);
    this._flashGeo = new THREE.SphereGeometry(6, 12, 8);
    this._ringGeo  = new THREE.RingGeometry(0.9, 1.0, 36);
  }

  /** Spawn the explosion at `position`. Call once per crash. */
  trigger(position) {
    // ── Flash: bright additive sphere that pops and disappears ──
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffeebb, transparent: true, opacity: 1.0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const flash = new THREE.Mesh(this._flashGeo, flashMat);
    flash.position.copy(position);
    flash.userData = { kind: 'flash', life: 0.25, maxLife: 0.25 };
    this.scene.add(flash);
    this.particles.push(flash);

    // ── Fire particles ──
    const fireColors = [0xffdd44, 0xff8822, 0xff4422, 0xff2211];
    for (let i = 0; i < 40; i++) {
      const color = fireColors[Math.floor(Math.random() * fireColors.length)];
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 1.0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const p = new THREE.Mesh(this._fireGeo, mat);
      p.position.copy(position);
      const speed = 18 + Math.random() * 30;
      // Slight upward bias so the fireball blooms rather than just spreading flat.
      p.userData = {
        kind: 'fire',
        vel: new THREE.Vector3(
          (Math.random() - 0.5),
           Math.random() * 0.7 + 0.1,
          (Math.random() - 0.5),
        ).normalize().multiplyScalar(speed),
        life: 0.7 + Math.random() * 0.5,
      };
      p.userData.maxLife = p.userData.life;
      this.scene.add(p);
      this.particles.push(p);
    }

    // ── Smoke particles (rise + linger) ──
    for (let i = 0; i < 22; i++) {
      // Subtly varied dark gray so the smoke cloud reads as volumetric.
      const shade = 0x22 + Math.floor(Math.random() * 0x22);
      const gray = (shade << 16) | (shade << 8) | shade;
      const mat = new THREE.MeshBasicMaterial({
        color: gray, transparent: true, opacity: 0.85, depthWrite: false,
      });
      const p = new THREE.Mesh(this._smokeGeo, mat);
      p.position.copy(position);
      p.userData = {
        kind: 'smoke',
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 0.5,
           Math.random() * 0.8 + 0.4,
          (Math.random() - 0.5) * 0.5,
        ).normalize().multiplyScalar(6 + Math.random() * 8),
        life: 1.4 + Math.random() * 1.0,
      };
      p.userData.maxLife = p.userData.life;
      this.scene.add(p);
      this.particles.push(p);
    }

    // ── Shockwave ring on the ground plane ──
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffaa44, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
    });
    const ring = new THREE.Mesh(this._ringGeo, ringMat);
    ring.position.copy(position);
    ring.rotation.x = -Math.PI / 2;                      // lie flat
    ring.userData = { life: 0.9, maxLife: 0.9 };
    this.scene.add(ring);
    this.shockwaves.push(ring);
  }

  /** Advance and clean up particles. Call every frame after trigger(). */
  update(dt) {
    // ── Particles ──
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      const d = p.userData;
      d.life -= dt;
      const t = d.life / d.maxLife;                      // 1 → 0

      if (d.kind === 'flash') {
        // Quick scale-up then disappear.
        p.scale.setScalar(1 + (1 - t) * 2);
        p.material.opacity = Math.max(0, t);
      } else if (d.kind === 'smoke') {
        p.position.addScaledVector(d.vel, dt);
        d.vel.multiplyScalar(0.96);                      // air drag
        d.vel.y += 4 * dt;                                // smoke rises
        p.material.opacity = Math.max(0, t * 0.7);
        p.scale.setScalar(1 + (1 - t) * 2.5);            // expand as it rises
      } else {                                            // fire
        p.position.addScaledVector(d.vel, dt);
        d.vel.multiplyScalar(0.91);                      // strong drag
        d.vel.y -= 18 * dt;                               // gravity pulls embers down
        p.material.opacity = Math.max(0, t);
        p.scale.setScalar(1 + (1 - t) * 1.4);
      }

      if (d.life <= 0) {
        this.scene.remove(p);
        p.material.dispose();                            // unique mat per particle
        this.particles.splice(i, 1);
      }
    }

    // ── Shockwaves ──
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const r = this.shockwaves[i];
      const d = r.userData;
      d.life -= dt;
      const u = 1 - (d.life / d.maxLife);                // 0 → 1
      r.scale.setScalar(2 + u * 60);                      // expand fast
      r.material.opacity = Math.max(0, (1 - u) * 0.9);
      if (d.life <= 0) {
        this.scene.remove(r);
        r.material.dispose();
        this.shockwaves.splice(i, 1);
      }
    }
  }
}
