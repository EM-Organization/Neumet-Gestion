// Navegación entre vistas: cada vista se registra con registerView(nombre, label, load).
const NAV_LABELS={};
const LOADERS={};
export function registerView(name,label,load){ NAV_LABELS[name]=label; LOADERS[name]=load; }

let activa=null;
// Recarga la vista activa (p. ej. al cambiar el selector de seccional).
export function reloadActiveView(){ if(activa&&LOADERS[activa]) LOADERS[activa](); }

export function switchView(v){
  activa=v;
  document.querySelectorAll('.nav-item[data-view]').forEach(n=>n.classList.toggle('active',n.dataset.view===v));
  document.querySelectorAll('.view').forEach(vw=>vw.classList.toggle('active',vw.id===`view-${v}`));
  document.getElementById('breadcrumb-current').textContent=NAV_LABELS[v]||v;
  if(LOADERS[v]) LOADERS[v]();
}

// Sidebar móvil
const menuToggle=document.getElementById('menu-toggle');
const sidebarEl=document.querySelector('.sidebar');
const overlayEl=document.getElementById('sidebar-overlay');
function closeSidebar(){ sidebarEl.classList.remove('open'); overlayEl.classList.remove('show'); }

export function initNav(){
  menuToggle.addEventListener('click',()=>{ sidebarEl.classList.toggle('open'); overlayEl.classList.toggle('show'); });
  overlayEl.addEventListener('click', closeSidebar);
  document.querySelectorAll('.nav-item[data-view]').forEach(el=>{
    el.addEventListener('click',()=>{ switchView(el.dataset.view); closeSidebar(); });
  });
}
