// ── CAPTCHA ──────────────────────────────────────────────────────────────────
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let captchaCode = '';

function randomInt(min, max){ return Math.floor(Math.random() * (max - min + 1)) + min; }

function refreshCaptcha(){
  captchaCode = Array.from({length:5}, () => CHARS[randomInt(0, CHARS.length-1)]).join('');
  document.getElementById('captcha-input').value = '';
  drawCaptcha();
}

function drawCaptcha(){
  const canvas = document.getElementById('captcha-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  ctx.clearRect(0, 0, W, H);

  // Fondo con leve textura
  const cs = getComputedStyle(document.documentElement);
  ctx.fillStyle = cs.getPropertyValue('--surface-2').trim();
  ctx.fillRect(0, 0, W, H);

  // Líneas de ruido
  for(let i = 0; i < 5; i++){
    ctx.beginPath();
    ctx.moveTo(randomInt(0, W), randomInt(0, H));
    ctx.bezierCurveTo(
      randomInt(0,W), randomInt(0,H),
      randomInt(0,W), randomInt(0,H),
      randomInt(0,W), randomInt(0,H)
    );
    ctx.strokeStyle = `rgba(${randomInt(100,180)},${randomInt(100,180)},${randomInt(80,140)},0.35)`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  // Caracteres
  const colors = ['--text-primary','--accent-dark','--text-secondary'].map(v => cs.getPropertyValue(v).trim());
  const startX = 18;
  const stepX  = (W - startX * 2) / captchaCode.length;

  captchaCode.split('').forEach((ch, i) => {
    ctx.save();
    const x = startX + i * stepX + stepX / 2;
    const y = H / 2 + randomInt(-4, 4);
    ctx.translate(x, y);
    ctx.rotate((randomInt(-18, 18)) * Math.PI / 180);
    ctx.font = `${randomInt(22, 28)}px "${['Georgia','serif','cursive'][randomInt(0,2)]}"`;
    ctx.fillStyle = colors[randomInt(0, colors.length - 1)];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Leve sombra para dificultar OCR
    ctx.shadowColor = 'rgba(0,0,0,0.12)';
    ctx.shadowBlur = 2;
    ctx.shadowOffsetX = randomInt(-1,1);
    ctx.shadowOffsetY = randomInt(-1,1);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  });

  // Puntos de ruido
  for(let i = 0; i < 40; i++){
    ctx.beginPath();
    ctx.arc(randomInt(0,W), randomInt(0,H), randomInt(1,2), 0, Math.PI*2);
    ctx.fillStyle = `rgba(${randomInt(80,160)},${randomInt(80,160)},${randomInt(40,100)},0.25)`;
    ctx.fill();
  }
}

// Inicializar al cargar
function init(){
  refreshCaptcha();
  document.querySelectorAll('[data-action="refresh-captcha"]').forEach(el => el.addEventListener('click', refreshCaptcha));
  document.querySelectorAll('[data-action="submit"]').forEach(el => el.addEventListener('click', submitForm));
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

// ── FORMULARIO ───────────────────────────────────────────────────────────────
async function submitForm(){
  const btn   = document.getElementById('form-btn');
  const errEl = document.getElementById('form-error');
  errEl.style.display = 'none';

  const nombre   = document.getElementById('f-nombre').value.trim();
  const empresa  = document.getElementById('f-empresa').value.trim();
  const email    = document.getElementById('f-email').value.trim();
  const telefono = document.getElementById('f-telefono').value.trim();
  const mensaje  = document.getElementById('f-mensaje').value.trim();
  const website  = document.getElementById('f-website').value;
  const captcha  = document.getElementById('captcha-input').value.trim().toUpperCase();

  if(!nombre || !email){
    errEl.textContent = 'Por favor completá nombre y email.';
    errEl.style.display = 'block'; return;
  }

  if(captcha !== captchaCode){
    errEl.textContent = 'El código de verificación no es correcto.';
    errEl.style.display = 'block';
    refreshCaptcha(); return;
  }

  btn.disabled = true; btn.textContent = 'Enviando...';

  try {
    const res = await fetch(`${window.NEUMET_CONFIG.SUPABASE_URL}/functions/v1/contacto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, empresa, email, telefono, mensaje, website })
    });
    const data = await res.json();
    if(!res.ok || !data.ok) throw new Error(data.error || 'Error al enviar');
    document.getElementById('form-fields').style.display = 'none';
    document.getElementById('form-success').style.display = 'block';
  } catch {
    errEl.textContent = 'No se pudo enviar el mensaje. Reintentar más tarde.';
    errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = 'Enviar consulta';
    refreshCaptcha();
  }
}
