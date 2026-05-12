package com.autograph.backend.controller;

import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class ChatController {

    @PostMapping("/chat")
    public ChatResponse handleChat(@RequestBody ChatRequest request) {
        String text = request.getText();
        List<Map<String, Object>> instructions = new ArrayList<>();
        String responseText = "";

        if (text.contains("正方形")) {
            instructions.add(createInstruction("place_point", Map.of("x", -2, "y", 2), "A", "A"));
            instructions.add(createInstruction("place_point", Map.of("x", 2, "y", 2), "B", "B"));
            instructions.add(createInstruction("place_point", Map.of("x", 2, "y", -2), "C", "C"));
            instructions.add(createInstruction("place_point", Map.of("x", -2, "y", -2), "D", "D"));
            instructions.add(createInstruction("polygon", Map.of("points", Arrays.asList("A", "B", "C", "D")), "sq1", null));
            responseText = "为您绘制了正方形 ABCD。现在您可以尝试右键平移画布，或左键拖拽正方形。";
        } else if (text.contains("中点")) {
            // Simplified logic for mock backend
            boolean hasA = request.getContext() != null && request.getContext().contains("\"id\": \"A\"");
            boolean hasB = request.getContext() != null && request.getContext().contains("\"id\": \"B\"");
            
            if (hasA && hasB) {
                instructions.add(createInstruction("midpoint", Map.of("p1", "A", "p2", "B"), "M", "M"));
                responseText = "已找到线段 AB 的中点 M。";
            } else {
                responseText = "请先绘制点 A 和 B。";
            }
        } else {
            responseText = "目前后端 Mock 理解“正方形”和“中点”指令。";
        }

        return new ChatResponse(instructions, responseText);
    }

    private Map<String, Object> createInstruction(String action, Map<String, Object> params, String resultId, String label) {
        Map<String, Object> ins = new HashMap<>();
        ins.put("action", action);
        ins.put("params", params);
        ins.put("result_id", resultId);
        if (label != null) {
            ins.put("label", label);
        }
        return ins;
    }
}

class ChatRequest {
    private String text;
    private String context;

    public String getText() { return text; }
    public void setText(String text) { this.text = text; }
    public String getContext() { return context; }
    public void setContext(String context) { this.context = context; }
}

class ChatResponse {
    private List<Map<String, Object>> instructions;
    private String responseText;

    public ChatResponse(List<Map<String, Object>> instructions, String responseText) {
        this.instructions = instructions;
        this.responseText = responseText;
    }

    public List<Map<String, Object>> getInstructions() { return instructions; }
    public String getResponseText() { return responseText; }
}