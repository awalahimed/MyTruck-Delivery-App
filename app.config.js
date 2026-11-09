// Extends app.json. The Chapa secret key is injected at build time from the
// CHAPA_SECRET_KEY environment variable (an EAS "sensitive" variable, or a local
// .env for development) so it is never committed to the repository.
//
// SECURITY NOTE: anything in `extra` ships inside the APK and can be extracted.
// This is an interim measure until the Chapa calls run on a server
// (functions/index.js). The app always tries the server first.
module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    chapaSecretKey: process.env.CHAPA_SECRET_KEY || "",
  },
});
