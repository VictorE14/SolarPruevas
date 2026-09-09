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

function getMexicoDateKey(value = new Date()) {
    const rawValue = value instanceof Date ? value : new Date(value);
    const date = typeof value === 'string' && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)
        ? new Date(`${value}Z`)
        : rawValue;
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
        
        for (const inv of inverters) {
            try {
                const stoppedAt = inverterStoppedAt.get(inv.id);
                const stoppedForToday = inverterStoppedForDate.get(inv.id) === currentDateKey;
                if (stoppedForToday && stoppedAt && Date.now() - stoppedAt < INVERTER_RECHECK_MS) continue;

                const ultima = await db.getUltimaLectura(inv.id);
                if (ultima) {
                    inv.potencia = Number(ultima.potencia_ac) || 0;
                    inv.energiaHoy = Number(ultima.energia_dia) || 0;
                    inv.estado = ultima.estado_operativo || inv.estado;

                    const lastReadingDate = getMexicoDateKey(ultima.timestamp);
                    if (lastReadingDate === currentDateKey && inv.estado === 'offline') {
                        inverterStoppedForDate.set(inv.id, currentDateKey);
                        inverterStoppedAt.set(inv.id, Date.now());
                    } else if (inv.estado !== 'offline') {
                        inverterStoppedForDate.delete(inv.id);
                        inverterStoppedAt.delete(inv.id);
                    }
                }

                if (typeof db.getLecturasByInversor === 'function') {
                    const lecturas = await db.getLecturasByInversor(inv.id, 500);
                    const latestReadingByDate = new Map();
                    (lecturas || []).forEach(lectura => {
                        if (!lectura.timestamp) return;
                        const dateKey = getMexicoDateKey(lectura.timestamp);
                        if (!latestReadingByDate.has(dateKey)) {
                            latestReadingByDate.set(dateKey, Number(lectura.energia_dia || 0));
                        }
                    });
                    dailyProductionByInverter.set(inv.id, latestReadingByDate);
                }
            } catch (e) {
                console.warn(`⚠️ No se pudo cargar lectura para ${inv.nombre}`);
            }
        }

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
        <tr style="background: #f1f5f9; font-weight: 600; border-top: 2px solid #d1d5db;">
            <td colspan="3" style="text-align: right; font-size: 13px; color: var(--text-secondary);">TOTAL</td>
            <td>${totalPower.toFixed(1)} kW</td>
            <td>${totalEnergy.toFixed(1)} kWh</td>
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

function getInverterName(inverterId) {
    return inverters.find(inverter => inverter.id === inverterId)?.nombre || inverterId || 'Inversor desconocido';
}

function renderDashboardAlerts() {
    const list = document.getElementById('alertsList');
    if (!list) return;
    list.innerHTML = alertasActivas.length
        ? alertasActivas.slice(0, 5).map(alerta => `
            <li>
                <strong>${escapeAlertText(getInverterName(alerta.inversor_id))}</strong>
                <span>${escapeAlertText(alerta.mensaje || alerta.tipo || 'Alerta activa')}</span>
            </li>`).join('')
        : '<li style="color:#64748b;">No hay alertas activas.</li>';
}

