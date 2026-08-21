// ============================================================
//  ADMIN - CON SUPABASE (VERIFICAR SESIÓN)
// ============================================================

if (typeof window.db === 'undefined') {
    console.error('❌ Error: window.db no está definido');
    alert('Error de conexión con la base de datos');
}

const db = window.db || {};
let tecnicos = [];
let inversoresAdmin = [];
let usuarioAdmin = null;

// ============================================================
//  ADMIN - VERIFICAR SESIÓN (CORREGIDO)
// ============================================================

function checkAdminSession() {
    const saved = localStorage.getItem('usuarioActual');
    if (!saved) {
        window.location.href = '../index.html';
        return false;
    }
    try {
        const usuario = JSON.parse(saved);
        if (usuario.rol !== 'admin') {
            alert('No tienes permisos de administrador');
            window.location.href = '../index.html';
            return false;
        }
        usuarioAdmin = usuario;
        // Actualizar UI
        document.getElementById('userName').textContent = usuario.nombre;
        document.getElementById('userRole').textContent = 'Administrador';
        const initials = usuario.nombre.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
        document.getElementById('userAvatar').textContent = initials;
        return true;
    } catch (e) {
        window.location.href = '../index.html';
        return false;
    }
}

// ============================================================
//  ADMIN - CERRAR SESIÓN (CORREGIDO)
// ============================================================

