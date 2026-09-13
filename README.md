# 🌿 Carbon Footprint Calculator & AI Sustainability Platform

A comprehensive, multi-component platform for tracking, calculating, predicting, and mitigating tourist carbon footprints in Sri Lanka. 

This repository combines a **Full-Stack Web Application**, an **AI/ML Prediction & LLM Recommendation Engine**, and a **Real-Time ESP32 IoT Air Quality Sensor**.

---

## 🏗️ Architecture Overview

```
                                 ┌─────────────────────────────────────────┐
                                 │     Full-Stack Web App (React 18)       │
                                 │   4-Step Trip Wizard & PDF Generator    │
                                 └────────────────────┬────────────────────┘
                                                      │ REST API
                                 ┌────────────────────▼────────────────────┐
                                 │      Node.js + Express Backend          │
                                 │   Emission Factor Engine & SQLite DB    │
                                 └───────────┬──────────────────┬──────────┘
                                             │                  │
                    ┌────────────────────────┴─┐              ┌─┴────────────────────────┐
                    │                          │              │                          │
┌───────────────────▼───────────────────┐    ┌─▼──────────────▼────────────────────┐   ┌─▼────────────────────────┐
│     IoT Air Quality Monitor           │    │    Python ML + LLM Backend          │   │  IoT GPS Transport Module│
│  ESP32 + MQ-135 Real-Time Sensor      │    │  XGBoost Models + Ollama Gemma LLM  │   │  On-Ground Vehicle Tracking │
└───────────────────────────────────────┘    └─────────────────────────────────────┘   └──────────────────────────┘
```

---

## 📁 Repository Structure

| Module | Directory | Technologies | Description |
|---|---|---|---|
| **Web Application** | [`Sri-Lanka-Tourist-Carbon-Footprint-Calculator/`](./Sri-Lanka-Tourist-Carbon-Footprint-Calculator) | React 18, Vite 5, Node.js, Express, SQLite | 4-step wizard for travel agents to capture tourist profiles, itinerary, hotel stays, calculate activity/hotel carbon footprints, and export A4 PDF reports. |
| **ML & LLM Engine** | [`carbon footprint ML+ LLM/`](./carbon%20footprint%20ML+%20LLM) | Python, FastAPI, XGBoost, Scikit-learn, Ollama | Machine learning classification models for carbon footprint prediction combined with local LLM (Ollama Gemma) for personalized eco-travel recommendations. |
| **IoT Air Quality** | [`Air-Quality-Monitor-temp/`](./Air-Quality-Monitor-temp) | ESP32, C++, MQ-135, HTML5/JS | Firmware and web dashboard for ESP32 + MQ-135 gas sensor displaying real-time CO₂ PPM readings, sparkline charts, and phone GPS integration. |

---

## ✨ System Modules & Features

### 1. 🏖️ Sri Lanka Tourist Carbon Calculator (`/Sri-Lanka-Tourist-Carbon-Footprint-Calculator`)
- **4-Step Wizard**:
  - **Step 1 (Trip Profile)**: Tourist profile, country of origin, travel group size, and airport details.
  - **Step 2 (Destinations & Hotels)**: Multi-destination planning across 20 Sri Lankan cities with per-day 3, 4, and 5-star hotel selection.
  - **Step 3 (Itinerary & Activities)**: Timed daily activity scheduling with overlap detection, gap indicators, and 60+ pre-configured location templates.
  - **Step 4 (Emission Summary & PDF)**: Total carbon footprint breakdown (Activity + Hotel) with database storage and downloadable A4 PDF reports.
- **SQLite Database**: Persistent trip logging and history management.
- **Emission Factor Engine**: Configurable IPCC AR6 & DEFRA standard emission factors.

