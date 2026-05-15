# brainstorm: canvas board second optimization

## Goal

Run a second optimization pass on the geometry canvas after the first drawing-tool refactor. The goal is to fix concrete interaction bugs and improve day-to-day drawing ergonomics around movement, preview, closed shapes, deletion, snapping, and toolbar layout without redoing the first-round architecture.

## What I already know

* The user asked to create a new task for the second round of canvas optimization.
* A first-round task already exists at `.trellis/tasks/05-14-canvas-drawing-refactor`.
* The first-round PRD covered circle dragging, auto-return-to-select, rectangle/square, isosceles/equilateral triangle, chained segments, point labels, angle marking, and focused constraint tools.
* Current frontend code is React + Vite + JSXGraph.
* `frontend/src/App.jsx` now delegates manual drawing behavior to `frontend/src/lib/manualTools/ManualDrawingController.js`.
* Manual tool constants live in `frontend/src/lib/manualTools/constants.js`.
* Geometry helper logic lives in `frontend/src/lib/manualTools/geometry.js` and has tests in `frontend/test/manualTools.test.js`.
* Current toolbar includes Select, Point, Segment, Circle, Rectangle, Triangle, Label, Angle, Midpoint, Parallel, Perpendicular, Angle Bisector, Undo, and Clear.
* `DrawingEngine` remains the shared execution layer for AI/DSL and manual tool creation.
* `ShapeRegistry.serialize()` provides board context back to the AI chat flow.
* The user provided six concrete second-round ideas:
  * Fix the bug where ellipses cannot move and dragging them pans the whole board.
  * Add live preview while drawing line segments.
  * If segment drawing directly closes a shape, treat the closed shape as one whole object.
  * Add delete support: double-click should open a dropdown/context menu with a delete action for the selected geometry object.
  * Add snapping so point/line/segment selection can snap directly to nearby candidates.
  * Split the toolbar into two columns so it is not covered by the upper-left message/chat panel.
* Follow-up scope change: remove manual ellipse drawing entirely; the circle tool should only create circles.
* Follow-up scope change: manually drawn circles must show their center, and the center label is fixed as `O`.
* Code inspection confirms `ManualDrawingController.createSegmentPreview()` currently intentionally omits segment preview.
* Code inspection confirms board pan is enabled in Select mode, which likely contributes to ellipse dragging being interpreted as canvas movement.
* Code inspection confirms toolbar layout is currently controlled by `frontend/src/App.css` around `#toolbar` and `.tool-group`.

## Assumptions (temporary)

* This task should build on the current controller/helper structure rather than moving back into a monolithic `App.jsx`.
* The second round should prioritize the six concrete user requirements over broad visual redesign.
* The main package impact is frontend; backend changes should be avoided unless serialization or AI context needs a contract update.
* JSXGraph remains the canvas engine.
* Closed-shape detection should initially target polygon closure from chained segment drawing, not arbitrary geometric cycles across unrelated existing segments.
* Snapping should initially be an interaction helper for click/drag selection and placement, not a full persistent constraint solver.

## Open Questions

* None.

## Requirements (evolving)

* Preserve all first-round manual drawing capabilities.
* Improve tool feedback so multi-step tools make the current step and next action obvious.
* Improve selection/editing ergonomics for existing points, lines, polygons, circles, labels, and angle markers.
* Identify and fix reliability gaps around undo grouping, cancelled operations, hidden auxiliary points, and object removal.
* Keep manually created objects serializable enough for AI follow-up commands.
* Add or update tests for pure geometry/helper behavior where practical.
* Maintain compatibility with the existing floating toolbar/status/chat layout.
* Remove the manual ellipse drawing path and keep the circle tool limited to circles.
* Manually drawn circles must render a visible center point labeled `O`.
* Preserve legacy/AI ellipse execution compatibility unless a separate backend/DSL scope removes it.
* Add live segment preview from the current segment start point to the mouse/snap target during chained segment drawing.
* Detect when chained segment drawing closes back to the start point and promote the closed chain into a whole shape.
* Closed segment chains must preserve their individual segment objects and additionally create a whole polygon object for group selection, deletion, and serialization.
* Add delete affordance through a double-click dropdown/context menu on geometry objects.
* Delete must clean up the selected user-visible shape and its owned auxiliary objects without corrupting unrelated referenced objects.
* Add snapping for point placement and point/path selection, especially near existing points, lines, and segments.
* Rework toolbar layout into two columns or two visual lanes so it does not conflict with the upper-left message/chat area.
* Add selected-object highlighting for the current geometry target. This supports double-click delete, closed-shape selection, and clearer snap/selection feedback.
* Selected-object highlighting must remain single-object only for this MVP.

