/**
 * MyTruck Delivery — Chapa payment Cloud Functions.
 *
 * The Chapa SECRET key lives only here, as a Firebase secret:
 *   firebase functions:secrets:set CHAPA_SECRET_KEY
 * It must never be shipped inside the mobile app.
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { createHmac, randomBytes, randomInt, timingSafeEqual, createHash } = require("node:crypto");
const { getAuth } = require("firebase-admin/auth");

initializeApp();
const db = getFirestore();

const CHAPA_SECRET_KEY = defineSecret("CHAPA_SECRET_KEY");
const SMS_ETHIOPIA_KEY = defineSecret("SMS_ETHIOPIA_KEY");
const OTP_SECRET = defineSecret("OTP_SECRET");
const CHAPA_BASE_URL = "https://api.chapa.co/v1";
const DEFAULT_RETURN_URL = "https://checkout.chapa.co/checkout/payment-receipt";

function chapaSecretValue() {
  const key = String(CHAPA_SECRET_KEY.value() || "").trim();
  if (!key.startsWith("CHASECK-") && !key.startsWith("CHASECK_TEST-")) {
    throw new HttpsError(
      "failed-precondition",
      "The Firebase CHAPA_SECRET_KEY is not a Chapa secret key. Set a Chapa key from the merchant dashboard; do not use the SMS Ethiopia key."
    );
  }
  return key;
}

function requireAuth(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to pay.");
  return request.auth.uid;
}

// ── Phone OTP (Firebase Functions + Firestore; SMS Ethiopia is the SMS carrier) ──
function normalizeOtpPhone(raw) {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("251")) digits = digits.slice(3);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  if (!/^[79]\d{8}$/.test(digits)) {
    throw new HttpsError("invalid-argument", "Enter a valid Ethiopian mobile number.");
  }
  return `251${digits}`;
}

function otpPhoneKey(phone) {
  return createHash("sha256").update(phone).digest("hex");
}

function otpMac(secret, value) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function secureStringEqual(a, b) {
  const left = Buffer.from(String(a || ""), "hex");
  const right = Buffer.from(String(b || ""), "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function otpSecretValue() {
  const otpSecret = OTP_SECRET.value();
  if (!otpSecret) {
    throw new HttpsError("failed-precondition", "Phone verification is not configured on the server.");
  }
  return otpSecret;
}

function smsProviderKey() {
  const smsKey = SMS_ETHIOPIA_KEY.value();
  if (!smsKey) {
    throw new HttpsError("failed-precondition", "Phone verification is not configured on the server.");
  }
  return smsKey;
}

exports.sendSignupOtp = onCall({ secrets: [SMS_ETHIOPIA_KEY, OTP_SECRET] }, async (request) => {
  const phone = normalizeOtpPhone(request.data?.phone);
  const key = otpPhoneKey(phone);
  const smsKey = smsProviderKey();
  const otpSecret = otpSecretValue();
  const nowMs = Date.now();
  const challengeRef = db.collection("phoneOtpChallenges").doc(key);
  const claimRef = db.collection("claimedPhones").doc(key);
  const code = String(randomInt(100000, 1000000));
  const codeHash = otpMac(otpSecret, `${phone}:${code}`);

  await db.runTransaction(async (tx) => {
    const [claimSnap, challengeSnap] = await Promise.all([tx.get(claimRef), tx.get(challengeRef)]);
    if (claimSnap.exists) {
      throw new HttpsError("already-exists", "This mobile number is already registered. Please sign in instead.");
    }
    const old = challengeSnap.data() || {};
    const lastSentAt = old.lastSentAt?.toMillis?.() || 0;
    if (nowMs - lastSentAt < 60_000) {
      throw new HttpsError("resource-exhausted", "Wait a minute before requesting another code.");
    }
    const windowStartAt = old.windowStartAt?.toMillis?.() || 0;
    const inWindow = nowMs - windowStartAt < 10 * 60_000;
    const requestCount = inWindow ? Number(old.requestCount || 0) : 0;
    if (requestCount >= 3) {
      throw new HttpsError("resource-exhausted", "Too many codes requested. Try again in 10 minutes.");
    }
    tx.set(challengeRef, {
      phoneHash: key,
      codeHash,
      attempts: 0,
      consumed: false,
      expiresAt: Timestamp.fromMillis(nowMs + 5 * 60_000),
      lastSentAt: Timestamp.fromMillis(nowMs),
      windowStartAt: Timestamp.fromMillis(inWindow ? windowStartAt : nowMs),
      requestCount: requestCount + 1,
    });
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let smsResponse;
  try {
    smsResponse = await fetch("https://smsethiopia.com/api/sms/send", {
      method: "POST",
      signal: controller.signal,
      headers: { KEY: smsKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        msisdn: phone,
        text: `Your MyTruck verification code is ${code}. It expires in 5 minutes. Do not share it with anyone.`,
      }),
    });
  } catch (error) {
    console.error("OTP SMS request failed:", error?.message || error);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(challengeRef);
      if (snap.exists && snap.data()?.codeHash === codeHash) {
        tx.update(challengeRef, { codeHash: null, consumed: true, smsFailed: true });
      }
    });
    throw new HttpsError("unavailable", "We couldn't send the SMS right now. Please try again.");
  } finally {
    clearTimeout(timeout);
  }

  if (!smsResponse.ok) {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(challengeRef);
      if (snap.exists && snap.data()?.codeHash === codeHash) {
        tx.update(challengeRef, { codeHash: null, consumed: true, smsFailed: true });
      }
    });
    console.error("OTP SMS provider returned HTTP", smsResponse.status);
    throw new HttpsError("unavailable", "We couldn't send the SMS right now. Please try again.");
  }

  return { sent: true, expiresInSeconds: 300 };
});

exports.verifySignupOtp = onCall({ secrets: [OTP_SECRET] }, async (request) => {
  const phone = normalizeOtpPhone(request.data?.phone);
  const code = String(request.data?.code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) throw new HttpsError("invalid-argument", "Enter the 6-digit code.");
  const otpSecret = otpSecretValue();
  const key = otpPhoneKey(phone);
  const challengeRef = db.collection("phoneOtpChallenges").doc(key);
  const expectedHash = otpMac(otpSecret, `${phone}:${code}`);
  const nowMs = Date.now();

  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(challengeRef);
    if (!snap.exists) return "no-code";
    const challenge = snap.data();
    if (challenge.consumed || !challenge.expiresAt || challenge.expiresAt.toMillis() <= nowMs) {
      if (!challenge.consumed) tx.update(challengeRef, { consumed: true, codeHash: null });
      return "expired";
    }
    if (Number(challenge.attempts || 0) >= 5) return "too-many-attempts";
    if (!secureStringEqual(expectedHash, challenge.codeHash)) {
      tx.update(challengeRef, { attempts: Number(challenge.attempts || 0) + 1 });
      return "wrong-code";
    }
    tx.update(challengeRef, { consumed: true, codeHash: null, verifiedAt: FieldValue.serverTimestamp() });
    return "verified";
  });

  if (outcome === "no-code") throw new HttpsError("failed-precondition", "No active code. Request a new one.");
  if (outcome === "expired") throw new HttpsError("deadline-exceeded", "The verification code expired. Request a new one.");
  if (outcome === "too-many-attempts") throw new HttpsError("resource-exhausted", "Too many wrong attempts. Request a new code.");
  if (outcome === "wrong-code") throw new HttpsError("invalid-argument", "Incorrect code. Check your SMS and try again.");

  const payload = Buffer.from(JSON.stringify({ phone, exp: Date.now() + 15 * 60_000, nonce: randomBytes(16).toString("hex") })).toString("base64url");
  const signature = otpMac(otpSecret, `proof:${payload}`);
  return { verified: true, proof: `${payload}.${signature}` };
});

exports.claimVerifiedPhone = onCall({ secrets: [OTP_SECRET] }, async (request) => {
  const uid = requireAuth(request);
  const phone = normalizeOtpPhone(request.data?.phone);
  if (String(request.data?.uid || "") !== uid) {
    throw new HttpsError("permission-denied", "The phone can only be claimed for the signed-in account.");
  }
  const proof = String(request.data?.proof || "");
  const [payload, signature, extra] = proof.split(".");
  if (!payload || !signature || extra) throw new HttpsError("permission-denied", "Verify your phone number again.");
  const otpSecret = otpSecretValue();
  if (!secureStringEqual(otpMac(otpSecret, `proof:${payload}`), signature)) {
    throw new HttpsError("permission-denied", "Verify your phone number again.");
  }
  let proofData;
  try {
    proofData = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new HttpsError("permission-denied", "Verify your phone number again.");
  }
  if (proofData?.phone !== phone || Number(proofData?.exp) <= Date.now()) {
    throw new HttpsError("permission-denied", "Verify your phone number again.");
  }

  const key = otpPhoneKey(phone);
  const claimRef = db.collection("claimedPhones").doc(key);
  await db.runTransaction(async (tx) => {
    const existing = await tx.get(claimRef);
    if (existing.exists && existing.data()?.uid !== uid) {
      throw new HttpsError("already-exists", "This mobile number is already used by another account. Please sign in instead.");
    }
    if (!existing.exists) tx.create(claimRef, { uid, phoneHash: key, claimedAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});

// Sign in existing email/password accounts using their Ethiopian phone.
// Firebase Auth verifies the submitted password first. Only then is the linked
// email returned so the client SDK can complete its normal email/password sign-in.
exports.signInWithPhonePassword = onCall(async (request) => {
  const phone = normalizeOtpPhone(request.data?.phone);
  const password = String(request.data?.password || "");
  const apiKey = String(request.data?.apiKey || "").trim();
  if (password.length < 6 || password.length > 256 || !apiKey || apiKey.length > 256) {
    throw new HttpsError("invalid-argument", "Enter a valid phone number and password.");
  }

  const phoneKey = otpPhoneKey(phone);
  let uid = null;
  const claim = await db.collection("claimedPhones").doc(phoneKey).get();
  if (claim.exists) uid = String(claim.data()?.uid || "") || null;

  // Older accounts may have a phone on their profile but no claimedPhones record.
  if (!uid) {
    const phoneForms = [`+${phone}`, `0${phone.slice(3)}`, phone];
    for (const collectionName of ["user", "users"]) {
      for (const field of ["phoneNumber", "phone", "workingPhone"]) {
        const matches = await db.collection(collectionName).where(field, "in", phoneForms).limit(2).get();
        if (matches.size > 1) {
          throw new HttpsError("failed-precondition", "This phone number is linked to more than one account. Contact MyTruck support.");
        }
        if (!matches.empty) {
          uid = matches.docs[0].id;
          break;
        }
      }
      if (uid) break;
    }
  }

  if (!uid) throw new HttpsError("unauthenticated", "Incorrect phone number or password.");

  let user;
  try {
    user = await getAuth().getUser(uid);
  } catch (_) {
    throw new HttpsError("unauthenticated", "Incorrect phone number or password.");
  }
  if (!user.email) throw new HttpsError("unauthenticated", "Incorrect phone number or password.");

  // Firebase Auth is the password authority. Do not log this request or its data.
  let verified;
  try {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, password, returnSecureToken: true }),
    });
    if (!response.ok) throw new Error("credential-check-failed");
    verified = await response.json();
  } catch (_) {
    throw new HttpsError("unauthenticated", "Incorrect phone number or password.");
  }
  if (verified?.localId !== uid) {
    throw new HttpsError("unauthenticated", "Incorrect phone number or password.");
  }

  return { email: user.email };
});

function cleanPhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  const p = digits.startsWith("251") ? "0" + digits.slice(3) : digits.startsWith("0") ? digits : "0" + digits;
  return p.length === 10 ? p : "0911000000";
}

// Chapa rejects some domains (.local, .et); fall back to a phone-based address.
function cleanEmail(raw, phone) {
  const e = String(raw || "").trim().toLowerCase();
  if (e && e.includes("@") && !e.endsWith(".local") && !e.endsWith(".et")) return e;
  return phone && phone !== "0911000000" ? `customer${phone}@gmail.com` : "customer@gmail.com";
}

function newTxRef() {
  return `MT${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

async function chapaFetch(path, options = {}) {
  const res = await fetch(`${CHAPA_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${chapaSecretValue()}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  return res.json().catch(() => ({}));
}

/** Loads the caller's orders by id, rejecting any they don't own. */
async function loadOwnedOrders(uid, orderIds) {
  const ids = [...new Set((orderIds || []).map((id) => String(id).trim()).filter(Boolean))].slice(0, 20);
  const snaps = await Promise.all(ids.map((id) => db.collection("orders").doc(id).get()));
  return snaps.map((snap) => {
    if (!snap.exists) throw new HttpsError("not-found", `Order ${snap.id} not found.`);
    if (snap.data().userId !== uid) throw new HttpsError("permission-denied", "Not your order.");
    return snap;
  });
}

