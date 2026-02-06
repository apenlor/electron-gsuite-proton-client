# AGENTS.md: AI Agent Instructions for electron-gsuite-client

This document provides instructions for AI agents working on this codebase. Adhering to these guidelines ensures consistency, quality, and effective collaboration.

## 1. Project Overview

This is an Electron-based desktop client for Google Workspace applications (Gmail, Chat, Drive, AI Studio, etc.). It uses a multi-`BrowserView` architecture (specifically `WebContentsView` in newer versions) to isolate services and provide a seamless user experience. The main process is written in modern JavaScript (ESM) and manages the window, views, and IPC communication.

The core logic is encapsulated within the `MainWindow` class in `main.js`. This class is responsible for all aspects of the application lifecycle, from window creation to IPC handling.

**Recent Improvements (v2.3.0):**

- **Lazy Loading:** Views load their URLs on-demand to speed up initial application startup.
- **Keyboard Shortcuts:** `Cmd/Ctrl+1-5` for rapid switching between services.
- **Zoom Persistence:** Zoom levels are remembered per service across sessions.
- **Loading Indicators:** Visual feedback in the sidebar during service initialization.
- **Performance:** Debounced favicon and badge updates to reduce IPC overhead.
- **Robustness:** Added error boundaries for view creation and null checks for IPC.

## 2. Directory Structure

- **`main.js`**: The entry point and core logic (Main Process). Manages lifecycle, windows, views, and IPC.
- **`menu.js`**: Defines the application menu template.
- **`preload.js`**: Preload script for the internal "Menu" view (side navigation).
- **`preload-web.js`**: Preload script for external content views (Gmail, Drive, etc.).
- **`assets/`**: Contains icons and static resources.
- **`release/`**: Output directory for build artifacts (created during build).

## 3. Development Commands

### Running the Application

- **Start:** `npm start`
  - Runs the application in development mode. Use this for all manual testing.

### Linting and Formatting

This project uses ESLint for linting and Prettier for formatting. A pre-commit hook is configured with `husky` to automatically format and lint staged files.

- **Lint:** `npm run lint`
  - Runs ESLint to check for code quality and style issues across the project.
- **Lint (Fix):** `npm run lint:fix`
  - Automatically fixes ESLint errors and warnings where possible.
- **Format:** `npm run format`
  - Runs Prettier to format the entire codebase. Run this before committing if the pre-commit hook fails.

### Building the Application

- **Full Build:** `npm run build`
  - This command builds the application for the current platform. It runs the linter (`prebuild` script) before starting the build.
- **Platform-specific Builds:**
  - **Windows:** `npm run build:win`
  - **macOS:** `npm run build:mac`
  - **Linux:** `npm run build:linux`

### Testing

- **No Automated Test Suite:** There is currently no automated test suite.
- **Manual Testing is Critical:** All changes must be manually verified.
- **Single Feature Verification:**
  - Since there are no unit tests, "running a single test" means manually exercising a specific feature.
  - **Example:** If modifying the notification logic, start the app, trigger a notification (e.g., send an email to yourself), and verify the badge updates and system notification appears.
- **Verification Checklist:**
  1. Run `npm start`.
  2. Verify all services (Gmail, Chat, etc.) load without white screens.
  3. Check developer console (View -> Toggle Developer Tools) for errors.
  4. Verify IPC functionality (switching tabs, updating badges).
  5. Test keyboard shortcuts (`Cmd/Ctrl+1-5`) for tab switching.
  6. Verify zoom levels persist per service after restarting the app.
  7. Confirm loading indicators appear when switching to a non-loaded service.

## 4. Code Style Guidelines

### Formatting

- **Prettier:** The project is auto-formatted by Prettier. Adhere to its output.
- **Line Length:** Aim for a maximum line length of 80-100 characters.
- **Semicolons:** Use semicolons at the end of statements.

### Naming Conventions

- **Variables/Functions:** Use `camelCase` (e.g., `mainWindow`, `createViews`).
- **Classes:** Use `PascalCase` (e.g., `MainWindow`).
- **Constants:** Use `UPPER_SNAKE_CASE` for top-level constants (e.g., `IPC_CHANNELS`).
- **Internal Methods:** Prefix internal class methods with `_` (e.g., `_createWindow`).

### Imports and Modules

- **ESM:** Use ES Modules (`import`/`export`) exclusively.
- **Import Grouping:**
  1. Electron built-ins (`electron`)
  2. Node.js built-ins (`path`, `fs`)
  3. External dependencies (`electron-store`)
  4. Internal modules (`./menu.js`)

### Types

- **Plain JavaScript:** Do not add TypeScript or Flow types.
- **JSDoc:** Use for complex functions to describe parameters and purpose.

### Error Handling

- **Main Process:** `throw` critical errors; `console.error` recoverable ones.
- **Preload Scripts:** Use `try...catch` and communicate via IPC.

### Comments

- **"Why" not "What":** Explain the reasoning behind complex logic.
- **Do not** describe the code itself (e.g., "Loop through items").

## 5. Architectural Patterns & Implementation Details

- **IPC:** Handled via `ipcMain` and `ipcRenderer`. Use `IPC_CHANNELS`.
- **Configuration:** Static config in `VIEW_CONFIG`.
- **Persistence:** `electron-store` used for `services` state and `windowBounds`.
- **CSP Headers:** The application **intentionally removes** Content-Security-Policy headers (`x-frame-options`, `content-security-policy`) in `_setupSecurity`. This is required to allow embedding Google services in `BrowserView`s. **Do not restore these headers.**
- **User Agent Spoofing:**
  - AI Studio requires a modern Chrome User-Agent.
  - Other views have the "Electron" string removed from their UA to prevent blocking.

## 6. Security

- **Context Isolation:** Enabled for all views (`contextIsolation: true`).
- **Sandbox:** Enabled for content views (`sandbox: true`).
- **Preload Validation:** `VALID_PRELOADS` ensures only authorized scripts run.
- **External Links:** Must be opened via `shell.openExternal()`.

## 7. Commit Messages

- **Conventional Commits:** `<type>(<scope>): <subject>`
  - `feat`: New feature
  - `fix`: Bug fix
  - `refactor`: Code restructuring
  - `style`: Formatting changes
  - `chore`: Build/tooling changes
  - `docs`: Documentation
- **Example:** `feat(gmail): add support for unread count badge`
