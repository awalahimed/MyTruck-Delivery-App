const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadBabelModule } = require("./moduleLoader.cjs");

const root = path.resolve(__dirname, "../..");
const routingPath = path.join(root, "services/maps/routingService.js");
const geocodingPath = path.join(root, "services/maps/geocodingService.js");
const providerPath = path.join(root, "services/maps/mapProviderClient.js");
const mapFacadePath = path.join(root, "utils/mapService.js");
const origin = { latitude: 9, longitude: 38.7 };
const destination = { latitude: 9.01, longitude: 38.71 };

function encodeValue(value) {
  let encoded = value < 0 ? ~(value << 1) : value << 1;
  let result = "";
  while (encoded >= 0x20) {
    result += String.fromCharCode((0x20 | (encoded & 0x1f)) + 63);
    encoded >>= 5;
  }
  return result + String.fromCharCode(encoded + 63);
}

function encodePolyline(points) {
  let previousLatitude = 0;
  let previousLongitude = 0;
  return points.map((point) => {
    const latitude = Math.round(point.latitude * 1e5);
    const longitude = Math.round(point.longitude * 1e5);
    const encoded = encodeValue(latitude - previousLatitude) + encodeValue(longitude - previousLongitude);
    previousLatitude = latitude;
    previousLongitude = longitude;
    return encoded;
  }).join("");
}

function loadRouting(dependencies = {}) {
  return loadBabelModule(routingPath, {
    [path.resolve(root, "services/maps/mapProviderClient.js")]: {
      requestMapboxDirections: async () => null,
      fetchJsonWithTimeout: async () => null,
    },
  }).createRoutingService(dependencies);
}

function loadGeocoding(dependencies = {}) {
  return loadBabelModule(geocodingPath, {
    [path.resolve(root, "services/maps/mapProviderClient.js")]: {
      requestMapboxGeocoding: async () => null,
      fetchJsonWithTimeout: async () => null,
      reverseGeocodeOnDevice: async () => [],
    },
  }).createGeocodingService(dependencies);
}

test("returns validated Mapbox road geometry, distance, and provider ETA", async () => {
  const service = loadRouting({
    mapboxDirections: async () => ({ code: "Ok", routes: [{ distance: 1800, duration: 301, geometry: { coordinates: [[38.7, 9], [38.71, 9.01]] } }] }),
    fetchJson: async () => assert.fail("OSRM should not run when Mapbox returns a valid route"),
  });

  const route = await service.getRoute(origin, destination);
  assert.equal(route.source, "mapbox");
  assert.equal(route.distanceKm, 1.8);
  assert.equal(route.etaMinutes, 6);
  assert.equal(route.etaBasis, "provider-estimate");
  assert.equal(route.points.length, 2);
});

