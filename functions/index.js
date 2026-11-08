/**
 * MyTruck Delivery — Chapa payment Cloud Functions.
 *
 * The Chapa SECRET key lives only here, as a Firebase secret:
 *   firebase functions:secrets:set CHAPA_SECRET_KEY
 * It must never be shipped inside the mobile app.
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

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
  const orders = data.orderIds && data.orderIds.length ? await loadOwnedOrders(uid, data.orderIds) : [];

  let amount;
  if (orders.length) {
    if (orders.some((s) => s.data().paymentStatus === "PAID")) {
      throw new HttpsError("failed-precondition", "Order is already paid.");
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
 * of the caller's orders under that reference, marks them PAID.
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
    batch.update(d.ref, {
      paymentStatus: "PAID",
      status: "AWAITING_MERCHANT",
      paidAt: FieldValue.serverTimestamp(),
      chapaVerifiedAmount: paid,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();

  return { verified: true, paymentStatus: "PAID", txRef };
});
