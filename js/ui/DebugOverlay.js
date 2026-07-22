/**
 * DebugOverlay
 *
 * Draws frame timing, clock, camera, grid, and input information in the corner
 * of the screen.
 *
 * Why this exists:
 * Every performance problem in this project will show up here first. Traffic
 * simulation gets expensive fast once hundreds of vehicles are pathfinding,
 * and the earliest possible warning is a frame rate that quietly drops while a
 * road network grows.
 *
 * Readouts that matter as much as fps:
 *   - Simulation steps per frame. If this sits above 1 consistently, the
 *     simulation is falling behind real time, which is a different failure from
 *     a slow renderer and needs a different fix.
 *   - Cells and grid lines drawn. These prove view culling is working. A
 *     culling bug is silent and only surfaces as unexplained slowness later.
 *   - Input mode and pointer count. A stuck gesture on a phone is invisible
 *     otherwise, and this exposes a finger the browser forgot to report.
 *   - Cell size in screen pixels. Both the zoom limits and the grid fade curve
 *     are defined in terms of this number, so showing it makes them legible
 *     rather than magic.
 *
 * Lines are deliberately packed two facts to a row. The panel is a diagnostic
 * tool, not a HUD, and on a phone every row it occupies is a row of the game
 * it covers.
 */
import { COLORS, CELL_SIZE } from "../config.js";

export class DebugOverlay {
  constructor() {
    /** Rolling window of recent frame times, in seconds. */
    this.samples = [];
    this.maxSamples = 60;

    /** Simulation steps executed during the most recent frame. */
    this.lastSteps = 0;

    this.visible = true;

    /**
     * Screen rectangle occupied by the panel, published so InputManager can
     * treat presses on it as UI rather than as the start of a pan.
     */
    this.bounds = { x: 0, y: 0, w: 0, h: 0 };
  }

  /**
   * Records timing data for the frame that just completed.
   * @param {number} frameTime real seconds elapsed this frame
   * @param {number} steps fixed simulation steps run this frame
   */
  sample(frameTime, steps) {
    this.samples.push(frameTime);
    if (this.samples.length > this.maxSamples) this.samples.shift();
    this.lastSteps = steps;
  }

  /** Average frames per second across the rolling window. */
  get fps() {
    if (this.samples.length === 0) return 0;
    const total = this.samples.reduce((sum, t) => sum + t, 0);
    return this.samples.length / total;
  }

  /** Average frame time in milliseconds across the rolling window. */
  get frameMs() {
    if (this.samples.length === 0) return 0;
    const total = this.samples.reduce((sum, t) => sum + t, 0);
    return (total / this.samples.length) * 1000;
  }

  toggle() {
    this.visible = !this.visible;
  }

  /**
   * @param {import("../core/Renderer.js").Renderer} renderer
   * @param {{
   *   clock: import("../core/Clock.js").Clock,
   *   camera: import("../render/Camera.js").Camera,
   *   input: import("./InputManager.js").InputManager,
   *   cellsDrawn: number,
   *   totalCells: number,
   *   gridLines: number,
   *   gridAlpha: number
   * }} state
   */
  draw(renderer, state) {
    if (!this.visible) {
      this.bounds = { x: 0, y: 0, w: 0, h: 0 };
      return;
    }

    const {
      clock,
      camera,
      input,
      cellsDrawn,
      totalCells,
      gridLines,
      gridAlpha,
    } = state;
    const ctx = renderer.ctx;

    const cellPx = CELL_SIZE * camera.zoom;

    const lines = [
      `${this.fps.toFixed(0)} fps  ${this.frameMs.toFixed(1)} ms  ${this.lastSteps} steps`,
      clock.format(),
      `cam ${camera.x.toFixed(0)}, ${camera.y.toFixed(0)}  zoom ${camera.zoom.toFixed(2)}x`,
      `cell ${cellPx.toFixed(1)}px  grid a${gridAlpha.toFixed(2)}`,
      `drawn ${cellsDrawn}/${totalCells} cells  ${gridLines} lines`,
      `${input.mode}  ptr ${input.pointers.size}  keys ${input.keys.size}`,
    ];

    const padding = 8;
    const lineHeight = 16;
    const x = 10;
    const y = 10;
    const w = 258;
    const h = padding * 2 + lineHeight * lines.length;

    this.bounds = { x, y, w, h };

    ctx.fillStyle = COLORS.debugPanel;
    ctx.fillRect(x, y, w, h);

    ctx.fillStyle = COLORS.debugText;
    ctx.font = "12px ui-monospace, Menlo, Consolas, monospace";
    ctx.textBaseline = "top";

    lines.forEach((line, i) => {
      ctx.fillText(line, x + padding, y + padding + i * lineHeight);
    });
  }
}
