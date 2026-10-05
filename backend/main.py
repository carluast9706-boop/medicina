import os
from typing import List, Optional
from fastapi import FastAPI, APIRouter, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from .database import engine, Base, get_db
from .models import User, SystemSetting, Medicine, IntakeLog
from .auth import hash_password, verify_password, create_access_token, get_current_user, get_current_superadmin
from .ai_service import get_master_gemini_api_key, analyze_prescription_with_gemini, chat_pharmacist_with_gemini

# Create Database Tables in Neon
Base.metadata.create_all(bind=engine)

import urllib.parse
from starlette.types import ASGIApp, Scope, Receive, Send

class VercelPathMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] == "http":
            query_bytes = scope.get("query_string", b"")
            query_str = query_bytes.decode("latin-1") if query_bytes else ""
            
            matched_subpath = None
            if "_route_path=" in query_str:
                params = urllib.parse.parse_qs(query_str)
                if "_route_path" in params and params["_route_path"]:
                    matched_subpath = params["_route_path"][0]
                    # Remove _route_path from query parameters
                    filtered_params = {k: v for k, v in params.items() if k != "_route_path"}
                    new_query = urllib.parse.urlencode(filtered_params, doseq=True)
                    scope["query_string"] = new_query.encode("latin-1")
            
            if not matched_subpath:
                headers = dict(scope.get("headers", []))
                route_matches = headers.get(b"x-now-route-matches", b"").decode("latin-1")
                if route_matches:
                    params = urllib.parse.parse_qs(route_matches)
                    if "1" in params and params["1"]:
                        matched_subpath = params["1"][0]
                    elif "match" in params and params["match"]:
                        matched_subpath = params["match"][0]
                    elif "path" in params and params["path"]:
                        matched_subpath = params["path"][0]

            path = scope.get("path", "")
            if matched_subpath:
                raw_path = "/api/" + matched_subpath.lstrip("/")
            else:
                raw_path = path

            if "?" in raw_path:
                raw_path = raw_path.split("?")[0]
                
            if not raw_path:
                raw_path = "/"
                
            if not raw_path.startswith("/"):
                raw_path = "/" + raw_path
                
            scope["path"] = raw_path
            scope["raw_path"] = raw_path.encode("latin-1")
            
        await self.app(scope, receive, send)

app = FastAPI(title="PharmaAlarm AI Backend", version="2.0.0")
app.add_middleware(VercelPathMiddleware)

# Enable CORS for Mobile & Web clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Seed Initial Superadmin and Sample Settings on Startup
def ensure_db_seeded():
    db = next(get_db())
    try:
        admin = db.query(User).filter(User.role == "superadmin").first()
        if not admin:
            new_admin = User(
                full_name="Administrador Principal",
                email="admin@pharma.com",
                password_hash=hash_password("admin123"),
                role="superadmin"
            )
            db.add(new_admin)
            db.commit()

        setting = db.query(SystemSetting).filter(SystemSetting.key == "gemini_api_key").first()
        if not setting:
            env_key = os.getenv("GEMINI_API_KEY", "")
            new_setting = SystemSetting(key="gemini_api_key", value=env_key)
            db.add(new_setting)
            db.commit()
    finally:
        db.close()

try:
    ensure_db_seeded()
except Exception as e:
    print("Seed warning:", e)

# =========================================================
# SCHEMAS (PYDANTIC)
# =========================================================
class RegisterSchema(BaseModel):
    full_name: str
    email: EmailStr
    password: str

