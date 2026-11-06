// Lógica pura del odómetro y del ciclo de vida del neumático (sin DOM ni red). docs/08 apéndice A.
export const TIPOS_EVENTO = ['montaje','desmontaje','rotacion','reparacion','reencauche','baja','inspeccion'];
export const TIPO_LABEL = {
  montaje:'Montaje', desmontaje:'Desmontaje', rotacion:'Rotación', reparacion:'Reparación',
  reencauche:'Reencauche', baja:'Baja', inspeccion:'Inspección'
};
export const VIDA_MAX = 3;

// Texto -> entero >= 0, o null si vacío/inválido. Rechaza decimales y notación científica.
export function parseEnteroNoNeg(v){
  if(v==null) return null;
  const s=String(v).trim();
  if(!/^\d{1,9}$/.test(s)) return null;
  return Number(s);
}
// Texto -> número >= 0 (decimales con punto o coma, máx. 2), o null.
export function parseMontoNoNeg(v){
  if(v==null) return null;
  const s=String(v).trim().replace(',','.');
  if(!/^\d{1,10}(\.\d{1,2})?$/.test(s)) return null;
  return Number(s);
}

// Registro de odómetro del vehículo. `actual` = valor guardado (o null). Si el nuevo valor baja respecto al actual,
// requiere confirmación explícita (`confirmarBaja`), p. ej. por cambio de tablero.
export function validarOdometro(actual, nuevoTexto, confirmarBaja=false){
  const raw=nuevoTexto==null?'':String(nuevoTexto).trim();
  if(raw==='') return {ok:false, error:'Ingresá el kilometraje'};
  const valor=parseEnteroNoNeg(raw);
  if(valor===null) return {ok:false, error:'El kilometraje debe ser un entero mayor o igual a 0'};
  const baja=actual!=null && valor<actual;
  if(baja && !confirmarBaja) return {ok:false, requiereConfirmacion:true, valor, error:`El valor (${valor}) es menor al actual (${actual}). Confirmá para registrarlo igual`};
  return {ok:true, valor, baja};
}

