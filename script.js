// ============================================================
//  SISTEMA DE MONITOREO - CON SUPABASE
// ============================================================

if (typeof window.db === 'undefined') {
    console.error('❌ Error: window.db no está definido');
}

const db = window.db || {};
let inverters = [];
let dailyProductionByDate = {};
let dailyProductionByInverter = new Map();
let historicalReadingsByInverter = new Map();
let inverterStoppedForDate = new Map();
let inverterStoppedAt = new Map();
let productionCacheDate = null;
let usuarioActual = null;
const INVERTER_RECHECK_MS = 30 * 1000;
let alertasActivas = [];
let intervalId = null;
let alertasHistorico = [];
const DASHBOARD_CACHE_PREFIX = 'crode_dashboard_cache_';

const CRODE_TIME_ZONE = 'America/Cancun';

function getDashboardCacheKey() {
    return usuarioActual?.id ? `${DASHBOARD_CACHE_PREFIX}${usuarioActual.id}` : null;
}

function saveDashboardCache() {
    const cacheKey = getDashboardCacheKey();
    if (!cacheKey || !inverters.length) return;

    try {
        localStorage.setItem(cacheKey, JSON.stringify({
            savedAt: Date.now(),
            productionCacheDate,
            inverters,
            dailyProductionByDate,
            dailyProductionByInverter: Array.from(dailyProductionByInverter.entries()).map(([id, readings]) => [
                id,
                Array.from(readings.entries())
            ])
        }));
    } catch (error) {
        console.warn('No se pudo guardar la caché del dashboard:', error);
    }
}

function restoreDashboardCache() {
    const cacheKey = getDashboardCacheKey();
    if (!cacheKey) return false;

    try {
        const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
        if (!cached?.inverters?.length) return false;

        inverters = cached.inverters;
        productionCacheDate = cached.productionCacheDate || null;
        dailyProductionByDate = cached.dailyProductionByDate || {};
        dailyProductionByInverter = new Map((cached.dailyProductionByInverter || []).map(([id, readings]) => [
            id,
            new Map(readings)
        ]));
        console.log('📦 Datos anteriores restaurados mientras se actualiza el dashboard');
        return true;
    } catch (error) {
        localStorage.removeItem(cacheKey);
        console.warn('No se pudo restaurar la caché del dashboard:', error);
        return false;
    }
}

function parseSafeDate(value = new Date()) {
    if (!value) return new Date();
    if (value instanceof Date) return value;
    const str = String(value).trim();
    if (!str) return new Date();
    // Si no contiene indicador de zona horaria ('Z' o offset +HH:mm/-HH:mm),
    // agregamos 'Z' ya que Supabase/PostgreSQL almacena las lecturas en UTC.
    return !/[zZ]|[+-]\d{2}:?\d{2}$/.test(str) ? new Date(`${str}Z`) : new Date(str);
}

