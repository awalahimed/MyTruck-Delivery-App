const { withGradleProperties } = require("@expo/config-plugins");

/** Apply smaller Android release settings only when the EAS preview profile asks for them. */
module.exports = function withPreviewAndroidOptimization(config) {
  const architectures = String(process.env.MYTRUCK_ANDROID_ABIS || "").trim();
  const shrinkResources = String(process.env.MYTRUCK_ANDROID_SHRINK_RESOURCES || "").trim().toLowerCase() === "true";
  const compressNativeLibraries = String(process.env.MYTRUCK_ANDROID_COMPRESS_LIBS || "").trim().toLowerCase() === "true";
  if (!architectures && !shrinkResources && !compressNativeLibraries) return config;

  return withGradleProperties(config, (config) => {
    const properties = config.modResults;
    const setProperty = (key, value) => {
      const existing = properties.find((entry) => entry.type === "property" && entry.key === key);
      if (existing) existing.value = value;
      else properties.push({ type: "property", key, value });
    };

    if (architectures) setProperty("reactNativeArchitectures", architectures);
    if (shrinkResources) setProperty("android.enableShrinkResourcesInReleaseBuilds", "true");
    if (compressNativeLibraries) setProperty("expo.useLegacyPackaging", "true");
    return config;
  });
};
