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
