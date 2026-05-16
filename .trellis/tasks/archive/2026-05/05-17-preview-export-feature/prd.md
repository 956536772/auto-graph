# brainstorm: Preview and Export Functionality

## Goal

Add a "Preview and Export" feature to the geometry assistant. This allows users to select a specific area of the canvas, preview it in a black-and-white "exam paper" style, and then export it as PNG/SVG or copy it to the clipboard.

## What I already know

* The project uses React and JSXGraph for geometric drawings.
* `ManualDrawingController` manages tool states and interactions.
* `TOOLS` in `constants.js` defines available tools.
* The user wants a "screenshot-like" selection tool.
* The output style should be black and white (suitable for exam papers).
* Export formats required: PNG, SVG.
* Copy to clipboard functionality is required.

## Assumptions (temporary)

* JSXGraph's `dumpToSVG` and `dumpToCanvas` can be used for capturing the board.
* The "black and white" style can be achieved by temporarily adjusting the board's visual attributes or post-processing the output.
* "Export to a specific folder" might mean a standard browser download trigger, or if this is a desktop app (Electron/NW.js), it might mean a native save dialog. Given the file list, it looks like a standard web app (Vite + React), so "specific folder" likely means the user's Downloads folder or via a browser save dialog.

## Open Questions

* **Black and White Style**: Should it just be "invert colors if dark mode" or a specific "ink/line" aesthetic? (The user image suggests clean black lines on white background).
* **Export Folder**: Is this a pure web app or a desktop app? (Affects "export to specific folder").
* **Cropping Tool**: Should it be a persistent tool mode or a one-time action?

## Requirements (evolving)

* Add a "Preview" button at the **top center or top right of the screen** (separate from the main floating toolbar).
* Implement a drag-to-select rectangle to define the capture area.
* Open a modal/dialog showing the preview of the selected area.
* **Export Presets**:
    * Apply a "black and white" theme to the preview image.
    * Automatically hide grid and axes in the preview.
    * Optimize line thickness and font styles for "Exam Paper" clarity.
* **Basic Robustness**:
    * Handle empty crop areas gracefully (e.g., show a placeholder or warning).
    * Provide feedback for clipboard actions (success/failure).
    * Ensure browser download triggers correctly for PNG/SVG.
* Provide "Export PNG", "Export SVG", and "Copy" buttons in the preview modal.

## Acceptance Criteria (evolving)

* [ ] User can click "Preview" and drag a box on the canvas.
* [ ] A preview dialog appears with the cropped image.
* [ ] The preview image is black and white, with grid/axes hidden.
* [ ] Geometric lines are clear and suitable for printing.
* [ ] "Export PNG" downloads a PNG file.
* [ ] "Export SVG" downloads an SVG file.
* [ ] "Copy" copies a PNG to the clipboard with a success message.
* [ ] Empty selections show a helpful error message.

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* Advanced image editing (brightness, contrast, etc.) beyond the B&W preset.
* Multi-page export.

## Technical Approach

### SVG-based Precise Rendering (Approach A)
*   **Capture**: Use `board.renderer.dumpToSVG()` to get the full construction as SVG.
*   **Processing**:
    *   Parse the SVG string.
    *   Force all `stroke` attributes to `black`.
    *   Set `fill` to `none` or `white` (except for specific markers like angles).
    *   Filter out elements belonging to the grid or axes.
    *   Scale `stroke-width` by a factor (e.g., 1.5x) for printing clarity.
*   **Cropping**: Apply a `viewBox` and `clip-path` to the SVG based on the selected rectangle.
*   **Conversion**: Use an off-screen `<canvas>` to render the processed SVG for PNG export and clipboard copy.

### Native Selection UI (Interaction 1)
*   Implement a new `TOOLS.PREVIEW` mode in `ManualDrawingController`.
*   The "Preview" action is triggered by a dedicated button at the top of the screen.
*   User clicks and drags to create a temporary, non-registered semi-transparent rectangle.
*   On release, the coordinates of the rectangle are used to trigger the preview modal.

## Decision (ADR-lite)

**Context**: Need a way to export high-quality, black-and-white geometric figures for exam papers.
**Decision**: Use SVG-based rendering with server-side/client-side string manipulation for style enforcement, and native JSXGraph objects for selection.
**Consequences**: High-quality vector output (SVG) and clear raster output (PNG). Requires careful SVG string manipulation to ensure "Exam Style" consistency.

## Out of Scope (explicit)

* Advanced image editing (brightness, contrast, etc.) beyond the B&W preset.
* Multi-page export.
* Server-side rendering of the images (all processing in-browser).
