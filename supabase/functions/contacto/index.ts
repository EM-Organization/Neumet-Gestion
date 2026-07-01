import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const TO_EMAIL       = 'contacto.neumet@gmail.com';

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { nombre, empresa, email, telefono, mensaje } = body;

  if (!nombre || !email) {
    return new Response(JSON.stringify({ error: 'nombre y email son requeridos' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'Servicio de email no configurado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e5e5ea">
      <div style="background:#3D3C20;padding:32px;text-align:center">
        <h1 style="margin:0;color:#C9B96A;font-size:24px;font-weight:800;letter-spacing:1px">NEUMET</h1>
        <p style="margin:8px 0 0;color:rgba(255,255,255,0.6);font-size:14px">Nueva consulta de contacto</p>
      </div>
      <div style="padding:32px">
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:10px 0;border-bottom:1px solid #f2f2f2;color:#9E9D82;font-size:13px;width:130px">Nombre</td><td style="padding:10px 0;border-bottom:1px solid #f2f2f2;font-weight:600;font-size:14px;color:#2C2B18">${nombre}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #f2f2f2;color:#9E9D82;font-size:13px">Empresa</td><td style="padding:10px 0;border-bottom:1px solid #f2f2f2;font-size:14px;color:#2C2B18">${empresa || '—'}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #f2f2f2;color:#9E9D82;font-size:13px">Email</td><td style="padding:10px 0;border-bottom:1px solid #f2f2f2;font-size:14px"><a href="mailto:${email}" style="color:#3D3C20">${email}</a></td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #f2f2f2;color:#9E9D82;font-size:13px">Teléfono</td><td style="padding:10px 0;border-bottom:1px solid #f2f2f2;font-size:14px;color:#2C2B18">${telefono || '—'}</td></tr>
        </table>
        ${mensaje ? `<div style="margin-top:24px;background:#F9F8F3;border-radius:12px;padding:20px"><p style="margin:0 0 8px;color:#9E9D82;font-size:12px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Mensaje</p><p style="margin:0;font-size:14px;line-height:1.6;color:#2C2B18">${mensaje.replace(/\n/g,'<br>')}</p></div>` : ''}
      </div>
      <div style="padding:20px 32px;background:#F5F4EE;text-align:center">
        <p style="margin:0;font-size:12px;color:#9E9D82">NEUMET · Calibre digital inteligente para flotas de transporte</p>
      </div>
    </div>
  `;

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'NEUMET Contacto <onboarding@resend.dev>',
      to: [TO_EMAIL],
      reply_to: email,
      subject: `Nueva consulta de ${nombre}${empresa ? ' · ' + empresa : ''}`,
      html,
    }),
  });

  if (!resendRes.ok) {
    const err = await resendRes.text();
    console.error('Resend error:', err);
    return new Response(JSON.stringify({ error: 'No se pudo enviar el email' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
