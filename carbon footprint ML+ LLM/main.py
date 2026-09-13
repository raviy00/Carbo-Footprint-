from pathlib import Path
from typing import Literal

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
) -> str:
    """Call local Ollama, or fallback to smart recommendation generator if Ollama is offline."""
    prompt = f"""
    You are a world-class Sustainability Expert and Carbon Footprint Analyst. 
    Your strict task is to provide a highly accurate, data-driven recommendation based on the user's specific travel calculation.

    Context Data:
    - Activity: {activity_type} on Day {day}
    - Calculated Carbon Emission: {emission} kg CO2
    - Severity Level: {level}

    Strict Rules for your response:
    1. Data Accuracy: You MUST explicitly mention the exact emission value ({emission} kg CO2) and the activity ({activity_type}) in your response.
    2. Dynamic Tone & Advice:
       - IF Severity Level is 'Low': Praise the user. Briefly explain why this choice is eco-friendly.
       - IF Severity Level is 'Medium': Acknowledge their effort, but suggest one practical optimization to lower it further.
       - IF Severity Level is 'High': Adopt a professional, urgent tone. Recommend a highly specific, actionable alternative to severely reduce this footprint.
    3. Constraint: Output exactly 2 impactful sentences. No generic greetings, no fluff.

    Expert Recommendation:
    """

    payload = {
        "model": "gemma3:1b",
        "prompt": prompt,
        "stream": False,
    }

    try:
        response = requests.post(OLLAMA_URL, json=payload, timeout=3)
        response.raise_for_status()
        response_data = response.json()
        message = response_data.get("response", "")
        if isinstance(message, str) and message.strip() and message.strip() != "Pending LLM generation":
            return message.strip()
        return generate_fallback_recommendation(emission, activity_type, day, level)
    except Exception:
        return generate_fallback_recommendation(emission, activity_type, day, level)

@app.on_event("startup")
def startup_event() -> None:
    """Load the model artifacts once when the API starts."""
    app.state.model, app.state.preprocessor, app.state.encoder, app.state.scaler = load_artifacts()


@app.get("/")
def root():
    return {"message": "Carbon Footprint Prediction API is running."}


@app.post("/api/predict", response_model=PredictionResponse)
def predict(request_data: TouristData):
    try:
        model = app.state.model
        preprocessor = app.state.preprocessor
        encoder = app.state.encoder
        scaler = app.state.scaler

        feature_frame = build_feature_frame(request_data)
        processed_input = preprocess_input(feature_frame, preprocessor, encoder, scaler)
        carbon_emission_kg = float(model.predict(processed_input)[0])
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