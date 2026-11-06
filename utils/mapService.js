import * as Location from "expo-location";
import Constants from "expo-constants";

export const DEFAULT_COORDS = {
  latitude: 8.9806,
  longitude: 38.7578,
  latitudeDelta: 0.015,
  longitudeDelta: 0.015,
};

/**
 * Validates whether coordinates fall within Ethiopian national boundaries.
 * Covers the entire country: Tigray → Somali Region → Gambella → Afar.
 * Prevents non-Ethiopian simulator/VPN coordinates (e.g. Montana/USA) from hijacking delivery locations.
 */
export function isWithinEthiopia(lat, lon) {
  const nLat = Number(lat);
  const nLon = Number(lon);
  return (
    !isNaN(nLat) &&
    !isNaN(nLon) &&
    nLat >= 3.0 &&
    nLat <= 15.0 &&
    nLon >= 33.0 &&
    nLon <= 48.0
  );
}

export const GEBETA_KEY = Constants.expoConfig?.extra?.gebetaMapsApiKey || "";

// Robust raster tile URL templates that render crisp street maps for Ethiopia (Zero watermark)
export const MAP_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const OSM_TILE_URL = "https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png";

// Quick-select delivery zones covering major Ethiopian cities
export const ADDIS_DELIVERY_ZONES = [
  // ── Addis Ababa ─────────────────────────────────────────────────────────
  { id: "bole", name: "Bole", sub: "Atlas & Edna Mall", latitude: 8.9950, longitude: 38.7885 },
  { id: "kazanchis", name: "Kazanchis", sub: "UN ECA & Intercontinental", latitude: 9.0180, longitude: 38.7660 },
  { id: "sarbet", name: "Sarbet", sub: "AU & Karl Square", latitude: 8.9910, longitude: 38.7360 },
  { id: "cmc", name: "CMC / Ayat", sub: "Michael Roundabout", latitude: 9.0190, longitude: 38.8370 },
  { id: "piassa", name: "Piassa", sub: "Arada & Churchill", latitude: 9.0340, longitude: 38.7510 },
  { id: "megenagna", name: "Megenagna", sub: "Zefmesh & Diaspora Square", latitude: 9.0200, longitude: 38.8020 },
  { id: "gerji", name: "Gerji", sub: "Unity & Mebrat Hail", latitude: 8.9890, longitude: 38.8110 },
  { id: "mexico", name: "Mexico Square", sub: "Genet Hotel & Kera", latitude: 9.0100, longitude: 38.7440 },
  { id: "22mazoria", name: "22 Mazoria", sub: "Golagol & Axum Hotel", latitude: 9.0150, longitude: 38.7830 },
  { id: "gotera", name: "Gotera / Lancha", sub: "NOC & Pepaps", latitude: 8.9830, longitude: 38.7560 },
  // ── Other Major Ethiopian Cities ─────────────────────────────────────────
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
  { id: "nekemte", name: "Nekemte", sub: "East Wollega, Oromia", latitude: 9.0890, longitude: 36.5473 },
  { id: "dilla", name: "Dilla", sub: "Gedeo Zone, SNNPR", latitude: 6.4111, longitude: 38.3113 },
  { id: "wolaita-sodo", name: "Wolaita Sodo", sub: "Wolaita Zone, SNNPR", latitude: 6.8503, longitude: 37.7570 },
];

/**
 * Reverse geocode latitude and longitude to a human-readable Ethiopian address.
 * Works for ANY location within Ethiopia — Addis Ababa, Mekelle, Hawassa, Dire Dawa, etc.
 * 1. Tries Gebeta Map Reverse Geocoding API if configured.
 * 2. Tries Expo Location reverseGeocodeAsync.
 * 3. Tries OpenStreetMap Nominatim (country-wide).
 * 4. Falls back to nearest known Ethiopian city name.
 */
