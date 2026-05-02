/**
 * joystick-helper.js
 * ──────────────────
 * Higher-level wrapper around JoystickController.
 *
 *  • Edge detection           justPressed / justReleased
 *  • Smoothed axes            for stick inputs that feel less twitchy
 *  • Speed-force manager      ramps 0 → 1 while speed button held,
 *                             decays back to 0 when released
 *  • Event hooks              .on('speedStart' | 'speedEnd', fn)
 *
 * The speed button is the *new* primary action — the joystick trigger
 * (button 0) on a Logitech stick, or the Spacebar on the keyboard.
 */

export class JoystickHelper {
  /**
   * @param {import('./joystick.js').JoystickController} controller
   */
  constructor(controller) {
    this.controller = controller;

    // Previous-frame button snapshot (for edge detection)
    this._prev = { boost: false, brake: false, speed: false };

    // Smoothed axes — small low-pass filter
    this._smoothed = { roll: 0, pitch: 0, yaw: 0 };

    // Speed force – the headline feature
    this.speedForce    = 0;     // 0 .. 1
    this._rampUpRate   = 3.2;   // per-second when held
    this._rampDownRate = 1.6;   // per-second when released

    // Lightweight event system
    this._listeners = {};
  }

  /* ── Events ─────────────────────────────────────────────── */

  /** Subscribe to 'speedStart' or 'speedEnd'. */
  on(event, fn) {
    (this._listeners[event] ||= []).push(fn);
    return this;
  }

  _emit(event, ...args) {
    const fns = this._listeners[event];
    if (fns) fns.forEach(fn => fn(...args));
  }

  /* ── Edge detection ─────────────────────────────────────── */

  justPressed(name) {
    return !!this.controller.state[name] && !this._prev[name];
  }

  justReleased(name) {
    return !this.controller.state[name] && !!this._prev[name];
  }

  /* ── Smoothed axes (optional helpers) ───────────────────── */

  smoothAxis(name, factor = 0.18) {
    const target = this.controller.state[name] || 0;
    this._smoothed[name] += (target - this._smoothed[name]) * factor;
    return this._smoothed[name];
  }

  /* ── Speed force ────────────────────────────────────────── */

  /** True while the speed button is currently held down. */
  isSpeedActive() {
    return !!this.controller.state.speed;
  }

  /** 0 .. 1 ramped boost intensity. */
  getSpeedForce() {
    return this.speedForce;
  }

  /* ── Per-frame update ───────────────────────────────────── */

  /**
   * Call once per frame *after* controller.update().
   * @param {number} dt seconds since last frame
   */
  update(dt) {
    const s = this.controller.state;

    // Edge events
    if (this.justPressed('speed'))  this._emit('speedStart');
    if (this.justReleased('speed')) this._emit('speedEnd');

    // Ramp speed force toward 0/1 with different up vs. down rates
    const target = s.speed ? 1 : 0;
    const rate   = s.speed ? this._rampUpRate : this._rampDownRate;
    const k      = Math.min(1, rate * dt);
    this.speedForce += (target - this.speedForce) * k;
    this.speedForce  = Math.max(0, Math.min(1, this.speedForce));

    // Save snapshot for next frame's edge detection
    this._prev.boost = !!s.boost;
    this._prev.brake = !!s.brake;
    this._prev.speed = !!s.speed;
  }
}
