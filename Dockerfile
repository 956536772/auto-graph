# Stage 1: Build Frontend
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build Backend
FROM maven:3.9-eclipse-temurin-21-alpine AS backend-build
WORKDIR /app/backend
# Copy pom.xml first to cache dependencies
COPY backend/pom.xml ./
RUN mvn dependency:go-offline

# Copy backend source
COPY backend/src ./src
# Copy frontend assets to static resources
# We remove existing static content to ensure a clean build
RUN rm -rf src/main/resources/static/
COPY --from=frontend-build /app/frontend/dist/ src/main/resources/static/

# Build JAR
RUN mvn package -DskipTests

# Stage 3: Runtime
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
# Copy the built jar from the backend-build stage
COPY --from=backend-build /app/backend/target/*.jar app.jar

# Expose the application port
EXPOSE 8080

# Environment variables with default values (can be overridden at runtime)
# Spring Boot will automatically map these to geometry.llm.* properties
ENV GEOMETRY_LLM_ENABLED=true
ENV GEOMETRY_LLM_BASE_URL=https://api.zhongzhuan.win/v1
ENV GEOMETRY_LLM_MODEL=gemini-3-flash-c
ENV GEOMETRY_LLM_API_KEY=""

ENTRYPOINT ["java", "-jar", "app.jar"]
