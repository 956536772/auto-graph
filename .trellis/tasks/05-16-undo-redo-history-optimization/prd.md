# brainstorm: undo redo history optimization

## Goal

Improve the geometry canvas history behavior so users can step backward and forward through meaningful editing actions. The current undo behavior only removes the last created shape group, which is insufficient once the canvas supports deletion, labels, dragging, generated compound shapes, and AI-created instruction batches.

## What I already know

* The user wants to optimize the current undo/backward rollback behavior and add forward rollback behavior.
* Current UI exposes a `TOOLS.UNDO` button in `frontend/src/App.jsx`; there is no redo tool.
* `ShapeRegistry` owns the current creation-order `history`, `undoStack`, and batch helpers.
* Current `undo(board)` pops created object ids from `undoStack`, removes those JSXGraph objects from the board, and deletes ids from registry history.
* Composite creation already relies on undo batching and merging through `beginUndoBatch`, `endUndoBatch`, and `mergeLastUndoEntries`.
* Manual interaction logic lives mainly in `frontend/src/lib/manualTools/ManualDrawingController.js`.
* Deleting an object currently calls `ShapeRegistry.removeObject()`, which removes owned/dependent ids and cleans stale ids out of the undo stack, but does not create an undoable delete action.
* Label editing happens through `openPointLabelEditor()` and `setPointLabel()` in `frontend/src/lib/manualTools/labels.js`; it is not currently recorded as history.
* Shape dragging/moving is possible for several JSXGraph objects, but movement is not currently recorded as history.
* Tests already cover basic registry undo batching, merged provisional groups, and delete cleanup in `frontend/test/manualTools.test.js`.

## Assumptions (temporary)

* The MVP should stay frontend-only unless implementation reveals a backend contract issue.
* Undo/redo should operate on user-visible actions, not internal single JSXGraph object creation steps.

## Open Questions

* None.

## Requirements (evolving)

* Add a forward rollback / redo operation to the canvas history UI.
* Implement full meaningful action history for creation, deletion, label editing, and movement.
* Keep existing undo batching semantics for compound creations such as circles, rectangles, triangles, closed segment chains, and AI instruction batches.
* Avoid leaving orphaned hidden points, stale registry ids, or broken dependent geometry after undo/redo.
* Reset or invalidate redo history when the user performs a new action after undo.
* Treat each completed drag gesture as one movement history action, not every mousemove frame.
* Treat each confirmed label edit as one label history action.

## Acceptance Criteria (evolving)

* [ ] Toolbar exposes both undo and redo actions with clear Chinese labels/status messages.
* [ ] Undo followed by redo restores a complete compound creation as one user-visible action.
* [ ] Deleting an object can be undone and redone without breaking dependents or ownership cleanup.
* [ ] Editing a point label can be undone and redone.
* [ ] Moving a draggable point or compound draggable shape can be undone and redone as one gesture.
* [ ] Performing a new creation after undo clears redo history.
* [ ] Existing delete and dependency cleanup tests continue to pass.
* [ ] Unit tests cover undo/redo stack behavior for the chosen MVP scope.
* [ ] Browser verification covers mixed workflows across manual creation, AI-created batches, delete, and history navigation.

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* Full persistent construction history editor.
* Export/import of history across page reloads.
* Branching history UI beyond standard redo invalidation after new actions.
* Undoable clear-page reload. The user confirmed `Clear` should not be included in undo/redo history for this task.

## Technical Notes

* Relevant files inspected:
  * `frontend/src/App.jsx`
  * `frontend/src/lib/ShapeRegistry.js`
  * `frontend/src/lib/DrawingEngine.js`
  * `frontend/src/lib/manualTools/ManualDrawingController.js`
  * `frontend/src/lib/manualTools/labels.js`
  * `frontend/src/lib/manualTools/constants.js`
  * `frontend/test/manualTools.test.js`
  * `.trellis/spec/frontend/state-management.md`
  * `.trellis/spec/frontend/quality-guidelines.md`
