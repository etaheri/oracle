// Expo reads this in preference to app.json and receives app.json's contents
// as `config` — so everything static still lives there, and only the pieces
// that depend on the environment are decided here.
//
// The Sentry plugin used to carry `organization: "SENTRY_ORG_TBD_BY_ERIK"`, a
// placeholder that would have gone to EAS as a real org name and broken every
// source-map upload (audit 2026-09-02 §6.1). A build must not carry a
// pretend value: with SENTRY_ORG set the plugin is configured properly, and
// without it the plugin is dropped entirely. Sentry then degrades exactly the
// way every other SDK in this app does — dark, not broken. The runtime DSN is
// separate and already optional (EXPO_PUBLIC_SENTRY_DSN, see config/keys.ts).
module.exports = ({ config }) => {
  const organization = process.env.SENTRY_ORG?.trim();
  const plugins = (config.plugins ?? []).filter(
    (p) => !(Array.isArray(p) && p[0] === "@sentry/react-native/expo"),
  );
  if (organization) {
    plugins.push(["@sentry/react-native/expo", { organization, project: process.env.SENTRY_PROJECT?.trim() || "oracle-mobile" }]);
  }
  return { ...config, plugins };
};
