import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-routing-machine/dist/leaflet-routing-machine.css";

// Make L available globally for the routing machine plugin
if (typeof window !== "undefined") {
  window.L = L;
}

// Fix leaflet icon issue in React
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

export default function RouteMap({ fromLat, fromLng, toLat, toLng, onDistanceCalculated }) {
  const [routingLoaded, setRoutingLoaded] = useState(false);
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const routingControl = useRef(null);
  const callbackRef = useRef(onDistanceCalculated);

  useEffect(() => {
    callbackRef.current = onDistanceCalculated;
  }, [onDistanceCalculated]);

  useEffect(() => {
    // Dynamically import routing machine to ensure window.L is set first
    import("leaflet-routing-machine").then(() => {
      setRoutingLoaded(true);
    }).catch(e => console.error("Failed to load routing machine", e));
  }, []);

  useEffect(() => {
    if (!routingLoaded || !mapRef.current) return;

    if (!mapInstance.current) {
      try {
        mapInstance.current = L.map(mapRef.current, { zoomControl: false }).setView([fromLat || 7.8731, fromLng || 80.7718], 7);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '&copy; OpenStreetMap contributors'
        }).addTo(mapInstance.current);
      } catch (e) {
        console.error("Error initializing map:", e);
      }
    }

    if (routingControl.current) {
      mapInstance.current.removeControl(routingControl.current);
    }

    if (fromLat && fromLng && toLat && toLng) {
      try {
        routingControl.current = L.Routing.control({
          waypoints: [
            L.latLng(fromLat, fromLng),
            L.latLng(toLat, toLng)
          ],
          routeWhileDragging: false,
          addWaypoints: false,
          fitSelectedRoutes: true,
          showAlternatives: false,
          lineOptions: {
            styles: [{ color: '#3b82f6', opacity: 0.8, weight: 5 }]
          }
        }).on('routesfound', function (e) {
          const routes = e.routes;
          const summary = routes[0].summary;
          if (callbackRef.current) {
            callbackRef.current(summary.totalDistance / 1000); // distance in km
          }
        }).on('routingerror', function(e) {
          console.error("Routing error:", e);
        }).addTo(mapInstance.current);
        
        const routingContainer = routingControl.current.getContainer();
        if (routingContainer) {
          routingContainer.style.display = 'none';
        }
      } catch(e) {
        console.error("Error adding routing control:", e);
      }
    }

    // invalidate size after a short delay to fix gray box issues
    const timeout = setTimeout(() => {
      if (mapInstance.current) {
        mapInstance.current.invalidateSize();
      }
    }, 200);

    return () => {
      clearTimeout(timeout);
      // Clean up routing control on unmount
      if (mapInstance.current && routingControl.current) {
        try {
          mapInstance.current.removeControl(routingControl.current);
        } catch(e) {}
        routingControl.current = null;
      }
    };
  }, [fromLat, fromLng, toLat, toLng, routingLoaded]);

  return (
    <div style={{ position: "relative" }}>
      {!routingLoaded && <div style={{position: "absolute", zIndex: 10, background: "white", padding: 10}}>Loading map...</div>}
      <div ref={mapRef} style={{ width: "100%", height: "200px", borderRadius: "8px", zIndex: 0, marginTop: "12px", border: "1px solid #ddd" }} />
    </div>
  );
}
