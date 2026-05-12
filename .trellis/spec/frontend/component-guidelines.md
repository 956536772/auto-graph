# Component Guidelines

## Overview
While this project does not use a framework like React, it follows a functional helper pattern to create interactive elements on the JSXGraph board.

## Patterns

### Functional Helpers
Use factory functions to create recurring elements with consistent properties and event listeners.
- **Example**: `createInteractivePoint(coords, name, options)` in `index.html`.
- **Naming**: Use `camelCase` for helper functions.

### Board Initialization
- Use `JXG.JSXGraph.initBoard` for board setup.
- Config should include `showCopyright: false`, `keepaspectratio: true`, and `shownavigation: true`.

### Interactivity
- Points should generally be draggable.
- Labels should support double-click to rename (using `p.label.on('dblclick', ...)`).

## Styling
- Use Ant Design-like colors for consistency (e.g., `#1890ff` for primary blue, `#f5222d` for errors/alerts).
- Board container (`#jxgbox`) should have a fixed or responsive size with a light border and rounded corners.
