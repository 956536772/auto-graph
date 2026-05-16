# Research: JSXGraph SVG Structure

- **Query**: Research JSXGraph SVG structure: grid lines, axes, labels, and distinguishing geometric vs UI elements in `dumpToSVG()`.
- **Scope**: Mixed (External Documentation + Internal Code Review)
- **Date**: 2024-05-17

## Findings

### 1. Common Class Names and Attributes
JSXGraph uses consistent CSS classes for its SVG elements, which are preserved in the output of `board.renderer.dumpToSVG()`.

| Element | Default CSS Class | SVG Element | Notes |
|---|---|---|---|
| **Axes** | `.JXGline` | `<path>` or `<line>` | Often has an ID like `jxgBoardL1`. |
| **Grid Lines** | `.JXGticks` | `<path>` | Grids are usually rendered as a single path containing multiple segments (ticks with `majorHeight: -1`). |
| **Points** | `.JXGpoint` | `<circle>` or `<path>` | Point shapes (cross, circle, square) are all tagged with this class. |
| **General Element** | `.JXGelement` | Any | Almost all geometric objects have this base class. |
| **Highlighted** | `.JXGhighlight` | Any | Added dynamically when an object is hovered/selected. |

### 2. Labels (Text) Representation
Labels in JSXGraph have a dual nature depending on configuration:

- **HTML Mode (Default)**: Labels are `<div>` elements placed in a layer above the SVG. **These will be missing from the `dumpToSVG()` output.**
- **Internal (SVG) Mode**: If `display: 'internal'` is set for the element (or globally in `JXG.Options.text.display`), labels are rendered as SVG `<text>` elements.
- **Attributes**:
    - **Class**: `.JXGtext`
    - **Positioning**: Uses standard SVG `x` and `y` attributes.
    - **Styling**: Inline `style` attributes often control `font-size` and `font-family` unless `JXG.Options.text.cssDefaultStyle = ''` is used.

### 3. Geometric Objects vs UI Elements
Distinguishing between construction elements and interface components:

- **Geometric Objects**:
    - Always children of the `<svg>` root.
    - Follow the ID pattern: `[boardID][Type][Index]` (e.g., `jxgBoardP5` for a point, `jxgBoardL2` for a line).
    - Carry semantic classes like `JXGpoint`, `JXGline`.
- **UI Elements (Navigation Bar)**:
    - **Location**: The navigation bar (zoom, home, etc.) is rendered as HTML elements (usually `<span>`) inside the main container but **outside** the `<svg>` element.
    - **Exclusion**: Because `board.renderer.dumpToSVG()` only serializes the SVG root, the navigation bar is **automatically excluded** from the export.
    - **Copyright**: The "JSXGraph" logo/link is also an HTML overlay and is not included in the SVG dump.

## Caveats / Not Found

- **Grid IDs**: Unlike points and lines, grid paths might not have a fixed ID across different board initializations, so targeting them via `.JXGticks` is more reliable.
- **Labels in Export**: To ensure labels appear in the preview/export, the code must explicitly set `display: 'internal'` for all elements or the board defaults.
- **Complexity of Grids**: Since the entire grid is often a single `<path>`, it is difficult to hide individual grid lines in the SVG without redrawing the board.
