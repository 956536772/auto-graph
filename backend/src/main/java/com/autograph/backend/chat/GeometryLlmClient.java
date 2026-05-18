package com.autograph.backend.chat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.data.message.Content;
import dev.langchain4j.data.message.ImageContent;
import dev.langchain4j.data.message.SystemMessage;
import dev.langchain4j.data.message.TextContent;
import dev.langchain4j.data.message.UserMessage;
import dev.langchain4j.exception.HttpException;
import dev.langchain4j.exception.LangChain4jException;
import dev.langchain4j.exception.TimeoutException;
import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.model.openai.OpenAiChatModel;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ResourceLoader;
import org.springframework.stereotype.Component;
import org.springframework.util.FileCopyUtils;

import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Component
public class GeometryLlmClient {
    private static final Logger LOGGER = LoggerFactory.getLogger(GeometryLlmClient.class);

    private static final String WORKFLOW_RESOURCE = "classpath:ai/geometry-workflow.md";

    private final ChatModel chatModel;
    private final ObjectMapper objectMapper;
    private final String apiKey;
    private final boolean enabled;
    private final String workflow;

    @Autowired
    public GeometryLlmClient(
        @Value("${geometry.llm.base-url:https://api.ikuncode.cc/v1}") String baseUrl,
        @Value("${geometry.llm.model:gpt-5.4}") String model,
        @Value("${geometry.llm.api-key:}") String apiKey,
        @Value("${geometry.llm.enabled:true}") boolean enabled,
        ResourceLoader resourceLoader
    ) {
        this(
            OpenAiChatModel.builder()
                .baseUrl(trimTrailingSlash(baseUrl))
                .apiKey(apiKey == null || apiKey.isBlank() ? "missing-api-key" : apiKey)
                .modelName(model)
                .temperature(0d)
                .timeout(Duration.ofSeconds(120))
                .maxRetries(0)
                .build(),
            new ObjectMapper(),
            apiKey,
            enabled,
            loadWorkflow(resourceLoader)
        );
    }

    GeometryLlmClient(ChatModel chatModel, ObjectMapper objectMapper, String apiKey, boolean enabled) {
        this(chatModel, objectMapper, apiKey, enabled, "");
    }

    GeometryLlmClient(ChatModel chatModel, ObjectMapper objectMapper, String apiKey, boolean enabled, String workflow) {
        this.chatModel = chatModel;
        this.objectMapper = objectMapper;
        this.apiKey = apiKey;
        this.enabled = enabled;
        this.workflow = workflow;
    }

    static GeometryLlmClient disabled() {
        return new GeometryLlmClient(null, new ObjectMapper(), "", false);
    }

    LlmDirectResult extractInstructions(String text, ContextIndex context) {
        return extractInstructions(text, context, null);
    }

    LlmDirectResult extractInstructions(String text, ContextIndex context, ChatImagePayload image) {
        if (!enabled) {
            LOGGER.warn("Geometry LLM unavailable: {}", LlmFailureReason.DISABLED);
            return LlmDirectResult.unavailable(LlmFailureReason.DISABLED);
        }
        if (apiKey == null || apiKey.isBlank()) {
            LOGGER.warn("Geometry LLM unavailable: {}", LlmFailureReason.MISSING_API_KEY);
            return LlmDirectResult.unavailable(LlmFailureReason.MISSING_API_KEY);
        }
        if (workflow == null || workflow.isBlank()) {
            LOGGER.warn("Geometry LLM unavailable: workflow resource is empty");
            return LlmDirectResult.unavailable(LlmFailureReason.MISSING_WORKFLOW);
        }

        try {
            List<ChatMessage> messages = new ArrayList<>();
            messages.add(SystemMessage.from(workflow));
            messages.add(buildUserMessage(text, context, image));

            var response = chatModel.chat(messages);
            var content = response.aiMessage().text();
            if (content == null || content.isBlank()) {
                LOGGER.warn("Geometry LLM returned empty content");
                return LlmDirectResult.invalid(LlmFailureReason.EMPTY_RESPONSE);
            }
            return parseDirectContent(content);
        } catch (TimeoutException exception) {
            LOGGER.warn("Geometry LLM timed out: {}", exception.getMessage());
            return LlmDirectResult.unavailable(LlmFailureReason.TIMEOUT);
        } catch (HttpException exception) {
            LOGGER.warn("Geometry LLM HTTP error: {}", exception.getMessage());
            return LlmDirectResult.unavailable(LlmFailureReason.HTTP_ERROR);
        } catch (LangChain4jException exception) {
            LOGGER.warn("Geometry LLM provider failure: {}", exception.getMessage());
            return LlmDirectResult.unavailable(LlmFailureReason.NETWORK_ERROR);
        } catch (IllegalArgumentException exception) {
            LOGGER.warn("Geometry LLM returned invalid direct response: {}", exception.getMessage());
            return LlmDirectResult.invalid(LlmFailureReason.INVALID_INTENT);
        } catch (Exception exception) {
            LOGGER.warn("Geometry LLM returned malformed response: {}", exception.getMessage());
            return LlmDirectResult.invalid(LlmFailureReason.MALFORMED_RESPONSE);
        }
    }

    private UserMessage buildUserMessage(String text, ContextIndex context, ChatImagePayload image) throws IOException {
        var prompt = buildUserPrompt(text, context, image);
        if (image == null || image.data() == null || image.data().isBlank()) {
            return UserMessage.from(prompt);
        }

        List<Content> contents = new ArrayList<>();
        contents.add(TextContent.from(prompt));
        contents.add(ImageContent.from(image.data(), normalizeMediaType(image.mediaType())));
        return UserMessage.from(contents);
    }

