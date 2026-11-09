// Fixture del arnés de humo para Vehículos (buscador + detalle con diagrama). Solo se activa con ?detalle=1 (junto a ?cliente=1).
// Se carga DESPUÉS de stub.js y de las demás fixtures: es la capa más externa y sirve vehiculos, v_estado_neumaticos,
// v_alertas y eventos_neumatico con datos propios (las mediciones salen del stub base: vehículo 10, posiciones 1..10).
(function(){
  if(!/[?&]detalle=1/.test(window.parent.location.search)) return;
  var D = function(d){ return new Date(Date.now()-d*86400000).toISOString(); };
  var U = {umbral_bajo_mm:8, umbral_critico_mm:5, umbral_retiro_mm:3};

  var veh = [
    {id:10,nombre:'Camión 01',patente:'AB123CD',numero:'07',tipo_ruedas:10,cliente_id:1,sucursal_id:null,activo:true,odometro_km:123456,odometro_actualizado_at:D(3),clientes:{nombre:'Transportes Alfa'}},
    {id:12,nombre:'Unidad <Crítica>',patente:'CR 0001',numero:'112',tipo_ruedas:10,cliente_id:1,sucursal_id:null,activo:true,odometro_km:null,odometro_actualizado_at:null,clientes:{nombre:'Transportes Alfa'}},
    {id:14,nombre:'Tractor 16',patente:'ZZ999YY',numero:'7',tipo_ruedas:16,cliente_id:1,sucursal_id:null,activo:true,odometro_km:80000,odometro_actualizado_at:D(10),clientes:{nombre:'Transportes Alfa'}}
  ];

  function fila(vid, nom, pat, pos, prom, extra){
    var estado = prom===null ? 'sin_datos' : prom < 5 ? 'critico' : prom < 8 ? 'bajo' : 'ok';
    return Object.assign({cliente_id:1,vehiculo_id:vid,vehiculo_nombre:nom,patente:pat,posicion:pos,neumatico_id:vid*100+pos,idneumatico:'N'+vid+'-'+pos,
      marca:'Michelin',modelo:'X MultiWay',vida:0,estado_montaje:'montado',
      mm1:prom,mm2:prom,mm3:prom,promedio:prom,odometro_km:null,ultima_medicion_at:prom===null?null:D(2),dias_desde_medicion:prom===null?null:2,
      estado:estado,sin_medir:prom===null,diferencia_huellas_mm:prom===null?null:0.4,desgaste_irregular:false,n_mediciones_90d:3,
      tasa_mm_semana:0.5,semanas_hasta_critico:null,semanas_hasta_retiro:null}, U, extra||{});
  }
  var estado = [
    fila(10,'Camión 01','AB123CD',1,14,{tasa_mm_semana:0.3}),
    fila(10,'Camión 01','AB123CD',2,7),
    fila(10,'Camión 01','AB123CD',3,4.2,{tasa_mm_semana:1.2,semanas_hasta_critico:0,semanas_hasta_retiro:1}),
    fila(10,'Camión 01','AB123CD',4,2.5,{tasa_mm_semana:0.5,semanas_hasta_critico:0,semanas_hasta_retiro:0}),
    fila(10,'Camión 01','AB123CD',5,null,{tasa_mm_semana:null}),
    fila(10,'Camión 01','AB123CD',6,12,{mm1:14,mm2:12,mm3:10.9,diferencia_huellas_mm:3.1,desgaste_irregular:true}),
    fila(10,'Camión 01','AB123CD',7,9), fila(10,'Camión 01','AB123CD',8,6.5), fila(10,'Camión 01','AB123CD',9,10), fila(10,'Camión 01','AB123CD',10,13),
    fila(12,'Unidad <Crítica>','CR0001',1,3.5,{tasa_mm_semana:0.5}), fila(12,'Unidad <Crítica>','CR0001',3,9,{tasa_mm_semana:0.4}),
    fila(14,'Tractor 16','ZZ999YY',1,12), fila(14,'Tractor 16','ZZ999YY',3,10,{tasa_mm_semana:0.5}), fila(14,'Tractor 16','ZZ999YY',99,11)
  ];
  var alertas = [
    {cliente_id:1,vehiculo_id:10,vehiculo_nombre:'Camión 01',patente:'AB123CD',posicion:3,tipo:'critico',severidad:3,valor:4.2,mensaje:'Neumático crítico: 4.2 mm (límite 5 mm)',ultima_medicion_at:D(2)},
    {cliente_id:1,vehiculo_id:10,vehiculo_nombre:'Camión 01',patente:'AB123CD',posicion:6,tipo:'desgaste_irregular',severidad:2,valor:3.1,mensaje:'Desgaste irregular: 3.1 mm entre huellas (máx. 2 mm)',ultima_medicion_at:D(2)}
  ];
  var eventos = [
    {id:1,cliente_id:1,vehiculo_id:10,neumatico_id:1003,idneumatico:'N10-3',tipo:'rotacion',posicion_origen:4,posicion_destino:3,odometro_km:120000,notas:'Rotación <programada>',created_at:D(30)},
    {id:2,cliente_id:1,vehiculo_id:10,neumatico_id:1003,idneumatico:'N10-3',tipo:'montaje',posicion_destino:3,odometro_km:120000,notas:null,created_at:D(60)}
  ];
  // Neumáticos con número de quema y km previos: P3 con montaje a 120000 km; P5 sin quema; vehículo 14 con una quema propia.
  var neumaticos = [];
  for(var pn = 1; pn <= 10; pn++){
    neumaticos.push({id:1000+pn,vehiculo_id:10,cliente_id:1,posicion:pn,marca:'Michelin',modelo:'X MultiWay',idneumatico:'N10-'+pn,vida:0,estado:'montado',
      numero_quema:pn === 3 ? 'Q-0103' : null,km_previos:pn === 3 ? 20000 : 0});
  }
  neumaticos.push({id:1401,vehiculo_id:14,cliente_id:1,posicion:1,marca:'Michelin',modelo:'X MultiWay',idneumatico:'N14-1',vida:0,estado:'montado',numero_quema:'q-1401',km_previos:0});
  // 10 mediciones semanales por rueda del vehículo 10 (como el demo): el gráfico se juzga con una serie realista.
  var mediciones = [];
  estado.filter(function(f){ return f.vehiculo_id === 10 && f.promedio !== null; }).forEach(function(f){
    for(var k = 9; k >= 0; k--){
      var mm = Math.round((f.promedio + (f.tasa_mm_semana || 0.4) * k + (k % 3 === 1 ? 0.15 : 0)) * 10) / 10;
      mediciones.push({id:f.posicion*100+k, medicion_id:f.posicion*100+k, estado_montaje:'montado', posicion_actual:f.posicion, vehiculo_id:10, cliente_id:1, posicion:f.posicion, mm1:mm+0.2, mm2:mm, mm3:mm-0.2, promedio:mm, created_at:D(k*7+2)});
    }
  });
  // Cubiertas del stock del cliente 1 (neumáticos sin vehículo): las ofrece el cambio de neumático al perfil global y al admin.
  neumaticos.push(
    {id:3101,vehiculo_id:null,cliente_id:1,posicion:null,numero_quema:'S-001',marca:'Michelin',modelo:'X Multi Z',condicion:'nuevo',sucursal_id:1,estado:'almacenado'},
    {id:3102,vehiculo_id:null,cliente_id:1,posicion:null,numero_quema:'S-002',marca:'Pirelli',modelo:null,condicion:'usado',sucursal_id:null,estado:'almacenado'},
    {id:3103,vehiculo_id:null,cliente_id:1,posicion:null,numero_quema:'S-010',marca:'Goodyear',modelo:'G661',condicion:'reparado',sucursal_id:2,estado:'almacenado'});
  // Calidad de datos (F3): mediciones con observaciones. La tabla `mediciones` las incluye; la vista v_mediciones_neumatico NO
  // (las invalidadas no cuentan y las sospechosas ya figuran en la serie). P3: una en revisión y una invalidada; P2: una duplicada.
  var vd = function(v){ return {nombre:v.nombre, patente:v.patente, tipo_ruedas:v.tipo_ruedas}; };
  var observadas = [
    {id:9001,vehiculo_id:10,cliente_id:1,posicion:3,idneumatico:'N10-3',mm1:11,mm2:10.8,mm3:11.2,promedio:11,created_at:D(5),calidad:'sospechosa',calidad_motivo:'Aumento sin recauchutado',calidad_at:D(5),calidad_por:'sistema',vehiculos:vd(veh[0])},
    {id:9002,vehiculo_id:10,cliente_id:1,posicion:3,idneumatico:'N10-3',mm1:3,mm2:3,mm3:3,promedio:3,created_at:D(1),calidad:'invalidada',calidad_motivo:'Lectura <errónea> del medidor',calidad_at:D(1),calidad_por:'u-1',vehiculos:vd(veh[0])},
    {id:9003,vehiculo_id:10,cliente_id:1,posicion:2,idneumatico:'N10-2',mm1:8,mm2:8,mm3:8,promedio:8,created_at:D(9),calidad:'sospechosa',calidad_motivo:'Lectura duplicada',calidad_at:D(9),calidad_por:'sistema',vehiculos:vd(veh[0])},
    {id:9004,vehiculo_id:12,cliente_id:1,posicion:1,idneumatico:'N12-1',mm1:35,mm2:35,mm3:35,promedio:35,created_at:D(2),calidad:'sospechosa',calidad_motivo:'Valor fuera del rango físico (0 a 30 mm)',calidad_at:D(2),calidad_por:'sistema',vehiculos:vd(veh[1])}
  ];
  var T = {vehiculos:veh, v_estado_neumaticos:estado, v_alertas:alertas, eventos_neumatico:eventos, mediciones:mediciones.concat(observadas), v_mediciones_neumatico:mediciones, neumaticos:neumaticos};
  var fx = window.__vehFx = { queries: [], T: T }; // T: datos mutables (los usa montar.fixture.js)

  function Q(table){
    var rows = T[table].slice(), rng = null, single = false, tag = '';
    var q = {
      select:function(){ return q; }, order:function(){ return q; }, limit:function(){ return q; }, not:function(){ return q; },
      neq:function(){ return q; },
      // in(calidad, [...]) se registra aparte: la lectura de observaciones no es el historial de la rueda.
      in:function(c,vs){ if(c === 'calidad'){ tag = '#calidad'; rows = rows.filter(function(r){ return vs.indexOf(r.calidad) !== -1; }); } return q; },
      is:function(c,v){ rows = rows.filter(function(r){ return v===null ? (r[c]===null||r[c]===undefined) : r[c]===v; }); return q; },
      eq:function(c,v){ if(c === 'calidad') tag = '#calidad'; rows = rows.filter(function(r){ return !(c in r) || String(r[c])===String(v); }); return q; },
      range:function(a,b){ rng=[a,b]; return q; },
      single:function(){ single=true; return q; }, maybeSingle:function(){ single=true; return q; },
      then:function(res,rej){
        fx.queries.push(table + tag);
        if(rng) rows = rows.slice(rng[0], rng[1]+1);
        return Promise.resolve({data: single ? (rows[0]||null) : rows, error:null}).then(res,rej);
      }
    };
    return q;
  }
  // medicion_invalidar / medicion_revalidar cambian la calidad de la fila (como la base) para que el detalle recargado la refleje.
  fx.calRpcs = []; fx.calError = null;
  var base = window.supabase.createClient;
  window.supabase.createClient = function(){
    var c = base.apply(this, arguments), from = c.from, rpc = c.rpc;
    c.from = function(t){ return T[t] ? Q(t) : from(t); };
    c.rpc = function(name, args){
      if(name !== 'medicion_invalidar' && name !== 'medicion_revalidar') return rpc.apply(c, arguments);
      fx.calRpcs.push({name: name, args: args});
      if(fx.calError) return Promise.resolve({data: null, error: fx.calError});
      var m = T.mediciones.filter(function(x){ return x.id === args.p_medicion_id; })[0];
      if(!m) return Promise.resolve({data: null, error: {code: 'P0002', message: 'medición inexistente'}});
      if(name === 'medicion_invalidar') Object.assign(m, {calidad:'invalidada', calidad_motivo:args.p_motivo, calidad_por:'u-1'});
      else Object.assign(m, {calidad:'valida', calidad_motivo:null, calidad_por:'u-1'});
      return Promise.resolve({data: {id: m.id, calidad: m.calidad, cambiado: true}, error: null});
    };
    return c;
  };
})();
