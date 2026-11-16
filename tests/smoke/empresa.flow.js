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
  ['sucursales', 'empresa-usuarios', 'empresa-umbrales', 'empresa-dispositivos'].forEach(function (v) {
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
  if (!btn('u-20', 'empresaReponer') || !btn('u-20', 'empresaQuitar')) fail('empresa: la fila quitada debe ofrecer Reponer acceso y Quitar');
  if (btn('u-5', 'empresaQuitar').className.indexOf('icon-btn danger') === -1 || /(^| )btn( |$)/.test(btn('u-5', 'empresaQuitar').className)) fail('empresa: Quitar debe usar el estilo de baja del panel (icon-btn danger), no un botón rojo sólido: ' + btn('u-5', 'empresaQuitar').className);
  if (!btn('u-21', 'empresaQuitar')) fail('empresa: Quitar falta en una fila quitada sin bloqueo pendiente');
  if (!fila('u-1') || fila('u-1').textContent.indexOf('Sesión actual') === -1) fail('empresa: la fila propia no se marca como sesión actual');
  var opciones = all('#emp-user-sucursal option').length;
  if (opciones !== 3) fail('empresa: el alcance debe tener Toda la empresa + 2 sucursales, hay ' + opciones);

  // Alta por Enter (submit del formulario): sin contraseña = invitación; alcance toda la empresa
  $('#emp-user-email').value = 'nuevo@demo.test';
  $('#emp-user-form').requestSubmit(); await sleep(500);
  var alta = fx.llamadas.filter(function (c) { return c.fn === 'crear-usuario-seccional'; }).pop();
  if (!alta || alta.body.email !== 'nuevo@demo.test' || alta.body.cliente_id !== 1 || alta.body.sucursal_id != null) fail('empresa: alta incorrecta ' + JSON.stringify(alta));
  if (!fila('u-31')) fail('empresa: la lista no mostró al usuario creado');
  if ($('#emp-user-email').value !== '') fail('empresa: el formulario no se vació');
  // 409 acceso_quitado: remite a Reponer acceso
  $('#emp-user-email').value = 'dup@demo.test';
  $('#emp-user-form').requestSubmit(); await sleep(400);
  if ($('#emp-user-error').textContent.indexOf('Reponer acceso') === -1) fail('empresa: 409 acceso_quitado sin remitir a Reponer acceso: ' + $('#emp-user-error').textContent);
  // Contraseña corta: validación local, sin llamada
  var n0 = fx.llamadas.length;
  $('#emp-user-email').value = 'corta@demo.test'; $('#emp-user-password').value = 'abc';
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
  if (all('#emp-umb-campos [data-umbral]').length !== 6) fail('empresa: faltan campos de umbrales');
  if (!$('#eu-alerta_histeresis_mm') || $('#eu-alerta_histeresis_mm').value !== '0.5') fail('empresa: la histéresis actual no se cargó');
  var upd0 = (w.__saludFx && w.__saludFx.updates.length) || 0;
  var valores = { umbral_bajo_mm: '9', umbral_critico_mm: '5', umbral_retiro_mm: '3', alerta_histeresis_mm: '1,2', dias_sin_medir_alerta: '30', irregularidad_mm: '2' };
  var llenar = function () { Object.keys(valores).forEach(function (k) { $('#eu-' + k).value = valores[k]; }); };
  llenar();
  $('#emp-umb-form').requestSubmit(); await sleep(500);
  var cfg = fx.rpcs.filter(function (r) { return r.name === 'alerta_configurar'; }).pop();
  if (!cfg || cfg.args.p_cliente_id !== 1 || cfg.args.p_umbral_bajo_mm !== 9 || cfg.args.p_histeresis_mm !== 1.2) fail('empresa: alerta_configurar ' + JSON.stringify(cfg));
  if (!/Umbrales actualizados/.test(toast())) fail('empresa: sin aviso al guardar umbrales: ' + toast());
  if (w.__saludFx && w.__saludFx.updates.length !== upd0) fail('empresa: guardó con UPDATE directo sobre clientes');
  var nCfg = fx.rpcs.length;
  $('#eu-umbral_bajo_mm').value = '2'; $('#emp-umb-form').requestSubmit(); await sleep(200);
  if (fx.rpcs.length !== nCfg || !$('#emp-umb-error').classList.contains('show')) fail('empresa: umbrales inválidos llegaron a la base o no se avisó');
  llenar(); $('#eu-alerta_histeresis_mm').value = '3,5'; $('#emp-umb-form').requestSubmit(); await sleep(200);
  if (fx.rpcs.length !== nCfg || !/histéresis/i.test($('#emp-umb-error').textContent)) fail('empresa: histéresis fuera de rango llegó a la base o no se avisó: ' + $('#emp-umb-error').textContent);
  llenar(); fx.errAlerta = { code: '42501', message: 'denegado' };
  $('#emp-umb-form').requestSubmit(); await sleep(300);
  if ($('#emp-umb-error').textContent.indexOf('Sin permiso') === -1) fail('empresa: 42501 sin mensaje: ' + $('#emp-umb-error').textContent);
  fx.errAlerta = null;

  // Alertas: sin tarjeta de nivel crítico ni escritura de umbrales; solo un aviso hacia Empresa > Umbrales
  var nCfgAl = fx.rpcs.filter(function (r) { return r.name === 'alerta_configurar'; }).length;
  $('.nav-item[data-view="alertas"]').click(); await sleep(500);
  if (!$('#view-alertas').classList.contains('active')) fail('empresa: vista alertas no activa');
  if ($('#alert-config') || $('#alert-umbral') || $('[data-action="alertasGuardarConfig"]')) fail('empresa: Alertas conserva la tarjeta de nivel crítico');
  if (!visible($('#alert-umbral-aviso')) || !/Empresa > Umbrales/.test($('#alert-umbral-aviso').textContent)) fail('empresa: Alertas sin el aviso hacia Empresa > Umbrales');
  if (fx.rpcs.filter(function (r) { return r.name === 'alerta_configurar'; }).length !== nCfgAl) fail('empresa: Alertas llamó a alerta_configurar');

  // Dispositivos: solo lectura
  $('.nav-item[data-view="empresa-dispositivos"]').click(); await sleep(500);
  if (all('#tbody-empresa-dispositivos tr[data-estado]').length !== 2) fail('empresa: se esperaban 2 dispositivos del cliente 1, hay ' + all('#tbody-empresa-dispositivos tr[data-estado]').length);
  var acc = all('#view-empresa-dispositivos button, #view-empresa-dispositivos input, #view-empresa-dispositivos select');
  for (var k = 0; k < acc.length; k++) if (acc[k].dataset.action !== 'loadEmpresaDispositivos') fail('empresa: dispositivos no es de solo lectura: ' + acc[k].outerHTML.slice(0, 80));
  log.push('empresa: llamadas=' + fx.llamadas.length + ' rpcs=' + fx.rpcs.length);
};

window.empresaBloqueadaFlow = async function (w, d, sleep, fail, log, quien) {
  var fx = w.__empFx, $ = function (s) { return d.querySelector(s); };
  var oculto = function (el) { return !el || el.getClientRects().length === 0; };
  ['sucursales', 'empresa-usuarios', 'empresa-umbrales', 'empresa-dispositivos'].forEach(function (v) {
    if (!oculto($('.nav-item[data-view="' + v + '"]'))) fail('empresa(' + quien + '): el menú muestra ' + v);
  });
  if (quien === 'sucursal' && d.querySelector('#user-role').textContent !== 'Usuario de sucursal') fail('empresa(sucursal): rol mostrado: ' + d.querySelector('#user-role').textContent);
  if (quien === 'neumet' && d.querySelector('#user-role').textContent !== 'Equipo Neumet') fail('empresa(neumet): rol mostrado: ' + d.querySelector('#user-role').textContent);
  // Entrar a la fuerza (el botón está oculto, no ausente): el router redirige a Inicio sin llamar a la base
  ['empresa-usuarios', 'empresa-umbrales', 'empresa-dispositivos'].forEach(function (v) { var b = $('.nav-item[data-view="' + v + '"]'); if (b) b.click(); });
  await sleep(500);
  ['empresa-usuarios', 'empresa-umbrales', 'empresa-dispositivos'].forEach(function (v) {
    if ($('#view-' + v).classList.contains('active')) fail('empresa(' + quien + '): entró a ' + v);
  });
  // Defensa en profundidad: los botones «Actualizar» de las vistas de empresa (data-action al loader crudo) tampoco consultan
  var tb = $('#tbody-empresa-dispositivos').innerHTML, tu = $('#tbody-empresa-usuarios').innerHTML;
  ['loadEmpresaUsuarios', 'loadEmpresaUmbrales', 'loadEmpresaDispositivos'].forEach(function (a) { var b = $('[data-action="' + a + '"]'); if (b) b.click(); });
  await sleep(500);
  if ($('#tbody-empresa-dispositivos').innerHTML !== tb || $('#tbody-empresa-usuarios').innerHTML !== tu || $('#emp-umb-campos').innerHTML !== '') fail('empresa(' + quien + '): un loader de empresa cargó datos sin ser administrador de empresa');
  if (fx.rpcs.length || fx.llamadas.length) fail('empresa(' + quien + '): hubo llamadas a la base: ' + JSON.stringify(fx.rpcs.concat(fx.llamadas)));
  if (quien === 'sucursal') {
    // El usuario de sucursal tampoco ve Clientes ni Balance (siempre fue así)
    if (!oculto($('.nav-item[data-view="clientes"]')) || !oculto($('.nav-item[data-view="balance"]'))) fail('empresa(sucursal): ve Clientes o Balance');
  }
};
