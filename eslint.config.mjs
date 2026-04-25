import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const noTelemetry = require("./eslint-rules/no-telemetry.js");

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Electron main-process compile output — emitted by `npm run build:electron`
    "dist/**",
  ]),
  {
    plugins: {
      scriptr: {
        rules: { "no-telemetry": noTelemetry },
      },
    },
    rules: {
      "scriptr/no-telemetry": "error",
    },
  },
]);

export default eslintConfig;
