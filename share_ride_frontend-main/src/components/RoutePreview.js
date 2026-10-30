import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { WebView } from "react-native-webview";

const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";

// Any https URL works; it only gives the WebView a real origin/Referer
// so OpenStreetMap tile servers accept the tile requests.
const WEBVIEW_BASE_URL = "https://localhost/";

// Safely embed JSON inside a <script> tag.
function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function createRouteMapHtml(geometry, origin, destination) {
  const geometryJson = safeJson(geometry);
  const originJson = safeJson({
    latitude: Number(origin.latitude),
    longitude: Number(origin.longitude),
  });
  const destinationJson = safeJson({
    latitude: Number(destination.latitude),
    longitude: Number(destination.longitude),
  });

  return `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport"
    content="width=device-width, initial-scale=1.0, maximum-scale=1.0">

  <link
    rel="stylesheet"
    href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
  />

  <style>
    html, body, #map {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
    }
  </style>
</head>

<body>
  <div id="map"></div>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

  <script>
    const map = L.map("map", {
      zoomControl: false
    });

    L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
      }
    ).addTo(map);

    const geometry = ${geometryJson};
    const origin = ${originJson};
    const destination = ${destinationJson};

    const routeLayer = L.geoJSON(geometry, {
      style: {
        color: "#5B4BDB",
        weight: 5,
        opacity: 0.9
      }
    }).addTo(map);

    L.marker([origin.latitude, origin.longitude])
      .addTo(map)
      .bindPopup("Pickup");

    L.marker([destination.latitude, destination.longitude])
      .addTo(map)
      .bindPopup("Destination");

    map.fitBounds(routeLayer.getBounds(), {
      padding: [25, 25]
    });
  </script>
</body>
</html>
`;
}

export default function RoutePreview({
  origin,
  destination,
  originCoordinates,
  destinationCoordinates,
  onRouteCalculated,
}) {
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const originLat = originCoordinates?.latitude;
  const originLng = originCoordinates?.longitude;
  const destinationLat = destinationCoordinates?.latitude;
  const destinationLng = destinationCoordinates?.longitude;

  

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function calculateRoute() {
      if (
        originLat == null ||
        originLng == null ||
        destinationLat == null ||
        destinationLng == null
      ) {
        setLoading(false);
        setRoute(null);
        setError("Select both locations on the map");
        return;
      }

      const oLat = Number(originLat);
      const oLng = Number(originLng);
      const dLat = Number(destinationLat);
      const dLng = Number(destinationLng);

      if (
        !Number.isFinite(oLat) ||
        !Number.isFinite(oLng) ||
        !Number.isFinite(dLat) ||
        !Number.isFinite(dLng) ||
        Math.abs(oLat) > 90 ||
        Math.abs(dLat) > 90 ||
        Math.abs(oLng) > 180 ||
        Math.abs(dLng) > 180
      ) {
        setLoading(false);
        setRoute(null);
        setError("Invalid pickup or destination coordinates");
        return;
      }

      if (oLat === dLat && oLng === dLng) {
        setLoading(false);
        setRoute(null);
        setError("Choose two different locations");
        return;
      }

      try {
        setLoading(true);
        setError("");
        setRoute(null);

        const url =
          `${OSRM_URL}/` +
          `${oLng},${oLat};${dLng},${dLat}` +
          `?overview=full&geometries=geojson`;


        

        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok) {
          throw new Error("OSRM server request failed");
        }

        const data = await response.json();

        if (data.code !== "Ok" || !data.routes || data.routes.length === 0) {
          throw new Error("No driving route found");
        }

        if (cancelled) return;

        const result = data.routes[0];

        setRoute({
          geometry: result.geometry,
          distanceKm: (result.distance / 1000).toFixed(2),
          durationMinutes: Math.round(result.duration / 60),
        });
      } catch (err) {
        if (err.name !== "AbortError" && !cancelled) {
          console.error("OSRM error:", err);
          setError(err.message || "Unable to calculate route");
        }
      } finally {
        // Only the latest (non-cancelled) run controls the spinner.
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    calculateRoute();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [originLat, originLng, destinationLat, destinationLng]);

  // Rebuild the HTML only when the route changes, so the WebView
  // doesn't reload on unrelated parent re-renders.
  const webViewSource = useMemo(() => {
    if (!route) return null;
    return {
      html: createRouteMapHtml(
        route.geometry,
        { latitude: originLat, longitude: originLng },
        { latitude: destinationLat, longitude: destinationLng }
      ),
      baseUrl: WEBVIEW_BASE_URL,
    };
  }, [route, originLat, originLng, destinationLat, destinationLng]);

  return (
    <View style={styles.mapCard}>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#5B4BDB" />
          <Text style={styles.statusText}>Calculating road route...</Text>
        </View>
      ) : route && webViewSource ? (
        <>
          <WebView
            style={styles.map}
            originWhitelist={["*"]}
            source={webViewSource}
            javaScriptEnabled
            domStorageEnabled
          />

          <View style={styles.summary}>
            <Text style={styles.routeTitle} numberOfLines={1}>
              {origin} → {destination}
            </Text>

            <Text style={styles.routeSubtitle}>
              {route.distanceKm} km • {route.durationMinutes} min
            </Text>
          </View>
        </>
      ) : (
        <View style={styles.center}>
          <Text style={styles.errorText}>
            {error || "Select pickup and destination"}
          </Text>

          <Text style={styles.hint}>
            Your actual road route will appear here.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  mapCard: {
    height: 205,
    marginBottom: 12,
    borderRadius: 17,
    overflow: "hidden",
    backgroundColor: "#EAF2F8",
  },

  map: {
    flex: 1,
  },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 15,
  },

  statusText: {
    marginTop: 10,
    fontSize: 13,
    color: "#555555",
  },

  errorText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#B00020",
    textAlign: "center",
  },

  hint: {
    marginTop: 6,
    fontSize: 12,
    color: "#777777",
    textAlign: "center",
  },

  summary: {
    position: "absolute",
    bottom: 8,
    left: 8,
    right: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.96)",
  },

  routeTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#29243F",
  },

  routeSubtitle: {
    marginTop: 3,
    fontSize: 11,
    color: "#5B4BDB",
    fontWeight: "700",
  },
});
