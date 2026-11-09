// Recorridos de humo de sucursales (datos simulados por sucursales.fixture.js + flota.fixture.js).
//   window.seccionalesAdminFlow(w, d, sleep, fail, log)    ABM en la ficha de cliente (admin)
//   window.seccionalesClienteFlow(w, d, sleep, fail, log)  selector de sucursal (perfil global)
//   window.seccionalesUsuarioFlow(w, d, sleep, fail, log)  perfil de sucursal: sin selector
window.seccionalesAdminFlow = async function(w, d, sleep, fail, log){
  var fx = w.__secFx, $ = function(s){ return d.querySelector(s); }, all = function(s){ return d.querySelectorAll(s); };
  var toast = function(){ return $('#toast-msg').textContent; };
  var setSel = function(el, v){ el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  var lista = function(){ return all('#sec-lista tr[data-sucursal]').length; };
  $('.nav-item[data-view="clientes"]').click(); await sleep(500); $('#tbody-clientes [data-action="abrirFichaCliente"]').click(); await sleep(700);
  if (!$('#view-ficha').classList.contains('active')) { fail('sucursales: ficha no activa'); return; }
  if (!$('#ficha-seccionales') || $('#ficha-seccionales').style.display === 'none') { fail('sucursales: falta la tarjeta del ABM'); return; }
  if (lista() !== 2) fail('sucursales: se esperaban 2 sucursales del cliente 1, hay ' + lista());
  if (d.body.innerHTML.indexOf('<Norte>') !== -1) fail('sucursales: nombre sin escapar');
  if (all('#sec-vehiculos select').length < 1) fail('sucursales: sin selects de vehículos');

  // Asignar un vehículo a una sucursal
  var selVeh = $('#sec-vehiculos select');
  setSel(selVeh, '1'); await sleep(300);
  var up = fx.updates.filter(function(u){ return u.table === 'vehiculos'; }).pop();
  if (!up || up.patch.sucursal_id !== 1) fail('sucursales: no asignó el vehículo a la sucursal 1');
  setSel($('#sec-vehiculos select'), ''); await sleep(300);
  up = fx.updates.filter(function(u){ return u.table === 'vehiculos'; }).pop();
  if (!up || up.patch.sucursal_id !== null) fail('sucursales: no quitó la sucursal del vehículo');
  var upd = $('#sec-dispositivos select');
  if (upd) { setSel(upd, '2'); await sleep(300); if (!fx.updates.some(function(u){ return u.table === 'dispositivos' && u.patch.sucursal_id === 2; })) fail('sucursales: no asignó el dispositivo'); }

  // Alta (con validación de nombre vacío)
  $('#sec-nombre').value = '  '; $('[data-action="seccionalCrear"]').click(); await sleep(100);
  if ($('#sec-error').textContent.indexOf('nombre') === -1) fail('sucursales: falta validación de nombre vacío');
  $('#sec-nombre').value = 'Rivera'; $('[data-action="seccionalCrear"]').click(); await sleep(300);
  var ins = fx.inserts.filter(function(i){ return i.table === 'sucursales'; }).pop();
  if (!ins || ins.row.nombre !== 'Rivera' || ins.row.cliente_id !== 1) fail('sucursales: alta incorrecta');
  if (lista() !== 3) fail('sucursales: la lista no creció tras el alta (' + lista() + ')');

  // Renombrar
  $('#sec-n-1').value = 'Montevideo Centro'; $('#sec-lista tr[data-sucursal="1"] [data-action="seccionalRenombrar"]').click(); await sleep(300);
  var ren = fx.updates.filter(function(u){ return u.table === 'sucursales'; }).pop();
  if (!ren || ren.patch.nombre !== 'Montevideo Centro') fail('sucursales: renombrar incorrecto');

  // Eliminar: la sucursal 2 tiene vehículos => la base la rechaza y se explica
  $('#sec-lista tr[data-sucursal="2"] [data-action="seccionalEliminar"]').click(); await sleep(150);
  $('#confirm-ok').click(); await sleep(300);
  if (toast().indexOf('reasígnalos') === -1) fail('sucursales: falta mensaje de sucursal con datos: ' + toast());
  if (lista() !== 3) fail('sucursales: se borró una sucursal rechazada');
  // Eliminar una vacía (la recién creada)
  var nueva = all('#sec-lista tr[data-sucursal]')[2];
  nueva.querySelector('[data-action="seccionalEliminar"]').click(); await sleep(150);
  $('#confirm-ok').click(); await sleep(300);
  if (lista() !== 2) fail('sucursales: no eliminó la sucursal vacía (' + lista() + ')');

  // Crear usuarios con la función crear-usuario-seccional
  var n = fx.fetches.length;
  $('#sec-user-email').value = 'nuevo@demo.test'; setSel($('#sec-user-sucursal'), '2'); $('#sec-user-password').value = '';
  $('#sec-user-crear').click(); await sleep(300);
  var f = fx.fetches[fx.fetches.length - 1];
  if (fx.fetches.length !== n + 1 || f.cliente_id !== 1 || f.sucursal_id !== 2 || 'password' in f) fail('sucursales: alta de usuario sin password incorrecta: ' + JSON.stringify(f));
  if (toast().indexOf('Invitación') === -1) fail('sucursales: falta aviso de invitación: ' + toast());
  n = fx.fetches.length;
  $('#sec-user-email').value = 'corta@demo.test'; $('#sec-user-password').value = 'abc12345678'; $('#sec-user-crear').click(); await sleep(150);
  if (fx.fetches.length !== n) fail('sucursales: contraseña corta llegó al servidor');
  if ($('#sec-error').textContent.indexOf('12 caracteres') === -1) fail('sucursales: falta mensaje de 12 caracteres');
  setSel($('#sec-user-sucursal'), ''); $('#sec-user-email').value = 'global2@demo.test'; $('#sec-user-password').value = 'abcdefghijkl'; $('#sec-user-crear').click(); await sleep(300);
  f = fx.fetches[fx.fetches.length - 1];
  if (!f || 'sucursal_id' in f || f.password !== 'abcdefghijkl') fail('sucursales: alta de usuario global incorrecta: ' + JSON.stringify(f));
  $('#sec-user-email').value = 'dup@demo.test'; $('#sec-user-password').value = ''; $('#sec-user-crear').click(); await sleep(300);
  if (toast().indexOf('Ya existe') === -1) fail('sucursales: 409 sin mensaje: ' + toast());
  if (all('#sec-usuarios tr').length < 4) fail('sucursales: la tabla de usuarios no muestra los nuevos');
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
  if (d.body.innerHTML.indexOf('<Norte>') !== -1) fail('selector: nombre de sucursal sin escapar');

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

  // Inicio y Reportes consultan con el filtro de sucursal en el servidor
  fx.vehEqs.length = 0;
  setSel('#sec-select', '2');
  await nav('inicio'); await sleep(300);
  if (fx.vehEqs.indexOf('vehiculos:2') === -1) fail('selector: Inicio no filtró por sucursal_id: ' + fx.vehEqs.join(','));
  if ($('#inicio-subtitle').textContent.indexOf('Salto') === -1) fail('selector: Inicio no indica la sucursal');
  fx.vehEqs.length = 0;
  await nav('reportes'); await sleep(300);
  if (fx.vehEqs.indexOf('vehiculos:2') === -1) fail('selector: Reportes no filtró vehículos por sucursal_id');
  // Costo por km (cpk_por_grupo): visible para el perfil global, con muestra baja y sin CPK inventado
  var cpkT = d.querySelector('#rep-cpk-tabla');
  if (d.querySelector('#rep-cpk-card').hidden || !cpkT.querySelector('table')) fail('reportes: sin la tabla Costo por km para el perfil global');
  var cpkTxt = cpkT.textContent.replace(/\s+/g, ' ');
  if (cpkTxt.indexOf('Michelin') === -1 || cpkTxt.indexOf('UYU 0,100 por km') === -1 || cpkTxt.indexOf('60.000 km') === -1) fail('reportes: fila Michelin: ' + cpkTxt);
  if (cpkTxt.indexOf('Muestra baja') === -1 || cpkTxt.indexOf('Sin dato') === -1 || cpkTxt.indexOf('2 sin km confiables') === -1) fail('reportes: fila de muestra baja: ' + cpkTxt);
  if (d.querySelector('#view-reportes').textContent.indexOf('Comparar marcas sin ajustar por eje, carga y época puede engañar.') === -1) fail('reportes: falta el aviso de comparación');
  if (d.querySelector('#rep-cpk-csv').disabled) fail('reportes: CSV de costo por km deshabilitado con datos');
  setSel('#sec-select', ''); await sleep(300);
  log.push('selector-flow: ok, vehEqs=' + fx.vehEqs.join(','));
};

window.seccionalesUsuarioFlow = async function(w, d, sleep, fail, log){
  var navS = d.querySelector('.nav-item[data-view="sucursales"]');
  if (navS && navS.getClientRects().length) fail('seccional: el perfil de sucursal no debe ver la entrada Sucursales');
  var sel = d.querySelector('#sec-selector');
  if (sel && sel.style.display !== 'none') fail('sucursal: el selector no debe verse para un perfil de sucursal');
  if (d.querySelector('#user-role').textContent !== 'Sucursal') fail('sucursal: rol mostrado incorrecto: ' + d.querySelector('#user-role').textContent);
  d.querySelector('.nav-item[data-view="reportes"]').click(); await sleep(400);
  if (!d.querySelector('#rep-cpk-card').hidden) fail('sucursal: el perfil de sucursal no debe ver Costo por km');
  d.querySelector('.nav-item[data-view="flota"]').click(); await sleep(500);
  if (d.querySelectorAll('#flota-grid .flota-card').length < 1) fail('sucursal: Flota vacía');
  log.push('seccional-usuario-flow: ok');
};

// Vista Sucursales del perfil global: alta, renombrar, eliminar (con y sin vehículos), alta y movimiento de vehículos
// con confirmación, escape de nombres y actualización del selector de la barra superior.
window.sucursalesClienteFlow = async function(w, d, sleep, fail, log){
  var fx = w.__secFx, $ = function(s){ return d.querySelector(s); }, all = function(s){ return d.querySelectorAll(s); };
  var toast = function(){ return $('#toast-msg').textContent; };
  var setSel = function(el, v){ el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  var filas = function(){ return all('#suc-lista tr[data-sucursal]').length; };
  var visible = function(el){ return !!el && el.getClientRects().length > 0; };
  fx.rpcs.length = 0;
  $('.nav-item[data-view="sucursales"]').click(); await sleep(600);
  if (!$('#view-sucursales').classList.contains('active')) { fail('sucursales: vista no activa'); return; }
  if ($('#breadcrumb-current').textContent !== 'Sucursales') fail('sucursales: título incorrecto');
  if (filas() !== 2) fail('sucursales: se esperaban 2 sucursales propias, hay ' + filas());
  if (d.body.innerHTML.indexOf('<Hostil>') !== -1 || d.body.innerHTML.indexOf('<Norte>') !== -1) fail('sucursales: nombre sin escapar');
  var vrows = function(){ return Array.prototype.slice.call(all('#suc-vehiculos tr[data-vehiculo]')); };
  if (vrows().length !== 3) fail('sucursales: se esperaban 3 vehículos del cliente, hay ' + vrows().length);
  if (vrows().some(function(r){ return r.dataset.vehiculo === '17'; })) fail('sucursales: aparece un vehículo de otro cliente');

  // Alta (validación de nombre vacío, alta, duplicado)
  $('#suc-nombre').value = '  '; $('[data-action="sucursalCrear"]').click(); await sleep(100);
  if ($('#suc-error').textContent.indexOf('nombre') === -1 || fx.rpcs.length) fail('sucursales: falta validación de nombre vacío');
  $('#suc-nombre').value = 'Rivera'; $('[data-action="sucursalCrear"]').click(); await sleep(400);
  if (!fx.rpcs.some(function(r){ return r.name === 'sucursal_crear' && r.args.p_nombre === 'Rivera'; })) fail('sucursales: no llamó a sucursal_crear');
  if (filas() !== 3) fail('sucursales: la lista no creció (' + filas() + ')');
  if (all('#sec-select option').length !== 4) fail('sucursales: el selector de la barra no se actualizó (' + all('#sec-select option').length + ' opciones)');
  $('#suc-nombre').value = 'rivera'; $('[data-action="sucursalCrear"]').click(); await sleep(400);
  if (toast().indexOf('Ya existe una sucursal') === -1) fail('sucursales: sin mensaje de duplicado: ' + toast());

  // Renombrar
  $('#suc-n-1').value = 'Montevideo Centro'; $('#suc-lista tr[data-sucursal="1"] [data-action="sucursalRenombrar"]').click(); await sleep(400);
  if (!fx.rpcs.some(function(r){ return r.name === 'sucursal_renombrar' && r.args.p_sucursal_id === 1 && r.args.p_nombre === 'Montevideo Centro'; })) fail('sucursales: renombrar incorrecto');

  // Eliminar con vehículos: no llama a la base y explica
  var n = fx.rpcs.length;
  $('#suc-lista tr[data-sucursal="2"] [data-action="sucursalEliminar"]').click(); await sleep(200);
  if (fx.rpcs.length !== n || $('#suc-error').textContent.indexOf('Moverlos') === -1) fail('sucursales: eliminar con vehículos debía bloquearse: ' + $('#suc-error').textContent);
  if (filas() !== 3) fail('sucursales: se borró una sucursal con vehículos');
  // Eliminar vacía: pide confirmación; cancelar no hace nada
  var vacia = all('#suc-lista tr[data-sucursal]')[2].dataset.sucursal;
  var btn = $('#suc-lista tr[data-sucursal="' + vacia + '"] [data-action="sucursalEliminar"]');
  btn.click(); await sleep(150);
  if (!$('#modal-confirm').classList.contains('show')) fail('sucursales: eliminar no pidió confirmación');
  $('#confirm-cancel').click(); await sleep(200);
  if (filas() !== 3) fail('sucursales: cancelar eliminó igual');
  $('#suc-lista tr[data-sucursal="' + vacia + '"] [data-action="sucursalEliminar"]').click(); await sleep(150);
  $('#confirm-ok').click(); await sleep(400);
  if (filas() !== 2) fail('sucursales: no eliminó la sucursal vacía (' + filas() + ')');

  // Agregar vehículo (validación, alta con sucursal, duplicado)
  $('#suc-veh-numero').value = ' '; $('[data-action="sucursalVehiculoCrear"]').click(); await sleep(100);
  if ($('#suc-error').textContent.indexOf('número de coche') === -1) fail('sucursales: falta validación del número de coche');
  $('#suc-veh-numero').value = '321'; $('#suc-veh-patente').value = 'QQ 0001'; $('#suc-veh-ruedas').value = '16'; $('#suc-veh-sucursal').value = '2';
  $('[data-action="sucursalVehiculoCrear"]').click(); await sleep(400);
  var cr = fx.rpcs.filter(function(r){ return r.name === 'vehiculo_crear'; }).pop();
  if (!cr || cr.args.p_numero !== '321' || cr.args.p_patente !== 'QQ 0001' || cr.args.p_tipo_ruedas !== 16 || cr.args.p_sucursal_id !== 2) fail('sucursales: vehiculo_crear con argumentos incorrectos: ' + JSON.stringify(cr));
  if (vrows().length !== 4) fail('sucursales: el vehículo nuevo no aparece (' + vrows().length + ')');
  $('#suc-veh-numero').value = '321'; $('[data-action="sucursalVehiculoCrear"]').click(); await sleep(400);
  if (toast().indexOf('número de coche') === -1) fail('sucursales: sin mensaje de número duplicado: ' + toast());

  // Mover: confirmar y cancelar
  var selFila = function(id){ return $('#suc-vehiculos tr[data-vehiculo="' + id + '"] select'); };
  setSel(selFila(15), '1'); await sleep(150);
  if (!$('#modal-confirm').classList.contains('show') || $('#confirm-title').textContent !== 'Mover vehículo') fail('sucursales: mover no pidió confirmación');
  if ($('#confirm-ok').textContent !== 'Mover' || $('#confirm-ok').classList.contains('danger')) fail('sucursales: el botón de mover no debe ser de borrado');
  $('#confirm-cancel').click(); await sleep(200);
  if (selFila(15).value !== '') fail('sucursales: cancelar no restableció el select');
  if (fx.rpcs.some(function(r){ return r.name === 'vehiculo_mover_sucursal'; })) fail('sucursales: movió pese a cancelar');
  setSel(selFila(15), '1'); await sleep(150); $('#confirm-ok').click(); await sleep(400);
  var mv = fx.rpcs.filter(function(r){ return r.name === 'vehiculo_mover_sucursal'; }).pop();
  if (!mv || mv.args.p_vehiculo_id !== 15 || mv.args.p_sucursal_id !== 1) fail('sucursales: mover con argumentos incorrectos: ' + JSON.stringify(mv));
  if (selFila(15).value !== '1' || toast().indexOf('movido') === -1) fail('sucursales: el movimiento no se reflejó');
  // A "sin sucursal"
  setSel(selFila(10), ''); await sleep(150); $('#confirm-ok').click(); await sleep(400);
  mv = fx.rpcs.filter(function(r){ return r.name === 'vehiculo_mover_sucursal'; }).pop();
  if (!mv || mv.args.p_vehiculo_id !== 10 || mv.args.p_sucursal_id !== null) fail('sucursales: mover a «sin sucursal» incorrecto: ' + JSON.stringify(mv));
  // Buscador del listado
  $('#suc-buscar').value = 'sab1234'; $('#suc-buscar').dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(100);
  if (vrows().length !== 1 || vrows()[0].dataset.vehiculo !== '15') fail('sucursales: el buscador no filtró por matrícula');
  $('#suc-buscar').value = 'nada'; $('#suc-buscar').dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(100);
  if ($('#suc-vehiculos').textContent.indexOf('Ningún vehículo coincide') === -1) fail('sucursales: falta estado vacío del buscador');
  if (!visible($('.nav-item[data-view="sucursales"]'))) fail('sucursales: la entrada del menú no es visible para el perfil global');
  // «Cargar neumáticos ahora»: tras crear el vehículo abre su detalle, que ofrece cargar los neumáticos
  $('#suc-buscar').value = ''; $('#suc-buscar').dispatchEvent(new w.Event('input', { bubbles: true }));
  if (!/Cargar neumáticos ahora/.test($('label.sec-check').textContent) || $('#suc-veh-cargar').checked) fail('sucursales: falta la opción «Cargar neumáticos ahora» (sin marcar por defecto)');
  $('#suc-veh-numero').value = '322'; $('#suc-veh-cargar').checked = true;
  $('[data-action="sucursalVehiculoCrear"]').click(); await sleep(1200);
  // El stub no conoce el vehículo recién creado: basta comprobar que se navegó a su detalle (la base real lo prueba en e2e).
  if (!$('#view-vehiculo-detalle').classList.contains('active') || $('#vd-volver').textContent.indexOf('Volver a Sucursales') === -1) fail('sucursales: «Cargar neumáticos ahora» no abrió el detalle del vehículo nuevo');
  if ($('#suc-veh-cargar').checked) fail('sucursales: la casilla debe desmarcarse tras abrir el detalle');
  $('[data-action="detalleVolver"]').click(); await sleep(700);
  if (!$('#view-sucursales').classList.contains('active')) fail('sucursales: Volver no regresó a Sucursales');
  log.push('sucursales-cliente: rpcs=' + fx.rpcs.length);
};
