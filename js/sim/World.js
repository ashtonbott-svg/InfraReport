/**
 * World
 *
 * Defines the bounded site the player works within, and owns the conversion
 * between world units and grid cells.
 *
 * This is a simulation class. It knows nothing about canvas, camera, colors,
 * or the mouse. It answers questions about space, and nothing else.
 *
 * Why the world is bounded:
 * An infinite plane invites sprawl, and sprawl is the city builder answer to
 * congestion, build somewhere else. A traffic engineer never gets that option.
 * They get a fixed site and must make the geometry inside it work. Every
 * satisfying moment in this game comes from solving a problem in place, so the
 * boundary is a gameplay feature rather than a limitation.
 *
 * Coordinate systems in this project, defined here once:
 *   - Cell coordinates: integer (col, row), origin at top left cell.
 *   - World coordinates: floating point units, origin at the site's top left
 *     corner. One world unit equals one pixel at camera zoom 1.
 *   - Screen coordinates: pixels on the canvas. Camera owns that conversion.
 */
import { CELL_SIZE, WORLD_COLS, WORLD_ROWS } from "../config.js";

export class World {
  constructor(cols = WORLD_COLS, rows = WORLD_ROWS, cellSize = CELL_SIZE) {
    this.cols = cols;
    this.rows = rows;
    this.cellSize = cellSize;
  }

  /** Site width in world units. */
  get width() {
    return this.cols * this.cellSize;
  }

  /** Site height in world units. */
  get height() {
    return this.rows * this.cellSize;
  }

  /** World coordinate of the site centre, used for initial camera framing. */
  get centerX() {
    return this.width / 2;
  }

  get centerY() {
    return this.height / 2;
  }

  /**
   * Converts a world coordinate to the cell containing it.
   * Returns fractional input floored, so the result is always an integer pair.
   * @param {number} wx
   * @param {number} wy
   * @returns {{col: number, row: number}}
   */
  worldToCell(wx, wy) {
    return {
      col: Math.floor(wx / this.cellSize),
      row: Math.floor(wy / this.cellSize),
    };
  }

  /**
   * World coordinate of a cell's top left corner.
   * @param {number} col
   * @param {number} row
   */
  cellToWorld(col, row) {
    return { x: col * this.cellSize, y: row * this.cellSize };
  }

  /**
   * World coordinate of a cell's centre. Vehicles will travel between cell
   * centres, so this gets used constantly later.
   * @param {number} col
   * @param {number} row
   */
  cellCenter(col, row) {
    return {
      x: col * this.cellSize + this.cellSize / 2,
      y: row * this.cellSize + this.cellSize / 2,
    };
  }

  /**
   * Whether a cell lies inside the site.
   * @param {number} col
   * @param {number} row
   */
  contains(col, row) {
    return col >= 0 && row >= 0 && col < this.cols && row < this.rows;
  }

  /**
   * Whether a cell sits on the outer edge of the site.
   *
   * Not used yet. It exists because edge cells are the natural place for
   * external traffic to enter and leave the network in a later milestone,
   * and the concept belongs to the world rather than to whatever system
   * eventually needs it.
   * @param {number} col
   * @param {number} row
   */
  isEdgeCell(col, row) {
    if (!this.contains(col, row)) return false;
    return (
      col === 0 || row === 0 || col === this.cols - 1 || row === this.rows - 1
    );
  }

  /** Clamps a cell coordinate pair into the site. */
  clampCell(col, row) {
    return {
      col: Math.min(Math.max(col, 0), this.cols - 1),
      row: Math.min(Math.max(row, 0), this.rows - 1),
    };
  }
}
