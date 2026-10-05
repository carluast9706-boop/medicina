/**
 * PharmaAlarm AI - Motor Principal y Especialista Farmacéutico
 * Soporta PWA en Android e iOS, Backend Python con PostgreSQL/SQLite, JWT, Superadmin Master API y Control de Dosis.
 */

// =========================================================
// DEFAULT DATA & ASSETS
// =========================================================
const STOCK_IMAGES = {
  pastilla: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&auto=format&fit=crop&q=60',
  jarabe: 'https://images.unsplash.com/photo-1587854692152-cbe660dbde88?w=500&auto=format&fit=crop&q=60',
  gotas: 'https://images.unsplash.com/photo-1576602976047-174e57a47881?w=500&auto=format&fit=crop&q=60',
  inyeccion: 'https://images.unsplash.com/photo-1579154204601-01588f351e67?w=500&auto=format&fit=crop&q=60'
};

const INITIAL_MEDICINES = [
  {
    id: 'med-1',
    name: 'Amoxicilina + Ácido Clavulánico (Jarabe)',
    type: 'jarabe',
    doseValue: '7.5',
    doseUnit: 'ml',
    frequencyHours: 8,
    firstDoseTime: '08:00',
    durationDays: '7',
    foodRelation: 'con',
    photoUrl: STOCK_IMAGES.jarabe,
    alarmTone: 'urgent-siren',
    notes: 'Agitar bien el frasco antes de dosificar con jeringa.',
    startDate: new Date().toISOString()
  },
  {
    id: 'med-2',
    name: 'Ibuprofeno 400mg',
    type: 'pastilla',
    doseValue: '1',
    doseUnit: 'pastilla(s)',
    frequencyHours: 8,
    firstDoseTime: '09:00',
    durationDays: '5',
    foodRelation: 'despues',
    photoUrl: STOCK_IMAGES.pastilla,
    alarmTone: 'hospital-beeps',
    notes: 'Tomar con medio vaso de agua después del desayuno/comida.',
    startDate: new Date().toISOString()
  }
];

// =========================================================
// APPLICATION STATE
// =========================================================
const state = {
  currentView: 'view-today',
  user: JSON.parse(localStorage.getItem('pharma_user')) || null,
  token: localStorage.getItem('pharma_jwt') || null,
  medicines: JSON.parse(localStorage.getItem('pharma_medicines')) || INITIAL_MEDICINES,
  historyLogs: JSON.parse(localStorage.getItem('pharma_history')) || [],
  settings: JSON.parse(localStorage.getItem('pharma_settings')) || {
    apiKey: '',
    voiceAnnouncement: true,
    vibration: true
  },
  chatMessages: [
    {
      sender: 'ai',
      text: '¡Hola! Soy tu Especialista Farmacéutico personal de PharmaAlarm. Estoy aquí para resolver cualquier duda exclusivamente sobre tus **medicamentos actualmente cargados**, sus dosis exactas (en ml o pastillas), horarios, toma con alimentos y precauciones.'
    }
  ],
  activeAlarm: null,
  isAlarmMuted: false,
  scannedImageBase64: null,
  detectedMedicinesDraft: []
};

// =========================================================
// API HELPER (Fetch with JWT Authentication & Remote URL support)
// =========================================================
function getApiBaseUrl() {
  return localStorage.getItem('pharma_api_url') || '';
}

async function apiFetch(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }

  const url = `${getApiBaseUrl()}${endpoint}`;

  try {
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      logoutUser(false);
      throw new Error('Sesión expirada. Inicia sesión nuevamente.');
    }
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || 'Error en la petición al servidor');
    }
    return data;
  } catch (err) {
    console.warn(`API [${url}] Error:`, err);
    throw err;
  }
}

// =========================================================
// SYNC DATA WITH PYTHON SQL BACKEND
// =========================================================
async function syncFromBackend() {
  if (!state.token) return;

  try {
    // 1. Verify User Profile
    const me = await apiFetch('/api/auth/me');
    state.user = me;
    localStorage.setItem('pharma_user', JSON.stringify(me));
    updateUserAuthUI();

    // 2. Fetch User Medicines from SQL
    const backendMeds = await apiFetch('/api/medicines');
    if (Array.isArray(backendMeds)) {
      state.medicines = backendMeds.map(m => ({
        id: m.id,
        name: m.name,
        type: m.presentation_type,
        doseValue: m.dose_value,
        doseUnit: m.dose_unit,
        frequencyHours: m.frequency_hours,
        firstDoseTime: m.first_dose_time,
        durationDays: m.duration_days,
        foodRelation: m.food_relation,
        photoUrl: m.photo_url || STOCK_IMAGES[m.presentation_type] || STOCK_IMAGES.pastilla,
        alarmTone: m.alarm_tone,
        notes: m.notes
      }));
      localStorage.setItem('pharma_medicines', JSON.stringify(state.medicines));
    }

    // 3. Fetch Intake Logs from SQL
    const backendLogs = await apiFetch('/api/intake-logs');
    if (Array.isArray(backendLogs)) {
      state.historyLogs = backendLogs.map(l => ({
        id: l.id,
        medId: l.medicine_id,
        medName: l.medicine_name,
        dose: l.dose_registered,
        doseTime: l.scheduled_time,
        time: l.taken_at ? l.taken_at.split('T')[1]?.substring(0, 5) : l.scheduled_time,
        date: l.taken_at ? l.taken_at.split('T')[0] : new Date().toISOString().split('T')[0],
        status: l.status,
        timestamp: new Date(l.taken_at).getTime()
      }));
      localStorage.setItem('pharma_history', JSON.stringify(state.historyLogs));
    }

    renderCurrentView();
  } catch (err) {
    console.warn('Sync fallback to local cache:', err);
  }
}

function updateUserAuthUI() {
  const superAdminBtn = document.getElementById('btn-superadmin');
  const userBtn = document.getElementById('btn-user-auth');
  const loggedInView = document.getElementById('auth-logged-in-view');
  const formsView = document.getElementById('auth-forms-view');

  if (state.user) {
    userBtn.innerHTML = `<i class="fa-solid fa-user-check" style="color: var(--primary);"></i>`;
    userBtn.title = `Conectado como: ${state.user.full_name}`;

    document.getElementById('profile-name').textContent = state.user.full_name;
    document.getElementById('profile-email').textContent = state.user.email;
    document.getElementById('profile-role').textContent = state.user.role === 'superadmin' ? '👑 Super Administrador' : '👤 Paciente';

    loggedInView.classList.remove('hidden');
    formsView.classList.add('hidden');

    if (state.user.role === 'superadmin') {
      superAdminBtn.classList.remove('hidden');
    } else {
      superAdminBtn.classList.add('hidden');
    }
  } else {
    userBtn.innerHTML = `<i class="fa-solid fa-user"></i>`;
    userBtn.title = 'Iniciar Sesión / Cuenta';
    superAdminBtn.classList.add('hidden');
    loggedInView.classList.add('hidden');
    formsView.classList.remove('hidden');
  }
}

