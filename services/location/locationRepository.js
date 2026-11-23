import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { normalizeEthiopiaCoordinate } from "../../utils/coordinates";

const CUSTOMER_LOCATION_CACHE_KEY = "@mytruck_cached_customer_location";

/** Persistence boundary for location data; timing and watcher policy live elsewhere. */
export function createLocationRepository({
  storage = AsyncStorage,
  firestore = { doc, serverTimestamp, setDoc, updateDoc },
  firestoreDb = db,
} = {}) {
  async function getCachedCustomerLocation() {
    try {
      const raw = await storage.getItem(CUSTOMER_LOCATION_CACHE_KEY);
      if (!raw) return null;
      return normalizeEthiopiaCoordinate(JSON.parse(raw));
    } catch (_) {
      return null;
    }
  }

  async function cacheCustomerLocation(coords) {
    const coordinate = normalizeEthiopiaCoordinate(coords);
    if (!coordinate) return false;
    try {
      await storage.setItem(CUSTOMER_LOCATION_CACHE_KEY, JSON.stringify(coordinate));
      return true;
    } catch (_) {
      return false;
    }
  }

  async function syncCustomerLocationToProfile(userId, coords, address) {
    const coordinate = normalizeEthiopiaCoordinate(coords);
    if (!userId || !coordinate) return false;
    const payload = {
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      address: address || "Ethiopia",
      lastLocationUpdate: firestore.serverTimestamp(),
    };
    await Promise.all([
      firestore.setDoc(firestore.doc(firestoreDb, "user", userId), { ...payload, updatedAt: firestore.serverTimestamp() }, { merge: true }),
      firestore.setDoc(firestore.doc(firestoreDb, "users", userId), { ...payload, updatedAt: firestore.serverTimestamp() }, { merge: true }),
    ]);
    return true;
  }

  async function syncDriverLocation({ userId, orderId = null, coords, heading = null, speed = null }) {
    const coordinate = normalizeEthiopiaCoordinate(coords);
    if (!userId || !coordinate) return false;
    const profileFields = {
      driverLat: coordinate.latitude,
      driverLng: coordinate.longitude,
      driverLocationUpdatedAt: firestore.serverTimestamp(),
    };
    const writes = [firestore.updateDoc(firestore.doc(firestoreDb, "user", userId), profileFields)];
    if (orderId) {
      const orderFields = {
        driverLat: coordinate.latitude,
        driverLng: coordinate.longitude,
        ...(Number.isFinite(heading) && heading >= 0 ? { driverHeading: heading } : {}),
        ...(Number.isFinite(speed) && speed >= 0 ? { driverSpeed: speed } : {}),
        driverLocationUpdatedAt: firestore.serverTimestamp(),
      };
      writes.push(firestore.updateDoc(firestore.doc(firestoreDb, "orders", orderId), orderFields));
    }
    await Promise.all(writes);
    return true;
  }

  return { getCachedCustomerLocation, cacheCustomerLocation, syncCustomerLocationToProfile, syncDriverLocation };
}

const locationRepository = createLocationRepository();
export default locationRepository;
