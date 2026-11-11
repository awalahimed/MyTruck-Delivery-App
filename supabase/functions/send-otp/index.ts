import { createClient } from "npm:@supabase/supabase-js@2";

const enc = new TextEncoder();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Ethiopian mobile numbers -> 251 + 9 digits (starting with 7 or 9)
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

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const body = await req.json().catch(() => ({}));
  const phone = normalizePhone(body?.phone);
  if (!phone) return json({ error: "invalid_phone", message: "Enter a valid Ethiopian mobile number." }, 400);

  const smsKey = Deno.env.get("SMS_ETHIOPIA_KEY");
  const otpSecret = Deno.env.get("OTP_SECRET");
  if (!smsKey || !otpSecret) return json({ error: "not_configured", message: "Verification is not set up yet." }, 500);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // A number that already belongs to an account can't be used to sign up again
  const { data: claimed } = await admin.from("claimed_phones").select("phone").eq("phone", phone).maybeSingle();
  if (claimed) {
    return json({ error: "already_registered", message: "This mobile number is already registered. Please sign in instead." }, 409);
  }

  // Rate limits: at most 3 codes per number per 10 minutes, and 1 per minute
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: recent } = await admin
    .from("phone_otps")
    .select("created_at")
    .eq("phone", phone)
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if ((recent?.length ?? 0) >= 3) {
    return json({ error: "rate_limited", message: "Too many codes requested. Try again in 10 minutes." }, 429);
  }
  if (recent?.[0] && Date.now() - new Date(recent[0].created_at).getTime() < 60_000) {
    return json({ error: "too_soon", message: "Wait a minute before requesting another code." }, 429);
  }

  // Cryptographically random 6-digit code; only a keyed hash is stored
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  const code = String(100000 + (n[0] % 900000));
  const codeHash = await hmacHex(otpSecret, `${phone}:${code}`);

  const { error } = await admin.from("phone_otps").insert({
    phone,
    code_hash: codeHash,
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  });
  if (error) return json({ error: "db_error", message: "Please try again." }, 500);

  const sms = await fetch("https://smsethiopia.com/api/v2/sms/send", {
    method: "POST",
    headers: { KEY: smsKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      msisdn: phone,
      text: `Your MyTruck verification code is ${code}. It expires in 5 minutes. Do not share it with anyone.`,
    }),
  });
  if (!sms.ok) return json({ error: "sms_failed", message: "We couldn't send the SMS right now. Please try again." }, 502);

  return json({ sent: true, expiresInSeconds: 300 });
});
