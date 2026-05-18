package com.autograph.backend.chat;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

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

        var index = new ReferenceIndex();
        if (context != null) {
            for (int objectIndex = 0; objectIndex < context.size(); objectIndex++) {
                var payload = context.get(objectIndex);
                if (payload == null || payload.id() == null || payload.id().isBlank()) {
                    continue;
                }
                index.add(CanvasObject.from(payload, objectIndex));
            }
        }

        var resolvedInstructions = new ArrayList<DrawingInstruction>();

        for (var instruction : instructions) {
            var params = instruction.params() == null ? new HashMap<String, Object>() : new HashMap<>(instruction.params());
            resolveParams(instruction.action(), params, index);
            
            var resolved = new DrawingInstruction(
                instruction.action(),
                params,
                instruction.resultId(),
                instruction.label()
            );
            resolvedInstructions.add(resolved);

            if (resolved.label() != null && !resolved.label().isBlank() && resolved.resultId() != null) {
                index.add(resolved.resultId(), createdType(resolved.action()), resolved.label());
            }
        }
        return resolvedInstructions;
    }

    private static void resolveParams(String action, Map<String, Object> params, ReferenceIndex index) {
        // Exhaustive list of keys that might contain object references across all actions
        String[] referenceKeys = {
            "p1", "p2", "p3", "vertex", "center", "through", "point", "line", "circle", "segment", "path",
            "from", "to", "point1", "point2", "first", "second", "known", "vectorFrom", "vectorTo",
            "directionFrom", "directionTo", "target"
        };

        for (var key : referenceKeys) {
            resolveRef(action, params, key, index);
        }

        // Handle list-based point references (e.g., polygon points).
        if (params.get("points") instanceof List<?> list) {
            var resolved = list.stream()
                .map(item -> item instanceof String s ? index.resolve(s, GeometryChatService.POINT_TYPES) : item)
                .toList();
            params.put("points", resolved);
        }
    }

    private static void resolveRef(String action, Map<String, Object> params, String key, ReferenceIndex index) {
        if (params.get(key) instanceof String value) {
            params.put(key, index.resolve(value, allowedTypes(action, key)));
        }
    }

    private static Set<String> allowedTypes(String action, String key) {
        if (action == null || key == null) {
            return null;
        }
        if ("target".equals(key)) {
            return null;
        }
        var intersectableTypes = intersectableTypes();
        return switch (action) {
            case "segment", "line", "midpoint", "circumcircle", "incircle" -> pointKeys(key);
            case "polygon" -> "points".equals(key) ? GeometryChatService.POINT_TYPES : pointKeys(key);
            case "parallel", "perpendicular" -> switch (key) {
                case "line" -> GeometryChatService.LINE_TYPES;
                case "point" -> GeometryChatService.POINT_TYPES;
                default -> null;
            };
            case "circle" -> switch (key) {
                case "center", "through" -> GeometryChatService.POINT_TYPES;
                default -> null;
            };
            case "tangent" -> switch (key) {
                case "circle" -> GeometryChatService.CIRCLE_TYPES;
                case "point" -> GeometryChatService.POINT_TYPES;
                default -> null;
            };
            case "intersection" -> switch (key) {
                case "first", "second" -> intersectableTypes;
                default -> null;
            };
            case "otherintersection" -> switch (key) {
                case "first", "second" -> intersectableTypes;
                case "known" -> GeometryChatService.POINT_TYPES;
                default -> null;
            };
            case "angle", "bisector" -> switch (key) {
                case "p1", "vertex", "p2" -> GeometryChatService.POINT_TYPES;
                default -> null;
            };
            case "glider", "point_on_circle" -> switch (key) {
                case "path", "circle" -> intersectableTypes;
                default -> null;
            };
            case "line_through_points", "point_by_ratio", "translate_point", "equal_length_point" -> pointKeys(key);
            case "point_on_segment", "point_on_line", "divide_segment" -> switch (key) {
                case "segment", "line" -> GeometryChatService.LINE_TYPES;
                case "p1", "p2", "from", "to", "point", "through" -> GeometryChatService.POINT_TYPES;
                default -> null;
            };
            case "parallel_through_point_to_segment", "perpendicular_through_point_to_segment" -> switch (key) {
                case "segment" -> GeometryChatService.LINE_TYPES;
                case "point" -> GeometryChatService.POINT_TYPES;
                default -> null;
            };
            case "tangents_from_point_to_circle" -> switch (key) {
                case "point" -> GeometryChatService.POINT_TYPES;
                case "circle" -> GeometryChatService.CIRCLE_TYPES;
                default -> null;
            };
            case "perpendicular_foot_segment" -> switch (key) {
                case "point", "p1", "p2" -> GeometryChatService.POINT_TYPES;
                case "segment", "line" -> GeometryChatService.LINE_TYPES;
                default -> null;
            };
            case "angle_bisector_segment" -> switch (key) {
                case "p1", "vertex", "p2" -> GeometryChatService.POINT_TYPES;
                default -> null;
            };
            default -> null;
        };
    }

    private static Set<String> pointKeys(String key) {
        return switch (key) {
            case "p1", "p2", "p3", "vertex", "center", "through", "point", "from", "to", "point1", "point2",
                 "known", "vectorFrom", "vectorTo", "directionFrom", "directionTo" -> GeometryChatService.POINT_TYPES;
            default -> null;
        };
    }

    private static Set<String> intersectableTypes() {
        var types = new HashSet<String>();
        types.addAll(GeometryChatService.LINE_TYPES);
        types.addAll(GeometryChatService.CIRCLE_TYPES);
        return types;
    }

    private static String createdType(String action) {
        return switch (action) {
            case "place_point", "glider", "midpoint", "intersection", "otherintersection" -> "point";
            case "function_graph" -> "functiongraph";
            default -> action;
        };
    }

    private static final class ReferenceIndex {
        private final Map<String, List<ReferenceEntry>> labelEntries = new HashMap<>();

        void add(CanvasObject object) {
            add(object.id(), object.type(), object.label());
            if (GeometryChatService.CIRCLE_TYPES.contains(object.type())) {
                add(object.id(), object.type(), object.centerLabel());
            }
        }

        void add(String id, String type, String label) {
            if (id == null || id.isBlank() || label == null || label.isBlank()) {
                return;
            }
            labelEntries.computeIfAbsent(label.toUpperCase(), key -> new ArrayList<>())
                .add(new ReferenceEntry(id, type));
        }

        String resolve(String label, Set<String> allowedTypes) {
            if (label == null || label.isBlank()) {
                return label;
            }
            var entries = labelEntries.get(label.toUpperCase());
            if (entries == null || entries.isEmpty()) {
                return label;
            }
            var candidates = entries.stream()
                .filter(entry -> allowedTypes == null || allowedTypes.contains(entry.type()))
                .map(ReferenceEntry::id)
                .distinct()
                .toList();
            return candidates.size() == 1 ? candidates.get(0) : label;
        }
    }

    private record ReferenceEntry(String id, String type) {
    }
}