## Acceptance Criteria (evolving)

* [ ] First-round tools still work after the second optimization pass.
* [ ] Multi-step tools expose clear step-by-step status text and recover cleanly on Esc/cancel.
* [ ] Undo removes complete user-visible operations, including auxiliary points, without leaving broken hidden objects.
* [ ] Selection/editing interactions are documented in the PRD before implementation.
* [ ] AI board context remains accurate for manually created objects that are relevant to follow-up commands.
* [ ] `npm test`, lint, and build are green for the frontend package after implementation.
* [ ] Manual browser verification covers at least point, segment chain, circle, rectangle/square, triangle/equilateral, label, angle, and one constraint tool.
* [ ] The circle tool creates only circles and no manual non-circular ellipse.
* [ ] The circle tool marks the circle center with fixed label `O`.
* [ ] Segment tool shows a preview segment before the next endpoint is committed.
* [ ] A chained segment path that closes onto its starting point preserves the individual edge segments and additionally creates a selectable/deletable whole polygon.
* [ ] Double-clicking a geometry object opens a small menu/dropdown with Delete.
* [ ] Deleting a shape removes the intended object and owned auxiliaries, and undo/history remains coherent.
* [ ] Point selection/placement can snap to nearby existing points and can attach to nearby line/segment/circle/ellipse paths where appropriate.
* [ ] Toolbar renders in two columns/lanes and no longer overlaps the upper-left message/chat panel at desktop size.
* [ ] Clicking or double-clicking a geometry object can show a visible selected/highlighted state before or while delete actions are offered.
* [ ] Highlighting is cleared when the user changes tools, deletes the object, or cancels the current operation.

## Definition of Done (team quality bar)

* Tests added/updated where practical for geometry/helper behavior.
* Lint / typecheck / build green.
* Docs/notes updated if behavior changes.
* Rollout/rollback considered if risky.

## Out of Scope (explicit)

* Replacing JSXGraph.
* Rebuilding the entire drawing controller from scratch.
* Large backend or LLM prompt rewrites unless a frontend serialization bug makes them necessary.
* Full persistent construction history editing.
* Full constraint solver or arbitrary relation editor.
* Arbitrary cycle detection across the whole graph of existing segments.
* Multi-object selection and bulk delete.
* Full object inspector panel.
* Export/import of geometry construction history.
* Keyboard shortcut system beyond MVP-critical Esc behavior unless explicitly pulled into scope.
* Delete keyboard shortcut.

## Technical Notes

* Initial task created at `.trellis/tasks/05-14-canvas-board-second-optimization`.
* Code inspected: `frontend/src/App.jsx`, `frontend/src/lib/manualTools/ManualDrawingController.js`, `frontend/src/lib/manualTools/geometry.js`, `frontend/src/lib/manualTools/constants.js`, `frontend/src/lib/DrawingEngine.js`, `frontend/src/lib/ShapeRegistry.js`, `frontend/test/manualTools.test.js`.
* First-round task inspected: `.trellis/tasks/05-14-canvas-drawing-refactor/prd.md`.
* Current risk areas to validate in second round:
  * Preview lifecycle for drag tools and chained segment mode.
  * Undo batching when tools create provisional points plus final shapes.
  * Hidden auxiliary point cleanup for circles, ellipses, previews, and constraints.
  * Serialization details for angle, polygon, circle/ellipse, and auxiliary-object-backed shapes.
  * Usability of selecting existing points versus accidentally creating new points.
* Current code-specific findings:
  * `frontend/src/lib/manualTools/ManualDrawingController.js#createSegmentPreview` intentionally has no preview object today.
  * `frontend/src/lib/DrawingEngine.js#attachTranslationDrag` implements custom movement for auxiliary-point-backed circle/ellipse shapes.
  * `frontend/src/App.jsx` enables board `pan` and `browsing` in Select mode.
  * `frontend/src/App.css` currently positions the toolbar as a single fixed vertical strip near the upper-left.

