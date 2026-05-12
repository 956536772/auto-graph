# Directory Structure (Frontend)

## Overview
This is a single-page static project. The structure is currently flat, with core logic residing in `index.html`.

## Layout
- `/` - Root directory containing the main entry point.
- `index.html` - The main application file containing HTML, CSS, and JavaScript.
- `.trellis/` - Trellis workflow and spec files.
- `.gemini/` - Gemini CLI configuration.

## Convention
- **Single Page**: Keep the main logic in `index.html` unless it grows significantly.
- **External Assets**: Use CDN-hosted libraries (e.g., JSXGraph) to keep the repository lightweight.
