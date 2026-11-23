import { normalizeEthiopiaCoordinate } from "../../utils/coordinates";

export const TRACKING_STATUS = Object.freeze({
  IDLE: "idle",
  REQUESTING_PERMISSION: "requesting-permission",
  WAITING_FOR_GPS: "waiting-for-gps",
  LIVE: "live",
  PERMISSION_DENIED: "permission-denied",
  GPS_DISABLED: "gps-disabled",
  UNAVAILABLE: "unavailable",
  CONNECTION_DELAYED: "connection-delayed",
});

export const LOCATION_FRESHNESS = Object.freeze({
  UNKNOWN: "unknown",
  FRESH: "fresh",
  DELAYED: "delayed",
  STALE: "stale",
});

const knownTrackingStatuses = new Set(Object.values(TRACKING_STATUS));

function timestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number" && Number.isFinite(value.seconds)) return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** Canonical map coordinate: numeric { latitude, longitude } inside the app service area. */
export function createCoordinate(value) {
  return normalizeEthiopiaCoordinate(value);
}

/**
 * GPS fix model. Keeps the legacy flat coordinate and `accuracy` fields while
 * adding explicit units, capture time, and source for new consumers.
 */
export function createGpsFix(position, { source = "device", capturedAtMs, now = Date.now } = {}) {
  const coordinate = createCoordinate(position?.coords || position);
  if (!coordinate) return null;
  const rawAccuracy = position?.coords?.accuracy ?? position?.accuracyMeters ?? position?.accuracy;
  const accuracyMeters = rawAccuracy != null && rawAccuracy !== "" &&
    Number.isFinite(Number(rawAccuracy)) && Number(rawAccuracy) >= 0 ? Number(rawAccuracy) : null;
  const rawTimestamp = capturedAtMs ?? position?.timestampMs ?? position?.timestamp;
  return {
    ...coordinate,
    accuracy: accuracyMeters,
    accuracyMeters,
    capturedAtMs: timestampMs(rawTimestamp) ?? now(),
    source,
  };
}

/** Preserve the current detectCurrentLocation fields and add a standard freshness value. */
export function createLocationDetectionResult({ coords = null, status = "error", error = null } = {}) {
  const coordinate = createCoordinate(coords);
  const safeStatus = typeof status === "string" && status ? status : "error";
  const trackingStatus = safeStatus === "granted" || safeStatus === "cached"
    ? TRACKING_STATUS.LIVE
    : safeStatus === "stale"
    ? TRACKING_STATUS.CONNECTION_DELAYED
    : safeStatus === "denied" || safeStatus === "permission-denied"
    ? TRACKING_STATUS.PERMISSION_DENIED
    : safeStatus === "disabled" || safeStatus === "gps-disabled"
    ? TRACKING_STATUS.GPS_DISABLED
    : normalizeTrackingStatus(safeStatus);
  const freshness = safeStatus === "granted"
    ? LOCATION_FRESHNESS.FRESH
    : safeStatus === "cached"
    ? LOCATION_FRESHNESS.DELAYED
    : safeStatus === "stale"
    ? LOCATION_FRESHNESS.STALE
    : LOCATION_FRESHNESS.UNKNOWN;
  return {
    coords: coordinate,
    status: safeStatus,
    trackingStatus,
    freshness,
    error: typeof error === "string" && error ? error : null,
  };
}

/** Standardized address/geocoding result using the same flat coordinate fields. */
export function createAddressResult({ address, latitude, longitude, coordinate, provider = "unknown", fallback = false } = {}) {
  const coords = createCoordinate(coordinate || { latitude, longitude });
  const normalizedAddress = typeof address === "string" ? address.trim() : "";
  if (!normalizedAddress) return null;
  return {
    address: normalizedAddress,
    ...(coords || {}),
    provider: typeof provider === "string" ? provider : "unknown",
    fallback: fallback === true,
  };
}

