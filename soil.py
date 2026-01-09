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
import copy

# Known/valid crop names (lowercase). Add more as needed.
VALID_CROPS = {
    "rice", "wheat", "maize", "corn", "sugarcane", "cotton", "soybean",
    "potato", "tomato", "banana", "millet", "barley", "groundnut",
    "pea", "lentil", "mustard", "sunflower", "chili", "onion",
    "cauliflower", "brinjal", "grapes", "apple", "orange", "mango",
    "tea", "coffee"
}

# Try to load a wider crop list from crops.json in project root
try:
    from pathlib import Path
    p = Path(__file__).resolve().parents[0] / 'crops.json'
    if p.exists():
        with open(p, 'r', encoding='utf8') as fh:
            arr = json.load(fh)
            if isinstance(arr, list) and arr:
                VALID_CROPS = set([str(x).strip() for x in arr if str(x).strip()])
except Exception:
    # keep the built-in set if anything goes wrong
    pass

# Per-crop nutrient / threshold profiles. Keys are lowercase crop names.
# Each profile may contain guidance for `moisture`, `nitrogen`, `ph`, `potassium`, and
# textual `recommendation` strings for fertilizer actions. Add or extend
# profiles as needed or load from an external file in future.
CROP_PROFILES = {
    "corn": {
        "moisture": {"min": 40},
        "nitrogen": {"min": 300, "recommendation": "Apply 60kg urea per acre"},
        "potassium": {"min": 160, "recommendation": "Apply 40kg potash per acre"},
        "ph": {"min": 6.0, "max": 7.5}
    },
    "sugarcane": {
        "moisture": {"min": 45},
        "nitrogen": {"min": 350, "recommendation": "Apply 80kg urea per acre"},
        "potassium": {"min": 220, "recommendation": "Apply 60kg potash per acre"},
        "ph": {"min": 6.0, "max": 8.0}
    },
    # generic default profile used when crop-specific profile missing
    "_default": {
        "moisture": {"min": 35},
        "nitrogen": {"min": 250, "recommendation": "Apply 50kg urea per acre"},
        "potassium": {"min": 150, "recommendation": "Apply 30kg potash per acre"},
        "ph": {"min": 6.0, "max": 8.0}
    }
}
# Try to load profiles and/or crop list from `crops.json` (supports both formats):
#  - list (existing file): treated as `crops` list
#  - object with `crops` and optional `profiles` mapping
#  - object that is a direct profiles mapping
try:
    from pathlib import Path
    p = Path(__file__).resolve().parents[0] / 'crops.json'
    if p.exists():
        with open(p, 'r', encoding='utf8') as fh:
            data = json.load(fh)
            if isinstance(data, dict):
                profiles = data.get('profiles', data)
                if isinstance(profiles, dict):
                    for k, v in profiles.items():
                        if isinstance(v, dict):
                            CROP_PROFILES[k.strip().lower()] = v
                crops_list = data.get('crops') if 'crops' in data else None
                if isinstance(crops_list, list):
                    VALID_CROPS = set([str(x).strip() for x in crops_list if str(x).strip()]) | set([k for k in CROP_PROFILES.keys() if k != "_default"])
                    # ensure every crop has a profile (copy default if missing)
                    for c in list(VALID_CROPS):
                        key = c.strip().lower()
                        if key not in CROP_PROFILES:
                            CROP_PROFILES[key] = copy.deepcopy(CROP_PROFILES["_default"])
            elif isinstance(data, list):
                VALID_CROPS = set([str(x).strip() for x in data if str(x).strip()]) | set([k for k in CROP_PROFILES.keys() if k != "_default"])
                for c in list(VALID_CROPS):
                    key = c.strip().lower()
                    if key not in CROP_PROFILES:
                        CROP_PROFILES[key] = copy.deepcopy(CROP_PROFILES["_default"])
except Exception:
    # keep built-in sets on error
    pass

def get_crop_profile(name: str) -> dict:
    """Return the nutrient/threshold profile for `name` (case-insensitive).
    Falls back to the `_default` profile when a crop-specific profile isn't found."""
    if not name:
        return CROP_PROFILES["_default"]
    return CROP_PROFILES.get(name.strip().lower(), CROP_PROFILES["_default"])

