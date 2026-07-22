/**
 * HintOverlay
 *
 * A quiet line of text telling the player how to move the camera, phrased for
 * whichever input device they are actually using.
 *
 * Why bother:
 * Nothing on screen suggests that a green rectangle can be dragged or pinched.
 * A player who cannot move the camera concludes the game is broken within
 * about four seconds. One line of text costs nothing and removes that failure
 * entirely.
 *
 * Why it reads the pointer type rather than the user agent:
 * User agent sniffing is wrong constantly, iPads claim to be desktops, touch
 * laptops exist, and Replit's mobile preview is its own environment. Asking
 * what kind of pointer last touched the screen is simply the truth, and it
 * updates the moment a player switches device.
 *
 * This class reads input state and draws. It holds no simulation state and
 * never affects the simulation.
 */
import { COLORS } from "../config.js";

export class HintOverlay {
  constructor() {
    this.visible = true;

    /** Screen rectangle occupied by the hint, published for InputManager. */
    this.bounds = { x: 0, y: 0, w: 0, h: 0 };
  }

  toggle() {
    this.visible = !this.visible;
  }

  /**
   * @param {import("../ui/InputManager.js").InputManager} input
   * @returns {string}
   */
  textFor(input) {
    return input.pointerType === "mouse"
      ? "Pan: WASD / Arrows / Space-drag   Zoom: Wheel / + -"
      : "Drag to pan \u2022 Pinch to zoom";
  }

  /**
   * @param {import("../core/Renderer.js").Renderer} renderer
   * @param {import("../ui/InputManager.js").InputManager} input
   */
  draw(renderer, input) {
    if (!this.visible) {
      this.bounds = { x: 0, y: 0, w: 0, h: 0 };
      return;
    }

    const ctx = renderer.ctx;
    const text = this.textFor(input);

    ctx.font = "12px ui-monospace, Menlo, Consolas, monospace";
    ctx.textBaseline = "top";

    const paddingX = 10;
    const paddingY = 6;
    const textWidth = ctx.measureText(text).width;
    const w = textWidth + paddingX * 2;
    const h = 12 + paddingY * 2;

    // Bottom left, clear of the debug panel in the top left. Sits above the
    // iPhone home indicator so it is never half swallowed by the system UI.
    const x = 10;
    const y = renderer.height - h - 24;

    this.bounds = { x, y, w, h };

    ctx.fillStyle = COLORS.hintPanel;
    ctx.fillRect(x, y, w, h);

    ctx.fillStyle = COLORS.hintText;
    ctx.fillText(text, x + paddingX, y + paddingY);
  }
}
