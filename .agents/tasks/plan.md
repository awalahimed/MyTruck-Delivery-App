# Implementation Plan — MyTruck Customer App Bug Fixes & UI Rebuild

> **Constraints (never violate)**
> - tailwindcss 3.2.7 / postcss 8.4.31 — do not change versions
> - Do not upgrade Expo / React Native packages
> - Do not touch `babel.config.js` or `postcss.config.js`
> - `app.json`: package name `com.mytruck.delivery`, owner `ibushs-team` — do not change
> - Do not touch `eas.json`
> - `OTP_VERIFICATION_REQUIRED = false` must stay `false` in `AuthContext.js`
> - Do not add new npm packages unless the item explicitly allows it

---

## Findings from codebase reading

| File | Confirmed observation |
|------|-----------------------|
| `firebase.js` | `getStorage(app)` — no explicit bucket URL passed. `app.json` storageBucket is `mytruck-delivery.firebasestorage.app` (new format), confirmed. |
| `AuthContext.js` | No safety timeout. `authLoading` stays `true` indefinitely if Firestore hangs. No fallback when `dbUser` is null after auth. |
| `RootNavigator.js` | `if (!dbUser) return null;` — confirmed permanent blank screen if profile load fails. |
| `SellerApply.js` | `functions/not-found` catch block calls `uploadPhoto` unwrapped. If storage throws, Firebase Auth account already exists but `dbUser` never sets → blank screen. `sellerApplications` doc is also missing from the bypass path. |
| `Home.js` | Modal `<MapView>` has no `provider` prop. `<Text style={styles.seeAll}>See All ›</Text>` has no `onPress`. Food shortcut button clears filters but no `ScrollView` ref / scroll-to. |
| `UserDetails.js` | `<MapView>` has no `provider` prop. |
| `ProfileScreen.js` | `<MapView>` has no `provider` prop. |
| `PreparingOrderScreen.js` | `<MapView>` has no `provider` prop. |
| `OptionsScreen.js` | Minimal — no role badge, no admin section, no premium layout. |
| `AppStack.js` | `AdminDashboard` not imported or registered. |
| `RestaurantDetails.js` | Back button: `onPress={() => navigation.goBack()}` — ✅ correct arrow-function form. |
| `BasketScreen.js` | No back button (uses XCircleIcon close). No MapView. ✅ no issue. |
| `OrderDetailsScreen.js` | Back button: `onPress={() => navigation.goBack()}` — ✅ correct. |
| `PreparingOrderScreen.js` | Back button: `onPress={() => navigation.goBack()}` — ✅ correct. |
| `ProductDeliveryScreen.js` | Uses `ScreenHeader` — back handled inside component with arrow fn. ✅ |
| `ProfileScreen.js` | Back button: `onPress={() => navigation.goBack()}` — ✅ correct. |
| `SellerApply.js` | Back button: `onPress={() => navigation.goBack()}` — ✅ correct. |
| `OptionsScreen.js` | Back button uses `Pressable onPress={() => navigation.goBack()}` — ✅ correct form, but will be rebuilt anyway. |
| `SignIn.js` | No back button (root auth screen). ✅ |
| `components/ui/` | No `BackButton.js` yet — must be created. |

**Conclusion on back buttons**: No screen uses the broken `onPress={navigation.goBack}` (unbound) form. All existing back buttons already use the arrow-function form. The `BackButton` component must still be created and inserted per the task spec, but there are no broken back button bugs to fix in existing screens beyond the component not existing. After creating `BackButton.js`, screens that already have their own back button UI can optionally adopt it — the plan marks screens that have inline `ArrowLeftIcon` back buttons as candidates for adoption but marks them optional so the codebase stays buildable at every step.

---

## Ordered implementation steps

---

- [ ] **1. Fix `firebase.js` — pass explicit storage bucket**

  **What**: Change `getStorage(app)` to `getStorage(app, "gs://mytruck-delivery.appspot.com")`. This forces the Firebase Storage SDK to use the legacy `.appspot.com` bucket URL that SDK v9.19.1 accepts instead of the new `.firebasestorage.app` domain in `app.json`. Do not change `app.json`.

  **Files**: `apps/customer-app/firebase.js`

  **Exact change**:
  ```js
  // Before
  export const storage = getStorage(app);
  // After
  export const storage = getStorage(app, "gs://mytruck-delivery.appspot.com");
  ```

  **Verify**: `expo start` builds without error. The storage export is used in `SellerApply.js`; step 3 will validate it end-to-end.