/** Search result model with stable fields; existing latitude/longitude consumers remain valid. */
export function createPlaceResult({ id, title, fullAddress, latitude, longitude, coordinate, provider = "unknown" } = {}) {
  const coords = createCoordinate(coordinate || { latitude, longitude });
  if (!coords) return null;
  const normalizedTitle = typeof title === "string" ? title.trim() : "";
  if (!normalizedTitle) return null;
  return {
    id: typeof id === "string" && id ? id : `${provider}-${coords.latitude}-${coords.longitude}`,
    title: normalizedTitle,
    fullAddress: typeof fullAddress === "string" && fullAddress.trim() ? fullAddress.trim() : normalizedTitle,
    ...coords,
    provider: typeof provider === "string" ? provider : "unknown",
  };
}

const ROUTE_PROVIDERS = new Set(["mapbox", "osrm"]);

/**
 * Standard route model with transitional aliases (`source`, `points`,
 * `distanceKm`, `etaMinutes`) for existing map and screen consumers.
 */
export function createRouteResult({
  provider = null,
  routeType,
  fallbackType = null,
  distanceMeters,
  distanceKm,
  durationSeconds,
  etaMinutes,
  geometry,
  points,
  etaBasis = null,
} = {}) {
  if (provider != null && !ROUTE_PROVIDERS.has(provider)) return null;
  const normalizedProvider = ROUTE_PROVIDERS.has(provider) ? provider : null;
  const normalizedGeometry = geometry || points;
  if (!Array.isArray(normalizedGeometry) || normalizedGeometry.length < 2 || normalizedGeometry.length > 20000 ||
      normalizedGeometry.some((point) => !createCoordinate(point))) return null;

  if (normalizedProvider) {
    if ((routeType && routeType !== "road") || fallbackType) return null;
    const meters = Number(distanceMeters ?? (Number(distanceKm) * 1000));
    const seconds = Number(durationSeconds ?? (Number(etaMinutes) * 60));
    if (!Number.isFinite(meters) || meters <= 0 || !Number.isFinite(seconds) || seconds <= 0) return null;
    const kilometers = Number((meters / 1000).toFixed(1));
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    return {
      routeType: "road",
      provider: normalizedProvider,
      fallbackType: null,
      distanceMeters: meters,
      distanceKm: kilometers,
      durationSeconds: seconds,
      etaMinutes: minutes,
      geometry: normalizedGeometry,
      points: normalizedGeometry,
      source: normalizedProvider,
      etaBasis: etaBasis || "provider-estimate",
    };
  }

  if ((routeType && routeType !== "straight-line") || fallbackType !== "straight-line") return null;
  const meters = Number.isFinite(Number(distanceMeters))
    ? Number(distanceMeters)
    : Number.isFinite(Number(distanceKm)) ? Number(distanceKm) * 1000 : null;
  if (!Number.isFinite(meters) || meters < 0 || fallbackType !== "straight-line") return null;
  return {
    routeType: "straight-line",
    provider: null,
    fallbackType: "straight-line",
    distanceMeters: meters,
    distanceKm: Number((meters / 1000).toFixed(1)),
    durationSeconds: null,
    etaMinutes: null,
    geometry: normalizedGeometry,
    points: normalizedGeometry,
    source: "straight",
    etaBasis: null,
  };
}

export function normalizeTrackingStatus(status) {
  return knownTrackingStatuses.has(status) ? status : TRACKING_STATUS.UNAVAILABLE;
}

export function getLocationFreshness(updatedAt, now = Date.now(), { freshMs = 45000, delayedMs = 120000 } = {}) {
  const updatedAtMs = timestampMs(updatedAt);
  if (updatedAtMs === null || !Number.isFinite(now) || !Number.isFinite(freshMs) || !Number.isFinite(delayedMs) || freshMs < 0 || delayedMs < freshMs) {
    return { freshness: LOCATION_FRESHNESS.UNKNOWN, updatedAtMs: null, ageMs: null };
  }
  const ageMs = Math.max(0, now - updatedAtMs);
  return {
    freshness: ageMs <= freshMs
      ? LOCATION_FRESHNESS.FRESH
      : ageMs <= delayedMs ? LOCATION_FRESHNESS.DELAYED : LOCATION_FRESHNESS.STALE,
    updatedAtMs,
    ageMs,
  };
}
