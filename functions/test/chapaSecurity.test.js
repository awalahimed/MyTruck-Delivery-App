const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const records = new Map();
const calls = [];
let chapaResponse;

class TestHttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function recordKey(collection, id) { return `${collection}/${id}`; }
function docRef(collection, id) {
  return {
    id,
    path: recordKey(collection, id),
    async get() {
      const row = records.get(this.path);
      return { id, exists: Boolean(row), data: () => row?.data, ref: this };
    },
    async update(data) {
      const row = records.get(this.path);
      if (!row) throw new Error(`Missing document ${this.path}`);
      Object.assign(row.data, data);
    },
    async set(data, options = {}) {
      const row = records.get(this.path);
      if (row && options.merge) Object.assign(row.data, data);
      else records.set(this.path, { data: { ...data } });
    },
    async create(data) {
      if (records.has(this.path)) throw new Error(`Already exists ${this.path}`);
      records.set(this.path, { data: { ...data } });
    },
  };
}

const db = {
  collection(name) {
    return {
      doc(id) { return docRef(name, id || `auto-${Date.now()}-${Math.random()}`); },
      where(field, operator, value) {
        let filters = [[field, operator, value]];
        const query = {
          where(nextField, nextOperator, nextValue) { filters = [...filters, [nextField, nextOperator, nextValue]]; return query; },
          limit() { return query; },
          async get() {
            const docs = [];
            for (const [key, row] of records) {
              if (!key.startsWith(`${name}/`)) continue;
              if (filters.every(([f, op, expected]) => op === "==" && row.data[f] === expected)) {
                const id = key.slice(name.length + 1);
                docs.push({ id, data: () => row.data, ref: docRef(name, id) });
              }
            }
            return { docs, empty: docs.length === 0, size: docs.length };
          },
        };
        filters = [[field, operator, value]];
        return query;
      },
    };
  },
  batch() {
    const writes = [];
    const batch = {
      create(ref, data) { writes.push(() => ref.create(data)); return batch; },
      set(ref, data, options) { writes.push(() => ref.set(data, options)); return batch; },
      update(ref, data) { writes.push(() => ref.update(data)); return batch; },
      async commit() { for (const write of writes) await write(); },
    };
    return batch;
  },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "firebase-functions/v2/https") return {
    onCall: (...args) => args[args.length - 1], HttpsError: TestHttpsError,
  };
  if (request === "firebase-functions/v2/firestore") return { onDocumentWritten: () => async () => {} };
  if (request === "firebase-functions/params") return { defineSecret: (name) => ({ value: () => name === "CHAPA_SECRET_KEY" ? "CHASECK_TEST-payment-test-value" : "test" }) };
  if (request === "firebase-admin/app") return { initializeApp() {} };
  if (request === "firebase-admin/firestore") return {
    getFirestore: () => db,
    FieldValue: { serverTimestamp: () => "server-time" },
    Timestamp: { now: () => ({ toMillis: () => Date.now() }) },
  };
  if (request === "firebase-admin/auth") return { getAuth: () => ({}) };
  return originalLoad.call(this, request, parent, isMain);
};

global.fetch = async (_url, options = {}) => {
  calls.push(JSON.parse(options.body || "{}"));
  return { json: async () => chapaResponse };
};

const functions = require("../index.js");
Module._load = originalLoad;

function put(collection, id, data) { records.set(recordKey(collection, id), { data: { ...data } }); }
function paymentAndOrder(id = "order-a", txRef = "tx-a", overrides = {}) {
  put("orders", id, {
    userId: "customer-a", orderType: "PACKAGE", paymentMethod: "CHAPA", paymentStatus: "UNPAID",
    status: "AWAITING_PAYMENT", total: 100, currency: "ETB", chapaMerchantReference: txRef,
    ...overrides,
  });
  put("chapaPaymentVerifications", txRef, { uid: "customer-a", orderIds: [id], amount: 100, currency: "ETB", status: "PENDING" });
}

