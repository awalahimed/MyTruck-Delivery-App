// PostCSS config for NativeWind 2.x (Expo SDK 48).
// NativeWind 2.x requires synchronous PostCSS processing.
// tailwindcss is pinned to 3.3.7 and postcss to 8.4.47 via package.json
// overrides to keep the pipeline synchronous.
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
