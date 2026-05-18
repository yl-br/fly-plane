/**
 * music.js
 * ────────
 * Background music. Plays a single looping audio track through Web
 * Audio so the game can apply real-time effects to it (volume
 * crossfades, an intensity-driven low-pass that "opens up" when the
 * player is boosting, a gentle duck on the game-over menu so the
 * leaderboard screen still has a soundtrack) without touching the
 * source file.
 *
 *   Track:  ./royals.mp3   (must sit next to index.html)
 *
 * Routing graph:
 *
 *     <audio loop>  →  MediaElementSource  →  filter  →  master  →  destination
 *
 * Browsers block audio until a real user gesture, so armOnFirstGesture()
 * latches the first keyboard / mouse / touch / gamepad input and fades
 * the track in from silence. Press M to mute.
 *
 * Public API:
 *   const music = new Music();
 *   music.armOnFirstGesture();
 *   music.setIntensity(0..1);     // brightens the mix on boost
 *   music.onGameOver();           // gentle duck so the menu still has music
 *   music.toggleMute();           // also bound to the M key
 */

const TRACK_URL        = './royals.mp3';
const MASTER_VOLUME    = 0.7;        // fade-in target during gameplay
const GAMEOVER_VOLUME  = 0.6;        // gentle duck on the game-over menu —
                                     // still loud enough to clearly hear
const FILTER_DARK_HZ   = 14000;      // low-pass cutoff at zero intensity —
                                     // gentle high-end roll-off so cruising
                                     // sounds a touch warmer than boost but
                                     // not muffled. Anything below ~10 kHz
                                     // strips audible brightness from the
                                     // mix and the track sounds permanently
                                     // dull.
const FILTER_BRIGHT_HZ = 22000;      // effectively open at full intensity

export class Music {
  constructor() {
    this.ctx       = null;
    this.audio     = null;
    this.master    = null;
    this.filter    = null;
    this.playing   = false;
    this.muted     = false;
    this._armed    = false;
    this._gameOver = false;
    this.intensity = 0;
  }

  /* ═══════════════════════════════════════════════════════════
     Gesture-arming
  ═══════════════════════════════════════════════════════════ */