class LoginSchema(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: int
    full_name: str
    email: str
    role: str

    class Config:
        from_attributes = True

class MedicineCreate(BaseModel):
    name: str
    presentation_type: str
    dose_value: str
    dose_unit: str
    frequency_hours: int
    first_dose_time: str
    duration_days: str = "7"
    food_relation: str = "despues"
    photo_url: Optional[str] = None
    alarm_tone: str = "urgent-siren"
    notes: Optional[str] = None

class MedicineResponse(BaseModel):
    id: int
    user_id: int
    name: str
    presentation_type: str
    dose_value: str
    dose_unit: str
    frequency_hours: int
    first_dose_time: str
    duration_days: str
    food_relation: str
    photo_url: Optional[str] = None
    alarm_tone: str
    notes: Optional[str] = None
    is_active: bool

    class Config:
        from_attributes = True

class IntakeLogCreate(BaseModel):
    medicine_id: Optional[int] = None
    medicine_name: str
    scheduled_time: str
    status: str
    dose_registered: str

class ScanRecipeRequest(BaseModel):
    image_base64: str

class ChatRequest(BaseModel):
    message: str

class AdminSettingsUpdate(BaseModel):
    gemini_api_key: str

from fastapi import FastAPI, APIRouter, Depends, HTTPException, status, Request

router = APIRouter()

@router.api_route("/debug", methods=["GET", "POST"])
def api_debug(request: Request):
    return {
        "url": str(request.url),
        "headers": dict(request.headers),
        "scope_path": request.scope.get("path")
    }

@router.get("/health")
def api_health():
    return {"status": "online", "database": "Neon PostgreSQL", "service": "PharmaAlarm AI Backend"}

# AUTH
@router.post("/auth/register", response_model=dict)
def register(data: RegisterSchema, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == data.email.lower()).first()
    if existing:
        raise HTTPException(status_code=400, detail="Este correo electrónico ya está registrado.")
    
    user = User(
        full_name=data.full_name,
        email=data.email.lower(),
        password_hash=hash_password(data.password),
        role="patient"
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token({"sub": user.id, "email": user.email, "role": user.role})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "full_name": user.full_name,
            "email": user.email,
            "role": user.role
        }
    }

@router.post("/auth/login", response_model=dict)
def login(data: LoginSchema, db: Session = Depends(get_db)):
    ensure_db_seeded()
    user = db.query(User).filter(User.email == data.email.lower()).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Correo o contraseña incorrectos.")

    token = create_access_token({"sub": user.id, "email": user.email, "role": user.role})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "full_name": user.full_name,
            "email": user.email,
            "role": user.role
        }
    }

