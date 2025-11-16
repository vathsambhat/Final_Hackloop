# Farmer Assistant - Integration Guide

## 🌾 Architecture

```
Frontend (HTML/CSS/JS) 
    ↓
Express Backend (Node.js)
    ↓
Python Soil Analysis (AI + Fallback)
```

## 📋 Integration Steps

### 1. **Install Dependencies**

```bash
# Node.js dependencies
npm install

# Python dependencies  
pip install -r requirements.txt
```

### 2. **Setup Environment Variables**

Create a `.env` file in the root directory:

```env
PORT=4000
WEATHER_API_KEY=your_openweather_key
DISEASE_API_KEY=your_plant_id_key
GEMINI_API_KEY=AIzaSyChbY2RrmQo7ld1QRUplqxiT82u-jOBuoY
```

**Get API Keys:**
- 🌤️ **OpenWeather**: https://openweathermap.org/api
- 🪴 **Plant.ID**: https://plant.id/api
- 🤖 **Gemini**: https://ai.google.dev/

### 3. **Verify Python Installation**

```bash
python --version
```

Make sure Python 3.7+ is installed and accessible.

### 4. **Start the Server**

```bash
npm start
```

This will:
- Start Express on `http://localhost:4000`
- Serve frontend files
- Ready to accept soil analysis requests

## 🔄 How It Works

### Soil Analysis Flow:

1. **User enters soil data** in dashboard (`dashboard.html`)
2. **Frontend sends JSON** to `/api/soil` endpoint
3. **Express receives request** and spawns `soil.py` process
4. **Python script**:
   - Tries to call Gemini AI for smart analysis
   - Falls back to rule engine if API fails or key missing
   - Returns JSON with recommendations (English + Hindi)
5. **Express sends response** back to frontend
6. **Dashboard displays** results with priority and next check time

### Sample Request:
```json
{
  "crop_type": "tomato",
  "location": "India",
  "moisture": 45,
  "nitrogen": 150,
  "phosphorus": 25,
  "potassium": 100,
  "ph": 7.0,
  "temperature": 28,
  "electrical_conductivity": 0.8,
  "organic_carbon": 2.5
}
```

### Sample Response:
```json
{
  "action": "ALL_GOOD",
  "priority": "LOW",
  "confidence": 0.85,
  "reasoning": "All soil parameters within optimal ranges",
  "recommendations": [
    "Soil healthy, maintain regular care",
    "Water as needed based on crop requirements"
  ],
  "recommendations_hindi": [
    "मिट्टी अच्छी है, नियमित देखभाल करें",
    "आवश्यकतानुसार पानी दें"
  ],
  "next_check_hours": 12,
  "timestamp": "2025-11-16T10:30:00"
}
```

## 🛠️ Troubleshooting

### Python not found
- Ensure Python is in PATH: `python --version`
- On Windows, reinstall Python and check "Add Python to PATH"

### Gemini API errors
- Verify API key in `.env` file
- Check internet connection
- If key invalid, fallback rule engine will kick in

### Frontend not loading
- Check Express is running on port 4000
- Verify frontend files are in `./frontend/` directory
- Check browser console for errors

### CORS errors
- Already handled by Express config
- If issues persist, check headers in `server.js`

## 📱 Features Integrated

✅ **Soil Analysis** - AI + Rule Engine fallback  
✅ **Weather Forecast** - 5-day forecast  
✅ **Disease Detection** - Plant leaf analysis  
✅ **Multi-language** - English + Hindi recommendations  
✅ **Offline Mode** - Works without AI if API fails  

## 🚀 Deployment

### Local Testing:
```bash
npm start
# Visit http://localhost:4000
```

### Production:
```bash
# Build process (if using)
npm run build

# Set production env
export NODE_ENV=production

# Run server
npm start
```

## 📝 File Structure

```
.
├── backend/
│   └── server.js          # Express server with API endpoints
├── frontend/
│   ├── index.html         # Login page
│   ├── dashboard.html     # Main application
│   └── styles.css         # Styling
├── soil.py                # Python soil analysis engine
├── requirements.txt       # Python dependencies
├── package.json           # Node dependencies
├── .env                   # Environment variables (create this)
└── login.html             # Alternative login page
```

## 🔐 Security Notes

- Never commit `.env` with real API keys
- Use environment variables for all secrets
- Validate user input in production
- Rate limit API endpoints

---

**Questions?** Check the code comments or run tests:
```bash
# Test soil analysis directly
python soil.py
```
