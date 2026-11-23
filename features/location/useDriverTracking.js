import { useEffect, useState } from "react";
import { useIsFocused } from "@react-navigation/native";
import trackingService from "../../services/location/trackingService";

/**
 * Owns driver tracking lifecycle and view state. The tracking service remains
 * responsible for GPS policy, throttling, retry, and Firestore persistence.
 */
export function useDriverTracking({
  userId,
  isOnline,
  activeOrderId = null,
  initialLocation = null,
  initialUpdatedAtMs = 0,
} = {}) {
  const isFocused = useIsFocused();
  const [driverLocationState, setDriverLocationState] = useState(() => ({
    userId,
    position: initialLocation || null,
    updatedAtMs: initialUpdatedAtMs || 0,
  }));
  const [gpsActive, setGpsActive] = useState(false);
  const [locationTrackingStatus, setLocationTrackingStatus] = useState("idle");
  const driverPos = driverLocationState.userId === userId ? driverLocationState.position : initialLocation || null;
  const driverLocationUpdatedAtMs = driverLocationState.userId === userId
    ? driverLocationState.updatedAtMs
    : initialUpdatedAtMs || 0;

  useEffect(() => {
    let active = true;
    const shouldTrack = Boolean(userId) && (isOnline === true || Boolean(activeOrderId));
    if (!isFocused || !shouldTrack) {
      setGpsActive(false);
      setLocationTrackingStatus("idle");
      trackingService.stopDriverTracking();
      return undefined;
    }

    setLocationTrackingStatus("requesting-permission");
    trackingService.startDriverTracking(
      (sample) => {
        if (!active) return;
        setDriverLocationState({
          userId,
          position: { latitude: sample.latitude, longitude: sample.longitude },
          updatedAtMs: sample.updatedAt,
        });
      },
      {
        userId,
        orderId: activeOrderId,
        onStatus: (status) => {
          if (!active) return;
          setLocationTrackingStatus(status);
          setGpsActive(status === "live");
        },
      }
    );
    return () => {
      active = false;
      trackingService.stopDriverTracking();
    };
  }, [userId, isOnline, activeOrderId, isFocused]);

  return { driverPos, gpsActive, locationTrackingStatus, driverLocationUpdatedAtMs };
}

export default useDriverTracking;
