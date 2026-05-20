package com.autograph.backend.chat;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

final class GeometryInstructionNormalizer {
    private static final Pattern ANGLE_BISECTOR_SEGMENT_LABEL = Pattern.compile("角平分线\\s*([A-Za-z])\\s*([A-Za-z])");
    private static final Pattern LINE_BY_TWO_POINTS = Pattern.compile("直线\\s*([A-Za-z])\\s*([A-Za-z])");
    private static final Pattern TANGENT_FROM_POINT_TO_CIRCLE = Pattern.compile("过点?\\s*([A-Za-z]).*圆\\s*([A-Za-z]).*切线");

    private GeometryInstructionNormalizer() {
    }

    static List<DrawingInstruction> normalize(List<DrawingInstruction> instructions, String rawText) {
        if (instructions == null || instructions.isEmpty()) {
            return instructions;
        }

        var normalized = instructions;
        if (requestsPerpendicularSegment(rawText) && normalized.size() >= 3) {
            normalized = normalizePerpendicularSegment(normalized);
        }
        if (requestsAngleBisectorSegment(rawText)) {
            normalized = normalizeAngleBisectorSegment(normalized, rawText);
        }
        if (requestsLineByTwoPoints(rawText)) {
            normalized = normalizeLineByTwoPoints(normalized, rawText);
        }
        if (requestsTangentsFromPointToCircle(rawText)) {
            normalized = normalizeTangentsFromPointToCircle(normalized, rawText);
        }
        return normalized;
    }

    private static List<DrawingInstruction> normalizeTangentsFromPointToCircle(List<DrawingInstruction> instructions, String rawText) {
        var request = tangentFromPointToCircle(rawText);
        if (request == null) {
            return instructions;
        }

        var normalized = new ArrayList<DrawingInstruction>();
        var changed = false;
        for (var instruction : instructions) {
            if (!"tangent".equals(instruction.action())) {
                normalized.add(instruction);
                continue;
            }
            var point = stringParam(instruction.params(), "point");
            if (point == null) {
                normalized.add(instruction);
                continue;
            }
            var params = new HashMap<>(instruction.params());
            params.put("point", point);
            var circle = stringParam(instruction.params(), "circle");
            params.put("circle", circle == null ? request.circleLabel() : circle);
            normalized.add(new DrawingInstruction("tangents_from_point_to_circle", params, instruction.resultId(), instruction.label()));
            changed = true;
        }
        return changed ? normalized : instructions;
    }

    private static List<DrawingInstruction> normalizeLineByTwoPoints(List<DrawingInstruction> instructions, String rawText) {
        var lineLabel = lineByTwoPointsLabel(rawText);
        if (lineLabel == null) {
            return instructions;
        }

        var segmentCount = instructions.stream().filter(instruction -> "segment".equals(instruction.action())).count();
        var normalized = new ArrayList<DrawingInstruction>();
        var changed = false;
        for (var instruction : instructions) {
            if (!"segment".equals(instruction.action())) {
                normalized.add(instruction);
                continue;
            }
            var p1 = stringParam(instruction.params(), "p1");
            var p2 = stringParam(instruction.params(), "p2");
            if (segmentCount != 1 && !lineLabel.matches(p1, p2)) {
                normalized.add(instruction);
                continue;
            }
            normalized.add(new DrawingInstruction("line", instruction.params(), instruction.resultId(), instruction.label()));
            changed = true;
        }
        return changed ? normalized : instructions;
    }