function getMexicoDateKey(value = new Date()) {
    const date = parseSafeDate(value);
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: CRODE_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date).reduce((result, part) => {
        if (part.type !== 'literal') result[part.type] = part.value;
        return result;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function getMexicoHour(value = new Date()) {
    const date = parseSafeDate(value);
    const hourStr = new Intl.DateTimeFormat('en-US', {
        timeZone: CRODE_TIME_ZONE,
        hour: '2-digit',
        hour12: false
    }).format(date);
    const hour = parseInt(hourStr, 10);
    return Number.isNaN(hour) ? 0 : hour % 24;
}

// ============================================================
//  VERIFICAR SESIÓN (CORREGIDO)
// ============================================================

function checkSession() {
    const session = window.CRODE_SESSION && typeof window.CRODE_SESSION.getUser === 'function'
        ? window.CRODE_SESSION.getUser()
        : null;

    if (!session) {
        if (window.CRODE_SESSION && typeof window.CRODE_SESSION.clear === 'function') {
            window.CRODE_SESSION.clear();
        }
        window.location.href = 'index.html';
        return false;
    }

    if (session.rol === 'admin') {
        window.location.href = 'admin/admin.html';
        return false;
    }

    usuarioActual = session;
    const userNameEl = document.getElementById('userName');
    const userRoleEl = document.getElementById('userRole');
    const userAvatarEl = document.getElementById('userAvatar');

    if (userNameEl) userNameEl.textContent = session.nombre;
    if (userRoleEl) {
        const roleText = session.rol ? session.rol.charAt(0).toUpperCase() + session.rol.slice(1) : 'Técnico';
        userRoleEl.textContent = roleText;
    }
    if (userAvatarEl) {
        const initials = (session.nombre || 'US').split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
        userAvatarEl.textContent = initials;
    }
    return true;
}

// ============================================================
//  ADMIN - CERRAR SESIÓN (CORREGIDO)
// ============================================================

document.getElementById('logoutBtn')?.addEventListener('click', function() {
    if (confirm('¿Cerrar sesión?')) {
        if (window.CRODE_SESSION && typeof window.CRODE_SESSION.clear === 'function') {
            window.CRODE_SESSION.clear();
        }
        window.location.href = 'index.html';
    }
});

// ============================================================
//  CARGAR INVERSORES
// ============================================================

async function loadInverters() {
    try {
        let data;
        if (!usuarioActual) return [];

        const currentDateKey = getMexicoDateKey();
        if (productionCacheDate !== currentDateKey) {
            productionCacheDate = currentDateKey;
            inverterStoppedForDate.clear();
            inverterStoppedAt.clear();
            dailyProductionByInverter.clear();
        }
        
        if (usuarioActual.rol === 'admin') {
            data = await db.getAllInversores();
        } else {
            data = await db.getInversoresByUsuario(usuarioActual.id);
        }
        
        const previousInverters = new Map(inverters.map(inverter => [inverter.id, inverter]));
        inverters = data.map(inv => ({
            ...(previousInverters.get(inv.id) || {}),
            id: inv.id,
            nombre: inv.nombre,
            marca: inv.marca,
            modelo: inv.modelo || 'No especificado',
            ubicacion: inv.ubicacion || 'No especificada',
            potencia: previousInverters.get(inv.id)?.potencia || 0,
            energiaHoy: previousInverters.get(inv.id)?.energiaHoy || 0,
            estado: inv.estado || 'offline',
            apiStatus: inv.api_status || 'pending',
            apiLastSync: inv.api_last_sync || null,
            apiLastError: inv.api_last_error || null,
            apiUrl: inv.api_url || null,
            plantId: inv.plant_id || null,
            deviceSerial: inv.device_serial || null,
            apiToken: inv.api_token || null
        }));
        
        await Promise.all(inverters.map(async (inv) => {
            try {
                const stoppedAt = inverterStoppedAt.get(inv.id);
                const stoppedForToday = inverterStoppedForDate.get(inv.id) === currentDateKey;
                if (!(stoppedForToday && stoppedAt && Date.now() - stoppedAt < INVERTER_RECHECK_MS)) {
                    const ultima = await db.getUltimaLectura(inv.id);
                    if (ultima) {
                        // Si el inversor está marcado como offline en BD, conservar offline y potencia 0
                        if (inv.estado === 'offline') {
                            inv.potencia = 0;
                        } else {
                            inv.potencia = Number(ultima.potencia_ac) || 0;
                            inv.estado = ultima.estado_operativo || inv.estado;
                        }
                        inv.energiaHoy = Number(ultima.energia_dia) || 0;

                        const lastReadingDate = getMexicoDateKey(ultima.timestamp);
                        if (lastReadingDate === currentDateKey && inv.estado === 'offline') {
                            inverterStoppedForDate.set(inv.id, currentDateKey);
                            inverterStoppedAt.set(inv.id, Date.now());
                        } else if (inv.estado !== 'offline') {
                            inverterStoppedForDate.delete(inv.id);
                            inverterStoppedAt.delete(inv.id);
                        }
                    }

                    // Evaluar reglas de alertas automáticas (A, B, C)
                    if (typeof db.evaluarAlertasInversor === 'function') {
                        await db.evaluarAlertasInversor(inv, ultima);
                    }
                }

                if (typeof db.getLecturasByInversor === 'function') {
                    // Cargar hasta 3000 lecturas para abarcar meses anteriores (ej. Septiembre y Octubre)
                    const lecturas = await db.getLecturasByInversor(inv.id, 3000);
                    historicalReadingsByInverter.set(inv.id, lecturas || []);
                    const latestReadingByDate = new Map();
                    (lecturas || []).forEach(lectura => {
                        if (!lectura.timestamp) return;
                        const dateKey = getMexicoDateKey(lectura.timestamp);
                        const energy = Number(lectura.energia_dia || 0);
                        const cur = latestReadingByDate.get(dateKey) || 0;
                        if (energy > cur || !latestReadingByDate.has(dateKey)) {
                            latestReadingByDate.set(dateKey, energy);
                        }
                    });
                    dailyProductionByInverter.set(inv.id, latestReadingByDate);
                }
            } catch (e) {
                console.warn(`⚠️ No se pudo cargar lectura para ${inv.nombre}`, e);
            }
        }));

        dailyProductionByDate = {};
        dailyProductionByInverter.forEach(readingsByDate => {
            readingsByDate.forEach((energy, dateKey) => {
                dailyProductionByDate[dateKey] = (dailyProductionByDate[dateKey] || 0) + energy;
            });
        });

        saveDashboardCache();
        console.log(`✅ ${inverters.length} inversores cargados para ${usuarioActual.nombre}`);
        return inverters;
    } catch (error) {
        console.error('❌ Error al cargar inversores:', error);
        return [];
    }
}

// ============================================================
//  FUNCIONES DE RENDERIZADO
// ============================================================

function getStatusBadge(status) {
    const map = {
        online: '<span class="status-badge"><span class="dot online"></span> Online</span>',
        warning: '<span class="status-badge"><span class="dot warning"></span> Advertencia</span>',
        offline: '<span class="status-badge"><span class="dot offline"></span> Offline</span>'
    };
    return map[status] || status;
}

function renderDashboardKPIs() {
    const total = inverters.length;
    const online = inverters.filter(i => i.estado === 'online').length;
    const totalPower = inverters.reduce((s, i) => s + i.potencia, 0);
    const totalEnergy = inverters.reduce((s, i) => s + i.energiaHoy, 0);

    document.getElementById('totalInverters').textContent = total;
    document.getElementById('totalPower').innerHTML = `${totalPower.toFixed(1)} <small>kW</small>`;
    document.getElementById('totalEnergy').innerHTML = `${totalEnergy.toFixed(0)} <small>kWh</small>`;
    document.getElementById('activeCount').innerHTML = `${online} <small>/ ${total}</small>`;
    
    const fill = document.querySelector('.progress-fill');
    if (fill) fill.style.width = total > 0 ? `${(online / total) * 100}%` : '0%';
}

function renderDashboardTable() {
    const tbody = document.getElementById('inverterTableBody');
    if (!tbody) return;

    const totalPower = inverters.reduce((s, i) => s + i.potencia, 0);
    const totalEnergy = inverters.reduce((s, i) => s + i.energiaHoy, 0);

    let html = inverters.map((inv, i) => `
        <tr>
            <td>${i + 1}</td>
            <td><strong>${inv.nombre}</strong></td>
            <td><span class="brand-badge ${inv.marca.toLowerCase()}">${inv.marca}</span></td>
            <td>${inv.potencia.toFixed(1)} kW</td>
            <td>${inv.energiaHoy.toFixed(1)} kWh</td>
            <td>${getStatusBadge(inv.estado)}</td>
        </tr>
    `).join('');

    html += `
        <tr class="table-total-row">
            <td colspan="3" class="total-label">TOTAL</td>
            <td class="total-power">${totalPower.toFixed(1)} kW</td>
            <td class="total-energy">${totalEnergy.toFixed(1)} kWh</td>
            <td></td>
        </tr>
    `;

    tbody.innerHTML = html;
}

function renderFullInverterTable() {
    const tbody = document.getElementById('inverterFullTableBody');
    if (!tbody) return;

    const brandFilter = document.getElementById('filterBrand')?.value || 'all';
    const statusFilter = document.getElementById('filterStatus')?.value || 'all';
    const searchTerm = document.getElementById('searchInverter')?.value?.toLowerCase() || '';

    let filtered = inverters.filter(inv => {
        const matchSearch = inv.nombre.toLowerCase().includes(searchTerm);
        const matchBrand = brandFilter === 'all' || inv.marca === brandFilter;
        const matchStatus = statusFilter === 'all' || inv.estado === statusFilter;
        return matchSearch && matchBrand && matchStatus;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#64748b; padding:30px;">No se encontraron inversores.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map((inv, i) => `
        <tr>
            <td>${i + 1}</td>
            <td><strong>${inv.nombre}</strong></td>
            <td><span class="brand-badge ${inv.marca.toLowerCase()}">${inv.marca}</span></td>
            <td>${inv.modelo}</td>
            <td>${inv.ubicacion}</td>
            <td>${getStatusBadge(inv.estado)}</td>
            <td>
                <button class="btn-outline" style="padding:4px 10px; font-size:12px;" onclick="viewInverter('${inv.id}')"><i class="fas fa-eye"></i></button>
            </td>
        </tr>
    `).join('');
}

// ============================================================
//  ACCIONES
// ============================================================

window.viewInverter = function(id) {
    const inv = inverters.find(i => i.id === id);
    if (!inv) return;
    alert(`📋 Detalle de ${inv.nombre}\nMarca: ${inv.marca}\nModelo: ${inv.modelo}\nUbicación: ${inv.ubicacion}\nPotencia: ${inv.potencia} kW\nEnergía Hoy: ${inv.energiaHoy} kWh\nEstado: ${inv.estado}`);
};

window.resolverAlertaUI = async function(id) {
    if (confirm('¿Marcar esta alerta como resuelta?')) {
        try {
            await db.resolverAlerta(id, usuarioActual?.id);
            await loadAlertas();
            renderDashboardAlerts();
            renderAlertas();
            renderDashboardKPIs();
            console.log('✅ Alerta resuelta');
        } catch (error) {
            console.error('❌ Error al resolver alerta:', error);
            alert('Error al resolver la alerta');
        }
    }
};

function escapeAlertText(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[character]));
}

function getAlertTagHtml(tipo) {
    const raw = String(tipo || 'Sistema').trim();
    const normalized = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    let icon = 'fa-exclamation-circle';
    let cls = 'tag-sistema';

    if (normalized.includes('conex') || normalized.includes('offline')) {
        icon = 'fa-network-wired';
        cls = 'tag-conexion';
    } else if (normalized.includes('api')) {
        icon = 'fa-server';
        cls = 'tag-api';
    } else if (normalized.includes('rend') || normalized.includes('potencia')) {
        icon = 'fa-chart-line';
        cls = 'tag-rendimiento';
    } else if (normalized.includes('temp')) {
        icon = 'fa-temperature-high';
        cls = 'tag-temperatura';
    }

    return `<span class="alert-tag ${cls}"><i class="fas ${icon}"></i> ${escapeAlertText(raw)}</span>`;
}

function getInverterName(inverterId) {
    return inverters.find(inverter => inverter.id === inverterId)?.nombre || inverterId || 'Inversor desconocido';
}

function renderDashboardAlerts() {
    const list = document.getElementById('alertsList');
    if (!list) return;

    if (!alertasActivas.length) {
        list.innerHTML = `
            <li class="success" style="padding:12px 14px;">
                <i class="fas fa-check-circle" style="color:#16a34a;font-size:16px;"></i>
                <div style="display:flex;flex-direction:column;gap:2px;">
                    <strong style="color:#15803d;">Planta operando con normalidad</strong>
                    <span style="color:#4b5563;font-size:12px;">Todos los inversores reportan sincronización sin incidencias activas.</span>
                </div>
            </li>`;
        return;
    }

    list.innerHTML = alertasActivas.slice(0, 5).map(alerta => {
        const isCritical = ['conexión', 'temperatura'].some(c => (alerta.tipo || '').toLowerCase().includes(c));
        const timeStr = alerta.fecha ? new Date(alerta.fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '';
        return `
            <li class="${isCritical ? 'danger' : ''}" style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:10px 14px;">
                <div style="display:flex;flex-direction:column;gap:4px;flex:1;">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                        <strong>${escapeAlertText(getInverterName(alerta.inversor_id))}</strong>
                        ${getAlertTagHtml(alerta.tipo)}
                    </div>
                    <span style="color:#334155;font-size:12.5px;">${escapeAlertText(alerta.mensaje || alerta.tipo || 'Alerta activa')}</span>
                </div>
                <span style="font-size:11px;color:#64748b;white-space:nowrap;margin-top:2px;">${timeStr}</span>
            </li>`;
    }).join('');
}

function renderAlertas() {
    const activeBody = document.getElementById('alertasActivasBody');
    const historyBody = document.getElementById('alertasHistoricoBody');

    const renderRow = (alerta, active) => {
        const dateFormatted = alerta.fecha ? new Date(alerta.fecha).toLocaleString('es-MX') : 'Sin fecha';
        const resolutionNote = alerta.resuelta_por 
            ? '<span class="status-badge" style="color:#0284c7;"><span class="dot" style="background:#0284c7;"></span> Resuelta manual (Técnico)</span>'
            : '<span class="status-badge" style="color:#16a34a;"><span class="dot online"></span> Auto-resuelta (Sistema)</span>';

        return `
            <tr>
                <td><strong>${escapeAlertText(getInverterName(alerta.inversor_id))}</strong></td>
                <td>${getAlertTagHtml(alerta.tipo)}</td>
                <td>${escapeAlertText(alerta.mensaje || 'Sin descripción')}</td>
                <td><small style="color:#64748b;">${escapeAlertText(dateFormatted)}</small></td>
                ${active
                    ? `<td><button class="btn-outline" style="padding:4px 10px;font-size:12px;" onclick="resolverAlertaUI('${escapeAlertText(alerta.id)}')"><i class="fas fa-check"></i> Resolver</button></td>`
                    : `<td>${resolutionNote}</td>`}
            </tr>`;
    };

    if (activeBody) {
        activeBody.innerHTML = alertasActivas.length
            ? alertasActivas.map(alerta => renderRow(alerta, true)).join('')
            : '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:26px;"><i class="fas fa-check-circle" style="color:#16a34a;margin-right:6px;"></i> No hay alertas activas.</td></tr>';
    }
    if (historyBody) {
        historyBody.innerHTML = alertasHistorico.length
            ? alertasHistorico.map(alerta => renderRow(alerta, false)).join('')
            : '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:26px;">No hay alertas en el histórico.</td></tr>';
    }
}

// ============================================================
//  REGLAS DE MONITOREO (Configurables)
// ============================================================

const DEFAULT_MONITORING_RULES = [
    {
        id: 'rule-offline',
        nombre: 'Inversor Fuera de Línea',
        condicion: 'Estado == "offline" o sin telemetría',
        accion: 'Crear Alerta [Conexión]',
        estado: 'Activa'
    },
    {
        id: 'rule-api',
        nombre: 'Falla Sincronización API',
        condicion: 'api_status == "error" o timeout de red',
        accion: 'Crear Alerta [API]',
        estado: 'Activa'
    },
    {
        id: 'rule-potencia',
        nombre: 'Generación Nula Diurna',
        condicion: 'Horario solar (09:00 - 17:00) y Potencia <= 0.01 kW',
        accion: 'Crear Alerta [Rendimiento]',
        estado: 'Activa'
    },
    {
        id: 'rule-temperatura',
        nombre: 'Sobrecalentamiento Crítico',
        condicion: 'Temperatura interna >= 70 °C',
        accion: 'Crear Alerta [Temperatura]',
        estado: 'Activa'
    },
    {
        id: 'rule-autoresolve',
        nombre: 'Auto-resolución al Restablecer',
        condicion: 'Inversor recupera estado "online" y genera energía',
        accion: 'Cerrar Alerta activa automáticamente',
        estado: 'Activa'
    }
];

function getStoredRules() {
    try {
        const stored = localStorage.getItem('crode_monitoring_rules');
        return stored ? JSON.parse(stored) : DEFAULT_MONITORING_RULES;
    } catch {
        return DEFAULT_MONITORING_RULES;
    }
}

function saveStoredRules(rules) {
    try {
        localStorage.setItem('crode_monitoring_rules', JSON.stringify(rules));
    } catch (e) {
        console.warn('Error al guardar reglas en localStorage:', e);
    }
}

function renderReglas() {
    const tbody = document.getElementById('reglasBody');
    if (!tbody) return;

    const rules = getStoredRules();
    tbody.innerHTML = rules.map((r, idx) => {
        const isActive = r.estado === 'Activa';
        return `
            <tr>
                <td><strong>#${idx + 1}</strong></td>
                <td><strong>${escapeAlertText(r.nombre)}</strong></td>
                <td><code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:12px;">${escapeAlertText(r.condicion)}</code></td>
                <td><span class="status-badge" style="color:#2563eb;">${escapeAlertText(r.accion)}</span></td>
                <td>
                    <span class="status-badge ${isActive ? 'online' : 'offline'}">
                        <span class="dot ${isActive ? 'online' : 'offline'}"></span> ${r.estado}
                    </span>
                </td>
                <td>
                    <button class="btn-outline" style="padding:3px 8px;font-size:11px;" onclick="window.toggleReglaUI('${escapeAlertText(r.id)}')">
                        ${isActive ? '<i class="fas fa-pause"></i> Pausar' : '<i class="fas fa-play"></i> Activar'}
                    </button>
                </td>
            </tr>`;
    }).join('');
}

window.toggleReglaUI = function(ruleId) {
    const rules = getStoredRules();
    const rule = rules.find(r => r.id === ruleId);
    if (rule) {
        rule.estado = rule.estado === 'Activa' ? 'Pausada' : 'Activa';
        saveStoredRules(rules);
        renderReglas();
    }
};

async function loadAlertas() {
    if (!db || typeof db.getAlertasActivas !== 'function' || typeof db.getAllAlertas !== 'function') {
        throw new Error('Las funciones de alertas no están disponibles.');
    }
    const [active, history] = await Promise.all([
        usuarioActual?.rol === 'admin'
            ? db.getAlertasActivas()
            : db.getAlertasActivas(usuarioActual?.id),
        usuarioActual?.rol === 'admin'
            ? db.getAllAlertas()
            : db.getAllAlertas(usuarioActual?.id)
    ]);
    const assignedIds = new Set(inverters.map(inverter => inverter.id));
    alertasActivas = (active || []).filter(alerta => assignedIds.has(alerta.inversor_id) && !alerta.resuelta);
    // Histórico: solo alertas resueltas para diferenciar claramente de las activas
    alertasHistorico = (history || []).filter(alerta => assignedIds.has(alerta.inversor_id) && alerta.resuelta);

    renderAlertas();
    renderDashboardAlerts();
    renderReglas();
}

// ============================================================
//  CLIMA Y RADIACIÓN
// ============================================================

const weatherConfig = (window.APP_CONFIG && window.APP_CONFIG.weather) || {};
const OPENWEATHER_API_KEY = weatherConfig.openWeatherApiKey || '';
const SOLCAST_API_KEY = weatherConfig.solcastApiKey || '';
const SOLCAST_SITE_ID = weatherConfig.solcastSiteId || '';
const CRODE_LAT = Number(weatherConfig.latitude || 20.967);
const CRODE_LON = Number(weatherConfig.longitude || -89.592);

function generateMockWeather() {
    const now = new Date();
    const hour = now.getHours();
    const baseTemp = 29 + Math.sin((hour - 12) / 6) * 8;
    return {
        temperatura: Number(baseTemp.toFixed(1)),
        sensacion_termica: Number((baseTemp + 2).toFixed(1)),
        humedad: 55 + ((hour % 7) * 3),
        presion: 1012,
        clima: 'Parcialmente nublado',
        icono: (hour >= 6 && hour <= 18) ? '02d' : '02n',
        viento: 4.5,
        nubes: 35,
        ciudad: 'Mérida',
        pais: 'MX'
    };
}

function generateMockRadiation() {
    const now = new Date();
    const hour = now.getHours();
    let maxRadiation = 0;
    if (hour >= 6 && hour <= 18) {
        const peakHour = 12;
        const factor = 1 - Math.pow((hour - peakHour) / 8, 2);
        maxRadiation = Math.round(1000 * Math.max(0, factor));
    }
    return {
        radiacion: maxRadiation,
        dni: Math.round(maxRadiation * 0.8),
        dhi: Math.round(maxRadiation * 0.2),
        timestamp: now.toISOString(),
        source: 'Simulado'
    };
}

async function fetchWeatherData() {
    if (!OPENWEATHER_API_KEY) {
        console.warn('⚠️ No hay API key de OpenWeather configurada; usando clima simulado.');
        return generateMockWeather();
    }

    try {
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${CRODE_LAT}&lon=${CRODE_LON}&appid=${OPENWEATHER_API_KEY}&units=metric&lang=es`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.cod !== 200) throw new Error(`OpenWeatherMap error: ${data.message}`);
        return {
            temperatura: data.main.temp,
            sensacion_termica: data.main.feels_like,
            humedad: data.main.humidity,
            presion: data.main.pressure,
            clima: data.weather[0].description,
            icono: data.weather[0].icon,
            viento: data.wind.speed,
            nubes: data.clouds.all,
            ciudad: data.name,
            pais: data.sys.country
        };
    } catch (error) {
        console.error('❌ Error al obtener clima:', error.message);
        return generateMockWeather();
    }
}

async function fetchSolarRadiation() {
    if (!SOLCAST_API_KEY || !SOLCAST_SITE_ID) {
        console.warn('⚠️ No hay configuración de Solcast; usando radiación simulada.');
        return generateMockRadiation();
    }

    try {
        const url = `https://api.solcast.com.au/rooftop_sites/${SOLCAST_SITE_ID}/forecasts?api_key=${SOLCAST_API_KEY}&format=json`;
        const response = await fetch(url);
        const data = await response.json();
        if (!data.forecasts || data.forecasts.length === 0) throw new Error('No se recibieron datos de radiación');
        const latest = data.forecasts[0];
        return {
            radiacion: latest.ghi,
            dni: latest.dni,
            dhi: latest.dhi,
            timestamp: latest.period_end,
            source: 'Solcast'
        };
    } catch (error) {
        console.error('❌ Error al obtener radiación solar:', error.message);
        return generateMockRadiation();
    }
}

async function fetchAllWeatherData() {
    console.log('🌤️ Obteniendo datos climáticos...');
    const [weather, radiation] = await Promise.all([fetchWeatherData(), fetchSolarRadiation()]);
    const result = {
        weather: weather || { temperatura: '--', sensacion_termica: '--', humedad: '--', clima: 'No disponible', icono: '01d', viento: '--', ciudad: 'Mérida', pais: 'MX' },
        radiation: radiation || { radiacion: '--', timestamp: new Date().toISOString(), source: 'No disponible' }
    };
    try { localStorage.setItem('weatherData', JSON.stringify({ ...result, lastUpdated: new Date().toISOString() })); } catch (e) {}
    return result;
}

function renderWeatherWidget(weatherData) {
    const widget = document.getElementById('weatherWidget');
    if (!widget) return;
    const weather = weatherData.weather;
    const radiation = weatherData.radiation;
    const iconMap = {
        '01d': 'fa-sun', '01n': 'fa-moon', '02d': 'fa-cloud-sun', '02n': 'fa-cloud-moon',
        '03d': 'fa-cloud', '03n': 'fa-cloud', '04d': 'fa-cloud', '04n': 'fa-cloud',
        '09d': 'fa-cloud-rain', '09n': 'fa-cloud-rain', '10d': 'fa-cloud-sun-rain',
        '10n': 'fa-cloud-moon-rain', '11d': 'fa-cloud-sun', '11n': 'fa-cloud-moon',
        '13d': 'fa-snowflake', '13n': 'fa-snowflake', '50d': 'fa-smog', '50n': 'fa-smog'
    };
    const iconClass = iconMap[weather.icono] || 'fa-sun';
    const radiationText = radiation.radiacion !== '--' ? `${Math.round(radiation.radiacion)} W/m²` : '-- W/m²';
    const sourceText = radiation.source ? `(fuente: ${radiation.source})` : '';
    widget.innerHTML = `
        <div class="weather-card">
            <div class="weather-header">
                <h4><i class="fas fa-cloud-sun"></i> Clima en ${weather.ciudad}</h4>
                <span class="weather-time">${new Date().toLocaleTimeString()}</span>
            </div>
            <div class="weather-body">
                <div class="weather-main">
                    <i class="fas ${iconClass} weather-icon"></i>
                    <div class="weather-temp">
                        <span class="temp-value">${Math.round(weather.temperatura)}°C</span>
                        <span class="temp-desc">${weather.clima}</span>
                    </div>
                </div>
                <div class="weather-details">
                    <div class="weather-detail"><i class="fas fa-sun"></i><span>Radiación: ${radiationText}</span><span style="font-size:10px;color:var(--text-secondary);margin-left:4px;">${sourceText}</span></div>
                    <div class="weather-detail"><i class="fas fa-droplet"></i><span>Humedad: ${weather.humedad}%</span></div>
                    <div class="weather-detail"><i class="fas fa-wind"></i><span>Viento: ${weather.viento} m/s</span></div>
                    <div class="weather-detail"><i class="fas fa-thermometer-half"></i><span>Sensación: ${Math.round(weather.sensacion_termica)}°C</span></div>
                </div>
            </div>
        </div>
    `;
}

async function initWeatherWidget() {
    const cached = localStorage.getItem('weatherData');
    if (cached) {
        try {
            const parsed = JSON.parse(cached);
            const cacheAge = Date.now() - new Date(parsed.lastUpdated).getTime();
            if (cacheAge < 5 * 60 * 1000) {
                renderWeatherWidget(parsed);
                console.log('🌤️ Clima cargado desde caché');
                return;
            }
        } catch (e) {}
    }
    const weatherData = await fetchAllWeatherData();
    if (weatherData) renderWeatherWidget(weatherData);
}

function startWeatherUpdates() {
    setInterval(async () => {
        const weatherData = await fetchAllWeatherData();
        if (weatherData) renderWeatherWidget(weatherData);
    }, 5 * 60 * 1000);
}

// ============================================================
//  GRÁFICAS CON CHART.JS
// ============================================================

let weeklyChartInstance = null;
let inverterChartInstance = null;
let statsChartInstance = null;

function buildWeeklyProductionData() {
    const days = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    const data = Array(days.length).fill(0);
    const todayKey = getMexicoDateKey();
    const today = new Date(`${todayKey}T12:00:00Z`);
    const monday = new Date(today);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));

    data.forEach((_, index) => {
        const date = new Date(monday);
        date.setUTCDate(monday.getUTCDate() + index);
        const dateKey = date.toISOString().slice(0, 10);
        if (dateKey > todayKey) return;
        const value = Number(dailyProductionByDate[dateKey] || 0);
        data[index] = Number(value.toFixed(1));
    });

    return { labels: days, data };
}

