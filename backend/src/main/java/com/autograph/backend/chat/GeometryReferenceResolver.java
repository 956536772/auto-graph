package com.autograph.backend.chat;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Resolves object labels to internal IDs in drawing instructions.
 * This should be called before expansion and validation to ensure that
 * instructions generated using names (labels) can be correctly mapped to
 * existing or newly created objects.
 */
final class GeometryReferenceResolver {
    private GeometryReferenceResolver() {
    }

    /**
     * Resolves labels to IDs for a list of instructions.
     * Updates label-to-ID mapping as it processes instructions to allow
     * forward-referencing by label within the same response.
     */
    static List<DrawingInstruction> resolve(List<DrawingInstruction> instructions, List<CanvasObjectPayload> context) {
        if (instructions == null || instructions.isEmpty()) {
            return instructions;
        }

        // Map labels (case-insensitive) to IDs from existing context
        var labelToId = new HashMap<String, List<String>>();
        if (context != null) {
            for (var obj : context) {
                if (obj.label() != null && !obj.label().isBlank()) {
                    labelToId.computeIfAbsent(obj.label().toUpperCase(), k -> new ArrayList<>()).add(obj.id());
                }
            }
        }

        var resolvedInstructions = new ArrayList<DrawingInstruction>();
        var currentLabelToId = new HashMap<>(labelToId);

        for (var instruction : instructions) {
            var params = instruction.params() == null ? new HashMap<String, Object>() : new HashMap<>(instruction.params());
            resolveParams(params, currentLabelToId);
            
            var resolved = new DrawingInstruction(
                instruction.action(),
                params,
                instruction.resultId(),
                instruction.label()
            );
            resolvedInstructions.add(resolved);

            // Update mapping for points created in this turn
            if (resolved.label() != null && !resolved.label().isBlank() && resolved.resultId() != null) {
                currentLabelToId.computeIfAbsent(resolved.label().toUpperCase(), k -> new ArrayList<>()).add(resolved.resultId());
            }
        }
        return resolvedInstructions;
    }

    private static void resolveParams(Map<String, Object> params, Map<String, List<String>> labelToId) {
        // Exhaustive list of keys that might contain object references across all actions
        String[] referenceKeys = {
            "p1", "p2", "p3", "vertex", "center", "through", "point", "line", "circle", "segment",
            "from", "to", "point1", "point2", "first", "second", "known", "vectorFrom", "vectorTo",
            "directionFrom", "directionTo"
        };

        for (var key : referenceKeys) {
            resolveRef(params, key, labelToId);
        }

        // Handle list-based references (e.g., polygon points, divide_segment labels)
        if (params.get("points") instanceof List<?> list) {
            var resolved = list.stream()
                .map(item -> item instanceof String s ? resolveLabel(s, labelToId) : item)
                .toList();
            params.put("points", resolved);
        }
    }

    private static void resolveRef(Map<String, Object> params, String key, Map<String, List<String>> labelToId) {
        if (params.get(key) instanceof String value) {
            params.put(key, resolveLabel(value, labelToId));
        }
    }

    private static String resolveLabel(String label, Map<String, List<String>> labelToId) {
        if (label == null || label.isBlank()) {
            return label;
        }
        var ids = labelToId.get(label.toUpperCase());
        // Only resolve if the label matches exactly one object to avoid ambiguity
        if (ids != null && ids.size() == 1) {
            return ids.get(0);
        }
        return label;
    }
}
