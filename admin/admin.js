// ============================================================
//  ADMIN - CON SUPABASE (VERIFICAR SESIÓN)
// ============================================================

if (typeof window.db === 'undefined') {
    console.error('❌ Error: window.db no está definido');
    alert('Error de conexión con la base de datos');
}

const db = window.db || {};
const bcryptLib = window.bcrypt || (window.dcodeIO && window.dcodeIO.bcrypt) || null;
if (bcryptLib && !window.bcrypt) {
    window.bcrypt = bcryptLib;
}

let tecnicos = [];
let inversoresAdmin = [];
let inversorAssignmentCounts = {};
let inversorAssignments = {};
let usuarioAdmin = null;
let adminApiIntervalId = null;
let adminGrowattErrorSnapshot = sessionStorage.getItem('crode-admin-growatt-error') === 'true';
let adminApiSyncInProgress = false;
const ADMIN_API_RETRY_MS = 30 * 1000;
const ADMIN_API_RETRY_MAX_MS = 5 * 60 * 1000;
const ADMIN_API_RATE_LIMIT_RETRY_MS = 5 * 60 * 1000;
const adminApiRetryState = new Map();

function showToast(message, type = 'info') {
    const existingToast = document.getElementById('crode-toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.id = 'crode-toast';
    toast.textContent = message;
    toast.style.position = 'fixed';
    toast.style.right = '20px';
    toast.style.bottom = '20px';
    toast.style.zIndex = '2000';
    toast.style.padding = '10px 14px';
    toast.style.borderRadius = '10px';
    toast.style.fontSize = '13px';
    toast.style.fontWeight = '600';
    toast.style.color = '#fff';
    toast.style.boxShadow = '0 10px 25px rgba(15, 23, 42, 0.2)';
    toast.style.background = type === 'error' ? '#ef4444' : type === 'success' ? '#22c55e' : '#2563eb';
    toast.style.maxWidth = '320px';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(12px)';
    toast.style.transition = 'all 0.2s ease';
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(12px)';
        setTimeout(() => toast.remove(), 200);
    }, 2200);
}

async function refreshTecnicos() {
    if (typeof window.refreshData === 'function') {
        return window.refreshData();
    }
    return initAdmin();
}

// ============================================================
//  ADMIN - VERIFICAR SESIÓN (CORREGIDO)
// ============================================================

function checkAdminSession() {
    const sessionUser = window.CRODE_SESSION && typeof window.CRODE_SESSION.getUser === 'function'
        ? window.CRODE_SESSION.getUser()
        : null;

    if (!sessionUser) {
        if (window.CRODE_SESSION && typeof window.CRODE_SESSION.clear === 'function') {
            window.CRODE_SESSION.clear();
        }
        window.location.href = '../index.html';
        return false;
    }

    if (sessionUser.rol !== 'admin') {
        alert('No tienes permisos de administrador');
        if (window.CRODE_SESSION && typeof window.CRODE_SESSION.clear === 'function') {
            window.CRODE_SESSION.clear();
        }
        window.location.href = '../index.html';
        return false;
    }

    usuarioAdmin = sessionUser;
    const userNameEl = document.getElementById('userName');
    const userRoleEl = document.getElementById('userRole');
    const userAvatarEl = document.getElementById('userAvatar');

    if (userNameEl) userNameEl.textContent = sessionUser.nombre;
    if (userRoleEl) userRoleEl.textContent = 'Administrador';
    if (userAvatarEl) {
        const initials = (sessionUser.nombre || 'AD').split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
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
        window.location.href = '../index.html';
    }
});

// ============================================================
//  ADMIN - CARGAR DATOS (CORREGIDO)
// ============================================================

async function loadTecnicos() {
    try {
        // Verificar que db existe y tiene la función
        if (!db || typeof db.getUsuarios !== 'function') {
            console.error('❌ db.getUsuarios no está disponible');
            // Intentar recargar supabase.js
            if (window.db) {
                console.log('🔄 Intentando usar window.db directamente');
                const data = await window.db.getUsuarios();
                tecnicos = data.filter(u => u.rol !== 'admin');
                console.log(`✅ ${tecnicos.length} técnicos cargados desde window.db`);
                return tecnicos;
            }
            // Si aún no funciona, usar datos mock como fallback
            console.warn('⚠️ Usando datos mock como fallback');
            return getMockTecnicos();
        }
        
        // Obtener datos reales de Supabase
        const data = await db.getUsuarios();
        console.log('📊 Datos de usuarios desde Supabase:', data);
        
        // Filtrar solo técnicos (excluir admin)
        tecnicos = data.filter(u => u.rol !== 'admin');
        console.log(`✅ ${tecnicos.length} técnicos cargados desde Supabase`);
        console.log('📋 Lista de técnicos:', tecnicos.map(t => `- ${t.nombre} (${t.email})`).join('\n'));
        
        return tecnicos;
    } catch (error) {
        console.error('❌ Error al cargar técnicos:', error);
        console.warn('⚠️ Usando datos mock como fallback');
        return getMockTecnicos();
    }
}

async function loadAdminInversores() {
    try {
        if (!db || typeof db.getAllInversores !== 'function') {
            console.warn('⚠️ db.getAllInversores no disponible, usando datos mock');
            inversoresAdmin = getMockInversores();
            return inversoresAdmin;
        }
        const data = await db.getAllInversores();
        inversoresAdmin = Array.isArray(data) ? data : getMockInversores();
        console.log(`✅ ${inversoresAdmin.length} inversores cargados`);
        return inversoresAdmin;
    } catch (error) {
        console.error('❌ Error al cargar inversores:', error);
        inversoresAdmin = getMockInversores();
        return inversoresAdmin;
    }
}

async function loadInversorAssignmentCounts() {
    if (typeof db.getInversorAssignmentCounts !== 'function') {
        inversorAssignmentCounts = {};
        await loadInversorAssignments();
        return inversorAssignmentCounts;
    }

    try {
        inversorAssignmentCounts = await db.getInversorAssignmentCounts();
    } catch (error) {
        console.warn('⚠️ No se pudieron cargar los conteos de inversores asignados:', error.message);
        inversorAssignmentCounts = {};
    }
    await loadInversorAssignments();
    return inversorAssignmentCounts;
}

async function loadInversorAssignments() {
    if (typeof db.getInversorAssignments !== 'function') {
        inversorAssignments = {};
        return inversorAssignments;
    }

    try {
        inversorAssignments = await db.getInversorAssignments();
    } catch (error) {
        console.warn('⚠️ No se pudieron cargar las asignaciones de inversores:', error.message);
        inversorAssignments = {};
    }
    return inversorAssignments;
}

