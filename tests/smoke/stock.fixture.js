// Fixture del arnés de humo para el stock de cubiertas: registra las RPC stock_cubierta_* (nombre y argumentos) y puede
// responder con un error. Se carga DESPUÉS de stub.js y seccionales.fixture.js; envuelve createClient.
(function(){
  var fx = window.__stockFx = { rpcs: [], rpcError: null };
  var base = window.supabase.createClient;
  window.supabase.createClient = function(){
    var c = base.apply(this, arguments), rpc = c.rpc;
    c.rpc = function(name, args){
      if(!/^stock_cubierta_/.test(name)) return rpc.apply(c, arguments);
      fx.rpcs.push({name: name, args: args});
      return Promise.resolve(fx.rpcError ? {data: null, error: fx.rpcError} : {data: {id: 99, movido: true}, error: null});
    };
    return c;
  };
})();
