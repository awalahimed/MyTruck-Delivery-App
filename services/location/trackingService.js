import * as Location from "expo-location";
import { isWithinEthiopia, normalizeEthiopiaCoordinate } from "../../utils/coordinates";
import {
  createGpsFix,
  createLocationDetectionResult,
  normalizeTrackingStatus,
} from "../../features/location/locationModels";
import defaultLocationRepository from "./locationRepository";

const CUSTOMER_LOCATION_REFRESH_MS = 120000;
const GPS_TIMEOUT_MS = 7000;
const CUSTOMER_DISTANCE_INTERVAL_M = 15;
const CUSTOMER_TIME_INTERVAL_MS = 12000;
const DRIVER_DISTANCE_INTERVAL_M = 8;
const DRIVER_TIME_INTERVAL_MS = 10000;
const DRIVER_MIN_WRITE_DISTANCE_M = 15;
const DRIVER_MIN_WRITE_INTERVAL_MS = 30000;
const DRIVER_WRITE_RETRY_MS = 12000;
const MAX_ACCEPTED_ACCURACY_M = 150;

function distanceMeters(a, b) {
  if (!a || !b) return Infinity;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(value));
}

function emitStatus(target, status) {
  try { target?.onStatus?.(normalizeTrackingStatus(status)); } catch (_) {}
}

/**
 * GPS watcher and policy layer. All storage and Firestore I/O is delegated to
 * the repository; this factory keeps timers and provider adapters injectable.
 */
