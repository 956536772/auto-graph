# brainstorm: canvas board third optimization

## Goal

Run a third optimization pass focused on canvas-board stability. The work must begin with browser testing of all existing tools, edge cases, tool switching, and combined workflows; then fix the bugs and UX friction found during testing instead of adding broad new drawing features.

## What I already know

* The user asked to start the third round of optimization.
* First-round task: `.trellis/tasks/05-14-canvas-drawing-refactor`.
* Second-round task: `.trellis/tasks/05-14-canvas-board-second-optimization`.
* The user has submitted the second-round implementation as commit `e0c8831 画板优化第二轮`.
* Current working tree still contains Trellis task/spec files and `.DS_Store` changes that should not be confused with third-round code changes.
* The user clarified that third-round optimization is mainly canvas stability: browser-test existing tools, edge cases, tool switching, combined-use scenarios, then improve UX and fix bugs.
* Current likely frontend impact areas remain:
  * `frontend/src/App.jsx`
  * `frontend/src/App.css`
  * `frontend/src/lib/DrawingEngine.js`
  * `frontend/src/lib/ShapeRegistry.js`
  * `frontend/src/lib/manualTools/ManualDrawingController.js`
  * `frontend/src/lib/manualTools/geometry.js`
  * `frontend/test/manualTools.test.js`
* Current spec guidance emphasizes functional helpers, JSXGraph board initialization conventions, draggable points, label editing, Ant Design-like colors, and manual verification of interactions.

## Assumptions (temporary)

* Second-round commit `e0c8831` is the implementation baseline.
* The third round should stay primarily frontend unless AI/manual serialization exposes a backend contract issue.
* The board should continue using JSXGraph and the current `DrawingEngine` / `ShapeRegistry` architecture.
* This round should prioritize reliability, consistency, bug fixes, and small UX improvements over adding new geometry primitives.

## Open Questions

* None.

## Requirements (evolving)

* Preserve first- and second-round manual drawing behavior.
* Browser-test every existing toolbar tool: Select, Point, Segment, Circle, Rectangle/Square, Triangle/Equilateral, Label, Angle, Midpoint, Parallel, Perpendicular, Angle Bisector, Undo, and Clear.
* Browser-test edge cases: tiny drags, repeated clicks, Esc cancellation, invalid repeated point selection, deleting selected objects, undo after delete, snap near dense geometry, and dragging shapes while board pan is enabled.
* Browser-test tool switching: partial operation to another tool, selected object to drawing tool, segment chain to other tools, constraint tools to Select, and menu open to other action.
* Browser-test combined workflows: create points and paths, add constraints, label points, create closed polygon chains, select/delete/undo, then continue drawing.
* Fix concrete bugs discovered during browser testing.
* Improve UX for confusing states with clearer status text, safer cancellation, and fewer accidental selections/deletions.
* Make object ownership behavior safer for delete, undo, closed polygons, auxiliary points, labels, and generated shapes.
* Keep the toolbar/status/chat layout usable after second-round toolbar changes.
* Add tests for pure helper and registry behavior where practical.
* Record manual browser verification findings and final pass/fail status for interactions that cannot be covered well in unit tests.

## Acceptance Criteria (evolving)

* [ ] Browser test matrix covers all existing tools.
* [ ] Browser test matrix covers edge cases, tool switching, and combined-use scenarios.
* [ ] Bugs discovered during browser testing are either fixed or explicitly documented as out of scope with rationale.
* [ ] `npm test` is green for the frontend package.
* [ ] Frontend lint and build are green.
* [ ] Selection, snap, drag, double-click menu, delete, undo, and Esc cancellation are manually verified in the browser.
* [ ] Tool switching never leaves stale preview objects, stale highlights, or broken pending undo groups.
* [ ] Combined workflows remain usable after bug fixes.
* [ ] Any UX copy or affordance changes reduce ambiguity in tested failure paths.

## Definition of Done (team quality bar)

* Tests added/updated where practical.
* Lint / typecheck / build green.
* Docs/notes updated if behavior changes.
* Rollout/rollback considered if risky.

## Out of Scope (explicit)

* Replacing JSXGraph.
* Rebuilding the entire canvas architecture.
* A full persistent construction-history editor.
* Multi-user collaboration.
* Full constraint solver.
* Large backend or LLM prompt rewrites.
* Adding new drawing tools.
* Broad visual redesign unrelated to tested stability failures.

## Technical Notes

* Initial task created at `.trellis/tasks/05-15-canvas-board-third-optimization`.
* Current active task was set with `task.py start 05-15-canvas-board-third-optimization`.
* Relevant frontend specs:
  * `.trellis/spec/frontend/index.md`
  * `.trellis/spec/frontend/component-guidelines.md`
  * `.trellis/spec/frontend/quality-guidelines.md`
  * `.trellis/spec/frontend/state-management.md`
