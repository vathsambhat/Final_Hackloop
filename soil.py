"""
Soil Agentic AI System (Keyless Silent Mode)
--------------------------------------------
✔ Manual soil input
✔ Agentic AI built-in
✔ If API key exists in code → uses AI
✔ If key missing → automatic rule fallback
✔ No key prompt
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Optional, List, Dict
import json

# `requests` is optional; if missing the script falls back to the rule engine
try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    requests = None
    REQUESTS_AVAILABLE = False

# -------------------------------------------------
# CONFIGURE API KEYS HERE (optional)
# Leave empty = offline fallback
# -------------------------------------------------
OPENAI_KEY = ""          # "sk-xxxxx"
ANTHROPIC_KEY = ""       # "anthropic-key"
GEMINI_KEY = "AIzaSyChbY2RrmQo7ld1QRUplqxiT82u-jOBuoY"          # ""
USE_LOCAL_LLM = False    # True if running Ollama locally
# -------------------------------------------------

@dataclass
class SoilReading:
    moisture: float
    nitrogen: float
    phosphorus: float
    potassium: float
    ph: float
    temperature: float
    electrical_conductivity: float
    organic_carbon: float
    location: str
    crop_type: str
    timestamp: Optional[str] = None
    
    def __post_init__(self):
        self.timestamp = datetime.now().isoformat()

@dataclass
class AIDecision:
    action: str
    priority: str
    confidence: float
    reasoning: str
    recommendations: List[str]
    recommendations_hindi: List[str]
    next_check_hours: int
    timestamp: Optional[str] = None
    
    def __post_init__(self):
        self.timestamp = datetime.now().isoformat()


# -------------------------------------------------
# AGENTIC AI LOGIC
# -------------------------------------------------

def call_openai(prompt):
    if not OPENAI_KEY: return None
    if not REQUESTS_AVAILABLE: return None
    try:
        r = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENAI_KEY}"},
            json={"model":"gpt-4.1-mini","messages":[{"role":"user","content":prompt}]}
        )
        return r.json()["choices"][0]["message"]["content"]
    except:
        return None

def call_claude(prompt):
    if not ANTHROPIC_KEY: return None
    if not REQUESTS_AVAILABLE: return None
    try:
        r = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key":ANTHROPIC_KEY,"Content-Type":"application/json"},
            json={"model":"claude-3.5-sonnet","messages":[{"role":"user","content":prompt}]}
        )
        return r.json()["content"][0]["text"]
    except:
        return None

def call_gemini(prompt):
    if not GEMINI_KEY: return None
    if not REQUESTS_AVAILABLE: return None
    try:
        url=f"https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key={GEMINI_KEY}"
        r=requests.post(url,json={"contents":[{"parts":[{"text":prompt}]}]})
        return r.json()["candidates"][0]["content"]["parts"][0]["text"]
    except:
        return None

def call_local(prompt):
    if not USE_LOCAL_LLM: return None
    if not REQUESTS_AVAILABLE: return None
    try:
        r = requests.post("http://localhost:11434/api/generate",
                          json={"model":"llama3","prompt":prompt})
        return r.json()["response"]
    except:
        return None


# -------------------------------------------------
# RULE ENGINE (fallback)
# -------------------------------------------------

def rule_engine(s):
    rec = []
    rec_hi = []
    reasoning_parts = []

    if s.moisture < 30:
        rec.append("Irrigate immediately")
        rec_hi.append("तुरंत सिंचाई करें")
        reasoning_parts.append(f"Moisture critically low at {s.moisture}%")
    elif s.moisture < 40:
        rec.append("Irrigate soon")
        rec_hi.append("जल्द सिंचाई करें")
        reasoning_parts.append(f"Moisture is {s.moisture}%, below optimal")

    if s.nitrogen < 250:
        rec.append("Apply 50kg urea per acre")
        rec_hi.append("यूरिया 50 किलो/एकड़ डालें")
        reasoning_parts.append(f"Nitrogen deficiency detected at {s.nitrogen} mg/kg")

    if s.ph < 6.0 or s.ph > 8.0:
        reasoning_parts.append(f"Soil pH {s.ph} is outside ideal range (6.0-8.0)")
    
    if not rec:
        rec=["Soil healthy, maintain regular care"]
        rec_hi=["मिट्टी अच्छी है, नियमित देखभाल करें"]
        reasoning_parts.append("All soil parameters within optimal ranges")
    
    reasoning = "; ".join(reasoning_parts) if reasoning_parts else "Soil analysis complete"

    return AIDecision(
        action="ATTENTION_NEEDED" if len(rec)>1 else "ALL_GOOD",
        priority="HIGH" if len(rec)>1 else "LOW",
        confidence=0.80,
        reasoning=reasoning,
        recommendations=rec,
        recommendations_hindi=rec_hi,
        next_check_hours=6 if len(rec)>1 else 12
    )


# -------------------------------------------------
# MAIN DECISION PIPELINE
# -------------------------------------------------

def analyze_soil(soil: SoilReading):
    prompt = f"""
You are an agricultural soil expert AI. Analyze and return JSON only:

Soil:
Moisture={soil.moisture}
Nitrogen={soil.nitrogen}
Phosphorus={soil.phosphorus}
Potassium={soil.potassium}
pH={soil.ph}
EC={soil.electrical_conductivity}
Organic Carbon={soil.organic_carbon}
Crop={soil.crop_type}
Location={soil.location}

Response format:
{{
 "action": "",
 "priority": "",
 "confidence": 0.0,
 "reasoning": "",
 "recommendations": [],
 "recommendations_hindi": [],
 "next_check_hours": 0
}}
"""

    # Use Gemini API only
    ai = call_gemini(prompt)

    if ai:
        try:
            ai = ai.replace("```json","").replace("```","")
            data = json.loads(ai)
            return AIDecision(**data)
        except:
            pass  # AI failed to parse → fallback

    return rule_engine(soil)


# -------------------------------------------------
# USER INPUT (NO KEY ASKING)
# -------------------------------------------------

if __name__ == "__main__":
    print("\n🌾 Soil AI Assistant (No Key Needed) 🌾\n")

    if not REQUESTS_AVAILABLE:
        print("Notice: Python package 'requests' is not installed. LLM API calls will be disabled and the tool will use the local rule-based fallback.")
        print("To enable LLM providers install requests:  python -m pip install requests\n")

    def num(q): return float(input(q))

    soil = SoilReading(
        moisture=num("Moisture %: "),
        nitrogen=num("Nitrogen mg/kg: "),
        phosphorus=num("Phosphorus mg/kg: "),
        potassium=num("Potassium mg/kg: "),
        ph=num("Soil pH: "),
        temperature=num("Temperature °C: "),
        electrical_conductivity=num("EC (dS/m): "),
        organic_carbon=num("Organic Carbon %: "),
        location=input("Location: "),
        crop_type=input("Crop: ")
    )

    result = analyze_soil(soil)

    print("\n✅ RESULT ✅\n")
    print("Action:", result.action)
    print("Priority:", result.priority)
    print("Reasoning:", result.reasoning)
    print("\nRecommendations:")
    for r in result.recommendations: print(" -",r)
    print("\nHindi Tips:")
    for r in result.recommendations_hindi: print(" -",r)
    print(f"\nNext Check in: {result.next_check_hours} hours\n")
