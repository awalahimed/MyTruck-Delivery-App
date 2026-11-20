/**
 * Registered phone numbers, one Firestore document per number: phoneIndex/{2519XXXXXXXX} -> { uid }.
 *
 * User profiles are private, so a signed-out device can't search them to see whether a number is
 * taken. This index holds nothing but "this number belongs to an account", and a single number can
 * be looked up without signing in. Sign-up checks it BEFORE sending the SMS code, so a number that
 * already has an account never costs an SMS.
 *
 * Needs the phoneIndex block in firestore.rules to be deployed. Until it is, every call here
 * fails quietly and sign-up behaves as it did before.
 */
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where, writeBatch } from "firebase/firestore";
import { db } from "../firebase";

const COLLECTION = "phoneIndex";

/** Any common Ethiopian format -> "2519XXXXXXXX" (the document id), or null. */
export function phoneKey(phone) {
  let d = String(phone ?? "").replace(/\D/g, "");
  if (d.startsWith("251")) d = d.slice(3);
  else if (d.startsWith("0")) d = d.slice(1);
  if (!/^[79]\d{8}$/.test(d)) return null;
  return "251" + d;
}

function takenError() {
  const err = new Error("This mobile number is already registered. Please sign in instead.");
  err.code = "otp/taken";
  return err;
}

/** true = the number belongs to an account, false = it's free, null = couldn't tell. */
export async function isPhoneIndexed(phone) {
  const key = phoneKey(phone);
  if (!key) return null;
  try {
    const snap = await getDoc(doc(db, COLLECTION, key));
    return snap.exists();
  } catch (_) {
    return null;
  }
}

/**
 * Reserves the number for this account. Throws code "otp/taken" if another account has it.
 * Any other trouble (offline, rules not deployed) is reported as { ok: false } and never blocks.
 */
export async function reservePhone(phone, uid) {
  const key = phoneKey(phone);
  if (!key || !uid) return { ok: false };
  const ref = doc(db, COLLECTION, key);

  let snap;
  try {
    snap = await getDoc(ref);
  } catch (_) {
    return { ok: false };
  }
  if (snap.exists()) {
    if (snap.data()?.uid === uid) return { ok: true };
    throw takenError();
  }

  try {
    await setDoc(ref, { uid, createdAt: serverTimestamp() });
    return { ok: true };
  } catch (_) {
    // Someone else may have reserved it a moment ago
    const again = await getDoc(ref).catch(() => null);
    if (again?.exists() && again.data()?.uid !== uid) throw takenError();
    return { ok: false };
  }
}

const syncedThisSession = new Set();

/**
 * Keeps the signed-in account's entry right: adds its current number (this is also how accounts
 * created before the index existed get added) and frees a number it no longer uses.
 */
export async function syncOwnPhone(uid, phone) {
  const key = phoneKey(phone);
  if (!uid || !key) return;
  const tag = `${uid}:${key}`;
  if (syncedThisSession.has(tag)) return;
  syncedThisSession.add(tag);
  try {
    const mine = await getDocs(query(collection(db, COLLECTION), where("uid", "==", uid)));
    await Promise.all(mine.docs.filter((d) => d.id !== key).map((d) => deleteDoc(d.ref)));
    if (!mine.docs.some((d) => d.id === key)) await reservePhone(key, uid);
  } catch (_) {
    // Taken by another account, offline, or rules not deployed: try again next session
    syncedThisSession.delete(tag);
  }
}

let backfillStarted = false;

/**
 * Staff only: adds every existing account's number to the index, so accounts that haven't
 * opened the app since this was released are covered too. Runs once per app session.
 * If two accounts share a number, the older account keeps it.
 */
export async function backfillPhoneIndex() {
  if (backfillStarted) return;
  backfillStarted = true;
  try {
    const [users, index] = await Promise.all([getDocs(collection(db, "user")), getDocs(collection(db, COLLECTION))]);
    const have = new Set(index.docs.map((d) => d.id));
    const createdMs = (d) => d.data()?.createdAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
    const missing = [];
    [...users.docs]
      .sort((a, b) => createdMs(a) - createdMs(b))
      .forEach((d) => {
        const key = phoneKey(d.data()?.phoneNumber || d.data()?.phone);
        if (!key || have.has(key)) return;
        have.add(key);
        missing.push({ key, uid: d.id });
      });
    for (let i = 0; i < missing.length; i += 400) {
      const batch = writeBatch(db);
      missing.slice(i, i + 400).forEach(({ key, uid }) => {
        batch.set(doc(db, COLLECTION, key), { uid, createdAt: serverTimestamp() });
      });
      await batch.commit();
    }
    return missing.length;
  } catch (e) {
    console.warn("Phone index backfill skipped:", e?.code || e?.message);
    backfillStarted = false;
    return 0;
  }
}
