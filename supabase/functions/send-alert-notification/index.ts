declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response> | Response): void;
};

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendAlertNotifications } from '../_shared/notifications.ts';

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

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response({ ok: false, error: 'Método no permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return response({ ok: false, error: 'Falta la configuración de Supabase.' }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return response({ ok: false, error: 'La solicitud no contiene JSON válido.' }, 400);
  }

  const alertId = String(body.alertId ?? '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(alertId)) {
    return response({ ok: false, error: 'El identificador de alerta no es válido.' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const recentCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  try {
    const { data: alert, error } = await admin
      .from('alertas')
      .select('id,inversor_id,tipo,mensaje,fecha')
      .eq('id', alertId)
      .eq('resuelta', false)
      .gte('fecha', recentCutoff)
      .maybeSingle();
    if (error) throw error;
    if (!alert) return response({ ok: false, error: 'No se encontró una alerta nueva para enviar.' }, 404);

    await sendAlertNotifications(admin, alert);
    return response({ ok: true });
  } catch (error) {
    console.error('send-alert-notification failed:', error);
    return response({
      ok: false,
      error: error instanceof Error ? error.message : 'No se pudo enviar el correo.',
    }, 500);
  }
});
