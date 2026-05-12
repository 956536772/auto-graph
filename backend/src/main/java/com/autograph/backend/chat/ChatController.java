package com.autograph.backend.chat;

import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class ChatController {

    private final GeometryChatService geometryChatService;

    public ChatController(GeometryChatService geometryChatService) {
        this.geometryChatService = geometryChatService;
    }

    @PostMapping("/chat")
    public ChatResponse handleChat(@RequestBody ChatRequest request) {
        return geometryChatService.handle(request);
    }
}
