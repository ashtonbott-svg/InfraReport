/**
 * InputManager
 *
 * The single owner of every keyboard, mouse, wheel, pointer, and touch
 * listener in the project. Nothing else is permitted to call addEventListener
 * for input.
 *
 * Why one owner:
 * Input bugs are almost always state bugs, a key that stayed down, a drag that
 * never ended, a pinch that survived a finger lift. If listeners are scattered
 * across classes there is no single place to reset that state, and the
 * failures are intermittent and horrible. With one owner there is exactly one
 * `clearAll()` and exactly one source of truth.
 *
 * Why Pointer Events instead of separate mouse and touch handlers:
 * A finger and a mouse are the same gesture as far as panning is concerned,
 * and pointer events give every touch a stable id, which is what makes pinch
 * tracking tractable. One code path means the two can never drift out of sync.
 * iOS Safari has supported Pointer Events since 13.
 *
 * This class is a passive state holder. It never moves the camera, never
 * toggles UI, and never touches simulation state. Systems poll it and consume
 * accumulated gestures. That keeps input testable without a canvas and keeps
 * the direction of dependency one way.
 */
import { WHEEL_ZOOM_SENSITIVITY } from "../config.js";

/** Gesture modes. Exactly one is active at a time. */
export const InputMode = {
  IDLE: "idle",
  DRAG: "dragging",
  PINCH: "pinching",
};

/**
 * How far a pointer may move between press and release and still count as a
 * tap rather than a drag, in CSS pixels. Fingers are never perfectly still,
 * so zero tolerance would make buttons feel broken on a phone.
 */
const TAP_MOVE_TOLERANCE = 12;

export class InputManager {
  /**
   * @param {HTMLCanvasElement} target the canvas that receives pointer input
   */
  constructor(target) {
    this.target = target;

    /** Currently held keys, by KeyboardEvent.code. */
    this.keys = new Set();

    /**
     * Keys that went down since a consumer last read them.
     *
     * Held state and pressed state are different questions. Panning wants "is
     * this key down right now". A toggle wants "did this key go down", exactly
     * once, no matter how long it is held or how fast the OS repeats it. Both
     * are tracked because answering the second from the first is where
     * accidental double toggles come from.
     */
    this.pressedKeys = new Set();

    /**
     * Every pointer currently down on the canvas, keyed by pointerId.
     * @type {Map<number, {x: number, y: number, type: string}>}
     */
    this.pointers = new Map();

    /** Current gesture mode. */
    this.mode = InputMode.IDLE;

    /** The pointer id that owns a single pointer drag. */
    this.activePointerId = null;

    /**
     * Movement accumulated since a consumer last read it, in screen pixels.
     * During a drag this is the pointer's movement. During a pinch it is the
     * movement of the midpoint between the two fingers, so a pinch pans and
     * zooms at the same time, which is what hands expect.
     */
    this.dragDX = 0;
    this.dragDY = 0;

    /** Last pointer position during a single pointer drag, in client pixels. */
    this.lastX = 0;
    this.lastY = 0;

    /** Last measured distance and midpoint between the two pinch pointers. */
    this.lastPinchDistance = 0;
    this.lastPinchMidX = 0;
    this.lastPinchMidY = 0;

    /**
     * Zoom accumulated since a consumer last read it, as a multiplier.
     *
     * Multiplicative rather than additive, and measured incrementally against
     * the previous event rather than against the start of the gesture. Against
     * the gesture start, lifting and replacing a finger or the OS resampling
     * touches produces a visible snap.
     */
    this.pendingZoomFactor = 1;

    /** Canvas relative point that the pending zoom should be anchored to. */
    this.zoomAnchorX = 0;
    this.zoomAnchorY = 0;

    /**
     * A press that began on a UI panel, tracked separately from world gestures.
     *
     * UI presses are deliberately kept out of the pointer map so they can never
     * start a pan or a pinch. But they still have to be followed to release, or
     * on screen buttons would be impossible to tap. Keeping them in their own
     * two fields means a UI press cannot leak into gesture state, and a
     * cancelled UI press cannot leave anything stuck.
     */
    this.uiPressPointerId = null;
    this.uiPressX = 0;
    this.uiPressY = 0;

    /** A completed tap on a UI region, waiting to be consumed. */
    this.pendingUITap = null;

    /**
     * The most recent pointer type observed, "mouse", "touch", or "pen".
     * Used only by the control hint. Starts as a guess from a media query and
     * is corrected by the first real event, which is far more reliable than
     * sniffing the user agent string.
     */
    this.pointerType = window.matchMedia?.("(pointer: coarse)")?.matches
      ? "touch"
      : "mouse";

    /**
     * Screen space rectangles owned by UI overlays. A gesture beginning inside
     * one of these is treated as UI interaction rather than world interaction.
     *
     * This exists because on a phone the debug panel and the toggle button
     * occupy a real slice of a small screen, and a finger landing on them
     * should not yank the camera.
     *
     * @type {Array<{x: number, y: number, w: number, h: number}>}
     */
    this.uiRects = [];

    this.attach();
  }