  /**
   * Wait for the first user gesture, then build the audio graph and
   * start playback. Required by every modern browser's autoplay policy.
   *
   * Four signals count as a gesture:
   *   1) DOM keydown / pointerdown / touchstart
   *   2) A gamepad button press           (poll-based, no DOM event)
   *   3) A noticeable joystick-axis movement
   *
   * Chrome 102+ treats gamepad input as user activation, so creating
   * AudioContext inside the poll callback works the same as inside a
   * DOM event handler.
   */
  armOnFirstGesture() {
    if (this._armed) return;
    this._armed = true;

    let gamepadPollId = null;
    let initialAxes   = null;   // first-poll axis snapshot

    const start = () => {
      this._init();
      this.play();
      window.removeEventListener('keydown',     start);
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('touchstart',  start);
      if (gamepadPollId !== null) {
        clearInterval(gamepadPollId);
        gamepadPollId = null;
      }
    };
    window.addEventListener('keydown',     start);
    window.addEventListener('pointerdown', start);
    window.addEventListener('touchstart',  start);

    // ── Gamepad-press polling ──
    // The Gamepad API has no "button down" event, so we sample every
    // 100 ms. A joystick's throttle axis can rest anywhere in [-1, 1],
    // so axes are compared to their initial snapshot — not to 0 —
    // otherwise an off-centre throttle would false-trigger immediately.
    gamepadPollId = setInterval(() => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const pad of pads) {
        if (!pad) continue;

        // Any button press is an unambiguous gesture.
        for (const b of pad.buttons) {
          if (b && (b.pressed || (b.value ?? 0) > 0.5)) { start(); return; }
        }

        // Axes: snapshot the resting position on the first poll, then
        // watch for meaningful movement away from it.
        if (initialAxes === null) {
          initialAxes = Array.from(pad.axes);
          continue;
        }
        for (let i = 0; i < pad.axes.length; i++) {
          if (Math.abs(pad.axes[i] - (initialAxes[i] || 0)) > 0.25) {
            start(); return;
          }
        }
      }
    }, 100);

    // M = mute toggle. Bound now (rather than after _init) so the key
    // always works once we're armed; toggleMute is a no-op until ctx
    // exists, so a pre-gesture M press just does nothing.
    window.addEventListener('keydown', e => {
      if (e.code === 'KeyM') { this.toggleMute(); e.preventDefault(); }
    });

    console.log('[Music] Armed — waiting for first user gesture (keyboard, mouse, touch, or gamepad).');
  }

  /* ═══════════════════════════════════════════════════════════
     Setup
  ═══════════════════════════════════════════════════════════ */

  /** Build the audio graph. Called once from within a user gesture. */
  _init() {
    if (this.ctx) return;

    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    // Some browsers create the context "suspended" even inside a
    // gesture; resume() is harmless either way.
    if (this.ctx.state === 'suspended') this.ctx.resume();

    // ── HTMLAudioElement is the simplest way to stream + loop a file.
    // We route it through Web Audio for real-time effects.
    this.audio          = new Audio(TRACK_URL);
    this.audio.loop     = true;
    this.audio.preload  = 'auto';

    this.audio.addEventListener('error', e => {
      console.warn(`[Music] Failed to load ${TRACK_URL}. Make sure the file sits next to index.html.`, e);
    });

    // Low-pass filter — drives both the boost-brightness effect and
    // the game-over muffle. Starts dark so the fade-in feels like the
    // track is "tuning in".
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = FILTER_DARK_HZ;
    this.filter.Q.value = 0.7;

    // Master gain — fades in on play(), ducks on game-over, kills on mute.
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;

    const source = this.ctx.createMediaElementSource(this.audio);
    source.connect(this.filter);
    this.filter.connect(this.master);
    this.master.connect(this.ctx.destination);

    console.log('[Music] AudioContext initialised — track loading.');
  }

  /* ═══════════════════════════════════════════════════════════
     Transport
  ═══════════════════════════════════════════════════════════ */

  /** Start playback and fade the master gain in. */
  play() {
    if (this.playing || !this.ctx || !this.audio) return;
    this.playing = true;

    // audio.play() returns a Promise that rejects if the browser still
    // considers this unauthorised (rare after a gesture, but possible
    // e.g. in iframes without allow="autoplay"). We log the rejection
    // and roll back `playing` so a later gesture can try again.
    this.audio.play()
      .then(() => console.log('[Music] Track playing.'))
      .catch(err => {
        console.warn('[Music] play() rejected:', err);
        this.playing = false;
      });

    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(0, now);
    this.master.gain.linearRampToValueAtTime(this.muted ? 0 : MASTER_VOLUME, now + 2.0);
  }

  /* ═══════════════════════════════════════════════════════════
     Public mix controls
  ═══════════════════════════════════════════════════════════ */

  /**
   * Drive the filter cutoff with the player's speed-force.
   *
   * At rest the lowpass sits at 14 kHz — a gentle high-end roll-off that
   * adds a touch of warmth without muffling the track. Full boost opens
   * it to 22 kHz, making the mix punch through. The game-over outro
   * overrides this completely (we ignore intensity once _gameOver is set).
   *
   * setTargetAtTime is used rather than linearRamp so frame-rate
   * calls don't fight each other for the parameter timeline.
   */
  setIntensity(level) {
    if (!this.filter || this._gameOver) return;
    this.intensity = Math.max(0, Math.min(1, level));
    const target = FILTER_DARK_HZ + (FILTER_BRIGHT_HZ - FILTER_DARK_HZ) * this.intensity;
    this.filter.frequency.setTargetAtTime(target, this.ctx.currentTime, 0.15);
  }

  /**
   * Game-over treatment: the track keeps looping under the overlay
   * so the leaderboard screen has a soundtrack. The filter opens
   * fully so the music is clearly audible (no boost-brightness
   * dependency frozen at the moment of crash), and the master ducks
   * only slightly to signal the state change without burying the
   * track.
   */
  onGameOver() {
    if (!this.ctx || !this.filter || !this.master) return;
    this._gameOver = true;

    const now = this.ctx.currentTime;

    // Filter opens to full brightness over 1.0 s.
    this.filter.frequency.cancelScheduledValues(now);
    this.filter.frequency.setValueAtTime(this.filter.frequency.value, now);
    this.filter.frequency.linearRampToValueAtTime(FILTER_BRIGHT_HZ, now + 1.0);

    // Master barely ducks (0.7 → 0.6). Just enough to "make space"
    // for the game-over text without losing audibility.
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(this.muted ? 0 : GAMEOVER_VOLUME, now + 1.0);

    console.log('[Music] Game-over: opening filter, gentle duck.');
  }

  /** M-key handler. Smoothly mutes/unmutes — no clicks. */
  toggleMute() {
    if (!this.ctx || !this.master) return;
    this.muted = !this.muted;
    const target = this.muted ? 0 : (this._gameOver ? GAMEOVER_VOLUME : MASTER_VOLUME);
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.linearRampToValueAtTime(target, now + 0.2);
    console.log(`[Music] ${this.muted ? 'Muted' : 'Unmuted'}.`);
  }
}