beforeEach(() => {
  records.clear();
  calls.length = 0;
  chapaResponse = { status: "success", data: { status: "SUCCESS", tx_ref: "tx-a", amount: "100", currency: "ETB" } };
});

test("customer rules do not expose a direct PAID update path", () => {
  const rules = fs.readFileSync(path.resolve(__dirname, "../../firestore.rules"), "utf8");
  assert.doesNotMatch(rules, /customerRecordsChapaPayment/);
  const orderRules = rules.split("match /orders/{orderId}")[1].split("match /orderDishes/{lineId}")[0];
  assert.match(orderRules, /allow update: if signedIn\(\)[\s\S]*?staffOrderUpdate\(\)/);
  assert.doesNotMatch(orderRules, /allow update:[\s\S]*?isStaff\(\)\s*\|\|/);
  assert.match(rules, /'paymentStatus', 'paidAt', 'chapaVerifiedAmount', 'paymentVerifiedBy'/);
  assert.match(rules, /function driverCompletes\(\)[\s\S]*?cashOrder && request\.resource\.data\.paymentStatus == 'PAID'/);
});

test("successful Chapa verification marks only the bound order paid", async () => {
  paymentAndOrder();
  const result = await functions.verifyChapaPayment({ auth: { uid: "customer-a" }, data: { orderId: "order-a", tx_ref: "tx-a" } });
  assert.equal(result.verified, true);
  assert.equal(records.get("orders/order-a").data.paymentStatus, "PAID");
});

test("failed Chapa status never marks the order paid", async () => {
  paymentAndOrder();
  chapaResponse.data.status = "FAILED";
  const result = await functions.verifyChapaPayment({ auth: { uid: "customer-a" }, data: { orderId: "order-a", tx_ref: "tx-a" } });
  assert.equal(result.paymentStatus, "FAILED");
  assert.equal(records.get("orders/order-a").data.paymentStatus, "UNPAID");
});

test("cancelled Chapa payment remains unpaid", async () => {
  paymentAndOrder(); chapaResponse.data.status = "CANCELLED";
  const result = await functions.verifyChapaPayment({ auth: { uid: "customer-a" }, data: { orderId: "order-a", tx_ref: "tx-a" } });
  assert.equal(result.paymentStatus, "FAILED");
  assert.equal(records.get("orders/order-a").data.paymentStatus, "UNPAID");
});

test("incorrect amount never marks the order paid", async () => {
  paymentAndOrder(); chapaResponse.data.amount = "99";
  const result = await functions.verifyChapaPayment({ auth: { uid: "customer-a" }, data: { orderId: "order-a", tx_ref: "tx-a" } });
  assert.equal(result.paymentStatus, "AMOUNT_MISMATCH");
  assert.equal(records.get("orders/order-a").data.paymentStatus, "UNPAID");
});

test("incorrect currency never marks the order paid", async () => {
  paymentAndOrder(); chapaResponse.data.currency = "USD";
  const result = await functions.verifyChapaPayment({ auth: { uid: "customer-a" }, data: { orderId: "order-a", tx_ref: "tx-a" } });
  assert.equal(result.paymentStatus, "AMOUNT_MISMATCH");
  assert.equal(records.get("orders/order-a").data.paymentStatus, "UNPAID");
});

test("verification response with a different transaction reference is rejected", async () => {
  paymentAndOrder(); chapaResponse.data.tx_ref = "other-transaction";
  const result = await functions.verifyChapaPayment({ auth: { uid: "customer-a" }, data: { orderId: "order-a", tx_ref: "tx-a" } });
  assert.equal(result.verified, false);
  assert.equal(records.get("orders/order-a").data.paymentStatus, "UNPAID");
});

test("another authenticated user cannot verify the payment", async () => {
  paymentAndOrder();
  await assert.rejects(
    functions.verifyChapaPayment({ auth: { uid: "customer-b" }, data: { orderId: "order-a", tx_ref: "tx-a" } }),
    (error) => error.code === "permission-denied"
  );
});

