// Fixture del arnés de humo del asistente de reportes (docs/24 §2). Se carga en el iframe DESPUÉS de los demás fixtures:
// intercepta fetch a /functions/v1/asistente-reportes. Ninguna prueba llama a la función real.
//   window.__asisPedidos: cuerpo de cada pedido recibido (es el mismo arreglo que fx.pedidos)
//   fx.cola: respuestas forzadas para los próximos pedidos: { status, body, demoraMs, cuelga }
//   Sin cola: respuesta de prueba con un párrafo, una tabla y su fuente.
(function () {
  var fx = window.__asisFx = { pedidos: [], cola: [] };
  window.__asisPedidos = fx.pedidos;
  var base = window.fetch;
  var OK = {
    ok: true,
    bloques: [
      { tipo: 'parrafo', texto: 'Hay 2 alertas activas.' },
      { tipo: 'tabla', columnas: ['Tipo', 'Vehículos'], filas: [['Desgaste', '2']] }
    ],
    fuentes: [{ tool: 'alertas_activas', desde: null, hasta: null, filas: 2, recortado: false }],
    modelo: 'nemotron',
    cuota: { usadas: 1, limite: 30 }
  };
  function respuesta(status, body) {
    return Promise.resolve({ status: status, ok: status < 300, json: function () { return Promise.resolve(body); } });
  }
  // La espera respeta el AbortController del panel: si se aborta (60 s o cambio de cliente), rechaza como lo hace fetch real.
  function esperar(ms, signal) {
    return new Promise(function (ok, no) {
      if (signal.aborted) return no(new DOMException('abortado', 'AbortError'));
      var t = setTimeout(ok, ms);
      signal.addEventListener('abort', function () { clearTimeout(t); no(new DOMException('abortado', 'AbortError')); });
    });
  }

  window.fetch = function (url, opts) {
    if (!/\/functions\/v1\/asistente-reportes/.test(String(url))) return base.apply(this, arguments);
    fx.pedidos.push(JSON.parse(opts.body));
    var forzada = fx.cola.shift();
    if (forzada && forzada.cuelga) {
      return new Promise(function (ok, no) {
        opts.signal.addEventListener('abort', function () { no(new DOMException('abortado', 'AbortError')); });
      });
    }
    var salida = {
      status: (forzada && forzada.status) || 200,
      body: forzada && forzada.body !== undefined ? forzada.body : OK,
      demoraMs: (forzada && forzada.demoraMs) || 0
    };
    return esperar(salida.demoraMs, opts.signal).then(function () { return respuesta(salida.status, salida.body); });
  };
})();
