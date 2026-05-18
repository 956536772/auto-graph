# brainstorm: AI chat image input and queued draft

## Goal

Allow the AI geometry chat to accept an image together with the user's text, and allow the user to keep editing the next question while an AI response is pending. The next question must remain a local draft and must not be sent to the backend until the current AI response returns.

## What I already know

* The user wants two related behaviors: image input in AI chat, and non-blocking editing of the next question while the current request is pending.
* The current frontend disables the chat input while `isSending` is true, so the user cannot type during a pending request.
* The current frontend request payload is built by `frontend/src/lib/chatPayload.js` as `{ text, context }`.
* The current backend API is `POST /api/chat`, handled by `ChatController`, with `ChatRequest(String text, List<CanvasObjectPayload> context)`.
* The backend LLM path uses `GeometryChatService` -> `GeometryLlmClient.extractInstructions(text, context)` and currently builds a text-only `UserMessage`.
* The backend architecture intentionally keeps canvas context as the current source of truth and does not rely on prior chat messages.
* LangChain4j `ChatModel` supports `UserMessage` with multiple content items, including `TextContent` and `ImageContent`, so image support can fit the current backend framework.

## Assumptions (temporary)

* Images are intended to help the model understand a geometry problem screenshot or diagram, not to be stored permanently.
* The first implementation should support attaching images from local file selection in the chat composer.
* The frontend should keep only one pending backend request at a time to preserve canvas-context correctness.
* While a request is pending, pressing send for the next draft should not call `/api/chat`; it should remain queued until the current response returns.
* Image payloads should be bounded by file type and size before sending to avoid large request bodies.

## Open Questions

* None for MVP.

## Requirements (evolving)

* The chat composer can attach an image to a user prompt.
* Sent messages display enough attachment context for the user to know an image was included.
* The backend request contract includes image metadata/data in addition to text and canvas context.
* The backend forwards image content to the LLM using LangChain4j multimodal message support.
* While a request is pending, the input remains editable and new messages can be queued.
* Queued messages automatically send sequentially after the current response returns.
* The implementation preserves the existing current-canvas-context contract for each actual backend request.
* AI-generated points and other auxiliary points are consistently exported as solid black circles in the preview SVG.

## Acceptance Criteria (evolving)

* [X] User can choose an image in the chat input area and send it with text.
* [X] Backend accepts the image payload and includes it in the LLM user message.
* [X] If the AI is responding, the user can type and send the next question, which is queued visually.
* [X] A second backend request is made automatically after the first response returns if a message is queued.
* [X] AI-generated points (often rendered as `<ellipse>` by JSXGraph) are restyled as solid circles in exported SVGs.
* [X] Existing text-only chat behavior remains supported.
* [X] Invalid or oversized images show a clear frontend or backend error without sending unsupported content to the LLM.
* [X] Frontend tests/build/lint and backend tests pass.

## Definition of Done (team quality bar)

* Tests added/updated for frontend payload and pending/draft behavior where practical.
* Backend tests added/updated for image payload parsing and multimodal LLM message construction.
* `npm test`, `npm run lint`, and `npm run build` pass in `frontend/`.
* `mvn test` passes in `backend/`.
* Browser interaction pass verifies attach image, pending edit, and post-response send behavior.
* Rollout/rollback considered if request payload shape affects existing clients.

## Out of Scope (explicit)

* Persistent image storage or image history beyond the current chat session.
* Streaming AI responses.
* Multiple concurrent backend chat requests.
* Multi-image batch support unless chosen later.
* Full OCR pipeline separate from the LLM vision input.

## Technical Notes

* Likely frontend files: `frontend/src/App.jsx`, `frontend/src/App.css`, `frontend/src/lib/chatPayload.js`, plus possible tests near existing frontend node tests.
* Likely backend files: `backend/src/main/java/com/autograph/backend/chat/ChatModels.java`, `GeometryChatService.java`, `GeometryLlmClient.java`, `backend/src/main/resources/ai/geometry-workflow.md`, and backend chat tests.
* Backend spec says `/api/chat` is cross-layer code and drawing instructions must remain constrained by `GeometryCapabilityContract`.
* Memory note: validated architecture is `App.handleSendMessage()` -> `POST /api/chat` -> `GeometryChatService` -> `GeometryCapabilityContract` -> frontend `DrawingEngine.execute()`.
* LangChain4j docs confirm `UserMessage` can contain `TextContent` and `ImageContent`, including base64 image data with a media type.

## Research References

* LangChain4j Chat and Language Models documentation — `ChatModel` is the current API and supports multimodal `UserMessage` content including `ImageContent`.

## Expansion Sweep

### Future evolution

* Image input may later become OCR-plus-geometry extraction, but this MVP should keep the LLM responsible for interpreting image content.
* The composer state should separate "in-flight request" from "draft being edited" so future features like queued history or cancel/retry are not blocked.

### Related scenarios

* Text-only prompts, prompt suggestions, and canvas-context serialization must continue to work.
* Clear/reset should decide whether it also clears any local draft and attached image.

### Failure and edge cases

* Reject unsupported MIME types and oversized files.
* Do not allow stale canvas context from the pending request to be mixed with the user's next draft.
* If the first request fails, the local next draft should not be lost.

## Feasible Approaches

### Approach A: Manual queued draft

The first request runs. The input remains editable. While the request is pending, the send button indicates the draft is waiting/disabled and never calls the backend. After the AI result returns, the draft stays in the composer and the user manually clicks send.

### Approach B: Auto-send queued draft after current response (Recommended)

The user can type and click send while a request is pending. That draft becomes queued locally and automatically sends after the first response returns.

## Decision (ADR-lite)

**Context**: The backend treats the current canvas context in each request as the source of truth. The user requested the ability to "queue" the next question so it sends automatically once the first response is received.

**Decision**: Use Approach B, auto-send queued draft. When a request is in-flight, new user messages are added to a `messageQueue` and displayed in the chat with a "Queued..." status. Once the current response completes, the `useEffect` hook in `App.jsx` automatically dequeues and sends the next request.

**Consequences**: This provides a smooth conversational experience. To ensure the correct canvas state is sent, the queue processor reads the registry state *at the moment of sending* (in `performChatRequest`), not at the moment of queuing.

**Context (SVG Export)**: Points in JSXGraph can be rendered as `<circle>` or `<ellipse>`. The SVG processor only handled `<circle>`, causing inconsistent styling for AI-generated points.

**Decision**: Update `SVGProcessor.js` to restyle both `<circle>` and `<ellipse>` point tags into solid black markers with a fixed radius/axis of 2.
