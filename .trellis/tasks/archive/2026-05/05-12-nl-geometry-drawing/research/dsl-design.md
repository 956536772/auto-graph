# Research: Geometric DSL Design for AI

## Findings

### 1. Construction-First Pattern
AI should not just provide raw coordinates. Instead, it should output a sequence of logical construction steps. This allows JSXGraph to maintain geometric constraints during interaction.

### 2. Proposed JSON Schema
```json
{
  "action": "place_point | draw_line | midpoint | perpendicular | parallel | intersect",
  "params": { ... },
  "result_id": "string",
  "label": "string"
}
```

### 3. Key Primitives for Junior High Math
- `place_point`: `(x, y)`
- `line_through`: `(p1, p2)`
- `midpoint`: `(p1, p2)`
- `perpendicular`: `(line, point)`
- `parallel`: `(line, point)`
- `circle_with_center`: `(center, through_point | radius)`
- `intersect`: `(obj1, obj2)`

## Implementation Notes
- Use a `DrawingEngine` to map these JSON actions to JSXGraph methods (e.g., `board.create('midpoint', [p1, p2])`).
- Reference objects by their `result_id` to maintain a dependency graph.
