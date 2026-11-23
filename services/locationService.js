/**
 * Temporary compatibility facade. New code may import from
 * services/location/trackingService; repository I/O stays behind that service.
 */
import trackingService from "./location/trackingService";

export const locationService = trackingService;
export default locationService;
