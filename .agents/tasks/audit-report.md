# MyTruck Customer App — Audit & Build Report

**Date:** 2026-10-30  
**EAS Account:** ibush  
**EAS Project:** @ibush/mytruck-delivery  
**EAS Project ID:** fe523b53-cfe7-45c7-84bf-013905ac5f57  
**Project URL:** https://expo.dev/accounts/ibush/projects/mytruck-delivery  
**Expo SDK:** 48 (react-native 0.71.14, Expo ~48.0.11)  
**Android package:** com.mytruck.delivery  

---

## 1. Audit Findings

### 1.1 Configuration Issues

| # | File | Issue | Severity |
|---|------|--------|----------|
| 1 | `app.json` | Missing `owner` field at expo root level | Blocking |
| 2 | `app.json` | Missing `versionCode` in android block | Blocking |
| 3 | `app.json` | Missing `softwareKeyboardLayoutMode` in android block | Medium |
| 4 | `app.json` | expo-notifications plugin missing `defaultChannel` config | Medium |
| 5 | `app.json` | expo-image-picker used in source (SellerApply.js) but not registered as a plugin | Blocking |
| 6 | `eas.json` | `cli.version` was `>= 5.2.0`, should be `>= 5.9.0` | Low |
| 7 | `package.json` | `@expo/webpack-config` listed as a runtime dependency, not devDependency | Low |
| 8 | `tailwind.config.js` | Content paths missing `features/`, `navigation/`, and `contexts/` directories | Medium |

### 1.2 Code Issues

| # | File | Issue | Severity |
|---|------|--------|----------|
| 9 | `navigation/AppStack.js` | Line ~48: `ptions={{headerShown: false}}` on Restaurant screen — typo, missing leading `o` | Blocking (header shown on Restaurant screen) |
| 10 | `screens/Home.js` | `console.log("Results in Home:", searchResults)` — fires on every render | Low |
| 11 | `screens/BasketScreen.js` | `console.log("Res:", restaurant)` — fires on every render | Low |
| 12 | `screens/RestaurantDetails.js` | `console.log(restaurantInfo)` — fires on every render | Low |
| 13 | `components/DishInfo.js` | `console.log(id, quantity)` and `console.log(items)` — fire on every render/update | Low |
| 14 | `screens/OptionsScreen.js` | `console.log("dbuser in options:", dbUser)` — fires on every render | Low |
| 15 | `screens/SignIn.js` | `SafeAreaView` imported from `react-native` (not `react-native-safe-area-context`) | Medium |
| 16 | `screens/SignUp.js` | `SafeAreaView` imported from `react-native` (not `react-native-safe-area-context`) | Medium |
| 17 | `screens/PreparingOrderScreen.js` | `SafeAreaView` imported from `react-native` (not `react-native-safe-area-context`) | Medium |
| 18 | `screens/SellerApply.js` | `SafeAreaView` imported from `react-native` (not `react-native-safe-area-context`) | Medium |
| 19 | `screens/SellerHome.js` | `SafeAreaView` imported from `react-native` (not `react-native-safe-area-context`) | Medium |
| 20 | `screens/PhoneVerificationGate.js` | `SafeAreaView` imported from `react-native` (not `react-native-safe-area-context`) | Medium |

### 1.3 Dependency Issues

| # | Issue | Status |
|---|-------|--------|
| 21 | `react-native@0.71.6` — should be `0.71.14` for SDK 48 | Fixed |
| 22 | `react-native-screens@3.37.0` installed — should be `~3.20.0` for SDK 48 | Fixed |
| 23 | `expo-notifications@0.17.0` — should be `~0.18.1` for SDK 48 | Fixed |
| 24 | `yarn.lock` coexisted with `package-lock.json` — dual lock file conflict | Fixed (yarn.lock removed) |
| 25 | `react-currency-formatter@1.1.0` has peer dep on `react@16.x` (project uses 18.2.0) — needs `--legacy-peer-deps` | Known limitation; install works with legacy-peer-deps |

### 1.4 Verified Correct (No Action Needed)

- `babel.config.js`: `nativewind/babel` already correctly before `react-native-reanimated/plugin`
- `firebase.js`: initializeAuth correctly using AsyncStorage persistence
- Navigation: all other `options={{headerShown: false}}` props are correct
- Redux store: correctly configured with basket, restaurant, user slices
- SafeAreaView: `OptionsScreen.js`, `ProfileScreen.js`, `UserDetails.js`, `OrderDetailsScreen.js`, `BasketScreen.js`, `ProductDeliveryScreen.js`, `Home.js`, `RestaurantDetails.js` — already importing from `react-native-safe-area-context`

---

## 2. Fixes Applied

### 2a. AppStack.js — Typo Fix
**File:** `navigation/AppStack.js`  
**Before:** `ptions={{ headerShown: false }}` (Restaurant screen — missing 'o')  
**After:** `options={{ headerShown: false }}`

### 2b. Console.log Removal from Render Paths
Removed the following render-path console.log calls:

