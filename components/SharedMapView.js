import React, { forwardRef, useImperativeHandle, useRef } from "react";
import { View, StyleSheet } from "react-native";
import InteractiveMapView from "./InteractiveMapView";
import { DEFAULT_COORDS } from "../utils/mapService";

/**
 * SharedMapView — Global production map component for MyTruck Delivery
 *
 * Backed by InteractiveMapView (Leaflet + CartoDB Voyager / OSM).
 * Renders 100% reliably on all Android and iOS devices without requiring
 * Google Play Services API billing keys or restricted tokens.
 */
const SharedMapView = forwardRef(function SharedMapView(
  {
    style,
    initialRegion,
    region,
    mode = "picker",
    origin,
    destination,
    driverLocation,
    orderStatus,
    onPress,
    onRegionChangeComplete,
    onLocationChange,
    onRouteInfo,
    showControls = true,
    onRecenter,
    recenterLoading = false,
    children,
    ...rest
  },
  ref
) {
  const mapRef = useRef(null);

  useImperativeHandle(ref, () => ({
    animateToRegion: (coords, duration = 600) => {
      if (mapRef.current?.animateToRegion) {
        mapRef.current.animateToRegion(coords);
      }
    },
    fitToCoordinates: (coordsList) => {
      if (mapRef.current?.fitToCoordinates) {
        mapRef.current.fitToCoordinates(coordsList);
      }
    },
    toggleLayer: (type) => {
      if (mapRef.current?.toggleLayer) {
        mapRef.current.toggleLayer(type);
      }
    },
  }));

  const handleLocationChange = (coords) => {
    if (onLocationChange) {
      onLocationChange(coords);
    }
    if (onPress) {
      onPress({ nativeEvent: { coordinate: coords } });
    }
    if (onRegionChangeComplete) {
      onRegionChangeComplete(coords);
    }
  };

  const activeRegion = region || initialRegion || DEFAULT_COORDS;
  const isRoute = mode === "route" || Boolean(origin && destination);

  return (
    <View style={[styles.container, style]}>
      <InteractiveMapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        initialRegion={activeRegion}
        mode={isRoute ? "route" : "picker"}
        origin={origin}
        destination={destination}
        driverLocation={driverLocation}
        orderStatus={orderStatus}
        onLocationChange={handleLocationChange}
        onRouteInfo={onRouteInfo}
        onRecenter={onRecenter}
        recenterLoading={recenterLoading}
        showControls={showControls}
      />
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
});

export default SharedMapView;