test("uses OSRM when Mapbox routing is unavailable", async () => {
  const service = loadRouting({
    mapboxDirections: async () => null,
    fetchJson: async (url, timeout) => {
      assert.match(url, /^https:\/\/router\.project-osrm\.org\//);
      assert.equal(timeout, 5000);
      return {
        code: "Ok",
        routes: [{ distance: 2100, duration: 240, geometry: { coordinates: [[38.7, 9], [38.71, 9.01]] } }],
      };
    },
  });
  const route = await service.getRoute(origin, destination);
  assert.equal(route.source, "osrm");
  assert.equal(route.distanceKm, 2.1);
  assert.equal(route.etaMinutes, 4);
});

test("straight-line fallback has no road ETA", async () => {
  const { getStraightLineRouteEstimate } = loadBabelModule(routingPath, {
    [path.resolve(root, "services/maps/mapProviderClient.js")]: {
      requestMapboxDirections: async () => null,
      fetchJsonWithTimeout: async () => null,
    },
  });
  const route = await loadRouting({ mapboxDirections: async () => null, fetchJson: async () => null })
    .getRoute(origin, destination);
  const estimate = getStraightLineRouteEstimate(origin, destination);
  assert.equal(route, null);
  assert.equal(estimate.source, "straight");
  assert.ok(estimate.distanceKm > 0);
  assert.equal(estimate.etaMinutes, null);
});

test("rejects invalid coordinates without provider calls", async () => {
  let calls = 0;
  const service = loadRouting({
    mapboxDirections: async () => { calls += 1; return null; },
    fetchJson: async () => { calls += 1; return null; },
  });
  assert.equal(await service.getRoute({ latitude: 30, longitude: 40 }, destination), null);
  assert.equal(calls, 0);
});

test("Mapbox reverse-geocoding failure falls back to device geocoding", async () => {
  let deviceCalls = 0;
  const service = loadGeocoding({
    mapboxGeocode: async () => { throw new Error("Mapbox unavailable"); },
    deviceReverseGeocode: async (point) => {
      deviceCalls += 1;
      assert.deepEqual(point, origin);
      return [{ street: "Bole Road", city: "Addis Ababa", region: "Addis Ababa" }];
    },
  });
  assert.equal(await service.reverseGeocodeLocation(origin.latitude, origin.longitude), "Bole Road, Addis Ababa");
  assert.equal(deviceCalls, 1);
});

test("device geocoding failure returns a non-invented generic address", async () => {
  const service = loadGeocoding({
    mapboxGeocode: async () => null,
    deviceReverseGeocode: async () => { throw new Error("device geocoder unavailable"); },
  });
  assert.equal(await service.reverseGeocodeLocation(origin.latitude, origin.longitude), "Selected location, Ethiopia");
});

test("place search falls back to Photon and retains local results", async () => {
  const service = loadGeocoding({
    mapboxGeocode: async () => null,
    now: () => 2000,
    sleep: async () => {},
    fetchJson: async (url, timeout) => {
      assert.match(url, /photon\.komoot\.io/);
      assert.equal(timeout, 5000);
      return {
        features: [{
          geometry: { coordinates: [38.72, 9.02] },
          properties: { osm_id: 15, name: "Test Place", city: "Addis Ababa" },
        }],
      };
    },
  });
  const places = await service.searchPlaces("Bole");
  assert.ok(places.some((place) => place.id === "local-bole"));
  assert.ok(places.some((place) => place.id.startsWith("photon-15-")));
});

test("OSRM timeout produces no road route and straight fallback omits ETA", async () => {
  const service = loadRouting({
    mapboxDirections: async () => null,
    fetchJson: async (_url, timeout) => {
      assert.equal(timeout, 5000);
      throw new Error("AbortError: request timed out");
    },
  });
  assert.equal(await service.getRoute(origin, destination), null);
});

test("concurrent route requests share the same provider request", async () => {
  let mapboxCalls = 0;
  let resolveMapbox;
  const service = loadRouting({
    mapboxDirections: () => {
      mapboxCalls += 1;
      return new Promise((resolve) => { resolveMapbox = resolve; });
    },
    fetchJson: async () => null,
  });

  const first = service.getRoute(origin, destination);
  const second = service.getRoute(origin, destination);
  assert.equal(mapboxCalls, 1);
  resolveMapbox(null);
  assert.deepEqual(await first, null);
  assert.deepEqual(await second, null);
});

test("map provider fetch aborts after its timeout", async () => {
  const { fetchJsonWithTimeout } = loadBabelModule(providerPath, {
    "expo-location": { reverseGeocodeAsync: async () => [] },
  });
  const originalFetch = global.fetch;
  let aborted = false;
  global.fetch = (_url, { signal }) => new Promise((resolve) => {
    signal.addEventListener("abort", () => {
      aborted = true;
      resolve({ ok: false });
    }, { once: true });
  });
  try {
    assert.equal(await fetchJsonWithTimeout("https://example.invalid/route", 10), null);
    assert.equal(aborted, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("legacy mapService facade preserves its existing public exports", () => {
  const facade = loadBabelModule(mapFacadePath, {
    "expo-location": { reverseGeocodeAsync: async () => [] },
    [path.resolve(root, "services/maps/mapProviderClient.js")]: {
      requestMapboxDirections: async () => null,
      requestMapboxGeocoding: async () => null,
      fetchJsonWithTimeout: async () => null,
      reverseGeocodeOnDevice: async () => [],
    },
  });
  for (const name of [
    "DEFAULT_COORDS",
    "ADDIS_DELIVERY_ZONES",
    "isWithinEthiopia",
    "getRealGpsLocation",
    "requestGpsLocation",
    "reverseGeocodeLocation",
    "searchLocalPlaces",
    "searchPlaces",
    "getRoute",
    "straightLineKm",
    "decodePolyline",
    "isValidRoutePoint",
  ]) {
    assert.ok(facade[name], `expected compatibility export ${name}`);
  }
});

