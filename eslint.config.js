// Flat ESLint config for the React/TypeScript frontend. The Rust core is linted
// separately by clippy. Formatting is delegated to Prettier (eslint-config-prettier
// turns off any stylistic rules that would conflict).
//
// react-hooks is registered manually with just the two classic rules
// (rules-of-hooks + exhaustive-deps); the plugin's newer "recommended-latest"
// preset ships the full React-Compiler ruleset, which is far stricter than this
// project wants as a baseline gate.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist", "src-tauri", "node_modules", "coverage"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Tests use Node-style globals (vitest provides describe/it/expect via the
    // `globals: true` vitest setting) and may assert on `any`-shaped fixtures.
    files: ["**/*.test.{ts,tsx}", "src/test/**"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Build tooling and config files run under Node.
    files: ["scripts/**", "**/*.cjs", "**/*.mjs", "*.config.{js,ts}"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  prettier,
);
