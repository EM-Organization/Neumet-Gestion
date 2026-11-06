// Registro de acciones invocables desde el DOM, sin handlers inline (la CSP no permite 'unsafe-inline' en script-src).
//   data-action="nombre" [data-args='[...]']  -> click
//   data-change="nombre" [data-args='[...]']  -> change (se añade el value del control como último argumento)
//   data-backdrop-close="nombre"              -> click sobre el propio fondo del modal
// Cada vista registra las suyas: ACTIONS.nombre = fn  (o registerActions({...})).
export const ACTIONS = {};
export function registerActions(obj){ Object.assign(ACTIONS,obj); }

function actionArgs(el){
  try{ const a=JSON.parse(el.dataset.args||'[]'); return Array.isArray(a)?a:[a]; }
  catch(_e){ return []; }
}
export function runAction(name,args){
  const fn=Object.prototype.hasOwnProperty.call(ACTIONS,name)?ACTIONS[name]:null;
  if(typeof fn!=='function'){ console.error('Acción desconocida: '+name); return; }
  return fn(...args);
}

export function initActions(){
  document.addEventListener('click',e=>{
    const bd=e.target.closest('[data-backdrop-close]');
    if(bd&&e.target===bd){ runAction(bd.dataset.backdropClose,[]); return; }
    const el=e.target.closest('[data-action]');
    if(el) runAction(el.dataset.action,actionArgs(el));
  });
  document.addEventListener('change',e=>{
    const el=e.target.closest('[data-change]');
    if(el) runAction(el.dataset.change,[...actionArgs(el),el.value]);
  });
}
