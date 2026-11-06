import React, { forwardRef, useImperativeHandle, useRef, useState, useEffect, useMemo } from "react";
import { View, StyleSheet, ActivityIndicator, Platform, TouchableOpacity, Text } from "react-native";
import { WebView } from "react-native-webview";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { DEFAULT_COORDS } from "../utils/mapService";

const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";

/**
 * InteractiveMapView — Enterprise Leaflet-powered map component with animated markers,
 * interactive location popups, and live continuous road routing connecting
 * Driver (🛵), Restaurant (🏪), and Customer (🏠).
 */
const InteractiveMapView = forwardRef(function InteractiveMapView(
  {
    style,
    initialRegion = DEFAULT_COORDS,
    mode = "picker", // 'picker' | 'route' | 'view'
    origin,         // { latitude, longitude, title, address } for route mode
    destination,    // { latitude, longitude, title, address } for route mode
    driverLocation, // { latitude, longitude, title, status } for live driver tracking
    orderStatus,    // 'PENDING' | 'ACCEPTED' | 'PREPARING' | 'READY_FOR_PICKUP' | 'DRIVER_ASSIGNED' | 'DRIVERPICKEDUP' | 'ON_THE_WAY' | 'DELIVERED'
    onLocationChange,
    onRouteInfo,    // callback({ distanceKm, etaMinutes }) from OSRM
    onRecenter,
    recenterLoading = false,
    showControls = true,
  },
  ref
) {
  const webViewRef = useRef(null);
  const lastRouteRef = useRef({ distanceKm: null, etaMinutes: null });
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapType, setMapType] = useState("street"); // 'street' | 'satellite'

  // Expose imperative API
  useImperativeHandle(ref, () => ({
    animateToRegion: (coords, zoom = 15) => {
      if (webViewRef.current && coords?.latitude && coords?.longitude) {
        const js = `window.moveToCoords(${Number(coords.latitude)}, ${Number(coords.longitude)}, ${zoom});`;
        webViewRef.current.injectJavaScript(js);
      }
    },
    fitToCoordinates: (coordsList) => {
      if (webViewRef.current && Array.isArray(coordsList) && coordsList.length > 0) {
        const js = `window.fitBoundsToPoints(${JSON.stringify(coordsList)});`;
        webViewRef.current.injectJavaScript(js);
      }
    },
    toggleLayer: (type) => {
      const next = type || (mapType === "street" ? "satellite" : "street");
      setMapType(next);
      if (webViewRef.current) {
        webViewRef.current.injectJavaScript(`window.setMapLayer('${next}');`);
      }
    },
  }));

  const handleToggleLayer = () => {
    const next = mapType === "street" ? "satellite" : "street";
    setMapType(next);
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(`window.setMapLayer('${next}');`);
    }
  };

  // Sync live driver position when prop changes
  useEffect(() => {
    if (mapLoaded && driverLocation?.latitude && driverLocation?.longitude && webViewRef.current) {
      const js = `window.updateDriverLocation(${Number(driverLocation.latitude)}, ${Number(driverLocation.longitude)}, ${JSON.stringify(driverLocation.status || orderStatus || "On the way")});`;
      webViewRef.current.injectJavaScript(js);
    }
  }, [driverLocation?.latitude, driverLocation?.longitude, driverLocation?.status, orderStatus, mapLoaded]);

  const handleZoom = (delta) => {
    if (webViewRef.current) {
      const js = `window.zoomByDelta(${delta});`;
      webViewRef.current.injectJavaScript(js);
    }
  };

  const handleMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === "MAP_READY") {
        setMapLoaded(true);
      } else if (data.type === "LOCATION_SELECTED") {
        if (onLocationChange) {
          onLocationChange({
            latitude: Number(data.lat),
            longitude: Number(data.lng),
          });
        }
      } else if (data.type === "ROUTE_INFO") {
        const dKm = Number(data.distanceKm) || 0;
        const eta = Number(data.etaMinutes) || 0;
        if (
          lastRouteRef.current.distanceKm !== dKm ||
          lastRouteRef.current.etaMinutes !== eta
        ) {
          lastRouteRef.current = { distanceKm: dKm, etaMinutes: eta };
          if (onRouteInfo) {
            onRouteInfo({
              distanceKm: dKm,
              etaMinutes: eta,
            });
          }
        }
      }
    } catch (_) {}
  };

  const initLat = Number(initialRegion?.latitude || DEFAULT_COORDS.latitude);
  const initLng = Number(initialRegion?.longitude || DEFAULT_COORDS.longitude);

  const originLat = Number(origin?.latitude || initLat);
  const originLng = Number(origin?.longitude || initLng);
  const originTitle = String(origin?.title || "Restaurant / Storefront");
  const originAddress = String(origin?.address || "Ethiopia");

  const destLat = Number(destination?.latitude || (initLat + 0.015));
  const destLng = Number(destination?.longitude || (initLng + 0.015));
  const destTitle = String(destination?.title || "Delivery Destination");
  const destAddress = String(destination?.address || "Ethiopia");

  const driverLat = Number(driverLocation?.latitude || (originLat * 0.6 + destLat * 0.4));
  const driverLng = Number(driverLocation?.longitude || (originLng * 0.6 + destLng * 0.4));
  const driverTitle = String(driverLocation?.title || "MyTruck Courier 🛵");
  const currentStatus = String(orderStatus || driverLocation?.status || "Heading to destination");

  const htmlContent = useMemo(() => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #map { width: 100%; height: 100%; background: #F1F5F9; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .leaflet-control-attribution { font-size: 8px !important; background: rgba(255,255,255,0.7) !important; }
    .leaflet-control-zoom { display: none !important; }
    
    /* Base Pin Wrap */
    .custom-pin-wrap {
      position: relative;
      width: 44px;
      height: 52px;
      display: flex;
      flex-direction: column;
      align-items: center;
      transform: translate(-22px, -48px);
      cursor: pointer;
    }
    .pin-circle {
      width: 40px;
      height: 40px;
      border-radius: 20px;
      background: ${TEAL};
      border: 3px solid #FFFFFF;
      box-shadow: 0 5px 14px rgba(11, 42, 38, 0.35);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #FFFFFF;
      font-size: 20px;
      transition: transform 0.2s ease;
    }
    .custom-pin-wrap:hover .pin-circle {
      transform: scale(1.1);
    }
    .pin-tip {
      width: 0;
      height: 0;
      border-left: 7px solid transparent;
      border-right: 7px solid transparent;
      border-top: 9px solid ${TEAL};
      margin-top: -2px;
    }
    .pin-shadow {
      width: 16px;
      height: 6px;
      border-radius: 50%;
      background: rgba(0,0,0,0.28);
      margin-top: 1px;
    }

    /* 1. ANIMATION: Restaurant Origin Pin Floating Bounce */
    @keyframes storeBounce {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-7px); }
    }
    .origin-marker-wrap {
      animation: storeBounce 2.6s infinite ease-in-out;
    }
    .store-pin {
      background: ${TEAL} !important;
      border-color: #FFFFFF !important;
      box-shadow: 0 6px 16px rgba(23, 155, 131, 0.5) !important;
    }
    .store-tip {
      border-top-color: ${TEAL} !important;
    }

    /* 2. ANIMATION: Customer Destination Pin Beacon Glow */
    @keyframes destBeacon {
      0%, 100% {
        transform: scale(1);
        box-shadow: 0 4px 12px rgba(244, 119, 33, 0.45);
      }
      50% {
        transform: scale(1.08);
        box-shadow: 0 8px 22px rgba(244, 119, 33, 0.85);
      }
    }
    .dest-marker-wrap .pin-circle {
      background: ${ORANGE} !important;
      border-color: #FFFFFF !important;
      animation: destBeacon 2.2s infinite ease-in-out;
    }
    .dest-tip {
      border-top-color: ${ORANGE} !important;
    }

    /* 3. ANIMATION: Dynamic Driver Motorcycle Radar Ripple & Motor Idle */
    @keyframes pulseRadar {
      0% { transform: scale(0.65); opacity: 0.95; }
      50% { transform: scale(1.6); opacity: 0.35; }
      100% { transform: scale(2.3); opacity: 0; }
    }
    .pulse-ring {
      position: absolute;
      width: 46px;
      height: 46px;
      border-radius: 50%;
      background: rgba(23, 155, 131, 0.4);
      border: 2px solid ${TEAL};
      top: -3px;
      left: -1px;
      animation: pulseRadar 2s infinite cubic-bezier(0.2, 0.8, 0.4, 1);
      pointer-events: none;
    }
    @keyframes driverVibe {
      0%, 100% { transform: translateY(0) rotate(0deg); }
      25% { transform: translateY(-2px) rotate(-1.5deg); }
      75% { transform: translateY(-1px) rotate(1.5deg); }
    }
    .driver-pin {
      background: ${DARK} !important;
      border-color: ${TEAL} !important;
      animation: driverVibe 1.3s infinite ease-in-out;
      box-shadow: 0 5px 16px rgba(23, 155, 131, 0.55) !important;
    }
    .driver-tip {
      border-top-color: ${DARK} !important;
    }

    /* Custom Leaflet Popup Box Styling */
    .leaflet-popup-content-wrapper {
      background: #FFFFFF !important;
      border-radius: 14px !important;
      box-shadow: 0 10px 25px rgba(11, 42, 38, 0.22) !important;
      padding: 2px !important;
      border: 1px solid rgba(226, 232, 240, 0.8) !important;
    }
    .leaflet-popup-content {
      margin: 8px 12px !important;
      line-height: 1.35 !important;
    }
    .leaflet-popup-tip {
      background: #FFFFFF !important;
    }
    .popup-box {
      min-width: 170px;
      max-width: 240px;
    }
    .popup-badge {
      display: inline-block;
      font-size: 9.5px;
      font-weight: 800;
      letter-spacing: 0.4px;
      padding: 2px 7px;
      border-radius: 6px;
      margin-bottom: 5px;
      text-transform: uppercase;
    }
    .badge-store { background: #E6F7F1; color: #087F5B; }
    .badge-dest { background: #FFF1E8; color: #C2410C; }
    .badge-driver { background: #0B2A26; color: #2DD4BF; }
    .popup-title {
      font-size: 13.5px;
      font-weight: 800;
      color: #0F172A;
      margin-bottom: 3px;
    }
    .popup-address {
      font-size: 11px;
      color: #475569;
      margin-bottom: 4px;
    }
    .popup-status {
      font-size: 11px;
      color: #059669;
      font-weight: 600;
      margin-bottom: 3px;
    }
    .popup-coords {
      font-size: 9.5px;
      color: #94A3B8;
      font-family: monospace;
    }

    /* Animated Route Line Flow */
    @keyframes routeFlow {
      to { stroke-dashoffset: -32; }
    }
    .animated-route-flow {
      stroke-dasharray: 10, 14;
      animation: routeFlow 1.2s linear infinite;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map', {
      center: [${initLat}, ${initLng}],
      zoom: 15,
      zoomControl: false,
      attributionControl: true
    });

    // Base tile layers
    var streetLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    });

    var esriStreetLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: '© Esri'
    });

    var satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: '© Esri, Maxar'
    });

    var currentBaseLayer = streetLayer;
    currentBaseLayer.addTo(map);

    streetLayer.on('tileerror', function() {
      if (map.hasLayer(streetLayer)) {
        map.removeLayer(streetLayer);
        esriStreetLayer.addTo(map);
        currentBaseLayer = esriStreetLayer;
      }
    });

    window.setMapLayer = function(type) {
      if (type === 'satellite') {
        if (map.hasLayer(streetLayer)) map.removeLayer(streetLayer);
        if (map.hasLayer(esriStreetLayer)) map.removeLayer(esriStreetLayer);
        satelliteLayer.addTo(map);
        currentBaseLayer = satelliteLayer;
      } else {
        if (map.hasLayer(satelliteLayer)) map.removeLayer(satelliteLayer);
        streetLayer.addTo(map);
        currentBaseLayer = streetLayer;
      }
    };

    var mode = "${mode}";
    var currentMarker = null;
    var originMarker = null;
    var destMarker = null;
    var driverMarker = null;
    var routeLayerGroup = L.layerGroup().addTo(map);

    function createStoreIcon() {
      return L.divIcon({
        className: 'custom-pin-icon',
        html: '<div class="custom-pin-wrap origin-marker-wrap">' +
                '<div class="pin-circle store-pin">🏪</div>' +
                '<div class="pin-tip store-tip"></div>' +
                '<div class="pin-shadow"></div>' +
              '</div>',
        iconSize: [44, 52],
        iconAnchor: [22, 48]
      });
    }

    function createDestIcon() {
      return L.divIcon({
        className: 'custom-pin-icon',
        html: '<div class="custom-pin-wrap dest-marker-wrap">' +
                '<div class="pin-circle dest-pin">🏠</div>' +
                '<div class="pin-tip dest-tip"></div>' +
                '<div class="pin-shadow"></div>' +
              '</div>',
        iconSize: [44, 52],
        iconAnchor: [22, 48]
      });
    }

    function createDriverIcon() {
      return L.divIcon({
        className: 'custom-pin-icon',
        html: '<div class="custom-pin-wrap driver-marker-wrap">' +
                '<div class="pulse-ring"></div>' +
                '<div class="pin-circle driver-pin">🛵</div>' +
                '<div class="pin-tip driver-tip"></div>' +
                '<div class="pin-shadow"></div>' +
              '</div>',
        iconSize: [44, 52],
        iconAnchor: [22, 48]
      });
    }

    function buildStorePopup(title, addr, lat, lng) {
      return '<div class="popup-box">' +
               '<div class="popup-badge badge-store">🏪 Restaurant / Pickup</div>' +
               '<div class="popup-title">' + title + '</div>' +
               '<div class="popup-address">' + addr + '</div>' +
               '<div class="popup-coords">📍 ' + Number(lat).toFixed(5) + ', ' + Number(lng).toFixed(5) + '</div>' +
             '</div>';
    }

    function buildDestPopup(title, addr, lat, lng) {
      return '<div class="popup-box">' +
               '<div class="popup-badge badge-dest">🏠 Delivery Destination</div>' +
               '<div class="popup-title">' + title + '</div>' +
               '<div class="popup-address">' + addr + '</div>' +
               '<div class="popup-coords">📍 ' + Number(lat).toFixed(5) + ', ' + Number(lng).toFixed(5) + '</div>' +
             '</div>';
    }

    function buildDriverPopup(title, status, lat, lng) {
      return '<div class="popup-box">' +
               '<div class="popup-badge badge-driver">🛵 Live Driver Location</div>' +
               '<div class="popup-title">' + title + '</div>' +
               '<div class="popup-status">⚡ ' + status + '</div>' +
               '<div class="popup-coords">📍 ' + Number(lat).toFixed(5) + ', ' + Number(lng).toFixed(5) + '</div>' +
             '</div>';
    }

    if (mode === "picker") {
      currentMarker = L.marker([${initLat}, ${initLng}], {
        icon: L.divIcon({
          className: 'custom-pin-icon',
          html: '<div class="custom-pin-wrap"><div class="pin-circle">📍</div><div class="pin-tip"></div><div class="pin-shadow"></div></div>',
          iconSize: [44, 52],
          iconAnchor: [22, 48]
        }),
        draggable: true
      }).addTo(map);

      currentMarker.on('dragend', function(e) {
        var coord = e.target.getLatLng();
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'LOCATION_SELECTED',
          lat: coord.lat,
          lng: coord.lng
        }));
      });

      map.on('click', function(e) {
        currentMarker.setLatLng(e.latlng);
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'LOCATION_SELECTED',
          lat: e.latlng.lat,
          lng: e.latlng.lng
        }));
      });
    } else if (mode === "route") {
      var originLat = ${originLat};
      var originLng = ${originLng};
      var originTitle = ${JSON.stringify(originTitle)};
      var originAddress = ${JSON.stringify(originAddress)};

      var destLat = ${destLat};
      var destLng = ${destLng};
      var destTitle = ${JSON.stringify(destTitle)};
      var destAddress = ${JSON.stringify(destAddress)};

      var driverLat = ${driverLat};
      var driverLng = ${driverLng};
      var driverTitle = ${JSON.stringify(driverTitle)};
      var currentStatus = ${JSON.stringify(currentStatus)};

      // 1. Create and bind animated Restaurant Origin Marker
      originMarker = L.marker([originLat, originLng], {
        icon: createStoreIcon()
      }).addTo(map);
      originMarker.bindPopup(buildStorePopup(originTitle, originAddress, originLat, originLng), {
        offset: [0, -36],
        autoPanPadding: [20, 20]
      });

      // 2. Create and bind animated Customer Destination Marker
      destMarker = L.marker([destLat, destLng], {
        icon: createDestIcon()
      }).addTo(map);
      destMarker.bindPopup(buildDestPopup(destTitle, destAddress, destLat, destLng), {
        offset: [0, -36],
        autoPanPadding: [20, 20]
      });

      // 3. Create and bind dynamic animated Driver Motorcycle Marker
      driverMarker = L.marker([driverLat, driverLng], {
        icon: createDriverIcon()
      }).addTo(map);
      driverMarker.bindPopup(buildDriverPopup(driverTitle, currentStatus, driverLat, driverLng), {
        offset: [0, -36],
        autoPanPadding: [20, 20]
      });

      // Draw stylized multi-layer route polyline
      function renderRoutePolylines(points) {
        routeLayerGroup.clearLayers();
        if (!points || points.length < 2) return;

        // Outer glow
        L.polyline(points, {
          color: '${TEAL}',
          weight: 12,
          opacity: 0.22,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(routeLayerGroup);

        // Main road line
        L.polyline(points, {
          color: '${TEAL}',
          weight: 6,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(routeLayerGroup);

        // Animated transit dash flow overlay
        L.polyline(points, {
          color: '#FFFFFF',
          weight: 3,
          opacity: 0.95,
          className: 'animated-route-flow',
          lineCap: 'round'
        }).addTo(routeLayerGroup);
      }

      // Generate a continuous, guaranteed-connected path through intermediate points
      function createConnectedPath(dLat, dLng, oLat, oLng, dstLat, dstLng) {
        var isPickedUp = currentStatus.toUpperCase().indexOf('PICKED') >= 0 || currentStatus.toUpperCase().indexOf('WAY') >= 0;
        if (isPickedUp) {
          // Driver has picked up items and is driving to customer
          return [
            [dLat, dLng],
            [(dLat * 0.65 + dstLat * 0.35) + 0.001, (dLng * 0.65 + dstLng * 0.35) - 0.001],
            [(dLat * 0.35 + dstLat * 0.65) - 0.001, (dLng * 0.35 + dstLng * 0.65) + 0.001],
            [dstLat, dstLng]
          ];
        } else {
          // Driver is en route to restaurant, then restaurant to customer
          return [
            [dLat, dLng],
            [(dLat + oLat) / 2, (dLng + oLng) / 2],
            [oLat, oLng],
            [(oLat + dstLat) / 2, (oLng + dstLng) / 2],
            [dstLat, dstLng]
          ];
        }
      }

      // Immediate guaranteed connection
      var initialPath = createConnectedPath(driverLat, driverLng, originLat, originLng, destLat, destLng);
      renderRoutePolylines(initialPath);

      // Fetch live road routing from OSRM
      function fetchLiveRoadRoute() {
        var isPickedUp = currentStatus.toUpperCase().indexOf('PICKED') >= 0 || currentStatus.toUpperCase().indexOf('WAY') >= 0;
        var osrmUrl;
        if (isPickedUp) {
          // Direct driver to customer destination route
          osrmUrl = 'https://router.project-osrm.org/route/v1/driving/' + driverLng + ',' + driverLat + ';' + destLng + ',' + destLat + '?overview=full&geometries=geojson';
        } else {
          // Driver to Store to Customer destination route
          osrmUrl = 'https://router.project-osrm.org/route/v1/driving/' + driverLng + ',' + driverLat + ';' + originLng + ',' + originLat + ';' + destLng + ',' + destLat + '?overview=full&geometries=geojson';
        }

        var controller = new AbortController();
        var timeoutId = setTimeout(function() { controller.abort(); }, 4000);

        fetch(osrmUrl, { signal: controller.signal })
          .then(function(res) { return res.json(); })
          .then(function(data) {
            clearTimeout(timeoutId);
            if (data && data.routes && data.routes[0]) {
              var r = data.routes[0];
              var distanceKm = (r.distance / 1000).toFixed(1);
              var etaMinutes = Math.max(5, Math.round(r.duration / 60));
              var roadPoints = r.geometry.coordinates.map(function(c) {
                return [c[1], c[0]]; // [lng, lat] -> [lat, lng]
              });

              if (roadPoints.length > 1) {
                renderRoutePolylines(roadPoints);
              }

              window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'ROUTE_INFO',
                distanceKm: distanceKm,
                etaMinutes: etaMinutes
              }));
            }
          })
          .catch(function(err) {
            clearTimeout(timeoutId);
            // Seamless fallback keeps markers 100% connected
            renderRoutePolylines(createConnectedPath(driverLat, driverLng, originLat, originLng, destLat, destLng));
          });
      }

      fetchLiveRoadRoute();

      // Fit bounds to show all 3 pins nicely
      map.fitBounds(L.latLngBounds([
        [originLat, originLng],
        [destLat, destLng],
        [driverLat, driverLng]
      ]).pad(0.28));
    }

    // Dynamic driver location update from React Native live GPS stream
    window.updateDriverLocation = function(lat, lng, status) {
      var nLat = Number(lat);
      var nLng = Number(lng);
      if (!nLat || !nLng) return;
      driverLat = nLat;
      driverLng = nLng;
      if (status) currentStatus = String(status);

      if (driverMarker) {
        driverMarker.setLatLng([nLat, nLng]);
        driverMarker.setPopupContent(buildDriverPopup(driverTitle, currentStatus, nLat, nLng));
      } else {
        driverMarker = L.marker([nLat, nLng], { icon: createDriverIcon() }).addTo(map);
        driverMarker.bindPopup(buildDriverPopup(driverTitle, currentStatus, nLat, nLng), { offset: [0, -36] });
      }

      // Re-connect the route from the new driver position
      if (typeof createConnectedPath === 'function') {
        renderRoutePolylines(createConnectedPath(nLat, nLng, originLat, originLng, destLat, destLng));
        if (typeof fetchLiveRoadRoute === 'function') {
          fetchLiveRoadRoute();
        }
      }
    };

    window.moveToCoords = function(lat, lng, zoom) {
      if (currentMarker) currentMarker.setLatLng([lat, lng]);
      map.flyTo([lat, lng], zoom || 15, { animate: true, duration: 0.8 });
    };

    window.zoomByDelta = function(delta) {
      map.setZoom(map.getZoom() + delta);
    };

    window.fitBoundsToPoints = function(points) {
      if (!points || !points.length) return;
      var bounds = L.latLngBounds(points.map(function(p) { return [p.latitude, p.longitude]; }));
      map.fitBounds(bounds.pad(0.25));
    };

    setTimeout(function() {
      map.invalidateSize();
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MAP_READY' }));
    }, 400);
  </script>
</body>
</html>
  `, [
    mode,
    initLat,
    initLng,
    originLat,
    originLng,
    originTitle,
    originAddress,
    destLat,
    destLng,
    destTitle,
    destAddress,
    driverLat,
    driverLng,
    driverTitle,
    currentStatus,
  ]);

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webViewRef}
        originWhitelist={["*"]}
        source={{ html: htmlContent }}
        onMessage={handleMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        scalesPageToFit={true}
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        androidLayerType="hardware"
        onRenderProcessGone={(e) => {
          console.warn("InteractiveMapView: render process gone", e?.nativeEvent?.didCrash);
        }}
        onError={(e) => {
          console.warn("InteractiveMapView error:", e?.nativeEvent?.description);
        }}
        style={styles.webView}
      />

      {/* Floating Map Controls */}
      {showControls && (
        <View style={styles.controlsWrap} pointerEvents="box-none">
          {/* Map Layer Switch (Street / Satellite) */}
          <TouchableOpacity
            style={[styles.controlBtn, mapType === "satellite" && { backgroundColor: TEAL }]}
            onPress={handleToggleLayer}
            activeOpacity={0.85}
            accessibilityLabel="Toggle satellite imagery"
          >
            <MaterialCommunityIcons
              name={mapType === "satellite" ? "earth" : "layers-outline"}
              size={20}
              color={mapType === "satellite" ? "white" : DARK}
            />
          </TouchableOpacity>

          {/* Zoom In */}
          <TouchableOpacity
            style={[styles.controlBtn, { marginTop: 6 }]}
            onPress={() => handleZoom(1)}
            activeOpacity={0.85}
            accessibilityLabel="Zoom in map"
          >
            <MaterialCommunityIcons name="plus" size={20} color={DARK} />
          </TouchableOpacity>

          {/* Zoom Out */}
          <TouchableOpacity
            style={[styles.controlBtn, { marginTop: 6 }]}
            onPress={() => handleZoom(-1)}
            activeOpacity={0.85}
            accessibilityLabel="Zoom out map"
          >
            <MaterialCommunityIcons name="minus" size={20} color={DARK} />
          </TouchableOpacity>

          {/* Re-center / GPS */}
          {onRecenter && (
            <TouchableOpacity
              style={[styles.controlBtn, styles.gpsBtn, { marginTop: 10 }]}
              onPress={onRecenter}
              activeOpacity={0.85}
              accessibilityLabel="Re-center map"
            >
              {recenterLoading ? (
                <ActivityIndicator size="small" color={TEAL} />
              ) : (
                <MaterialCommunityIcons name="crosshairs-gps" size={20} color={TEAL} />
              )}
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Subtle attribution pill */}
      <View style={styles.attrPill} pointerEvents="none">
        <Text style={styles.attrTxt}>© OpenStreetMap</Text>
      </View>
    </View>
  );
});

export default InteractiveMapView;

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
    position: "relative",
    backgroundColor: "#F1F5F9",
  },
  webView: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent",
  },
  controlsWrap: {
    position: "absolute",
    right: 12,
    bottom: 24,
    alignItems: "center",
    zIndex: 10,
  },
  controlBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "white",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  gpsBtn: {
    borderColor: "#CCFBF1",
  },
  attrPill: {
    position: "absolute",
    left: 8,
    bottom: 6,
    backgroundColor: "rgba(255, 255, 255, 0.85)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    zIndex: 5,
  },
  attrTxt: {
    fontSize: 9,
    color: "#64748B",
    fontWeight: "500",
  },
});
