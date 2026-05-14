package com.autograph.backend.chat;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;

class GeometryChatServiceTests {

    private final GeometryChatService service = new GeometryChatService(GeometryLlmClient.disabled());

    @Test
    void shouldCompileCircumcircleIntent() {
        var response = service.handle(new ChatRequest(
            "过A、B、C三点作外接圆",
            List.of(
                point("A", 0, 0, 0),
                point("B", 4, 0, 1),
                point("C", 2, 3, 2)
            )
        ));

        assertEquals("ok", response.status());
        assertEquals("circumcircle", response.instructions().get(0).action());
    }

    @Test
    void shouldClarifyAmbiguousLeftPointReference() {
        var response = service.handle(new ChatRequest(
            "连接左边那个点和A",
            List.of(
                point("A", 4, 0, 0),
                point("B", -2, 2, 1),
                point("C", -2, -2, 2)
            )
        ));

        assertEquals("clarification", response.status());
        assertNotNull(response.clarification());
        assertFalse(response.clarification().candidates().isEmpty());
    }

    @Test
    void shouldCompileCircleIntersectionsBySizeHints() {
        var response = service.handle(new ChatRequest(
            "求大圆和小圆的交点",
            List.of(
                circle("big", 0, 0, 5, 0),
                circle("small", 1, 0, 2, 1)
            )
        ));

        assertEquals("ok", response.status());
        assertEquals(2, response.instructions().size());
        assertEquals("intersection", response.instructions().get(0).action());
        assertEquals("otherintersection", response.instructions().get(1).action());
    }

    private static CanvasObjectPayload point(String label, double x, double y, int order) {
        return new CanvasObjectPayload(label, "point", label, order, new Anchor(x, y), null, null, List.of(), null);
    }

    private static CanvasObjectPayload circle(String id, double x, double y, double radius, int order) {
        return new CanvasObjectPayload(id, "circle", id, order, new Anchor(x, y), new Anchor(x, y), radius, List.of(), null);
    }
}
