// Fixture del arnés de humo: emula los privilegios por columna de la migración 20261116500000.
// Se carga la ÚLTIMA (envuelve a todas las demás): neumaticos.precio_unidad y eventos_neumatico.costo no se leen por select.
//   * select() sin columnas, select('*') o con precio_unidad / costo en neumaticos / eventos_neumatico => error 42501
//     (como la base real: permiso denegado para la columna). Cada intento queda en __preciosFx.violaciones.
//   * Las filas devueltas nunca llevan esos campos (la base no los entrega).
//   * Desde el PR 9b (docs/17, migración C2): clientes.precio_mensual tampoco se lee ni se escribe directo. Un select con esa columna
//     (o con '*'), o un update que la incluya, queda en __preciosFx.violaciones y el select falla con 42501. El precio llega por
//     cliente_precios_mensuales y se fija con cliente_precio_mensual_fijar (registradas en __preciosFx.balance; __preciosFx.falla
//     = código SQLSTATE con el que la próxima llamada a fijar responde un error, para probar los avisos de Balance).
//   * rpc neumaticos_precios / eventos_costos devuelven los valores (registrados en __preciosFx.rpcs); la base real
//     responde vacío al perfil de sucursal, pero el panel no debe ni llamarlas (el flujo lo comprueba).
(function(){
  var fx = window.__preciosFx = { violaciones: [], rpcs: [], balance: [], falla: null };
  var PRIV = { neumaticos: 'precio_unidad', eventos_neumatico: 'costo', clientes: 'precio_mensual' };
  var PRECIOS_MENSUALES = { 1: 50000, 2: 75000 }; // mismos importes que los clientes del stub
  // Mismos importes que el stub: neumáticos del vehículo 10 y cubiertas de stock (31, 33); costo del montaje del evento 2.
  var PRECIOS = [{id:1,precio_unidad:450000},{id:2,precio_unidad:450000},{id:3,precio_unidad:450000},{id:31,precio_unidad:455},{id:33,precio_unidad:410.5},{id:1003,precio_unidad:230000}];
  var COSTOS = [{id:2,costo:230.5}];
  var STOCK = [31, 33];
  var base = window.supabase.createClient;
  function respuesta(rows, filtro){
    var rng = null, data = rows.filter(filtro || function(){ return true; });
    var q = {
      order: function(){ return q; }, range: function(a, b){ rng = [a, b]; return q; },
      then: function(res, rej){ return Promise.resolve({ data: rng ? data.slice(rng[0], rng[1] + 1) : data, error: null }).then(res, rej); }
    };
    return q;
  }
  function sinCampo(x, campo){
    if(Array.isArray(x)) return x.map(function(f){ return sinCampo(f, campo); });
    if(x && typeof x === 'object' && campo in x){ var c = Object.assign({}, x); delete c[campo]; return c; }
    return x;
  }
  window.supabase.createClient = function(){
    var c = base.apply(this, arguments), from = c.from, rpc = c.rpc;
    c.rpc = function(name, args){
      if(name === 'neumaticos_precios'){
        fx.rpcs.push({ name: name, args: args });
        return respuesta(PRECIOS, function(f){ return !(args && args.p_solo_stock) || STOCK.indexOf(f.id) !== -1; });
      }
      if(name === 'cliente_precios_mensuales'){
        fx.balance.push({ name: name, args: args });
        return Promise.resolve({ data: Object.keys(PRECIOS_MENSUALES).map(function(id){ return { cliente_id: Number(id), precio_mensual: PRECIOS_MENSUALES[id] }; }), error: null });
      }
      if(name === 'cliente_precio_mensual_fijar'){
        fx.balance.push({ name: name, args: args });
        if(fx.falla){ var code = fx.falla; fx.falla = null; return Promise.resolve({ data: null, error: { code: code, message: 'simulado ' + code } }); }
        PRECIOS_MENSUALES[args.p_cliente_id] = Math.round(args.p_precio * 100) / 100;
        return Promise.resolve({ data: PRECIOS_MENSUALES[args.p_cliente_id], error: null });
      }
      if(name === 'eventos_costos'){ fx.rpcs.push({ name: name, args: args }); return respuesta(COSTOS); }
      return rpc.apply(c, arguments);
    };
    c.from = function(t){
      var q = from(t), campo = PRIV[t];
      if(!campo) return q;
      var os = q.select, th = q.then, cols, escribe = false, selecciona = false;
      ['insert', 'update', 'upsert', 'delete'].forEach(function(op){
        var o = q[op]; if(!o) return;
        q[op] = function(v){
          escribe = true;
          if(op === 'update' && v && typeof v === 'object' && campo in v) fx.violaciones.push(t + ': update(' + campo + ')');
          return o.apply(q, arguments);
        };
      });
      q.select = function(c_){ cols = c_ === undefined ? '*' : String(c_); selecciona = true; return os.apply(q, arguments); };
      q.then = function(res, rej){
        if(selecciona || !escribe){
          var tokens = (cols === undefined ? '*' : cols).split(',').map(function(s){ return s.trim(); });
          if(tokens.indexOf('*') !== -1 || tokens.indexOf(campo) !== -1){
            fx.violaciones.push(t + ': select(' + cols + ')');
            return Promise.resolve({ data: null, error: { code: '42501', message: 'permission denied for table ' + t } }).then(res, rej);
          }
        }
        return th.call(q, function(r){ return res ? res(r && r.data !== undefined ? Object.assign({}, r, { data: sinCampo(r.data, campo) }) : r) : r; }, rej);
      };
      return q;
    };
    return c;
  };
})();
