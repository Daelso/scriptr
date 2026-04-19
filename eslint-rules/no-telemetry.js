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
  "bugsnag",
  "@bugsnag/",
  "rollbar",
  "react-ga",
  "react-ga4",
  "gtag",
  "hotjar",
  "fullstory",
  "logrocket",
  "datadog-rum",
  "@datadog/",
  "newrelic",
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