* Current second-round PRD should be consulted before implementation: `.trellis/tasks/05-14-canvas-board-second-optimization/prd.md`.
* Test driver: browser verification of the local frontend app, supported by unit tests and build/lint checks.

## Decision (ADR-lite)

**Context**: The second round added many interaction features at once: snapping, previews, closed polygon affordances, selection highlighting, delete menu, and toolbar changes. The next highest-value work is to verify that these interactions are stable under real browser usage.

**Decision**: Third-round MVP is a browser-driven stability pass. Start with a comprehensive manual browser test matrix, fix the concrete issues found, then rerun the matrix and automated checks.

**Consequences**: New drawing features and large UI redesign are deferred. Small UX improvements are allowed only when they directly address a tested stability or usability issue.

## Browser Test Matrix

* Tool coverage: Select, Point, Segment, Circle, Rectangle/Square, Triangle/Equilateral, Label, Angle, Midpoint, Parallel, Perpendicular, Angle Bisector, Undo, Clear.
* Edge cases: tiny drag, repeated click, same point selected twice, Esc during each multi-step tool, delete while selected, undo after delete, snap near existing point/path, drag shape while pan is available.
* Tool switching: partial segment chain to Select/Point, drag tool to Select before mouseup, constraint tool mid-selection to another tool, delete menu open then tool switch.
* Combined workflows: points -> segments -> closed polygon -> select/delete/undo; points -> circle -> tangent-like path snapping if available; rectangle/triangle -> label vertices -> constraints; angle mark -> angle bisector -> undo.

## Browser Test Notes

* Local frontend launched with `npm run dev -- --host 127.0.0.1` and opened at `http://127.0.0.1:5174/`.
* Visual page load passed: board grid, two-column toolbar, status bar, chat panel, and all toolbar buttons rendered.
* Browser tooling limitation from the first pass: Playwright MCP was initially locked by an existing browser profile and the Chrome AppleScript JavaScript bridge failed in this environment; Computer Use could inspect and click toolbar controls but canvas-coordinate clicks were unreliable.
* Follow-up browser pass succeeded through Playwright MCP at `http://127.0.0.1:5174/` with coordinate interactions on the canvas.
* Verified workflows: manual circle -> use circle center as segment endpoint -> draw concentric circle from the same center; rectangle -> select/use generated edge as perpendicular reference; drag-created rectangle/triangle -> generated selectable edges and polygon area; closed segment chain -> midpoint -> angle marker -> angle bisector -> parallel line -> undo; partial segment -> switch to Select and confirm cancellation status.

## Findings And Fixes

* Finding: Double-click delete menu could open even while another drawing tool was active because `handleDoubleClick` did not check the current tool. Fix: only allow the object action menu in Select mode.
* Finding: Visible but unregistered auxiliary points, especially the manual circle center marker, could be picked by selection logic even though deletion could not resolve them through `ShapeRegistry`. Fix: selection now filters to registered editable objects.
* Finding: Snap priority could be unstable because a path hit could overwrite a previously found nearby point candidate. Fix: extracted snap prioritization so point snap targets stay ahead of path hits.
* Finding: Deleting a selected object restored highlight before removal, which risks mutating an object immediately before JSXGraph removal and can produce stale selection state. Fix: deletion now removes first, then clears selected state without restoring removed-object styling.
* Finding: The manual circle center marker is intentionally visible as `O` but should not behave like an independent editable point. Fix: center and hidden through point are fixed, non-highlight auxiliary controls.
* Finding: Circle centers were no longer usable as geometry references after selection was restricted to registry-backed objects. Fix: manual circle centers are now registered as real point objects, remain fixed/non-highlight, and can be reused for segments, constraints, and concentric circles while the hidden radius point stays auxiliary.
* Finding: Rectangle and triangle tools created only vertices plus a polygon area, unlike closed segment chains that also preserve selectable edges. Fix: drag-created polygons now create vertices, perimeter segments, and the polygon area in one undo batch, with `closedSegmentIds` linking edge deletion to area deletion.
* Finding: Switching tools during a pending segment/constraint could leave the previous status text visible until the next action. Fix: pending interaction cancellation now emits an explicit tool-switch status.

## Verification Results

* `npm test`: passed, 13 tests.
* `npm run lint`: passed.
* `npm run build`: passed. Build still reports existing JSXGraph dependency warnings for large bundle/direct eval.
* Added tests for registered-object selection filtering, point-over-path snap priority, circle center dependency removal, drag-created polygon edge parity, and pending tool-switch status text.

## Implementation Plan

* PR1: Run browser test matrix and record findings in this PRD.
* PR2: Fix high-confidence stability bugs in the manual controller, registry, drawing engine, or CSS.
* PR3: Add or update tests for pure helper/registry behavior behind the fixes.
* PR4: Rerun browser matrix plus `npm test`, lint, and build.
