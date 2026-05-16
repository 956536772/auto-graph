package com.autograph.backend.chat;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

final class GeometryCapabilityContract {
    private static final Set<String> SUPPORTED_ACTIONS = Set.of(
        "place_point",
        "segment",
        "midpoint",
        "parallel",
        "perpendicular",
        "circle",
        "circumcircle",
        "incircle",
        "tangent",
        "intersection",
        "otherintersection",
        "polygon",
        "angle",
        "bisector",
        "function_graph",
        "show_axis"
    );

    private GeometryCapabilityContract() {
    }

    static boolean isSupportedBaseAction(String action) {
        return SUPPORTED_ACTIONS.contains(action);
    }

    static ValidationResult validateInstructions(List<DrawingInstruction> instructions) {
        return validateInstructions(instructions, List.of());
    }

    static ValidationResult validateInstructions(List<DrawingInstruction> instructions, List<CanvasObjectPayload> context) {
        var known = new HashMap<String, GeometryObjectInfo>();
        var payloads = context == null ? List.<CanvasObjectPayload>of() : context;
        for (int index = 0; index < payloads.size(); index++) {
            var payload = payloads.get(index);
            if (payload == null || payload.id() == null) {
                continue;
            }
            var object = CanvasObject.from(payload, index);
            known.put(object.id(), GeometryObjectInfo.from(object));
        }
        var resultIds = new HashSet<String>();
        for (var instruction : instructions) {
            var result = validateInstruction(instruction, known, resultIds);
            if (!result.valid()) {
                return result;
            }
        }
        return ValidationResult.ok();
    }

    private static ValidationResult validateInstruction(
        DrawingInstruction instruction,
        Map<String, GeometryObjectInfo> known,
        Set<String> resultIds
    ) {
        if (instruction == null || instruction.action() == null || !SUPPORTED_ACTIONS.contains(instruction.action())) {
            return ValidationResult.invalid("unsupported_action");
        }
        var resultId = instruction.resultId();
        if (resultId == null || resultId.isBlank()) {
            return ValidationResult.invalid("missing_required_param");
        }
        if (known.containsKey(resultId)) {
            return ValidationResult.invalid("duplicate_result_id");
        }
        if (!resultIds.add(resultId)) {
            return ValidationResult.invalid("duplicate_result_id");
        }
        var params = instruction.params() == null ? Map.<String, Object>of() : instruction.params();
        var validation = validateParams(instruction.action(), params, known);
        if (!validation.valid()) {
            return validation;
        }
        known.put(resultId, GeometryObjectInfo.created(instruction.action(), params));
        return ValidationResult.ok();
    }

    private static ValidationResult validateParams(String action, Map<String, Object> params, Map<String, GeometryObjectInfo> known) {
        return switch (action) {
            case "place_point" -> requireNumbers(params, "x", "y");
            case "segment" -> requireRefs(params, known, GeometryChatService.POINT_TYPES, "p1", "p2");
            case "midpoint" -> requireRefs(params, known, GeometryChatService.POINT_TYPES, "p1", "p2");
            case "parallel", "perpendicular" -> requireRefsByType(params, known, Map.of(
                "line", GeometryChatService.LINE_TYPES,
                "point", GeometryChatService.POINT_TYPES
            ));
            case "circle" -> validateCircle(params, known);
            case "circumcircle", "incircle" -> requireRefs(params, known, GeometryChatService.POINT_TYPES, "p1", "p2", "p3");
            case "tangent" -> validateTangent(params, known);
            case "intersection" -> validateIntersection(params, known);
            case "otherintersection" -> validateOtherIntersection(params, known);
            case "polygon" -> validatePolygon(params, known);
            case "bisector", "angle" -> requireRefsByType(params, known, Map.of(
                "p1", GeometryChatService.POINT_TYPES,
                "vertex", GeometryChatService.POINT_TYPES,
                "p2", GeometryChatService.POINT_TYPES
            ));
            case "function_graph" -> validateFunctionGraph(params);
            case "show_axis" -> validateShowAxis(params);
            default -> ValidationResult.invalid("unsupported_action");
        };
    }

    private static ValidationResult validateFunctionGraph(Map<String, Object> params) {
        if (!(params.get("expr") instanceof String expr) || expr.isBlank()) {
            return ValidationResult.invalid("missing_required_param");
        }
        return ValidationResult.ok();
    }

