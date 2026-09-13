import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-routing-machine/dist/leaflet-routing-machine.css";
import { TRANSPORT_EMISSION_FACTORS } from "../data";

if (typeof window !== "undefined") window.L = L;

import icon from "leaflet/dist/images/marker-icon.png";
import iconShadow from "leaflet/dist/images/marker-shadow.png";
L.Marker.prototype.options.icon = L.icon({ iconUrl: icon, shadowUrl: iconShadow, iconAnchor: [12, 41] });

// Inject CSS styles
if (typeof document !== "undefined" && !document.getElementById("lt-styles")) {
  const el = document.createElement("style");
  el.id = "lt-styles";
  el.textContent = `
    @keyframes lt-spin { to { transform:rotate(360deg) } }
    @keyframes lt-pulse { 0% { transform:scale(0.95); opacity:0.8; } 50% { transform:scale(1.2); opacity:0.3; } 100% { transform:scale(0.95); opacity:0.8; } }
    .lt-input { width:100%; box-sizing:border-box; border:1px solid #ddd; border-radius:6px; padding:8px 10px; font-size:0.85rem; outline:none; font-family:inherit; transition:border 0.15s; background:#fff; }
    .lt-input:focus { border-color:#555; }
    .lt-suggest { position:absolute; top:100%; left:0; right:0; background:#fff; border:1px solid #ddd; border-radius:6px; box-shadow:0 4px 12px rgba(0,0,0,0.1); z-index:10000; max-height:180px; overflow-y:auto; margin-top:2px; }
    .lt-suggest-item { padding:8px 12px; font-size:0.82rem; cursor:pointer; color:#333; border-bottom:1px solid #f5f5f5; }
    .lt-suggest-item:hover { background:#f5f5f5; }
    .lt-suggest-item:last-child { border-bottom:none; }
    .lt-hist-del { background:none; border:none; color:#ccc; cursor:pointer; font-size:14px; padding:2px 6px; border-radius:4px; }
    .lt-hist-del:hover { color:#e53e3e; background:#fff0f0; }
    .lt-gps-dot { width:14px; height:14px; background:#2563eb; border:2px solid #fff; border-radius:50%; box-shadow:0 0 8px rgba(37,99,235,0.6); display:inline-block; }
  `;
  document.head.appendChild(el);
}