function closeAssignedTechniciansPopover() {
    document.querySelector('.assigned-technicians-popover')?.remove();
}

document.addEventListener('click', event => {
    if (event.target.closest('.assigned-technicians-popover')) return;
    const trigger = event.target.closest('.assigned-technicians-trigger');
    closeAssignedTechniciansPopover();
    if (!trigger) return;

    const names = JSON.parse(trigger.dataset.names || '[]');
    if (!names.length) return;

    const popover = document.createElement('div');
    popover.className = 'assigned-technicians-popover';
    popover.innerHTML = `<div class="assigned-technicians-popover-title">Técnicos asignados</div>${names.map(name => `<div class="assigned-technician-item">${escapeHtml(name)}</div>`).join('')}`;
    const triggerRect = trigger.getBoundingClientRect();
    const popoverWidth = Math.min(280, window.innerWidth - 24);
    popover.style.width = `${popoverWidth}px`;
    document.body.appendChild(popover);

    const left = Math.min(triggerRect.left, window.innerWidth - popoverWidth - 12);
    const opensUp = triggerRect.bottom + popover.offsetHeight > window.innerHeight - 12;
    popover.style.left = `${Math.max(12, left)}px`;
    popover.style.top = `${opensUp ? triggerRect.top - popover.offsetHeight - 6 : triggerRect.bottom + 6}px`;
});

// ============================================================
//  DATOS MOCK CON UUIDs VÁLIDOS
// ============================================================

function hashPasswordForStorage(password) {
    if (!password) return null;
    const bcryptInstance = window.bcrypt || (window.dcodeIO && window.dcodeIO.bcrypt);
    if (!bcryptInstance || typeof bcryptInstance.hashSync !== 'function') {
        throw new Error('La biblioteca bcrypt no está disponible para cifrar la contraseña.');
    }
    return bcryptInstance.hashSync(password, 10);
}

function getMockTecnicos() {
    return [
        { id: '22222222-2222-2222-2222-222222222222', nombre: 'Juan Técnico', email: 'juan@crode.mx', password_hash: '', rol: 'tecnico', estado: 'activo' },
        { id: '33333333-3333-3333-3333-333333333333', nombre: 'Pedro Técnico', email: 'pedro@crode.mx', password_hash: '', rol: 'tecnico', estado: 'activo' }
    ];
}

