# Android APK setup

## Google Maps key for local builds

1. In Google Cloud Console, enable **Maps SDK for Android** in the billing-enabled project.
2. Restrict the key to Android apps, package `com.mytruck.delivery`, and the SHA-1 fingerprint for the certificate that signs the APK. Restrict API usage to **Maps SDK for Android**.
3. Put `GOOGLE_MAPS_ANDROID_API_KEY=<your restricted key>` in the project-root `.env` file. `.env` is ignored by Git and by EAS uploads. Do not put this key in source code, `app.json`, or Expo `extra`.
4. `app.config.js` reads the local environment variable and the `react-native-maps` plugin injects it into the native Android manifest at prebuild time. The resulting APK contains the client key, as required for Google Maps; anyone who receives the APK can extract it, so Google Cloud restrictions and usage monitoring are required.

## Build a local APK

Install Android Studio with an Android SDK and a Java 17 JDK, connect an Android phone with USB debugging enabled (or start an emulator), then run:

```powershell
npm run build:apk:local
```

This regenerates the ignored `android/` directory from Expo configuration and compiles/installs the release variant locally. The APK is normally written to `android/app/build/outputs/apk/release/app-release.apk`. The current local Gradle template signs its release variant with the debug keystore, so this command is for development/internal sharing only. Add that signing certificate's SHA-1 in Google Cloud. For a production APK, configure a stable private release keystore and use its SHA-1; do not distribute a debug-signed production release.

The value in `.env` is used only while building. Recipients do not need a `.env` file: the native Google Maps SDK key is included in the APK. All recipients use the same embedded key, and it works only while its package/certificate/API restrictions allow it.

## EAS cloud build

The existing `npm run build:apk` command still uses EAS cloud and the `preview` environment. EAS does not upload `.env` because `.easignore` excludes it. For cloud builds, set `GOOGLE_MAPS_ANDROID_API_KEY` in EAS's selected environment instead.

## Limits and verification

The Android Maps SDK key powers the Google basemap. Routing/geocoding remain separate OSRM/Photon/device fallbacks; this key is not a Google Routes or Geocoding web-service key. Expo Go can render `react-native-maps` for quick iteration, but native key injection is verified only in a rebuilt custom APK. A successful build does not prove Google Cloud restrictions, billing, or map loading; test on a physical Android device.

Before enabling Chapa payments in a deployment, set the Firebase Functions `CHAPA_SECRET_KEY` secret and deploy the Functions. The mobile app must not contain a Chapa secret.