/**
 * createChapaCheckout({ orderIds?, amount?, email?, firstName?, lastName?, phone?, description?, txRef?, returnUrl? })
 *
 * With orderIds: the amount is taken from the orders in Firestore and the new
 * tx_ref / checkout URL are written back to them.
 * Without orderIds (checkout started before the orders are written): the
 * client amount is used. That is safe because verifyChapaPayment only marks
 * orders PAID when Chapa's verified amount covers the orders' totals.
 */
exports.createChapaCheckout = onCall({ secrets: [CHAPA_SECRET_KEY] }, async (request) => {
  const uid = requireAuth(request);
  const data = request.data || {};
  // Availability probe from the app (lets it hide Chapa when this function isn't deployed)
  if (data.probe === true) {
    chapaSecretValue();
    return { ok: true };
  }
  const orders = data.orderIds && data.orderIds.length ? await loadOwnedOrders(uid, data.orderIds) : [];

  let amount;
  if (orders.length) {
    if (orders.some((s) => s.data().paymentStatus === "PAID")) {
      throw new HttpsError("failed-precondition", "Order is already paid.");
    }
    if (orders.some((s) => s.data().status === "CANCELLED")) {
      throw new HttpsError("failed-precondition", "This order was cancelled.");
    }
    amount = orders.reduce((sum, s) => sum + (Number(s.data().total) || 0), 0);
  } else {
    amount = Number(data.amount);
  }
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpsError("invalid-argument", "Invalid amount.");

  const first = orders[0]?.data() || {};
  const phone = cleanPhone(data.phone || first.customerPhone);
  const fullName = String(data.firstName ? `${data.firstName} ${data.lastName || ""}` : first.customerName || "Customer User").trim();
  const [firstName = "Customer", ...rest] = fullName.split(" ");
  const txRef = String(data.txRef || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 50) || newTxRef();

  const base = {
    amount: amount.toFixed(2),
    currency: "ETB",
    tx_ref: txRef,
    email: cleanEmail(data.email || first.customerEmail, phone),
    first_name: firstName || "Customer",
    last_name: rest.join(" ") || "Client",
    phone_number: phone,
    return_url: data.returnUrl || DEFAULT_RETURN_URL,
  };

  let result = await chapaFetch("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      ...base,
      customization: {
        title: "MyTruck Delivery",
        description: String(data.description || "MyTruck order").replace(/[^A-Za-z0-9 ._,-]/g, "").slice(0, 50),
      },
    }),
  });
  // Chapa sometimes rejects the customization block; retry without it.
  if (!result?.data?.checkout_url) {
    result = await chapaFetch("/transaction/initialize", { method: "POST", body: JSON.stringify(base) });
  }

  const checkoutUrl = result?.data?.checkout_url;
  if (!checkoutUrl) {
    const detail = String(result?.message || "").replace(/\s+/g, " ").trim().slice(0, 300);
    console.warn("Chapa initialize failed", detail || "No checkout URL returned.");
    const lowerDetail = detail.toLowerCase();
    if (lowerDetail.includes("invalid api key") || lowerDetail.includes("can't accept payments")) {
      throw new HttpsError(
        "failed-precondition",
        "Chapa rejected the configured secret or the merchant account is not enabled for API payments. Check the Chapa secret key and account payment status."
      );
    }
    throw new HttpsError(
      "unavailable",
      detail ? `Chapa could not start checkout: ${detail}` : "Chapa did not return a checkout URL."
    );
  }

  if (orders.length) {
    const batch = db.batch();
    orders.forEach((s) =>
      batch.update(s.ref, {
        chapaMerchantReference: txRef,
        chapaCheckoutUrl: checkoutUrl,
        updatedAt: FieldValue.serverTimestamp(),
      })
    );
    await batch.commit();
  }

  return { checkoutUrl, txRef, amount: Number(amount.toFixed(2)) };
});

