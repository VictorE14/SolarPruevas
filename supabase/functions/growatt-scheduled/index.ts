// @ts-nocheck

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Inverter = {
  id: string;
  nombre: string;
  marca: string;
  api_token: string | null;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response({ ok: false, error: 'Método no permitido' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const cronSecret = Deno.env.get('GROWATT_CRON_SECRET');
  if (!supabaseUrl || !serviceRoleKey || !cronSecret) {
    return response({ ok: false, error: 'Faltan secretos de Supabase o del cron' }, 500);
  }

  if (request.headers.get('x-cron-secret') !== cronSecret) {
    return response({ ok: false, error: 'No autorizado' }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: inverters, error: queryError } = await admin
    .from('inversores')
    .select('id,nombre,marca,api_token')
    .ilike('marca', 'growatt')
    .not('api_token', 'is', null)
    .order('api_last_sync', { ascending: true, nullsFirst: true })
    .limit(1);

  if (queryError) return response({ ok: false, error: queryError.message }, 500);

  const results = [];
  for (const inverter of (inverters || []) as Inverter[]) {
    const { data, error } = await admin.functions.invoke('growatt-sync', {
      body: { inverterId: inverter.id },
    });
    results.push({
      inverterId: inverter.id,
      nombre: inverter.nombre,
      ok: !error && data?.ok === true,
      error: error?.message || data?.error || null,
    });
  }

  return response({
    ok: results.every(result => result.ok),
    processed: results.length,
    results,
  });
});
