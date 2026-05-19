/**
 * mars.js
 * ───────
 * Brief Mars cinematic shown for 3 seconds after a crash, between the
 * fireball and the game-over overlay. Pure DOM + CSS — no Three.js
 * scene work — so it renders reliably even while the main loop has
 * paused world updates for the crash sequence.
 *
 * The mood: "the wreckage hurled you somewhere else." A twinkling
 * star field, a slowly rotating Mars built from radial gradients
 * (atmosphere glow, surface mottling, polar cap), and a beat of
 * letter-spacing text.
 *
 * Usage from game.js:
 *   const mars = new Mars();
 *   mars.onComplete = () => this._showGameOver();
 *   mars.show(3);
 */

export class Mars {
  constructor() {
    this.onComplete = null;
    this._timeoutId = null;
    this._injectStyles();
    this._buildOverlay();
  }

  /* ── DOM setup ──────────────────────────────────────────── */

  /** Inject the keyframes + selectors once. Idempotent. */
  _injectStyles() {
    if (document.getElementById('mars-styles')) return;
    const style = document.createElement('style');
    style.id = 'mars-styles';
    style.textContent = `
      @keyframes mars-spin     { from { transform: rotate(0deg); }       to { transform: rotate(360deg); } }
      @keyframes mars-fade-in  { from { opacity: 0; }                    to { opacity: 1; } }
      @keyframes mars-zoom-in  { from { transform: scale(0.55); opacity: 0; }
                                 to   { transform: scale(1);    opacity: 1; } }
      @keyframes mars-twinkle  { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
      @keyframes mars-text-in  { from { letter-spacing: 0.1em; opacity: 0; }
                                 to   { letter-spacing: 0.4em; opacity: 1; } }

      #mars-overlay {
        position: fixed;
        inset: 0;
        z-index: 250;
        display: none;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 30px;
        background: radial-gradient(ellipse at center,
                                    #2a0a05 0%,
                                    #0a0200 60%,
                                    #000 100%);
        font-family: 'Share Tech Mono', 'Courier New', monospace;
        overflow: hidden;
        animation: mars-fade-in 0.5s ease;
      }
      #mars-overlay.visible { display: flex; }

      /* Star field — purely decorative, twinkles in place. */
      #mars-stars {
        position: absolute;
        inset: 0;
        background-image:
          radial-gradient(1.2px 1.2px at 12% 18%, #fff, transparent),
          radial-gradient(1px 1px     at 78% 72%, #fff, transparent),
          radial-gradient(1.5px 1.5px at 50% 22%, #fff, transparent),
          radial-gradient(1px 1px     at 10% 80%, #fff, transparent),
          radial-gradient(1.2px 1.2px at 68% 38%, #fff, transparent),
          radial-gradient(1px 1px     at 32% 64%, #fff, transparent),
          radial-gradient(1.5px 1.5px at 88% 15%, #fff, transparent),
          radial-gradient(1px 1px     at 42% 88%, #fff, transparent),
          radial-gradient(1.2px 1.2px at 62% 52%, #fff, transparent),
          radial-gradient(1px 1px     at 18% 44%, #fff, transparent),
          radial-gradient(1px 1px     at 92% 60%, #fff, transparent),
          radial-gradient(1.2px 1.2px at 5%  30%, #fff, transparent);
        animation: mars-twinkle 3s ease-in-out infinite;
        pointer-events: none;
      }

      /* The planet itself.
         Atmosphere glow + base gradient give it depth; the ::before
         layer adds dark surface features that rotate with the planet,
         and the separate #mars-cap sits on top as a static polar cap. */
      #mars-planet {
        width: min(360px, 60vmin);
        height: min(360px, 60vmin);
        border-radius: 50%;
        position: relative;
        background:
          radial-gradient(circle at 32% 30%,
                          #ffaa77 0%,
                          #dd5533 30%,
                          #aa3315 60%,
                          #661508 90%,
                          #330800 100%);
        box-shadow:
          inset -28px -28px 60px rgba(0,0,0,0.65),
          inset  18px  18px 50px rgba(255,180,120,0.18),
          0 0 70px  rgba(220,80,40,0.55),
          0 0 160px rgba(220,80,40,0.25);
        animation: mars-zoom-in 0.8s cubic-bezier(.2,.7,.3,1) both,
                   mars-spin    14s linear infinite;
        z-index: 1;
      }

      /* Surface features — craters, dark patches, dust streaks.
         Lives inside the planet so it rotates with it. */
      #mars-planet::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background:
          radial-gradient(circle at 22% 42%, rgba(70,18,8,0.65) 0%, transparent 9%),
          radial-gradient(circle at 58% 66%, rgba(70,18,8,0.55) 0%, transparent 11%),
          radial-gradient(circle at 71% 32%, rgba(50,12,4,0.55) 0%, transparent 7%),
          radial-gradient(circle at 44% 76%, rgba(70,18,8,0.55) 0%, transparent 8%),
          radial-gradient(circle at 36% 22%, rgba(40,10,2,0.60) 0%, transparent 6%),
          radial-gradient(circle at 80% 56%, rgba(50,12,4,0.50) 0%, transparent 9%),
          radial-gradient(circle at 18% 60%, rgba(60,16,6,0.45) 0%, transparent 7%);
        pointer-events: none;
      }

      /* Static polar ice cap (separate element so it stays put as the
         planet spins underneath it). */
      #mars-cap {
        position: absolute;
        top: 8%;
        left: 50%;
        transform: translateX(-50%);
        width: 38%;
        height: 14%;
        background: radial-gradient(ellipse at center,
                                    rgba(255,240,220,0.85) 0%,
                                    rgba(255,220,200,0.35) 50%,
                                    transparent 75%);
        border-radius: 50%;
        pointer-events: none;
        z-index: 2;
        filter: blur(1px);
      }

      #mars-title {
        font-size: clamp(40px, 8vw, 78px);
        color: #ff7744;
        letter-spacing: 0.4em;
        text-shadow: 0 0 30px #ff552288,
                     0 0 60px #ff552244;
        text-transform: uppercase;
        animation: mars-text-in 1.1s ease both;
        z-index: 3;
      }

      #mars-sub {
        font-size: 12px;
        letter-spacing: 0.35em;
        color: #ff996688;
        text-transform: uppercase;
        animation: mars-fade-in 1.5s ease both;
        z-index: 3;
      }
    `;
    document.head.appendChild(style);
  }