### 2. 🤖 ML Classification & LLM Engine (`/carbon footprint ML+ LLM`)
- **Machine Learning Models**:
  - Compares **XGBoost**, **Random Forest**, **SVM**, **KNN**, and **Logistic Regression** for predicting emission levels.
  - Feature engineering and scaling pipelines saved via `joblib`.
- **FastAPI Endpoints**: REST API serving real-time predictions (`/api/predict`).
- **Ollama LLM Integration**: Generates natural language sustainability advice using `gemma` local models based on predicted emission tiers (Low / Medium / High).

### 3. 🌡️ ESP32 Air Quality Monitor (`/Air-Quality-Monitor-temp`)
- **Real-Time CO₂ Monitoring**: Measures gas levels using MQ-135 connected to ESP32 GPIO 32.
- **Embedded Web Dashboard**: Mobile-responsive dark dashboard served directly from the ESP32 chip.
- **GPS Location Integration**: Uses a `data:` URI technique to bypass HTTP/HTTPS browser location security restrictions.
- **Visual Badges**: Real-time CO₂ PPM scale (Excellent < 800, Good 800-1000, Moderate 1000-1500, Poor 1500-2000, Dangerous > 2000).

---

## ⚡ Getting Started

### Prerequisites
- **Node.js**: v18.x or v20.x LTS
- **Python**: 3.10 or higher
- **Arduino IDE**: 2.x (for ESP32 flashing)
- **Ollama**: (Optional for LLM features) `ollama run gemma3:1b`

---

### Running the Full-Stack Web App

#### 1. Frontend Setup
```bash
cd "Sri-Lanka-Tourist-Carbon-Footprint-Calculator"
npm install
npm run dev
```
> Open http://localhost:5173

#### 2. Express Backend Setup
```bash
cd "Sri-Lanka-Tourist-Carbon-Footprint-Calculator/backend"
npm install
node server.js
```
> Server running on http://localhost:5000

---

### Running the Python ML + LLM Backend

```bash
cd "carbon footprint ML+ LLM"
pip install -r requirements.txt # pandas, scikit-learn, xgboost, fastapi, uvicorn, joblib, ollama
python train_new_model.py      # Train and save best ML model
uvicorn main:app --reload      # Start FastAPI backend
```
> FastAPI running on http://localhost:8000

---

### Flashing the ESP32 IoT Monitor

1. Open `Air-Quality-Monitor-temp/AirQualityMonitor/AirQualityMonitor.ino` in Arduino IDE.
2. Update WiFi credentials:
   ```cpp
   const char* ssid     = "YOUR_WIFI_NAME";
   const char* password = "YOUR_WIFI_PASSWORD";
   ```
3. Select Board `ESP32 Dev Module` and flash to your device.
4. Access the dashboard via the IP address printed on the Serial Monitor (e.g., `http://192.168.1.42`).

---

## 📊 Carbon Emission Factors

### Activity Emissions (kg CO₂ / person / hour)
| Category | Activity | Emission Factor |
|---|---|---|
| 🍽️ Meals | Food consumption | `1.500` |
| 🦁 Wildlife | Safari Jeep | `0.800` |
| 🚗 Transport | Private / Hired Vehicle | `0.550` |
| 💆 Wellness | Spa / Ayurveda | `0.400` |
| 🛍️ Shopping | Retail energy | `0.300` |
| ⛵ Boat Ride | Motor boat | `0.240` |
| 🏛️ Heritage | Cultural site visit | `0.100` |
| 🏊 Sports | Swimming / Surfing | `0.050` |
| 🚶 Active | Walking / Hiking | `0.008 - 0.030` |

### Hotel Emissions (kg CO₂ / person / night)
| Category | Daily Factor |
|---|---|
| ⭐⭐⭐ 3-Star | `20.0 kg` |
| ⭐⭐⭐⭐ 4-Star | `35.0 kg` |
| ⭐⭐⭐⭐⭐ 5-Star | `60.0 kg` |

---

## 📄 License

This project is licensed under the [MIT License](./LICENSE).