function formatChartLabel(label, maxLength = 10) {
    const text = String(label ?? '').trim();
    if (!text) return '';

    if (text.length <= maxLength) return text;

    const keepLength = Math.max(3, maxLength - 1);
    return `${text.slice(0, keepLength).trimEnd()}…`;
}

function adjustInverterChartWidth(itemCount) {
    const wrapper = document.getElementById('inverterChartWrapper');
    const container = wrapper ? wrapper.parentElement : null;
    if (!wrapper || !container) return;

    const count = Math.max(1, Number(itemCount) || 0);
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
        // En celular: responsivo sin scroll horizontal
        wrapper.style.width = '100%';
        wrapper.style.minWidth = '100%';
        container.style.overflowX = 'hidden';
    } else {
        // En tablet y computadora: scroll horizontal si hay muchos inversores
        container.style.overflowX = 'auto';
        const minBarWidth = 90;
        const yAxisWidth = 60;
        const neededWidth = (count * minBarWidth) + yAxisWidth;
        const containerWidth = container.clientWidth || 600;

        if (neededWidth > containerWidth) {
            wrapper.style.width = `${neededWidth}px`;
            wrapper.style.minWidth = `${neededWidth}px`;
        } else {
            wrapper.style.width = '100%';
            wrapper.style.minWidth = '100%';
        }
    }
}

function enableDragToScroll(container) {
    if (!container || container.dataset.dragEnabled) return;
    container.dataset.dragEnabled = 'true';
    let isDown = false;
    let startX = 0;
    let scrollLeft = 0;

    // Arrastre con Mouse (Escritorio / Laptop)
    container.addEventListener('mousedown', (e) => {
        isDown = true;
        container.classList.add('dragging');
        startX = e.pageX - container.offsetLeft;
        scrollLeft = container.scrollLeft;
    });

    window.addEventListener('mouseup', () => {
        if (!isDown) return;
        isDown = false;
        container.classList.remove('dragging');
    });

    container.addEventListener('mouseleave', () => {
        if (!isDown) return;
        isDown = false;
        container.classList.remove('dragging');
    });

    container.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - container.offsetLeft;
        const walk = (x - startX) * 1.5;
        container.scrollLeft = scrollLeft - walk;
    });

    // Desplazamiento táctil (Celulares y Tablets)
    let touchStartX = 0;
    let touchStartY = 0;
    let touchScrollLeft = 0;
    let isHorizontalGesture = false;

    container.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchScrollLeft = container.scrollLeft;
        isHorizontalGesture = false;
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
        if (e.touches.length !== 1) return;
        const currentX = e.touches[0].clientX;
        const currentY = e.touches[0].clientY;
        const deltaX = currentX - touchStartX;
        const deltaY = currentY - touchStartY;

        if (!isHorizontalGesture) {
            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 6) {
                isHorizontalGesture = true;
            }
        }

        if (isHorizontalGesture) {
            container.scrollLeft = touchScrollLeft - deltaX;
            if (e.cancelable) {
                e.preventDefault();
            }
        }
    }, { passive: false });
}

