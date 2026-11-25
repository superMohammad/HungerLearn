import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // UI text lives only in src/lib/i18n/{ar,en}.ts: render it from getDict()/useDict(), never as a JSX literal.
    // Allowed literals are language-neutral symbols and the brand name.
    files: ["src/app/**/*.tsx", "src/components/**/*.tsx"],
    rules: {
      "react/jsx-no-literals": ["error", {
        noStrings: true,
        ignoreProps: true,
        allowedStrings: ["HungerLearn", ".", "0", "·", "—", "–", "/", ":", "%", "×", "→", "←", "(", ")", "|", "-", "+", "•", "…", "#", "✓", "▲", "▼", "«", "»"],
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
