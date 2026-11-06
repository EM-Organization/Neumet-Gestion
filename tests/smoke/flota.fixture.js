// Fixture del arnés de humo para Flota/Alertas. Se carga en el iframe DESPUÉS de stub.js (no lo modifica):
// envuelve createClient.from para servir las vistas v_estado_neumaticos, v_alertas y v_resumen_flota_cliente.
(function(){
  var D = function(d){ return new Date(Date.now()-d*86400000).toISOString(); };
  function e(cid, vid, nom, pat, pos, estado, prom, extra){
    return Object.assign({cliente_id:cid,vehiculo_id:vid,vehiculo_nombre:nom,patente:pat,posicion:pos,estado:estado,promedio:prom,
      sin_medir:false,desgaste_irregular:false,ultima_medicion_at:prom===null?null:D(2)}, extra||{});
  }
  var estado = [
    e(1,10,'Camión 01','AB123CD',1,'ok',13), e(1,10,'Camión 01','AB123CD',2,'ok',12),
    e(1,12,'Unidad <Crítica>','CR0001',1,'critico',3,{sin_medir:true}), e(1,12,'Unidad <Crítica>','CR0001',2,'bajo',6),
    e(2,11,'Camión 02','XY987ZZ',1,'bajo',6), e(2,11,'Camión 02','XY987ZZ',2,'ok',9),
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
  var fx = window.__flotaFx = { queries: [] };

  function VQ(table){
    var rows = T[table].slice(), rng = null;
    var q = {
      select:function(){ return q; }, order:function(){ return q; },
      eq:function(c,v){ rows = rows.filter(function(r){ return String(r[c])===String(v); }); return q; },
      range:function(a,b){ rng=[a,b]; return q; },
      then:function(res,rej){
        fx.queries.push(table);
        if(rng) rows = rows.slice(rng[0], rng[1]+1);
        return Promise.resolve({data:rows,error:null}).then(res,rej);
      }
    };
    return q;
  }
  var base = window.supabase.createClient;
  window.supabase.createClient = function(){
    var c = base.apply(this, arguments), from = c.from;
    c.from = function(t){ return T[t] ? VQ(t) : from(t); };
    return c;
  };
})();
