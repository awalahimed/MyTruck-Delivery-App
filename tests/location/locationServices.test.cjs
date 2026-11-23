const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadBabelModule } = require("../maps/moduleLoader.cjs");

const root = path.resolve(__dirname, "../..");
const repositoryPath = path.join(root, "services/location/locationRepository.js");
const trackingPath = path.join(root, "services/location/trackingService.js");
const facadePath = path.join(root, "services/locationService.js");
const repositoryImport = path.resolve(root, "services/location/locationRepository.js");
const databaseImport = path.resolve(root, "firebase.js");
const validFix = { latitude: 9, longitude: 38.7, accuracy: 8, heading: 90, speed: 4 };

function loadRepository({ storage, calls, updateDoc } = {}) {
  const fakeStorage = storage || { getItem: async () => null, setItem: async () => {} };
  const records = calls || [];
  const firestore = {
    doc: (_db, collection, id) => ({ path: `${collection}/${id}` }),
    serverTimestamp: () => "server-timestamp",
    setDoc: async (...args) => records.push(["setDoc", ...args]),
    updateDoc: updateDoc || (async (...args) => records.push(["updateDoc", ...args])),
  };
  const module = loadBabelModule(repositoryPath, {
    "@react-native-async-storage/async-storage": { __esModule: true, default: fakeStorage },
    "firebase/firestore": firestore,
    [databaseImport]: { db: "mock-db" },
  });
  return { repository: module.createLocationRepository({ storage: fakeStorage, firestore, firestoreDb: "mock-db" }), calls: records };
}

function loadTracking({ repository, locationApi, timers, now = () => 100000, logger = { warn() {} } } = {}) {
  const fallbackRepository = repository || {
    getCachedCustomerLocation: async () => null,
    cacheCustomerLocation: async () => true,
    syncCustomerLocationToProfile: async () => true,
    syncDriverLocation: async () => true,
  };
  const api = locationApi || {
    Accuracy: { Balanced: "balanced", High: "high" },
    hasServicesEnabledAsync: async () => true,
    getForegroundPermissionsAsync: async () => ({ status: "granted" }),
    requestForegroundPermissionsAsync: async () => ({ status: "granted" }),
    getLastKnownPositionAsync: async () => null,
    getCurrentPositionAsync: async () => ({ coords: validFix }),
    watchPositionAsync: async () => ({ remove() {} }),
  };
  const pendingTimers = timers || [];
  const module = loadBabelModule(trackingPath, {
    "expo-location": api,
    [repositoryImport]: { __esModule: true, default: fallbackRepository },
  });
  return module.createTrackingService({
    repository: fallbackRepository,
    locationApi: api,
    now,
    schedule: (callback, ms) => {
      const timer = { callback, ms, cancelled: false };
      pendingTimers.push(timer);
      return timer;
    },
    cancel: (timer) => { if (timer) timer.cancelled = true; },
    logger,
  });
}

const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

test("customer coordinates cache and profile writes preserve legacy paths and fields", async () => {
  const stored = new Map();
  const storage = {
    getItem: async (key) => stored.get(key) || null,
    setItem: async (key, value) => stored.set(key, value),
  };
  const { repository, calls } = loadRepository({ storage });
  assert.equal(await repository.cacheCustomerLocation(validFix), true);
  assert.deepEqual(await repository.getCachedCustomerLocation(), { latitude: 9, longitude: 38.7 });
  await repository.syncCustomerLocationToProfile("customer-1", validFix, "Bole Road");
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1].path, "user/customer-1");
  assert.equal(calls[1][1].path, "users/customer-1");
  for (const [, reference, payload, options] of calls) {
    assert.deepEqual(Object.keys(payload).sort(), ["address", "latitude", "lastLocationUpdate", "longitude", "updatedAt"].sort());
    assert.equal(payload.address, "Bole Road");
    assert.deepEqual(options, { merge: true });
    assert.ok(reference.path.startsWith("user"));
  }
});

test("driver profile and active order writes keep their established fields", async () => {
  const { repository, calls } = loadRepository();
  await repository.syncDriverLocation({ userId: "driver-1", orderId: "order-1", coords: validFix, heading: 90, speed: 4 });
  assert.equal(calls.length, 2);
  const profileFields = calls[0][2];
  assert.equal(calls[0][1].path, "user/driver-1");
  assert.deepEqual(Object.keys(profileFields).sort(), ["driverLat", "driverLng", "driverLocationUpdatedAt"].sort());
  const orderFields = calls[1][2];
  assert.equal(calls[1][1].path, "orders/order-1");
  assert.deepEqual(Object.keys(orderFields).sort(), ["driverLat", "driverLng", "driverHeading", "driverSpeed", "driverLocationUpdatedAt"].sort());
});

test("customer watcher caches valid updates without writing driver or order data", async () => {
  let onFix;
  const cached = [];
  const syncCalls = [];
  const locationApi = {
    Accuracy: { Balanced: "balanced", High: "high" },
    getForegroundPermissionsAsync: async () => ({ status: "granted" }),
    watchPositionAsync: async (_options, callback) => { onFix = callback; return { remove() {} }; },
  };
  const repository = {
    getCachedCustomerLocation: async () => null,
    cacheCustomerLocation: async (coords) => { cached.push(coords); },
    syncCustomerLocationToProfile: async (...args) => syncCalls.push(args),
    syncDriverLocation: async (...args) => syncCalls.push(args),
  };
  const service = loadTracking({ repository, locationApi });
  await service.startContinuousTracking(() => {}, { userId: "customer-1" });
  onFix({ coords: { ...validFix, accuracy: 151 } });
  await flushAsync();
  assert.deepEqual(cached, []);
  onFix({ coords: validFix });
  await flushAsync();
  assert.deepEqual(cached, [{ latitude: 9, longitude: 38.7 }]);
  assert.equal(syncCalls.length, 0);
});

