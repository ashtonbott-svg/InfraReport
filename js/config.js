/**
 * config.js
 *
 * Single source of truth for tunable constants.
 *
 * Why this exists:
 * World size, cell size, colours, and input speeds are exactly the values that
 * get duplicated across simulation and rendering code. Centralising them
 * before that duplication happens is far cheaper than untangling it later.
 *
 * Rule: simulation constants and render constants are grouped separately.
 * Simulation code must never import a colour. Render code must never redefine
 * a dimension.
 */

/* ------------------------------------------------------------------ */
/* Simulation constants                                               */
/* ------------------------------------------------------------------ */

/**
 * Size of one grid cell in world units. One world unit is one pixel at zoom 1.
 *
 * 32 is chosen deliberately. A cell has to comfortably hold a car rendered as
 * a small rectangle with visible gaps in front and behind, because gaps are how
 * a player reads congestion at a glance. Smaller cells make queues unreadable.
 * Larger cells make interesting road networks require too much panning.
 */
export const CELL_SIZE = 32;

/**
 * World size in cells. Bounded, not infinite.
 *
 * The bound is a design decision, not a technical limitation. A traffic
 * engineer works within a fixed site and must solve congestion in place rather
 * than sprawling away from it. The edges also become natural entry and exit
 * points for external traffic demand later.
 */
export const WORLD_COLS = 96;
export const WORLD_ROWS = 96;

/** Fixed simulation step, in real seconds. 60 steps per real second. */
export const FIXED_STEP = 1 / 60;

/**
 * Maximum real time a single frame may catch up on. Time beyond this is
 * discarded so a backgrounded tab cannot freeze the page on return.
 */
export const MAX_FRAME_TIME = 0.25;

/* ------------------------------------------------------------------ */
/* Camera constants                                                   */
/* ------------------------------------------------------------------ */

/**
 * Zoom limits are expressed as how large a cell may appear on screen, then
 * converted into zoom multipliers.
 *
 * Why define them this way round:
 * The real requirements are "the site must not become visually useless when
 * zoomed out" and "cells must not become meaningless when zoomed in". Both of
 * those are statements about screen pixels per cell, not about an abstract
 * multiplier. Deriving the multiplier means that if CELL_SIZE ever changes,
 * the limits remain correct instead of silently becoming wrong.
 */
export const MIN_CELL_SCREEN_PX = 8;
export const MAX_CELL_SCREEN_PX = 128;

export const CAMERA_MIN_ZOOM = MIN_CELL_SCREEN_PX / CELL_SIZE; // 0.25
export const CAMERA_MAX_ZOOM = MAX_CELL_SCREEN_PX / CELL_SIZE; // 4
export const CAMERA_DEFAULT_ZOOM = 1;

/**
 * Keyboard pan speed, in SCREEN pixels per second.
 *
 * Deliberately expressed in screen space rather than world space. If pan speed
 * were a fixed number of world units, the map would rocket past at high zoom
 * and crawl at low zoom. Dividing by zoom at use time means the map always
 * appears to move at the same rate under the player's eye.
 */
export const CAMERA_PAN_SPEED = 900;

/**
 * Wheel zoom sensitivity, applied to normalised wheel delta.
 *
 * Zoom is applied multiplicatively through an exponential curve rather than by
 * adding a fixed amount. Additive zoom feels wrong at the extremes: the same
 * step is imperceptible when zoomed out and violent when zoomed in.
 */
export const WHEEL_ZOOM_SENSITIVITY = 0.0015;

/**
 * Keyboard zoom rate, as a zoom multiplier per second while a key is held.
 * 2.4 means roughly one and a quarter seconds to travel the full zoom range.
 */
export const KEY_ZOOM_RATE = 2.4;

/**
 * How far past the site edge the camera centre may travel, in cells.
 *
 * Not zero, because the player will work right at the boundary. Design Note
 * DN-1 puts external traffic gateways on the site edges, so cramping the view
 * there would fight the game's own layout.
 */
export const CAMERA_EDGE_MARGIN_CELLS = 6;

/**
 * Fraction of the viewport half extent that the edge margin may not exceed.
 * Guarantees a meaningful portion of the site stays on screen at any zoom.
 */
export const CAMERA_EDGE_MARGIN_VIEW_FRACTION = 0.45;

/* ------------------------------------------------------------------ */
/* Grid constants                                                     */
/* ------------------------------------------------------------------ */

/**
 * Grid visibility is driven entirely by how many screen pixels a cell occupies,
 * following Design Note DN-13. Zoom multipliers are the wrong unit for this
 * question: what actually decides whether a grid helps or hurts is whether the
 * player can distinguish and aim at an individual cell, and that is a statement
 * about apparent size.
 *
 * The curve has three regions, and each answers one of the milestone's stated
 * requirements:
 *
 *   below GRID_HIDE_BELOW_CELL_PX      invisible
 *     Lines closer together than roughly ten pixels stop reading as a grid and
 *     start reading as noise or moire. At that point they are actively harmful,
 *     so the grid disappears entirely rather than fading to something faint.
 *
 *   up to GRID_FULL_ABOVE_CELL_PX      ramping up to GRID_ALPHA_MAX
 *     The working range. The grid is clearly present because this is where the
 *     player will be placing and reading roads.
 *
 *   above GRID_SOFTEN_ABOVE_CELL_PX    easing back to GRID_ALPHA_ZOOMED_IN
 *     Zoomed right in, a full strength grid dominates the screen and competes
 *     with the things that matter, which will shortly be roads and vehicles.
 *     The grid steps back to being a quiet reference.
 */
export const GRID_HIDE_BELOW_CELL_PX = 10;
export const GRID_FULL_ABOVE_CELL_PX = 24;
export const GRID_SOFTEN_ABOVE_CELL_PX = 64;

export const GRID_ALPHA_MAX = 0.45;
export const GRID_ALPHA_ZOOMED_IN = 0.2;

/**
 * Target visual thickness of a grid line, in CSS pixels.
 *
 * The renderer converts this into a whole number of device pixels and snaps
 * the line to the device pixel boundary. Fractional device pixel positions are
 * what produce blurry grey smears instead of crisp lines, and on a 3x iPhone
 * display that difference is very visible.
 */
export const GRID_LINE_WIDTH_CSS_PX = 1;

/* ------------------------------------------------------------------ */
/* Render constants                                                   */
/* ------------------------------------------------------------------ */

export const COLORS = {
  /** Area outside the buildable site. Deliberately dead and uninviting. */
  void: "#12161a",

  /** The two alternating ground tints. The contrast is intentionally tiny. */
  groundA: "#3f6b39",
  groundB: "#436f3d",

  /** Site boundary line. The player should always know where the site ends. */
  boundary: "#7fae6b",

  /** Grid lines. Darker than the ground so they read as incisions in it. */
  grid: "#2c4f28",

  /** Debug overlay. */
  debugText: "#9fe870",
  debugPanel: "rgba(0, 0, 0, 0.55)",

  /** Control hint. Quiet on purpose, it must never compete with traffic. */
  hintText: "rgba(255, 255, 255, 0.55)",
  hintPanel: "rgba(0, 0, 0, 0.35)",

  /** Debug toggle button. */
  buttonPanel: "rgba(0, 0, 0, 0.45)",
  buttonPanelActive: "rgba(0, 0, 0, 0.7)",
  buttonText: "rgba(255, 255, 255, 0.75)",
};
