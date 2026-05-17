package com.autograph.backend.chat;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class GeometryChatService {
    private static final Logger LOGGER = LoggerFactory.getLogger(GeometryChatService.class);

    static final Set<String> POINT_TYPES = Set.of("point", "glider");
    static final Set<String> LINE_TYPES = Set.of("segment", "line", "parallel", "perpendicular", "tangent", "functiongraph");
    static final Set<String> CIRCLE_TYPES = Set.of("circle", "circumcircle", "incircle");

    private final GeometryLlmClient llmClient;

    @Autowired
    public GeometryChatService(GeometryLlmClient llmClient) {
        this.llmClient = llmClient;
    }

    public ChatResponse handle(ChatRequest request) {
        var rawText = request.text();
        var normalizedText = normalize(rawText);
        var canvasContext = request.context() == null ? List.<CanvasObjectPayload>of() : request.context();
        var directResponse = directResponseFor(normalizedText, canvasContext);
        if (directResponse != null) {
            return directResponse;
        }

        var context = ContextIndex.from(canvasContext);
        if (normalizedText.isBlank()) {
            return ChatResponse.error("目前支持三角形、正方形、连接线段、中点、平行/垂线、圆、外接圆、内切圆、过圆上一点作切线、两圆交点这些指令。");
        }
        var result = llmClient.extractInstructions(rawText, context);
        if (result.status() != LlmDirectStatus.SUCCESS) {
            return ChatResponse.error(aiUnavailableMessage(result.reason()));
        }
        var aiResponse = result.response();
        return switch (aiResponse.mode()) {
            case "instructions" -> instructionsResponse(aiResponse, canvasContext, rawText);
            case "clarification" -> ChatResponse.clarification(aiResponse.clarification());
            case "error" -> ChatResponse.error(aiResponse.responseText());
            default -> ChatResponse.error("AI 无法使用：AI 响应格式错误。");
        };
    }

    private ChatResponse instructionsResponse(GeometryAiResponse aiResponse, List<CanvasObjectPayload> context, String rawText) {
        var instructions = aiResponse.instructions() == null ? List.<DrawingInstruction>of() : aiResponse.instructions();
        if (instructions.isEmpty()) {
            return ChatResponse.error("这次没有生成可执行的绘图指令。");
        }
        var resolvedInstructions = GeometryReferenceResolver.resolve(instructions, context);
        var normalizedInstructions = GeometryInstructionNormalizer.normalize(resolvedInstructions, rawText);
        var expansion = GeometryInstructionExpander.expand(normalizedInstructions, context);
        if (!expansion.valid()) {
            if (expansion.clarification() != null) {
                return ChatResponse.clarification(expansion.clarification());
            }
            return ChatResponse.error(errorForValidation(ValidationResult.invalid(expansion.reason())));
        }
        var expandedInstructions = expansion.instructions();
        var validation = GeometryCapabilityContract.validateInstructions(expandedInstructions, context);
        if (validation.valid()) {
            LOGGER.info("Successfully processed {} instructions for request: {}", expandedInstructions.size(), rawText);
            return ChatResponse.ok(expandedInstructions, responseTextWithExpansionNotes(aiResponse.responseText(), expansion.notes()));
        }
        LOGGER.warn("Instruction validation failed for request: {}. Reason: {}", rawText, validation.reason());
        if (validation.clarification() != null) {
            return ChatResponse.clarification(validation.clarification());
        }
        return ChatResponse.error(errorForValidation(validation));
    }

    private ChatResponse directResponseFor(String normalizedText, List<CanvasObjectPayload> context) {
        if (!"画一条线段".equals(normalizedText)) {
            return null;
        }
        var usedIds = context.stream()
            .map(CanvasObjectPayload::id)
            .filter(id -> id != null && !id.isBlank())
            .collect(Collectors.toSet());
        var firstId = nextAvailableId("A", usedIds);
        usedIds.add(firstId);
        var secondId = nextAvailableId("B", usedIds);
        usedIds.add(secondId);
        var segmentId = nextAvailableId("AB", usedIds);
        return instructionsResponse(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("place_point", Map.of("x", -2, "y", 1), firstId, "A"),
            new DrawingInstruction("place_point", Map.of("x", 2, "y", 1), secondId, "B"),
            new DrawingInstruction("segment", Map.of("p1", firstId, "p2", secondId), segmentId, null)
        ), "已绘制线段 AB。"), context, normalizedText);
    }

    private String nextAvailableId(String base, Set<String> usedIds) {
        if (!usedIds.contains(base)) {
            return base;
        }
        var suffix = 2;
        while (usedIds.contains(base + "_" + suffix)) {
            suffix++;
        }
        return base + "_" + suffix;
    }

    private String aiUnavailableMessage(LlmFailureReason reason) {
        return switch (reason) {
            case DISABLED -> "AI 无法使用：AI 服务未启用。";
            case MISSING_API_KEY -> "AI 无法使用：缺少 AI API Key。";
            case HTTP_ERROR -> "AI 无法使用：AI 服务返回错误。";
            case NETWORK_ERROR -> "AI 无法使用：无法连接 AI 服务。";
            case TIMEOUT -> "AI 无法使用：AI 服务请求超时。";
            case MISSING_WORKFLOW -> "AI 无法使用：缺少 AI 绘图工作流。";
            case EMPTY_RESPONSE -> "AI 无法使用：AI 服务返回空响应。";
            case MALFORMED_RESPONSE -> "AI 无法使用：AI 响应格式错误。";
            case INVALID_INTENT -> "AI 无法使用：AI 返回了无效绘图意图。";
            case UNSUPPORTED_REQUEST -> "目前不支持这个绘图请求。";
        };
    }

    private String errorForValidation(ValidationResult validation) {
        return switch (validation.reason()) {
            case "unsupported_action" -> "AI 生成了当前前端不支持的绘图动作，未执行。";
            case "duplicate_result_id" -> "AI 生成了重复的结果 ID，未执行。";
            case "missing_required_param", "invalid_param_shape" -> "AI 生成的绘图参数不完整，未执行。";
            case "unknown_reference", "invalid_reference_order" -> "AI 引用了不存在或尚未创建的对象，未执行。";
            case "invalid_object_type" -> "AI 引用了类型不匹配的对象，未执行。";
            case "invalid_geometry" -> "AI 生成的几何关系不成立，未执行。";
            default -> "AI 生成了无效绘图指令，未执行。";
        };
    }

    private String responseTextWithExpansionNotes(String responseText, List<String> notes) {
        var baseText = responseText == null || responseText.isBlank() ? "已根据你的描述执行了绘图操作。" : responseText;
        var uniqueNotes = notes == null ? List.<String>of() : notes.stream()
            .filter(note -> note != null && !note.isBlank())
            .distinct()
            .toList();
        if (uniqueNotes.isEmpty()) {
            return baseText;
        }
        return baseText + (baseText.endsWith("。") ? " " : "。 ") + String.join(" ", uniqueNotes);
    }

    private String normalize(String text) {
        return text == null ? "" : text.replace('，', ',').replace('。', ' ').trim().toUpperCase(Locale.ROOT);
    }
}