function getMockInversores() {
    return [
        { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', nombre: 'Huawei-Planta Norte', marca: 'Huawei', modelo: 'SUN2000-10KTL-M1', ubicacion: 'Mérida, Yuc', estado: 'online', usuario_id: null },
        { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', nombre: 'Huawei-Planta Sur', marca: 'Huawei', modelo: 'SUN2000-8KTL-M0', ubicacion: 'Progreso, Yuc', estado: 'online', usuario_id: null },
        { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', nombre: 'Growatt-Planta Este', marca: 'Growatt', modelo: 'MIN 6000TL-X', ubicacion: 'Valladolid, Yuc', estado: 'online', usuario_id: null },
        { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', nombre: 'Growatt-Planta Oeste', marca: 'Growatt', modelo: 'MAX 8000TL-X', ubicacion: 'Tizimín, Yuc', estado: 'warning', usuario_id: null },
        { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', nombre: 'Growatt-Planta Centro', marca: 'Growatt', modelo: 'MIN 4500TL-X', ubicacion: 'Mérida, Yuc', estado: 'offline', usuario_id: null }
    ];
}

// ============================================================
//  RENDERIZADO
// ============================================================

function getStatusBadge(status) {
    const map = {
        online: '<span class="status-badge"><span class="dot online"></span> Online</span>',
        warning: '<span class="status-badge"><span class="dot warning"></span> Advertencia</span>',
        offline: '<span class="status-badge"><span class="dot offline"></span> Offline</span>',
        activo: '<span class="status-badge"><span class="dot online"></span> Activo</span>',
        inactivo: '<span class="status-badge"><span class="dot offline"></span> Inactivo</span>'
    };
    return map[status] || status;
}

function renderAdminKPIs() {
    const technicians = tecnicos.filter(t => t.rol === 'tecnico');
    const total = technicians.length;
    const activos = technicians.filter(t => t.estado === 'activo').length;
    const inactivos = total - activos;

    document.getElementById('totalTecnicos').textContent = total;
    document.getElementById('totalInversores').textContent = inversoresAdmin.length;
    document.getElementById('totalAlertas').textContent = '0';
    document.getElementById('totalInactivos').textContent = inactivos;
    document.getElementById('sysTotalTecnicos').value = total;
    document.getElementById('sysTotalInversores').value = inversoresAdmin.length;
    document.getElementById('sysTotalAlertas').value = '0';
}

// ============================================================
//  ADMIN - RENDER TÉCNICOS (CON LOGS)
// ============================================================

function renderUserRoleTable(role, tableId) {
    const tbody = document.getElementById(tableId);
    if (!tbody) {
        console.error(`❌ No se encontró el elemento ${tableId}`);
        return;
    }

    const users = tecnicos.filter(user => user.rol === role);

    if (users.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${role === 'tecnico' ? 7 : 6}" style="text-align:center;color:#64748b;padding:20px;">
            No hay usuarios con el rol ${role} registrados.
        </td></tr>`;
        return;
    }

    tbody.innerHTML = users.map((t, i) => {
        const invCount = inversorAssignmentCounts[t.id] ||
            inversoresAdmin.filter(inv => inv.usuario_id === t.id).length;
        const estadoColor = t.estado === 'activo' ? '#22c55e' : '#ef4444';
        const estadoText = t.estado === 'activo' ? 'Activo' : 'Inactivo';
        return `
            <tr>
                <td>${i + 1}</td>
                <td><strong>${t.nombre}</strong></td>
                <td>${t.email}</td>
                <td><span class="brand-badge">${t.rol || 'tecnico'}</span></td>
                <td>
                    <span style="display:inline-flex;align-items:center;gap:6px;">
                        <span style="width:8px;height:8px;border-radius:50%;background:${estadoColor};display:inline-block;"></span>
                        ${estadoText}
                    </span>
                </td>
                ${role === 'tecnico' ? `<td>${invCount}</td>` : ''}
                <td>
                    <button class="btn-outline" style="padding:4px 10px;font-size:12px;" onclick="editarTecnicoUI('${t.id}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-outline" style="padding:4px 10px;font-size:12px;color:var(--danger);" onclick="eliminarTecnicoUI('${t.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    console.log(`✅ ${users.length} usuarios con rol ${role} renderizados`);
}

function renderTecnicos() {
    renderUserRoleTable('tecnico', 'tecnicosTableBody');
    renderUserRoleTable('admin', 'administradoresTableBody');
    renderUserRoleTable('invitado', 'invitadosTableBody');
}

let logsActividad = [];

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[character]));
}

function renderLogs() {
    const fullBody = document.getElementById('logsTableBody');
    const recentBody = document.getElementById('ultimosLogsBody');
    const search = document.getElementById('searchLogs')?.value?.trim().toLowerCase() || '';
    const action = document.getElementById('filterLogAction')?.value || 'all';
    const filtered = logsActividad.filter(log => {
        const user = String(log.usuario_nombre || '').toLowerCase();
        return (!search || user.includes(search)) && (action === 'all' || log.accion === action);
    });

    const row = log => `
        <tr>
            <td>${escapeHtml(log.fecha ? new Date(log.fecha).toLocaleString('es-MX') : 'Sin fecha')}</td>
            <td>${escapeHtml(log.usuario_nombre || 'Sistema')}</td>
            <td>${escapeHtml(log.accion || 'Sin acción')}</td>
            <td>${escapeHtml(log.descripcion || '')}</td>
        </tr>`;

    if (fullBody) {
        fullBody.innerHTML = filtered.length
            ? filtered.map(row).join('')
            : '<tr><td colspan="4" style="text-align:center;color:#64748b;padding:20px;">No hay accesos registrados.</td></tr>';
    }
    if (recentBody) {
        recentBody.innerHTML = filtered.slice(0, 5).map(row).join('');
    }
}

async function loadLogs() {
    if (!db || typeof db.getLogs !== 'function') {
        throw new Error('La función de logs no está disponible.');
    }
    logsActividad = await db.getLogs(100);
    renderLogs();
}

// ============================================================
//  RENDER ADMIN INVERSORES - CON CAMBIO DE ESTADO
// ============================================================

function renderAdminInversores() {
    const tbody = document.getElementById('inversoresAdminBody');
    if (!tbody) return;

    const searchTerm = document.getElementById('searchInverterAdmin')?.value?.toLowerCase() || '';
    const brandFilter = document.getElementById('filterBrandAdmin')?.value || 'all';

    let filtered = inversoresAdmin.filter(inv => {
        const matchSearch = inv.nombre.toLowerCase().includes(searchTerm);
        const matchBrand = brandFilter === 'all' || inv.marca === brandFilter;
        return matchSearch && matchBrand;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#64748b;padding:20px;">No se encontraron inversores.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map((inv, i) => {
        const assignedIds = inversorAssignments[inv.id] || (inv.usuario_id ? [inv.usuario_id] : []);
        const assignedTechnicians = assignedIds
            .map(id => tecnicos.find(t => t.id === id))
            .filter(Boolean);
        const assignedSummary = assignedTechnicians.length
            ? `${assignedTechnicians[0].nombre}${assignedTechnicians.length > 1 ? ` +${assignedTechnicians.length - 1}` : ''}`
            : 'Sin asignar';
        const assignedNames = assignedTechnicians.map(technician => technician.nombre);
        const estadoOptions = `
            <option value="online" ${inv.estado === 'online' ? 'selected' : ''}>🟢 Online</option>
            <option value="warning" ${inv.estado === 'warning' ? 'selected' : ''}>🟡 Advertencia</option>
            <option value="offline" ${inv.estado === 'offline' ? 'selected' : ''}>🔴 Offline</option>
        `;
        return `
            <tr>
                <td>${i + 1}</td>
                <td><strong>${inv.nombre}</strong></td>
                <td><span class="brand-badge ${inv.marca.toLowerCase()}">${inv.marca}</span></td>
                <td>${inv.modelo || 'No especificado'}</td>
                <td>${inv.ubicacion || 'No especificada'}</td>
                <td>
                    <button type="button" class="assigned-technicians-trigger" title="Ver técnicos asignados" data-names="${escapeHtml(JSON.stringify(assignedNames))}">
                        <span>${escapeHtml(assignedSummary)}</span><i class="fas fa-chevron-down"></i>
                    </button>
                </td>
                <td>
                    <select class="estado-select" data-id="${inv.id}" style="padding:4px 8px;border-radius:6px;border:1px solid #e2e8f0;font-size:12px;background:white;cursor:pointer;">
                        ${estadoOptions}
                    </select>
                </td>
                <td>
                    <button class="btn-outline" style="padding:4px 10px;font-size:12px;" onclick="editarInverterAdminUI('${inv.id}')"><i class="fas fa-edit"></i></button>
                    <button class="btn-outline" style="padding:4px 10px;font-size:12px;color:var(--danger);" onclick="eliminarInverterAdminUI('${inv.id}')"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `;
    }).join('');

    document.querySelectorAll('.estado-select').forEach(select => {
        select.addEventListener('change', async function() {
            const id = this.dataset.id;
            const nuevoEstado = this.value;
            await cambiarEstadoInversor(id, nuevoEstado);
        });
    });
}

function renderAdminApiStatus() {
    const body = document.getElementById('adminApiStatusBody');
    if (!body) return;

    if (!inversoresAdmin.length) {
        body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:20px;">No hay inversores configurados.</td></tr>';
        return;
    }

    body.innerHTML = inversoresAdmin.map(inverter => {
        const apiStatus = inverter.api_status || 'pending';
        const status = apiStatus === 'connected' ? 'Conectada' : apiStatus === 'error' ? 'Error' : 'Pendiente';
        const color = apiStatus === 'connected' ? '#16a34a' : apiStatus === 'error' ? '#dc2626' : '#64748b';
        const canDiagnose = inverter.marca?.toLowerCase() === 'growatt';
        return `
            <tr>
                <td><strong>${escapeHtml(inverter.nombre)}</strong></td>
                <td>${escapeHtml(inverter.marca)}</td>
                <td><span style="color:${color};font-weight:600;">${status}</span></td>
                <td>${formatAdminSyncDate(inverter.api_last_sync)}</td>
                <td>${canDiagnose ? `<button class="btn-outline admin-api-diagnostic-btn" data-id="${escapeHtml(inverter.id)}">Diagnosticar</button>` : '<span style="color:#64748b;font-size:12px;">No disponible</span>'}</td>
            </tr>`;
    }).join('');

    body.querySelectorAll('.admin-api-diagnostic-btn').forEach(button => {
        button.addEventListener('click', () => diagnoseAdminApi(button.dataset.id));
    });
}

function formatAdminSyncDate(value) {
    return value ? new Date(value).toLocaleString('es-MX') : 'Sin sincronización';
}

async function diagnoseAdminApi(id) {
    const inverter = inversoresAdmin.find(item => item.id === id);
    if (!inverter) return;
    const button = document.querySelector(`.admin-api-diagnostic-btn[data-id="${id}"]`);
    if (button) {
        button.disabled = true;
        button.textContent = 'Consultando...';
    }

    try {
        if (typeof db.sincronizarGrowatt !== 'function') {
            throw new Error('La sincronización Growatt no está disponible.');
        }
        const result = await db.sincronizarGrowatt(id);
        inversoresAdmin = await db.getAllInversores();
        renderAdminApiStatus();
        renderAdminInversores();
        const power = result?.powerKw !== undefined ? ` Potencia: ${result.powerKw} kW.` : '';
        alert(`"${inverter.nombre}" se sincronizó correctamente.${power}`);
    } catch (error) {
        inversoresAdmin = await db.getAllInversores().catch(() => inversoresAdmin);
        renderAdminApiStatus();
        alert(`No se pudo conectar "${inverter.nombre}": ${error.message}`);
    }
}

async function syncAdminApisAutomatically() {
    if (adminApiSyncInProgress || !db || typeof db.sincronizarGrowatt !== 'function') return false;
    adminApiSyncInProgress = true;

    try {
        return await runAdminApiSync();
    } finally {
        adminApiSyncInProgress = false;
    }
}

async function runAdminApiSync() {

    let recovered = false;

    const now = Date.now();
    const readyInverters = inversoresAdmin.filter(item => {
        if (item.marca?.toLowerCase() !== 'growatt' || !item.api_token) return false;
        const retry = adminApiRetryState.get(item.id);
        return !retry || now >= retry.nextAttemptAt;
    });

    for (const inverter of readyInverters) {
        const wasInError = inverter.api_status === 'error';
        try {
            await db.sincronizarGrowatt(inverter.id);
            adminApiRetryState.delete(inverter.id);
            if (wasInError) {
                recovered = true;
            }
            inverter.api_status = 'connected';
            inverter.api_last_sync = new Date().toISOString();
            inverter.api_last_error = null;
            console.log(`✅ ${inverter.nombre} reconectado automáticamente; estado API: Conectada`);
        } catch (error) {
            const previousFailures = adminApiRetryState.get(inverter.id)?.failures || 0;
            const failures = previousFailures + 1;
            const isRateLimited = error.message?.includes('error_frequently_access') || error.message?.includes('limitó temporalmente');
            const delay = isRateLimited
                ? ADMIN_API_RATE_LIMIT_RETRY_MS
                : Math.min(ADMIN_API_RETRY_MS * (2 ** (failures - 1)), ADMIN_API_RETRY_MAX_MS);
            adminApiRetryState.set(inverter.id, {
                failures,
                nextAttemptAt: Date.now() + delay
            });
            inverter.api_status = 'error';
            inverter.api_last_error = error.message;
            console.warn(`⚠️ No se pudo sincronizar ${inverter.nombre}. Próximo intento: ${new Date(Date.now() + delay).toLocaleTimeString('es-MX')}`, error.message);
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    const freshInverters = await db.getAllInversores().catch(() => null);
    if (Array.isArray(freshInverters)) {
        const currentById = new Map(inversoresAdmin.map(inverter => [inverter.id, inverter]));
        freshInverters.forEach(fresh => {
            const current = currentById.get(fresh.id);
            if (current) {
                current.api_status = fresh.api_status;
                current.api_last_sync = fresh.api_last_sync;
                current.api_last_error = fresh.api_last_error;
            }
        });
    }

    const hasAnyAdminError = inversoresAdmin.some(inverter => inverter.api_status === 'error');
    adminGrowattErrorSnapshot = hasAnyAdminError;
    sessionStorage.setItem('crode-admin-growatt-error', hasAnyAdminError ? 'true' : 'false');
    renderAdminApiStatus();
    return recovered;
}

async function cambiarEstadoInversor(id, nuevoEstado) {
    try {
        await db.updateInversor(id, { estado: nuevoEstado });
        const inv = inversoresAdmin.find(i => i.id === id);
        if (inv) inv.estado = nuevoEstado;
        await db.registrarLog(usuarioAdmin?.id, usuarioAdmin?.nombre, 'Cambió estado de inversor', `${inv?.nombre || id} → ${nuevoEstado}`);
        renderAdminInversores();
        renderAdminKPIs();
    } catch (error) {
        console.error('❌ Error al cambiar estado:', error);
        alert('Error al cambiar el estado del inversor');
        renderAdminInversores();
    }
}

// ============================================================
//  RENDER TÉCNICO INVERSORES - LISTA VERTICAL
// ============================================================

function renderTecnicoInversores(tecnico) {
    const container = document.getElementById('tecInversoresList');
    if (!container) {
        console.warn('⚠️ No se encontró el contenedor #tecInversoresList');
        return;
    }

    if (!inversoresAdmin || inversoresAdmin.length === 0) {
        container.innerHTML = `
            <div style="padding:20px;text-align:center;color:var(--text-secondary);width:100%;">
                <i class="fas fa-spinner fa-spin"></i> Cargando inversores...
            </div>
        `;
        loadAdminInversores().then(() => renderTecnicoInversores(tecnico));
        return;
    }

    const selectedIds = tecnico?.inversores || [];
    
    const activos = inversoresAdmin.filter(inv => inv.estado === 'online');
    const warning = inversoresAdmin.filter(inv => inv.estado === 'warning');
    const offline = inversoresAdmin.filter(inv => inv.estado === 'offline' || inv.estado === null);
    
    let html = '';

    // Activos
    html += `
        <div style="width:100%; margin-top:6px; margin-bottom:4px;">
            <div style="display:flex;align-items:center;gap:8px;font-weight:600; font-size:14px; color:var(--success);">
                <i class="fas fa-circle" style="font-size:10px;"></i>
                Inversores Activos
                <span style="font-weight:400; font-size:12px; color:var(--text-secondary);">(${activos.length})</span>
                <span style="font-weight:400; font-size:11px; color:var(--text-secondary); margin-left:auto;">
                    <i class="fas fa-check-circle"></i> Seleccionados: ${activos.filter(inv => selectedIds.includes(inv.id)).length}
                </span>
            </div>
            <hr style="border:1px solid #e2e8f0; margin:4px 0 6px 0;">
        </div>
    `;

    if (activos.length === 0) {
        html += `<p style="color:var(--text-secondary); font-size:13px; margin:4px 0; padding-left:8px; width:100%;">No hay inversores activos disponibles.</p>`;
    } else {
        html += `<div style="display:flex;flex-direction:column;gap:3px;margin-bottom:8px;width:100%;">`;
        activos.forEach(inv => {
            const checked = selectedIds.includes(inv.id) ? 'checked' : '';
            html += `
                <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;background:#f0fdf4;padding:4px 10px;border-radius:4px;border-left:3px solid #22c55e;">
                    <input type="checkbox" value="${inv.id}" ${checked} class="tec-inversor-check" style="flex-shrink:0;">
                    <span style="flex:1;">${inv.nombre}</span>
                </label>
            `;
        });
        html += `</div>`;
    }

    // Advertencia
    html += `
        <div style="width:100%; margin-top:8px; margin-bottom:4px;">
            <div style="display:flex;align-items:center;gap:8px;font-weight:600; font-size:14px; color:var(--accent);">
                <i class="fas fa-circle" style="font-size:10px; color:var(--accent);"></i>
                Inversores con Advertencia
                <span style="font-weight:400; font-size:12px; color:var(--text-secondary);">(${warning.length})</span>
                <span style="font-weight:400; font-size:11px; color:var(--text-secondary); margin-left:auto;">
                    <i class="fas fa-check-circle"></i> Seleccionados: ${warning.filter(inv => selectedIds.includes(inv.id)).length}
                </span>
            </div>
            <hr style="border:1px solid #e2e8f0; margin:4px 0 6px 0;">
        </div>
    `;

    if (warning.length === 0) {
        html += `<p style="color:var(--text-secondary); font-size:13px; margin:4px 0; padding-left:8px; width:100%;">No hay inversores con advertencia.</p>`;
    } else {
        html += `<div style="display:flex;flex-direction:column;gap:3px;margin-bottom:8px;width:100%;">`;
        warning.forEach(inv => {
            const checked = selectedIds.includes(inv.id) ? 'checked' : '';
            html += `
                <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;background:#fef9f0;padding:4px 10px;border-radius:4px;border-left:3px solid #f59e0b;">
                    <input type="checkbox" value="${inv.id}" ${checked} class="tec-inversor-check" style="flex-shrink:0;">
                    <span style="flex:1;">${inv.nombre}</span>
                </label>
            `;
        });
        html += `</div>`;
    }

    // Offline
    html += `
        <div style="width:100%; margin-top:8px; margin-bottom:4px;">
            <div style="display:flex;align-items:center;gap:8px;font-weight:600; font-size:14px; color:var(--danger);">
                <i class="fas fa-circle" style="font-size:10px; color:var(--danger);"></i>
                Inversores Offline
                <span style="font-weight:400; font-size:12px; color:var(--text-secondary);">(${offline.length})</span>
                <span style="font-weight:400; font-size:11px; color:var(--text-secondary); margin-left:auto;">
                    <i class="fas fa-check-circle"></i> Seleccionados: ${offline.filter(inv => selectedIds.includes(inv.id)).length}
                </span>
            </div>
            <hr style="border:1px solid #e2e8f0; margin:4px 0 6px 0;">
        </div>
    `;

    if (offline.length === 0) {
        html += `<p style="color:var(--text-secondary); font-size:13px; margin:4px 0; padding-left:8px; width:100%;">No hay inversores offline.</p>`;
    } else {
        html += `<div style="display:flex;flex-direction:column;gap:3px;margin-bottom:4px;width:100%;">`;
        offline.forEach(inv => {
            const checked = selectedIds.includes(inv.id) ? 'checked' : '';
            html += `
                <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;background:#fef2f2;padding:4px 10px;border-radius:4px;border-left:3px solid #ef4444;">
                    <input type="checkbox" value="${inv.id}" ${checked} class="tec-inversor-check" style="flex-shrink:0;">
                    <span style="flex:1;">${inv.nombre}</span>
                </label>
            `;
        });
        html += `</div>`;
    }

    container.innerHTML = html;
}

// ============================================================
//  BOTÓN AGREGAR TÉCNICO - CON CARGA PREVIA
// ============================================================

// Se mantiene una sola definición del handler para evitar duplicados y errores de ejecución.

// ============================================================
//  EDITAR TÉCNICO - CON CARGA PREVIA
// ============================================================

window.editarTecnicoUI = async function(id) {
    if (inversoresAdmin.length === 0) {
        await loadAdminInversores();
    }
    const tecnico = tecnicos.find(t => t.id === id);
    if (tecnico) await abrirModalTecnico(tecnico);
};

// ============================================================
//  ABRIR MODALES
// ============================================================

async function abrirModalTecnico(tecnico = null, role = 'tecnico') {
    const modal = document.getElementById('modalTecnico');
    const title = document.getElementById('modalTecnicoTitle');
    const idField = document.getElementById('editTecnicoId');
    const assignmentGroup = document.getElementById('tecInversoresGroup');
    const roleField = document.getElementById('tecRol');

    if (tecnico) {
        title.innerHTML = '<i class="fas fa-user-edit"></i> Editar Técnico';
        document.getElementById('tecNombre').value = tecnico.nombre;
        document.getElementById('tecEmail').value = tecnico.email;
        document.getElementById('tecPassword').value = '';
        document.getElementById('tecRol').value = tecnico.rol || 'tecnico';
        document.getElementById('tecEstado').value = tecnico.estado || 'activo';
        idField.value = tecnico.id;
        if (roleField) roleField.disabled = false;
        if (assignmentGroup) assignmentGroup.style.display = ['tecnico', 'invitado'].includes(tecnico.rol) ? '' : 'none';
    } else {
        title.innerHTML = role === 'admin'
            ? '<i class="fas fa-user-shield"></i> Agregar Administrador'
            : role === 'invitado'
                ? '<i class="fas fa-user-tag"></i> Agregar Invitado'
                : '<i class="fas fa-user-plus"></i> Agregar Técnico';
        document.getElementById('tecNombre').value = '';
        document.getElementById('tecEmail').value = '';
        document.getElementById('tecPassword').value = '';
        document.getElementById('tecRol').value = role;
        document.getElementById('tecEstado').value = 'activo';
        idField.value = '';
        if (roleField) roleField.disabled = true;
        if (assignmentGroup) assignmentGroup.style.display = ['tecnico', 'invitado'].includes(role) ? '' : 'none';
    }

    if (['tecnico', 'invitado'].includes(tecnico?.rol || role)) {
        try {
            tecnico = tecnico || {};
            tecnico.inversores = tecnico.id && typeof db.getInversorIdsByUsuario === 'function'
                ? await db.getInversorIdsByUsuario(tecnico.id)
                : [];
        } catch (error) {
            console.error('❌ No se pudieron cargar las asignaciones:', error);
            tecnico.inversores = [];
        }
        renderTecnicoInversores(tecnico);
    } else {
        document.getElementById('tecInversoresList').innerHTML = '';
    }
    modal.classList.add('open');
}

function abrirModalInverterAdmin(inversor = null) {
    const modal = document.getElementById('modalInverterAdmin');
    if (!modal) return;

    if (inversor) {
        document.getElementById('invAdminNombre').value = inversor.nombre;
        document.getElementById('invAdminMarca').value = inversor.marca;
        document.getElementById('invAdminModelo').value = inversor.modelo || '';
        document.getElementById('invAdminUbicacion').value = inversor.ubicacion || '';
        document.getElementById('invAdminTecnico').value = inversor.usuario_id || '';
        document.getElementById('invAdminId').value = inversor.id || '';
        document.getElementById('invAdminCapacidad').value = inversor.capacidad_kw || '';
        document.getElementById('invAdminTipoConexion').value = inversor.tipo_conexion || 'api';
        document.getElementById('invAdminApiUrl').value = inversor.api_url || '';
        document.getElementById('invAdminPlantId').value = inversor.plant_id || '';
        document.getElementById('invAdminGatewayId').value = inversor.gateway_id || '';
        document.getElementById('invAdminSerial').value = inversor.device_serial || '';
        document.getElementById('invAdminApiUser').value = inversor.api_username || '';
        document.getElementById('invAdminApiPassword').value = '';
        document.getElementById('invAdminApiToken').value = '';
    } else {
        document.getElementById('invAdminNombre').value = '';
        document.getElementById('invAdminModelo').value = '';
        document.getElementById('invAdminUbicacion').value = '';
        document.getElementById('invAdminTecnico').value = '';
        document.getElementById('invAdminId').value = '';
        document.getElementById('invAdminCapacidad').value = '';
        document.getElementById('invAdminTipoConexion').value = 'api';
        document.getElementById('invAdminApiUrl').value = '';
        document.getElementById('invAdminPlantId').value = '';
        document.getElementById('invAdminGatewayId').value = '';
        document.getElementById('invAdminSerial').value = '';
        document.getElementById('invAdminApiUser').value = '';
        document.getElementById('invAdminApiPassword').value = '';
        document.getElementById('invAdminApiToken').value = '';
    }
    
    const select = document.getElementById('invAdminTecnico');
    select.innerHTML = `<option value="">Sin asignar</option>` +
        tecnicos.filter(t => t.estado === 'activo' && t.rol !== 'admin').map(t =>
            `<option value="${t.id}">${t.nombre}</option>`
        ).join('');
    
    modal.classList.add('open');
}

// ============================================================
//  GUARDAR TÉCNICO (CORREGIDO)
// ============================================================

document.getElementById('saveTecnico')?.addEventListener('click', async function() {
    const id = document.getElementById('editTecnicoId').value;
    const nombre = document.getElementById('tecNombre').value.trim();
    const email = document.getElementById('tecEmail').value.trim().toLowerCase();
    const password = document.getElementById('tecPassword').value.trim();
    const rol = document.getElementById('tecRol').value;
    const estado = document.getElementById('tecEstado').value;

    if (!nombre || !email) {
        alert('⚠️ Nombre y email son obligatorios.');
        return;
    }

    if (!email.includes('@') || !email.includes('.')) {
        alert('⚠️ Ingresa un email válido.');
        return;
    }

    const checkboxes = document.querySelectorAll('.tec-inversor-check:checked');
    const inversoresSeleccionados = Array.from(checkboxes).map(cb => cb.value);

    try {
        if (id) {
            const updates = { nombre, email, rol, estado };
            if (password) {
                updates.password_hash = hashPasswordForStorage(password);
            }

            await db.updateUsuario(id, updates);

            if (['tecnico', 'invitado'].includes(rol) && typeof db.setInversoresForUsuario === 'function') {
                await db.setInversoresForUsuario(id, inversoresSeleccionados);
            }

            await db.registrarLog(usuarioAdmin?.id, usuarioAdmin?.nombre, 'Editó técnico', `${nombre} (${email})`);
            alert(`✅ Técnico "${nombre}" actualizado correctamente.`);
        } else {
            if (!password) {
                alert('⚠️ Debes definir una contraseña segura para el técnico.');
                return;
            }

            const hashedPassword = hashPasswordForStorage(password);
            const newUser = await db.createUsuario({
                nombre: nombre,
                email: email,
                password_hash: hashedPassword,
                rol: rol,
                estado: estado
            });

            console.log('✅ Nuevo usuario creado:', newUser);

            if (['tecnico', 'invitado'].includes(rol) && typeof db.setInversoresForUsuario === 'function') {
                await db.setInversoresForUsuario(newUser.id, inversoresSeleccionados);
            }

            await db.registrarLog(usuarioAdmin?.id, usuarioAdmin?.nombre, 'Agregó técnico', `${nombre} (${email})`);
            alert(`✅ Técnico "${nombre}" agregado correctamente.`);
        }
        
        // Cerrar modal
        document.getElementById('modalTecnico').classList.remove('open');
        
        // FORZAR RECARGA DE DATOS DESDE SUPABASE
        console.log('🔄 Recargando datos desde Supabase...');
        
        // Recargar técnicos
        const freshData = await db.getUsuarios();
        tecnicos = freshData;
        console.log(`✅ ${tecnicos.length} técnicos recargados`);
        
        // Recargar inversores
        inversoresAdmin = await db.getAllInversores();
        console.log(`✅ ${inversoresAdmin.length} inversores recargados`);
        await loadInversorAssignmentCounts();
        
        // Renderizar todo
        renderAdminKPIs();
        renderTecnicos();
        renderAdminInversores();
        
        console.log('✅ Todo actualizado correctamente');
        
    } catch (error) {
        console.error('❌ Error al guardar técnico:', error);
        
        if (error.code === '23505' || (error.message && error.message.includes('duplicate key'))) {
            alert(`⚠️ El email "${email}" ya está registrado. Usa otro email.`);
        } else {
            alert(`❌ Error al guardar: ${error.message || 'Error desconocido'}`);
        }
    }
});

// ============================================================
//  ELIMINAR
// ============================================================

window.eliminarTecnicoUI = async function(id) {
    if (!confirm('¿Eliminar este técnico?')) return;
    
    try {
        if (typeof db.setInversoresForUsuario === 'function') {
            await db.setInversoresForUsuario(id, []);
        }
        await db.deleteUsuario(id);
        
        await loadTecnicos();
        await loadAdminInversores();
        await loadInversorAssignmentCounts();
        renderTecnicos();
        renderAdminInversores();
        renderAdminKPIs();
        
        if (db.registrarLog) {
            await db.registrarLog(usuarioAdmin?.id, usuarioAdmin?.nombre, 'Eliminó técnico', `ID: ${id}`);
        }
        alert('✅ Técnico eliminado correctamente.');
    } catch (error) {
        console.error('❌ Error al eliminar técnico:', error);
        alert('Error al eliminar el técnico');
    }
};

// ============================================================
//  CRUD INVERSORES
// ============================================================

window.editarInverterAdminUI = function(id) {
    const inv = inversoresAdmin.find(i => i.id === id);
    if (inv) abrirModalInverterAdmin(inv);
};

window.eliminarInverterAdminUI = async function(id) {
    if (!confirm('¿Eliminar este inversor?')) return;
    
    try {
        await db.deleteInversor(id);
        await loadAdminInversores();
        renderAdminInversores();
        renderAdminKPIs();
        await db.registrarLog(usuarioAdmin?.id, usuarioAdmin?.nombre, 'Eliminó inversor', `ID: ${id}`);
        alert('✅ Inversor eliminado correctamente.');
    } catch (error) {
        console.error('❌ Error al eliminar inversor:', error);
        alert('Error al eliminar el inversor');
    }
};

document.getElementById('saveInverterAdmin')?.addEventListener('click', async function() {
    const id = document.getElementById('invAdminId').value;
    const nombre = document.getElementById('invAdminNombre').value.trim();
    const marca = document.getElementById('invAdminMarca').value;
    const modelo = document.getElementById('invAdminModelo').value.trim() || 'No especificado';
    const ubicacion = document.getElementById('invAdminUbicacion').value.trim() || 'No especificada';
    const tecnicoId = document.getElementById('invAdminTecnico').value;
    const capacidad = parseFloat(document.getElementById('invAdminCapacidad').value) || 0;
    const tipoConexion = document.getElementById('invAdminTipoConexion').value;
    const apiConfig = {
        api_url: document.getElementById('invAdminApiUrl').value.trim(),
        plant_id: document.getElementById('invAdminPlantId').value.trim(),
        gateway_id: document.getElementById('invAdminGatewayId').value.trim(),
        device_serial: document.getElementById('invAdminSerial').value.trim(),
        api_username: document.getElementById('invAdminApiUser').value.trim(),
        api_password: document.getElementById('invAdminApiPassword').value,
        api_token: document.getElementById('invAdminApiToken').value
    };
    const existingInverter = id ? inversoresAdmin.find(inversor => inversor.id === id) : null;
    const apiUpdates = Object.fromEntries(Object.entries(apiConfig).filter(([key, value]) => {
        return value !== '' || !existingInverter || !['api_password', 'api_token'].includes(key);
    }));

    if (!nombre) {
        alert('El nombre es obligatorio.');
        return;
    }

    if (marca.toLowerCase() === 'growatt') {
        const hasExistingToken = Boolean(existingInverter?.api_token);
        const hasToken = Boolean(apiConfig.api_token || hasExistingToken);
        if (!hasToken || !apiConfig.device_serial || !apiConfig.plant_id) {
            alert('Para conectar un inversor Growatt debes indicar Token API, ID de planta y número de serie.');
            return;
        }
    }

    const connectionChanged = Boolean(existingInverter && (
        apiConfig.api_url !== (existingInverter.api_url || '') ||
        apiConfig.plant_id !== (existingInverter.plant_id || '') ||
        apiConfig.gateway_id !== (existingInverter.gateway_id || '') ||
        apiConfig.device_serial !== (existingInverter.device_serial || '') ||
        apiConfig.api_username !== (existingInverter.api_username || '') ||
        Boolean(apiConfig.api_password) ||
        Boolean(apiConfig.api_token)
    ));
    if (connectionChanged) {
        apiUpdates.api_status = 'pending';
        apiUpdates.api_last_error = null;
        apiUpdates.api_last_sync = null;
    }

    try {
        if (id) {
            await db.updateInversor(id, {
                nombre, marca, modelo, ubicacion,
                usuario_id: tecnicoId || null,
                capacidad_kw: capacidad,
                tipo_conexion: tipoConexion,
                ...apiUpdates
            });
            if (typeof db.unassignInversorFromUsuario === 'function' && existingInverter?.usuario_id && existingInverter.usuario_id !== tecnicoId) {
                await db.unassignInversorFromUsuario(id, existingInverter.usuario_id);
            }
            if (typeof db.assignInversorToUsuario === 'function' && tecnicoId) {
                await db.assignInversorToUsuario(id, tecnicoId);
            }
            await db.registrarLog(usuarioAdmin?.id, usuarioAdmin?.nombre, 'Editó inversor', `${nombre} (${marca})`);
            alert(`✅ Inversor "${nombre}" actualizado correctamente.`);
        } else {
            const newInverter = await db.createInversor({
                nombre, marca, modelo, ubicacion,
                usuario_id: tecnicoId || null,
                capacidad_kw: capacidad,
                tipo_conexion: tipoConexion,
                ...apiUpdates,
                estado: 'offline'
            });
            if (typeof db.assignInversorToUsuario === 'function' && tecnicoId && newInverter) {
                await db.assignInversorToUsuario(newInverter.id, tecnicoId);
            }
            await db.registrarLog(usuarioAdmin?.id, usuarioAdmin?.nombre, 'Agregó inversor', `${nombre} (${marca})`);
            alert(`✅ Inversor "${nombre}" agregado correctamente.`);
        }
        
        document.getElementById('modalInverterAdmin').classList.remove('open');
        await loadAdminInversores();
        await loadInversorAssignmentCounts();
        renderAdminInversores();
        renderAdminKPIs();
        
        console.log('✅ Inversor guardado correctamente');
    } catch (error) {
        console.error('❌ Error al guardar inversor:', error);
        alert('Error al guardar: ' + error.message);
    }
});

// ============================================================
//  NAVEGACIÓN Y EVENTOS
// ============================================================

document.getElementById('btnAddTecnico')?.addEventListener('click', async function() {
    if (inversoresAdmin.length === 0) {
        await loadAdminInversores();
    }
    await abrirModalTecnico(null, 'tecnico');
});

document.getElementById('btnAddAdministrador')?.addEventListener('click', () => {
    abrirModalTecnico(null, 'admin');
});

document.getElementById('btnAddInvitado')?.addEventListener('click', () => {
    abrirModalTecnico(null, 'invitado');
});

document.getElementById('tecRol')?.addEventListener('change', function() {
    const assignmentGroup = document.getElementById('tecInversoresGroup');
    if (assignmentGroup) assignmentGroup.style.display = ['tecnico', 'invitado'].includes(this.value) ? '' : 'none';
});

document.getElementById('btnAddInverterAdmin')?.addEventListener('click', () => abrirModalInverterAdmin(null));

document.getElementById('closeModalTecnico')?.addEventListener('click', () => {
    document.getElementById('modalTecnico').classList.remove('open');
});
document.getElementById('cancelModalTecnico')?.addEventListener('click', () => {
    document.getElementById('modalTecnico').classList.remove('open');
});
document.getElementById('modalTecnico')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) document.getElementById('modalTecnico').classList.remove('open');
});

document.getElementById('closeModalInverterAdmin')?.addEventListener('click', () => {
    document.getElementById('modalInverterAdmin').classList.remove('open');
});
document.getElementById('cancelModalInverterAdmin')?.addEventListener('click', () => {
    document.getElementById('modalInverterAdmin').classList.remove('open');
});
document.getElementById('modalInverterAdmin')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) document.getElementById('modalInverterAdmin').classList.remove('open');
});

