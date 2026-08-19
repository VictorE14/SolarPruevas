// ============================================================
//  SISTEMA DE MONITOREO - CON SUPABASE (SIN LOGIN PROPIO)
// ============================================================

if (typeof window.db === 'undefined') {
    console.error('❌ Error: window.db no está definido');
    alert('Error de conexión con la base de datos');
}

const db = window.db || {};
let inverters = [];
let usuarioActual = null;
let alertasActivas = [];
let intervalId = null;

// ============================================================
//  VERIFICAR SESIÓN
// ============================================================

function checkSession() {
    const saved = localStorage.getItem('usuarioActual');
    if (saved) {
        try {
            const usuario = JSON.parse(saved);
            if (usuario.rol === 'admin') {
                window.location.href = 'admin/index.html';
                return false;
            }
            usuarioActual = usuario;
            return true;
        } catch (e) {
            window.location.href = 'login.html';
            return false;
        }
    }
    window.location.href = 'login.html';
    return false;
}

function getCurrentUser() { return usuarioActual; }
function isAdmin() { return usuarioActual && usuarioActual.rol === 'admin'; }
function isTecnico() { return usuarioActual && usuarioActual.rol === 'tecnico'; }

// ============================================================
//  CARGAR DATOS DESDE SUPABASE
// ============================================================

async function loadInverters() {
    try {
        let data;
        if (isAdmin()) {
            data = await db.getAllInversores();
        } else if (usuarioActual) {
            data = await db.getInversoresByUsuario(usuarioActual.id);
        } else {
            return [];
        }
        
        inverters = data.map(inv => ({
            id: inv.id,
            nombre: inv.nombre,
            marca: inv.marca,
            modelo: inv.modelo || 'No especificado',
            ubicacion: inv.ubicacion || 'No especificada',
            potencia: 0,
            energiaHoy: 0,
            estado: inv.estado || 'offline'
        }));
        
        for (const inv of inverters) {
            try {
                const ultima = await db.getUltimaLectura(inv.id);
                if (ultima) {
                    inv.potencia = ultima.potencia_ac || 0;
                    inv.energiaHoy = ultima.energia_dia || 0;
                    inv.estado = ultima.estado_operativo || inv.estado;
                }
            } catch (e) {
                console.warn(`⚠️ No se pudo cargar lectura para ${inv.nombre}`);
            }
        }
        
        console.log(`✅ ${inverters.length} inversores cargados para ${usuarioActual?.nombre || 'Invitado'}`);
        return inverters;
    } catch (error) {
        console.error('❌ Error al cargar inversores:', error);
        return [];
    }
}

