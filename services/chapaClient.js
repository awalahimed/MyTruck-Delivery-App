/**
 * Chapa payments: server first, app fallback.
 *
 * 1. Uses the Cloud Functions in functions/index.js when they are deployed
 *    (secret key stays on the server — the secure setup).
 * 2. Otherwise falls back to calling Chapa directly with a key baked in at
 *    build time (app.config.js → CHAPA_SECRET_KEY). Interim only: a key in an
 *    APK can be extracted.
 */
import Constants from "expo-constants";
import { getFunctions, httpsCallable } from "firebase/functions";
import { collection, getDocs, query, where, writeBatch, doc, serverTimestamp } from "firebase/firestore";
import { app, db } from "../firebase";

const CHAPA_BASE_URL = "https://api.chapa.co/v1";
const DEFAULT_RETURN_URL = "https://checkout.chapa.co/checkout/payment-receipt";

const appKey = () =>
  String(Constants.expoConfig?.extra?.chapaSecretKey || Constants.manifest?.extra?.chapaSecretKey || "").trim();

/** True when this build carries a Chapa key for the fallback. */
export const hasAppChapaKey = () => appKey().length > 0;

/** Server function not deployed (as opposed to a real payment error). */
export const isServerMissing = (e) => /not-found|unimplemented/.test(String(e?.code || ""));

const cleanPhone = (raw) => {
  const d = String(raw || "").replace(/\D/g, "");
  const p = d.startsWith("251") ? "0" + d.slice(3) : d.startsWith("0") ? d : "0" + d;
  return p.length === 10 ? p : "0911000000";
};
// Chapa rejects some domains (.local, .et); fall back to a phone-based address
const cleanEmail = (raw, phone) => {
  const e = String(raw || "").trim().toLowerCase();
  if (e && e.includes("@") && !e.endsWith(".local") && !e.endsWith(".et")) return e;
  return phone && phone !== "0911000000" ? `customer${phone}@gmail.com` : "customer@gmail.com";
};
export const newTxRef = () =>
  `MT${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

async function chapaFetch(path, options = {}) {
  const res = await fetch(`${CHAPA_BASE_URL}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${appKey()}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  return res.json().catch(() => ({}));
}

/**
 * Starts a Chapa checkout. Returns { checkoutUrl, txRef, via: "server" | "app" }.
 * Throws when neither the server nor an app key is available.
 */
export async function startChapaCheckout({
  orderIds, amount, txRef, email, firstName, lastName, phone, description, returnUrl,
}) {
  const ref = txRef || newTxRef();
  try {
    const res = await httpsCallable(getFunctions(app), "createChapaCheckout")({
      orderIds, amount, txRef: ref, email, firstName, lastName, phone, description,
      returnUrl: returnUrl || DEFAULT_RETURN_URL,
    });
    if (res?.data?.checkoutUrl) return { checkoutUrl: res.data.checkoutUrl, txRef: res.data.txRef || ref, via: "server" };
  } catch (e) {
    if (!isServerMissing(e) || !hasAppChapaKey()) throw e;
  }
  if (!hasAppChapaKey()) {
    const err = new Error("Online payment is not available right now.");
    err.code = "chapa/unavailable";
    throw err;
  }

  const ph = cleanPhone(phone);
  const base = {
    amount: Number(amount || 0).toFixed(2),
    currency: "ETB",
    tx_ref: ref,
    email: cleanEmail(email, ph),
    first_name: String(firstName || "Customer") || "Customer",
    last_name: String(lastName || "Client") || "Client",
    phone_number: ph,
    return_url: returnUrl || DEFAULT_RETURN_URL,
  };
  let result = await chapaFetch("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      ...base,
      customization: {
        title: "MyTruck Delivery",
        // Chapa allows only letters, numbers, spaces, hyphens, underscores and dots here
        description: String(description || "MyTruck order").replace(/[^A-Za-z0-9 ._-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 50) || "MyTruck order",
      },
    }),
  });
  // Chapa sometimes rejects the customization block; retry without it
  if (!result?.data?.checkout_url) {
    result = await chapaFetch("/transaction/initialize", { method: "POST", body: JSON.stringify(base) });
  }
  const checkoutUrl = result?.data?.checkout_url;
  if (!checkoutUrl) {
    // Chapa returns validation errors as an object or a string; surface it so problems are visible
    const raw = result?.message;
    const detail = typeof raw === "string" ? raw : raw ? JSON.stringify(raw) : "";
    const err = new Error(detail ? `Chapa: ${detail}` : "Could not start Chapa checkout (no response from Chapa).");
    err.code = "chapa/initialize-failed";
    throw err;
  }
  return { checkoutUrl, txRef: ref, via: "app" };
}

