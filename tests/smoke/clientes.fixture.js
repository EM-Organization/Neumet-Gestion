// Fixture del arnés de humo para clientes (baja lógica + alta con/sin contraseña). Se carga en el iframe
// DESPUÉS de stub.js. No modifica stub.js: envuelve createClient y fetch.
(function(){
  var fx = window.__clientesFx = { fetches: [], rpcs: [] };
  var deleted = {id:99,nombre:'Cliente Eliminado SA',created_at:new Date(Date.now()-86400000*90).toISOString(),auth_user_id:null,deleted_at:new Date(Date.now()-86400000).toISOString(),dispositivos:[],vehiculos:[]};
  var seq = 200;

  fx.apiFetches = []; fx.apiRpcs = []; var apiCuentas = [];
  window.fetch = (function(orig){ return function(url, opts){
    if(String(url).indexOf('/functions/v1/crear-cuenta-api') !== -1){
      var b = JSON.parse(opts.body); fx.apiFetches.push(b);
      apiCuentas.push({user_id:'api-'+apiCuentas.length, email:b.email, created_at:new Date().toISOString()});
      return Promise.resolve({status:201, ok:true, json:function(){ return Promise.resolve({ok:true, cuenta:{user_id:'api-x', email:b.email, cliente_id:b.cliente_id}, password:'contrasena-de-prueba'}); }});
    }
    if(String(url).indexOf('/functions/v1/crear-cliente') === -1) return orig.apply(this, arguments);
    var body = JSON.parse(opts.body); fx.fetches.push(body);
    function resp(status, obj){ return Promise.resolve({status:status, ok:status<300, json:function(){ return Promise.resolve(obj); }}); }
    if(/^dup@/.test(body.email)) return resp(409, {ok:false, error:'A user with this email address has already been registered'});
    if(/^noadmin@/.test(body.email)) return resp(403, {ok:false, error:'forbidden'});
    return resp(200, {ok:true, cliente:{id:++seq, nombre:body.nombre, created_at:new Date().toISOString(), auth_user_id:'u-'+seq, dispositivos:[], vehiculos:[]}});
  }; })(window.fetch);

  var base = window.supabase.createClient;
  window.supabase.createClient = function(){
    var c = base.apply(this, arguments), from = c.from, rpc = c.rpc;
    c.from = function(t){
      var q = from(t);
      if(t === 'clientes'){
        q.is = function(){ return q; }; // el stub no filtra: el filtro de eliminados también se aplica en cliente
        var th = q.then;
        q.then = function(res, rej){ return th.call(q, function(out){
          if(out && Array.isArray(out.data)) out = Object.assign({}, out, {data: out.data.concat([deleted])});
          return res ? res(out) : out; }, rej); };
      }
      return q;
    };
    c.rpc = function(name, args){
      if(name === 'cuentas_api_listar'){ fx.apiRpcs.push(args); return Promise.resolve({data:apiCuentas.slice(), error:null}); }
      if(name === 'cliente_eliminar_suave'){ fx.rpcs.push({name:name, args:args}); return Promise.resolve({data:null, error:null}); }
      return rpc.apply(this, arguments);
    };
    return c;
  };
})();
