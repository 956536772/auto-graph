package com.autograph.backend.chat;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

final class GeometryInstructionExpander {
    private static final Set<String> HIGH_LEVEL_ACTIONS = Set.of(
        "line_through_points",
        "point_on_segment",
        "point_on_line",
        "point_on_circle",
        "parallel_through_point_to_segment",
        "perpendicular_through_point_to_segment",
        "perpendicular_foot_segment",
        "angle_bisector_segment",
        "divide_segment",
        "point_by_ratio",
        "translate_point",
        "equal_length_point",
        "regular_polygon",
        "constraint_polygon"
    );

    private static final double DEFAULT_LINE_OFFSET = 2.0d;
    private static final double DEFAULT_CIRCLE_ANGLE = Math.PI / 4.0d;

    private GeometryInstructionExpander() {
    }

    static ExpansionResult expand(List<DrawingInstruction> instructions, List<CanvasObjectPayload> context) {
        var state = ExpansionState.from(context);
        var output = new ArrayList<DrawingInstruction>();
        var notes = new ArrayList<String>();
        var source = instructions == null ? List.<DrawingInstruction>of() : instructions;
        for (var instruction : source) {
            var expanded = expandOne(instruction, state);
            if (!expanded.valid()) {
                return ExpansionResult.invalid(expanded.reason(), expanded.clarification());
            }
            output.addAll(expanded.instructions());
            notes.addAll(expanded.notes());
        }
        return ExpansionResult.ok(output, notes);
    }

    static boolean isHighLevelAction(String action) {
        return HIGH_LEVEL_ACTIONS.contains(action);
    }

    private static StepExpansion expandOne(DrawingInstruction instruction, ExpansionState state) {
        if (instruction == null || instruction.action() == null) {
            return StepExpansion.invalid("unsupported_action");
        }
        if (GeometryCapabilityContract.isSupportedBaseAction(instruction.action())) {
            return state.addBase(instruction);
        }
        if (!isHighLevelAction(instruction.action())) {
            return StepExpansion.invalid("unsupported_action");
        }

        return switch (instruction.action()) {
            case "line_through_points" -> lineThroughPoints(instruction, state);
            case "point_on_segment" -> pointOnSegment(instruction, state);
            case "point_on_line" -> pointOnLine(instruction, state);
            case "point_on_circle" -> pointOnCircle(instruction, state);
            case "parallel_through_point_to_segment" -> lineThroughPointToSegment(instruction, state, "parallel");
            case "perpendicular_through_point_to_segment" -> lineThroughPointToSegment(instruction, state, "perpendicular");
            case "perpendicular_foot_segment" -> perpendicularFootSegment(instruction, state);
            case "angle_bisector_segment" -> angleBisectorSegment(instruction, state);
            case "divide_segment" -> divideSegment(instruction, state);
            case "point_by_ratio" -> pointByRatio(instruction, state);
            case "translate_point" -> translatePoint(instruction, state);
            case "equal_length_point" -> equalLengthPoint(instruction, state);
            case "regular_polygon" -> regularPolygon(instruction, state);
            case "constraint_polygon" -> constraintPolygon(instruction, state);
            default -> StepExpansion.invalid("unsupported_action");
        };
    }

    private static StepExpansion lineThroughPoints(DrawingInstruction instruction, ExpansionState state) {
        var params = params(instruction);
        var p1 = stringParam(params, "p1").orElse(stringParam(params, "point1").orElse(null));
        var p2 = stringParam(params, "p2").orElse(stringParam(params, "point2").orElse(null));
        if (p1 == null || p2 == null) {
            return StepExpansion.invalid("missing_required_param");
        }
        return state.addBase(new DrawingInstruction("segment", Map.of("p1", p1, "p2", p2), instruction.resultId(), null));
    }

    private static StepExpansion pointOnSegment(DrawingInstruction instruction, ExpansionState state) {
        var params = params(instruction);
        var endpoints = state.segmentEndpoints(stringParam(params, "segment").orElse(null), params);
        if (endpoints.isEmpty()) {
            return StepExpansion.invalid("missing_required_param");
        }
        var ratio = numberParam(params, "ratio").orElse(0.5d);
        return placeInterpolatedPoint(instruction, state, endpoints.get().p1(), endpoints.get().p2(), ratio, "point_on_segment", true);
    }

