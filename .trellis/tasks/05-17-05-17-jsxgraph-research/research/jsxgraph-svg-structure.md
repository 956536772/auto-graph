# Research: JSXGraph SVG Structure and Canvas Export

- **Query**: Exact SVG structure and selectors for JSXGraph grid, axes, logo, and navigation; Canvas rendering issues for SVG Blobs.
- **Scope**: Mixed (External Documentation + Internal Code Review)
- **Date**: 2026-05-17

## Findings

### 1. JSXGraph SVG Structure and Selectors

JSXGraph uses a combination of SVG elements for geometric data and HTML overlays for UI components. However, depending on the renderer and version, some UI elements can appear within the SVG.

| Element | Selectors / IDs | Type | Notes |
|---|---|---|---|
| **Grid Lines** | `.JXGgrid`, `.JXGticks` | `<path>` | Usually rendered as a single path with multiple M/L commands. |
| **Coordinate Axes** | `.JXGline`, `#[boardID]_xAxis`, `#[boardID]_yAxis` | `<path>` / `<line>` | `board.defaultAxes.x` often has a predictable ID. |
| **Logo / Copyright** | `.JXGlogo`, `#[boardID]_copyright` | `<text>` / `<div>` | By default an HTML overlay, but some renderers/settings place it in SVG. |
| **Navigation Icons** | `.JXG_navigation_button`, `#[boardID]_navigationbar` | `<span>` / `<div>` | Almost always HTML overlays, NOT included in standard SVG dumps. |

#### Detailed targeting for removal:
- **Grid & Ticks**: `svg.querySelectorAll('.JXGticks, .JXGgrid')`. Note that axes also use `.JXGticks` for their marks.
- **Axes**: `svg.querySelectorAll('.JXGline')` will target all lines. To target only axes, look for IDs starting with the board ID and ending in `L1`, `L2` or similar, or check for the absence of specific geometric classes.
- **Logo**: If it appears in SVG, it typically has the `.JXGlogo` class. In HTML mode, it's outside the SVG element.

### 2. `board.renderer.dumpToDataURI()` and `dumpToSVG()`

- **`dumpToSVG()`**: Returns a string representation of the SVG root. It **excludes** HTML overlays (Navigation Bar, Copyright Logo by default).
- **`dumpToDataURI()`**: Typically wraps the `dumpToSVG()` output into a `data:image/svg+xml;base64,...` URI.
- **Inclusion**: Geometric elements (points, lines, circles, grids, axes) ARE included. UI elements (buttons, logo) ARE NOT included unless specifically configured to render inside SVG (rare for navigation).

### 3. Canvas Rendering of SVG Blob Failures

Rendering an SVG Blob to a `<canvas>` via `drawImage(img, ...)` is a common source of failures, especially in Chrome and Safari.

#### Common Issues:
1. **Missing `xmlns`**: Standalone SVG Blobs MUST have `xmlns="http://www.w3.org/2000/svg"`. Browsers fail to parse them as images otherwise.
2. **External CSS Dependencies**: Styles defined in external CSS files or `<style>` blocks in the main document are **ignored** by the SVG Blob. Styles must be inlined or injected into a `<style>` tag inside the SVG.
3. **Missing Dimensions**: Safari often requires explicit `width` and `height` attributes on the `<svg>` element (not just `viewBox`) to render to Canvas.
4. **Security Restrictions (Tainted Canvas)**:
    - SVGs containing `<image>` tags with external URLs or `<foreignObject>` will "taint" the canvas, preventing `toDataURL()` extraction.
    - Some browsers block `Blob` or `data:URL` images from being drawn to canvas if they contain certain features.
5. **Serialization Errors**: If using `XMLSerializer`, ensure the output is valid XML. JSXGraph labels in "HTML mode" will cause errors if they are somehow pulled into the serializer.

## Recommendations for SVG Processor

To reliably process JSXGraph SVGs for export:
1. **Ensure Namespace**: `svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')`.
2. **Inline Styles**: Manually copy relevant CSS rules (e.g., from `jsxgraph.css`) into a `<style>` block inside the SVG.
3. **Set Dimensions**: Explicitly set `width` and `height` based on the `viewBox` or board dimensions.
4. **Targeted Removal**:
   ```javascript
   const toRemove = svg.querySelectorAll('.JXGticks, .JXGgrid, .JXGlogo, .JXGline[id*="Axis"]');
   toRemove.forEach(el => el.remove());
   ```

## References

- [JSXGraph API: Board.renderer](https://jsxgraph.org/docs/symbols/JXG.Board.html#renderer)
- [MDN: Drawing DOM objects into a canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Drawing_DOM_objects_into_a_canvas)
- Internal File: `frontend/src/lib/SVGProcessor.js`
