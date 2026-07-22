# VISION.md

Living design document for **GRIDLOCK**. Updated at the end of every milestone.

> Working title changed from "Traffic Engineer" to **GRIDLOCK** at the end of Milestone 2. The old name survives nowhere in the codebase.

---

## 1. Overall vision

GRIDLOCK is a traffic engineering simulator, not a city builder.

The player is a professional traffic engineer. They are handed congestion problems and they solve them with infrastructure: road layouts, intersection geometry, signal timing, highways, and interchanges. Success is measured, not vibed. When the player rebuilds an intersection, they should be able to point at a number that got better.

Buildings, if they ever appear, exist only as traffic origins and destinations. They are inputs to the simulation, never the subject of gameplay.

**Roads are the main character.**

---

## 2. Core gameplay loop

1. Observe congestion somewhere in the network.
2. Diagnose it using engineering statistics on the affected road or intersection.
3. Redesign the infrastructure.
4. Watch traffic respond in real time.
5. Compare the statistics before and after.
6. Find the next bottleneck, which the fix probably just moved somewhere else.

Step 6 is the heart of the game. Solving congestion should reveal new congestion, the way it does in reality.

---

## 3. Project philosophy

- **Simulation over visuals, always.** If a choice exists between looking better and simulating better, simulation wins every time.
- **Extremely simple graphics, permanently.** Coloured rectangles, circles, and lines. No sprites, no textures, no polish passes.
- **Playable at every milestone.** Every milestone ends with something the player can run and interact with.
- **Tiny milestones.** Under one hour each. Stop and wait for approval after each one.
- **Question every feature.** If it does not improve road engineering gameplay, it probably does not belong.
- **Maintainability over cleverness.**
- **Constant feedback.** Every improvement the player makes must produce immediate visual and statistical response. The game should generate frequent "I fixed it" moments.
- **Reward understanding, not trial and error.** The simulation must be legible enough that a player who reasons correctly is rewarded faster than a player who guesses.
- **Mobile is a first class target.** The game is tested on iPhone every milestone. Touch is not a port, it is a supported input.

### Technical rules

- Object oriented JavaScript, ES modules.
- HTML5 Canvas only. No libraries, no frameworks, no build step.
- Simulation never touches the canvas. Rendering never mutates simulation state.
- UI is separate from both.
- Only `InputManager` may register input DOM listeners.
- Files stay under roughly 300 lines. Split when they grow.
- Comment the *why* of important systems, not the *what* of obvious lines.

### Packaging rules

- The distributed ZIP has `index.html` at its root, with no nested project folder.
- `.replit`, `replit.nix`, and `start.sh` ship at the root.
- `start.sh` binds `$PORT` with a fallback, on `0.0.0.0`.
- No framework, no bundler, no build step; Python's `http.server` is the whole server.
- Every package is verified before shipping: `GET /` returns 200, and the full module graph is walked over HTTP.

---

## 4. Current milestone

**Milestone 5 complete: grid rendering with zoom driven fade and device pixel snapping, plus a debug panel toggle on keyboard and an on screen button.**

Awaiting approval before starting Milestone 6 (pointer to cell conversion and hover highlight).

---

## 5. Roadmap progress

Original milestones 2 through 5 were merged into three, because a green background alone and a camera with no controls are not testable milestones.

### Phase 1: Skeleton — complete
- [x] 1. Canvas, fixed timestep loop, debug overlay
- [x] 2. Bounded world, camera transform, ground rendering, view culling
- [x] 3. InputManager, camera panning (keyboard, mouse, touch), clamping, control hint
- [x] 4. Camera zooming (wheel, keyboard, pinch), anchored, derived limits

### Phase 2: Grid
- [x] 5. Grid lines, zoom driven fade, device pixel snapping, debug panel toggle
- [ ] 6. Pointer to grid cell conversion, hover and touch highlight
- [ ] 7. Grid data structure
- [ ] 8. Tap or click a cell to toggle a debug marker

### Phase 3: Roads
- [ ] 9. Place a single road tile
- [ ] 10. Drag to place multiple road tiles
- [ ] 11. Road deletion
- [ ] 12. Road adjacency detection
- [ ] 13. Neighbour aware road rendering
- [ ] 14. Undo last action *(optional, trim candidate)*