  /* ---------------------------------------------------------------- */
  /* Setup                                                            */
  /* ---------------------------------------------------------------- */

  attach() {
    const t = this.target;

    // Pointer events cover mouse, touch, and pen through one path.
    t.addEventListener("pointerdown", this.onPointerDown.bind(this));
    t.addEventListener("pointermove", this.onPointerMove.bind(this));
    t.addEventListener("pointerup", this.onPointerUp.bind(this));

    // pointercancel is the important one on iOS. The system fires it whenever
    // it takes a gesture back, for a notification, a control centre swipe, or
    // an incoming call. Without handling it, the gesture never ends and the
    // camera stays glued to a finger that is no longer there.
    t.addEventListener("pointercancel", this.onPointerCancel.bind(this));

    // Wheel must be non passive so the default can be prevented. Without that,
    // ctrl plus wheel zooms the whole page on desktop Safari and Chrome, and
    // a trackpad pinch does the same, both of which would fight the camera.
    t.addEventListener("wheel", this.onWheel.bind(this), { passive: false });

    // Safari has legacy gesture events that can drive page zoom independently
    // of touch-action. Claiming them explicitly closes that last route to the
    // browser zooming the page out from under the game.
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
      t.addEventListener(type, (e) => e.preventDefault());
    }

    // Middle mouse drag would otherwise trigger the browser autoscroll widget.
    t.addEventListener("auxclick", (e) => e.preventDefault());
    t.addEventListener("contextmenu", (e) => e.preventDefault());
    t.addEventListener("dblclick", (e) => e.preventDefault());

    // Keyboard listens on window, not the canvas, because a canvas needs focus
    // to receive key events and demanding a click before WASD works is a bad
    // first ten seconds for any player.
    window.addEventListener("keydown", this.onKeyDown.bind(this));
    window.addEventListener("keyup", this.onKeyUp.bind(this));

