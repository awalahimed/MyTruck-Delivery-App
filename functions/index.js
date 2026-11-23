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
const logger = require("firebase-functions/logger");

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
  return `MT${Date.now().toString(36).toUpperCase()}${randomBytes(10).toString("hex").toUpperCase()}`;
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

const DEFAULT_PAYMENT_PRICING = {
  itemMarkupPercent: 20, itemMarkupFlat: 100, deliveryRatePerKm: 25, minimumDeliveryFee: 50,
  serviceFee: 15, deliveryCommissionPercent: 20, packageBaseFee: 60, packageRatePerKm: 25,
  packageMinimumFee: 80,
  maxDeliveryRadiusKm: 25, maxShopRadiusKm: 35, maxPackageRadiusKm: 50,
  packageTypeSurcharges: { "Documents / Envelope": 0, "Small Box (< 3kg)": 20, "Medium Box (3-10kg)": 50, "Fragile Item": 80 },
};

async function paymentPricing() {
  const snap = await db.collection("platformSettings").doc("config").get();
  const raw = snap.exists ? snap.data() : {};
  const nonNegative = (value, fallback) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;
  return {
    ...DEFAULT_PAYMENT_PRICING, ...raw,
    itemMarkupPercent: Math.min(500, nonNegative(raw.itemMarkupPercent, DEFAULT_PAYMENT_PRICING.itemMarkupPercent)),
    itemMarkupFlat: nonNegative(raw.itemMarkupFlat, DEFAULT_PAYMENT_PRICING.itemMarkupFlat),
    deliveryRatePerKm: nonNegative(raw.deliveryRatePerKm ?? raw.perKmFee, DEFAULT_PAYMENT_PRICING.deliveryRatePerKm),
    minimumDeliveryFee: nonNegative(raw.minimumDeliveryFee ?? raw.baseFee, DEFAULT_PAYMENT_PRICING.minimumDeliveryFee),
    serviceFee: nonNegative(raw.serviceFee, DEFAULT_PAYMENT_PRICING.serviceFee),
    deliveryCommissionPercent: Math.min(100, nonNegative(raw.deliveryCommissionPercent, DEFAULT_PAYMENT_PRICING.deliveryCommissionPercent)),
    packageBaseFee: nonNegative(raw.packageBaseFee, DEFAULT_PAYMENT_PRICING.packageBaseFee),
    packageRatePerKm: nonNegative(raw.packageRatePerKm, DEFAULT_PAYMENT_PRICING.packageRatePerKm),
    packageMinimumFee: nonNegative(raw.packageMinimumFee, DEFAULT_PAYMENT_PRICING.packageMinimumFee),
    maxDeliveryRadiusKm: nonNegative(raw.maxDeliveryRadiusKm ?? raw.maxDistanceKm, DEFAULT_PAYMENT_PRICING.maxDeliveryRadiusKm),
    maxShopRadiusKm: nonNegative(raw.maxShopRadiusKm, DEFAULT_PAYMENT_PRICING.maxShopRadiusKm),
    maxPackageRadiusKm: nonNegative(raw.maxPackageRadiusKm, DEFAULT_PAYMENT_PRICING.maxPackageRadiusKm),
    packageTypeSurcharges: Object.fromEntries(Object.entries(DEFAULT_PAYMENT_PRICING.packageTypeSurcharges).map(([type, fallback]) =>
      [type, nonNegative(raw.packageTypeSurcharges?.[type], fallback)])),
  };
}

function validEthiopiaPoint(point) {
  const lat = Number(point?.latitude ?? point?.lat);
  const lng = Number(point?.longitude ?? point?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 3.4 && lat <= 14.9 && lng >= 32.9 && lng <= 48.0
    ? { latitude: lat, longitude: lng } : null;
}

function roundMoney(value) { return Number(Number(value).toFixed(2)); }
function paymentDistanceKm(a, b) {
  const rad = (n) => n * Math.PI / 180;
  const x = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return Number((6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))).toFixed(1));
}

