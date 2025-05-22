import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import globals from "globals";
import { includeIgnoreFile } from "@eslint/compat";
import tseslint from "typescript-eslint";
import css from "@eslint/css";
import { defineConfig } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import importPlugin from "eslint-plugin-import";

const gitignorePath = fileURLToPath(new URL(".gitignore", import.meta.url));

export default defineConfig([
  includeIgnoreFile(gitignorePath),
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    plugins: { js },
    extends: ["js/recommended", importPlugin.flatConfigs.recommended],
    rules: {
      "import/no-unresolved": "off",
      "import/order": "error",
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [importPlugin.flatConfigs.typescript],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    languageOptions: { globals: globals.node },
  },
  tseslint.configs.recommended,
  {
    files: ["**/*.css"],
    plugins: { css },
    language: "css/css",
    extends: ["css/recommended"],
  },
  eslintConfigPrettier,
]);
