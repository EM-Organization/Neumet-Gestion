import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const RESEND_API_KEY    = Deno.env.get('RESEND_API_KEY');
const TO_EMAIL          = Deno.env.get('TO_EMAIL');
const FROM_EMAIL        = Deno.env.get('FROM_EMAIL') || 'NEUMET Contacto <onboarding@resend.dev>';
const TURNSTILE_SECRET  = Deno.env.get('TURNSTILE_SECRET');
const ALLOWED_ORIGINS   = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const MAX_BODY_BYTES = 10 * 1024;
const LIMITS = { nombre: 100, email: 254, empresa: 120, telefono: 40, mensaje: 2000 } as const;
const EMAIL_RE = /^[^\s@<>"',;:]+@[^\s@<>"',;:]+\.[^\s@<>"',;:]{2,}$/;

let warnedNoOrigins = false;

function log(level: 'info' | 'warn' | 'error', request_id: string, event: string, extra: Record<string, unknown> = {}) {
  // Nunca incluir datos personales (nombre, email, telefono, mensaje).
  const line = JSON.stringify({ level, request_id, event, ...extra });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

async function verifyTurnstile(token: string, ip: string | null): Promise<boolean> {
  const form = new URLSearchParams({ secret: TURNSTILE_SECRET!, response: token });
  if (ip) form.set('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', body: form,
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data?.success === true;
}

Deno.serve(async (req: Request) => {
  const request_id = crypto.randomUUID();
  const origin = req.headers.get('origin');

  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };

  if (ALLOWED_ORIGINS.length > 0) {
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      corsHeaders['Access-Control-Allow-Origin'] = origin;
    } else if (origin) {
      log('warn', request_id, 'origin_not_allowed');
      return json({ error: 'Origen no permitido' }, 403, corsHeaders);
    }
    // Sin cabecera Origin (no navegador): se deja pasar sin ACAO.
  } else {
    if (!warnedNoOrigins) {
      warnedNoOrigins = true;
      console.warn(JSON.stringify({ level: 'warn', event: 'allowed_origins_unset', msg: 'ALLOWED_ORIGINS no definido: usando * como fallback' }));
    }
    corsHeaders['Access-Control-Allow-Origin'] = '*';
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  if (!TO_EMAIL || !RESEND_API_KEY) {
    log('error', request_id, 'missing_config', { to_email: !!TO_EMAIL, resend_key: !!RESEND_API_KEY });
    return json({ error: 'Servicio de email no configurado' }, 500, corsHeaders);
  }

  // Límite de tamaño: leer texto y comprobar antes de parsear.
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return json({ error: 'Solicitud demasiado grande' }, 413, corsHeaders);
  }
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return json({ error: 'Invalid JSON' }, 400, corsHeaders);
  }
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return json({ error: 'Solicitud demasiado grande' }, 413, corsHeaders);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON' }, 400, corsHeaders);
  }

  // Honeypot: responder éxito sin enviar.
  if (body.website !== undefined && body.website !== null && String(body.website).trim() !== '') {
    log('info', request_id, 'honeypot');
    return json({ ok: true }, 200, corsHeaders);
  }

  // Validación de tipos y longitudes.
  for (const k of ['nombre', 'email', 'empresa', 'telefono', 'mensaje'] as const) {
    const v = body[k];
    if (v !== undefined && v !== null && typeof v !== 'string') {
      return json({ error: `${k} debe ser texto` }, 400, corsHeaders);
    }
  }
  const nombre   = ((body.nombre   as string | undefined) ?? '').trim();
  const email    = ((body.email    as string | undefined) ?? '').trim();
  const empresa  = ((body.empresa  as string | undefined) ?? '').trim();
  const telefono = ((body.telefono as string | undefined) ?? '').trim();
  const mensaje  = ((body.mensaje  as string | undefined) ?? '').trim();

  if (!nombre || !email) {
    return json({ error: 'nombre y email son requeridos' }, 400, corsHeaders);
  }
  if (nombre.length > LIMITS.nombre)     return json({ error: `nombre excede ${LIMITS.nombre} caracteres` }, 400, corsHeaders);
  if (email.length > LIMITS.email)       return json({ error: `email excede ${LIMITS.email} caracteres` }, 400, corsHeaders);
  if (empresa.length > LIMITS.empresa)   return json({ error: `empresa excede ${LIMITS.empresa} caracteres` }, 400, corsHeaders);
  if (telefono.length > LIMITS.telefono) return json({ error: `telefono excede ${LIMITS.telefono} caracteres` }, 400, corsHeaders);
  if (mensaje.length > LIMITS.mensaje)   return json({ error: `mensaje excede ${LIMITS.mensaje} caracteres` }, 400, corsHeaders);
  if (/[\r\n]/.test(nombre) || /[\r\n]/.test(email) || /[\r\n]/.test(empresa)) {
    return json({ error: 'Caracteres no permitidos en nombre, email o empresa' }, 400, corsHeaders);
  }
  if (!EMAIL_RE.test(email)) {
    return json({ error: 'Email inválido' }, 400, corsHeaders);
  }

  // Turnstile opcional.
  if (TURNSTILE_SECRET) {
    const token = body.cf_token;
    if (typeof token !== 'string' || !token || token.length > 2048) {
      return json({ error: 'Verificación anti-bot requerida' }, 400, corsHeaders);
    }
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || null;
    let ok = false;
    try {
      ok = await verifyTurnstile(token, ip);
    } catch (e) {
      log('error', request_id, 'turnstile_error', { err: e instanceof Error ? e.name : 'unknown' });
    }
    if (!ok) {
      return json({ error: 'Verificación anti-bot fallida' }, 400, corsHeaders);
    }
  }

  const eNombre   = escapeHtml(nombre);
  const eEmpresa  = escapeHtml(empresa);
  const eEmail    = escapeHtml(email);
  const eTelefono = escapeHtml(telefono);
  const eMensaje  = escapeHtml(mensaje).replace(/\r?\n/g, '<br>');

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #EBEBEB">
      <div style="background:#383424;padding:32px;text-align:center">
        <h1 style="margin:0;color:#D5C58A;font-size:24px;font-weight:800;letter-spacing:1px">NEUMET</h1>
        <p style="margin:8px 0 0;color:#EBEBEB;font-size:14px">Nueva consulta de contacto</p>
      </div>
      <div style="padding:32px">
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:10px 0;border-bottom:1px solid #EBEBEB;color:#615A3F;font-size:13px;width:130px">Nombre</td><td style="padding:10px 0;border-bottom:1px solid #EBEBEB;font-weight:600;font-size:14px;color:#383424">${eNombre}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #EBEBEB;color:#615A3F;font-size:13px">Empresa</td><td style="padding:10px 0;border-bottom:1px solid #EBEBEB;font-size:14px;color:#383424">${eEmpresa || '—'}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #EBEBEB;color:#615A3F;font-size:13px">Email</td><td style="padding:10px 0;border-bottom:1px solid #EBEBEB;font-size:14px"><a href="mailto:${eEmail}" style="color:#383424">${eEmail}</a></td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #EBEBEB;color:#615A3F;font-size:13px">Teléfono</td><td style="padding:10px 0;border-bottom:1px solid #EBEBEB;font-size:14px;color:#383424">${eTelefono || '—'}</td></tr>
        </table>
        ${mensaje ? `<div style="margin-top:24px;background:#EBEBEB;border-radius:12px;padding:20px"><p style="margin:0 0 8px;color:#615A3F;font-size:12px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Mensaje</p><p style="margin:0;font-size:14px;line-height:1.6;color:#383424">${eMensaje}</p></div>` : ''}
      </div>
      <div style="padding:20px 32px;background:#EBEBEB;text-align:center">
        <p style="margin:0;font-size:12px;color:#615A3F">NEUMET · Calibre digital inteligente para flotas de transporte</p>
      </div>
    </div>
  `;

  // Asunto: sin saltos de línea (ya validado) y acotado.
  const subject = `Nueva consulta de ${nombre}${empresa ? ' · ' + empresa : ''}`.slice(0, 200);

  let resendRes: Response;
  try {
    resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [TO_EMAIL],
        reply_to: email,
        subject,
        html,
      }),
    });
  } catch (e) {
    log('error', request_id, 'resend_fetch_failed', { err: e instanceof Error ? e.name : 'unknown' });
    return json({ error: 'No se pudo enviar el email' }, 500, corsHeaders);
  }

  if (!resendRes.ok) {
    // No se registra el cuerpo de la respuesta (podría reflejar datos personales).
    log('error', request_id, 'resend_error', { status: resendRes.status });
    return json({ error: 'No se pudo enviar el email' }, 500, corsHeaders);
  }

  return json({ ok: true }, 200, corsHeaders);
});