### Phase 4: Road network data
- [ ] 15. Graph representation, nodes and edges
- [ ] 16. Automatic graph rebuild, debug overlay
- [ ] 17. Intersection detection
- [ ] 18. Intersection rendering

### Phase 5: Cars
- [ ] 19. Spawn and render a static car
- [ ] 20. Move one car along a straight segment
- [ ] 21. Car follows a hardcoded path with turns
- [ ] 22. Multiple cars on the same path

### Phase 6: Pathfinding
- [ ] 23. A* on the road graph, debug output only
- [ ] 24. Connect pathfinding to car movement
- [ ] 25. Trip generation

### Phase 7: Congestion
- [ ] 26. Car following, slow and stop behind other cars
- [ ] 27. Intersection queuing
- [ ] 28. Congestion visualisation

### Phase 8: Statistics
- [ ] 29. Per segment statistics collection
- [ ] 30. Statistics panel

**Anticipated insertion:** a dedicated mobile road drawing pass will likely be needed between milestones 10 and 11. Recorded as DN-10 rather than scheduled.

---

## 6. Out of scope

Intentionally excluded, and excluded permanently unless explicitly revisited:

- Sound and music
- Money, budgets, economy
- Zoning and land use management
- Weather
- Buildings as gameplay objects
- Graphics quality, art passes, sprites, lighting
- Terrain, elevation, land types
- City growth or population management
- Multiplayer
- Camera rotation *(M4: rotation would make road direction ambiguous and every overlay harder to read, for no engineering benefit)*

Excluded **for now**, may return once the core loop is proven:

- Buildings as pure traffic origins and destinations
- Traffic signals and signal timing
- Multi lane roads and highways
- Grade separated interchanges

---

## 7. Design Notes

Ideas discovered during development. Recorded rather than built, to preserve them without feature creep. Nothing here is committed.

**DN-1. External gateways at the site boundary.** *(M2)* Real traffic models represent the outside world as external zones: fixed points on the study area boundary where trips enter and leave. Because the world is bounded, edge cells can become traffic gateways. Better than spawning cars randomly on road tiles, because it produces directional corridors, natural through traffic, and rush hour patterns for free. It also makes the player's job legible: 800 vehicles per hour enter from the north gateway and must reach the east gateway, now make that work. `World.isEdgeCell()` exists in anticipation. Strongly favoured over random spawning for milestone 25.

**DN-2. Bounded site as the core constraint.** *(M2)* The site boundary is not a technical limit, it is the puzzle. An infinite world lets the player answer congestion by sprawling, which is the city builder answer. A fixed site forces them to answer with geometry, which is the engineering answer. Resist any future request to make the world expandable.

**DN-3. Before and after comparison mode.** Snapshot the network's statistics, make a change, see a diff. Directly rewards the core loop and manufactures the "I fixed it" moment on demand. Likely the single highest value feature after basic statistics exist.

**DN-4. Statistics that drive gameplay rather than inform it.** Candidates: contracts requiring a corridor be held at Level of Service C or better; complaints triggering when average delay crosses a threshold; scenario objectives phrased in engineering terms.

**DN-5. Induced demand.** Widening a road increases the traffic that uses it. Deeply thematic, genuinely funny, and a real engineering lesson. Punishes the naive "just add lanes" instinct most players arrive with, which is exactly the misunderstanding this game should correct.

**DN-6. Time of day demand curves.** Morning and evening peaks, so a layout must survive rush hour rather than average conditions. `Clock` already tracks hour of day specifically to enable this.

**DN-7. Deterministic replay.** The fixed timestep makes this possible, and camera motion was deliberately kept outside the fixed step to protect it. Would let a player run the identical rush hour against two different designs, turning DN-3 from approximate into rigorous. Requires a seeded random number generator, introduced before any randomness enters the simulation.

**DN-8. Simulation speed controls and pause.** Essential for diagnosis. Because camera motion runs on real frame time, the player can already pan and zoom around a paused simulation, which is what this feature depends on. Small effort, large payoff.