    private static StepExpansion pointOnLine(DrawingInstruction instruction, ExpansionState state) {
        var params = params(instruction);
        var lineId = stringParam(params, "line").orElse(null);
        var endpoints = state.lineEndpoints(lineId, params);
        if (endpoints.isPresent()) {
            var ratio = numberParam(params, "ratio").orElse(0.5d);
            return placeInterpolatedPoint(instruction, state, endpoints.get().p1(), endpoints.get().p2(), ratio, "point_on_line", true);
        }
        var through = stringParam(params, "through").orElse(stringParam(params, "point").orElse(null));
        var anchor = state.anchor(through).orElse(null);
        if (anchor == null) {
            return StepExpansion.invalid("missing_required_param");
        }
        var offset = pointFromOffset(params, DEFAULT_LINE_OFFSET, 0);
        return state.addBase(placePoint(instruction, anchor.x() + offset.x(), anchor.y() + offset.y()));
    }

    private static StepExpansion pointOnCircle(DrawingInstruction instruction, ExpansionState state) {
        var params = params(instruction);
        var circle = state.circle(stringParam(params, "circle").orElse(null)).orElse(null);
        if (circle == null || circle.center() == null || circle.radius() == null) {
            return StepExpansion.invalid("missing_required_param");
        }
        var angle = numberParam(params, "angle").orElse(DEFAULT_CIRCLE_ANGLE);
        return state.addBase(placePoint(
            instruction,
            circle.center().x() + circle.radius() * Math.cos(angle),
            circle.center().y() + circle.radius() * Math.sin(angle)
        ));
    }

    private static StepExpansion lineThroughPointToSegment(DrawingInstruction instruction, ExpansionState state, String action) {
        var params = params(instruction);
        var point = stringParam(params, "point").orElse(null);
        var segment = stringParam(params, "segment").orElse(null);
        if (point == null || segment == null) {
            return StepExpansion.invalid("missing_required_param");
        }
        return state.addBase(new DrawingInstruction(action, Map.of("line", segment, "point", point), instruction.resultId(), null));
    }

    private static StepExpansion perpendicularFootSegment(DrawingInstruction instruction, ExpansionState state) {
        var params = params(instruction);
        var pointRef = stringParam(params, "point").orElse(null);
        var footResultId = stringParam(params, "footResultId").orElse(null);
        if (pointRef == null || footResultId == null) {
            return StepExpansion.invalid("missing_required_param");
        }

        var baseRef = stringParam(params, "segment").orElse(stringParam(params, "line").orElse(null));
        var endpoints = state.segmentEndpoints(baseRef, params);
        if (endpoints.isEmpty()) {
            return StepExpansion.invalid("missing_required_param");
        }

        var point = state.anchor(pointRef).orElse(null);
        var baseStart = state.anchor(endpoints.get().p1()).orElse(null);
        var baseEnd = state.anchor(endpoints.get().p2()).orElse(null);
        if (point == null || baseStart == null || baseEnd == null) {
            return StepExpansion.invalid("missing_required_param");
        }

        var dx = baseEnd.x() - baseStart.x();
        var dy = baseEnd.y() - baseStart.y();
        var lengthSquared = dx * dx + dy * dy;
        if (lengthSquared < 0.000001d) {
            return StepExpansion.invalid("invalid_geometry");
        }

        var ratio = ((point.x() - baseStart.x()) * dx + (point.y() - baseStart.y()) * dy) / lengthSquared;
        var footX = baseStart.x() + ratio * dx;
        var footY = baseStart.y() + ratio * dy;
        var footLabel = stringParam(params, "footLabel").orElse(instruction.label());

        var foot = state.addBase(new DrawingInstruction(
            "place_point",
            Map.of("x", round(footX), "y", round(footY)),
            footResultId,
            footLabel
        ));
        if (!foot.valid()) {
            return foot;
        }

        var segment = state.addBase(new DrawingInstruction(
            "segment",
            Map.of("p1", pointRef, "p2", footResultId),
            instruction.resultId(),
            null
        ));
        if (!segment.valid()) {
            return segment;
        }

        var output = new ArrayList<DrawingInstruction>();
        output.addAll(foot.instructions());
        output.addAll(segment.instructions());
        return StepExpansion.ok(output, List.of());
    }

