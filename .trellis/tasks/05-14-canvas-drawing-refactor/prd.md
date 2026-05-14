# brainstorm: canvas drawing refactor

## Goal

Refactor the canvas drawing experience so basic geometry creation, selection, dragging, constraints, angle marking, and point labels feel coherent and usable for geometry editing.

## What I already know

* Circle drawing currently creates a circle that cannot be dragged afterward.
* After completing a shape, most drawing tools should automatically return to the Select tool.
* Rectangle and isosceles triangle drawing must be added; holding Shift constrains them to square and equilateral triangle respectively.
* More geometric constraints are needed, but the exact MVP set still needs convergence.
* Line drawing should support chained segments: after a segment is completed, the endpoint becomes the next segment start until Esc returns to Select.
* Angle marking needs a product design decision.
* Point labels are needed for names like point A and point B.
* The current frontend is React + Vite + JSXGraph, with most manual drawing logic in `frontend/src/App.jsx` and AI/DSL object creation in `frontend/src/lib/DrawingEngine.js`.
* Current manual tools are limited to Select, Point, Segment, Circle, Undo, and Clear.
* The current manual Circle tool records a drag rectangle and emits the existing `ellipse` instruction; when Shift makes it circular, `DrawingEngine` creates a fixed-radius circle around a hidden center point.
* A prior task `.trellis/tasks/05-12-fix-circle-drag-issue` already attempted to fix circle dragging by adding fill/interior hit targets, but this refactor should treat circle movement as a first-class control-point movement problem, not only as a hit-testing problem.
* Existing DSL supports `place_point`, `segment`, `midpoint`, `perpendicular`, `parallel`, `circle`, `ellipse`, `polygon`, `glider`, intersections, and tangent.
* Frontend specs expect functional helper patterns around JSXGraph, draggable points, visual consistency with the existing floating UI, and label double-click rename support.

## Assumptions (temporary)

* This task primarily affects the frontend canvas implementation under `frontend/src`.
* The implementation should preserve JSXGraph as the canvas engine unless code inspection shows a strong reason to change.
* Shape creation should keep existing interaction style and visual language where possible.
* New shape tools should reuse the existing instruction/registry path where practical, rather than creating a separate ad hoc object model only for manual tools.

## Open Questions

* None.

## Requirements (evolving)

* Existing circles must be selectable and draggable after creation.
* Shape creation tools except chained line mode should return to Select after completing a shape.
* Add rectangle drawing with Shift-constrained square mode.
* Add isosceles triangle drawing with Shift-constrained equilateral triangle mode.
* Add chained line segment drawing; Esc exits to Select.
* Add an angle-marking feature with a concrete interaction model.
* Add point labels for geometry points such as A and B.
* Keep AI/DSL and manual drawing compatible enough that manually created objects still serialize into AI context.
* MVP constraint tools include parallel, perpendicular, midpoint, and angle bisector; a full arbitrary constraint relation system is out of scope for this task.
* Angle marking uses a three-point interaction: click one side point, the vertex, then the other side point; for example `A -> B -> C` marks `∠ABC`.
* Angle bisector should reuse the same three-point angle selection model where practical.

## Acceptance Criteria (evolving)

* [ ] A circle can be created, selected, and moved without losing its circle geometry.
* [ ] Drawing a circle, rectangle, or triangle completes the shape and switches the active tool to Select.
* [ ] Holding Shift while drawing a rectangle creates a square.
* [ ] Holding Shift while drawing an isosceles triangle creates an equilateral triangle.
* [ ] Line tool continues from the previous endpoint after each completed segment.
* [ ] Pressing Esc during line chaining returns to Select.
* [ ] Users can create visible angle marks for selected points or segments.
* [ ] Users can add or edit labels for points.
* [ ] Existing AI drawing instructions still execute after the canvas interaction refactor.
* [ ] Angle marking by clicking `A -> B -> C` creates a visible marker for `∠ABC`.

## Definition of Done (team quality bar)

* Tests added/updated where practical for geometry helper behavior.
* Lint / typecheck / build green.
* Docs/notes updated if behavior changes.
* Rollout/rollback considered if risky.

## Out of Scope (explicit)

* Replacing JSXGraph unless current code inspection proves it is necessary.
* Backend changes unless repo inspection reveals current geometry persistence depends on backend support.
* A full constraint relation editor where users select arbitrary existing objects and attach persistent editable constraints beyond the MVP tools.

## Technical Notes