export function createTrackingService({
  locationApi = Location,
  repository = defaultLocationRepository,
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout,
  logger = console,
} = {}) {
  let customerWatcherSubscription = null;
  let customerWatcherGeneration = 0;
  let driverWatcherSubscription = null;
  let driverWatcherGeneration = 0;
  let driverTarget = null;
  let driverWriteInFlight = false;
  let pendingDriverWrite = null;
  let lastDriverWrite = null;
  let driverRetryTimer = null;
  const lastProfileSyncByUid = new Map();

  async function flushDriverWrite() {
    if (driverWriteInFlight || !pendingDriverWrite) return;
    driverWriteInFlight = true;
    const payload = pendingDriverWrite;
    pendingDriverWrite = null;
    try {
      if (payload.generation !== driverWatcherGeneration) return;
      await repository.syncDriverLocation(payload);
      if (payload.generation !== driverWatcherGeneration) return;
      lastDriverWrite = { userId: payload.userId, coords: payload.coords, at: now() };
      emitStatus(driverTarget, "live");
    } catch (error) {
      const targetStillActive = payload.generation === driverWatcherGeneration && driverTarget?.generation === payload.generation;
      if (targetStillActive) {
        // Preserve a newer queued GPS sample if one arrived while this write ran.
        if (!pendingDriverWrite) pendingDriverWrite = payload;
        emitStatus(driverTarget, "connection-delayed");
        logger.warn("locationService: driver location sync is delayed:", error?.code || "network");
      }
      if (targetStillActive && !driverRetryTimer) {
        driverRetryTimer = schedule(() => {
          driverRetryTimer = null;
          if (pendingDriverWrite?.generation === driverWatcherGeneration) flushDriverWrite();
        }, DRIVER_WRITE_RETRY_MS);
      }
    } finally {
      driverWriteInFlight = false;
      if (pendingDriverWrite && pendingDriverWrite.generation === driverWatcherGeneration && !driverRetryTimer) {
        flushDriverWrite();
      }
    }
  }

  async function getCachedLocation() {
    return repository.getCachedCustomerLocation();
  }

  async function detectCurrentLocation({ forceFresh = false } = {}) {
    try {
      const enabled = await locationApi.hasServicesEnabledAsync().catch(() => true);
      const cached = await getCachedLocation();
      if (!enabled) return createLocationDetectionResult({ coords: cached, status: "disabled", error: "Location services are turned off on your device." });

      const { status } = await locationApi.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        return createLocationDetectionResult({
          coords: cached,
          status: status || "denied",
          error: "Location permission was denied. Choose a delivery location manually or allow location access in Settings.",
        });
      }

      if (!forceFresh) {
        try {
          const last = await locationApi.getLastKnownPositionAsync({ maxAge: CUSTOMER_LOCATION_REFRESH_MS });
          if (last?.coords && isWithinEthiopia(last.coords.latitude, last.coords.longitude) &&
              (!Number.isFinite(last.coords.accuracy) || last.coords.accuracy <= MAX_ACCEPTED_ACCURACY_M)) {
            const coordinate = normalizeEthiopiaCoordinate(last.coords);
            await repository.cacheCustomerLocation(coordinate);
            return createLocationDetectionResult({ coords: coordinate, status: "cached" });
          }
        } catch (_) {}
      }

      const getPosition = locationApi.getCurrentPositionAsync({ accuracy: locationApi.Accuracy.Balanced });
      let timeoutId;
      let position;
      try {
        position = await Promise.race([
          getPosition,
          new Promise((_, reject) => {
            timeoutId = schedule(() => reject(new Error("GPS lookup timed out.")), GPS_TIMEOUT_MS);
          }),
        ]);
      } finally {
        cancel(timeoutId);
      }
      if (position?.coords && isWithinEthiopia(position.coords.latitude, position.coords.longitude) &&
          (!Number.isFinite(position.coords.accuracy) || position.coords.accuracy <= MAX_ACCEPTED_ACCURACY_M)) {
        const coordinate = normalizeEthiopiaCoordinate(position.coords);
        await repository.cacheCustomerLocation(coordinate);
        return createLocationDetectionResult({ coords: coordinate, status: "granted" });
      }

      return createLocationDetectionResult({
        coords: cached,
        status: "stale",
        error: "A fresh, sufficiently accurate GPS location could not be confirmed. You can select a location manually.",
      });
    } catch (error) {
      return createLocationDetectionResult({
        coords: await getCachedLocation(),
        status: "error",
        error: error?.message || "Could not read your current location.",
      });
    }
  }

  async function startContinuousTracking(onLocationUpdate, { userId = null, onStatus } = {}) {
    // Customer GPS is kept separate from driver tracking and is never written to orders.
    void userId; // accepted for backward compatibility
    stopContinuousTracking();
    const generation = customerWatcherGeneration;
    emitStatus({ onStatus }, "requesting-permission");
    try {
      const currentPermission = await locationApi.getForegroundPermissionsAsync();
      if (currentPermission.status !== "granted") {
        const requestedPermission = await locationApi.requestForegroundPermissionsAsync();
        if (requestedPermission.status !== "granted") {
          emitStatus({ onStatus }, "permission-denied");
          return null;
        }
      }
      if (generation !== customerWatcherGeneration) return null;
      emitStatus({ onStatus }, "waiting-for-gps");
      const subscription = await locationApi.watchPositionAsync({
        accuracy: locationApi.Accuracy.Balanced,
        distanceInterval: CUSTOMER_DISTANCE_INTERVAL_M,
        timeInterval: CUSTOMER_TIME_INTERVAL_MS,
      }, (location) => {
        if (generation !== customerWatcherGeneration || !location?.coords) return;
        if (Number.isFinite(location.coords.accuracy) && location.coords.accuracy > MAX_ACCEPTED_ACCURACY_M) return;
        const coordinate = normalizeEthiopiaCoordinate(location.coords);
        if (!coordinate) return;
        repository.cacheCustomerLocation(coordinate).catch(() => {});
        emitStatus({ onStatus }, "live");
        if (typeof onLocationUpdate === "function") Promise.resolve(onLocationUpdate(coordinate)).catch(() => {});
      });
      if (generation !== customerWatcherGeneration) {
        subscription?.remove?.();
        return null;
      }
      customerWatcherSubscription = subscription;
      return subscription;
    } catch (error) {
      logger.warn("locationService: startContinuousTracking note:", error?.message);
      emitStatus({ onStatus }, "unavailable");
      return null;
    }
  }

  function stopContinuousTracking() {
    customerWatcherGeneration += 1;
    if (customerWatcherSubscription) {
      try { customerWatcherSubscription.remove(); } catch (_) {}
      customerWatcherSubscription = null;
    }
  }

  async function startDriverTracking(onLocationUpdate, { userId, orderId = null, onStatus } = {}) {
    stopDriverTracking();
    const generation = driverWatcherGeneration;
    driverTarget = { userId, orderId, onStatus, generation };
    if (!userId) return null;
    emitStatus(driverTarget, "requesting-permission");
    try {
      const enabled = await locationApi.hasServicesEnabledAsync().catch(() => true);
      if (!enabled) {
        emitStatus(driverTarget, "gps-disabled");
        return null;
      }
      let permission = await locationApi.getForegroundPermissionsAsync();
      if (permission.status !== "granted") permission = await locationApi.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        emitStatus(driverTarget, "permission-denied");
        return null;
      }
      if (generation !== driverWatcherGeneration) return null;
      emitStatus(driverTarget, "waiting-for-gps");
      const subscription = await locationApi.watchPositionAsync({
        accuracy: locationApi.Accuracy.High,
        distanceInterval: DRIVER_DISTANCE_INTERVAL_M,
        timeInterval: DRIVER_TIME_INTERVAL_MS,
      }, (location) => {
        if (generation !== driverWatcherGeneration || !location?.coords) return;
        const coordinate = normalizeEthiopiaCoordinate(location.coords);
        if (!coordinate || (Number.isFinite(location.coords.accuracy) && location.coords.accuracy > MAX_ACCEPTED_ACCURACY_M)) return;
        const gpsFix = createGpsFix(location, { source: "device", capturedAtMs: now() });
        const sample = {
          ...gpsFix,
          heading: Number.isFinite(location.coords.heading) && location.coords.heading >= 0 ? location.coords.heading : null,
          speed: Number.isFinite(location.coords.speed) && location.coords.speed >= 0 ? location.coords.speed : null,
          updatedAt: gpsFix.capturedAtMs,
        };
        if (typeof onLocationUpdate === "function") Promise.resolve(onLocationUpdate(sample)).catch(() => {});

        const previous = lastDriverWrite?.userId === userId ? lastDriverWrite : null;
        if (previous && distanceMeters(previous.coords, coordinate) < DRIVER_MIN_WRITE_DISTANCE_M &&
            now() - previous.at < DRIVER_MIN_WRITE_INTERVAL_MS) return;
        pendingDriverWrite = { userId, orderId, generation, coords: coordinate, heading: sample.heading, speed: sample.speed };
        if (!previous) lastDriverWrite = { userId, coords: coordinate, at: now() - DRIVER_MIN_WRITE_INTERVAL_MS };
        flushDriverWrite();
      });

      if (generation !== driverWatcherGeneration) {
        subscription?.remove?.();
        return null;
      }
      driverWatcherSubscription = subscription;
      return subscription;
    } catch (error) {
      logger.warn("locationService: driver tracking unavailable:", error?.code || "location");
      emitStatus(driverTarget, "unavailable");
      return null;
    }
  }

  function stopDriverTracking() {
    driverWatcherGeneration += 1;
    driverTarget = null;
    pendingDriverWrite = null;
    if (driverRetryTimer) {
      cancel(driverRetryTimer);
      driverRetryTimer = null;
    }
    if (driverWatcherSubscription) {
      try { driverWatcherSubscription.remove?.(); } catch (_) {}
      driverWatcherSubscription = null;
    }
  }

  async function syncLocationToProfile(userId, coords, address) {
    const coordinate = normalizeEthiopiaCoordinate(coords);
    if (!userId || !coordinate) return;
    const normalizedAddress = address || "Ethiopia";
    const timestamp = now();
    const previous = lastProfileSyncByUid.get(userId);
    if (previous && previous.address === normalizedAddress &&
        distanceMeters(previous.coords, coordinate) < 75 && timestamp - previous.at < 60000) return;
    try {
      await repository.syncCustomerLocationToProfile(userId, coordinate, normalizedAddress);
      lastProfileSyncByUid.set(userId, { coords: coordinate, address: normalizedAddress, at: timestamp });
    } catch (error) {
      logger.warn("locationService: syncLocationToProfile note:", error?.message);
    }
  }

  return {
    getCachedLocation,
    detectCurrentLocation,
    startContinuousTracking,
    stopContinuousTracking,
    startDriverTracking,
    stopDriverTracking,
    syncLocationToProfile,
  };
}

export const trackingService = createTrackingService();
export default trackingService;