    private static ValidationResult validateShowAxis(Map<String, Object> params) {
        if (params.containsKey("visible") && !(params.get("visible") instanceof Boolean)) {
            return ValidationResult.invalid("invalid_param_shape");
        }
        return ValidationResult.ok();
    }

    private static ValidationResult validateCircle(Map<String, Object> params, Map<String, GeometryObjectInfo> known) {
        if (hasKeys(params, "center", "through")) {
            return requireRefsByType(params, known, Map.of(
                "center", GeometryChatService.POINT_TYPES,
                "through", GeometryChatService.POINT_TYPES
            ));
        }
        if (hasKeys(params, "cx", "cy", "radius")) {
            var numeric = requireNumbers(params, "cx", "cy", "radius");
            if (!numeric.valid()) {
                return numeric;
            }
            return number(params, "radius") > 0 ? ValidationResult.ok() : ValidationResult.invalid("invalid_param_shape");
        }
        return ValidationResult.invalid("missing_required_param");
    }

    private static ValidationResult validateTangent(Map<String, Object> params, Map<String, GeometryObjectInfo> known) {
        var refs = requireRefsByType(params, known, Map.of(
            "circle", GeometryChatService.CIRCLE_TYPES,
            "point", GeometryChatService.POINT_TYPES
        ));
        if (!refs.valid()) {
            return refs;
        }
        var circle = known.get(stringParam(params, "circle"));
        var point = known.get(stringParam(params, "point"));
        if (circle.center() == null || circle.radius() == null || point.position() == null) {
            return ValidationResult.ok();
        }
        var dx = point.position().x() - circle.center().x();
        var dy = point.position().y() - circle.center().y();
        var distance = Math.sqrt(dx * dx + dy * dy);
        return Math.abs(distance - circle.radius()) < 0.75
            ? ValidationResult.ok()
            : ValidationResult.invalid("invalid_geometry");
    }

    private static ValidationResult validateIntersection(Map<String, Object> params, Map<String, GeometryObjectInfo> known) {
        var refs = requireRefsByType(params, known, Map.of(
            "first", intersectableTypes(),
            "second", intersectableTypes()
        ));
        if (!refs.valid()) {
            return refs;
        }
        if (params.containsKey("index") && !(params.get("index") instanceof Number)) {
            return ValidationResult.invalid("invalid_param_shape");
        }
        return ValidationResult.ok();
    }

    private static ValidationResult validateOtherIntersection(Map<String, Object> params, Map<String, GeometryObjectInfo> known) {
        return requireRefsByType(params, known, Map.of(
            "first", intersectableTypes(),
            "second", intersectableTypes(),
            "known", GeometryChatService.POINT_TYPES
        ));
    }

    private static ValidationResult validatePolygon(Map<String, Object> params, Map<String, GeometryObjectInfo> known) {
        if (!(params.get("points") instanceof List<?> points)) {
            return ValidationResult.invalid("missing_required_param");
        }
        if (points.size() < 3) {
            return ValidationResult.invalid("invalid_geometry");
        }
        for (var point : points) {
            if (!(point instanceof String ref)) {
                return ValidationResult.invalid("invalid_param_shape");
            }
            var result = validateReference(ref, known, GeometryChatService.POINT_TYPES);
            if (!result.valid()) {
                return result;
            }
        }
        return ValidationResult.ok();
    }

    private static ValidationResult requireNumbers(Map<String, Object> params, String... keys) {
        for (var key : keys) {
            if (!(params.get(key) instanceof Number)) {
                return ValidationResult.invalid("missing_required_param");
            }
        }
        return ValidationResult.ok();
    }

    private static ValidationResult requireRefs(
        Map<String, Object> params,
        Map<String, GeometryObjectInfo> known,
        Set<String> allowedTypes,
        String... keys
    ) {
        for (var key : keys) {
            var result = validateReference(stringParam(params, key), known, allowedTypes);
            if (!result.valid()) {
                return result;
            }
        }
        return ValidationResult.ok();
    }

