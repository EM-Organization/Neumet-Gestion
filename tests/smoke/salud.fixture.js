// Fixture del arnés de humo para salud de dispositivos y ficha de cliente. Se carga en el iframe DESPUÉS de stub.js
// (y de clientes.fixture.js si va antes): añade las vistas v_salud_dispositivos / v_resumen_flota_cliente, las columnas
// de umbrales de clientes y un error de check simulable (window.__umbralError).
(function(){
  var fx = window.__saludFx = { updates: [], error: null, sinFilas: false };
  var D = function(d){ return new Date(Date.now()-d*86400000).toISOString(); };
  var salud = [
    {dispositivo_id:100,cliente_id:1,mac_address:'AA:BB:CC:00:00:01',nombre:'Sensor 1',activo:true,ultima_actividad_at:D(1),total_mediciones:30,dias_sin_actividad:1,estado:'activo'},
    {dispositivo_id:101,cliente_id:2,mac_address:'AA:BB:CC:00:00:02',nombre:'Sensor <2>',activo:true,ultima_actividad_at:D(12),total_mediciones:4,dias_sin_actividad:12,estado:'sin_actividad'},
    {dispositivo_id:102,cliente_id:2,mac_address:'AA:BB:CC:00:00:03',nombre:null,activo:false,ultima_actividad_at:D(60),total_mediciones:7,dias_sin_actividad:60,estado:'caido'},
    {dispositivo_id:103,cliente_id:1,mac_address:'AA:BB:CC:00:00:04',nombre:null,activo:true,ultima_actividad_at:null,total_mediciones:0,dias_sin_actividad:null,estado:'nunca'}
  ];
  var resumen = [
    {cliente_id:1,nombre:'Transportes Alfa',n_vehiculos_activos:1,n_neumaticos_con_datos:10,n_ok:6,n_bajo:3,n_critico:1,n_sin_datos:0,n_alertas_sev1:0,n_alertas_sev2:2,n_alertas_sev3:1,ultima_medicion_at:D(1)},
    {cliente_id:2,nombre:'Minera <Beta> & Cía',n_vehiculos_activos:1,n_neumaticos_con_datos:0,n_ok:0,n_bajo:0,n_critico:0,n_sin_datos:0,n_alertas_sev1:0,n_alertas_sev2:0,n_alertas_sev3:0,ultima_medicion_at:null}
  ];
  var umbrales = {};
  var DEF = {umbral_bajo_mm:8,umbral_critico_mm:5,umbral_retiro_mm:3,alerta_histeresis_mm:0.5,dias_sin_medir_alerta:30,irregularidad_mm:2};
  function umb(id){ return umbrales[id] || (umbrales[id] = Object.assign({}, DEF)); }

  function simple(rows){
    var q = { select:function(){ return q; }, order:function(){ return q; },
      eq:function(c,v){ rows = rows.filter(function(r){ return String(r[c])===String(v); }); return q; },
      then:function(res,rej){ return Promise.resolve({data:rows.slice(),error:null}).then(res,rej); } };
    return q;
  }

  var base = window.supabase.createClient;
  window.supabase.createClient = function(){
    var c = base.apply(this, arguments), from = c.from;
    c.from = function(t){
      if(t === 'v_salud_dispositivos') return simple(salud);
      if(t === 'v_resumen_flota_cliente') return simple(resumen);
      var q = from(t);
      if(t === 'clientes'){
        var upd = null, eqId = null, eq = q.eq, update = q.update, th = q.then;
        q.is = q.is || function(){ return q; };
        q.update = function(r){ upd = r; return update.apply(q, arguments); };
        q.eq = function(col, v){ if(col === 'id') eqId = v; return eq.apply(q, arguments); };
        q.then = function(res, rej){
          if(upd && 'umbral_bajo_mm' in upd){
            fx.updates.push(Object.assign({id:eqId}, upd));
            var out = fx.error ? {data:null, error:fx.error} : fx.sinFilas ? {data:[], error:null} : (Object.assign(umb(eqId), upd), {data:[Object.assign({id:Number(eqId), nombre:'Cliente'}, umb(eqId))], error:null});
            return Promise.resolve(out).then(res, rej);
          }
          return th.call(q, function(out){
            if(out && Array.isArray(out.data)) out = Object.assign({}, out, {data: out.data.map(function(r){ return r.id ? Object.assign({}, r, umb(r.id)) : r; })});
            return res ? res(out) : out; }, rej);
        };
      }
      return q;
    };
    return c;
  };
})();
