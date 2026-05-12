# Research: Bidirectional Synchronization

## Findings

### 1. Board to AI (Serialization)
Listen to `drag` and `update` events on the board. Since `JSON.stringify(board)` fails due to circular references, use a **State-Mapping Pattern**:
- Iterate through `board.objects`.
- Extract only essential data: `id`, `name`, `type`, and `coords` (for independent points) or `parents` (for constrained objects).
- Keep a `ShapeRegistry` in the frontend as the source of truth.

### 2. AI to Board (Incremental Updates)
When AI sends a new instruction, check if the `result_id` already exists:
- If NEW: Create the object.
- If EXISTS: Update its properties (e.g., change color, rename label) or re-constrain it.

### 3. Performance
Use `board.suspendUpdate()` during batch processing of AI instructions to avoid flickering and improve speed.

## Constraints Sync
For constrained objects (like a midpoint), the "position" is derived. Only the "independent" objects (points placed at specific coordinates) need their coordinates synced back to the AI. Constrained objects only need their logical existence synced.