    private static List<DrawingInstruction> normalizePerpendicularSegment(List<DrawingInstruction> instructions) {
        var byResultId = new HashMap<String, Integer>();
        var referenceCounts = new HashMap<String, Integer>();
        for (int index = 0; index < instructions.size(); index++) {
            var instruction = instructions.get(index);
            if (instruction.resultId() != null && !instruction.resultId().isBlank()) {
                byResultId.putIfAbsent(instruction.resultId(), index);
            }
            for (var ref : references(instruction)) {
                referenceCounts.merge(ref, 1, Integer::sum);
            }
        }

        var replacements = new HashMap<Integer, DrawingInstruction>();
        var skipped = new HashSet<Integer>();

        for (int index = 0; index < instructions.size(); index++) {
            var finalSegment = instructions.get(index);
            if (!"segment".equals(finalSegment.action())) {
                continue;
            }

            var p1 = stringParam(finalSegment.params(), "p1");
            var p2 = stringParam(finalSegment.params(), "p2");
            if (p1 == null || p2 == null) {
                continue;
            }

            var match = perpendicularFootMatch(instructions, byResultId, referenceCounts, finalSegment, p1, p2)
                .orElseGet(() -> perpendicularFootMatch(instructions, byResultId, referenceCounts, finalSegment, p2, p1).orElse(null));
            if (match == null || skipped.contains(match.perpendicularIndex()) || skipped.contains(match.intersectionIndex())) {
                continue;
            }

            replacements.put(index, match.toInstruction(finalSegment));
            skipped.add(match.perpendicularIndex());
            skipped.add(match.intersectionIndex());
            if (match.helperSegmentIndex() >= 0) {
                skipped.add(match.helperSegmentIndex());
            }
        }

        if (replacements.isEmpty()) {
            return instructions;
        }

        var normalized = new ArrayList<DrawingInstruction>();
        for (int index = 0; index < instructions.size(); index++) {
            if (skipped.contains(index)) {
                continue;
            }
            normalized.add(replacements.getOrDefault(index, instructions.get(index)));
        }
        return normalized;
    }

    private static List<DrawingInstruction> normalizeAngleBisectorSegment(List<DrawingInstruction> instructions, String rawText) {
        var label = angleBisectorSegmentLabel(rawText);
        if (label == null) {
            return instructions;
        }

        var replacements = new HashMap<Integer, DrawingInstruction>();
        var skipped = new HashSet<Integer>();

        for (int index = 0; index < instructions.size(); index++) {
            var bisector = instructions.get(index);
            if (!"bisector".equals(bisector.action()) || bisector.resultId() == null || bisector.resultId().isBlank()) {
                continue;
            }
            var params = angleBisectorSegmentParams(bisector, label);
            if (params == null) {
                continue;
            }

            var segmentIndex = segmentUsingBisectorAsEndpoint(instructions, bisector, params);
            if (segmentIndex >= 0) {
                var segment = instructions.get(segmentIndex);
                replacements.put(segmentIndex, new DrawingInstruction("angle_bisector_segment", params, segment.resultId(), null));
                skipped.add(index);
                continue;
            }

            if (label.matchesResultId(bisector.resultId())) {
                replacements.put(index, new DrawingInstruction(
                    "angle_bisector_segment",
                    params,
                    "segment_" + label.start() + label.end(),
                    null
                ));
            }
        }

        if (replacements.isEmpty()) {
            return instructions;
        }

        var normalized = new ArrayList<DrawingInstruction>();
        for (int index = 0; index < instructions.size(); index++) {
            if (skipped.contains(index)) {
                continue;
            }
            normalized.add(replacements.getOrDefault(index, instructions.get(index)));
        }
        return normalized;
    }

    private static Map<String, Object> angleBisectorSegmentParams(DrawingInstruction bisector, BisectorSegmentLabel label) {
        var p1 = stringParam(bisector.params(), "p1");
        var vertex = stringParam(bisector.params(), "vertex");
        var p2 = stringParam(bisector.params(), "p2");
        if (p1 == null || vertex == null || p2 == null) {
            return null;
        }

        var params = new HashMap<String, Object>();
        params.put("p1", p1);
        params.put("vertex", vertex);
        params.put("p2", p2);
        params.put("endpointResultId", label.endpointFor(vertex));
        params.put("endpointLabel", label.endpointFor(vertex));
        return params;
    }

