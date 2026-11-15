// Fixture del arnés de humo para la pantalla Empresa (F10 PR 4). Se carga en el iframe DESPUÉS de los demás fixtures
// (envuelve createClient por fuera): simula usuarios_empresa_listar, alerta_configurar y las Edge Functions
// quitar-acceso-usuario, reponer-acceso-usuario y crear-usuario-seccional. La base real las prueba en tests/e2e.
//   fx.cola: respuestas forzadas para las próximas llamadas a funciones: { status, body, efecto: 'quitado'|'vigente'|null }
//   fx.llamadas: { fn, body } de cada llamada a una función; fx.rpcs: { name, args } de cada RPC propia
(function () {
  var fx = window.__empFx = { cola: [], llamadas: [], rpcs: [], errAlerta: null };
  var seq = 30;
  var usuarios = [
    { user_id: 'u-1', email: 'yo@demo.test', alcance: 'empresa', sucursal_id: null, sucursal_nombre: null, estado: 'vigente', desde: '2026-01-01', acceso_id: null, bloqueo_auth_pendiente: false },
    { user_id: 'u-5', email: 'global@demo.test', alcance: 'empresa', sucursal_id: null, sucursal_nombre: null, estado: 'vigente', desde: '2026-01-02', acceso_id: null, bloqueo_auth_pendiente: false },
    { user_id: 'u-9', email: 'salto@demo.test', alcance: 'sucursal', sucursal_id: 2, sucursal_nombre: 'Salto & <Norte>', estado: 'vigente', desde: '2026-01-03', acceso_id: null, bloqueo_auth_pendiente: false },
    { user_id: 'u-20', email: 'baja@demo.test', alcance: 'empresa', sucursal_id: null, sucursal_nombre: null, estado: 'quitado', desde: '2026-02-01', acceso_id: 9, bloqueo_auth_pendiente: true },
    { user_id: 'u-21', email: 'baja2@demo.test', alcance: 'sucursal', sucursal_id: 2, sucursal_nombre: 'Salto & <Norte>', estado: 'quitado', desde: '2026-02-02', acceso_id: 10, bloqueo_auth_pendiente: false }
  ];
  function resp(status, obj) { return Promise.resolve({ status: status, ok: status < 300, json: function () { return Promise.resolve(obj); } }); }
  function porId(id) { return usuarios.filter(function (u) { return u.user_id === id; })[0]; }

  window.fetch = (function (orig) { return function (url, opts) {
    var m = /\/functions\/v1\/(quitar-acceso-usuario|reponer-acceso-usuario|crear-usuario-seccional)/.exec(String(url));
    // El alta de usuarios del ABM de sucursales (admin) la simula seccionales.fixture.js: aquí solo con ?empresa=1.
    if (!m || (m[1] === 'crear-usuario-seccional' && !/[?&]empresa=1/.test(window.parent.location.search))) return orig.apply(this, arguments);
    var fn = m[1], body = JSON.parse(opts.body);
    fx.llamadas.push({ fn: fn, body: body });
    var forzada = fx.cola.shift();
    if (forzada) {
      var u = fn === 'reponer-acceso-usuario' ? usuarios.filter(function (x) { return x.acceso_id === body.acceso_id; })[0] : porId(body.user_id);
      if (u && forzada.efecto) { u.estado = forzada.efecto; if (forzada.efecto === 'quitado' && !u.acceso_id) u.acceso_id = ++seq; }
      return resp(forzada.status, forzada.body);
    }
    if (fn === 'quitar-acceso-usuario') {
      var q = porId(body.user_id); if (q) { q.estado = 'quitado'; q.acceso_id = q.acceso_id || ++seq; }
      return resp(200, { ok: true, estado: 'quitado', acceso_id: q && q.acceso_id });
    }
    if (fn === 'reponer-acceso-usuario') {
      var r = usuarios.filter(function (x) { return x.acceso_id === body.acceso_id; })[0]; if (r) r.estado = 'vigente';
      return resp(200, { ok: true, estado: 'repuesto' });
    }
    if (/^dup@/.test(body.email)) return resp(409, { ok: false, codigo: 'acceso_quitado', error: 'El usuario tiene el acceso quitado' });
    usuarios.push({ user_id: 'u-' + (++seq), email: body.email, alcance: body.sucursal_id == null ? 'empresa' : 'sucursal', sucursal_id: body.sucursal_id == null ? null : body.sucursal_id, sucursal_nombre: body.sucursal_id == null ? null : 'Salto & <Norte>', estado: 'vigente', desde: '2026-11-16', acceso_id: null, bloqueo_auth_pendiente: false });
    return resp(201, { ok: true, usuario: { email: body.email, modo: body.password ? 'password' : 'invite' } });
  }; })(window.fetch);

  var base = window.supabase.createClient;
  window.supabase.createClient = function () {
    var c = base.apply(this, arguments), rpcBase = c.rpc, fromBase = c.from;
    // Umbrales de la empresa: la lectura con maybeSingle() devuelve los valores por defecto (alimenta Empresa > Umbrales y su captura).
    c.from = function (t) {
      var q = fromBase.apply(this, arguments);
      if (t === 'clientes' && q.maybeSingle) {
        var ms = q.maybeSingle;
        q.maybeSingle = function () {
          return ms.apply(q, arguments).then(function (o) {
            return o && o.data ? { data: Object.assign({ umbral_bajo_mm: 8, umbral_critico_mm: 5, umbral_retiro_mm: 3, dias_sin_medir_alerta: 30, irregularidad_mm: 2 }, o.data), error: o.error } : o;
          });
        };
      }
      return q;
    };
    c.rpc = function (name, args) {
      if (name === 'usuarios_empresa_listar') {
        fx.rpcs.push({ name: name, args: args });
        return Promise.resolve({ data: usuarios.map(function (u) { return Object.assign({}, u); }), error: null });
      }
      if (name === 'alerta_configurar') {
        fx.rpcs.push({ name: name, args: args });
        return Promise.resolve({ data: null, error: fx.errAlerta });
      }
      return rpcBase.apply(this, arguments);
    };
    return c;
  };
})();
