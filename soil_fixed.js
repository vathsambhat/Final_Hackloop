const fetch = require('node-fetch');

function ruleEngine(s) {
  const rec = [];
  const rec_hi = [];
  const reasoning_parts = [];

  if (s.moisture < 30) {
    rec.push('Irrigate immediately');
    rec_hi.push('तुरंत सिंचाई करें');
    reasoning_parts.push(`Moisture critically low at ${s.moisture}%`);
  } else if (s.moisture < 40) {
    rec.push('Irrigate soon');
    rec_hi.push('जल्द सिंचाई करें');
    reasoning_parts.push(`Moisture is ${s.moisture}%, below optimal`);
  }

  if (s.nitrogen < 250) {
    rec.push('Apply 50kg urea per acre');
    rec_hi.push('यूरिया 50 किलो/एकड़ डालें');
    reasoning_parts.push(`Nitrogen deficiency detected at ${s.nitrogen} mg/kg`);
  }

  if (s.ph < 6.0 || s.ph > 8.0) {
    reasoning_parts.push(`Soil pH ${s.ph} is outside ideal range (6.0-8.0)`);
  }

  if (!rec.length) {
    rec.push('Soil healthy, maintain regular care');
    rec_hi.push('मिट्टी अच्छी है, नियमित देखभाल करें');
    reasoning_parts.push('All soil parameters within optimal ranges');
  }

  const reasoning = reasoning_parts.length ? reasoning_parts.join('; ') : 'Soil analysis complete';

  return {
    action: rec.length > 1 ? 'ATTENTION_NEEDED' : 'ALL_GOOD',
    priority: rec.length > 1 ? 'HIGH' : 'LOW',
    confidence: 0.80,
    reasoning,
    recommendations: rec,
    recommendations_hindi: rec_hi,
    next_check_hours: rec.length > 1 ? 6 : 12,
    timestamp: new Date().toISOString()
  };
}

async function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY || process.env.GEMINI_KEY || '';
  if (!key) return null;
  try {
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=${key}`;
    const body = { contents: [{ parts: [{ text: prompt }] }] };
    const r = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
    const j = await r.json();
    return j?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (e) {
    console.error('Gemini call failed', e?.message || e);
    return null;
  }
}

async function analyzeSoil(soil) {
  // Basic check: ensure the crop is commonly grown in the provided location.
  // This prevents giving actionable recommendations for crops that are unlikely
  // to be cultivated in the specified region.
  function normalize(s) { return String(s || '').toLowerCase().trim(); }
  const cropName = normalize(soil.crop_type || soil.crop || '');
  const locName = normalize(soil.location || '');

  // Small, conservative mapping of regions -> commonly grown crops. Keep this
  // list small and local to avoid false negatives; expand as needed.
  const regionCropMap = {
    india: ['rice','wheat','maize','millet','sugarcane','cotton','tea','lentil','chickpea','mustard','tomato','potato'],
    usa: ['corn','wheat','soybean','cotton','rice','potato','tomato','apple','grape'],
    brazil: ['soybean','sugarcane','coffee','corn','cotton','rice'],
    china: ['rice','wheat','maize','tea','soybean','cotton','potato'],
    australia: ['wheat','barley','sugarcane','cotton','canola']
  };

  function findRegionForLocation(loc) {
    if (!loc) return null;
    for (const r of Object.keys(regionCropMap)) {
      if (loc.includes(r)) return r;
    }
    // try simple country tokens (very naive)
    if (loc.includes('india') || loc.includes('bharat')) return 'india';
    if (loc.includes('usa') || loc.includes('united states') || loc.includes('america') ) return 'usa';
    if (loc.includes('brazil')) return 'brazil';
    if (loc.includes('china')) return 'china';
    if (loc.includes('australia')) return 'australia';
    return null;
  }

  const region = findRegionForLocation(locName);
  if (region && cropName) {
    const known = regionCropMap[region] || [];
    // normalize known list
    const knownNorm = known.map(x=>x.toLowerCase());
    // If crop is not in the known list, treat conservatively and return a non-actionable response
    if (!knownNorm.includes(cropName)) {
      return {
        action: 'CROP_NOT_SUITABLE',
        priority: 'HIGH',
        confidence: 0.15,
        reasoning: `The crop \"${soil.crop_type || soil.crop}\" is not commonly grown in ${region}. Please verify crop and location before taking action.`,
        recommendations: [],
        recommendations_hindi: [],
        next_check_hours: 0,
        timestamp: new Date().toISOString()
      };
    }
  }
  // Build prompt similar to Python version
  const prompt = `You are an agricultural soil expert AI. Analyze and return JSON only:

Soil:
Moisture=${soil.moisture}
Nitrogen=${soil.nitrogen}
Phosphorus=${soil.phosphorus}
Potassium=${soil.potassium}
pH=${soil.ph}
EC=${soil.electrical_conductivity}
Organic Carbon=${soil.organic_carbon}
Crop=${soil.crop_type}
Location=${soil.location}

Response format:
{
 "action": "",
 "priority": "",
 "confidence": 0.0,
 "reasoning": "",
 "recommendations": [],
 "recommendations_hindi": [],
 "next_check_hours": 0
}`;

  // Try Gemini first
  const ai = await callGemini(prompt);
  if (ai) {
    try {
      const cleaned = ai.replace(/```json/g, '').replace(/```/g, '').trim();
      const data = JSON.parse(cleaned);
      // ensure timestamp
      if (!data.timestamp) data.timestamp = new Date().toISOString();
      return data;
    } catch (e) {
      console.error('Failed to parse Gemini JSON, falling back to rules', e?.message || e);
    }
  }

  return ruleEngine(soil);
}

module.exports = { analyzeSoil };