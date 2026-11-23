const { before, beforeEach, after, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore: getAdminFirestore } = require("firebase-admin/firestore");
if (!process.env.MYTRUCK_RULES_TEST_DEPS) throw new Error("Set MYTRUCK_RULES_TEST_DEPS to the isolated test dependency directory.");
const testRequire = createRequire(path.join(path.resolve(process.env.MYTRUCK_RULES_TEST_DEPS), "package.json"));
const { initializeTestEnvironment, assertSucceeds } = testRequire("@firebase/rules-unit-testing");
const { doc, setDoc, updateDoc, serverTimestamp } = testRequire("firebase/firestore");

const projectId = "demo-mytruck-chapa-rules";
const rulesPath = path.resolve(__dirname, "../../firestore.rules");
let testEnv;
let adminApp;
let adminDb;

const clientDb = (uid) => testEnv.authenticatedContext(uid, { email: `${uid}@example.test` }).firestore();

// assertFails() accepts any rejection, including Rules evaluation errors. For
// negative authorization cases require the SDK's explicit permission-denied
// code and reject emulator diagnostics that reveal a rules evaluation failure.
async function assertPermissionDenied(operation) {
  let error;
  try {
    await operation();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, "expected Firestore to deny the write");
  assert.equal(error.code, "permission-denied", `unexpected Firestore error: ${error.message}`);
  assert.doesNotMatch(
    error.message || "",
    /evaluation error|unable to evaluate expression|max(?:imum)? of 1000 expressions/i,
    "write failed because Rules evaluation errored instead of returning a permission denial",
  );
}

const order = (overrides = {}) => ({
  userId: "customer-1",
  paymentMethod: "CHAPA",
  paymentStatus: "UNPAID",
  status: "AWAITING_PAYMENT",
  chapaMerchantReference: "server-reference-1",
  chapaCheckoutUrl: "https://checkout.example",
  total: 100,
  subtotal: 80,
  deliveryFee: 10,
  serviceFee: 10,
  driverId: null,
  ...overrides,
});

async function seed() {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "user/customer-1"), { role: "customer" }),
      setDoc(doc(db, "user/customer-2"), { role: "customer" }),
      setDoc(doc(db, "user/staff-1"), { role: "admin" }),
      setDoc(doc(db, "user/driver-1"), { role: "driver" }),
      setDoc(doc(db, "orders/chapa-customer-1"), order()),
      setDoc(doc(db, "orders/chapa-customer-2"), order({ userId: "customer-2" })),
      setDoc(doc(db, "orders/chapa-driver-1"), order({ userId: "customer-2", driverId: "driver-1", status: "DRIVERPICKEDUP" })),
      setDoc(doc(db, "orders/cod-driver-1"), order({ userId: "customer-2", paymentMethod: "COD", paymentStatus: "PENDING", driverId: "driver-1", status: "DRIVERPICKEDUP" })),
    ]);
  });
}

before(async () => {
  const rules = fs.readFileSync(rulesPath, "utf8");
  console.log(`Loading rules for emulator from ${rulesPath}`);
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { host: "127.0.0.1", port: 8080, rules },
  });
  adminApp = initializeApp({ projectId }, "chapa-rules-admin-test");
  adminDb = getAdminFirestore(adminApp);
});
beforeEach(seed);
after(async () => { await testEnv?.cleanup(); if (adminApp) await deleteApp(adminApp); });

test("customer cannot change own Chapa order to PAID", async () => {
  const db = clientDb("customer-1");
  await assertPermissionDenied(() => updateDoc(doc(db, "orders/chapa-customer-1"), { paymentStatus: "PAID" }));
});

test("customer cannot write paymentVerifiedBy", async () => {
  const db = clientDb("customer-1");
  await assertPermissionDenied(() => updateDoc(doc(db, "orders/chapa-customer-1"), { paymentVerifiedBy: "server" }));
});

test("customer cannot write chapaVerifiedAmount", async () => {
  const db = clientDb("customer-1");
  await assertPermissionDenied(() => updateDoc(doc(db, "orders/chapa-customer-1"), { chapaVerifiedAmount: 100 }));
});

test("customer cannot alter Chapa transaction or verification fields", async () => {
  const db = clientDb("customer-1");
  const ref = doc(db, "orders/chapa-customer-1");
  for (const update of [
    { chapaMerchantReference: "forged-reference" },
    { chapaCheckoutUrl: "https://forged.example" },
    { paidAt: serverTimestamp() },
    { paymentVerifiedBy: "customer" },
    { chapaVerifiedAmount: 1000 },
  ]) await assertPermissionDenied(() => updateDoc(ref, update));
});

test("customer cannot modify another customer's order", async () => {
  const db = clientDb("customer-1");
  await assertPermissionDenied(() => updateDoc(doc(db, "orders/chapa-customer-2"), {
    status: "CANCELLED", cancelledBy: "CUSTOMER", updatedAt: serverTimestamp(),
  }));
});

test("customer can cancel own unpaid awaiting-payment order", async () => {
  const db = clientDb("customer-1");
  await assertSucceeds(updateDoc(doc(db, "orders/chapa-customer-1"), {
    status: "CANCELLED", cancelledBy: "CUSTOMER", updatedAt: serverTimestamp(),
  }));
});

test("customer can create an allowed unpaid Chapa draft", async () => {
  const db = clientDb("customer-1");
  await assertSucceeds(setDoc(doc(db, "orders/chapa-draft"), {
    userId: "customer-1", paymentMethod: "CHAPA", paymentStatus: "UNPAID",
    status: "AWAITING_PAYMENT", driverId: null, total: 20, subtotal: 0,
    deliveryFee: 10, serviceFee: 10,
  }));
});

test("staff cannot mark a Chapa order paid", async () => {
  const db = clientDb("staff-1");
  await assertPermissionDenied(() => updateDoc(doc(db, "orders/chapa-customer-1"), {
    paymentStatus: "PAID", paidAt: serverTimestamp(), chapaVerifiedAmount: 100,
  }));
});

test("driver cannot mark a Chapa order paid while completing it", async () => {
  const db = clientDb("driver-1");
  await assertPermissionDenied(() => updateDoc(doc(db, "orders/chapa-driver-1"), {
    status: "COMPLETE", paymentStatus: "PAID", paidAt: serverTimestamp(),
  }));
});

test("driver can mark a COD order paid when completing delivery", async () => {
  const db = clientDb("driver-1");
  await assertSucceeds(updateDoc(doc(db, "orders/cod-driver-1"), {
    status: "COMPLETE", paymentStatus: "PAID", cashCollected: true,
    cashCollectedAmount: 100, paidAt: serverTimestamp(),
  }));
});

test("trusted Firebase Admin SDK write bypasses client rules", async () => {
  await adminDb.collection("orders").doc("chapa-customer-1").update({
    paymentStatus: "PAID", paymentVerifiedBy: "firebase-function", chapaVerifiedAmount: 100,
  });
  const updated = await adminDb.collection("orders").doc("chapa-customer-1").get();
  assert.equal(updated.data().paymentStatus, "PAID");
});
