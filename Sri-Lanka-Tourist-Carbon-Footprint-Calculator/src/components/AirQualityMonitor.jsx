import React, { useState, useEffect, useRef, useCallback } from "react";

const MAX_HISTORY = 40;

const airQuality = (ppm) => {
  if (ppm < 800)  return { label: "Excellent", color: "#22c55e", bg: "#052e16" };
  if (ppm < 1000) return { label: "Good",      color: "#86efac", bg: "#064e26" };
  if (ppm < 1500) return { label: "Moderate",   color: "#fbbf24", bg: "#2d1d04" };
  if (ppm < 2000) return { label: "Poor",       color: "#f97316", bg: "#2d1005" };
  return                  { label: "Dangerous",  color: "#f87171", bg: "#2d0505" };
};

export default function AirQualityMonitor() {
  const [collapsed, setCollapsed] = useState(false);
  const [espIp, setEspIp] = useState(() => localStorage.getItem("esp32_ip") || "");
  const [ipInput, setIpInput] = useState(() => localStorage.getItem("esp32_ip") || "");
  const [co2, setCo2] = useState(null);
  const [raw, setRaw] = useState(null);
  const [connected, setConnected] = useState(false);
  const [gpsData, setGpsData] = useState(null);
  const [ipLocation, setIpLocation] = useState(null);
  const historyRef = useRef([]);
  const canvasRef = useRef(null);
  const intervalRef = useRef(null);

  // ── Draw sparkline chart ──
  const drawChart = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const history = historyRef.current;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = 60;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    if (history.length < 2) {
      ctx.fillStyle = "#64748b";
      ctx.font = "11px 'DM Sans', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Waiting for data…", W / 2, H / 2 + 4);
      return;
    }

    const min = Math.min(...history) * 0.95;
    const max = Math.max(...history) * 1.05 || 1;
    const pad = 4;
    const pts = history.map((v, i) => ({
      x: pad + (i / (MAX_HISTORY - 1)) * (W - pad * 2),
      y: H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2),
    }));

    // Fill gradient
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "rgba(45,106,79,0.35)");
    grad.addColorStop(1, "rgba(45,106,79,0.0)");
    ctx.beginPath();
    ctx.moveTo(pts[0].x, H);
    pts.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.lineTo(pts[pts.length - 1].x, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.strokeStyle = "#2d6a4f";
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.stroke();

    // Dot
    const last = pts[pts.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#2d6a4f";
    ctx.fill();
  }, []);

  // ── Fetch sensor data ──
  const fetchData = useCallback(async () => {
    if (!espIp) return;
    try {
      const r = await fetch(`http://${espIp}/api/data`, { signal: AbortSignal.timeout(3000) });
      const d = await r.json();
      setCo2(d.co2);
      setRaw(d.raw);
      setConnected(true);
      historyRef.current.push(d.co2);
      if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
      drawChart();
    } catch {
      setConnected(false);
    }
  }, [espIp, drawChart]);

  // ── Fetch GPS location from ESP32 ──
  const fetchGPS = useCallback(async () => {
    if (!espIp) return;
    try {
      const r = await fetch(`http://${espIp}/api/location`, { signal: AbortSignal.timeout(3000) });
      const d = await r.json();
      if (d.lat !== 0) setGpsData(d);
    } catch { /* ignore */ }
  }, [espIp]);

  // ── Fetch IP-based location ──
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("http://ip-api.com/json/");
        const d = await r.json();
        if (d.status === "success") {
          setIpLocation(`${d.city}, ${d.regionName}, ${d.country}`);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  // ── Polling loop ──
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (espIp) {
      fetchData();
      fetchGPS();
      intervalRef.current = setInterval(fetchData, 3000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [espIp, fetchData, fetchGPS]);

  // ── Connect ──
  const handleConnect = () => {
    const trimmed = ipInput.trim();
    if (trimmed) {
      localStorage.setItem("esp32_ip", trimmed);
      setEspIp(trimmed);
      historyRef.current = [];
      setCo2(null);
      setRaw(null);
      setConnected(false);
      setGpsData(null);
    }
  };

  // ── Disconnect ──
  const handleDisconnect = () => {
    localStorage.removeItem("esp32_ip");
    setEspIp("");
    setIpInput("");
    setCo2(null);
    setRaw(null);
    setConnected(false);
    setGpsData(null);
    historyRef.current = [];
    if (intervalRef.current) clearInterval(intervalRef.current);
  };

  const quality = co2 !== null ? airQuality(co2) : null;

  return (
    <div className="aqm-panel">
      <button
        className="aqm-header"
        type="button"
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="aqm-header-left">
          <span className={`aqm-dot ${connected ? "aqm-dot--live" : "aqm-dot--off"}`} />
          <span className="aqm-title">🌍 Air Quality</span>
        </span>
        {co2 !== null && !collapsed && (
          <span className="aqm-header-badge" style={{ color: quality.color, background: quality.bg }}>
            {quality.label}
          </span>
        )}
        <span className={`aqm-chevron ${collapsed ? "" : "aqm-chevron--open"}`}>▸</span>
      </button>

      {!collapsed && (
        <div className="aqm-body">
          {/* ── Connection input ── */}
          {!espIp ? (
            <div className="aqm-connect">
              <label className="aqm-label">ESP32 IP Address</label>
              <div className="aqm-connect-row">
                <input
                  type="text"
                  className="aqm-ip-input"
                  value={ipInput}
                  onChange={(e) => setIpInput(e.target.value)}
                  placeholder="192.168.1.42"
                  onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                />
                <button className="btn btn-primary aqm-connect-btn" type="button" onClick={handleConnect}>
                  Connect
                </button>
              </div>
              <p className="aqm-hint">Enter the IP shown on ESP32 serial monitor</p>
            </div>
          ) : (
            <>
              {/* ── Status bar ── */}
              <div className="aqm-status-bar">
                <span className={`aqm-dot ${connected ? "aqm-dot--live" : "aqm-dot--off"}`} />
                <span className="aqm-status-text">
                  {connected ? "Live" : "Connecting…"} — {espIp}
                </span>
                <button className="aqm-disconnect" type="button" onClick={handleDisconnect} title="Disconnect">
                  ✕
                </button>
              </div>

              {/* ── CO₂ reading ── */}
              <div className="aqm-readings">
                <div className="aqm-reading-card aqm-reading-co2">
                  <div className="aqm-reading-label">CO₂ Level</div>
                  <div className="aqm-reading-value">{co2 !== null ? co2.toFixed(1) : "—"}</div>
                  <div className="aqm-reading-unit">PPM</div>
                </div>
                <div className="aqm-reading-card aqm-reading-raw">
                  <div className="aqm-reading-label">Raw ADC</div>
                  <div className="aqm-reading-value">{raw !== null ? raw : "—"}</div>
                  <div className="aqm-reading-unit">0 – 4095</div>
                </div>
              </div>

              {/* ── Badge ── */}
              {quality && (
                <div className="aqm-quality-badge" style={{ color: quality.color, background: quality.bg }}>
                  {quality.label}
                </div>
              )}

              {/* ── Sparkline ── */}
              <div className="aqm-chart-wrap">
                <div className="aqm-chart-label">CO₂ History (last {MAX_HISTORY} readings)</div>
                <canvas ref={canvasRef} className="aqm-chart-canvas" />
              </div>

              {/* ── Location info ── */}
              {ipLocation && (
                <div className="aqm-location-row">
                  <span className="aqm-location-icon">🌐</span>
                  <span className="aqm-location-text">{ipLocation}</span>
                </div>
              )}

              {gpsData && (
                <div className="aqm-gps-section">
                  <div className="aqm-gps-label">📍 Exact GPS</div>
                  <div className="aqm-gps-coords">
                    {parseFloat(gpsData.lat).toFixed(6)}, {parseFloat(gpsData.lng).toFixed(6)}
                  </div>
                  {gpsData.acc > 0 && (
                    <div className="aqm-gps-acc">Accuracy: ~{gpsData.acc}m</div>
                  )}
                  <a
                    href={`https://www.google.com/maps?q=${gpsData.lat},${gpsData.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="aqm-maps-link"
                  >
                    🔗 Open in Google Maps
                  </a>
                </div>
              )}

              {/* ── Scale reference ── */}
              <div className="aqm-scale">
                <div className="aqm-scale-title">CO₂ Scale</div>
                {[
                  { label: "Excellent", color: "#22c55e", range: "< 800" },
                  { label: "Good",      color: "#86efac", range: "800 – 1000" },
                  { label: "Moderate",   color: "#fbbf24", range: "1000 – 1500" },
                  { label: "Poor",       color: "#f97316", range: "1500 – 2000" },
                  { label: "Dangerous",  color: "#f87171", range: "> 2000" },
                ].map((s) => (
                  <div className="aqm-scale-row" key={s.label}>
                    <span className="aqm-scale-dot" style={{ background: s.color }} />
                    <span>{s.label}</span>
                    <span className="aqm-scale-range">{s.range}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Small inline badge for the topbar — shows current CO₂ + quality */
export function AirQualityBadge() {
  const [co2, setCo2] = useState(null);
  const [connected, setConnected] = useState(false);
  const espIp = localStorage.getItem("esp32_ip") || "";

  useEffect(() => {
    if (!espIp) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch(`http://${espIp}/api/data`, { signal: AbortSignal.timeout(3000) });
        const d = await r.json();
        if (!cancelled) { setCo2(d.co2); setConnected(true); }
      } catch {
        if (!cancelled) setConnected(false);
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [espIp]);

  if (!espIp || co2 === null) return null;

  const q = airQuality(co2);

  return (
    <span className="aqm-topbar-badge" title="Live CO₂ from ESP32">
      <span className={`aqm-dot-sm ${connected ? "aqm-dot--live" : "aqm-dot--off"}`} />
      <span style={{ fontWeight: 600 }}>{co2.toFixed(0)}</span>
      <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>PPM</span>
      <span className="aqm-topbar-quality" style={{ color: q.color, background: q.bg }}>
        {q.label}
      </span>
    </span>
  );
}
