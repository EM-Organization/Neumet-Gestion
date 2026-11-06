// Fixture del arnés de humo para odómetro y ciclo de vida: registra las escrituras (update/insert) por tabla.
// Se carga DESPUÉS de stub.js; no lo modifica, envuelve createClient.
(function(){
  var fx = window.__cicloFx = { writes: [] };
  var base = window.supabase.createClient;
  window.supabase.createClient = function(){
    var c = base.apply(this, arguments), from = c.from;
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
