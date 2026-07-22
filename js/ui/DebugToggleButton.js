/**
 * DebugToggleButton
 *
 * A small on screen button that shows and hides the debug panel.
 *
 * Why this exists:
 * The debug panel grew to eight lines and on a phone it covers a real slice of
 * the screen, both visually and as a region where gestures are ignored. That
 * was logged as technical debt in milestone 4. A keyboard shortcut solves it
 * on desktop and does nothing at all on a phone, which is where the problem
 * actually is.
 *
 * The button stays visible when the panel is hidden, otherwise there would be
 * no way to bring it back on a device with no keyboard.
 *
 * Sizing follows Apple's 44 point minimum touch target. Smaller looks tidier
 * and is genuinely harder to hit while holding a phone one handed.
 *
 * Like every overlay, it publishes its bounds so InputManager treats presses
 * on it as UI interaction rather than as the start of a pan. That is what
 * keeps the button from fighting the camera.
 */
import { COLORS } from "../config.js";

const WIDTH = 46;
const HEIGHT = 44;
const MARGIN = 10;

export class DebugToggleButton {
  constructor() {
    /** Screen rectangle occupied by the button, published for InputManager. */
    this.bounds = { x: 0, y: 0, w: 0, h: 0 };
  }

  /**
   * @param {number} x canvas relative x
   * @param {number} y canvas relative y
   * @returns {boolean} whether the point falls inside the button
   */
  hitTest(x, y) {
    const b = this.bounds;
    return x >= b.x && y >= b.y && x <= b.x + b.w && y <= b.y + b.h;
  }

  /**
   * @param {import("../core/Renderer.js").Renderer} renderer
   * @param {boolean} debugVisible whether the debug panel is currently shown
   */
  draw(renderer, debugVisible) {
    const ctx = renderer.ctx;

    // Top right. Deliberately opposite the debug panel so the button is never
    // underneath the thing it toggles, and clear of the iPhone home indicator.
    const x = renderer.width - WIDTH - MARGIN;
    const y = MARGIN;

    this.bounds = { x, y, w: WIDTH, h: HEIGHT };

    ctx.fillStyle = debugVisible
      ? COLORS.buttonPanelActive
      : COLORS.buttonPanel;
    ctx.fillRect(x, y, WIDTH, HEIGHT);

    ctx.fillStyle = COLORS.buttonText;
    ctx.font = "11px ui-monospace, Menlo, Consolas, monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";

    ctx.fillText("DBG", x + WIDTH / 2, y + HEIGHT / 2);

    // Text alignment is global context state, so it is restored rather than
    // left for the next drawing routine to be surprised by.
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
}