    private static int segmentUsingBisectorAsEndpoint(
        List<DrawingInstruction> instructions,
        DrawingInstruction bisector,
        Map<String, Object> params
    ) {
        var vertex = stringParam(params, "vertex");
        for (int index = 0; index < instructions.size(); index++) {
            var instruction = instructions.get(index);
            if (!"segment".equals(instruction.action())) {
                continue;
            }
            var p1 = stringParam(instruction.params(), "p1");
            var p2 = stringParam(instruction.params(), "p2");
            if (p1 == null || p2 == null) {
                continue;
            }
            if ((vertex.equals(p1) && bisector.resultId().equals(p2)) || (vertex.equals(p2) && bisector.resultId().equals(p1))) {
                return index;
            }
        }
        return -1;
    }

    private static java.util.Optional<PerpendicularFootMatch> perpendicularFootMatch(
        List<DrawingInstruction> instructions,
        Map<String, Integer> byResultId,
        Map<String, Integer> referenceCounts,
        DrawingInstruction finalSegment,
        String maybeFootId,
        String maybeSourcePoint
    ) {
        var intersectionIndex = byResultId.get(maybeFootId);
        if (intersectionIndex == null) {
            return java.util.Optional.empty();
        }
        var intersection = instructions.get(intersectionIndex);
        if (!"intersection".equals(intersection.action()) || referenceCounts.getOrDefault(maybeFootId, 0) != 1) {
            return java.util.Optional.empty();
        }

        var first = stringParam(intersection.params(), "first");
        var second = stringParam(intersection.params(), "second");
        if (first == null || second == null) {
            return java.util.Optional.empty();
        }

        var firstMatch = perpendicularFor(instructions, byResultId, referenceCounts, first, second, maybeSourcePoint);
        if (firstMatch.isPresent()) {
            return java.util.Optional.of(firstMatch.get().withFoot(intersection, intersectionIndex));
        }
        return perpendicularFor(instructions, byResultId, referenceCounts, second, first, maybeSourcePoint)
            .map(match -> match.withFoot(intersection, intersectionIndex));
    }

    private static java.util.Optional<PerpendicularFootMatch> perpendicularFor(
        List<DrawingInstruction> instructions,
        Map<String, Integer> byResultId,
        Map<String, Integer> referenceCounts,
        String perpendicularId,
        String baseRef,
        String sourcePoint
    ) {
        var perpendicularIndex = byResultId.get(perpendicularId);
        if (perpendicularIndex == null || referenceCounts.getOrDefault(perpendicularId, 0) != 1) {
            return java.util.Optional.empty();
        }
        var perpendicular = instructions.get(perpendicularIndex);
        if (!"perpendicular".equals(perpendicular.action())) {
            return java.util.Optional.empty();
        }
        if (!sourcePoint.equals(stringParam(perpendicular.params(), "point")) || !baseRef.equals(stringParam(perpendicular.params(), "line"))) {
            return java.util.Optional.empty();
        }

        var params = new HashMap<String, Object>();
        params.put("point", sourcePoint);

        var helperSegmentIndex = helperSegmentIndex(instructions, byResultId, referenceCounts, baseRef);
        if (helperSegmentIndex >= 0) {
            var helper = instructions.get(helperSegmentIndex);
            params.put("p1", stringParam(helper.params(), "p1"));
            params.put("p2", stringParam(helper.params(), "p2"));
        } else {
            params.put("segment", baseRef);
        }

        return java.util.Optional.of(new PerpendicularFootMatch(perpendicularIndex, -1, helperSegmentIndex, params));
    }

    private static int helperSegmentIndex(
        List<DrawingInstruction> instructions,
        Map<String, Integer> byResultId,
        Map<String, Integer> referenceCounts,
        String baseRef
    ) {
        var index = byResultId.get(baseRef);
        if (index == null || referenceCounts.getOrDefault(baseRef, 0) != 2) {
            return -1;
        }
        var instruction = instructions.get(index);
        return "segment".equals(instruction.action()) ? index : -1;
    }

