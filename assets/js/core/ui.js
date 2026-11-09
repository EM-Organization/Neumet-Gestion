// Utilidades de UI compartidas: toast, aviso de problema de conexión, diálogo de confirmación, fechas relativas.
import { fmtFecha } from '../domain/formato.js';
import { configDialogo } from '../domain/dialogo.js';
export const AVATARS = ['av-1','av-2','av-3','av-4','av-5','av-6'];
export const avatarFor = id => AVATARS[Math.abs(id) % AVATARS.length];
export function userError(e){ console.error(e); return 'No se pudo completar la operación'; }
export function relDate(d){
  const s=(Date.now()-new Date(d).getTime())/1000;
  if(s<60)return'hace un momento';
  if(s<3600)return`hace ${Math.floor(s/60)} min`;
  if(s<86400)return`hace ${Math.floor(s/3600)} h`;
  if(s<604800)return`hace ${Math.floor(s/86400)} d`;
  return fmtFecha(d);
}

// Aviso de conexión: oculto mientras todo anda bien. Solo se muestra ante un problema real (sin conexión / error de carga),
// con botón para reintentar. setStatus(true) lo oculta; setStatus(false) lo muestra. Nunca muestra "Conectando…".
export function setStatus(ok){
  const pill=document.getElementById('status-pill');
  if(pill) pill.hidden=!!ok;
}

let toastTimer=null;
export function showToast(msg,err=false){
  const t=document.getElementById('toast');
  document.getElementById('toast-msg').textContent=msg;
  t.classList.toggle('error',err);
  t.classList.add('show');
  // Anuncio para lectores de pantalla: región viva aparte (el toast se muestra/oculta con display, que no se anuncia).
  const live=document.getElementById(err?'sr-alert':'sr-live');
  if(live){ live.textContent=''; setTimeout(()=>{ live.textContent=msg; },50); }
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove('show'),err?6000:3500);
}

// ── CONFIRM MODAL ──
// okLabel y danger son obligatorios (ver domain/dialogo.js). danger=true: botón rojo e icono de papelera; si no, botón primario e icono neutro.
export function confirmDialog(title, msg, okLabel, danger){
  const cfg=configDialogo(title, msg, okLabel, danger);
  return new Promise(resolve=>{
    document.getElementById('confirm-title').textContent=cfg.title;
    document.getElementById('confirm-msg').textContent=cfg.msg;
    const backdrop=document.getElementById('modal-confirm');
    const icon=document.getElementById('confirm-icon');
    icon.classList.toggle('danger',cfg.danger); icon.classList.toggle('neutral',!cfg.danger);
    icon.querySelectorAll('[data-icono]').forEach(sv=>{ sv.toggleAttribute('hidden',sv.dataset.icono!==cfg.icono); });
    backdrop.classList.add('show');
    const ok=document.getElementById('confirm-ok');
    ok.textContent=cfg.okLabel; ok.classList.toggle('danger',cfg.danger); ok.classList.toggle('primary',!cfg.danger);
    const cancel=document.getElementById('confirm-cancel');
    const cleanup=(val)=>{
      backdrop.classList.remove('show');
      ok.replaceWith(ok.cloneNode(true));
      cancel.replaceWith(cancel.cloneNode(true));
      resolve(val);
    };
    document.getElementById('confirm-ok').addEventListener('click',()=>cleanup(true),{once:true});
    document.getElementById('confirm-cancel').addEventListener('click',()=>cleanup(false),{once:true});
  });
}
