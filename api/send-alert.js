// api/send-alert.js - Serverless function para Vercel (Email con Resend + WhatsApp con Twilio)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  const { inversorNombre, tipo, mensaje, fecha, destinatario, whatsappNumero } = req.body || {};

  const results = { email: null, whatsapp: null };

  // ==========================================
  // 1. ENVÍO DE CORREO ELECTRÓNICO (RESEND)
  // ==========================================
  const resendApiKey = process.env.RESEND_API_KEY;
  if (resendApiKey) {
    try {
      const fromEmail = process.env.RESEND_FROM_EMAIL || 'CRODE Solar <onboarding@resend.dev>';
      const toEmail = destinatario || process.env.ALERT_EMAIL_RECIPIENT || 'tuzdzidzv@gmail.com';
      const subject = `⚠️ Alerta CRODE Solar: ${tipo || 'Incidencia'} en ${inversorNombre || 'Inversor'}`;
      
      const htmlContent = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; padding: 24px;">
          <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); border: 1px solid #e2e8f0;">
            <div style="background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); padding: 20px 24px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 700;">☀️ CRODE Solar - Alerta de Monitoreo</h1>
              <p style="color: #93c5fd; margin: 4px 0 0 0; font-size: 13px;">TecNM CRODE Mérida</p>
            </div>
            <div style="padding: 24px;">
              <div style="display: inline-block; background-color: #fee2e2; color: #dc2626; padding: 6px 12px; border-radius: 9999px; font-weight: 600; font-size: 12px; margin-bottom: 16px;">
                ${tipo ? tipo.toUpperCase() : 'DESCONEXIÓN'}
              </div>
              <h2 style="color: #1e293b; margin: 0 0 12px 0; font-size: 18px;">Se ha detectado una incidencia</h2>
              <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 20px 0;">
                ${mensaje || 'El inversor ha dejado de responder o se encuentra fuera de línea.'}
              </p>
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px;">
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Inversor afectado:</td>
                  <td style="padding: 10px 0; color: #0f172a; text-align: right; font-weight: 700;">${inversorNombre || 'Desconocido'}</td>
                </tr>
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Fecha y hora:</td>
                  <td style="padding: 10px 0; color: #0f172a; text-align: right;">${fecha || new Date().toLocaleString('es-MX', { timeZone: 'America/Cancun' })}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; color: #64748b; font-weight: 600;">Estado del equipo:</td>
                  <td style="padding: 10px 0; color: #dc2626; text-align: right; font-weight: 700;">OFFLINE</td>
                </tr>
              </table>
              <div style="text-align: center; margin-top: 24px;">
                <a href="https://solar-pruevas.vercel.app/monitor.html" style="background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; display: inline-block;">
                  Abrir Dashboard de Monitoreo
                </a>
              </div>
            </div>
          </div>
        </div>
      `;

      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: fromEmail,
          to: toEmail,
          subject: subject,
          html: htmlContent
        })
      });
      results.email = await emailRes.json();
    } catch (e) {
      results.email = { error: e.message };
    }
  }

  // ==========================================
  // 2. ENVÍO DE WHATSAPP (TWILIO)
  // ==========================================
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_WHATSAPP_FROM || '+17372508034'; // Tu número Sandbox de Twilio
  const targetPhone = whatsappNumero || process.env.ALERT_WHATSAPP_RECIPIENT;

  if (twilioSid && twilioToken && targetPhone) {
    try {
      // Limpiar formato del teléfono (quitar espacios o guiones)
      const cleanPhone = targetPhone.replace(/[\s\-]/g, '');
      const toWhatsApp = cleanPhone.startsWith('whatsapp:') ? cleanPhone : `whatsapp:${cleanPhone}`;
      const fromWhatsApp = twilioFrom.startsWith('whatsapp:') ? twilioFrom : `whatsapp:${twilioFrom}`;

      const whatsappText = `☀️ *ALERTA CRODE SOLAR*\n\n⚠️ *Incidencia*: ${tipo || 'Desconexión'}\n📍 *Inversor*: ${inversorNombre || 'Inversor'}\n📝 *Detalle*: ${mensaje || 'Equipo fuera de línea'}\n⏰ *Fecha*: ${fecha || new Date().toLocaleTimeString()}\n\n🔗 Ver panel: https://solar-pruevas.vercel.app/monitor.html`;

      const params = new URLSearchParams();
      params.append('From', fromWhatsApp);
      params.append('To', toWhatsApp);
      params.append('Body', whatsappText);

      const twilioRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
      });

      results.whatsapp = await twilioRes.json();
    } catch (e) {
      results.whatsapp = { error: e.message };
    }
  }

  return res.status(200).json({ ok: true, results });
}
