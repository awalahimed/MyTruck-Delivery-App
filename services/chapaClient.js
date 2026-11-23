/**
 * Chapa payments run only through authenticated Firebase Cloud Functions.
 * The Chapa secret is stored as a Firebase Functions secret and never ships
 * in Expo config, JavaScript, or the native application bundle.
 */
import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "../firebase";

const secureFunction = async (name, data) => {
  try {
    const result = await httpsCallable(getFunctions(app), name)(data);
    return result?.data || {};
  } catch (error) {
    if (/not-found|unimplemented/.test(String(error?.code || ""))) {
      const unavailable = new Error("Secure payment service is unavailable. Please try again later.");
      unavailable.code = "chapa/unavailable";
      throw unavailable;
    }
    throw error;
  }
};

export async function startChapaCheckout({
  orderIds, email, firstName, lastName, phone, description,
}) {
  if (!Array.isArray(orderIds) || !orderIds.length) throw new Error("Create the order before starting Chapa checkout.");
  const data = await secureFunction("createChapaCheckout", {
    orderIds, email, firstName, lastName, phone, description,
  });
  if (!data.checkoutUrl) throw new Error("Secure payment service did not return a checkout URL.");
  return { checkoutUrl: data.checkoutUrl, txRef: data.txRef, amount: data.amount, via: "server" };
}

export async function verifyChapaPayment({ orderId, txRef }) {
  const result = await secureFunction("verifyChapaPayment", { orderId, tx_ref: txRef || "" });
  return { ...result, orders: [] };
}

export async function checkChapaPaymentForStore(txRef) {
  if (!txRef) return { ok: false, reason: "This order has no Chapa payment reference." };
  try {
    return await secureFunction("checkChapaPaymentForStore", { txRef });
  } catch (error) {
    if (error?.code === "chapa/unavailable") {
      return { ok: false, retry: true, reason: error.message };
    }
    if (String(error?.code || "").includes("permission-denied")) {
      return { ok: false, reason: "Your account is not authorized to confirm this store's payment." };
    }
    return { ok: false, retry: true, reason: "Couldn't reach the secure payment service. Check your connection and try again." };
  }
}
