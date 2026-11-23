const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadBabelModule } = require("../maps/moduleLoader.cjs");

const root = path.resolve(__dirname, "../..");
const modelPath = path.join(root, "features/location/locationModels.js");
const models = loadBabelModule(modelPath);

test("coordinate and GPS fix models validate coordinates and normalize accuracy", () => {
  assert.deepEqual(models.createCoordinate({ latitude: "9", longitude: "38.7" }), { latitude: 9, longitude: 38.7 });
  assert.equal(models.createCoordinate({ latitude: NaN, longitude: 38.7 }), null);
  assert.equal(models.createCoordinate({ latitude: 30, longitude: 40 }), null);
  assert.deepEqual(models.createGpsFix({ coords: { latitude: 9, longitude: 38.7, accuracy: 12 }, timestamp: 500 }, { now: () => 900 }), {
    latitude: 9, longitude: 38.7, accuracy: 12, accuracyMeters: 12, capturedAtMs: 500, source: "device",
  });
  assert.equal(models.createGpsFix({ latitude: 9, longitude: 38.7, accuracy: null }, { now: () => 900 }).accuracyMeters, null);
  assert.equal(models.createGpsFix({ latitude: 30, longitude: 40 }), null);
});

test("address and place models accept optional metadata and reject malformed results", () => {
  assert.deepEqual(models.createAddressResult({ address: " Bole Road " }), {
    address: "Bole Road", provider: "unknown", fallback: false,
  });
  assert.equal(models.createAddressResult({ address: "  " }), null);
  const place = models.createPlaceResult({ title: "Bole", latitude: 9, longitude: 38.7 });
  assert.equal(place.title, "Bole");
  assert.equal(place.fullAddress, "Bole");
  assert.equal(place.provider, "unknown");
  assert.equal(models.createPlaceResult({ title: "No coordinate" }), null);
  assert.equal(models.createPlaceResult({ title: "", latitude: 9, longitude: 38.7 }), null);
});

test("route models distinguish road routes from straight-line fallback and omit fallback ETA", () => {
  const geometry = [{ latitude: 9, longitude: 38.7 }, { latitude: 9.01, longitude: 38.71 }];
  const road = models.createRouteResult({ provider: "mapbox", distanceMeters: 1800, durationSeconds: 301, geometry });
  assert.equal(road.routeType, "road");
  assert.equal(road.distanceKm, 1.8);
  assert.equal(road.etaMinutes, 6);
  assert.equal(road.source, "mapbox");
  assert.equal(models.createRouteResult({ provider: "other", distanceMeters: 10, durationSeconds: 10, geometry }), null);
  assert.equal(models.createRouteResult({ provider: "osrm", distanceMeters: 100, durationSeconds: 0, geometry }), null);
  assert.equal(models.createRouteResult({ provider: "mapbox", distanceMeters: 100, durationSeconds: 10, geometry: [{ latitude: 40, longitude: 40 }] }), null);
  const estimate = models.createRouteResult({ fallbackType: "straight-line", distanceKm: 2, geometry, etaMinutes: 99 });
  assert.equal(estimate.routeType, "straight-line");
  assert.equal(estimate.fallbackType, "straight-line");
  assert.equal(estimate.etaMinutes, null);
  assert.equal(estimate.durationSeconds, null);
  assert.equal(models.createRouteResult({ fallbackType: "straight-line", distanceKm: 2, geometry: [] }), null);
});

test("tracking results preserve legacy fields and report stale GPS freshness", () => {
  const detection = models.createLocationDetectionResult({ coords: { latitude: 9, longitude: 38.7 }, status: "stale", error: "old fix" });
  assert.equal(detection.status, "stale");
  assert.equal(detection.freshness, "stale");
  assert.equal(detection.trackingStatus, "connection-delayed");
  assert.deepEqual(detection.coords, { latitude: 9, longitude: 38.7 });
  assert.equal(detection.error, "old fix");
  assert.deepEqual(models.getLocationFreshness(1000, 50000), { freshness: "delayed", updatedAtMs: 1000, ageMs: 49000 });
  assert.equal(models.getLocationFreshness(1000, 130001).freshness, "stale");
  assert.equal(models.getLocationFreshness(null, 2000).freshness, "unknown");
});

test("geocoding provider failures are represented with fallback metadata and legacy address stays a string", async () => {
  const geoPath = path.join(root, "services/maps/geocodingService.js");
  const geocoding = loadBabelModule(geoPath, {
    [path.resolve(root, "services/maps/mapProviderClient.js")]: {
      requestMapboxGeocoding: async () => { throw new Error("Mapbox unavailable"); },
      fetchJsonWithTimeout: async () => null,
      reverseGeocodeOnDevice: async () => [],
    },
  }).createGeocodingService({
    mapboxGeocode: async () => { throw new Error("Mapbox unavailable"); },
    deviceReverseGeocode: async () => [],
    fetchJson: async () => null,
    sleep: async () => {},
    now: () => 2000,
  });
  const result = await geocoding.reverseGeocodeResult(9, 38.7);
  assert.equal(result.address, "Selected location, Ethiopia");
  assert.equal(result.provider, "fallback");
  assert.equal(result.fallback, true);
  assert.equal(await geocoding.reverseGeocodeLocation(9, 38.7), "Selected location, Ethiopia");
  const places = await geocoding.searchPlaces("unknown remote place");
  assert.deepEqual(places, []);
});

test("legacy map and location facades retain imports while model compatibility aliases remain available", () => {
  const facade = loadBabelModule(path.join(root, "utils/mapService.js"), {
    "expo-location": { reverseGeocodeAsync: async () => [] },
    [path.resolve(root, "services/maps/mapProviderClient.js")]: {
      requestMapboxDirections: async () => null, requestMapboxGeocoding: async () => null,
      fetchJsonWithTimeout: async () => null, reverseGeocodeOnDevice: async () => [],
    },
  });
  for (const name of ["DEFAULT_COORDS", "requestGpsLocation", "reverseGeocodeLocation", "reverseGeocodeResult", "getRoute"]) assert.ok(facade[name]);
  const route = models.createRouteResult({ fallbackType: "straight-line", distanceKm: 2, points: [{ latitude: 9, longitude: 38.7 }, { latitude: 9.01, longitude: 38.71 }] });
  assert.equal(route.points, route.geometry);
  assert.equal(route.source, "straight");
  assert.equal(route.distanceKm, 2);
});
