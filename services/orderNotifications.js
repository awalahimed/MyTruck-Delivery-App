/**
 * Order status alerts without a backend.
 *
 * Writes a document to `notifications` for the recipient. NotificationContext
 * listens on `recipientUid` and shows a heads-up banner on the recipient's
 * device whenever the app is running, plus the in-app Notification Center.
 * Failures never block the order flow.
 */
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";

const shortRef = (orderId) => `#${String(orderId || "").slice(0, 8).toUpperCase()}`;

export async function notifyUser(recipientUid, { title, body, data, category = "ORDER", type = "ORDER_UPDATE" }) {
  if (!recipientUid || !title) return;
  try {
    await addDoc(collection(db, "notifications"), {
      recipientUid,
      type,
      category,
      title,
      body: body || "",
      data: data || {},
      priority: "HIGH",
      isRead: false,
      readAt: null,
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.warn("notifyUser note:", e?.message);
  }
}

/** Customer: deep-links to the order tracking screen. */
export function notifyCustomer(order, title, body) {
  const orderId = order?.id || order?.orderId;
  return notifyUser(order?.userId, {
    title,
    body: `${shortRef(orderId)} · ${body}`,
    data: { targetRoute: "TrackOrder", orderId },
  });
}

/** Store owner: deep-links to the seller dashboard (no orderId, which would open customer tracking). */
export function notifyMerchant(order, title, body) {
  return notifyUser(order?.merchantOwnerUid, {
    title,
    body: `${shortRef(order?.id || order?.orderId)} · ${body}`,
    data: { targetRoute: "SellerHome" },
  });
}
