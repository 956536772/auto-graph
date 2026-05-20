# brainstorm: single JAR packaging

## Goal
Package the full-stack project as a single executable JAR file.

## Technical Approach
1. **Frontend Build**: Build the React/Vite project in the `frontend/` directory.
2. **Asset Migration**: Copy the generated `dist/` files to `backend/src/main/resources/static/`.
3. **Backend Build**: Use Maven to package the Spring Boot application into a single JAR.

## Acceptance Criteria
* [ ] Frontend `dist` assets are present in the final JAR.
* [ ] Running `java -jar backend-0.0.1-SNAPSHOT.jar` serves both backend API and frontend UI.
* [ ] The JAR can be executed standalone on any machine with Java 21.

## Technical Notes
* Backend: Spring Boot 4.0.6, Java 21.
* Frontend: Vite/React.
* Target Path: `backend/src/main/resources/static/`