**DN-9. Scenario challenges.** A fixed site with a fixed problem and a target metric. Likely the best long term structure for the game, better than an open sandbox, because a stated objective is what turns a toy into a puzzle.

**DN-10. Touch road drawing needs its own design pass.** *(M3)* Dragging a finger to draw a road is not the same interaction as dragging a mouse, because the finger covers the cell being placed. Options: an offset cursor floating above the fingertip; a two step tap start then tap end for straight runs; a drag handle extending a road from its endpoint. The two step approach may be better on desktop too, since roads here are mostly straight runs between intersections. Prototype before committing to freehand dragging.

**DN-11. A pan gesture is a diagnosis gesture.** *(M3)* On a phone the player will spend most of their time travelling between a jam and the intersection causing it. That round trip is friction sitting directly in the core loop. Candidates: tap a congested segment to jump to the responsible intersection; a jam list that flies the camera to each problem; a pinned split view. Do not build until congestion exists.

**DN-12. Zoom level is a semantic level, not just a scale.** *(M4)* With a sixteen times zoom range, the same site reads completely differently at each end. Zoomed out is the network view: corridor flow, congestion heat, where the jams are. Zoomed in is the intersection view: queue lengths, turning movements, individual vehicles. Overlays should therefore switch by zoom rather than by a menu, which would make zoom itself the diagnostic tool. **Milestone 5 is the first working instance of this idea**, since the grid now appears and recedes based on whether it is currently useful. Reconsider seriously for congestion overlays at milestone 28.

**DN-13. Cell screen size is the real design unit.** *(M4, applied M5)* Deriving zoom limits and now grid opacity from how many screen pixels a cell occupies is a much better way to reason about the view than abstract multipliers, because every legibility question is really a question about that number. Reuse for vehicle rendering, label visibility, and any future overlay threshold.

**DN-14. A reset or fit-to-site control.** *(M4)* `CameraController.centerOnSite()` exists but nothing calls it. After zooming deep into an intersection there is no fast way back to the overview, and on a phone that is a lot of pinching. A double tap, a keyboard shortcut, or a small button would fix it. Cheap, and it directly serves DN-11. The UI tap plumbing added in M5 means this is now a very small job.

**DN-15. Major grid lines every N cells.** *(M5)* Deliberately not built, to avoid scope creep, but worth serious consideration. A heavier line every 8 cells would let the player judge block size and intersection spacing by eye, and block spacing is a genuine traffic engineering variable: too close and you get queue spillback between junctions, too far and you get excessive trip lengths. That makes a major grid a real engineering aid rather than decoration, which is a stronger argument than it first appears. Cheap to add: one extra threshold and one extra colour.

**DN-16. The grid is the first place the game teaches its own scale.** *(M5)* Now that cells are visible, the player can count them, and counting cells is how they will reason about road lengths and block sizes before any statistics exist. Worth remembering when choosing what a "cell" means in later engineering terms. If a cell is later given a real world dimension, say 8 metres, then every derived statistic gains real units and the game becomes far more legible to anyone with actual traffic knowledge. Decide this before vehicles have speeds.

---

## 8. Known bugs

None recorded.

---

## 9. Technical debt

| Item | Milestone | Notes |
|---|---|---|
| `DebugOverlay`, `HintOverlay`, and `DebugToggleButton` each draw their own panel and text | 1, 3, 5 | Three overlays now duplicate the same rounded panel and text pattern. This has crossed the threshold: extract a shared `Panel` helper next time UI is touched. |
| `Game.render()` hardcodes its renderer calls | 2 | Three renderers and three overlays now. A render layer list with explicit ordering is due before roads and vehicles arrive. |
| No seeded random number generator | 2 | Must exist before any randomness enters the simulation, or deterministic replay (DN-7) becomes impossible to retrofit. |
| Debug overlay state passed as an ad hoc object literal | 2 | Now seven fields. A small stats registry that systems push named values into would be cleaner. |
| `InputManager.uiRects` rebuilt every frame from overlay bounds | 3 | Cheap and correct, but UI must render before input can be blocked, a one frame lag on the very first frame only. |
| No pointer position tracking for hover | 3 | Milestone 6 needs it and will add it. |
| Third finger during a pinch is tracked but ignored | 4 | Correct and predictable. Noted so it is not mistaken for a leak. |
| `GridRenderer.alphaFor` hardcodes 128 as the top of the softening ramp | 5 | It should reference `MAX_CELL_SCREEN_PX`. Trivial, but it is exactly the kind of duplicated constant this project has been avoiding. |