/**
 * Verifies a payment and, when paid in full, marks the customer's orders under
 * that reference as PAID and forwards them to the store (PENDING).
 * Returns { verified, paymentStatus: "PAID" | "FAILED" | "PENDING" | "AMOUNT_MISMATCH", orders }.
 */
export async function verifyChapaPayment({ orderId, txRef, uid }) {
  try {
    const res = await httpsCallable(getFunctions(app), "verifyChapaPayment")({ orderId, tx_ref: txRef || "" });
    return { ...(res?.data || {}), orders: [] };
  } catch (e) {
    if (!isServerMissing(e) || !hasAppChapaKey()) throw e;
  }
  if (!txRef) return { verified: false, paymentStatus: "PENDING", orders: [] };

  const result = await chapaFetch(`/transaction/verify/${encodeURIComponent(txRef)}`);
  const chapaStatus = String(result?.data?.status || "").toUpperCase();
  if (result?.status !== "success" || chapaStatus !== "SUCCESS") {
    const failed = ["FAILED", "CANCELLED", "EXPIRED"].includes(chapaStatus);
    return { verified: false, paymentStatus: failed ? "FAILED" : "PENDING", orders: [] };
  }

  // Every order of this customer under the reference (one checkout can cover several stores)
  const snap = await getDocs(
    query(collection(db, "orders"), where("chapaMerchantReference", "==", txRef), where("userId", "==", uid))
  );
  const linked = [];
  snap.forEach((d) => linked.push({ id: d.id, ...d.data() }));
  if (!linked.length) return { verified: false, paymentStatus: "PENDING", orders: [] };

  const expected = linked.filter((o) => o.status !== "CANCELLED").reduce((s, o) => s + Number(o.total || 0), 0);
  const paid = Number(result.data.amount);
  if (String(result.data.currency || "ETB").toUpperCase() !== "ETB" || !(paid + 0.01 >= expected)) {
    return { verified: false, paymentStatus: "AMOUNT_MISMATCH", orders: [] };
  }

  const toForward = linked.filter((o) => o.status === "AWAITING_PAYMENT" && o.paymentStatus !== "PAID");
  if (toForward.length) {
    const batch = writeBatch(db);
    toForward.forEach((o) =>
      batch.update(doc(db, "orders", o.id), {
        paymentStatus: "PAID",
        status: "PENDING",
        paidAt: serverTimestamp(),
        chapaVerifiedAmount: paid,
        paymentVerifiedBy: "app",
        updatedAt: serverTimestamp(),
      })
    );
    await batch.commit();
  }
  return { verified: true, paymentStatus: "PAID", orders: toForward };
}

/**
 * Store-side check before accepting an order the customer's app marked as paid.
 * Asks Chapa directly (the customer can't fake this — it runs on the store's phone).
 * Returns { ok: true, amount } or { ok: false, reason, retry? }.
 */
export async function checkChapaPaymentForStore(txRef) {
  if (!txRef) return { ok: false, reason: "This order has no Chapa payment reference." };
  if (!hasAppChapaKey()) {
    return { ok: false, reason: "This app version can't contact Chapa to confirm the payment. Update the app." };
  }
  let result;
  try {
    result = await chapaFetch(`/transaction/verify/${encodeURIComponent(txRef)}`);
  } catch (e) {
    return { ok: false, retry: true, reason: "Couldn't reach Chapa to confirm the payment. Check your connection and try again." };
  }
  const status = String(result?.data?.status || "").toUpperCase();
  if (result?.status !== "success" || status !== "SUCCESS") {
    return {
      ok: false,
      reason: status ? `Chapa reports this payment as ${status}, not completed.` : "Chapa has no completed payment for this order.",
    };
  }
  const currency = String(result.data.currency || "ETB").toUpperCase();
  if (currency !== "ETB") return { ok: false, reason: `The payment was made in ${currency}, not ETB.` };
  return { ok: true, amount: Number(result.data.amount) || 0 };
}
