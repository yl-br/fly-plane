/**
 * joystick-helper.js
 * ──────────────────
 * Higher-level wrapper around JoystickController.
 *
 *  • Edge detection           justPressed / justReleased
 *  • Smoothed axes
 *  • Speed-force manager      ramps 0 → 1 while either:
 *                                – the speed button is held, OR
 *                                – the throttle scroller is past 0.85
 *                             decays back to 0 when neither is true
 *  • Live debug overlay       (toggle with ` / F1)
 */

export class JoystickHelper {
  /**
   * @param {import('./joystick.js').JoystickController} controller
   * @param {{debug?: boolean}} [opts]
   */
  constructor(controller, opts = {}) {
    this.controller = controller;

    this._prev      = { boost: false, brake: false, speed: false };
    this._smoothed  = { roll: 0, pitch: 0, yaw: 0 };

    this.speedForce    = 0;
    this._rampUpRate   = 3.2;
    this._rampDownRate = 1.6;

    this._listeners = {};

    // Debug HUD (visible by default — press ` to hide)
    this._debugVisible = opts.debug !== false;
    this._debugEl      = null;
    this._buildDebugUI();
    window.addEventListener('keydown', e => {
      if (e.code === 'Backquote' || e.code === 'F1') {
        this._debugVisible = !this._debugVisible;
        if (this._debugEl) this._debugEl.style.display = this._debugVisible ? 'block' : 'none';
        e.preventDefault();
      }
    });
  }

  /* ── Events ─────────────────────────────────────────────── */

  on(event, fn) {
    (this._listeners[event] ||= []).push(fn);
    return this;
  }
  _emit(event, ...args) {
    (this._listeners[event] || []).forEach(fn => fn(...args));
  }

  /* ── Edge detection ─────────────────────────────────────── */

  justPressed(name)  { return !!this.controller.state[name] && !this._prev[name]; }
  justReleased(name) { return !this.controller.state[name] &&  !!this._prev[name]; }

  /* ── Smoothed axes ──────────────────────────────────────── */

  smoothAxis(name, factor = 0.18) {
    const target = this.controller.state[name] || 0;
    this._smoothed[name] += (target - this._smoothed[name]) * factor;
    return this._smoothed[name];
  }

  /* ── Speed force ────────────────────────────────────────── */

  isSpeedActive()   { return !!this.controller.state.speed; }
  getSpeedForce()   { return this.speedForce; }

  /* ── Per-frame update ───────────────────────────────────── */

  update(dt) {
    const s = this.controller.state;

    // Edge events
    if (this.justPressed('speed'))  this._emit('speedStart');
    if (this.justReleased('speed')) this._emit('speedEnd');

    // Combine button-driven and throttle-driven targets so the throttle
    // scroller above 0.85 also engages speed force proportionally.
    const buttonTarget  = s.speed ? 1 : 0;
    const throttleDrive = Math.max(0, (s.throttle - 0.85) / 0.15);  // 0 .. 1
    const target        = Math.max(buttonTarget, throttleDrive);

    const rate = target > this.speedForce ? this._rampUpRate : this._rampDownRate;
    const k    = Math.min(1, rate * dt);
    this.speedForce += (target - this.speedForce) * k;
    this.speedForce  = Math.max(0, Math.min(1, this.speedForce));

    this._prev.boost = !!s.boost;
    this._prev.brake = !!s.brake;
    this._prev.speed = !!s.speed;

    if (this._debugVisible) this._renderDebug();
  }

  /* ── Debug overlay (DOM, self-contained) ────────────────── */

  _buildDebugUI() {
    const el = document.createElement('div');
    el.id = 'joystick-debug';
    el.style.cssText = `
      position: fixed;
      bottom: 12px;
      right: 12px;
      width: 320px;
      max-height: 60vh;
      overflow: auto;
      background: rgba(6,12,20,0.85);
      border: 1px solid #00ffcc44;
      border-radius: 4px;
      padding: 10px 12px;
      font-family: 'Share Tech Mono', 'Courier New', monospace;
      font-size: 11px;
      line-height: 1.55;
      color: #00ffccaa;
      pointer-events: none;
      z-index: 50;
      backdrop-filter: blur(4px);
    `;
    el.innerHTML = '…';
    document.body.appendChild(el);
    this._debugEl = el;
  }

  _renderDebug() {
    const ctrl = this.controller;
    const raw  = ctrl.raw || { axes: [], buttons: [] };

    let html = `<div style="color:#00ffee;letter-spacing:.1em;margin-bottom:4px">
      ⚙ JOYSTICK DEBUG <span style="color:#00ffcc44">(\` to hide)</span>
    </div>`;
    html += `<div>Device: <b style="color:#fff">${ctrl.deviceName}</b></div>`;
    html += `<div>connected: <b style="color:${ctrl.connected ? '#0f0' : '#f55'}">${ctrl.connected}</b></div>`;
    html += `<div style="margin-top:6px;color:#ff8822">force: ${this.speedForce.toFixed(2)} · speed: ${ctrl.state.speed} · throttle: ${ctrl.state.throttle.toFixed(2)}</div>`;

    // Axes
    if (raw.axes.length) {
      html += `<div style="margin-top:6px;color:#00ffcc88">AXES</div>`;
      raw.axes.forEach((v, i) => {
        const w = Math.abs(v) * 50;
        const x = v < 0 ? 50 - w : 50;
        const col = Math.abs(v) > 0.5 ? '#ffdd44' : '#00ffcc';
        html += `<div style="display:flex;align-items:center;gap:6px">
          <span style="width:18px;color:#666">${i}</span>
          <div style="position:relative;flex:1;height:6px;background:#0d2230;border-radius:2px">
            <div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:#00ffcc44"></div>
            <div style="position:absolute;left:${x}%;top:0;bottom:0;width:${w}%;background:${col}"></div>
          </div>
          <span style="width:46px;text-align:right;color:${col}">${v.toFixed(2)}</span>
        </div>`;
      });
    }

    // Buttons
    if (raw.buttons.length) {
      html += `<div style="margin-top:6px;color:#00ffcc88">BUTTONS</div>`;
      html += `<div style="display:flex;flex-wrap:wrap;gap:4px">`;
      raw.buttons.forEach((b, i) => {
        const on = b.pressed || (b.value ?? 0) > 0.5;
        html += `<span style="
          display:inline-flex;
          align-items:center;
          justify-content:center;
          min-width:24px;
          padding:2px 5px;
          border:1px solid ${on ? '#ffdd44' : '#00ffcc33'};
          background:${on ? '#ffaa22cc' : '#0d2230'};
          color:${on ? '#000' : '#00ffcc66'};
          border-radius:3px;
          font-weight:bold;
        ">${i}</span>`;
      });
      html += `</div>`;
    }

    if (!ctrl.connected) {
      html += `<div style="margin-top:6px;color:#666">No gamepad detected.<br>Press a button on your stick after the page is focused.</div>`;
    }

    this._debugEl.innerHTML = html;
  }
}
