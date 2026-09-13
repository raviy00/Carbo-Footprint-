/*
 * =========================================================
 *  Air Quality Monitor — ESP32 + MQ-135
 *  Repository: https://github.com/raviy00/Air-Quality-Monitor
 * =========================================================
 *  Features:
 *    - CO2 PPM reading via MQ-135
 *    - WiFi web dashboard (dark UI, live chart)
 *    - IP-based approximate location (auto)
 *    - Exact GPS via GitHub Pages HTTPS helper (no mixed-content issue)
 *    - Google Maps link
 * =========================================================
 *  Libraries needed (install via Arduino Library Manager):
 *    - MQ135 by GeorgK
 *  Board: ESP32 Dev Module
 * =========================================================
 */

#include <WiFi.h>
#include <WebServer.h>
#include "MQ135.h"

// ─────────────────────────────────────────────────────────────────
//  WiFi Credentials  ← CHANGE THESE
// ─────────────────────────────────────────────────────────────────
const char* ssid     = "YOUR_WIFI_NAME";      // ← CHANGE THIS (do not push to GitHub)
const char* password = "YOUR_WIFI_PASSWORD";  // ← CHANGE THIS (do not push to GitHub)

// ─────────────────────────────────────────────────────────────────
//  Hardware Config
// ─────────────────────────────────────────────────────────────────
#define PIN_MQ135          32
#define RZERO_CALIBRATED   76.63   // Replace after outdoor calibration

MQ135      mq135_sensor(PIN_MQ135);
WebServer  server(80);

// ─────────────────────────────────────────────────────────────────
//  Global Data
// ─────────────────────────────────────────────────────────────────
float         g_co2       = 0;
int           g_raw       = 0;
float         g_temp      = 25.0;   // ← set your room temperature (°C)
float         g_humidity  = 60.0;   // ← set your room humidity (%)
float         g_lat       = 0.0;
float         g_lng       = 0.0;
int           g_gps_acc   = 0;
String        g_gps_time  = "";
unsigned long lastRead    = 0;