---

- [ ] **2. Fix `AuthContext.js` — add 8-second safety timeout on `authLoading`**

  **What**: In the `useEffect` that calls `onAuthStateChanged`, add a `setTimeout` that calls `setAuthLoading(false)` after 8 000 ms if `authLoading` is still `true`. Cancel the timeout via `clearTimeout` in the cleanup function alongside `unsubscribe()`. This prevents a permanent splash-screen freeze if Firestore is unreachable.

  **Constraint**: Keep `OTP_VERIFICATION_REQUIRED = false` untouched.

  **Files**: `apps/customer-app/contexts/AuthContext.js`

  **Exact insertion** — inside the `useEffect`, after the `let active = true;` line, before the `onAuthStateChanged` call:
  ```js
  // Safety timeout: if auth state never resolves (e.g. Firestore unreachable),
  // release the splash screen after 8 seconds.
  const safetyTimer = setTimeout(() => {
    if (active) setAuthLoading(false);
  }, 8000);
  ```
  And in the cleanup return:
  ```js
  return () => {
    active = false;
    clearTimeout(safetyTimer);
    unsubscribe();
  };
  ```

  **Verify**: Existing app behavior unchanged when auth resolves normally. Splash screen no longer freezes permanently on Firestore timeout (manual test).

---

- [ ] **3. Fix `RootNavigator.js` — replace permanent `null` guard for missing `dbUser`**

  **What**: When `user` is set but `dbUser` is null, the current code returns `null` forever (confirmed in file). Replace this with a 3-second `useState` timer: after 3 s without a `dbUser`, fall through to `<AppStack />` so the customer can still use the app. Import `useState` and `useEffect` from React.

  **Files**: `apps/customer-app/navigation/RootNavigator.js`

  **Exact change** — add at the top of the component body (after the `UserAuth()` call):
  ```js
  const [profileTimedOut, setProfileTimedOut] = useState(false);
  useEffect(() => {
    if (!user || dbUser) {
      setProfileTimedOut(false);
      return;
    }
    const t = setTimeout(() => setProfileTimedOut(true), 3000);
    return () => clearTimeout(t);
  }, [user, dbUser]);
  ```
  Then replace:
  ```js
  // Before
  if (!dbUser) return null;
  // After
  if (!dbUser && !profileTimedOut) return null;
  ```
  Add the React import line at the top:
  ```js
  import { useState, useEffect } from "react";
  ```

  **Dependency**: Must be done after step 2 (the safety timeout in AuthContext reduces how often `!dbUser` is hit in the first place).

  **Verify**: App no longer shows a permanent blank screen when registration partially fails; after 3 s it falls through to `AppStack`.

---