function initDashboardCharts() {
    console.log('📊 Inicializando gráficas...');
    if (typeof Chart === 'undefined') {
        console.error('❌ Chart.js no está cargado. Esperando...');
        setTimeout(initDashboardCharts, 500);
        return;
    }
    const canvas1 = document.getElementById('inverterChart');
    const canvas2 = document.getElementById('weeklyChart');
    if (!canvas1 || !canvas2) {
        console.error('❌ No se encontraron los canvas para las gráficas');
        return;
    }

    const isDark = document.body.classList.contains('dark-mode');
    const chartTextColor = isDark ? '#94a3b8' : '#475569';
    const chartGridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(148, 163, 184, 0.18)';
    const chartTitleColor = isDark ? '#cbd5e1' : '#475569';

    try {
        if (inverterChartInstance) { inverterChartInstance.destroy(); inverterChartInstance = null; }
        const ctx1 = canvas1.getContext('2d');
        const sorted = [...inverters].sort((a, b) => b.energiaHoy - a.energiaHoy);
        const inverterLabels = sorted.length ? sorted.map(i => i.nombre) : ['Sin datos'];
        const inverterData = sorted.length ? sorted.map(i => Number(i.energiaHoy) || 0) : [0];
        const colors = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899'];

        const isMobile = window.innerWidth <= 768;
        adjustInverterChartWidth(sorted.length);
        if (!isMobile) {
            enableDragToScroll(document.querySelector('.chart-scroll-container'));
        }

        inverterChartInstance = new Chart(ctx1, {
            type: 'bar',
            data: {
                labels: inverterLabels,
                datasets: [{
                    label: 'Energía Hoy (kWh)',
                    data: inverterData,
                    backgroundColor: inverterLabels.map((_, index) => colors[index % colors.length]),
                    borderColor: 'rgba(255,255,255,0.7)',
                    borderWidth: 1,
                    borderRadius: 5,
                    borderSkipped: false,
                    maxBarThickness: 30,
                    categoryPercentage: 0.62,
                    barPercentage: 0.75,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 250 },
                layout: { padding: { top: 8, right: isMobile ? 8 : 14, left: 4, bottom: isMobile ? 6 : 0 } },
                events: ['mousemove', 'mouseout', 'click', 'touchstart', 'touchend'],
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        displayColors: false,
                        backgroundColor: 'rgba(15,23,42,0.95)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        padding: 10,
                        callbacks: {
                            title: (items) => {
                                if (!items || !items.length) return '';
                                const idx = items[0].dataIndex;
                                return sorted[idx]?.nombre || items[0].label || '';
                            },
                            label: (context) => ` ${context.parsed.y.toFixed(1)} kWh`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        border: { display: false },
                        ticks: {
                            color: chartTextColor,
                            font: { size: isMobile ? 10 : 11, weight: '500' },
                            maxRotation: isMobile ? 45 : 0,
                            minRotation: isMobile ? 45 : 0,
                            autoSkip: false, // NUNCA omitir ningún inversor
                            callback: (value) => formatChartLabel(inverterLabels[value] || value, 10)
                        },
                        title: { display: true, text: 'Inversor', color: chartTitleColor, font: { weight: '600', size: 12 } }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: chartGridColor, drawBorder: false },
                        border: { display: false },
                        ticks: { color: chartTextColor, font: { size: 11 }, precision: 0 },
                        title: { display: true, text: 'kWh', color: chartTitleColor, font: { weight: '600', size: 12 } }
                    }
                }
            }
        });
        console.log('✅ Gráfica de inversores creada');
    } catch (e) { console.error('❌ Error en gráfica de inversores:', e); }
    try {
        if (weeklyChartInstance) { weeklyChartInstance.destroy(); weeklyChartInstance = null; }
        const ctx2 = canvas2.getContext('2d');
        const weeklyProduction = buildWeeklyProductionData();
        const maxValue = Math.max(...weeklyProduction.data, 10);
        const weeklyColors = ['#2dd4bf', '#34d399', '#2ec4b6', '#22c55e', '#14b8a6', '#10b981', '#34d399'];
        weeklyChartInstance = new Chart(ctx2, {
            type: 'bar',
            data: {
                labels: weeklyProduction.labels,
                datasets: [{
                    label: 'Producción total del sistema',
                    data: weeklyProduction.data,
                    backgroundColor: weeklyProduction.data.map((value, index) => value === 0 ? (isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(148, 163, 184, 0.12)') : weeklyColors[index]),
                    borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.3)',
                    borderWidth: 1,
                    borderRadius: 6,
                    borderSkipped: false,
                    maxBarThickness: 28,
                    categoryPercentage: 0.72,
                    barPercentage: 0.8,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 250 },
                layout: { padding: { top: 6, right: 10, left: 4, bottom: 0 } },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        borderColor: 'rgba(148, 163, 184, 0.3)',
                        borderWidth: 1,
                        callbacks: {
                            label: (context) => ` ${context.parsed.y.toFixed(1)} kWh`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        border: { display: false },
                        ticks: { color: chartTextColor, font: { size: 11, weight: '500' } }
                    },
                    y: {
                        beginAtZero: true,
                        max: maxValue > 0 ? maxValue * 1.2 : 10,
                        grid: { color: chartGridColor, drawBorder: false },
                        border: { display: false },
                        ticks: { color: chartTextColor, font: { size: 11 }, precision: 0 },
                        title: { display: true, text: 'kWh', color: chartTitleColor, font: { weight: '600', size: 12 } }
                    }
                }
            }
        });
        console.log('✅ Gráfica semanal creada con total agregado por inversores');
    } catch (e) { console.error('❌ Error en gráfica semanal:', e); }
}