    // Losing focus or visibility must wipe all held state. Otherwise a player
    // who leaves mid gesture returns to a camera drifting on a key or a finger
    // the browser never reported releasing.
    window.addEventListener("blur", this.clearAll.bind(this));
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.clearAll();
    });
  }

  /* ---------------------------------------------------------------- */
  /* Keyboard                                                         */
  /* ---------------------------------------------------------------- */

  onKeyDown(e) {
    // Space and the arrow keys scroll the page by default, and F3 opens quick
    // find in some browsers. The canvas fills the window so there is nothing to
    // scroll, but the browser still consumes the event unless it is claimed.
    if (PREVENT_DEFAULT_KEYS.has(e.code)) e.preventDefault();

    // Only the first keydown counts as a press. The OS repeats keydown while a
    // key is held, and without this guard a held backtick would toggle the
    // debug panel dozens of times a second.
    if (!this.keys.has(e.code)) this.pressedKeys.add(e.code);

    this.keys.add(e.code);
  }

  onKeyUp(e) {
    this.keys.delete(e.code);
  }

  /** @param {string} code a KeyboardEvent.code value */
  isKeyDown(code) {
    return this.keys.has(code);
  }

  /** True if any of the supplied key codes is held. */
  anyKeyDown(codes) {
    return codes.some((c) => this.keys.has(c));
  }

  get spaceHeld() {
    return this.keys.has("Space");
  }

  /**
   * Returns the keys pressed since the last call and clears them.
   * @returns {Set<string>}
   */
  consumePressedKeys() {
    const pressed = this.pressedKeys;
    this.pressedKeys = new Set();
    return pressed;
  }

  /* ---------------------------------------------------------------- */
  /* Pointer                                                          */
  /* ---------------------------------------------------------------- */

  onPointerDown(e) {
    this.pointerType = e.pointerType;

    const local = this.toCanvasLocal(e.clientX, e.clientY);

    // A press on a UI panel becomes a candidate tap and never enters the
    // pointer map, so it cannot start a pan or a pinch.
    if (this.isOverUI(local.x, local.y)) {
      this.uiPressPointerId = e.pointerId;
      this.uiPressX = local.x;
      this.uiPressY = local.y;
      e.preventDefault();
      return;
    }

    // A mouse press that is not an explicit pan gesture is not tracked at all,
    // because plain left click has to stay free for road placement.
    if (e.pointerType === "mouse" && !this.isMousePanButton(e)) return;

    this.pointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      type: e.pointerType,
    });

    // Pointer capture routes every subsequent event for this pointer to the
    // canvas even if the finger or cursor leaves it. Without this, dragging
    // off the edge of a phone screen silently drops the gesture.
    try {
      this.target.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a convenience, not a requirement.
    }

    this.refreshMode();
    e.preventDefault();
  }

  /**
   * Whether a mouse press counts as an explicit pan gesture.
   * Middle button, or left button with space held.
   * @param {PointerEvent} e
   */
  isMousePanButton(e) {
    if (e.button === 1) return true;
    if (e.button === 0 && this.spaceHeld) return true;
    return false;
  }

  onPointerMove(e) {
    const tracked = this.pointers.get(e.pointerId);
    if (!tracked) return;

    tracked.x = e.clientX;
    tracked.y = e.clientY;

    if (this.mode === InputMode.DRAG && e.pointerId === this.activePointerId) {
      this.dragDX += e.clientX - this.lastX;
      this.dragDY += e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    } else if (this.mode === InputMode.PINCH) {
      this.updatePinch();
    }

    e.preventDefault();
  }

  onPointerUp(e) {
    // A release that belongs to a UI press completes a tap, if the pointer did
    // not wander far enough to be a drag.
    if (e.pointerId === this.uiPressPointerId) {
      const local = this.toCanvasLocal(e.clientX, e.clientY);
      const moved = Math.hypot(
        local.x - this.uiPressX,
        local.y - this.uiPressY
      );
      if (moved <= TAP_MOVE_TOLERANCE) {
        this.pendingUITap = { x: local.x, y: local.y };
      }
      this.uiPressPointerId = null;
      return;
    }

    if (!this.pointers.has(e.pointerId)) return;

    this.pointers.delete(e.pointerId);
    this.releaseCapture(e.pointerId);

    // Recomputing the mode from scratch is what makes the transitions safe.
    // Lifting one finger of a pinch resumes a drag with the finger that is
    // still down, and because the drag reference position is re-seeded from
    // that finger's current location, the camera does not jump.
    this.refreshMode();
  }

  /**
   * A cancelled pointer must never complete a tap. The system took the gesture
   * away, so the player's intent is unknown and the safe reading is "nothing
   * happened".
   */
  onPointerCancel(e) {
    if (e.pointerId === this.uiPressPointerId) {
      this.uiPressPointerId = null;
      return;
    }

    if (!this.pointers.has(e.pointerId)) return;

    this.pointers.delete(e.pointerId);
    this.releaseCapture(e.pointerId);
    this.refreshMode();
  }

  /**
   * Recomputes gesture mode from the set of tracked pointers, and re-seeds
   * whatever reference values the new mode needs.
   *
   * All gesture transitions funnel through here. That is deliberate: a mode
   * machine with one entry point cannot end up in a state that no code path
   * expected, which is the failure that makes multi touch feel broken.
   */
  refreshMode() {
    const count = this.pointers.size;

    if (count === 0) {
      this.mode = InputMode.IDLE;
      this.activePointerId = null;
      return;
    }

    if (count === 1) {
      const [id, p] = [...this.pointers.entries()][0];
      this.mode = InputMode.DRAG;
      this.activePointerId = id;
      // Re-seeding from the pointer's current position is what prevents a jump
      // when a pinch collapses back into a drag.
      this.lastX = p.x;
      this.lastY = p.y;
      return;
    }

    // Two or more. Only the first two are used; a third finger is tracked but
    // ignored, which is far less surprising than the gesture suddenly changing
    // meaning mid pinch.
    this.mode = InputMode.PINCH;
    this.activePointerId = null;
    this.seedPinch();
  }

  /** Records the current distance and midpoint as the pinch reference. */
  seedPinch() {
    const [a, b] = this.firstTwoPointers();
    if (!a || !b) return;
    this.lastPinchDistance = Math.hypot(b.x - a.x, b.y - a.y);
    this.lastPinchMidX = (a.x + b.x) / 2;
    this.lastPinchMidY = (a.y + b.y) / 2;
  }

  /**
   * Converts the change since the previous pinch sample into pending zoom and
   * pending pan, then re-seeds the reference.
   */
  updatePinch() {
    const [a, b] = this.firstTwoPointers();
    if (!a || !b) return;

    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;

    // Guard against a degenerate zero distance, which would produce infinity.
    if (this.lastPinchDistance > 0.01 && distance > 0.01) {
      this.pendingZoomFactor *= distance / this.lastPinchDistance;
      const anchor = this.toCanvasLocal(midX, midY);
      this.zoomAnchorX = anchor.x;
      this.zoomAnchorY = anchor.y;
    }

    // Midpoint movement pans, so two fingers can slide the map while scaling.
    this.dragDX += midX - this.lastPinchMidX;
    this.dragDY += midY - this.lastPinchMidY;

    this.lastPinchDistance = distance;
    this.lastPinchMidX = midX;
    this.lastPinchMidY = midY;
  }

  /** @returns {Array<{x: number, y: number, type: string}>} */
  firstTwoPointers() {
    const values = [...this.pointers.values()];
    return [values[0], values[1]];
  }

  releaseCapture(pointerId) {
    try {
      this.target.releasePointerCapture(pointerId);
    } catch {
      // Already released, or never captured. Nothing to do.
    }
  }

  /* ---------------------------------------------------------------- */
  /* Wheel                                                            */
  /* ---------------------------------------------------------------- */

  onWheel(e) {
    e.preventDefault();

    const local = this.toCanvasLocal(e.clientX, e.clientY);
    if (this.isOverUI(local.x, local.y)) return;

    // Wheel deltas arrive in three different units depending on the device and
    // browser. Normalising to approximate pixels first means one sensitivity
    // constant behaves the same on a mouse wheel, a trackpad, and a tilt wheel.
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 16; // lines
    else if (e.deltaMode === 2) delta *= 100; // pages

    this.pendingZoomFactor *= Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY);
    this.zoomAnchorX = local.x;
    this.zoomAnchorY = local.y;
  }

  /* ---------------------------------------------------------------- */
  /* UI regions                                                       */
  /* ---------------------------------------------------------------- */

  /**
   * Converts a viewport coordinate into a canvas relative one.
   *
   * Uses the bounding rectangle rather than `offsetX` and `offsetY`, because
   * those are unreliable for touch pointers across browsers, and because the
   * canvas may be inset by system UI on a phone or embedded in an iframe in
   * the Replit preview.
   *
   * @param {number} clientX
   * @param {number} clientY
   * @returns {{x: number, y: number}}
   */
  toCanvasLocal(clientX, clientY) {
    const rect = this.target.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  /**
   * @param {number} x canvas relative x in CSS pixels
   * @param {number} y canvas relative y in CSS pixels
   */
  isOverUI(x, y) {
    return this.uiRects.some(
      (r) => x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h
    );
  }

  /* ---------------------------------------------------------------- */
  /* Consumption                                                      */
  /* ---------------------------------------------------------------- */

  get dragging() {
    return this.mode === InputMode.DRAG;
  }

  get pinching() {
    return this.mode === InputMode.PINCH;
  }

  /**
   * Returns the movement accumulated since the last call and resets it.
   *
   * Consume rather than read, so a delta can never be applied twice, and so a
   * frame that happens to receive three pointermove events pans exactly as far
   * as a frame that receives one.
   *
   * @returns {{dx: number, dy: number}} movement in screen pixels
   */
  consumeDragDelta() {
    const delta = { dx: this.dragDX, dy: this.dragDY };
    this.dragDX = 0;
    this.dragDY = 0;
    return delta;
  }

  /**
   * Returns the zoom accumulated since the last call and resets it.
   * A factor of exactly 1 means no zoom occurred.
   *
   * @returns {{factor: number, anchorX: number, anchorY: number}}
   */
  consumeZoom() {
    const zoom = {
      factor: this.pendingZoomFactor,
      anchorX: this.zoomAnchorX,
      anchorY: this.zoomAnchorY,
    };
    this.pendingZoomFactor = 1;
    return zoom;
  }

  /**
   * Returns a completed UI tap, or null. Consuming clears it.
   * @returns {{x: number, y: number} | null}
   */
  consumeUITap() {
    const tap = this.pendingUITap;
    this.pendingUITap = null;
    return tap;
  }

  /** Wipes all held input state. Safe to call at any time. */
  clearAll() {
    this.keys.clear();
    this.pressedKeys.clear();

    for (const id of this.pointers.keys()) this.releaseCapture(id);
    this.pointers.clear();

    this.mode = InputMode.IDLE;
    this.activePointerId = null;
    this.dragDX = 0;
    this.dragDY = 0;
    this.pendingZoomFactor = 1;
    this.lastPinchDistance = 0;

    this.uiPressPointerId = null;
    this.pendingUITap = null;
  }
}

/** Keys whose browser default would interfere with the game. */
const PREVENT_DEFAULT_KEYS = new Set([
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "F3",
]);
