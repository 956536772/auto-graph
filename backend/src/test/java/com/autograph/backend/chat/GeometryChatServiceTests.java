package com.autograph.backend.chat;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.langchain4j.model.chat.ChatModel;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GeometryChatServiceTests {

    @Test
    void shouldReturnDirectInstructionsFromLlm() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("circumcircle", Map.of("p1", "A", "p2", "B", "p3", "C"), "circle_1", null)
        ), "已根据三点作出外接圆。")));

        var response = service.handle(new ChatRequest(
            "过A、B、C三点作外接圆",
            List.of(
                point("A", 0, 0, 0),
                point("B", 4, 0, 1),
                point("C", 2, 3, 2)
            )
        ));

        assertEquals("instructions", response.status());
        assertEquals("circumcircle", response.instructions().get(0).action());
        assertEquals("已根据三点作出外接圆。", response.responseText());
    }

    @Test
    void shouldExpandWordProblemHighLevelInstructionsToBaseInstructions() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("regular_polygon", Map.of(
                "sides", 4,
                "labels", List.of("A", "B", "C", "D"),
                "cx", 0,
                "cy", 0,
                "radius", 4,
                "startAngle", Math.PI / 4
            ), "square_ABCD", null),
            new DrawingInstruction("regular_polygon", Map.of(
                "sides", 8,
                "labels", List.of("E", "F", "G", "H", "I", "J", "K", "L"),
                "cx", 0,
                "cy", 0,
                "radius", 2.5,
                "startAngle", Math.PI / 2
            ), "octagon_EFGHIJKL", null)
        ), "已根据题意提取正方形和正八边形。")));

        var response = service.handle(new ChatRequest(
            "正方形ABCD内有正八边形EFGHIJKL，且E/G/I/K在四边上，求边长",
            List.of()
        ));

        assertEquals("instructions", response.status());
        assertEquals(14, response.instructions().size());
        assertTrue(response.instructions().stream().allMatch(instruction ->
            GeometryCapabilityContract.isSupportedBaseAction(instruction.action())
        ));
        assertTrue(response.instructions().stream().noneMatch(instruction ->
            GeometryInstructionExpander.isHighLevelAction(instruction.action())
        ));
        assertEquals("polygon", response.instructions().get(4).action());
        assertEquals("polygon", response.instructions().get(13).action());
        assertTrue(response.responseText().contains("近似"));
    }

    @Test
    void shouldExpandSkeletonHighLevelInstructionsExactlyWhenReferencesExist() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("place_point", Map.of("x", 0, "y", 0), "A", "A"),
            new DrawingInstruction("place_point", Map.of("x", 4, "y", 0), "B", "B"),
            new DrawingInstruction("line_through_points", Map.of("p1", "A", "p2", "B"), "AB", null),
            new DrawingInstruction("place_point", Map.of("x", 1, "y", 2), "P", "P"),
            new DrawingInstruction("parallel_through_point_to_segment", Map.of("point", "P", "segment", "AB"), "parallel_P_AB", null),
            new DrawingInstruction("perpendicular_through_point_to_segment", Map.of("point", "P", "segment", "AB"), "perpendicular_P_AB", null)
        ), "已完成骨架构图。")));

        var response = service.handle(new ChatRequest("过P作AB的平行线和垂线", List.of()));

        assertEquals("instructions", response.status());
        assertEquals("segment", response.instructions().get(2).action());
        assertEquals("parallel", response.instructions().get(4).action());
        assertEquals("perpendicular", response.instructions().get(5).action());
        assertEquals("已完成骨架构图。", response.responseText());
    }

    @Test
    void shouldSurfaceApproximationForRatioHighLevelInstructions() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("place_point", Map.of("x", 0, "y", 0), "A", "A"),
            new DrawingInstruction("place_point", Map.of("x", 6, "y", 0), "B", "B"),
            new DrawingInstruction("point_by_ratio", Map.of("p1", "A", "p2", "B", "ratio", 0.333333), "P", "P")
        ), "已根据比例放置点P。")));

        var response = service.handle(new ChatRequest("点P在AB上且AP:PB=1:2", List.of()));

        assertEquals("instructions", response.status());
        assertEquals("place_point", response.instructions().get(2).action());
        assertEquals(Map.of("x", 2.0, "y", 0.0), response.instructions().get(2).params());
        assertTrue(response.responseText().contains("近似"));
    }

    @Test
    void shouldReturnFixedSegmentInstructionsForDirectPhrase() {
        var service = serviceReturning(LlmDirectResult.unavailable(LlmFailureReason.DISABLED));

        var response = service.handle(new ChatRequest("画一条线段", List.of()));

        assertEquals("instructions", response.status());
        assertEquals("已绘制线段 AB。", response.responseText());
        assertEquals(3, response.instructions().size());
        assertEquals("place_point", response.instructions().get(0).action());
        assertEquals(Map.of("x", -2, "y", 1), response.instructions().get(0).params());
        assertEquals("A", response.instructions().get(0).resultId());
        assertEquals("A", response.instructions().get(0).label());
        assertEquals("place_point", response.instructions().get(1).action());
        assertEquals(Map.of("x", 2, "y", 1), response.instructions().get(1).params());
        assertEquals("B", response.instructions().get(1).resultId());
        assertEquals("B", response.instructions().get(1).label());
        assertEquals("segment", response.instructions().get(2).action());
        assertEquals(Map.of("p1", "A", "p2", "B"), response.instructions().get(2).params());
        assertEquals("AB", response.instructions().get(2).resultId());
    }

    @Test
    void shouldKeepFixedSegmentPhraseIdsSafeForExistingCanvas() {
        var service = serviceReturning(LlmDirectResult.unavailable(LlmFailureReason.DISABLED));

        var response = service.handle(new ChatRequest(
            "画一条线段",
            List.of(
                point("A", 0, 0, 0),
                point("B", 1, 0, 1),
                new CanvasObjectPayload("AB", "segment", "AB", 2, null, null, null, List.of("A", "B"), null)
            )
        ));

        assertEquals("instructions", response.status());
        assertEquals("A_2", response.instructions().get(0).resultId());
        assertEquals("B_2", response.instructions().get(1).resultId());
        assertEquals(Map.of("p1", "A_2", "p2", "B_2"), response.instructions().get(2).params());
        assertEquals("AB_2", response.instructions().get(2).resultId());
    }

    @Test
    void shouldPreserveLlmClarificationMode() {
        var clarification = new Clarification("你指的是哪一个点？", List.of(
            new ClarificationCandidate("A1", "A", "point", "点 A"),
            new ClarificationCandidate("A2", "A", "point", "另一个点 A")
        ));
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.clarification(clarification)));

        var response = service.handle(new ChatRequest("连接A和B", List.of()));

        assertEquals("clarification", response.status());
        assertNotNull(response.clarification());
        assertEquals("你指的是哪一个点？", response.responseText());
        assertEquals(2, response.clarification().candidates().size());
    }

    @Test
    void shouldReturnLlmErrorModeWithoutInstructions() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.error("目前不支持椭圆。")));

        var response = service.handle(new ChatRequest("画一个椭圆", List.of()));

        assertEquals("error", response.status());
        assertEquals("目前不支持椭圆。", response.responseText());
        assertTrue(response.instructions().isEmpty());
    }

    @Test
    void shouldNotFallbackWhenAiIsDisabled() {
        var service = serviceReturning(LlmDirectResult.unavailable(LlmFailureReason.DISABLED));

        var response = service.handle(new ChatRequest("画一个三角形ABC", List.of()));

        assertEquals("error", response.status());
        assertEquals("AI 无法使用：AI 服务未启用。", response.responseText());
        assertTrue(response.instructions().isEmpty());
    }

    @Test
    void shouldRejectUnsupportedActions() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("ellipse", Map.of(), "ellipse_1", null)
        ), "已绘制。")));

        var response = service.handle(new ChatRequest("画椭圆", List.of()));

        assertEquals("error", response.status());
        assertEquals("AI 生成了当前前端不支持的绘图动作，未执行。", response.responseText());
        assertTrue(response.instructions().isEmpty());
    }

    @Test
    void shouldRejectDuplicateResultIds() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("place_point", Map.of("x", 0, "y", 0), "A", "A"),
            new DrawingInstruction("place_point", Map.of("x", 1, "y", 1), "A", "A")
        ), "已绘制。")));

        var response = service.handle(new ChatRequest("画两个点", List.of()));

        assertEquals("error", response.status());
        assertEquals("AI 生成了重复的结果 ID，未执行。", response.responseText());
    }

    @Test
    void shouldRejectResultIdsThatOverwriteExistingCanvasObjects() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("place_point", Map.of("x", 1, "y", 1), "A", "A")
        ), "已绘制。")));

        var response = service.handle(new ChatRequest("再画一个A点", List.of(point("A", 0, 0, 0))));

        assertEquals("error", response.status());
        assertEquals("AI 生成了重复的结果 ID，未执行。", response.responseText());
    }

    @Test
    void shouldRejectReferencesBeforeCreation() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("segment", Map.of("p1", "A", "p2", "B"), "AB", null),
            new DrawingInstruction("place_point", Map.of("x", 0, "y", 0), "A", "A"),
            new DrawingInstruction("place_point", Map.of("x", 1, "y", 1), "B", "B")
        ), "已绘制。")));

        var response = service.handle(new ChatRequest("画线段AB", List.of()));

        assertEquals("error", response.status());
        assertEquals("AI 引用了不存在或尚未创建的对象，未执行。", response.responseText());
    }

    @Test
    void shouldConvertAmbiguousSymbolicReferenceToClarification() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("segment", Map.of("p1", "A", "p2", "B"), "segment_1", null)
        ), "已连接。")));

        var response = service.handle(new ChatRequest(
            "连接A和B",
            List.of(
                new CanvasObjectPayload("point_a_1", "point", "A", 0, new Anchor(0, 0), null, null, List.of(), null),
                new CanvasObjectPayload("point_a_2", "point", "A", 1, new Anchor(1, 0), null, null, List.of(), null),
                point("B", 2, 0, 2)
            )
        ));

        assertEquals("clarification", response.status());
        assertNotNull(response.clarification());
        assertFalse(response.clarification().candidates().isEmpty());
    }

    @Test
    void shouldRejectInvalidTangentPoint() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("tangent", Map.of("circle", "circle_1", "point", "P"), "tangent_1", null)
        ), "已作出切线。")));

        var response = service.handle(new ChatRequest(
            "过P作圆的切线",
            List.of(
                point("P", 3, 0, 0),
                circle("circle_1", 0, 0, 2, 1)
            )
        ));

        assertEquals("error", response.status());
        assertEquals("AI 生成的几何关系不成立，未执行。", response.responseText());
    }

    @Test
    void shouldRejectPolygonWithTooFewVertices() {
        var result = GeometryCapabilityContract.validateInstructions(List.of(
            new DrawingInstruction("place_point", Map.of("x", 0, "y", 0), "A", "A"),
            new DrawingInstruction("place_point", Map.of("x", 1, "y", 0), "B", "B"),
            new DrawingInstruction("polygon", Map.of("points", List.of("A", "B")), "poly_1", null)
        ));

        assertFalse(result.valid());
        assertEquals("invalid_geometry", result.reason());
    }

    private static GeometryChatService serviceReturning(LlmDirectResult result) {
        return new GeometryChatService(new FakeLlmClient(result));
    }

    private static CanvasObjectPayload point(String label, double x, double y, int order) {
        return new CanvasObjectPayload(label, "point", label, order, new Anchor(x, y), null, null, List.of(), null);
    }

    private static CanvasObjectPayload circle(String id, double x, double y, double radius, int order) {
        return new CanvasObjectPayload(id, "circle", id, order, new Anchor(x, y), new Anchor(x, y), radius, List.of(), null);
    }

    private static final class FakeLlmClient extends GeometryLlmClient {
        private final LlmDirectResult result;

        private FakeLlmClient(LlmDirectResult result) {
            super((ChatModel) null, new ObjectMapper(), "test-key", true);
            this.result = result;
        }

        @Override
        LlmDirectResult extractInstructions(String text, ContextIndex context) {
            return result;
        }
    }
}
