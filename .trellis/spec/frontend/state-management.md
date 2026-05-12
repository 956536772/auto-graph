# State Management (Frontend)

## Overview
This project uses a combination of local JavaScript variables and JSXGraph's internal board state to manage data.

## Patterns

### Local Variables
- Use `var` or `let` for board objects (e.g., `board`, `A`, `B`, `square`).
- Constants like `sqrt2_2` should be derived from `Math`.

### JSXGraph Board State
- The board object (`board`) maintains the state of all points, polygons, and their properties.
- Use `board.update()` to refresh the visualization after programmatic changes.
