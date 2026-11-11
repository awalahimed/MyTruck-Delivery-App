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

initializeApp();
const db = getFirestore();

const CHAPA_SECRET_KEY = defineSecret("CHAPA_SECRET_KEY");
const CHAPA_BASE_URL = "https://api.chapa.co/v1";
const DEFAULT_RETURN_URL = "https://checkout.chapa.co/checkout/payment-receipt";

function requireAuth(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to pay.");
  return request.auth.uid;
}

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
      Authorization: `Bearer ${CHAPA_SECRET_KEY.value()}`,
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
  if (data.probe === true) return { ok: true };
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
    console.warn("Chapa initialize failed", result?.message);
    throw new HttpsError("unavailable", "Could not start Chapa checkout.");
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
const MAX_OFFER_RADIUS_KM = 15;
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
    if (km <= MAX_OFFER_RADIUS_KM && (!best || km < best.km)) best = { id: d.id, km, token: u.expoPushToken };
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
