/**
 * CameraController
 *
 * Reads input state and moves the camera. The only class permitted to mutate
 * camera position or zoom.
 *
 * Why this is separate from both Camera and InputManager:
 * Camera is a pure transform, so it stays usable by a minimap, a scripted
 * tutorial, or a replay. InputManager is a pure state holder, so it stays
 * testable without a canvas. The policy that connects them, how fast panning
 * feels, how sharply zoom responds, and how far the view may stray from the
 * site, is a design decision and deserves its own file where it can be tuned
 * without touching either.
 *
 * Why this updates on real frame time rather than inside the fixed simulation
 * step:
 * The camera is not simulation state. Design Note DN-7 wants deterministic
 * replay, which requires that nothing a player does with their viewport can
 * influence the fixed step. Camera motion therefore runs outside the
 * accumulator. It is still frame rate independent, because velocity is
 * multiplied by real elapsed seconds, and it has the useful side effect that
 * the player can still look around while the simulation clock is paused, which
 * is exactly what they will want while studying a queue.
 */
import {
  CAMERA_PAN_SPEED,
  CAMERA_EDGE_MARGIN_CELLS,
  CAMERA_EDGE_MARGIN_VIEW_FRACTION,
  KEY_ZOOM_RATE,
} from "../config.js";

/** Key codes that pan in each direction. WASD and arrows are equivalent. */
const KEYS_LEFT = ["KeyA", "ArrowLeft"];
const KEYS_RIGHT = ["KeyD", "ArrowRight"];
const KEYS_UP = ["KeyW", "ArrowUp"];
const KEYS_DOWN = ["KeyS", "ArrowDown"];

/**
 * Key codes that zoom. Both the main row and the numpad are covered, and
 * Equal is included alongside NumpadAdd because typing plus on most layouts
 * requires shift, and requiring shift to zoom in would be needlessly hostile.
 */
const KEYS_ZOOM_IN = ["Equal", "NumpadAdd"];
const KEYS_ZOOM_OUT = ["Minus", "NumpadSubtract"];

export class CameraController {
  /**
   * @param {import("./Camera.js").Camera} camera
   * @param {import("../sim/World.js").World} world
   * @param {import("../ui/InputManager.js").InputManager} input
   */
  constructor(camera, world, input) {
    this.camera = camera;
    this.world = world;
    this.input = input;
  }

  /**
   * @param {number} dt real seconds elapsed since the last frame
   */
  update(dt) {
    // Zoom is applied before pan so that the pan delta accumulated during a
    // pinch is converted to world units using the zoom the player has just
    // arrived at, which is what keeps a two finger slide feeling attached to
    // the fingers rather than lagging a frame behind them.
    this.applyGestureZoom();
    this.applyKeyboardZoom(dt);
    this.applyDrag();
    this.applyKeyboardPan(dt);
    this.clamp();
  }

  /* ---------------------------------------------------------------- */
  /* Zoom                                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Changes zoom while keeping one screen point pinned to the same world point.
   *
   * The implementation is deliberately the boring one: measure the world point
   * under the anchor, change the zoom, measure it again, and shift the camera
   * by the difference. There is a closed form solution, and it is where most
   * implementations quietly introduce drift. This version has no algebra to
   * get wrong, and it stays exactly correct when the requested zoom is clamped
   * at a limit, because the second measurement uses whatever zoom was actually
   * applied rather than the zoom that was asked for.
   *
   * @param {number} anchorX canvas relative x to keep fixed
   * @param {number} anchorY canvas relative y to keep fixed
   * @param {number} targetZoom desired zoom, clamped by Camera
   */
  zoomAt(anchorX, anchorY, targetZoom) {
    const cam = this.camera;

    const before = cam.screenToWorld(anchorX, anchorY);
    cam.setZoom(targetZoom);
    const after = cam.screenToWorld(anchorX, anchorY);

    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
  }

  /** Applies zoom accumulated from the wheel or from a pinch. */
  applyGestureZoom() {
    const { factor, anchorX, anchorY } = this.input.consumeZoom();
    if (factor === 1) return;

    this.zoomAt(anchorX, anchorY, this.camera.zoom * factor);
  }

