const CARBON_API_URL = "http://localhost:8000";

export async function predictTrip(activities) {
  const response = await fetch(`${CARBON_API_URL}/api/predict/trip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(activities),
  });

  if (!response.ok) {
    throw new Error(`Trip prediction request failed with status ${response.status}`);
  }

  return response.json();
}
