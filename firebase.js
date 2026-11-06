import { initializeApp, getApp, getApps } from "firebase/app";
import Constants from "expo-constants";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";
import { getReactNativePersistence, initializeAuth } from "firebase/auth/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Configure these values in user-side/.env from your own Firebase project.
// Firebase client config is public; access control must be enforced by Security Rules.
const firebaseConfig = (Constants.expoConfig?.extra?.firebase || Constants.manifest?.extra?.firebase) || {
  apiKey: "YOUR_FIREBASE_WEB_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_FIREBASE_APP_ID",
};
if (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("YOUR_") || !firebaseConfig.projectId || firebaseConfig.projectId.startsWith("YOUR_")) {
  console.warn("MyTruck Firebase config is not set. Add your Firebase web app values to app.json > expo.extra.firebase.");
}

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
let auth;
try {
  auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
} catch (error) {
  // Hot reload may initialize Auth more than once.
  auth = getAuth(app);
}
export { app, auth };
export const db = getFirestore(app);

// Use the configured storageBucket from app.json (mytruck-delivery.firebasestorage.app)
const bucketUrl = firebaseConfig.storageBucket
  ? (firebaseConfig.storageBucket.startsWith("gs://")
      ? firebaseConfig.storageBucket
      : `gs://${firebaseConfig.storageBucket}`)
  : undefined;
export const storage = getStorage(app, bucketUrl);
