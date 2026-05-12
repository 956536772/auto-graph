package com.autograph.backend.chat;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Objects;

record ChatRequest(String text, List<CanvasObjectPayload> context) {
}

record ChatResponse(String status, List<DrawingInstruction> instructions, String responseText, Clarification clarification) {
    static ChatResponse ok(List<DrawingInstruction> instructions, String responseText) {
        return new ChatResponse("ok", instructions, responseText, null);
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
    Anchor center,
    Double radius,
    List<String> endpointLabels,
    String centerLabel
) {
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
    String centerLabel
) {
    static CanvasObject from(CanvasObjectPayload payload, int fallbackOrder) {
        return new CanvasObject(
            payload.id(),
            payload.type() == null ? "" : payload.type().toLowerCase(),
            payload.label(),
            payload.order() == null ? fallbackOrder : payload.order(),
            payload.position(),
            payload.center(),
            payload.radius(),
            payload.endpointLabels() == null ? List.of() : payload.endpointLabels(),
            payload.centerLabel()
        );
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
}

record Anchor(double x, double y) {
}

record GeometryIntent(IntentType type, Map<String, Object> args, String successMessage) {
    GeometryIntent withResolvedArgs(Map<String, String> resolvedArgs) {
        var merged = new java.util.HashMap<String, Object>(args);
        merged.putAll(resolvedArgs);
        return new GeometryIntent(type, merged, successMessage);
    }

    String stringArg(String key) {
        return Objects.toString(args.get(key), null);
    }
}

enum IntentType {
    CREATE_TRIANGLE,
    CREATE_SQUARE,
    CREATE_SEGMENT,
    CREATE_MIDPOINT,
    CREATE_PARALLEL,
    CREATE_PERPENDICULAR,
    CREATE_CIRCLE,
    CREATE_CIRCUMCIRCLE,
    CREATE_INCIRCLE,
    CREATE_TANGENT,
    CREATE_CIRCLE_INTERSECTIONS
}

record IntentExtraction(GeometryIntent intent, Clarification clarification) {
}

record ResolutionOutcome(GeometryIntent intent, String errorMessage, Clarification clarification) {
}

record RefQuery(
    String raw,
    java.util.Set<String> allowedTypes,
    String explicitLabel,
    LabelPair endpointLabels,
    String centerLabel,
    Descriptor descriptor
) {
    static RefQuery label(String label, java.util.Set<String> allowedTypes) {
        return new RefQuery(label, allowedTypes, label, null, null, new Descriptor(PositionHint.NONE, SizeHint.NONE, false));
    }

    static RefQuery lineByEndpoints(String first, String second, java.util.Set<String> allowedTypes) {
        return new RefQuery(first + second, allowedTypes, null, new LabelPair(first, second), null, new Descriptor(PositionHint.NONE, SizeHint.NONE, false));
    }

    static RefQuery circleByCenter(String centerLabel, java.util.Set<String> allowedTypes) {
        return new RefQuery(centerLabel, allowedTypes, null, null, centerLabel, new Descriptor(PositionHint.NONE, SizeHint.NONE, false));
    }
}

record LabelPair(String first, String second) {
}

record Descriptor(PositionHint positionHint, SizeHint sizeHint, boolean recent) {
}

enum PositionHint {
    NONE,
    LEFTMOST,
    RIGHTMOST,
    TOPMOST,
    BOTTOMMOST
}

enum SizeHint {
    NONE,
    LARGEST,
    SMALLEST
}

record ResolvedReference(CanvasObject object, String errorMessage, Clarification clarification) {
    static ResolvedReference ok(CanvasObject object) {
        return new ResolvedReference(object, null, null);
    }

    static ResolvedReference error(String errorMessage) {
        return new ResolvedReference(null, errorMessage, null);
    }

    static ResolvedReference clarify(Clarification clarification) {
        return new ResolvedReference(null, null, clarification);
    }

    ResolutionOutcome toOutcome() {
        return new ResolutionOutcome(null, errorMessage, clarification);
    }
}