  /**
   * Applies held key zoom, anchored to the centre of the screen.
   *
   * Rate is a multiplier per second raised to the power of elapsed time, so
   * holding the key changes the view by the same proportion every second
   * regardless of frame rate, and regardless of how far in or out the player
   * already is.
   *
   * @param {number} dt real seconds elapsed since the last frame
   */
  applyKeyboardZoom(dt) {
    const input = this.input;

    const zoomingIn = input.anyKeyDown(KEYS_ZOOM_IN);
    const zoomingOut = input.anyKeyDown(KEYS_ZOOM_OUT);
    if (zoomingIn === zoomingOut) return; // neither, or both cancelling out

    const factor = Math.pow(KEY_ZOOM_RATE, zoomingIn ? dt : -dt);

    this.zoomAt(
      this.camera.viewportWidth / 2,
      this.camera.viewportHeight / 2,
      this.camera.zoom * factor
    );
  }

  /* ---------------------------------------------------------------- */
  /* Pan                                                              */
  /* ---------------------------------------------------------------- */

  /**
   * Applies pointer drag movement, from either a one finger drag or the
   * midpoint of a two finger pinch.
   *
   * Screen delta is divided by zoom to get world delta, which is what makes
   * dragging feel identical at every zoom level: the world point under the
   * finger stays under the finger. The sign is inverted because dragging right
   * should pull the world right, which means moving the camera left.
   */
  applyDrag() {
    const { dx, dy } = this.input.consumeDragDelta();
    if (dx === 0 && dy === 0) return;

    this.camera.x -= dx / this.camera.zoom;
    this.camera.y -= dy / this.camera.zoom;
  }

  /**
   * Applies keyboard panning.
   * @param {number} dt real seconds elapsed since the last frame
   */
  applyKeyboardPan(dt) {
    const input = this.input;

    let dirX = 0;
    let dirY = 0;

    if (input.anyKeyDown(KEYS_LEFT)) dirX -= 1;
    if (input.anyKeyDown(KEYS_RIGHT)) dirX += 1;
    if (input.anyKeyDown(KEYS_UP)) dirY -= 1;
    if (input.anyKeyDown(KEYS_DOWN)) dirY += 1;

    if (dirX === 0 && dirY === 0) return;

    // Normalise so diagonal panning is not faster than straight panning.
    const length = Math.hypot(dirX, dirY);
    dirX /= length;
    dirY /= length;

    // Speed is defined in screen pixels per second, so it is divided by zoom
    // to convert into world units. The map then appears to move at the same
    // rate whether the player is zoomed into an intersection or looking at the
    // whole site.
    const worldSpeed = (CAMERA_PAN_SPEED / this.camera.zoom) * dt;

    this.camera.x += dirX * worldSpeed;
    this.camera.y += dirY * worldSpeed;
  }

  /* ---------------------------------------------------------------- */
  /* Clamping                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Keeps the site reachable.
   *
   * The camera centre is clamped to the site expanded by a margin, rather than
   * hard clamped to the site itself. Some overshoot is necessary because the
   * player will work right at the boundary, and later the boundary is where
   * external traffic enters the network. The margin is capped as a fraction of
   * the visible half extent, which is measured in world units and therefore
   * shrinks automatically as the player zooms in. That is what stops a high
   * zoom overshoot from pushing the site off screen entirely, and it is why
   * clamping is run after every zoom change rather than only after panning.
   */
  clamp() {
    const cam = this.camera;
    const world = this.world;

    const halfW = cam.viewportWidth / 2 / cam.zoom;
    const halfH = cam.viewportHeight / 2 / cam.zoom;

    const baseMargin = CAMERA_EDGE_MARGIN_CELLS * world.cellSize;
    const marginX = Math.min(baseMargin, halfW * CAMERA_EDGE_MARGIN_VIEW_FRACTION);
    const marginY = Math.min(baseMargin, halfH * CAMERA_EDGE_MARGIN_VIEW_FRACTION);

    cam.x = clamp(cam.x, -marginX, world.width + marginX);
    cam.y = clamp(cam.y, -marginY, world.height + marginY);
  }

  /** Recentres the camera on the site. Useful for a reset control later. */
  centerOnSite() {
    this.camera.x = this.world.centerX;
    this.camera.y = this.world.centerY;
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
