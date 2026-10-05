import json
import re
import requests
from sqlalchemy.orm import Session
from .models import SystemSetting

def get_master_gemini_api_key(db: Session) -> str:
    setting = db.query(SystemSetting).filter(SystemSetting.key == "gemini_api_key").first()
    if setting and setting.value and setting.value.strip():
        return setting.value.strip()
    return ""

def analyze_prescription_with_gemini(image_base64: str, api_key: str):
    clean_base64 = re.sub(r'^data:image\/[a-zA-Z0-9]+;base64,', '', image_base64)
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"

    prompt = """Eres un Especialista Farmacéutico y Médico Farmacólogo. Analiza la siguiente imagen de una receta médica o caja de medicamento y extrae todos los medicamentos prescritos.
Responde ÚNICAMENTE un array JSON válido con la siguiente estructura exacta:
[
  {
    "name": "Nombre comercial o principio activo",
    "presentation_type": "pastilla" | "jarabe" | "gotas" | "inyeccion",
    "dose_value": "cantidad numérica (ej: '5', '7.5', '1')",
    "dose_unit": "ml" | "pastilla(s)" | "cápsula(s)" | "gota(s)",
    "frequency_hours": 8,
    "first_dose_time": "08:00",
    "duration_days": "7",
    "food_relation": "despues" | "con" | "ayunas" | "indiferente",
    "notes": "Instrucción de seguridad farmacéutica"
  }
]"""

    payload = {
        "contents": [{
            "parts": [
                {"text": prompt},
                {
                    "inline_data": {
                        "mime_type": "image/jpeg",
                        "data": clean_base64
                    }
                }
            ]
        }]
    }

    resp = requests.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=30)
    if not resp.ok:
        raise Exception(f"Gemini API Error: {resp.status_code} - {resp.text}")

    data = resp.json()
    text_content = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "[]")
    
    match = re.search(r'\[[\s\S]*\]', text_content)
    if match:
        return json.loads(match.group(0))
    return []

def chat_pharmacist_with_gemini(query: str, user_medicines: list, api_key: str) -> str:
    med_text = ""
    for m in user_medicines:
        med_text += f"- {m.name}: Tipo {m.presentation_type}, Dosis: {m.dose_value} {m.dose_unit}, Cada {m.frequency_hours} horas (inicio {m.first_dose_time}), Alimentos: {m.food_relation}, Duración: {m.duration_days} días. Notas: {m.notes or 'Sin notas'}\n"

    system_instruction = f"""Eres el Especialista Farmacéutico personal de PharmaAlarm AI.
REGLA ESTRICTA Y OBLIGATORIA:
Solo puedes responder preguntas y orientar sobre los medicamentos que el paciente tiene actualmente CARGADOS en su tratamiento activo:

MEDICAMENTOS CARGADOS DEL PACIENTE:
{med_text if med_text else 'EL PACIENTE NO TIENE MEDICAMENTOS CARGADOS.'}

Si el usuario pregunta sobre cualquier fármaco que NO esté en la lista anterior, debes indicarle con amabilidad y firmeza que ese medicamento no está registrado en su tratamiento actual, listar sus medicamentos cargados y pedirle que lo registre primero en la aplicación si su médico se lo recetó.
Para sus medicamentos cargados, explícale su dosis exacta (indicando si es en ml o pastillas), horarios, comidas y precauciones. Responde en español claro, profesional y empático."""

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
    payload = {
        "contents": [
            {"parts": [{"text": system_instruction + "\n\nPregunta del paciente: " + query}]}
        ]
    }

    resp = requests.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=25)
    if not resp.ok:
        raise Exception(f"Gemini API Error: {resp.status_code} - {resp.text}")

    data = resp.json()
    return data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "No se pudo obtener respuesta del especialista.")
