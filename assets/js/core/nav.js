// Navegación entre vistas: cada vista se registra con registerView(nombre, label, load).
const NAV_LABELS={};
const LOADERS={};
export function registerView(name,label,load){ NAV_LABELS[name]=label; LOADERS[name]=load; }

let activa=null;
// Recarga la vista activa (p. ej. al cambiar el selector de seccional).
export function reloadActiveView(){ if(activa&&LOADERS[activa]) LOADERS[activa](); }

export function switchView(v){
  activa=v;
  document.querySelectorAll('.nav-item[data-view]').forEach(n=>{
    const on=n.dataset.view===v;
    n.classList.toggle('active',on);
    if(on) n.setAttribute('aria-current','page'); else n.removeAttribute('aria-current');
  });
  document.querySelectorAll('.view').forEach(vw=>vw.classList.toggle('active',vw.id===`view-${v}`));
  document.getElementById('breadcrumb-current').textContent=NAV_LABELS[v]||v;
  document.title=`${NAV_LABELS[v]||v} · NEUMET`;
  if(LOADERS[v]) LOADERS[v]();
}

// Sidebar móvil
const menuToggle=document.getElementById('menu-toggle');
const sidebarEl=document.querySelector('.sidebar');
const overlayEl=document.getElementById('sidebar-overlay');
function setSidebar(open){
  sidebarEl.classList.toggle('open',open); overlayEl.classList.toggle('show',open);
  menuToggle.setAttribute('aria-expanded',String(open));
  menuToggle.setAttribute('aria-label',open?'Cerrar menú':'Abrir menú');
}
function closeSidebar(){ setSidebar(false); }

export function initNav(){
  menuToggle.addEventListener('click',()=>setSidebar(!sidebarEl.classList.contains('open')));
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&sidebarEl.classList.contains('open')){ closeSidebar(); menuToggle.focus(); } });
  overlayEl.addEventListener('click', closeSidebar);
  document.querySelectorAll('.nav-item[data-view]').forEach(el=>{
    el.addEventListener('click',()=>{ switchView(el.dataset.view); closeSidebar(); });
  });
}
