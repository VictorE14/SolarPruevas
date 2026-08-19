// ============================================================
//  CONEXIÓN A SUPABASE (CON ANON KEY - RLS DESACTIVADO)
// ============================================================

const SUPABASE_URL = 'https://nojpqnclmhztwwwjqxeh.supabase.co';

// Anon Key (la que ya tienes)
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vanBxbmNsbWh6dHd3d2pxeGVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyOTI5NjMsImV4cCI6MjEwMDg2ODk2M30.VbgGn_QWdZvF4mYRbU_Vg1Zi_O-JMMbSrWMsmsdx5vw';

// Crear el cliente de Supabase
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

console.log('✅ Supabase conectado correctamente (Anon Key)');

// ============================================================
//  FUNCIONES DE USUARIOS
// ============================================================

async function getUsuarios() {
    const { data, error } = await supabase
        .from('usuarios')
        .select('*')
        .order('nombre');
    if (error) throw error;
    return data;
}

async function getUsuarioByEmail(email) {
    const { data, error } = await supabase
        .from('usuarios')
        .select('*')
        .eq('email', email)
        .maybeSingle();
    if (error) throw error;
    return data;
}

async function createUsuario(usuario) {
    const { data, error } = await supabase
        .from('usuarios')
        .insert({
            nombre: usuario.nombre,
            email: usuario.email,
            password_hash: usuario.password_hash,
            rol: usuario.rol || 'tecnico',
            estado: usuario.estado || 'activo'
        })
        .select()
        .single();
    if (error) {
        console.error('❌ Error en createUsuario:', error);
        throw error;
    }
    return data;
}

async function updateUsuario(id, updates) {
    const { data, error } = await supabase
        .from('usuarios')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    return data;
}

async function deleteUsuario(id) {
    const { error } = await supabase
        .from('usuarios')
        .delete()
        .eq('id', id);
    if (error) throw error;
    return true;
}

async function updateUltimoAcceso(id) {
    const { error } = await supabase
        .from('usuarios')
        .update({ ultimo_acceso: new Date().toISOString() })
        .eq('id', id);
    if (error) throw error;
    return true;
}

// ============================================================
//  FUNCIONES DE INVERSORES
// ============================================================

async function getInversoresByUsuario(usuarioId) {
    const { data, error } = await supabase
        .from('inversores')
        .select('*')
        .eq('usuario_id', usuarioId)
        .order('nombre');
    if (error) throw error;
    return data;
}

async function getAllInversores() {
    const { data, error } = await supabase
        .from('inversores')
        .select('*')
        .order('nombre');
    if (error) throw error;
    return data;
}

async function createInversor(inversor) {
    const { data, error } = await supabase
        .from('inversores')
        .insert({
            nombre: inversor.nombre,
            marca: inversor.marca,
            modelo: inversor.modelo,
            ubicacion: inversor.ubicacion,
            capacidad_kw: inversor.capacidad_kw || 0,
            tipo_conexion: inversor.tipo_conexion || 'api',
            usuario_id: inversor.usuario_id || null,
            ip_modbus: inversor.ip_modbus || null,
            puerto_modbus: inversor.puerto_modbus || 502,
            huawei_usuario: inversor.huawei_usuario || null,
            huawei_plant_code: inversor.huawei_plant_code || null,
            growatt_usuario: inversor.growatt_usuario || null,
            growatt_serial_number: inversor.growatt_serial_number || null,
            frecuencia_lectura: inversor.frecuencia_lectura || 60,
            estado: inversor.estado || 'offline'
        })
        .select()
        .single();
    if (error) {
        console.error('❌ Error en createInversor:', error);
        throw error;
    }
    return data;
}

async function updateInversor(id, updates) {
    const { data, error } = await supabase
        .from('inversores')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    return data;
}

async function deleteInversor(id) {
    const { error } = await supabase
        .from('inversores')
        .delete()
        .eq('id', id);
    if (error) throw error;
    return true;
}

// ============================================================
//  FUNCIONES DE LECTURAS HISTÓRICAS
// ============================================================

async function saveLectura(lectura) {
    const { data, error } = await supabase
        .from('lecturas_historicas')
        .insert({
            inversor_id: lectura.inversor_id,
            timestamp: lectura.timestamp || new Date().toISOString(),
            voltaje_dc: lectura.voltaje_dc || 0,
            corriente_dc: lectura.corriente_dc || 0,
            potencia_ac: lectura.potencia_ac || 0,
            energia_dia: lectura.energia_dia || 0,
            energia_total: lectura.energia_total || 0,
            temperatura: lectura.temperatura || 0,
            frecuencia: lectura.frecuencia || 60,
            estado_operativo: lectura.estado_operativo || 'offline'
        })
        .select()
        .single();
    if (error) throw error;
    return data;
}

async function getLecturasByInversor(inversorId, limit = 100) {
    const { data, error } = await supabase
        .from('lecturas_historicas')
        .select('*')
        .eq('inversor_id', inversorId)
        .order('timestamp', { ascending: false })
        .limit(limit);
    if (error) throw error;
    return data;
}

async function getUltimaLectura(inversorId) {
    const { data, error } = await supabase
        .from('lecturas_historicas')
        .select('*')
        .eq('inversor_id', inversorId)
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data;
}

// ============================================================
//  FUNCIONES DE ALERTAS
// ============================================================

async function getAlertasActivas() {
    const { data, error } = await supabase
        .from('alertas')
        .select('*')
        .eq('resuelta', false)
        .order('fecha', { ascending: false });
    if (error) throw error;
    return data;
}

async function getAllAlertas() {
    const { data, error } = await supabase
        .from('alertas')
        .select('*')
        .order('fecha', { ascending: false });
    if (error) throw error;
    return data;
}

async function resolverAlerta(id, usuarioId) {
    const { data, error } = await supabase
        .from('alertas')
        .update({
            resuelta: true,
            resuelta_por: usuarioId,
            fecha_resolucion: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    return data;
}

// ============================================================
//  FUNCIONES DE LOGS
// ============================================================

async function registrarLog(usuarioId, usuarioNombre, accion, descripcion, ip = null) {
    const { data, error } = await supabase
        .from('logs_actividad')
        .insert({
            usuario_id: usuarioId || null,
            usuario_nombre: usuarioNombre || 'Sistema',
            accion: accion,
            descripcion: descripcion || '',
            ip: ip || null,
            fecha: new Date().toISOString()
        });
    if (error) throw error;
    return data;
}

async function getLogs(limit = 100) {
    const { data, error } = await supabase
        .from('logs_actividad')
        .select('*')
        .order('fecha', { ascending: false })
        .limit(limit);
    if (error) throw error;
    return data;
}

// ============================================================
//  EXPORTAR FUNCIONES
// ============================================================

window.db = {
    getUsuarios,
    getUsuarioByEmail,
    createUsuario,
    updateUsuario,
    deleteUsuario,
    updateUltimoAcceso,
    getInversoresByUsuario,
    getAllInversores,
    createInversor,
    updateInversor,
    deleteInversor,
    saveLectura,
    getLecturasByInversor,
    getUltimaLectura,
    getAlertasActivas,
    getAllAlertas,
    resolverAlerta,
    registrarLog,
    getLogs,
    supabase
};

console.log('✅ Base de datos conectada con Supabase (Anon Key - RLS desactivado)');
console.log('✅ window.db disponible:', typeof window.db !== 'undefined');
console.log('✅ Funciones disponibles:', Object.keys(window.db));