/** Recomputes the amount from trusted catalog/config data; client order totals are never used. */
async function validateAndPriceChapaOrders(uid, orderSnaps) {
  if (!orderSnaps.length) throw new HttpsError("invalid-argument", "At least one order is required.");
  if (orderSnaps.length > 10) throw new HttpsError("invalid-argument", "Too many orders in one payment.");
  const cfg = await paymentPricing();
  let expected = 0;
  for (const snap of orderSnaps) {
    const order = snap.data();
    if (order.userId !== uid) throw new HttpsError("permission-denied", "Not your order.");
    if (order.paymentMethod !== "CHAPA" || order.status !== "AWAITING_PAYMENT" || !["UNPAID", "PENDING"].includes(order.paymentStatus))
      throw new HttpsError("failed-precondition", "Order is not awaiting Chapa payment.");
    if (order.currency && String(order.currency).toUpperCase() !== "ETB") throw new HttpsError("failed-precondition", "Order currency must be ETB.");
    if (order.status === "CANCELLED") throw new HttpsError("failed-precondition", "Cancelled orders cannot be paid.");

    if (order.orderType === "PACKAGE") {
      const pickup = validEthiopiaPoint(order.pickupCoords);
      const dropoff = validEthiopiaPoint(order.dropoffCoords || order.deliveryCoords);
      const surcharge = cfg.packageTypeSurcharges?.[order.packageType];
      if (!pickup || !dropoff || !Number.isFinite(Number(surcharge)) || !String(order.recipientName || "").trim() || !String(order.recipientPhone || "").trim())
        throw new HttpsError("invalid-argument", "Package details or locations are invalid.");
      const km = paymentDistanceKm(pickup, dropoff);
      if (km > cfg.maxPackageRadiusKm) throw new HttpsError("failed-precondition", "Package route is outside the delivery area.");
      const fee = Math.round(Math.max(cfg.packageMinimumFee, cfg.packageBaseFee + km * cfg.packageRatePerKm) + Number(surcharge));
      const total = roundMoney(fee + cfg.serviceFee);
      const commission = roundMoney(fee * cfg.deliveryCommissionPercent / 100);
      await snap.ref.update({ pickupCoords: pickup, dropoffCoords: dropoff, deliveryCoords: dropoff, deliveryDistanceKm: km,
        packageBaseFee: cfg.packageBaseFee, packageDistanceCharge: Math.round(km * cfg.packageRatePerKm), packageTypeSurcharge: Number(surcharge),
        subtotal: 0, deliveryFee: fee, serviceFee: cfg.serviceFee, total, currency: "ETB",
        deliveryCommissionPercent: cfg.deliveryCommissionPercent, deliveryCommission: commission,
        driverEarnings: roundMoney(fee - commission), companyProfit: roundMoney(cfg.serviceFee + commission), restaurantEarnings: 0,
        totalOwedOut: roundMoney(fee - commission), updatedAt: FieldValue.serverTimestamp() });
      expected += total;
      continue;
    }

    const destination = validEthiopiaPoint(order.deliveryCoords || order.dropoffCoords);
    const restaurantId = String(order.restaurantId || "");
    if (!destination || !restaurantId || restaurantId.startsWith("package_")) throw new HttpsError("invalid-argument", "Delivery location or store is invalid.");
    const collectionName = order.sellerType === "shop" ? "shops" : "restaurants";
    const storeSnap = await db.collection(collectionName).doc(restaurantId).get();
    if (!storeSnap.exists) throw new HttpsError("failed-precondition", "The selected store is unavailable.");
    const store = storeSnap.data();
    if (String(store.status || "").toUpperCase() !== "APPROVED" || store.isVerified === false || store.isActive === false)
      throw new HttpsError("failed-precondition", "The selected store is not approved for orders.");
    if (store.isOpen === false || store.isAvailable === false) throw new HttpsError("failed-precondition", "The selected store is closed.");
    const origin = validEthiopiaPoint({ latitude: store.latitude ?? store.lat ?? store.storeLatitude, longitude: store.longitude ?? store.lng ?? store.storeLongitude });
    if (!origin) throw new HttpsError("failed-precondition", "The selected store has no valid delivery location.");
    const linesSnap = await db.collection("orderDishes").where("orderId", "==", snap.id).get();
    if (linesSnap.empty || linesSnap.size > 50) throw new HttpsError("failed-precondition", "Order items are missing or invalid.");
    let subtotal = 0;
    let baseSubtotal = 0;
    for (const lineSnap of linesSnap.docs) {
      const line = lineSnap.data();
      const quantity = Number(line.quantity);
      const catalogId = String(line.dishId || line.productId || "");
      if (!catalogId || !Number.isInteger(quantity) || quantity < 1 || quantity > 50 || String(line.restaurantId) !== restaurantId)
        throw new HttpsError("invalid-argument", "An order item or quantity is invalid.");
      let catalogSnap = await db.collection(order.sellerType === "shop" ? "products" : "dishes").doc(catalogId).get();
      if (!catalogSnap.exists && order.sellerType === "shop") catalogSnap = await db.collection("dishes").doc(catalogId).get();
      if (!catalogSnap.exists) throw new HttpsError("failed-precondition", "An item is no longer available.");
      const item = catalogSnap.data();
      const itemStore = String(item.shopId || item.restaurantId || item.storeId || "");
      const itemApproved = item.isApproved === true || item.isPublished === true || item.status === "APPROVED" || item.status === "Published" || item.lifecycleStatus === "Published";
      if (itemStore !== restaurantId || !itemApproved || item.isAvailable === false || item.inStock === false || item.isActive === false)
        throw new HttpsError("failed-precondition", "An item is not available from this store.");
      const base = Number(item.price ?? item.discountedPrice);
      if (!Number.isFinite(base) || base <= 0) throw new HttpsError("failed-precondition", "An item has an invalid catalog price.");
      const unit = Math.round(base * (1 + cfg.itemMarkupPercent / 100) + cfg.itemMarkupFlat);
      subtotal += unit * quantity;
      baseSubtotal += base * quantity;
      await lineSnap.ref.update({ price: unit, merchantBasePrice: base, totalPrice: roundMoney(unit * quantity), name: item.name || line.name });
    }
    subtotal = roundMoney(subtotal);
    const distance = paymentDistanceKm(origin, destination);
    const maxDistance = order.sellerType === "shop" ? cfg.maxShopRadiusKm : cfg.maxDeliveryRadiusKm;
    if (distance > maxDistance) throw new HttpsError("failed-precondition", "Store is outside the delivery area.");
    const deliveryFee = Math.max(cfg.minimumDeliveryFee, Math.round(distance * cfg.deliveryRatePerKm));
    const serviceFee = cfg.serviceFee;
    const promoCode = String(order.promoCode || "").toUpperCase();
    let promoDiscount = 0;
    if (promoCode === "MYTRUCK20") promoDiscount = roundMoney(subtotal * 0.2);
    else if (promoCode === "WELCOME" || promoCode === "WELCOME50") promoDiscount = Math.min(subtotal, 50);
    else if (promoCode === "FREESHIP") promoDiscount = Math.min(subtotal, deliveryFee);
    else if (promoCode) throw new HttpsError("failed-precondition", "Promo code is invalid.");
    const total = roundMoney(Math.max(0, subtotal + deliveryFee + serviceFee - promoDiscount));
    baseSubtotal = roundMoney(baseSubtotal);
    const commission = roundMoney(deliveryFee * cfg.deliveryCommissionPercent / 100);
    const platformMarkup = roundMoney(subtotal - baseSubtotal);
    await snap.ref.update({ subtotal, merchantBaseSubtotal: baseSubtotal, platformItemMarkup: platformMarkup,
      deliveryFee, serviceFee, promoDiscount, total, currency: "ETB", deliveryDistanceKm: distance,
      deliveryCommissionPercent: cfg.deliveryCommissionPercent, deliveryCommission: commission,
      restaurantEarnings: baseSubtotal, driverEarnings: roundMoney(deliveryFee - commission),
      companyProfit: roundMoney(platformMarkup + serviceFee + commission), totalOwedOut: roundMoney(baseSubtotal + deliveryFee - commission),
      deliveryCoords: destination, dropoffCoords: destination, restaurantLat: origin.latitude, restaurantLng: origin.longitude,
      updatedAt: FieldValue.serverTimestamp() });
    expected += total;
  }
  return roundMoney(expected);
}

