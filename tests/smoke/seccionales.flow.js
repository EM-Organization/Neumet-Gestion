// Recorridos de humo de seccionales (datos simulados por seccionales.fixture.js + flota.fixture.js).
//   window.seccionalesAdminFlow(w, d, sleep, fail, log)    ABM en la ficha de cliente (admin)
//   window.seccionalesClienteFlow(w, d, sleep, fail, log)  selector de seccional (perfil global)
//   window.seccionalesUsuarioFlow(w, d, sleep, fail, log)  perfil de seccional: sin selector
window.seccionalesAdminFlow = async function(w, d, sleep, fail, log){
  var fx = w.__secFx, $ = function(s){ return d.querySelector(s); }, all = function(s){ return d.querySelectorAll(s); };
  var toast = function(){ return $('#toast-msg').textContent; };
  var setSel = function(el, v){ el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  var lista = function(){ return all('#sec-lista tr[data-sucursal]').length; };
  $('.nav-item[data-view="ficha"]').click(); await sleep(700);
  if (!$('#view-ficha').classList.contains('active')) { fail('seccionales: ficha no activa'); return; }
  if (!$('#ficha-seccionales') || $('#ficha-seccionales').style.display === 'none') { fail('seccionales: falta la tarjeta del ABM'); return; }
  if (lista() !== 2) fail('seccionales: se esperaban 2 seccionales del cliente 1, hay ' + lista());
  if (d.body.innerHTML.indexOf('<Norte>') !== -1) fail('seccionales: nombre sin escapar');
  if (all('#sec-vehiculos select').length < 1) fail('seccionales: sin selects de vehículos');

  // Asignar un vehículo a una seccional
  var selVeh = $('#sec-vehiculos select');
  setSel(selVeh, '1'); await sleep(300);
  var up = fx.updates.filter(function(u){ return u.table === 'vehiculos'; }).pop();
  if (!up || up.patch.sucursal_id !== 1) fail('seccionales: no asignó el vehículo a la seccional 1');
  setSel($('#sec-vehiculos select'), ''); await sleep(300);
  up = fx.updates.filter(function(u){ return u.table === 'vehiculos'; }).pop();
  if (!up || up.patch.sucursal_id !== null) fail('seccionales: no quitó la seccional del vehículo');
  var upd = $('#sec-dispositivos select');
  if (upd) { setSel(upd, '2'); await sleep(300); if (!fx.updates.some(function(u){ return u.table === 'dispositivos' && u.patch.sucursal_id === 2; })) fail('seccionales: no asignó el dispositivo'); }

  // Alta (con validación de nombre vacío)
  $('#sec-nombre').value = '  '; $('[data-action="seccionalCrear"]').click(); await sleep(100);
  if ($('#sec-error').textContent.indexOf('nombre') === -1) fail('seccionales: falta validación de nombre vacío');
  $('#sec-nombre').value = 'Rivera'; $('[data-action="seccionalCrear"]').click(); await sleep(300);
  var ins = fx.inserts.filter(function(i){ return i.table === 'sucursales'; }).pop();
  if (!ins || ins.row.nombre !== 'Rivera' || ins.row.cliente_id !== 1) fail('seccionales: alta incorrecta');
  if (lista() !== 3) fail('seccionales: la lista no creció tras el alta (' + lista() + ')');

  // Renombrar
  $('#sec-n-1').value = 'Montevideo Centro'; $('#sec-lista tr[data-sucursal="1"] [data-action="seccionalRenombrar"]').click(); await sleep(300);
  var ren = fx.updates.filter(function(u){ return u.table === 'sucursales'; }).pop();
  if (!ren || ren.patch.nombre !== 'Montevideo Centro') fail('seccionales: renombrar incorrecto');

  // Eliminar: la seccional 2 tiene vehículos => la base la rechaza y se explica
  $('#sec-lista tr[data-sucursal="2"] [data-action="seccionalEliminar"]').click(); await sleep(150);
  $('#confirm-ok').click(); await sleep(300);
  if (toast().indexOf('reasígnalos') === -1) fail('seccionales: falta mensaje de seccional con datos: ' + toast());
  if (lista() !== 3) fail('seccionales: se borró una seccional rechazada');
  // Eliminar una vacía (la recién creada)
  var nueva = all('#sec-lista tr[data-sucursal]')[2];
  nueva.querySelector('[data-action="seccionalEliminar"]').click(); await sleep(150);
  $('#confirm-ok').click(); await sleep(300);
  if (lista() !== 2) fail('seccionales: no eliminó la seccional vacía (' + lista() + ')');

  // Crear usuarios con la función crear-usuario-seccional
  var n = fx.fetches.length;
  $('#sec-user-email').value = 'nuevo@demo.test'; setSel($('#sec-user-sucursal'), '2'); $('#sec-user-password').value = '';
  $('#sec-user-crear').click(); await sleep(300);
  var f = fx.fetches[fx.fetches.length - 1];
  if (fx.fetches.length !== n + 1 || f.cliente_id !== 1 || f.sucursal_id !== 2 || 'password' in f) fail('seccionales: alta de usuario sin password incorrecta: ' + JSON.stringify(f));
  if (toast().indexOf('Invitación') === -1) fail('seccionales: falta aviso de invitación: ' + toast());
  n = fx.fetches.length;
  $('#sec-user-email').value = 'corta@demo.test'; $('#sec-user-password').value = 'abc12345678'; $('#sec-user-crear').click(); await sleep(150);
  if (fx.fetches.length !== n) fail('seccionales: contraseña corta llegó al servidor');
  if ($('#sec-error').textContent.indexOf('12 caracteres') === -1) fail('seccionales: falta mensaje de 12 caracteres');
  setSel($('#sec-user-sucursal'), ''); $('#sec-user-email').value = 'global2@demo.test'; $('#sec-user-password').value = 'abcdefghijkl'; $('#sec-user-crear').click(); await sleep(300);
  f = fx.fetches[fx.fetches.length - 1];
  if (!f || 'sucursal_id' in f || f.password !== 'abcdefghijkl') fail('seccionales: alta de usuario global incorrecta: ' + JSON.stringify(f));
  $('#sec-user-email').value = 'dup@demo.test'; $('#sec-user-password').value = ''; $('#sec-user-crear').click(); await sleep(300);
  if (toast().indexOf('Ya existe') === -1) fail('seccionales: 409 sin mensaje: ' + toast());
  if (all('#sec-usuarios tr').length < 4) fail('seccionales: la tabla de usuarios no muestra los nuevos');
  log.push('seccionales-admin: updates=' + fx.updates.length + ' inserts=' + fx.inserts.length + ' fetches=' + fx.fetches.length);
};

window.seccionalesClienteFlow = async function(w, d, sleep, fail, log){
  var fx = w.__secFx, $ = function(s){ return d.querySelector(s); }, all = function(s){ return d.querySelectorAll(s); };
  var setSel = function(id, v){ var el = $(id); el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  var nav = function(v){ $('.nav-item[data-view="' + v + '"]').click(); return sleep(500); };
  var sel = $('#sec-selector');
  if (!sel || sel.style.display === 'none') { fail('selector: no aparece para el perfil global'); return; }
  var ops = all('#sec-select option');
  if (ops.length !== 3) fail('selector: se esperaban 3 opciones (todas + 2), hay ' + ops.length);
  if (d.body.innerHTML.indexOf('<Norte>') !== -1) fail('selector: nombre de seccional sin escapar');

  await nav('flota');
  var cards = function(){ return all('#flota-grid .flota-card'); };
  var kp = function(){ return Array.prototype.map.call(all('#flota-kpis .dash-kpi-val'), function(k){ return k.textContent; }).join(','); };
  if (cards().length !== 4) fail('selector: sin filtro se esperaban 4 vehículos en Flota, hay ' + cards().length);
  setSel('#sec-select', '1'); await sleep(500);
  if (cards().length !== 1 || cards()[0].dataset.vehiculo !== '10') fail('selector: Flota/Montevideo debía mostrar solo el vehículo 10, hay ' + cards().length);
  if (kp() !== '1,0,0,0') fail('selector: KPIs de Montevideo inesperados: ' + kp());
  setSel('#sec-select', '2'); await sleep(500);
  if (cards().length !== 1 || cards()[0].dataset.vehiculo !== '12') fail('selector: Flota/Salto debía mostrar solo el vehículo 12');
  if (kp() !== '1,1,1,2') fail('selector: KPIs de Salto inesperados: ' + kp());

  await nav('alertas');   // la selección (Salto) persiste entre vistas
  var rows = function(){ return all('#alert-tbody tr[data-severidad]'); };
  if (rows().length !== 2) fail('selector: Alertas/Salto debía tener 2 filas, hay ' + rows().length);
  setSel('#sec-select', '1'); await sleep(500);
  if (rows().length !== 0) fail('selector: Alertas/Montevideo debía estar vacía, hay ' + rows().length);
  setSel('#sec-select', ''); await sleep(500);
  if (rows().length !== 4) fail('selector: Alertas/Todas debía tener 4 filas, hay ' + rows().length);

  // Inicio y Reportes consultan con el filtro de seccional en el servidor
  fx.vehEqs.length = 0;
  setSel('#sec-select', '2');
  await nav('inicio'); await sleep(300);
  if (fx.vehEqs.indexOf('vehiculos:2') === -1) fail('selector: Inicio no filtró por sucursal_id: ' + fx.vehEqs.join(','));
  if ($('#inicio-subtitle').textContent.indexOf('Salto') === -1) fail('selector: Inicio no indica la seccional');
  fx.vehEqs.length = 0;
  await nav('reportes'); await sleep(300);
  if (fx.vehEqs.indexOf('vehiculos:2') === -1) fail('selector: Reportes no filtró vehículos por sucursal_id');
  setSel('#sec-select', ''); await sleep(300);
  log.push('selector-flow: ok, vehEqs=' + fx.vehEqs.join(','));
};

window.seccionalesUsuarioFlow = async function(w, d, sleep, fail, log){
  var sel = d.querySelector('#sec-selector');
  if (sel && sel.style.display !== 'none') fail('seccional: el selector no debe verse para un perfil de seccional');
  if (d.querySelector('#user-role').textContent !== 'Seccional') fail('seccional: rol mostrado incorrecto: ' + d.querySelector('#user-role').textContent);
  d.querySelector('.nav-item[data-view="flota"]').click(); await sleep(500);
  if (d.querySelectorAll('#flota-grid .flota-card').length < 1) fail('seccional: Flota vacía');
  log.push('seccional-usuario-flow: ok');
};