## Candidate Directions

### Direction A: Interaction Reliability Pass

Focus on cancellation, undo, hidden-object cleanup, pointer hit testing, status prompts, and manual verification coverage.

Pros: directly reduces user-visible bugs after the first refactor; low architectural risk.
Cons: less visually dramatic than UI polish.

### Direction B: Editing Ergonomics Pass

Add better edit affordances such as selected-object highlighting, delete selected object, rename/label discoverability, and maybe lightweight object inspector behavior.

Pros: makes the board feel more like an editor instead of a creation-only tool.
Cons: may require more careful object ownership and deletion semantics.

### Direction C: Visual Polish Pass

Improve toolbar grouping, active tool hints, cursor states, preview styling, mobile layout, and status presentation.

Pros: visible UX improvement.
Cons: can hide deeper interaction bugs if done before reliability cleanup.

## Expansion Sweep

### Future evolution

* The canvas can evolve from creation-only tools toward a lightweight geometry editor with selected-object state, delete/rename actions, object inspector, and construction history.
* Snapping can later become a configurable layer with visible snap candidates, snap radius settings, and persistent constraints, but this task keeps it as an interaction helper.

### Related scenarios

* Delete behavior should stay consistent with Undo and Clear: user-visible actions should remove coherent objects without leaving hidden auxiliary objects behind.
* Closed-shape grouping should stay compatible with AI context serialization so follow-up prompts can refer to both individual edges and the whole polygon.
* Single-object highlight should be reusable by snapping and delete affordances, but should not become a full selection model in this task.

### Failure and edge cases

* Double-click delete must not accidentally delete unrelated referenced points or segments that other constructions depend on.
* Snapping must not make point creation impossible in dense drawings; users still need a way to place a new free point near existing geometry.

## Decision (ADR-lite)

**Context**: The user provided a concrete second-round optimization list after the first drawing-tool refactor. The list mixes bug fixes, editing ergonomics, geometry behavior, snapping, and layout.

**Decision**: Treat the six user-provided items as the MVP scope for this task. Implement in this order unless inspection reveals a dependency: ellipse drag bug, segment preview, snapping helper, closed-chain shape grouping, delete context menu, toolbar two-column layout.

**Consequences**: The task is no longer a broad reliability pass. It is a focused frontend interaction pass. Backend and full constraint solving remain out of scope.

## Decision (ADR-lite): Selected-object Highlight

**Context**: Delete and whole-shape selection need visible feedback. The user chose to include selected-object highlighting as the one extra consistency enhancement beyond the original six items.

**Decision**: Add single-object highlighting to the MVP. Highlighting is used for the current target during select/delete interactions and may also clarify snap or selection feedback.

**Consequences**: The implementation needs a small selected-object state and style restoration path. Multi-select, keyboard Delete, and a full inspector panel remain out of scope.

## Decision (ADR-lite): Closed Segment Shape Ownership

**Context**: When chained segment drawing closes back to the start point, the resulting figure should behave as a whole shape, but the individual edges may still be useful for later geometric construction.

**Decision**: Preserve each individual segment and additionally create a polygon object for the closed shape. The polygon is the whole-object affordance for selection, deletion, and serialization.

**Consequences**: Deletion needs ownership rules so deleting the whole polygon can remove the polygon affordance without accidentally corrupting edge segments unless the delete action explicitly targets the whole closed-chain group. The implementation should keep the edge objects available for snapping and geometry tools.

## Implementation Plan (draft)

* PR1: Fix ellipse drag versus board pan conflict and add regression-oriented manual verification notes.
* PR2: Restore a stable live segment preview for chained segment drawing.
* PR3: Add snapping helper APIs for nearest visible point/path detection and use them in point/segment selection flows.
* PR4: Detect closed segment chains and create/select/delete them as whole shapes while preserving useful edge behavior.
* PR5: Add single-object highlight plus double-click object menu with Delete and robust owned-object cleanup.
* PR6: Rework toolbar into two columns/lanes and verify it avoids the upper-left message/chat panel.
