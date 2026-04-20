import { describe, it, expect } from "vitest";
import { RuleTester } from "eslint";
import * as tsParser from "@typescript-eslint/parser";
import noTelemetry from "../../eslint-rules/no-telemetry.js";

const tester = new RuleTester({
  // Use @typescript-eslint/parser so TypeScript-only syntax (import type, export type, …)
  // is accepted by the rule tester without needing a separate TS-aware fixture file.
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
});

describe("no-telemetry", () => {
  it("fails for each banned package", () => {
    expect(() => {
      tester.run("no-telemetry", noTelemetry, {
        valid: [
          { code: "import x from 'next';" },
          { code: "import { a } from './util';" },
          { code: "import x from 'posthog-js-extra';" },     // Similar name, not blocked
          { code: "import x from 'mixpanel-like';" },        // Boundary — shouldn't match
          { code: "import x from '@sentry-hypothetical/pkg';" }, // Different org scope
          { code: "import type { X } from 'next';" },        // type-only imports allowed if package isn't blocked
        ],
        invalid: [
          {
            code: "import * as Sentry from '@sentry/nextjs';",
            errors: [{ messageId: "blocked" }],
          },
          {
            code: "const ph = require('posthog-js');",
            errors: [{ messageId: "blocked" }],
          },
          {
            code: "const a = await import('@vercel/analytics');",
            errors: [{ messageId: "blocked" }],
          },
          {
            code: "export { init } from '@sentry/nextjs';",
            errors: [{ messageId: "blocked" }],
          },
          {
            code: "export * from 'posthog-js';",
            errors: [{ messageId: "blocked" }],
          },
          {
            code: "import type { X } from '@sentry/nextjs';",  // type-only imports of blocked packages are still blocked
            errors: [{ messageId: "blocked" }],
          },
          {
            code: "import { track } from '@microsoft/clarity';",
            errors: [{ messageId: "blocked" }],
          },
          {
            code: "import p from 'plausible-tracker';",
            errors: [{ messageId: "blocked" }],
          },
        ],
      });
    }).not.toThrow();
  });
});
