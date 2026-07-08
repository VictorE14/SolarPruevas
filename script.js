// ============================================================
//  DATOS MOCK
// ============================================================
let inverters = [
    { id: 1, nombre: 'Huawei-Planta Norte', marca: 'Huawei', modelo: 'SUN2000-10KTL-M1', ubicacion: 'Mérida, Yuc', potencia: 8.6, energiaHoy: 45.3, estado: 'online' },
    { id: 2, nombre: 'Huawei-Planta Sur', marca: 'Huawei', modelo: 'SUN2000-8KTL-M0', ubicacion: 'Progreso, Yuc', potencia: 7.2, energiaHoy: 39.2, estado: 'online' },
    { id: 3, nombre: 'Growatt-Planta Este', marca: 'Growatt', modelo: 'MIN 6000TL-X', ubicacion: 'Valladolid, Yuc', potencia: 4.5, energiaHoy: 29.8, estado: 'online' },
    { id: 4, nombre: 'Growatt-Planta Oeste', marca: 'Growatt', modelo: 'MAX 8000TL-X', ubicacion: 'Tizimín, Yuc', potencia: 3.8, energiaHoy: 22.4, estado: 'warning' },
    { id: 5, nombre: 'Growatt-Planta Centro', marca: 'Growatt', modelo: 'MIN 4500TL-X', ubicacion: 'Mérida, Yuc', potencia: 0.0, energiaHoy: 12.1, estado: 'offline' }
];

let alertasActivas = [
    { id: 1, inversor: 'Growatt-Planta Centro', tipo: 'Comunicación', mensaje: 'Sin comunicación desde hace 15 minutos', fecha: '2026-06-30 14:30' },
    { id: 2, inversor: 'Huawei-Planta Norte', tipo: 'Rendimiento', mensaje: 'Bajo rendimiento (8.6 kW < 9.0 kW esperado)', fecha: '2026-06-30 13:15' }
];

let alertasHistorico = [
    { id: 3, inversor: 'Growatt-Planta Este', tipo: 'Mantenimiento', mensaje: 'Mantenimiento programado completado', fecha: '2026-06-29 10:00' }
];

let reglas = [
    { id: 1, nombre: 'Rendimiento Bajo', condicion: 'Potencia < 90% capacidad', accion: 'Correo + Telegram', estado: 'Activa' },
    { id: 2, nombre: 'Falla Comunicación', condicion: 'Sin datos > 10 min', accion: 'Correo + WhatsApp', estado: 'Activa' }
];

let nextInverterId = 6;

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

// DASHBOARD KPIs
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
    if (fill) fill.style.width = `${(online / total) * 100}%`;

    document.getElementById('alertBadge').textContent = alertasActivas.length;
}

