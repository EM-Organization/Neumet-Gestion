// Recorridos de humo de la pantalla Empresa (datos simulados por empresa.fixture.js + seccionales/salud.fixture.js).
//   window.empresaFlow(w, d, sleep, fail, log)          administrador de empresa (cliente sin sucursal): usuarios, umbrales, dispositivos
//   window.empresaBloqueadaFlow(w, d, sleep, fail, log, quien)  equipo Neumet (admin) y usuario de sucursal: sin menú, sin acceso por URL, sin llamadas
window.empresaFlow = async function (w, d, sleep, fail, log) {
  var fx = w.__empFx, $ = function (s) { return d.querySelector(s); }, all = function (s) { return d.querySelectorAll(s); };
  var toast = function () { return $('#toast-msg').textContent; };
  var fila = function (id) { return $('#tbody-empresa-usuarios tr[data-user="' + id + '"]'); };
  var btn = function (id, accion) { var f = fila(id); return f && f.querySelector('[data-action="' + accion + '"]'); };
  var visible = function (el) { return !!el && el.getClientRects().length > 0; };
  var esperar = async function (cond, que) { for (var t = 0; t < 60; t++) { if (cond()) return true; await sleep(50); } fail('empresa: timeout esperando ' + que); return false; };
  var confirmar = async function () { await esperar(function () { return $('#modal-confirm').classList.contains('show'); }, 'diálogo de confirmación'); $('#confirm-ok').click(); await sleep(250); };

  // Menú: sección Empresa visible solo para el administrador de empresa
  ['sucursales', 'empresa-usuarios', 'empresa-umbrales'].forEach(function (v) {
    if (!visible($('.nav-item[data-view="' + v + '"]'))) fail('empresa: falta en el menú ' + v);
  });
  if (visible($('.nav-item[data-view="clientes"]')) || visible($('.nav-item[data-view="balance"]'))) fail('empresa: el menú muestra Clientes o Balance');
  if (d.querySelector('#user-role').textContent !== 'Administrador de empresa') fail('empresa: rol mostrado: ' + d.querySelector('#user-role').textContent);

  // Usuarios: lista, escape, el propio usuario no se quita
  $('.nav-item[data-view="empresa-usuarios"]').click(); await sleep(500);
  if (!$('#view-empresa-usuarios').classList.contains('active')) { fail('empresa: vista usuarios no activa'); return; }
  if (all('#tbody-empresa-usuarios tr[data-user]').length !== 5) fail('empresa: se esperaban 5 usuarios, hay ' + all('#tbody-empresa-usuarios tr[data-user]').length);
  if (d.body.innerHTML.indexOf('<Norte>') !== -1) fail('empresa: nombre de sucursal sin escapar');
  if (btn('u-1', 'empresaQuitar')) fail('empresa: el usuario de la sesión puede quitarse a sí mismo');
  if (!btn('u-5', 'empresaQuitar')) fail('empresa: falta Quitar en un usuario vigente');
  if (!btn('u-20', 'empresaReponer') || !btn('u-20', 'empresaQuitar')) fail('empresa: la fila quitada debe ofrecer Reponer acceso y Bloquear de nuevo');
  if (btn('u-5', 'empresaQuitar').className.indexOf('icon-btn danger') === -1 || /(^| )btn( |$)/.test(btn('u-5', 'empresaQuitar').className)) fail('empresa: Quitar debe usar el estilo de baja del panel (icon-btn danger), no un botón rojo sólido: ' + btn('u-5', 'empresaQuitar').className);
  if (!btn('u-21', 'empresaQuitar') || btn('u-21', 'empresaQuitar').textContent.trim() !== 'Bloquear de nuevo') fail('empresa: toda fila quitada debe ofrecer Quitar rotulado «Bloquear de nuevo» (docs/17 sección 10), incluso sin bloqueo de Auth pendiente');
  if (/danger/.test(btn('u-21', 'empresaQuitar').className)) fail('empresa: «Bloquear de nuevo» debe ser un botón secundario, no el estilo de baja');
  if (!btn('u-20', 'empresaReponer') || /primary/.test(btn('u-20', 'empresaReponer').className)) fail('empresa: Reponer acceso debe ser un botón secundario (un solo primario por pantalla)');
  if (!($('#emp-user-form').compareDocumentPosition($('#tbody-empresa-usuarios')) & 4)) fail('empresa: el formulario Nuevo usuario debe ir arriba de la lista');
  if (!fila('u-1') || fila('u-1').textContent.indexOf('Sesión actual') === -1) fail('empresa: la fila propia no se marca como sesión actual');
  var opciones = all('#emp-user-sucursal option');
  if (opciones.length !== 4) fail('empresa: el campo Sucursal debe tener Elegir sucursal + 2 sucursales + Toda la empresa, hay ' + opciones.length);
  if ($('label[for="emp-user-sucursal"]').textContent !== 'Sucursal') fail('empresa: el campo se llama «Sucursal», no ' + $('label[for="emp-user-sucursal"]').textContent);
  if ($('#emp-user-sucursal').value !== '' || opciones[0].textContent !== 'Elegir sucursal') fail('empresa: el campo Sucursal debe empezar en «Elegir sucursal» (vacío)');
  if (opciones[opciones.length - 1].textContent !== 'Toda la empresa') fail('empresa: «Toda la empresa» debe ser una opción explícita');

  // Sin email: el foco vuelve al campo email
  $('#emp-user-email').value = ''; $('#emp-user-form').requestSubmit(); await sleep(150);
  if (d.activeElement !== $('#emp-user-email')) fail('empresa: sin email el foco no va al campo email');

  // Solo el email + Enter NO crea el usuario (antes quedaba con acceso a toda la empresa)
  var n1 = fx.llamadas.length;
  $('#emp-user-email').value = 'sinsuc@demo.test';
  $('#emp-user-form').requestSubmit(); await sleep(200);
  if (fx.llamadas.length !== n1) fail('empresa: el alta sin elegir sucursal llegó a la función');
  if ($('#emp-user-error').textContent.indexOf('Elegir la sucursal') === -1) fail('empresa: sin mensaje al faltar la sucursal: ' + $('#emp-user-error').textContent);

  // Alta por Enter (submit del formulario): sin contraseña = invitación; alcance toda la empresa, elegido explícitamente
  $('#emp-user-email').value = 'nuevo@demo.test';
  $('#emp-user-sucursal').value = 'empresa';
  $('#emp-user-form').requestSubmit(); await sleep(500);
  var alta = fx.llamadas.filter(function (c) { return c.fn === 'crear-usuario-seccional'; }).pop();
  if (!alta || alta.body.email !== 'nuevo@demo.test' || alta.body.cliente_id !== 1 || alta.body.sucursal_id != null) fail('empresa: alta incorrecta ' + JSON.stringify(alta));
  if (!fila('u-31')) fail('empresa: la lista no mostró al usuario creado');
  if ($('#emp-user-email').value !== '') fail('empresa: el formulario no se vació');
  if (d.activeElement !== $('#emp-user-email')) fail('empresa: tras el alta el foco debe volver al email (siguiente alta sin clics), está en ' + (d.activeElement && (d.activeElement.id || d.activeElement.tagName)));
  if ($('#emp-user-sucursal').value === 'empresa') fail('empresa: tras crear con «Toda la empresa» el campo conserva «empresa» (el siguiente email + Enter daría acceso a toda la empresa)');
  // Alta en una sucursal concreta
  $('#emp-user-email').value = 'enclave@demo.test'; $('#emp-user-sucursal').value = '2';
  $('#emp-user-form').requestSubmit(); await sleep(500);
  var altaSuc = fx.llamadas.filter(function (c) { return c.fn === 'crear-usuario-seccional'; }).pop();
  if (!altaSuc || altaSuc.body.email !== 'enclave@demo.test' || altaSuc.body.sucursal_id !== 2) fail('empresa: alta en sucursal incorrecta ' + JSON.stringify(altaSuc));
  // 409 acceso_quitado: remite a Reponer acceso
  $('#emp-user-sucursal').value = 'empresa';
  $('#emp-user-email').value = 'dup@demo.test';
  $('#emp-user-form').requestSubmit(); await sleep(400);
  if ($('#emp-user-error').textContent.indexOf('Reponer acceso') === -1) fail('empresa: 409 acceso_quitado sin remitir a Reponer acceso: ' + $('#emp-user-error').textContent);
  // Contraseña corta: validación local, sin llamada
  var n0 = fx.llamadas.length;
  $('#emp-user-email').value = 'corta@demo.test'; $('#emp-user-sucursal').value = 'empresa'; $('#emp-user-password').value = 'abc';
  $('#emp-user-form').requestSubmit(); await sleep(150);
  if (fx.llamadas.length !== n0) fail('empresa: contraseña corta llegó a la función');
  $('#emp-user-email').value = ''; $('#emp-user-password').value = '';

  // Quitar con confirmación y Reponer sin diálogo
  btn('u-5', 'empresaQuitar').click(); await confirmar();
  var q = fx.llamadas.filter(function (c) { return c.fn === 'quitar-acceso-usuario'; }).pop();
  if (!q || q.body.user_id !== 'u-5' || 'acceso_id' in q.body) fail('empresa: cuerpo de quitar ' + JSON.stringify(q));
  if (fila('u-5').dataset.estado !== 'quitado') fail('empresa: u-5 no figura quitado');
  btn('u-5', 'empresaReponer').click(); await sleep(400);
  if ($('#modal-confirm').classList.contains('show')) fail('empresa: reponer no debe pedir confirmación');
  if (fila('u-5').dataset.estado !== 'vigente') fail('empresa: u-5 no volvió a vigente');
  // Cancelar el diálogo no llama a la función
  n0 = fx.llamadas.length;
  btn('u-5', 'empresaQuitar').click(); await esperar(function () { return $('#modal-confirm').classList.contains('show'); }, 'diálogo');
  $('#confirm-cancel').click(); await sleep(200);
  if (fx.llamadas.length !== n0) fail('empresa: cancelar la confirmación igual quitó el acceso');

  // Carreras en 200
  fx.cola.push({ status: 200, body: { ok: true, estado: 'repuesto_durante_baja' }, efecto: null });
  btn('u-9', 'empresaQuitar').click(); await confirmar();
  if (!/repuso/.test(toast())) fail('empresa: repuesto_durante_baja sin aviso: ' + toast());
  if (fila('u-9').dataset.estado !== 'vigente') fail('empresa: repuesto_durante_baja debe dejar vigente');
  // 502 bloqueo_auth_pendiente al quitar: la baja quedó; la fila ofrece Quitar (reintento sin diálogo) y muestra el error
  fx.cola.push({ status: 502, body: { ok: false, codigo: 'bloqueo_auth_pendiente', acceso_cortado: true, acceso_id: 77, error: 'Falta bloquear en Auth' }, efecto: 'quitado' });
  btn('u-9', 'empresaQuitar').click(); await confirmar();
  if (fila('u-9').textContent.indexOf('Falta bloquear en Auth') === -1) fail('empresa: bloqueo_auth_pendiente sin mensaje en la fila');
  if (!btn('u-9', 'empresaQuitar')) fail('empresa: bloqueo_auth_pendiente sin Quitar');
  n0 = fx.llamadas.length;
  btn('u-9', 'empresaQuitar').click(); await sleep(400);
  if ($('#modal-confirm').classList.contains('show')) fail('empresa: el reintento de una baja pidió confirmación');
  var rq = fx.llamadas.slice(n0).pop();
  if (!rq || rq.fn !== 'quitar-acceso-usuario' || typeof rq.body.acceso_id !== 'number') fail('empresa: el reintento no lleva acceso_id ' + JSON.stringify(rq));
  // quitado_durante_reposicion (200)
  fx.cola.push({ status: 200, body: { ok: true, estado: 'quitado_durante_reposicion' }, efecto: null });
  btn('u-9', 'empresaReponer').click(); await sleep(400);
  if (!/quitó/.test(toast())) fail('empresa: quitado_durante_reposicion sin aviso: ' + toast());
  // 400 elegir_sucursal: ofrece elegir sucursal y repone allí
  fx.cola.push({ status: 400, body: { ok: false, codigo: 'elegir_sucursal', error: 'La sucursal original ya no existe' }, efecto: null });
  btn('u-21', 'empresaReponer').click(); await sleep(400);
  if (!$('#emp-suc-u-21') || !btn('u-21', 'empresaReponerEn')) fail('empresa: elegir_sucursal sin selector');
  else {
    $('#emp-suc-u-21').value = '1'; btn('u-21', 'empresaReponerEn').click(); await sleep(400);
    var rp = fx.llamadas.filter(function (c) { return c.fn === 'reponer-acceso-usuario'; }).pop();
    if (!rp || rp.body.acceso_id !== 10 || rp.body.sucursal_id !== 1) fail('empresa: reponer en sucursal ' + JSON.stringify(rp));
    if (fila('u-21').dataset.estado !== 'vigente') fail('empresa: u-21 no quedó vigente');
  }
  // 502 desbloqueo_auth_pendiente al reponer: el perfil volvió; se ofrece Reponer acceso (no una baja nueva)
  fx.cola.push({ status: 502, body: { ok: false, codigo: 'desbloqueo_auth_pendiente', acceso_repuesto: true, acceso_cortado: false, acceso_id: 9, error: 'Falta desbloquear en Auth' }, efecto: 'vigente' });
  btn('u-20', 'empresaReponer').click(); await sleep(400);
  if (fila('u-20').textContent.indexOf('Falta desbloquear en Auth') === -1) fail('empresa: desbloqueo_auth_pendiente sin mensaje');
  if (!btn('u-20', 'empresaReponer')) fail('empresa: desbloqueo_auth_pendiente sin Reponer acceso');
  n0 = fx.llamadas.length;
  btn('u-20', 'empresaReponer').click(); await sleep(400);
  rp = fx.llamadas.slice(n0).pop();
  if (!rp || rp.fn !== 'reponer-acceso-usuario' || rp.body.acceso_id !== 9) fail('empresa: el reintento de reponer ' + JSON.stringify(rp));
  // 502 estado_no_confirmado, 403 recargar_lista y 409 no_converge: no afirman estado; ofrecen Actualizar lista
  var casos = [
    [502, { ok: false, codigo: 'estado_no_confirmado', error: 'No se pudo leer el estado' }],
    [403, { ok: false, codigo: 'recargar_lista', error: 'x' }],
    [409, { ok: false, codigo: 'no_converge', error: 'x' }]
  ];
  for (var i = 0; i < casos.length; i++) {
    fx.cola.push({ status: casos[i][0], body: casos[i][1], efecto: null });
    btn('u-5', 'empresaQuitar').click(); await confirmar();
    if (!btn('u-5', 'empresaActualizar')) fail('empresa: ' + casos[i][1].codigo + ' sin Actualizar lista');
    if (fila('u-5').dataset.estado !== 'vigente') fail('empresa: ' + casos[i][1].codigo + ' afirmó un estado');
    btn('u-5', 'empresaActualizar').click(); await sleep(300);
    if (btn('u-5', 'empresaActualizar')) fail('empresa: Actualizar lista no limpió la fila');
  }

  // Bloqueante 1: reponer en fila quitada y otra persona quitó entretanto (502 bloqueo_auth_pendiente, sin acceso_id):
  // no se ofrece Reponer (revertiría esa baja con un clic); sí Quitar y Actualizar lista
  btn('u-20', 'empresaQuitar').click(); await confirmar();
  if (fila('u-20').dataset.estado !== 'quitado') fail('empresa: u-20 no quedó quitado para el caso bloqueo pendiente');
  fx.cola.push({ status: 502, body: { ok: false, codigo: 'bloqueo_auth_pendiente', acceso_cortado: true, acceso_repuesto: false, error: 'Falta bloquear en Auth' }, efecto: null });
  btn('u-20', 'empresaReponer').click(); await sleep(400);
  if (btn('u-20', 'empresaReponer')) fail('empresa: bloqueo_auth_pendiente al reponer vuelve a ofrecer Reponer acceso');
  if (!btn('u-20', 'empresaQuitar') || !btn('u-20', 'empresaActualizar')) fail('empresa: bloqueo_auth_pendiente al reponer debe ofrecer Quitar y Actualizar lista');
  btn('u-20', 'empresaActualizar').click(); await sleep(300);
  if (!btn('u-20', 'empresaReponer')) fail('empresa: tras Actualizar lista la fila quitada vuelve a ofrecer Reponer');
  // Bloqueante 2: quitar y otra persona repuso entretanto (502 desbloqueo_auth_pendiente, con acceso_id): nunca Quitar, sí Reponer
  fx.cola.push({ status: 502, body: { ok: false, codigo: 'desbloqueo_auth_pendiente', acceso_repuesto: true, acceso_cortado: false, acceso_id: 55, error: 'Falta desbloquear en Auth' }, efecto: null });
  btn('u-5', 'empresaQuitar').click(); await confirmar();
  if (btn('u-5', 'empresaQuitar')) fail('empresa: desbloqueo_auth_pendiente al quitar sigue ofreciendo Quitar');
  if (!btn('u-5', 'empresaReponer')) fail('empresa: desbloqueo_auth_pendiente al quitar sin Reponer acceso');
  n0 = fx.llamadas.length;
  btn('u-5', 'empresaReponer').click(); await sleep(400);
  rp = fx.llamadas.slice(n0).pop();
  if (!rp || rp.fn !== 'reponer-acceso-usuario' || rp.body.acceso_id !== 55) fail('empresa: reintento de reponer tras desbloqueo pendiente ' + JSON.stringify(rp));
  if (!btn('u-5', 'empresaQuitar')) fail('empresa: resuelto el pendiente, la fila vigente debe volver a ofrecer Quitar');

  // 500 tras una RPC exitosa: la baja quedó hecha aunque la función falló; la vista relee la lista y no deja la fila desactualizada
  fx.cola.push({ status: 500, body: { ok: false, error: 'Error interno' }, efecto: 'quitado' });
  btn('u-5', 'empresaQuitar').click(); await confirmar();
  if (fila('u-5').dataset.estado !== 'quitado') fail('empresa: tras un 500 la fila no se actualizó desde la base');
  btn('u-5', 'empresaReponer').click(); await sleep(400);

  // Umbrales vía RPC alerta_configurar
  $('.nav-item[data-view="empresa-umbrales"]').click(); await sleep(500);
  if (all('#emp-umb-campos [data-umbral]').length !== 10) fail('empresa: faltan campos de umbrales');
  var grupos = {};
  Array.prototype.forEach.call(all('#emp-umb-campos .field'), function (f) {
    var key = Math.round(f.getBoundingClientRect().top);
    var inp = f.querySelector('input');
    if (inp) { grupos[key] = grupos[key] || []; grupos[key].push(inp.offsetTop); }
  });
  for (var k in grupos) {
    if (grupos[k].length > 1 && new Set(grupos[k]).size !== 1) fail('empresa: los inputs de umbrales no están alineados verticalmente');
  }
  // Solo los tres umbrales a la vista; el resto va en «Ajustes avanzados», cerrado al cargar
  // Se consulta cada vez: cada guardado repinta la vista y el elemento anterior queda desconectado
  var detAv = function () { return $('#emp-umb-campos details.umb-avanzados'); };
  if (!detAv() || detAv().open !== false) fail('empresa: Ajustes avanzados debe existir y cargar cerrado');
  if (!visible($('#eu-umbral_bajo_mm'))) fail('empresa: el umbral bajo no está a la vista');
  if (!$('#eu-alerta_histeresis_mm') || $('#eu-alerta_histeresis_mm').value !== '0,5') fail('empresa: la histéresis actual no se cargó');
  if (!$('#eu-caida_brusca_mm') || $('#eu-caida_brusca_mm').value !== '5') fail('empresa: la caída brusca actual no se cargó: ' + ($('#eu-caida_brusca_mm') && $('#eu-caida_brusca_mm').value));
  var ordenCampos = Array.prototype.slice.call(all('#emp-umb-campos [data-umbral]')).map(function (i) { return i.dataset.umbral; }).slice(0, 3).join(',');
  if (ordenCampos !== 'umbral_bajo_mm,umbral_critico_mm,umbral_retiro_mm') fail('empresa: los umbrales deben ir de mayor a menor: ' + ordenCampos);
  var textoUmb = $('#view-empresa-umbrales').textContent;
  if (/\((naranja|rojo)\)|[<"]/i.test(textoUmb.replace(/\s+/g, ' ')) ) fail('empresa: textos de umbrales fuera de la guía: ' + textoUmb.replace(/\s+/g, ' '));
  var upd0 = (w.__saludFx && w.__saludFx.updates.length) || 0;
  var valores = { umbral_bajo_mm: '9', umbral_critico_mm: '5', umbral_retiro_mm: '3', alerta_histeresis_mm: '1,2', dias_sin_medir_alerta: '30', irregularidad_mm: '2', direccion_aviso_mm: '7,5', direccion_limite_mm: '6,5', swap_km: '15000', caida_brusca_mm: '4,5' };
  var llenar = function () { Object.keys(valores).forEach(function (k) { $('#eu-' + k).value = valores[k]; }); };
  llenar();
  $('#emp-umb-form').requestSubmit(); await sleep(500);
  var cfg = fx.rpcs.filter(function (r) { return r.name === 'alerta_configurar'; }).pop();
  if (!cfg || cfg.args.p_cliente_id !== 1 || cfg.args.p_umbral_bajo_mm !== 9 || cfg.args.p_histeresis_mm !== 1.2) fail('empresa: alerta_configurar ' + JSON.stringify(cfg));
  if (!cfg || cfg.args.p_direccion_aviso_mm !== 7.5 || cfg.args.p_direccion_limite_mm !== 6.5 || cfg.args.p_swap_km !== 15000) fail('empresa: pasar atrás y swap no llegan a alerta_configurar ' + JSON.stringify(cfg));
  if (!cfg || cfg.args.p_caida_brusca_mm !== 4.5) fail('empresa: la caída brusca no llega a alerta_configurar ' + JSON.stringify(cfg));
  if (!/Umbrales actualizados/.test(toast())) fail('empresa: sin aviso al guardar umbrales: ' + toast());
  if (d.activeElement !== $('#emp-umb-guardar')) fail('empresa: tras guardar umbrales el foco debe volver a Guardar, está en ' + (d.activeElement && (d.activeElement.id || d.activeElement.tagName)));
  // Si el operario ya puso el foco en otro campo mientras guardaba, no se le quita (campo a la vista: el desplegable sigue cerrado)
  $('#eu-umbral_bajo_mm').focus(); $('#emp-umb-form').requestSubmit(); await sleep(500);
  if (d.activeElement !== $('#eu-umbral_bajo_mm')) fail('empresa: guardar umbrales le robó el foco al campo en uso: ' + (d.activeElement && (d.activeElement.id || d.activeElement.tagName)));
  if (detAv().open !== false) fail('empresa: guardar umbrales abrió Ajustes avanzados sin error');
  if (w.__saludFx && w.__saludFx.updates.length !== upd0) fail('empresa: guardó con UPDATE directo sobre clientes');
  var nCfg = fx.rpcs.length;
  $('#eu-umbral_bajo_mm').value = '2'; $('#emp-umb-form').requestSubmit(); await sleep(200);
  if (fx.rpcs.length !== nCfg || !$('#emp-umb-error').classList.contains('show')) fail('empresa: umbrales inválidos llegaron a la base o no se avisó');
  // Error en un campo avanzado: se abre el desplegable, se enfoca el campo y el error lo nombra
  llenar(); $('#eu-alerta_histeresis_mm').value = '5'; $('#emp-umb-form').requestSubmit(); await sleep(200);
  if (fx.rpcs.length !== nCfg || !/margen para cerrar la alerta/i.test($('#emp-umb-error').textContent)) fail('empresa: margen fuera de rango llegó a la base o no se avisó: ' + $('#emp-umb-error').textContent);
  if (detAv().open !== true) fail('empresa: el error en un campo avanzado no abrió Ajustes avanzados');
  if (d.activeElement !== $('#eu-alerta_histeresis_mm')) fail('empresa: el error en un campo avanzado no enfocó el campo: ' + (d.activeElement && (d.activeElement.id || d.activeElement.tagName)));
  llenar(); $('#eu-caida_brusca_mm').value = '31'; $('#emp-umb-form').requestSubmit(); await sleep(200);
  if (fx.rpcs.length !== nCfg || !/hasta 30/.test($('#emp-umb-error').textContent)) fail('empresa: caída brusca fuera de rango llegó a la base o no se avisó: ' + $('#emp-umb-error').textContent);
  llenar(); $('#eu-caida_brusca_mm').value = '0'; $('#emp-umb-form').requestSubmit(); await sleep(200);
  if (fx.rpcs.length !== nCfg || !/Caída brusca desde \(mm\)/.test($('#emp-umb-error').textContent)) fail('empresa: caída brusca en 0 llegó a la base o el error no nombra el campo: ' + $('#emp-umb-error').textContent);
  llenar(); fx.errAlerta = { code: '42501', message: 'denegado' };
  $('#emp-umb-form').requestSubmit(); await sleep(300);
  if ($('#emp-umb-error').textContent.indexOf('Sin permiso') === -1) fail('empresa: 42501 sin mensaje: ' + $('#emp-umb-error').textContent);
  fx.errAlerta = null;

  // Moneda de los costos (F8 ola 4): tarjeta aparte con su propio guardado; la RPC la registra el stub en __escrituras
  var escrMon = w.__escrituras;
  if (!$('#emp-moneda') || $('#emp-moneda').value !== 'USD') fail('empresa: la moneda del cliente no se cargó: ' + ($('#emp-moneda') && $('#emp-moneda').value));
  $('#emp-moneda').value = 'UYU';
  $('#emp-moneda-form').requestSubmit(); await sleep(400);
  var mon = escrMon.calls.filter(function (c) { return c.name === 'cliente_fijar_moneda'; }).pop();
  if (!mon || mon.args.p_cliente_id !== 1 || mon.args.p_moneda !== 'UYU') fail('empresa: cliente_fijar_moneda ' + JSON.stringify(mon));
  if (!/Moneda actualizada/.test(toast())) fail('empresa: sin aviso al guardar la moneda: ' + toast());
  var nMon = escrMon.calls.length;
  $('#emp-moneda').value = 'USD'; escrMon.error = { code: '42501', message: 'denegado' };
  $('#emp-moneda-form').requestSubmit(); await sleep(300);
  if ($('#emp-moneda-error').textContent.indexOf('Sin permiso para cambiar la moneda') === -1) fail('empresa: 42501 de la moneda sin mensaje: ' + $('#emp-moneda-error').textContent);
  escrMon.error = null;
  if (escrMon.calls.length !== nMon + 1) fail('empresa: el guardado de la moneda debe llamar una vez');
  // Dos clics seguidos: una sola RPC (guarda ocupado)
  var nMon2 = escrMon.calls.length;
  $('#emp-moneda').value = 'UYU';
  $('#emp-moneda-guardar').click(); $('#emp-moneda-guardar').click(); await sleep(400);
  if (escrMon.calls.length !== nMon2 + 1) fail('empresa: dos clics en Guardar moneda llamaron ' + (escrMon.calls.length - nMon2) + ' veces');
  // Umbrales y moneda guardados seguidos: las dos RPC salen
  var nCfg2 = fx.rpcs.filter(function (r) { return r.name === 'alerta_configurar'; }).length;
  llenar(); $('#emp-umb-form').requestSubmit(); $('#emp-moneda').value = 'USD'; $('#emp-moneda-form').requestSubmit(); await sleep(500);
  if (fx.rpcs.filter(function (r) { return r.name === 'alerta_configurar'; }).length !== nCfg2 + 1 || escrMon.calls.length !== nMon2 + 2) fail('empresa: umbrales y moneda seguidos no salieron las dos RPC');

  // Alertas: sin tarjeta de nivel crítico ni escritura de umbrales; solo un aviso hacia Empresa > Umbrales
  var nCfgAl = fx.rpcs.filter(function (r) { return r.name === 'alerta_configurar'; }).length;
  $('.nav-item[data-view="alertas"]').click(); await sleep(500);
  if (!$('#view-alertas').classList.contains('active')) fail('empresa: vista alertas no activa');
  if ($('#alert-config') || $('#alert-umbral') || $('[data-action="alertasGuardarConfig"]')) fail('empresa: Alertas conserva la tarjeta de nivel crítico');
  if (!visible($('#alert-umbral-aviso')) || !/Empresa > Umbrales/.test($('#alert-umbral-aviso').textContent)) fail('empresa: Alertas sin el aviso hacia Empresa > Umbrales');
  if (fx.rpcs.filter(function (r) { return r.name === 'alerta_configurar'; }).length !== nCfgAl) fail('empresa: Alertas llamó a alerta_configurar');

  // Dispositivos de la empresa se retiró (decisión del dueño): ni ítem de menú ni vista; forzar la ruta cae a Inicio.
  if (d.querySelector('.nav-item[data-view="empresa-dispositivos"]') || d.querySelector('#view-empresa-dispositivos')) fail('empresa: sigue existiendo empresa-dispositivos');
  var fz = d.createElement('button'); fz.setAttribute('data-action', 'irA'); fz.setAttribute('data-args', '["empresa-dispositivos"]'); d.body.appendChild(fz);
  fz.click(); await sleep(400); fz.remove();
  if (!$('#view-inicio').classList.contains('active') || d.querySelectorAll('.view.active').length !== 1) fail('empresa: irA("empresa-dispositivos") no cayó a Inicio');
  // Móvil (390 px): lo que se toca con el dedo mide al menos 44 px de alto (enlaces de Inicio, botones de Usuarios, menú)
  var marco = w.frameElement, anchoAntes = marco.style.width;
  marco.style.width = '390px'; await sleep(300);
  var chicos = function (sel) {
    return Array.prototype.filter.call(all(sel), function (e) { return e.getClientRects().length && e.getBoundingClientRect().height < 43.5; })
      .map(function (e) { return (e.id || e.className || e.tagName) + ' ' + Math.round(e.getBoundingClientRect().height) + 'px'; });
  };
  $('.nav-item[data-view="inicio"]').click(); await sleep(500);
  if (!all('#view-inicio .inicio-enlace').length) fail('empresa: Inicio sin enlaces para medir el tamaño táctil');
  var cI = chicos('#view-inicio .inicio-enlace, #view-inicio .btn, #view-inicio .alert-chip');
  if (cI.length) fail('móvil: objetivos táctiles de Inicio menores a 44 px: ' + cI.join(', '));
  $('.nav-item[data-view="empresa-usuarios"]').click(); await sleep(500);
  var cU = chicos('#view-empresa-usuarios .btn, #view-empresa-usuarios .icon-btn');
  if (!all('#view-empresa-usuarios .btn').length || cU.length) fail('móvil: botones de Usuarios menores a 44 px: ' + cU.join(', '));
  var cN = chicos('.nav-item');
  if (cN.length) fail('móvil: ítems del menú menores a 44 px: ' + cN.join(', '));
  marco.style.width = anchoAntes; await sleep(200);
  log.push('empresa: llamadas=' + fx.llamadas.length + ' rpcs=' + fx.rpcs.length);
};

window.empresaBloqueadaFlow = async function (w, d, sleep, fail, log, quien) {
  var fx = w.__empFx, $ = function (s) { return d.querySelector(s); };
  var oculto = function (el) { return !el || el.getClientRects().length === 0; };
  ['sucursales', 'empresa-usuarios', 'empresa-umbrales'].forEach(function (v) {
    if (!oculto($('.nav-item[data-view="' + v + '"]'))) fail('empresa(' + quien + '): el menú muestra ' + v);
  });
  if (quien === 'sucursal' && d.querySelector('#user-role').textContent !== 'Usuario de sucursal') fail('empresa(sucursal): rol mostrado: ' + d.querySelector('#user-role').textContent);
  if (quien === 'neumet' && d.querySelector('#user-role').textContent !== 'Equipo Neumet') fail('empresa(neumet): rol mostrado: ' + d.querySelector('#user-role').textContent);
  // Entrar a la fuerza (el botón está oculto, no ausente): el router redirige a Inicio sin llamar a la base
  ['empresa-usuarios', 'empresa-umbrales'].forEach(function (v) { var b = $('.nav-item[data-view="' + v + '"]'); if (b) b.click(); });
  await sleep(500);
  ['empresa-usuarios', 'empresa-umbrales'].forEach(function (v) {
    if ($('#view-' + v).classList.contains('active')) fail('empresa(' + quien + '): entró a ' + v);
  });
  // Defensa en profundidad: los botones «Actualizar» de las vistas de empresa (data-action al loader crudo) tampoco consultan
  var tu = $('#tbody-empresa-usuarios').innerHTML;
  ['loadEmpresaUsuarios', 'loadEmpresaUmbrales'].forEach(function (a) { var b = $('[data-action="' + a + '"]'); if (b) b.click(); });
  await sleep(500);
  if ($('#tbody-empresa-usuarios').innerHTML !== tu || $('#emp-umb-campos').innerHTML !== '') fail('empresa(' + quien + '): un loader de empresa cargó datos sin ser administrador de empresa');
  if (fx.rpcs.length || fx.llamadas.length) fail('empresa(' + quien + '): hubo llamadas a la base: ' + JSON.stringify(fx.rpcs.concat(fx.llamadas)));
  if (quien === 'sucursal') {
    // El usuario de sucursal tampoco ve Clientes ni Balance (siempre fue así)
    if (!oculto($('.nav-item[data-view="clientes"]')) || !oculto($('.nav-item[data-view="balance"]'))) fail('empresa(sucursal): ve Clientes o Balance');
  }
};
