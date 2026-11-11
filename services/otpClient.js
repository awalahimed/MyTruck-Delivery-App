/**
 * Sign-up phone verification through the server (Supabase Edge Functions send-otp / verify-otp).
 *
 * The SMS provider key and the code check live on the server. The app only sends the phone
 * number and the code the user typed, and receives a short-lived proof that the number was verified.
 * The publishable key below is public by design (it only allows calling these functions).
 */
const SUPABASE_URL = "https://ubfeichwvegdbkjnsltv.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_W25wOYiJe2g9NF8Mr84--w_jYl__P8f";

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
  return callFunction("send-otp", { phone });
}

/** Checks the code. Returns { proof } when correct; the proof is checked by the sign-up step. */
export async function verifySignupCode(phone, code) {
  const data = await callFunction("verify-otp", { phone, code });
  if (!data?.verified || !data?.proof) {
    const err = new Error("Verification failed. Please try again.");
    err.code = "otp/not-verified";
    throw err;
  }
  return data.proof;
}
