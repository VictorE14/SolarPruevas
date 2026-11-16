// api/send-alert.js - Serverless function para Vercel usando Resend
export default async function handler(req, res) {
  // Configuración de cabeceras CORS
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

  const { inversorNombre, tipo, mensaje, fecha, destinatario } = req.body || {};

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('Falta la variable de entorno RESEND_API_KEY en Vercel.');
    return res.status(500).json({ ok: false, error: 'Servicio de correo no configurado (RESEND_API_KEY no encontrada).' });
  }

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
        <div style="background-color: #f1f5f9; padding: 16px; text-align: center; color: #94a3b8; font-size: 11px;">
          Este es un correo generado automáticamente por el Sistema de Monitoreo Fotovoltaico CRODE Mérida.
        </div>
      </div>
    </div>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromEmail,
        to: toEmail,
        subject: subject,
        html: htmlContent
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Error desde Resend:', data);
      return res.status(response.status).json({ ok: false, error: data });
    }

    return res.status(200).json({ ok: true, id: data.id });
  } catch (err) {
    console.error('Fallo en la llamada a Resend:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

