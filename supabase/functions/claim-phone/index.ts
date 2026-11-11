import { createClient } from "npm:@supabase/supabase-js@2";

// Claims a verified phone number for one account, so the same number can't be used twice.
// Needs the proof from verify-otp (signed with OTP_SECRET, valid 15 minutes).

const enc = new TextEncoder();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function normalizePhone(raw: unknown): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("251")) d = d.slice(3);
  else if (d.startsWith("0")) d = d.slice(1);
  if (!/^[79]\d{8}$/.test(d)) return null;
  return "251" + d;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function decodePayload(b64url: string): { phone?: string; exp?: number } | null {
  try {
    let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
    if (b64.length % 4) b64 += "=".repeat(4 - (b64.length % 4));
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const body = await req.json().catch(() => ({}));
  const phone = normalizePhone(body?.phone);
  const uid = String(body?.uid ?? "").trim();
  const proof = String(body?.proof ?? "");
  if (!phone || !uid || !proof.includes(".")) return json({ error: "invalid_input", message: "Missing details." }, 400);

  const otpSecret = Deno.env.get("OTP_SECRET");
  if (!otpSecret) return json({ error: "not_configured", message: "Verification is not set up yet." }, 500);

  const [payloadB64, sig] = proof.split(".");
  const expected = await hmacHex(otpSecret, `proof:${payloadB64}`);
  const payload = decodePayload(payloadB64);
  const valid = constantTimeEqual(expected, sig) && payload?.phone === phone && Number(payload?.exp) > Date.now();
  if (!valid) return json({ error: "bad_proof", message: "Please verify your phone number again." }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: existing } = await admin.from("claimed_phones").select("uid").eq("phone", phone).maybeSingle();
  if (existing && existing.uid !== uid) {
    return json({ error: "taken", message: "This mobile number is already used by another account. Please sign in instead." }, 409);
  }
  if (!existing) {
    const { error } = await admin.from("claimed_phones").insert({ phone, uid });
    if (error) return json({ error: "db_error", message: "Please try again." }, 500);
  }
  return json({ ok: true });
});
