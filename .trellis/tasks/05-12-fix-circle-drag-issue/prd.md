# Fix: Some circles cannot be dragged

## Goal

Resolve the issue where some drawn circles (likely those created via the manual tool or specific AI instructions) cannot be dragged in the drawing board.

## What I already know

* Circles can be created manually via the "圆" tool or via AI instructions.
* Manual tool uses the `ellipse` action which, for circles, creates a hidden center point and uses a fixed radius.
* AI instructions can use the `circle` action (center + through point) or `ellipse` action.
* `DrawingEngine.js` sets `draggable: true` and `hasInnerPoints: true` for these shapes.
* The issue affects "some" circles, suggesting a difference in creation method or state.

## Assumptions (temporary)

* Circles created with a fixed radius and a hidden center point might have issues if the hidden center point is not properly configured for dragging.
* Intersection points or constrained points (like midpoints) used as circle parameters might restrict dragging.
* The `pan: { enabled: true }` attribute on the board might be conflicting with circle dragging when `hasInnerPoints` is used.

## Open Questions

* Does the issue happen only for circles created with the manual tool?
* Does it happen for circles that are "filled" (since `hasInnerPoints` is true)?
* Are there specific error messages in the console?

## Requirements (evolving)

* All circles should be draggable regardless of how they were created (unless explicitly constrained).
* Dragging a circle should move its center point (and consequently its through point if applicable, or keep its radius if it's fixed).

## Acceptance Criteria (evolving)

* [x] Manually drawn circles (fixed radius) can be dragged by their boundary and interior.
* [x] AI-drawn circles (center + through point) can be dragged.
* [x] Circles with hidden center points can be dragged.

## Definition of Done (team quality bar)

* [x] Bug identified and fixed. (Added transparent fill to capture mouse events)
* [x] Verified manually in the browser.
* [x] Lint / typecheck pass.

## Technical Approach

* **Added Default Fill**: Circles and ellipses now have `fillColor: '#1890ff', fillOpacity: 0.1`. This ensures they have a "body" that intercepts drag events even when the board's `pan` attribute is enabled.
* **Auxiliary Point Cleanup**: Added `on('remove')` event listeners to shapes that use hidden auxiliary points (like manual circles and ellipses) to ensure these points are removed from the board when the main shape is deleted.

## Out of Scope (explicit)

* Redesigning the entire drawing engine.
* Fixing issues with other shapes unless they share the same root cause.

## Technical Notes

* Files to investigate: `frontend/src/lib/DrawingEngine.js`, `frontend/src/App.jsx`.
* JXGraph documentation on `circle` and `draggable`.
