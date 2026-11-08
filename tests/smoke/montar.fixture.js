// Fixture del arnés de humo para montar y retirar neumáticos. Solo se activa con ?detalle=1&cliente=1&montar=1.
// Se carga DESPUÉS de vehiculo.fixture.js: agrega el vehículo 13 («Coche 301», 10 ruedas, SIN neumáticos) a sus datos
// mutables (window.__vehFx.T) y responde neumatico_montar / neumatico_desmontar cambiando esos datos, de modo que el
// detalle recargado refleje el resultado. Registra las llamadas en window.__montarFx.rpcs y puede responder con un error.
(function(){
  if(!/[?&]montar=1/.test(window.parent.location.search) || !window.__vehFx) return;
  var T = window.__vehFx.T;
  var fx = window.__montarFx = { rpcs: [], rpcError: null };
  var VID = 13;
  T.vehiculos.push({id:VID,nombre:'301',patente:'VAC 301',numero:'301',tipo_ruedas:10,cliente_id:1,sucursal_id:null,activo:true,odometro_km:5000,odometro_actualizado_at:null,clientes:{nombre:'Transportes Alfa'}});
  var plantilla = T.v_estado_neumaticos[0];

  function filaEstado(pos, n){
    return Object.assign({}, plantilla, {vehiculo_id:VID, vehiculo_nombre:'301', patente:'VAC 301', posicion:pos, neumatico_id:n.id, idneumatico:n.idneumatico,
      marca:n.marca, modelo:n.modelo, vida:0, mm1:null, mm2:null, mm3:null, promedio:null, ultima_medicion_at:null, dias_desde_medicion:null,
      estado:'sin_datos', sin_medir:true, diferencia_huellas_mm:null, desgaste_irregular:false, n_mediciones_90d:0, tasa_mm_semana:null,
      semanas_hasta_critico:null, semanas_hasta_retiro:null});
  }

  var seq = 1300;
  var base = window.supabase.createClient;
  window.supabase.createClient = function(){
    var c = base.apply(this, arguments), rpc = c.rpc;
    c.rpc = function(name, args){
      if(name !== 'neumatico_montar' && name !== 'neumatico_desmontar') return rpc.apply(c, arguments);
      fx.rpcs.push({name: name, args: args});
      if(fx.rpcError) return Promise.resolve({data: null, error: fx.rpcError});
      var pos = args.p_posicion;
      if(name === 'neumatico_montar'){
        var n;
        if(args.p_cubierta_id){
          n = T.neumaticos.filter(function(x){ return x.id === args.p_cubierta_id; })[0];
          Object.assign(n, {vehiculo_id:VID, posicion:pos, estado:'montado'});
        } else {
          n = {id:++seq, vehiculo_id:VID, cliente_id:1, posicion:pos, marca:args.p_nuevo.marca, modelo:args.p_nuevo.modelo || null, idneumatico:'CN-'+VID+'-'+pos+'-x', vida:args.p_nuevo.vida,
            estado:'montado', numero_quema:args.p_nuevo.numero_quema || null, km_previos:args.p_nuevo.km_previos};
          T.neumaticos.push(n);
        }
        T.v_estado_neumaticos.push(filaEstado(pos, n));
        return Promise.resolve({data: {vehiculo_id:VID, posicion:pos, neumatico_id:n.id, odometro_km: args.p_odometro_km || 5000}, error: null});
      }
      var viejo = T.neumaticos.filter(function(x){ return x.vehiculo_id === VID && x.posicion === pos; })[0];
      T.v_estado_neumaticos = T.v_estado_neumaticos.filter(function(f){ return !(f.vehiculo_id === VID && f.posicion === pos); });
      if(args.p_destino === 'almacenado') Object.assign(viejo, {vehiculo_id:null, posicion:null, estado:'almacenado', condicion:'usado', sucursal_id:args.p_sucursal_stock});
      else Object.assign(viejo, {posicion:98, estado:args.p_destino === 'baja' ? 'baja' : 'reparacion'});
      return Promise.resolve({data: {vehiculo_id:VID, posicion:pos, destino:args.p_destino}, error: null});
    };
    return c;
  };
})();
