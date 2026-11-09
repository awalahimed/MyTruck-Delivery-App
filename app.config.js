// Extends app.json. The Chapa secret key is injected at build time from the
// CHAPA_SECRET_KEY environment variable (an EAS "sensitive" variable, or a local
// .env for development) so it is never committed to the repository.
//
// SECURITY NOTE: anything in `extra` ships inside the APK and can be extracted.
// This is an interim measure until the Chapa calls run on a server
// (functions/index.js). The app always tries the server first.

// Accept the value however it was pasted: "CHAPA_SECRET_KEY=CHASECK-…", quoted, or with spaces.
// (A pasted "NAME=value" line made Chapa reject every payment in 1.0.5.)
function cleanChapaKey(raw) {
  let v = String(raw || "").trim();
  v = v.replace(/^\s*(export\s+)?CHAPA_SECRET_KEY\s*=\s*/i, "");
  v = v.replace(/^["']|["']$/g, "").trim();
  return v;
}

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    chapaSecretKey: cleanChapaKey(process.env.CHAPA_SECRET_KEY),
  },
});

module.exports.cleanChapaKey = cleanChapaKey;
