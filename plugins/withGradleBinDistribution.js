/**
 * Expo config plugin: download the smaller Gradle "-bin" distribution instead of "-all".
 *
 * Why: EAS builds generate the android/ folder, whose Gradle wrapper points at
 * gradle-7.5.1-all.zip. services.gradle.org has been timing out (HTTP 504) on
 * that file, failing builds before any code compiles. "-bin" is the same Gradle
 * without bundled docs/sources, so the build output is identical.
 */
const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("@expo/config-plugins");

function useBinDistribution(properties) {
  return properties.replace(
    /(distributionUrl=.*gradle-[\d.]+)-all\.zip/,
    "$1-bin.zip"
  );
}

const withGradleBinDistribution = (config) =>
  withDangerousMod(config, [
    "android",
    async (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, "gradle", "wrapper", "gradle-wrapper.properties");
      if (fs.existsSync(file)) {
        const before = fs.readFileSync(file, "utf8");
        const after = useBinDistribution(before);
        if (after !== before) fs.writeFileSync(file, after);
      }
      return cfg;
    },
  ]);

module.exports = withGradleBinDistribution;
module.exports.useBinDistribution = useBinDistribution;
