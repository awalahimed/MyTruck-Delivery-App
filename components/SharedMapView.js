import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ActivityIndicator, AppState, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import * as Location from "expo-location";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { DEFAULT_COORDS, getRoute, straightLineKm } from "../utils/mapService";

const TEAL = "#179B83";
const ORANGE = "#F47721";
const BLUE = "#2563EB";
const DARK = "#0B2A26";

const toRegion = (value) => {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude,
    longitude,
    latitudeDelta: Number(value?.latitudeDelta) || 0.015,
    longitudeDelta: Number(value?.longitudeDelta) || 0.015,
  };
};

const toCoordinate = (value) => {
  const region = toRegion(value);
  return region ? { latitude: region.latitude, longitude: region.longitude } : null;
};

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
    onPress,
    onRegionChangeComplete,
    onLocationChange,
    onRouteInfo,
    showControls = true,
    onRecenter,
    recenterLoading = false,
    children,
  },
  ref
) {
  const mapRef = useRef(null);
  const [route, setRoute] = useState(null);
  const [routing, setRouting] = useState(false);
  const [hasLocationPermission, setHasLocationPermission] = useState(false);
  const onRouteInfoRef = useRef(onRouteInfo);
  onRouteInfoRef.current = onRouteInfo;

  useEffect(() => {
    let active = true;
    let subscription;
    const check = async () => {
      try {
        const result = await Location.getForegroundPermissionsAsync();
        if (active) setHasLocationPermission(result?.granted === true);
      } catch (_) {}
    };
    check();
    if (typeof AppState?.addEventListener === "function") {
      subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") check();
      });
    }
    return () => {
      active = false;
      subscription?.remove?.();
    };
  }, []);

  const from = routeFrom !== undefined ? routeFrom : origin;
  const to = routeTo !== undefined && routeTo !== null ? routeTo : destination;
  const isRoute = mode === "route" || Boolean(from && to);
  const routeKey =
    isRoute && toCoordinate(from) && toCoordinate(to)
      ? `${Number(from.latitude).toFixed(3)},${Number(from.longitude).toFixed(3)}>${Number(to.latitude).toFixed(3)},${Number(to.longitude).toFixed(3)}`
      : null;
  const activeRegion = toRegion(region) || toRegion(initialRegion) || toRegion(DEFAULT_COORDS);

  useImperativeHandle(
    ref,
    () => ({
      animateToRegion: (next, duration = 600) => {
        const normalized = toRegion(next);
        if (normalized) mapRef.current?.animateToRegion(normalized, duration);
      },
      fitToCoordinates: (coords, options) => {
        if (coords?.length) mapRef.current?.fitToCoordinates(coords, options);
      },
      toggleLayer: () => {},
    }),
    []
  );

  useEffect(() => {
    if (!routeKey) {
      setRoute(null);
      setRouting(false);
      return undefined;
    }
    let active = true;
    setRouting(true);
    (async () => {
      const realRoute = await getRoute(from, to);
      if (!active) return;
      const km =
        realRoute?.distanceKm ??
        straightLineKm(from.latitude, from.longitude, to.latitude, to.longitude) ??
        0;
      const next = {
        points: realRoute?.points || [toCoordinate(from), toCoordinate(to)].filter(Boolean),
        distanceKm: km,
        etaMinutes: realRoute?.etaMinutes ?? Math.max(15, Math.round(15 + km * 2.5)),
        source: realRoute?.source || (realRoute ? "road" : "straight"),
      };
      setRoute(next);
      setRouting(false);
      onRouteInfoRef.current?.({
        distanceKm: next.distanceKm,
        etaMinutes: next.etaMinutes,
        source: next.source,
      });
      if (next.points.length > 1) {
        mapRef.current?.fitToCoordinates(next.points, {
          edgePadding: { top: 70, right: 50, bottom: 70, left: 50 },
          animated: true,
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [routeKey]);

  const handleRegionComplete = (next) => {
    const coords = { latitude: next.latitude, longitude: next.longitude };
    onLocationChange?.(coords);
    onRegionChangeComplete?.(coords);
  };

  const handleMapPress = (event) => {
    const coords = event?.nativeEvent?.coordinate;
    if (coords && Number.isFinite(coords.latitude) && Number.isFinite(coords.longitude) && !isRoute) {
      mapRef.current?.animateToRegion(
        {
          latitude: coords.latitude,
          longitude: coords.longitude,
          latitudeDelta: activeRegion?.latitudeDelta || 0.015,
          longitudeDelta: activeRegion?.longitudeDelta || 0.015,
        },
        300
      );
      handleRegionComplete(coords);
    }
    onPress?.(event);
  };

  const routeColor = route?.source === "road" || route?.source === "google" ? TEAL : "#64748B";

  return (
    <View style={[styles.container, style]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        mapType="standard"
        showsBuildings={true}
        showsIndoors={true}
        showsCompass={true}
        showsScale={true}
        loadingEnabled={true}
        loadingIndicatorColor={TEAL}
        loadingBackgroundColor="#F8FAFC"
        initialRegion={activeRegion}
        region={toRegion(region) || undefined}
        showsUserLocation={hasLocationPermission}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        onPress={handleMapPress}
        onRegionChangeComplete={handleRegionComplete}
      >
        {isRoute && toCoordinate(from) ? (
          <Marker
            coordinate={toCoordinate(from)}
            title={from.title || "Pickup"}
            pinColor={TEAL}
          />
        ) : null}
        {isRoute && toCoordinate(to) ? (
          <Marker
            coordinate={toCoordinate(to)}
            title={to.title || "Drop-off"}
            pinColor={ORANGE}
          />
        ) : null}
        {toCoordinate(driverLocation) ? (
          <Marker
            coordinate={toCoordinate(driverLocation)}
            title={driverLocation.title || "Your driver"}
            pinColor={BLUE}
          />
        ) : null}
        {route?.points?.length > 1 ? (
          <Polyline
            coordinates={route.points}
            strokeColor={routeColor}
            strokeWidth={5}
          />
        ) : null}
        {children}
      </MapView>

      {!isRoute ? (
        <View pointerEvents="none" style={styles.centerPin}>
          <View style={styles.pinTooltip}>
            <Text style={styles.pinTooltipTxt}>Delivery Location</Text>
          </View>
          <MaterialCommunityIcons name="map-marker" size={46} color={ORANGE} />
          <View style={styles.pinDot} />
        </View>
      ) : null}
      {isRoute ? (
        <View pointerEvents="none" style={styles.badge}>
          <MaterialCommunityIcons name="map-marker-distance" size={14} color={DARK} />
          <Text style={styles.badgeTxt}>
            {route
              ? `${route.distanceKm} km · ${route.etaMinutes} min${
                  route.source === "google"
                    ? " by Google Maps"
                    : route.source === "road"
                    ? " by road"
                    : " (straight line)"
                }`
              : !from
              ? "Turn on location to see your route"
              : routing
              ? "Finding the road route…"
              : "Route unavailable"}
          </Text>
        </View>
      ) : null}
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
  container: { flex: 1, overflow: "hidden", backgroundColor: "#E8EEF3" },
  centerPin: {
    position: "absolute",
    left: "50%",
    top: "50%",
    marginLeft: -60,
    marginTop: -68,
    width: 120,
    alignItems: "center",
  },
  pinTooltip: {
    backgroundColor: DARK,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    marginBottom: 2,
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  pinTooltipTxt: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  pinDot: {
    width: 8,
    height: 4,
    borderRadius: 4,
    backgroundColor: "rgba(0,0,0,0.25)",
    marginTop: -3,
  },
  recenter: {
    position: "absolute",
    right: 16,
    bottom: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "white",
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  badge: {
    position: "absolute",
    top: 12,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.94)",
    elevation: 3,
  },
  badgeTxt: { color: DARK, fontSize: 12, fontWeight: "700" },
});

export default SharedMapView;