    private static StepExpansion angleBisectorSegment(DrawingInstruction instruction, ExpansionState state) {
        var params = params(instruction);
        var p1Ref = stringParam(params, "p1").orElse(null);
        var vertexRef = stringParam(params, "vertex").orElse(null);
        var p2Ref = stringParam(params, "p2").orElse(null);
        var endpointResultId = stringParam(params, "endpointResultId").orElse(null);
        if (p1Ref == null || vertexRef == null || p2Ref == null || endpointResultId == null) {
            return StepExpansion.invalid("missing_required_param");
        }

        var p1 = state.anchor(p1Ref).orElse(null);
        var vertex = state.anchor(vertexRef).orElse(null);
        var p2 = state.anchor(p2Ref).orElse(null);
        if (p1 == null || vertex == null || p2 == null) {
            return StepExpansion.invalid("missing_required_param");
        }

        var vertexToP1 = distance(vertex, p1);
        var vertexToP2 = distance(vertex, p2);
        if (vertexToP1 < 0.000001d || vertexToP2 < 0.000001d) {
            return StepExpansion.invalid("invalid_geometry");
        }

        var endpointX = (vertexToP2 * p1.x() + vertexToP1 * p2.x()) / (vertexToP1 + vertexToP2);
        var endpointY = (vertexToP2 * p1.y() + vertexToP1 * p2.y()) / (vertexToP1 + vertexToP2);
        var endpointLabel = stringParam(params, "endpointLabel").orElse(instruction.label());

        var endpoint = state.addBase(new DrawingInstruction(
            "place_point",
            Map.of("x", round(endpointX), "y", round(endpointY)),
            endpointResultId,
            endpointLabel
        ));
        if (!endpoint.valid()) {
            return endpoint;
        }

        var segment = state.addBase(new DrawingInstruction(
            "segment",
            Map.of("p1", vertexRef, "p2", endpointResultId),
            instruction.resultId(),
            null
        ));
        if (!segment.valid()) {
            return segment;
        }

        var output = new ArrayList<DrawingInstruction>();
        output.addAll(endpoint.instructions());
        output.addAll(segment.instructions());
        return StepExpansion.ok(output, List.of());
    }

    private static StepExpansion divideSegment(DrawingInstruction instruction, ExpansionState state) {
        var params = params(instruction);
        var endpoints = state.segmentEndpoints(stringParam(params, "segment").orElse(null), params);
        var parts = positiveIntParam(params, "parts").orElse(0);
        if (endpoints.isEmpty() || parts < 2) {
            return StepExpansion.invalid("missing_required_param");
        }
        var labels = stringListParam(params, "labels");
        var output = new ArrayList<DrawingInstruction>();
        var notes = new ArrayList<String>();
        for (var index = 1; index < parts; index++) {
            var resultId = index == 1 ? instruction.resultId() : "%s_%d".formatted(instruction.resultId(), index);
            var label = index - 1 < labels.size() ? labels.get(index - 1) : index == 1 ? instruction.label() : null;
            var point = new DrawingInstruction(
                "place_point",
                Map.of(),
                resultId,
                label
            );
            var expanded = placeInterpolatedPoint(point, state, endpoints.get().p1(), endpoints.get().p2(), index / (double) parts, "divide_segment", false);
            if (!expanded.valid()) {
                return expanded;
            }
            output.addAll(expanded.instructions());
        }
        notes.add("已按等分比例近似放置分点。");
        return StepExpansion.ok(output, notes);
    }

    private static StepExpansion pointByRatio(DrawingInstruction instruction, ExpansionState state) {
        var params = params(instruction);
        var p1 = stringParam(params, "p1").orElse(stringParam(params, "from").orElse(null));
        var p2 = stringParam(params, "p2").orElse(stringParam(params, "to").orElse(null));
        var ratio = numberParam(params, "ratio").orElse(null);
        if (p1 == null || p2 == null || ratio == null) {
            return StepExpansion.invalid("missing_required_param");
        }
        return placeInterpolatedPoint(instruction, state, p1, p2, ratio, "point_by_ratio", true);
    }