    private static boolean requestsPerpendicularSegment(String text) {
        if (text == null) {
            return false;
        }
        return text.contains("垂线段") || text.contains("垂足") || text.contains("高线段");
    }

    private static boolean requestsAngleBisectorSegment(String text) {
        return angleBisectorSegmentLabel(text) != null;
    }

    private static boolean requestsLineByTwoPoints(String text) {
        return lineByTwoPointsLabel(text) != null;
    }

    private static boolean requestsTangentsFromPointToCircle(String text) {
        return tangentFromPointToCircle(text) != null;
    }

    private static TangentFromPointToCircle tangentFromPointToCircle(String text) {
        if (text == null) {
            return null;
        }
        var matcher = TANGENT_FROM_POINT_TO_CIRCLE.matcher(text);
        if (!matcher.find()) {
            return null;
        }
        return new TangentFromPointToCircle(matcher.group(1).toUpperCase(), matcher.group(2).toUpperCase());
    }

    private static LineLabel lineByTwoPointsLabel(String text) {
        if (text == null) {
            return null;
        }
        var matcher = LINE_BY_TWO_POINTS.matcher(text);
        if (!matcher.find()) {
            return null;
        }
        return new LineLabel(matcher.group(1).toUpperCase(), matcher.group(2).toUpperCase());
    }

    private static BisectorSegmentLabel angleBisectorSegmentLabel(String text) {
        if (text == null) {
            return null;
        }
        var matcher = ANGLE_BISECTOR_SEGMENT_LABEL.matcher(text);
        if (!matcher.find()) {
            return null;
        }
        return new BisectorSegmentLabel(matcher.group(1).toUpperCase(), matcher.group(2).toUpperCase());
    }

    private static Set<String> references(DrawingInstruction instruction) {
        if (instruction == null || instruction.params() == null || instruction.params().isEmpty()) {
            return Set.of();
        }
        var refs = new HashSet<String>();
        for (var value : instruction.params().values()) {
            if (value instanceof String ref && !ref.isBlank()) {
                refs.add(ref);
            }
        }
        return refs;
    }

    private static String stringParam(Map<String, Object> params, String key) {
        return params != null && params.get(key) instanceof String value && !value.isBlank() ? value : null;
    }

    private record PerpendicularFootMatch(
        int perpendicularIndex,
        int intersectionIndex,
        int helperSegmentIndex,
        Map<String, Object> params
    ) {
        PerpendicularFootMatch withFoot(DrawingInstruction intersection, int newIntersectionIndex) {
            var nextParams = new HashMap<>(params);
            nextParams.put("footResultId", intersection.resultId());
            if (intersection.label() != null && !intersection.label().isBlank()) {
                nextParams.put("footLabel", intersection.label());
            }
            return new PerpendicularFootMatch(perpendicularIndex, newIntersectionIndex, helperSegmentIndex, nextParams);
        }

        DrawingInstruction toInstruction(DrawingInstruction finalSegment) {
            return new DrawingInstruction("perpendicular_foot_segment", params, finalSegment.resultId(), null);
        }
    }

    private record BisectorSegmentLabel(String start, String end) {
        String endpointFor(String vertex) {
            if (start.equalsIgnoreCase(vertex)) {
                return end;
            }
            if (end.equalsIgnoreCase(vertex)) {
                return start;
            }
            return end;
        }

        boolean matchesResultId(String resultId) {
            if (resultId == null) {
                return false;
            }
            var normalized = resultId.replace("_", "").replace("-", "").toUpperCase();
            return normalized.equals(start + end) || normalized.endsWith(start + end);
        }
    }

    private record LineLabel(String first, String second) {
        boolean matches(String p1, String p2) {
            if (p1 == null || p2 == null) {
                return false;
            }
            return (first.equalsIgnoreCase(p1) && second.equalsIgnoreCase(p2)) ||
                (first.equalsIgnoreCase(p2) && second.equalsIgnoreCase(p1));
        }
    }

    private record TangentFromPointToCircle(String pointLabel, String circleLabel) {
    }
}
