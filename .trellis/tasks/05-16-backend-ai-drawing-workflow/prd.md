# brainstorm: optimize backend AI drawing workflow

## Goal

Optimize the backend AI drawing path so geometry drawing depends on the configured AI when AI is required, reports AI unavailability directly instead of silently using heuristic fallback, and evolves toward a deliberate AI-assisted drawing workflow whose generated instructions stay aligned with frontend drawing capabilities.

## What I already know

* The user wants to remove fallback behavior when AI is unavailable: if AI cannot be used, the product should directly say AI is unavailable.
* The user wants to discuss and design an AI-assisted drawing workflow before implementation.
* The user requires AI-drawn geometry to match what the frontend can draw.
* Backend chat entrypoint is `backend/src/main/java/com/autograph/backend/chat/GeometryChatService.java`.
* AI client is `backend/src/main/java/com/autograph/backend/chat/GeometryLlmClient.java`.
* Current AI extraction returns `Optional.empty()` when disabled, API key is missing, HTTP status is non-2xx, response content is blank, model returns `UNSUPPORTED`, or any exception occurs.
* `GeometryChatService.extractIntent()` currently treats an empty AI result as permission to continue into local keyword/rule extraction.
* Frontend executes backend drawing instructions through `frontend/src/lib/DrawingEngine.js` and tracks objects through `frontend/src/lib/ShapeRegistry.js`.
* Current frontend manual tools include select, point, segment, circle, rectangle, triangle, label, angle, parallel, perpendicular, midpoint, angle bisector, undo, and clear.
* Current backend intent types include triangle, square, segment, midpoint, parallel, perpendicular, circle, circumcircle, incircle, tangent, and circle intersections.
* Current `DrawingEngine` supports additional instruction actions including `place_point`, `polygon`, `glider`, `intersection`, `otherintersection`, `tangent`, `bisector`, `angle`, and `ellipse`; however manual ellipse drawing was intentionally removed from the UI.
* `.trellis/spec/backend/index.md` is stale because it still says this is frontend-only, while a Spring backend now exists.

## Assumptions (temporary)

* "AI unavailable" covers missing/disabled config, network/API failure, malformed AI response, timeout, and AI response that cannot be parsed into a supported contract.
* Unsupported geometry requests should be distinguished from unavailable AI where possible.
* The workflow should use a capability contract rather than letting the LLM invent raw JSXGraph primitives.
* AI parity with frontend means AI may only emit instructions that the frontend can execute and that correspond to currently supported user-facing drawing capabilities, unless we explicitly decide to expand the frontend.

## Open Questions

* None.

## Requirements (evolving)

* Remove silent local fallback when AI is required but unavailable.
* Return an explicit user-facing error when backend cannot use AI.
* Keep AI-generated drawing within the same supported capability set as frontend drawing.
* Preserve existing reference resolution and clarification behavior where it improves correctness.
* Use the workflow "AI intent only, deterministic backend compiler" as the MVP direction.
* Include observability for AI unavailability reasons, at least distinguishing disabled/missing config, timeout/network/API failure, non-2xx responses, malformed response, invalid intent, and unsupported request.
* Include a backend capability contract that documents/validates which AI intents/actions are supported and keeps them aligned with frontend drawing capabilities.

## Acceptance Criteria (evolving)

* [x] Missing/disabled AI config returns a clear "AI unavailable" response instead of drawing via keyword fallback.
* [x] AI API failure, timeout, malformed response, or invalid intent returns a clear error and no drawing instructions.
* [x] Unsupported user requests are reported as unsupported rather than silently approximated.
* [x] Backend has tests covering unavailable AI and unsupported/invalid AI output.
* [x] AI drawing instruction actions are validated against a backend capability contract aligned with frontend-supported actions.
* [x] Existing supported flows that remain in MVP still produce executable instructions accepted by `DrawingEngine`.
* [x] AI failure logs preserve developer-visible reason categories without exposing secrets to users.
* [x] Capability contract is represented in code and covered by tests, not only prose.

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* Expanding manual frontend drawing tools unless needed for parity.
* Letting AI emit arbitrary JSXGraph code.
* Building a multi-turn autonomous theorem-solving agent unless chosen explicitly later.
* Retrying failed AI calls automatically.
* Streaming AI responses.
* Exposing provider-specific error details or API keys to the frontend.

## Technical Notes

* Inspected `backend/src/main/java/com/autograph/backend/chat/GeometryChatService.java`.
* Inspected `backend/src/main/java/com/autograph/backend/chat/GeometryLlmClient.java`.
* Inspected `backend/src/main/java/com/autograph/backend/chat/ChatModels.java`.
* Inspected `backend/src/test/java/com/autograph/backend/chat/GeometryChatServiceTests.java`.
* Inspected `frontend/src/lib/DrawingEngine.js`.
* Inspected `frontend/src/lib/ShapeRegistry.js`.
* Inspected `frontend/src/lib/manualTools/constants.js`.
* Inspected `frontend/src/App.jsx` chat request handling.
* Inspected `.trellis/spec/backend/index.md` and `.trellis/spec/backend/error-handling.md`; backend spec is currently incomplete/stale.

