// @ts-nocheck

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  serve(handler: (request: Request) => Promise<Response> | Response): void;
};

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DEFAULT_HUAWEI_URL = 'https://la5.fusionsolar.huawei.com';
const DEFAULT_HUAWEI_USER = 'brima_api';
const DEFAULT_HUAWEI_PASS = 'Brima2026*';

// Token cache en memoria de la Edge Function
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function toText(value: unknown): string {
  return String(value ?? '').trim();
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Autenticación contra Huawei FusionSolar OpenAPI con persistencia en DB para compartir tokens entre funciones
 */
async function getHuaweiToken(
  admin: any,
  baseUrl: string,
  userName: string,
  systemCode: string,
  forceRefresh = false
): Promise<string> {
  const now = Date.now();

  if (!forceRefresh) {
    if (cachedToken && now < tokenExpiresAt) {
      return cachedToken;
    }

    // Buscar token guardado en DB recientemente (últimos 20 min) para compartirlo entre todas las instancias
    try {
      const { data: recentInverter } = await admin
        .from('inversores')
        .select('api_token, api_last_sync')
        .ilike('marca', 'huawei')
        .not('api_token', 'is', null)
        .order('api_last_sync', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      if (recentInverter?.api_token) {
        const lastSyncTime = recentInverter.api_last_sync ? new Date(recentInverter.api_last_sync).getTime() : 0;
        const ageMs = now - lastSyncTime;
        // Si el token tiene menos de 22 minutos, lo reutilizamos directamente
        if (ageMs < 22 * 60 * 1000) {
          cachedToken = recentInverter.api_token;
          tokenExpiresAt = now + (15 * 60 * 1000);
          return cachedToken;
        }
      }
    } catch (_) {}
  }

  // Pequeño retardo si venimos de un error o refresh para evitar ráfagas 407
  if (forceRefresh) {
    await sleep(1500);
  }

  const cleanBase = baseUrl.replace(/\/+$/, '');
  const loginUrl = `${cleanBase}/thirdData/login`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userName: userName.trim(),
        systemCode: systemCode.trim(),
      }),
      signal: controller.signal,
    });

    const bodyText = await res.text();
    let payload: any = {};
    try {
      payload = JSON.parse(bodyText);
    } catch (_) {
      throw new Error(`Huawei respondió formato inválido HTTP ${res.status}: ${bodyText.slice(0, 150)}`);
    }

    if (payload.failCode === 407 || bodyText.includes('ACCESS_FREQUENCY_IS_TOO_HIGH')) {
      // Reintentar una vez tras 2.5 segundos
      await sleep(2500);
      try {
        const retryRes = await fetch(loginUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userName: userName.trim(), systemCode: systemCode.trim() }),
        });
        const retryText = await retryRes.text();
        const retryPayload = JSON.parse(retryText);
        if (retryPayload.success) {
          let retryToken = retryRes.headers.get('xsrf-token');
          if (!retryToken) {
            const setCookie = retryRes.headers.get('set-cookie') || '';
            const match = setCookie.match(/xsrf-token=([^;]+)/i);
            if (match) retryToken = match[1];
          }
          if (retryToken) {
            cachedToken = retryToken;
            tokenExpiresAt = now + (25 * 60 * 1000);
            await admin.from('inversores').update({ api_token: retryToken, api_last_sync: new Date().toISOString() }).ilike('marca', 'huawei');
            return retryToken;
          }
        }
      } catch (_) {}

      // Si falla, intentar usar el token que ya estaba en BD
      try {
        const { data: fallbackInverter } = await admin
          .from('inversores')
          .select('api_token')
          .ilike('marca', 'huawei')
          .not('api_token', 'is', null)
          .limit(1)
          .maybeSingle();

        if (fallbackInverter?.api_token) {
          cachedToken = fallbackInverter.api_token;
          tokenExpiresAt = now + (10 * 60 * 1000);
          return cachedToken;
        }
      } catch (_) {}
      throw new Error('Huawei limitó temporalmente el login (frecuencia alta / código 407). Espera unos instantes.');
    }

    if (!payload.success) {
      if (payload.failCode === 20400 || bodyText.includes('user_or_value_invalid')) {
        throw new Error('Credenciales de Huawei rechazadas (usuario o contraseña API incorrectos).');
      }
      throw new Error(payload.message || `Huawei error de login (código ${payload.failCode})`);
    }

    let token = res.headers.get('xsrf-token');
    if (!token) {
      const setCookie = res.headers.get('set-cookie') || '';
      const match = setCookie.match(/xsrf-token=([^;]+)/i);
      if (match) token = match[1];
    }

    if (!token) {
      throw new Error('Huawei no devolvió token XSRF en las cabeceras.');
    }

    cachedToken = token;
    tokenExpiresAt = now + (25 * 60 * 1000);

    // Guardar token y timestamp en BD para que todas las funciones lo compartan
    try {
      await admin
        .from('inversores')
        .update({
          api_token: token,
          api_last_sync: new Date().toISOString(),
        })
        .ilike('marca', 'huawei');
    } catch (_) {}

    return token;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Petición autenticada a endpoints de Huawei con manejo de reintentos por 407 y sesión expirada
 */