- [ ] **4. Fix `SellerApply.js` — wrap registration body in try/catch with signOut rollback, make photo uploads non-fatal, add missing `sellerApplications` write**

  **What**: Three changes in the `functions/not-found` catch block (OTP-bypass registration path):

  **(a) Wrap the entire bypass body in its own inner try/catch** so that if any step after `createUserWithEmailAndPassword` fails, `signOut(auth)` is called before re-throwing. This prevents the "account created but no profile" zombie state.

  **(b) Wrap each `uploadPhoto` call in its own try/catch** that stores `null` on failure and logs a console.warn. Do not throw; let registration continue without the photo.

  **(c) Add the missing `sellerApplications` `addDoc` write** to the bypass path (it exists in the OTP-verified path at the top of the file but is absent from the bypass path — confirmed by reading the file).

  Import `signOut` from `firebase/auth` at the top (it is already imported in `AuthContext.js` but not in `SellerApply.js`). Also import `addDoc` (already imported).

  **Files**: `apps/customer-app/screens/SellerApply.js`

  **Exact change to imports** — add `signOut` to the existing firebase/auth import line:
  ```js
  import { createUserWithEmailAndPassword, signOut } from "firebase/auth";
  ```

  **Exact restructuring** of the `functions/not-found` catch block body:
  ```js
  if (["functions/not-found", "functions/unavailable", "functions/internal"].includes(code)) {
    try {
      const uid = auth.currentUser.uid;
      let licencePath = null;
      let ownerIdPath = null;
      try {
        if (licencePhoto) licencePath = await uploadPhoto(uid, licencePhoto, "business-licence.jpg");
      } catch (photoErr) {
        console.warn("Licence photo upload failed (non-fatal):", photoErr?.message);
      }
      try {
        if (ownerIdPhoto) ownerIdPath = await uploadPhoto(uid, ownerIdPhoto, "owner-identity.jpg");
      } catch (photoErr) {
        console.warn("Owner ID photo upload failed (non-fatal):", photoErr?.message);
      }
      const businessRef = doc(collection(db, form.sellerType === "shop" ? "shops" : "restaurants"));
      await setDoc(businessRef, {
        id: businessRef.id,
        name: form.businessName.trim(),
        businessName: form.businessName.trim(),
        ownerUid: uid,
        ownerName: form.fullName.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        sellerType: form.sellerType,
        status: "PENDING",
        isVerified: false,
        createdAt: serverTimestamp(),
      });
      await addDoc(collection(db, "sellerApplications"), {
        ownerUid: uid,
        ownerName: form.fullName.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        businessName: form.businessName.trim(),
        sellerType: form.sellerType,
        address: form.address.trim(),
        licenceNumber: form.licenceNumber.trim(),
        businessLicencePath: licencePath,
        ownerIdentityPath: ownerIdPath,
        sellerId: businessRef.id,
        status: "PENDING",
        createdAt: serverTimestamp(),
      });
      await setDoc(doc(db, "user", uid), {
        uid,
        email: form.email.trim(),
        fullName: form.fullName.trim(),
        phoneNumber: form.phone.trim(),
        phoneVerified: true,
        role: "pendingSeller",
        sellerType: form.sellerType,
        sellerId: businessRef.id,
        approvalStatus: "PENDING",
        createdAt: serverTimestamp(),
      }, { merge: true });
      await refreshProfile();
      Alert.alert("Application submitted", "Your business registration is pending admin review.");
    } catch (bypassErr) {
      // Profile was not written — roll back the Auth account so the user can retry cleanly
      try { await signOut(auth); } catch (_) {}
      throw bypassErr;
    }
  } else {
    throw smsErr;
  }
  ```

  **Dependency**: Step 1 (storage bucket fix) must be done first so `uploadPhoto` does not throw `storage/unknown`.

  **Verify**: Manual registration flow completes without blank screen. If storage fails, the app shows the error Alert rather than freezing.

---

- [ ] **5. Create `components/ui/BackButton.js`**

  **What**: Create a reusable `BackButton` component — a circular white button (48×48, borderRadius 24) with a 2px elevation/shadow, containing an `ArrowLeftIcon` (size 22) in teal `#179B83`. Accepts optional `onPress` prop; defaults to `navigation.goBack()` via `useNavigation()`.

  **Files**: `apps/customer-app/components/ui/BackButton.js` (new file)

  **Full content**:
  ```js
  import { TouchableOpacity, StyleSheet } from "react-native";
  import { ArrowLeftIcon } from "react-native-heroicons/solid";
  import { useNavigation } from "@react-navigation/native";

  /**
   * Circular white back button with teal ArrowLeftIcon.
   * Drop-in replacement for inline back button patterns across the app.
   *
   * @param {object} props
   * @param {function} [props.onPress] - Custom handler; defaults to navigation.goBack()
   * @param {object}  [props.style]   - Additional container style overrides
   */
  export default function BackButton({ onPress, style }) {
    const navigation = useNavigation();
    const handlePress = onPress ?? (() => navigation.goBack());
    return (
      <TouchableOpacity
        onPress={handlePress}
        style={[s.btn, style]}
        accessibilityLabel="Go back"
        accessibilityRole="button"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={0.75}
      >
        <ArrowLeftIcon size={22} color="#179B83" />
      </TouchableOpacity>
    );
  }

  const s = StyleSheet.create({
    btn: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: "white",
      alignItems: "center",
      justifyContent: "center",
      elevation: 2,
      shadowColor: "#000",
      shadowOpacity: 0.08,
      shadowOffset: { width: 0, height: 2 },
      shadowRadius: 4,
    },
  });
  ```

  **Verify**: Import `BackButton` in any screen and confirm no import errors when Metro bundler loads it.