    private LlmDirectResult parseDirectContent(String content) {
        try {
            var responseJson = parseJsonContent(content);
            var mode = responseJson.path("mode").asText("");
            if (!List.of("instructions", "clarification", "error", "message").contains(mode)) {
                return LlmDirectResult.invalid(LlmFailureReason.INVALID_INTENT);
            }
            var responseText = responseJson.path("responseText").asText(defaultResponseText(mode));
            if ("instructions".equals(mode)) {
                var instructions = parseInstructions(responseJson.path("instructions"));
                return LlmDirectResult.success(GeometryAiResponse.instructions(instructions, responseText));
            }
            if ("clarification".equals(mode)) {
                var clarification = parseClarification(responseJson, responseText);
                return LlmDirectResult.success(GeometryAiResponse.clarification(clarification));
            }
            if ("message".equals(mode)) {
                return LlmDirectResult.success(GeometryAiResponse.message(responseText));
            }
            return LlmDirectResult.success(GeometryAiResponse.error(responseText));
        } catch (IllegalArgumentException exception) {
            LOGGER.warn("Geometry LLM returned invalid direct response: {}", exception.getMessage());
            return LlmDirectResult.invalid(LlmFailureReason.INVALID_INTENT);
        } catch (Exception exception) {
            LOGGER.warn("Geometry LLM returned malformed response: {}", exception.getMessage());
            return LlmDirectResult.invalid(LlmFailureReason.MALFORMED_RESPONSE);
        }
    }

    private String buildUserPrompt(String text, ContextIndex context, ChatImagePayload image) throws IOException {
        var contextPayload = context.toLlmSummary();
        var imageNote = image == null || image.data() == null || image.data().isBlank()
            ? "No image was attached."
            : "An image is attached to this user message. Use it as visual context for the geometry request.";
        return """
            You are handling one turn in a continuous geometry drawing conversation.

            Decide the next incremental drawing operation from:
            1. The current user request below.
            2. The current canvas context JSON below.
            3. The attached image when present.

            Current canvas context is the only source of truth for what exists now. The user may have manually changed the canvas after earlier AI turns.

            User request:
            %s

            Current canvas context JSON:
            %s

            Image attachment:
            %s

            Return only the JSON response for this turn.
            """.formatted(text, objectMapper.writeValueAsString(contextPayload), imageNote);
    }

    private String normalizeMediaType(String mediaType) {
        return mediaType == null || mediaType.isBlank() ? "image/png" : mediaType;
    }

    private JsonNode parseJsonContent(String content) throws IOException {
        var trimmed = content.trim();
        if (trimmed.startsWith("```")) {
            trimmed = trimmed.replaceFirst("^```json\\s*", "").replaceFirst("^```\\s*", "").replaceFirst("\\s*```$", "");
        }
        return objectMapper.readTree(trimmed);
    }

    private List<DrawingInstruction> parseInstructions(JsonNode instructionsNode) {
        if (!instructionsNode.isArray()) {
            throw new IllegalArgumentException("instructions must be an array");
        }
        var instructions = new ArrayList<DrawingInstruction>();
        for (var node : instructionsNode) {
            var action = node.path("action").asText("");
            var params = objectMapper.convertValue(node.path("params"), Map.class);
            var resultId = node.path("result_id").asText(null);
            var label = node.hasNonNull("label") ? node.path("label").asText() : null;
            instructions.add(new DrawingInstruction(action, params == null ? Map.of() : params, resultId, label));
        }
        return instructions;
    }

    private Clarification parseClarification(JsonNode responseJson, String fallbackQuestion) {
        var clarificationNode = responseJson.path("clarification");
        var question = clarificationNode.path("question").asText(fallbackQuestion);
        var candidates = new ArrayList<ClarificationCandidate>();
        var candidateNode = clarificationNode.path("candidates");
        if (candidateNode.isMissingNode()) {
            candidateNode = responseJson.path("candidates");
        }
        if (candidateNode.isArray()) {
            for (var node : candidateNode) {
                candidates.add(new ClarificationCandidate(
                    node.path("id").asText(""),
                    nullIfBlank(node.path("label").asText(null)),
                    node.path("type").asText(""),
                    node.path("description").asText("")
                ));
            }
        }
        return new Clarification(question, candidates);
    }

    private String defaultResponseText(String mode) {
        return switch (mode) {
            case "instructions" -> "已生成绘图指令。";
            case "clarification" -> "我需要你进一步说明。";
            case "message" -> "我已根据图片和问题完成分析。";
            case "error" -> "这个绘图请求暂时无法处理。";
            default -> "";
        };
    }

    private static String trimTrailingSlash(String value) {
        if (value.endsWith("/")) {
            return value.substring(0, value.length() - 1);
        }
        return value;
    }

    private String nullIfBlank(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private static String loadWorkflow(ResourceLoader resourceLoader) {
        var resource = resourceLoader.getResource(WORKFLOW_RESOURCE);
        try (var reader = new InputStreamReader(resource.getInputStream(), StandardCharsets.UTF_8)) {
            return FileCopyUtils.copyToString(reader);
        } catch (IOException exception) {
            LOGGER.warn("Geometry LLM workflow could not be loaded: {}", exception.getMessage());
            return "";
        }
    }
}