---

## 10. Refactoring opportunities

- Extract a shared `Panel` drawing helper. Three call sites now; this is overdue.
- Introduce a render layer list on `Game`.
- Have `GridRenderer` import `MAX_CELL_SCREEN_PX` rather than repeating 128.
- Introduce a seeded RNG module before milestone 25.
- `CameraController` is at roughly 230 lines with pan, zoom, and clamp policy together. Split if it grows further.

---

## 11. Long term architecture notes

**Three strict layers.**

1. **Simulation** (`js/sim/`). Pure data and logic. World, Grid, RoadNetwork, Vehicle, TrafficStats. Knows nothing about pixels, canvas, or pointer events. Advanced only by `Game.update(dt)` on a fixed timestep.
2. **Rendering** (`js/render/`). Reads simulation state and draws it. Owns the camera transform. Never writes to simulation state.
3. **UI and input** (`js/ui/`). Translates player intent into state that other systems poll, and simulation state into readouts. Never manipulates simulation internals directly.

`js/core/` holds the plumbing that is none of the above: the loop, the canvas surface, the clock.

**Why the layering matters here specifically.** The stated long term goal is to keep the option of porting to Godot or Unity. A port is only realistic if the simulation layer is portable on its own. Every piece of canvas or DOM knowledge that leaks into simulation code is a piece of that port that has to be rewritten. The rule is not stylistic, it is the port strategy.

**The grid is a rendering concern, not a simulation one.** There is no grid object in `js/sim/`, and there should not be. `World` already owns cell size and site dimensions, and every grid line position derives from those. Adding grid state to the simulation would be state that nothing simulates. When milestone 7 introduces a grid *data structure*, that is a different thing: it holds what is in each cell, which is genuine simulation state, and it will live in `js/sim/` while the lines that visualise it stay here.

**Fixed timestep is load bearing.** Vehicles per hour, average delay, and Level of Service are all rates measured against game time. If the simulation stepped at variable rates those numbers would differ between machines, and the game's central promise, that measurement is trustworthy, would break. Simulation runs at exactly 60 steps per real second. Rendering runs at whatever the display allows.

**The camera is not simulation state.** Camera pan and zoom are applied in the frame loop on real elapsed time, deliberately outside the fixed step accumulator. Nothing a player does with their viewport can influence simulation results, protecting DN-7, and the player can still look around while the clock is paused, a prerequisite for DN-8.

**Game time is separate from real time.** `Clock` converts real seconds into game minutes with a player controllable speed multiplier. All statistics will be expressed in game time units.

**Three coordinate systems, defined once in `World`.**
- Cell coordinates: integer (col, row).
- World coordinates: floating point units, one unit equals one pixel at zoom 1.
- Screen coordinates: canvas pixels. `Camera` owns this conversion and is the only class permitted to perform it.

**Device pixels are a fourth, and only `Renderer` knows about them.** Canvas drawing happens in CSS pixels, but the display works in device pixels, and on a 3x iPhone one CSS pixel is three device pixels. A thin line at a fractional device pixel position spreads across two rows at partial opacity and reads as a grey smear. `Renderer.snap()` and `Renderer.deviceLineWidth()` exist so that any drawing code can produce crisp lines without every renderer re-deriving the same maths.

**Thin lines are filled rectangles, not strokes.** A stroke of width w is centred on its path, so it straddles the coordinate and needs a half pixel offset that itself depends on the device pixel ratio. A filled rectangle occupies exactly the pixels it is told to, which makes snapping exact and the reasoning obvious.

**Visibility thresholds are expressed in cell screen pixels.** Zoom limits and grid opacity are both derived from apparent cell size rather than from zoom, because every legibility question is really a question about apparent size. See DN-13.