    private static StepExpansion translatePoint(DrawingInstruction instruction, ExpansionState state) {
        var params = params(instruction);
        var point = state.anchor(stringParam(params, "point").orElse(null)).orElse(null);
        if (point == null) {
            return StepExpansion.invalid("missing_required_param");
        }
        var vector = translateVector(params, state).orElse(null);
        if (vector == null) {
            return StepExpansion.invalid("missing_required_param");
        }
        return state.addBase(placePoint(instruction, point.x() + vector.x(), point.y() + vector.y()));
    }

    private static StepExpansion equalLengthPoint(DrawingInstruction instruction, ExpansionState state) {
        var params = params(instruction);
        var from = state.anchor(stringParam(params, "from").orElse(stringParam(params, "point").orElse(null))).orElse(null);
        var base = state.segmentEndpoints(stringParam(params, "segment").orElse(null), params).orElse(null);
        if (from == null || base == null) {
            return StepExpansion.invalid("missing_required_param");
        }
        var p1 = state.anchor(base.p1()).orElse(null);
        var p2 = state.anchor(base.p2()).orElse(null);
        if (p1 == null || p2 == null) {
            return StepExpansion.invalid("missing_required_param");
        }
        var direction = directionVector(params, state).orElse(new Vector(1, 0));
        var unit = direction.unitOrDefault();
        var length = distance(p1, p2);
        return state.addBase(placePoint(instruction, from.x() + unit.x() * length, from.y() + unit.y() * length));
    }

    private static StepExpansion regularPolygon(DrawingInstruction instruction, ExpansionState state) {
        var params = params(instruction);
        var sides = positiveIntParam(params, "sides").orElse(0);
        if (sides < 3) {
            return StepExpansion.invalid("missing_required_param");
        }
        var labels = stringListParam(params, "labels");
        var output = new ArrayList<DrawingInstruction>();
        var vertices = new ArrayList<String>();
        var center = centerFromParams(params, state).orElse(new Anchor(0, 0));
        var radius = numberParam(params, "radius").orElse(2.0d);
        var startAngle = numberParam(params, "startAngle").orElse(Math.PI / 2.0d);
        for (var index = 0; index < sides; index++) {
            var label = index < labels.size() ? labels.get(index) : null;
            var vertexId = vertexId(instruction, label, index);
            var angle = startAngle - (2.0d * Math.PI * index / sides);
            var step = state.addBase(new DrawingInstruction(
                "place_point",
                Map.of(
                    "x", round(center.x() + radius * Math.cos(angle)),
                    "y", round(center.y() + radius * Math.sin(angle))
                ),
                vertexId,
                label
            ));
            if (!step.valid()) {
                return step;
            }
            output.addAll(step.instructions());
            vertices.add(vertexId);
        }
        var polygonId = instruction.resultId();
        var polygon = state.addBase(new DrawingInstruction("polygon", Map.of("points", vertices), polygonId, null));
        if (!polygon.valid()) {
            return polygon;
        }
        output.addAll(polygon.instructions());
        return StepExpansion.ok(output, List.of("已按正多边形规则近似生成顶点布局。"));
    }

    private static StepExpansion constraintPolygon(DrawingInstruction instruction, ExpansionState state) {
        var params = params(instruction);
        var labels = stringListParam(params, "labels");
        if (labels.size() < 3) {
            return StepExpansion.invalid("missing_required_param");
        }
        var output = new ArrayList<DrawingInstruction>();
        var vertices = new ArrayList<String>();
        var center = centerFromParams(params, state).orElse(new Anchor(0, 0));
        var radius = numberParam(params, "radius").orElse(Math.max(2.0d, labels.size() * 0.35d));
        for (var index = 0; index < labels.size(); index++) {
            var label = labels.get(index);
            var vertexId = vertexId(instruction, label, index);
            var angle = Math.PI / 2.0d - (2.0d * Math.PI * index / labels.size());
            var step = state.addBase(new DrawingInstruction(
                "place_point",
                Map.of(
                    "x", round(center.x() + radius * Math.cos(angle)),
                    "y", round(center.y() + radius * Math.sin(angle))
                ),
                vertexId,
                label
            ));
            if (!step.valid()) {
                return step;
            }
            output.addAll(step.instructions());
            vertices.add(vertexId);
        }
        var polygon = state.addBase(new DrawingInstruction("polygon", Map.of("points", vertices), instruction.resultId(), null));
        if (!polygon.valid()) {
            return polygon;
        }
        output.addAll(polygon.instructions());
        return StepExpansion.ok(output, List.of("已根据约束提取多边形骨架，部分复杂约束以近似布局呈现。"));
    }

