// Fixture del arnés de humo para Flota/Alertas. Se carga en el iframe DESPUÉS de stub.js (no lo modifica):
// envuelve createClient.from para servir las vistas v_estado_neumaticos, v_alertas y v_resumen_flota_cliente.
(function(){
  var D = function(d){ return new Date(Date.now()-d*86400000).toISOString(); };
  function e(cid, vid, nom, pat, pos, estado, prom, extra){
    return Object.assign({cliente_id:cid,vehiculo_id:vid,vehiculo_nombre:nom,patente:pat,posicion:pos,estado:estado,promedio:prom,
      sin_medir:false,desgaste_irregular:false,ultima_medicion_at:prom===null?null:D(2),dias_desde_medicion:prom===null?null:2,semanas_hasta_critico:null,tasa_mm_semana:null}, extra||{});
  }
  var estado = [
    e(1,10,'Camión 01','AB123CD',1,'ok',13), e(1,10,'Camión 01','AB123CD',2,'ok',12),
    e(1,12,'Unidad <Crítica>','CR0001',1,'critico',3,{sin_medir:true}), e(1,12,'Unidad <Crítica>','CR0001',2,'bajo',6),
    e(2,11,'Camión 02','XY987ZZ',1,'bajo',6), e(2,11,'Camión 02','XY987ZZ',2,'ok',9,{semanas_hasta_critico:6.4}),
    e(2,13,'Camión 03','NN0003',1,'sin_datos',null,{sin_medir:true})
  ];
  var alertas = [
    {cliente_id:1,vehiculo_id:12,vehiculo_nombre:'Unidad <Crítica>',patente:'CR0001',posicion:1,tipo:'critico',severidad:3,valor:3,mensaje:'Neumático crítico: 3 mm (límite 5 mm)',ultima_medicion_at:D(2)},
    {cliente_id:1,vehiculo_id:12,vehiculo_nombre:'Unidad <Crítica>',patente:'CR0001',posicion:2,tipo:'bajo',severidad:2,valor:6,mensaje:'Desgaste bajo: 6 mm (límite 8 mm)',ultima_medicion_at:D(2)},
    {cliente_id:2,vehiculo_id:11,vehiculo_nombre:'Camión 02',patente:'XY987ZZ',posicion:1,tipo:'bajo',severidad:2,valor:6,mensaje:'Desgaste bajo: 6 mm (límite 8 mm)',ultima_medicion_at:D(3)},
    {cliente_id:2,vehiculo_id:13,vehiculo_nombre:'Camión 03',patente:'NN0003',posicion:1,tipo:'sin_medir',severidad:1,valor:null,mensaje:'Neumático montado sin ninguna medición',ultima_medicion_at:null}
  ];
  var resumen = [
    {cliente_id:1,nombre:'Transportes Alfa',n_vehiculos_activos:2,n_neumaticos_con_datos:4,n_ok:2,n_bajo:1,n_critico:1,n_sin_datos:0,n_alertas_sev1:0,n_alertas_sev2:1,n_alertas_sev3:1,ultima_medicion_at:D(2)},
    {cliente_id:2,nombre:'Minera <Beta> & Cía',n_vehiculos_activos:2,n_neumaticos_con_datos:2,n_ok:1,n_bajo:1,n_critico:0,n_sin_datos:1,n_alertas_sev1:1,n_alertas_sev2:1,n_alertas_sev3:0,ultima_medicion_at:D(3)}
  ];
  var T = {v_estado_neumaticos:estado, v_alertas:alertas, v_resumen_flota_cliente:resumen};
  var fx = window.__flotaFx = { queries: [], vacio: false };

  function VQ(table){
    var rows = T[table].slice(), rng = null;
    var q = {
      select:function(){ return q; }, order:function(){ return q; },
      eq:function(c,v){ rows = rows.filter(function(r){ return String(r[c])===String(v); }); return q; },
      range:function(a,b){ rng=[a,b]; return q; },
      then:function(res,rej){
        fx.queries.push(table);
        if(fx.vacio && table !== 'v_resumen_flota_cliente') rows = []; // vehículos sin neumáticos medidos: las vistas derivadas vienen vacías
        if(rng) rows = rows.slice(rng[0], rng[1]+1);
        return Promise.resolve({data:rows,error:null}).then(res,rej);
      }
    };
    return q;
  }
  // ultimas_mediciones (Inicio): una fila por posición de la última visita; mm_antes null = neumático sin medición previa.
  // El vehículo 11 trae un desgaste alto (1,4 mm) y una lectura mayor que la anterior; el 12 trae un neumático nuevo.
  function u(vid, nom, pat, num, dias, pos, ahora, antes){
    return {vehiculo_id:vid,nombre:nom,patente:pat,numero:num,medido_at:D(dias),posicion:pos,idneumatico:'UM-'+vid+'-'+pos,
      mm_ahora:ahora,mm_antes:antes,antes_at:antes===null?null:D(dias+7)};
  }
  var ultimas = [
    u(10,'101','AB123CD','101',1,1,12.6,13.0), u(10,'101','AB123CD','101',1,2,11.8,12.1), u(10,'101','AB123CD','101',1,3,15.5,null),
    u(12,'Unidad <Crítica>','CR0001','112',2,1,3.0,3.4), u(12,'Unidad <Crítica>','CR0001','112',2,2,5.1,5.2),
    u(11,'102','XY987ZZ','102',4,1,5.9,7.3), u(11,'102','XY987ZZ','102',4,2,9.2,9.0)
  ];
  fx.rpcs = [];
  var base = window.supabase.createClient;
  window.supabase.createClient = function(){
    var c = base.apply(this, arguments), from = c.from, rpc = c.rpc;
    c.from = function(t){ return T[t] ? VQ(t) : from(t); };
    c.rpc = function(name, args){
      if(name !== 'ultimas_mediciones') return rpc.apply(c, arguments);
      fx.rpcs.push([name, args]);
      if(fx.rpcError) return Promise.resolve({data:null,error:{message:'function does not exist'}});
      return Promise.resolve({data: fx.vacio ? [] : ultimas.slice(), error:null});
    };
    return c;
  };
})();
