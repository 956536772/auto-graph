# Research: Distinguishing Geometric Objects vs. System UI in JSXGraph SVG

- **Query**: How to distinguish between geometric objects and system UI (axes, grid, navigation, logo) in JSXGraph SVG output?
- **Scope**: external
- **Date**: 2025-05-17

## Findings

### 1. Axes Identification
Axes in JSXGraph are composed of lines (the axis itself) and ticks. They are rendered as `<path>` or `<line>` elements within the SVG.

*   **Classes**: 
    *   `.jxg-axis`: Applied to the main axis line.
    *   `.jxg-ticks`: Applied to the tick mark paths.
*   **IDs**: Follow the pattern `{boardID}_{elementID}`. 
    *   Example: `jxgbox_el1` for the axis line.
    *   Example: `jxgbox_el1_ticks1` for the ticks associated with that axis.
*   **Attributes**: Often have `stroke` and `stroke-width` defined.

### 2. Grid Identification
The grid can be rendered in two ways depending on configuration:

*   **As a Grid Element**: If created via `board.create('grid', ...)` or the `grid: true` shortcut, it is typically a single `<path>` element.
    *   **Class**: Usually empty by default unless `cssClass` is specified.
    *   **ID**: Follows `{boardID}_{elementID}` (e.g., `jxgbox_el2`).
*   **As Infinite Ticks**: Some configurations use axis ticks with `majorHeight: -1` to create a grid.
    *   **Class**: `.jxg-ticks`.
    *   **ID**: `{boardID}_{axisID}_ticks{N}`.
*   **Identification Strategy**: If no class is present, the grid path can be identified by checking if the element's ID corresponds to a `JXG.Grid` type in the board's element list, or by its characteristic "cage" pattern in the `d` attribute (spanning the bounding box).

### 3. Navigation Buttons (System UI)
**Crucial Distinction**: The navigation bar and its buttons are **NOT** part of the SVG output. They are HTML elements layered on top of the board.

*   **Container**: A `<div>` with ID `{boardID}_navigationbar`.
*   **Buttons**: `<span>` elements with class `.jxgbox_navigationbutton`.
*   **Selectors**:
    *   Left: `#{boardID}_nav_left`
    *   Right: `#{boardID}_nav_right`
    *   Up: `#{boardID}_nav_up`
    *   Down: `#{boardID}_nav_down`
    *   Zoom In: `#{boardID}_nav_zoomin`
    *   Zoom Out: `#{boardID}_nav_zoomout`
    *   Zoom Reset: `#{boardID}_nav_zoomreset`

### 4. Logo and Infobox
*   **Logo (Copyright)**: Usually an HTML `<a>` or `<div>` with class `jxgbox_copyright` or `jxgbox_logo`. It can be disabled via `showLogo: false`.
*   **Infobox**: Displays coordinates on hover.
    *   **Rendering**: Can be SVG `<text>` (default) or HTML `<div>` (if `isHtml: true`).
    *   **Class**: `.JXGinfobox`.
    *   **ID**: `{boardID}_infobox`.

### 5. Mapping Geometry Elements to SVG
Every geometric object in JSXGraph (Points, Lines, Circles, etc.) has a unique ID within the board.

*   **SVG ID**: The ID of the SVG element is exactly `{boardID}_{elementID}`.
*   **Filtering Logic**:
    *   To get **only user-defined geometric objects**:
        1.  Iterate through SVG elements.
        2.  Exclude elements with classes: `jxg-axis`, `jxg-ticks`, `JXGinfobox`.
        3.  Exclude elements whose JXG type is `grid` (by checking `board.objects[elementID].elType`).
        4.  Exclude the logo/copyright container (which is outside the SVG or has a specific class).

## Summary Table

| Element | Type | Selector / ID Pattern | Class |
|---|---|---|---|
| Axis Line | SVG | `#{boardID}_el[N]` | `.jxg-axis` |
| Axis Ticks | SVG | `#{boardID}_el[N]_ticks[M]` | `.jxg-ticks` |
| Grid | SVG | `#{boardID}_el[N]` | (none) |
| Nav Bar | HTML | `#{boardID}_navigationbar` | `.jxgbox_navigationbar` |
| Infobox | SVG/HTML | `#{boardID}_infobox` | `.JXGinfobox` |
| Logo | HTML | (varies) | `.jxgbox_copyright` |
| Geometry | SVG | `#{boardID}_{elementID}` | (varies) |

## Caveats / Not Found
*   If `cssClass` is used for geometric objects, they might share classes with system elements if not careful.
*   Some custom components might wrap multiple SVG elements; `element.rendNode` only points to the primary one.
