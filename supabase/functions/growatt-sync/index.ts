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

type Inversor = {
  id: string;
  nombre: string;
  marca: string;
  plant_id: string | null;
  gateway_id: string | null;
  device_serial: string | null;
  api_token: string | null;
  api_url: string | null;
};

const GROWATT_RATE_LIMIT_ERROR = 'error_frequently_access';

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

function findNumber(source: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
      return numberValue(source[key]);
    }
  }
  return 0;
}

function findPower(source: Record<string, unknown>): number {
  const keys = [
    'power',
    'pac',
    'current_power',
    'currentPower',
    'power_value',
    'powerValue',
    'output_power',
    'outputPower',
    'ppv',
  ];
  const directValue = findNumber(source, keys);
  if (directValue !== 0) return directValue;

  for (const value of Object.values(source)) {
    if (value && typeof value === 'object') {
      const nestedValue = Array.isArray(value)
        ? value.reduce((result, item) => result || (item && typeof item === 'object' ? findPower(item as Record<string, unknown>) : 0), 0)
        : findPower(value as Record<string, unknown>);
      if (nestedValue !== 0) return nestedValue;
    }
  }

  return 0;
}

function normalized(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function getPayloadData(payload: any): any {
  if (!payload || typeof payload !== 'object') return payload;
  if ('data' in payload && payload.data !== undefined) return payload.data;
  return payload;
}

async function growattRequest(baseUrl: string, path: string, token: string, params?: Record<string, string>) {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/v1/${path}`);
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);
  let result: Response;
  try {
    result = await fetch(url.toString(), {
      headers: { token, Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Tiempo de espera agotado al consultar Growatt en ${path}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  const rawText = await result.text();
  let payload: any = null;
  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    payload = { raw: rawText };
  }

  if (!result.ok) {
    if (rawText.includes(GROWATT_RATE_LIMIT_ERROR)) {
      throw new Error(`Growatt limitó temporalmente las consultas en ${path}. Espera unos minutos antes de reintentar.`);
    }
    throw new Error(`Growatt respondió HTTP ${result.status} en ${path}: ${rawText.slice(0, 250)}`);
  }

  const data = getPayloadData(payload);
  if (payload && typeof payload === 'object' && payload.error_code !== undefined && payload.error_code !== 0) {
    if (String(payload.error_code) === 'error_permission_denied') {
      throw new Error('Growatt rechazó el token API (error_permission_denied). Verifica que api_token contenga el token de Growatt vigente y que tenga acceso a la cuenta y planta.');
    }
    throw new Error(payload.error_msg || `Growatt respondió código ${String(payload.error_code)}`);
  }

  if (data === undefined || data === null) {
    throw new Error(`Growatt no devolvió datos para ${path}`);
  }

  return data;
}

async function tryGrowattRequest(baseUrl: string, path: string, token: string, params?: Record<string, string>) {
  try {
    return await growattRequest(baseUrl, path, token, params);
  } catch (error) {
    console.warn(`Growatt endpoint opcional ${path} no disponible:`, error instanceof Error ? error.message : error);
    return null;
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response({ error: 'Método no permitido' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return response({ ok: false, error: 'Faltan secretos de Supabase: SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const body = await request.json().catch(() => ({}));
  const inverterId = typeof body?.inverterId === 'string' ? body.inverterId.trim() : '';

  if (!inverterId) {
    return response({ ok: false, error: 'inverterId es obligatorio' }, 400);
  }

  let inverter: Inversor | null = null;
  try {
    const { data, error } = await admin
      .from('inversores')
      .select('id,nombre,marca,plant_id,gateway_id,device_serial,api_token,api_url')
      .eq('id', inverterId)
      .single<Inversor>();

    if (error) throw new Error(error.message || 'Inversor no encontrado');
    inverter = data;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Inversor no encontrado';
    return response({ ok: false, error: message }, 404);
  }

  if (!inverter) {
    return response({ ok: false, error: 'Inversor no encontrado' }, 404);
  }

  if (inverter.marca?.toLowerCase() !== 'growatt') {
    return response({ ok: false, error: 'El inversor no es Growatt' }, 400);
  }

  const tokenFromBody = typeof body?.apiToken === 'string' ? body.apiToken.trim() : '';
  const token = toText(inverter.api_token || tokenFromBody);
  if (!token) {
    return response({ ok: false, error: 'El inversor no tiene token API configurado' }, 400);
  }

  if (!inverter.device_serial) {
    return response({ ok: false, error: 'Falta el número de serie del inversor' }, 400);
  }

  const baseUrl = inverter.api_url?.startsWith('http') ? inverter.api_url : 'https://openapi.growatt.com';

  try {
    let plantId = inverter.plant_id || '';
    if (!plantId) {
      const plantsPayload = await growattRequest(baseUrl, 'plant/list', token, {
        page: '',
        perpage: '',
        search_type: '',
        search_keyword: '',
      });
      const plants = Array.isArray(plantsPayload?.plants) ? plantsPayload.plants : [];
      const matchingPlant = plants.find((plant: Record<string, unknown>) =>
        normalized(plant.name ?? plant.plant_name) === normalized(inverter.nombre)
      );
      if (matchingPlant) {
        plantId = String(matchingPlant.id ?? matchingPlant.plant_id ?? '');
        if (plantId) await admin.from('inversores').update({ plant_id: plantId }).eq('id', inverter.id);
      }
    }

    if (!plantId) {
      throw new Error('No se encontró la planta Growatt para este inversor');
    }

    // Con plant_id guardado no se consulta device/list en cada ciclo; Growatt
    // limita rápidamente las consultas repetitivas de ese endpoint.
    const device: Record<string, unknown> = {};

    const findPlantId = async () => {
      const plantsPayload = await growattRequest(baseUrl, 'plant/list', token, {
        page: '',
        perpage: '',
        search_type: '',
        search_keyword: '',
      });
      const plants = Array.isArray(plantsPayload?.plants) ? plantsPayload.plants : [];
      const matchingPlant = plants.find((plant: Record<string, unknown>) =>
        normalized(plant.name ?? plant.plant_name) === normalized(inverter?.nombre)
      );
      const resolvedId = matchingPlant
        ? String(matchingPlant.id ?? matchingPlant.plant_id ?? '')
        : '';
      if (!resolvedId) {
        throw new Error(`La planta Growatt "${inverter?.nombre}" no existe con este token o no coincide con el nombre registrado`);
      }
      await admin.from('inversores').update({ plant_id: resolvedId }).eq('id', inverter.id);
      return resolvedId;
    };

    let plantData;
    let plantPower;
    try {
      plantData = await growattRequest(baseUrl, 'plant/data', token, { plant_id: plantId });
      plantPower = await growattRequest(baseUrl, 'plant/power', token, {
        plant_id: plantId,
        date: new Date().toISOString().slice(0, 10),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/plant.*does not exist/i.test(message)) throw error;
      plantId = await findPlantId();
      plantData = await growattRequest(baseUrl, 'plant/data', token, { plant_id: plantId });
      plantPower = await growattRequest(baseUrl, 'plant/power', token, {
        plant_id: plantId,
        date: new Date().toISOString().slice(0, 10),
      });
    }
    const source = (plantData && typeof plantData === 'object' ? plantData : {}) as Record<string, unknown>;
    const powerRows = Array.isArray(plantPower?.powers) ? plantPower.powers : [];
    const latestPower = [...powerRows].reverse().find((row: Record<string, unknown>) => findPower(row) > 0) || (powerRows.at(-1) || {});
    const power = findPower(latestPower) || findPower(source) || findPower(device as Record<string, unknown>);
    const energyToday = findNumber(source, ['today_energy', 'energy_today', 'e_today']);
    const energyTotal = findNumber(source, ['total_energy', 'energy_total', 'e_total']);
    const powerKw = power > 100 ? power / 1000 : power;
    const timestamp = new Date().toISOString();
    const deviceStatus = String(device.status ?? source.status ?? '').toLowerCase();
    const explicitlyOffline = deviceStatus === '0' || deviceStatus === 'offline' || deviceStatus === 'lost' || device.lost === true;
    const online = !explicitlyOffline;

    const { error: readingError } = await admin.from('lecturas_historicas').insert({
      inversor_id: inverter.id,
      timestamp,
      potencia_ac: powerKw,
      energia_dia: energyToday,
      energia_total: energyTotal,
      estado_operativo: online ? 'online' : 'offline',
    });

    if (readingError) {
      throw new Error(`No se pudo guardar la lectura: ${readingError.message}`);
    }

    const { error: updateError } = await admin.from('inversores').update({
      estado: online ? 'online' : 'offline',
      api_status: 'connected',
      api_last_sync: timestamp,
      api_last_error: null,
      plant_id: plantId,
    }).eq('id', inverter.id);

    if (updateError) {
      throw new Error(`No se pudo actualizar el estado: ${updateError.message}`);
    }

    return response({
      ok: true,
      inverterId: inverter.id,
      plantId,
      device,
      power,
      powerKw,
      energyToday,
      energyTotal,
      timestamp,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido al consultar Growatt';
    console.error('growatt-sync failed:', message);

    try {
      await admin.from('inversores').update({
        api_status: 'error',
        api_last_sync: new Date().toISOString(),
        api_last_error: message,
      }).eq('id', inverter.id);
    } catch (updateError) {
      console.error('growatt-sync update error:', updateError);
    }

    return response({ ok: false, error: message }, 502);
  }
});