/**
 * verifyChapaPayment({ orderId?, orderIds?, tx_ref? })
 *
 * Asks Chapa whether tx_ref was paid and, only when the paid amount covers all
 * of the caller's orders under that reference, marks them PAID and forwards
 * them to the merchant as PENDING (the same state a Cash on Delivery order starts in).
 */
exports.verifyChapaPayment = onCall({ secrets: [CHAPA_SECRET_KEY] }, async (request) => {
  const uid = requireAuth(request);
  const data = request.data || {};
  const requested = data.orderIds?.length ? data.orderIds : data.orderId ? [data.orderId] : [];
  const seed = await loadOwnedOrders(uid, requested);

  const txRef = String(data.tx_ref || seed[0]?.data().chapaMerchantReference || "").trim();
  if (!txRef) throw new HttpsError("failed-precondition", "No Chapa reference on this order.");

  // Every order of this user sharing the reference (one checkout can cover several merchants).
  const linked = await db
    .collection("orders")
    .where("chapaMerchantReference", "==", txRef)
    .where("userId", "==", uid)
    .get();
  if (linked.empty) throw new HttpsError("not-found", "No orders for this payment reference.");

  if (linked.docs.every((d) => d.data().paymentStatus === "PAID")) {
    return { verified: true, paymentStatus: "PAID", txRef };
  }

  const result = await chapaFetch(`/transaction/verify/${encodeURIComponent(txRef)}`);
  const chapaStatus = String(result?.data?.status || "").toUpperCase();

  if (result?.status !== "success" || chapaStatus !== "SUCCESS") {
    const failed = ["FAILED", "CANCELLED", "EXPIRED"].includes(chapaStatus);
    return { verified: false, paymentStatus: failed ? "FAILED" : "PENDING", chapaStatus, txRef };
  }

  const expected = linked.docs.reduce((sum, d) => sum + (Number(d.data().total) || 0), 0);
  const paid = Number(result.data.amount);
  if (String(result.data.currency || "ETB").toUpperCase() !== "ETB" || !(paid + 0.01 >= expected)) {
    console.error("Chapa amount mismatch", { txRef, paid, expected });
    return { verified: false, paymentStatus: "AMOUNT_MISMATCH", txRef };
  }

  const batch = db.batch();
  linked.docs.forEach((d) => {
    if (d.data().paymentStatus === "PAID") return;
    const cancelled = d.data().status === "CANCELLED";
    batch.update(d.ref, {
      paymentStatus: "PAID",
      // Only move orders still waiting on payment; never undo a cancel or later stage.
      // (package orders have no store step: once paid they go straight to drivers)
      ...(d.data().status === "AWAITING_PAYMENT"
        ? d.data().orderType === "PACKAGE"
          ? { status: "READY", readyAt: FieldValue.serverTimestamp(), dispatchStartedAt: FieldValue.serverTimestamp() }
          : { status: "PENDING" }
        : {}),
      // Paid after the customer cancelled: money must go back
      ...(cancelled ? { refundStatus: "REQUESTED", refundAmount: Number(d.data().total || 0) } : {}),
      paidAt: FieldValue.serverTimestamp(),
      chapaVerifiedAmount: paid,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();

  // Tell each store about its newly paid order (same shape the app's NotificationContext reads)
  await Promise.all(
    linked.docs
      .filter((d) => d.data().status === "AWAITING_PAYMENT" && d.data().merchantOwnerUid)
      .map((d) =>
        db.collection("notifications").add({
          recipientUid: d.data().merchantOwnerUid,
          type: "ORDER_UPDATE",
          category: "ORDER",
          title: "New Paid Order 🛎️",
          body: `#${d.id.slice(0, 8).toUpperCase()} · ETB ${Number(d.data().total || 0).toFixed(2)} · paid with Chapa`,
          data: { targetRoute: "SellerHome" },
          priority: "HIGH",
          isRead: false,
          readAt: null,
          createdAt: FieldValue.serverTimestamp(),
        })
      )
  ).catch((e) => console.warn("merchant notify failed", e?.message));

  return { verified: true, paymentStatus: "PAID", txRef };
});

/* ───────────────────────── Driver dispatch ─────────────────────────
 * Nearest-driver-first: when an order enters PREPARING (or READY) without a
 * driver, it is offered to the closest free online driver for OFFER_SECONDS.
 * If that driver passes, the next closest gets it (up to MAX_OFFER_ROUNDS).
 * After that, or once an offer expires, the order is visible to every online
 * driver (the open pool) — the app hides offers from other drivers only while
 * offerExpiresAt is in the future.
 */
const OFFER_SECONDS = 60;
const MAX_OFFER_ROUNDS = 3;
const DEFAULT_MAX_OFFER_RADIUS_KM = 35; // Expanded driver search radius (was 15 km)
const DRIVER_LOCATION_MAX_AGE_MS = 10 * 60 * 1000;
const DISPATCHABLE = ["PREPARING", "READY"];

function haversineKm(aLat, aLng, bLat, bLng) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

async function sendExpoPush(token, title, body, data) {
  if (!token || !String(token).startsWith("ExponentPushToken")) return;
  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ to: token, title, body, data, sound: "default", priority: "high", channelId: "orders" }),
    });
  } catch (e) {
    console.warn("Expo push failed", e?.message);
  }
}

