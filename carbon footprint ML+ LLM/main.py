from pathlib import Path
from typing import List, Literal

import joblib
import numpy as np
import pandas as pd
import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


BASE_DIR = Path(__file__).resolve().parent
MODELS_DIR = BASE_DIR / "models"
BEST_MODEL_PATH = MODELS_DIR / "best_model.joblib"
PREPROCESSOR_PATH = MODELS_DIR / "preprocessor.joblib"
ENCODER_PATH = MODELS_DIR / "encoder.joblib"
SCALER_PATH = MODELS_DIR / "scaler.joblib"

OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "llama3"


class TouristData(BaseModel):
    Age: int
    Group_Size: int
    Travel_Mode: str
    Location: str
    Activity_Type: str
    Duration_Minutes: float
    Hotel_Star: int
    day: int
    emission: float


class PredictionResponse(BaseModel):
    carbon_emission_kg: float
    level: Literal["Low", "Medium", "High"]
    llm_message: str


class TripPredictionResponse(BaseModel):
    total_trip_emission_kg: float
    overall_trip_level: Literal["Low", "Medium", "High"]
    overall_llm_message: str
    top_3_high_impact_activities: List[dict]


app = FastAPI(title="Carbon Footprint Prediction API", version="3.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def load_artifacts():
    """Load the trained model and preprocessing artifacts from disk."""
    if not BEST_MODEL_PATH.exists():
        raise FileNotFoundError(f"Model file not found: {BEST_MODEL_PATH}")

    model = joblib.load(BEST_MODEL_PATH)

    preprocessor = None
    if PREPROCESSOR_PATH.exists():
        preprocessor = joblib.load(PREPROCESSOR_PATH)

    encoder = joblib.load(ENCODER_PATH) if ENCODER_PATH.exists() else None
    scaler = joblib.load(SCALER_PATH) if SCALER_PATH.exists() else None

    if preprocessor is None and (encoder is None or scaler is None):
        raise FileNotFoundError(
            "No usable preprocessing artifact found. Expected preprocessor.joblib or both encoder.joblib and scaler.joblib."
        )

    return model, preprocessor, encoder, scaler


def get_level(predicted_value: float) -> Literal["Low", "Medium", "High"]:
    """Map the numeric prediction to a simple emission level."""
    if predicted_value < 10:
        return "Low"
    if predicted_value < 50:
        return "Medium"
    return "High"


def get_trip_level(total_emission: float) -> Literal["Low", "Medium", "High"]:
    """Map total trip emissions to an overall trip level."""
    if total_emission < 50:
        return "Low"
    if total_emission <= 150:
        return "Medium"
    return "High"


def build_feature_frame(request_data: TouristData) -> pd.DataFrame:
    """Convert the request payload into the training feature order."""
    return pd.DataFrame(
        [
            {
                "Age": request_data.Age,
                "Group_Size": request_data.Group_Size,
                "Travel_Mode": request_data.Travel_Mode,
                "Location": request_data.Location,
                "Activity_Type": request_data.Activity_Type,
                "Duration_Minutes": request_data.Duration_Minutes,
                "Hotel_Star": request_data.Hotel_Star,
            }
        ]
    )


def preprocess_input(features: pd.DataFrame, preprocessor, encoder, scaler):
    """Apply the same preprocessing used during training."""
    if preprocessor is not None:
        transformed = preprocessor.transform(features)
        return transformed.toarray() if hasattr(transformed, "toarray") else transformed

    categorical_columns = ["Travel_Mode", "Location", "Activity_Type"]
    numerical_columns = ["Age", "Group_Size", "Duration_Minutes", "Hotel_Star"]

    categorical_part = encoder.transform(features[categorical_columns])
    numerical_part = scaler.transform(features[numerical_columns])

    if hasattr(categorical_part, "toarray"):
        categorical_part = categorical_part.toarray()

    return np.hstack([np.asarray(categorical_part), np.asarray(numerical_part)])


def generate_fallback_recommendation(emission: float, activity_type: str, day: int, level: str) -> str:
    if day == 0 or activity_type == "the entire trip":
        if level == "Low":
            return f"Great job! Your entire trip is highly sustainable with a minimal overall footprint of {emission:.2f} kg CO2."
        if level == "Medium":
            return f"Your entire trip generated a moderate footprint of {emission:.2f} kg CO2. Consider offsetting this by engaging in local eco-activities."
        return f"Your overall trip footprint is quite high at {emission:.2f} kg CO2. We strongly recommend choosing greener transport and accommodations for future travel."

    act_lower = str(activity_type).lower()
    
    if "travel" in act_lower or "leg" in act_lower or "transport" in act_lower:
        if level == "Low":
            return f"Great eco-conscious travel choice for Day {day}! This leg produces only {emission:.2f} kg CO2. Keeping a steady speed and sharing rides helps sustain minimal impact."
        elif level == "Medium":
            return f"Travel leg on Day {day} produces {emission:.2f} kg CO2 (Medium level). Consider switching to a hybrid/EV or Sri Lanka's scenic train to lower your footprint."
        else:
            return f"High emission travel leg on Day {day} ({emission:.2f} kg CO2). Switching to electric transport or public trains will significantly cut this footprint."
    elif "hotel" in act_lower or "stay" in act_lower:
        if level == "Low":
            return f"Great sustainable accommodation choice on Day {day} ({emission:.2f} kg CO2). Supporting green certified hotels keeps emissions minimal."
        else:
            return f"Hotel stay on Day {day} generates {emission:.2f} kg CO2. Choosing solar-powered eco-lodges in Sri Lanka can lower your room footprint."
    else:
        if level == "Low":
            return f"Praise for a low-impact choice on Day {day}! {activity_type} generates only {emission:.2f} kg CO2, making it a very sustainable local experience."
        elif level == "Medium":
            return f"{activity_type} on Day {day} generates {emission:.2f} kg CO2. Grouping local activities into non-motorized walking tours can optimize your daily footprint."
        else:
            return f"{activity_type} on Day {day} has a higher carbon footprint ({emission:.2f} kg CO2). Consider switching to low-emission eco-tours to reduce your total impact."

def get_llm_recommendation(
    emission: float,
    activity_type: str,
    day: int,
    level: str,
    context_activities: list = None,
) -> str:
    """Call local Ollama, or fallback to smart recommendation generator if Ollama is offline."""
    if activity_type == "the entire trip":
        activity_details = "\n".join(
            f"  - Day {activity.get('day')}: {activity.get('activity_type')} in "
            f"{activity.get('location')} for {activity.get('duration_minutes')} minutes; "
            f"{activity.get('predicted_emission_kg'):.2f} kg CO2 ({activity.get('level')} level)"
            for activity in (context_activities or [])
        ) or "  - No activity details were provided."
        
        prompt = f"""
        You are an Eco-Tourism Assistant for Sri Lanka.
        
        Trip Data:
        - Total Emission: {emission:.2f} kg CO2
        - Severity: {level}
        - High-Impact Activities:
        {activity_details}
        
        TASK: Write EXACTLY 2 sentences in a single paragraph. 
        Sentence 1: State the total emission ({emission:.2f} kg CO2) and briefly explain that it is driven by the specific activities listed above. DO NOT invent data or numbers.
        Sentence 2: Give ONE specific, actionable eco-friendly tip for Sri Lanka to reduce this footprint based ONLY on the locations provided.
        
        STRICT RULES:
        - NO headings.
        - NO bold text or asterisks.
        - NO bullet points.
        - OUTPUT ONLY THE 2 SENTENCES. NOTHING ELSE.
        """
    else:
        prompt = f"""
        You are a Sustainability Expert and Carbon Footprint Analyst.
        
        Context Data:
        - Activity: {activity_type} on Day {day}
        - Calculated Carbon Emission: {emission:.2f} kg CO2
        - Severity Level: {level}

        Strict Rules for your response:
        1. You MUST explicitly mention the exact emission value ({emission:.2f} kg CO2) and the activity ({activity_type}).
        2. IF 'Low': Praise the user briefly. IF 'Medium': Suggest one practical optimization. IF 'High': Recommend a highly specific, actionable alternative.
        3. NO headings, NO bold text, NO asterisks, NO bullet points.
        4. Output EXACTLY 2 impactful sentences in a single paragraph. Nothing else.
        """

    payload = {
        "model": "gemma3:1b",
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.1,  # Hallucination අවම කරයි
            "top_p": 0.5
        }
    }

    try:
        response = requests.post("http://localhost:11434/api/generate", json=payload, timeout=60)
        response.raise_for_status()
        response_data = response.json()
        message = response_data.get("response", "")

        if (
            isinstance(message, str)
            and message.strip()
            and message.strip() != "Pending LLM generation"
        ):
            # අමතරව AI එකෙන් එවන Asterisks (*) හෝ Newlines (\n) මකා දැමීම
            clean_message = message.replace("*", "").replace("\n", " ").strip()
            return clean_message

        return generate_fallback_recommendation(
            emission,
            activity_type,
            day,
            level,
        )
    except Exception:
        return generate_fallback_recommendation(
            emission,
            activity_type,
            day,
            level,
        )

