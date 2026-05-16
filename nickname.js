/**
 * nickname.js
 * ───────────
 * Pilot identity + high-score persistence (localStorage).
 *
 *   • generateNickname()  – returns a fresh random callsign like
 *                           "Maverick Falcon" or "Ace Comet".
 *   • getOrCreatePilot()  – returns this session's pilot. A new
 *                           random nickname is generated for every
 *                           page load (each run = new pilot).
 *
 *   • loadScores()        – returns the saved scoreboard, descending
 *                           by score. Always an array (empty if none).
 *   • saveScore(name, n)  – inserts a new entry, keeps the top 10,
 *                           returns the updated array along with the
 *                           rank of the new entry (1-indexed, or null
 *                           if it didn't make the cut).
 *   • clearScores()       – wipes the saved scoreboard.
 *
 * Storage is a single JSON-encoded key under `flyplane:scores`. If
 * the saved value is malformed, we recover by starting fresh rather
 * than throwing — a corrupted leaderboard shouldn't break the game.
 */

const STORAGE_KEY = 'flyplane:scores';
const MAX_ENTRIES = 10;

/* ── Nickname pieces ──────────────────────────────────────────
   Two-word callsigns: <adjective/title> <bird/sky thing>. Picked
   for fly-plane flavor — short, punchy, readable in HUD rows.
─────────────────────────────────────────────────────────────── */
const ADJECTIVES = [
  'Ace', 'Maverick', 'Iron', 'Sky', 'Thunder', 'Storm', 'Rogue',
  'Silver', 'Crimson', 'Shadow', 'Lone', 'Wild', 'Frost', 'Solar',
  'Lucky', 'Steel', 'Phantom', 'Turbo', 'Cosmic', 'Vapor', 'Ghost',
  'Nitro', 'Razor', 'Echo', 'Rapid', 'Blaze',
];

const NOUNS = [
  'Falcon', 'Hawk', 'Eagle', 'Viper', 'Comet', 'Bolt', 'Raven',
  'Phoenix', 'Wolf', 'Tiger', 'Cobra', 'Arrow', 'Blade', 'Jet',
  'Wing', 'Storm', 'Drake', 'Specter', 'Cyclone', 'Pilot', 'Ranger',
  'Skylark', 'Vortex', 'Meteor', 'Glider',
];

/** Returns a random two-word callsign. */
export function generateNickname() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${a} ${n}`;
}

/** One pilot per page-load. */
let _currentPilot = null;
export function getOrCreatePilot() {
  if (!_currentPilot) _currentPilot = { name: generateNickname() };
  return _currentPilot;
}

/** Re-roll the current pilot's nickname (used by the "New name" button). */
export function rerollPilot() {
  const p = getOrCreatePilot();
  p.name = generateNickname();
  return p;
}

/* ── Storage ──────────────────────────────────────────────── */

function _readRaw() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (!s) return [];
    const parsed = JSON.parse(s);
    if (!Array.isArray(parsed)) return [];
    // Filter to entries with the expected shape; ignore stray junk.
    return parsed.filter(e =>
      e && typeof e.name === 'string' && typeof e.score === 'number',
    );
  } catch (err) {
    console.warn('[scores] corrupted scoreboard, starting fresh.', err);
    return [];
  }
}

function _writeRaw(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    // Quota/private-mode failures shouldn't crash the game; the
    // leaderboard just becomes session-only.
    console.warn('[scores] could not save scoreboard.', err);
  }
}

/** Top entries, descending. Always returns an array. */
export function loadScores() {
  return _readRaw().sort((a, b) => b.score - a.score).slice(0, MAX_ENTRIES);
}

/**
 * Save `{ name, score }` and return:
 *   { scores: <updated top-N>, rank: <1-indexed rank in top-N, or null> }
 *
 * `rank` lets the UI highlight the new entry's row, or show
 * "didn't make the leaderboard" if it fell off the bottom.
 *
 * A timestamp is stored alongside in case we ever want to show "when".
 */
export function saveScore(name, score) {
  const entry = { name, score, date: Date.now() };
  const all   = [..._readRaw(), entry].sort((a, b) => b.score - a.score);
  const top   = all.slice(0, MAX_ENTRIES);
  _writeRaw(top);

  // Identify this specific entry's rank in the top list (by reference,
  // since two entries can tie on score+name).
  const rankIdx = top.indexOf(entry);
  return { scores: top, rank: rankIdx >= 0 ? rankIdx + 1 : null };
}

/** Wipe the saved leaderboard. */
export function clearScores() {
  try { localStorage.removeItem(STORAGE_KEY); }
  catch (err) { console.warn('[scores] could not clear.', err); }
}
