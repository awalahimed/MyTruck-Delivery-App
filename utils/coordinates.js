/** Pure coordinate helpers shared by maps and location services. */
export function isWithinEthiopia(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= 3.0 && lat <= 15.0 && lon >= 33.0 && lon <= 48.0;
}

/** Normalize supported-area coordinates into the app's { latitude, longitude } shape. */
export function normalizeEthiopiaCoordinate(value) {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);
  return isWithinEthiopia(latitude, longitude) ? { latitude, longitude } : null;
}
