const { withAndroidManifest } = require("@expo/config-plugins");

/** Google Maps Android renders map tiles through a hardware-accelerated surface. */
module.exports = function withMapsHardwareAcceleration(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (application) {
      application.$["android:hardwareAccelerated"] = "true";
      const mainActivity = application.activity?.find((activity) =>
        activity.$?.["android:name"]?.endsWith("MainActivity")
      );
      if (mainActivity) {
        mainActivity.$["android:hardwareAccelerated"] = "true";
      }
    }
    return config;
  });
};