---

- [ ] **6. Add `provider={null}` to every `<MapView>` instance**

  **What**: On Android, `react-native-maps` defaults to Google Maps when `provider` is not set. `provider={null}` forces the OSM/default renderer, which lets the Gebeta `UrlTile` overlay render correctly without Google attribution overriding it.

  **Files and exact locations**:

  | File | Location | Change |
  |------|----------|--------|
  | `screens/Home.js` | Modal `<MapView>` (line ≈ 176) | Add `provider={null}` |
  | `screens/UserDetails.js` | `<MapView className="w-full h-40"` | Add `provider={null}` |
  | `screens/ProfileScreen.js` | `<MapView className="w-full h-40"` | Add `provider={null}` |
  | `screens/PreparingOrderScreen.js` | `<MapView style={{ flex: 1 }}` | Add `provider={null}` |

  For each MapView, the change is simply:
  ```jsx
  // Before
  <MapView style={...} ...>
  // After
  <MapView provider={null} style={...} ...>
  ```

  **No other changes to these files in this step.**

  **Verify**: Run `expo start --android` and open the location modal in Home and the profile screen map. Gebeta tiles should render without Google branding beneath them.

---

- [ ] **7. Register `AdminDashboard` in `AppStack.js`**

  **What**: Import `AdminDashboard` and add a `<Stack.Screen name="AdminDashboard" component={AdminDashboard} options={{ headerShown: false }} />` entry. This must be done before step 8 (OptionsScreen navigation to AdminDashboard).

  **Files**: `apps/customer-app/navigation/AppStack.js`

  **Exact change** — add import at the top:
  ```js
  import AdminDashboard from "../screens/AdminDashboard";
  ```
  Add screen after the existing "Order Details" screen:
  ```jsx
  <Stack.Screen
    name="AdminDashboard"
    component={AdminDashboard}
    options={{ headerShown: false }}
  />
  ```

  **Verify**: `expo start` — Metro bundler resolves without error. Navigate to AdminDashboard via `navigation.navigate("AdminDashboard")` in a test (will be exercised via OptionsScreen in step 8).

---

- [ ] **8. Rebuild `OptionsScreen.js`**

  **What**: Replace the current minimal implementation with a premium profile screen. Exact requirements:

  - **Header section**: Initials-based avatar circle (teal background, white text, 60×60, borderRadius 30), full name (`dbUser.firstName + " " + dbUser.lastName`), phone (`dbUser.phoneNumber`), role badge (teal pill = "customer", orange = "admin"/"superadmin", purple = "driver").
  - **Menu section** (white cards with `ArrowRightIcon`):
    - "My Profile" → `navigation.navigate("Profile")`
    - "My Orders" → `navigation.navigate("Order Details")`
  - **Admin section** (only rendered when `dbUser.role === "superadmin" || dbUser.role === "admin"`):
    - "Administration Control Center" → `navigation.navigate("AdminDashboard")`
  - **Support section**:
    - "Help & Support" → `Alert.alert("Help & Support", "Contact us at support@mytruck.et")`
    - "About MyTruck" → `Alert.alert("About MyTruck", "MyTruck Delivery v1.0.0")`
  - **Sign Out**: Red/destructive button calling `signOutUser`.
  - **Back button**: Use the `BackButton` component from step 5 in the top-left of the header.
  - Use `StyleSheet.create` (not NativeWind classes) for all new styles so the layout is consistent.

  **Files**: `apps/customer-app/screens/OptionsScreen.js` (full rewrite)

  **Dependency**: Step 5 (`BackButton.js`) and step 7 (`AdminDashboard` in AppStack) must be complete first.

  **Verify**: Navigate to OptionsScreen as a customer — profile header shows name, phone, "customer" teal badge. Sign Out works. "My Profile" and "My Orders" navigate correctly. Admin section is hidden. Sign in as admin → admin section visible, tapping "Administration Control Center" navigates to AdminDashboard.

---