@router.get("/auth/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user

# MEDICINES
@router.get("/medicines", response_model=List[MedicineResponse])
def get_my_medicines(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Medicine).filter(Medicine.user_id == current_user.id, Medicine.is_active == True).all()

@router.post("/medicines", response_model=MedicineResponse)
def create_medicine(data: MedicineCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    med = Medicine(
        user_id=current_user.id,
        name=data.name,
        presentation_type=data.presentation_type,
        dose_value=data.dose_value,
        dose_unit=data.dose_unit,
        frequency_hours=data.frequency_hours,
        first_dose_time=data.first_dose_time,
        duration_days=data.duration_days,
        food_relation=data.food_relation,
        photo_url=data.photo_url,
        alarm_tone=data.alarm_tone,
        notes=data.notes,
        is_active=True
    )
    db.add(med)
    db.commit()
    db.refresh(med)
    return med

@router.delete("/medicines/{med_id}")
def delete_medicine(med_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    med = db.query(Medicine).filter(Medicine.id == med_id, Medicine.user_id == current_user.id).first()
    if not med:
        raise HTTPException(status_code=404, detail="Medicamento no encontrado.")
    db.delete(med)
    db.commit()
    return {"message": "Medicamento eliminado correctamente."}

# INTAKE LOGS
@router.get("/intake-logs")
def get_my_logs(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(IntakeLog).filter(IntakeLog.user_id == current_user.id).order_by(IntakeLog.taken_at.desc()).limit(50).all()

@router.post("/intake-logs")
def record_log(data: IntakeLogCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    log = IntakeLog(
        user_id=current_user.id,
        medicine_id=data.medicine_id,
        medicine_name=data.medicine_name,
        scheduled_time=data.scheduled_time,
        status=data.status,
        dose_registered=data.dose_registered
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log

# AI VISION & CHAT
@router.post("/ai/scan-recipe")
def scan_recipe_ai(data: ScanRecipeRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    api_key = get_master_gemini_api_key(db)
    if not api_key:
        return [
            {
                "name": "Amoxicilina + Ácido Clavulánico (Jarabe)",
                "presentation_type": "jarabe",
                "dose_value": "7.5",
                "dose_unit": "ml",
                "frequency_hours": 8,
                "first_dose_time": "08:00",
                "duration_days": "7",
                "food_relation": "con",
                "notes": "Medir exactamente con jeringa graduada y agitar antes de usar."
            },
            {
                "name": "Ibuprofeno 400mg",
                "presentation_type": "pastilla",
                "dose_value": "1",
                "dose_unit": "pastilla(s)",
                "frequency_hours": 8,
                "first_dose_time": "09:00",
                "duration_days": "5",
                "food_relation": "despues",
                "notes": "Tomar con abundante agua después de la comida."
            }
        ]
    try:
        return analyze_prescription_with_gemini(data.image_base64, api_key)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error en análisis IA: {str(e)}")

@router.post("/ai/chat")
def chat_ai(data: ChatRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user_meds = db.query(Medicine).filter(Medicine.user_id == current_user.id, Medicine.is_active == True).all()
    api_key = get_master_gemini_api_key(db)
    
    if not api_key:
        if not user_meds:
            return {"reply": "⚠️ Actualmente **no tienes ningún medicamento registrado** en tu tratamiento activo. Por favor registra tus fármacos en 'Medicinas' o escanea una receta."}
        
        q = data.message.lower()
        matched = [m for m in user_meds if m.name.lower().split()[0] in q]
        if matched:
            m = matched[0]
            return {"reply": f"💊 **Especialista en {m.name}:**\n• Dosis: **${m.dose_value} ${m.dose_unit}**\n• Frecuencia: Cada **${m.frequency_hours} horas** (Inicia ${m.first_dose_time})\n• Instrucción: Tomar ${m.food_relation} de los alimentos.\n• Duración: ${m.duration_days} días."}
        
        names = ", ".join([m.name for m in user_meds])
        return {"reply": f"🔒 **Medicamento no registrado:** Como tu Especialista Farmacéutico, solo puedo responderte sobre tus medicamentos cargados actualmente: **${names}**."}

    try:
        reply = chat_pharmacist_with_gemini(data.message, user_meds, api_key)
        return {"reply": reply}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al consultar el especialista: {str(e)}")

# SUPERADMIN
@router.get("/admin/settings")
def get_admin_settings(admin: User = Depends(get_current_superadmin), db: Session = Depends(get_db)):
    key_setting = db.query(SystemSetting).filter(SystemSetting.key == "gemini_api_key").first()
    key_val = key_setting.value if key_setting else ""
    masked = key_val[:6] + "..." + key_val[-4:] if len(key_val) > 10 else ("Configurada" if key_val else "No configurada")
    return {
        "gemini_api_key_configured": bool(key_val),
        "gemini_api_key_preview": masked
    }

@router.post("/admin/settings")
def update_admin_settings(data: AdminSettingsUpdate, admin: User = Depends(get_current_superadmin), db: Session = Depends(get_db)):
    setting = db.query(SystemSetting).filter(SystemSetting.key == "gemini_api_key").first()
    if not setting:
        setting = SystemSetting(key="gemini_api_key", value=data.gemini_api_key.strip())
        db.add(setting)
    else:
        setting.value = data.gemini_api_key.strip()
    db.commit()
    return {"message": "Clave API de Gemini actualizada por el Superadministrador exitosamente."}

@router.get("/admin/stats")
def get_admin_stats(admin: User = Depends(get_current_superadmin), db: Session = Depends(get_db)):
    total_users = db.query(User).count()
    total_medicines = db.query(Medicine).count()
    total_logs = db.query(IntakeLog).count()
    users_list = db.query(User.id, User.full_name, User.email, User.role, User.created_at).all()
    
    return {
        "total_users": total_users,
        "total_medicines": total_medicines,
        "total_logs": total_logs,
        "users": [
            {
                "id": u.id,
                "full_name": u.full_name,
                "email": u.email,
                "role": u.role,
                "created_at": str(u.created_at)
            }
            for u in users_list
        ]
    }

# Mount Router with BOTH /api prefix and root prefix
app.include_router(router, prefix="/api")
app.include_router(router, prefix="")