* Current registry serialization captures live geometry for AI context, but not enough instruction metadata to recreate arbitrary removed objects reliably.
* Current removal path is destructive from the registry perspective. A redo-capable design needs either replayable action descriptors, object snapshots that can recreate JSXGraph objects, or board-level snapshots.
* Browser-visible behavior should be verified because this changes user-facing canvas interactions.

## Expansion Sweep

### Future evolution

* The history layer may later support an action list, action labels, keyboard shortcuts, or timeline inspection.
* A stable action model could become the basis for saving/restoring construction sessions.

### Related scenarios

* Manual tools, AI-generated instruction batches, delete menu actions, label editing, and drag moves should eventually feel like the same history system.
* Undo and redo should be consistent with object ownership rules for polygons, generated edges, circle centers, and dependent constructions.

### Failure & edge cases

* Redo must be cleared after any new user action following undo.
* Undoing deletion or redoing creation must not recreate duplicate ids or stale references.
* Dependency-heavy geometry can break if object recreation order is wrong.

## Feasible Approaches

### Approach A: Creation redo only

* How it works: Extend the current create-id undo stack with a redo stack, and store enough creation metadata to replay recently undone creation batches.
* Pros: Smallest implementation, lower risk, preserves current mental model.
* Cons: Still does not solve the user's broader complaint for delete, label edits, and movement; likely feels incomplete.

### Approach B: Action history for create and delete (recommended MVP)

* How it works: Introduce history actions such as `create` and `delete`. Creation actions reuse grouped instruction metadata where available; delete actions capture removed object snapshots before deletion. Undo/redo applies inverse actions.
* Pros: Addresses the most visible gap beyond "remove last generated shape"; pairs naturally with redo; keeps scope manageable.
* Cons: Requires careful snapshot/recreation support for compound/dependent geometry.

### Approach C: Full action history for create, delete, label edit, and move (selected)

* How it works: Treat every meaningful canvas edit as a command with before/after state and inverse operation.
* Pros: Most correct editor behavior; matches drawing-tool expectations.
* Cons: Highest implementation risk because JSXGraph drag/move events and label offset/name changes need robust capture and replay.

## Decision (ADR-lite)

**Context**: The current registry only tracks created ids and removes objects on undo, so redo and non-creation undo require a richer action model.

**Decision**: Implement full action history for create, delete, label edit, and move actions.

**Consequences**: This gives editor-like history behavior but needs careful replay/snapshot logic, movement capture, and browser verification across mixed manual and AI-created workflows.

## Technical Approach

Use a hybrid command-history model:

* `create` actions record grouped created ids plus enough creation/recreation data to remove and restore the whole user-visible operation.
* `delete` actions snapshot all removed owned/dependent objects before removal, preserving removal order and registry ids.
* `label` actions record the target id plus previous and next label values.
* `move` actions record affected point-like object ids plus before and after coordinates at drag start/end, so one gesture is one history step.
* The history layer owns undo and redo stacks. Any new committed action clears redo.
* Existing registry `history` remains the live creation/order list used by serialization, but the undo stack evolves from id groups into action descriptors.
* `Clear` remains a reset action outside the history model.

## Implementation Plan

* PR1: Add history action primitives in `ShapeRegistry`, including `redoStack`, action commit, undo/redo dispatch, and unit coverage for create batching and redo invalidation.
* PR2: Store replayable creation metadata from `DrawingEngine.execute()` and adapt manual/AI creation flows without changing visible behavior.
* PR3: Make deletion undoable by snapshotting removed dependency groups before `removeObject()` deletes them, then restoring them in dependency-safe order.
* PR4: Record label edits through the label editor helper and add undo/redo for point names.
* PR5: Capture completed drag gestures for movable points and compound translated shapes, recording only final before/after coordinates.
* PR6: Add redo UI/constant/status copy, run unit quality gates, and browser-test mixed workflows.