/** Initializes payments only for caller-owned persisted drafts, priced here from trusted data. */
exports.createChapaCheckout = onCall({ secrets: [CHAPA_SECRET_KEY] }, async (request) => {
  const uid = requireAuth(request);
  const data = request.data || {};
  // Availability probe from the app (lets it hide Chapa when this function isn't deployed)
  if (data.probe === true) {
    chapaSecretValue();
    return { ok: true };
  }
  if (!Array.isArray(data.orderIds) || !data.orderIds.length) throw new HttpsError("invalid-argument", "Order IDs are required.");
  const ids = [...new Set(data.orderIds.map((id) => String(id).trim()).filter(Boolean))];
  if (ids.length !== data.orderIds.length) throw new HttpsError("invalid-argument", "Order IDs must be unique.");
  const orders = await loadOwnedOrders(uid, ids);
  for (const orderSnap of orders) {
    const priorRef = String(orderSnap.data().chapaMerchantReference || "");
    if (!priorRef) continue;
    const prior = await db.collection("chapaPaymentVerifications").doc(priorRef).get();
    if (prior.exists && !["FAILED", "CANCELLED", "EXPIRED", "INITIALIZATION_FAILED", "INITIALIZATION_ERROR"].includes(String(prior.data().status || ""))) {
      throw new HttpsError("failed-precondition", "This order already has an active or verified Chapa payment. Check its payment status before retrying.");
    }
  }
  const amount = await validateAndPriceChapaOrders(uid, orders);
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpsError("failed-precondition", "The validated order total is invalid.");

  const first = orders[0]?.data() || {};
  const phone = cleanPhone(data.phone || first.customerPhone);
  const fullName = String(data.firstName ? `${data.firstName} ${data.lastName || ""}` : first.customerName || "Customer User").trim();
  const [firstName = "Customer", ...rest] = fullName.split(" ");
  // Client references are not accepted: the server creates a unique payment binding.
  const txRef = newTxRef();

  const base = {
    amount: amount.toFixed(2),
    currency: "ETB",
    tx_ref: txRef,
    email: cleanEmail(data.email || first.customerEmail, phone),
    first_name: firstName || "Customer",
    last_name: rest.join(" ") || "Client",
    phone_number: phone,
    return_url: DEFAULT_RETURN_URL,
  };

  const paymentRef = db.collection("chapaPaymentVerifications").doc(txRef);
  const bindBatch = db.batch();
  bindBatch.create(paymentRef, { uid, orderIds: orders.map((s) => s.id).sort(), amount: roundMoney(amount), currency: "ETB", status: "INITIALIZING", createdAt: FieldValue.serverTimestamp() });
  orders.forEach((s) => bindBatch.update(s.ref, {
    chapaMerchantReference: txRef, chapaCheckoutUrl: "", paymentInitiatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }));
  await bindBatch.commit();

  let result;
  try {
    result = await chapaFetch("/transaction/initialize", {
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
  } catch (error) {
    await paymentRef.set({ status: "INITIALIZATION_ERROR", updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("unavailable", "Couldn't reach Chapa to start payment. Please try again.");
  }

  const checkoutUrl = result?.data?.checkout_url;
  if (!checkoutUrl) {
    const detail = String(result?.message || "").replace(/\s+/g, " ").trim().slice(0, 300);
    console.warn("Chapa initialize failed", detail || "No checkout URL returned.");
    const lowerDetail = detail.toLowerCase();
    await paymentRef.set({ status: "INITIALIZATION_FAILED", updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
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

  const batch = db.batch();
  batch.set(paymentRef, { status: "PENDING", checkoutUrl, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  orders.forEach((s) => batch.update(s.ref, { chapaCheckoutUrl: checkoutUrl, updatedAt: FieldValue.serverTimestamp() }));
  await batch.commit();

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

  const paymentSnap = await db.collection("chapaPaymentVerifications").doc(txRef).get();
  if (!paymentSnap.exists) throw new HttpsError("not-found", "No server payment record exists for this reference.");
  const payment = paymentSnap.data();
  if (payment.uid !== uid) throw new HttpsError("permission-denied", "This payment does not belong to your account.");
  const linked = await loadOwnedOrders(uid, payment.orderIds || []);
  const boundIds = [...(payment.orderIds || [])].sort();
  if (!boundIds.length || linked.length !== boundIds.length || boundIds.some((id, i) => id !== linked[i].id) ||
      linked.some((s) => s.data().chapaMerchantReference !== txRef)) {
    throw new HttpsError("failed-precondition", "The payment is not bound to this exact order set.");
  }
  if (requested.some((id) => !boundIds.includes(String(id)))) throw new HttpsError("permission-denied", "Requested order is not part of this payment.");
  const expected = roundMoney(linked.reduce((sum, d) => sum + Number(d.data().total), 0));
  if (expected !== Number(payment.amount) || payment.currency !== "ETB")
    throw new HttpsError("failed-precondition", "Server payment record does not match the current order totals.");

  const result = await chapaFetch(`/transaction/verify/${encodeURIComponent(txRef)}`);
  const chapaStatus = String(result?.data?.status || "").toUpperCase();

  const returnedRef = String(result?.data?.tx_ref || "").trim();
  if (returnedRef !== txRef) {
    return { verified: false, paymentStatus: "PENDING", chapaStatus, txRef };
  }
  if (result?.status !== "success") {
    const failed = ["FAILED", "CANCELLED", "EXPIRED"].includes(chapaStatus);
    if (failed) await paymentSnap.ref.set({ status: chapaStatus, lastCheckedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { verified: false, paymentStatus: failed ? "FAILED" : "PENDING", chapaStatus, txRef };
  }
  if (chapaStatus !== "SUCCESS") {
    const failed = ["FAILED", "CANCELLED", "EXPIRED"].includes(chapaStatus);
    if (failed) await paymentSnap.ref.set({ status: chapaStatus, lastCheckedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { verified: false, paymentStatus: failed ? "FAILED" : "PENDING", chapaStatus, txRef };
  }

  const paid = Number(result.data.amount);
  if (String(result.data.currency || "").toUpperCase() !== "ETB" || !Number.isFinite(paid) || Math.abs(paid - expected) > 0.01 || Math.abs(paid - Number(payment.amount)) > 0.01) {
    console.error("Chapa amount or currency mismatch", { txRef, paid, expected });
    return { verified: false, paymentStatus: "AMOUNT_MISMATCH", txRef };
  }

  const batch = db.batch();
  linked.forEach((d) => {
    if (d.data().paymentStatus === "PAID") return; // server has re-verified this exact payment and binding
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
  batch.set(paymentSnap.ref, { status: "VERIFIED", verifiedAmount: paid, verifiedCurrency: "ETB", verifiedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();

  // Tell each store about its newly paid order (same shape the app's NotificationContext reads)
  await Promise.all(
    linked
      .filter((d) => d.data().status === "AWAITING_PAYMENT" && d.data().merchantOwnerUid)
      .map((d) => {
        const notificationRef = db.collection("notifications").doc(`chapa_${txRef}_${d.id}`);
        return notificationRef.create({
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
          .catch((e) => { if (e.code !== 6 && e.code !== "already-exists") console.warn("merchant notify failed", e?.message); });
      })
  );

  return { verified: true, paymentStatus: "PAID", txRef };
});

/** Server-side payment check used by a merchant before accepting a legacy app-verified order. */
exports.checkChapaPaymentForStore = onCall({ secrets: [CHAPA_SECRET_KEY] }, async (request) => {
  const uid = requireAuth(request);
  const txRef = String(request.data?.txRef || "").trim();
  if (!txRef) throw new HttpsError("invalid-argument", "A Chapa transaction reference is required.");

  const profileSnap = await db.collection("user").doc(uid).get();
  const profile = profileSnap.data() || {};
  const role = String(profile.role || "").toLowerCase();
  const isStaff = ["admin", "superadmin", "super_admin", "mini_admin", "miniadmin"].includes(role) ||
    profile.isAdmin === true || profile.isSuperAdmin === true || profile.isMiniAdmin === true;
  if (!isStaff && !["restaurant", "shop", "seller"].includes(role)) {
    throw new HttpsError("permission-denied", "Only the order's merchant can check its payment.");
  }

  const ordersSnap = await db.collection("orders")
    .where("chapaMerchantReference", "==", txRef)
    .limit(20)
    .get();
  if (ordersSnap.empty) throw new HttpsError("not-found", "No order was found for this Chapa reference.");

  const ownedIds = new Set([uid, profile.sellerId, profile.restaurantId, profile.shopId].filter(Boolean).map(String));
  let ownsMatchingOrder = isStaff;
  for (const orderDoc of ordersSnap.docs) {
    const order = orderDoc.data();
    const storeId = String(order.restaurantId || "");
    if (order.merchantOwnerUid === uid || ownedIds.has(storeId)) {
      ownsMatchingOrder = true;
      break;
    }
    if (storeId) {
      const storeDocs = await Promise.all([
        db.collection("restaurants").doc(storeId).get(),
        db.collection("shops").doc(storeId).get(),
      ]);
      if (storeDocs.some((store) => store.exists && store.data()?.ownerUid === uid)) {
        ownsMatchingOrder = true;
        break;
      }
    }
  }
  if (!ownsMatchingOrder) throw new HttpsError("permission-denied", "This payment reference is not for your store.");

  const result = await chapaFetch(`/transaction/verify/${encodeURIComponent(txRef)}`);
  const status = String(result?.data?.status || "").toUpperCase();
  if (result?.status !== "success" || status !== "SUCCESS") {
    return { ok: false, reason: status ? `Chapa reports this payment as ${status}, not completed.` : "Chapa has no completed payment for this order." };
  }
  const currency = String(result.data.currency || "ETB").toUpperCase();
  if (currency !== "ETB") return { ok: false, reason: `The payment was made in ${currency}, not ETB.` };
  return { ok: true, amount: Number(result.data.amount) || 0 };
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