function updateDashboardCharts() {
    if (!inverterChartInstance || !weeklyChartInstance) {
        initDashboardCharts();
        return;
    }

    const colors = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899'];
    const sorted = [...inverters].sort((a, b) => b.energiaHoy - a.energiaHoy);
    const inverterLabels = sorted.length ? sorted.map(inverter => inverter.nombre) : ['Sin datos'];
    const inverterData = sorted.length ? sorted.map(inverter => Number(inverter.energiaHoy) || 0) : [0];

    const isMobile = window.innerWidth <= 768;
    adjustInverterChartWidth(sorted.length);
    inverterChartInstance.options.scales.x.ticks.maxRotation = isMobile ? 45 : 0;
    inverterChartInstance.options.scales.x.ticks.minRotation = isMobile ? 45 : 0;
    inverterChartInstance.options.scales.x.ticks.font.size = isMobile ? 10 : 11;
    inverterChartInstance.options.scales.x.ticks.autoSkip = false;
    inverterChartInstance.options.scales.x.ticks.callback = (value) => formatChartLabel(inverterLabels[value] || value, 10);
    inverterChartInstance.options.layout.padding.right = isMobile ? 8 : 14;
    inverterChartInstance.options.layout.padding.bottom = isMobile ? 6 : 0;
    inverterChartInstance.resize();

    inverterChartInstance.data.labels = inverterLabels;
    inverterChartInstance.data.datasets[0].data = inverterData;
    inverterChartInstance.data.datasets[0].backgroundColor = inverterLabels.map((_, index) => colors[index % colors.length]);
    inverterChartInstance.data.datasets[0].borderColor = 'rgba(255,255,255,0.7)';
    inverterChartInstance.data.datasets[0].borderWidth = 1;
    inverterChartInstance.data.datasets[0].borderRadius = 5;
    inverterChartInstance.data.datasets[0].maxBarThickness = 30;
    inverterChartInstance.data.datasets[0].categoryPercentage = 0.62;
    inverterChartInstance.data.datasets[0].barPercentage = 0.75;

    inverterChartInstance.update('none');

    const isDark = document.body.classList.contains('dark-mode');
    const weeklyProduction = buildWeeklyProductionData();
    const weeklyColors = ['#34d399', '#2dd4bf', '#60a5fa', '#a78bfa', '#fbbf24', '#f97316', '#22c55e'];
    const weeklyDataset = weeklyChartInstance.data.datasets[0];
    weeklyDataset.data = weeklyProduction.data;
    weeklyDataset.backgroundColor = weeklyProduction.data.map((value, index) => value === 0 ? (isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(148, 163, 184, 0.12)') : weeklyColors[index]);
    weeklyDataset.borderColor = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.3)';
    weeklyDataset.categoryPercentage = 0.72;
    weeklyDataset.barPercentage = 0.8;
    weeklyChartInstance.options.scales.y.max = Math.max(...weeklyProduction.data, 10) * 1.2;
    weeklyChartInstance.update('none');
}

function buildStatsProductionData(range = 'hora') {
    const todayKey = getMexicoDateKey();
    const dailyValues = new Map();
    dailyProductionByInverter.forEach(readings => readings.forEach((energy, dateKey) => {
        dailyValues.set(dateKey, (dailyValues.get(dateKey) || 0) + Number(energy || 0));
    }));

    if (dailyValues.size === 0 && typeof dailyProductionByDate === 'object' && dailyProductionByDate !== null) {
        Object.entries(dailyProductionByDate).forEach(([dateKey, energy]) => {
            dailyValues.set(dateKey, Number(energy || 0));
        });
    }

    if (range === 'hora') {
        // Encontrar la fecha objetivo (hoy, o la más reciente con lecturas en el historial)
        let targetDateKey = todayKey;
        let hasTodayData = false;
        historicalReadingsByInverter.forEach(readings => {
            if ((readings || []).some(r => r.timestamp && getMexicoDateKey(r.timestamp) === todayKey)) {
                hasTodayData = true;
            }
        });

        if (!hasTodayData) {
            let latestFound = null;
            historicalReadingsByInverter.forEach(readings => {
                (readings || []).forEach(r => {
                    if (!r.timestamp) return;
                    const dk = getMexicoDateKey(r.timestamp);
                    if (!latestFound || dk > latestFound) latestFound = dk;
                });
            });
            if (latestFound) targetDateKey = latestFound;
        }

        // Agrupar lecturas por hora y por cada inversor para calcular la potencia horaria real del sistema
        // hourlyByInverter[hour][inverterId] = { sum: 0, count: 0 }
        const hourlyByInverter = Array(24).fill(null).map(() => ({}));
        historicalReadingsByInverter.forEach((readings, inverterId) => {
            (readings || []).forEach(reading => {
                if (!reading.timestamp) return;
                if (getMexicoDateKey(reading.timestamp) !== targetDateKey) return;
                const hour = getMexicoHour(reading.timestamp);
                if (hour >= 0 && hour < 24) {
                    if (!hourlyByInverter[hour][inverterId]) {
                        hourlyByInverter[hour][inverterId] = { sum: 0, count: 0 };
                    }
                    hourlyByInverter[hour][inverterId].sum += Number(reading.potencia_ac || 0);
                    hourlyByInverter[hour][inverterId].count += 1;
                }
            });
        });

        const hourlyData = [];
        for (let h = 0; h < 24; h++) {
            const invertersInHour = hourlyByInverter[h];
            let plantTotalKw = 0;
            Object.values(invertersInHour).forEach(v => {
                if (v.count > 0) {
                    plantTotalKw += (v.sum / v.count);
                }
            });
            hourlyData.push(Number(plantTotalKw.toFixed(1)));
        }

        return {
            type: 'line',
            unit: 'kW',
            targetDateKey,
            labels: hourlyData.map((_, hour) => `${String(hour).padStart(2, '0')}:00`),
            data: hourlyData
        };
    }

    if (range === 'mes') {
        const currentYear = new Date().getFullYear();
        const monthly = Array(12).fill(0);
        dailyValues.forEach((energy, dateKey) => {
            const date = new Date(`${dateKey}T00:00:00`);
            if (date.getFullYear() === currentYear) monthly[date.getMonth()] += energy;
        });
        return {
            type: 'bar', unit: 'kWh',
            labels: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'],
            data: monthly.map(value => Number(value.toFixed(1)))
        };
    }

    if (range === 'anio') {
        const currentYear = new Date().getFullYear();
        const years = Array.from({ length: 5 }, (_, index) => currentYear - 4 + index);
        const yearly = years.map(year => [...dailyValues.entries()]
            .filter(([dateKey]) => new Date(`${dateKey}T00:00:00`).getFullYear() === year)
            .reduce((sum, [, energy]) => sum + energy, 0));
        return { type: 'bar', unit: 'kWh', labels: years.map(String), data: yearly.map(value => Number(value.toFixed(1))) };
    }

    // range === 'dia': Todos los días del mes completo (1 al 28/29/30/31)

    const [todayYearStr, todayMonthStr] = todayKey.split('-');
    let targetYear = parseInt(todayYearStr, 10);
    let targetMonth = parseInt(todayMonthStr, 10); // 1-12

    const sortedKeys = [...dailyValues.keys()].sort();
    const hasCurrentMonthData = sortedKeys.some(k => k.startsWith(`${todayYearStr}-${todayMonthStr}`));
    if (!hasCurrentMonthData && sortedKeys.length > 0) {
        const latestKey = sortedKeys.at(-1);
        const [lYear, lMonth] = latestKey.split('-');
        targetYear = parseInt(lYear, 10);
        targetMonth = parseInt(lMonth, 10);
    }

    const yearStr = String(targetYear);
    const monthStr = String(targetMonth).padStart(2, '0');
    const totalDays = new Date(targetYear, targetMonth, 0).getDate();

    const labels = [];
    const fullLabels = [];
    const data = [];

    for (let day = 1; day <= totalDays; day++) {
        const dayStr = String(day).padStart(2, '0');
        const dateKey = `${yearStr}-${monthStr}-${dayStr}`;
        labels.push(dayStr);

        const dateObj = new Date(`${dateKey}T12:00:00`);
        const weekday = dateObj.toLocaleDateString('es-MX', { weekday: 'long' });
        const monthName = dateObj.toLocaleDateString('es-MX', { month: 'long' });
        const fullDateStr = `${weekday.charAt(0).toUpperCase() + weekday.slice(1)}, ${day} de ${monthName}`;
        fullLabels.push(fullDateStr);

        const energy = Number(dailyValues.get(dateKey) || 0);
        data.push(Number(energy.toFixed(1)));
    }

    return {
        type: 'bar',
        unit: 'kWh',
        labels,
        fullLabels,
        data
    };
}

function getSelectedStatsRange() {
    return document.querySelector('#statsRange .stats-period-btn.active')?.dataset.range || 'hora';
}

function updateStatsSummary(range = getSelectedStatsRange()) {
    const todayKey = getMexicoDateKey();
    const production = buildStatsProductionData(range);

    let totalEnergy = 0;
    let avgMetricValue = 0;
    let avgMetricUnit = 'kW';
    let avgMetricLabel = 'Potencia Promedio';
    let totalMetricLabel = 'Producción Total';

    if (range === 'hora') {
        const activeDateKey = production.targetDateKey || todayKey;
        dailyProductionByInverter.forEach(readings => {
            totalEnergy += Number(readings.get(activeDateKey) || 0);
        });
        if (totalEnergy === 0 && dailyProductionByDate[activeDateKey]) {
            totalEnergy = Number(dailyProductionByDate[activeDateKey] || 0);
        }
        if (totalEnergy === 0) {
            totalEnergy = production.data.reduce((sum, v) => sum + v, 0);
        }

        // Potencia promedio generada durante horas activas de sol (> 0.5 kW)
        const activeHours = production.data.filter(val => val > 0.5);
        avgMetricValue = activeHours.length
            ? activeHours.reduce((sum, val) => sum + val, 0) / activeHours.length
            : 0;
        avgMetricUnit = 'kW';
        avgMetricLabel = 'Potencia Prom. Generada';
        totalMetricLabel = 'Producción del Día';
    } else if (range === 'dia') {
        totalEnergy = production.data.reduce((sum, val) => sum + val, 0);
        const daysWithProd = production.data.filter(val => val > 0);
        avgMetricValue = daysWithProd.length ? totalEnergy / daysWithProd.length : 0;
        avgMetricUnit = 'kWh/día';
        avgMetricLabel = 'Promedio Diario';
        totalMetricLabel = 'Producción del Mes';
    } else if (range === 'mes') {
        totalEnergy = production.data.reduce((sum, val) => sum + val, 0);
        const monthsWithProd = production.data.filter(val => val > 0);
        avgMetricValue = monthsWithProd.length ? totalEnergy / monthsWithProd.length : 0;
        avgMetricUnit = 'kWh/mes';
        avgMetricLabel = 'Promedio Mensual';
        totalMetricLabel = 'Producción del Año';
    } else if (range === 'anio') {
        totalEnergy = production.data.reduce((sum, val) => sum + val, 0);
        const yearsWithProd = production.data.filter(val => val > 0);
        avgMetricValue = yearsWithProd.length ? totalEnergy / yearsWithProd.length : 0;
        avgMetricUnit = 'kWh/año';
        avgMetricLabel = 'Promedio Anual';
        totalMetricLabel = 'Producción Histórica';
    }

    const totalElement = document.getElementById('statsTotalEnergy');
    const averageElement = document.getElementById('statsAvgPower');
    const totalLabelEl = document.getElementById('statsTotalLabel');
    const avgLabelEl = document.getElementById('statsAvgLabel');

    if (totalElement) totalElement.innerHTML = `${totalEnergy.toFixed(1)} <small>kWh</small>`;
    if (averageElement) averageElement.innerHTML = `${avgMetricValue.toFixed(1)} <small>${avgMetricUnit}</small>`;
    if (totalLabelEl) totalLabelEl.textContent = totalMetricLabel;
    if (avgLabelEl) avgLabelEl.textContent = avgMetricLabel;

    return production;
}

function initStatsChart() {
    const canvas = document.getElementById('statsChart');
    if (!canvas) { console.error('❌ No se encontró statsChart'); return; }
    const ctx = canvas.getContext('2d');
    if (statsChartInstance) statsChartInstance.destroy();
    const range = getSelectedStatsRange();
    const production = updateStatsSummary(range);
    const isDia = range === 'dia';
    const isDark = document.body.classList.contains('dark-mode');
    const statsTextColor = isDark ? '#94a3b8' : '#475569';
    const statsGridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : '#f1f5f9';
    const statsBgColor = isDark ? 'rgba(59, 130, 246, 0.25)' : 'rgba(59, 130, 246, 0.1)';

    statsChartInstance = new Chart(ctx, {
        type: production.type,
        data: {
            labels: production.labels,
            datasets: [{
                label: production.unit === 'kW' ? 'Potencia total del sistema (kW)' : 'Producción (kWh)',
                data: production.data,
                borderColor: '#3b82f6',
                backgroundColor: statsBgColor,
                borderWidth: 2,
                borderRadius: production.type === 'bar' ? (isDia ? 4 : 6) : 0,
                maxBarThickness: isDia ? 24 : 34,
                categoryPercentage: isDia ? 0.82 : 0.62,
                barPercentage: isDia ? 0.88 : 0.58,
                tension: 0.35,
                fill: production.type === 'line'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: statsTextColor }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    padding: 10,
                    callbacks: {
                        title: (items) => {
                            if (!items || !items.length) return '';
                            const idx = items[0].dataIndex;
                            if (production.fullLabels && production.fullLabels[idx]) {
                                return production.fullLabels[idx];
                            }
                            return items[0].label || '';
                        },
                        label: (context) => ` ${production.unit === 'kW' ? 'Potencia' : 'Producción'}: ${context.parsed.y.toFixed(1)} ${production.unit}`
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        autoSkip: true,
                        maxTicksLimit: production.type === 'line' ? 8 : (isDia ? 31 : 12),
                        maxRotation: 0,
                        minRotation: 0,
                        color: statsTextColor,
                        font: {
                            size: isDia ? 10 : 11
                        }
                    },
                    grid: { display: false }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: statsGridColor },
                    ticks: { color: statsTextColor }
                }
            }
        }
    });
}

document.querySelectorAll('#statsRange .stats-period-btn').forEach(button => {
    button.addEventListener('click', () => {
        document.querySelectorAll('#statsRange .stats-period-btn').forEach(item => {
            const selected = item === button;
            item.classList.toggle('active', selected);
            item.setAttribute('aria-selected', String(selected));
        });
        initStatsChart();
    });
});

// ============================================================
//  MODAL AGREGAR INVERSOR (RESTRINGIDO A ADMINS)
// ============================================================

document.getElementById('btnAddInverter')?.addEventListener('click', () => {
    if (usuarioActual?.rol !== 'admin') {
        alert('Solo los administradores tienen permisos para agregar nuevos inversores.');
        return;
    }
    document.getElementById('modalInverter')?.classList.add('open');
});

document.getElementById('closeModal')?.addEventListener('click', () => {
    document.getElementById('modalInverter')?.classList.remove('open');
});
document.getElementById('cancelModal')?.addEventListener('click', () => {
    document.getElementById('modalInverter')?.classList.remove('open');
});
document.getElementById('modalInverter')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) document.getElementById('modalInverter')?.classList.remove('open');
});

document.getElementById('saveInverter')?.addEventListener('click', async () => {
    if (usuarioActual?.rol !== 'admin') {
        alert('Solo los administradores tienen permisos para agregar nuevos inversores.');
        return;
    }
    const nombre = document.getElementById('invNombre')?.value.trim();
    const marca = document.getElementById('invMarca')?.value;
    const modelo = document.getElementById('invModelo')?.value.trim() || 'No especificado';
    const ubicacion = document.getElementById('invUbicacion')?.value.trim() || 'No especificada';
    if (!nombre) { alert('El nombre es obligatorio.'); return; }
    try {
        await db.createInversor({
            nombre: nombre,
            marca: marca,
            modelo: modelo,
            ubicacion: ubicacion,
            usuario_id: usuarioActual?.id || null,
            capacidad_kw: 0,
            tipo_conexion: 'api'
        });
        document.getElementById('modalInverter')?.classList.remove('open');
        await loadInverters();
        renderDashboardKPIs();
        renderDashboardTable();
        renderFullInverterTable();
        updateDashboardCharts();
        console.log('✅ Inversor agregado');
    } catch (error) {
        console.error('❌ Error al agregar inversor:', error);
        alert('Error al agregar el inversor');
    }
});

// ============================================================
//  FILTROS (Inversores)
// ============================================================

document.getElementById('searchInverter')?.addEventListener('input', renderFullInverterTable);
document.getElementById('filterBrand')?.addEventListener('change', renderFullInverterTable);
document.getElementById('filterStatus')?.addEventListener('change', renderFullInverterTable);

function formatSyncDate(value) {
    return value ? new Date(value).toLocaleString('es-MX') : 'Sin sincronización';
}

function renderApiStatus() {
    const body = document.getElementById('apiStatusBody');
    if (!body) return;

    if (!inverters.length) {
        body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:20px;">No tienes inversores asignados.</td></tr>';
        return;
    }

    body.innerHTML = inverters.map(inverter => {
        const status = inverter.apiStatus === 'connected' ? 'Conectada' :
            inverter.apiStatus === 'retrying' ? 'Reintentando en 30 s' :
            inverter.apiStatus === 'error' ? 'Error' :
                inverter.apiUrl ? 'Esperando actualización' : 'Sin configurar';
        const color = inverter.apiStatus === 'connected' ? '#16a34a' :
            inverter.apiStatus === 'retrying' ? '#d97706' :
            inverter.apiStatus === 'error' ? '#dc2626' : '#64748b';
        return `
            <tr>
                <td><strong>${inverter.nombre}</strong></td>
                <td>${inverter.marca}</td>
                <td><span style="color:${color};font-weight:600;">${status}</span></td>
                <td>${formatSyncDate(inverter.apiLastSync)}</td>
                <td><span style="color:#64748b;font-size:12px;">Gestionada por admin</span></td>
            </tr>`;
    }).join('');
}