// Nominatim Geocoding
async function geocodeQuery(query) {
  if (!query || query.trim().length < 2) return [];
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&countrycodes=lk`,
      { headers: { "Accept-Language": "en", "User-Agent": "SL-CO2-Calculator/1.0" } }
    );
    return await res.json();
  } catch { return []; }
}

// Nominatim Reverse Geocoding
async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { "Accept-Language": "en", "User-Agent": "SL-CO2-Calculator/1.0" } }
    );
    const data = await res.json();
    return data.display_name?.split(",")[0] || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  } catch {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}

// Haversine distance formula in km
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const LS_KEY = "lt_trip_history";
function loadHistory() { try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { return []; } }
function saveHistory(list) { localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, 10))); }

const VEHICLE_OPTIONS = [
  { label: "Small Car — Petrol",    mode: "Small Car (3-4)",            fuel: "Petrol" },
  { label: "Small Car — Diesel",    mode: "Small Car (3-4)",            fuel: "Diesel" },
  { label: "Small Car — EV",        mode: "Small Car (3-4)",            fuel: "EV" },
  { label: "Small Car — Hybrid",    mode: "Small Car (3-4)",            fuel: "Hybrid" },
  { label: "SUV / Jeep — Petrol",   mode: "SUV / Jeep (5-6)",           fuel: "Petrol" },
  { label: "SUV / Jeep — Diesel",   mode: "SUV / Jeep (5-6)",           fuel: "Diesel" },
  { label: "Three-Wheeler — Petrol",mode: "Three-Wheeler (1-3)",        fuel: "Petrol" },
  { label: "Motorbike — Petrol",    mode: "Motorbike (1-2)",            fuel: "Petrol" },
  { label: "Tourist Van — Diesel",  mode: "Tourist Van (8-12)",         fuel: "Diesel" },
  { label: "Public Bus / Train",    mode: "Public Transport (Bus/Train)", fuel: "Public" },
  { label: "Bicycle",               mode: "Bicycle (1)",                fuel: "Human-powered" },
];

function calcCO2(distKm, vehicleOpt, passengers) {
  const factor = TRANSPORT_EMISSION_FACTORS[vehicleOpt.mode]?.[vehicleOpt.fuel] ?? 0;
  const perPassenger = vehicleOpt.mode === "Public Transport (Bus/Train)" || vehicleOpt.mode === "Bicycle (1)";
  return perPassenger ? factor * distKm * passengers : factor * distKm;
}

function GeoInput({ label, value, onChange, placeholder, onUseMyLocation, isLocating }) {
  const [query, setQuery] = useState(value?.name || "");
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    setQuery(value?.name || "");
  }, [value]);

  const handleChange = (e) => {
    const q = e.target.value;
    setQuery(q);
    onChange(null);
    clearTimeout(timer.current);
    if (q.length < 3) { setSuggestions([]); return; }
    timer.current = setTimeout(async () => {
      setSearching(true);
      const res = await geocodeQuery(q);
      setSuggestions(res);
      setSearching(false);
    }, 400);
  };

  const pick = (item) => {
    const name = item.display_name.split(",")[0].trim();
    setQuery(name);
    setSuggestions([]);
    onChange({ name, lat: parseFloat(item.lat), lng: parseFloat(item.lon) });
  };

  return (
    <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ fontSize: "0.7rem", color: "#999", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
        {onUseMyLocation && (
          <button
            type="button"
            onClick={onUseMyLocation}
            disabled={isLocating}
            style={{
              background: "none", border: "none", color: "#2563eb", fontSize: "0.72rem", cursor: "pointer",
              fontWeight: 600, padding: 0
            }}
          >
            {isLocating ? "Locating..." : "Use My Location"}
          </button>
        )}
      </div>
      <input className="lt-input" value={query} onChange={handleChange} placeholder={placeholder} autoComplete="off" />
      {searching && <div style={{ position: "absolute", right: 10, top: 32, fontSize: 11, color: "#aaa" }}>...</div>}
      {suggestions.length > 0 && (
        <div className="lt-suggest">
          {suggestions.map(s => (
            <div key={s.place_id} className="lt-suggest-item" onMouseDown={() => pick(s)}>
              {s.display_name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LiveTrackingPage({ onClose, itinerary }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const routingControl = useRef(null);
  const userMarkerRef = useRef(null);
  const watchIdRef = useRef(null);
  const lastGpsPosRef = useRef(null);

  const [routingLoaded, setRoutingLoaded] = useState(false);
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const [vehicle, setVehicle] = useState(VEHICLE_OPTIONS[0]);
  const [passengers, setPassengers] = useState(1);
  const [routeInfo, setRouteInfo] = useState(null);
  const [status, setStatus] = useState("idle");
  const [history, setHistory] = useState(loadHistory);
  const [view, setView] = useState("route");
  const [isLocating, setIsLocating] = useState(false);
  const [isLiveNavigating, setIsLiveNavigating] = useState(false);
  const [traveledKm, setTraveledKm] = useState(0);

  // 1. Load routing plugin
  useEffect(() => {
    import("leaflet-routing-machine").then(() => setRoutingLoaded(true)).catch(console.error);
  }, []);

  // 2. Init map ONLY after plugin loaded AND div exists AND view is "route"
  useEffect(() => {
    if (!routingLoaded || !mapRef.current) return;
    if (mapInstance.current) {
      setTimeout(() => mapInstance.current.invalidateSize(), 50);
      return;
    }
    mapInstance.current = L.map(mapRef.current, { zoomControl: true }).setView([7.87, 80.77], 8);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 18,
    }).addTo(mapInstance.current);
    setTimeout(() => mapInstance.current.invalidateSize(), 100);
  }, [routingLoaded, view]);

  // 3. Draw route when from/to are set
  useEffect(() => {
    if (!routingLoaded || !mapInstance.current || !from || !to) return;

    if (routingControl.current) {
      try { mapInstance.current.removeControl(routingControl.current); } catch (_) {}
      routingControl.current = null;
    }

    setStatus("loading");
    setRouteInfo(null);

    routingControl.current = L.Routing.control({
      waypoints: [L.latLng(from.lat, from.lng), L.latLng(to.lat, to.lng)],
      routeWhileDragging: false,
      addWaypoints: false,
      fitSelectedRoutes: true,
      showAlternatives: false,
      lineOptions: { styles: [{ color: "#2563eb", opacity: 0.8, weight: 5 }] },
    })
      .on("routesfound", (e) => {
        const s = e.routes[0].summary;
        setRouteInfo({
          distKm: +(s.totalDistance / 1000).toFixed(2),
          durationMin: Math.round(s.totalTime / 60),
        });
        setStatus("done");
      })
      .on("routingerror", () => setStatus("error"))
      .addTo(mapInstance.current);

    const panel = routingControl.current.getContainer?.();
    if (panel) panel.style.display = "none";
  }, [from, to, routingLoaded]);

  // 4. Live GPS Tracking (watchPosition)
  const toggleLiveNavigation = () => {
    if (isLiveNavigating) {
      // Stop tracking
      if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
      setIsLiveNavigating(false);
      return;
    }

    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }

    setIsLiveNavigating(true);
    setTraveledKm(0);
    lastGpsPosRef.current = null;

    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        const currentLatLng = [lat, lng];

        // Update or create user GPS marker on map
        if (mapInstance.current) {
          if (!userMarkerRef.current) {
            const gpsIcon = L.divIcon({
              className: "lt-gps-icon",
              html: `<div class="lt-gps-dot"></div>`,
              iconSize: [14, 14],
              iconAnchor: [7, 7]
            });
            userMarkerRef.current = L.marker(currentLatLng, { icon: gpsIcon }).addTo(mapInstance.current);
          } else {
            userMarkerRef.current.setLatLng(currentLatLng);
          }
        }

        // Accumulate distance if moved > 5 meters
        if (lastGpsPosRef.current) {
          const d = haversineDistance(
            lastGpsPosRef.current.lat, lastGpsPosRef.current.lng,
            lat, lng
          );
          if (d > 0.005) { // 5 meters
            setTraveledKm(prev => +(prev + d).toFixed(3));
            lastGpsPosRef.current = { lat, lng };
          }
        } else {
          lastGpsPosRef.current = { lat, lng };
        }

        // If no 'from' set, set 'from' to current location
        if (!from) {
          const locName = await reverseGeocode(lat, lng);
          setFrom({ name: `My Location (${locName})`, lat, lng });
        }
      },
      (err) => {
        console.error("GPS Error:", err);
        alert("Unable to fetch live GPS coordinates: " + err.message);
        setIsLiveNavigating(false);
      },
      { enableHighAccuracy: false, maximumAge: 5000, timeout: 20000 }
    );
  };

  // 5. Use Current Location for Start Point (with fallback for desktop/local environments)
  const handleUseMyLocation = () => {
    setIsLocating(true);

    const applyLocation = async (lat, lng, label) => {
      const placeName = await reverseGeocode(lat, lng);
      setFrom({ name: `${label} (${placeName})`, lat, lng });
      setIsLocating(false);
      if (mapInstance.current) {
        mapInstance.current.setView([lat, lng], 13);
      }
    };

    // Try standard browser location (enableHighAccuracy: false avoids hardware GPS timeout on desktops)
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => applyLocation(pos.coords.latitude, pos.coords.longitude, "My Location"),
        (err) => {
          console.warn("Browser GPS failed or timed out, trying IP geolocation fallback...", err);
          // IP Fallback for local desktop environments without GPS chips
          fetch("https://ipapi.co/json/")
            .then(res => res.json())
            .then(data => {
              if (data.latitude && data.longitude) {
                applyLocation(data.latitude, data.longitude, "Approximate Location");
              } else {
                throw new Error("Invalid IP location");
              }
            })
            .catch(ipErr => {
              console.error("IP Geolocation failed:", ipErr);
              alert("Could not detect location. Please type your location manually in the box.");
              setIsLocating(false);
            });
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
      );
    } else {
      // Fallback for browsers without geolocation API
      fetch("https://ipapi.co/json/")
        .then(res => res.json())
        .then(data => applyLocation(data.latitude, data.longitude, "Approximate Location"))
        .catch(() => {
          alert("Geolocation is not supported. Please type your location manually.");
          setIsLocating(false);
        });
    }
  };

  // Clean up GPS watch on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  const totalDist = isLiveNavigating && traveledKm > 0 ? traveledKm : (routeInfo?.distKm || 0);
  const co2 = totalDist ? calcCO2(totalDist, vehicle, passengers) : null;

  const markComplete = () => {
    if (!from || !to) return;
    const finalDist = isLiveNavigating && traveledKm > 0 ? traveledKm : (routeInfo?.distKm || 0);
    const record = {
      id: Date.now(),
      date: new Date().toLocaleString(),
      from: from.name,
      to: to.name,
      distKm: finalDist,
      durationMin: routeInfo?.durationMin || 0,
      vehicle: vehicle.label,
      passengers,
      co2: +co2.toFixed(4),
    };
    const updated = [record, ...history].slice(0, 10);
    setHistory(updated);
    saveHistory(updated);
    if (typeof window !== "undefined") window.__liveTrackingLastTrip = record;

    if (isLiveNavigating) toggleLiveNavigation();
    setView("summary");
  };

  const fmtDur = (m) => { const h = Math.floor(m / 60), r = m % 60; return h > 0 ? `${h}h ${r}m` : `${r}m`; };

  return (
    <div style={S.overlay}>
      <div style={S.modal}>

        {/* Top bar */}
        <div style={S.topbar}>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            {[["route", "Route"], ["history", `History (${history.length})`]].map(([v, label]) => (
              <button key={v} onClick={() => setView(v)} style={{ ...S.tab, ...(view === v || (v === "route" && view === "summary") ? S.tabActive : {}) }}>
                {label}
              </button>
            ))}
            {isLiveNavigating && (
              <span style={{ fontSize: "0.72rem", background: "#eff6ff", color: "#2563eb", padding: "3px 8px", borderRadius: 12, fontWeight: 600, border: "1px solid #bfdbfe", display: "flex", alignItems: "center", gap: 6 }}>
                <span className="lt-gps-dot" /> Live GPS Active
              </span>
            )}
          </div>
          <button onClick={onClose} style={S.closeBtn}>Close</button>
        </div>

        {/* ROUTE / SUMMARY views */}
        {(view === "route" || view === "summary") && (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>

            {/* Controls */}
            <div style={S.controls}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <GeoInput
                  label="From"
                  value={from}
                  onChange={setFrom}
                  placeholder="Type location or use GPS..."
                  onUseMyLocation={handleUseMyLocation}
                  isLocating={isLocating}
                />
                <button
                  style={S.swapBtn}
                  title="Swap"
                  onClick={() => { const t = from; setFrom(to); setTo(t); }}
                >
                  swap
                </button>
                <GeoInput label="To" value={to} onChange={setTo} placeholder="Type destination..." />
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div style={{ flex: 2, minWidth: 160 }}>
                  <div style={S.fieldLabel}>Vehicle</div>
                  <select
                    className="lt-input"
                    value={vehicle.label}
                    onChange={e => setVehicle(VEHICLE_OPTIONS.find(v => v.label === e.target.value))}
                  >
                    {VEHICLE_OPTIONS.map(v => <option key={v.label}>{v.label}</option>)}
                  </select>
                </div>
                <div style={{ width: 90 }}>
                  <div style={S.fieldLabel}>Passengers</div>
                  <input
                    className="lt-input"
                    type="number" min={1} max={50}
                    value={passengers}
                    onChange={e => setPassengers(Math.max(1, Number(e.target.value)))}
                  />
                </div>
                
                <button
                  style={{
                    ...S.outlineBtn,
                    borderColor: isLiveNavigating ? "#ef4444" : "#2563eb",
                    color: isLiveNavigating ? "#ef4444" : "#2563eb",
                    fontWeight: 600
                  }}
                  onClick={toggleLiveNavigation}
                >
                  {isLiveNavigating ? "Stop Live GPS" : "Start Live GPS"}
                </button>

                {(status === "done" || isLiveNavigating) && (
                  <button style={S.finishBtn} onClick={markComplete}>Mark Complete</button>
                )}
              </div>

              {/* Status / info strip */}
              {status === "loading" && !isLiveNavigating && <div style={S.statusText}>Calculating route...</div>}
              {status === "error"   && !isLiveNavigating && <div style={{ ...S.statusText, color: "#c00" }}>Could not find route. Try a different location.</div>}
              {(status === "done" || isLiveNavigating) && (
                <div style={S.infoStrip}>
                  <div style={S.infoCell}>
                    <div style={S.infoVal}>{isLiveNavigating ? `${traveledKm} km (Live)` : `${routeInfo?.distKm} km`}</div>
                    <div style={S.infoLbl}>{isLiveNavigating ? "GPS Distance Traveled" : "Route Distance"}</div>
                  </div>
                  <div style={S.infoDivider} />
                  <div style={S.infoCell}>
                    <div style={S.infoVal}>{routeInfo ? fmtDur(routeInfo.durationMin) : "--"}</div>
                    <div style={S.infoLbl}>Estimated Drive Time</div>
                  </div>
                  <div style={S.infoDivider} />
                  <div style={S.infoCell}>
                    <div style={S.infoVal}>{co2?.toFixed(3)} kg</div>
                    <div style={S.infoLbl}>Real-time CO2</div>
                  </div>
                </div>
              )}
            </div>

            {/* Map */}
            {view === "route" && (
              <div style={{ flex: 1, position: "relative", minHeight: 320 }}>
                {!routingLoaded && (
                  <div style={S.mapOverlay}>
                    <div style={S.spinner} /> Loading map...
                  </div>
                )}
                <div ref={mapRef} style={{ position: "absolute", inset: 0 }} />
              </div>
            )}

            {/* Summary */}
            {view === "summary" && (() => {
              const last = history[0];
              if (!last) return null;
              return (
                <div style={{ flex: 1, overflowY: "auto", padding: "24px 24px" }}>
                  <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: 16 }}>Trip Complete</div>
                  <div style={S.summaryGrid}>
                    {[
                      ["From", last.from], ["To", last.to],
                      ["Distance", `${last.distKm} km`], ["Drive time", fmtDur(last.durationMin)],
                      ["Vehicle", last.vehicle], ["Passengers", last.passengers],
                    ].map(([k, v]) => (
                      <div key={k} style={S.summaryRow}>
                        <span style={{ color: "#888", fontSize: "0.82rem" }}>{k}</span>
                        <span style={{ fontWeight: 600, fontSize: "0.84rem" }}>{v}</span>
                      </div>
                    ))}
                  </div>
                  <div style={S.co2Box}>
                    <div style={{ fontSize: "2.2rem", fontWeight: 800, letterSpacing: "-0.02em" }}>{last.co2?.toFixed(3)}</div>
                    <div style={{ fontSize: "0.78rem", color: "#666", marginTop: 4 }}>kg CO2 — total for this trip</div>
                    <div style={{ fontSize: "0.72rem", color: "#aaa", marginTop: 2 }}>
                      {(last.co2 / last.passengers).toFixed(3)} kg per person
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
                    <button style={S.outlineBtn} onClick={() => setView("route")}>New Route</button>
                    <button style={S.outlineBtn} onClick={() => setView("history")}>View History</button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* HISTORY view */}
        {view === "history" && (
          <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px" }}>
            <div style={{ fontSize: "0.72rem", color: "#aaa", marginBottom: 12 }}>
              Showing last {history.length} trip{history.length !== 1 ? "s" : ""} — stored in browser
            </div>
            {history.length === 0 && (
              <div style={{ color: "#ccc", textAlign: "center", paddingTop: 48, fontSize: "0.85rem" }}>No trips recorded yet.</div>
            )}
            {history.map((h, i) => (
              <div key={h.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f2f2f2" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "#ccc", minWidth: 16, textAlign: "right" }}>{i + 1}</span>
                  <div>
                    <div style={{ fontSize: "0.84rem", fontWeight: 600 }}>{h.from} — {h.to}</div>
                    <div style={{ fontSize: "0.72rem", color: "#999", marginTop: 1 }}>{h.date} · {h.vehicle} · {h.passengers} pax</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "0.84rem", fontWeight: 700 }}>{h.distKm} km</div>
                    <div style={{ fontSize: "0.72rem", color: "#2d6a4f", fontWeight: 600 }}>{h.co2?.toFixed(3)} kg CO2</div>
                  </div>
                  <button className="lt-hist-del" onClick={() => {
                    const u = history.filter(x => x.id !== h.id);
                    setHistory(u); saveHistory(u);
                  }}>x</button>
                </div>
              </div>
            ))}
            {history.length > 0 && (
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #eee", display: "flex", gap: 32 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>{history.reduce((s, h) => s + h.distKm, 0).toFixed(1)} km</div>
                  <div style={{ fontSize: "0.72rem", color: "#999" }}>Total distance</div>
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "#2d6a4f" }}>{history.reduce((s, h) => s + (h.co2 || 0), 0).toFixed(3)} kg</div>
                  <div style={{ fontSize: "0.72rem", color: "#999" }}>Total CO2</div>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

const S = {
  overlay: { position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  modal: { background: "#fff", borderRadius: 10, overflow: "hidden", width: "100%", maxWidth: 820, height: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" },
  topbar: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid #eee", flexShrink: 0 },
  tab: { background: "none", border: "none", cursor: "pointer", fontSize: "0.82rem", color: "#aaa", padding: "5px 12px", borderRadius: 6, fontFamily: "inherit" },
  tabActive: { color: "#111", fontWeight: 700, background: "#f2f2f2" },
  closeBtn: { background: "none", border: "1px solid #e5e5e5", cursor: "pointer", fontSize: "0.78rem", color: "#888", padding: "5px 12px", borderRadius: 6, fontFamily: "inherit" },
  controls: { padding: "12px 14px", borderBottom: "1px solid #eee", flexShrink: 0 },
  fieldLabel: { fontSize: "0.7rem", color: "#999", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" },
  swapBtn: { background: "#f2f2f2", border: "none", borderRadius: 6, padding: "0 12px", height: 34, cursor: "pointer", fontSize: "0.78rem", color: "#555", flexShrink: 0, alignSelf: "flex-end", fontFamily: "inherit" },
  finishBtn: { background: "#111", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontSize: "0.8rem", alignSelf: "flex-end", fontFamily: "inherit" },
  statusText: { marginTop: 8, fontSize: "0.78rem", color: "#999" },
  infoStrip: { display: "flex", marginTop: 10, border: "1px solid #eee", borderRadius: 8, overflow: "hidden" },
  infoCell: { flex: 1, padding: "8px 12px", display: "flex", flexDirection: "column", alignItems: "center" },
  infoVal: { fontSize: "0.9rem", fontWeight: 700, color: "#111" },
  infoLbl: { fontSize: "0.68rem", color: "#aaa", marginTop: 2 },
  infoDivider: { width: 1, background: "#eee", alignSelf: "stretch" },
  mapOverlay: { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#f8f8f8", zIndex: 10, gap: 10, fontSize: "0.82rem", color: "#aaa" },
  spinner: { width: 22, height: 22, border: "2px solid #e5e5e5", borderTop: "2px solid #555", borderRadius: "50%", animation: "lt-spin 0.8s linear infinite" },
  summaryGrid: { background: "#f9f9f9", borderRadius: 8, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 },
  summaryRow: { display: "flex", justifyContent: "space-between" },
  co2Box: { textAlign: "center", padding: "20px 0", marginTop: 16, borderTop: "1px solid #eee", borderBottom: "1px solid #eee" },
  outlineBtn: { border: "1px solid #ddd", background: "#fff", borderRadius: 6, padding: "7px 18px", cursor: "pointer", fontSize: "0.8rem", color: "#333", fontFamily: "inherit" },
};
