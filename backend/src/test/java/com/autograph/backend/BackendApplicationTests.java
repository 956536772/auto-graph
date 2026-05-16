package com.autograph.backend;

import com.autograph.backend.chat.GeometryChatService;
import com.autograph.backend.chat.GeometryLlmClient;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertSame;

@SpringBootTest
class BackendApplicationTests {

	@Autowired
	private GeometryChatService geometryChatService;

	@Autowired
	private GeometryLlmClient geometryLlmClient;

	@Test
	void contextLoads() {
	}

	@Test
	void geometryChatServiceShouldUseContainerManagedLlmClient() {
		assertSame(geometryLlmClient, ReflectionTestUtils.getField(geometryChatService, "llmClient"));
	}

}
