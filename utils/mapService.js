import * as Location from "expo-location";
import Constants from "expo-constants";

/**
 * Map, address and route services — Google Maps Platform.
 *
 * The web key (Geocoding + Directions APIs) is injected at build time from the
 * GOOGLE_MAPS_WEB_KEY EAS variable by app.config.js. The map tiles on Android use
 * the Android key (GOOGLE_MAPS_ANDROID_KEY) through the native Google Maps SDK.
 * Without a web key, addresses fall back to the device's own geocoder and routes
 * fall back to straight-line distance.
 */

export const DEFAULT_COORDS = {
  latitude: 8.9806,
  longitude: 38.7578,
  latitudeDelta: 0.015,
  longitudeDelta: 0.015,
};

const WEB_KEY = String(
  Constants.expoConfig?.extra?.googleMapsWebKey || Constants.manifest?.extra?.googleMapsWebKey || ""
).trim();

export const hasGoogleMaps = () => WEB_KEY.length > 0;

/**
 * Validates whether coordinates fall within Ethiopian national boundaries.
 * Prevents non-Ethiopian simulator/VPN coordinates from hijacking delivery locations.
 */
export function isWithinEthiopia(lat, lon) {
  const nLat = Number(lat);
  const nLon = Number(lon);
  return !isNaN(nLat) && !isNaN(nLon) && nLat >= 3.0 && nLat <= 15.0 && nLon >= 33.0 && nLon <= 48.0;
}

// Quick-select delivery zones covering major Ethiopian cities
export const ADDIS_DELIVERY_ZONES = [
  { id: "bole", name: "Bole", sub: "Atlas & Edna Mall", latitude: 8.995, longitude: 38.7885 },
  { id: "kazanchis", name: "Kazanchis", sub: "UN ECA & Intercontinental", latitude: 9.018, longitude: 38.766 },
  { id: "sarbet", name: "Sarbet", sub: "AU & Karl Square", latitude: 8.991, longitude: 38.736 },
  { id: "cmc", name: "CMC / Ayat", sub: "Michael Roundabout", latitude: 9.019, longitude: 38.837 },
  { id: "piassa", name: "Piassa", sub: "Arada & Churchill", latitude: 9.034, longitude: 38.751 },
  { id: "megenagna", name: "Megenagna", sub: "Zefmesh & Diaspora Square", latitude: 9.02, longitude: 38.802 },
  { id: "gerji", name: "Gerji", sub: "Unity & Mebrat Hail", latitude: 8.989, longitude: 38.811 },
  { id: "mexico", name: "Mexico Square", sub: "Genet Hotel & Kera", latitude: 9.01, longitude: 38.744 },
  { id: "22mazoria", name: "22 Mazoria", sub: "Golagol & Axum Hotel", latitude: 9.015, longitude: 38.783 },
  { id: "gotera", name: "Gotera / Lancha", sub: "NOC & Pepaps", latitude: 8.983, longitude: 38.756 },
  { id: "dire-dawa", name: "Dire Dawa", sub: "Dire Dawa City Center", latitude: 9.5932, longitude: 41.8661 },
  { id: "mekelle", name: "Mekelle", sub: "Tigray Region Capital", latitude: 13.4967, longitude: 39.4753 },
  { id: "gondar", name: "Gondar", sub: "Amhara Region", latitude: 12.6031, longitude: 37.4661 },
  { id: "hawassa", name: "Hawassa", sub: "Sidama Region Capital", latitude: 7.0504, longitude: 38.4784 },
  { id: "bahirdar", name: "Bahir Dar", sub: "Amhara Region Capital", latitude: 11.5742, longitude: 37.3614 },
  { id: "jimma", name: "Jimma", sub: "Oromia Region", latitude: 7.6718, longitude: 36.8342 },
  { id: "adama", name: "Adama / Nazret", sub: "East Shewa, Oromia", latitude: 8.5399, longitude: 39.2694 },
  { id: "dessie", name: "Dessie", sub: "South Wollo, Amhara", latitude: 11.1333, longitude: 39.6333 },
  { id: "harar", name: "Harar", sub: "Harari Region", latitude: 9.3127, longitude: 42.1189 },
  { id: "arba-minch", name: "Arba Minch", sub: "Gamo Zone, SNNPR", latitude: 6.0381, longitude: 37.5503 },
  { id: "shashamane", name: "Shashemene", sub: "West Arsi, Oromia", latitude: 7.1998, longitude: 38.5979 },
  { id: "nekemte", name: "Nekemte", sub: "East Wollega, Oromia", latitude: 9.089, longitude: 36.5473 },
  { id: "dilla", name: "Dilla", sub: "Gedeo Zone, SNNPR", latitude: 6.4111, longitude: 38.3113 },
  { id: "wolaita-sodo", name: "Wolaita Sodo", sub: "Wolaita Zone, SNNPR", latitude: 6.8503, longitude: 37.757 },
];

