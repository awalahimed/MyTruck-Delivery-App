import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { db } from "../firebase";
import {
  doc,
  updateDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

// Configure how notifications appear when app is in foreground matching HabInfo-App
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Configure Android notification channels with high visibility and sound
 * Set MAX importance on all channels to guarantee heads-up banners & audible chime
 */
export async function setupNotificationChannels() {
  if (Platform.OS === "android") {
    try {
      await Notifications.setNotificationChannelAsync("default", {
        name: "General Alerts",
        description: "General notifications from MyTruck",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#179B83",
        sound: "default",
        showBadge: true,
        enableVibrate: true,
        enableLights: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });

      await Notifications.setNotificationChannelAsync("orders", {
        name: "Order Updates",
        description: "Notifications about your order preparation and acceptance",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#179B83",
        sound: "default",
        showBadge: true,
        enableVibrate: true,
        enableLights: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });

      await Notifications.setNotificationChannelAsync("deliveries", {
        name: "Live Deliveries",
        description: "Driver dispatch, pickup, and real-time tracking updates",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 300, 200, 300],
        lightColor: "#F47721",
        sound: "default",
        showBadge: true,
        enableVibrate: true,
        enableLights: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });

      await Notifications.setNotificationChannelAsync("announcements", {
        name: "Announcements & Offers",
        description: "Platform announcements, promotions, and updates",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#179B83",
        sound: "default",
        showBadge: true,
        enableVibrate: true,
        enableLights: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });

      await Notifications.setNotificationChannelAsync("general", {
        name: "General Notifications",
        description: "General system and account notifications",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#179B83",
        sound: "default",
        showBadge: true,
        enableVibrate: true,
        enableLights: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    } catch (e) {
      console.warn("Failed to set notification channels:", e?.message);
    }
  }
}

// Call channel configuration immediately at module load
void setupNotificationChannels();

/**
 * Triggers an immediate local test notification for instant device feedback
 */
export async function triggerLocalTestAlert(title = "MyTruck Alert 🚚", body = "Real-time push notification is working!") {
  await setupNotificationChannels();
  return Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: "default",
      channelId: "announcements",
      priority: "high",
    },
    trigger: null,
  });
}

/**
 * Request notification permissions and register Expo push token
 *
 * @param {string} userId - Firebase user UID
 * @returns {Promise<string|null>} The registered push token or null
 */
export async function registerForPushNotificationsAsync(userId) {
  if (!Device.isDevice) {
    console.log("Push notifications require a physical device.");
    return null;
  }

  try {
    await setupNotificationChannels();

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      console.log("Notification permission not granted.");
      return null;
    }

    // Resolve EAS project ID with multiple fallbacks for standalone APK
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ||
      Constants?.manifest?.extra?.eas?.projectId ||
      Constants?.manifest2?.extra?.eas?.projectId ||
      Constants?.easConfig?.projectId ||
      "d0e655d9-4ce5-4e46-b356-55a0acba9331";

    let token = null;
    try {
      const tokenResponse = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined
      );
      token = tokenResponse?.data;
    } catch (e1) {
      console.warn("getExpoPushTokenAsync with projectId note, retrying direct:", e1?.message);
      try {
        const tokenResponse = await Notifications.getExpoPushTokenAsync();
        token = tokenResponse?.data;
      } catch (e2) {
        console.warn("getExpoPushTokenAsync direct note:", e2?.message);
      }
    }

    if (!token) return null;

    console.log("Acquired Expo Push Token:", token);

    // Save token to Firestore for the user
    if (userId) {
      await saveTokenToFirestore(userId, token);
    }

    return token;
  } catch (error) {
    console.warn("Error getting push token:", error?.message || error);
    return null;
  }
}

/**
 * Persist device token to user doc and deviceTokens subcollection
 */
async function saveTokenToFirestore(userId, token) {
  try {
    const tokenDocId = token.replace(/[^a-zA-Z0-9]/g, "_").slice(-40);
    const tokenData = {
      token,
      uid: userId,
      platform: Platform.OS,
      deviceModel: Device.modelName || "Android",
      isActive: true,
      updatedAt: serverTimestamp(),
    };

    // 1. Write to both 'user' and 'users' primary document
    await setDoc(doc(db, "user", userId), { expoPushToken: token, pushTokenUpdatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
    await setDoc(doc(db, "users", userId), { expoPushToken: token, pushTokenUpdatedAt: serverTimestamp() }, { merge: true }).catch(() => {});

    // 2. Write to both 'user' and 'users' subcollections
    await setDoc(doc(db, "user", userId, "deviceTokens", tokenDocId), tokenData, { merge: true }).catch(() => {});
    await setDoc(doc(db, "users", userId, "deviceTokens", tokenDocId), tokenData, { merge: true }).catch(() => {});

    // 3. Write to global top-level deviceTokens collection for instant broadcast querying
    await setDoc(doc(db, "deviceTokens", tokenDocId), tokenData, { merge: true }).catch(() => {});
  } catch (err) {
    console.warn("Could not save push token to Firestore:", err?.message);
  }
}

/**
 * Deactivates device token upon sign-out
 */
export async function unregisterPushTokenAsync(userId, token) {
  if (!userId || !token) return;
  try {
    const tokenDocId = token.replace(/[^a-zA-Z0-9]/g, "_").slice(-40);
    const deviceRef = doc(db, "user", userId, "deviceTokens", tokenDocId);
    await updateDoc(deviceRef, {
      isActive: false,
      unregisteredAt: serverTimestamp(),
    }).catch(() => {});

    const userRef = doc(db, "user", userId);
    await updateDoc(userRef, {
      expoPushToken: null,
    }).catch(() => {});
  } catch (err) {
    console.warn("Error unregistering push token:", err?.message);
  }
}

/**
 * Schedule a local notification banner
 */
export async function presentLocalNotification({ title, body, data = {}, category = "general" }) {
  await setupNotificationChannels();
  return Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data,
      sound: true,
    },
    trigger: null, // show immediately
  });
}
