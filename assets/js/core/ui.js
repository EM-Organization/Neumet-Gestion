// Utilidades de UI compartidas: toast, estado de conexión, diálogo de confirmación, fechas relativas.
export const AVATARS = ['av-1','av-2','av-3','av-4','av-5','av-6'];
export const avatarFor = id => AVATARS[Math.abs(id) % AVATARS.length];
export function userError(e){ console.error(e); return 'No se pudo completar la operación'; }
export function relDate(d){
  const s=(Date.now()-new Date(d).getTime())/1000;
  if(s<60)return'hace un momento';
  if(s<3600)return`hace ${Math.floor(s/60)} min`;
  if(s<86400)return`hace ${Math.floor(s/3600)} h`;
  if(s<604800)return`hace ${Math.floor(s/86400)} d`;
  return new Date(d).toLocaleDateString();
}

export function setStatus(ok,msg){
  document.getElementById('status-text').textContent=msg;
  document.getElementById('status-pill').classList.toggle('disconnected',!ok);
  const dot=document.querySelector('.status-dot');
  if(dot) dot.style.background=ok?'#34c759':'var(--danger)';
}

let toastTimer=null;
export function showToast(msg,err=false){
  const t=document.getElementById('toast');
  document.getElementById('toast-msg').textContent=msg;
  t.classList.toggle('error',err);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove('show'),3000);
}

// ── CONFIRM MODAL ──
export function confirmDialog(title, msg){
  return new Promise(resolve=>{
    document.getElementById('confirm-title').textContent=title;
    document.getElementById('confirm-msg').textContent=msg;
    const backdrop=document.getElementById('modal-confirm');
    backdrop.classList.add('show');
    const ok=document.getElementById('confirm-ok');
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
