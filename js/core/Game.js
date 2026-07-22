/**
 * Game
 *
 * The root object. Owns the loop, the simulation world, the camera, the
 * renderers, and the UI, and is the single place where those layers meet.
 *
 * Loop design: fixed timestep with an accumulator.
 *
 * Why fixed timestep rather than "update with whatever dt the browser gave us":
 * Traffic simulation is a stack of interacting rules, car following distance,
 * intersection queuing, signal timing. Those behave differently at different
 * step sizes, so a variable timestep would mean the same road layout produces
 * different congestion on a 60Hz laptop and a 120Hz phone. That would make the
 * engineering statistics, which are the entire point of this game,
 * untrustworthy. A fixed step guarantees identical simulation results on every
 * machine. Rendering still runs as fast as the browser allows.
 *
 * Camera movement runs OUTSIDE the fixed step, on real frame time. The camera
 * is not simulation state, and nothing a player does with their viewport may
 * influence the simulation. It stays frame rate independent by multiplying
 * velocity by real elapsed seconds.
 */
import { Renderer } from "./Renderer.js";
import { Clock } from "./Clock.js";
import { World } from "../sim/World.js";
import { Camera } from "../render/Camera.js";
import { CameraController } from "../render/CameraController.js";
import { GroundRenderer } from "../render/GroundRenderer.js";
import { GridRenderer } from "../render/GridRenderer.js";
import { InputManager } from "../ui/InputManager.js";
import { DebugOverlay } from "../ui/DebugOverlay.js";
import { DebugToggleButton } from "../ui/DebugToggleButton.js";
import { HintOverlay } from "../ui/HintOverlay.js";
import { FIXED_STEP, MAX_FRAME_TIME } from "../config.js";

/** Keys that toggle the debug panel. Backtick, or F3 for muscle memory. */
const DEBUG_TOGGLE_KEYS = ["Backquote", "F3"];

export class Game {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    /* Simulation layer. Knows nothing about pixels. */
    this.world = new World();
    this.clock = new Clock();

    /* Render layer. Reads simulation state, never writes it. */
    this.renderer = new Renderer(canvas);
    this.camera = new Camera(this.world.centerX, this.world.centerY);
    this.groundRenderer = new GroundRenderer(this.world);
    this.gridRenderer = new GridRenderer(this.world);

    /* UI and input layer. */
    this.input = new InputManager(canvas);
    this.debug = new DebugOverlay();
    this.debugButton = new DebugToggleButton();
    this.hint = new HintOverlay();

    /* Connects input state to the camera. Owns pan and zoom policy. */
    this.cameraController = new CameraController(
      this.camera,
      this.world,
      this.input
    );

    /** Timestamp of the previous animation frame, in milliseconds. */
    this.lastTime = 0;

    /** Leftover real time not yet consumed by fixed simulation steps. */
    this.accumulator = 0;

    /** Whether the loop is currently running. */
    this.running = false;

    // Bound once so requestAnimationFrame keeps a stable reference and
    // `this` stays correct.
    this.frame = this.frame.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
  }

  /**
   * One animation frame.
   * @param {number} now high resolution timestamp from requestAnimationFrame
   */
  frame(now) {
    if (!this.running) return;

    let frameTime = (now - this.lastTime) / 1000;
    this.lastTime = now;

    if (frameTime > MAX_FRAME_TIME) frameTime = MAX_FRAME_TIME;

    // The camera must know the current viewport before anything reads its
    // transform, otherwise a window resize or an iPhone rotation would leave
    // it converting and clamping against stale dimensions.
    this.camera.setViewport(this.renderer.width, this.renderer.height);

    // Discrete UI actions, drained once per frame so a key press or a tap can
    // never be handled twice.
    this.handleUI();

    // View movement, on real time, outside the simulation step.
    this.cameraController.update(frameTime);

    // Simulation, in fixed steps.
    this.accumulator += frameTime;
    let steps = 0;
    while (this.accumulator >= FIXED_STEP) {
      this.update(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
      steps++;
    }

    this.debug.sample(frameTime, steps);
    this.render();

    requestAnimationFrame(this.frame);
  }

  /**
   * Handles discrete, one shot UI input: key presses and taps on panels.
   *
   * Kept apart from continuous input like panning because the two need
   * different semantics. Panning asks whether a key is held right now. A
   * toggle asks whether a key went down, exactly once, regardless of how long
   * it is held or how fast the operating system repeats it.
   */
  handleUI() {
    const pressed = this.input.consumePressedKeys();
    for (const key of DEBUG_TOGGLE_KEYS) {
      if (pressed.has(key)) {
        this.debug.toggle();
        break;
      }
    }

    const tap = this.input.consumeUITap();
    if (tap && this.debugButton.hitTest(tap.x, tap.y)) {
      this.debug.toggle();
    }
  }

  /**
   * Advances simulation state by exactly one fixed step.
   * No canvas calls are ever allowed in here.
   * @param {number} dt fixed timestep in real seconds
   */
  update(dt) {
    this.clock.advance(dt);
    // Future systems step here: grid changes, road network, vehicles, stats.
  }

  /**
   * Draws the current state. No simulation state is ever mutated in here.
   */
  render() {
    const cellsDrawn = this.groundRenderer.draw(this.renderer, this.camera);
    const gridLines = this.gridRenderer.draw(this.renderer, this.camera);

    this.debug.draw(this.renderer, {
      clock: this.clock,
      camera: this.camera,
      input: this.input,
      cellsDrawn,
      totalCells: this.world.cols * this.world.rows,
      gridLines,
      gridAlpha: this.gridRenderer.alpha,
    });

    this.debugButton.draw(this.renderer, this.debug.visible);
    this.hint.draw(this.renderer, this.input);

    // Overlays publish the screen space they occupy so that a press on top of
    // them is treated as UI rather than as the start of a pan. Refreshed every
    // frame because panel size depends on content and on viewport size, and a
    // hidden panel publishes an empty rectangle so it blocks nothing.
    this.input.uiRects = [
      this.debug.bounds,
      this.debugButton.bounds,
      this.hint.bounds,
    ];
  }
}
