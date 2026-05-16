# Research: JSXGraph Export and Styling

- **Query**: JSXGraph "black and white" styling and export options
- **Scope**: External (JSXGraph API and integration)
- **Date**: 2025-05-17

## Findings

### 1. Black and White Styling
JSXGraph provides several ways to achieve a high-contrast or grayscale look, which is essential for exam-style rendering or print.

#### `JXG.useBlackWhiteOptions(board)`
- **Behavior**: This is a static utility that converts the color scheme of a construction to grayscale.
- **Existing Objects**: It updates all current elements on the board.
- **New Objects**: It modifies the global `JXG.Options` defaults, meaning any objects created *after* this call will also be black and white.
- **Usage**:
  ```javascript
  JXG.useBlackWhiteOptions(board);
  board.update();
  ```

#### Built-in Themes
For a B&W look from initialization, use the `mono_thin` theme:
```javascript
const board = JXG.JSXGraph.initBoard('jxgbox', {
    theme: 'mono_thin',
    axis: true
});
```

#### Individual Grayscale
- **`draft: true`**: Attribute that renders a specific element in grayscale.
- **`JXG.rgb2bw(colorString)`**: Utility to manually convert a color to its B&W equivalent.

---

### 2. Exporting Specific Areas
Exporting a sub-region (bounding box) requires a multi-step process because the renderer typically exports the entire viewport.

#### Strategy: Viewport Swapping
1. **Save** the current bounding box: `const oldBB = board.getBoundingBox();`
2. **Set** the target area: `board.setBoundingBox([x1, y1, x2, y2]);`
3. **Export**:
   - **SVG**: `new XMLSerializer().serializeToString(board.renderer.svgRoot);`
   - **PNG**: `board.renderer.dumpToCanvas(canvasId, width, height, withTexts);`
4. **Restore**: `board.setBoundingBox(oldBB);`

#### Built-in Screenshot Tool
Enable a basic screenshot button in the navigation bar:
```javascript
const board = JXG.JSXGraph.initBoard('jxgbox', {
    showScreenshot: true
});
```

---

### 3. High-Contrast / Exam Rendering
| Feature | Attribute | Description |
|---|---|---|
| **Disable Highlight** | `highlight: false` | Prevents color change on hover (reduces interactive "clues"). |
| **Fixed Elements** | `fixed: true` | Prevents dragging of geometric givens. |
| **Internal Text** | `text: { display: 'internal' }` | Ensures labels are part of the SVG export (rather than HTML overlays). |
| **Dashed Lines** | `dash: 2` | Standard for differentiating lines in B&W. |

---

### 4. Screenshot-Style Cropping UI
To implement a "selection box" over the board using JSXGraph primitives:

1. **Polygon-based Crop**:
   - Use two free points (Bottom-Left, Top-Right).
   - Use two dependent points that derive their coordinates from the free points to maintain a rectangle.
   - Create a `polygon` with `hasInnerPoints: true` to allow dragging the entire area.

```javascript
// Example Rectangular Selection
const p1 = board.create('point', [-1, -1]);
const p2 = board.create('point', [1, 1]);
const p3 = board.create('point', [() => p1.X(), () => p2.Y()], { visible: false });
const p4 = board.create('point', [() => p2.X(), () => p1.Y()], { visible: false });

const selection = board.create('polygon', [p1, p4, p2, p3], {
    fillColor: 'gray',
    fillOpacity: 0.2,
    hasInnerPoints: true
});
```

2. **External Libraries**:
   - If the crop needs to happen *after* the board is rendered as an image, **Cropper.js** is the standard vanilla JS solution for a "dimmed overlay" UI.

## Caveats / Not Found
- **Reversibility**: `JXG.useBlackWhiteOptions` is destructive to the global `JXG.Options`. To revert, one must call `JXG.setClassicColors()` and then `JXG.useStandardOptions(board)`.
- **Text in SVG**: SVG export frequently misses text labels if they are rendered as HTML (default). Always ensure `display: 'internal'` for export-heavy apps.