* Initial task created at `.trellis/tasks/05-14-canvas-drawing-refactor`.
* Frontend specs require functional helper patterns around JSXGraph board creation and note that points should generally be draggable.
* Code inspected: `frontend/src/App.jsx`, `frontend/src/lib/DrawingEngine.js`, `frontend/src/lib/ShapeRegistry.js`, `frontend/src/App.css`, `frontend/package.json`, `.trellis/spec/frontend/*`.
* Current interaction state is `drawState` in `App.jsx`; it tracks `point1Id`, drag starts, ghost shapes, ghost points, and temp auxiliary points.
* Candidate refactor: extract drawing tool behavior into small helper functions or a tool-controller module so adding rectangle, triangle, angle mark, label, and line chaining does not further enlarge `App.jsx`.

## Research Notes

### Constraints from current repo/project

* JSXGraph already provides constrained geometry primitives such as midpoint, perpendicular, parallel, glider, circle, ellipse, polygon, and angle-like rendering primitives should be evaluated during implementation.
* Current project has no TypeScript; helper naming and manual validation matter.
* Current quality gate is primarily lint/build plus manual browser interaction verification.

### Feasible approaches here

**Approach A: Tool-controller refactor with JSXGraph-native primitives** (Recommended)

* How it works: keep JSXGraph and `ShapeRegistry`, move manual drawing state/geometry helpers out of `App.jsx`, and add each tool as a focused controller that emits normal `DrawingEngine` instructions or shared helper calls.
* Pros: low migration risk, keeps AI DSL compatible, makes new tools testable enough through pure geometry helpers.
* Cons: still relies on JSXGraph object semantics and some manual browser verification.

**Approach B: Minimal patch inside `App.jsx`**

* How it works: add rectangle, triangle, chained line, label, and angle behaviors directly into the current event handlers.
* Pros: fastest first patch.
* Cons: `App.jsx` will become harder to maintain; angle/constraint interactions will be fragile.

**Approach C: New internal canvas object model over JSXGraph**

* How it works: define our own shape records, selection model, constraints, and render-sync layer to JSXGraph.
* Pros: best long-term control over selection, dragging, labels, and constraints.
* Cons: too large for this MVP and risks breaking existing AI DSL behavior.

## Decision (ADR-lite)

**Context**: The requested canvas refactor includes both immediate drawing UX fixes and new geometry capabilities. A complete constraint relation system would increase scope and implementation risk.

**Decision**: Use the practical MVP scope: fix circle dragging, auto-return to Select for completed non-line tools, add rectangle/square, isosceles/equilateral triangle, chained segment drawing, point labels, angle marking, and a focused constraint tool set of parallel, perpendicular, midpoint, and angle bisector.

**Consequences**: The first implementation stays focused on visible user value and keeps AI/manual drawing compatibility. More advanced persistent constraint editing remains a later task.

## Decision (ADR-lite): Angle Marking Interaction

**Context**: Angle marking can be based on either selecting three points or selecting two intersecting lines. Two-line selection is faster in simple cases but becomes ambiguous when multiple angles share an intersection.

**Decision**: Use three-point angle marking for MVP. Users click a point on one ray, then the vertex, then a point on the other ray. This directly maps to mathematical notation like `∠ABC`.

**Consequences**: The interaction is explicit, robust, and reusable for angle bisectors. It requires users to click three points, but avoids ambiguity and keeps the implementation deterministic.

## Technical Approach

Use a tool-controller refactor on top of JSXGraph-native primitives. Keep `DrawingEngine` and `ShapeRegistry` as the shared object creation and serialization path, but extract manual drawing behavior from the large `App.jsx` board-event handler into smaller geometry/tool helpers. Add reusable point-picking and drag-preview flows for shape tools, constraint tools, labels, and three-point angle interactions.

## Implementation Plan (small PRs)

* PR1: Refactor manual drawing state into tool-controller/helper modules without changing user-visible behavior; preserve existing point, segment, circle, undo, clear, AI DSL execution, and serialization.
* PR2: Fix circle/ellipse dragging semantically by representing movable auxiliary controls correctly; add auto-return-to-Select behavior for completed non-line tools.
* PR3: Add rectangle/square and isosceles/equilateral triangle tools with drag previews and Shift constraints.
* PR4: Add chained segment drawing with endpoint carry-over and Esc-to-Select handling.
* PR5: Add point label tool/editing, three-point angle marking, and angle bisector using the shared point-selection flow.
* PR6: Add focused constraint tools for parallel, perpendicular, and midpoint; run lint/build and complete manual browser verification.
