import * as Location from "expo-location";
import Constants from "expo-constants";

/**
 * Map, address and route helpers.
 *
 * Uses Google Maps SDK, Google Directions and Geocoding when an API key is configured.
 * Device geocoding, Komoot Photon, OSRM routing and local known zones provide resilient fallbacks.
 */

export function getGoogleMapsApiKey() {
  return (
    Constants.expoConfig?.extra?.googleMapsApiKey ||
    Constants.expoConfig?.android?.config?.googleMaps?.apiKey ||
    Constants.expoConfig?.ios?.config?.googleMapsApiKey ||
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    "AIzaSyBQP-h2NxxB3HqrQeraeUq5UNayFn9oxYU"
  );
}

export const DEFAULT_COORDS = {
  latitude: 8.9806,
  longitude: 38.7578,
  latitudeDelta: 0.015,
  longitudeDelta: 0.015,
};

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
 * Human-readable address for a point in Ethiopia using Google Geocoding or device geocoder.
 */
export async function reverseGeocodeLocation(latitude, longitude) {
  if (!latitude || !longitude || !isWithinEthiopia(latitude, longitude)) return "Ethiopia";

  const googleKey = getGoogleMapsApiKey();
  if (googleKey) {
    try {
      const res = await fetchJson(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${googleKey}`,
        4000
      );
      if (res?.status === "OK" && Array.isArray(res.results) && res.results.length > 0) {
        const addr = res.results[0].formatted_address;
        if (addr && !addr.includes("Montana") && !addr.includes("Cascade")) {
          return addr;
        }
      }
    } catch (_) {}
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
 * Search local delivery zones first, then Photon on explicit user submission.
 */
export function searchLocalPlaces(queryText) {
  if (!queryText || queryText.trim().length < 2) return [];
  const clean = queryText.trim().toLowerCase();
  return ADDIS_DELIVERY_ZONES.filter(
    (z) => z.name.toLowerCase().includes(clean) || z.sub.toLowerCase().includes(clean)
  ).map((z) => ({
    id: `local-${z.id}`,
    title: z.name,
    fullAddress: `${z.name}${z.sub ? ` (${z.sub})` : ""}`,
    latitude: z.latitude,
    longitude: z.longitude,
  }));
}

let lastPhotonSearchAt = 0;
export async function searchPlaces(queryText) {
  const q = String(queryText || "").trim();
  const localMatches = searchLocalPlaces(q);
  if (q.length < 2) return localMatches;

  const googleKey = getGoogleMapsApiKey();
  let googleResults = [];
  if (googleKey) {
    try {
      const gData = await fetchJson(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&components=country:ET&key=${googleKey}`,
        4000
      );
      if (gData?.status === "OK" && Array.isArray(gData.results)) {
        googleResults = gData.results
          .map((item, idx) => {
            const lat = item.geometry?.location?.lat;
            const lng = item.geometry?.location?.lng;
            const address = item.formatted_address || item.name;
            return Number.isFinite(lat) && Number.isFinite(lng) && isWithinEthiopia(lat, lng)
              ? { id: `google-${idx}-${lat}-${lng}`, title: address, fullAddress: address, latitude: lat, longitude: lng }
              : null;
          })
          .filter(Boolean);
      }
    } catch (_) {}
  }

  // Photon fallback / secondary matches
  let remote = [];
  try {
    const waitMs = Math.max(0, 1100 - (Date.now() - lastPhotonSearchAt));
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastPhotonSearchAt = Date.now();
    const data = await fetchJson(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=en&lat=8.9806&lon=38.7578&bbox=33,3,48,15`,
      5000
    );
    remote = (data?.features || []).map((feature, idx) => {
      const [longitude, latitude] = feature?.geometry?.coordinates || [];
      const p = feature?.properties || {};
      const address = [p.name, p.street, p.city || p.district, p.state, p.country]
        .filter((part, index, all) => part && all.indexOf(part) === index)
        .join(", ");
      return Number.isFinite(latitude) && Number.isFinite(longitude) && isWithinEthiopia(latitude, longitude)
        ? { id: `photon-${p.osm_id || idx}-${latitude}-${longitude}`, title: address || q, fullAddress: address || q, latitude, longitude }
        : null;
    }).filter(Boolean);
  } catch (_) {}

  const seen = new Set(localMatches.map((place) => `${place.latitude.toFixed(4)},${place.longitude.toFixed(4)}`));
  const combined = [...localMatches, ...googleResults, ...remote];
  return combined.filter((place) => {
    const key = `${place.latitude.toFixed(4)},${place.longitude.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
 * Real road route between two points.
 * Tries Google Directions API first when configured, then OpenStreetMap OSRM.
 * Returns { distanceKm, etaMinutes, points, source } or null when unavailable.
 * Results are cached by rounded coordinates to keep API use low.
 */
export async function getRoute(from, to) {
  if (!from || !to) return null;
  const fLat = Number(from.latitude);
  const fLng = Number(from.longitude);
  const tLat = Number(to.latitude);
  const tLng = Number(to.longitude);
  if (![fLat, fLng, tLat, tLng].every(Number.isFinite)) return null;

  const key = [fLat, fLng, tLat, tLng].map((n) => n.toFixed(4)).join(",");
  if (routeCache.has(key)) return routeCache.get(key);

  const googleKey = getGoogleMapsApiKey();

  // 1. Google Routes API (Active & Enabled)
  if (googleKey) {
    const rCtrl = new AbortController();
    const rTimer = setTimeout(() => rCtrl.abort(), 6000);
    try {
      const rRes = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        signal: rCtrl.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": googleKey,
          "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: fLat, longitude: fLng } } },
          destination: { location: { latLng: { latitude: tLat, longitude: tLng } } },
          travelMode: "DRIVE",
        }),
      });
      if (rRes.ok) {
        const rData = await rRes.json();
        const rRoute = rData?.routes?.[0];
        const poly = rRoute?.polyline?.encodedPolyline;
        if (rRoute && poly) {
          const durationSeconds = parseInt(rRoute.duration || "0", 10) || 0;
          const result = {
            distanceKm: Number(((rRoute.distanceMeters || 0) / 1000).toFixed(1)),
            etaMinutes: Math.max(1, Math.round(durationSeconds / 60)),
            points: decodePolyline(poly),
            source: "google",
          };
          if (routeCache.size >= ROUTE_CACHE_LIMIT) routeCache.delete(routeCache.keys().next().value);
          routeCache.set(key, result);
          return result;
        }
      }
    } catch (_) {
      // Fallback
    } finally {
      clearTimeout(rTimer);
    }

    // 1b. Google Directions API (Standard fallback)
    const gCtrl = new AbortController();
    const gTimer = setTimeout(() => gCtrl.abort(), 6000);
    try {
      const gUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${fLat},${fLng}&destination=${tLat},${tLng}&mode=driving&key=${googleKey}`;
      const gRes = await fetch(gUrl, { signal: gCtrl.signal, headers: { Accept: "application/json" } });
      if (gRes.ok) {
        const gData = await gRes.json();
        const gRoute = gData?.routes?.[0];
        const gLeg = gRoute?.legs?.[0];
        if (gData?.status === "OK" && gRoute && gLeg && gRoute.overview_polyline?.points) {
          const result = {
            distanceKm: Number(((gLeg.distance?.value || 0) / 1000).toFixed(1)),
            etaMinutes: Math.max(1, Math.round((gLeg.duration?.value || 0) / 60)),
            points: decodePolyline(gRoute.overview_polyline.points),
            source: "google",
          };
          if (routeCache.size >= ROUTE_CACHE_LIMIT) routeCache.delete(routeCache.keys().next().value);
          routeCache.set(key, result);
          return result;
        }
      }
    } catch (_) {
      // Fallback to OSRM
    } finally {
      clearTimeout(gTimer);
    }
  }

  // 2. OpenStreetMap OSRM fallback (independent controller)
  const oCtrl = new AbortController();
  const oTimer = setTimeout(() => oCtrl.abort(), 6000);
  let data = null;
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${fLng},${fLat};${tLng},${tLat}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: oCtrl.signal, headers: { Accept: "application/json" } });
    if (res.ok) data = await res.json();
  } catch (_) {
    data = null;
  } finally {
    clearTimeout(oTimer);
  }

  const route = data?.code === "Ok" ? data.routes?.[0] : null;
  if (!route || !Number.isFinite(Number(route.distance))) return null;

  const result = {
    distanceKm: Number((Number(route.distance) / 1000).toFixed(1)),
    etaMinutes: Math.max(1, Math.round((Number(route.duration) || 0) / 60)),
    points: (route.geometry?.coordinates || []).map(([longitude, latitude]) => ({ latitude, longitude })),
    source: "road",
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