function loadConfigurationPreferences() {
    const saved = JSON.parse(localStorage.getItem(`crode_preferences_${usuarioActual?.id}`) || '{}');
    ['modbusPort', 'modbusTimeout', 'modbusInterval'].forEach(id => {
        const element = document.getElementById(id);
        if (element && saved[id] !== undefined) element.value = saved[id];
    });
    ['notifyEmail', 'notifyTelegram'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.checked = Boolean(saved[id]);
    });
    const profileName = document.getElementById('perfilNombre');
    if (profileName) profileName.value = usuarioActual?.nombre || '';
    const email = document.getElementById('perfilEmail');
    if (email) email.value = usuarioActual?.email || '';
}

function saveConfigurationPreferences() {
    const key = `crode_preferences_${usuarioActual?.id}`;
    const current = JSON.parse(localStorage.getItem(key) || '{}');
    ['modbusPort', 'modbusTimeout', 'modbusInterval'].forEach(id => {
        const element = document.getElementById(id);
        if (element) current[id] = element.value;
    });
    ['notifyEmail', 'notifyTelegram'].forEach(id => {
        const element = document.getElementById(id);
        if (element) current[id] = element.checked;
    });
    localStorage.setItem(key, JSON.stringify(current));
}

document.getElementById('savePerfil')?.addEventListener('click', async () => {
    const name = document.getElementById('perfilNombre')?.value.trim();
    const password = document.getElementById('perfilPassword')?.value || '';
    if (!name) {
        alert('El nombre es obligatorio.');
        return;
    }
    try {
        const updates = { nombre: name };
        if (password) {
            const bcryptInstance = window.bcrypt || (window.dcodeIO && window.dcodeIO.bcrypt);
            if (!bcryptInstance?.hashSync) throw new Error('La librería de seguridad no está disponible.');
            updates.password_hash = bcryptInstance.hashSync(password, 10);
        }
        const updated = await db.updateUsuario(usuarioActual.id, updates);
        usuarioActual = { ...usuarioActual, ...updated, password_hash: undefined };
        window.CRODE_SESSION?.write(usuarioActual);
        document.getElementById('userName').textContent = usuarioActual.nombre;
        document.getElementById('perfilPassword').value = '';
        alert('Perfil actualizado correctamente.');
    } catch (error) {
        console.error('Error al actualizar el perfil:', error);
        alert('No se pudo actualizar el perfil.');
    }
});

document.getElementById('saveModbus')?.addEventListener('click', () => {
    saveConfigurationPreferences();
    alert('Preferencias Modbus guardadas para este usuario.');
});

document.getElementById('saveNotifications')?.addEventListener('click', () => {
    saveConfigurationPreferences();
    alert('Preferencias de alertas guardadas.');
});

// ============================================================
//  NAVEGACIÓN SPA
// ============================================================

document.querySelectorAll('.nav-menu a[data-section]').forEach(link => {
    link.addEventListener('click', function(e) {
        e.preventDefault();
        document.querySelectorAll('.nav-menu a').forEach(a => a.classList.remove('active'));
        this.classList.add('active');
        const sectionId = this.dataset.section;
        document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
        const target = document.getElementById(sectionId);
        if (target) target.classList.add('active');
        document.getElementById('sidebar')?.classList.remove('open');
        if (sectionId === 'configuracion') {
            loadConfigurationPreferences();
            renderApiStatus();
        }
        if (sectionId === 'estadisticas') {
            setTimeout(initStatsChart, 200);
        }
    });
});

// ============================================================
//  TABS (Alertas y Configuración)
// ============================================================

document.querySelectorAll('.tab-group').forEach(group => {
    group.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            group.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            const parentSection = this.closest('.page-section');
            const tabId = this.dataset.tab;
            parentSection.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            const target = parentSection.querySelector(`#tab-${tabId}`);
            if (target) target.classList.add('active');
        });
    });
});

// ============================================================
//  BOTONES ADICIONALES
// ============================================================

document.querySelector('.chart-expand-btn')?.addEventListener('click', function() {
    const card = this.closest('.chart-card-expandable');
    if (!card) return;
    const expanded = card.classList.toggle('expanded');
    this.setAttribute('aria-label', expanded ? 'Contraer gráfica' : 'Expandir gráfica');
    this.innerHTML = expanded ? '<i class="fas fa-compress"></i>' : '<i class="fas fa-expand"></i>';
    adjustInverterChartWidth(inverters ? inverters.length : 0);
    if (inverterChartInstance) {
        setTimeout(() => inverterChartInstance.resize(), 150);
    }
});

window.addEventListener('resize', () => {
    adjustInverterChartWidth(inverters ? inverters.length : 0);
    if (inverterChartInstance) {
        const isMobile = window.innerWidth <= 768;
        inverterChartInstance.options.scales.x.ticks.maxRotation = isMobile ? 45 : 0;
        inverterChartInstance.options.scales.x.ticks.minRotation = isMobile ? 45 : 0;
        inverterChartInstance.options.scales.x.ticks.font.size = isMobile ? 10 : 11;
        inverterChartInstance.options.layout.padding.right = isMobile ? 8 : 14;
        inverterChartInstance.options.layout.padding.bottom = isMobile ? 6 : 0;
        inverterChartInstance.resize();
    }
});

// ============================================================
//  EXPORTACIÓN DE REPORTES EN PDF (INDIVIDUAL Y 4 EN 1)
// ============================================================

function renderChartImageForPdf({ type = 'line', labels = [], data = [], title = '', unit = 'kW', color = '#2563eb', aspect = 2.8 }) {
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = Math.round(1000 / aspect);
    const ctx = canvas.getContext('2d');
    
    // Fondo blanco sólido para que en el PDF no se transparente
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const isLine = type === 'line';
    const chart = new Chart(ctx, {
        type: isLine ? 'line' : 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: `${title} (${unit})`,
                data: data,
                borderColor: color,
                backgroundColor: isLine ? 'rgba(37, 99, 235, 0.14)' : color,
                borderWidth: isLine ? 2.5 : 1,
                borderRadius: isLine ? 0 : 3,
                tension: 0.35,
                fill: isLine,
                pointRadius: isLine ? (labels.length > 24 ? 1.5 : 3.5) : 0,
                pointBackgroundColor: color
            }]
        },
        options: {
            animation: false,
            responsive: false,
            devicePixelRatio: 1,
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: { color: '#0f172a', font: { size: 12, weight: 'bold' } }
                }
            },
            scales: {
                x: {
                    grid: { color: '#f1f5f9' },
                    ticks: { color: '#475569', font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 24 }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: '#e2e8f0' },
                    ticks: { color: '#475569', font: { size: 10 } }
                }
            }
        }
    });

    const img = canvas.toDataURL('image/png', 1.0);
    chart.destroy();
    return img;
}

