// Navegación entre vistas: cada vista se registra con registerView(nombre, etiqueta, load, { menu }).
// `menu` = ítem del menú lateral que queda resaltado cuando la vista está abierta (por defecto, ella misma):
// el detalle de vehículo cuelga de Vehículos y la ficha de cliente cuelga de Clientes.
const NAV_LABELS={};
const LOADERS={};
const MENU={};
export function registerView(name,label,load,{menu}={}){ NAV_LABELS[name]=label; LOADERS[name]=load; if(menu) MENU[name]=menu; }

let activa=null;
export const vistaActiva=()=>activa;
export const etiquetaVista=v=>NAV_LABELS[v]||v;
// Recarga la vista activa (p. ej. al cambiar el selector de seccional).
export function reloadActiveView(){ if(activa&&LOADERS[activa]) LOADERS[activa](); }

// Título de la barra superior: "Padre › Actual". `padre` = nombre de una vista (enlaza a ella) o null.
export function setTitulo(actual,padre=null){
  const p=document.getElementById('breadcrumb-parent'), sep=document.getElementById('breadcrumb-sep');
  if(p){ p.hidden=!padre; if(padre){ p.textContent=NAV_LABELS[padre]||padre; p.dataset.args=JSON.stringify([padre]); } }
  if(sep) sep.hidden=!padre;
  document.getElementById('breadcrumb-current').textContent=actual;
  document.title=`${actual} · NEUMET`;
}

export function switchView(v){
  activa=v;
  const item=MENU[v]||v;
  document.querySelectorAll('.nav-item[data-view]').forEach(n=>{
    const on=n.dataset.view===item;
    n.classList.toggle('active',on);
    if(on) n.setAttribute('aria-current','page'); else n.removeAttribute('aria-current');
  });
  document.querySelectorAll('.view').forEach(vw=>vw.classList.toggle('active',vw.id===`view-${v}`));
  const main=document.getElementById('contenido');
  if(main) main.dataset.vista=v;
  setTitulo(NAV_LABELS[v]||v, MENU[v]&&MENU[v]!==v?MENU[v]:null);
  if(LOADERS[v]) LOADERS[v]();
}

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