    private static StepExpansion placeInterpolatedPoint(
        DrawingInstruction instruction,
        ExpansionState state,
        String p1Ref,
        String p2Ref,
        double ratio,
        String source,
        boolean noteApproximation
    ) {
        var p1 = state.anchor(p1Ref).orElse(null);
        var p2 = state.anchor(p2Ref).orElse(null);
        if (p1 == null || p2 == null) {
            return StepExpansion.invalid("missing_required_param");
        }
        var step = state.addBase(placePoint(
            instruction,
            p1.x() + (p2.x() - p1.x()) * ratio,
            p1.y() + (p2.y() - p1.y()) * ratio
        ));
        if (!step.valid() || !noteApproximation) {
            return step;
        }
        return StepExpansion.ok(step.instructions(), List.of("%s 已按坐标比例近似放置。".formatted(source)));
    }

    private static DrawingInstruction placePoint(DrawingInstruction source, double x, double y) {
        return new DrawingInstruction(
            "place_point",
            Map.of("x", round(x), "y", round(y)),
            source.resultId(),
            source.label()
        );
    }

    private static Optional<Vector> translateVector(Map<String, Object> params, ExpansionState state) {
        var dx = numberParam(params, "dx");
        var dy = numberParam(params, "dy");
        if (dx.isPresent() && dy.isPresent()) {
            return Optional.of(new Vector(dx.get(), dy.get()));
        }
        var from = state.anchor(stringParam(params, "vectorFrom").orElse(null)).orElse(null);
        var to = state.anchor(stringParam(params, "vectorTo").orElse(null)).orElse(null);
        if (from != null && to != null) {
            return Optional.of(new Vector(to.x() - from.x(), to.y() - from.y()));
        }
        return Optional.empty();
    }

    private static Optional<Vector> directionVector(Map<String, Object> params, ExpansionState state) {
        var dx = numberParam(params, "dx");
        var dy = numberParam(params, "dy");
        if (dx.isPresent() && dy.isPresent()) {
            return Optional.of(new Vector(dx.get(), dy.get()));
        }
        var from = state.anchor(stringParam(params, "directionFrom").orElse(null)).orElse(null);
        var to = state.anchor(stringParam(params, "directionTo").orElse(null)).orElse(null);
        if (from != null && to != null) {
            return Optional.of(new Vector(to.x() - from.x(), to.y() - from.y()));
        }
        return Optional.empty();
    }

    private static Optional<Anchor> centerFromParams(Map<String, Object> params, ExpansionState state) {
        var cx = numberParam(params, "cx");
        var cy = numberParam(params, "cy");
        if (cx.isPresent() && cy.isPresent()) {
            return Optional.of(new Anchor(cx.get(), cy.get()));
        }
        return state.anchor(stringParam(params, "center").orElse(null));
    }

    private static Vector pointFromOffset(Map<String, Object> params, double defaultX, double defaultY) {
        return new Vector(numberParam(params, "dx").orElse(defaultX), numberParam(params, "dy").orElse(defaultY));
    }

    private static String vertexId(DrawingInstruction instruction, String label, int index) {
        if (label != null && !label.isBlank()) {
            return label;
        }
        return "%s_%d".formatted(instruction.resultId(), index + 1);
    }

    private static Map<String, Object> params(DrawingInstruction instruction) {
        return instruction.params() == null ? Map.of() : instruction.params();
    }

    private static Optional<String> stringParam(Map<String, Object> params, String key) {
        return params.get(key) instanceof String value && !value.isBlank() ? Optional.of(value) : Optional.empty();
    }

    private static Optional<Double> numberParam(Map<String, Object> params, String key) {
        return params.get(key) instanceof Number value ? Optional.of(value.doubleValue()) : Optional.empty();
    }

