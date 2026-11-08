// Registra las llamadas a datos del cliente simulado (tablas y RPC) en window.__llamadas. Se carga el ÚLTIMO entre los
// fixtures, así envuelve a todos los demás y ve cada consulta. Lo usa tests/smoke/sinacceso.flow.js.
(function(){
  var llamadas = window.__llamadas = [];
  var base = window.supabase.createClient;
  window.supabase.createClient = function(){
    var c = base.apply(this, arguments), from = c.from, rpc = c.rpc;
    c.from = function(t){ llamadas.push('from:' + t); return from.apply(this, arguments); };
    c.rpc = function(n){ llamadas.push('rpc:' + n); return rpc.apply(this, arguments); };
    return c;
  };
})();
