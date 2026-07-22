/**
 * GroundRenderer
 *
 * Draws the buildable site and its boundary.
 *
 * Deliberately not called GrassRenderer. "Grass" implies terrain, terrain
 * implies land types and elevation and biomes, and that is the road to a city
 * builder. This is a site, a flat surface to lay infrastructure on, and it
 * should never become more than that.
 *
 * The alternating cell tint is doing real work despite being nearly invisible.
 * It gives the player a constant sense of scale, so at any zoom level they can
 * see roughly how many cells a road spans without a grid overlay shouting at
 * them. The contrast is intentionally tiny because roads and traffic must
 * always be the loudest thing on screen.
 *
 * Culling: only the cells inside the camera's visible bounds are drawn. On a
 * 96 x 96 site that is the difference between roughly 9200 fill operations per
 * frame and a few hundred.
 */
import { COLORS } from "../config.js";

export class GroundRenderer {
  /**
   * @param {import("../sim/World.js").World} world
   */
  constructor(world) {
    this.world = world;
  }

  /**
   * @param {import("../core/Renderer.js").Renderer} renderer
   * @param {import("./Camera.js").Camera} camera
   * @returns {number} how many cells were drawn, reported for the debug overlay
   */
  draw(renderer, camera) {
    const ctx = renderer.ctx;
    const world = this.world;
    const cs = world.cellSize;

    // Everything outside the site reads as dead space.
    renderer.clear(COLORS.void);

    const view = camera.visibleBounds();

    // Convert the visible world rectangle into a cell range, then clamp it to
    // the site so we never iterate over cells that do not exist.
    let startCol = Math.floor(view.left / cs);
    let endCol = Math.ceil(view.right / cs);
    let startRow = Math.floor(view.top / cs);
    let endRow = Math.ceil(view.bottom / cs);

    startCol = Math.max(startCol, 0);
    startRow = Math.max(startRow, 0);
    endCol = Math.min(endCol, world.cols);
    endRow = Math.min(endRow, world.rows);

    let drawn = 0;

    // Cells are drawn one world unit oversized so that fractional zoom levels
    // cannot leave hairline seams of void colour showing between them.
    const overdraw = 1;

    for (let row = startRow; row < endRow; row++) {
      for (let col = startCol; col < endCol; col++) {
        const topLeft = camera.worldToScreen(col * cs, row * cs);
        const size = cs * camera.zoom + overdraw;

        ctx.fillStyle = (col + row) % 2 === 0 ? COLORS.groundA : COLORS.groundB;
        ctx.fillRect(topLeft.x, topLeft.y, size, size);
        drawn++;
      }
    }

    this.drawBoundary(renderer, camera);

    return drawn;
  }

  /**
   * Outlines the site.
   *
   * The player must always be able to tell where the buildable area ends,
   * because the boundary is a hard constraint on every layout decision they
   * make, and later it is where external traffic enters and leaves.
   *
   * @param {import("../core/Renderer.js").Renderer} renderer
   * @param {import("./Camera.js").Camera} camera
   */
  drawBoundary(renderer, camera) {
    const ctx = renderer.ctx;
    const topLeft = camera.worldToScreen(0, 0);
    const bottomRight = camera.worldToScreen(this.world.width, this.world.height);

    ctx.strokeStyle = COLORS.boundary;
    ctx.lineWidth = 2;
    ctx.strokeRect(
      topLeft.x,
      topLeft.y,
      bottomRight.x - topLeft.x,
      bottomRight.y - topLeft.y
    );
  }
}
