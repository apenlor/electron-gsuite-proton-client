import globals from "globals";
import pluginJs from "@eslint/js";
import prettierConfig from "eslint-config-prettier";

/**
 * ESLint v9 "Flat Config".
 * This file is the single source of truth for all linting rules.
 * @see https://eslint.org/docs/latest/use/configure/configuration-files
 */
export default [
  // 1. Provides ESLint's recommended default rules.
  pluginJs.configs.recommended,

  // 2. Disables any ESLint styling rules that would conflict with Prettier.
  // This must be the last "extends" in the configuration.
  prettierConfig,

  // 3. Custom configuration for this specific project.
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser, // Standard browser globals (for preload scripts)
        ...globals.node, // Standard Node.js globals (for main.js)
      },
    },
    rules: {
      // Reduces noise from unused 'event' parameters in IPC handlers.
      "no-unused-vars": ["warn", { args: "none" }],
    },
  },
];
