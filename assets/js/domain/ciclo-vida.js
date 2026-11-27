// Lógica pura del odómetro y del ciclo de vida del neumático (sin DOM ni red). docs/08 apéndice A.
export const TIPOS_EVENTO = ['montaje','desmontaje','rotacion','reparacion','reencauche','baja','inspeccion','rotacion_disco','alineacion'];
export const TIPO_LABEL = {
  montaje:'Montaje', desmontaje:'Desmontaje', rotacion:'Rotación', reparacion:'Reparación',
  reencauche:'Recauchutado', baja:'Baja', inspeccion:'Inspección', rotacion_disco:'Rotación en disco', alineacion:'Alineación',
  alta_stock:'Alta en stock', traslado:'Traslado', cambio_condicion:'Cambio de condición',
  envio_recauchutado:'Envío a recauchutar', dictamen_recauchutado:'Dictamen de recauchutado', rechazo_recauchutado:'Rechazo de recauchutado'
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
  if(raw==='') return {ok:false, error:'Falta el kilometraje'};
  const valor=parseEnteroNoNeg(raw);
  if(valor===null) return {ok:false, error:'El kilometraje debe ser un entero mayor o igual a 0'};
  const baja=actual!=null && valor<actual;
  if(baja && !confirmarBaja) return {ok:false, requiereConfirmacion:true, valor, error:`El valor (${valor}) es menor al actual (${actual}). Confirmar para registrarlo igual`};
  return {ok:true, valor, baja};
}

// Qué hace cada rol ante un kilometraje menor al actual (docs/17 §4.1):
//   'solo_lectura'       el equipo Neumet no escribe el kilometraje (PR 9 de F10): ninguna RPC;
//   'corregir'           el administrador de empresa confirma y usa la RPC vehiculo_corregir_odometro;
//   'avisar'             el usuario de sucursal no puede: se le indica quién lo corrige.
// Sin baja, el cliente usa vehiculo_registrar_odometro (que rechaza bajar).
export function rutaOdometro({ cliente = false, adminEmpresa = false, baja = false } = {}){
  if(!cliente) return {accion:'solo_lectura', rpc:null};
  if(!baja) return {accion:'registrar', rpc:'vehiculo_registrar_odometro'};
  return adminEmpresa ? {accion:'corregir', rpc:'vehiculo_corregir_odometro'} : {accion:'avisar', rpc:null};
}
export const AVISO_ODOMETRO_SUCURSAL = actual => `El kilometraje no puede ser menor al actual (${actual} km). La corrección la hace el administrador de empresa`;

const tsOf=e=>new Date(e.created_at).getTime()||0;
export function ordenarEventos(eventos, desc=false){
  const s=[...eventos].sort((a,b)=>tsOf(a)-tsOf(b) || (a.id||0)-(b.id||0));
  return desc?s.reverse():s;
}
