# Backend Guidelines

## Status

This project has a Spring Boot backend under `backend/`. The current backend surface is the geometry chat API used by the frontend canvas.

## Pre-Development Checklist

Before modifying backend AI drawing code:

* Read `backend/src/main/java/com/autograph/backend/chat/ChatController.java` for the API entrypoint.
* Read `backend/src/main/java/com/autograph/backend/chat/GeometryChatService.java` for intent resolution and instruction compilation.
* Read `backend/src/main/java/com/autograph/backend/chat/GeometryLlmClient.java` for LangChain4j remote LLM integration.
* Read `backend/src/main/resources/ai/geometry-workflow.md` before changing model behavior.
* Read `backend/src/main/java/com/autograph/backend/chat/GeometryCapabilityContract.java` before adding new intent types or drawing actions.
* Read `frontend/src/lib/DrawingEngine.js` before changing backend drawing instruction actions.
* Update `backend/src/test/java/com/autograph/backend/chat/GeometryChatServiceTests.java` for AI availability, unsupported input, reference resolution, and capability contract changes.

## Scenario: Geometry AI Drawing Contract

### 1. Scope / Trigger

* Trigger: Any change to `/api/chat`, `GeometryLlmClient`, `GeometryChatService`, `IntentType`, `DrawingInstruction`, or frontend drawing instruction actions.
* This is cross-layer code: natural language input -> LLM intent JSON -> backend validation/resolution -> backend drawing instructions -> frontend `DrawingEngine`.

### 2. Signatures

* API: `POST /api/chat`
* Request body: `ChatRequest(String text, List<CanvasObjectPayload> context)`
* Response body: `ChatResponse(String status, List<DrawingInstruction> instructions, String responseText, Clarification clarification)`
* LLM seam: `GeometryLlmClient.extractIntent(String text, ContextIndex context) -> LlmExtractionResult`
* LLM runtime: LangChain4j `ChatModel` with `OpenAiChatModel.builder()` for OpenAI-compatible `/chat/completions` providers.
* Compiler seam: `GeometryChatService.compile(GeometryIntent intent, ContextIndex context) -> List<DrawingInstruction>`
* Workflow file: `backend/src/main/resources/ai/geometry-workflow.md`

### 3. Contracts

* `ChatRequest.text` is the user drawing request.
* `ChatRequest.context` is serialized frontend canvas state from `ShapeRegistry.serialize()`.
* `LlmExtractionResult.SUCCESS` must include a supported `GeometryIntent`.
* `LlmExtractionResult.UNSUPPORTED` means the model understood that the request is outside the supported geometry set.
* `LlmExtractionResult.UNAVAILABLE` means the backend could not use the AI provider because of config, network, timeout, or API availability.
* `LlmExtractionResult.INVALID` means the AI provider responded, but the response could not be safely used.
* `DrawingInstruction.action` must be listed in `GeometryCapabilityContract` and executable by `frontend/src/lib/DrawingEngine.js`.
* The backend must never return arbitrary model-generated JSXGraph code.
* Runtime model behavior must come from `geometry-workflow.md`, not a hard-coded prompt string in Java.
* Tests should inject fake LangChain4j `ChatModel` instances instead of mocking HTTP request bodies.

### 4. Validation & Error Matrix

* AI disabled -> `status=error`, no instructions, response says AI service is not enabled.
* Missing API key -> `status=error`, no instructions, response says AI API key is missing.
* AI timeout -> `status=error`, no instructions, response says AI request timed out.
* Missing workflow file -> `status=error`, no instructions, response says AI drawing workflow is missing.
* AI HTTP non-2xx -> `status=error`, no instructions, response says AI service returned an error.
* Empty/malformed AI response -> `status=error`, no instructions, response says AI response is unusable.
* Invalid intent/action -> `status=error`, no instructions, response says AI returned an invalid or unsupported drawing operation.
* Unsupported geometry request -> `status=error`, no instructions, response lists supported request families.
* Ambiguous canvas reference -> `status=clarification`, no instructions, `clarification.candidates` contains possible objects.

### 5. Good/Base/Bad Cases

* Good: LLM returns `CREATE_CIRCUMCIRCLE` with three point references; backend resolves points and returns one `circumcircle` instruction.
* Base: LLM returns `CREATE_SEGMENT` with an ambiguous positional reference; backend returns clarification instead of guessing.
* Bad: AI is disabled and text contains a locally parseable phrase like "画一个三角形ABC"; backend must not use keyword fallback and must return AI unavailable.
* Bad: LLM returns an action such as `ellipse` that is not allowed by `GeometryCapabilityContract`; backend must reject it.

### 6. Tests Required

* Unit test unavailable AI categories that must not fall back to local parsing.
* Unit test unsupported AI output returns no drawing instructions.
* Unit test valid LLM intents still compile through deterministic backend paths.
* Unit test ambiguous references still return clarification.
* Unit test `GeometryCapabilityContract` rejects unsupported actions.
* Run `mvn test` in `backend/`.

### 7. Wrong vs Correct

#### Wrong

```java
var llmIntent = llmClient.extractIntent(text, context);
if (llmIntent.isEmpty()) {
    return localKeywordParser(text);
}
```

#### Correct

```java
var result = llmClient.extractIntent(text, context);
return switch (result.status()) {
    case SUCCESS -> IntentExtraction.success(result.intent());
    case UNSUPPORTED -> IntentExtraction.unsupported();
    case UNAVAILABLE, INVALID -> IntentExtraction.failed(result.reason());
};
```

## Design Decisions

### AI Intent Only, Deterministic Backend Compiler

**Context**: AI drawing must be reliable and aligned with frontend capabilities.

**Options Considered**:
1. AI emits raw drawing instructions.
2. AI emits high-level drawing plan DSL.
3. AI emits strict intent JSON and backend compiles it.

**Decision**: Use strict intent JSON from AI and keep reference resolution plus instruction compilation in backend code.

**Why**: This makes frontend parity testable, avoids arbitrary model-generated drawing actions, and preserves existing clarification behavior.

**Extensibility**: To add a new AI drawing ability, extend `IntentType`, update the LLM prompt schema, add deterministic compile/resolve logic, update `GeometryCapabilityContract`, and add tests.
