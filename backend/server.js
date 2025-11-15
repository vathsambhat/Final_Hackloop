require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fetch = require('node-fetch');
const multer = require('multer');

const app = express();

// ===========================
//       MIDDLEWARE
// ===========================
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../frontend')));

// ===========================
//       ENV VARIABLES
// ===========================
const PORT = process.env.PORT || 4000;
const WEATHER_KEY = process.env.WEATHER_API_KEY || '';
const DISEASE_KEY = process.env.DISEASE_API_KEY || '';

console.log("Loaded WEATHER KEY:", WEATHER_KEY);
console.log("Loaded DISEASE KEY:", DISEASE_KEY);

// ===========================
//        HEALTH CHECK
// ===========================
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ===========================
//        SOIL ANALYSIS
// ===========================
function analyzeSoil(payload) {
  const ideal = {
    nitrogen: [80, 120],
    phosphorus: [20, 40],
    potassium: [100, 150],
    sulfur: [10, 20],
    organic_matter: [1.5, 3.0],
    ph: [6.0, 7.5]
  };

  const tips = {
    nitrogen: {
      low: 'Add compost or urea fertilizer.',
      high: 'Avoid nitrogen fertilizers for 2–3 weeks.',
      optimal: 'Nitrogen level is perfect.'
    },
    phosphorus: {
      low: 'Add phosphate fertilizer.',
      high: 'Avoid phosphorus fertilizers.',
      optimal: 'Phosphorus level is perfect.'
    },
    potassium: {
      low: 'Add potash or banana compost.',
      high: 'Avoid potash fertilizers.',
      optimal: 'Potassium level is perfect.'
    },
    sulfur: {
      low: 'Add gypsum or sulfur fertilizer.',
      high: 'Reduce sulfur-based fertilizers.',
      optimal: 'Sulfur level is perfect.'
    },
    organic_matter: {
      low: 'Add cow dung, compost, or vermicompost.',
      high: 'Organic matter is excellent.',
      optimal: 'Organic matter level is good.'
    },
    ph: {
      low: 'Add lime to reduce acidity.',
      high: 'Add sulfur to reduce alkalinity.',
      optimal: 'pH is optimal.'
    }
  };

  const result = { crop: payload.crop, soil_type: payload.soil_type, analysis: {} };

  for (let key in ideal) {
    const [low, high] = ideal[key];
    const value = Number(payload[key]);

    if (value < low)
      result.analysis[key] = { status: "LOW", value, suggestion: tips[key].low };
    else if (value > high)
      result.analysis[key] = { status: "HIGH", value, suggestion: tips[key].high };
    else
      result.analysis[key] = { status: "OPTIMAL", value, suggestion: tips[key].optimal };
  }

  return result;
}

app.post('/api/soil', (req, res) => {
  try {
    res.json(analyzeSoil(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================
//        WEATHER API
// ===========================
app.get('/api/weather', async (req, res) => {
  try {
    if (!WEATHER_KEY) {
      return res.status(500).json({ error: "Weather API key not configured" });
    }

    const { q, lat, lon } = req.query;

    let url = "";

    if (q)
      url = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(q)}&units=metric&appid=${WEATHER_KEY}`;
    else if (lat && lon)
      url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${WEATHER_KEY}`;
    else
      return res.status(400).json({ error: "City or coordinates required" });

    const response = await fetch(url);
    const data = await response.json();

    res.json(data);

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===========================
//   DISEASE DETECTION (Plant.id v3)
// ===========================
const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/disease', upload.single("image"), async (req, res) => {
  try {
    if (!DISEASE_KEY)
      return res.status(500).json({ error: "Disease API key missing" });

    if (!req.file)
      return res.status(400).json({ error: "No image uploaded" });

    const base64 = req.file.buffer.toString("base64");

    // ---------------------------------------
    // STEP 1 — VERIFY IT IS A PLANT
    // ----------------------------------------
    const verifyResponse = await fetch("https://plant.id/api/v3/identification", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Api-Key": DISEASE_KEY
      },
      body: JSON.stringify({
        images: [base64],
        classification_level: "all",
        similar_images: true
      })
    });
    // Read response text so we can show raw details when things go wrong
    const verifyText = await verifyResponse.text();

    if (!verifyResponse.ok) {
      console.error('Plant.id verify returned non-OK status', verifyResponse.status, verifyText);
      return res.status(502).json({
        success: false,
        error: 'Plant.id verify API returned an error',
        status: verifyResponse.status,
        details: verifyText
      });
    }

    let verify;
    try {
      verify = JSON.parse(verifyText);
    } catch (err) {
      console.error('Failed to parse Plant.id verify JSON:', err, verifyText);
      return res.status(502).json({
        success: false,
        error: 'Invalid verify JSON',
        details: verifyText
      });
    }

    // Plant.id responses can vary in shape; try several common fields
    let isPlantProb = null;
    if (verify && typeof verify === 'object') {
      if (verify.result && typeof verify.result.is_plant_probability !== 'undefined')
        isPlantProb = verify.result.is_plant_probability;
      else if (verify.result && verify.result.is_plant && typeof verify.result.is_plant.probability !== 'undefined')
        isPlantProb = verify.result.is_plant.probability;
      else if (typeof verify.is_plant_probability !== 'undefined')
        isPlantProb = verify.is_plant_probability;
      else if (Array.isArray(verify.results) && verify.results[0] && typeof verify.results[0].is_plant_probability !== 'undefined')
        isPlantProb = verify.results[0].is_plant_probability;
      else if (Array.isArray(verify.result) && verify.result[0] && typeof verify.result[0].is_plant_probability !== 'undefined')
        isPlantProb = verify.result[0].is_plant_probability;
    }

    if (isPlantProb === null) {
      console.error('Unable to determine plant probability from verify response', JSON.stringify(verify));
      return res.status(502).json({
        success: false,
        error: 'Could not determine plant probability from verification response',
        details: verify
      });
    }

    if (isPlantProb < 0.60) {
      return res.json({
        success: false,
        message: '❌ This image is NOT a plant. Please upload a plant leaf.',
        plant_probability: isPlantProb,
        verify
      });
    }

    // ---------------------------------------
    // STEP 2 — DISEASE DETECTION
    // ----------------------------------------
    const diseaseResponse = await fetch("https://plant.id/api/v3/health_assessment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Api-Key": DISEASE_KEY
      },
      body: JSON.stringify({
        images: [base64],
        classification_level: "species",
        similar_images: true,
        health: "only"
      })
    });
    const diseaseText = await diseaseResponse.text();

    if (!diseaseResponse.ok) {
      console.error('Plant.id health_assessment returned non-OK status', diseaseResponse.status, diseaseText);
      return res.status(502).json({
        success: false,
        error: 'Plant.id health_assessment API returned an error',
        status: diseaseResponse.status,
        details: diseaseText
      });
    }

    let diseaseJSON;
    try {
      diseaseJSON = JSON.parse(diseaseText);
    } catch (err) {
      console.error('Failed to parse disease JSON:', err, diseaseText);
      return res.status(502).json({
        success: false,
        error: 'Invalid disease JSON',
        details: diseaseText
      });
    }

    res.json(diseaseJSON);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===========================
//      FRONTEND FALLBACK
// ===========================
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// ===========================
//        START SERVER
// ===========================
app.listen(PORT, () => {
  console.log("Farmer Assistant running on http://localhost:" + PORT);
});
