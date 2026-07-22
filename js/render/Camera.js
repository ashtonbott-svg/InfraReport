/**
 * Camera
 *
 * Owns the transform between world coordinates and screen coordinates.
 * Position is expressed as the world coordinate sitting at the centre of the
 * viewport, which is far easier to reason about than a top left offset when
 * zooming, because zooming about the screen centre becomes a no op on position.
 *
 * This class has no input handling. It is pure transform state. Milestone 3
 * adds panning and milestone 4 adds zooming, both of which will only ever
 * mutate `x`, `y`, and `zoom` from an input layer. Keeping the transform free
 * of event listeners means the same camera can later be driven by a minimap,
 * a scripted tutorial, or a replay without any changes.
 */
import {
  CAMERA_DEFAULT_ZOOM,
  CAMERA_MIN_ZOOM,
  CAMERA_MAX_ZOOM,
} from "../config.js";

export class Camera {
  /**
   * @param {number} x world coordinate at viewport centre
   * @param {number} y world coordinate at viewport centre
   * @param {number} zoom screen pixels per world unit
   */
  constructor(x = 0, y = 0, zoom = CAMERA_DEFAULT_ZOOM) {
    this.x = x;
    this.y = y;
    this.zoom = zoom;

    /** Viewport size in screen pixels, refreshed each frame by the renderer. */
    this.viewportWidth = 0;
    this.viewportHeight = 0;
  }

  /**
   * Updates the cached viewport size. Called before any transform is used,
   * so a window resize can never leave the camera converting against stale
   * dimensions.
   * @param {number} width
   * @param {number} height
   */
  setViewport(width, height) {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  /** Clamps zoom into the allowed range. */
  setZoom(zoom) {
    this.zoom = Math.min(Math.max(zoom, CAMERA_MIN_ZOOM), CAMERA_MAX_ZOOM);
  }

  /**
   * @param {number} wx world x
   * @param {number} wy world y
   * @returns {{x: number, y: number}} screen position in CSS pixels
   */
  worldToScreen(wx, wy) {
    return {
      x: (wx - this.x) * this.zoom + this.viewportWidth / 2,
      y: (wy - this.y) * this.zoom + this.viewportHeight / 2,
    };
  }

  /**
   * @param {number} sx screen x in CSS pixels
   * @param {number} sy screen y in CSS pixels
   * @returns {{x: number, y: number}} world position
   */
  screenToWorld(sx, sy) {
    return {
      x: (sx - this.viewportWidth / 2) / this.zoom + this.x,
      y: (sy - this.viewportHeight / 2) / this.zoom + this.y,
    };
  }

  /**
   * The rectangle of world space currently visible, in world units.
   *
   * This is the basis of view culling. Every renderer that draws many objects
   * asks the camera what is visible and skips everything else. At full zoom out
   * on a large site the difference between drawing what is visible and drawing
   * everything is thousands of operations per frame, and that gap only widens
   * once roads and vehicles exist.
   *
   * @param {number} margin extra world units to include on each side, useful
   *   for objects whose centre is offscreen but whose body is not
   * @returns {{left: number, top: number, right: number, bottom: number}}
   */
  visibleBounds(margin = 0) {
    const halfW = this.viewportWidth / 2 / this.zoom;
    const halfH = this.viewportHeight / 2 / this.zoom;
    return {
      left: this.x - halfW - margin,
      top: this.y - halfH - margin,
      right: this.x + halfW + margin,
      bottom: this.y + halfH + margin,
    };
  }
}
