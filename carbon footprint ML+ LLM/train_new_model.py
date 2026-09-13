from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import r2_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import OneHotEncoder, StandardScaler

try:
	from xgboost import XGBRegressor
except ImportError as import_error:
	raise ImportError(
		"xgboost is required for this script. Install it with `pip install xgboost`."
	) from import_error


BASE_DIR = Path(__file__).resolve().parent
DATA_PATH = BASE_DIR / "updated_tourism_data.csv"
MODELS_DIR = BASE_DIR / "models"

CATEGORICAL_COLUMNS = ["Travel_Mode", "Location", "Activity_Type"]
NUMERICAL_COLUMNS = ["Age", "Group_Size", "Duration_Minutes", "Hotel_Star"]
TARGET_COLUMN = "Carbon_Footprint_kg_CO2"


def build_one_hot_encoder() -> OneHotEncoder:
	"""Create a dense one-hot encoder compatible with multiple scikit-learn versions."""
	try:
		return OneHotEncoder(handle_unknown="ignore", sparse_output=False)
	except TypeError:
		return OneHotEncoder(handle_unknown="ignore", sparse=False)


def load_data(data_path: Path) -> pd.DataFrame:
	"""Load the tourism dataset from disk."""
	if not data_path.exists():
		raise FileNotFoundError(f"Dataset not found: {data_path}")

	data_frame = pd.read_csv(data_path)

	required_columns = CATEGORICAL_COLUMNS + NUMERICAL_COLUMNS + [TARGET_COLUMN]
	missing_columns = [column for column in required_columns if column not in data_frame.columns]
	if missing_columns:
		raise ValueError(f"Missing required columns in dataset: {missing_columns}")

	return data_frame


def prepare_features_and_target(data_frame: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
	"""Split the loaded dataset into features and target."""
	features = data_frame[CATEGORICAL_COLUMNS + NUMERICAL_COLUMNS].copy()
	target = data_frame[TARGET_COLUMN].copy()
	return features, target


def build_preprocessor() -> ColumnTransformer:
	"""Build the preprocessing transformer used for both training and inference."""
	categorical_encoder = build_one_hot_encoder()
	numerical_scaler = StandardScaler()

	return ColumnTransformer(
		transformers=[
			("categorical", categorical_encoder, CATEGORICAL_COLUMNS),
			("numerical", numerical_scaler, NUMERICAL_COLUMNS),
		],
		remainder="drop",
	)


def transform_features(preprocessor: ColumnTransformer, features: pd.DataFrame) -> np.ndarray:
	"""Transform raw feature columns into a model-ready numeric matrix."""
	transformed_features = preprocessor.transform(features)
	if hasattr(transformed_features, "toarray"):
		transformed_features = transformed_features.toarray()
	return np.asarray(transformed_features)


def evaluate_models(
	x_train: np.ndarray,
	x_test: np.ndarray,
	y_train: pd.Series,
	y_test: pd.Series,
) -> dict[str, dict[str, object]]:
	"""Train the required regressors and return their fitted models with test R-squared scores."""
	models = {
		"Random Forest": RandomForestRegressor(
			n_estimators=300,
			random_state=42,
			n_jobs=-1,
		),
		"XGBoost": XGBRegressor(
			n_estimators=300,
			learning_rate=0.1,
			max_depth=5,
			subsample=0.9,
			colsample_bytree=0.9,
			objective="reg:squarederror",
			random_state=42,
		),
		"Linear Regression": LinearRegression(),
	}

	results: dict[str, dict[str, object]] = {}

	for model_name, model in models.items():
		model.fit(x_train, y_train)
		predictions = model.predict(x_test)
		r2 = r2_score(y_test, predictions)
		results[model_name] = {
			"model": model,
			"r2_score": r2,
		}
		print(f"{model_name} R-squared: {r2:.4f}")

	return results


def save_artifacts(
	best_model: object,
	preprocessor: ColumnTransformer,
	models_dir: Path,
) -> None:
	"""Persist the selected model, the fitted preprocessor, and the individual fitted transformers."""
	models_dir.mkdir(parents=True, exist_ok=True)

	joblib.dump(best_model, models_dir / "best_model.joblib")
	joblib.dump(best_model, models_dir / "xgboost_model.joblib")
	joblib.dump(preprocessor, models_dir / "preprocessor.joblib")
	joblib.dump(preprocessor.named_transformers_["categorical"], models_dir / "encoder.joblib")
	joblib.dump(preprocessor.named_transformers_["numerical"], models_dir / "scaler.joblib")


def main() -> None:
	data_frame = load_data(DATA_PATH)
	features, target = prepare_features_and_target(data_frame)

	x_train, x_test, y_train, y_test = train_test_split(
		features,
		target,
		test_size=0.2,
		random_state=42,
	)

	preprocessor = build_preprocessor()
	preprocessor.fit(x_train)

	x_train_processed = transform_features(preprocessor, x_train)
	x_test_processed = transform_features(preprocessor, x_test)

	model_results = evaluate_models(x_train_processed, x_test_processed, y_train, y_test)

	best_model_name, best_model_result = max(
		model_results.items(),
		key=lambda item: item[1]["r2_score"],
	)
	best_model = best_model_result["model"]
	best_r2 = float(best_model_result["r2_score"])

	save_artifacts(best_model, preprocessor, MODELS_DIR)

	print("\nBest model selected:")
	print(f"{best_model_name} with R-squared = {best_r2:.4f}")
	print(f"Artifacts saved to: {MODELS_DIR}")


if __name__ == "__main__":
	main()
