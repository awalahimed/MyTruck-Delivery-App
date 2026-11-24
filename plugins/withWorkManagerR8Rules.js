const fs = require("fs");
const path = require("path");
const { withDangerousMod, withGradleProperties } = require("@expo/config-plugins");

const KEEP_RULES = [
  "# Keep constructors used reflectively by AndroidX WorkManager/Room on SDK 58.",
  "-keep class * extends androidx.room.RoomDatabase { <init>(); }",
  "-keep class * extends androidx.work.InputMerger { <init>(); }",
  "# Keep react-native-maps and Google Maps classes intact under R8 (defensive; they use reflection).",
  "-keep class com.rnmaps.** { *; }",
  "-keep class com.google.android.gms.maps.** { *; }",
  "-keep interface com.google.android.gms.maps.** { *; }",
].join("\n");

module.exports = function withWorkManagerR8Rules(config) {
  config = withGradleProperties(config, (config) => {
    const key = "android.enableMinifyInReleaseBuilds";
    const properties = config.modResults.filter(
      (item) => !(item.type === "property" && item.key === key)
    );
    properties.push({ type: "property", key, value: "true" });
    config.modResults = properties;
    return config;
  });

  return withDangerousMod(config, ["android", async (config) => {
    const rulesFile = path.join(
      config.modRequest.platformProjectRoot,
      "app",
      "proguard-rules.pro"
    );
    const existing = fs.existsSync(rulesFile)
      ? fs.readFileSync(rulesFile, "utf8")
      : "";
    const missingRules = KEEP_RULES.split("\n").filter(
      (rule) => !existing.includes(rule)
    );
    if (missingRules.length) {
      fs.appendFileSync(rulesFile, `${existing.endsWith("\n") || !existing ? "" : "\n"}${missingRules.join("\n")}\n`);
    }
    return config;
  }]);
};
