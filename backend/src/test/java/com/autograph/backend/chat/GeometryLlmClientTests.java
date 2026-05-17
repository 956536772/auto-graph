package com.autograph.backend.chat;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.data.message.SystemMessage;
import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.model.chat.request.ChatRequest;
import dev.langchain4j.model.chat.response.ChatResponse;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GeometryLlmClientTests {
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void shouldSendWorkflowAsSystemMessage() {
        var chatModel = new CapturingChatModel("""
            {"mode":"instructions","responseText":"ok","instructions":[{"action":"place_point","params":{"x":0,"y":0},"result_id":"A","label":"A"}]}
            """);
        var client = new GeometryLlmClient(chatModel, objectMapper, "test-key", true, "workflow-body");

        var result = client.extractInstructions("画三角形ABC", ContextIndex.from(List.of()));

        assertEquals(LlmDirectStatus.SUCCESS, result.status());
        assertEquals("instructions", result.response().mode());
        assertEquals("place_point", result.response().instructions().get(0).action());
        assertTrue(chatModel.messages.stream()
            .filter(SystemMessage.class::isInstance)
            .map(SystemMessage.class::cast)
            .anyMatch(message -> "workflow-body".equals(message.text())));
    }

    @Test
    void shouldParseClarificationMode() {
        var chatModel = new CapturingChatModel("""
            {"mode":"clarification","responseText":"你指的是哪一个？","clarification":{"question":"你指的是哪一个？","candidates":[{"id":"A1","label":"A","type":"point","description":"点A"}]}}
            """);
        var client = new GeometryLlmClient(chatModel, objectMapper, "test-key", true, "workflow-body");

        var result = client.extractInstructions("连接A", ContextIndex.from(List.of()));

        assertEquals(LlmDirectStatus.SUCCESS, result.status());
        assertEquals("clarification", result.response().mode());
        assertEquals(1, result.response().clarification().candidates().size());
    }

    @Test
    void shouldRejectIntentMode() {
        var chatModel = new CapturingChatModel("""
            {"intentType":"CREATE_TRIANGLE","successMessage":"ok","args":{"labels":["A","B","C"]}}
            """);
        var client = new GeometryLlmClient(chatModel, objectMapper, "test-key", true, "workflow-body");

        var result = client.extractInstructions("画三角形ABC", ContextIndex.from(List.of()));

        assertEquals(LlmDirectStatus.INVALID, result.status());
        assertEquals(LlmFailureReason.INVALID_INTENT, result.reason());
    }

    @Test
    void shouldPromptWithCurrentCanvasOnly() {
        var chatModel = new CapturingChatModel("""
            {"mode":"instructions","responseText":"ok","instructions":[{"action":"place_point","params":{"x":0,"y":0},"result_id":"M","label":"M"}]}
            """);
        var client = new GeometryLlmClient(chatModel, objectMapper, "test-key", true, "workflow-body");

        client.extractInstructions(
            "继续作AB中点",
            ContextIndex.from(List.of(
                new CanvasObjectPayload(
                    "AB",
                    "segment",
                    null,
                    2,
                    null,
                    null,
                    null,
                    null,
                    List.of("A", "B"),
                    null,
                    List.of(
                        new CanvasPointPayload("A", "A", 0d, 0d),
                        new CanvasPointPayload("B", "B", 4d, 0d)
                    ),
                    null,
                    null
                )
            ))
        );

        assertEquals(2, chatModel.messages.size());
        var finalPrompt = ((dev.langchain4j.data.message.UserMessage) chatModel.messages.get(1)).singleText();
        assertTrue(finalPrompt.contains("继续作AB中点"));
        assertTrue(finalPrompt.contains("\"endpointRefs\":[\"A\",\"B\"]"));
        assertTrue(finalPrompt.contains("\"endpoints\""));
    }

    @Test
    void shouldPromptLlmWithContinuousConversationInstructions() {
        var chatModel = new CapturingChatModel("""
            {"mode":"instructions","responseText":"ok","instructions":[{"action":"midpoint","params":{"p1":"A","p2":"C"},"result_id":"D","label":"D"}]}
            """);
        var client = new GeometryLlmClient(chatModel, objectMapper, "test-key", true, "workflow-body");

        client.extractInstructions(
            "取AC中点D",
            ContextIndex.from(List.of(
                new CanvasObjectPayload("A", "point", "A", 0, new Anchor(0, 3), null, null, List.of(), null),
                new CanvasObjectPayload("C", "point", "C", 2, new Anchor(2, 0), null, null, List.of(), null)
            ))
        );

        assertEquals("workflow-body", ((SystemMessage) chatModel.messages.get(0)).text());
        var finalPrompt = ((dev.langchain4j.data.message.UserMessage) chatModel.messages.get(chatModel.messages.size() - 1)).singleText();
        assertTrue(finalPrompt.contains("continuous geometry drawing conversation"));
        assertTrue(finalPrompt.contains("current canvas context"));
        assertTrue(finalPrompt.contains("only source of truth"));
        assertTrue(finalPrompt.contains("manually changed the canvas"));
        assertFalse(finalPrompt.contains("prior chat messages"));
        assertTrue(finalPrompt.contains("current canvas context"));
        assertTrue(finalPrompt.contains("取AC中点D"));
        assertTrue(finalPrompt.contains("\"id\":\"A\""));
        assertTrue(finalPrompt.contains("\"id\":\"C\""));
    }

    private static final class CapturingChatModel implements ChatModel {
        private final String responseText;
        private List<ChatMessage> messages = List.of();

        private CapturingChatModel(String responseText) {
            this.responseText = responseText;
        }

        @Override
        public ChatResponse doChat(ChatRequest request) {
            messages = request.messages();
            return ChatResponse.builder()
                .aiMessage(AiMessage.from(responseText))
                .build();
        }
    }
}
