/** Phone verification through Firebase Cloud Functions. */
import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "../firebase";

const functions = getFunctions(app);

function otpError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function digitsFor(phone) {
  let digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.startsWith("251")) digits = digits.slice(3);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  if (!/^[79]\d{8}$/.test(digits)) return null;
  return `251${digits}`;
}

const MESSAGE_BY_CODE = {
  "functions/invalid-argument": "Enter a valid Ethiopian mobile number or 6-digit code.",
  "functions/already-exists": "This mobile number is already registered. Please sign in instead.",
  "functions/resource-exhausted": "Too many requests. Wait before trying again.",
  "functions/failed-precondition": "No active code. Request a new verification code.",
  "functions/permission-denied": "Phone verification could not be confirmed. Please verify your number again.",
  "functions/unauthenticated": "Please sign in again and retry phone verification.",
  "functions/unavailable": "Phone verification is temporarily unavailable. Please try again later.",
  "functions/internal": "Phone verification is temporarily unavailable. Please try again later.",
};

async function callFunction(name, body) {
  try {
    const result = await httpsCallable(functions, name)(body);
    return result?.data || {};
  } catch (cause) {
    const code = String(cause?.code || "functions/unknown");
    const serverMessage = String(cause?.message || "").replace(/^Firebase: Error \(functions\/[^)]+\)\.\s*/i, "").trim();
    const message = serverMessage || MESSAGE_BY_CODE[code] || "Phone verification failed. Please try again.";
    throw otpError(message, `otp/${code.replace(/^functions\//, "")}`);
  }
}

/** Sends a server-generated 6-digit SMS code to an Ethiopian mobile number. */
export async function sendSignupCode(phone) {
  const normalizedPhone = digitsFor(phone);
  if (!normalizedPhone) throw otpError("Enter a valid Ethiopian mobile number.", "otp/invalid_phone");
  return callFunction("sendSignupOtp", { phone: normalizedPhone });
}

/** Verifies the OTP on the server and returns a short-lived signed proof. */
export async function verifySignupCode(phone, code) {
  const normalizedPhone = digitsFor(phone);
  const normalizedCode = String(code ?? "").replace(/\s/g, "");
  if (!normalizedPhone || !/^\d{6}$/.test(normalizedCode)) {
    throw otpError("Enter the 6-digit code sent to your phone.", "otp/invalid_input");
  }

  const data = await callFunction("verifySignupOtp", { phone: normalizedPhone, code: normalizedCode });
  if (!data?.verified || !data?.proof) {
    throw otpError("The verification code could not be confirmed. Request a new code and try again.", "otp/not_verified");
  }
  return data.proof;
}

/** Reserves a verified phone number for the signed-in Firebase account. */
export async function claimPhone(phone, uid, proof) {
  const normalizedPhone = digitsFor(phone);
  if (!normalizedPhone || !uid || !proof) {
    throw otpError("Verify your phone number before creating an account.", "otp/bad_proof");
  }
  return callFunction("claimVerifiedPhone", { phone: normalizedPhone, uid, proof });
}
