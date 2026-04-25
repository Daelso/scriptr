/**
 * Block imports of analytics / telemetry / crash-reporting packages.
 * Privacy is a first-class design pillar of scriptr.
 */
const BLOCKED = [
  "@sentry/",
  "posthog-js",
  "posthog-node",
  "@vercel/analytics",
  "@vercel/speed-insights",
  "mixpanel",
  "mixpanel-browser",
  "amplitude",
  "@amplitude/",
  "segment",
  "@segment/",
  "rudderstack",
  "@rudderstack/", // RudderStack
  "mparticle",
  "@mparticle/", // mParticle
  "heap",
  "heap-analytics", // Heap
  "@microsoft/clarity", // Microsoft Clarity
  "@clarity-js/", // Clarity JS
  "bugsnag",
  "@bugsnag/",
  "rollbar",
  "react-ga",
  "react-ga4",
  "gtag",
  "gtm", // Google Tag Manager shorthand
  "@google-analytics/", // Google Analytics scoped
  "hotjar",
  "fullstory",
  "logrocket",
  "datadog-rum",
  "@datadog/",
  "newrelic",
  "intercom-client", // Intercom direct
  "@intercom/", // Intercom
  "plausible-tracker", // Plausible — even self-hostable trackers count as telemetry
  "@plausible/", // Plausible scoped
  "umami-analytics", // Umami tracker
  "matomo-tracker", // Matomo
  "@matomo/", // Matomo scoped
  // Electron-specific telemetry packages (note: `crashReporter` from "electron"
  // is enforced by code review — see comment in electron/main.ts)
  "electron-log",                  // popular remote-logging package; can phone home
  "@electron/remote",              // not telemetry per se but enables main-process access from renderer; ban out of caution
  "electron-google-analytics",
  "electron-fiddle-telemetry",
];

function isBlocked(name) {
  return BLOCKED.some((prefix) =>
    prefix.endsWith("/") ? name.startsWith(prefix) : name === prefix || name.startsWith(`${prefix}/`)
  );
}

module.exports = {
  meta: {
    type: "problem",
    docs: { description: "Ban telemetry/analytics package imports" },
    schema: [],
    messages: {
      blocked: "Telemetry package '{{name}}' is banned. scriptr ships no analytics.",
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (isBlocked(node.source.value)) {
          context.report({ node, messageId: "blocked", data: { name: node.source.value } });
        }
      },
      // Dynamic import() expressions — ESLint 9 parses these as ImportExpression
      ImportExpression(node) {
        const src = node.source;
        if (src && src.type === "Literal" && typeof src.value === "string" && isBlocked(src.value)) {
          context.report({ node, messageId: "blocked", data: { name: src.value } });
        }
      },
      ExportNamedDeclaration(node) {
        if (node.source && isBlocked(node.source.value)) {
          context.report({ node, messageId: "blocked", data: { name: node.source.value } });
        }
      },
      ExportAllDeclaration(node) {
        if (node.source && isBlocked(node.source.value)) {
          context.report({ node, messageId: "blocked", data: { name: node.source.value } });
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        const isRequire = callee.type === "Identifier" && callee.name === "require";
        // callee.type === "Import" is the old espree representation; kept for compat
        const isDynamicImport = callee.type === "Import";
        if (!isRequire && !isDynamicImport) return;
        const arg = node.arguments[0];
        if (arg && arg.type === "Literal" && typeof arg.value === "string" && isBlocked(arg.value)) {
          context.report({ node, messageId: "blocked", data: { name: arg.value } });
        }
      },
    };
  },
};
