import { isWithinEthiopia } from "../../utils/coordinates";
import { createRouteResult } from "../../features/location/locationModels";
import { fetchJsonWithTimeout, requestMapboxDirections } from "./mapProviderClient";

const OSRM_ROUTE_URL = "https://router.project-osrm.org/route/v1/driving";
const ROUTE_CACHE_LIMIT = 60;
const ROUTE_CACHE_TTL_MS = { mapbox: 60_000, osrm: 5 * 60_000, unavailable: 15_000 };
const OSRM_TIMEOUT_MS = 5000;

/** Great-circle distance; only an approximate distance, never a road ETA. */
export function straightLineKm(lat1, lon1, lat2, lon2) {
  const values = [lat1, lon1, lat2, lon2].map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  const [a1, o1, a2, o2] = values;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const haversine = Math.sin(toRad(a2 - a1) / 2) ** 2 +
    Math.cos(toRad(a1)) * Math.cos(toRad(a2)) * Math.sin(toRad(o2 - o1) / 2) ** 2;
  return Number((6371 * 2 * Math.asin(Math.sqrt(haversine))).toFixed(1));
}

export function isValidRoutePoint(value) {
  return typeof value?.latitude === "number" && Number.isFinite(value.latitude) &&
    typeof value?.longitude === "number" && Number.isFinite(value.longitude) &&
    isWithinEthiopia(value.latitude, value.longitude);
}

/** Decode a standard encoded polyline to the app's { latitude, longitude } shape. */
export function decodePolyline(encoded) {
  if (typeof encoded !== "string" || encoded.length < 4 || encoded.length > 100000) return [];
  const points = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  const readValue = () => {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      if (index >= encoded.length || shift > 30) throw new Error("Malformed route geometry.");
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new Error("Malformed route geometry.");
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  try {
    while (index < encoded.length) {
      latitude += readValue();
      longitude += readValue();
      const point = { latitude: latitude / 1e5, longitude: longitude / 1e5 };
      if (!isValidRoutePoint(point)) return [];
      points.push(point);
    }
  } catch (_) {
    return [];
  }
  return points.length > 1 ? points : [];
}

function distanceMeters(a, b) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

function validRoadPoints(points, origin, destination) {
  return Array.isArray(points) && points.length >= 2 && points.length <= 20000 &&
    points.every(isValidRoutePoint) && distanceMeters(points[0], origin) <= 2500 &&
    distanceMeters(points[points.length - 1], destination) <= 2500;
}

/**
 * Factory provides deterministic provider injection for tests while keeping
 * the production implementation and bounded caches private to each instance.
 */
export function createRoutingService({
  mapboxDirections = (origin, destination, fetchJson) => requestMapboxDirections(origin, destination, fetchJson),
  fetchJson = fetchJsonWithTimeout,
  now = Date.now,
} = {}) {
  const routeCache = new Map();
  const requestsInFlight = new Map();

  function setCachedRoute(key, value, ttlMs) {
    if (routeCache.size >= ROUTE_CACHE_LIMIT && !routeCache.has(key)) {
      routeCache.delete(routeCache.keys().next().value);
    }
    routeCache.delete(key);
    routeCache.set(key, { value, expiresAt: now() + ttlMs });
  }

  function readCachedRoute(key) {
    const cached = routeCache.get(key);
    if (!cached) return { found: false };
    if (cached.expiresAt <= now()) {
      routeCache.delete(key);
      return { found: false };
    }
    routeCache.delete(key);
    routeCache.set(key, cached);
    return { found: true, value: cached.value };
  }

  async function requestRoadRoute(origin, destination) {
    let mapboxResponse = null;
    try {
      mapboxResponse = await mapboxDirections(origin, destination, fetchJson);
    } catch (_) {}
    const mapboxRoute = mapboxResponse?.code === "Ok" ? mapboxResponse.routes?.[0] : null;
    if (mapboxRoute) {
      const durationSeconds = Number(mapboxRoute.duration);
      const distance = Number(mapboxRoute.distance);
      const coordinates = mapboxRoute.geometry?.coordinates;
      const points = Array.isArray(coordinates)
        ? coordinates.map((point) => ({ latitude: Number(point?.[1]), longitude: Number(point?.[0]) }))
        : [];
      if (Number.isFinite(distance) && distance > 0 && distance <= 3000000 && durationSeconds &&
          validRoadPoints(points, origin, destination)) {
        // The traffic profile falls back to ordinary driving where traffic
        // coverage is unavailable; report this as a provider estimate.
        return createRouteResult({ provider: "mapbox", distanceMeters: distance, durationSeconds, geometry: points, etaBasis: "provider-estimate" });
      }
    }

    const url = `${OSRM_ROUTE_URL}/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}?overview=full&geometries=geojson&steps=false`;
    const data = await fetchJson(url, OSRM_TIMEOUT_MS);
    const route = data?.code === "Ok" ? data.routes?.[0] : null;
    const distance = Number(route?.distance);
    const durationSeconds = Number(route?.duration);
    const coordinates = route?.geometry?.coordinates;
    if (!Number.isFinite(distance) || distance <= 0 || distance > 3000000 ||
        !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 7 * 24 * 60 * 60 ||
        !Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > 20000) return null;
    const points = coordinates.map((point) => ({ latitude: Number(point?.[1]), longitude: Number(point?.[0]) }));
    if (!validRoadPoints(points, origin, destination)) return null;
    return createRouteResult({ provider: "osrm", distanceMeters: distance, durationSeconds, geometry: points, etaBasis: "provider-estimate" });
  }

  async function getRoute(from, to) {
    if (!isValidRoutePoint(from) || !isValidRoutePoint(to)) return null;
    const origin = { latitude: from.latitude, longitude: from.longitude };
    const destination = { latitude: to.latitude, longitude: to.longitude };
    if (distanceMeters(origin, destination) < 3) return null;

    const key = [origin.latitude, origin.longitude, destination.latitude, destination.longitude]
      .map((coordinate) => coordinate.toFixed(5)).join(",");
    const cached = readCachedRoute(key);
    if (cached.found) return cached.value;
    if (requestsInFlight.has(key)) return requestsInFlight.get(key);

    const request = (async () => {
      try {
        const route = await requestRoadRoute(origin, destination);
        setCachedRoute(key, route, route ? ROUTE_CACHE_TTL_MS[route.source] : ROUTE_CACHE_TTL_MS.unavailable);
        return route;
      } catch (_) {
        setCachedRoute(key, null, ROUTE_CACHE_TTL_MS.unavailable);
        return null;
      } finally {
        requestsInFlight.delete(key);
      }
    })();
    requestsInFlight.set(key, request);
    return request;
  }

  return { getRoute };
}

export function getStraightLineRouteEstimate(from, to) {
  if (!isValidRoutePoint(from) || !isValidRoutePoint(to)) return null;
  return createRouteResult({
    fallbackType: "straight-line",
    distanceKm: straightLineKm(from.latitude, from.longitude, to.latitude, to.longitude),
    geometry: [
      { latitude: from.latitude, longitude: from.longitude },
      { latitude: to.latitude, longitude: to.longitude },
    ],
  });
}

export const { getRoute } = createRoutingService();