## Research Notes

### Constraints from our repo/project

* The current backend already separates intent extraction, reference resolution, and instruction compilation.
* The current frontend already has a concrete instruction executor and object serialization contract, so the safest workflow is to keep AI output structured and validated rather than execute free-form model output.
* The local keyword parser currently doubles as fallback and test harness. Removing fallback means tests should use a fake deterministic AI client or an explicit parser seam rather than relying on disabled AI.

### Feasible approaches here

**Approach A: AI intent only, deterministic backend compiler** (Recommended)

* How it works: AI converts natural language into a strict intent JSON. Backend validates intent, resolves references, compiles to known drawing instructions, and rejects unavailable/invalid AI.
* Pros: Best control over frontend parity, easiest to test, keeps geometry execution deterministic, limits prompt injection and malformed geometry.
* Cons: AI cannot directly express new geometry unless the backend intent schema is extended.

**Approach B: AI emits drawing plan DSL, backend validates capability contract**

* How it works: AI emits a multi-step plan of approved drawing actions directly matching frontend capabilities. Backend validates all actions/params and returns instructions.
* Pros: More flexible for multi-step constructions, closer to an "AI-assisted drawing workflow".
* Cons: Larger validation surface; harder to keep reference resolution, undo batching, and labels consistent.

**Approach C: Two-stage AI planner plus backend compiler**

* How it works: AI first creates a high-level drawing plan, then backend or a second model pass normalizes the plan into approved intents/instructions; backend validates and executes only known capabilities.
* Pros: Best long-term path for complex workflows and clarification loops.
* Cons: More moving parts, higher latency/cost, more tests and observability needed.

## Decision (ADR-lite)

**Context**: The backend AI path must stop silently falling back when AI is unavailable, while keeping AI drawing aligned with frontend capabilities.

**Decision**: Use "AI intent only, deterministic backend compiler" for the MVP. The LLM only converts Chinese geometry requests into strict intent JSON. The backend validates the intent, resolves references from canvas context, compiles it into known drawing instructions, and rejects unavailable or invalid AI output.

**Consequences**: This keeps frontend parity and tests manageable, but new AI drawing behaviors require extending the intent schema and compiler rather than relying on free-form model output.

## MVP Scope Decision

**Context**: The first implementation should both fix the fallback behavior and establish maintainable boundaries for future AI drawing work.

**Decision**: Include the minimal behavior change plus observability and a backend capability contract.

**Consequences**: The initial patch is larger than a single fallback removal, but it avoids another ambiguous AI path and gives future intent additions a clear validation target.

## Technical Approach

* Change `GeometryLlmClient` from "empty optional for every failure" to a typed extraction result that can represent success, unsupported request, and unavailable/invalid AI with a reason category.
* Change `GeometryChatService.extractIntent()` so AI unavailability does not fall through to keyword rules. Unsupported requests should produce a user-facing unsupported message; AI unavailable/invalid should produce an AI unavailable error with no drawing instructions.
* Keep deterministic backend compilation through existing `resolveIntent()` and `compile()` paths.
* Add a capability contract in backend code for supported intent types and emitted instruction actions. Use it to validate compiled output before returning it.
* Keep the contract aligned with frontend current capabilities: point, segment, circle, rectangle/square, triangle, label-bearing constructions, angle, parallel, perpendicular, midpoint, angle bisector/bisector if exposed, and supported derived constructions already accepted by `DrawingEngine`.
* Add tests using fake/stub AI clients rather than disabled AI fallback.

## Implementation Plan (small PRs)

* PR1: Introduce typed AI extraction result and remove silent fallback for unavailable/invalid AI.
* PR2: Add capability contract and validate backend compiled instructions against it.
* PR3: Update tests for unavailable AI, unsupported AI output, valid intent compilation, and capability alignment.
* PR4: Update backend spec/docs if implementation reveals durable conventions worth preserving.

## Implementation Notes

* Added typed LLM extraction result states and failure reason categories in backend chat models.
* Changed `GeometryLlmClient` to return explicit unavailable/invalid/unsupported results and log reason categories.
* Changed `GeometryChatService` so unavailable or invalid AI no longer falls through to local keyword parsing.
* Added `GeometryCapabilityContract` to whitelist supported backend instruction actions.
* Updated backend tests to use fake LLM clients and cover unavailable, malformed, unsupported, valid intent, clarification, and contract rejection cases.
* Updated `.trellis/spec/backend/index.md` with the executable geometry AI drawing contract.
* Moved model behavior into `backend/src/main/resources/ai/geometry-workflow.md`.
* Replaced hand-written Java `HttpClient` model calls with LangChain4j `ChatModel` / `OpenAiChatModel` while keeping the existing OpenAI-compatible provider config.