document.getElementById('searchInverterAdmin')?.addEventListener('input', renderAdminInversores);
document.getElementById('filterBrandAdmin')?.addEventListener('change', renderAdminInversores);
document.getElementById('searchLogs')?.addEventListener('input', renderLogs);
document.getElementById('filterLogAction')?.addEventListener('change', renderLogs);

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
    });
});

document.getElementById('menuToggle')?.addEventListener('click', function() {
    document.getElementById('sidebar').classList.toggle('open');
});

// ============================================================
//  ADMIN - INICIALIZACIÓN (CORREGIDA - MUESTRA TODOS)
// ============================================================

async function initAdmin() {
    console.log('🚀 Panel de Administración iniciado');
    console.log('🔍 Verificando db:', typeof db !== 'undefined' ? '✅ Disponible' : '❌ No disponible');
    
    try {
        // 1. Verificar que la conexión a Supabase funciona
        if (!db || typeof db.getUsuarios !== 'function') {
            console.error('❌ db.getUsuarios no es una función');
            if (window.db && typeof window.db.getUsuarios === 'function') {
                console.log('🔄 Usando window.db en su lugar');
                Object.assign(db, window.db);
            } else {
                throw new Error('Base de datos no disponible');
            }
        }
        
        // 2. Cargar TODOS los usuarios desde Supabase (SIN FILTRAR)
        console.log('📥 Cargando usuarios desde Supabase...');
        const data = await db.getUsuarios();
        console.log('📊 TODOS LOS USUARIOS DE SUPABASE:', data);
        
        // 🔥 CORREGIDO: Mostrar TODOS los usuarios (admin, técnicos, etc.)
        tecnicos = data; // ¡YA NO FILTRAMOS!
        
        console.log(`✅ ${tecnicos.length} usuarios cargados`);
        console.log('📋 Lista de usuarios:', tecnicos.map(t => 
            `- ${t.nombre} | ${t.email} | rol: "${t.rol || 'sin rol'}" | estado: ${t.estado}`
        ).join('\n'));
        
        // 3. Cargar inversores
        console.log('📥 Cargando inversores desde Supabase...');
        const invData = await db.getAllInversores();
        inversoresAdmin = invData;
        console.log(`✅ ${inversoresAdmin.length} inversores cargados`);
        await loadInversorAssignmentCounts();
        
        // 4. Renderizar todo
        renderAdminKPIs();
        renderTecnicos();
        renderAdminInversores();
        renderAdminApiStatus();
        await loadLogs();

        if (adminApiIntervalId) clearInterval(adminApiIntervalId);
        syncAdminApisAutomatically().catch(error => {
            console.error('❌ Error en sincronización inicial del admin:', error);
        });
        adminApiIntervalId = setInterval(async () => {
            try {
                await syncAdminApisAutomatically();
            } catch (error) {
                console.error('❌ Error en sincronización automática del admin:', error);
            }
        }, ADMIN_API_RETRY_MS);
        
        console.log('✅ Panel de Administración listo - TODOS los usuarios visibles');
        
    } catch (error) {
        console.error('❌ Error en initAdmin:', error);
        console.log('🔄 Intentando recargar con datos mock...');
        
        // Usar datos mock como fallback
        tecnicos = getMockTecnicos();
        inversoresAdmin = getMockInversores();
        
        renderAdminKPIs();
        renderTecnicos();
        renderAdminInversores();
        logsActividad = [];
        renderLogs();
        
        alert('⚠️ Error al cargar datos desde Supabase. Mostrando datos de prueba.\nRevisa la consola para más detalles.');
    }
}