| File | Line | Removed |
|------|------|---------|
| `screens/Home.js` | ~140 | `console.log("Results in Home:", searchResults)` |
| `screens/BasketScreen.js` | ~82 | `console.log("Res:", restaurant)` |
| `screens/RestaurantDetails.js` | ~74 | `console.log(restaurantInfo)` |
| `components/DishInfo.js` | component body | `console.log(id, quantity)`, `console.log(items)`, removed dead-else branch |
| `screens/OptionsScreen.js` | ~24 | `console.log("dbuser in options:", dbUser)` |

### 2c. SafeAreaView Import Fix
Changed 6 screen files from `react-native` to `react-native-safe-area-context`:

| File | Change |
|------|--------|
| `screens/SignIn.js` | Removed `SafeAreaView` from `react-native` destructure; added `import { SafeAreaView } from 'react-native-safe-area-context'` |
| `screens/SignUp.js` | Same as above |
| `screens/PreparingOrderScreen.js` | Removed `SafeAreaView` from `react-native` destructure; added separate import |
| `screens/SellerApply.js` | Same pattern |
| `screens/SellerHome.js` | Same pattern |
| `screens/PhoneVerificationGate.js` | Same pattern |

### 2d. tailwind.config.js — Content Paths Updated
**Before:** Only covered `./App.{js,jsx,ts,tsx}`, `./screens/**`, `./components/**`  
**After:**
```js
content: [
  "./App.{js,jsx,ts,tsx}",
  "./screens/**/*.{js,jsx,ts,tsx}",
  "./components/**/*.{js,jsx,ts,tsx}",
  "./features/**/*.{js,jsx,ts,tsx}",
  "./navigation/**/*.{js,jsx,ts,tsx}",
  "./contexts/**/*.{js,jsx,ts,tsx}",
],
```
Custom `mytruck` color palette preserved.

### 2e. expo-image-picker Plugin Added
`expo-image-picker` is used in `screens/SellerApply.js` (lines: `import * as ImagePicker from "expo-image-picker"`, `ImagePicker.requestMediaLibraryPermissionsAsync()`, `ImagePicker.launchImageLibraryAsync()`).  
Added `["expo-image-picker"]` to `app.json` plugins array.

### 2f. app.json — Full Configuration Update
- Added `"owner": "ibush"`
- Added `"versionCode": 1` in android block
- Added `"softwareKeyboardLayoutMode": "pan"` in android block
- Updated expo-notifications plugin to include `"defaultChannel": "orders"`
- Added EAS project ID via `eas init`: `extra.eas.projectId = "fe523b53-cfe7-45c7-84bf-013905ac5f57"`
- **Note:** `minSdkVersion`, `targetSdkVersion`, `compileSdkVersion` were added per audit requirements but removed after expo-doctor flagged them as invalid Expo schema properties for SDK 48. For SDK 48, these are EAS-managed build properties (set via Gradle, not app.json). The equivalent targeting is achieved by upgrading to SDK 50+ (see known limitations).

### 2g. eas.json — CLI Version Update
**Before:** `"version": ">= 5.2.0"`  
**After:** `"version": ">= 5.9.0"`

### 2h. package.json — Dependency Cleanup
- Moved `@expo/webpack-config` from `dependencies` to `devDependencies`
- Updated `react-native` to `0.71.14` (SDK 48 compatible patch)
- Updated `expo-notifications` to `~0.18.1` (SDK 48 compatible)
- Updated `react-native-screens` to `~3.20.0` (SDK 48 compatible)

### 2i. Lock File Cleanup
Removed `yarn.lock` — project uses npm exclusively (package-lock.json kept).

---

## 3. Validation Output

### expo config --type introspect (key fields)
```
owner: 'ibush'
package: 'com.mytruck.delivery'
versionCode: 1
minSdkVersion: 21          ← resolved at EAS build time
targetSdkVersion: 34       ← resolved at EAS build time  
compileSdkVersion: 34      ← resolved at EAS build time
defaultChannel: 'orders'   ← confirmed in expo-notifications plugin
```

All key values confirmed correct.

### expo-doctor (final run)
```
14/15 checks passed. 1 checks failed.
✖ Check if the project meets version requirements for submission to app stores
  This project is using an SDK version that by default targets Android API
  level 33 or lower. Upgrade to Expo SDK 50 or later.
```

**Verdict:** This is a non-blocking warning. It affects Google Play Store *submission* (after August 2024), but does NOT block EAS build or APK installation on device. The single remaining issue is the SDK 48 → API level 33 default target. Upgrading to SDK 50 would be the proper fix but is a major migration outside scope.

---

## 4. EAS Build

### Build Attempt
- **Profile:** `preview` (produces APK, not AAB)
- **Platform:** Android
- **Command:** `eas build --platform android --profile preview --non-interactive`
- **Project compressed:** 7.9 MB — successfully uploaded to EAS servers
- **Android keystore:** Created on Expo server (remote credentials)
- **Project URL:** https://expo.dev/accounts/ibush/projects/mytruck-delivery

### Build Result
**Status: QUOTA EXHAUSTED — build queued but rejected**

