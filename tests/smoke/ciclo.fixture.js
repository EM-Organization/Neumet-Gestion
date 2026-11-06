// Fixture del arnés de humo para odómetro y ciclo de vida: registra las escrituras (update/insert) por tabla.
// Se carga DESPUÉS de stub.js; no lo modifica, envuelve createClient.
(function(){
  var fx = window.__cicloFx = { writes: [], rpcs: [], rpcError: null };
  var base = window.supabase.createClient;
  window.supabase.createClient = function(){
    var c = base.apply(this, arguments), from = c.from, rpc = c.rpc;
    c.rpc = function(name, args){
      if(name !== 'neumatico_rotar' && name !== 'neumatico_cambiar') return rpc.apply(c, arguments);
      fx.rpcs.push({name: name, args: args});
      return Promise.resolve(fx.rpcError ? {data: null, error: fx.rpcError} : {data: {intercambio: true}, error: null});
    };
    c.from = function(t){
      var q = from(t);
      if(t === 'vehiculos' || t === 'neumaticos' || t === 'eventos_neumatico'){
        ['insert','update'].forEach(function(op){
          var orig = q[op];
          q[op] = function(payload){ fx.writes.push({table:t, op:op, payload:payload}); return orig.apply(q, arguments); };
        });
      }
      return q;
    };
    return c;
  };
})();
