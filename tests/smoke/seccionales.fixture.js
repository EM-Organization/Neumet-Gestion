// Fixture del arnés de humo para sucursales. Se carga en el iframe DESPUÉS de stub.js (no lo modifica):
// sirve las tablas sucursales/perfiles, el mapa vehículo->sucursal y registra las escrituras del ABM.
//   ?cliente=1            perfil GLOBAL del cliente 1 (ve el selector)
//   ?cliente=1&secuser=1  perfil de SUCURSAL (Salto): el selector no debe aparecer
(function(){
  var parentSearch = window.parent.location.search;
  var asCliente = /[?&](cliente|secuser)=1/.test(parentSearch);
  var secUser = /[?&]secuser=1/.test(parentSearch);
  var sinPerfil = /[?&]sinperfil=1/.test(parentSearch), rolApi = /[?&]api=1/.test(parentSearch);
  var fx = window.__secFx = { inserts: [], updates: [], deletes: [], fetches: [], vehEqs: [] };
  var seq = 100;

  var sucursales = [
    { id: 1, cliente_id: 1, nombre: 'Montevideo' },
    { id: 2, cliente_id: 1, nombre: 'Salto & <Norte>' },
    { id: 3, cliente_id: 2, nombre: 'Ajena' }
  ];
  // Mapa vehículo -> sucursal que lee el selector del cliente (ids de v_estado_neumaticos de flota.fixture.js)
  var vehMap = [
    { id: 10, sucursal_id: 1 }, { id: 12, sucursal_id: 2 }, { id: 11, sucursal_id: null }, { id: 13, sucursal_id: null }
  ];
  var perfiles = [
    { user_id: 'u-5', email: 'global@demo.test', sucursal_id: null, rol: 'cliente', cliente_id: 1 },
    { user_id: 'u-9', email: 'salto@demo.test', sucursal_id: 2, rol: 'cliente', cliente_id: 1 }
  ];
  // Perfil del usuario de la sesión simulada (u-1): admin, cliente, rol api o ninguno (?sinperfil=1).
  if (rolApi) perfiles.push({ user_id: 'u-1', email: 'api@demo.test', sucursal_id: null, rol: 'api', cliente_id: 1 });
  else if (!asCliente && !sinPerfil) perfiles.push({ user_id: 'u-1', email: 'admin@test.local', sucursal_id: null, rol: 'admin', cliente_id: null });
  if (asCliente) perfiles.push({ user_id: 'u-1', email: 'yo@demo.test', sucursal_id: secUser ? 2 : null, rol: 'cliente', cliente_id: 1 });

  // Vehículos que lee la vista Sucursales (select 'id,nombre,numero,patente,sucursal_id,activo') y que mueven las RPC simuladas.
  var SUC_COLS = 'id,nombre,numero,patente,sucursal_id,activo';
  var vehiculosSuc = [
    { id: 10, cliente_id: 1, nombre: 'Camión 01', numero: '201', patente: 'AB123CD', sucursal_id: 1, activo: true },
    { id: 15, cliente_id: 1, nombre: 'Camión 05', numero: '205', patente: 'SAB-1234', sucursal_id: null, activo: true },
    { id: 16, cliente_id: 1, nombre: '<Hostil> & Cía', numero: null, patente: null, sucursal_id: 2, activo: true },
    { id: 17, cliente_id: 2, nombre: 'Ajeno', numero: '900', patente: 'ZZ9', sucursal_id: 3, activo: true }
  ];
  fx.rpcs = [];
  var store = { sucursales: sucursales, perfiles: perfiles, vehiculos: vehiculosSuc };
  function resp(status, obj){ return Promise.resolve({ status: status, ok: status < 300, json: function(){ return Promise.resolve(obj); } }); }

  window.fetch = (function(orig){ return function(url, opts){
    if (String(url).indexOf('/functions/v1/crear-usuario-seccional') === -1) return orig.apply(this, arguments);
    var body = JSON.parse(opts.body); fx.fetches.push(body);
    if (/^dup@/.test(body.email)) return resp(409, { ok: false, error: 'Ya existe un usuario con ese email' });
    perfiles.push({ user_id: 'u-' + (++seq), email: body.email, sucursal_id: body.sucursal_id == null ? null : body.sucursal_id, rol: 'cliente', cliente_id: body.cliente_id });
    return resp(201, { ok: true, usuario: { user_id: 'u-' + seq, cliente_id: body.cliente_id, sucursal_id: body.sucursal_id == null ? null : body.sucursal_id, email: body.email, modo: 'invite' } });
  }; })(window.fetch);

  // Constructor mínimo de consultas para sucursales y perfiles (con estado).
  function MQ(table){
    var op = 'select', payload = null, filters = [];
    var q = {
      select: function(){ return q; }, order: function(){ return q; },
      insert: function(r){ op = 'insert'; payload = r; return q; },
      update: function(r){ op = 'update'; payload = r; return q; },
      delete: function(){ op = 'delete'; return q; },
      eq: function(c, v){ filters.push([c, v]); return q; },
      maybeSingle: function(){ op = op === 'select' ? 'single' : op; return q; },
      then: function(res, rej){
        var rows = store[table].filter(function(r){ return filters.every(function(f){ return String(r[f[0]]) === String(f[1]); }); });
        var out;
        if (op === 'insert') {
          var row = Object.assign({ id: ++seq }, payload); store[table].push(row); fx.inserts.push({ table: table, row: payload }); out = { data: [row], error: null };
        } else if (op === 'update') {
          rows.forEach(function(r){ Object.assign(r, payload); }); fx.updates.push({ table: table, patch: payload, filters: filters }); out = { data: rows, error: null };
        } else if (op === 'delete') {
          fx.deletes.push({ table: table, filters: filters });
          if (rows.some(function(r){ return r.id === 2; })) out = { data: null, error: { code: '23503', message: 'fk' } }; // la sucursal 2 tiene vehículos
          else { store[table] = store[table].filter(function(r){ return rows.indexOf(r) === -1; }); out = { data: null, error: null }; }
        } else if (op === 'single') out = { data: rows[0] || null, error: null };
        else out = { data: rows, error: null };
        return Promise.resolve(out).then(res, rej);
      }
    };
    return q;
  }

  var base = window.supabase.createClient;
  window.supabase.createClient = function(){
    var c = base.apply(this, arguments), from = c.from;
    // RPC de gestión (la base real las prueba en tests/sql y tests/e2e): aquí solo se simula su contrato.
    var rpcBase = c.rpc;
    c.rpc = function(name, args){
      var h = {
        sucursal_crear: function(){
          if (store.sucursales.some(function(x){ return x.cliente_id === 1 && x.nombre.toLowerCase() === args.p_nombre.toLowerCase(); })) return { code: '23505', message: 'duplicate key value violates unique constraint "sucursales_cliente_nombre_uk"' };
          store.sucursales.push({ id: ++seq, cliente_id: 1, nombre: args.p_nombre });
        },
        sucursal_renombrar: function(){ store.sucursales.forEach(function(x){ if (x.id === args.p_sucursal_id) x.nombre = args.p_nombre; }); },
        sucursal_eliminar: function(){
          if (store.vehiculos.some(function(v){ return v.sucursal_id === args.p_sucursal_id; })) return { code: '23503', message: 'la sucursal tiene 1 vehículo(s), 0 dispositivo(s) y 0 usuario(s): reasignarlos antes de eliminarla' };
          store.sucursales = store.sucursales.filter(function(x){ return x.id !== args.p_sucursal_id; });
        },
        vehiculo_crear: function(){
          if (store.vehiculos.some(function(v){ return v.cliente_id === 1 && v.numero === args.p_numero; })) return { code: '23505', message: 'duplicate key value violates unique constraint "vehiculos_cliente_numero_uk"' };
          store.vehiculos.push({ id: ++seq, cliente_id: 1, nombre: 'Coche ' + args.p_numero, numero: args.p_numero, patente: args.p_patente, sucursal_id: args.p_sucursal_id, activo: true });
        },
        vehiculo_mover_sucursal: function(){ store.vehiculos.forEach(function(v){ if (v.id === args.p_vehiculo_id) v.sucursal_id = args.p_sucursal_id; }); }
      }[name];
      if (!h) return rpcBase.apply(this, arguments);
      fx.rpcs.push({ name: name, args: args });
      var e = h();
      return Promise.resolve({ data: e ? null : {}, error: e || null });
    };
    c.from = function(t){
      if (t === 'sucursales' || t === 'perfiles') return MQ(t);
      var q = from(t);
      if (t !== 'vehiculos' && t !== 'dispositivos') return q;
      var oe = q.eq, ou = q.update, os = q.select, th = q.then, patch = null, eqs = [], mapa = false;
      q.update = function(r){ patch = r; return ou.call(q, r); };
      q.eq = function(c2, v){ eqs.push([c2, v]); return oe.call(q, c2, v); };
      q.select = function(cols){
        if (t === 'vehiculos' && cols === SUC_COLS) return MQ('vehiculos').select();
        if (cols === 'id,sucursal_id') mapa = true;
        return os.apply(q, arguments);
      };
      q.then = function(res, rej){
        eqs.forEach(function(e){ if (e[0] === 'sucursal_id') fx.vehEqs.push(t + ':' + e[1]); });
        if (patch) fx.updates.push({ table: t, patch: patch, filters: eqs });
        if (mapa) return Promise.resolve({ data: vehMap.map(function(v){ return Object.assign({}, v); }), error: null }).then(res, rej);
        return th.call(q, res, rej);
      };
      return q;
    };
    return c;
  };
})();
