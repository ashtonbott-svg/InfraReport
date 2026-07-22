/**
 * Renderer
 *
 * Owns the canvas, the 2D context, and the device pixel ratio handling.
 *
 * Why this is its own class:
 * The hard rule for this project is that simulation code never touches the
 * canvas and rendering code never mutates simulation state. Renderer is the
 * only object allowed to know that a canvas exists. Simulation classes added
 * later (Grid, RoadNetwork, Vehicle) will expose plain data, and dedicated
 * render functions will read that data through this class.
 *
 * Handling devicePixelRatio here means every later drawing routine can work in
 * plain CSS pixels and stay crisp on high density displays without thinking
 * about it. The ratio is also published, because anything that draws thin
 * lines needs it to snap them onto whole device pixels.
 */
export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");

    /** Logical drawing size in CSS pixels. */
    this.width = 0;
    this.height = 0;

    /**
     * Device pixels per CSS pixel. Typically 1 on a desktop monitor, 2 or 3 on
     * a phone. Published because thin lines must be snapped to whole device
     * pixels to avoid blurring, and only the drawing code knows where its
     * lines are going.
     */
    this.dpr = 1;

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  /**
   * Matches the canvas backing store to the window size and pixel density.
   * Called on startup and on every window resize.
   */
  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;

    this.width = window.innerWidth;
    this.height = window.innerHeight;

    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);

    // Reset any previous transform, then scale so that one unit drawn equals
    // one CSS pixel regardless of display density.
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Crisp edges suit the deliberately simple rectangle based art style.
    this.ctx.imageSmoothingEnabled = false;
  }

  /**
   * Snaps a CSS pixel coordinate onto the nearest device pixel boundary.
   *
   * Why this matters: a one pixel line drawn at a fractional device pixel
   * position gets split across two rows of pixels at partial opacity, which
   * reads as a soft grey smear rather than a line. Snapping first is the
   * difference between a crisp grid and a blurry one, and on a 3x phone
   * display the difference is obvious.
   *
   * @param {number} value CSS pixel coordinate
   * @returns {number} CSS pixel coordinate aligned to a device pixel edge
   */
  snap(value) {
    return Math.round(value * this.dpr) / this.dpr;
  }

  /**
   * Converts a target thickness in CSS pixels into a whole number of device
   * pixels, expressed back in CSS pixels.
   *
   * Always at least one device pixel, so a line can never round away to
   * nothing, and always a whole number, so it can never straddle a boundary.
   *
   * @param {number} cssPx desired thickness in CSS pixels
   * @returns {number} thickness in CSS pixels that is a whole device pixel count
   */
  deviceLineWidth(cssPx) {
    return Math.max(1, Math.round(cssPx * this.dpr)) / this.dpr;
  }

  /**
   * Fills the whole canvas with a solid color.
   * @param {string} color
   */
  clear(color) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }
}
