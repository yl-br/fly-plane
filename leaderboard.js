/**
 * leaderboard.js
 * ──────────────
 * Renders the top-pilots list into the game-over overlay.
 *
 * Score persistence itself lives in nickname.js (saveScore / loadScores);
 * this module only handles the DOM side. Keeping render & storage separate
 * means the leaderboard can be shown without writing a new entry (e.g.
 * a future "view scores" button on a start screen).
 *
 * Usage from game.js:
 *   const lb = new Leaderboard();
 *   const { scores, rank } = saveScore(name, score);
 *   lb.render(scores, rank);
 */

export class Leaderboard {
  /**
   * @param {{listId?: string, noteId?: string}} [opts]
   *   Defaults to the IDs declared in index.html. Override if you want
   *   to host a leaderboard somewhere else (e.g. a start-screen panel).
   */
  constructor(opts = {}) {
    this.listEl = document.getElementById(opts.listId || 'leaderboard-list');
    this.noteEl = document.getElementById(opts.noteId || 'leaderboard-note');
  }

  /**
   * Render the rows.
   *
   * @param {Array<{name: string, score: number}>} scores  Top entries, descending.
   * @param {number|null} currentRank  1-indexed rank of this run within `scores`,
   *                                   or null if it didn't make the cut.
   *                                   Used to highlight the player's row and
   *                                   choose the footer message.
   */
  render(scores, currentRank) {
    if (!this.listEl) return;
    this.listEl.innerHTML = '';

    if (!scores.length) {
      const empty = document.createElement('li');
      empty.className = 'lb-empty';
      empty.textContent = 'No scores yet';
      this.listEl.appendChild(empty);
    } else {
      // textContent on each child keeps random/future nicknames safe
      // from accidental HTML injection without needing an escape helper.
      scores.forEach((entry, i) => {
        const li = document.createElement('li');
        if (i + 1 === currentRank) li.className = 'you';

        const nameEl = document.createElement('span');
        nameEl.className = 'lb-name';
        nameEl.textContent = entry.name;

        const scoreEl = document.createElement('span');
        scoreEl.className = 'lb-score';
        scoreEl.textContent = String(entry.score);

        li.appendChild(nameEl);
        li.appendChild(scoreEl);
        this.listEl.appendChild(li);
      });
    }

    if (this.noteEl) {
      if      (currentRank === 1) this.noteEl.textContent = '★ New high score';
      else if (currentRank)       this.noteEl.textContent = `Your rank · #${currentRank}`;
      else                        this.noteEl.textContent = "Didn't make the top 10";
    }
  }

  /** Clear the rendered rows (useful before a fresh game). */
  clear() {
    if (this.listEl) this.listEl.innerHTML = '';
    if (this.noteEl) this.noteEl.textContent = '';
  }
}