    private static ValidationResult requireRefsByType(
        Map<String, Object> params,
        Map<String, GeometryObjectInfo> known,
        Map<String, Set<String>> required
    ) {
        for (var entry : required.entrySet()) {
            var result = validateReference(stringParam(params, entry.getKey()), known, entry.getValue());
            if (!result.valid()) {
                return result;
            }
        }
        return ValidationResult.ok();
    }

    private static ValidationResult validateReference(String ref, Map<String, GeometryObjectInfo> known, Set<String> allowedTypes) {
        if (ref == null || ref.isBlank()) {
            return ValidationResult.invalid("missing_required_param");
        }
        var object = known.get(ref);
        if (object == null) {
            var candidates = candidatesByLabel(ref, known, allowedTypes);
            if (!candidates.isEmpty()) {
                return ValidationResult.clarify(Clarification.fromCandidates("我不确定你指的是哪一个对象，请明确说出对象 ID。", candidates));
            }
            return ValidationResult.invalid("unknown_reference");
        }
        return allowedTypes.contains(object.type())
            ? ValidationResult.ok()
            : ValidationResult.invalid("invalid_object_type");
    }

    private static List<CanvasObject> candidatesByLabel(String label, Map<String, GeometryObjectInfo> known, Set<String> allowedTypes) {
        return known.values().stream()
            .filter(info -> allowedTypes.contains(info.type()))
            .map(GeometryObjectInfo::source)
            .filter(Objects::nonNull)
            .filter(object -> label.equalsIgnoreCase(Objects.toString(object.label(), "")))
            .toList();
    }

    private static Set<String> intersectableTypes() {
        var types = new HashSet<String>();
        types.addAll(GeometryChatService.LINE_TYPES);
        types.addAll(GeometryChatService.CIRCLE_TYPES);
        return types;
    }

    private static boolean hasKeys(Map<String, Object> params, String... keys) {
        for (var key : keys) {
            if (!params.containsKey(key)) {
                return false;
            }
        }
        return true;
    }

    private static String stringParam(Map<String, Object> params, String key) {
        return params.get(key) instanceof String value ? value : null;
    }

    private static double number(Map<String, Object> params, String key) {
        return ((Number) params.get(key)).doubleValue();
    }
}

record ValidationResult(boolean valid, String reason, Clarification clarification) {
    static ValidationResult ok() {
        return new ValidationResult(true, null, null);
    }

    static ValidationResult invalid(String reason) {
        return new ValidationResult(false, reason, null);
    }

    static ValidationResult clarify(Clarification clarification) {
        return new ValidationResult(false, "clarification", clarification);
    }
}

record GeometryObjectInfo(String type, Anchor position, Anchor center, Double radius, CanvasObject source) {
    static GeometryObjectInfo from(CanvasObject object) {
        return new GeometryObjectInfo(object.type(), object.anchor(), object.center(), object.radius(), object);
    }

    static GeometryObjectInfo created(String action, Map<String, Object> params) {
        return switch (action) {
            case "place_point" -> new GeometryObjectInfo("point", new Anchor(number(params, "x"), number(params, "y")), null, null, null);
            case "midpoint", "intersection", "otherintersection" -> new GeometryObjectInfo("point", null, null, null, null);
            case "segment", "parallel", "perpendicular", "tangent", "bisector" -> new GeometryObjectInfo(action, null, null, null, null);
            case "circle" -> circleInfo(params);
            case "circumcircle", "incircle" -> new GeometryObjectInfo(action, null, null, null, null);
            case "function_graph" -> new GeometryObjectInfo("functiongraph", null, null, null, null);
            case "polygon" -> new GeometryObjectInfo("polygon", null, null, null, null);
            case "angle" -> new GeometryObjectInfo("angle", null, null, null, null);
            default -> new GeometryObjectInfo(action, null, null, null, null);
        };
    }

    private static GeometryObjectInfo circleInfo(Map<String, Object> params) {
        if (params.get("cx") instanceof Number cx && params.get("cy") instanceof Number cy && params.get("radius") instanceof Number radius) {
            return new GeometryObjectInfo("circle", null, new Anchor(cx.doubleValue(), cy.doubleValue()), radius.doubleValue(), null);
        }
        return new GeometryObjectInfo("circle", null, null, null, null);
    }

    private static double number(Map<String, Object> params, String key) {
        return ((Number) params.get(key)).doubleValue();
    }
}
