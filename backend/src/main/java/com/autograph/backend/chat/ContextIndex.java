package com.autograph.backend.chat;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

final class ContextIndex {
    private final List<CanvasObject> objects;

    private ContextIndex(List<CanvasObject> objects) {
        this.objects = objects;
    }

    static ContextIndex from(List<CanvasObjectPayload> payloads) {
        if (payloads == null || payloads.isEmpty()) {
            return new ContextIndex(List.of());
        }
        var objects = new ArrayList<CanvasObject>();
        for (int index = 0; index < payloads.size(); index++) {
            var payload = payloads.get(index);
            if (payload == null || payload.id() == null) {
                continue;
            }
            objects.add(CanvasObject.from(payload, index));
        }
        return new ContextIndex(objects);
    }

    Optional<CanvasObject> findByLabel(String label, Set<String> allowedTypes) {
        return objects.stream()
            .filter(obj -> allowedTypes.contains(obj.type()))
            .filter(obj -> label.equalsIgnoreCase(Objects.toString(obj.label(), "")))
            .findFirst();
    }

    Optional<CanvasObject> findLineByEndpoints(String first, String second) {
        var targets = Set.of(first, second);
        return objects.stream()
            .filter(obj -> GeometryChatService.LINE_TYPES.contains(obj.type()))
            .filter(obj -> Set.copyOf(obj.endpointLabels()).equals(targets))
            .findFirst();
    }

    Optional<CanvasObject> findCircleByCenterLabel(String centerLabel) {
        return objects.stream()
            .filter(obj -> GeometryChatService.CIRCLE_TYPES.contains(obj.type()))
            .filter(obj -> centerLabel.equalsIgnoreCase(Objects.toString(obj.centerLabel(), "")))
            .findFirst();
    }

    List<CanvasObject> findByTypes(Set<String> allowedTypes) {
        return objects.stream()
            .filter(obj -> allowedTypes.contains(obj.type()))
            .toList();
    }

    List<CanvasObject> latestPoints(int count) {
        return objects.stream()
            .filter(obj -> GeometryChatService.POINT_TYPES.contains(obj.type()))
            .filter(obj -> obj.label() != null && !obj.label().isBlank())
            .sorted(Comparator.comparingInt(CanvasObject::order).reversed())
            .limit(count)
            .sorted(Comparator.comparingInt(CanvasObject::order))
            .toList();
    }

    String nextAvailableLabel(String preferred) {
        if (preferred == null || preferred.isBlank()) {
            return null;
        }
        var labels = objects.stream()
            .map(CanvasObject::label)
            .filter(Objects::nonNull)
            .collect(Collectors.toSet());
        if (!labels.contains(preferred)) {
            return preferred;
        }
        var index = 2;
        while (labels.contains(preferred + index)) {
            index++;
        }
        return preferred + index;
    }

    List<Map<String, Object>> toLlmSummary() {
        return objects.stream()
            .map(obj -> Map.<String, Object>of(
                "id", obj.id(),
                "type", obj.type(),
                "label", Objects.toString(obj.label(), ""),
                "order", obj.order(),
                "position", obj.anchor() == null ? Map.of() : Map.of("x", obj.anchor().x(), "y", obj.anchor().y()),
                "center", obj.center() == null ? Map.of() : Map.of("x", obj.center().x(), "y", obj.center().y()),
                "radius", obj.radius() == null ? 0d : obj.radius(),
                "endpointLabels", obj.endpointLabels(),
                "centerLabel", Objects.toString(obj.centerLabel(), "")
            ))
            .toList();
    }
}