exports.offerOrderToNearestDriver = onDocumentWritten("orders/{orderId}", async (event) => {
  const after = event.data?.after;
  if (!after?.exists) return;
  const order = after.data();

  if (!DISPATCHABLE.includes(order.status) || order.driverId) return;
  if (order.offeredDriverId || order.offerOpenPool) return; // an offer is live, or we already fell back
  if ((order.offerRound || 0) >= MAX_OFFER_ROUNDS) return;

  const pLat = Number(order.restaurantLat ?? order.pickupCoords?.latitude);
  const pLng = Number(order.restaurantLng ?? order.pickupCoords?.longitude);
  if (!Number.isFinite(pLat) || !Number.isFinite(pLng)) {
    await after.ref.update({ offerOpenPool: true });
    return;
  }

  const [onlineSnap, busySnap] = await Promise.all([
    db.collection("user").where("isOnline", "==", true).limit(300).get(),
    db.collection("orders").where("status", "in", ["PREPARING", "READY", "DRIVERACCEPTED", "DRIVERPICKEDUP"]).limit(500).get(),
  ]);

  const busy = new Set();
  busySnap.forEach((d) => {
    const o = d.data();
    if (o.driverId) busy.add(o.driverId);
    // Don't stack two live offers on one driver
    if (o.offeredDriverId && d.id !== after.id && o.offerExpiresAt?.toMillis?.() > Date.now()) busy.add(o.offeredDriverId);
  });
  const declined = new Set(order.declinedDriverIds || []);
  const now = Date.now();

  let best = null;
  onlineSnap.forEach((d) => {
    const u = d.data();
    if (String(u.role || "").toLowerCase() !== "driver") return;
    if (busy.has(d.id) || declined.has(d.id)) return;
    if (["BANNED", "SUSPENDED"].includes(String(u.accountStatus || "").toUpperCase())) return;
    const lat = Number(u.driverLat);
    const lng = Number(u.driverLng);
    const seenAt = u.driverLocationUpdatedAt?.toMillis?.() || 0;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || now - seenAt > DRIVER_LOCATION_MAX_AGE_MS) return;
    const km = haversineKm(pLat, pLng, lat, lng);
    if (km <= DEFAULT_MAX_OFFER_RADIUS_KM && (!best || km < best.km)) best = { id: d.id, km, token: u.expoPushToken };
  });

  if (!best) {
    await after.ref.update({ offerOpenPool: true, offeredDriverId: null, offerExpiresAt: null });
    return;
  }

  // Transaction: only write the offer if nobody claimed the order meanwhile.
  const offered = await db.runTransaction(async (tx) => {
    const fresh = await tx.get(after.ref);
    const f = fresh.data() || {};
    if (f.driverId || f.offeredDriverId || f.offerOpenPool || !DISPATCHABLE.includes(f.status)) return false;
    tx.update(after.ref, {
      offeredDriverId: best.id,
      offeredDriverDistanceKm: Number(best.km.toFixed(2)),
      offerExpiresAt: Timestamp.fromMillis(Date.now() + OFFER_SECONDS * 1000),
      offerRound: (f.offerRound || 0) + 1,
    });
    return true;
  });
  if (!offered) return;

  const title = "New delivery near you 🚚";
  const body = `${order.restaurantName || "A store"} · ${best.km.toFixed(1)} km away · ${OFFER_SECONDS}s to accept`;
  await Promise.all([
    db.collection("notifications").add({
      recipientUid: best.id,
      type: "DELIVERY_OFFER",
      category: "ORDER",
      title,
      body,
      data: { targetRoute: "DriverDashboard" },
      priority: "HIGH",
      isRead: false,
      readAt: null,
      createdAt: FieldValue.serverTimestamp(),
    }),
    sendExpoPush(best.token, title, body, { targetRoute: "DriverDashboard" }),
  ]);
});
