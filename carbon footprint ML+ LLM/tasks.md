# AI Task Pipeline: Carbon Footprints Calculator (Backend: ML + LLM)

මෙම ලේඛනයේ ඇති පියවර අනුපිළිවෙලින් VS Code Copilot Chat වෙත ලබා දෙන්න. එක් පියවරක් සාර්ථකව Run කර තහවුරු කරගත් පසු පමණක් මීළඟ පියවරට යන්න.

## Phase 1: Data Exploration and Setup
මෙම පියවරෙන් දත්ත නිවැරදිව Load කරගැනීම සහ එහි අඩුපාඩු බැලීම සිදු කරයි.

* **Copilot Prompt:**
> I have a dataset named 'srilanka_tourism_carbon_data.csv' for predicting 'Carbon_Footprint_kg_CO2' based on tourist activities. Write a Python script using pandas to load this data, display basic info, and handle any missing values. Please provide the full complete code.

## Phase 2: Data Preprocessing & Feature Engineering
Machine Learning Model එකකට දත්ත ලබා දීමට පෙර, අකුරු (Categories) ඉලක්කම් බවට පත් කිරීම සහ දත්ත පරිමාණය (Scaling) කිරීම මෙහිදී සිදු වේ.

* **Copilot Prompt:**
> Now, write the code to preprocess this dataframe. Encode the categorical columns (like 'Activity_Type', 'Region') using OneHotEncoder or LabelEncoder. Scale the numerical columns (like 'Duration_Minutes', 'Distance_km') using StandardScaler. Finally, define the features (X) and target (y), and split the data into training and testing sets (80/20 split). Provide the full complete code.

## Phase 3: Train Multiple Models & Select the Best
විවිධ Models කිහිපයක් Train කර, ඉන් වඩාත්ම නිවැරදි (Highest Accuracy) Model එක තෝරාගැනීම.

* **Copilot Prompt:**
> Next, I want to train and compare three machine learning regression models: Random Forest, XGBoost, and Linear Regression to predict the carbon footprint. Write the complete code to train these models, evaluate them using RMSE and R-squared scores on the test set, and automatically select the model with the highest R-squared score. Provide the full code.

## Phase 4: Save the Best Model and Scalers
තෝරාගත් හොඳම Model එක සහ Preprocessing objects ටික අනාගත ප්‍රයෝජනය සඳහා (API එකට සම්බන්ධ කිරීමට) Save කරගැනීම.

* **Copilot Prompt:**
> Write the code to save the best-performing model, along with the fitted scalers and encoders, to disk using 'joblib'. Make sure the code saves them into a folder named 'models/'. Provide the full code.

## Phase 5: Build the FastAPI Backend
React Web App එකට කතා කිරීමට හැකිවන පරිදි FastAPI භාවිතයෙන් Endpoint එකක් සෑදීම සහ සුරක්ෂිත කළ ML Model එක ඊට සම්බන්ධ කිරීම.

* **Copilot Prompt:**

> Now I want to build the API using FastAPI. Create a new file named 'main.py'. Write the complete code to set up FastAPI with CORS middleware to allow connections from a React frontend. Define a Pydantic BaseModel for the incoming data (Activity_Type, Duration_Minutes, Distance_km, Region). In the   `/api/predict`  POST endpoint, load the saved ML model and preprocessors (scalers/encoders) from the 'models/' folder. Preprocess the incoming data and predict the carbon footprint. Then, add logic to classify this predicted numeric value into a recommendation level: 'Low', 'Medium', or 'High' (e.g., < 10 is Low, 10-50 is Medium, >50 is High). Return the numeric predicted value and this recommendation level as a JSON response. Provide the complete code for main.py.

## Phase 6: Integrate Local LLM (Ollama)
අවසාන පියවර: ML ප්‍රතිඵලය සාමාන්‍ය මිනිසෙකුට කියවා තේරුම් ගත හැකි ආකාරයට LLM හරහා වාක්‍යයක් බවට පත් කිරීම.

* **Copilot Prompt:**
> "Now update the current 'main.py' to integrate the local LLM using the 'ollama' library. In the '/api/predict' endpoint, after you get the 'ml_prediction' and the 'recommendation_level', use ollama.generate(model='gemma3:1b', prompt=...) to create a friendly explanation. The prompt should ask the LLM: 'The system predicted a carbon footprint of [ml_prediction] kg CO2, which is [recommendation_level]. Suggest a simple, sustainable tourism alternative or tip in 2 sentences in a friendly tone'. Finally, return both the raw prediction, the recommendation level, and the LLM's explanation as a JSON response. Provide the complete updated main.py code."