// Valida y arma el cambio a neumaticos (`patch`, puede ser {}) y la fila de eventos_neumatico para una acción.
// n: fila de neumaticos {id,vehiculo_id,cliente_id,posicion,estado,vida,idneumatico}
// d: {odometro, costo, notas, destinoEstado, motivo, fecha, posicionDestino}; hoy: 'YYYY-MM-DD'
export function planEvento(tipo, n, d={}, hoy=''){
  if(!TIPOS_EVENTO.includes(tipo)) return {ok:false, error:'Tipo de evento inválido'};
  if(!n) return {ok:false, error:'Seleccioná un neumático'};
  const estado=n.estado||'montado', vida=n.vida||0;
  const odoTxt=d.odometro==null?'':String(d.odometro).trim();
  const odo=odoTxt===''?null:parseEnteroNoNeg(odoTxt);
  if(odoTxt!=='' && odo===null) return {ok:false, error:'El odómetro debe ser un entero mayor o igual a 0'};
  const costoTxt=d.costo==null?'':String(d.costo).trim();
  const costo=costoTxt===''?null:parseMontoNoNeg(costoTxt);
  if(costoTxt!=='' && costo===null) return {ok:false, error:'El costo debe ser un número mayor o igual a 0'};
  if(estado==='baja') return {ok:false, error:'El neumático ya está dado de baja'};
  const notas=(d.notas||'').trim()||null;
  let patch={}, posDestino=null;
  switch(tipo){
    case 'montaje':
      if(estado==='montado') return {ok:false, error:'El neumático ya está montado'};
      patch={estado:'montado'}; break;
    case 'desmontaje': {
      if(estado!=='montado') return {ok:false, error:'Solo se puede desmontar un neumático montado'};
      const dest=d.destinoEstado||'almacenado';
      if(!['almacenado','reparacion'].includes(dest)) return {ok:false, error:'Destino inválido'};
      patch={estado:dest}; break;
    }
    case 'rotacion': {
      if(estado!=='montado') return {ok:false, error:'Solo se puede rotar un neumático montado'};
      const p=parseEnteroNoNeg(d.posicionDestino);
      if(p===null||p<1||p>99) return {ok:false, error:'Indicá la posición de destino (1 a 99)'};
      if(p===n.posicion) return {ok:false, error:'La posición de destino es la misma'};
      posDestino=p; break;
    }
    case 'reparacion':
      if(estado==='reparacion') patch={estado:'almacenado'};
      break;
    case 'reencauche':
      if(vida>=VIDA_MAX) return {ok:false, error:`Ya alcanzó la vida máxima (${VIDA_MAX} reencauches)`};
      patch={vida:vida+1};
      if(estado==='reparacion') patch.estado='almacenado';
      break;
    case 'baja': {
      const motivo=(d.motivo||'').trim();
      if(!motivo) return {ok:false, error:'Indicá el motivo de la baja'};
      const fecha=(d.fecha||hoy||'').trim();
      if(!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return {ok:false, error:'Fecha de baja inválida'};
      patch={estado:'baja', fecha_baja:fecha, motivo_baja:motivo};
      break;
    }
    default: break; // inspeccion: solo evento
  }
  const evento={
    cliente_id:n.cliente_id, vehiculo_id:n.vehiculo_id, neumatico_id:n.id, idneumatico:n.idneumatico||null, tipo,
    posicion_origen:n.posicion, posicion_destino:tipo==='rotacion'?posDestino:null,
    odometro_km:odo, costo, notas
  };
  return {ok:true, patch, evento, posicionDestino:posDestino};
}

// Rotación: mueve `n` a `destino`. Si el destino está ocupado se intercambian los dos neumáticos. La escritura la hace
// la RPC atómica neumatico_rotar (posición temporal y eventos dentro de una transacción); aquí solo se valida y se
// detecta el intercambio para pedir confirmación. Devuelve {ok, intercambio: neumático ocupante | null}.
export function planRotacion(neumaticos, n, destino){
  const otro=neumaticos.find(x=>x.vehiculo_id===n.vehiculo_id && x.posicion===destino && x.id!==n.id);
  if(!otro) return {ok:true, intercambio:null};
  if(otro.estado==='baja') return {ok:false, error:'La posición de destino está ocupada por un neumático dado de baja'};
  return {ok:true, intercambio:otro};
}

const tsOf=e=>new Date(e.created_at).getTime()||0;
export function ordenarEventos(eventos, desc=false){
  const s=[...eventos].sort((a,b)=>tsOf(a)-tsOf(b) || (a.id||0)-(b.id||0));
  return desc?s.reverse():s;
}
export const claveNeumatico=e=>e.neumatico_id!=null?`n${e.neumatico_id}`:(e.idneumatico?`i${e.idneumatico}`:null);

// Km recorridos por neumático a partir de los eventos: un montaje abre un tramo con el odómetro del vehículo;
// desmontaje o baja lo cierran; la rotación no corta el tramo. Un tramo abierto cuenta hasta `odometroActual`.
// Tramos sin odómetro en algún extremo (o con fin < inicio) no suman km y se cuentan en `incompletos`.
// Devuelve { [clave]: {km, tramos, abierto, incompletos} }.
export function kmPorNeumatico(eventos, odometroActual=null){
  const res={}, abierto={};
  const get=k=>res[k]||(res[k]={km:0, tramos:0, abierto:false, incompletos:0});
  for(const e of ordenarEventos(eventos)){
    const k=claveNeumatico(e); if(!k) continue;
    const r=get(k), odo=Number.isInteger(e.odometro_km)?e.odometro_km:null;
    if(e.tipo==='montaje'){
      if(!(k in abierto)) abierto[k]=odo;
    } else if(e.tipo==='desmontaje' || e.tipo==='baja'){
      if(k in abierto){
        const ini=abierto[k]; delete abierto[k];
        if(ini!=null && odo!=null && odo>=ini){ r.km+=odo-ini; r.tramos++; } else r.incompletos++;
      }
    }
  }
  for(const k of Object.keys(abierto)){
    const r=get(k), ini=abierto[k];
    r.abierto=true;
    if(ini!=null && Number.isInteger(odometroActual) && odometroActual>=ini){ r.km+=odometroActual-ini; r.tramos++; }
    else r.incompletos++;
  }
  return res;
}
