// Fixture del arnés de humo para odómetro y ciclo de vida: registra las escrituras (update/insert) por tabla.
// Se carga DESPUÉS de stub.js; no lo modifica, envuelve createClient.
(function(){
  var fx = window.__cicloFx = { writes: [], rpcs: [], rpcError: null, rpcDelay: 0, lecturas: {} };
  var base = window.supabase.createClient;
  window.supabase.createClient = function(){
    var c = base.apply(this, arguments), from = c.from, rpc = c.rpc;
    c.rpc = function(name, args){
      if(['neumatico_rotar','neumatico_cambiar','neumatico_rotar_disco','vehiculo_alinear'].indexOf(name) === -1) return rpc.apply(c, arguments);
      fx.rpcs.push({name: name, args: args});
      // Disco y alineación: la base responde con su propio retorno (sin «intercambio»).
      var ok = name === 'vehiculo_alinear' ? {neumaticos: 2, duplicada: false} : (name === 'neumatico_rotar_disco' ? {duplicada: false} : {intercambio: true});
      var res = fx.rpcError ? {data: null, error: fx.rpcError} : {data: ok, error: null};
      // fx.rpcDelay (ms): RPC lenta, para probar el tiempo de espera y la respuesta que llega tarde
      return fx.rpcDelay ? new Promise(function(ok){ setTimeout(function(){ ok(res); }, fx.rpcDelay); }) : Promise.resolve(res);
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