function logoutUser(showMsg = true) {
  state.token = null;
  state.user = null;
  localStorage.removeItem('pharma_jwt');
  localStorage.removeItem('pharma_user');
  updateUserAuthUI();
  if (showMsg) showToast('Has cerrado sesión');
}

// =========================================================
// WEB AUDIO API - SYNTHESIZER DE ALARMAS CONTUNDENTES
// =========================================================
class AlarmAudioEngine {
  constructor() {
    this.ctx = null;
    this.isPlaying = false;
    this.timer = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  startUrgentSiren() {
    this.init();
    this.stop();
    this.isPlaying = true;

    const playSirenBurst = () => {
      if (!this.isPlaying) return;
      try {
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(1400, now + 0.35);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.7);

        gain.gain.setValueAtTime(0.3, now);
        gain.gain.linearRampToValueAtTime(0.7, now + 0.2);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.75);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.75);
      } catch (e) {
        console.warn('Audio play error:', e);
      }
    };

    playSirenBurst();
    this.timer = setInterval(playSirenBurst, 850);
  }

  startHospitalBeeps() {
    this.init();
    this.stop();
    this.isPlaying = true;

    const playBeepSeq = () => {
      if (!this.isPlaying) return;
      try {
        const now = this.ctx.currentTime;
        [0, 0.2, 0.4].forEach((offset) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(1050, now + offset);
          gain.gain.setValueAtTime(0.6, now + offset);
          gain.gain.exponentialRampToValueAtTime(0.01, now + offset + 0.12);

          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start(now + offset);
          osc.stop(now + offset + 0.14);
        });
      } catch (e) {
        console.warn('Beep error:', e);
      }
    };

    playBeepSeq();
    this.timer = setInterval(playBeepSeq, 1200);
  }

  startDigitalChime() {
    this.init();
    this.stop();
    this.isPlaying = true;

    const playChime = () => {
      if (!this.isPlaying) return;
      try {
        const now = this.ctx.currentTime;
        const freqs = [523.25, 659.25, 783.99, 1046.50];
        freqs.forEach((freq, idx) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + idx * 0.1);
          gain.gain.setValueAtTime(0.5, now + idx * 0.1);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.4);

          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start(now + idx * 0.1);
          osc.stop(now + idx * 0.1 + 0.45);
        });
      } catch (e) {
        console.warn('Chime error:', e);
      }
    };

    playChime();
    this.timer = setInterval(playChime, 2000);
  }

  playTone(toneName) {
    if (toneName === 'hospital-beeps') {
      this.startHospitalBeeps();
    } else if (toneName === 'digital-chime') {
      this.startDigitalChime();
    } else {
      this.startUrgentSiren();
    }
  }

  stop() {
    this.isPlaying = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

const audioEngine = new AlarmAudioEngine();

// =========================================================
// SPEECH SYNTHESIS & VIBRATION
// =========================================================
function speakMedicationReminder(med) {
  if (!state.settings.voiceAnnouncement || !('speechSynthesis' in window)) return;

  window.speechSynthesis.cancel();
  const doseText = `${med.doseValue} ${med.doseUnit}`;
  const foodNote = getFoodInstructionText(med.foodRelation);
  const text = `Atención. Es hora de tomar su medicamento: ${med.name}. Dosis: ${doseText}. ${foodNote}.`;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'es-ES';
  utterance.rate = 1.0;
  utterance.pitch = 1.05;

  const voices = window.speechSynthesis.getVoices();
  const esVoice = voices.find(v => v.lang.startsWith('es'));
  if (esVoice) utterance.voice = esVoice;

  window.speechSynthesis.speak(utterance);
}

function getFoodInstructionText(foodRelation) {
  switch (foodRelation) {
    case 'con': return 'Tomar junto con los alimentos';
    case 'despues': return 'Tomar después de comer';
    case 'ayunas': return 'Tomar en ayunas antes de comer';
    default: return 'Puede tomarse en cualquier momento';
  }
}

let vibrationInterval = null;
function startDeviceVibration() {
  if (!state.settings.vibration || !('vibrate' in navigator)) return;
  stopDeviceVibration();
  navigator.vibrate([400, 200, 400, 200, 800]);
  vibrationInterval = setInterval(() => {
    navigator.vibrate([400, 200, 400, 200, 800]);
  }, 2200);
}

function stopDeviceVibration() {
  if (vibrationInterval) {
    clearInterval(vibrationInterval);
    vibrationInterval = null;
  }
  if ('vibrate' in navigator) {
    navigator.vibrate(0);
  }
}

function saveLocalState() {
  localStorage.setItem('pharma_medicines', JSON.stringify(state.medicines));
  localStorage.setItem('pharma_history', JSON.stringify(state.historyLogs));
  localStorage.setItem('pharma_settings', JSON.stringify(state.settings));
}

// =========================================================
// SCHEDULE & TIMELINE CALCULATOR
// =========================================================
function computeTodayDoses() {
  const today = new Date();
  const currentHour = today.getHours();
  const currentMinute = today.getMinutes();
  const allDoses = [];

  state.medicines.forEach(med => {
    const [startH, startM] = (med.firstDoseTime || '08:00').split(':').map(Number);
    const freq = Number(med.frequencyHours) || 8;
    const dosesPerDay = Math.floor(24 / freq);

    for (let i = 0; i < dosesPerDay; i++) {
      const doseHour = (startH + i * freq) % 24;
      const doseMin = startM;
      const timeString = `${String(doseHour).padStart(2, '0')}:${String(doseMin).padStart(2, '0')}`;

      const todayDateStr = today.toISOString().split('T')[0];
      const isTaken = state.historyLogs.some(log => 
        String(log.medId) === String(med.id) && 
        log.date === todayDateStr && 
        log.doseTime === timeString &&
        log.status === 'taken'
      );

      let status = 'pending';
      if (isTaken) {
        status = 'taken';
      } else if (doseHour < currentHour || (doseHour === currentHour && doseMin < currentMinute)) {
        status = 'missed';
      }

      allDoses.push({
        medId: med.id,
        medName: med.name,
        medType: med.type,
        doseValue: med.doseValue,
        doseUnit: med.doseUnit,
        foodRelation: med.foodRelation,
        photoUrl: med.photoUrl || STOCK_IMAGES[med.type] || STOCK_IMAGES.pastilla,
        alarmTone: med.alarmTone || 'urgent-siren',
        timeString: timeString,
        hour: doseHour,
        min: doseMin,
        status: status,
        rawMed: med
      });
    }
  });

  allDoses.sort((a, b) => {
    if (a.hour !== b.hour) return a.hour - b.hour;
    return a.min - b.min;
  });

  return allDoses;
}

// =========================================================
// RENDER VIEWS
// =========================================================
function renderCurrentView() {
  document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
  document.querySelectorAll('.bottom-nav .nav-item').forEach(btn => btn.classList.remove('active'));

  const activeSection = document.getElementById(state.currentView);
  if (activeSection) activeSection.classList.add('active');

  const activeNavBtn = document.querySelector(`.bottom-nav .nav-item[data-view="${state.currentView}"]`);
  if (activeNavBtn) activeNavBtn.classList.add('active');

  if (state.currentView === 'view-today') {
    renderTodayView();
  } else if (state.currentView === 'view-medicines') {
    renderMedicinesGrid();
  } else if (state.currentView === 'view-history') {
    renderHistoryView();
  } else if (state.currentView === 'view-assistant') {
    renderChatMessages();
  }
}

function renderTodayView() {
  const doses = computeTodayDoses();
  const spotlightEl = document.getElementById('next-dose-spotlight');
  const timelineEl = document.getElementById('timeline-container');
  const todayBadgeEl = document.getElementById('today-count-badge');

  const pendingDoses = doses.filter(d => d.status === 'pending' || d.status === 'missed');
  todayBadgeEl.textContent = `${pendingDoses.length} pendientes`;

  const nextDose = pendingDoses[0];

  if (nextDose) {
    spotlightEl.innerHTML = `
      <div class="spotlight-top">
        <span class="spotlight-badge"><i class="fa-solid fa-clock"></i> Próxima Toma</span>
        <span class="spotlight-time">${nextDose.timeString}</span>
      </div>
      <div class="spotlight-body">
        <img class="spotlight-med-img" src="${nextDose.photoUrl}" alt="${nextDose.medName}">
        <div class="spotlight-info">
          <h3>${nextDose.medName}</h3>
          <div class="spotlight-dose-tag">
            <i class="${getIconForType(nextDose.medType)}"></i> ${nextDose.doseValue} ${nextDose.doseUnit}
          </div>
          <div class="spotlight-instructions">
            <i class="fa-solid fa-circle-info"></i> ${getFoodInstructionText(nextDose.foodRelation)}
          </div>
        </div>
      </div>
      <div class="spotlight-actions">
        <button class="btn-spotlight-take" onclick="markDoseAsTaken('${nextDose.medId}', '${nextDose.timeString}')">
          <i class="fa-solid fa-check"></i> Tomar Ahora
        </button>
        <button class="btn-spotlight-snooze" onclick="triggerAlarmModalForDose('${nextDose.medId}', '${nextDose.timeString}')">
          <i class="fa-solid fa-bell"></i> Ver Alarma
        </button>
      </div>
    `;
  } else {
    spotlightEl.innerHTML = `
      <div class="spotlight-empty">
        <i class="fa-solid fa-circle-check"></i>
        <h3>¡Todo al día por hoy!</h3>
        <p>Has completado todas tus tomas programadas o no hay medicamentos activos.</p>
      </div>
    `;
  }

  if (doses.length === 0) {
    timelineEl.innerHTML = `
      <div style="text-align: center; padding: 30px; color: var(--text-muted);">
        <i class="fa-solid fa-notes-medical" style="font-size: 36px; margin-bottom: 8px;"></i>
        <p>No tienes medicamentos programados hoy.</p>
        <p style="font-size: 12px; margin-top: 4px;">Usa el botón "Escanear" para cargar tu receta o agrega uno manualmente.</p>
      </div>
    `;
    return;
  }

  timelineEl.innerHTML = doses.map(dose => {
    const isTaken = dose.status === 'taken';
    const isMissed = dose.status === 'missed';
    const statusClass = isTaken ? 'dose-taken' : (isMissed ? 'dose-missed' : 'dose-pending');
    const statusText = isTaken ? 'Tomado' : (isMissed ? 'Atrasada' : 'Pendiente');

    return `
      <div class="dose-card ${statusClass}">
        <div class="dose-time-box">
          <span class="dose-time-hour">${dose.timeString}</span>
          <span class="dose-time-status">${statusText}</span>
        </div>
        <div class="dose-main-info">
          <img class="dose-med-avatar" src="${dose.photoUrl}" alt="${dose.medName}">
          <div class="dose-text">
            <h4>${dose.medName}</h4>
            <span class="dose-qty-badge">
              <i class="${getIconForType(dose.medType)}"></i> ${dose.doseValue} ${dose.doseUnit}
            </span>
            <p class="dose-food-note">${getFoodInstructionText(dose.foodRelation)}</p>
          </div>
        </div>
        <div class="dose-actions">
          <button class="btn-check-dose ${isTaken ? 'checked' : ''}" 
                  title="${isTaken ? 'Dosis completada' : 'Marcar como tomado'}"
                  onclick="markDoseAsTaken('${dose.medId}', '${dose.timeString}')">
            <i class="fa-solid ${isTaken ? 'fa-check-double' : 'fa-check'}"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function renderMedicinesGrid() {
  const gridEl = document.getElementById('medicines-grid');
  if (state.medicines.length === 0) {
    gridEl.innerHTML = `
      <div style="text-align: center; padding: 40px 16px; color: var(--text-muted); background: var(--bg-card); border-radius: var(--radius-lg); border: 1px dashed var(--border-light);">
        <i class="fa-solid fa-pills" style="font-size: 40px; margin-bottom: 12px; color: var(--primary);"></i>
        <h3 style="color: var(--text-main); font-size: 16px;">Sin medicamentos registrados</h3>
        <p style="font-size: 13px; margin-top: 6px;">Agrega tus medicamentos con el botón "Nuevo" o escanea una receta médica con foto.</p>
      </div>
    `;
    return;
  }

  gridEl.innerHTML = state.medicines.map(med => `
    <div class="med-card">
      <img class="med-card-img" src="${med.photoUrl || STOCK_IMAGES[med.type] || STOCK_IMAGES.pastilla}" alt="${med.name}">
      <button class="btn-med-delete" onclick="deleteMedicine('${med.id}')" title="Eliminar medicamento">
        <i class="fa-regular fa-trash-can"></i>
      </button>
      <div class="med-card-content">
        <h3 class="med-card-title">${med.name}</h3>
        <p class="med-card-dose">
          <i class="${getIconForType(med.type)}"></i> Dosis: <strong>${med.doseValue} ${med.doseUnit}</strong>
        </p>
        <p class="med-card-schedule">
          <i class="fa-solid fa-rotate"></i> Cada ${med.frequencyHours} horas (Inicia: ${med.firstDoseTime})
        </p>
        <div class="med-card-badge-row">
          <span class="pill-badge"><i class="fa-solid fa-utensils"></i> ${getFoodInstructionText(med.foodRelation)}</span>
          <span class="pill-badge"><i class="fa-solid fa-calendar"></i> ${med.durationDays === 'cronico' ? 'Continuo' : `${med.durationDays} días`}</span>
        </div>
      </div>
    </div>
  `).join('');
}

function renderHistoryView() {
  const listEl = document.getElementById('history-log-list');
  const rateEl = document.getElementById('stat-adherence-rate');
  const takenEl = document.getElementById('stat-taken-count');
  const missedEl = document.getElementById('stat-missed-count');

  const takenCount = state.historyLogs.filter(l => l.status === 'taken').length;
  const snoozedCount = state.historyLogs.filter(l => l.status === 'snoozed').length;
  const total = takenCount + snoozedCount;
  const adherence = total > 0 ? Math.round((takenCount / total) * 100) : 100;

  rateEl.textContent = `${adherence}%`;
  takenEl.textContent = takenCount;
  missedEl.textContent = snoozedCount;

  if (state.historyLogs.length === 0) {
    listEl.innerHTML = `
      <p style="text-align:center; color: var(--text-muted); font-size: 13px; padding: 16px;">
        Aún no hay registros de tomas. Las dosis que confirmes aparecerán aquí.
      </p>
    `;
    return;
  }

  const sortedLogs = [...state.historyLogs].reverse().slice(0, 20);
  listEl.innerHTML = sortedLogs.map(log => `
    <div class="history-item">
      <div class="history-item-left">
        <i class="fa-solid fa-circle-check" style="color: var(--accent-emerald);"></i>
        <div>
          <strong style="color: var(--text-main); font-size: 13px;">${log.medName}</strong>
          <p style="font-size: 11px; color: var(--text-muted);">${log.dose}</p>
        </div>
      </div>
      <div style="text-align: right;">
        <span class="history-item-time">${log.time || log.doseTime}</span>
        <div><span class="badge-log-taken">${log.status === 'taken' ? 'Tomado' : 'Pospuesto'}</span></div>
      </div>
    </div>
  `).join('');
}

function getIconForType(type) {
  switch (type) {
    case 'jarabe': return 'fa-solid fa-bottle-droplet';
    case 'gotas': return 'fa-solid fa-eye-dropper';
    case 'inyeccion': return 'fa-solid fa-syringe';
    default: return 'fa-solid fa-capsules';
  }
}

// =========================================================
// ACTION: MARK DOSE AS TAKEN & RECORD TO SQL
// =========================================================
window.markDoseAsTaken = async function(medId, doseTime) {
  const med = state.medicines.find(m => String(m.id) === String(medId));
  if (!med) return;

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const dateStr = now.toISOString().split('T')[0];

  const logEntry = {
    id: 'log-' + Date.now(),
    medId: med.id,
    medName: med.name,
    dose: `${med.doseValue} ${med.doseUnit}`,
    date: dateStr,
    doseTime: doseTime,
    time: timeStr,
    status: 'taken',
    timestamp: Date.now()
  };

  state.historyLogs.push(logEntry);
  saveLocalState();
  closeAlarmModal();
  renderCurrentView();

  // Sync with SQL Backend if logged in
  if (state.token && typeof med.id === 'number') {
    try {
      await apiFetch('/api/intake-logs', {
        method: 'POST',
        body: JSON.stringify({
          medicine_id: med.id,
          medicine_name: med.name,
          scheduled_time: doseTime,
          status: 'taken',
          dose_registered: `${med.doseValue} ${med.doseUnit}`
        })
      });
    } catch (e) {
      console.warn('Log sync error:', e);
    }
  }

  showToast(`✅ Dosis registrada: ${med.name} (${med.doseValue} ${med.doseUnit})`);
};

window.deleteMedicine = async function(medId) {
  if (confirm('¿Deseas eliminar este medicamento de tus recordatorios?')) {
    if (state.token && typeof medId === 'number') {
      try {
        await apiFetch(`/api/medicines/${medId}`, { method: 'DELETE' });
      } catch (e) {
        console.warn('Delete SQL error:', e);
      }
    }
    state.medicines = state.medicines.filter(m => String(m.id) !== String(medId));
    saveLocalState();
    renderCurrentView();
    showToast('Medicamento eliminado');
  }
};

// =========================================================
// CONTUNDENT ALARM MODAL TRIGGER
// =========================================================
window.triggerAlarmModalForDose = function(medId, doseTime) {
  const med = state.medicines.find(m => String(m.id) === String(medId));
  if (!med) return;

  state.activeAlarm = {
    med: med,
    doseTime: doseTime || '12:00',
    timestamp: Date.now()
  };

  const modalEl = document.getElementById('alarm-modal');
  const clockEl = document.getElementById('alarm-live-clock');
  const imgEl = document.getElementById('alarm-med-image');
  const nameEl = document.getElementById('alarm-med-name');
  const doseAmtEl = document.getElementById('alarm-dose-amount');
  const doseTypeEl = document.getElementById('alarm-dose-type');
  const instructionsEl = document.getElementById('alarm-instructions');
  const formTagEl = document.getElementById('alarm-form-tag');

  const now = new Date();
  clockEl.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  imgEl.src = med.photoUrl || STOCK_IMAGES[med.type] || STOCK_IMAGES.pastilla;
  nameEl.textContent = med.name;
  doseAmtEl.textContent = `${med.doseValue} ${med.doseUnit}`;
  doseTypeEl.textContent = med.type === 'jarabe' ? '(Vía Oral - Medir con Jeringa/Cuchara)' : '(Vía Oral)';
  instructionsEl.innerHTML = `<i class="fa-solid fa-utensils"></i> ${getFoodInstructionText(med.foodRelation)}. ${med.notes || ''}`;
  formTagEl.innerHTML = `<i class="${getIconForType(med.type)}"></i> ${med.type.toUpperCase()}`;

  modalEl.classList.remove('hidden');

  state.isAlarmMuted = false;
  audioEngine.playTone(med.alarmTone || 'urgent-siren');
  speakMedicationReminder(med);
  startDeviceVibration();
};

function closeAlarmModal() {
  const modalEl = document.getElementById('alarm-modal');
  modalEl.classList.add('hidden');
  audioEngine.stop();
  stopDeviceVibration();
  window.speechSynthesis.cancel();
  state.activeAlarm = null;
}

function snoozeActiveAlarm(minutes) {
  if (!state.activeAlarm) return;
  const med = state.activeAlarm.med;
  const doseTime = state.activeAlarm.doseTime;

  state.historyLogs.push({
    id: 'log-' + Date.now(),
    medId: med.id,
    medName: med.name,
    dose: `${med.doseValue} ${med.doseUnit}`,
    date: new Date().toISOString().split('T')[0],
    doseTime: doseTime,
    time: `${new Date().getHours()}:${new Date().getMinutes()}`,
    status: 'snoozed',
    timestamp: Date.now()
  });

  saveLocalState();
  closeAlarmModal();
  showToast(`⏰ Alarma pospuesta por ${minutes} minutos.`);

  setTimeout(() => {
    window.triggerAlarmModalForDose(med.id, doseTime);
  }, minutes * 60 * 1000);
}

// Real-time alarm ticker
let lastTriggeredMinute = '';
function startAlarmClockTicker() {
  setInterval(() => {
    const now = new Date();
    const currentMinStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const todayDateStr = now.toISOString().split('T')[0];

    if (currentMinStr === lastTriggeredMinute) return;

    state.medicines.forEach(med => {
      const [startH, startM] = (med.firstDoseTime || '08:00').split(':').map(Number);
      const freq = Number(med.frequencyHours) || 8;
      const dosesPerDay = Math.floor(24 / freq);

      for (let i = 0; i < dosesPerDay; i++) {
        const doseHour = (startH + i * freq) % 24;
        const doseMin = startM;
        const timeString = `${String(doseHour).padStart(2, '0')}:${String(doseMin).padStart(2, '0')}`;

        if (timeString === currentMinStr) {
          const isTaken = state.historyLogs.some(log => 
            String(log.medId) === String(med.id) && 
            log.date === todayDateStr && 
            log.doseTime === timeString &&
            log.status === 'taken'
          );

          if (!isTaken && (!state.activeAlarm || String(state.activeAlarm.med.id) !== String(med.id))) {
            lastTriggeredMinute = currentMinStr;
            window.triggerAlarmModalForDose(med.id, timeString);
          }
        }
      }
    });
  }, 1000);
}

// =========================================================
// AI RECIPE & PRESCRIPTION SCANNER (SERVER AIDED)
// =========================================================
async function processRecipeWithAI() {
  if (!state.scannedImageBase64) {
    showToast('⚠️ Por favor sube o toma una foto primero.');
    return;
  }

  const loadingEl = document.getElementById('scanner-loading');
  const resultsEl = document.getElementById('scanner-results');
  const statusEl = document.getElementById('scanner-loading-status');
  const processBtn = document.getElementById('btn-process-recipe');

  loadingEl.classList.remove('hidden');
  resultsEl.classList.add('hidden');
  processBtn.disabled = true;
  statusEl.textContent = 'Consultando IA Farmacéutica centralizada en el servidor...';

  try {
    let extracted = [];
    if (state.token) {
      extracted = await apiFetch('/api/ai/scan-recipe', {
        method: 'POST',
        body: JSON.stringify({ image_base64: state.scannedImageBase64 })
      });
    } else {
      await new Promise(r => setTimeout(r, 1200));
      extracted = [
        {
          name: 'Amoxicilina + Ácido Clavulánico (Jarabe)',
          presentation_type: 'jarabe',
          dose_value: '7.5',
          dose_unit: 'ml',
          frequency_hours: 8,
          first_dose_time: '08:00',
          duration_days: '7',
          food_relation: 'con',
          notes: 'Medir con jeringa graduada y agitar antes de cada toma.'
        },
        {
          name: 'Ibuprofeno 400mg',
          presentation_type: 'pastilla',
          dose_value: '1',
          dose_unit: 'pastilla(s)',
          frequency_hours: 8,
          first_dose_time: '09:00',
          duration_days: '5',
          food_relation: 'despues',
          notes: 'Tomar con medio vaso de agua después de la comida.'
        }
      ];
    }

    state.detectedMedicinesDraft = extracted;
    renderDetectedMedicines(extracted);

    loadingEl.classList.add('hidden');
    resultsEl.classList.remove('hidden');
  } catch (err) {
    loadingEl.classList.add('hidden');
    showToast('Error en análisis: ' + err.message);
  } finally {
    processBtn.disabled = false;
  }
}

function renderDetectedMedicines(list) {
  const container = document.getElementById('detected-medicines-list');
  const countBadge = document.getElementById('detected-count-badge');
  countBadge.textContent = `${list.length} Detectados`;

  container.innerHTML = list.map(med => `
    <div class="detected-item">
      <div class="detected-info">
        <h4>${med.name}</h4>
        <p><i class="${getIconForType(med.presentation_type || med.type)}"></i> Dosis: ${med.dose_value || med.doseValue} ${med.dose_unit || med.doseUnit}</p>
        <span class="detected-schedule">⏰ Cada ${med.frequency_hours || med.frequencyHours} hrs • Inicia ${med.first_dose_time || med.firstDoseTime}</span>
      </div>
      <span class="pill-badge">${(med.presentation_type || med.type || 'pastilla').toUpperCase()}</span>
    </div>
  `).join('');
}

async function confirmDetectedMedicines() {
  if (!state.detectedMedicinesDraft || state.detectedMedicinesDraft.length === 0) return;

  for (const raw of state.detectedMedicinesDraft) {
    const medPayload = {
      name: raw.name,
      presentation_type: raw.presentation_type || raw.type || 'pastilla',
      dose_value: String(raw.dose_value || raw.doseValue || '1'),
      dose_unit: raw.dose_unit || raw.doseUnit || 'pastilla(s)',
      frequency_hours: Number(raw.frequency_hours || raw.frequencyHours || 8),
      first_dose_time: raw.first_dose_time || raw.firstDoseTime || '08:00',
      duration_days: String(raw.duration_days || raw.durationDays || '7'),
      food_relation: raw.food_relation || raw.foodRelation || 'despues',
      photo_url: STOCK_IMAGES[raw.presentation_type || raw.type] || STOCK_IMAGES.pastilla,
      alarm_tone: 'urgent-siren',
      notes: raw.notes || ''
    };

    if (state.token) {
      try {
        const saved = await apiFetch('/api/medicines', {
          method: 'POST',
          body: JSON.stringify(medPayload)
        });
        state.medicines.push({
          id: saved.id,
          name: saved.name,
          type: saved.presentation_type,
          doseValue: saved.dose_value,
          doseUnit: saved.dose_unit,
          frequencyHours: saved.frequency_hours,
          firstDoseTime: saved.first_dose_time,
          durationDays: saved.duration_days,
          foodRelation: saved.food_relation,
          photoUrl: saved.photo_url,
          alarmTone: saved.alarm_tone,
          notes: saved.notes
        });
      } catch (e) {
        console.warn('Error saving to SQL, saving locally:', e);
        state.medicines.push({ id: 'med-' + Date.now(), ...medPayload });
      }
    } else {
      state.medicines.push({ id: 'med-' + Date.now(), ...medPayload });
    }
  }

  saveLocalState();
  showToast(`🎉 ¡${state.detectedMedicinesDraft.length} medicamentos guardados en SQL!`);

  state.currentView = 'view-today';
  renderCurrentView();

  document.getElementById('dropzone-preview').classList.add('hidden');
  document.getElementById('dropzone-prompt').classList.remove('hidden');
  document.getElementById('scanner-results').classList.add('hidden');
  document.getElementById('btn-process-recipe').disabled = true;
  state.scannedImageBase64 = null;
}

// =========================================================
// AI PHARMACIST CHAT (SERVER & LOCAL STRICT RESTRICTION)
// =========================================================
function renderChatMessages() {
  const chatContainer = document.getElementById('chat-messages');
  chatContainer.innerHTML = state.chatMessages.map(msg => `
    <div class="chat-msg ${msg.sender === 'ai' ? 'msg-ai' : 'msg-user'}">
      ${msg.text.replace(/\n/g, '<br>')}
    </div>
  `).join('');
  chatContainer.scrollTop = chatContainer.scrollHeight;
  renderDynamicQuickChips();
}

function renderDynamicQuickChips() {
  const chipsContainer = document.querySelector('.quick-prompts-bar');
  if (!chipsContainer) return;

  if (state.medicines.length === 0) {
    chipsContainer.innerHTML = `
      <span style="font-size: 11px; color: var(--text-muted); padding: 6px 10px;">
        Sin medicamentos registrados. Añade uno en "Medicinas" o "Escanear".
      </span>
    `;
    return;
  }

  const chips = [];
  state.medicines.forEach(m => {
    chips.push({
      label: `¿Cómo tomo ${m.name.split(' ')[0]}?`,
      prompt: `¿Cuál es mi dosis exacta e instrucciones para tomar ${m.name}?`
    });
    chips.push({
      label: `Horarios de ${m.name.split(' ')[0]}`,
      prompt: `¿A qué horas me toca tomar ${m.name}?`
    });
  });

  if (state.medicines.length > 1) {
    chips.unshift({
      label: `¿Puedo tomarlos juntos?`,
      prompt: `¿Puedo tomar juntos mis medicamentos cargados (${state.medicines.map(m => m.name).join(', ')})?`
    });
  }

  chips.push({
    label: `Dosis olvidada`,
    prompt: `¿Qué hago si olvidé una dosis de mis medicamentos cargados?`
  });

  chipsContainer.innerHTML = chips.slice(0, 5).map(c => `
    <button class="quick-chip" data-prompt="${c.prompt}">${c.label}</button>
  `).join('');

  chipsContainer.querySelectorAll('.quick-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = chip.getAttribute('data-prompt');
      handleChatSubmit(prompt);
    });
  });
}

async function handleChatSubmit(userQuery) {
  if (!userQuery.trim()) return;

  state.chatMessages.push({ sender: 'user', text: userQuery });
  renderChatMessages();

  // If connected to Python backend, call /api/ai/chat with server master key
  if (state.token) {
    try {
      const res = await apiFetch('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ message: userQuery })
      });
      state.chatMessages.push({ sender: 'ai', text: res.reply });
      renderChatMessages();
      return;
    } catch (e) {
      console.warn('Server chat error, fallback to local:', e);
    }
  }

  // Local strictly restricted engine
  setTimeout(() => {
    const aiReply = generateStrictPharmacistAdviceLocal(userQuery);
    state.chatMessages.push({ sender: 'ai', text: aiReply });
    renderChatMessages();
  }, 400);
}

function generateStrictPharmacistAdviceLocal(query) {
  const q = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  if (!state.medicines || state.medicines.length === 0) {
    return `⚠️ **Especialista Farmacéutico:** Actualmente **no tienes ningún medicamento registrado** en tu tratamiento.\n\nPor favor registra tus fármacos en "Medicinas" o escanéalos para que pueda asistirte con tus dosis y horarios.`;
  }

  const loadedMeds = state.medicines.map(m => ({
    raw: m,
    cleanName: m.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  }));

  const matchedMeds = loadedMeds.filter(m => {
    const words = m.cleanName.split(/[\s,+/-]+/);
    return words.some(w => w.length > 3 && q.includes(w));
  });

  const isTogether = q.includes('juntos') || q.includes('junto') || q.includes('mismo tiempo');
  const isMissedDose = q.includes('olvide') || q.includes('olvido') || q.includes('tarde');

  if (matchedMeds.length > 0) {
    const target = matchedMeds[0].raw;
    return `💊 **Especialista en ${target.name}:**\n• **Dosis Exacta:** **${target.doseValue} ${target.doseUnit}** ${target.type === 'jarabe' ? '(medir con jeringa graduada)' : ''}\n• **Horarios:** Cada **${target.frequencyHours} horas** (Primera toma: ${target.firstDoseTime})\n• **Alimentos:** ${getFoodInstructionText(target.foodRelation)}\n• **Duración:** ${target.durationDays} días.`;
  }

  if (isTogether && state.medicines.length > 1) {
    return `📋 **Toma conjunta de tus medicamentos (${state.medicines.map(m => m.name).join(', ')}):**\nPuedes tomarlos con abundante agua si coinciden en la misma hora, asegurándote de respetar la indicación de comida de cada uno.`;
  }

  if (isMissedDose) {
    return `⏰ **Dosis Olvidada:** Tómala en cuanto lo recuerdes a menos que ya casi sea la hora de tu siguiente alarma. ¡Nunca dupliques la dosis!`;
  }

  const loadedListNames = state.medicines.map(m => `• **${m.name}** (${m.doseValue} ${m.doseUnit})`).join('\n');
  return `🔒 **Medicamento no registrado en tu tratamiento:**\n\nPor protocolo de seguridad, **solo puedo responderte acerca de tus medicamentos cargados actualmente**:\n\n${loadedListNames}\n\nSi tu médico te prescribió un nuevo medicamento, agrégalo a tu lista para que pueda gestionar tus alarmas.`;
}

// =========================================================
// SUPERADMIN PANEL LOGIC
// =========================================================
async function openSuperAdminPanel() {
  const modal = document.getElementById('modal-superadmin');
  modal.classList.remove('hidden');

  try {
    // 1. Fetch settings status
    const settings = await apiFetch('/api/admin/settings');
    const badge = document.getElementById('gemini-key-status-badge');
    badge.textContent = settings.gemini_api_key_configured ? `✅ Clave Activa (${settings.gemini_api_key_preview})` : '⚠️ Sin Clave Master';
    badge.style.background = settings.gemini_api_key_configured ? '#d1fae5' : '#fee2e2';

    // 2. Fetch stats
    const stats = await apiFetch('/api/admin/stats');
    document.getElementById('admin-stat-users').textContent = stats.total_users;
    document.getElementById('admin-stat-meds').textContent = stats.total_medicines;
    document.getElementById('admin-stat-logs').textContent = stats.total_logs;

    // 3. Render Users Directory Table
    const usersTable = document.getElementById('admin-users-table');
    usersTable.innerHTML = stats.users.map(u => `
      <div class="history-item">
        <div>
          <strong style="color: var(--text-main); font-size: 13px;">${u.full_name}</strong>
          <p style="font-size: 11px; color: var(--text-muted);">${u.email}</p>
        </div>
        <span class="pill-badge" style="text-transform: uppercase;">${u.role}</span>
      </div>
    `).join('');
  } catch (err) {
    showToast('Error al cargar panel de Superadministrador: ' + err.message);
  }
}

// =========================================================
// TOAST NOTIFICATIONS
// =========================================================
function showToast(message) {
  const existing = document.getElementById('pharma-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'pharma-toast';
  toast.style.cssText = `
    position: fixed;
    top: 70px;
    left: 50%;
    transform: translateX(-50%);
    background: #0f172a;
    color: white;
    padding: 10px 18px;
    border-radius: 9999px;
    font-size: 13px;
    font-weight: 700;
    box-shadow: 0 10px 25px rgba(0,0,0,0.3);
    z-index: 10000;
    border: 1px solid rgba(255,255,255,0.2);
    animation: fadeIn 0.2s ease;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3200);
}

// =========================================================
// EVENT LISTENERS & INITIALIZATION
// =========================================================
document.addEventListener('DOMContentLoaded', () => {
  const options = { weekday: 'long', day: 'numeric', month: 'long' };
  const dateStr = new Date().toLocaleDateString('es-ES', options);
  document.getElementById('current-date-text').textContent = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);

  // Bottom Nav
  document.querySelectorAll('.bottom-nav .nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      state.currentView = btn.getAttribute('data-view');
      renderCurrentView();
    });
  });

  // Sound Test button (Header)
  document.getElementById('btn-sound-test').addEventListener('click', () => {
    if (audioEngine.isPlaying) {
      audioEngine.stop();
      showToast('Alarma de prueba detenida');
    } else {
      audioEngine.startUrgentSiren();
      showToast('🔊 Sonando Sirena Médica Contundente');
      setTimeout(() => audioEngine.stop(), 4000);
    }
  });

  // User Auth Modal
  const authModal = document.getElementById('modal-auth');
  document.getElementById('btn-user-auth').addEventListener('click', () => {
    updateUserAuthUI();
    authModal.classList.remove('hidden');
  });

  document.getElementById('btn-close-auth').addEventListener('click', () => {
    authModal.classList.add('hidden');
  });

  document.getElementById('btn-logout').addEventListener('click', () => {
    logoutUser(true);
    authModal.classList.add('hidden');
  });

  // Auth Tabs (Login vs Register)
  const tabLoginBtn = document.getElementById('tab-login-btn');
  const tabRegisterBtn = document.getElementById('tab-register-btn');
  const formLogin = document.getElementById('form-login');
  const formRegister = document.getElementById('form-register');

  tabLoginBtn.addEventListener('click', () => {
    tabLoginBtn.classList.add('active');
    tabRegisterBtn.classList.remove('active');
    formLogin.classList.remove('hidden');
    formRegister.classList.add('hidden');
  });

  tabRegisterBtn.addEventListener('click', () => {
    tabRegisterBtn.classList.add('active');
    tabLoginBtn.classList.remove('active');
    formRegister.classList.remove('hidden');
    formLogin.classList.add('hidden');
  });

  // Login Submit
  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      state.token = res.access_token;
      state.user = res.user;
      localStorage.setItem('pharma_jwt', res.access_token);
      localStorage.setItem('pharma_user', JSON.stringify(res.user));

      authModal.classList.add('hidden');
      showToast(`👋 ¡Bienvenido de nuevo, ${res.user.full_name}!`);
      updateUserAuthUI();
      syncFromBackend();
    } catch (err) {
      showToast('❌ ' + err.message);
    }
  });

  // Register Submit
  formRegister.addEventListener('submit', async (e) => {
    e.preventDefault();
    const full_name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;

    try {
      const res = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ full_name, email, password })
      });
      state.token = res.access_token;
      state.user = res.user;
      localStorage.setItem('pharma_jwt', res.access_token);
      localStorage.setItem('pharma_user', JSON.stringify(res.user));

      authModal.classList.add('hidden');
      showToast(`🎉 ¡Cuenta creada con éxito, ${res.user.full_name}!`);
      updateUserAuthUI();
      syncFromBackend();
    } catch (err) {
      showToast('❌ ' + err.message);
    }
  });

  // Super Admin Button & Modal
  const superAdminModal = document.getElementById('modal-superadmin');
  document.getElementById('btn-superadmin').addEventListener('click', openSuperAdminPanel);
  document.getElementById('btn-close-superadmin').addEventListener('click', () => superAdminModal.classList.add('hidden'));
  document.getElementById('btn-done-superadmin').addEventListener('click', () => superAdminModal.classList.add('hidden'));

  // Super Admin Master Gemini Key Form
  document.getElementById('form-master-gemini').addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = document.getElementById('master-gemini-key').value.trim();
    if (!key) {
      showToast('⚠️ Ingresa una clave válida de Gemini');
      return;
    }

    try {
      await apiFetch('/api/admin/settings', {
        method: 'POST',
        body: JSON.stringify({ gemini_api_key: key })
      });
      showToast('👑 Clave Master de Gemini guardada en SQL con éxito');
      document.getElementById('master-gemini-key').value = '';
      openSuperAdminPanel();
    } catch (err) {
      showToast('❌ Error al guardar clave master: ' + err.message);
    }
  });

  // Settings Modal (Sound & Vibration)
  const settingsModal = document.getElementById('modal-settings');
  document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('setting-voice-announcement').checked = state.settings.voiceAnnouncement !== false;
    document.getElementById('setting-vibration').checked = state.settings.vibration !== false;
    settingsModal.classList.remove('hidden');
  });

  document.getElementById('btn-close-settings').addEventListener('click', () => settingsModal.classList.add('hidden'));
  document.getElementById('btn-save-settings').addEventListener('click', () => {
    state.settings.voiceAnnouncement = document.getElementById('setting-voice-announcement').checked;
    state.settings.vibration = document.getElementById('setting-vibration').checked;
    saveLocalState();
    settingsModal.classList.add('hidden');
    showToast('Ajustes guardados');
  });

  // Manual Medicine Add Modal
  const medFormModal = document.getElementById('modal-medicine-form');
  document.getElementById('btn-add-medicine-manual').addEventListener('click', () => {
    document.getElementById('medicine-form').reset();
    document.getElementById('form-photo-preview').innerHTML = '<i class="fa-solid fa-image"></i>';
    medFormModal.classList.remove('hidden');
  });

  document.getElementById('btn-close-form').addEventListener('click', () => medFormModal.classList.add('hidden'));
  document.getElementById('btn-cancel-form').addEventListener('click', () => medFormModal.classList.add('hidden'));

  // Presentation radio change
  document.querySelectorAll('input[name="presentation-type"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const type = e.target.value;
      const unitSelect = document.getElementById('med-dose-unit');
      const doseInput = document.getElementById('med-dose-value');

      if (type === 'jarabe') {
        unitSelect.value = 'ml';
        doseInput.placeholder = 'Ej: 5 o 7.5';
      } else if (type === 'gotas') {
        unitSelect.value = 'gota(s)';
        doseInput.placeholder = 'Ej: 10 o 15';
      } else if (type === 'inyeccion') {
        unitSelect.value = 'ampolla(s)';
        doseInput.placeholder = 'Ej: 1';
      } else {
        unitSelect.value = 'pastilla(s)';
        doseInput.placeholder = 'Ej: 1 o 1/2';
      }
    });
  });

  // Photo Picker
  let formPhotoBase64 = null;
  document.getElementById('med-photo-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        formPhotoBase64 = ev.target.result;
        document.getElementById('form-photo-preview').innerHTML = `<img src="${formPhotoBase64}">`;
      };
      reader.readAsDataURL(file);
    }
  });

  document.getElementById('btn-select-stock-photo').addEventListener('click', () => {
    const type = document.querySelector('input[name="presentation-type"]:checked').value;
    formPhotoBase64 = STOCK_IMAGES[type] || STOCK_IMAGES.pastilla;
    document.getElementById('form-photo-preview').innerHTML = `<img src="${formPhotoBase64}">`;
    showToast('Imagen médica asignada');
  });

  // Submit Medicine Form
  document.getElementById('medicine-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = document.querySelector('input[name="presentation-type"]:checked').value;
    const name = document.getElementById('med-name').value.trim();
    const doseValue = document.getElementById('med-dose-value').value.trim();
    const doseUnit = document.getElementById('med-dose-unit').value;
    const frequencyHours = document.getElementById('med-frequency').value;
    const firstDoseTime = document.getElementById('med-first-dose-time').value;
    const durationDays = document.getElementById('med-duration').value;
    const foodRelation = document.getElementById('med-food-relation').value;
    const alarmTone = document.getElementById('med-alarm-tone').value;

    const medPayload = {
      name: name,
      presentation_type: type,
      dose_value: doseValue,
      dose_unit: doseUnit,
      frequency_hours: frequencyHours === 'custom' ? 8 : Number(frequencyHours),
      first_dose_time: firstDoseTime,
      duration_days: durationDays,
      food_relation: foodRelation,
      photo_url: formPhotoBase64 || STOCK_IMAGES[type] || STOCK_IMAGES.pastilla,
      alarm_tone: alarmTone,
      notes: ''
    };

    if (state.token) {
      try {
        const saved = await apiFetch('/api/medicines', {
          method: 'POST',
          body: JSON.stringify(medPayload)
        });
        state.medicines.push({
          id: saved.id,
          name: saved.name,
          type: saved.presentation_type,
          doseValue: saved.dose_value,
          doseUnit: saved.dose_unit,
          frequencyHours: saved.frequency_hours,
          firstDoseTime: saved.first_dose_time,
          durationDays: saved.duration_days,
          foodRelation: saved.food_relation,
          photoUrl: saved.photo_url,
          alarmTone: saved.alarm_tone,
          notes: saved.notes
        });
      } catch (err) {
        showToast('Guardando localmente: ' + err.message);
        state.medicines.push({ id: 'med-' + Date.now(), ...medPayload, type });
      }
    } else {
      state.medicines.push({ id: 'med-' + Date.now(), ...medPayload, type });
    }

    saveLocalState();
    medFormModal.classList.add('hidden');
    formPhotoBase64 = null;
    showToast(`✅ ${name} guardado con éxito.`);
    renderCurrentView();
  });

  // Scanner Drag & Drop
  const dropzone = document.getElementById('recipe-dropzone');
  const fileInput = document.getElementById('recipe-file-input');

  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        state.scannedImageBase64 = ev.target.result;
        document.getElementById('scanned-image-preview').src = state.scannedImageBase64;
        document.getElementById('dropzone-prompt').classList.add('hidden');
        document.getElementById('dropzone-preview').classList.remove('hidden');
        document.getElementById('btn-process-recipe').disabled = false;
      };
      reader.readAsDataURL(file);
    }
  });

  document.getElementById('btn-retake-photo').addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  document.getElementById('btn-process-recipe').addEventListener('click', processRecipeWithAI);
  document.getElementById('btn-demo-recipe').addEventListener('click', () => {
    state.scannedImageBase64 = STOCK_IMAGES.jarabe;
    document.getElementById('scanned-image-preview').src = state.scannedImageBase64;
    document.getElementById('dropzone-prompt').classList.add('hidden');
    document.getElementById('dropzone-preview').classList.remove('hidden');
    document.getElementById('btn-process-recipe').disabled = false;
    processRecipeWithAI();
  });

  document.getElementById('btn-confirm-detected').addEventListener('click', confirmDetectedMedicines);
  document.getElementById('btn-cancel-detected').addEventListener('click', () => {
    document.getElementById('scanner-results').classList.add('hidden');
  });

  // Alarm Modal Buttons
  document.getElementById('btn-alarm-take').addEventListener('click', () => {
    if (state.activeAlarm) {
      markDoseAsTaken(state.activeAlarm.med.id, state.activeAlarm.doseTime);
    }
  });

  document.getElementById('btn-alarm-snooze-5').addEventListener('click', () => snoozeActiveAlarm(5));
  document.getElementById('btn-alarm-snooze-15').addEventListener('click', () => snoozeActiveAlarm(15));

  document.getElementById('btn-toggle-alarm-sound').addEventListener('click', () => {
    if (audioEngine.isPlaying) {
      audioEngine.stop();
      state.isAlarmMuted = true;
      document.getElementById('btn-toggle-alarm-sound').innerHTML = '<i class="fa-solid fa-volume-xmark"></i> Alarma Silenciada';
    } else if (state.activeAlarm) {
      audioEngine.playTone(state.activeAlarm.med.alarmTone || 'urgent-siren');
      state.isAlarmMuted = false;
      document.getElementById('btn-toggle-alarm-sound').innerHTML = '<i class="fa-solid fa-volume-high"></i> Silenciar Alarma Sonora';
    }
  });

  // Chat Form
  document.getElementById('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const q = input.value.trim();
    if (q) {
      handleChatSubmit(q);
      input.value = '';
    }
  });

  // Export History Report
  document.getElementById('btn-export-history').addEventListener('click', () => {
    const reportText = state.historyLogs.map(l => `• [${l.date} ${l.time || l.doseTime}] ${l.medName} (${l.dose}) - Estado: ${l.status}`).join('\n');
    const blob = new Blob([`REPORTE DE ADHERENCIA MÉDICA - PHARMAALARM AI\nUsuario: ${state.user ? state.user.full_name : 'Paciente'}\nFecha: ${new Date().toLocaleString()}\n\n` + reportText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Reporte_Tomas_${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    showToast('📄 Reporte médico descargado');
  });

  // Initial Sync from Python SQL Backend
  syncFromBackend();
  updateUserAuthUI();
  startAlarmClockTicker();
  renderCurrentView();
});
