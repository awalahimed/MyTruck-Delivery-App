import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ActivityIndicator, AppState, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Constants from "expo-constants";
import * as Location from "expo-location";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { DEFAULT_COORDS } from "../utils/mapService";
import { getRoute, getStraightLineRouteEstimate, isValidRoutePoint } from "../services/maps/routingService";

const TEAL = "#179B83";
const ORANGE = "#F47721";
const BLUE = "#2563EB";
const DARK = "#0B2A26";
const MAP_READY_TIMEOUT_MS = 15000;
const isExpoGo = Constants.appOwnership === "expo" || Constants.executionEnvironment === "storeClient";
const mapConfig = Constants.expoConfig?.extra?.maps || Constants.manifest?.extra?.maps || {};
const androidGoogleMapsConfigured = mapConfig.androidKeyConfigured === true;
const missingAndroidKey = Platform.OS === "android" && !isExpoGo && !androidGoogleMapsConfigured;

const toRegion = (value) => {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);
  if (!isValidRoutePoint({ latitude, longitude })) return null;
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

const MapPin = ({ color, name }) => (
  <View style={styles.marker} collapsable={false}>
    <MaterialCommunityIcons name={name} size={36} color={color} />
  </View>
);

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
    selectedCoordinate,
    onMarkerDragEnd,
    onUserPan,
    onRouteInfo,
    showControls = true,
    onRecenter,
    recenterLoading = false,
    locked = false,
    children,
  },
  ref
) {
  const mapRef = useRef(null);
  const [route, setRoute] = useState(null);
  const [routing, setRouting] = useState(false);
  const [hasLocationPermission, setHasLocationPermission] = useState(false);
  const [driverMarkerPosition, setDriverMarkerPosition] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState(null);
  // Measured size of the container. On React Native 0.88 (New Architecture) the
  // native Google map got 0px height from absoluteFill and stayed invisible, so
  // the MapView is given an explicit width/height from this measurement.
  const [mapBox, setMapBox] = useState(null);
  const previousDriverCoordinate = useRef(null);
  const animationFrame = useRef(null);
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

  useEffect(() => () => {
    if (animationFrame.current != null) cancelAnimationFrame(animationFrame.current);
  }, []);

  // Two separate checks so the on-screen message says where the map stopped:
  // never started (native map view problem) vs started but no tiles arrived
  // (Google refused the key: Maps SDK disabled, billing, or key restrictions).
  useEffect(() => {
    if (missingAndroidKey || mapLoaded) return undefined;
    const timer = setTimeout(() => {
      setMapError(
        mapReady
          ? "The map started, but Google sent no map tiles. Check that Maps SDK for Android is enabled, billing is active, and the key allows this app."
          : "The map could not start on this phone. Check your internet connection and that Google Play services is up to date."
      );
    }, MAP_READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [missingAndroidKey, mapReady, mapLoaded]);

  const from = routeFrom !== undefined ? routeFrom : origin;
  const to = routeTo !== undefined && routeTo !== null ? routeTo : destination;
  const isRoute = mode === "route" || Boolean(from && to);
  const routeKey = isRoute && isValidRoutePoint(from) && isValidRoutePoint(to)
    ? `${from.latitude.toFixed(3)},${from.longitude.toFixed(3)}>${to.latitude.toFixed(3)},${to.longitude.toFixed(3)}`
    : null;
  const activeRegion = toRegion(region) || toRegion(initialRegion) || toRegion(DEFAULT_COORDS);
  const pickerCoordinate = toCoordinate(selectedCoordinate) || toCoordinate(activeRegion);
  const driverCoordinate = toCoordinate(driverLocation);
  const pickupCoordinate = toCoordinate(origin) || toCoordinate(from);
  const dropoffCoordinate = toCoordinate(destination) || toCoordinate(to);

  useEffect(() => {
    if (!driverCoordinate) {
      if (animationFrame.current != null) cancelAnimationFrame(animationFrame.current);
      animationFrame.current = null;
      previousDriverCoordinate.current = null;
      setDriverMarkerPosition(null);
      return undefined;
    }
    const previous = previousDriverCoordinate.current;
    previousDriverCoordinate.current = driverCoordinate;
    if (!previous) {
      setDriverMarkerPosition(driverCoordinate);
      return undefined;
    }
    if (previous.latitude === driverCoordinate.latitude && previous.longitude === driverCoordinate.longitude) return undefined;
    if (animationFrame.current != null) cancelAnimationFrame(animationFrame.current);
    const startedAt = Date.now();
    const animate = () => {
      const progress = Math.min(1, (Date.now() - startedAt) / 900);
      const eased = progress * (2 - progress);
      setDriverMarkerPosition({
        latitude: previous.latitude + (driverCoordinate.latitude - previous.latitude) * eased,
        longitude: previous.longitude + (driverCoordinate.longitude - previous.longitude) * eased,
      });
      if (progress < 1) animationFrame.current = requestAnimationFrame(animate);
      else animationFrame.current = null;
    };
    animationFrame.current = requestAnimationFrame(animate);
    return () => {
      if (animationFrame.current != null) cancelAnimationFrame(animationFrame.current);
      animationFrame.current = null;
    };
  }, [driverCoordinate?.latitude, driverCoordinate?.longitude]);

  useImperativeHandle(ref, () => ({
    animateToRegion: (next, duration = 600) => {
      const normalized = toRegion(next);
      if (normalized) mapRef.current?.animateToRegion(normalized, duration);
    },
    fitToCoordinates: (coordinates, options = {}) => {
      const points = (coordinates || []).map(toCoordinate).filter(Boolean);
      if (points.length < 2) return;
      mapRef.current?.fitToCoordinates(points, {
        edgePadding: {
          top: options.edgePadding?.top || 70,
          right: options.edgePadding?.right || 50,
          bottom: options.edgePadding?.bottom || 70,
          left: options.edgePadding?.left || 50,
        },
        animated: options.animated !== false,
      });
    },
    toggleLayer: () => {},
  }), []);

  useEffect(() => {
    if (!routeKey) {
      setRoute(null);
      setRouting(false);
      onRouteInfoRef.current?.(null);
      return undefined;
    }
    let active = true;
    setRouting(true);
    (async () => {
      let realRoute = null;
      try { realRoute = await getRoute(from, to); } catch (_) {}
      if (!active) return;
      const next = realRoute || getStraightLineRouteEstimate(from, to);
      if (!next) {
        setRoute(null);
        setRouting(false);
        onRouteInfoRef.current?.(null);
        return;
      }
      setRoute(next);
      setRouting(false);
      onRouteInfoRef.current?.({
        distanceKm: next.distanceKm,
        etaMinutes: next.etaMinutes,
        source: next.source,
        etaBasis: realRoute?.etaBasis || null,
      });
      if (realRoute?.points?.length > 1) {
        mapRef.current?.fitToCoordinates(realRoute.points, {
          edgePadding: { top: 70, right: 50, bottom: 70, left: 50 },
          animated: true,
        });
      }
    })();
    return () => { active = false; };
  }, [routeKey]);

  const handleRegionChangeComplete = (nextRegion, details) => {
    const coordinate = toCoordinate(nextRegion);
    if (!coordinate) return;
    onLocationChange?.(coordinate);
    onRegionChangeComplete?.(coordinate);
    if (details?.isGesture) onUserPan?.();
  };

  const handleMapPress = (event) => {
    if (locked) return;
    const coordinate = toCoordinate(event?.nativeEvent?.coordinate);
    if (!coordinate) return;
    onPress?.({ nativeEvent: { coordinate } });
  };

  const handlePickerMarkerDragEnd = (event) => {
    const coordinate = toCoordinate(event?.nativeEvent?.coordinate);
    if (!coordinate) return;
    if (onMarkerDragEnd) onMarkerDragEnd(coordinate);
    else onLocationChange?.(coordinate);
  };

  const routeColor = route?.source === "osrm" || route?.source === "road" || route?.source === "mapbox" ? TEAL : "#64748B";
  const showMapError = missingAndroidKey || Boolean(mapError);

  return (
    <View
      style={[styles.container, style]}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setMapBox((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
      }}
    >
      {!missingAndroidKey && mapBox ? (
        <MapView
          ref={mapRef}
          style={{ position: "absolute", top: 0, left: 0, width: mapBox.width, height: mapBox.height }}
          provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
          mapType="standard"
          initialRegion={activeRegion}
          region={toRegion(region) || undefined}
          showsBuildings
          showsPointsOfInterest
          showsUserLocation={hasLocationPermission}
          showsMyLocationButton={false}
          showsCompass
          onPress={handleMapPress}
          onMapReady={() => {
            setMapReady(true);
          }}
          onMapLoaded={() => {
            setMapLoaded(true);
            setMapError(null);
          }}
          onRegionChangeComplete={handleRegionChangeComplete}
          onPanDrag={() => onUserPan?.()}
          scrollEnabled={!locked}
          zoomEnabled={!locked}
          rotateEnabled={!locked}
          pitchEnabled={!locked}
          toolbarEnabled={false}
        >
          {!isRoute && pickerCoordinate ? (
            <Marker
              identifier="mytruck-location-picker"
              coordinate={pickerCoordinate}
              anchor={{ x: 0.5, y: 1 }}
              draggable={!locked}
              onDragEnd={locked ? undefined : handlePickerMarkerDragEnd}
            >
              <View style={styles.pickerMarker} collapsable={false}>
                <View style={styles.pinTooltip}><Text style={styles.pinTooltipTxt}>{locked ? "Your location" : "Drag to choose"}</Text></View>
                <MaterialCommunityIcons name="map-marker" size={46} color={ORANGE} />
              </View>
            </Marker>
          ) : null}
          {isRoute && pickupCoordinate ? (
            <Marker identifier="pickup" coordinate={pickupCoordinate} anchor={{ x: 0.5, y: 1 }}>
              <MapPin color={TEAL} name="map-marker" />
            </Marker>
          ) : null}
          {isRoute && dropoffCoordinate ? (
            <Marker identifier="dropoff" coordinate={dropoffCoordinate} anchor={{ x: 0.5, y: 1 }}>
              <MapPin color={ORANGE} name="map-marker" />
            </Marker>
          ) : null}
          {driverMarkerPosition ? (
            <Marker identifier="driver" coordinate={driverMarkerPosition} anchor={{ x: 0.5, y: 1 }}>
              <MapPin color={BLUE} name="truck" />
            </Marker>
          ) : null}
          {route?.points?.length > 1 ? (
            <Polyline coordinates={route.points} strokeColor={routeColor} strokeWidth={5} lineCap="round" lineJoin="round" />
          ) : null}
          {children}
        </MapView>
      ) : null}

      {showMapError ? (
        <View pointerEvents="none" style={styles.mapFallbackNotice}>
          <MaterialCommunityIcons name="map-marker-alert-outline" size={22} color="#64748B" />
          <Text style={styles.unavailableTitle}>{missingAndroidKey ? "Google Maps key not configured" : "Google Maps unavailable"}</Text>
          <Text style={styles.mapFallbackText}>
            {missingAndroidKey
              ? "Add GOOGLE_MAPS_ANDROID_API_KEY to the build environment, then rebuild the Android app."
              : mapError}
          </Text>
        </View>
      ) : null}

      {/* Google basemap branding is supplied by the native SDK. Show OSM credit
          only when the visible route geometry actually comes from OSRM. */}
      {route?.source === "osrm" ? (
        <View pointerEvents="none" style={styles.osmAttribution}>
          <Text style={styles.osmAttributionText}>Route data © OpenStreetMap contributors</Text>
        </View>
      ) : null}

      {isRoute ? (
        <View pointerEvents="none" style={styles.badge}>
          <MaterialCommunityIcons name="map-marker-distance" size={14} color={DARK} />
          <Text style={styles.badgeTxt}>
            {route
              ? route.source === "straight"
                ? `${route.distanceKm ?? "—"} km straight-line · no road ETA`
                : `${route.distanceKm} km · ~${route.etaMinutes} min · road estimate`
              : !from ? "Turn on location to see your route" : routing ? "Finding the road route…" : "Choose valid pickup and drop-off locations"}
          </Text>
        </View>
      ) : null}
      {showControls && onRecenter ? (
        <TouchableOpacity style={styles.recenter} onPress={onRecenter} disabled={recenterLoading} accessibilityRole="button" accessibilityLabel="Use my current location" activeOpacity={0.8}>
          {recenterLoading ? <ActivityIndicator size="small" color={TEAL} /> : <MaterialCommunityIcons name="crosshairs-gps" size={22} color={TEAL} />}
        </TouchableOpacity>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, overflow: "hidden", backgroundColor: "#E8EEF3" },
  marker: { width: 42, height: 46, alignItems: "center", justifyContent: "center" },
  pickerMarker: { alignItems: "center", justifyContent: "flex-end", minWidth: 120, height: 72 },
  pinTooltip: { backgroundColor: DARK, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, marginBottom: 2, elevation: 3 },
  pinTooltipTxt: { color: "#FFFFFF", fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },
  recenter: { position: "absolute", right: 16, bottom: 16, width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "white", elevation: 4 },
  badge: { position: "absolute", top: 12, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.94)", elevation: 3 },
  badgeTxt: { color: DARK, fontSize: 12, fontWeight: "700" },
  mapFallbackNotice: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", paddingHorizontal: 28, backgroundColor: "#E8EEF3" },
  unavailableTitle: { color: DARK, fontSize: 15, fontWeight: "800", marginTop: 10, textAlign: "center" },
  mapFallbackText: { color: "#475569", fontSize: 12, marginTop: 6, textAlign: "center", lineHeight: 18 },
  osmAttribution: { position: "absolute", right: 6, bottom: 4, paddingHorizontal: 4, paddingVertical: 2, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.9)" },
  osmAttributionText: { color: "#334155", fontSize: 9 },
});

export default SharedMapView;
