/**
 * keyboard.js
 * ───────────
 * Standalone keyboard input. Runs in parallel with joystick.js
 * (not as a fallback inside it). Game.js reads both controllers
 * every frame and merges them.
 *
 * Why split this out?
 * ───────────────────
 * Previously the keyboard was a fallback branch inside
 * JoystickController.update():
 *
 *     if (this.connected && this.gamepad) _readGamepad();
 *     else                                 _readKeyboard();
 *
 * If any pad was registered with the OS — even an idle one the
 * player isn't touching — the gamepad branch ran each frame and
 * wrote 0s into state.roll/pitch/yaw, silently shadowing every
 * keypress. Splitting the responsibilities means the keyboard
 * always works, period.
 *
 * State shape mirrors JoystickController.state so the merge in
 * game.js is a field-by-field combine.
 *
 * Bindings
 * ────────
 *   Roll          A / D   or  Left / Right arrows
 *   Pitch         W / S   or  Up / Down arrows
 *   Yaw           Q / E
 *   Throttle ↑    Shift
 *   Throttle ↓    Ctrl
 *   Fire          Space   or  F     (Space also engages speed)
 *   Speed         Space
 */

export class KeyboardController {
  constructor() {
    // Same shape as JoystickController.state so the merge in game.js
    // can walk fields without special-casing.
    this.state = {
      roll:     0,
      pitch:    0,
      yaw:      0,
      throttle: 0.3,    // idle throttle floor — see _ramp() below
      boost:    false,
      brake:    false,
      speed:    false,
      fire:     false,
    };

    this._keys = {};
    this._bindListeners();
  }

  /* ── Listeners ──────────────────────────────────────────── */

  _bindListeners() {
    // Keys we own — preventDefault so the browser doesn't scroll the
    // page or trigger spatial navigation while the player is flying.
    const owned = new Set([
      'Space', 'KeyF',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    ]);
    window.addEventListener('keydown', e => {
      this._keys[e.code] = true;
      if (owned.has(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => {
      this._keys[e.code] = false;
    });
  }

  /* ── Helpers ────────────────────────────────────────────── */

  /** Two-key axis: pressing `pos` → +1, `neg` → -1, both/neither → 0. */
  _axis(neg, pos) {
    return (this._keys[pos] ? 1 : 0) - (this._keys[neg] ? 1 : 0);
  }

  /** True if the player is actively pressing any flight input. */
  isActive() {
    const s = this.state;
    return s.roll !== 0 || s.pitch !== 0 || s.yaw !== 0
        || s.boost || s.brake || s.speed || s.fire;
  }

  /* ── Per-frame update ───────────────────────────────────── */

  update() {
    const s = this.state;

    // Axes — WASD/Arrows for roll & pitch, Q/E for yaw.
    // (WASD wins if both groups are held; the `||` short-circuits on
    // a non-zero numeric, which falls through to arrows only at 0.)
    s.roll  = this._axis('KeyA', 'KeyD') ||
              this._axis('ArrowLeft', 'ArrowRight');
    s.pitch = this._axis('KeyW', 'KeyS') ||
              this._axis('ArrowUp', 'ArrowDown');
    s.yaw   = this._axis('KeyQ', 'KeyE');

    // Buttons.
    s.boost = !!this._keys['ShiftLeft']   || !!this._keys['ShiftRight'];
    s.brake = !!this._keys['ControlLeft'] || !!this._keys['ControlRight'];
    // Space fires AND engages speed — same "primary action" feel as
    // pressing the trigger on the stick. F is a quieter fire-only key.
    s.fire  = !!this._keys['Space'] || !!this._keys['KeyF'];
    s.speed = !!this._keys['Space'];

    // Throttle is persistent: ramps up with Shift, down with Ctrl,
    // and floors at 0.3 so the plane never stalls when the player
    // releases everything.
    if (s.boost)      s.throttle = Math.min(1, s.throttle + 0.02);
    else if (s.brake) s.throttle = Math.max(0, s.throttle - 0.03);
    else              s.throttle = Math.max(0.3, s.throttle);

    return s;
  }
}
