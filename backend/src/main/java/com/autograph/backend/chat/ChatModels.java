package com.autograph.backend.chat;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Objects;

@JsonIgnoreProperties(ignoreUnknown = true)
record ChatRequest(String text, List<CanvasObjectPayload> context) {
    ChatRequest(String text) {
        this(text, List.of());
    }
}

record ChatResponse(
    String status,
    List<DrawingInstruction> instructions,
    @JsonProperty("responseText") String responseText,
    Clarification clarification
) {
    static ChatResponse ok(List<DrawingInstruction> instructions, String responseText) {
        return new ChatResponse("instructions", instructions, responseText, null);
    }

    static ChatResponse clarification(Clarification clarification) {
        return new ChatResponse("clarification", List.of(), clarification.question(), clarification);
    }

    static ChatResponse error(String responseText) {
        return new ChatResponse("error", List.of(), responseText, null);
    }
}

record DrawingInstruction(
    String action,
    Map<String, Object> params,
    @JsonProperty("result_id") String resultId,
    String label
) {
}

record Clarification(String question, List<ClarificationCandidate> candidates) {
    static Clarification fromCandidates(String question, Collection<CanvasObject> objects) {
        var candidates = objects.stream()
            .limit(4)
            .map(object -> new ClarificationCandidate(object.id(), object.label(), object.type(), object.describe()))
            .toList();
        return new Clarification(question, candidates);
    }
}

record ClarificationCandidate(String id, String label, String type, String description) {
}

record CanvasObjectPayload(
    String id,
    String type,
    String label,
    Integer order,
    Anchor position,
    List<Double> coords,
    Anchor center,
    Double radius,
    List<String> endpointLabels,
    String centerLabel,
    List<CanvasPointPayload> endpoints,
    List<CanvasPointPayload> vertices,
    List<CanvasPointPayload> points
) {
    CanvasObjectPayload(
        String id,
        String type,
        String label,
        Integer order,
        Anchor position,
        Anchor center,
        Double radius,
        List<String> endpointLabels,
        String centerLabel
    ) {
        this(id, type, label, order, position, null, center, radius, endpointLabels, centerLabel, null, null, null);
    }
}

record CanvasPointPayload(String id, String label, Double x, Double y) {
    Anchor anchor() {
        return Anchor.of(x, y);
    }
}

record CanvasObject(
    String id,
    String type,
    String label,
    int order,
    Anchor anchor,
    Anchor center,
    Double radius,
    List<String> endpointLabels,
    String centerLabel,
    List<CanvasPointPayload> endpoints,
    List<CanvasPointPayload> vertices,
    List<CanvasPointPayload> points
) {
    static CanvasObject from(CanvasObjectPayload payload, int fallbackOrder) {
        var endpoints = payload.endpoints() == null ? List.<CanvasPointPayload>of() : payload.endpoints();
        var vertices = payload.vertices() == null ? List.<CanvasPointPayload>of() : payload.vertices();
        var points = payload.points() == null ? List.<CanvasPointPayload>of() : payload.points();
        return new CanvasObject(
            payload.id(),
            payload.type() == null ? "" : payload.type().toLowerCase(),
            payload.label(),
            payload.order() == null ? fallbackOrder : payload.order(),
            firstNonNull(validAnchor(payload.position()), anchorFromCoords(payload.coords())),
            validAnchor(payload.center()),
            payload.radius(),
            endpointLabels(payload.endpointLabels(), endpoints),
            payload.centerLabel(),
            endpoints,
            vertices,
            points
        );
    }

    List<String> endpointRefs() {
        var ids = endpoints.stream()
            .map(CanvasPointPayload::id)
            .filter(value -> value != null && !value.isBlank())
            .toList();
        return ids.size() == 2 ? ids : endpointLabels;
    }

    String describe() {
        if (anchor != null) {
            return "%s%s (x=%.2f, y=%.2f)".formatted(typeDescription(), optionalLabel(), anchor.x(), anchor.y());
        }
        if (center != null && radius != null) {
            return "%s%s (圆心=%.2f, %.2f, 半径=%.2f)".formatted(typeDescription(), optionalLabel(), center.x(), center.y(), radius);
        }
        return typeDescription() + optionalLabel();
    }

    private String typeDescription() {
        return switch (type) {
            case "point", "glider" -> "点";
            case "circle", "circumcircle", "incircle" -> "圆";
            case "segment", "line", "parallel", "perpendicular", "tangent" -> "线";
            default -> type;
        };
    }

    private String optionalLabel() {
        return label == null || label.isBlank() ? "" : " " + label;
    }

    private static Anchor anchorFromCoords(List<Double> coords) {
        if (coords == null || coords.size() < 2 || coords.get(0) == null || coords.get(1) == null) {
            return null;
        }
        return Anchor.of(coords.get(0), coords.get(1));
    }

    private static Anchor firstNonNull(Anchor first, Anchor second) {
        return first != null ? first : second;
    }

    private static Anchor validAnchor(Anchor anchor) {
        return anchor != null && anchor.isValid() ? anchor : null;
    }

    private static List<String> endpointLabels(List<String> explicitLabels, List<CanvasPointPayload> endpoints) {
        if (explicitLabels != null && !explicitLabels.isEmpty()) {
            return explicitLabels;
        }
        return endpoints.stream()
            .map(CanvasPointPayload::label)
            .filter(Objects::nonNull)
            .filter(value -> !value.isBlank())
            .toList();
    }
}

record Anchor(Double x, Double y) {
    Anchor(double x, double y) {
        this(Double.valueOf(x), Double.valueOf(y));
    }

    static Anchor of(Double x, Double y) {
        if (x == null || y == null || !Double.isFinite(x) || !Double.isFinite(y)) {
            return null;
        }
        return new Anchor(x, y);
    }

    boolean isValid() {
        return x != null && y != null && Double.isFinite(x) && Double.isFinite(y);
    }
}

record GeometryAiResponse(String mode, String responseText, List<DrawingInstruction> instructions, Clarification clarification) {
    static GeometryAiResponse instructions(List<DrawingInstruction> instructions, String responseText) {
        return new GeometryAiResponse("instructions", responseText, instructions, null);
    }

    static GeometryAiResponse clarification(Clarification clarification) {
        return new GeometryAiResponse("clarification", clarification.question(), List.of(), clarification);
    }

    static GeometryAiResponse error(String responseText) {
        return new GeometryAiResponse("error", responseText, List.of(), null);
    }
}

record LlmDirectResult(LlmDirectStatus status, GeometryAiResponse response, LlmFailureReason reason) {
    static LlmDirectResult success(GeometryAiResponse response) {
        return new LlmDirectResult(LlmDirectStatus.SUCCESS, response, null);
    }

    static LlmDirectResult unavailable(LlmFailureReason reason) {
        return new LlmDirectResult(LlmDirectStatus.UNAVAILABLE, null, reason);
    }

    static LlmDirectResult invalid(LlmFailureReason reason) {
        return new LlmDirectResult(LlmDirectStatus.INVALID, null, reason);
    }
}

enum LlmDirectStatus {
    SUCCESS,
    UNAVAILABLE,
    INVALID
}

enum LlmFailureReason {
    DISABLED,
    MISSING_API_KEY,
    HTTP_ERROR,
    NETWORK_ERROR,
    TIMEOUT,
    MISSING_WORKFLOW,
    EMPTY_RESPONSE,
    MALFORMED_RESPONSE,
    INVALID_INTENT,
    UNSUPPORTED_REQUEST
}
