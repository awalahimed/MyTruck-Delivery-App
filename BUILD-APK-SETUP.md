# Android APK setup

1. Create a Firebase project and register a **Web app**. Copy its client configuration into `app.json` at `expo.extra.firebase` (replace each `YOUR_*` placeholder). These are client-side Firebase configuration values, not service-account secrets.
2. Map screens use Google Maps via `react-native-maps`. Add your Google Maps API key to your `.env` as `GOOGLE_MAPS_API_KEY=AIzaSy...` (or in EAS Build variables: `eas env:update preview --variable-name GOOGLE_MAPS_API_KEY`). Make sure "Maps SDK for Android", "Maps SDK for iOS", "Directions API", and "Geocoding API" are enabled on your Google Cloud Console project.
3. Install dependencies with `npm install` in this folder.
4. Install EAS CLI (`npm install -g eas-cli`), sign in (`eas login`), and configure the project (`eas build:configure`). If prompted, link the project to your Expo account.
5. Build a directly installable APK: `npm run build:apk`. Download the artifact from the EAS build page when it finishes.

**Important:** Firebase configuration still comes from `expo.extra.firebase`; this change only replaces the map renderer and tile source. EAS cloud builds and Firebase services are not tested by this source patch. Do not commit private credentials or service-account keys.