@app.on_event("startup")
def startup_event() -> None:
    """Load the model artifacts once when the API starts."""
    app.state.model, app.state.preprocessor, app.state.encoder, app.state.scaler = load_artifacts()


@app.get("/")
def root():
    return {"message": "Carbon Footprint Prediction API is running."}


@app.post("/api/predict/trip", response_model=TripPredictionResponse)
def predict_trip(request_data: List[TouristData]):
    try:
        model = app.state.model
        preprocessor = app.state.preprocessor
        encoder = app.state.encoder
        scaler = app.state.scaler
        activity_predictions = []

        for activity in request_data:
            feature_frame = build_feature_frame(activity)
            processed_input = preprocess_input(
                feature_frame,
                preprocessor,
                encoder,
                scaler,
            )
            predicted_emission = max(0.0, float(model.predict(processed_input)[0]))
            activity_type_lower = activity.Activity_Type.lower()

            if activity_type_lower in [
                "hiking",
                "walking",
                "cycling",
                "bicycle ride",
                "scuba diving",
                "snorkeling",
            ] or "hotel" in activity_type_lower:
                predicted_emission = activity.emission

            activity_predictions.append(
                {
                    "day": activity.day,
                    "activity_type": activity.Activity_Type,
                    "location": activity.Location,
                    "duration_minutes": activity.Duration_Minutes,
                    "predicted_emission_kg": predicted_emission,
                    "level": get_level(predicted_emission),
                }
            )

        total_trip_emission = sum(
            activity["predicted_emission_kg"] for activity in activity_predictions
        )
        overall_trip_level = get_trip_level(total_trip_emission)
        top_3_activities = sorted(
            activity_predictions,
            key=lambda activity: activity["predicted_emission_kg"],
            reverse=True,
        )[:3]
        overall_llm_message = get_llm_recommendation(
            emission=total_trip_emission,
            activity_type="the entire trip",
            day=0,
            level=overall_trip_level,
            context_activities=top_3_activities,
        )

        return TripPredictionResponse(
            total_trip_emission_kg=total_trip_emission,
            overall_trip_level=overall_trip_level,
            overall_llm_message=overall_llm_message,
            top_3_high_impact_activities=top_3_activities,
        )
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@app.post("/api/predict", response_model=PredictionResponse)
def predict(request_data: TouristData):
    try:
        model = app.state.model
        preprocessor = app.state.preprocessor
        encoder = app.state.encoder
        scaler = app.state.scaler

        feature_frame = build_feature_frame(request_data)
        processed_input = preprocess_input(
            feature_frame,
            preprocessor,
            encoder,
            scaler,
        )
        carbon_emission_kg = max(0.0, float(model.predict(processed_input)[0]))
        activity_type_lower = request_data.Activity_Type.lower()

        if activity_type_lower in [
            "hiking",
            "walking",
            "cycling",
            "bicycle ride",
            "scuba diving",
            "snorkeling",
        ] or "hotel" in activity_type_lower:
            carbon_emission_kg = request_data.emission

        level = get_level(carbon_emission_kg)
        llm_message = get_llm_recommendation(
            emission=request_data.emission,
            activity_type=request_data.Activity_Type,
            day=request_data.day,
            level=level,
        )

        return PredictionResponse(
            carbon_emission_kg=carbon_emission_kg,
            level=level,
            llm_message=llm_message,
        )
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)