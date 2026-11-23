import * as Location from "expo-location";
import { isWithinEthiopia } from "../utils/coordinates";
import { createGpsFix } from "../features/location/locationModels";

function gpsError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Resolve a recent phone position for flows that save the user's current location.
 * Never supplies map defaults or an out-of-date device position as a result.
 */
export async function getRealGpsLocation({ timeoutMs = 15000 } = {}) {
  const enabled = await Location.hasServicesEnabledAsync().catch(() => true);
  if (!enabled) {
    throw gpsError("gps/disabled", "Location (GPS) is turned off on your phone. Turn it on and try again.");
  }
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") {
    throw gpsError("gps/denied", "Location permission is needed. Allow location access for MyTruck in your phone settings and try again.");
  }

  let position = null;
  let timeoutId;
  try {
    position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch (_) {
    // Convert provider failures below into a stable, user-readable GPS error.
  } finally {
    clearTimeout(timeoutId);
  }

  let source = "device";
  if (!position?.coords) {
    try {
      position = await Location.getLastKnownPositionAsync({ maxAge: 120000 });
      if (position?.coords) source = "last-known";
    } catch (_) {}
  }
  if (!position?.coords) {
    throw gpsError("gps/no_fix", "We couldn't find your location. Move outside or near a window and try again.");
  }
  if (Number.isFinite(position.coords.accuracy) && position.coords.accuracy > 150) {
    throw gpsError("gps/inaccurate", "Your GPS signal is too weak to confirm your location. Move outside or choose the location manually on the map.");
  }
  if (!isWithinEthiopia(position.coords.latitude, position.coords.longitude)) {
    throw gpsError("gps/outside", "MyTruck only works inside Ethiopia, and your phone reports a location outside it.");
  }

  return createGpsFix(position, { source });
}

/** Resolve a recent, verified phone position or throw a coded, user-readable error. */
export async function requestGpsLocation({ timeoutMs = 8000 } = {}) {
  const enabled = await Location.hasServicesEnabledAsync().catch(() => true);
  if (!enabled) {
    throw gpsError("gps/disabled", "Location (GPS) is turned off. Turn it on or choose your location manually on the map.");
  }

  let permission;
  try {
    permission = await Location.requestForegroundPermissionsAsync();
  } catch (_) {
    throw gpsError("gps/permission-error", "We couldn't request location permission. Choose your location manually on the map.");
  }
  if (permission?.status !== "granted") {
    throw gpsError("gps/denied", "Location permission was denied. Allow location access in Settings or choose your location manually on the map.");
  }

  const asVerifiedCoordinate = (coords) => {
    const latitude = Number(coords?.latitude);
    const longitude = Number(coords?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !isWithinEthiopia(latitude, longitude)) return null;
    if (Number.isFinite(coords?.accuracy) && coords.accuracy > 150) return null;
    return { latitude, longitude, accuracy: Number(coords?.accuracy) || null };
  };

  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 120000 });
    const coords = asVerifiedCoordinate(last?.coords);
    if (coords) return createGpsFix(last, { source: "last-known" });
  } catch (_) {}

  let timer;
  try {
    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(gpsError("gps/timeout", "We couldn't get a GPS fix in time. Choose your location manually on the map and try again.")),
          timeoutMs
        );
      }),
    ]);
    const coords = asVerifiedCoordinate(position?.coords);
    if (!coords) {
      throw gpsError("gps/outside", "Your phone's location is outside Ethiopia, invalid, or too imprecise to confirm. Choose the location manually on the map.");
    }
    return createGpsFix(position, { source: "device" });
  } catch (error) {
    if (error?.code?.startsWith?.("gps/")) throw error;
    throw gpsError("gps/no_fix", "We couldn't get your GPS location. Choose your location manually on the map and try again.");
  } finally {
    clearTimeout(timer);
  }
}
