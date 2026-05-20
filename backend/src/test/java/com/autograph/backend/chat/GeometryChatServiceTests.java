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
    void shouldAllowDeletingExistingObjectWithoutResultId() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("delete_object", Map.of("target", "triangle_ABC"), null, null)
        ), "已删除三角形 ABC。")));

        var response = service.handle(new ChatRequest(
            "删除三角形ABC",
            List.of(
                point("A", 0, 0, 0),
                point("B", 4, 0, 1),
                point("C", 2, 3, 2),
                new CanvasObjectPayload(
                    "triangle_ABC",
                    "polygon",
                    null,
                    3,
                    new Anchor(2, 1),
                    null,
                    null,
                    null,
                    List.of(),
                    null,
                    null,
                    List.of(
                        new CanvasPointPayload("A", "A", 0d, 0d),
                        new CanvasPointPayload("B", "B", 4d, 0d),
                        new CanvasPointPayload("C", "C", 2d, 3d)
                    ),
                    null
                )
            )
        ));

        assertEquals("instructions", response.status());
        assertEquals("delete_object", response.instructions().get(0).action());
        assertEquals(Map.of("target", "triangle_ABC"), response.instructions().get(0).params());
        assertEquals("已删除三角形 ABC。", response.responseText());
    }

    @Test
    void shouldAllowShowAxisWithoutResultId() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("show_axis", Map.of("visible", true), null, null),
            new DrawingInstruction("function_graph", Map.of("expr", "x*x"), "graph_1", null)
        ), "已显示坐标轴并绘制函数图像。")));

        var response = service.handle(new ChatRequest("画出 y=x^2"));

        assertEquals("instructions", response.status());
        assertEquals(List.of("show_axis", "function_graph"), response.instructions().stream().map(DrawingInstruction::action).toList());
        assertEquals(Map.of("visible", true), response.instructions().get(0).params());
        assertEquals(null, response.instructions().get(0).resultId());
    }

    @Test
    void shouldClarifyAmbiguousDeleteTargetLabels() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("delete_object", Map.of("target", "A"), null, null)
        ), "已删除点A。")));

        var response = service.handle(new ChatRequest(
            "删除点A",
            List.of(
                new CanvasObjectPayload("point_a_1", "point", "A", 0, new Anchor(0, 0), null, null, List.of(), null),
                new CanvasObjectPayload("point_a_2", "point", "A", 1, new Anchor(1, 0), null, null, List.of(), null)
            )
        ));

        assertEquals("clarification", response.status());
        assertNotNull(response.clarification());
        assertEquals(2, response.clarification().candidates().size());
    }

    @Test
    void shouldUseLlmForImageRequests() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("place_point", Map.of("x", 0, "y", 0), "P", "P")
        ), "已根据图片绘制点P。")));

        var response = service.handle(new ChatRequest(
            "画一条线段",
            List.of(),
            new ChatImagePayload("image/png", "abc123", "diagram.png")
        ));

        assertEquals("instructions", response.status());
        assertEquals("place_point", response.instructions().get(0).action());
        assertEquals("已根据图片绘制点P。", response.responseText());
    }

    @Test
    void shouldNotGenerateLocalDrawingInstructionsWhenLlmReturnsError() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.error("模型未生成可执行指令。")));

        var response = service.handle(new ChatRequest(
            "连接OD",
            List.of(
                pointWithId("circle_o_center", "O", 0, 0, 0),
                pointWithId("point_d", "D", 3, 1, 1)
            )
        ));

        assertEquals("error", response.status());
        assertTrue(response.instructions().isEmpty());
        assertEquals("模型未生成可执行指令。", response.responseText());
    }

    @Test
    void shouldResolveLineRequestInstructionsFromLlmLabels() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("line", Map.of("p1", "E", "p2", "F"), "line_EF", null)
        ), "已作直线 EF。")));

        var response = service.handle(new ChatRequest(
            "我要作直线EF",
            List.of(
                pointWithId("point_e", "E", 0, 0, 0),
                pointWithId("point_f", "F", 4, 1, 1)
            )
        ));

        assertEquals("instructions", response.status());
        assertEquals("line", response.instructions().get(0).action());
        assertEquals(Map.of("p1", "point_e", "p2", "point_f"), response.instructions().get(0).params());
    }

    @Test
    void shouldValidateLlmCreatedMissingPointsForLineRequest() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("place_point", Map.of("x", -2.0, "y", 1.0), "E", "E"),
            new DrawingInstruction("place_point", Map.of("x", 2.0, "y", 1.0), "F", "F"),
            new DrawingInstruction("line", Map.of("p1", "E", "p2", "F"), "line_EF", null)
        ), "已作直线 EF。")));

        var response = service.handle(new ChatRequest("我要作直线EF", List.of()));

        assertEquals("instructions", response.status());
        assertEquals(List.of("place_point", "place_point", "line"), response.instructions().stream().map(DrawingInstruction::action).toList());
        assertEquals(Map.of("p1", "E", "p2", "F"), response.instructions().get(2).params());
    }

    @Test
    void shouldValidateLlmTangentDescriptionPointMetadata() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("tangent", Map.of(
                "circle", "circle_1",
                "point", "A",
                "descriptionPointLabel", "D",
                "descriptionPointResultId", "D"
            ), "tangent_AD", null)
        ), "已过点 A 作切线 AD。")));

        var response = service.handle(new ChatRequest(
            "过点A作切线AD",
            List.of(
                pointWithId("point_a", "A", 2, 0, 0),
                circle("circle_1", 0, 0, 2, 1)
            )
        ));

        assertEquals("instructions", response.status());
        assertEquals(Map.of(
            "circle", "circle_1",
            "point", "point_a",
            "descriptionPointLabel", "D",
            "descriptionPointResultId", "D"
        ), response.instructions().get(0).params());
    }

    @Test
    void shouldAllowTangentsAtCirclePointsAndTheirIntersection() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("tangent", Map.of("circle", "O", "point", "A"), "tangent_A", null),
            new DrawingInstruction("tangent", Map.of("circle", "O", "point", "B"), "tangent_B", null),
            new DrawingInstruction("intersection", Map.of("first", "tangent_A", "second", "tangent_B", "index", 0), "D", "D")
        ), "已过 A、B 作圆 O 的切线并标出交点 D。")));

        var response = service.handle(new ChatRequest(
            "过点A 作圆O的切线 与 过点B的切线 交于 点D",
            List.of(
                pointWithId("A", "A", 0, 5, 0),
                pointWithId("B", "B", -4, -3, 1),
                pointWithId("C", "C", 4, -3, 2),
                new CanvasObjectPayload("circle_ABC_center", "point", "O", 4, new Anchor(0, 0), null, null, List.of(), null),
                new CanvasObjectPayload("circle_ABC", "circumcircle", null, 5, new Anchor(0, 0), new Anchor(0, 0), 5.0, List.of(), "O")
            )
        ));

        assertEquals("instructions", response.status());
        assertEquals(List.of("tangent", "tangent", "intersection"), response.instructions().stream().map(DrawingInstruction::action).toList());
        assertEquals(Map.of("circle", "circle_ABC", "point", "A"), response.instructions().get(0).params());
        assertEquals(Map.of("circle", "circle_ABC", "point", "B"), response.instructions().get(1).params());
        assertEquals(Map.of("first", "tangent_A", "second", "tangent_B", "index", 0), response.instructions().get(2).params());
        assertEquals("D", response.instructions().get(2).resultId());
        assertEquals("D", response.instructions().get(2).label());
    }

    @Test
    void shouldAllowTangentOnNewlyCreatedCircumcircle() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction(
                "circumcircle",
                Map.of(
                    "p1", "point_1779109477750_3",
                    "p2", "point_1779109478316_4",
                    "p3", "point_1779109478983_6"
                ),
                "circle_O",
                null
            ),
            new DrawingInstruction("place_point", Map.of("x", -3.866, "y", -0.042), "point_O", "O"),
            new DrawingInstruction(
                "tangent",
                Map.of(
                    "circle", "circle_O",
                    "point", "point_1779109477750_3",
                    "descriptionPointLabel", "D",
                    "descriptionPointResultId", "point_D"
                ),
                "tangent_AD",
                null
            )
        ), "已绘制过点 A、B、C 的外接圆 O，并过点 A 作出了切线 AD。")));

        var response = service.handle(new ChatRequest(
            "过点A、B、C的外接圆O，并过点A作切线AD",
            List.of(
                pointWithId("point_1779109477750_3", "A", 0, 5, 0),
                pointWithId("point_1779109478316_4", "B", -4, -3, 1),
                pointWithId("point_1779109478983_6", "C", 4, -3, 2)
            )
        ));

        assertEquals("instructions", response.status());
        assertEquals(List.of("circumcircle", "place_point", "tangent"), response.instructions().stream().map(DrawingInstruction::action).toList());
        assertEquals(Map.of(
            "circle", "circle_O",
            "point", "point_1779109477750_3",
            "descriptionPointLabel", "D",
            "descriptionPointResultId", "point_D"
        ), response.instructions().get(2).params());
    }

    @Test
    void shouldConnectExistingPointLabelsFromLlmSegmentInstruction() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("segment", Map.of("p1", "A", "p2", "D"), "segment_AD", null)
        ), "已连接 AD。")));

        var response = service.handle(new ChatRequest(
            "连接AD",
            List.of(
                pointWithId("point_a", "A", 2, 0, 0),
                pointWithId("point_d", "D", 3, 1, 1),
                new CanvasObjectPayload("tangent_AD", "tangent", null, 2, null, null, null, List.of("A", "D"), null)
            )
        ));

        assertEquals("instructions", response.status());
        assertEquals(1, response.instructions().size());
        assertEquals("segment", response.instructions().get(0).action());
        assertEquals("segment_AD", response.instructions().get(0).resultId());
        assertEquals(Map.of("p1", "point_a", "p2", "point_d"), response.instructions().get(0).params());
        assertEquals("已连接 AD。", response.responseText());
    }

    @Test
    void shouldConnectGeneratedCircleCenterAndPointFromLlmSegmentInstruction() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("segment", Map.of("p1", "O", "p2", "D"), "segment_OD", null)
        ), "已连接 OD。")));

        var response = service.handle(new ChatRequest(
            "连接OD",
            List.of(
                pointWithId("circle_o_center", "O", 0, 0, 0),
                pointWithId("point_d", "D", 3, 1, 1),
                new CanvasObjectPayload("circle_o", "circle", null, 2, new Anchor(0, 0), new Anchor(0, 0), 2.0, List.of(), "O")
            )
        ));

        assertEquals("instructions", response.status());
        assertEquals("segment", response.instructions().get(0).action());
        assertEquals(Map.of("p1", "circle_o_center", "p2", "point_d"), response.instructions().get(0).params());
    }

    @Test
    void shouldConnectIntersectionPointFromLlmSegmentInstruction() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("segment", Map.of("p1", "O", "p2", "D"), "segment_OD", null)
        ), "已连接 OD。")));

        var response = service.handle(new ChatRequest(
            "连接OD",
            List.of(
                pointWithId("circle_ABC_center", "O", 0, -0.001111111111111186, 0),
                new CanvasObjectPayload(
                    "D",
                    "intersection",
                    "D",
                    1,
                    new Anchor(5.194230769230771, 3.0000000000000004),
                    null,
                    null,
                    List.of(),
                    null
                )
            )
        ));

        assertEquals("instructions", response.status());
        assertEquals(1, response.instructions().size());
        assertEquals("segment", response.instructions().get(0).action());
        assertEquals(Map.of("p1", "circle_ABC_center", "p2", "D"), response.instructions().get(0).params());
    }

    @Test
    void shouldAcceptLlmCreatedCenterPointWhenConnectingCircleCenterLabel() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("place_point", Map.of("x", 0.0, "y", 0.0), "O", "O"),
            new DrawingInstruction("segment", Map.of("p1", "O", "p2", "D"), "segment_OD", null)
        ), "已连接 OD。")));

        var response = service.handle(new ChatRequest(
            "连接OD",
            List.of(
                new CanvasObjectPayload("circle_o", "circle", null, 0, new Anchor(0, 0), new Anchor(0, 0), 2.0, List.of(), "O"),
                pointWithId("point_d", "D", 3, 1, 1)
            )
        ));

        assertEquals("instructions", response.status());
        assertEquals(List.of("place_point", "segment"), response.instructions().stream().map(DrawingInstruction::action).toList());
        assertEquals("O", response.instructions().get(0).resultId());
        assertEquals("O", response.instructions().get(0).label());
        assertEquals(Map.of("x", 0.0, "y", 0.0), response.instructions().get(0).params());
        assertEquals(Map.of("p1", "O", "p2", "point_d"), response.instructions().get(1).params());
    }

    @Test
    void shouldExpandTangentsFromExternalPointToCircle() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("tangents_from_point_to_circle", Map.of("point", "G", "circle", "circle_o"), "tangent_from_G", null)
        ), "已过点G作圆O的切线。")));

        var response = service.handle(new ChatRequest(
            "过点G作圆O的切线",
            List.of(
                pointWithId("point_g", "G", 5, 0, 0),
                new CanvasObjectPayload("circle_o", "circle", null, 1, new Anchor(0, 0), new Anchor(0, 0), 3.0, List.of(), "O")
            )
        ));

        assertEquals("instructions", response.status());
        assertEquals(List.of("glider", "tangent", "glider", "tangent"), response.instructions().stream().map(DrawingInstruction::action).toList());
        assertEquals(Map.of("x", 1.8, "y", 2.4, "path", "circle_o"), response.instructions().get(0).params());
        assertEquals(Map.of("circle", "circle_o", "point", "tangent_from_G_touch_1"), response.instructions().get(1).params());
        assertEquals(Map.of("x", 1.8, "y", -2.4, "path", "circle_o"), response.instructions().get(2).params());
        assertEquals(Map.of("circle", "circle_o", "point", "tangent_from_G_touch_2"), response.instructions().get(3).params());
        assertTrue(response.responseText().contains("已从圆外点近似计算两个切点"));
    }

    @Test
    void shouldNormalizeDirectTangentFromExternalPointToHighLevelTangents() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("tangent", Map.of("point", "G", "circle", "circle_o"), "tangent_from_G", null)
        ), "已过点G作圆O的切线。")));

        var response = service.handle(new ChatRequest(
            "过点G作圆O的切线",
            List.of(
                pointWithId("point_g", "G", 5, 0, 0),
                new CanvasObjectPayload("circle_o", "circle", null, 1, new Anchor(0, 0), new Anchor(0, 0), 3.0, List.of(), "O")
            )
        ));

        assertEquals("instructions", response.status());
        assertEquals(List.of("glider", "tangent", "glider", "tangent"), response.instructions().stream().map(DrawingInstruction::action).toList());
    }

    @Test
    void shouldKeepExternalTangentPointLabelsOnlyOnTouchPoints() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction(
                "tangents_from_point_to_circle",
                Map.of("point", "G", "circle", "circle_o", "labels", List.of("C", "D")),
                "tangent_from_G",
                null
            )
        ), "已过点G作圆O的切线。")));

        var response = service.handle(new ChatRequest(
            "过点G作圆O的切线",
            List.of(
                pointWithId("point_g", "G", 5, 0, 0),
                new CanvasObjectPayload("circle_o", "circle", null, 1, new Anchor(0, 0), new Anchor(0, 0), 3.0, List.of(), "O")
            )
        ));

        assertEquals("instructions", response.status());
        assertEquals("C", response.instructions().get(0).resultId());
        assertEquals("C", response.instructions().get(0).label());
        assertEquals(Map.of("circle", "circle_o", "point", "C"), response.instructions().get(1).params());
        assertEquals("D", response.instructions().get(2).resultId());
        assertEquals("D", response.instructions().get(2).label());
        assertEquals(Map.of("circle", "circle_o", "point", "D"), response.instructions().get(3).params());
    }

    @Test
    void shouldNormalizeModelSegmentToLineWhenUserExplicitlyRequestsLine() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("segment", Map.of("p1", "E", "p2", "F"), "line_EF", null)
        ), "已作直线EF。")));

        var response = service.handle(new ChatRequest(
            "我要作直线EF",
            List.of(
                pointWithId("point_e", "E", 0, 0, 0),
                pointWithId("point_f", "F", 4, 1, 1)
            ),
            new ChatImagePayload("image/png", "abc123", "diagram.png")
        ));

        assertEquals("instructions", response.status());
        assertEquals("line", response.instructions().get(0).action());
        assertEquals(Map.of("p1", "point_e", "p2", "point_f"), response.instructions().get(0).params());
    }

    @Test
    void shouldReturnImageConversationMessageWithoutDrawingInstructions() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.message("图片中有一个三角形和一条辅助线。")));

        var response = service.handle(new ChatRequest(
            "这张图里有什么？",
            List.of(),
            new ChatImagePayload("image/png", "abc123", "diagram.png")
        ));

        assertEquals("message", response.status());
        assertEquals("图片中有一个三角形和一条辅助线。", response.responseText());
        assertTrue(response.instructions().isEmpty());
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
            "正方形ABCD内有正八边形EFGHIJKL，且E/G/I/K在四边上，求边长"
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
        assertTrue(response.responseText().contains("已根据你的描述执行了绘图操作。") || response.responseText().contains("近似"));
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

        var response = service.handle(new ChatRequest("过P作AB的平行线和垂线"));

        assertEquals("instructions", response.status());
        assertEquals("line", response.instructions().get(2).action());
        assertEquals("parallel", response.instructions().get(4).action());
        assertEquals("perpendicular", response.instructions().get(5).action());
        assertEquals("已完成骨架构图。", response.responseText());
    }

    @Test
    void shouldExpandPerpendicularFootSegmentToFootPointAndSegmentOnly() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("perpendicular_foot_segment", Map.of(
                "point", "A",
                "p1", "B",
                "p2", "C",
                "footResultId", "D",
                "footLabel", "D"
            ), "segment_AD", null)
        ), "已绘制垂线段AD。")));

        var response = service.handle(new ChatRequest(
            "过点A作BC的垂线段交BC于点D",
            List.of(
                point("A", 0, 2, 0),
                point("B", -2, -1, 1),
                point("C", 3, -1, 2)
            )
        ));

        assertEquals("instructions", response.status());
        assertEquals(2, response.instructions().size());
        assertEquals("place_point", response.instructions().get(0).action());
        assertEquals("D", response.instructions().get(0).resultId());
        assertEquals("D", response.instructions().get(0).label());
        assertEquals(Map.of("x", 0.0, "y", -1.0), response.instructions().get(0).params());
        assertEquals("segment", response.instructions().get(1).action());
        assertEquals("segment_AD", response.instructions().get(1).resultId());
        assertEquals(Map.of("p1", "A", "p2", "D"), response.instructions().get(1).params());
    }

    @Test
    void shouldAllowDerivedCircleCenterContextAsPointReference() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("perpendicular_foot_segment", Map.of(
                "point", "circumcircle_ABC_center",
                "p1", "B",
                "p2", "C",
                "footResultId", "E",
                "footLabel", "E"
            ), "segment_OE", null)
        ), "已过点O作BC的垂线段OE。")));

        var response = service.handle(new ChatRequest(
            "过点O作BC的垂线交BC于E",
            List.of(
                point("B", -3, -1, 0),
                point("C", 4, -1, 1),
                new CanvasObjectPayload(
                    "circumcircle_ABC_center",
                    "circumcenter",
                    "O",
                    2,
                    new Anchor(0.5, -0.5),
                    null,
                    null,
                    List.of(),
                    null
                )
            )
        ));

        assertEquals("instructions", response.status());
        assertEquals(List.of("place_point", "segment"), response.instructions().stream().map(DrawingInstruction::action).toList());
        assertEquals("E", response.instructions().get(0).resultId());
        assertEquals("E", response.instructions().get(0).label());
        assertEquals(Map.of("x", 0.5, "y", -1.0), response.instructions().get(0).params());
        assertEquals(Map.of("p1", "circumcircle_ABC_center", "p2", "E"), response.instructions().get(1).params());
    }

    @Test
    void shouldCompactVisiblePerpendicularHelperPatternForPerpendicularSegmentRequest() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("segment", Map.of("p1", "B", "p2", "C"), "segment_BC", null),
            new DrawingInstruction("perpendicular", Map.of("line", "segment_BC", "point", "A"), "line_perp_A", null),
            new DrawingInstruction("intersection", Map.of("first", "line_perp_A", "second", "segment_BC", "index", 0), "D", "D"),
            new DrawingInstruction("segment", Map.of("p1", "A", "p2", "D"), "segment_AD", null)
        ), "已过点A作BC的垂线，交BC于点D，并绘制了垂线段AD。")));

        var response = service.handle(new ChatRequest(
            "过点A作BC的垂线段交BC于点D",
            List.of(
                point("A", 0, 2, 0),
                point("B", -2, -1, 1),
                point("C", 3, -1, 2)
            )
        ));

        assertEquals("instructions", response.status());
        assertEquals(List.of("place_point", "segment"), response.instructions().stream().map(DrawingInstruction::action).toList());
        assertEquals("D", response.instructions().get(0).resultId());
        assertEquals(Map.of("x", 0.0, "y", -1.0), response.instructions().get(0).params());
        assertEquals("segment_AD", response.instructions().get(1).resultId());
        assertTrue(response.instructions().stream().noneMatch(instruction -> "perpendicular".equals(instruction.action())));
        assertTrue(response.instructions().stream().noneMatch(instruction -> "intersection".equals(instruction.action())));
        assertTrue(response.instructions().stream().noneMatch(instruction -> "segment_BC".equals(instruction.resultId())));
    }

    @Test
    void shouldExpandAngleBisectorSegmentToEndpointAndSegmentOnly() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("angle_bisector_segment", Map.of(
                "p1", "A",
                "vertex", "B",
                "p2", "C",
                "endpointResultId", "E",
                "endpointLabel", "E"
            ), "segment_BE", null)
        ), "已绘制角平分线段BE。")));

        var response = service.handle(new ChatRequest(
            "作角ABC 的角平分线 BE",
            List.of(
                point("A", 0, 2, 0),
                point("B", -2, -1, 1),
                point("C", 3, -1, 2)
            )
        ));

        assertEquals("instructions", response.status());
        assertEquals(2, response.instructions().size());
        assertEquals("place_point", response.instructions().get(0).action());
        assertEquals("E", response.instructions().get(0).resultId());
        assertEquals("E", response.instructions().get(0).label());
        assertEquals(Map.of("x", 1.257, "y", 0.743), response.instructions().get(0).params());
        assertEquals("segment", response.instructions().get(1).action());
        assertEquals("segment_BE", response.instructions().get(1).resultId());
        assertEquals(Map.of("p1", "B", "p2", "E"), response.instructions().get(1).params());
    }

    @Test
    void shouldCompactBisectorLineUsedAsSegmentEndpointForNamedAngleBisectorSegment() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("bisector", Map.of("p1", "A", "vertex", "B", "p2", "C"), "BE", null),
            new DrawingInstruction("segment", Map.of("p1", "B", "p2", "BE"), "segment_BE", null)
        ), "已绘制角平分线BE。")));

        var response = service.handle(new ChatRequest(
            "作角ABC 的角平分线 BE",
            List.of(
                point("A", 0, 2, 0),
                point("B", -2, -1, 1),
                point("C", 3, -1, 2)
            )
        ));

        assertEquals("instructions", response.status());
        assertEquals(List.of("place_point", "segment"), response.instructions().stream().map(DrawingInstruction::action).toList());
        assertEquals("E", response.instructions().get(0).resultId());
        assertEquals(Map.of("x", 1.257, "y", 0.743), response.instructions().get(0).params());
        assertEquals(Map.of("p1", "B", "p2", "E"), response.instructions().get(1).params());
        assertTrue(response.instructions().stream().noneMatch(instruction -> "bisector".equals(instruction.action())));
    }

    @Test
    void shouldSurfaceApproximationForRatioHighLevelInstructions() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("place_point", Map.of("x", 0, "y", 0), "A", "A"),
            new DrawingInstruction("place_point", Map.of("x", 6, "y", 0), "B", "B"),
            new DrawingInstruction("point_by_ratio", Map.of("p1", "A", "p2", "B", "ratio", 0.333333), "P", "P")
        ), "已根据比例放置点P。")));

        var response = service.handle(new ChatRequest("点P在AB上且AP:PB=1:2"));

        assertEquals("instructions", response.status());
        assertEquals("place_point", response.instructions().get(2).action());
        assertEquals(Map.of("x", 2.0, "y", 0.0), response.instructions().get(2).params());
        assertTrue(response.responseText().contains("已根据你的描述执行了绘图操作。") || response.responseText().contains("近似"));
    }

    @Test
    void shouldExpandPointOnCircleAsGliderBoundToCirclePath() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("point_on_circle", Map.of("circle", "circle_1", "angle", 0), "P", "P")
        ), "已在圆上取点 P。")));

        var response = service.handle(new ChatRequest(
            "在圆上取一点P",
            List.of(circle("circle_1", 0, 0, 2, 0))
        ));

        assertEquals("instructions", response.status());
        assertEquals("glider", response.instructions().get(0).action());
        assertEquals(Map.of("x", 2.0, "y", 0.0, "path", "circle_1"), response.instructions().get(0).params());
        assertEquals("P", response.instructions().get(0).label());
    }

    @Test
    void shouldNotFallbackToLocalSegmentWhenLlmIsDisabled() {
        var service = serviceReturning(LlmDirectResult.unavailable(LlmFailureReason.DISABLED));

        var response = service.handle(new ChatRequest("画一条线段"));

        assertEquals("error", response.status());
        assertTrue(response.instructions().isEmpty());
        assertEquals("AI 无法使用：AI 服务未启用。", response.responseText());
    }

    @Test
    void shouldValidateLlmSegmentPhraseIdsForExistingCanvas() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("place_point", Map.of("x", -2, "y", 1), "A_2", "A"),
            new DrawingInstruction("place_point", Map.of("x", 2, "y", 1), "B_2", "B"),
            new DrawingInstruction("segment", Map.of("p1", "A_2", "p2", "B_2"), "AB_2", null)
        ), "已绘制线段 AB。")));

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

        var response = service.handle(new ChatRequest("连接A和B"));

        assertEquals("clarification", response.status());
        assertNotNull(response.clarification());
        assertEquals("你指的是哪一个点？", response.responseText());
        assertEquals(2, response.clarification().candidates().size());
    }

    @Test
    void shouldReturnLlmErrorModeWithoutInstructions() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.error("目前不支持椭圆。")));

        var response = service.handle(new ChatRequest("画一个椭圆"));

        assertEquals("error", response.status());
        assertEquals("目前不支持椭圆。", response.responseText());
        assertTrue(response.instructions().isEmpty());
    }

    @Test
    void shouldNotFallbackWhenAiIsDisabled() {
        var service = serviceReturning(LlmDirectResult.unavailable(LlmFailureReason.DISABLED));

        var response = service.handle(new ChatRequest("画一个三角形ABC"));

        assertEquals("error", response.status());
        assertEquals("AI 无法使用：AI 服务未启用。", response.responseText());
        assertTrue(response.instructions().isEmpty());
    }

    @Test
    void shouldRejectUnsupportedActions() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("ellipse", Map.of(), "ellipse_1", null)
        ), "已绘制。")));

        var response = service.handle(new ChatRequest("画椭圆"));

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

        var response = service.handle(new ChatRequest("画两个点"));

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

        var response = service.handle(new ChatRequest("画线段AB"));

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

    @Test
    void shouldResolveUniqueLabelsToIdsDuringValidation() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("midpoint", Map.of("p1", "A", "p2", "B"), "M", "M")
        ), "")));

        var response = service.handle(new ChatRequest(
            "作AB中点M",
            List.of(
                pointWithId("point_id_1", "A", 0),
                pointWithId("point_id_2", "B", 1)
            )
        ));

        assertEquals("instructions", response.status());
        assertEquals("midpoint", response.instructions().get(0).action());
        assertEquals("已根据你的描述执行了绘图操作。", response.responseText());
    }

    @Test
    void shouldResolvePointReferencesByExpectedTypeWhenLabelsCollide() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("segment", Map.of("p1", "A", "p2", "D"), "segment_AD", null)
        ), "已连接。")));

        var response = service.handle(new ChatRequest(
            "请把点A与点D连起来",
            List.of(
                pointWithId("point_a", "A", 0, 0, 0),
                new CanvasObjectPayload("line_d", "tangent", "D", 1, null, null, null, List.of("A", "D"), null),
                pointWithId("point_d", "D", 3, 1, 2)
            )
        ));

        assertEquals("instructions", response.status());
        assertEquals(Map.of("p1", "point_a", "p2", "point_d"), response.instructions().get(0).params());
    }

    @Test
    void shouldResolveCircleReferencesByCenterLabelWhenCircleIsExpected() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("tangent", Map.of("circle", "O", "point", "P"), "tangent_P", null)
        ), "已作切线。")));

        var response = service.handle(new ChatRequest(
            "作点P处圆O的切线",
            List.of(
                pointWithId("point_p", "P", 2, 0, 0),
                new CanvasObjectPayload("circle_o", "circle", null, 1, new Anchor(0, 0), new Anchor(0, 0), 2.0, List.of(), "O")
            )
        ));

        assertEquals("instructions", response.status());
        assertEquals(Map.of("circle", "circle_o", "point", "point_p"), response.instructions().get(0).params());
    }

    @Test
    void shouldUseSerializedEndpointIdsForExistingSegmentContext() {
        var service = serviceReturning(LlmDirectResult.success(GeometryAiResponse.instructions(List.of(
            new DrawingInstruction("point_on_segment", Map.of("segment", "segment_1", "ratio", 0.5), "M", "M")
        ), "已作出中点。")));

        var response = service.handle(new ChatRequest(
            "继续作AB中点",
            List.of(
                pointWithId("point_1", "A", 0, 0, 0),
                pointWithId("point_2", "B", 4, 0, 1),
                new CanvasObjectPayload(
                    "segment_1",
                    "segment",
                    null,
                    2,
                    null,
                    null,
                    null,
                    null,
                    List.of("A", "B"),
                    null,
                    List.of(
                        new CanvasPointPayload("point_1", "A", 0d, 0d),
                        new CanvasPointPayload("point_2", "B", 4d, 0d)
                    ),
                    null,
                    null
                )
            )
        ));

        assertEquals("instructions", response.status());
        assertEquals("place_point", response.instructions().get(0).action());
        assertEquals(Map.of("x", 2.0, "y", 0.0), response.instructions().get(0).params());
    }

    @Test
    void shouldIgnoreInvalidCanvasAnchorsInsteadOfRejectingRequest() throws Exception {
        var mapper = new ObjectMapper();
        var request = mapper.readValue("""
            {
              "text": "取AC中点",
              "history": [{"role": "user", "text": "旧历史应被忽略"}],
              "context": [
                {"id": "A", "type": "point", "label": "A", "coords": [0, 3]},
                {"id": "C", "type": "point", "label": "C", "coords": [2, -1]},
                {"id": "circumcircle_ABC", "type": "circumcircle", "position": {"x": null, "y": null}, "center": {"x": 0, "y": 0.5}, "radius": 2.5}
              ]
            }
            """, ChatRequest.class);

        var context = ContextIndex.from(request.context());
        var summary = context.toLlmSummary();

        assertEquals("取AC中点", request.text());
        assertEquals(Map.of(), summary.get(2).get("position"));
        assertEquals(Map.of("x", 0.0, "y", 0.5), summary.get(2).get("center"));
    }

    private static CanvasObjectPayload point(String label, double x, double y, int order) {
        return new CanvasObjectPayload(label, "point", label, order, new Anchor(x, y), null, null, List.of(), null);
    }

    private static CanvasObjectPayload pointWithId(String id, String label, int order) {
        return new CanvasObjectPayload(id, "point", label, order, new Anchor(0, 0), null, null, List.of(), null);
    }

    private static CanvasObjectPayload pointWithId(String id, String label, double x, double y, int order) {
        return new CanvasObjectPayload(id, "point", label, order, new Anchor(x, y), null, null, List.of(), null);
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

        @Override
        LlmDirectResult extractInstructions(String text, ContextIndex context, ChatImagePayload image) {
            return result;
        }
    }
}