async function exportProductionPdf({ scope = 'current', requestedRange = null, includeKpis = true, includeInverters = true, includeDataTable = true, includeWeather = true }) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
        throw new Error('La biblioteca jsPDF no está cargada en el navegador. Por favor recarga la página.');
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
    });

    const primaryColor = [30, 58, 138];    // #1e3a8a (Azul CRODE)
    const accentColor = [245, 158, 11];    // #f59e0b (Dorado Solar)
    const darkTextColor = [15, 23, 42];    // #0f172a
    const mutedTextColor = [100, 116, 139];// #64748b

    // Helper: Encabezado principal
    function drawHeader(title, subtitle) {
        doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        doc.rect(0, 0, 210, 24, 'F');
        doc.setFillColor(accentColor[0], accentColor[1], accentColor[2]);
        doc.rect(0, 24, 210, 1.5, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(15);
        doc.text('CRODE SOLAR', 14, 11);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(224, 231, 255);
        doc.text('Centro Regional de Optimización y Desarrollo de Equipo • Mérida, Yuc.', 14, 17);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(255, 255, 255);
        doc.text(title.toUpperCase(), 196, 11, { align: 'right' });

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(224, 231, 255);
        const nowStr = new Date().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
        doc.text(`Emisión: ${nowStr}`, 196, 17, { align: 'right' });

        return 32;
    }

    // Helper: Barra de metadatos del reporte
    function drawInfoBox(currentY, periodText) {
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.3);
        doc.roundedRect(14, currentY, 182, 16, 2, 2, 'FD');

        const roleText = usuarioActual?.rol === 'admin'
            ? 'Administrador'
            : (usuarioActual?.rol === 'invitado' ? 'Cliente' : 'Técnico');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(mutedTextColor[0], mutedTextColor[1], mutedTextColor[2]);
        doc.text('RESPONSABLE:', 18, currentY + 6);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(darkTextColor[0], darkTextColor[1], darkTextColor[2]);
        doc.text(`${usuarioActual?.nombre || 'Técnico'} (${roleText})`, 44, currentY + 6);

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(mutedTextColor[0], mutedTextColor[1], mutedTextColor[2]);
        doc.text('CORREO:', 18, currentY + 11.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(darkTextColor[0], darkTextColor[1], darkTextColor[2]);
        doc.text(`${usuarioActual?.email || 'N/A'}`, 44, currentY + 11.5);

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(mutedTextColor[0], mutedTextColor[1], mutedTextColor[2]);
        doc.text('PERÍODO:', 116, currentY + 6);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(darkTextColor[0], darkTextColor[1], darkTextColor[2]);
        doc.text(`${periodText}`, 135, currentY + 6);

        const onlineCount = (inverters || []).filter(i => i.estado === 'online').length;
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(mutedTextColor[0], mutedTextColor[1], mutedTextColor[2]);
        doc.text('INVERSORES:', 116, currentY + 11.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(darkTextColor[0], darkTextColor[1], darkTextColor[2]);
        doc.text(`${inverters.length} total (${onlineCount} operativos)`, 138, currentY + 11.5);

        return currentY + 21;
    }

    // Helper: Tarjetas de métricas clave (KPIs)
    function drawKpiCards(currentY, kpis) {
        const gap = 3;
        const cardW = (182 - (gap * (kpis.length - 1))) / kpis.length;
        const cardH = 16.5;

        kpis.forEach((kpi, index) => {
            const x = 14 + (index * (cardW + gap));
            doc.setFillColor(248, 250, 252);
            doc.setDrawColor(226, 232, 240);
            doc.setLineWidth(0.3);
            doc.roundedRect(x, currentY, cardW, cardH, 1.5, 1.5, 'FD');

            const barColor = kpi.color || [37, 99, 235];
            doc.setFillColor(barColor[0], barColor[1], barColor[2]);
            doc.rect(x, currentY, 1.5, cardH, 'F');

            // Etiqueta superior
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(6.5);
            doc.setTextColor(mutedTextColor[0], mutedTextColor[1], mutedTextColor[2]);
            doc.text(kpi.label.toUpperCase(), x + 4, currentY + 5.2);

            // Calcular ancho del valor con su fuente real (10.5pt bold)
            let valFontSize = 10.5;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(valFontSize);
            const valStr = `${kpi.value}`;
            let valWidth = doc.getTextWidth(valStr);

            // Calcular ancho de la unidad (7.5pt normal)
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            const unitWidth = doc.getTextWidth(kpi.unit);

            // Si el número es muy grande, reducir ligeramente la fuente para que quepa holgado
            if (valWidth + unitWidth + 7 > cardW) {
                valFontSize = 9;
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(valFontSize);
                valWidth = doc.getTextWidth(valStr);
            }

            // 1. Dibujar el valor numérico
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(valFontSize);
            doc.setTextColor(darkTextColor[0], darkTextColor[1], darkTextColor[2]);
            doc.text(valStr, x + 4, currentY + 12.2);

            // 2. Dibujar la unidad con margen limpio de separación (+ 2 mm)
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            doc.setTextColor(mutedTextColor[0], mutedTextColor[1], mutedTextColor[2]);
            doc.text(kpi.unit, x + 4 + valWidth + 2.0, currentY + 12.2);
        });

        return currentY + cardH + 5.5;
    }

    // Helper: Título de sección
    function drawSectionTitle(currentY, title) {
        doc.setFillColor(37, 99, 235);
        doc.rect(14, currentY, 2.5, 5, 'F');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(darkTextColor[0], darkTextColor[1], darkTextColor[2]);
        doc.text(title, 19, currentY + 4.2);

        return currentY + 7.5;
    }

    // Helper: Datos del clima y radiación
    async function drawWeatherSection(currentY) {
        try {
            const [weather, radiation] = await Promise.all([
                fetchWeatherData(),
                fetchSolarRadiation()
            ]);

            doc.setFillColor(239, 246, 255);
            doc.setDrawColor(191, 219, 254);
            doc.setLineWidth(0.3);
            doc.roundedRect(14, currentY, 182, 11, 1.5, 1.5, 'FD');

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(7.5);
            doc.setTextColor(29, 78, 216);
            doc.text('ESTACIÓN METEOROLÓGICA CRODE:', 18, currentY + 4.5);

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            doc.setTextColor(30, 41, 59);
            const info = `Temp: ${weather.temperatura}°C  |  Sensación: ${weather.sensacion_termica}°C  |  Radiación Solar: ${radiation.radiacion} W/m²  |  Humedad: ${weather.humedad}%  |  Clima: ${weather.clima}`;
            doc.text(info, 18, currentY + 8.5);

            return currentY + 15;
        } catch {
            return currentY;
        }
    }

    // Helper: Pie de página con numeración y leyendas
    function stampFooters() {
        const totalPages = doc.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            doc.setDrawColor(226, 232, 240);
            doc.setLineWidth(0.3);
            doc.line(14, 287, 196, 287);

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.setTextColor(mutedTextColor[0], mutedTextColor[1], mutedTextColor[2]);
            doc.text('CRODE Solar • Monitoreo Fotovoltaico Inteligente • Reporte Confidencial', 14, 292);
            doc.text(`Página ${i} de ${totalPages}`, 196, 292, { align: 'right' });
        }
    }

    const dateKey = typeof getMexicoDateKey === 'function' ? getMexicoDateKey() : 'hoy';

    // ========================================================
    // CASO 1: VISTA ACTUAL SELECCIONADA (HORA, DÍA, MES O AÑO)
    // ========================================================
    if (scope === 'current') {
        const currentRange = requestedRange || getSelectedStatsRange();
        const rangeTitles = {
            hora: 'Reporte de Rendimiento Horario',
            dia: 'Reporte de Producción Diaria (Mes)',
            mes: 'Reporte de Producción Mensual (Año)',
            anio: 'Reporte de Producción Anual (Histórico)'
        };
        const rangeLabels = {
            hora: 'Horario (Hoy)',
            dia: 'Diario (Mes en curso)',
            mes: 'Mensual (Año en curso)',
            anio: 'Anual (Últimos 5 años)'
        };

        let currentY = drawHeader(rangeTitles[currentRange] || 'Reporte de Producción', rangeLabels[currentRange]);
        currentY = drawInfoBox(currentY, rangeLabels[currentRange]);

        const prod = buildStatsProductionData(currentRange);

        if (includeKpis) {
            let totalVal = 0;
            let avgVal = 0;
            const values = prod.data || [];
            const maxVal = values.length ? Math.max(...values) : 0;

            if (currentRange === 'hora') {
                const todayKey = getMexicoDateKey();
                dailyProductionByInverter.forEach(readings => {
                    totalVal += Number(readings.get(todayKey) || 0);
                });
                if (totalVal === 0 && dailyProductionByDate[todayKey]) {
                    totalVal = Number(dailyProductionByDate[todayKey] || 0);
                }
                avgVal = inverters.length ? (inverters.reduce((sum, inv) => sum + Number(inv.potencia || 0), 0) / inverters.length) : 0;
            } else {
                totalVal = values.reduce((sum, v) => sum + v, 0);
                avgVal = values.length ? (totalVal / values.length) : 0;
            }

            const kpis = [
                { label: 'Producción Total', value: totalVal.toFixed(1), unit: currentRange === 'hora' ? 'kWh hoy' : 'kWh', color: [16, 185, 129] },
                { label: 'Promedio Registrado', value: avgVal.toFixed(1), unit: prod.unit, color: [37, 99, 235] },
                { label: 'Pico Máximo', value: maxVal.toFixed(1), unit: prod.unit, color: [245, 158, 11] },
                { label: 'Inversores Planta', value: inverters.length, unit: 'equipos', color: [139, 92, 246] }
            ];
            currentY = drawKpiCards(currentY, kpis);
        }

        if (includeWeather) {
            currentY = await drawWeatherSection(currentY);
        }

        // ========================================================
        // 🌟 LA GRÁFICA PRINCIPAL EN PRIMERA PLANA (PÁGINA 1)
        // ========================================================
        currentY = drawSectionTitle(currentY, `Evolución Gráfica - ${rangeLabels[currentRange]}`);

        const chartImg = renderChartImageForPdf({
            type: prod.type,
            labels: prod.labels,
            data: prod.data,
            title: prod.unit === 'kW' ? 'Potencia horaria del sistema' : 'Producción acumulada',
            unit: prod.unit,
            color: '#2563eb',
            aspect: 2.7
        });

        doc.addImage(chartImg, 'PNG', 14, currentY, 182, 67);
        currentY += 73;

        // Desglose tabulado de valores (si se solicita)
        if (includeDataTable && typeof doc.autoTable === 'function' && prod.labels.length > 0) {
            if (currentY + 45 > 275) {
                doc.addPage();
                currentY = 22;
            }

            currentY = drawSectionTitle(currentY, 'Desglose Tabulado de Valores');

            const totalSum = (prod.data || []).reduce((a, b) => a + b, 0);
            const tableRows = prod.labels.map((lbl, idx) => {
                const val = Number(prod.data[idx] || 0);
                const pct = totalSum > 0 ? `${((val / totalSum) * 100).toFixed(1)}%` : '0%';
                const fullLbl = prod.fullLabels && prod.fullLabels[idx] ? prod.fullLabels[idx] : lbl;
                return [idx + 1, fullLbl, `${val.toFixed(2)} ${prod.unit}`, pct];
            });

            doc.autoTable({
                startY: currentY,
                head: [['#', 'Punto / Intervalo', `Valor (${prod.unit})`, '% Contribución']],
                body: tableRows,
                theme: 'striped',
                headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
                styles: { fontSize: 7.2, cellPadding: 1.8, textColor: [30, 41, 59] },
                margin: { left: 14, right: 14 }
            });
            currentY = doc.lastAutoTable.finalY + 8;
        }

        // Ficha de inversores (al final, en su propia sección ordenada)
        if (includeInverters && inverters.length > 0 && typeof doc.autoTable === 'function') {
            if (currentY + 35 > 275) {
                doc.addPage();
                currentY = 22;
            }

            currentY = drawSectionTitle(currentY, 'Inversores Asignados');
            doc.autoTable({
                startY: currentY,
                head: [['Inversor', 'Marca', 'Modelo', 'Potencia Actual', 'Energía Hoy', 'Estado']],
                body: inverters.map(inv => [
                    inv.nombre,
                    inv.marca,
                    inv.modelo || 'N/A',
                    `${Number(inv.potencia || 0).toFixed(2)} kW`,
                    `${Number(inv.energiaHoy || 0).toFixed(2)} kWh`,
                    inv.estado === 'online' ? 'En línea' : 'Fuera de línea'
                ]),
                theme: 'grid',
                headStyles: { fillColor: [30, 58, 138], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
                styles: { fontSize: 7.5, cellPadding: 2, textColor: [30, 41, 59] },
                margin: { left: 14, right: 14 }
            });
            currentY = doc.lastAutoTable.finalY + 6;
        }

        stampFooters();
        doc.save(`Reporte_Solar_${currentRange.toUpperCase()}_${dateKey}.pdf`);
        return;
    }

    // ========================================================
    // CASO 2: REPORTE INTEGRAL COMPLETO (4 EN 1: HORA, DÍA, MES, AÑO)
    // ========================================================
    // PÁGINA 1: ANÁLISIS HORARIO Y DIARIO
    let p1Y = drawHeader('Informe Integral Consolidado de Producción', 'Reporte Consolidado (4 en 1)');
    p1Y = drawInfoBox(p1Y, 'Consolidado: Hora, Día, Mes y Año');

    const prodHora = buildStatsProductionData('hora');
    const prodDia = buildStatsProductionData('dia');
    const prodMes = buildStatsProductionData('mes');
    const prodAnio = buildStatsProductionData('anio');

    if (includeKpis) {
        let todayEnergy = 0;
        dailyProductionByInverter.forEach(readings => {
            todayEnergy += Number(readings.get(dateKey) || 0);
        });
        if (todayEnergy === 0 && dailyProductionByDate[dateKey]) {
            todayEnergy = Number(dailyProductionByDate[dateKey] || 0);
        }
        const totalMesEnergy = (prodDia.data || []).reduce((a, b) => a + b, 0);
        const totalAnioEnergy = (prodMes.data || []).reduce((a, b) => a + b, 0);
        const totalGlobalEnergy = (prodAnio.data || []).reduce((a, b) => a + b, 0);

        const kpis = [
            { label: 'Energía Hoy', value: todayEnergy.toFixed(1), unit: 'kWh', color: [16, 185, 129] },
            { label: 'Total Mes Actual', value: totalMesEnergy.toFixed(1), unit: 'kWh', color: [37, 99, 235] },
            { label: 'Total Año en Curso', value: totalAnioEnergy.toFixed(1), unit: 'kWh', color: [245, 158, 11] },
            { label: 'Histórico 5 Años', value: totalGlobalEnergy.toFixed(0), unit: 'kWh', color: [139, 92, 246] }
        ];
        p1Y = drawKpiCards(p1Y, kpis);
    }

    if (includeWeather) {
        p1Y = await drawWeatherSection(p1Y);
    }

    // Sección 1: Gráfica Horaria
    p1Y = drawSectionTitle(p1Y, '1. Análisis Horario de Generación (Día de Hoy)');
    const chartHora = renderChartImageForPdf({
        type: 'line',
        labels: prodHora.labels,
        data: prodHora.data,
        title: 'Potencia horaria del sistema',
        unit: 'kW',
        color: '#2563eb',
        aspect: 3.4
    });
    doc.addImage(chartHora, 'PNG', 14, p1Y, 182, 53);
    p1Y += 58;

    // Sección 2: Gráfica Diaria del Mes
    p1Y = drawSectionTitle(p1Y, '2. Evolución Diaria (Mes en Curso)');
    const chartDia = renderChartImageForPdf({
        type: 'bar',
        labels: prodDia.labels,
        data: prodDia.data,
        title: 'Producción diaria',
        unit: 'kWh',
        color: '#0284c7',
        aspect: 3.4
    });
    doc.addImage(chartDia, 'PNG', 14, p1Y, 182, 53);
    p1Y += 58;

    // PÁGINA 2: ANÁLISIS MENSUAL, ANUAL Y CERTIFICACIÓN TÉCNICA
    doc.addPage();
    doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.rect(0, 0, 210, 16, 'F');
    doc.setFillColor(accentColor[0], accentColor[1], accentColor[2]);
    doc.rect(0, 16, 210, 1.2, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('CRODE SOLAR • INFORME INTEGRAL DE PRODUCCIÓN', 14, 10.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(224, 231, 255);
    doc.text('CONTINUACIÓN: ANÁLISIS MENSUAL Y ANUAL', 196, 10.5, { align: 'right' });

    let p2Y = 24;

    // Sección 3: Gráfica Mensual
    p2Y = drawSectionTitle(p2Y, '3. Rendimiento Mensual Acumulado (Año en Curso)');
    const chartMes = renderChartImageForPdf({
        type: 'bar',
        labels: prodMes.labels,
        data: prodMes.data,
        title: 'Producción mensual',
        unit: 'kWh',
        color: '#16a34a',
        aspect: 3.4
    });
    doc.addImage(chartMes, 'PNG', 14, p2Y, 182, 53);
    p2Y += 58;

    // Sección 4: Gráfica Anual
    p2Y = drawSectionTitle(p2Y, '4. Histórico Anual de Generación (Últimos 5 Años)');
    const chartAnio = renderChartImageForPdf({
        type: 'bar',
        labels: prodAnio.labels,
        data: prodAnio.data,
        title: 'Producción anual',
        unit: 'kWh',
        color: '#ea580c',
        aspect: 3.4
    });
    doc.addImage(chartAnio, 'PNG', 14, p2Y, 182, 53);
    p2Y += 58;

    // Tabla consolidada compacta si se solicita
    if (includeDataTable && typeof doc.autoTable === 'function') {
        p2Y = drawSectionTitle(p2Y, 'Resumen Numérico Comparativo (Meses y Años)');
        
        // Tabla comparativa de meses
        const mesLabels = prodMes.labels;
        const mesData = prodMes.data || [];
        const tableBody = mesLabels.map((m, idx) => [
            m,
            `${Number(mesData[idx] || 0).toFixed(1)} kWh`,
            prodAnio.labels[idx] ? `${prodAnio.labels[idx]}` : '-',
            prodAnio.labels[idx] ? `${Number(prodAnio.data[idx] || 0).toFixed(1)} kWh` : '-'
        ]);

        doc.autoTable({
            startY: p2Y,
            head: [['Mes', 'Producción Mes (kWh)', 'Año', 'Producción Anual (kWh)']],
            body: tableBody,
            theme: 'grid',
            headStyles: { fillColor: [30, 58, 138], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
            styles: { fontSize: 7, cellPadding: 1.5, textColor: [30, 41, 59] },
            margin: { left: 14, right: 14 }
        });
        p2Y = doc.lastAutoTable.finalY + 8;
    }

    // Bloque de Firma y Validación Técnica
    if (p2Y + 25 > 280) {
        doc.addPage();
        p2Y = 30;
    }

    const signY = Math.max(p2Y + 8, 256);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.4);
    doc.line(25, signY, 85, signY);
    doc.line(125, signY, 185, signY);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(darkTextColor[0], darkTextColor[1], darkTextColor[2]);
    doc.text('RESPONSABLE TÉCNICO', 55, signY + 4.5, { align: 'center' });
    doc.text('SELLO Y VALIDACIÓN CRODE', 155, signY + 4.5, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(mutedTextColor[0], mutedTextColor[1], mutedTextColor[2]);
    doc.text(usuarioActual?.nombre || 'Técnico de Planta', 55, signY + 8.5, { align: 'center' });
    doc.text('Centro Regional de Optimización y Desarrollo de Equipo', 155, signY + 8.5, { align: 'center' });

    stampFooters();
    doc.save(`Reporte_Solar_Integral_CRODE_${dateKey}.pdf`);
}

function initExportPdfModal() {
    const modal = document.getElementById('modalExportPdf');
    const btnOpen = document.getElementById('btnExport');
    const btnClose = document.getElementById('closeExportPdfModal');
    const btnCancel = document.getElementById('btnCancelExportPdf');
    const btnConfirm = document.getElementById('btnConfirmExportPdf');

    const scopeCardCurrent = document.getElementById('scopeCardCurrent');
    const scopeCardAll = document.getElementById('scopeCardAll');
    const radioCurrent = scopeCardCurrent?.querySelector('input[type="radio"]');
    const radioAll = scopeCardAll?.querySelector('input[type="radio"]');
    const periodButtons = document.querySelectorAll('#exportPeriodSelector .stats-period-btn');

    let activeModalRange = 'hora';

    function setActiveModalRange(range) {
        activeModalRange = range || 'hora';
        periodButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.exportRange === activeModalRange);
        });
    }

    periodButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            setActiveModalRange(btn.dataset.exportRange);
            updateScopeCards('current');
        });
    });

    function updateScopeCards(selectedVal) {
        if (selectedVal === 'current') {
            scopeCardCurrent?.classList.add('active');
            scopeCardAll?.classList.remove('active');
            if (radioCurrent) radioCurrent.checked = true;
        } else {
            scopeCardAll?.classList.add('active');
            scopeCardCurrent?.classList.remove('active');
            if (radioAll) radioAll.checked = true;
        }
    }

    scopeCardCurrent?.addEventListener('click', () => updateScopeCards('current'));
    scopeCardAll?.addEventListener('click', () => updateScopeCards('all'));

    btnOpen?.addEventListener('click', () => {
        const curRange = getSelectedStatsRange();
        setActiveModalRange(curRange);
        updateScopeCards('current');
        modal?.classList.add('open');
    });

    const closeModal = () => modal?.classList.remove('open');
    btnClose?.addEventListener('click', closeModal);
    btnCancel?.addEventListener('click', closeModal);
    modal?.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    btnConfirm?.addEventListener('click', async () => {
        const scope = document.querySelector('input[name="exportScope"]:checked')?.value || 'current';
        const requestedRange = activeModalRange;
        const includeKpis = !!document.getElementById('chkKpis')?.checked;
        const includeInverters = !!document.getElementById('chkInverters')?.checked;
        const includeDataTable = !!document.getElementById('chkDataTable')?.checked;
        const includeWeather = !!document.getElementById('chkWeather')?.checked;

        const btnText = document.getElementById('btnExportPdfText');
        const originalText = btnText ? btnText.textContent : 'Generar y Descargar PDF';

        try {
            btnConfirm.disabled = true;
            if (btnText) {
                btnText.innerHTML = '<span class="spinner" style="display:inline-block;width:13px;height:13px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;margin-right:6px;vertical-align:middle;"></span> Generando...';
            }

            await exportProductionPdf({
                scope,
                requestedRange,
                includeKpis,
                includeInverters,
                includeDataTable,
                includeWeather
            });

            closeModal();
        } catch (error) {
            console.error('❌ Error al exportar PDF:', error);
            alert(`Ocurrió un error al generar el PDF: ${error.message || error}`);
        } finally {
            btnConfirm.disabled = false;
            if (btnText) btnText.textContent = originalText;
        }
    });
}