// ─────────────────────────────────────────────────────────────────
//  Dashboard HTML  (stored in flash via PROGMEM)
// ─────────────────────────────────────────────────────────────────
const char DASHBOARD[] PROGMEM = R"rawhtml(
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Air Quality Monitor</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh;padding:20px}
    h1{text-align:center;font-size:1.2rem;margin-bottom:20px;color:#94a3b8;
       letter-spacing:2px;text-transform:uppercase}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px}
    .card{background:#1e293b;border-radius:16px;padding:18px;text-align:center}
    .card .label{font-size:.68rem;color:#64748b;text-transform:uppercase;
                 letter-spacing:1px;margin-bottom:6px}
    .card .value{font-size:2rem;font-weight:700}
    .card .unit{font-size:.78rem;color:#94a3b8;margin-top:4px}
    .co2 .value{color:#38bdf8}
    .raw .value{color:#a78bfa}
    .status-bar{background:#1e293b;border-radius:12px;padding:12px 16px;
                margin-bottom:12px;display:flex;align-items:center;gap:10px}
    .dot{width:9px;height:9px;border-radius:50%;background:#22c55e;
         flex-shrink:0;animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
    .badge{display:inline-block;padding:2px 10px;border-radius:20px;
           font-size:.72rem;font-weight:600;margin-left:6px}
    .time{margin-left:auto;font-size:.72rem;color:#475569}
    .history-card{background:#1e293b;border-radius:16px;padding:14px 16px;margin-bottom:14px}
    .history-label{font-size:.68rem;color:#64748b;text-transform:uppercase;
                   letter-spacing:1px;margin-bottom:10px}
    canvas{width:100%;height:80px;display:block}
    .loc-card{background:#1e293b;border-radius:16px;padding:16px;margin-bottom:14px}
    .loc-card h3{font-size:.68rem;color:#64748b;text-transform:uppercase;
                 letter-spacing:1px;margin-bottom:10px}
    #loc-text{font-size:.88rem;color:#94a3b8;line-height:1.7}
    .action-btn{margin-top:12px;width:100%;padding:12px;background:#2563eb;color:white;
             border:none;border-radius:12px;font-size:.88rem;cursor:pointer;font-weight:600}
    .action-btn:disabled{background:#1e3a6e;color:#64748b;cursor:default}
    #calc-btn{background:#7c3aed;margin-top:8px}
    .ip-loc{background:#1e293b;border-radius:12px;padding:10px 14px;
            font-size:.75rem;color:#475569;margin-bottom:14px}
    .scale{background:#1e293b;border-radius:16px;padding:14px 16px;margin-bottom:14px}
    .scale h3{font-size:.68rem;color:#64748b;text-transform:uppercase;
              letter-spacing:1px;margin-bottom:10px}
    .scale-row{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:.78rem}
    .scale-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
    .scale-range{color:#64748b;margin-left:auto;font-size:.7rem}
    .footer{text-align:center;font-size:.68rem;color:#334155;padding-bottom:10px}
  </style>
</head>
<body>
  <h1>&#127756; Air Quality Monitor</h1>

  <div class="status-bar">
    <div class="dot"></div>
    <span style="font-size:.82rem">Live</span>
    <span class="badge" id="badge">—</span>
    <span class="time" id="last-time">—</span>
  </div>

  <div class="grid">
    <div class="card co2">
      <div class="label">CO&#8322; Level</div>
      <div class="value" id="co2">—</div>
      <div class="unit">PPM</div>
    </div>
    <div class="card raw">
      <div class="label">Raw ADC</div>
      <div class="value" id="raw">—</div>
      <div class="unit">0 – 4095</div>
    </div>
  </div>

  <div class="history-card">
    <div class="history-label">CO&#8322; History (last 40 readings)</div>
    <canvas id="chart"></canvas>
  </div>

  <div class="ip-loc" id="ip-loc">&#127757; Fetching approximate location...</div>

  <div class="loc-card">
    <h3>&#128205; Exact GPS Location & Tools</h3>
    <div id="loc-text">Use the GitHub Pages helper to send your exact GPS location.</div>
    <button class="action-btn" id="gps-btn" onclick="openGPSHelper()">&#128279; Open GPS Helper</button>
    <button class="action-btn" id="calc-btn" onclick="openTripCalc()">&#128663; Open CO&#8322; Trip Calculator</button>
  </div>

  <div class="scale">
    <h3>CO&#8322; Scale Reference</h3>
    <div class="scale-row"><div class="scale-dot" style="background:#22c55e"></div><span>Excellent</span><span class="scale-range">&lt; 800 PPM</span></div>
    <div class="scale-row"><div class="scale-dot" style="background:#86efac"></div><span>Good</span><span class="scale-range">800 – 1000 PPM</span></div>
    <div class="scale-row"><div class="scale-dot" style="background:#fbbf24"></div><span>Moderate</span><span class="scale-range">1000 – 1500 PPM</span></div>
    <div class="scale-row"><div class="scale-dot" style="background:#f97316"></div><span>Poor</span><span class="scale-range">1500 – 2000 PPM</span></div>
    <div class="scale-row"><div class="scale-dot" style="background:#f87171"></div><span>Dangerous</span><span class="scale-range">&gt; 2000 PPM</span></div>
  </div>

  <div class="footer">ESP32 Air Quality Monitor &nbsp;|&nbsp; MQ-135 Sensor</div>

  <script>
    const history = [];
    const MAX_H   = 40;

    function airQuality(ppm) {
      if (ppm < 800)  return { label:'Excellent', color:'#22c55e', bg:'#052e16' };
      if (ppm < 1000) return { label:'Good',      color:'#86efac', bg:'#052e16' };
      if (ppm < 1500) return { label:'Moderate',  color:'#fbbf24', bg:'#2d1d04' };
      if (ppm < 2000) return { label:'Poor',       color:'#f97316', bg:'#2d1005' };
      return                  { label:'Dangerous', color:'#f87171', bg:'#2d0505' };
    }

    function drawChart() {
      const canvas = document.getElementById('chart');
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.offsetWidth, H = 80;
      canvas.width  = W * dpr;
      canvas.height = H * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, W, H);
      if (history.length < 2) return;
      const min = Math.min(...history) * 0.95;
      const max = Math.max(...history) * 1.05;
      const pad = 4;
      const pts = history.map((v, i) => ({
        x: pad + (i / (MAX_H - 1)) * (W - pad * 2),
        y: H - pad - ((v - min) / (max - min)) * (H - pad * 2)
      }));
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, 'rgba(56,189,248,0.3)');
      grad.addColorStop(1, 'rgba(56,189,248,0.0)');
      ctx.beginPath();
      ctx.moveTo(pts[0].x, H);
      pts.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.lineTo(pts[pts.length-1].x, H);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.beginPath();
      pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
      const last = pts[pts.length-1];
      ctx.beginPath();
      ctx.arc(last.x, last.y, 3, 0, Math.PI*2);
      ctx.fillStyle = '#38bdf8';
      ctx.fill();
    }

    async function fetchData() {
      try {
        const r = await fetch('/api/data');
        const d = await r.json();
        document.getElementById('co2').textContent = d.co2.toFixed(1);
        document.getElementById('raw').textContent = d.raw;
        history.push(d.co2);
        if (history.length > MAX_H) history.shift();
        drawChart();
        const q = airQuality(d.co2);
        const b = document.getElementById('badge');
        b.textContent  = q.label;
        b.style.color  = q.color;
        b.style.background = q.bg;
        const now = new Date();
        document.getElementById('last-time').textContent =
          now.getHours().toString().padStart(2,'0') + ':' +
          now.getMinutes().toString().padStart(2,'0') + ':' +
          now.getSeconds().toString().padStart(2,'0');
      } catch(e) {}
    }

    async function loadIPLocation() {
      try {
        const r = await fetch('http://ip-api.com/json/');
        const d = await r.json();
        if (d.status === 'success') {
          document.getElementById('ip-loc').textContent =
            '🌍 Approximate: ' + d.city + ', ' + d.regionName + ', ' + d.country +
            '  (ISP: ' + d.isp + ')';
        }
      } catch(e) {
        document.getElementById('ip-loc').textContent = 'IP location unavailable.';
      }
    }

    async function loadSavedGPS() {
      try {
        const r = await fetch('/api/location');
        const d = await r.json();
        if (d.lat !== 0) showGPS(d.lat, d.lng, d.acc, d.time);
      } catch(e) {}
    }

    function showGPS(lat, lng, acc, time) {
      document.getElementById('loc-text').innerHTML =
        '<strong style="color:#38bdf8">Exact GPS Location</strong>' +
        (time ? ' <span style="font-size:.7rem;color:#475569">(set ' + time + ')</span>' : '') +
        '<br>Latitude: '  + parseFloat(lat).toFixed(6) +
        '<br>Longitude: ' + parseFloat(lng).toFixed(6) +
        '<br>Accuracy: ~' + acc + ' metres<br>' +
        '<a href="https://www.google.com/maps?q=' + lat + ',' + lng +
        '" target="_blank" style="color:#60a5fa;font-size:.85rem;text-decoration:none">' +
        '&#128279; Open in Google Maps</a>';
      document.getElementById('gps-btn').textContent = '🔄 Update GPS';
    }

    function openGPSHelper() {
      // Opens the GitHub Pages GPS helper (served over HTTPS — GPS works!)
      // Pre-fills the ESP32 IP so the helper knows where to send the coordinates.
      const ip  = window.location.hostname;
      const url = 'https://raviy00.github.io/Air-Quality-Monitor/?esp=' + ip;
      window.open(url, '_blank');
    }

    function openTripCalc() {
      // Open the CO2 Trip Calculator
      window.open('http://localhost:8080/index.html', '_blank');
    }

    fetchData();
    loadIPLocation();
    loadSavedGPS();
    setInterval(fetchData, 3000);
  </script>
</body>
</html>
)rawhtml";

// ─────────────────────────────────────────────────────────────────
//  HTTP Handlers
// ─────────────────────────────────────────────────────────────────

void handleRoot() {
  server.send_P(200, "text/html", DASHBOARD);
}

void handleAPI() {
  String json = "{";
  json += "\"co2\":"  + String(g_co2, 2)      + ",";
  json += "\"raw\":"  + String(g_raw)          + ",";
  json += "\"temp\":" + String(g_temp, 1)      + ",";
  json += "\"hum\":"  + String(g_humidity, 1);
  json += "}";
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", json);
}

void handleGetLocation() {
  String json = "{";
  json += "\"lat\":"  + String(g_lat, 6)   + ",";
  json += "\"lng\":"  + String(g_lng, 6)   + ",";
  json += "\"acc\":"  + String(g_gps_acc)  + ",";
  json += "\"time\":\"" + g_gps_time + "\"";
  json += "}";
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", json);
}

void handleSetLocation() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");

  if (server.hasArg("plain")) {
    String body = server.arg("plain");

    int li  = body.indexOf("\"lat\":");
    int lni = body.indexOf("\"lng\":");
    int ai  = body.indexOf("\"acc\":");

    if (li  >= 0) g_lat     = body.substring(li  + 6).toFloat();
    if (lni >= 0) g_lng     = body.substring(lni + 6).toFloat();
    if (ai  >= 0) g_gps_acc = body.substring(ai  + 6).toInt();

    unsigned long s = millis() / 1000;
    if      (s < 60)   g_gps_time = String(s)       + "s ago";
    else if (s < 3600) g_gps_time = String(s / 60)  + "m ago";
    else               g_gps_time = String(s / 3600) + "h ago";

    Serial.printf("GPS saved: %.6f, %.6f  acc:%d m\n", g_lat, g_lng, g_gps_acc);
    server.send(200, "application/json", "{\"ok\":true}");
  } else {
    server.send(400, "application/json", "{\"error\":\"no body\"}");
  }
}

void handleSetLocationOptions() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.send(204);
}

// ─────────────────────────────────────────────────────────────────
//  GET /setgps?lat=xx&lng=yy&acc=zz
//  Called by GitHub Pages GPS helper via anchor navigation.
//  Browser allows HTTPS→HTTP navigation (unlike fetch).
// ─────────────────────────────────────────────────────────────────
void handleSetGPS() {
  if (server.hasArg("lat") && server.hasArg("lng")) {
    g_lat     = server.arg("lat").toFloat();
    g_lng     = server.arg("lng").toFloat();
    g_gps_acc = server.hasArg("acc") ? server.arg("acc").toInt() : 0;

    unsigned long s = millis() / 1000;
    if      (s < 60)   g_gps_time = String(s)       + "s ago";
    else if (s < 3600) g_gps_time = String(s / 60)  + "m ago";
    else               g_gps_time = String(s / 3600) + "h ago";

    Serial.printf("GPS saved via GitHub Pages: %.6f, %.6f  acc:%d m\n",
                  g_lat, g_lng, g_gps_acc);

    // Redirect straight to dashboard after saving
    server.sendHeader("Location", "/");
    server.send(302, "text/plain", "Redirecting to dashboard...");
  } else {
    server.send(400, "text/plain", "Missing lat or lng parameters");
  }
}

// ─────────────────────────────────────────────────────────────────
//  Setup
// ─────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Serial.println("\n=== Air Quality Monitor ===");

  // MQ-135 warmup
  Serial.println("Warming up MQ-135 sensor (60 seconds)...");
  for (int i = 60; i > 0; i--) {
    Serial.printf("%d ", i);
    if (i % 10 == 0) Serial.println();
    delay(1000);
  }
  Serial.println("\nWarmup complete.");

  // Connect to WiFi
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 30) {
    delay(500);
    Serial.print(".");
    tries++;
  }
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("\nWiFi failed — restarting...");
    ESP.restart();
  }

  Serial.println("\nConnected!");
  Serial.print("Open this on your phone: http://");
  Serial.println(WiFi.localIP());

  // Register HTTP routes
  server.on("/",                    handleRoot);
  server.on("/api/data",            handleAPI);
  server.on("/api/location",        handleGetLocation);
  server.on("/api/setlocation", HTTP_POST,    handleSetLocation);
  server.on("/api/setlocation", HTTP_OPTIONS, handleSetLocationOptions);
  server.on("/setgps",              handleSetGPS);   // ← GitHub Pages GPS helper endpoint
  server.begin();
  Serial.println("Web server started.");
}

// ─────────────────────────────────────────────────────────────────
//  Loop
// ─────────────────────────────────────────────────────────────────
void loop() {
  server.handleClient();

  if (millis() - lastRead >= 2000) {
    lastRead = millis();
    g_raw  = analogRead(PIN_MQ135);
    g_co2  = mq135_sensor.getCorrectedPPM(g_temp, g_humidity);

    Serial.printf("Raw: %d  CO2: %.1f PPM\n", g_raw, g_co2);
  }
}
