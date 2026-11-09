// Stub de supabase-js para el arnés de humo. Se carga ANTES de los módulos (main.js) dentro del iframe.
(function(){
  var asCliente = /[?&](cliente|secuser)=1/.test(window.parent.location.search);
  var D = function(d){ return new Date(Date.now()-d*86400000).toISOString(); };
  var cl = [
    {id:1,nombre:'Transportes Alfa',precio_mensual:50000,created_at:D(40),auth_user_id:'u-1'},
    {id:2,nombre:'Minera <Beta> & Cía',precio_mensual:75000,created_at:D(20),auth_user_id:null}
  ];
  var veh = [
    {id:10,nombre:'Camión 01',patente:'AB123CD',numero:'201',tipo_ruedas:10,cliente_id:1,activo:true,created_at:D(30),clientes:{nombre:cl[0].nombre}},
    {id:11,nombre:'Camión 02',patente:'XY987ZZ',numero:'202',tipo_ruedas:16,cliente_id:2,activo:true,created_at:D(25),clientes:{nombre:cl[1].nombre}}
  ];
  veh.push({id:15,nombre:'Camión 05',patente:'SAB-1234',numero:'205',tipo_ruedas:10,cliente_id:1,activo:true,created_at:D(5),clientes:{nombre:cl[0].nombre}});
  var dev = [
    {id:100,mac_address:'AA:BB:CC:00:00:01',nombre:'Sensor 1',activo:true,cliente_id:1,created_at:D(30),clientes:{nombre:cl[0].nombre}},
    {id:101,mac_address:'AA:BB:CC:00:00:02',nombre:'Sensor 2',activo:true,cliente_id:2,created_at:D(10),clientes:{nombre:cl[1].nombre}}
  ];
  cl[0].dispositivos=[{id:100,mac_address:dev[0].mac_address,activo:true}]; cl[0].vehiculos=[{id:10}];
  cl[1].dispositivos=[{id:101,mac_address:dev[1].mac_address,activo:true}]; cl[1].vehiculos=[{id:11}];
  var med = [];
  [0,1,2].forEach(function(k){
    for(var p=1;p<=10;p++){
      med.push({id:k*10+p,vehiculo_id:10,cliente_id:1,device_id:dev[0].mac_address,posicion:p,mm1:14-k*2-p*0.3,mm2:13-k*2,mm3:12-k*2,promedio:13-k*2,created_at:D(k*7+1),idneumatico:null,
        vehiculos:{nombre:veh[0].nombre,patente:veh[0].patente,tipo_ruedas:10},patente_raw:null,numero_raw:null});
    }
  });
  var neu = [1,2,3].map(function(p){ return {id:p,vehiculo_id:10,cliente_id:1,posicion:p,marca:'Michelin',modelo:'X <MultiWay>',fecha_compra:'2025-01-10',precio_unidad:450000,notas:'ok',stock_id:p===1?1:null,numero_quema:p===3?null:'Q-778'+(p+7),km_previos:p===1?15000:0,vehiculos:{nombre:veh[0].nombre}}; });
  // Cubiertas de stock: neumáticos sin vehículo (vehiculo_id nulo), con condición y sucursal.
  var cub = [
    {id:31,vehiculo_id:null,cliente_id:1,posicion:null,numero_quema:'S-001',marca:'Michelin',modelo:'X <Multi> Z',condicion:'nuevo',sucursal_id:1,sucursales:{nombre:'Montevideo'},fecha_compra:'2026-01-10',precio_unidad:455,estado:'almacenado',vida:0,km_previos:0,clientes:{nombre:cl[0].nombre}},
    {id:32,vehiculo_id:null,cliente_id:1,posicion:null,numero_quema:'S-002',marca:'Pirelli',modelo:null,condicion:'usado',sucursal_id:null,fecha_compra:null,precio_unidad:null,estado:'almacenado',vida:0,km_previos:42000,clientes:{nombre:cl[0].nombre}},
    {id:33,vehiculo_id:null,cliente_id:1,posicion:null,numero_quema:'S-010',marca:'Goodyear',modelo:'G661',condicion:'reparado',sucursal_id:2,sucursales:{nombre:'Salto'},fecha_compra:'2025-11-02',precio_unidad:410.5,estado:'almacenado',vida:0,km_previos:0,clientes:{nombre:cl[0].nombre}},
    {id:34,vehiculo_id:null,cliente_id:1,posicion:null,numero_quema:'S-011',marca:'Bridgestone',modelo:'R249',condicion:'recauchutado',sucursal_id:2,fecha_compra:null,precio_unidad:null,estado:'almacenado',vida:1,km_previos:0,clientes:{nombre:cl[0].nombre}},
    {id:35,vehiculo_id:null,cliente_id:2,posicion:null,numero_quema:'Z-900',marca:'Ajena',modelo:null,condicion:'nuevo',sucursal_id:null,fecha_compra:null,precio_unidad:null,estado:'almacenado',vida:0,km_previos:0,clientes:{nombre:cl[1].nombre}}
  ];
  var stock = [
    {id:1,marca:'Michelin',modelo:'X MultiWay',cliente_id:1,precio_unidad:450000,fecha_compra:'2025-01-10',cantidad:8,notas:'lote A',created_at:D(5),clientes:{nombre:cl[0].nombre}},
    {id:2,marca:'Bridgestone',modelo:null,cliente_id:2,precio_unidad:380000,fecha_compra:null,cantidad:4,notas:null,created_at:D(3),clientes:{nombre:cl[1].nombre}}
  ];
  var gas = [
    {id:1,nombre:'Servidor',categoria:'infra',monto:20000,notas:'Hosting <mensual>',recurrente:true,activo:true,created_at:D(9)},
    {id:2,nombre:'Publicidad',categoria:'marketing',monto:15000,notas:null,recurrente:false,activo:true,created_at:D(4)}
  ];
  // Modo ?reportes=1: 2.300 mediciones extra del vehículo 10 (nombre y id hostiles) para probar la paginación de la vista Reportes.
  var repMode = /[?&]reportes=1/.test(window.parent.location.search);
  window.__rangeCalls = [];
  if(repMode){
    for(var n=0;n<2300;n++){
      med.push({id:5000+n,vehiculo_id:10,cliente_id:1,device_id:dev[0].mac_address,posicion:(n%10)+1,mm1:9,mm2:9,mm3:9,promedio:9-(n%10)*0.5,created_at:D(100+n/10),idneumatico:'=ID,'+n,
        vehiculos:{nombre:'=Camión 01',patente:veh[0].patente,tipo_ruedas:10},patente_raw:null,numero_raw:null});
    }
  }
  // v_mediciones_neumatico: las mismas mediciones atribuidas al neumático montado en esa posición.
  var medNeu = med.map(function(m){ return Object.assign({}, m, {posicion_actual:m.posicion, estado_montaje:'montado', medicion_id:m.id}); });
  // v_km_cubierta: neumático 1 con datos completos, 2 con un tramo sin odómetro (estimado) y 3 sin ningún dato.
  var kmc = [
    {neumatico_id:1,cliente_id:1,vehiculo_id:10,km_previos:15000,km_en_vehiculos:0,km_tramo_actual:4000,km_totales:19000,km_confiable:true,tramos_con_dato:1,tramos_sin_dato:0,odometro_anomalo:false},
    {neumatico_id:2,cliente_id:1,vehiculo_id:10,km_previos:0,km_en_vehiculos:1200,km_tramo_actual:null,km_totales:1200,km_confiable:false,tramos_con_dato:1,tramos_sin_dato:1,odometro_anomalo:false},
    {neumatico_id:3,cliente_id:1,vehiculo_id:10,km_previos:0,km_en_vehiculos:null,km_tramo_actual:null,km_totales:null,km_confiable:false,tramos_con_dato:0,tramos_sin_dato:1,odometro_anomalo:false}
  ];
  // v_costo_cubierta: 1 con costo y CPK confiable, 2 con CPK provisional (estimado), 3 sin costos.
  var costoc = [
    {neumatico_id:1,vehiculo_id:10,tiene_costo:true,moneda:'UYU',monedas:['UYU'],moneda_mixta:false,costo_total:'1900.00',costo_por_concepto:{compra:'1900.00'},km_totales:19000,km_recorridos:4000,km_confiable:true,cpk:'0.475000',cpk_provisional:null,cpk_carcasa:'0.100000'},
    {neumatico_id:2,vehiculo_id:10,tiene_costo:true,moneda:'UYU',monedas:['UYU'],moneda_mixta:false,costo_total:'600.00',costo_por_concepto:{compra:'600.00'},km_totales:1200,km_recorridos:1200,km_confiable:false,cpk:null,cpk_provisional:'0.500000',cpk_carcasa:null},
    {neumatico_id:3,vehiculo_id:10,tiene_costo:false,moneda:null,monedas:null,moneda_mixta:false,costo_total:null,costo_por_concepto:null,km_totales:null,km_recorridos:null,km_confiable:false,cpk:null,cpk_provisional:null,cpk_carcasa:null}
  ];
  // cpk_por_grupo: una marca con muestra suficiente y otra con muestra baja y sin km confiables.
  var cpkg = [
    {grupo:'marca',clave:'Michelin',cliente_id:null,moneda:'UYU',n_neumaticos:6,n_sin_km:1,km_recorridos:60000,costo_total:'6000.00',cpk:'0.100000',muestra_baja:false},
    {grupo:'marca',clave:'Pirelli',cliente_id:null,moneda:'UYU',n_neumaticos:0,n_sin_km:2,km_recorridos:0,costo_total:null,cpk:null,muestra_baja:true}
  ];
  var T = {v_costo_cubierta:costoc,clientes:cl,vehiculos:veh,dispositivos:dev,mediciones:med,v_mediciones_neumatico:medNeu,neumaticos:neu.concat(cub),stock_neumaticos:stock,gastos:gas,v_km_cubierta:kmc};

  function Q(table){
    var rows=(T[table]||[]).slice(), head=false, single=false, rng=null;
    var q={
      select:function(_c,o){ if(o&&o.head) head=true; return q; },
      insert:function(r){ rows=[Object.assign({id:999},r)]; return q; },
      update:function(r){ rows=[Object.assign({},rows[0]||{id:1},r)]; return q; },
      upsert:function(){ return q; }, delete:function(){ return q; },
      eq:function(c,v){ rows=rows.filter(function(r){ return !(c in r) || String(r[c])===String(v); }); return q; },
      // is(col, null): filas sin valor en la columna (una columna ausente cuenta como nula)
      is:function(c,v){ rows=rows.filter(function(r){ return v===null ? (r[c]===null||r[c]===undefined) : r[c]===v; }); return q; },
      not:function(){ return q; }, in:function(){ return q; }, order:function(){ return q; }, limit:function(){ return q; },
      ilike:function(){ return q; }, neq:function(){ return q; }, gte:function(c,v){ if(repMode) rows=rows.filter(function(r){ return r[c]>=v; }); return q; },
      lte:function(c,v){ if(repMode) rows=rows.filter(function(r){ return r[c]<=v; }); return q; },
      lt:function(c,v){ if(repMode) rows=rows.filter(function(r){ return r[c]<v; }); return q; },
      range:function(a,b){ rng=[a,b]; window.__rangeCalls.push([a,b,table]); return q; },
      single:function(){ single=true; return q; },
      maybeSingle:function(){ single=true; return q; },
      then:function(res,rej){
        var out;
        if(rng) rows=rows.slice(rng[0],rng[1]+1);
        if(table==='clientes' && single && !asCliente){ out={data:null,error:null}; }
        else out={data: head?null:(single?(rows[0]||null):rows), count:rows.length, error:null};
        return Promise.resolve(out).then(res,rej);
      }
    };
    return q;
  }
  var session={user:{id:'u-1',email:'admin@test.local'}};
  window.supabase={createClient:function(){
    return {
      from:Q,
      rpc:function(name){ if(name==='cpk_por_grupo') return Promise.resolve({data:cpkg,error:null}); return Promise.resolve({data: name==='get_unregistered_devices'?[{device_id:'DE:AD:BE:EF:00:01',last_seen:D(1),n:3,total_meds:3,last_seen:D(1)}]:null,error:null}); },
      auth:{
        getSession:function(){ return Promise.resolve({data:{session:/[?&]nosession=1/.test(window.parent.location.search)?null:session}}); },
        signInWithPassword:function(){ return Promise.resolve({data:{user:session.user},error:null}); },
        signOut:function(){ return Promise.resolve({error:null}); },
        onAuthStateChange:function(){ return {data:{subscription:{unsubscribe:function(){}}}}; }
      }
    };
  }};
})();
