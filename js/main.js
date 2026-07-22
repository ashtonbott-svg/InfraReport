/**
 * main.js
 *
 * Entry point. Its only job is to find the canvas, construct the Game, and
 * start it. Keeping this file trivial means the game itself can be embedded,
 * tested, or driven by a different host later without changing any core code.
 */
import { Game } from "./core/Game.js";

const canvas = document.getElementById("game-canvas");
const game = new Game(canvas);

// Exposed for console poking during development, for example
// `game.clock.speed = 4` or `game.debug.toggle()`.
window.game = game;

game.start();