async function loadAlertas() {
    try {
        const data = await db.getAlertasActivas();
        alertasActivas = data.map(a => ({
            id: a.id,
            inversor: a.inversor_nombre || 'Inversor desconocido',
            tipo: a.tipo,
            mensaje: a.mensaje,
            fecha: new Date(a.fecha).toLocaleString()
        }));
        return alertasActivas;
    } catch (error) {
        console.error('❌ Error al cargar alertas:', error);
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

function renderDashboardAlerts() {
    const list = document.getElementById('alertsList');
    if (!list) return;
    
    if (alertasActivas.length === 0) {
        list.innerHTML = '<li class="success"><i class="fas fa-check-circle" style="color:var(--success);"></i> No hay alertas activas.</li>';
        return;
    }
    list.innerHTML = alertasActivas.map(a => `
        <li class="${a.tipo === 'Comunicación' ? 'danger' : ''}">
            <i class="fas ${a.tipo === 'Comunicación' ? 'fa-exclamation-circle' : 'fa-exclamation-triangle'}"></i>
            ${a.inversor} - ${a.mensaje}
        </li>
    `).join('');
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

function renderAlertas() {
    const tbodyA = document.getElementById('alertasActivasBody');
    if (tbodyA) {
        if (alertasActivas.length === 0) {
            tbodyA.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#64748b; padding:20px;">No hay alertas activas.</td></tr>`;
        } else {
            tbodyA.innerHTML = alertasActivas.map(a => `
                <tr>
                    <td><strong>${a.inversor}</strong></td>
                    <td><span class="brand-badge">${a.tipo}</span></td>
                    <td>${a.mensaje}</td>
                    <td>${a.fecha}</td>
                    <td><button class="btn-outline" style="padding:4px 12px; font-size:12px; color:var(--success);" onclick="resolverAlertaUI('${a.id}')">Resolver</button></td>
                </tr>
            `).join('');
        }
    }
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

// ============================================================
//  CLIMA Y RADIACIÓN
// ============================================================

const OPENWEATHER_API_KEY = 'bb1b7a894209951686c60bc533f45108';
const SOLCAST_API_KEY = 'B1v47_nx8Ecp5a6xZtIXEJQY1BMDJvgY';
const SOLCAST_SITE_ID = 'f6b5-c254-bf60-1ca7';
const CRODE_LAT = 20.967;
const CRODE_LON = -89.592;

async function fetchWeatherData() {
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
        return null;
    }
}

async function fetchSolarRadiation() {
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
        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899'];
        inverterChartInstance = new Chart(ctx1, {
            type: 'bar',
            data: {
                labels: sorted.map(i => i.nombre),
                datasets: [{
                    label: 'Energía Hoy (kWh)',
                    data: sorted.map(i => i.energiaHoy),
                    backgroundColor: sorted.map((_, index) => colors[index % colors.length]),
                    borderRadius: 6,
                    borderSkipped: false,
                    barThickness: 32,
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { beginAtZero: true, grid: { color: '#f1f5f9' }, title: { display: true, text: 'kWh' } },
                    y: { grid: { display: false } }
                }
            }
        });
        console.log('✅ Gráfica de inversores creada');
    } catch (e) { console.error('❌ Error en gráfica de inversores:', e); }
    try {
        if (weeklyChartInstance) { weeklyChartInstance.destroy(); weeklyChartInstance = null; }
        const ctx2 = canvas2.getContext('2d');
        const days = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
        const totalProduction = [45, 52, 48, 55, 60, 58, 62];
        weeklyChartInstance = new Chart(ctx2, {
            type: 'bar',
            data: {
                labels: days,
                datasets: [{
                    label: 'kWh totales',
                    data: totalProduction,
                    backgroundColor: '#3b82f6',
                    borderRadius: 6,
                    borderSkipped: false,
                    barThickness: 28,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, grid: { color: '#f1f5f9' }, title: { display: true, text: 'kWh' } },
                    x: { grid: { display: false } }
                }
            }
        });
        console.log('✅ Gráfica semanal creada');
    } catch (e) { console.error('❌ Error en gráfica semanal:', e); }
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
        initDashboardCharts();
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
//  CERRAR SESIÓN
// ============================================================

document.getElementById('logoutBtn')?.addEventListener('click', function() {
    if (confirm('¿Cerrar sesión?')) {
        localStorage.removeItem('usuarioActual');
        window.location.href = 'login.html';
    }
});

// ============================================================
//  INICIALIZACIÓN
// ============================================================

async function initDashboard() {
    console.log('🚀 Inicializando Dashboard...');
    console.log('👤 Usuario:', usuarioActual?.nombre || 'Invitado');
    console.log('📋 Rol:', usuarioActual?.rol || 'Sin rol');
    
    await loadInverters();
    await loadAlertas();
    
    console.log('📊 Inversores cargados:', inverters.length);
    console.log('🔔 Alertas activas:', alertasActivas.length);
    
    renderDashboardKPIs();
    renderDashboardTable();
    renderDashboardAlerts();
    renderFullInverterTable();
    renderAlertas();
    
    initDashboardCharts();
    initWeatherWidget();
    startWeatherUpdates();
    
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(async () => {
        await loadInverters();
        await loadAlertas();
        renderDashboardKPIs();
        renderDashboardTable();
        renderDashboardAlerts();
        renderFullInverterTable();
        renderAlertas();
        initDashboardCharts();
    }, 10000);
    
    console.log('✅ Dashboard inicializado correctamente');
}

// ============================================================
//  VERIFICAR SESIÓN AL CARGAR
// ============================================================

document.addEventListener('DOMContentLoaded', async function() {
    if (checkSession()) {
        document.getElementById('loginPage').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        
        document.getElementById('userName').textContent = usuarioActual.nombre;
        document.getElementById('userRole').textContent = usuarioActual.rol.charAt(0).toUpperCase() + usuarioActual.rol.slice(1);
        const initials = usuarioActual.nombre.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
        document.getElementById('userAvatar').textContent = initials;
        
        await initDashboard();
    }
});

console.log('✅ Sistema de monitoreo cargado');