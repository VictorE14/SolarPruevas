type AlertRecord = {
  id: string;
  inversor_id: string;
  tipo: string;
  mensaje: string;
  fecha: string;
};

type Preference = {
  usuario_id: string;
  email_destino: string | null;
  whatsapp_numero: string | null;
  email_habilitado: boolean;
  whatsapp_habilitado: boolean;
  whatsapp_consentimiento: boolean;
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

async function createDelivery(admin: any, alertId: string, userId: string, channel: string) {
  const { error } = await admin.from('notificaciones_destinatarios_envios').insert({
    alerta_id: alertId,
    usuario_id: userId,
    canal: channel,
    estado: 'pendiente',
  });
  if (error?.code === '23505') return false;
  if (error) throw error;
  return true;
}

async function updateDelivery(
  admin: any,
  alertId: string,
  userId: string,
  channel: string,
  status: 'enviado' | 'error',
  providerId: string | null,
  errorMessage: string | null,
) {
  const { error } = await admin
    .from('notificaciones_destinatarios_envios')
    .update({
      estado: status,
      proveedor_id: providerId,
      error: errorMessage,
      enviado_en: status === 'enviado' ? new Date().toISOString() : null,
    })
    .eq('alerta_id', alertId)
    .eq('usuario_id', userId)
    .eq('canal', channel);
  if (error) throw error;
}

async function sendEmail(admin: any, alert: AlertRecord, userId: string, recipient: string, inverterName: string) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('RESEND_FROM_EMAIL');
  if (!apiKey || !from) throw new Error('Configura RESEND_API_KEY y RESEND_FROM_EMAIL en Supabase.');
  if (!(await createDelivery(admin, alert.id, userId, 'correo'))) return;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `crode-alert-${alert.id}-${userId}-email`,
      },
      body: JSON.stringify({
        from,
        to: recipient,
        subject: `Alerta CRODE Solar: ${alert.tipo}`,
        text: [
          `Se detectó una alerta en el inversor ${inverterName}.`,
          `Tipo: ${alert.tipo}`,
          `Detalle: ${alert.mensaje}`,
          `Fecha: ${alert.fecha}`,
        ].join('\n'),
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(text(result?.message) || `Resend respondió HTTP ${response.status}.`);
    await updateDelivery(admin, alert.id, userId, 'correo', 'enviado', text(result?.id) || null, null);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido al enviar correo.';
    await updateDelivery(admin, alert.id, userId, 'correo', 'error', null, message);
    throw error;
  }
}

async function sendWhatsApp(
  admin: any,
  alert: AlertRecord,
  userId: string,
  recipient: string,
  inverterName: string,
) {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
  const from = Deno.env.get('TWILIO_WHATSAPP_FROM');
  const contentSid = Deno.env.get('TWILIO_CONTENT_SID');
  if (!accountSid || !authToken || !from || !contentSid) {
    throw new Error('Configura los secretos de Twilio para WhatsApp en Supabase.');
  }
  if (!(await createDelivery(admin, alert.id, userId, 'whatsapp'))) return;

  try {
    const body = new URLSearchParams({
      From: from,
      To: `whatsapp:${recipient}`,
      ContentSid: contentSid,
      ContentVariables: JSON.stringify({
        '1': inverterName,
        '2': alert.tipo,
        '3': alert.mensaje.slice(0, 900),
        '4': alert.fecha,
      }),
    });
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(text(result?.message) || `Twilio respondió HTTP ${response.status}.`);
    await updateDelivery(admin, alert.id, userId, 'whatsapp', 'enviado', text(result?.sid) || null, null);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido al enviar WhatsApp.';
    await updateDelivery(admin, alert.id, userId, 'whatsapp', 'error', null, message);
    throw error;
  }
}

export async function sendAlertNotifications(admin: any, alert: AlertRecord) {
  const { data: inverter, error: inverterError } = await admin
    .from('inversores')
    .select('id,nombre,usuario_id')
    .eq('id', alert.inversor_id)
    .maybeSingle();
  if (inverterError) throw inverterError;
  if (!inverter) throw new Error(`No se encontró el inversor de la alerta ${alert.id}.`);

  const { data: assignments, error: assignmentError } = await admin
    .from('inversores_tecnicos')
    .select('usuario_id')
    .eq('inversor_id', inverter.id);
  if (assignmentError) throw assignmentError;

  const userIds = new Set((assignments || []).map((row: { usuario_id: string }) => row.usuario_id));
  if (inverter.usuario_id) userIds.add(inverter.usuario_id);
  if (!userIds.size) return;

  const { data: users, error: usersError } = await admin
    .from('usuarios')
    .select('id,rol,estado')
    .in('id', [...userIds]);
  if (usersError) throw usersError;

  const eligibleUsers = (users || []).filter((user: any) =>
    user.estado === 'activo' && ['tecnico', 'invitado'].includes(user.rol)
  );
  if (!eligibleUsers.length) return;

  const { data: preferences, error: preferencesError } = await admin
    .from('preferencias_notificaciones')
    .select('usuario_id,email_destino,whatsapp_numero,email_habilitado,whatsapp_habilitado,whatsapp_consentimiento')
    .in('usuario_id', eligibleUsers.map((user: any) => user.id));
  if (preferencesError) throw preferencesError;

  const preferencesByUser = new Map<string, Preference>(
    (preferences || []).map((item: Preference) => [item.usuario_id, item]),
  );
  const inverterName = text(inverter.nombre) || inverter.id;

  const results = await Promise.allSettled(eligibleUsers.map(async (user: any) => {
    const preference = preferencesByUser.get(user.id);
    if (!preference) return;

    const tasks: Promise<void>[] = [];
    if (preference.email_habilitado && preference.email_destino) {
      tasks.push(sendEmail(admin, alert, user.id, preference.email_destino, inverterName));
    }
    if (
      preference.whatsapp_habilitado &&
      preference.whatsapp_consentimiento &&
      preference.whatsapp_numero
    ) {
      tasks.push(sendWhatsApp(admin, alert, user.id, preference.whatsapp_numero, inverterName));
    }
    await Promise.all(tasks);
  }));

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`Alert ${alert.id} notification failed for user ${eligibleUsers[index].id}:`, result.reason);
    }
  });
}
