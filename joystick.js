/**
 * joystick.js
 * Handles gamepad input via the Gamepad API. Keyboard input is its
 * own module now (keyboard.js) — game.js reads both each frame and
 * merges them. This split fixes a bug where any gamepad registered
 * with the OS, even an idle one, would shadow the keyboard.
 *
 * `speed` (the boost trigger that drives the airplane's speed-force
 * reactions in the game) is intentionally permissive:
 *   • ANY button on the stick being pressed counts
 *   • analog triggers reported as axes (4 / 5 / 6 / 7) past −0.3 count
 *   • the throttle scroller pushed past 0.9 also counts
 *
 * `fire` is dedicated to the gun trigger:
 *   • button 0 on the gamepad (the primary/trigger button)
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

    this._watchGamepad();
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
    if (this.connected && this.gamepad) {
      this._readGamepad();
    } else {
      // No gamepad — clear axes/buttons so any leftover values from a
      // prior connection don't linger. Keyboard input is merged on top
      // of this state in game.js, so we leave a clean slate for it.
      this._clearState();
    }
    return this.state;
  }

  _clearState() {
    const s = this.state;
    s.roll = 0;
    s.pitch = 0;
    s.yaw = 0;
    s.boost = false;
    s.brake = false;
    s.speed = false;
    s.fire = false;
    // Throttle is owned by the keyboard merge when no pad is present,
    // so leave it for game.js to overwrite.
  }

  getStatusLabel() {
    if (this.connected) {
      const name = this.deviceName.length > 30
        ? this.deviceName.slice(0, 28) + '…'
        : this.deviceName;
      return `🕹 ${name}  ·  TRIGGER = FIRE  ·  KEYBOARD ALSO ACTIVE`;
    }
    return '⌨  Arrows/WASD · Q/E yaw · Shift/Ctrl throttle · ␣ FIRE+SPEED · F FIRE';
  }
}
