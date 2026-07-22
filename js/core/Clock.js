/**
 * Clock
 *
 * Tracks simulated game time, separately from real wall clock time.
 *
 * Why this exists from milestone 1:
 * The long term goal is engineering statistics such as vehicles per hour,
 * average delay, and level of service. Every one of those numbers is a rate
 * measured against a unit of game time. If the simulation only ever knows
 * about real seconds, those statistics have to be retrofitted later, and
 * retrofitting a time base is one of the most invasive changes possible in a
 * simulation. So the concept of "game minutes" exists before anything moves.
 *
 * The scale is deliberately simple: one real second equals `minutesPerSecond`
 * game minutes. At the default of 1, a game day takes 24 real minutes, which
 * is a reasonable pace for watching a rush hour build and clear.
 */
export class Clock {
  constructor(minutesPerSecond = 1) {
    /** How many game minutes pass per real second at speed multiplier 1. */
    this.minutesPerSecond = minutesPerSecond;

    /** Player controlled speed multiplier. 0 means paused. */
    this.speed = 1;

    /** Total elapsed game time, in game minutes, since the session started. */
    this.totalMinutes = 0;

    /** Total elapsed real seconds the simulation has actually stepped. */
    this.realSeconds = 0;
  }

  /**
   * Advances the clock by one fixed simulation step.
   * @param {number} dt fixed timestep in real seconds
   */
  advance(dt) {
    this.realSeconds += dt;
    this.totalMinutes += dt * this.minutesPerSecond * this.speed;
  }

  /** Whole game days elapsed. */
  get day() {
    return Math.floor(this.totalMinutes / 1440);
  }

  /** Hour of the current game day, 0 to 23. */
  get hour() {
    return Math.floor((this.totalMinutes % 1440) / 60);
  }

  /** Minute of the current game hour, 0 to 59. */
  get minute() {
    return Math.floor(this.totalMinutes % 60);
  }

  /** Formatted clock string, for example "Day 1  07:45". */
  format() {
    const hh = String(this.hour).padStart(2, "0");
    const mm = String(this.minute).padStart(2, "0");
    return `Day ${this.day + 1}  ${hh}:${mm}`;
  }
}
