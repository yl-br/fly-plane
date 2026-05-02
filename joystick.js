/**
 * joystick.js
 * Handles Logitech joystick input via the Gamepad API.
 * Falls back to keyboard if no joystick is connected.
 */

export class JoystickController {
  constructor() {
    this.gamepad = null;
    this.connected = false;
    this.deviceName = 'Keyboard';

    // Normalised input state — all values in [-1, 1] or boolean
    this.state = {
      roll:     0,   // X-axis  → bank left / right
      pitch:    0,   // Y-axis  → nose up / down
      yaw:      0,   // Z-axis / twist or Q/E
      throttle: 0,   // slider / throttle axis  (0 = idle, 1 = full)
      boost:    false,
      brake:    false,
    };

    // Keyboard raw keys
    this._keys = {};

    this._bindKeyboard();
    this._watchGamepad();
  }

  /* ─── Keyboard ─────────────────────────────────────────── */

  _bindKeyboard() {
    window.addEventListener('keydown', e => {
      this._keys[e.code] = true;
    });
    window.addEventListener('keyup', e => {
      this._keys[e.code] = false;
    });
  }

  _keyAxis(negCode, posCode) {
    const neg = this._keys[negCode] ? -1 : 0;
    const pos = this._keys[posCode] ?  1 : 0;
    return neg + pos;
  }

  _readKeyboard() {
    const s = this.state;

    // Roll   : A / D  or  ArrowLeft / ArrowRight
    s.roll  = this._keyAxis('KeyA', 'KeyD') ||
              this._keyAxis('ArrowLeft', 'ArrowRight');

    // Pitch  : W / S  or  ArrowUp / ArrowDown
    s.pitch = this._keyAxis('KeyW', 'KeyS') ||
              this._keyAxis('ArrowUp', 'ArrowDown');

    // Yaw    : Q / E
    s.yaw   = this._keyAxis('KeyQ', 'KeyE');

    // Throttle: Shift = boost, Ctrl = brake
    s.boost  = !!this._keys['ShiftLeft'] || !!this._keys['ShiftRight'];
    s.brake  = !!this._keys['ControlLeft'] || !!this._keys['Space'];

    // Build a simple throttle 0→1 from boost/brake
    if (s.boost)       s.throttle = Math.min(1, s.throttle + 0.02);
    else if (s.brake)  s.throttle = Math.max(0, s.throttle - 0.03);
    else               s.throttle = Math.max(0.3, s.throttle); // idle
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
        console.log('[Joystick] Disconnected');
      }
    });
  }

  /**
   * Deadzone helper – returns 0 for tiny axis wobble.
   */
  _dead(value, zone = 0.08) {
    return Math.abs(value) < zone ? 0 : value;
  }

  _readGamepad() {
    // Refresh the snapshot (required by the spec)
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = gamepads[this.gamepad.index];
    if (!gp) return;

    const s = this.state;
    const axes = gp.axes;
    const btns = gp.buttons;

    // ── Axis mapping (Logitech Extreme 3D Pro layout) ──
    // axes[0] = stick X  → roll
    // axes[1] = stick Y  → pitch  (inverted: push forward = nose down)
    // axes[2] = twist    → yaw
    // axes[3] = throttle slider (usually -1 top, +1 bottom → invert)

    s.roll     = this._dead(axes[0] ?? 0);
    s.pitch    = this._dead(axes[1] ?? 0);       // forward = positive pitch-down
    s.yaw      = this._dead(axes[2] ?? 0);

    // Throttle slider: map [-1,+1] → [1,0]
    const rawThrottle = axes[3] ?? -1;
    s.throttle = (1 - rawThrottle) / 2;          // −1→1 , +1→0

    // Buttons
    s.boost  = !!(btns[0]?.pressed);             // trigger
    s.brake  = !!(btns[2]?.pressed);             // side button
  }

  /* ─── Public API ────────────────────────────────────────── */

  /**
   * Call once per frame to refresh state.
   * Returns the current normalised state object.
   */
  update() {
    if (this.connected && this.gamepad) {
      this._readGamepad();
    } else {
      this._readKeyboard();
    }
    return this.state;
  }

  /**
   * Returns a short status string for the HUD.
   */
  getStatusLabel() {
    if (this.connected) {
      const name = this.deviceName.length > 30
        ? this.deviceName.slice(0, 28) + '…'
        : this.deviceName;
      return `🕹 ${name}`;
    }
    return '⌨  Keyboard  (W/S pitch · A/D roll · Q/E yaw · Shift throttle)';
  }
}
