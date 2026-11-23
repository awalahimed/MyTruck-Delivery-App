const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadBabelModule } = require("../maps/moduleLoader.cjs");

const root = path.resolve(__dirname, "../..");
const customerHookPath = path.join(root, "features/location/useCustomerLocation.js");
const driverHookPath = path.join(root, "features/location/useDriverTracking.js");
const trackingModulePath = path.resolve(root, "services/location/trackingService.js");
const mapModulePath = path.resolve(root, "services/maps/geocodingService.js");
const point = { latitude: 9, longitude: 38.7 };

function createHookHost(focused) {
  const slots = [];
  let cursor = 0;
  let pendingEffects = [];
  let hook;
  let output;

  const react = {
    useRef(initialValue) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initialValue };
      return slots[index];
    },
    useState(initialValue) {
      const index = cursor++;
      if (!slots[index] || !Object.prototype.hasOwnProperty.call(slots[index], "value")) {
        slots[index] = { value: typeof initialValue === "function" ? initialValue() : initialValue };
      }
      return [slots[index].value, (value) => {
        slots[index].value = typeof value === "function" ? value(slots[index].value) : value;
      }];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = slots[index];
      const unchanged = previous?.deps && deps && previous.deps.length === deps.length &&
        deps.every((value, depIndex) => Object.is(value, previous.deps[depIndex]));
      if (unchanged) return;
      pendingEffects.push({ index, effect, previous });
      slots[index] = { deps, cleanup: previous?.cleanup };
    },
  };

  return {
    react,
    setHook(value) { hook = value; },
    render(props) {
      cursor = 0;
      pendingEffects = [];
      output = hook(props);
      for (const item of pendingEffects) {
        item.previous?.cleanup?.();
        slots[item.index].cleanup = item.effect();
      }
      return output;
    },
    unmount() {
      for (const slot of slots) slot?.cleanup?.();
    },
    get output() { return output; },
  };
}

function loadHook(pathname, { focused, tracking, reverseGeocode, react } = {}) {
  return loadBabelModule(pathname, {
    react,
    "@react-navigation/native": { useIsFocused: () => focused.value },
    [trackingModulePath]: { __esModule: true, default: tracking },
    [mapModulePath]: { reverseGeocodeLocation: reverseGeocode },
  });
}

function bindHook(pathname, hookName, dependencies) {
  const host = createHookHost(dependencies.focused);
  const module = loadHook(pathname, { ...dependencies, react: host.react });
  host.setHook(module[hookName]);
  return host;
}

const flushAsync = async () => {
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve));
};

test("customer tracking starts on focus, ignores repeated renders, and stops on blur/unmount", async () => {
  const focused = { value: false };
  const starts = [];
  const locations = [];
  let stops = 0;
  let locationCallback;
  const tracking = {
    stopContinuousTracking: () => { stops += 1; },
    detectCurrentLocation: async () => ({ coords: point, status: "cached" }),
    startContinuousTracking: async (callback, options) => { starts.push(options.userId); locationCallback = callback; },
    syncLocationToProfile: async () => {},
  };
  const host = bindHook(customerHookPath, "useCustomerLocation", {
    focused,
    tracking,
    reverseGeocode: async () => "Bole",
  });

  host.render({ userId: "customer-1", onLocationChange: (coords) => locations.push(coords) });
  assert.equal(starts.length, 0);
  focused.value = true;
  const props = { userId: "customer-1", onLocationChange: (coords) => locations.push(coords) };
  host.render(props);
  await flushAsync();
  host.render(props);
  await flushAsync();
  assert.deepEqual(starts, ["customer-1"]);

  focused.value = false;
  host.render(props);
  assert.equal(stops, 3);
  locationCallback(point);
  await flushAsync();
  assert.equal(locations.length, 1); // initial detection only; stale watcher callback ignored

  focused.value = true;
  host.render(props);
  await flushAsync();
  assert.deepEqual(starts, ["customer-1", "customer-1"]);
  host.unmount();
  assert.equal(stops, 4);
});

test("driver tracking follows online and active-delivery status without duplicate renders", () => {
  const focused = { value: true };
  const starts = [];
  const stops = [];
  const tracking = {
    startDriverTracking: (onLocation, options) => starts.push({ onLocation, options }),
    stopDriverTracking: () => stops.push(true),
  };
  const host = bindHook(driverHookPath, "useDriverTracking", { focused, tracking });
  const base = { userId: "driver-1", isOnline: false, activeOrderId: null, initialLocation: point };
  host.render(base);
  assert.equal(starts.length, 0);
  assert.equal(host.output.locationTrackingStatus, "idle");

  host.render({ ...base, isOnline: true });
  assert.equal(starts.length, 1);
  assert.equal(starts[0].options.userId, "driver-1");
  assert.equal(starts[0].options.orderId, null);
  host.render({ ...base, isOnline: true });
  assert.equal(starts.length, 1);

  host.render({ ...base, isOnline: false, activeOrderId: "order-1" });
  assert.equal(starts.length, 2);
  assert.equal(starts[1].options.orderId, "order-1");
  host.render(base);
  assert.equal(starts.length, 2);
  assert.ok(stops.length >= 3);
  host.unmount();
});

test("driver account switch cleans the previous watcher and rejects its stale callback", () => {
  const focused = { value: true };
  const starts = [];
  let stopCount = 0;
  const tracking = {
    startDriverTracking: (onLocation, options) => starts.push({ onLocation, options }),
    stopDriverTracking: () => { stopCount += 1; },
  };
  const host = bindHook(driverHookPath, "useDriverTracking", { focused, tracking });
  host.render({ userId: "driver-old", isOnline: true, initialLocation: point });
  const oldCallback = starts[0].onLocation;
  host.render({ userId: "driver-new", isOnline: true, initialLocation: null });
  assert.equal(starts.length, 2);
  assert.equal(starts[1].options.userId, "driver-new");
  oldCallback({ latitude: 9.2, longitude: 38.8, updatedAt: 1 });
  assert.equal(host.output.driverPos, null);
  starts[1].onLocation({ latitude: 9.1, longitude: 38.75, updatedAt: 2 });
  host.render({ userId: "driver-new", isOnline: true, initialLocation: null });
  assert.deepEqual(host.output.driverPos, { latitude: 9.1, longitude: 38.75 });
  assert.equal(host.output.driverLocationUpdatedAtMs, 2);
  host.unmount();
  assert.ok(stopCount >= 2);
});