initExportPdfModal();

document.getElementById('btnAddRule')?.addEventListener('click', () => {
    const nombre = prompt('Nombre de la nueva regla de monitoreo:');
    if (!nombre || !nombre.trim()) return;
    const condicion = prompt('Condición o umbral de disparo (ej. "Potencia < 1 kW"):', 'Potencia < 1 kW en hora pico');
    if (!condicion) return;
    const accion = prompt('Acción a ejecutar (ej. "Crear Alerta [Rendimiento]"):', 'Crear Alerta [Rendimiento]');
    if (!accion) return;

    const rules = getStoredRules();
    rules.push({
        id: 'rule-' + Date.now(),
        nombre: nombre.trim(),
        condicion: condicion.trim(),
        accion: accion.trim(),
        estado: 'Activa'
    });
    saveStoredRules(rules);
    renderReglas();
    alert(`✅ Regla "${nombre.trim()}" agregada correctamente.`);
});

// ============================================================
//  MENÚ MÓVIL
// ============================================================

document.getElementById('menuToggle')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.toggle('open');
});

document.addEventListener('click', (e) => {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('menuToggle');
    if (window.innerWidth <= 768 && sidebar && toggle && !sidebar.contains(e.target) && !toggle.contains(e.target)) {
        sidebar.classList.remove('open');
    }
});

// ============================================================
//  INICIALIZACIÓN
// ============================================================

async function initDashboard() {
    console.log('🚀 Inicializando Dashboard...');
    console.log('👤 Usuario:', usuarioActual?.nombre || 'Invitado');
    console.log('📋 Rol:', usuarioActual?.rol || 'Sin rol');

    // Restricción de permisos: Técnicos y Clientes no pueden agregar inversores
    if (usuarioActual?.rol !== 'admin') {
        const btnAdd = document.getElementById('btnAddInverter');
        if (btnAdd) btnAdd.remove();
        const modalInv = document.getElementById('modalInverter');
        if (modalInv) modalInv.remove();
    }

    const restoredCache = restoreDashboardCache();
    if (restoredCache) {
        renderDashboardKPIs();
        renderDashboardTable();
        renderFullInverterTable();
        renderApiStatus();
        initDashboardCharts();
    }
    
    await loadInverters();
    try {
        await loadAlertas();
    } catch (error) {
        console.error('❌ Error al cargar alertas:', error);
        alertasActivas = [];
        alertasHistorico = [];
        renderAlertas();
        renderDashboardAlerts();
    }
    
    console.log('📊 Inversores cargados:', inverters.length);
    
    renderDashboardKPIs();
    renderDashboardTable();
    renderFullInverterTable();
    loadConfigurationPreferences();
    renderApiStatus();
    
    initDashboardCharts();
    initWeatherWidget();
    startWeatherUpdates();

    console.log('ℹ️ La sincronización Growatt está centralizada en el panel de administración.');
    
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(async () => {
        await loadInverters();
        try {
            await loadAlertas();
        } catch (error) {
            console.error('❌ Error al actualizar alertas:', error);
        }

        renderDashboardKPIs();
        renderDashboardTable();
        renderFullInverterTable();
        updateDashboardCharts();
        if (document.getElementById('estadisticas')?.classList.contains('active')) {
            initStatsChart();
        }
    }, 10000);
    
    console.log('✅ Dashboard inicializado correctamente');
}

// ============================================================
//  GESTIÓN DE TEMA OSCURO / CLARO
// ============================================================

function isDarkMode() {
    return document.body.classList.contains('dark-mode');
}

function initTheme() {
    const savedTheme = localStorage.getItem('crode_theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = savedTheme === 'dark' || (!savedTheme && prefersDark);
    setTheme(isDark ? 'dark' : 'light', false);
}

function setTheme(theme, updateStorage = true) {
    const isDark = theme === 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    document.body.classList.toggle('dark-mode', isDark);
    if (updateStorage) {
        localStorage.setItem('crode_theme', theme);
    }
    const toggleBtn = document.getElementById('themeToggleBtn');
    if (toggleBtn) {
        toggleBtn.innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        toggleBtn.setAttribute('title', isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
        toggleBtn.setAttribute('aria-label', isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
    }
    applyChartTheme();
}

function applyChartTheme() {
    if (inverterChartInstance || weeklyChartInstance) {
        initDashboardCharts();
    }
    const statsCanvas = document.getElementById('statsChart');
    if (statsCanvas && statsCanvas.offsetParent !== null) {
        initStatsChart();
    }
}

document.getElementById('themeToggleBtn')?.addEventListener('click', () => {
    const isDark = isDarkMode();
    setTheme(isDark ? 'light' : 'dark', true);
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem('crode_theme')) {
        setTheme(e.matches ? 'dark' : 'light', false);
    }
});

// ============================================================
//  VERIFICAR SESIÓN AL CARGAR
// ============================================================

document.addEventListener('DOMContentLoaded', async function() {
    initTheme();
    if (checkSession()) {
        await initDashboard();
    }
});

console.log('✅ Sistema de monitoreo cargado');