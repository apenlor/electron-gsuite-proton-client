# AGENTS.md: AI Agent Instructions for electron-gsuite-client

This document provides instructions for AI agents working on this codebase. Adhering to these guidelines ensures consistency, quality, and effective collaboration.

## 1. Project Overview

This is an Electron-based desktop client for Google Workspace applications (Gmail, Chat, Drive, AI Studio, etc.). It uses a multi-`BrowserView` architecture to isolate services and provide a seamless user experience. The main process is written in modern JavaScript (ESM) and manages the window, views, and IPC communication.

The core logic is encapsulated within the `MainWindow` class in `main.js`. This class is responsible for all aspects of the application lifecycle, from window creation to IPC handling.

## 2. Development Commands

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
- **Manual Testing is Critical:** All changes, especially those affecting the main process (`main.js`) or preload scripts, must be manually tested:
  1. Run the application using `npm start`.
  2. Verify that all services load and function correctly.
  3. Check for regressions in core features (e.g., tab switching, notifications, unread badges).
  4. Open the developer tools (via the "View" menu) to check for console errors.

## 3. Code Style Guidelines

### Formatting

- **Prettier:** The project is auto-formatted by Prettier. Adhere to its output.
- **Line Length:** Aim for a maximum line length of 80-100 characters for readability.
- **Semicolons:** Use semicolons at the end of statements.

### Naming Conventions

- **Variables/Functions:** Use `camelCase` (e.g., `mainWindow`, `createViews`).
- **Classes:** Use `PascalCase` (e.g., `MainWindow`).
- **Constants:** Use `UPPER_SNAKE_CASE` for top-level constants and configuration objects (e.g., `IPC_CHANNELS`, `VIEW_CONFIG`).
- **Internal Methods:** Prefix internal class methods with an underscore `_` to indicate they are not for external use (e.g., `_createWindow`).

### Imports and Modules

- **ESM:** Use ES Modules (`import`/`export`) syntax exclusively. Do not use `require`.
- **Import Grouping:** Group imports in the following order:
  1. Electron built-in modules (`electron`).
  2. Node.js built-in modules (`path`, `fs`).
  3. External dependencies (`electron-store`).
  4. Internal modules (`./menu.js`).
- **Example Import Order:**
  ```javascript
  import { app, BrowserWindow } from "electron";
  import path from "path";
  import Store from "electron-store";
  import { createMenu } from "./menu.js";
  ```

### Types

- **Plain JavaScript:** This is a plain JavaScript project. Do not add TypeScript or Flow type annotations.
- **JSDoc (Optional):** For complex functions, you may add JSDoc comments to describe parameters, return values, and purpose.

### Error Handling

- **Main Process:**
  - For critical errors that prevent the app from starting (e.g., invalid preload script), `throw new Error()`.
  - For non-critical, recoverable errors (e.g., a failed favicon fetch), log the error to the console using `console.error()` without crashing the application.
- **Preload Scripts:** Use `try...catch` blocks for operations that might fail. Communicate errors back to the main process via IPC if the main process needs to be aware of them.

### Comments

- **Focus on "Why":** Write comments to explain _why_ a piece of code exists, especially for complex or non-obvious logic. Avoid explaining _what_ the code does, as the code itself should be clear.
- **JSDoc:** Use for documenting function signatures as noted above.

## 4. Architectural Patterns

- **IPC:** Inter-process communication is handled via `ipcMain` and `ipcRenderer`. Use the predefined channels in the `IPC_CHANNELS` constant.
- **Configuration:** Static configuration (e.g., view URLs, preload scripts) is stored in the `VIEW_CONFIG` object in `main.js`.
- **Persistence:** User settings and window state are persisted using `electron-store`. Access it via `this.store` in the `MainWindow` class.
- **Key Dependencies:**
  - `electron-store`: Handles persistent key-value storage for user settings and window state.
  - `electron-updater`: Manages automatic application updates.
  - `electron-context-menu`: Provides a default right-click context menu.

## 5. Security

- **Context Isolation:** `contextIsolation` is enabled for all `BrowserView` instances.
- **Sandbox:** The sandbox is enabled for all web content views (`isContent: true`).
- **Preload Validation:** A `VALID_PRELOADS` set ensures that only approved preload scripts from the `VIEW_CONFIG` can be loaded.
- **External Links:** Use `shell.openExternal()` to open links in the user's default browser. Do not open external content within the Electron application itself.

## 6. Commit Messages

- **Conventional Commits:** Use the Conventional Commits specification for all commit messages. This helps maintain a clear and automated version history.
- **Format:** `<type>(<scope>): <subject>`
  - **`feat`**: A new feature.
  - **`fix`**: A bug fix.
  - **`refactor`**: A code change that neither fixes a bug nor adds a feature.
  - **`style`**: Changes that do not affect the meaning of the code (formatting).
  - **`chore`**: Changes to the build process or auxiliary tools.
  - **`docs`**: Documentation only changes.
- **Example:** `feat(gmail): add support for unread count badge`