test("repeated successful verification is idempotent", async () => {
  paymentAndOrder();
  const request = { auth: { uid: "customer-a" }, data: { orderId: "order-a", tx_ref: "tx-a" } };
  assert.equal((await functions.verifyChapaPayment(request)).verified, true);
  assert.equal((await functions.verifyChapaPayment(request)).verified, true);
  assert.equal(records.get("orders/order-a").data.paymentStatus, "PAID");
  assert.equal(calls.length, 2, "each repeat rechecks Chapa rather than trusting the order status");
});

test("delayed Chapa confirmation remains pending and can later succeed", async () => {
  paymentAndOrder(); chapaResponse.data.status = "PENDING";
  const request = { auth: { uid: "customer-a" }, data: { orderId: "order-a", tx_ref: "tx-a" } };
  assert.equal((await functions.verifyChapaPayment(request)).paymentStatus, "PENDING");
  assert.equal(records.get("orders/order-a").data.paymentStatus, "UNPAID");
  chapaResponse.data.status = "SUCCESS";
  assert.equal((await functions.verifyChapaPayment(request)).paymentStatus, "PAID");
});

test("checkout ignores a manipulated client total and prices a package from server config", async () => {
  put("orders", "package-a", {
    userId: "customer-a", orderType: "PACKAGE", paymentMethod: "CHAPA", paymentStatus: "UNPAID", status: "AWAITING_PAYMENT",
    total: 0.01, currency: "ETB", packageType: "Documents / Envelope", recipientName: "Receiver", recipientPhone: "0912345678",
    pickupCoords: { latitude: 8.98, longitude: 38.75 }, dropoffCoords: { latitude: 8.98, longitude: 38.75 },
  });
  chapaResponse = { status: "success", data: { checkout_url: "https://checkout.example" } };
  const result = await functions.createChapaCheckout({ auth: { uid: "customer-a" }, data: { orderIds: ["package-a"], amount: 0.01 } });
  assert.equal(result.amount, 95);
  assert.equal(calls[0].amount, "95.00");
  assert.equal(records.get("orders/package-a").data.total, 95);
});

test("one transaction applies only to the server-bound order set", async () => {
  paymentAndOrder();
  put("orders", "unrelated", { userId: "customer-a", orderType: "PACKAGE", paymentMethod: "CHAPA", paymentStatus: "UNPAID", status: "AWAITING_PAYMENT", total: 100, chapaMerchantReference: "tx-a" });
  const result = await functions.verifyChapaPayment({ auth: { uid: "customer-a" }, data: { orderId: "order-a", tx_ref: "tx-a" } });
  assert.equal(result.verified, true);
  assert.equal(records.get("orders/order-a").data.paymentStatus, "PAID");
  assert.equal(records.get("orders/unrelated").data.paymentStatus, "UNPAID");
});

test("one transaction can pay its complete server-bound multi-order set", async () => {
  paymentAndOrder();
  put("orders", "order-b", {
    userId: "customer-a", orderType: "PACKAGE", paymentMethod: "CHAPA", paymentStatus: "UNPAID",
    status: "AWAITING_PAYMENT", total: 50, currency: "ETB", chapaMerchantReference: "tx-a",
  });
  put("chapaPaymentVerifications", "tx-a", { uid: "customer-a", orderIds: ["order-a", "order-b"], amount: 150, currency: "ETB", status: "PENDING" });
  chapaResponse.data.amount = "150";
  const result = await functions.verifyChapaPayment({ auth: { uid: "customer-a" }, data: { orderId: "order-a", tx_ref: "tx-a" } });
  assert.equal(result.verified, true);
  assert.equal(records.get("orders/order-a").data.paymentStatus, "PAID");
  assert.equal(records.get("orders/order-b").data.paymentStatus, "PAID");
});