test("detectCurrentLocation persists a fresh valid customer GPS fix", async () => {
  const cached = [];
  const repository = {
    getCachedCustomerLocation: async () => null,
    cacheCustomerLocation: async (coords) => { cached.push(coords); },
  };
  const locationApi = {
    Accuracy: { Balanced: "balanced", High: "high" },
    hasServicesEnabledAsync: async () => true,
    requestForegroundPermissionsAsync: async () => ({ status: "granted" }),
    getLastKnownPositionAsync: async () => null,
    getCurrentPositionAsync: async () => ({ coords: validFix }),
  };
  const service = loadTracking({ repository, locationApi });
  const result = await service.detectCurrentLocation();
  assert.equal(result.status, "granted");
  assert.deepEqual(result.coords, { latitude: 9, longitude: 38.7 });
  assert.deepEqual(cached, [result.coords]);
});

test("inaccurate fresh GPS returns the cached location as stale without replacing the cache", async () => {
  const cacheWrites = [];
  const previous = { latitude: 9.02, longitude: 38.72 };
  const repository = {
    getCachedCustomerLocation: async () => previous,
    cacheCustomerLocation: async (coords) => { cacheWrites.push(coords); },
  };
  const locationApi = {
    Accuracy: { Balanced: "balanced", High: "high" },
    hasServicesEnabledAsync: async () => true,
    requestForegroundPermissionsAsync: async () => ({ status: "granted" }),
    getLastKnownPositionAsync: async () => null,
    getCurrentPositionAsync: async () => ({ coords: { ...validFix, accuracy: 600 } }),
  };
  const result = await loadTracking({ repository, locationApi }).detectCurrentLocation();
  assert.equal(result.status, "stale");
  assert.deepEqual(result.coords, previous);
  assert.match(result.error, /sufficiently accurate/);
  assert.deepEqual(cacheWrites, []);
});

test("customer profile synchronization preserves movement and heartbeat throttling", async () => {
  let writes = 0;
  let currentTime = 100000;
  const repository = {
    syncCustomerLocationToProfile: async () => { writes += 1; },
  };
  const service = loadTracking({ repository, now: () => currentTime });
  await service.syncLocationToProfile("customer-1", validFix, "Bole Road");
  await service.syncLocationToProfile("customer-1", { latitude: 9.0001, longitude: 38.7001 }, "Bole Road");
  assert.equal(writes, 1);
  currentTime += 61000;
  await service.syncLocationToProfile("customer-1", { latitude: 9.0001, longitude: 38.7001 }, "Bole Road");
  assert.equal(writes, 2);
});

test("failed Firebase driver writes retry and recover", async () => {
  let attempts = 0;
  let onFix;
  const timers = [];
  const statuses = [];
  const repository = {
    syncDriverLocation: async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error("offline"), { code: "unavailable" });
    },
  };
  const locationApi = {
    Accuracy: { Balanced: "balanced", High: "high" },
    hasServicesEnabledAsync: async () => true,
    getForegroundPermissionsAsync: async () => ({ status: "granted" }),
    watchPositionAsync: async (_options, callback) => { onFix = callback; return { remove() {} }; },
  };
  const service = loadTracking({ repository, locationApi, timers, onStatus: (s) => statuses.push(s) });
  await service.startDriverTracking(() => {}, { userId: "driver-1", orderId: "order-1", onStatus: (s) => statuses.push(s) });
  onFix({ coords: validFix });
  await flushAsync();
  assert.ok(statuses.includes("connection-delayed"));
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 12000);
  timers[0].callback();
  await flushAsync();
  await flushAsync();
  assert.equal(attempts, 2);
  assert.ok(statuses.includes("live"));
});

test("duplicate driver watcher is removed and stale callback cannot write after account switch", async () => {
  const callbacks = [];
  let removed = 0;
  const writes = [];
  const locationApi = {
    Accuracy: { Balanced: "balanced", High: "high" },
    hasServicesEnabledAsync: async () => true,
    getForegroundPermissionsAsync: async () => ({ status: "granted" }),
    watchPositionAsync: async (_options, callback) => {
      callbacks.push(callback);
      return { remove: () => { removed += 1; } };
    },
  };
  const repository = { syncDriverLocation: async (payload) => writes.push(payload.userId) };
  const service = loadTracking({ repository, locationApi });
  await service.startDriverTracking(() => {}, { userId: "driver-old" });
  const oldCallback = callbacks[0];
  await service.startDriverTracking(() => {}, { userId: "driver-new" });
  assert.equal(removed, 1);
  oldCallback({ coords: validFix });
  callbacks[1]({ coords: validFix });
  await flushAsync();
  assert.deepEqual(writes, ["driver-new"]);
  service.stopDriverTracking();
  assert.equal(removed, 2);
  callbacks[1]({ coords: { latitude: 9.1, longitude: 38.8, accuracy: 5 } });
  await flushAsync();
  assert.deepEqual(writes, ["driver-new"]);
});

test("legacy locationService default and named imports still expose the service API", () => {
  const tracking = {
    getCachedLocation() {}, detectCurrentLocation() {}, startContinuousTracking() {}, stopContinuousTracking() {},
    startDriverTracking() {}, stopDriverTracking() {}, syncLocationToProfile() {},
  };
  const facade = loadBabelModule(facadePath, {
    [path.resolve(root, "services/location/trackingService.js")]: { __esModule: true, default: tracking },
  });
  assert.equal(facade.locationService, tracking);
  assert.equal(facade.default, tracking);
  for (const method of Object.keys(tracking)) assert.equal(typeof facade.default[method], "function");
});

