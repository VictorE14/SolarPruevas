// ============================================================
//  CONEXIÓN A SUPABASE (CONFIGURACIÓN EXTERNA)
// ============================================================

(function () {
    const SUPABASE_URL = (window.APP_CONFIG && window.APP_CONFIG.supabase && window.APP_CONFIG.supabase.url) || window.SUPABASE_URL || '';
    const SUPABASE_ANON_KEY = (window.APP_CONFIG && window.APP_CONFIG.supabase && window.APP_CONFIG.supabase.anonKey) || window.SUPABASE_ANON_KEY || '';

    function requireSupabase() {
        if (!window.supabase || typeof window.supabase.createClient !== 'function') {
            throw new Error('Supabase client no está disponible. Revisa la carga de @supabase/supabase-js.');
        }
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            throw new Error('Supabase no está configurado. Revisa shared/config.js y agrega la URL y la anon key.');
        }
        return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }

    const supabase = (() => {
        try {
            return requireSupabase();
        } catch (error) {
            console.warn('⚠️', error.message);
            return null;
        }
    })();

    function ensureClient() {
        if (!supabase) {
            throw new Error('La base de datos no está disponible porque Supabase no está configurado.');
        }
        return supabase;
    }

    async function getUsuarios() {
        const client = ensureClient();
        const { data, error } = await client
            .from('usuarios')
            .select('*')
            .order('nombre');
        if (error) throw error;
        return data;
    }

    async function getUsuarioByEmail(email) {
        const client = ensureClient();
        const { data, error } = await client
            .from('usuarios')
            .select('*')
            .eq('email', email)
            .maybeSingle();
        if (error) throw error;
        return data;
    }

    async function createUsuario(usuario) {
        const client = ensureClient();
        const { data, error } = await client
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
        const client = ensureClient();
        const { data, error } = await client
            .from('usuarios')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    }

    async function deleteUsuario(id) {
        const client = ensureClient();
        const { error } = await client
            .from('usuarios')
            .delete()
            .eq('id', id);
        if (error) throw error;
        return true;
    }

    async function updateUltimoAcceso(id) {
        const client = ensureClient();
        const { error } = await client
            .from('usuarios')
            .update({ ultimo_acceso: new Date().toISOString() })
            .eq('id', id);
        if (error) throw error;
        return true;
    }

    async function getInversoresByUsuario(usuarioId) {
        const client = ensureClient();
        const { data, error } = await client
            .from('inversores')
            .select('*')
            .eq('usuario_id', usuarioId)
            .order('nombre');
        if (error) throw error;
        return data;
    }

    async function getAllInversores() {
        const client = ensureClient();
        const { data, error } = await client
            .from('inversores')
            .select('*')
            .order('nombre');
        if (error) throw error;
        return data;
    }

    async function createInversor(inversor) {
        const client = ensureClient();
        const { data, error } = await client
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
                api_url: inversor.api_url || null,
                plant_id: inversor.plant_id || null,
                gateway_id: inversor.gateway_id || null,
                device_serial: inversor.device_serial || null,
                api_username: inversor.api_username || null,
                api_password: inversor.api_password || null,
                api_token: inversor.api_token || null,
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
        const client = ensureClient();
        const { data, error } = await client
            .from('inversores')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data;
    }

    async function deleteInversor(id) {
        const client = ensureClient();
        const { error } = await client
            .from('inversores')
            .delete()
            .eq('id', id);
        if (error) throw error;
        return true;
    }

    async function saveLectura(lectura) {
        const client = ensureClient();
        const { data, error } = await client
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
        const client = ensureClient();
        const { data, error } = await client
            .from('lecturas_historicas')
            .select('*')
            .eq('inversor_id', inversorId)
            .order('timestamp', { ascending: false })
            .limit(limit);
        if (error) throw error;
        return data;
    }

    async function getUltimaLectura(inversorId) {
        const client = ensureClient();
        const { data, error } = await client
            .from('lecturas_historicas')
            .select('*')
            .eq('inversor_id', inversorId)
            .order('timestamp', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) throw error;
        return data;
    }

    async function sincronizarGrowatt(inverterId) {
        const client = ensureClient();
        const { data, error } = await client.functions.invoke('growatt-sync', {
            body: { inverterId }
        });
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || 'No se pudo sincronizar con Growatt');
        return data;
    }

    async function getAlertasActivas(usuarioId = null) {
        const client = ensureClient();
        let query = client
            .from('alertas')
            .select('*')
            .eq('resuelta', false)
            .order('fecha', { ascending: false });

        if (usuarioId) {
            const inversores = await getInversoresByUsuario(usuarioId);
            const inversorIds = inversores.map(inv => inv.id).filter(Boolean);
            if (!inversorIds.length) return [];
            query = query.in('inversor_id', inversorIds);
        }

        const { data, error } = await query;
        if (error) throw error;
        return data;
    }

    async function getAllAlertas(usuarioId = null) {
        const client = ensureClient();
        let query = client
            .from('alertas')
            .select('*')
            .order('fecha', { ascending: false });

        if (usuarioId) {
            const inversores = await getInversoresByUsuario(usuarioId);
            const inversorIds = inversores.map(inv => inv.id).filter(Boolean);
            if (!inversorIds.length) return [];
            query = query.in('inversor_id', inversorIds);
        }

        const { data, error } = await query;
        if (error) throw error;
        return data;
    }

    async function resolverAlerta(id, usuarioId) {
        const client = ensureClient();
        const { data, error } = await client
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

    async function registrarLog(usuarioId, usuarioNombre, accion, descripcion, ip = null) {
        const client = ensureClient();
        const { data, error } = await client
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
        const client = ensureClient();
        const { data, error } = await client
            .from('logs_actividad')
            .select('*')
            .order('fecha', { ascending: false })
            .limit(limit);
        if (error) throw error;
        return data;
    }

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
        sincronizarGrowatt,
        getAlertasActivas,
        getAllAlertas,
        resolverAlerta,
        registrarLog,
        getLogs,
        supabase
    };

    console.log('✅ window.db disponible:', typeof window.db !== 'undefined');
    console.log('✅ Funciones disponibles:', Object.keys(window.db));
})();
