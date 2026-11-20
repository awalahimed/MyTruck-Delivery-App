import Constants from "expo-constants";
import { getFunctions, httpsCallable } from "firebase/functions";
import { signInWithEmailAndPassword } from "firebase/auth";
import { app, auth } from "../firebase";

function normalizePhone(input) {
  let digits = String(input ?? "").replace(/\D/g, "");
  if (digits.startsWith("251")) digits = digits.slice(3);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  if (!/^[79]\d{8}$/.test(digits)) {
    const error = new Error("Enter a valid Ethiopian mobile number (e.g. 0912345678 or +251912345678). ");
    error.code = "auth/invalid-phone-number";
    throw error;
  }
  return `+251${digits}`;
}

/** Authenticates a phone/password pair through Firebase Auth without exposing account email. */
export async function signInWithPhonePassword(phoneInput, password) {
  const phone = normalizePhone(phoneInput);
  const firebaseConfig = Constants.expoConfig?.extra?.firebase || Constants.manifest?.extra?.firebase || {};
  const apiKey = String(firebaseConfig.apiKey || "").trim();
  if (!apiKey || apiKey.startsWith("YOUR_")) {
    const error = new Error("Phone sign-in is not configured for this app. Please contact MyTruck support.");
    error.code = "auth/phone-sign-in-not-configured";
    throw error;
  }

  const functions = getFunctions(app);
  const result = await httpsCallable(functions, "signInWithPhonePassword")({ phone, password, apiKey });
  const email = String(result?.data?.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    const error = new Error("Could not complete sign-in. Please try again.");
    error.code = "auth/phone-sign-in-failed";
    throw error;
  }
  return signInWithEmailAndPassword(auth, email, password);
}
