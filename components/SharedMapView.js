import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { DEFAULT_COORDS, getRoute, straightLineKm } from "../utils/mapService";

const TEAL = "#179B83";
const ORANGE = "#F47721";
const BLUE = "#2563EB";
const DARK = "#0B2A26";

/** Accepts { latitude, longitude, ...deltas } and returns a complete region, or null. */
const toRegion = (r) => {
  const lat = Number(r?.latitude);
  const lng = Number(r?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    latitude: lat,
    longitude: lng,
    latitudeDelta: Number(r.latitudeDelta) || 0.015,
    longitudeDelta: Number(r.longitudeDelta) || 0.015,
  };
};

/**
 * Map for MyTruck — native Google Maps (Android) via react-native-maps.
 *
 * mode "picker": a fixed pin sits in the middle; moving the map reports the centre
 *                through onLocationChange (used to choose a delivery address).
 * mode "route":  draws the real road route from routeFrom → routeTo (or origin → destination),
 *                shows its distance and travel time, and an optional live driver marker.
 *                Falls back to a straight line if the route service is unavailable.
 */
const SharedMapView = forwardRef(function SharedMapView(
  {
    style,
    initialRegion,
    region,
    mode = "picker",
    origin,
    destination,
    routeFrom,
    routeTo,
    driverLocation,
    orderStatus,
    onPress,
    onRegionChangeComplete,
    onLocationChange,
    onRouteInfo,
    showControls = true,
    onRecenter,
    recenterLoading = false,
    // locked: the map only shows a location; touching it can't move or change anything
    locked = false,
    children,
    ...rest
  },
  ref
) {
  const mapRef = useRef(null);
  const [route, setRoute] = useState(null); // { points, distanceKm, etaMinutes, source }
  const [routing, setRouting] = useState(false);
  const onRouteInfoRef = useRef(onRouteInfo);
  onRouteInfoRef.current = onRouteInfo;

  // routeFrom === null means "start point unknown yet" (e.g. no GPS fix): draw no route rather than a wrong one
  const from = routeFrom !== undefined ? routeFrom : origin;
  const to = routeTo !== undefined && routeTo !== null ? routeTo : destination;
  const isRoute = mode === "route" || Boolean(from && to);

  // Re-route only when a point has moved noticeably (≈100 m), so live driver updates don't spam the route service.
  const routeKey =
    isRoute && toRegion(from) && toRegion(to)
      ? `${Number(from.latitude).toFixed(3)},${Number(from.longitude).toFixed(3)}>${Number(to.latitude).toFixed(3)},${Number(to.longitude).toFixed(3)}`
      : null;

  useImperativeHandle(ref, () => ({
    animateToRegion: (r, duration = 600) => {
      const next = toRegion(r);
      if (next) mapRef.current?.animateToRegion(next, duration);
    },
    fitToCoordinates: (coords, opts) => {
      if (coords?.length) mapRef.current?.fitToCoordinates(coords, opts);
    },
    toggleLayer: () => {},
  }));

  useEffect(() => {
    if (!routeKey) {
      setRoute(null);
      setRouting(false);
      return undefined;
    }
    let alive = true;
    setRouting(true);
    (async () => {
      const real = await getRoute(from, to);
      if (!alive) return;
      let info;
      if (real) {
        info = { ...real, source: "road" };
      } else {
        // Straight-line fallback: same rough travel-time rule the app already uses for estimates
        const km = straightLineKm(from.latitude, from.longitude, to.latitude, to.longitude) || 0;
        info = {
          points: [toRegion(from), toRegion(to)],
          distanceKm: km,
          etaMinutes: Math.max(15, Math.round(15 + km * 2.5)),
          source: "straight",
        };
      }
      setRoute(info);
      setRouting(false);
      onRouteInfoRef.current?.({ distanceKm: info.distanceKm, etaMinutes: info.etaMinutes, source: info.source });
      if (info.points?.length > 1) {
        mapRef.current?.fitToCoordinates(info.points, {
          edgePadding: { top: 70, right: 50, bottom: 70, left: 50 },
          animated: true,
        });
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  const handleRegionChangeComplete = (r) => {
    if (locked) return;
    const c = { latitude: r.latitude, longitude: r.longitude };
    onLocationChange?.(c);
    onRegionChangeComplete?.(c);
  };

  const handlePress = (e) => {
    if (locked) return;
    const c = e?.nativeEvent?.coordinate;
    if (c && mode !== "route") mapRef.current?.animateToRegion({ ...c, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 400);
    onPress?.(e);
  };

  const activeRegion = toRegion(region) || toRegion(initialRegion) || toRegion(DEFAULT_COORDS);
  const routeColor = route?.source === "road" ? TEAL : "#64748B";

  return (
    <View style={[styles.container, style]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        initialRegion={activeRegion}
        showsUserLocation={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        onPress={handlePress}
        onRegionChangeComplete={handleRegionChangeComplete}
        {...rest}
        {...(locked ? { scrollEnabled: false, zoomEnabled: false, rotateEnabled: false, pitchEnabled: false } : {})}
      >
        {isRoute && toRegion(from) ? (
          <Marker coordinate={toRegion(from)} title={from.title || "Pickup"} pinColor={TEAL} />
        ) : null}
        {isRoute && toRegion(to) ? (
          <Marker coordinate={toRegion(to)} title={to.title || "Drop-off"} pinColor={ORANGE} />
        ) : null}
        {toRegion(driverLocation) ? (
          <Marker
            coordinate={toRegion(driverLocation)}
            title={driverLocation.title || "Your driver"}
            pinColor={BLUE}
          />
        ) : null}
        {route?.points?.length > 1 ? (
          <Polyline coordinates={route.points} strokeColor={routeColor} strokeWidth={5} />
        ) : null}
        {children}
      </MapView>

      {!isRoute && (
        <View pointerEvents="none" style={styles.centerPin}>
          <MaterialCommunityIcons name="map-marker" size={44} color={ORANGE} />
        </View>
      )}

      {isRoute && (
        <View pointerEvents="none" style={styles.badge}>
          <MaterialCommunityIcons name="map-marker-distance" size={14} color={DARK} />
          <Text style={styles.badgeTxt}>
            {route
              ? `${route.distanceKm} km · ${route.etaMinutes} min${route.source === "straight" ? " (straight line)" : " by road"}`
              : !from
              ? "Turn on location to see your route"
              : routing
              ? "Finding the road route…"
              : "Route unavailable"}
          </Text>
        </View>
      )}

      {showControls && onRecenter ? (
        <TouchableOpacity
          style={styles.recenter}
          onPress={onRecenter}
          disabled={recenterLoading}
          accessibilityRole="button"
          accessibilityLabel="Use my current location"
          activeOpacity={0.8}
        >
          {recenterLoading ? (
            <ActivityIndicator size="small" color={TEAL} />
          ) : (
            <MaterialCommunityIcons name="crosshairs-gps" size={22} color={TEAL} />
          )}
        </TouchableOpacity>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: "100%",
    position: "relative",
    backgroundColor: "#F1F5F9",
    overflow: "hidden",
  },
  centerPin: {
    position: "absolute",
    top: "50%",
    left: "50%",
    marginLeft: -22,
    marginTop: -44,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: 10,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  badgeTxt: { fontSize: 12, fontWeight: "700", color: DARK },
  recenter: {
    position: "absolute",
    right: 12,
    bottom: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
});

export default SharedMapView;