function renderAlertas() {
    const activeBody = document.getElementById('alertasActivasBody');
    const historyBody = document.getElementById('alertasHistoricoBody');
    const renderRow = (alerta, active) => `
        <tr>
            <td>${escapeAlertText(getInverterName(alerta.inversor_id))}</td>
            <td>${escapeAlertText(alerta.tipo || 'Sistema')}</td>
            <td>${escapeAlertText(alerta.mensaje || 'Sin descripción')}</td>
            <td>${escapeAlertText(alerta.fecha ? new Date(alerta.fecha).toLocaleString('es-MX') : 'Sin fecha')}</td>
            ${active
                ? `<td><button class="btn-outline" onclick="resolverAlertaUI('${escapeAlertText(alerta.id)}')">Resolver</button></td>`
                : `<td>${alerta.resuelta ? 'Resuelta' : 'Activa'}</td>`}
        </tr>`;

    if (activeBody) {
        activeBody.innerHTML = alertasActivas.length
            ? alertasActivas.map(alerta => renderRow(alerta, true)).join('')
            : '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:20px;">No hay alertas activas.</td></tr>';
    }
    if (historyBody) {
        historyBody.innerHTML = alertasHistorico.length
            ? alertasHistorico.map(alerta => renderRow(alerta, false)).join('')
            : '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:20px;">No hay alertas históricas.</td></tr>';
    }
}

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
    alertasActivas = (active || []).filter(alerta => assignedIds.has(alerta.inversor_id));
    alertasHistorico = (history || []).filter(alerta => assignedIds.has(alerta.inversor_id));
    renderAlertas();
    renderDashboardAlerts();
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
    try {
        if (inverterChartInstance) { inverterChartInstance.destroy(); inverterChartInstance = null; }
        const ctx1 = canvas1.getContext('2d');
        const sorted = [...inverters].sort((a, b) => b.energiaHoy - a.energiaHoy);
        const inverterLabels = sorted.length ? sorted.map(i => i.nombre) : ['Sin datos'];
        const inverterData = sorted.length ? sorted.map(i => Number(i.energiaHoy) || 0) : [0];
        const colors = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899'];
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
                layout: { padding: { top: 8, right: 10, left: 4, bottom: 0 } },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        displayColors: false,
                        backgroundColor: 'rgba(15,23,42,0.95)',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        padding: 10,
                        callbacks: {
                            label: (context) => ` ${context.parsed.y.toFixed(1)} kWh`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        border: { display: false },
                        ticks: {
                            color: '#475569',
                            font: { size: 11, weight: '500' },
                            maxRotation: 0,
                            minRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: 6,
                            callback: (value) => formatChartLabel(inverterLabels[value] || value, 10)
                        },
                        title: { display: true, text: 'Inversor', color: '#475569', font: { weight: '600', size: 12 } }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(148, 163, 184, 0.18)', drawBorder: false },
                        border: { display: false },
                        ticks: { color: '#475569', font: { size: 11 }, precision: 0 },
                        title: { display: true, text: 'kWh', color: '#475569', font: { weight: '600', size: 12 } }
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
                    backgroundColor: weeklyProduction.data.map((value, index) => value === 0 ? 'rgba(148, 163, 184, 0.12)' : weeklyColors[index]),
                    borderColor: 'rgba(255,255,255,0.3)',
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
                        ticks: { color: '#475569', font: { size: 11, weight: '500' } }
                    },
                    y: {
                        beginAtZero: true,
                        max: maxValue > 0 ? maxValue * 1.2 : 10,
                        grid: { color: 'rgba(148, 163, 184, 0.18)', drawBorder: false },
                        border: { display: false },
                        ticks: { color: '#475569', font: { size: 11 }, precision: 0 },
                        title: { display: true, text: 'kWh', color: '#475569', font: { weight: '600', size: 12 } }
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
    inverterChartInstance.data.labels = inverterLabels;
    inverterChartInstance.data.datasets[0].data = inverterData;
    inverterChartInstance.data.datasets[0].backgroundColor = inverterLabels.map((_, index) => colors[index % colors.length]);
    inverterChartInstance.data.datasets[0].borderColor = 'rgba(255,255,255,0.7)';
    inverterChartInstance.data.datasets[0].categoryPercentage = 0.62;
    inverterChartInstance.data.datasets[0].barPercentage = 0.75;
    inverterChartInstance.data.labels = inverterLabels;
    inverterChartInstance.options.scales.x.ticks.callback = (value) => formatChartLabel(inverterLabels[value] || value, 10);
    inverterChartInstance.update('none');

    const weeklyProduction = buildWeeklyProductionData();
    const weeklyColors = ['#34d399', '#2dd4bf', '#60a5fa', '#a78bfa', '#fbbf24', '#f97316', '#22c55e'];
    const weeklyDataset = weeklyChartInstance.data.datasets[0];
    weeklyDataset.data = weeklyProduction.data;
    weeklyDataset.backgroundColor = weeklyProduction.data.map((value, index) => value === 0 ? 'rgba(148, 163, 184, 0.12)' : weeklyColors[index]);
    weeklyDataset.borderColor = 'rgba(255,255,255,0.3)';
    weeklyDataset.categoryPercentage = 0.72;
    weeklyDataset.barPercentage = 0.8;
    weeklyChartInstance.options.scales.y.max = Math.max(...weeklyProduction.data, 10) * 1.2;
    weeklyChartInstance.update('none');
}

function initStatsChart() {
    const canvas = document.getElementById('statsChart');
    if (!canvas) { console.error('❌ No se encontró statsChart'); return; }
    const ctx = canvas.getContext('2d');
    if (statsChartInstance) statsChartInstance.destroy();
    statsChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'],
            datasets: [{
                label: 'Producción (kWh)',
                data: [25, 30, 28, 35, 42, 38, 45],
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'top' } },
            scales: { y: { beginAtZero: true, grid: { color: '#f1f5f9' } } }
        }
    });
}

// ============================================================
//  MODAL AGREGAR INVERSOR
// ============================================================

document.getElementById('btnAddInverter')?.addEventListener('click', () => {
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
    if (inverterChartInstance) {
        setTimeout(() => inverterChartInstance.resize(), 150);
    }
});

document.getElementById('btnExport')?.addEventListener('click', () => {
    alert('📄 Reporte exportado en formato CSV/PDF (simulación).');
});

document.getElementById('btnAddRule')?.addEventListener('click', () => {
    alert('🛠️ Abrir formulario para nueva regla (simulación).');
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
    }, 10000);
    
    console.log('✅ Dashboard inicializado correctamente');
}

// ============================================================
//  VERIFICAR SESIÓN AL CARGAR
// ============================================================

document.addEventListener('DOMContentLoaded', async function() {
    if (checkSession()) {
        await initDashboard();
    }
});

console.log('✅ Sistema de monitoreo cargado');