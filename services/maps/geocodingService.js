import { isWithinEthiopia } from "../../utils/coordinates";
import { createAddressResult, createPlaceResult } from "../../features/location/locationModels";
import {
  fetchJsonWithTimeout,
  requestMapboxGeocoding,
  reverseGeocodeOnDevice,
} from "./mapProviderClient";

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
  { id: "gondar", name: "Gondar", sub: "Amhara Region Capital", latitude: 12.6031, longitude: 37.4661 },
  { id: "hawassa", name: "Hawassa", sub: "Sidama Region Capital", latitude: 7.0504, longitude: 38.4784 },
  { id: "bahirdar", name: "Bahir Dar", sub: "Amhara Region Capital", latitude: 11.5742, longitude: 37.3614 },
  { id: "jimma", name: "Jimma", sub: "Oromia Region Capital", latitude: 7.6718, longitude: 36.8342 },
  { id: "adama", name: "Adama / Nazret", sub: "East Shewa, Oromia", latitude: 8.5399, longitude: 39.2694 },
  { id: "dessie", name: "Dessie", sub: "South Wollo, Amhara", latitude: 11.1333, longitude: 39.6333 },
  { id: "harar", name: "Harar", sub: "Harari Region", latitude: 9.3127, longitude: 42.1189 },
  { id: "arba-minch", name: "Arba Minch", sub: "Gamo Zone, SNNPR", latitude: 6.0381, longitude: 37.5503 },
  { id: "shashamane", name: "Shashemene", sub: "West Arsi, Oromia", latitude: 7.1998, longitude: 38.5979 },
  { id: "nekemte", name: "Nekemte", sub: "East Wollega, Oromia", latitude: 9.089, longitude: 36.5473 },
  { id: "dilla", name: "Dilla", sub: "Gedeo Zone, SNNPR", latitude: 6.4111, longitude: 38.3113 },
  { id: "wolaita-sodo", name: "Wolaita Sodo", sub: "Wolaita Zone, SNNPR", latitude: 6.8503, longitude: 37.757 },
];

const PHOTON_URL = "https://photon.komoot.io/api/";
const PHOTON_MIN_INTERVAL_MS = 1100;

export function createGeocodingService({
  mapboxGeocode = (path, params, fetch) => requestMapboxGeocoding(path, params, fetch),
  deviceReverseGeocode = reverseGeocodeOnDevice,
  fetchJson = fetchJsonWithTimeout,
  sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
  now = Date.now,
  zones = ADDIS_DELIVERY_ZONES,
} = {}) {
  let lastPhotonSearchAt = 0;

  function searchLocalPlaces(queryText) {
    if (!queryText || String(queryText).trim().length < 2) return [];
    const query = String(queryText).trim().toLowerCase();
    return zones.filter((zone) => zone.name.toLowerCase().includes(query) || zone.sub.toLowerCase().includes(query))
      .map((zone) => createPlaceResult({
        id: `local-${zone.id}`,
        title: zone.name,
        fullAddress: `${zone.name}${zone.sub ? ` (${zone.sub})` : ""}`,
        latitude: zone.latitude,
        longitude: zone.longitude,
        provider: "local",
      })).filter(Boolean);
  }

  async function reverseGeocodeResult(latitude, longitude) {
    if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude)) || !isWithinEthiopia(Number(latitude), Number(longitude))) {
      return createAddressResult({ address: "Ethiopia", latitude: null, longitude: null, provider: "fallback", fallback: true });
    }
    const point = { latitude: Number(latitude), longitude: Number(longitude) };
    let mapboxResult = null;
    try {
      mapboxResult = await mapboxGeocode("reverse", {
        longitude: String(point.longitude),
        latitude: String(point.latitude),
        country: "ET",
        language: "en",
        limit: "1",
      }, fetchJson);
    } catch (_) {}
    const mapboxFeature = mapboxResult?.features?.[0];
    const mapboxAddress = mapboxFeature?.properties?.full_address || mapboxFeature?.properties?.place_formatted || mapboxFeature?.properties?.name;
    if (mapboxAddress) {
      return createAddressResult({ address: mapboxAddress, coordinate: point, provider: "mapbox" });
    }

    try {
      const results = await deviceReverseGeocode(point);
      if (results?.length) {
        const place = results[0];
        const parts = [place.name || place.street, place.subregion || place.district || place.city, place.region].filter(Boolean);
        if (parts.length) return createAddressResult({ address: parts.slice(0, 2).join(", "), coordinate: point, provider: "device" });
      }
    } catch (_) {}
    return createAddressResult({ address: "Selected location, Ethiopia", coordinate: point, provider: "fallback", fallback: true });
  }

  async function reverseGeocodeLocation(latitude, longitude) {
    return (await reverseGeocodeResult(latitude, longitude))?.address || "Ethiopia";
  }

  async function searchPlaces(queryText) {
    const query = String(queryText || "").trim();
    const localMatches = searchLocalPlaces(query);
    if (query.length < 2) return localMatches;

    let mapboxResponse = null;
    try {
      mapboxResponse = await mapboxGeocode("forward", {
        q: query,
        country: "ET",
        language: "en",
        limit: "8",
      }, fetchJson);
    } catch (_) {}
    const mapboxResults = Array.isArray(mapboxResponse?.features)
      ? mapboxResponse.features.map((feature, index) => {
        const [longitude, latitude] = feature?.geometry?.coordinates || [];
        const properties = feature?.properties || {};
        const address = properties.full_address || properties.place_formatted || properties.name;
        return address
          ? createPlaceResult({
            id: feature.id || `mapbox-${index}-${latitude}-${longitude}`,
            title: address,
            fullAddress: address,
            latitude: Number(latitude),
            longitude: Number(longitude),
            provider: "mapbox",
          })
          : null;
      }).filter(Boolean)
      : [];

    let photonResults = [];
    try {
      const waitMs = Math.max(0, PHOTON_MIN_INTERVAL_MS - (now() - lastPhotonSearchAt));
      if (waitMs) await sleep(waitMs);
      lastPhotonSearchAt = now();
      const data = await fetchJson(
        `${PHOTON_URL}?q=${encodeURIComponent(query)}&limit=8&lang=en&lat=8.9806&lon=38.7578&bbox=33,3,48,15`,
        5000
      );
      photonResults = (data?.features || []).map((feature, index) => {
        const [longitude, latitude] = feature?.geometry?.coordinates || [];
        const properties = feature?.properties || {};
        const address = [properties.name, properties.street, properties.city || properties.district, properties.state, properties.country]
          .filter((part, partIndex, all) => part && all.indexOf(part) === partIndex).join(", ");
        return Number.isFinite(latitude) && Number.isFinite(longitude) && isWithinEthiopia(latitude, longitude)
          ? createPlaceResult({
            id: `photon-${properties.osm_id || index}-${latitude}-${longitude}`,
            title: address || query,
            fullAddress: address || query,
            latitude,
            longitude,
            provider: "photon",
          })
          : null;
      }).filter(Boolean);
    } catch (_) {}

    const seen = new Set();
    return [...localMatches, ...mapboxResults, ...photonResults].filter((place) => {
      const key = `${place.latitude.toFixed(4)},${place.longitude.toFixed(4)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return { reverseGeocodeLocation, reverseGeocodeResult, searchLocalPlaces, searchPlaces };
}

export const { reverseGeocodeLocation, reverseGeocodeResult, searchLocalPlaces, searchPlaces } = createGeocodingService();
