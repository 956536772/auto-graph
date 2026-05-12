# Type Safety (Frontend)

## Overview
This project uses Vanilla JavaScript without a static type system (like TypeScript).

## Standards

### Descriptive Naming
Since there are no types, naming is critical:
- Use clear names for geometry objects (`square`, `octagon`).
- Use single uppercase letters for points (`A`, `B`, `E`) to match mathematical conventions.

### Validation
- For functional helpers, manually ensure that parameters (like `coords`) match the expected format (e.g., `[x, y]`).