let lastHuaweiRequestAt = 0;

async function huaweiRequest(
  baseUrl: string,
  path: string,
  token: string,
  bodyPayload: Record<string, unknown> = {},
  retryCount = 0
): Promise<any> {
  const now = Date.now();
  const timeSinceLast = now - lastHuaweiRequestAt;
  if (timeSinceLast < 1600) {
    await sleep(1600 - timeSinceLast);
  }
  lastHuaweiRequestAt = Date.now();

  const cleanBase = baseUrl.replace(/\/+$/, '');
  const url = `${cleanBase}/thirdData/${path.replace(/^\/+/, '')}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xsrf-token': token,
      },
      body: JSON.stringify(bodyPayload),
      signal: controller.signal,
    });

    const bodyText = await res.text();
    let data: any = {};
    try {
      data = JSON.parse(bodyText);
    } catch (_) {
      throw new Error(`Huawei respondió formato inválido en ${path}: ${bodyText.slice(0, 150)}`);
    }

    if (data.failCode === 407 || bodyText.includes('ACCESS_FREQUENCY_IS_TOO_HIGH')) {
      if (retryCount < 3) {
        const waitMs = (retryCount + 1) * 3500;
        await sleep(waitMs);
        return huaweiRequest(baseUrl, path, token, bodyPayload, retryCount + 1);
      }
      throw new Error(`Huawei limitó temporalmente la consulta en ${path} (frecuencia alta / código 407).`);
    }

    if (data.failCode === 305 || data.failCode === 306 || data.failCode === 307 || data.failCode === 20400) {
      cachedToken = null;
      tokenExpiresAt = 0;
      throw new Error('SESION_EXPIRADA');
    }

    if (!data.success && data.failCode !== 0) {
      throw new Error(data.message || `Huawei error en ${path} (código ${data.failCode})`);
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response({ ok: false, error: 'Método no permitido' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return response({ ok: false, error: 'Variables de Supabase no configuradas' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  let body: any = {};
  try {
    body = await request.json();
  } catch (_) {
    body = {};
  }

  const action = toText(body?.action);

  // Helper para resolver credenciales Huawei (del body o de base de datos)
  async function resolveCredentials() {
    let apiUrl = toText(body?.apiUrl);
    let apiUser = toText(body?.apiUser || body?.apiUsername);
    let apiPassword = toText(body?.apiPassword);

    if (!apiUrl || !apiUser || !apiPassword) {
      const { data: firstHuawei } = await admin
        .from('inversores')
        .select('api_url, api_username, api_password, huawei_usuario')
        .ilike('marca', 'huawei')
        .not('api_username', 'is', null)
        .limit(1)
        .maybeSingle();

      if (!apiUrl) apiUrl = toText(firstHuawei?.api_url) || DEFAULT_HUAWEI_URL;
      if (!apiUser) apiUser = toText(firstHuawei?.api_username || firstHuawei?.huawei_usuario) || DEFAULT_HUAWEI_USER;
      if (!apiPassword) apiPassword = toText(firstHuawei?.api_password) || DEFAULT_HUAWEI_PASS;
    }

    if (!apiUrl.startsWith('http')) apiUrl = DEFAULT_HUAWEI_URL;
    return { apiUrl, apiUser, apiPassword };
  }

  // --------------------------------------------------------------------------
  // ACCIÓN 1: Obtener lista de plantas (Asistente en Frontend)
  // --------------------------------------------------------------------------
  if (action === 'get-plants') {
    try {
      const { apiUrl, apiUser, apiPassword } = await resolveCredentials();
      let token = await getHuaweiToken(admin, apiUrl, apiUser, apiPassword);

      let stationsPayload;
      try {
        stationsPayload = await huaweiRequest(apiUrl, 'stations', token, { pageNo: 1 });
      } catch (err) {
        if (err instanceof Error && err.message === 'SESION_EXPIRADA') {
          token = await getHuaweiToken(admin, apiUrl, apiUser, apiPassword, true);
          stationsPayload = await huaweiRequest(apiUrl, 'stations', token, { pageNo: 1 });
        } else {
          throw err;
        }
      }

      const rawList = stationsPayload?.data?.list || [];
      const plants = rawList.map((item: any) => ({
        plantId: toText(item.plantCode),
        plantCode: toText(item.plantCode),
        plantName: toText(item.plantName),
        capacity: numberValue(item.capacity),
        address: toText(item.plantAddress),
        contactPerson: toText(item.contactPerson),
        gridConnectionDate: toText(item.gridConnectionDate),
        latitude: numberValue(item.latitude),
        longitude: numberValue(item.longitude),
      }));

      return response({ ok: true, plants });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Error desconocido al obtener plantas de Huawei';
      return response({ ok: false, error: msg }, 400);
    }
  }

  // --------------------------------------------------------------------------
  // ACCIÓN 2: Obtener dispositivos de una planta (Asistente en Frontend)
  // --------------------------------------------------------------------------
  if (action === 'get-devices') {
    try {
      const plantCode = toText(body?.plantCode || body?.plantId);
      if (!plantCode) {
        return response({ ok: false, error: 'plantCode o plantId es requerido' }, 400);
      }

      const { apiUrl, apiUser, apiPassword } = await resolveCredentials();
      let token = await getHuaweiToken(admin, apiUrl, apiUser, apiPassword);

      let devPayload;
      try {
        devPayload = await huaweiRequest(apiUrl, 'getDevList', token, { stationCodes: plantCode });
      } catch (err) {
        if (err instanceof Error && err.message === 'SESION_EXPIRADA') {
          token = await getHuaweiToken(admin, apiUrl, apiUser, apiPassword, true);
          devPayload = await huaweiRequest(apiUrl, 'getDevList', token, { stationCodes: plantCode });
        } else {
          throw err;
        }
      }

      const rawList = devPayload?.data || [];
      const devices = rawList.map((item: any) => ({
        devId: String(item.id || item.devId || item.devDn || ''),
        devDn: toText(item.devDn),
        devName: toText(item.devName),
        devTypeId: numberValue(item.devTypeId),
        serial: toText(item.esnCode),
        esnCode: toText(item.esnCode),
        model: toText(item.invType || item.model),
        stationCode: toText(item.stationCode),
        softwareVersion: toText(item.softwareVersion),
      }));

      return response({ ok: true, devices });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Error al obtener dispositivos de Huawei';
      return response({ ok: false, error: msg }, 400);
    }
  }

  // --------------------------------------------------------------------------
  // ACCIÓN PRINCIPAL: Sincronizar un inversor por su ID
  // --------------------------------------------------------------------------
  const inverterId = toText(body?.inverterId || body?.id);
  if (!inverterId) {
    return response({ ok: false, error: 'inverterId es requerido' }, 400);
  }

  const { data: inverter, error: fetchError } = await admin
    .from('inversores')
    .select('*')
    .eq('id', inverterId)
    .single();

  if (fetchError || !inverter) {
    return response({ ok: false, error: 'Inversor no encontrado en la base de datos' }, 404);
  }

  if (toText(inverter.marca).toLowerCase() !== 'huawei') {
    return response({ ok: false, error: `El inversor ${inverter.nombre} no es de marca Huawei` }, 400);
  }

  try {
    let apiUrl = toText(inverter.api_url) || DEFAULT_HUAWEI_URL;
    let apiUser = toText(inverter.api_username || inverter.huawei_usuario) || DEFAULT_HUAWEI_USER;
    let apiPassword = toText(inverter.api_password) || DEFAULT_HUAWEI_PASS;

    if (!apiUrl.startsWith('http')) apiUrl = DEFAULT_HUAWEI_URL;

    let token = await getHuaweiToken(admin, apiUrl, apiUser, apiPassword);

    let stationCode = toText(inverter.huawei_plant_code || inverter.plant_id);

    // Si no tenemos stationCode, intentamos buscarlo por nombre en la lista de plantas
    if (!stationCode) {
      let stationsRes;
      try {
        stationsRes = await huaweiRequest(apiUrl, 'stations', token, { pageNo: 1 });
      } catch (err) {
        if (err instanceof Error && err.message === 'SESION_EXPIRADA') {
          token = await getHuaweiToken(admin, apiUrl, apiUser, apiPassword, true);
          stationsRes = await huaweiRequest(apiUrl, 'stations', token, { pageNo: 1 });
        } else {
          throw err;
        }
      }
      const list = stationsRes?.data?.list || [];
      const matched = list.find((s: any) =>
        toText(s.plantName).toLowerCase() === toText(inverter.nombre).toLowerCase() ||
        toText(inverter.nombre).toLowerCase().includes(toText(s.plantName).toLowerCase())
      );
      if (matched) {
        stationCode = toText(matched.plantCode);
      } else if (list.length > 0) {
        stationCode = toText(list[0].plantCode);
      }
    }

    if (!stationCode) {
      throw new Error(`No se encontró el código de planta (stationCode / NE=...) para "${inverter.nombre}".`);
    }

    // 1. Obtener KPIs generales de la estación (opcional como fallback)
    let stationMap: Record<string, unknown> = {};
    let healthState = 3;
    try {
      let stationKpiRes;
      try {
        stationKpiRes = await huaweiRequest(apiUrl, 'getStationRealKpi', token, { stationCodes: stationCode });
      } catch (err) {
        if (err instanceof Error && err.message === 'SESION_EXPIRADA') {
          token = await getHuaweiToken(admin, apiUrl, apiUser, apiPassword, true);
          stationKpiRes = await huaweiRequest(apiUrl, 'getStationRealKpi', token, { stationCodes: stationCode });
        } else {
          throw err;
        }
      }

      const stationKpiList = stationKpiRes?.data || [];
      const stationKpi = stationKpiList.find((s: any) => toText(s.stationCode) === stationCode) || stationKpiList[0] || {};
      stationMap = stationKpi.dataItemMap || {};
      if (stationMap.real_health_state !== undefined) {
        healthState = numberValue(stationMap.real_health_state);
      }
    } catch (stationErr) {
      console.warn(`getStationRealKpi omitido para ${stationCode} (se usarán datos directos de inversor):`, stationErr);
    }

    let dayEnergyKwh = numberValue(stationMap.day_power);
    let totalEnergyKwh = numberValue(stationMap.total_power);

    // 2. Obtener lista de dispositivos de la planta para consultar potencia activa en tiempo real (kW)
    let devListRes;
    try {
      devListRes = await huaweiRequest(apiUrl, 'getDevList', token, { stationCodes: stationCode });
    } catch (err) {
      if (err instanceof Error && err.message === 'SESION_EXPIRADA') {
        token = await getHuaweiToken(admin, apiUrl, apiUser, apiPassword, true);
        devListRes = await huaweiRequest(apiUrl, 'getDevList', token, { stationCodes: stationCode });
      } else {
        console.warn('No se pudo obtener getDevList:', err);
      }
    }

    const allDevices = devListRes?.data || [];
    // Filtrar inversores: devTypeId 1 (String Inverter comercial/residencial), 38 (Residencial), 2 (Central)
    // Ignorar dongles (devTypeId 62)
    const inverterDevices = allDevices.filter((d: any) => {
      const typeId = numberValue(d.devTypeId);
      return typeId === 1 || typeId === 38 || typeId === 2 ||
        (d.invType && String(d.invType).length > 0) ||
        (d.devName && String(d.devName).startsWith('INV')) ||
        (d.model && String(d.model).toUpperCase().includes('SUN2000'));
    });

    const candidateDevices = inverterDevices.length > 0
      ? inverterDevices
      : allDevices.filter((d: any) => numberValue(d.devTypeId) !== 62);

    // Determinar si hay múltiples registros en BD para esta misma planta
    const { count: invertersForPlant } = await admin
      .from('inversores')
      .select('id', { count: 'exact', head: true })
      .or(`huawei_plant_code.eq.${stationCode},plant_id.eq.${stationCode}`);

    const targetGateway = toText(inverter.gateway_id);
    const targetSerial = toText(inverter.device_serial);

    // Si solo hay 1 inversor en BD para esta planta, sumamos todos los inversores de la planta
    // (exactamente como se visualiza en FusionSolar). Si hay varios registrados en BD con series distintas,
    // filtramos al específico.
    let targetDevices = candidateDevices;
    if ((invertersForPlant || 1) > 1 && (targetGateway || targetSerial)) {
      const specific = candidateDevices.find((d: any) =>
        (targetGateway && String(d.id) === targetGateway) ||
        (targetSerial && toText(d.esnCode) === targetSerial)
      );
      if (specific) {
        targetDevices = [specific];
      }
    }

    const matchedDev = candidateDevices.find((d: any) =>
      (targetGateway && String(d.id) === targetGateway) ||
      (targetSerial && toText(d.esnCode) === targetSerial)
    ) || (candidateDevices.length === 1 ? candidateDevices[0] : null);

    // Agrupar dispositivos por devTypeId para consultar getDevRealKpi
    const byType = new Map<number, string[]>();
    for (const d of targetDevices) {
      const typeId = numberValue(d.devTypeId) || 1;
      const idStr = String(d.id || d.devId);
      if (idStr) {
        if (!byType.has(typeId)) byType.set(typeId, []);
        byType.get(typeId)!.push(idStr);
      }
    }

    let totalActivePower = 0;
    let totalDevDayCap = 0;
    let totalDevTotalCap = 0;
    let latestVoltajeDc = 0;
    let totalCorrienteDc = 0;
    let maxTemp = 0;
    let avgFreq = 60.0;
    let countWithFreq = 0;
    let hasDevKpi = false;

    for (const [devTypeId, idList] of byType.entries()) {
      try {
        let kpiRes;
        try {
          kpiRes = await huaweiRequest(apiUrl, 'getDevRealKpi', token, {
            devIds: idList.join(','),
            devTypeId: String(devTypeId),
          });
        } catch (err) {
          if (err instanceof Error && err.message === 'SESION_EXPIRADA') {
            token = await getHuaweiToken(admin, apiUrl, apiUser, apiPassword, true);
            kpiRes = await huaweiRequest(apiUrl, 'getDevRealKpi', token, {
              devIds: idList.join(','),
              devTypeId: String(devTypeId),
            });
          } else {
            throw err;
          }
        }

        const kpiList = kpiRes?.data || [];
        for (const item of kpiList) {
          const m = item.dataItemMap || {};
          hasDevKpi = true;

          const p = numberValue(m.active_power);
          totalActivePower += p;

          const dayCap = numberValue(m.day_cap);
          if (dayCap > 0) totalDevDayCap += dayCap;

          const totCap = numberValue(m.total_cap || m.accumul_active_power);
          if (totCap > 0) totalDevTotalCap += totCap;

          const v = numberValue(m.pv1_u || m.pv2_u || m.mppt_1_voltage || m.a_u || m.a_phase_voltage);
          if (v > 0) latestVoltajeDc = v;

          const i = numberValue(m.pv1_i || m.pv2_i || m.mppt_1_current || m.a_i || m.a_phase_current);
          if (i > 0) totalCorrienteDc += i;

          const temp = numberValue(m.temperature || m.internal_temperature);
          if (temp > maxTemp) maxTemp = temp;

          const f = numberValue(m.elec_freq || m.grid_frequency);
          if (f > 0) {
            avgFreq = f;
            countWithFreq++;
          }
        }
      } catch (devError) {
        console.warn(`Error al consultar getDevRealKpi para devTypeId ${devTypeId}:`, devError);
      }
    }

    // Potencia activa en kW (en Huawei OpenAPI devTypeId: 1/38 active_power viene en kW ej. 17.22)
    let activePowerKw = hasDevKpi ? totalActivePower : numberValue(stationMap.active_power);
    if (activePowerKw > 500) {
      activePowerKw = activePowerKw / 1000;
    }

    if (dayEnergyKwh === 0 && totalDevDayCap > 0) {
      dayEnergyKwh = totalDevDayCap;
    }
    if (totalEnergyKwh === 0 && totalDevTotalCap > 0) {
      totalEnergyKwh = totalDevTotalCap;
    }

    const voltajeDc = latestVoltajeDc || 220;
    const corrienteDc = totalCorrienteDc || (activePowerKw > 0 ? (activePowerKw * 1000) / voltajeDc : 0);
    const temperatura = maxTemp || 35.0;
    const frecuencia = avgFreq || 60.0;

    const currentUtcHour = new Date().getUTCHours();
    const isSolarTime = currentUtcHour >= 14 && currentUtcHour <= 23;
    const isOnline = activePowerKw > 0.01 || healthState === 3 || (dayEnergyKwh > 0 && isSolarTime);
    const estadoOperativo = isOnline ? 'online' : (healthState === 2 ? 'falla' : 'offline');
    const timestamp = new Date().toISOString();

    // 3. Guardar en lecturas_historicas
    const { error: insertError } = await admin.from('lecturas_historicas').insert({
      inversor_id: inverter.id,
      timestamp,
      voltaje_dc: Math.round(voltajeDc * 10) / 10,
      corriente_dc: Math.round(corrienteDc * 100) / 100,
      potencia_ac: Math.round(activePowerKw * 100) / 100,
      energia_dia: Math.round(dayEnergyKwh * 100) / 100,
      energia_total: Math.round(totalEnergyKwh * 100) / 100,
      temperatura: Math.round(temperatura * 10) / 10,
      frecuencia: Math.round(frecuencia * 100) / 100,
      estado_operativo: estadoOperativo,
    });

    if (insertError) {
      throw new Error(`Error al insertar lectura histórica: ${insertError.message}`);
    }

    // 4. Actualizar tabla inversores
    const updatePayload: Record<string, unknown> = {
      estado: isOnline ? 'online' : 'offline',
      api_status: 'connected',
      api_last_sync: timestamp,
      api_last_error: null,
      huawei_plant_code: stationCode,
      plant_id: stationCode,
    };

    if (matchedDev) {
      if (!inverter.gateway_id && matchedDev.id) updatePayload.gateway_id = String(matchedDev.id);
      if (!inverter.device_serial && matchedDev.esnCode) updatePayload.device_serial = toText(matchedDev.esnCode);
      if ((!inverter.modelo || inverter.modelo === 'No especificado') && (matchedDev.model || matchedDev.invType)) {
        updatePayload.modelo = toText(matchedDev.model || matchedDev.invType);
      }
    }

    const { error: updateError } = await admin.from('inversores').update(updatePayload).eq('id', inverter.id);
    if (updateError) {
      throw new Error(`Error al actualizar estado del inversor: ${updateError.message}`);
    }

    // 5. Gestión de Alertas
    // Alerta de Conexión
    await syncAlert(
      admin,
      inverter.id,
      'Conexión',
      !isOnline,
      `Inversor Huawei ${inverter.nombre} fuera de línea.`
    );

    // Auto-resolver alerta de API
    await syncAlert(admin, inverter.id, 'API', false, '');

    // Alerta de Rendimiento:
    // Si activePowerKw > 0.05 kW, se resuelve cualquier alerta de rendimiento activa
    if (activePowerKw > 0.05) {
      await syncAlert(admin, inverter.id, 'Rendimiento', false, '');
    } else if (isOnline && isSolarTime && activePowerKw <= 0.01) {
      await syncAlert(
        admin,
        inverter.id,
        'Rendimiento',
        true,
        `Generación nula (${activePowerKw.toFixed(2)} kW) detectada en horario solar para ${inverter.nombre}.`
      );
    }

    return response({
      ok: true,
      inverterId: inverter.id,
      nombre: inverter.nombre,
      stationCode,
      powerKw: Math.round(activePowerKw * 100) / 100,
      energyDay: Math.round(dayEnergyKwh * 100) / 100,
      energyTotal: Math.round(totalEnergyKwh * 100) / 100,
      estado: isOnline ? 'online' : 'offline',
      timestamp,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido al sincronizar con Huawei';
    console.error('huawei-sync failed:', message);

    try {
      await admin.from('inversores').update({
        api_status: 'error',
        api_last_sync: new Date().toISOString(),
        api_last_error: message,
      }).eq('id', inverter.id);

      await syncAlert(
        admin,
        inverter.id,
        'API',
        true,
        `Falla de comunicación con Huawei para ${inverter.nombre}: ${message}`
      );
    } catch (dbError) {
      console.error('huawei-sync update error:', dbError);
    }

    return response({ ok: false, error: message }, 502);
  }
});

async function syncAlert(
  admin: any,
  inverterId: string,
  tipo: string,
  conditionActive: boolean,
  message: string
) {
  try {
    if (conditionActive) {
      const { data: existing } = await admin
        .from('alertas')
        .select('id')
        .eq('inversor_id', inverterId)
        .eq('tipo', tipo)
        .eq('resuelta', false)
        .limit(1);

      if (!existing || existing.length === 0) {
        await admin.from('alertas').insert({
          inversor_id: inverterId,
          tipo,
          mensaje: message,
          fecha: new Date().toISOString(),
          resuelta: false,
        });
      }
    } else {
      await admin
        .from('alertas')
        .update({
          resuelta: true,
          resuelta_por: null,
          fecha_resolucion: new Date().toISOString(),
        })
        .eq('inversor_id', inverterId)
        .eq('tipo', tipo)
        .eq('resuelta', false);
    }
  } catch (alertError) {
    console.error(`Error al sincronizar alerta ${tipo}:`, alertError);
  }
}