/** Straight-line (great-circle) distance in km. Used for listings and as a map fallback. */
export function straightLineKm(lat1, lon1, lat2, lon2) {
  const nums = [lat1, lon1, lat2, lon2].map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [a1, o1, a2, o2] = nums;
  const toRad = (d) => (d * Math.PI) / 180;
  const h =
    Math.sin(toRad(a2 - a1) / 2) ** 2 + Math.cos(toRad(a1)) * Math.cos(toRad(a2)) * Math.sin(toRad(o2 - o1) / 2) ** 2;
  return Number((6371 * 2 * Math.asin(Math.sqrt(h))).toFixed(1));
}

/** Fetch JSON with a timeout. Returns null on any failure (never throws). */
async function fetchJson(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** "Bole Rd, Addis Ababa, Ethiopia" -> "Bole Rd, Addis Ababa" */
const shortAddress = (formatted) => {
  const parts = String(formatted || "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && p.toLowerCase() !== "ethiopia");
  return parts.slice(0, 2).join(", ") || String(formatted || "");
};

/** Nearest known Ethiopian city name (last resort). */
function nearestZoneName(latitude, longitude) {
  let best = "Ethiopia";
  let min = Infinity;
  for (const zone of ADDIS_DELIVERY_ZONES) {
    const d = (zone.latitude - latitude) ** 2 + (zone.longitude - longitude) ** 2;
    if (d < min) {
      min = d;
      best = zone.name;
    }
  }
  return best;
}

/**
 * Human-readable address for a point in Ethiopia.
 * 1. Google Geocoding API.  2. Device geocoder.  3. Nearest known city.
 */
export async function reverseGeocodeLocation(latitude, longitude) {
  if (!latitude || !longitude || !isWithinEthiopia(latitude, longitude)) return "Ethiopia";

  if (hasGoogleMaps()) {
    const data = await fetchJson(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&language=en&key=${encodeURIComponent(WEB_KEY)}`
    );
    const formatted = data?.status === "OK" ? data.results?.[0]?.formatted_address : null;
    if (formatted) return shortAddress(formatted);
  }

  try {
    const res = await Location.reverseGeocodeAsync({ latitude, longitude });
    if (res && res.length > 0) {
      const place = res[0];
      const parts = [place.name || place.street, place.subregion || place.district || place.city, place.region].filter(Boolean);
      if (parts.length > 0) return parts.slice(0, 2).join(", ");
    }
  } catch (_) {}

  return nearestZoneName(latitude, longitude);
}

/**
 * Places matching a search, anywhere in Ethiopia.
 * Local city/zone names first, then Google Geocoding (restricted to Ethiopia).
 */
export async function searchPlaces(queryText) {
  if (!queryText || queryText.trim().length < 2) return [];
  const q = queryText.trim();
  const clean = q.toLowerCase();

  const localMatches = ADDIS_DELIVERY_ZONES.filter(
    (z) => z.name.toLowerCase().includes(clean) || z.sub.toLowerCase().includes(clean)
  ).map((z) => ({
    id: `local-${z.id}`,
    title: z.name,
    fullAddress: `${z.name}${z.sub ? ` (${z.sub})` : ""}`,
    latitude: z.latitude,
    longitude: z.longitude,
  }));

  if (!hasGoogleMaps()) return localMatches;

  const data = await fetchJson(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&components=country:ET&language=en&key=${encodeURIComponent(WEB_KEY)}`,
    6000
  );
  const remote =
    data?.status === "OK"
      ? data.results.slice(0, 8).map((r, idx) => ({
          id: `google-${r.place_id || idx}`,
          title: shortAddress(r.formatted_address),
          fullAddress: r.formatted_address,
          latitude: r.geometry.location.lat,
          longitude: r.geometry.location.lng,
        }))
      : [];

  return [...localMatches, ...remote];
}

/** Decode a Google encoded polyline into { latitude, longitude } points. */
export function decodePolyline(encoded) {
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const readValue = () => {
    let result = 0;
    let shift = 0;
    let b;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += readValue();
    lng += readValue();
    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}

const routeCache = new Map();
const ROUTE_CACHE_LIMIT = 60;

/**
 * Real road route between two points (Google Routes API, driving).
 * Returns { distanceKm, etaMinutes, points } or null when unavailable.
 * Results are cached by rounded coordinates to keep API use low.
 */
export async function getRoute(from, to) {
  if (!hasGoogleMaps() || !from || !to) return null;
  const fLat = Number(from.latitude);
  const fLng = Number(from.longitude);
  const tLat = Number(to.latitude);
  const tLng = Number(to.longitude);
  if (![fLat, fLng, tLat, tLng].every(Number.isFinite)) return null;

  const key = [fLat, fLng, tLat, tLng].map((n) => n.toFixed(4)).join(",");
  if (routeCache.has(key)) return routeCache.get(key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let data = null;
  try {
    const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": WEB_KEY,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: fLat, longitude: fLng } } },
        destination: { location: { latLng: { latitude: tLat, longitude: tLng } } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
      }),
    });
    if (res.ok) data = await res.json();
  } catch (_) {
    data = null;
  } finally {
    clearTimeout(timer);
  }

  const route = data?.routes?.[0];
  if (!route || !Number.isFinite(Number(route.distanceMeters))) return null;

  // duration comes as a string such as "780s"
  const seconds = Number(String(route.duration || "0").replace("s", "")) || 0;
  const result = {
    distanceKm: Number((Number(route.distanceMeters) / 1000).toFixed(1)),
    etaMinutes: Math.max(1, Math.round(seconds / 60)),
    points: decodePolyline(route.polyline?.encodedPolyline || ""),
  };

  if (routeCache.size >= ROUTE_CACHE_LIMIT) routeCache.delete(routeCache.keys().next().value);
  routeCache.set(key, result);
  return result;
}

/**
 * Request location permission and get current GPS location.
 * Uses last known position for an instant answer, then a fresh fix with an 8s cap.
 */
export async function requestGpsLocation() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") {
    throw new Error("Location permission denied. Please allow location access in your device settings.");
  }

  try {
    const last = await Location.getLastKnownPositionAsync();
    if (last && last.coords && isWithinEthiopia(last.coords.latitude, last.coords.longitude)) {
      return last.coords;
    }
  } catch (_) {}

  const getPosPromise = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve({ coords: DEFAULT_COORDS }), 8000));

  try {
    const pos = await Promise.race([getPosPromise, timeoutPromise]);
    const coords = pos?.coords;
    if (coords && isWithinEthiopia(coords.latitude, coords.longitude)) return coords;
    return DEFAULT_COORDS;
  } catch (_) {
    return DEFAULT_COORDS;
  }
}