def is_valid_crop(name: str) -> bool:
    if not name: return False
    return name.strip().lower() in VALID_CROPS

def suggest_crops(prefix: str, limit: int = 20):
    p = prefix.strip().lower()
    if not p:
        return []
    matches = [c for c in sorted(VALID_CROPS) if c.lower().startswith(p)]
    return matches[:limit]

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
    # Use crop-specific profile thresholds when available
    profile = get_crop_profile(s.crop_type)

    # Moisture guidance
    moisture_min = profile.get("moisture", {}).get("min", 35)
    if s.moisture < max(20, moisture_min - 15):
        rec.append("Irrigate immediately")
        rec_hi.append("तुरंत सिंचाई करें")
        reasoning_parts.append(f"Moisture critically low at {s.moisture}%")
    elif s.moisture < moisture_min:
        rec.append("Irrigate soon")
        rec_hi.append("जल्द सिंचाई करें")
        reasoning_parts.append(f"Moisture is {s.moisture}%, below crop optimal of {moisture_min}%")

    # Nitrogen guidance
    n_min = profile.get("nitrogen", {}).get("min", 250)
    n_rec = profile.get("nitrogen", {}).get("recommendation", "Apply 50kg urea per acre")
    if s.nitrogen < n_min:
        rec.append(n_rec)
        rec_hi.append("यूरिया आवश्यक")
        reasoning_parts.append(f"Nitrogen deficiency detected at {s.nitrogen} mg/kg (target {n_min})")

    # Potassium guidance
    k_min = profile.get("potassium", {}).get("min", None)
    k_rec = profile.get("potassium", {}).get("recommendation", "Apply potash as needed")
    if k_min is not None and s.potassium < k_min:
        rec.append(k_rec)
        rec_hi.append("पोटाश की आवश्यकता")
        reasoning_parts.append(f"Potassium low at {s.potassium} mg/kg (target {k_min})")

    # pH guidance
    ph_min = profile.get("ph", {}).get("min", 6.0)
    ph_max = profile.get("ph", {}).get("max", 8.0)
    if s.ph < ph_min or s.ph > ph_max:
        reasoning_parts.append(f"Soil pH {s.ph} is outside ideal range ({ph_min}-{ph_max})")
    
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
    # Validate crop at analysis time so non-interactive callers also get feedback
    if not is_valid_crop(soil.crop_type):
        suggestions = suggest_crops(soil.crop_type)
        if suggestions:
            rec = ["Enter a valid crop name. Suggestions:"] + suggestions
        else:
            rec = ["Enter the valid crop name"]

        return AIDecision(
            action="INVALID_CROP",
            priority="LOW",
            confidence=0.0,
            reasoning=f"Crop '{soil.crop_type}' is not recognized.",
            recommendations=rec,
            recommendations_hindi=[],
            next_check_hours=0
        )

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

    def read_crop_interactive():
        while True:
            raw = input("Crop (type name or prefix): ").strip()
            if not raw:
                print("Please enter a crop name.")
                continue
            # if exact match in list, return canonical casing
            for c in VALID_CROPS:
                if c.lower() == raw.lower():
                    return c

            # suggest matches starting with prefix
            matches = suggest_crops(raw)
            if matches:
                print("\nDid you mean one of these crops?")
                for i, m in enumerate(matches, 1):
                    print(f" {i}. {m}")
                sel = input("Enter number to choose, 'r' to re-enter, or press Enter to use typed name: ").strip()
                if sel.isdigit():
                    idx = int(sel)
                    if 1 <= idx <= len(matches):
                        return matches[idx - 1]
                    print("Invalid selection, try again.")
                    continue
                if sel.lower() == 'r':
                    continue
                # empty or anything else → accept typed raw as custom crop
                return raw

            # no matches — confirm or re-enter
            confirm = input(f"No suggestions. Use '{raw}' as crop? (y/n): ").strip().lower()
            if confirm == 'y':
                return raw
            # else loop to re-enter

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
        crop_type=read_crop_interactive()
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