export async function reverseGeocodeLocation(latitude, longitude) {
  if (!latitude || !longitude || !isWithinEthiopia(latitude, longitude)) {
    return "Ethiopia";
  }

  // Tier 1: Gebeta Map API
  if (GEBETA_KEY) {
    try {
      const gebetaUrl = `https://mapapi.gebeta.app/api/v1/route/revgeocoding?lat=${latitude}&lon=${longitude}&apiKey=${encodeURIComponent(GEBETA_KEY)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(gebetaUrl, {
        headers: {
          "Authorization": `Bearer ${GEBETA_KEY}`,
          "Accept": "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        const candidate = data?.data?.name || data?.data?.address || data?.address || data?.name;
        if (candidate && typeof candidate === "string" && candidate.trim().length > 0) {
          return candidate.trim();
        }
      }
    } catch (_) {}
  }

  // Tier 2: Expo native Location
  try {
    const res = await Location.reverseGeocodeAsync({ latitude, longitude });
    if (res && res.length > 0) {
      const place = res[0];
      const parts = [
        place.name || place.street,
        place.subregion || place.district || place.city,
        place.region,
      ].filter(Boolean);
      if (parts.length > 0) return parts.slice(0, 2).join(", ");
    }
  } catch (_) {}

  // Tier 3: OpenStreetMap Nominatim (unrestricted — all Ethiopian cities)
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=en`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const resp = await fetch(url, {
      headers: { "User-Agent": "MyTruck-Delivery/1.0 (info@mytruck.et)" },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await resp.json();
    if (data && data.address) {
      const a = data.address;
      const sub = a.suburb || a.neighbourhood || a.city_district || a.quarter || a.road || "";
      const city = a.city || a.town || a.village || a.county || a.state || "Ethiopia";
      const result = [sub, city].filter(Boolean).join(", ");
      return result || data.display_name.split(",").slice(0, 2).join(",").trim();
    }
  } catch (_) {}

  // Tier 4: Nearest known Ethiopian city
  let closestCity = "Ethiopia";
  let minDistance = Infinity;
  for (const zone of ADDIS_DELIVERY_ZONES) {
    const dLat = zone.latitude - latitude;
    const dLon = zone.longitude - longitude;
    const dist = dLat * dLat + dLon * dLon;
    if (dist < minDistance) {
      minDistance = dist;
      closestCity = zone.name;
    }
  }
  return closestCity;
}

/**
 * Search for places / landmarks anywhere in Ethiopia.
 * 1. Checks predefined delivery zones for instant instant-match.
 * 2. Tries Gebeta Map Forward Geocoding.
 * 3. Tries OpenStreetMap Nominatim (country-wide, not Addis-only).
 */
export async function searchPlaces(queryText) {
  if (!queryText || queryText.trim().length < 2) return [];
  const clean = queryText.trim().toLowerCase();

  // Instant local zone matches (now covers 24 zones across all major Ethiopian cities)
  const localMatches = ADDIS_DELIVERY_ZONES.filter(
    (z) => z.name.toLowerCase().includes(clean) || z.sub.toLowerCase().includes(clean)
  ).map((z) => ({
    id: `local-${z.id}`,
    title: z.name,
    fullAddress: `${z.name}${z.sub ? ` (${z.sub})` : ""}`,
    latitude: z.latitude,
    longitude: z.longitude,
  }));

  // Tier 1: Gebeta Map Forward Geocoding
  if (GEBETA_KEY) {
    try {
      const gebetaUrl = `https://mapapi.gebeta.app/api/v1/route/geocoding?name=${encodeURIComponent(queryText.trim())}&apiKey=${encodeURIComponent(GEBETA_KEY)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(gebetaUrl, {
        headers: {
          "Authorization": `Bearer ${GEBETA_KEY}`,
          "Accept": "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
        if (list.length > 0) {
          const remote = list.map((item, idx) => ({
            id: `gebeta-${idx}`,
            title: item.name || item.title || queryText,
            fullAddress: item.address || item.formatted_address || item.name || queryText,
            latitude: parseFloat(item.lat || item.latitude),
            longitude: parseFloat(item.lon || item.longitude),
          })).filter((x) => !isNaN(x.latitude) && !isNaN(x.longitude));
          if (remote.length > 0) return [...localMatches, ...remote];
        }
      }
    } catch (_) {
      // Gebeta search fallback
    }
  }

  // Tier 2: OpenStreetMap Nominatim
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      queryText.trim() + ", Ethiopia"
    )}&format=json&limit=8&countrycodes=et&accept-language=en`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    const resp = await fetch(url, {
      headers: { "User-Agent": "MyTruck-Delivery/1.0 (info@mytruck.et)" },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await resp.json();
    if (Array.isArray(data)) {
      const osmList = data.map((item) => ({
        id: String(item.place_id || Math.random()),
        title: item.display_name.split(",").slice(0, 2).join(",").trim(),
        fullAddress: item.display_name,
        latitude: parseFloat(item.lat),
        longitude: parseFloat(item.lon),
      }));
      return [...localMatches, ...osmList];
    }
  } catch (err) {
    // search fallback
  }

  return localMatches;
}

/**
 * Request location permission and get current GPS location.
 * Highly robust: tries last known location for instant response,
 * falls back to fresh GPS query, and never hangs on device timeout.
 */
export async function requestGpsLocation() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") {
    throw new Error("Location permission denied. Please allow location access in your device settings.");
  }

  // Fast path: check last known position first
  try {
    const last = await Location.getLastKnownPositionAsync();
    if (
      last &&
      last.coords &&
      isWithinEthiopia(last.coords.latitude, last.coords.longitude)
    ) {
      return last.coords;
    }
  } catch (_) {}

  // Current position with safe 8s timeout race
  const getPosPromise = Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });

  const timeoutPromise = new Promise((resolve) =>
    setTimeout(() => resolve({ coords: DEFAULT_COORDS }), 8000)
  );

  try {
    const pos = await Promise.race([getPosPromise, timeoutPromise]);
    const coords = pos?.coords;
    if (coords && isWithinEthiopia(coords.latitude, coords.longitude)) {
      return coords;
    }
    return DEFAULT_COORDS;
  } catch (err) {
    return DEFAULT_COORDS;
  }
}
