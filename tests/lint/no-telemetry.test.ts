import { describe, it, expect } from "vitest";
import { RuleTester } from "eslint";
// @ts-expect-error — JS module
import noTelemetry from "../../eslint-rules/no-telemetry.js";

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

describe("no-telemetry", () => {
  it("fails for each banned package", () => {
    expect(() => {
      tester.run("no-telemetry", noTelemetry, {
        valid: [
          { code: "import x from 'next';" },
          { code: "import { a } from './util';" },
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
        ],
      });
    }).not.toThrow();
  });
});
