/**
 * joystick.js
 * Handles Logitech joystick input via the Gamepad API.
 * Falls back to keyboard if no joystick is connected.
 *
 * `speed` (the boost trigger that drives the airplane's speed-force
 * reactions in the game) is intentionally permissive:
 *   • ANY button on the stick being pressed counts
 *   • analog triggers reported as axes (4 / 5 / 6 / 7) past −0.3 count
 *   • the throttle scroller pushed past 0.9 also counts
 *
 * `fire` is dedicated to the gun trigger:
 *   • button 0 on the gamepad (the primary/trigger button)
 *   • KeyF on the keyboard
 *
 * Raw state is exposed on this.raw for the debug HUD to inspect.
 */

export class JoystickController {
  constructor() {
    this.gamepad     = null;
    this.connected   = false;
    this.deviceName  = 'Keyboard';

    // Normalised input state — all values in [-1, 1] or boolean
    this.state = {
      roll:     0,
      pitch:    0,
      yaw:      0,
      throttle: 0,
      boost:    false,
      brake:    false,
      speed:    false,
      fire:     false,
    };

    // Snapshot of every axis & button this frame  (for debug panel)
    this.raw = { axes: [], buttons: [] };

    this._keys = {};
    this._bindKeyboard();
    this._watchGamepad();
  }

  /* ─── Keyboard ─────────────────────────────────────────── */

  _bindKeyboard() {
    window.addEventListener('keydown', e => {
      this._keys[e.code] = true;
      if (e.code === 'Space' || e.code === 'KeyF') e.preventDefault();
    });
    window.addEventListener('keyup', e => {
      this._keys[e.code] = false;
    });
  }

  _keyAxis(neg, pos) {
    return (this._keys[pos] ? 1 : 0) - (this._keys[neg] ? 1 : 0);
  }

  _readKeyboard() {
    const s = this.state;

    s.roll  = this._keyAxis('KeyA', 'KeyD') ||
              this._keyAxis('ArrowLeft', 'ArrowRight');
    s.pitch = this._keyAxis('KeyW', 'KeyS') ||
              this._keyAxis('ArrowUp', 'ArrowDown');
    s.yaw   = this._keyAxis('KeyQ', 'KeyE');

    s.boost = !!this._keys['ShiftLeft'] || !!this._keys['ShiftRight'];
    s.brake = !!this._keys['ControlLeft'] || !!this._keys['ControlRight'];
    s.speed = !!this._keys['Space'];
    s.fire  = !!this._keys['KeyF'];

    if (s.boost)      s.throttle = Math.min(1, s.throttle + 0.02);
    else if (s.brake) s.throttle = Math.max(0, s.throttle - 0.03);
    else              s.throttle = Math.max(0.3, s.throttle);
  }

  /* ─── Gamepad ───────────────────────────────────────────── */

  _watchGamepad() {
    window.addEventListener('gamepadconnected', e => {
      this.gamepad   = e.gamepad;
      this.connected = true;
      this.deviceName = e.gamepad.id;
      console.log('[Joystick] Connected:', e.gamepad.id);
    });

    window.addEventListener('gamepaddisconnected', e => {
      if (this.gamepad && this.gamepad.index === e.gamepad.index) {
        this.gamepad   = null;
        this.connected = false;
        this.deviceName = 'Keyboard';
      }
    });
  }

  _dead(value, zone = 0.08) {
    return Math.abs(value) < zone ? 0 : value;
  }

  _readGamepad() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = gamepads[this.gamepad.index];
    if (!gp) return;

    const s    = this.state;
    const axes = gp.axes;
    const btns = gp.buttons;

    // Snapshot for debug HUD
    this.raw.axes    = Array.from(axes);
    this.raw.buttons = Array.from(btns).map(b => ({
      pressed: !!b.pressed, value: b.value ?? (b.pressed ? 1 : 0),
    }));

    // ── Stick axes ──
    s.roll  = this._dead(axes[0] ?? 0);
    s.pitch = this._dead(axes[1] ?? 0);
    s.yaw   = this._dead(axes[2] ?? 0);

    // ── Throttle scroller (axis 3 on most Logitech sticks) ──
    const rawThrottle = axes[3] ?? -1;
    s.throttle = (1 - rawThrottle) / 2;

    // ── Boost / brake on common button positions ──
    s.boost = !!(btns[1]?.pressed) || !!(btns[3]?.pressed);
    s.brake = !!(btns[2]?.pressed) || !!(btns[4]?.pressed);

    // ── Fire: dedicated to button 0 (the primary trigger) ──
    s.fire = !!(btns[0]?.pressed) || (btns[0]?.value ?? 0) > 0.5;

    // ── Speed: ANY button currently held counts (defensive) ──
    let speedFromButton = false;
    for (let i = 0; i < btns.length; i++) {
      if (btns[i]?.pressed || (btns[i]?.value ?? 0) > 0.5) {
        speedFromButton = true;
        break;
      }
    }

    // ── Speed: analog triggers sometimes show up as axes 4–7 ──
    let speedFromAxisTrigger = false;
    for (let i = 4; i < axes.length; i++) {
      // Resting state for trigger-axes is usually -1; pulled is +1.
      if ((axes[i] ?? -1) > -0.3) {
        speedFromAxisTrigger = true;
        break;
      }
    }

    // ── Speed: throttle pushed near max also engages it ──
    const speedFromThrottle = s.throttle > 0.9;

    s.speed = speedFromButton || speedFromAxisTrigger || speedFromThrottle;
  }

  /* ─── Public API ────────────────────────────────────────── */

  update() {
    if (this.connected && this.gamepad) this._readGamepad();
    else                                 this._readKeyboard();
    return this.state;
  }

  getStatusLabel() {
    if (this.connected) {
      const name = this.deviceName.length > 30
        ? this.deviceName.slice(0, 28) + '…'
        : this.deviceName;
      return `🕹 ${name}  ·  TRIGGER = FIRE  ·  ANY BTN/THR>90% = SPEED`;
    }
    return '⌨  WASD/Arrows · Q/E yaw · Shift throttle · ␣ SPEED · F FIRE';
  }
}
