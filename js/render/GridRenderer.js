/**
 * GridRenderer
 *
 * Draws the cell grid over the ground.
 *
 * The grid is purely a rendering concern. There is no grid object in the
 * simulation layer and there does not need to be: `World` already owns cell
 * size and site dimensions, and every line position is derived from those.
 * Adding grid state to the simulation would be state that nothing simulates.
 *
 * Two problems dominate this file, and both are worth naming.
 *
 * 1. Crispness. Canvas draws in CSS pixels, but the display works in device
 *    pixels, and on a 3x iPhone one CSS pixel is three device pixels. A line
 *    landing at a fractional device pixel position is spread across two rows
 *    at partial opacity, which reads as a soft grey smear. Every line here is
 *    therefore snapped to a device pixel boundary and given a thickness that
 *    is a whole number of device pixels. This also removes any chance of the
 *    double thickness artefact, where two neighbouring lines round onto the
 *    same pixel and stack.
 *
 * 2. Density. A grid is a reading aid, and a reading aid that is too dense
 *    becomes noise. The fade curve in config decides when the grid helps and
 *    when it hurts, driven by apparent cell size rather than by zoom, per
 *    Design Note DN-13.
 *
 * Lines are drawn with fillRect rather than stroke. A stroke of width w is
 * centred on its path, so it straddles the coordinate and needs a half pixel
 * offset that itself depends on the device pixel ratio. A filled rectangle
 * simply occupies the pixels it is told to, which makes the snapping exact and
 * the reasoning obvious.
 */
import {
  COLORS,
  GRID_HIDE_BELOW_CELL_PX,
  GRID_FULL_ABOVE_CELL_PX,
  GRID_SOFTEN_ABOVE_CELL_PX,
  GRID_ALPHA_MAX,
  GRID_ALPHA_ZOOMED_IN,
  GRID_LINE_WIDTH_CSS_PX,
} from "../config.js";

export class GridRenderer {
  /**
   * @param {import("../sim/World.js").World} world
   */
  constructor(world) {
    this.world = world;

    /** Lines drawn on the most recent frame, reported to the debug overlay. */
    this.lineCount = 0;

    /** Alpha used on the most recent frame, reported to the debug overlay. */
    this.alpha = 0;
  }

  /**
   * Opacity for a given apparent cell size.
   *
   * Piecewise rather than a single curve, because the three regions answer
   * three different questions and each threshold is independently meaningful.
   * Keeping them as separate named constants means the grid can be retuned
   * without anyone having to reverse engineer a formula.
   *
   * @param {number} cellPx how many screen pixels one cell occupies
   * @returns {number} alpha between 0 and GRID_ALPHA_MAX
   */
  alphaFor(cellPx) {
    if (cellPx <= GRID_HIDE_BELOW_CELL_PX) return 0;

    // Ramp in: too small to be useful, up to comfortably readable.
    if (cellPx < GRID_FULL_ABOVE_CELL_PX) {
      const t =
        (cellPx - GRID_HIDE_BELOW_CELL_PX) /
        (GRID_FULL_ABOVE_CELL_PX - GRID_HIDE_BELOW_CELL_PX);
      return GRID_ALPHA_MAX * t;
    }

    // Working range: full strength.
    if (cellPx <= GRID_SOFTEN_ABOVE_CELL_PX) return GRID_ALPHA_MAX;

    // Ease back: zoomed far in, the grid must not dominate what it frames.
    const span = 128 - GRID_SOFTEN_ABOVE_CELL_PX;
    const t = Math.min((cellPx - GRID_SOFTEN_ABOVE_CELL_PX) / span, 1);
    return GRID_ALPHA_MAX + (GRID_ALPHA_ZOOMED_IN - GRID_ALPHA_MAX) * t;
  }

  /**
   * @param {import("../core/Renderer.js").Renderer} renderer
   * @param {import("./Camera.js").Camera} camera
   * @returns {number} number of lines drawn, for the debug overlay
   */
  draw(renderer, camera) {
    const world = this.world;
    const cs = world.cellSize;
    const cellPx = cs * camera.zoom;

    const alpha = this.alphaFor(cellPx);
    this.alpha = alpha;

    if (alpha <= 0) {
      this.lineCount = 0;
      return 0;
    }

    const ctx = renderer.ctx;
    const view = camera.visibleBounds();

    // Line indices, not cell indices. A site of N columns has N + 1 vertical
    // lines, so the ranges are clamped inclusively at the far edge.
    const startCol = clampInt(Math.floor(view.left / cs), 0, world.cols);
    const endCol = clampInt(Math.ceil(view.right / cs), 0, world.cols);
    const startRow = clampInt(Math.floor(view.top / cs), 0, world.rows);
    const endRow = clampInt(Math.ceil(view.bottom / cs), 0, world.rows);

    // Extent of the drawn lines, clipped to both the site and the viewport.
    // Clipping to the viewport matters because at high zoom the site is many
    // times taller than the screen, and asking the canvas to fill a rectangle
    // thousands of pixels tall for every line is wasted work.
    const siteTop = camera.worldToScreen(0, 0);
    const siteBottom = camera.worldToScreen(world.width, world.height);

    const top = Math.max(siteTop.y, 0);
    const bottom = Math.min(siteBottom.y, renderer.height);
    const left = Math.max(siteTop.x, 0);
    const right = Math.min(siteBottom.x, renderer.width);

    const height = bottom - top;
    const width = right - left;
    if (height <= 0 || width <= 0) {
      this.lineCount = 0;
      return 0;
    }

    const lineWidth = renderer.deviceLineWidth(GRID_LINE_WIDTH_CSS_PX);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = COLORS.grid;

    let lines = 0;

    // Vertical lines.
    for (let col = startCol; col <= endCol; col++) {
      const x = renderer.snap(camera.worldToScreen(col * cs, 0).x);
      ctx.fillRect(x, top, lineWidth, height);
      lines++;
    }

    // Horizontal lines.
    for (let row = startRow; row <= endRow; row++) {
      const y = renderer.snap(camera.worldToScreen(0, row * cs).y);
      ctx.fillRect(left, y, width, lineWidth);
      lines++;
    }

    ctx.restore();

    this.lineCount = lines;
    return lines;
  }
}

function clampInt(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
