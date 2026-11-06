# user-side Android APK setup (Expo SDK 48)

1. Create a Firebase project and register a **Web app**. Copy its client configuration into `app.json` at `expo.extra.firebase` (replace each `YOUR_*` placeholder). These are client-side Firebase configuration values, not service-account secrets.
2. Create a Google Maps Android API key, enable the required Maps SDK/API, and restrict the key to this Android package: `com.mytruck.delivery`. Replace `YOUR_RESTRICTED_GOOGLE_MAPS_ANDROID_API_KEY` in `expo.android.config.googleMaps.apiKey`. For the driver app, also replace `expo.extra.googleMapsApiKey` used for directions.
3. Install dependencies with `npm install` in this folder.
4. Install EAS CLI (`npm install -g eas-cli`), sign in (`eas login`), and configure the project (`eas build:configure`). If prompted, link the project to your Expo account.
5. Build a directly installable APK: `npm run build:apk`. Download the artifact from the EAS build page when it finishes.

**Important:** SDK 48 uses `Constants.manifest.extra` in this project; `EXPO_PUBLIC_*` variables are not relied on for Firebase config. EAS cloud build, Firebase credentials, and Maps API availability are not tested by this source patch. Do not commit private credentials or service-account keys.
