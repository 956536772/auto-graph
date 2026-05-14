package com.autograph.backend.chat;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Component
public class GeometryLlmClient {

    private static final TypeReference<List<String>> STRING_LIST = new TypeReference<>() {
    };

    private static final String SYSTEM_PROMPT = """
        You convert Chinese geometry drawing requests into strict JSON intents for a geometry app.
        Return JSON only, no markdown.

        Supported intentType values:
        CREATE_TRIANGLE
        CREATE_SQUARE
        CREATE_SEGMENT
        CREATE_MIDPOINT
        CREATE_PARALLEL
        CREATE_PERPENDICULAR
        CREATE_CIRCLE
        CREATE_CIRCUMCIRCLE
        CREATE_INCIRCLE
        CREATE_TANGENT
        CREATE_CIRCLE_INTERSECTIONS

        Reference object schema:
        {
          "raw": "original short phrase",
          "allowedTypes": ["point","glider"] or ["segment","line","parallel","perpendicular","tangent"] or ["circle","circumcircle","incircle"],
          "explicitLabel": "A or null",
          "endpointLabels": {"first":"A","second":"B"} or null,
          "centerLabel": "A or null",
          "descriptor": {
            "positionHint": "NONE|LEFTMOST|RIGHTMOST|TOPMOST|BOTTOMMOST",
            "sizeHint": "NONE|LARGEST|SMALLEST",
            "recent": true|false
          }
        }

        Response schema:
        {
          "intentType": "...",
          "successMessage": "...",
          "args": { ... }
        }

        For CREATE_TRIANGLE and CREATE_SQUARE, args should be:
        {"labels":["A","B","C"]} or {"labels":["A","B","C","D"]}

        For CREATE_SEGMENT:
        {"from": <Reference>, "to": <Reference>}

        For CREATE_MIDPOINT:
        {"a": <Reference>, "b": <Reference>}

        For CREATE_PARALLEL and CREATE_PERPENDICULAR:
        {"point": <Reference>, "line": <Reference>}

        For CREATE_CIRCLE:
        {"center": <Reference>, "through": <Reference>}

        For CREATE_CIRCUMCIRCLE and CREATE_INCIRCLE:
        {"p1": <Reference>, "p2": <Reference>, "p3": <Reference>}

        For CREATE_TANGENT:
        {"point": <Reference>, "circle": <Reference>}

        For CREATE_CIRCLE_INTERSECTIONS:
        {"first": <Reference>, "second": <Reference>}

        Prefer explicit labels when the user names them.
        If the user says things like "左边那个点", "大圆", "刚才那条线", encode that into descriptor instead of inventing labels.
        If the request is unsupported or unclear, return {"intentType":"UNSUPPORTED","successMessage":"", "args":{}}.
        """;

    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final String baseUrl;
    private final String model;
    private final String apiKey;
    private final boolean enabled;

    @Autowired
    public GeometryLlmClient(
        @Value("${geometry.llm.base-url:https://api.ikuncode.cc/v1}") String baseUrl,
        @Value("${geometry.llm.model:gpt5.4}") String model,
        @Value("${geometry.llm.api-key:}") String apiKey,
        @Value("${geometry.llm.enabled:true}") boolean enabled
    ) {
        this(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build(), new ObjectMapper(), baseUrl, model, apiKey, enabled);
    }

    GeometryLlmClient(HttpClient httpClient, ObjectMapper objectMapper, String baseUrl, String model, String apiKey, boolean enabled) {
        this.httpClient = httpClient;
        this.objectMapper = objectMapper;
        this.baseUrl = baseUrl;
        this.model = model;
        this.apiKey = apiKey;
        this.enabled = enabled;
    }

    static GeometryLlmClient disabled() {
        return new GeometryLlmClient(HttpClient.newHttpClient(), new ObjectMapper(), "", "", "", false);
    }