  _buildOverlay() {
    const el = document.createElement('div');
    el.id = 'mars-overlay';
    // The cap sits inside the planet's containing block but outside
    // the rotating planet element, so it doesn't rotate with the planet.
    el.innerHTML = `
      <div id="mars-stars"></div>
      <div style="position:relative;display:flex;align-items:center;justify-content:center">
        <div id="mars-planet"></div>
        <div id="mars-cap"></div>
      </div>
      <div id="mars-title">Mars</div>
      <div id="mars-sub">Welcome to the red planet</div>
    `;
    document.body.appendChild(el);
    this.el = el;
  }

  /* ── Public API ─────────────────────────────────────────── */

  /**
   * Show the Mars overlay for `seconds`, then hide it and fire
   * `onComplete`. Calling show() while one is already running
   * resets the timer.
   */
  show(seconds = 3) {
    if (!this.el) return;
    this.el.classList.add('visible');
    if (this._timeoutId !== null) clearTimeout(this._timeoutId);
    this._timeoutId = setTimeout(() => {
      this.hide();
      if (typeof this.onComplete === 'function') this.onComplete();
    }, seconds * 1000);
    console.log(`[Mars] Showing for ${seconds}s.`);
  }

  hide() {
    if (!this.el) return;
    this.el.classList.remove('visible');
    if (this._timeoutId !== null) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
  }
}
