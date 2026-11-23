/**
 * Temporary map compatibility facade.
 * New code should import from services/maps/routingService or geocodingService.
 * GPS compatibility exports remain here until remaining call sites migrate.
 */
export { isWithinEthiopia } from "./coordinates";
export { getRealGpsLocation, requestGpsLocation } from "../services/gpsService";

export { ADDIS_DELIVERY_ZONES, reverseGeocodeLocation, reverseGeocodeResult, searchLocalPlaces, searchPlaces } from "../services/maps/geocodingService";
export {
  decodePolyline,
  getRoute,
  getStraightLineRouteEstimate,
  isValidRoutePoint,
  straightLineKm,
} from "../services/maps/routingService";

export const DEFAULT_COORDS = {
  latitude: 8.9806,
  longitude: 38.7578,
  latitudeDelta: 0.015,
  longitudeDelta: 0.015,
};
