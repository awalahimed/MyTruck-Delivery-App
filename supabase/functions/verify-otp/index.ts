import { createClient } from "npm:@supabase/supabase-js@2";

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

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const body = await req.json().catch(() => ({}));
  const phone = normalizePhone(body?.phone);
  const code = String(body?.code ?? "").replace(/\s/g, "");
  if (!phone || !/^\d{6}$/.test(code)) return json({ error: "invalid_input", message: "Enter the 6-digit code." }, 400);

  const otpSecret = Deno.env.get("OTP_SECRET");
  if (!otpSecret) return json({ error: "not_configured", message: "Verification is not set up yet." }, 500);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: row } = await admin
    .from("phone_otps")
    .select("id, code_hash, attempts")
    .eq("phone", phone)
    .eq("consumed", false)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row) return json({ error: "no_code", message: "No active code. Request a new one." }, 400);
  if (row.attempts >= 5) return json({ error: "too_many_attempts", message: "Too many wrong attempts. Request a new code." }, 429);

  const expected = await hmacHex(otpSecret, `${phone}:${code}`);
  if (!constantTimeEqual(expected, row.code_hash)) {
    await admin.from("phone_otps").update({ attempts: row.attempts + 1 }).eq("id", row.id);
    return json({ error: "wrong_code", message: "Incorrect code. Check your SMS and try again." }, 400);
  }

  await admin.from("phone_otps").update({ consumed: true }).eq("id", row.id);

  // Short-lived proof that this number was verified (checked by claim-phone)
  const payload = btoa(JSON.stringify({ phone, exp: Date.now() + 15 * 60 * 1000, n: crypto.randomUUID() }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const sig = await hmacHex(otpSecret, `proof:${payload}`);
  return json({ verified: true, proof: `${payload}.${sig}` });
});