// DASHBOARD TABLE (con fila de TOTAL)
function renderDashboardTable() {
    const tbody = document.getElementById('inverterTableBody');
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

    // Fila de TOTAL (con unión de celdas)
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

// DASHBOARD ALERTS
function renderDashboardAlerts() {
    const list = document.getElementById('alertsList');
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

// INVERSORES (Tabla completa)
function renderFullInverterTable() {
    const tbody = document.getElementById('inverterFullTableBody');
    const brandFilter = document.getElementById('filterBrand').value;
    const statusFilter = document.getElementById('filterStatus').value;
    const searchTerm = document.getElementById('searchInverter').value.toLowerCase();

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
                <button class="btn-outline" style="padding:4px 10px; font-size:12px;" onclick="viewInverter(${inv.id})"><i class="fas fa-eye"></i></button>
                <button class="btn-outline" style="padding:4px 10px; font-size:12px; color:var(--danger);" onclick="deleteInverter(${inv.id})"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

// ALERTAS
function renderAlertas() {
    // Activas
    const tbodyA = document.getElementById('alertasActivasBody');
    if (alertasActivas.length === 0) {
        tbodyA.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#64748b; padding:20px;">No hay alertas activas.</td></tr>`;
    } else {
        tbodyA.innerHTML = alertasActivas.map(a => `
            <tr>
                <td><strong>${a.inversor}</strong></td>
                <td><span class="brand-badge">${a.tipo}</span></td>
                <td>${a.mensaje}</td>
                <td>${a.fecha}</td>
                <td><button class="btn-outline" style="padding:4px 12px; font-size:12px; color:var(--success);" onclick="resolveAlert(${a.id})">Resolver</button></td>
            </tr>
        `).join('');
    }

    // Histórico
    const tbodyH = document.getElementById('alertasHistoricoBody');
    if (alertasHistorico.length === 0) {
        tbodyH.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#64748b; padding:20px;">No hay historial.</td></tr>`;
    } else {
        tbodyH.innerHTML = alertasHistorico.map(a => `
            <tr>
                <td><strong>${a.inversor}</strong></td>
                <td><span class="brand-badge">${a.tipo}</span></td>
                <td>${a.mensaje}</td>
                <td>${a.fecha}</td>
                <td><span class="status-badge"><span class="dot online"></span> Resuelta</span></td>
            </tr>
        `).join('');
    }

    // Reglas
    const tbodyR = document.getElementById('reglasBody');
    tbodyR.innerHTML = reglas.map((r, i) => `
        <tr>
            <td>${i + 1}</td>
            <td><strong>${r.nombre}</strong></td>
            <td>${r.condicion}</td>
            <td>${r.accion}</td>
            <td><span class="status-badge"><span class="dot online"></span> ${r.estado}</span></td>
            <td>
                <button class="btn-outline" style="padding:4px 10px; font-size:12px;" onclick="alert('Editar regla (simulación)')"><i class="fas fa-edit"></i></button>
                <button class="btn-outline" style="padding:4px 10px; font-size:12px; color:var(--danger);" onclick="alert('Eliminar regla (simulación)')"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

// ============================================================
//  GRÁFICAS CON CHART.JS
// ============================================================
let weeklyChartInstance = null;
let inverterChartInstance = null;
let statsChartInstance = null;

function initDashboardCharts() {
    // ============================================================
    // GRÁFICA 1: Producción por Inversor (Hoy) - PRINCIPAL
    // ============================================================
    const ctx1 = document.getElementById('inverterChart').getContext('2d');
    if (inverterChartInstance) inverterChartInstance.destroy();

    // Ordenar inversores por producción (de mayor a menor)
    const sorted = [...inverters].sort((a, b) => b.energiaHoy - a.energiaHoy);

    const colors = [
        '#3b82f6', // Azul
        '#10b981', // Verde
        '#f59e0b', // Naranja
        '#8b5cf6', // Morado
        '#ef4444', // Rojo
        '#06b6d4', // Cian
        '#ec4899'  // Rosa
    ];

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
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.parsed.x.toFixed(1) + ' kWh';
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    grid: { color: '#f1f5f9' },
                    title: { display: true, text: 'kWh' }
                },
                y: {
                    grid: { display: false }
                }
            }
        }
    });

    // ============================================================
    // GRÁFICA 2: Producción Total (últimos 7 días) - SECUNDARIA
    // ============================================================
    const ctx2 = document.getElementById('weeklyChart').getContext('2d');
    if (weeklyChartInstance) weeklyChartInstance.destroy();

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
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.parsed.y.toFixed(1) + ' kWh totales';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: '#f1f5f9' },
                    title: { display: true, text: 'kWh' }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });
}

function initStatsChart() {
    const ctx = document.getElementById('statsChart').getContext('2d');
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
//  ACCIONES (View, Delete, Resolve)
// ============================================================
window.viewInverter = function(id) {
    const inv = inverters.find(i => i.id === id);
    if (!inv) return;
    alert(`📋 Detalle de ${inv.nombre}\nMarca: ${inv.marca}\nModelo: ${inv.modelo}\nUbicación: ${inv.ubicacion}\nPotencia: ${inv.potencia} kW\nEnergía Hoy: ${inv.energiaHoy} kWh\nEstado: ${inv.estado}`);
};

window.deleteInverter = function(id) {
    if (confirm('¿Eliminar este inversor?')) {
        inverters = inverters.filter(i => i.id !== id);
        renderFullInverterTable();
        renderDashboardTable();
        renderDashboardKPIs();
        initDashboardCharts();
    }
};

window.resolveAlert = function(id) {
    const alert = alertasActivas.find(a => a.id === id);
    if (alert) {
        alertasHistorico.push({ ...alert });
        alertasActivas = alertasActivas.filter(a => a.id !== id);
        renderAlertas();
        renderDashboardAlerts();
        renderDashboardKPIs();
    }
};

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
        document.getElementById('sidebar').classList.remove('open');
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
//  MODAL AGREGAR INVERSOR
// ============================================================
document.getElementById('btnAddInverter').addEventListener('click', () => {
    document.getElementById('modalInverter').classList.add('open');
});

document.getElementById('closeModal').addEventListener('click', () => {
    document.getElementById('modalInverter').classList.remove('open');
});
document.getElementById('cancelModal').addEventListener('click', () => {
    document.getElementById('modalInverter').classList.remove('open');
});
document.getElementById('modalInverter').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) document.getElementById('modalInverter').classList.remove('open');
});

document.getElementById('saveInverter').addEventListener('click', () => {
    const nombre = document.getElementById('invNombre').value.trim();
    const marca = document.getElementById('invMarca').value;
    const modelo = document.getElementById('invModelo').value.trim() || 'No especificado';
    const ubicacion = document.getElementById('invUbicacion').value.trim() || 'No especificada';
    if (!nombre) { alert('El nombre es obligatorio.'); return; }
    inverters.push({
        id: nextInverterId++,
        nombre: nombre,
        marca: marca,
        modelo: modelo,
        ubicacion: ubicacion,
        potencia: 0,
        energiaHoy: 0,
        estado: 'offline'
    });
    document.getElementById('modalInverter').classList.remove('open');
    renderFullInverterTable();
    renderDashboardTable();
    renderDashboardKPIs();
    initDashboardCharts();
});

// ============================================================
//  FILTROS (Inversores)
// ============================================================
document.getElementById('searchInverter').addEventListener('input', renderFullInverterTable);
document.getElementById('filterBrand').addEventListener('change', renderFullInverterTable);
document.getElementById('filterStatus').addEventListener('change', renderFullInverterTable);

// ============================================================
//  BOTONES ADICIONALES
// ============================================================
document.getElementById('btnExport').addEventListener('click', () => {
    alert('📄 Reporte exportado en formato CSV/PDF (simulación).');
});

document.getElementById('btnAddRule').addEventListener('click', () => {
    alert('🛠️ Abrir formulario para nueva regla (simulación).');
});

// ============================================================
//  MENÚ MÓVIL
// ============================================================
document.getElementById('menuToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
});

document.addEventListener('click', (e) => {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('menuToggle');
    if (window.innerWidth <= 768 && !sidebar.contains(e.target) && !toggle.contains(e.target)) {
        sidebar.classList.remove('open');
    }
});

// ============================================================
//  INICIALIZACIÓN
// ============================================================
renderDashboardKPIs();
renderDashboardTable();
renderDashboardAlerts();
renderFullInverterTable();
renderAlertas();
initDashboardCharts();

// Simular tiempo real (cada 10s)
setInterval(() => {
    inverters.forEach(inv => {
        if (inv.estado === 'online') {
            const v = (Math.random() * 0.8) - 0.4;
            inv.potencia = Math.max(0, inv.potencia + v);
            inv.energiaHoy += v * 0.5;
        }
    });
    renderDashboardKPIs();
    renderDashboardTable();
    renderFullInverterTable();
    initDashboardCharts();
}, 10000);

console.log('✅ CRODE Solar SPA funcionando correctamente.');