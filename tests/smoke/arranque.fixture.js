// Fixture de arranque (?arranque=1): controla la consulta de perfiles, los eventos de auth y el número de oyentes.
// Se carga DESPUÉS de stub.js y de los demás fixtures; envuelve createClient sin tocar stub.js.
// ?perfil=error  la consulta de perfiles falla (red caída)
// ?perfil=lento&ms=N  responde a los N ms (por defecto 3000)
// ?perfil=nunca1  la primera consulta nunca responde; las siguientes, normales
// ?desde=N        el perfil (error o lento) solo afecta a la consulta N en adelante (por defecto, desde la primera)
// ?sesionms=N     getSession responde N ms más tarde que el stub (400 ms): ventana de carrera de la escena «ventana»
// Los perfiles del usuario u-2 se resuelven con la fila de u-1 (un segundo usuario con panel, para la escena «cambio»).
// window.__perfil.calls: consultas de perfiles hechas. window.__auth.emitir(evento, sesion): dispara el oyente de auth.
(function () {
  if (!/[?&]arranque=1/.test(window.parent.location.search)) return;
  var q = window.parent.location.search;
  var modo = (q.match(/[?&]perfil=(\w+)/) || [])[1] || '';
  var ms = +((q.match(/[?&]ms=(\d+)/) || [])[1] || 3000);
  var desde = +((q.match(/[?&]desde=(\d+)/) || [])[1] || 1);
  var sesionMs = +((q.match(/[?&]sesionms=(\d+)/) || [])[1] || 0);
  var ctl = window.__perfil = { calls: 0 };
  var auth = window.__auth = {
    listeners: [],
    registros: 0,
    emitir: function (evento, sesion) { this.listeners.slice().forEach(function (fn) { fn(evento, sesion); }); }
  };
  var esperar = function (t) { return new Promise(function (r) { setTimeout(r, t); }); };
  var base = window.supabase.createClient;
  window.supabase.createClient = function () {
    var c = base.apply(this, arguments);
    var onCambio = c.auth.onAuthStateChange;
    c.auth.onAuthStateChange = function (fn) {
      auth.registros++; auth.listeners.push(fn);
      return onCambio.apply(this, arguments);
    };
    if (sesionMs) {
      var getSesion = c.auth.getSession;
      c.auth.getSession = function () {
        var args = arguments, self = this;
        return esperar(sesionMs).then(function () { return getSesion.apply(self, args); });
      };
    }
    var desdeTabla = c.from;
    c.from = function (tabla) {
      var query = desdeTabla.apply(this, arguments);
      if (tabla !== 'perfiles') return query;
      var eqOrig = query.eq;
      query.eq = function (col, val) { return eqOrig.call(query, col, col === 'user_id' && val === 'u-2' ? 'u-1' : val); };
      var then = query.then;
      query.then = function (ok, ko) {
        var n = ++ctl.calls, pr, afecta = n >= desde;
        if (modo === 'error' && afecta) pr = Promise.resolve({ data: null, error: { message: 'Failed to fetch' } });
        else if (modo === 'nunca1' && n === 1) pr = new Promise(function () {});
        else if (modo === 'lento' && afecta) pr = esperar(ms).then(function () { return then.call(query); });
        else pr = then.call(query);
        return pr.then(ok, ko);
      };
      return query;
    };
    return c;
  };
})();