// ============================================================
//  VERIFICAR SESIÓN AL CARGAR (CON RECARGA AUTOMÁTICA)
// ============================================================

document.addEventListener('DOMContentLoaded', async function() {
    if (checkAdminSession()) {
        await initAdmin();
        
        // Si no hay técnicos, intentar recargar automáticamente después de 1 segundo
        setTimeout(() => {
            if (tecnicos.length === 0) {
                console.log('⚠️ No hay técnicos, intentando recargar...');
                refreshTecnicos().catch(err => console.error('Error al recargar técnicos:', err));
            }
        }, 1000);
    }
});

// ============================================================
// FUNCIÓN PRINCIPAL CORREGIDA - ¡Muestra TODOS los usuarios!
// ============================================================

window.refreshData = async function() {
    console.log('🔄 Recargando usuarios desde Supabase...');
    showToast('Actualizando datos...', 'info');

    try {
        // 1. Obtener TODOS los usuarios
        const data = await db.getUsuarios();
        console.log('📊 TODOS LOS USUARIOS DE SUPABASE:', data);

        // 2. 🔥 FILTRO CORREGIDO - ¡MOSTRAR TODOS LOS USUARIOS!
        //    Ya NO filtramos, mostramos TODOS (admin, técnicos, etc.)
        tecnicos = data; // ¡TODOS los usuarios!

        console.log(`✅ ${tecnicos.length} usuarios encontrados`);
        console.log('📋 Lista de usuarios:', tecnicos.map(t => 
            `- ${t.nombre} | ${t.email} | rol: "${t.rol || 'sin rol'}" | estado: ${t.estado}`
        ).join('\n'));

        // 3. Cargar inversores
        const invData = await db.getAllInversores();
        inversoresAdmin = invData;
        console.log(`✅ ${inversoresAdmin.length} inversores cargados`);
        await loadInversorAssignmentCounts();

        // 4. Renderizar todo
        renderAdminKPIs();
        renderTecnicos();
        renderAdminInversores();
        renderAdminApiStatus();

        showToast(`✅ ${tecnicos.length} usuarios y ${inversoresAdmin.length} inversores cargados`, 'success');

    } catch (error) {
        console.error('❌ Error al recargar:', error);
        showToast('Error al recargar datos', 'error');
    }
};