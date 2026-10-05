import datetime
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from .database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String(120), nullable=False)
    email = Column(String(150), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), default="patient")  # 'patient' or 'superadmin'
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    medicines = relationship("Medicine", back_populates="user", cascade="all, delete-orphan")
    intake_logs = relationship("IntakeLog", back_populates="user", cascade="all, delete-orphan")

class SystemSetting(Base):
    __tablename__ = "system_settings"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(100), unique=True, index=True, nullable=False) # e.g. 'gemini_api_key'
    value = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

class Medicine(Base):
    __tablename__ = "medicines"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(150), nullable=False)
    presentation_type = Column(String(30), nullable=False)  # 'jarabe', 'pastilla', 'gotas', 'inyeccion'
    dose_value = Column(String(20), nullable=False)         # '5', '7.5', '1'
    dose_unit = Column(String(30), nullable=False)          # 'ml', 'pastilla(s)', etc.
    frequency_hours = Column(Integer, nullable=False)       # 4, 6, 8, 12, 24
    first_dose_time = Column(String(10), nullable=False)    # '08:00'
    duration_days = Column(String(20), default="7")         # '5', '7', 'cronico'
    food_relation = Column(String(30), default="despues")   # 'despues', 'con', 'ayunas'
    photo_url = Column(Text, nullable=True)
    alarm_tone = Column(String(50), default="urgent-siren")
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    user = relationship("User", back_populates="medicines")
    intake_logs = relationship("IntakeLog", back_populates="medicine", cascade="all, delete-orphan")

class IntakeLog(Base):
    __tablename__ = "intake_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    medicine_id = Column(Integer, ForeignKey("medicines.id", ondelete="CASCADE"), nullable=True)
    medicine_name = Column(String(150), nullable=False)
    scheduled_time = Column(String(10), nullable=False)     # '08:00'
    taken_at = Column(DateTime, default=datetime.datetime.utcnow)
    status = Column(String(20), nullable=False)             # 'taken', 'snoozed', 'missed'
    dose_registered = Column(String(50), nullable=False)

    user = relationship("User", back_populates="intake_logs")
    medicine = relationship("Medicine", back_populates="intake_logs")
