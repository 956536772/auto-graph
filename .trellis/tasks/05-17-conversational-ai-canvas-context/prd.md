# brainstorm: conversational AI canvas context

## Goal

Make the AI geometry assistant support iterative follow-up drawing requests by sending the latest canvas state to the backend on every AI turn. The backend stays stateless and the LLM reasons from the current user text plus current canvas snapshot only.

## Final Decision

The user decided not to send chat history and not to store backend sessions. The request contract is:

* `text`: the current user request.
* `context`: the current serialized canvas state.

The frontend must not send historical chat turns to `/api/chat`. Continuous dialogue is supported by grounding follow-up phrases like "取 AC 中点" in the latest canvas objects, labels, coordinates, endpoints, vertices, and construction order. Manual canvas edits naturally override old assumptions because the canvas snapshot is regenerated at send time.

## Requirements

* Follow-up AI prompts can refer to existing canvas objects.
* Every AI request includes the current canvas state from the frontend.
* Backend uses the latest canvas state for reference resolution and LLM prompting.
* Manual edits between AI turns are visible to the backend on the next request.
* AI-generated changes are additive unless the user explicitly asks to replace, clear, or redraw.
* Existing explicit AI-unavailable error behavior remains unchanged.
* Existing capability validation remains part of the backend response path.
* Backend request/context model preserves serialized canvas fields needed for reliable reference resolution.
* Backend does not persist conversation state after the response.
* Frontend chat history is only UI state and is not part of the API payload.

## Acceptance Criteria

* [ ] User can ask an initial geometry drawing request, then ask a follow-up such as "取 AC 中点" and get instructions based on the existing canvas.
* [ ] If the user manually adds, deletes, moves, or labels geometry before the next AI prompt, the backend receives and uses the latest canvas snapshot.
* [ ] Frontend chat request sends serialized canvas state on every AI turn.
* [ ] Frontend chat request does not send conversation history.
* [ ] Backend ignores unknown legacy fields such as `history` if an old client sends them.
* [ ] Backend does not store conversation turns between requests.
* [ ] Backend LLM prompt receives enough structured canvas data to identify points, lines, circles, polygons, and recent objects after manual edits.
* [ ] Requests containing invalid/null object anchors such as `position: {"x": null, "y": null}` do not fail with HTTP 400.
* [ ] Existing AI-unavailable and unsupported-request tests still pass.

## Out Of Scope

* Server-side collaborative editing or multi-user canvas sessions.
* Backend conversation storage, including in-memory server-side turn storage.
* Database-backed or file-backed conversation persistence.
* Browser-local persistence of chat history across page refresh.
* A standalone "new conversation" button that resets AI memory while preserving the current canvas.
* Replacing the current deterministic backend compiler with free-form AI-generated JSXGraph code.
* Backend semantic special cases such as hardcoding "取中点"; the LLM should infer supported drawing instructions from request plus canvas.

## Implementation Notes

* `frontend/src/lib/chatPayload.js` now builds stateless chat requests with only `text + context`.
* `frontend/src/App.jsx` sends the current canvas snapshot through the payload builder.
* `frontend/src/lib/ShapeRegistry.js` filters out non-finite anchors so canvas serialization does not emit `{x:null,y:null}` positions.
* `backend/src/main/java/com/autograph/backend/chat/ChatModels.java` models `ChatRequest` as `text + context`, ignores unknown legacy fields, and tolerates nullable anchor JSON at deserialization.
* Backend canvas payload handling includes frontend serialized `coords`, endpoint objects, polygon vertices, and angle points.
* `ContextIndex` LLM summaries include endpoint references, endpoint details, vertices, and angle points.
* `GeometryLlmClient` sends only workflow system message plus a user prompt containing current request and current canvas context JSON.
* `geometry-workflow.md` says current canvas context is the authoritative state and does not mention chat history.
* Tests cover current-canvas-only payloads, current-canvas-only LLM prompts, endpoint-id based follow-up construction, and invalid/null anchor tolerance.

## Validation

* Pending: `npm test`, `npm run lint`, `npm run build`, `mvn test`, `git diff --check`.
