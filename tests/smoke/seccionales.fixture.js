// Fixture del arnés de humo para seccionales. Se carga en el iframe DESPUÉS de stub.js (no lo modifica):
// sirve las tablas sucursales/perfiles, el mapa vehículo->seccional y registra las escrituras del ABM.
//   ?cliente=1            perfil GLOBAL del cliente 1 (ve el selector)
//   ?cliente=1&secuser=1  perfil de SECCIONAL (Salto): el selector no debe aparecer
(function(){
  var parentSearch = window.parent.location.search;
  var asCliente = /[?&](cliente|secuser)=1/.test(parentSearch);
  var secUser = /[?&]secuser=1/.test(parentSearch);
  var fx = window.__secFx = { inserts: [], updates: [], deletes: [], fetches: [], vehEqs: [] };
  var seq = 100;

  var sucursales = [
    { id: 1, cliente_id: 1, nombre: 'Montevideo' },
    { id: 2, cliente_id: 1, nombre: 'Salto & <Norte>' },
    { id: 3, cliente_id: 2, nombre: 'Ajena' }
  ];
  // Mapa vehículo -> seccional que lee el selector del cliente (ids de v_estado_neumaticos de flota.fixture.js)
  var vehMap = [
    { id: 10, sucursal_id: 1 }, { id: 12, sucursal_id: 2 }, { id: 11, sucursal_id: null }, { id: 13, sucursal_id: null }
  ];
  var perfiles = [
    { user_id: 'u-5', email: 'global@demo.test', sucursal_id: null, rol: 'cliente', cliente_id: 1 },
    { user_id: 'u-9', email: 'salto@demo.test', sucursal_id: 2, rol: 'cliente', cliente_id: 1 }
  ];
  if (asCliente) perfiles.push({ user_id: 'u-1', email: 'yo@demo.test', sucursal_id: secUser ? 2 : null, rol: 'cliente', cliente_id: 1 });

  var store = { sucursales: sucursales, perfiles: perfiles };
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
          if (rows.some(function(r){ return r.id === 2; })) out = { data: null, error: { code: '23503', message: 'fk' } }; // la seccional 2 tiene vehículos
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
    c.from = function(t){
      if (t === 'sucursales' || t === 'perfiles') return MQ(t);
      var q = from(t);
      if (t !== 'vehiculos' && t !== 'dispositivos') return q;
      var oe = q.eq, ou = q.update, os = q.select, th = q.then, patch = null, eqs = [], mapa = false;
      q.update = function(r){ patch = r; return ou.call(q, r); };
      q.eq = function(c2, v){ eqs.push([c2, v]); return oe.call(q, c2, v); };
      q.select = function(cols){ if (cols === 'id,sucursal_id') mapa = true; return os.apply(q, arguments); };
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