- [ ] **9. Fix `Home.js` — wire "See All", Food scroll, and `ScrollView` ref**

  **What**: Three changes in `Home.js`:

  **(a) Add a `useRef` for the main `ScrollView`** and attach it: `<ScrollView ref={scrollRef} ...>`.

  **(b) Wire the "See All" text** — add `onPress` that scrolls to the Top Restaurants section using `scrollRef.current?.scrollToEnd({ animated: true })`. A more precise approach: wrap the Top Restaurants section's outer `View` in a `View` with `onLayout` to capture its Y offset, then scroll to that Y. Use the `onLayout` approach since `ScrollView.scrollToEnd` may overshoot.

  Implementation for the ref + layout capture:
  ```js
  const scrollRef = useRef(null);
  const [restaurantSectionY, setRestaurantSectionY] = useState(0);
  ```
  On the Top Restaurants outer `View`:
  ```jsx
  <View
    style={styles.topRestaurantsSection}
    onLayout={(e) => setRestaurantSectionY(e.nativeEvent.layout.y)}
  >
  ```
  On "See All" text:
  ```jsx
  <TouchableOpacity onPress={() => scrollRef.current?.scrollTo({ y: restaurantSectionY, animated: true })}>
    <Text style={styles.seeAll}>See All ›</Text>
  </TouchableOpacity>
  ```

  **(c) Wire the Food shortcut scroll** — in the Food branch of the shortcut `onPress`, after clearing filters, also scroll to the restaurants section:
  ```js
  if (service.title === "Food") {
    setSearchInputHasValue(false);
    setSearchResults([]);
    setCategoryFilter(null);
    scrollRef.current?.scrollTo({ y: restaurantSectionY, animated: true });
  }
  ```

  **Files**: `apps/customer-app/screens/Home.js`

  **Verify**: Tapping "See All" scrolls to the Top Restaurants section. Tapping the Food shortcut clears any filter and scrolls to restaurants. No runtime errors.

---

- [ ] **10. Update `storage.rules` at the project root**

  **What**: Rewrite `c:\Users\user\Music\MyTruck-Production-Structured\storage.rules` to fix the `isAdmin()` function (it only checks for `admin` role but not `superadmin`) and add a `public-images` path for restaurant/product images uploaded by verified sellers.

  **Files**: `c:\Users\user\Music\MyTruck-Production-Structured\storage.rules`

  **Full content**:
  ```
  rules_version = '2';
  service firebase.storage {
    match /b/{bucket}/o {
      function signedIn() { return request.auth != null; }
      function isAdmin() {
        return signedIn() &&
          firestore.get(/databases/(default)/documents/user/$(request.auth.uid)).data.role in ['admin', 'superadmin'];
      }
      function isSeller(uid) {
        let role = firestore.get(/databases/(default)/documents/user/$(uid)).data.role;
        return role in ['pendingSeller', 'restaurant', 'shop'];
      }

      // Seller registration documents — private
      match /seller-private/{uid}/{fileName} {
        allow create, update: if signedIn()
          && request.auth.uid == uid
          && request.resource.size < 8 * 1024 * 1024
          && request.resource.contentType.matches('image/.*');
        allow read: if isAdmin() || (signedIn() && request.auth.uid == uid);
        allow delete: if isAdmin();
      }

      // Driver registration documents — private
      match /driver-private/{uid}/{fileName} {
        allow create, update: if signedIn()
          && request.auth.uid == uid
          && request.resource.size < 8 * 1024 * 1024
          && request.resource.contentType.matches('image/.*');
        allow read: if signedIn() && (request.auth.uid == uid || isAdmin());
        allow delete: if isAdmin();
      }

      // Public restaurant / product images uploaded by sellers
      match /public-images/{sellerId}/{fileName} {
        allow create, update: if signedIn()
          && (request.auth.uid == sellerId || isAdmin())
          && request.resource.size < 10 * 1024 * 1024
          && request.resource.contentType.matches('image/.*');
        allow read: if true;
        allow delete: if signedIn() && (request.auth.uid == sellerId || isAdmin());
      }
    }
  }
  ```

  **Deploy attempt**: Run from `c:\Users\user\Music\MyTruck-Production-Structured`:
  ```
  firebase deploy --only storage --project mytruck-delivery
  ```
  If this fails with a billing/permission error (Storage rules deployment requires Blaze plan), document the error in a comment at the bottom of `storage.rules` and continue. The rules file is still the correct target for future deployment.

  **Verify**: `firebase deploy --only storage --project mytruck-delivery` exits 0, or a billing error is documented and the file is saved correctly.

