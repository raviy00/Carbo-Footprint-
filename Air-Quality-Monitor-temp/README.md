# 🌍 ESP32 Air Quality Monitor

A real-time CO₂ air quality monitor using an ESP32 and MQ-135 sensor, with a beautiful dark-themed web dashboard served directly from the ESP32.

![Dashboard Preview](docs/dashboard.png)

## ✨ Features

- **Live CO₂ PPM readings** with 40-point history chart
- **Dark responsive dashboard** — works perfectly on phone browsers
- **IP-based approximate location** (auto-loads on page open)
- **Exact GPS via phone** — uses a `data:` URI trick to bypass HTTP/HTTPS restriction
- **Google Maps link** to your exact pinned location
- **Air quality badge** (Excellent / Good / Moderate / Poor / Dangerous)

## 🔧 Hardware Required

| Component | Details |
|-----------|---------|
| ESP32 Dev Board | Any standard ESP32 |
| MQ-135 Gas Sensor | Connected to GPIO 32 (analog) |
| Power supply | USB (5V via computer or charger) |

### Wiring

```
MQ-135 VCC  → ESP32 3.3V or 5V
MQ-135 GND  → ESP32 GND
MQ-135 AOUT → ESP32 GPIO 32
```

---

## 📦 Software Setup

### 1. Install Arduino IDE
Download from: https://www.arduino.cc/en/software

### 2. Add ESP32 Board Support
In Arduino IDE → **File → Preferences**, add this URL to "Additional Boards Manager URLs":
```
https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
```
Then go to **Tools → Board → Boards Manager**, search `esp32`, install **esp32 by Espressif Systems**.

### 3. Install MQ135 Library
**Sketch → Include Library → Manage Libraries** → search `MQ135` → install **MQ135 by GeorgK**.

### 4. Configure the Sketch
Open `AirQualityMonitor/AirQualityMonitor.ino` and change these 4 values:

```cpp
const char* ssid     = "YOUR_WIFI_NAME";       // ← your WiFi name
const char* password = "YOUR_WIFI_PASSWORD";   // ← your WiFi password
float g_temp         = 25.0;                   // ← your room temperature °C
float g_humidity     = 60.0;                   // ← your room humidity %
```

### 5. Upload to ESP32
- **Tools → Board** → select `ESP32 Dev Module`
- **Tools → Port** → select the COM port for your ESP32
- Click **Upload** ⬆️

### 6. Open the Dashboard
- Open **Serial Monitor** at baud rate `115200`
- Wait ~60 seconds for sensor warmup
- The IP address will print, e.g. `http://192.168.1.42`
- Open that URL on your phone (**same WiFi network**)

---

## 📍 Getting Exact GPS Location

Because the ESP32 serves plain `http://` (not `https://`), browsers block direct GPS access.

**Our solution — the `data:` URI trick:**
1. On the dashboard, tap **"Get Exact GPS from Phone"**
2. A new tab opens (a self-contained HTML page as a `data:` URI)
3. Tap **"Allow GPS & Send to ESP32"** and grant location permission
4. Your exact coordinates are sent back to the ESP32 and stored
5. Return to the dashboard — your location + a **Google Maps link** appear

> **Why it works:** `data:` URI pages are treated as local content by the browser, so GPS access is allowed even though the ESP32 uses plain HTTP.

---

## 🌡️ CO₂ Scale Reference

| Level | PPM Range | Meaning |
|-------|-----------|---------|
| 🟢 Excellent | < 800 PPM | Fresh outdoor air |
| 🟩 Good | 800–1000 PPM | Normal indoor |
| 🟡 Moderate | 1000–1500 PPM | Slightly stuffy |
| 🟠 Poor | 1500–2000 PPM | Open windows |
| 🔴 Dangerous | > 2000 PPM | Ventilate immediately |

---

## 🔬 Sensor Calibration (Optional)

For more accurate CO₂ readings:
1. Power the ESP32 outdoors in fresh air for 30 minutes
2. Read the printed RZero values from Serial Monitor
3. Average them and update `RZERO_CALIBRATED` in the sketch:

```cpp
#define RZERO_CALIBRATED 76.63  // ← update this
```

---

## 📁 Project Structure

```
AirQualityMonitor/
├── AirQualityMonitor/
│   └── AirQualityMonitor.ino    # Main Arduino sketch
├── docs/
│   └── dashboard.png            # Screenshot (optional)
├── .gitignore
└── README.md
```

---

## 📜 License

MIT License — free to use, modify, and distribute.
