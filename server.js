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

// Choose Python executable: allow override via env (PYTHON), otherwise prefer venv in repo
const PYTHON_EXEC = process.env.PYTHON || path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe');
console.log('Using Python executable:', PYTHON_EXEC);
console.log("Loaded WEATHER KEY:", WEATHER_KEY);
console.log("Loaded DISEASE KEY:", DISEASE_KEY);

// ===========================
//        HEALTH CHECK
// ===========================
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ===========================
//        SOIL ANALYSIS (JS)
// ===========================
const { analyzeSoil } = require('./soil_fixed');

async function runSoilAnalysis(payload) {
  // Normalize/parse inputs to numbers where appropriate
  const s = {
    moisture: Number(payload.moisture ?? 50),
    nitrogen: Number(payload.nitrogen ?? 100),
    phosphorus: Number(payload.phosphorus ?? 30),
    potassium: Number(payload.potassium ?? 120),
    ph: Number(payload.ph ?? 7.0),
    temperature: Number(payload.temperature ?? 25),
    electrical_conductivity: Number(payload.electrical_conductivity ?? 1.0),
    organic_carbon: Number(payload.organic_carbon ?? 2.0),
    location: payload.location || 'India',
    crop_type: payload.crop_type || payload.crop || 'wheat'
  };

  // Call the JS analyzer (tries AI then falls back to rule engine)
  return await analyzeSoil(s);
}

app.post('/api/soil', async (req, res) => {
  try {
    const result = await runSoilAnalysis(req.body);
    res.json(result);
  } catch (err) {
    // If the error includes python stderr/stdout, return them for debugging
    if (err && (err.stderr || err.stdout || err.code)) {
      return res.status(500).json({ error: err.message || 'soil analysis failed', stderr: err.stderr, stdout: err.stdout, code: err.code });
    }
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ===========================
//   HELPER / UTILITY APIS
// ===========================

// Return simple metadata about available APIs and which keys are configured
app.get('/api/info', (req, res) => {
  res.json({
    name: 'Farmer Assistant',
    version: process.env.npm_package_version || '1.0.0',
    endpoints: [
      { method: 'GET', path: '/api/health', desc: 'Health check' },
      { method: 'GET', path: '/api/info', desc: 'API info and available endpoints' },
      { method: 'GET', path: '/api/soil/sample', desc: 'Returns a sample soil payload' },
      { method: 'POST', path: '/api/soil', desc: 'Analyze single soil reading' },
      { method: 'POST', path: '/api/soil/batch', desc: 'Analyze multiple soil readings' },
      { method: 'GET', path: '/api/weather', desc: 'Weather forecast (requires WEATHER_API_KEY)' },
      { method: 'POST', path: '/api/disease', desc: 'Disease detection (requires DISEASE_API_KEY)' }
    ],
    keys: {
      weather: !!WEATHER_KEY,
      disease: !!DISEASE_KEY,
      gemini: !!process.env.GEMINI_API_KEY || !!process.env.GEMINI_KEY
    }
  });
});

// Return a sample soil payload clients can use
app.get('/api/soil/sample', (req, res) => {
  res.json({
    moisture: 50,
    nitrogen: 100,
    phosphorus: 30,
    potassium: 120,
    ph: 7.0,
    temperature: 25,
    electrical_conductivity: 1.0,
    organic_carbon: 2.0,
    location: 'India',
    crop_type: 'wheat'
  });
});

// Analyze an array of soil readings in one request
app.post('/api/soil/batch', async (req, res) => {
  try {
    const readings = Array.isArray(req.body) ? req.body : (req.body.readings || []);
    if (!readings.length) return res.status(400).json({ error: 'No readings provided (expected array)' });

    const results = [];
    for (const r of readings) {
      // run sequentially to avoid overloading external services; it's simple and deterministic
      // normalize input as runSoilAnalysis expects
      const normalized = {
        moisture: Number(r.moisture ?? 50),
        nitrogen: Number(r.nitrogen ?? 100),
        phosphorus: Number(r.phosphorus ?? 30),
        potassium: Number(r.potassium ?? 120),
        ph: Number(r.ph ?? 7.0),
        temperature: Number(r.temperature ?? 25),
        electrical_conductivity: Number(r.electrical_conductivity ?? 1.0),
        organic_carbon: Number(r.organic_carbon ?? 2.0),
        location: r.location || 'Unknown',
        crop_type: r.crop_type || r.crop || 'wheat'
      };

      try {
        const out = await runSoilAnalysis(normalized);
        results.push({ input: normalized, result: out });
      } catch (err) {
        results.push({ input: normalized, error: err && err.message ? err.message : String(err) });
      }
    }

    res.json({ count: results.length, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
//        START SERVER (only when run directly)
// ===========================
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log("Farmer Assistant running on http://localhost:" + PORT);
    console.log("Or visit http://127.0.0.1:" + PORT);
  });
}

// export app for tests
module.exports = app;