---

## Dependency ordering summary

```
Step 1 (firebase.js bucket fix)
  └─► Step 4 (SellerApply — storage uploads no longer throw unknown)

Step 2 (AuthContext timeout)
  └─► Step 3 (RootNavigator fallback — reduces need for timer but still needed)

Step 5 (BackButton component — must exist before step 8 imports it)
  └─► Step 8 (OptionsScreen rebuild — imports BackButton)

Step 7 (AdminDashboard in AppStack — must be registered before step 8 navigates to it)
  └─► Step 8 (OptionsScreen — navigate("AdminDashboard"))

Steps 6, 9, 10 — independent of each other and can be done in any order after their
                   own dependencies (step 6 only touches MapView props).
```

## Files changed summary

| Step | File(s) |
|------|---------|
| 1 | `apps/customer-app/firebase.js` |
| 2 | `apps/customer-app/contexts/AuthContext.js` |
| 3 | `apps/customer-app/navigation/RootNavigator.js` |
| 4 | `apps/customer-app/screens/SellerApply.js` |
| 5 | `apps/customer-app/components/ui/BackButton.js` *(new)* |
| 6 | `apps/customer-app/screens/Home.js`, `screens/UserDetails.js`, `screens/ProfileScreen.js`, `screens/PreparingOrderScreen.js` |
| 7 | `apps/customer-app/navigation/AppStack.js` |
| 8 | `apps/customer-app/screens/OptionsScreen.js` |
| 9 | `apps/customer-app/screens/Home.js` |
| 10 | `storage.rules` (project root) |

---

## Implementation run � 2026-10-31 16:48

### Changes implemented
1. **firebase.js** � getStorage(app, "gs://mytruck-delivery.appspot.com") explicit bucket.
2. **AuthContext.js** � 8 s startup safety timeout added; cleanup cancels it alongside unsubscribe().
3. **RootNavigator.js** � dbUserTimeout state (3 s) replaces permanent 
ull guard; falls through to <AppStack /> on timeout.
4. **SellerApply.js** � signOut imported; OTP-bypass path wrapped in try/catch with signOut(auth) rollback; each uploadPhoto call wrapped in its own try/catch (non-fatal); sellerApplications addDoc added to bypass path; same non-fatal upload fix applied to OTP-verified path.
5. **Home.js** � provider={null} on modal <MapView>; scrollViewRef + estaurantSectionY refs; scrollToRestaurants() fn; ScrollView gets ef; "See All" wrapped in TouchableOpacity; Food shortcut also calls scrollToRestaurants().
6. **UserDetails.js** � provider={null} on <MapView>.
7. **ProfileScreen.js** � provider={null} on <MapView>.
8. **PreparingOrderScreen.js** � provider={null} on <MapView>.
9. **components/ui/BackButton.js** � created; circular white button, teal ArrowLeftIcon, size 40�40.
10. **navigation/AppStack.js** � AdminDashboard imported and registered as Stack.Screen name="AdminDashboard".
11. **screens/OptionsScreen.js** � full premium rebuild: initials avatar, role badge, menu rows (My Profile, My Orders), admin section (conditional), support section, red Sign Out button, BackButton at top-left.
12. **storage.rules** � written at project root with seller-private / driver-private / public paths.

### Verification run
- All 11 app files confirmed present via Get-ChildItem (sizes checked).
- All key patterns confirmed via grep_search across modified files.
- irebase deploy --only storage attempted; failed with: *"Permissions denied enabling firebasestorage.googleapis.com"* � storage.rules is correctly written but the Firebase Storage API must be enabled by a project owner at https://console.cloud.google.com/apis/library/firebasestorage.googleapis.com?project=mytruck-delivery before deployment.
- 
px expo export --platform android hangs in this environment (no interactive terminal / Metro server available); no syntax errors were detected via file-inspection tools.
- Committed to pps/customer-app submodule (commit e08dbe0) and root repo (commit 495dca2).
