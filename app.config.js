const cleanEnv = (raw) => String(raw || "").trim().replace(/^["']|["']$/g, "");

module.exports = ({ config }) => {
  const safeExtra = { ...(config.extra || {}) };
  delete safeExtra.chapaSecretKey;
  delete safeExtra.googleMapsApiKey;
  delete safeExtra.googleMapsAndroidApiKey;
  delete safeExtra.GOOGLE_MAPS_ANDROID_API_KEY;
  const googleMapsAndroidApiKey = cleanEnv(process.env.GOOGLE_MAPS_ANDROID_API_KEY);
  const android = { ...config.android };
  if (android.config?.googleMaps) {
    const { googleMaps: _oldGoogleMaps, ...nativeConfig } = android.config;
    android.config = Object.keys(nativeConfig).length ? nativeConfig : undefined;
  }
  const plugins = (config.plugins || []).filter((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    return name !== "@rnmapbox/maps" && name !== "@maplibre/maplibre-react-native" && name !== "react-native-maps";
  });

  return {
    ...config,
    android,
    ios: { ...config.ios },
    plugins: [
      ...plugins,
      ["react-native-maps", { androidGoogleMapsApiKey: googleMapsAndroidApiKey || undefined }],
      "./plugins/withPreviewAndroidOptimization",
      "@react-native-community/datetimepicker",
    ],
    extra: {
      ...safeExtra,
      // The key is injected into the Android manifest by the config plugin.
      // Do not put it in Expo `extra`, which is bundled into JavaScript.
      maps: { provider: "google", androidKeyConfigured: Boolean(googleMapsAndroidApiKey) },
      perfTimings: process.env.PERF_TIMINGS === "1",
    },
  };
};
