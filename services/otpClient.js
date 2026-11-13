/**
 * Sign-up phone verification through the server (Supabase Edge Functions send-otp / verify-otp).
 *
 * The SMS provider key and the code check live on the server. The app only sends the phone
 * number and the code the user typed, and receives a short-lived proof that the number was verified.
 * The publishable key below is public by design (it only allows calling these functions).
 */
const SUPABASE_URL = "https://ubfeichwvegdbkjnsltv.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_W25wOYiJe2g9NF8Mr84--w_jYl__P8f";

// ── TEMPORARY: in-app SMS codes (the pre-1.0.8 system) ───────────────────────
// The server functions above are deployed but their secrets (SMS_ETHIOPIA_KEY, OTP_SECRET)
// aren't set yet, so they answer "Verification is not set up yet". Until they are, the app
// sends the SMS itself and checks the code on the phone, like before version 1.0.8.
// NOT SAFE LONG-TERM: the SMS key ships inside the app. Set this to false (and set the server
// secrets) as soon as possible.
export const USE_IN_APP_SMS = true;
const SMS_ETHIOPIA_KEY = "01ATJJKPX5H5QEPWXGQ28YYPHQI1FHR6F8JEKDB7";
const LEGACY_PROOF = "in-app-verified";

// Codes live only in this app's memory (not in Firestore), one per phone number
const localCodes = new Map();

function digitsFor(phone) {
  let d = String(phone ?? "").replace(/\D/g, "");
  if (d.startsWith("251")) d = d.slice(3);
  else if (d.startsWith("0")) d = d.slice(1);
  if (!/^[79]\d{8}$/.test(d)) return null;
  return "251" + d;
}

function otpError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

async function sendInAppCode(phone) {
  const msisdn = digitsFor(phone);
  if (!msisdn) throw otpError("Enter a valid Ethiopian mobile number.", "otp/invalid_phone");

  const prev = localCodes.get(msisdn);
  if (prev && Date.now() - prev.sentAt < 60_000) {
    throw otpError("Wait a minute before requesting another code.", "otp/too_soon");
  }

  const code = String(100000 + Math.floor(Math.random() * 900000));

  let res;
  try {
    res = await fetch("https://smsethiopia.com/api/v2/sms/send", {
      method: "POST",
      headers: { KEY: SMS_ETHIOPIA_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        msisdn,
        text: `Your MyTruck verification code is ${code}. It expires in 5 minutes. Do not share it with anyone.`,
      }),
    });
  } catch (_) {
    throw otpError("Couldn't send the SMS. Check your connection and try again.", "otp/network");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn("SMS Ethiopia send error:", res.status, text);
    throw otpError("We couldn't send the SMS right now. Please try again.", "otp/sms_failed");
  }

  localCodes.set(msisdn, { code, sentAt: Date.now(), expiresAt: Date.now() + 5 * 60 * 1000, attempts: 0 });
  return { sent: true, expiresInSeconds: 300 };
}

function verifyInAppCode(phone, code) {
  const msisdn = digitsFor(phone);
  const entry = msisdn && localCodes.get(msisdn);
  if (!entry || Date.now() > entry.expiresAt) {
    throw otpError("The verification code has expired. Please request a new code.", "otp/no_code");
  }
  if (entry.attempts >= 5) {
    localCodes.delete(msisdn);
    throw otpError("Too many wrong attempts. Request a new code.", "otp/too_many_attempts");
  }
  if (String(code).trim() !== entry.code) {
    entry.attempts += 1;
    throw otpError("Incorrect code. Check your SMS and try again.", "otp/wrong_code");
  }
  localCodes.delete(msisdn);
  return LEGACY_PROOF;
}

async function callFunction(name, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        apikey: PUBLISHABLE_KEY,
        Authorization: `Bearer ${PUBLISHABLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const err = new Error("Couldn't reach the verification service. Check your connection and try again.");
    err.code = "otp/network";
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.message || "Verification failed. Please try again.");
    err.code = `otp/${data?.error || res.status}`;
    throw err;
  }
  return data;
}

/** Sends a 6-digit SMS code to an Ethiopian mobile number. */
export function sendSignupCode(phone) {
  if (USE_IN_APP_SMS) return sendInAppCode(phone);
  return callFunction("send-otp", { phone });
}

/** Checks the code. Returns { proof } when correct; the proof is checked by the sign-up step. */
export async function verifySignupCode(phone, code) {
  if (USE_IN_APP_SMS) return verifyInAppCode(phone, code);
  const data = await callFunction("verify-otp", { phone, code });
  if (!data?.verified || !data?.proof) {
    const err = new Error("Verification failed. Please try again.");
    err.code = "otp/not-verified";
    throw err;
  }
  return data.proof;
}

/**
 * Claims the verified phone number for this account on the server, so no other account can use it.
 * Throws with code "otp/taken" if another account already has the number.
 */
export async function claimPhone(phone, uid, proof) {
  // In-app mode has no server proof to check, so the number isn't reserved on the server
  if (USE_IN_APP_SMS || proof === LEGACY_PROOF) return { ok: true, skipped: true };
  return callFunction("claim-phone", { phone, uid, proof });
}
