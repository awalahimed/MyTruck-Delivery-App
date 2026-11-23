import * as Location from "expo-location";

/** Fetch JSON with an abort timeout. Missing configuration and network errors return null. */
export async function fetchJsonWithTimeout(url, timeoutMs = 5000) {
  if (typeof fetch !== "function") return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function requestMapboxDirections(origin, destination, fetchJson = fetchJsonWithTimeout) {
  // Mapbox web services are intentionally disabled. Routing falls through to
  // the existing OSRM (OpenStreetMap data) provider.
  return null;
}

export async function requestMapboxGeocoding(path, params, fetchJson = fetchJsonWithTimeout) {
  // Geocoding falls through to device geocoding / Photon / local places.
  return null;
}

/** Device reverse-geocoder fallback used when Mapbox or the network is unavailable. */
export async function reverseGeocodeOnDevice(point) {
  return Location.reverseGeocodeAsync(point);
}