document.getElementById('logoutBtn')?.addEventListener('click', function() {
    if (confirm('¿Cerrar sesión?')) {
        localStorage.removeItem('usuarioActual');
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
        if (!db.getAllInversores) {
            console.warn('⚠️ db.getAllInversores no disponible, usando datos mock');
            return getMockInversores();
        }
        const data = await db.getAllInversores();
        inversoresAdmin = data;
        console.log(`✅ ${inversoresAdmin.length} inversores cargados`);
        return data;
    } catch (error) {
        console.error('❌ Error al cargar inversores:', error);
        return getMockInversores();
    }
}

// ============================================================
//  DATOS MOCK CON UUIDs VÁLIDOS
// ============================================================

function getMockTecnicos() {
    return [
        { id: '22222222-2222-2222-2222-222222222222', nombre: 'Juan Técnico', email: 'juan@crode.mx', password_hash: 'juan123', rol: 'tecnico', estado: 'activo' },
        { id: '33333333-3333-3333-3333-333333333333', nombre: 'Pedro Técnico', email: 'pedro@crode.mx', password_hash: 'pedro123', rol: 'tecnico', estado: 'activo' }
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
    const total = tecnicos.length;
    const activos = tecnicos.filter(t => t.estado === 'activo').length;
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

function renderTecnicos() {
    const tbody = document.getElementById('tecnicosTableBody');
    if (!tbody) {
        console.error('❌ No se encontró el elemento tecnicosTableBody');
        return;
    }

    console.log(`📋 Renderizando ${tecnicos.length} técnicos...`);

    if (tecnicos.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#64748b;padding:20px;">
            No hay técnicos registrados. <br>
            <small>Haz clic en "Recargar Técnicos" para actualizar.</small>
        </td></tr>`;
        return;
    }

    tbody.innerHTML = tecnicos.map((t, i) => {
        const invCount = inversoresAdmin.filter(inv => inv.usuario_id === t.id).length;
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
                <td>${invCount}</td>
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

    console.log(`✅ ${tecnicos.length} técnicos renderizados en la tabla`);
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
        const asignado = tecnicos.find(t => t.id === inv.usuario_id);
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
                <td>${asignado ? asignado.nombre : 'Sin asignar'}</td>
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
            const asignadoAOtro = inv.usuario_id && inv.usuario_id !== tecnico?.id;
            const disabled = asignadoAOtro ? 'disabled' : '';
            const checked = selectedIds.includes(inv.id) ? 'checked' : '';
            html += `
                <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:${disabled ? 'not-allowed' : 'pointer'};background:#f0fdf4;padding:4px 10px;border-radius:4px;border-left:3px solid #22c55e;opacity:${disabled ? 0.5 : 1};">
                    <input type="checkbox" value="${inv.id}" ${checked} ${disabled} class="tec-inversor-check" style="flex-shrink:0;">
                    <span style="flex:1;">${inv.nombre}</span>
                    <span style="font-size:11px;color:var(--text-secondary);">${asignadoAOtro ? '🔒 Asignado a otro técnico' : ''}</span>
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
            const asignadoAOtro = inv.usuario_id && inv.usuario_id !== tecnico?.id;
            const disabled = asignadoAOtro ? 'disabled' : '';
            const checked = selectedIds.includes(inv.id) ? 'checked' : '';
            html += `
                <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:${disabled ? 'not-allowed' : 'pointer'};background:#fef9f0;padding:4px 10px;border-radius:4px;border-left:3px solid #f59e0b;opacity:${disabled ? 0.5 : 1};">
                    <input type="checkbox" value="${inv.id}" ${checked} ${disabled} class="tec-inversor-check" style="flex-shrink:0;">
                    <span style="flex:1;">${inv.nombre}</span>
                    <span style="font-size:11px;color:var(--text-secondary);">${asignadoAOtro ? '🔒 Asignado a otro técnico' : ''}</span>
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
            const asignadoAOtro = inv.usuario_id && inv.usuario_id !== tecnico?.id;
            const disabled = asignadoAOtro ? 'disabled' : '';
            const checked = selectedIds.includes(inv.id) ? 'checked' : '';
            html += `
                <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:${disabled ? 'not-allowed' : 'pointer'};background:#fef2f2;padding:4px 10px;border-radius:4px;border-left:3px solid #ef4444;opacity:${disabled ? 0.5 : 0.7};">
                    <input type="checkbox" value="${inv.id}" ${checked} ${disabled} class="tec-inversor-check" style="flex-shrink:0;">
                    <span style="flex:1;">${inv.nombre}</span>
                    <span style="font-size:11px;color:var(--text-secondary);">${asignadoAOtro ? '🔒 Asignado a otro técnico' : ''}</span>
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

document.getElementById('btnAddTecnico')?.addEventListener('click', async function() {
    if (inversoresAdmin.length === 0) {
        await loadAdminInversores();
    }
    abrirModalTecnico(null);
});

// ============================================================
//  EDITAR TÉCNICO - CON CARGA PREVIA
// ============================================================

window.editarTecnicoUI = async function(id) {
    if (inversoresAdmin.length === 0) {
        await loadAdminInversores();
    }
    const tecnico = tecnicos.find(t => t.id === id);
    if (tecnico) abrirModalTecnico(tecnico);
};

// ============================================================
//  ABRIR MODALES
// ============================================================

function abrirModalTecnico(tecnico = null) {
    const modal = document.getElementById('modalTecnico');
    const title = document.getElementById('modalTecnicoTitle');
    const idField = document.getElementById('editTecnicoId');

    if (tecnico) {
        title.innerHTML = '<i class="fas fa-user-edit"></i> Editar Técnico';
        document.getElementById('tecNombre').value = tecnico.nombre;
        document.getElementById('tecEmail').value = tecnico.email;
        document.getElementById('tecPassword').value = '';
        document.getElementById('tecRol').value = tecnico.rol || 'tecnico';
        document.getElementById('tecEstado').value = tecnico.estado || 'activo';
        idField.value = tecnico.id;
    } else {
        title.innerHTML = '<i class="fas fa-user-plus"></i> Agregar Técnico';
        document.getElementById('tecNombre').value = '';
        document.getElementById('tecEmail').value = '';
        document.getElementById('tecPassword').value = '';
        document.getElementById('tecRol').value = 'tecnico';
        document.getElementById('tecEstado').value = 'activo';
        idField.value = '';
    }

    renderTecnicoInversores(tecnico);
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
    } else {
        document.getElementById('invAdminNombre').value = '';
        document.getElementById('invAdminModelo').value = '';
        document.getElementById('invAdminUbicacion').value = '';
        document.getElementById('invAdminTecnico').value = '';
        document.getElementById('invAdminId').value = '';
        document.getElementById('invAdminCapacidad').value = '';
        document.getElementById('invAdminTipoConexion').value = 'api';
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
    const email = document.getElementById('tecEmail').value.trim();
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
            // Actualizar usuario existente
            const updates = { nombre, email, rol, estado };
            if (password) updates.password_hash = password;
            
            await db.updateUsuario(id, updates);
            
            // Actualizar asignaciones de inversores
            for (const inv of inversoresAdmin) {
                if (inversoresSeleccionados.includes(inv.id)) {
                    await db.updateInversor(inv.id, { usuario_id: id });
                } else if (inv.usuario_id === id) {
                    await db.updateInversor(inv.id, { usuario_id: null });
                }
            }
            
            await db.registrarLog(usuarioAdmin?.id, usuarioAdmin?.nombre, 'Editó técnico', `${nombre} (${email})`);
            alert(`✅ Técnico "${nombre}" actualizado correctamente.`);
        } else {
            // Crear nuevo usuario
            const newUser = await db.createUsuario({
                nombre: nombre,
                email: email,
                password_hash: password || '123456',
                rol: rol,
                estado: estado
            });
            
            console.log('✅ Nuevo usuario creado:', newUser);
            
            // Asignar inversores seleccionados
            for (const invId of inversoresSeleccionados) {
                try {
                    await db.updateInversor(invId, { usuario_id: newUser.id });
                } catch (e) {
                    console.warn(`⚠️ No se pudo asignar inversor ${invId}:`, e);
                }
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
        tecnicos = freshData.filter(u => u.rol !== 'admin');
        console.log(`✅ ${tecnicos.length} técnicos recargados`);
        
        // Recargar inversores
        inversoresAdmin = await db.getAllInversores();
        console.log(`✅ ${inversoresAdmin.length} inversores recargados`);
        
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

window.editarTecnicoUI = function(id) {
    const tecnico = tecnicos.find(t => t.id === id);
    if (tecnico) abrirModalTecnico(tecnico);
};

window.eliminarTecnicoUI = async function(id) {
    if (!confirm('¿Eliminar este técnico?')) return;
    
    try {
        for (const inv of inversoresAdmin) {
            if (inv.usuario_id === id) {
                await db.updateInversor(inv.id, { usuario_id: null });
            }
        }
        await db.deleteUsuario(id);
        
        await loadTecnicos();
        await loadAdminInversores();
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

    if (!nombre) {
        alert('El nombre es obligatorio.');
        return;
    }

    try {
        if (id) {
            await db.updateInversor(id, {
                nombre, marca, modelo, ubicacion,
                usuario_id: tecnicoId || null,
                capacidad_kw: capacidad,
                tipo_conexion: tipoConexion
            });
            await db.registrarLog(usuarioAdmin?.id, usuarioAdmin?.nombre, 'Editó inversor', `${nombre} (${marca})`);
            alert(`✅ Inversor "${nombre}" actualizado correctamente.`);
        } else {
            await db.createInversor({
                nombre, marca, modelo, ubicacion,
                usuario_id: tecnicoId || null,
                capacidad_kw: capacidad,
                tipo_conexion: tipoConexion,
                estado: 'offline'
            });
            await db.registrarLog(usuarioAdmin?.id, usuarioAdmin?.nombre, 'Agregó inversor', `${nombre} (${marca})`);
            alert(`✅ Inversor "${nombre}" agregado correctamente.`);
        }
        
        document.getElementById('modalInverterAdmin').classList.remove('open');
        await loadAdminInversores();
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
    abrirModalTecnico(null);
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
        
        // 4. Renderizar todo
        renderAdminKPIs();
        renderTecnicos();
        renderAdminInversores();
        
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
                refreshTecnicos();
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
        inversores = invData;
        console.log(`✅ ${inversores.length} inversores cargados`);

        // 4. Renderizar todo
        renderAll();

        showToast(`✅ ${tecnicos.length} usuarios y ${inversores.length} inversores cargados`, 'success');

    } catch (error) {
        console.error('❌ Error al recargar:', error);
        showToast('Error al recargar datos', 'error');
    }
};
