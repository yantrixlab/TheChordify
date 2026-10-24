// Decides which string is being tuned, and how far off it is, from a stream of pitch readings: steadily, without jumping.
//
// A single pitch reading is not to be trusted. A string's overtones and undertones can fool the detector into a note an octave or
// a fifth away for a moment, and as a note dies away the readings wander. So:
//  * a reading is only taken for a string if it is within a few semitones of that string (an octave away is not a reading);
//  * one string is "locked", and stays so until another is played clearly and steadily (about a third of a second);
//  * the error in cents is smoothed, and a reading far from it is ignored unless it keeps coming;
//  * "in tune" has a margin (hysteresis), so it does not flicker at the edge.

export interface TrackerOptions {
  /** The strings as midi numbers; empty when any note will do. */
  strings: number[];
  /** A string chosen by hand, or null to find which is being played. */
  target: number | null;
  /** How close counts as in tune, in cents. */
  tol: number;
}

const REACH = 350; // cents: further from every string than this is not a reading of any string
const MANUAL_REACH = 600;
const SWITCH_READINGS = 6;
const FIRST_READINGS = 3;

export class StringTracker {
  /** Index of the string being tuned, or -1. In "any note" mode it is 0 whenever a note is held. */
  lock = -1;
  /** How far off it is, smoothed, in cents (positive is sharp). */
  cents = 0;
  ok = false;
  /** The note being tuned towards in "any note" mode. */
  chromGoal = 0;

  private cand = -1;
  private candCount = 0;
  private outliers = 0;
  private jump = 0;

  constructor(public opts: TrackerOptions) {}

  /** The midi note the locked string is tuned to (or the note nearest in "any note" mode). */
  goal(): number | null {
    if (this.lock < 0) return null;
    return this.opts.strings.length ? this.opts.strings[this.lock] : this.chromGoal;
  }

  /** Takes one reading (a midi pitch with a fraction) and how sure the detector is of it. Returns true if the display should change. */
  push(m: number, clarity: number): boolean {
    const { strings, target, tol } = this.opts;
    let idx: number;
    let cents: number;

    if (!strings.length) {
      if (this.lock < 0) this.chromGoal = Math.round(m);
      cents = (m - this.chromGoal) * 100;
      if (Math.abs(cents) > 65) {
        // a different note: only believed once it keeps coming
        if (++this.jump < 4) return false;
        this.chromGoal = Math.round(m);
        this.jump = 0;
        this.cents = (m - this.chromGoal) * 100;
        return this.settle(0, this.cents, true);
      }
      this.jump = 0;
      idx = 0;
    } else if (target !== null) {
      idx = strings.indexOf(target);
      cents = (m - target) * 100;
      if (idx < 0 || Math.abs(cents) > MANUAL_REACH) return false;
    } else {
      idx = 0;
      strings.forEach((s, i) => {
        if (Math.abs(m - s) < Math.abs(m - strings[idx])) idx = i;
      });
      cents = (m - strings[idx]) * 100;
      if (Math.abs(cents) > REACH) return false; // an octave out, or between strings: not a reading of any
    }
    return this.settle(idx, cents, false, clarity);
  }

  private settle(idx: number, cents: number, force = false, clarity = 1): boolean {
    if (force) {
      this.lock = idx;
      this.cents = cents;
      this.outliers = 0;
      return this.judge(true);
    }
    if (this.lock < 0) {
      // the first string: a few readings that agree
      if (idx === this.cand) this.candCount++;
      else {
        this.cand = idx;
        this.candCount = 1;
      }
      if (this.candCount < FIRST_READINGS) return false;
      this.lock = idx;
      this.cents = cents;
      this.outliers = 0;
      this.cand = -1;
      return this.judge(true);
    }
    if (idx !== this.lock) {
      // another string: only if it is played clearly and steadily
      if (idx === this.cand) this.candCount++;
      else {
        this.cand = idx;
        this.candCount = 1;
      }
      if (this.candCount < SWITCH_READINGS || clarity < 0.85) return false;
      this.lock = idx;
      this.cents = cents;
      this.cand = -1;
      this.outliers = 0;
      return this.judge(true);
    }
    this.cand = -1;
    this.candCount = 0;
    if (Math.abs(cents - this.cents) > 90) {
      // far from where the string has been: noise, unless it keeps coming
      if (++this.outliers < 4) return false;
      this.cents = cents;
      this.outliers = 0;
    } else {
      this.outliers = 0;
      this.cents += (cents - this.cents) * 0.35;
    }
    return this.judge(false);
  }

  private judge(changed: boolean): boolean {
    const ok = Math.abs(this.cents) <= (this.ok ? this.opts.tol + 2 : this.opts.tol);
    if (ok !== this.ok) {
      this.ok = ok;
      return true;
    }
    return changed || true; // the display follows every reading
  }

  /** The sound has stopped: let go of the string. */
  release() {
    this.lock = -1;
    this.ok = false;
    this.cents = 0;
    this.cand = -1;
    this.candCount = 0;
    this.outliers = 0;
    this.jump = 0;
  }
}