    private static Optional<Integer> positiveIntParam(Map<String, Object> params, String key) {
        return params.get(key) instanceof Number value && value.intValue() > 0 ? Optional.of(value.intValue()) : Optional.empty();
    }

    private static List<String> stringListParam(Map<String, Object> params, String key) {
        if (!(params.get(key) instanceof List<?> values)) {
            return List.of();
        }
        return values.stream()
            .filter(String.class::isInstance)
            .map(String.class::cast)
            .filter(value -> !value.isBlank())
            .toList();
    }

    private static double distance(Anchor p1, Anchor p2) {
        var dx = p2.x() - p1.x();
        var dy = p2.y() - p1.y();
        return Math.sqrt(dx * dx + dy * dy);
    }

    private static double round(double value) {
        return Math.round(value * 1000.0d) / 1000.0d;
    }

    record ExpansionResult(boolean valid, List<DrawingInstruction> instructions, List<String> notes, String reason, Clarification clarification) {
        static ExpansionResult ok(List<DrawingInstruction> instructions, List<String> notes) {
            return new ExpansionResult(true, instructions, notes, null, null);
        }

        static ExpansionResult invalid(String reason, Clarification clarification) {
            return new ExpansionResult(false, List.of(), List.of(), reason, clarification);
        }
    }

    private record StepExpansion(boolean valid, List<DrawingInstruction> instructions, List<String> notes, String reason, Clarification clarification) {
        static StepExpansion ok(List<DrawingInstruction> instructions, List<String> notes) {
            return new StepExpansion(true, instructions, notes, null, null);
        }

        static StepExpansion invalid(String reason) {
            return new StepExpansion(false, List.of(), List.of(), reason, null);
        }
    }

    private record SegmentRefs(String p1, String p2) {
    }

    private record CircleInfo(Anchor center, Double radius) {
    }

    private record Vector(double x, double y) {
        Vector unitOrDefault() {
            var length = Math.sqrt(x * x + y * y);
            if (length < 0.000001d) {
                return new Vector(1, 0);
            }
            return new Vector(x / length, y / length);
        }
    }

    private static final class ExpansionState {
        private final Map<String, ObjectInfo> known = new HashMap<>();
        private final Set<String> createdIds = new HashSet<>();

        static ExpansionState from(List<CanvasObjectPayload> context) {
            var state = new ExpansionState();
            var payloads = context == null ? List.<CanvasObjectPayload>of() : context;
            for (int index = 0; index < payloads.size(); index++) {
                var payload = payloads.get(index);
                if (payload == null || payload.id() == null || payload.id().isBlank()) {
                    continue;
                }
                var object = CanvasObject.from(payload, index);
                state.known.put(object.id(), ObjectInfo.from(object));
            }
            return state;
        }

        StepExpansion addBase(DrawingInstruction instruction) {
            if (instruction.resultId() == null || instruction.resultId().isBlank()) {
                return StepExpansion.invalid("missing_required_param");
            }
            if (known.containsKey(instruction.resultId()) || !createdIds.add(instruction.resultId())) {
                return StepExpansion.invalid("duplicate_result_id");
            }
            known.put(instruction.resultId(), ObjectInfo.created(instruction, this));
            return StepExpansion.ok(List.of(instruction), List.of());
        }

        Optional<Anchor> anchor(String ref) {
            if (ref == null) return Optional.empty();
            var info = known.get(ref);
            if (info != null) {
                return Optional.ofNullable(info.anchor());
            }
            var candidates = candidatesByLabel(ref, GeometryChatService.POINT_TYPES);
            return candidates.size() == 1 ? Optional.ofNullable(candidates.get(0).anchor()) : Optional.empty();
        }

        Optional<CircleInfo> circle(String ref) {
            if (ref == null) return Optional.empty();
            var info = known.get(ref);
            if (info != null && info.center() != null && info.radius() != null) {
                return Optional.of(new CircleInfo(info.center(), info.radius()));
            }
            var candidates = candidatesByLabel(ref, GeometryChatService.CIRCLE_TYPES);
            return candidates.size() == 1 ? Optional.of(new CircleInfo(candidates.get(0).center(), candidates.get(0).radius())) : Optional.empty();
        }