**One input owner.** `InputManager` is the only class permitted to register keyboard, mouse, wheel, pointer, or touch listeners. Input bugs are state bugs, and one owner means exactly one place to reset state on focus loss, visibility change, or a cancelled gesture.

**Held state and pressed state are different questions.** Panning asks whether a key is down right now. A toggle asks whether a key went down, exactly once, regardless of how long it is held or how fast the OS repeats keydown. `InputManager` tracks both, because deriving the second from the first is where accidental double toggles come from.

**UI presses never enter the gesture system.** A press landing on a published UI rectangle is tracked in its own two fields and never joins the pointer map, so it cannot start a pan or a pinch. It is still followed to release, because otherwise on screen buttons would be impossible to tap, and a cancelled UI press is discarded rather than completed, because when the system takes a gesture away the player's intent is unknown.

**All gesture transitions funnel through one function.** `InputManager.refreshMode()` recomputes gesture mode from the set of tracked pointers and re-seeds whatever reference values the new mode needs. A mode machine with a single entry point cannot reach a state that no code path expected, which is precisely the failure that makes multi touch feel broken.

**Gestures are accumulated and consumed, not read.** Pan, zoom, key presses, and UI taps all accumulate in `InputManager` and are drained once per frame. A delta can therefore never be applied twice, and a frame receiving three pointer events moves exactly as far as a frame receiving one.

**Zoom is multiplicative and incremental, and anchoring is done the boring way.** Measure the world point under the anchor, change the zoom, measure again, shift the camera by the difference. The closed form alternative is where drift usually creeps in, and the boring version stays exactly correct when zoom is clamped at a limit. Verified at zero drift across sixty alternating zoom steps.

**Culling is the default, not an optimisation.** Every renderer that draws many objects asks `Camera.visibleBounds()` first, then clamps the resulting range to the site. Established at the ground layer in milestone 2 so it is already habit by the time hundreds of vehicles exist.

**The world is bounded, and that is permanent.** See DN-2.

**Grid now, graph later.** The grid is the authoring surface, what the player edits. The graph is the simulation surface, what vehicles traverse. Keeping these separate means road rendering rules and pathfinding rules can evolve independently, and leaves room for future road types that do not sit neatly on grid cells, such as diagonals or ramps.

**Mobile constraints are permanent constraints.** `touch-action: none` on the canvas is what makes touch panning possible at all. `pointercancel` handling is what keeps gestures from sticking. Non passive `wheel` handling stops trackpad pinch and ctrl plus wheel from zooming the page. Safari's legacy `gesturestart` family is claimed explicitly because it can drive page zoom independently of `touch-action`. On screen controls follow a 44 point minimum touch target. Any future interactive HTML UI layered over the canvas must declare its own touch behaviour rather than inheriting this.

---

## 12. File map

```
gridlock/                     (ZIP root: these files sit at the top level)
  index.html                  Canvas host page
  VISION.md                   This document
  .replit                     Replit run configuration
  replit.nix                  Python 3.11, the only dependency
  start.sh                    Static server on $PORT, bound to 0.0.0.0
  css/
    style.css                 Canvas fills viewport, touch gestures suppressed
  js/
    main.js                   Entry point, constructs and starts Game
    config.js                 All tunable constants, sim and render separated
    core/
      Game.js                 Root object, fixed timestep loop, UI dispatch
      Renderer.js             Canvas, pixel ratio, device pixel snapping
      Clock.js                Game time, speed multiplier
    sim/
      World.js                Site bounds, cell and world coordinate conversion
    render/
      Camera.js               World to screen transform, visible bounds
      CameraController.js     Pan and zoom policy, anchoring, clamping
      GroundRenderer.js       Site surface and boundary, view culled
      GridRenderer.js         Cell grid, zoom driven fade, view culled
    ui/
      InputManager.js         Sole owner of all input DOM listeners
      DebugOverlay.js         Frame timing, clock, camera, grid, input readout
      DebugToggleButton.js    On screen show and hide for the debug panel
      HintOverlay.js          Control hint, adapts to pointer type
```
