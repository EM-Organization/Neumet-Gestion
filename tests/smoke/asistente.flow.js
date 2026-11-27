// Recorrido de humo del asistente de reportes (docs/24 §2 y §6; datos simulados por asistente.fixture.js).
//   window.asistenteFlow(w, d, sleep, fail, log, quien)
//   quien: 'cliente' (administrador de empresa), 'sucursal' (usuario de sucursal, sin selector) o
//          'neumet' (equipo Neumet: elige cliente y puede cambiarlo con una respuesta en vuelo).
// Lo que se prueba: envío por Enter (y que Shift+Enter y Enter mantenido no envían), doble envío, errores
// 429/500 con y sin «Volver a intentar», historial que se envía, escape del HTML de la respuesta, CSV de una
// tabla y reporte listo, y el cambio de cliente que vacía la conversación y descarta la respuesta vieja.
window.asistenteFlow = async function (w, d, sleep, fail, log, quien) {
  var fx = w.__asisFx, pref = 'asistente(' + quien + '): ', EQUIPO = quien === 'neumet';
  var $ = function (s) { return d.querySelector(s); }, all = function (s) { return d.querySelectorAll(s); };
  var visible = function (el) { return !!el && el.getClientRects().length > 0; };
  var texto = function () { return $('#asis-historial').textContent; };
  var estado = function () { return $('#asis-estado').textContent; };
  var listo = function (id) { return $('#asis-listos button[data-reporte="' + id + '"]'); };
  var respuestas = function () { return all('#asis-historial .asis-respuesta').length; };
  var sinRespuesta = function () { return all('#asis-historial .asis-sin-respuesta').length; };
  var ultimo = function () { return fx.pedidos[fx.pedidos.length - 1]; };
  var esperar = async function (cond, que) { for (var t = 0; t < 200; t++) { if (cond()) return true; await sleep(25); } fail(pref + 'timeout esperando ' + que); return false; };
  var fin = function () { return !$('#asis-enviar').disabled; };
  var enviar = function (t) { $('#asis-pregunta').value = t; $('#asis-form').requestSubmit(); };
  var cambiarCliente = function (id) { var s = $('#rep-cliente'); s.value = id; s.dispatchEvent(new w.Event('change', { bubbles: true })); };

  // Pintado inicial: «Reportes listos» solo con Alertas (los de la ola 7 no están disponibles)
  if (!(await esperar(function () { return listo('alertas'); }, 'botón Alertas de la flota'))) return;
  if (listo('mensual') || listo('trimestral') || listo('descartadas')) fail(pref + 'se muestran reportes que todavía no están disponibles');
  if (listo('alertas').textContent !== 'Alertas de la flota') fail(pref + 'título del reporte listo: ' + listo('alertas').textContent);
  // El selector de cliente solo lo ve el equipo Neumet
  if (visible($('#rep-asistente .asis-cliente')) !== EQUIPO) fail(pref + 'el selector de cliente del asistente debe verse solo para el equipo Neumet');

  if (EQUIPO) {
    if (!$('#asis-pregunta').disabled || estado().indexOf('Elegir un cliente.') === -1) fail(pref + 'sin cliente elegido debe pedir «Elegir un cliente.»');
    if (!listo('alertas').disabled) fail(pref + 'sin cliente, el reporte listo debe estar deshabilitado');
    cambiarCliente('1');
    await esperar(function () { return !$('#asis-pregunta').disabled; }, 'campo habilitado tras elegir cliente');
  }

  // Enter envía; Shift+Enter y Enter mantenido no
  var campo = $('#asis-pregunta');
  campo.value = 'Sin envío';
  campo.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
  campo.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true }));
  await sleep(50);
  if (fx.pedidos.length !== 0) fail(pref + 'Shift+Enter o Enter mantenido enviaron una pregunta');

  // Envío por Enter: respuesta con párrafo, tabla, CSV y fuente
  campo.value = '¿Cuántas alertas hay?';
  campo.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await esperar(fin, 'respuesta a la primera pregunta');
  if (fx.pedidos.length !== 1 || ultimo().pregunta !== '¿Cuántas alertas hay?') fail(pref + 'pedido incorrecto: ' + JSON.stringify(fx.pedidos));
  if (ultimo().historial.length !== 0) fail(pref + 'la primera pregunta no debe llevar historial');
  if (EQUIPO ? ultimo().cliente_id !== 1 : ultimo().cliente_id !== null) fail(pref + 'cliente_id del pedido: ' + ultimo().cliente_id);
  if (texto().indexOf('Hay 2 alertas activas.') === -1) fail(pref + 'no se pintó el párrafo de la respuesta');
  if (!$('#asis-historial table') || texto().indexOf('Desgaste') === -1) fail(pref + 'no se pintó la tabla');
  if (texto().indexOf('Datos de alertas activas, 2 filas') === -1) fail(pref + 'falta la línea de fuente');
  if (campo.value !== '' || d.activeElement !== campo) fail(pref + 'tras enviar el campo debe vaciarse y recuperar el foco');

  // Doble envío: mientras hay una pregunta en vuelo, el campo, el botón y el reporte listo no envían
  fx.cola.push({ demoraMs: 400 });
  campo.value = 'Doble envío';
  $('#asis-form').requestSubmit();
  if (!$('#asis-pregunta').disabled || $('#asis-enviar').disabled !== true) fail(pref + 'en vuelo, el campo y Preguntar deben estar deshabilitados');
  campo.value = 'Segundo envío';
  $('#asis-form').requestSubmit();
  listo('alertas').click();
  await esperar(fin, 'fin del doble envío');
  if (fx.pedidos.length !== 2) fail(pref + 'doble envío: se enviaron ' + (fx.pedidos.length - 1) + ' pedidos en lugar de 1');
  campo.value = '';

  // Error 429: mensaje de límite, sin «Volver a intentar»
  fx.cola.push({ status: 429, body: { error: 'limite_diario' } });
  enviar('Pregunta con límite');
  await esperar(fin, 'respuesta 429');
  if (estado().indexOf('Se alcanzó el límite de 30 preguntas por día.') === -1) fail(pref + '429 sin mensaje de límite: ' + estado());
  if ($('[data-asis-reintentar]')) fail(pref + '429 no debe ofrecer Volver a intentar');
  if (sinRespuesta() !== 1) fail(pref + 'la pregunta del 429 debe quedar «Sin respuesta»');

  // Error 500: mensaje genérico con «Volver a intentar», que reenvía la misma pregunta sin el turno fallido
  fx.cola.push({ status: 500, body: { error: 'interno' } });
  enviar('Reintentar mi pregunta');
  await esperar(fin, 'respuesta 500');
  if (estado().indexOf('No se pudo generar la respuesta.') === -1 || !$('[data-asis-reintentar]')) fail(pref + '500 sin mensaje o sin Volver a intentar');
  var antes = fx.pedidos.length;
  $('[data-asis-reintentar]').click();
  await esperar(fin, 'reintento');
  if (fx.pedidos.length !== antes + 1 || ultimo().pregunta !== 'Reintentar mi pregunta') fail(pref + 'el reintento no reenvió la pregunta');
  // Historial: solo los pares completos (dos preguntas con respuesta); la fallida no entra
  if (ultimo().historial.length !== 4) fail(pref + 'historial del reintento: ' + ultimo().historial.length + ' turnos, se esperaban 4');
  if ($('[data-asis-reintentar]') || sinRespuesta() !== 1) fail(pref + 'tras el reintento exitoso: sin respuesta=' + sinRespuesta());

  // La respuesta es texto: el HTML que venga del modelo no se interpreta
  fx.cola.push({ status: 200, body: { ok: true, bloques: [{ tipo: 'parrafo', texto: '<img src=x>' }], fuentes: [], cuota: null } });
  enviar('Escapar');
  await esperar(fin, 'respuesta con HTML');
  if ($('#asis-historial img')) fail(pref + 'una respuesta con HTML se pintó como HTML');
  if (texto().indexOf('<img src=x>') === -1) fail(pref + 'la respuesta no mostró el texto tal cual');

  // CSV de la tabla de la primera respuesta (BOM, celdas y nombre de archivo)
  var blobs = [], descargas = [];
  var crearUrl = w.URL.createObjectURL; w.URL.createObjectURL = function (b) { blobs.push(b); return crearUrl.call(w.URL, b); };
  w.HTMLAnchorElement.prototype.click = function () { descargas.push(this.download); };
  $('#asis-historial [data-asis-csv="0"]').click();
  if (descargas.length !== 1 || !/^neumet-asistente_.*\.csv$/.test(descargas[0])) fail(pref + 'nombre del CSV: ' + descargas.join(','));
  // Blob.text() quita el BOM (decodificación UTF-8 de la especificación): se decodifica con ignoreBOM para verlo
  var bytesCsv = blobs.length ? new Uint8Array(await blobs[0].arrayBuffer()) : new Uint8Array(0);
  var csv = new w.TextDecoder('utf-8', { ignoreBOM: true }).decode(bytesCsv);
  if (csv.charCodeAt(0) !== 0xFEFF || csv.indexOf('Tipo,Vehículos\r\nDesgaste,2\r\n') === -1) fail(pref + 'contenido del CSV: ' + JSON.stringify(csv));

  // Reporte listo: manda la pregunta fija de docs/24
  listo('alertas').click();
  await esperar(fin, 'reporte listo');
  if (ultimo().pregunta !== 'Alertas activas de la flota agrupadas por tipo y severidad, con los vehículos afectados. Usar alertas_activas.') fail(pref + 'pregunta del reporte listo: ' + ultimo().pregunta);

  if (EQUIPO) {
    // Cambio de cliente con una respuesta en vuelo: la conversación se vacía, el campo queda libre y la respuesta vieja no se pinta
    fx.cola.push({ demoraMs: 400 });
    var antesVuelo = fx.pedidos.length;
    enviar('En vuelo para el cliente uno');
    // El cambio tiene que llegar con la petición ya en vuelo (pedir espera la sesión antes del fetch)
    await esperar(function () { return fx.pedidos.length > antesVuelo; }, 'pedido en vuelo');
    cambiarCliente('2');
    if ($('#asis-pregunta').disabled) fail(pref + 'al cambiar de cliente el campo debe quedar libre');
    if (texto().trim() !== '' || estado().trim() !== '') fail(pref + 'al cambiar de cliente debe vaciarse la conversación y el estado');
    await sleep(600);
    if (texto().trim() !== '' || estado().trim() !== '') fail(pref + 'la respuesta del cliente anterior se pintó después del cambio');
    enviar('Con el cliente dos');
    await esperar(fin, 'respuesta con el cliente dos');
    if (ultimo().cliente_id !== 2 || ultimo().historial.length !== 0) fail(pref + 'tras cambiar: cliente_id=' + ultimo().cliente_id + ', historial=' + ultimo().historial.length);
  }
};
