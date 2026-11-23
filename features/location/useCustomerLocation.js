import { useEffect, useRef } from "react";
import { useIsFocused } from "@react-navigation/native";
import trackingService from "../../services/location/trackingService";
import { reverseGeocodeLocation } from "../../services/maps/geocodingService";

function distanceMeters(a, b) {
  if (!a || !b) return Infinity;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}

/**
 * Starts customer location detection and foreground tracking only while this
 * screen is focused. Tracking/repository services retain GPS and persistence policy.
 */
export function useCustomerLocation({ userId, onLocationChange, onAddressChange } = {}) {
  const isFocused = useIsFocused();
  const onLocationChangeRef = useRef(onLocationChange);
  const onAddressChangeRef = useRef(onAddressChange);
  const lastGeocodedLocationRef = useRef(null);
  onLocationChangeRef.current = onLocationChange;
  onAddressChangeRef.current = onAddressChange;

  useEffect(() => {
    if (!isFocused) {
      trackingService.stopContinuousTracking();
      return undefined;
    }

    let active = true;
    const publishAddress = (address, coords) => {
      if (!active || !address) return;
      onAddressChangeRef.current?.(address, coords);
    };

    const setup = async () => {
      try {
        const result = await trackingService.detectCurrentLocation();
        if (!active) return;
        if (result?.coords) {
          onLocationChangeRef.current?.(result.coords);
          reverseGeocodeLocation(result.coords.latitude, result.coords.longitude)
            .then((address) => {
              publishAddress(address, result.coords);
              if (active && result.status === "granted") {
                lastGeocodedLocationRef.current = { ...result.coords, at: Date.now() };
                if (userId) trackingService.syncLocationToProfile(userId, result.coords, address);
              }
            })
            .catch(() => {});
        }

        await trackingService.startContinuousTracking(async (coords) => {
          if (!active) return;
          onLocationChangeRef.current?.(coords);

          const previous = lastGeocodedLocationRef.current;
          const elapsedMs = previous ? Date.now() - previous.at : Infinity;
          if (distanceMeters(previous, coords) < 75 && elapsedMs < 60000) return;

          try {
            const address = await reverseGeocodeLocation(coords.latitude, coords.longitude);
            if (!active || !address) return;
            lastGeocodedLocationRef.current = { ...coords, at: Date.now() };
            publishAddress(address, coords);
            if (userId) trackingService.syncLocationToProfile(userId, coords, address);
          } catch (_) {}
        }, { userId });
      } catch (_) {
        // Tracking service reports GPS errors through its existing status path.
      }
    };

    setup();
    return () => {
      active = false;
      trackingService.stopContinuousTracking();
    };
  }, [isFocused, userId]);
}

export default useCustomerLocation;