        private List<ObjectInfo> candidatesByLabel(String label, Set<String> allowedTypes) {
            return known.values().stream()
                .filter(info -> allowedTypes.contains(info.type()))
                .filter(info -> label.equalsIgnoreCase(java.util.Objects.toString(info.label(), "")))
                .toList();
        }

        Optional<SegmentRefs> segmentEndpoints(String segmentId, Map<String, Object> params) {
            if (segmentId != null) {
                var info = known.get(segmentId);
                if (info != null && info.endpoints() != null) {
                    return Optional.of(info.endpoints());
                }
            }
            var p1 = stringParam(params, "p1").orElse(stringParam(params, "from").orElse(null));
            var p2 = stringParam(params, "p2").orElse(stringParam(params, "to").orElse(null));
            return p1 == null || p2 == null ? Optional.empty() : Optional.of(new SegmentRefs(p1, p2));
        }

        Optional<SegmentRefs> lineEndpoints(String lineId, Map<String, Object> params) {
            if (lineId != null) {
                var info = known.get(lineId);
                if (info != null && info.endpoints() != null) {
                    return Optional.of(info.endpoints());
                }
            }
            var p1 = stringParam(params, "p1").orElse(null);
            var p2 = stringParam(params, "p2").orElse(null);
            return p1 == null || p2 == null ? Optional.empty() : Optional.of(new SegmentRefs(p1, p2));
        }
    }

    private record ObjectInfo(String type, String label, Anchor anchor, Anchor center, Double radius, SegmentRefs endpoints) {
        static ObjectInfo from(CanvasObject object) {
            return new ObjectInfo(
                object.type(),
                object.label(),
                object.anchor(),
                object.center(),
                object.radius(),
                object.endpointRefs().size() == 2 ? new SegmentRefs(object.endpointRefs().get(0), object.endpointRefs().get(1)) : null
            );
        }

        static ObjectInfo created(DrawingInstruction instruction, ExpansionState state) {
            var params = params(instruction);
            return switch (instruction.action()) {
                case "place_point" -> new ObjectInfo(
                    "point",
                    instruction.label(),
                    new Anchor(numberParam(params, "x").orElse(0d), numberParam(params, "y").orElse(0d)),
                    null,
                    null,
                    null
                );
                case "segment" -> new ObjectInfo(
                    "segment",
                    instruction.label(),
                    null,
                    null,
                    null,
                    new SegmentRefs(
                        stringParam(params, "p1").orElse(""),
                        stringParam(params, "p2").orElse("")
                    )
                );
                case "circle" -> circleInfo(instruction, params, state);
                case "polygon" -> new ObjectInfo("polygon", instruction.label(), null, null, null, null);
                case "midpoint", "intersection", "otherintersection" -> new ObjectInfo("point", instruction.label(), null, null, null, null);
                case "parallel", "perpendicular", "tangent", "bisector" -> new ObjectInfo(instruction.action(), instruction.label(), null, null, null, null);
                case "circumcircle", "incircle" -> new ObjectInfo(instruction.action(), instruction.label(), null, null, null, null);
                case "angle" -> new ObjectInfo("angle", instruction.label(), null, null, null, null);
                default -> new ObjectInfo(instruction.action(), instruction.label(), null, null, null, null);
            };
        }

        private static ObjectInfo circleInfo(DrawingInstruction instruction, Map<String, Object> params, ExpansionState state) {
            var cx = numberParam(params, "cx");
            var cy = numberParam(params, "cy");
            var radius = numberParam(params, "radius");
            if (cx.isPresent() && cy.isPresent() && radius.isPresent()) {
                return new ObjectInfo("circle", instruction.label(), null, new Anchor(cx.get(), cy.get()), radius.get(), null);
            }
            var center = state.anchor(stringParam(params, "center").orElse(null)).orElse(null);
            var through = state.anchor(stringParam(params, "through").orElse(null)).orElse(null);
            if (center != null && through != null) {
                return new ObjectInfo("circle", instruction.label(), null, center, distance(center, through), null);
            }
            return new ObjectInfo("circle", instruction.label(), null, null, null, null);
        }
    }
}
