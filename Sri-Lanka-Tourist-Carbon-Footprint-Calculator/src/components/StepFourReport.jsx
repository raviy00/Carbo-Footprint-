import React, { useEffect, useMemo, useState } from "react";
import { ACTIVITY_EMISSION_FACTORS } from "../data";

function StepFourReport({ reportMarkup, base, destinations, legPlans, dayPlans }) {
  const [saveStatus, setSaveStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedTripId, setSavedTripId] = useState(null);
  const [aiInsights, setAiInsights] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [syncedLiveData, setSyncedLiveData] = useState(null);

  const handleSyncLiveTracking = () => {
    let history = [];
    try { history = JSON.parse(localStorage.getItem("lt_trip_history") || "[]"); } catch {}
    const lastTrip = (typeof window !== "undefined" && window.__liveTrackingLastTrip) || history[0] || null;

    if (!lastTrip && history.length === 0) {
      alert("No completed live tracking trips found. Use 'Live Tracking' on the sidebar to record a trip first!");
      return;
    }

    const totalLiveDist = history.reduce((sum, h) => sum + (h.distKm || 0), 0);
    const totalLiveCo2 = history.reduce((sum, h) => sum + (h.co2 || 0), 0);

    setSyncedLiveData({
      lastTrip,
      history,
      totalLiveDist: +totalLiveDist.toFixed(2),
      totalLiveCo2: +totalLiveCo2.toFixed(3),
      syncedAt: new Date().toLocaleTimeString()
    });

    setRefreshKey((prev) => prev + 1);
  };

  const toDayMinutes = (timeValue) => {
    if (!timeValue || !timeValue.includes(":")) return 0;
    const [hours, minutes] = timeValue.split(":").map(Number);
    return (hours * 60) + minutes;
  };

  const normalizedRange = (start, end) => {
    const startMinutes = toDayMinutes(start);
    const endRawMinutes = toDayMinutes(end);
    const endMinutes = endRawMinutes === 0 && startMinutes > 0 ? 1440 : endRawMinutes;
    return { startMinutes, endMinutes };
  };

  const deriveTravelMode = (activityType) => {
    const modeMap = {
      Meal: "N/A",
      Resting: "N/A",
      Walking: "Walking",
      Jogging: "Walking",
      Hiking: "Walking",
      "Bicycle Ride": "Bicycle",
      "Swimming / Snorkeling": "Water",
      Surfing: "Water",
      "Boat Ride": "Boat",
      "Beach Leisure": "N/A",
      "Wildlife Safari": "Jeep",
      "Cultural / Temple Visit": "Private Vehicle",
      Sightseeing: "Private Vehicle",
      Shopping: "Private Vehicle",
      "Spa / Ayurveda": "Private Vehicle",
      "Public Transport": "Public Transport",
      "Private / Hired Vehicle": "Private Vehicle",
      "Airport Transfer": "Private Vehicle",
      "Medical / Hospital Visit": "Private Vehicle",
      Other: "N/A",
      "Vehicle Travel": "Private Vehicle",
      Flight: "Flight",
      Cruise: "Cruise",
      Ferry: "Ferry"
    };

    return modeMap[activityType] || "Private Vehicle";
  };

  const estimateLegDistanceKm = (leg) => {
    const routeKey = `${String(leg.from || "").toLowerCase()} -> ${String(leg.to || "").toLowerCase()}`;
    const legDistanceMap = {
      "bandaranaike international airport (cmb) -> colombo": 35,
      "colombo -> kandy": 115,
      "kandy -> galle": 190,
      "galle -> ella": 155,
      "ella -> nuwara eliya": 55,
      "nuwara eliya -> sigiriya": 110,
      "sigiriya -> bentota": 165,
      "bentota -> anuradhapura": 170,
      "anuradhapura -> yala": 150,
      "yala -> arugam bay": 110,
      "arugam bay -> trincomalee": 145,
      "trincomalee -> jaffna": 250,
      "jaffna -> mirissa": 400,
      "mirissa -> hikkaduwa": 35,
      "hikkaduwa -> negombo": 110,
      "negombo -> dambulla": 150,
      "dambulla -> polonnaruwa": 55,
      "polonnaruwa -> kalpitiya": 155,
      "kalpitiya -> haputale": 240,
      "haputale -> badulla": 40,
      "badulla -> bandaranaike international airport (cmb)": 230,
      "colombo -> bandaranaike international airport (cmb)": 35
    };

    if (legDistanceMap[routeKey]) return legDistanceMap[routeKey];
    return 90 + ((String(leg.from || "").length + String(leg.to || "").length) % 8) * 18;
  };

  const classifyImpactLevel = (emission) => {
    if (emission >= 30) return "High";
    if (emission >= 10) return "Medium";
    return "Low";
  };

  const flattenActivities = useMemo(() => {
    return dayPlans.flatMap((day) => {
      const hotelStar = Number(String(day.hotelStar || "3").replace(/[^0-9]/g, "")) || 3;
      return (day.timeline || []).map((entry) => {
        const { startMinutes, endMinutes } = normalizedRange(entry.start, entry.end);
        const durationMinutes = Math.max(0, endMinutes - startMinutes);
        const activityFactor = ACTIVITY_EMISSION_FACTORS[entry.type] ?? 0.1;
        const emission = (durationMinutes / 60) * activityFactor * Number(base.groupSize || 1);
        const dayLabel = `Day ${day.day}`;
        const level = classifyImpactLevel(emission);
        const prompt = `A tourist has a carbon footprint of ${emission.toFixed(2)} kg CO2 from their ${entry.type} on Day ${day.day}, which is classified as ${level}. Write a short, friendly 2-sentence recommendation.`;

        return {
          dayNumber: day.day,
          dayLabel,
          location: day.location,
          hotelStar,
          activityType: entry.type,
          durationMinutes,
          emission,
          level,
          payload: {
            Age: Number(base.age) || 0,
            Group_Size: Number(base.groupSize) || 1,
            Travel_Mode: deriveTravelMode(entry.type),
            Location: day.location,
            Activity_Type: entry.type,
            Duration_Minutes: Number(durationMinutes.toFixed(2)),
            Hotel_Star: hotelStar,
            Day: day.day,
            Emission: Number(emission.toFixed(2)),
            Level: level,
            Prompt: prompt
          }
        };
      });
    });
  }, [base.age, base.groupSize, dayPlans]);

  const legCandidates = useMemo(() => {
    return (legPlans || []).map((leg, index) => {
      const transportMode = leg.transportMode || "Private Vehicle";
      const lowerMode = transportMode.toLowerCase();
      const travelMode = lowerMode.includes("public")
        ? "Public Transport"
        : lowerMode.includes("bike")
          ? "Bicycle"
          : lowerMode.includes("walk")
            ? "Walking"
            : lowerMode.includes("flight")
              ? "Flight"
              : lowerMode.includes("cruise")
                ? "Cruise"
                : lowerMode.includes("ferry")
                  ? "Ferry"
                  : "Private Vehicle";
      const durationMinutes = Math.max(15, Math.round(estimateLegDistanceKm(leg) * 2.8));
      const emission = (durationMinutes / 60) * 0.55 * Number(base.groupSize || 1);
      const dayNumber = index + 1;
      const dayLabel = `Day ${dayNumber}`;
      const level = classifyImpactLevel(emission);
      const prompt = `A tourist has a carbon footprint of ${emission.toFixed(2)} kg CO2 from their Travel Leg on Day ${dayNumber}, which is classified as ${level}. Write a short, friendly 2-sentence recommendation.`;
      const hotelStar = 3;

      return {
        dayNumber,
        dayLabel,
        location: leg.to,
        hotelStar,
        activityType: "Travel Leg",
        durationMinutes,
        emission,
        level,
        payload: {
          Age: Number(base.age) || 0,
          Group_Size: Number(base.groupSize) || 1,
          Travel_Mode: travelMode,
          Location: leg.to,
          Activity_Type: "Travel Leg",
          Duration_Minutes: Number(durationMinutes.toFixed(2)),
          Hotel_Star: hotelStar,
          Day: dayNumber,
          Emission: Number(emission.toFixed(2)),
          Level: level,
          Prompt: prompt
        }
      };
    });
  }, [base.age, base.groupSize, legPlans]);

  const rankedAIItems = useMemo(() => {
    const source = flattenActivities.length > 0 ? flattenActivities : legCandidates;
    return [...source]
      .sort((left, right) => {
        if (right.emission !== left.emission) {
          return right.emission - left.emission;
        }
        if (right.durationMinutes !== left.durationMinutes) {
          return right.durationMinutes - left.durationMinutes;
        }
        return String(left.activityType).localeCompare(String(right.activityType));
      })
      .slice(0, 3);
  }, [flattenActivities, legCandidates]);

  const topActivitiesSignature = useMemo(
    () => JSON.stringify(rankedAIItems.map((activity) => activity.payload)),
    [rankedAIItems]
  );

  const aiInsightsMarkup = useMemo(() => {
    if (aiLoading) {
      return [
        "<div class='ai-loading'>",
        "<div class='ai-spinner'></div>",
        "<strong>Loading AI Insights...</strong>",
        "<p>Only the top 3 highest-impact items are being analyzed.</p>",
        "</div>"
      ].join("");
    }

    if (aiError) {
      return `<div class='ai-empty'><strong>AI insights unavailable.</strong><p>${aiError}</p></div>`;
    }

    if (!aiInsights.length) {
      return "<div class='ai-empty'><strong>No AI insights yet.</strong><p>Complete the trip details to generate recommendations.</p></div>";
    }

    return aiInsights.map((insight) => `
      <article class="ai-card">
        <div class="ai-card-head">
          <div>
            <div class="ai-label">${insight.dayLabel || "Day"} · Activity Type</div>
            <h4>${insight.activityType}</h4>
          </div>
          <span class="ai-level level-${String(insight.level || "unknown").toLowerCase()}">${insight.level || "unknown"}</span>
        </div>
        <p class="ai-message">${insight.llmMessage || "No recommendation returned."}</p>
        <div class="ai-meta">${insight.dayLabel || "Day"} | Location: ${insight.location} | Duration: ${insight.durationMinutes} min | Emission: ${insight.emission} kg CO2</div>
      </article>
    `).join("");
  }, [aiError, aiInsights, aiLoading]);

  useEffect(() => {
    console.log("[AI Predict] ranked items count:", rankedAIItems.length);
    console.log("[AI Predict] ranked items selected:", rankedAIItems);

    if (!rankedAIItems.length) {
      setAiInsights([]);
      setAiError("");
      setAiLoading(false);
      return undefined;
    }

    let isMounted = true;

    const fetchInsights = async () => {
      setAiLoading(true);
      setAiError("");

      try {
        const results = await Promise.all(
          rankedAIItems.map(async (activity) => {
            // Pull in any live tracking session data the user recorded
            const liveTrip = (typeof window !== "undefined" && window.__liveTrackingLastTrip) || null;
            const liveTrackingContext = liveTrip
              ? {
                  live_route_from: liveTrip.from,
                  live_route_to: liveTrip.to,
                  live_distance_km: liveTrip.distKm,
                  live_duration_min: liveTrip.durationMin,
                  live_vehicle: liveTrip.vehicle,
                  live_passengers: liveTrip.passengers,
                  live_co2_kg: liveTrip.co2,
                }
              : {};

            const payload = {
              ...activity.payload,
              day: Number(activity.dayNumber ?? activity.payload?.Day ?? 1),
              emission: Number(activity.emission?.toFixed?.(2) ?? activity.emission ?? 0),
              // Itinerary summary for LLM context
              total_days: Number(base?.totalDays ?? dayPlans?.length ?? 0),
              group_size: Number(base?.groupSize ?? 1),
              destinations: (destinations || []).map(d => d.location).join(", "),
              leg_count: (legPlans || []).length,
              // Live tracking data
              ...liveTrackingContext,
            };

            console.log("[AI Predict] POST http://localhost:8000/api/predict payload:", payload);
            console.log(JSON.stringify(payload));

            const response = await fetch("http://localhost:8000/api/predict", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            });

            if (!response.ok) {
              throw new Error(`AI API request failed with status ${response.status}`);
            }

            const rawResponseText = await response.text();
            console.log("[AI Predict] Raw response text:", rawResponseText);

            let data = {};
            if (rawResponseText.trim()) {
              try {
                data = JSON.parse(rawResponseText);
              } catch (parseError) {
                console.warn("[AI Predict] Response was not valid JSON:", parseError);
                data = { raw_response: rawResponseText };
              }
            }

            console.log("[AI Predict] Parsed response:", data);

            const llmMessage = data.llm_message ?? data.llmMessage ?? data.message ?? data.response?.llm_message ?? data.response?.message ?? data.raw_response ?? "No message returned.";
            const level = data.level ?? data.risk_level ?? data.severity ?? data.response?.level ?? "unknown";

            return {
              dayLabel: activity.dayLabel,
              activityType: activity.activityType,
              location: activity.location,
              durationMinutes: activity.durationMinutes,
              emission: Number(activity.emission?.toFixed?.(2) ?? activity.emission ?? 0),
              llmMessage: String(llmMessage),
              level: String(level)
            };
          })
        );

        if (isMounted) {
          setAiInsights(results);
        }
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        console.error("[AI Predict] Network or fetch error:", error);
        if (isMounted) {
          setAiInsights([]);
          setAiError(error.message || "Failed to load AI insights.");
        }
      } finally {
        if (isMounted) {
          setAiLoading(false);
        }
      }
    };

    fetchInsights();

    return () => {
      isMounted = false;
    };
  }, [topActivitiesSignature, rankedAIItems, refreshKey]);

  const handlePrint = () => {
    const printWindow = window.open("", "_blank", "width=900,height=700");
    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Carbon Footprint Report</title>
        <style>
          @page { size: A4; margin: 20mm 15mm; }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #1a2318; background: #fff; }
          .report-header { text-align: center; padding-bottom: 14px; margin-bottom: 20px; border-bottom: 2px solid #2d6a4f; }
          .report-header h1 { font-size: 18pt; color: #2d6a4f; margin-bottom: 4px; }
          .report-header p { font-size: 9pt; color: #6b7c69; }
          .report-section { border: 1px solid #dde9e2; border-radius: 6px; padding: 10px 13px; margin-bottom: 12px; background: #fff; border-left: 3px solid #74c69d; page-break-inside: avoid; }
          h3 { font-size: 11pt; font-weight: 700; color: #2d6a4f; margin-bottom: 8px; }
          h4 { font-size: 9.5pt; font-weight: 600; color: #6b7c69; margin: 10px 0 5px; text-transform: uppercase; letter-spacing: 0.05em; }
          ul { padding-left: 16px; margin: 0 0 8px; font-size: 10pt; line-height: 1.8; }
          table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 9.5pt; }
          th { background: #e8f5ee; color: #2d6a4f; padding: 6px 8px; text-align: left; font-weight: 600; font-size: 9pt; }
          td { padding: 5px 8px; border-bottom: 1px solid #dde5db; color: #1a2318; }
          tr:last-child td { border-bottom: none; }
          tr:nth-child(even) td { background: #f7faf7; }
          .report-table { width: 100%; border-collapse: collapse; }
          .ai-report-section { border: 1px solid #d9e9e1; border-radius: 10px; padding: 14px 16px; margin: 14px 0 12px; background: linear-gradient(180deg, #f5fbf8 0%, #ffffff 100%); border-left: 4px solid #2d6a4f; page-break-inside: avoid; }
          .ai-report-section h3 { font-size: 11pt; margin-bottom: 8px; }
          .ai-grid { display: grid; grid-template-columns: 1fr; gap: 10px; }
          .ai-card { border: 1px solid #dde9e2; border-radius: 8px; padding: 10px 12px; background: #fff; }
          .ai-card-head { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; margin-bottom: 8px; }
          .ai-label { font-size: 8pt; color: #6b7c69; text-transform: uppercase; letter-spacing: 0.04em; }
          .ai-card h4 { margin: 2px 0 0; font-size: 10.5pt; color: #1a2318; }
          .ai-level { display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 999px; font-size: 8pt; font-weight: 700; background: #e8f5ee; color: #2d6a4f; }
          .ai-message { margin: 0; font-size: 9.5pt; line-height: 1.55; color: #1a2318; }
          .ai-meta { margin-top: 8px; font-size: 8.5pt; color: #6b7c69; }
          .ai-spinner { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #c7d8cf; border-top-color: #2d6a4f; animation: spin 0.9s linear infinite; }
          @keyframes spin { to { transform: rotate(360deg); } }
          .ai-empty, .ai-loading { border: 1px dashed #c7d8cf; border-radius: 8px; padding: 12px; background: #f9fcfa; color: #395345; }
          .report-footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #dde5db; font-size: 8.5pt; color: #6b7c69; text-align: center; }
        </style>
      </head>
      <body>
        <div class="report-header">
          <h1>Sri Lanka Carbon Footprint Report</h1>
          <p>Generated on ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })} &nbsp;|&nbsp; Travel Agent Carbon Intake System</p>
        </div>
        ${reportMarkup}
        <div class="ai-report-section">
          <h3>AI Key Insights</h3>
          <div class="ai-grid">
            ${aiInsightsMarkup}
          </div>
        </div>
        <div class="report-footer">
          This report was generated by the Sri Lanka Tourist Carbon Footprint Calculator.
          Transport emissions are calculated separately and not included in this report.
        </div>
      </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 500);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus(null);
    try {
      const response = await fetch("http://localhost:5000/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base, destinations, legPlans, dayPlans })
      });
      const data = await response.json();
      if (data.success) {
        setSavedTripId(data.tripId);
        setSaveStatus("success");
      } else {
        setSaveStatus("error");
      }
    } catch (err) {
      console.error("Save error:", err);
      setSaveStatus("error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="step active">
      <h2>Final Report</h2>
      <p className="muted">Review the complete trip carbon footprint report below.</p>

      {/* Save Status */}
      {saveStatus === "success" && (
        <div className="save-status success">
          Report saved successfully! Trip ID: <strong>#{savedTripId}</strong>
        </div>
      )}
      {saveStatus === "error" && (
        <div className="save-status error">
          Failed to save report. Please check the server connection.
        </div>
      )}

      <div className="report" dangerouslySetInnerHTML={{ __html: reportMarkup }} />

      <section className="ai-report-section" style={{ marginTop: 18, padding: 16, borderRadius: 14, border: "1px solid #d9e9e1", background: "linear-gradient(180deg, #f5fbf8 0%, #ffffff 100%)", boxShadow: "0 10px 24px rgba(26, 35, 24, 0.06)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.05rem", color: "#1a2318" }}>AI Key Insights</h3>
            <p style={{ margin: "4px 0 0", color: "#6b7c69", fontSize: "0.88rem" }}>
              Top high-impact activities sent to AI prediction endpoint with live trip data.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              type="button"
              style={{
                background: "linear-gradient(135deg, #52b788, #2d6a4f)",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "8px 14px",
                fontSize: "0.82rem",
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 2px 8px rgba(45, 106, 79, 0.2)",
                fontFamily: "inherit"
              }}
              onClick={handleSyncLiveTracking}
            >
              Sync Live Tracking Data
            </button>
            <div style={{ fontSize: "0.8rem", color: "#2d6a4f", fontWeight: 700 }}>
              {aiLoading ? "Loading..." : `${aiInsights.length} insight${aiInsights.length === 1 ? "" : "s"}`}
            </div>
          </div>
        </div>

        {syncedLiveData && (
          <div style={{ padding: "12px 14px", borderRadius: 10, background: "#e8f5ee", border: "1px solid #a3e6be", marginBottom: 14, color: "#1e4d39" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontWeight: 700, fontSize: "0.86rem" }}>Live Tracking Data Synced ({syncedLiveData.syncedAt})</span>
              <span style={{ fontSize: "0.72rem", background: "#2d6a4f", color: "#fff", padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>Active</span>
            </div>
            <div style={{ display: "flex", gap: 20, fontSize: "0.82rem", flexWrap: "wrap" }}>
              <div>Recorded Trips: <strong>{syncedLiveData.history.length}</strong></div>
              <div>Tracked Distance: <strong>{syncedLiveData.totalLiveDist} km</strong></div>
              <div>Tracked CO₂: <strong>{syncedLiveData.totalLiveCo2} kg</strong></div>
              {syncedLiveData.lastTrip && <div>Last Route: <strong>{syncedLiveData.lastTrip.from} → {syncedLiveData.lastTrip.to}</strong></div>}
            </div>
          </div>
        )}

        {aiError && (
          <div style={{ padding: 12, borderRadius: 10, background: "#fff4f4", color: "#a52828", border: "1px solid #f0caca", marginBottom: 12 }}>
            {aiError}
          </div>
        )}

        {!aiError && aiLoading && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, borderRadius: 10, background: "#f9fcfa", color: "#395345", border: "1px dashed #c7d8cf" }}>
            <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid #c7d8cf", borderTopColor: "#2d6a4f", animation: "spin 0.9s linear infinite" }} />
            <span>Loading AI Insights...</span>
          </div>
        )}

        {!aiError && !aiLoading && aiInsights.length === 0 && (
          <div style={{ padding: 12, borderRadius: 10, background: "#f9fcfa", color: "#395345", border: "1px dashed #c7d8cf" }}>
            No AI insights available yet.
          </div>
        )}

        <div style={{ display: "grid", gap: 12 }}>
          {aiInsights.map((insight) => (
            <article
              key={`${insight.activityType}-${insight.location}-${insight.durationMinutes}`}
              style={{
                border: "1px solid #dde9e2",
                borderRadius: 12,
                background: "#fff",
                padding: 14,
                boxShadow: "0 8px 20px rgba(26, 35, 24, 0.05)"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "#6b7c69" }}>
                    {insight.dayLabel || "Day"} · Activity Type
                  </div>
                  <h4 style={{ margin: "4px 0 0", fontSize: "1rem", color: "#1a2318" }}>{insight.activityType}</h4>
                </div>
                <span style={{ padding: "5px 10px", borderRadius: 999, background: "#e8f5ee", color: "#2d6a4f", fontWeight: 700, fontSize: "0.78rem" }}>
                  {insight.level || "unknown"}
                </span>
              </div>
              <p style={{ margin: 0, lineHeight: 1.6, color: "#1a2318" }}>{insight.llmMessage || "No recommendation returned."}</p>
              <div style={{ marginTop: 10, fontSize: "0.82rem", color: "#6b7c69" }}>
                {insight.dayLabel || "Day"} · Location: {insight.location} · Duration: {insight.durationMinutes} min · Emission: {insight.emission} kg CO2
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className="actions" style={{ display: "flex", gap: 12, marginTop: 14 }}>
        <button className="btn btn-primary" type="button" onClick={handlePrint}>
          Download / Print as PDF (A4)
        </button>
        <button
          className="btn btn-light"
          type="button"
          onClick={handleSave}
          disabled={saving || saveStatus === "success"}
        >
          {saving ? "Saving..." : saveStatus === "success" ? "Saved" : "Save Report"}
        </button>
      </div>
    </section>
  );
}

export default StepFourReport;