    Optional<GeometryIntent> extractIntent(String text, ContextIndex context) {
        if (!enabled || apiKey == null || apiKey.isBlank()) {
            return Optional.empty();
        }

        try {
            var body = Map.of(
                "model", model,
                "temperature", 0.1,
                "messages", List.of(
                    Map.of("role", "system", "content", SYSTEM_PROMPT),
                    Map.of("role", "user", "content", buildUserPrompt(text, context))
                )
            );

            var request = HttpRequest.newBuilder()
                .uri(URI.create(trimTrailingSlash(baseUrl) + "/chat/completions"))
                .header("Authorization", "Bearer " + apiKey)
                .header("Content-Type", "application/json")
                .timeout(Duration.ofSeconds(30))
                .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                .build();

            var response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                return Optional.empty();
            }

            var root = objectMapper.readTree(response.body());
            var content = root.path("choices").path(0).path("message").path("content").asText("");
            if (content.isBlank()) {
                return Optional.empty();
            }

            var intentJson = parseJsonContent(content);
            var intentType = intentJson.path("intentType").asText("");
            if (intentType.isBlank() || "UNSUPPORTED".equalsIgnoreCase(intentType)) {
                return Optional.empty();
            }

            var successMessage = intentJson.path("successMessage").asText("已处理该几何请求。");
            var args = parseArgs(IntentType.valueOf(intentType), intentJson.path("args"));
            return Optional.of(new GeometryIntent(IntentType.valueOf(intentType), args, successMessage));
        } catch (Exception ignored) {
            return Optional.empty();
        }
    }

    private String buildUserPrompt(String text, ContextIndex context) throws IOException {
        var contextPayload = context.toLlmSummary();
        return """
            User request:
            %s

            Current canvas context JSON:
            %s
            """.formatted(text, objectMapper.writeValueAsString(contextPayload));
    }

    private JsonNode parseJsonContent(String content) throws IOException {
        var trimmed = content.trim();
        if (trimmed.startsWith("```")) {
            trimmed = trimmed.replaceFirst("^```json\\s*", "").replaceFirst("^```\\s*", "").replaceFirst("\\s*```$", "");
        }
        return objectMapper.readTree(trimmed);
    }

    private Map<String, Object> parseArgs(IntentType intentType, JsonNode argsNode) {
        return switch (intentType) {
            case CREATE_TRIANGLE, CREATE_SQUARE -> Map.of(
                "labels", objectMapper.convertValue(argsNode.path("labels"), STRING_LIST)
            );
            case CREATE_SEGMENT -> Map.of(
                "from", parseReference(argsNode.path("from")),
                "to", parseReference(argsNode.path("to"))
            );
            case CREATE_MIDPOINT -> Map.of(
                "a", parseReference(argsNode.path("a")),
                "b", parseReference(argsNode.path("b"))
            );
            case CREATE_PARALLEL, CREATE_PERPENDICULAR -> Map.of(
                "point", parseReference(argsNode.path("point")),
                "line", parseReference(argsNode.path("line"))
            );
            case CREATE_CIRCLE -> Map.of(
                "center", parseReference(argsNode.path("center")),
                "through", parseReference(argsNode.path("through"))
            );
            case CREATE_CIRCUMCIRCLE, CREATE_INCIRCLE -> Map.of(
                "p1", parseReference(argsNode.path("p1")),
                "p2", parseReference(argsNode.path("p2")),
                "p3", parseReference(argsNode.path("p3"))
            );
            case CREATE_TANGENT -> Map.of(
                "point", parseReference(argsNode.path("point")),
                "circle", parseReference(argsNode.path("circle"))
            );
            case CREATE_CIRCLE_INTERSECTIONS -> Map.of(
                "first", parseReference(argsNode.path("first")),
                "second", parseReference(argsNode.path("second"))
            );
        };
    }

    private RefQuery parseReference(JsonNode node) {
        var descriptorNode = node.path("descriptor");
        var descriptor = new Descriptor(
            PositionHint.valueOf(descriptorNode.path("positionHint").asText("NONE")),
            SizeHint.valueOf(descriptorNode.path("sizeHint").asText("NONE")),
            descriptorNode.path("recent").asBoolean(false)
        );
        var endpointNode = node.path("endpointLabels");
        var endpoints = endpointNode.isObject() && endpointNode.hasNonNull("first") && endpointNode.hasNonNull("second")
            ? new LabelPair(endpointNode.path("first").asText(), endpointNode.path("second").asText())
            : null;
        var allowedTypes = objectMapper.convertValue(node.path("allowedTypes"), STRING_LIST).stream().collect(java.util.stream.Collectors.toSet());

        return new RefQuery(
            node.path("raw").asText(""),
            allowedTypes,
            nullIfBlank(node.path("explicitLabel").asText(null)),
            endpoints,
            nullIfBlank(node.path("centerLabel").asText(null)),
            descriptor
        );
    }

    private String trimTrailingSlash(String value) {
        if (value.endsWith("/")) {
            return value.substring(0, value.length() - 1);
        }
        return value;
    }

    private String nullIfBlank(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