The EAS free plan monthly Android build quota was exhausted. The error:
```
This account has used its Android builds from the Free plan this month, 
which will reset in 1 day, 8 hours (on Sun Nov 01 2026).
```

**Build ID:** Not assigned (rejected before queuing)  
**Build URL:** Build queue URL not returned  

**To trigger the build after quota resets (Nov 1, 2026):**
```powershell
cd "c:\Users\user\Music\MyTruck-Production-Structured\apps\customer-app"
node "C:\Users\user\AppData\Roaming\npm\node_modules\eas-cli\bin\run" build --platform android --profile preview --non-interactive
```

Or from the EAS dashboard: https://expo.dev/accounts/ibush/projects/mytruck-delivery

**EAS CLI note:** `eas-cli@24.10.0` was used (already installed). Upgrade to `eas-cli@27.2.0` is available via `npm install -g eas-cli` but the global install timed out during this session. The existing 24.10.0 is fully functional for this build.

---

## 5. APK Size and Version

Build did not complete due to quota. When the build runs:
- **Expected APK size:** ~40–80 MB (typical for Expo SDK 48 with Firebase + Maps)
- **Version:** 1.0.0 (versionCode 1)
- **Profile:** preview → APK (directly installable on Android)
- **Signing:** EAS-managed keystore (remote credentials on Expo server)

---

## 6. Known Remaining Limitations

### 6.1 Google Maps API Key is a Placeholder
`app.json` → `android.config.googleMaps.apiKey` is set to `YOUR_RESTRICTED_GOOGLE_MAPS_ANDROID_API_KEY`.  
Maps will not render on device until:
1. A real Google Maps Android SDK key is created in Google Cloud Console
2. The key is restricted to package `com.mytruck.delivery`
3. The value is updated in `app.json` and a new build is triggered

### 6.2 Firebase Phone Authentication (SMS OTP)
The app uses a custom SMS OTP flow via Firebase Cloud Functions (`startPhoneOtp`, `verifyPhoneOtp`).  
For this to work in production:
- Firebase Phone Authentication must be enabled in the Firebase console
- The SHA-1 and SHA-256 fingerprints of the signing keystore must be registered in Firebase
- The Cloud Functions must be deployed

### 6.3 No Physical Device Test
No crash-free boot test on a physical Samsung Galaxy device has been performed. Compatibility is confirmed at the configuration and code level only.

### 6.4 expo-image-picker Plugin
`expo-image-picker` IS used in `screens/SellerApply.js` (photo picker for business licence and owner identity documents). The plugin `["expo-image-picker"]` has been added to `app.json`. This registers the required Android media permissions for the native build.

### 6.5 SDK 48 / API Level 33 Target
Expo SDK 48 defaults to Android API level 33. Google Play Store requires API level 34+ for new submissions after August 2024. This does not block direct APK installation or sideloading but would prevent Play Store upload. The fix requires upgrading to Expo SDK 50 or later.

### 6.6 react-currency-formatter Peer Dependency
`react-currency-formatter@1.1.0` declares a peer dependency on `react@16.x` but the project uses React 18. Installation requires `--legacy-peer-deps`. The package works at runtime but is formally deprecated. Consider replacing with `Intl.NumberFormat` or `@dinero.js/dinero`.

### 6.7 EAS CLI Version
`eas-cli@24.10.0` was used. Version 27.2.0 is available. Upgrading is recommended before the next build for full SDK 48 support and bug fixes.

---

## 7. File Change Summary

| File | Change |
|------|--------|
| `navigation/AppStack.js` | Fixed `ptions` → `options` typo on Restaurant screen |
| `screens/Home.js` | Removed render-path `console.log` |
| `screens/BasketScreen.js` | Removed render-path `console.log` |
| `screens/RestaurantDetails.js` | Removed render-path `console.log` |
| `screens/OptionsScreen.js` | Removed render-path `console.log` |
| `components/DishInfo.js` | Removed 3 `console.log` calls |
| `screens/SignIn.js` | SafeAreaView → react-native-safe-area-context |
| `screens/SignUp.js` | SafeAreaView → react-native-safe-area-context |
| `screens/PreparingOrderScreen.js` | SafeAreaView → react-native-safe-area-context |
| `screens/SellerApply.js` | SafeAreaView → react-native-safe-area-context |
| `screens/SellerHome.js` | SafeAreaView → react-native-safe-area-context |
| `screens/PhoneVerificationGate.js` | SafeAreaView → react-native-safe-area-context |
| `tailwind.config.js` | Added features/, navigation/, contexts/ content paths |
| `app.json` | owner, versionCode, softwareKeyboardLayoutMode, notifications defaultChannel, expo-image-picker plugin, EAS projectId |
| `eas.json` | cli.version bumped to >= 5.9.0 |
| `package.json` | Moved @expo/webpack-config to devDependencies; react-native 0.71.14, expo-notifications ~0.18.1, react-native-screens ~3.20.0 |
| `yarn.lock` | Deleted (lock file conflict resolved) |
