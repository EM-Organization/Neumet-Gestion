// Fixture del arnés de humo para el stock de cubiertas: registra las RPC stock_cubierta_* (nombre y argumentos) y puede
// responder con un error. Se carga DESPUÉS de stub.js y seccionales.fixture.js; envuelve createClient.
(function(){
  var fx = window.__stockFx = { rpcs: [], rpcError: null, failTable: null };
  var base = window.supabase.createClient;
  window.supabase.createClient = function(){
    var c = base.apply(this, arguments), rpc = c.rpc, from = c.from;
    // `failTable`: las lecturas de esa tabla fallan (cualquier cadena de select/order/range termina en un error).
    c.from = function(t){
      if(fx.failTable !== t) return from.apply(c, arguments);
      var q = new Proxy(function(){}, { get: function(_, k){
        if(k === 'then') return function(res){ return Promise.resolve({ data: null, rows: null, error: { message: 'fallo simulado' } }).then(res); };
        return function(){ return q; };
      } });
      return q;
    };
    c.rpc = function(name, args){
      if(!/^(stock_cubierta_|stock_cubiertas_agregar_lote$|recauchutado_enviar$)/.test(name)) return rpc.apply(c, arguments); // alta por lote y «Enviar a recauchutar» desde Stock
      fx.rpcs.push({name: name, args: args});
      return Promise.resolve(fx.rpcError ? {data: null, error: fx.rpcError} : {data: {id: 99, movido: true}, error: null});
    };
    return c;
  };
})();
