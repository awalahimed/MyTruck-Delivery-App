import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, updateDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import {
  DEFAULT_COORDS,
  isWithinEthiopia,
  reverseGeocodeLocation,
} from "../utils/mapService";

const LOCATION_CACHE_KEY = "@mytruck_cached_customer_location";
let activeWatcherSubscription = null;
let lastKnownLocation = null;

/**
 * Service to manage automatic customer location detection,
 * continuous background/foreground tracking, permission lifecycle,
 * and seamless synchronization with Firebase & Redux.
 */
export const locationService = {
  /**
   * Fast-path: get cached coordinates from storage (< 5ms)
   */
  async getCachedLocation() {
    try {
      const raw = await AsyncStorage.getItem(LOCATION_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (isWithinEthiopia(parsed.latitude, parsed.longitude)) {
          return parsed;
        }
      }
    } catch (_) {}
    return null;
  },

  /**
   * Request permissions and retrieve accurate GPS coordinates automatically.
   * Handles: granted, denied, permanently denied, and service disabled.
   */
  async detectCurrentLocation({ forceFresh = false } = {}) {
    try {
      // 1. Check services enabled
      const enabled = await Location.hasServicesEnabledAsync().catch(() => true);
      if (!enabled) {
        return {
          coords: DEFAULT_COORDS,
          status: "disabled",
          error: "Location services are turned off on your device.",
        };
      }

      // 2. Request foreground permissions
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        return {
          coords: DEFAULT_COORDS,
          status: status || "denied",
          error: "Location permission not granted. Using default Addis Ababa location.",
        };
      }

      // 3. Fast-path: last known position if not forcing fresh
      if (!forceFresh) {
        try {
          const last = await Location.getLastKnownPositionAsync();
          if (
            last &&
            last.coords &&
            isWithinEthiopia(last.coords.latitude, last.coords.longitude)
          ) {
            const locObj = {
              latitude: Number(last.coords.latitude),
              longitude: Number(last.coords.longitude),
            };
            lastKnownLocation = locObj;
            AsyncStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(locObj)).catch(() => {});
            return { coords: locObj, status: "granted", error: null };
          }
        } catch (_) {}
      }

      // 4. Retrieve fresh GPS position with 7-second safe timeout
      const getPosPromise = Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const timeoutPromise = new Promise((resolve) =>
        setTimeout(() => resolve(null), 7000)
      );

      const pos = await Promise.race([getPosPromise, timeoutPromise]);
      if (
        pos &&
        pos.coords &&
        isWithinEthiopia(pos.coords.latitude, pos.coords.longitude)
      ) {
        const locObj = {
          latitude: Number(pos.coords.latitude),
          longitude: Number(pos.coords.longitude),
        };
        lastKnownLocation = locObj;
        AsyncStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(locObj)).catch(() => {});
        return { coords: locObj, status: "granted", error: null };
      }

      // Fallback to cached or default
      const cached = await this.getCachedLocation();
      return {
        coords: cached || DEFAULT_COORDS,
        status: "granted",
        error: null,
      };
    } catch (err) {
      console.warn("locationService: detectCurrentLocation error:", err?.message);
      const cached = await this.getCachedLocation();
      return {
        coords: cached || DEFAULT_COORDS,
        status: "error",
        error: err?.message,
      };
    }
  },

  /**
   * Start continuous location watching while customer is actively using the app.
   * Optimizes battery usage: Balanced accuracy, 15m distance threshold, 12s interval.
   */
  async startContinuousTracking(onLocationUpdate, { userId = null } = {}) {
    // Stop any existing subscription first
    this.stopContinuousTracking();

    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") {
        const req = await Location.requestForegroundPermissionsAsync();
        if (req.status !== "granted") return null;
      }

      activeWatcherSubscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 15, // Update every 15 meters
          timeInterval: 12000,   // Update every 12 seconds
        },
        async (location) => {
          if (!location?.coords) return;
          const { latitude, longitude } = location.coords;

          if (!isWithinEthiopia(latitude, longitude)) return;

          const newCoords = {
            latitude: Number(latitude),
            longitude: Number(longitude),
          };

          lastKnownLocation = newCoords;
          AsyncStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(newCoords)).catch(() => {});

          // Synchronize to Firebase user document if authenticated
          if (userId) {
            try {
              await updateDoc(doc(db, "user", userId), {
                latitude: newCoords.latitude,
                longitude: newCoords.longitude,
                lastLocationUpdate: new Date(),
              });
              await updateDoc(doc(db, "users", userId), {
                latitude: newCoords.latitude,
                longitude: newCoords.longitude,
                lastLocationUpdate: new Date(),
              }).catch(() => {});
            } catch (_) {}
          }

          if (typeof onLocationUpdate === "function") {
            onLocationUpdate(newCoords);
          }
        }
      );

      return activeWatcherSubscription;
    } catch (err) {
      console.warn("locationService: startContinuousTracking note:", err?.message);
      return null;
    }
  },

  /**
   * Stop continuous location watcher to conserve battery
   */
  stopContinuousTracking() {
    if (activeWatcherSubscription) {
      try {
        activeWatcherSubscription.remove();
      } catch (_) {}
      activeWatcherSubscription = null;
    }
  },

  /**
   * Synchronize detected location with address string to Firebase & Redux
   */
  async syncLocationToProfile(userId, coords, address) {
    if (!userId || !coords) return;
    try {
      const payload = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        address: address || "Ethiopia",
        updatedAt: new Date(),
      };
      await setDoc(doc(db, "user", userId), payload, { merge: true });
      await setDoc(doc(db, "users", userId), payload, { merge: true });
    } catch (e) {
      console.warn("locationService: syncLocationToProfile note:", e?.message);
    }
  },
};

export default locationService;

