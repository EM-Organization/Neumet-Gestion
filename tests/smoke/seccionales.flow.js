// Recorridos de humo de sucursales (datos simulados por sucursales.fixture.js + flota.fixture.js).
//   window.seccionalesAdminFlow(w, d, sleep, fail, log)    ficha de cliente del equipo Neumet: solo lectura (PR 9 de F10)
//   window.seccionalesClienteFlow(w, d, sleep, fail, log)  selector de sucursal (perfil global)
//   window.seccionalesUsuarioFlow(w, d, sleep, fail, log)  perfil de sucursal: sin selector
window.seccionalesAdminFlow = async function(w, d, sleep, fail, log){
  // Equipo Neumet (docs/17 PR 9): la ficha muestra sucursales, vehículos y usuarios SOLO en lectura. La única escritura que
  // conserva es asignar un dispositivo (hardware) a una sucursal.
  var fx = w.__secFx, ex = w.__empFx, $ = function(s){ return d.querySelector(s); }, all = function(s){ return d.querySelectorAll(s); };
  var toast = function(){ return $('#toast-msg').textContent; };
  var setSel = function(el, v){ el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  var lista = function(){ return all('#sec-lista tr[data-sucursal]').length; };
  $('.nav-item[data-view="clientes"]').click(); await sleep(500); $('#tbody-clientes [data-action="abrirFichaCliente"]').click(); await sleep(700);
  if (!$('#view-ficha').classList.contains('active')) { fail('sucursales: ficha no activa'); return; }
  if (!$('#ficha-seccionales') || $('#ficha-seccionales').style.display === 'none') { fail('sucursales: falta la tarjeta'); return; }
  if (lista() !== 2) fail('sucursales: se esperaban 2 sucursales del cliente 1, hay ' + lista());
  if (d.body.innerHTML.indexOf('<Norte>') !== -1) fail('sucursales: nombre sin escapar');

  // Sin formularios ni botones de escritura sobre sucursales, vehículos o usuarios
  ['#sec-nombre', '#sec-user-email', '#sec-user-sucursal', '#sec-user-password', '#sec-user-crear'].forEach(function(s){ if ($(s)) fail('sucursales: el equipo Neumet no debe ver el formulario ' + s); });
  ['seccionalCrear', 'seccionalRenombrar', 'seccionalEliminar', 'seccionalAsignarVeh', 'seccionalCrearUsuario'].forEach(function(a){ if ($('[data-action="' + a + '"],[data-change="' + a + '"]')) fail('sucursales: queda la acción de escritura ' + a); });
  if (all('#sec-vehiculos select, #sec-vehiculos input, #sec-vehiculos button').length) fail('sucursales: los vehículos deben ser solo lectura');
  if (all('#sec-usuarios select, #sec-usuarios input, #sec-usuarios button').length) fail('sucursales: los usuarios deben ser solo lectura');
  if (all('#sec-lista input, #sec-lista button').length) fail('sucursales: la lista de sucursales debe ser solo lectura');

  // Usuarios: salen de la RPC con el cliente de la ficha (no se lee perfiles) y muestran alcance y estado
  var rpc = ex.rpcs.filter(function(r){ return r.name === 'usuarios_empresa_listar'; }).pop();
  if (!rpc || rpc.args.p_cliente_id !== 1) fail('sucursales: usuarios_empresa_listar no se llamó con el cliente de la ficha: ' + JSON.stringify(rpc));
  var us = $('#sec-usuarios').textContent.replace(/\s+/g, ' ');
  if (us.indexOf('salto@demo.test') === -1 || us.indexOf('Acceso quitado') === -1 || us.indexOf('Con acceso') === -1) fail('sucursales: usuarios sin email o estado: ' + us);

  // Única escritura: asignar un dispositivo a una sucursal
  var upd = $('#sec-dispositivos select');
  if (!upd) { fail('sucursales: falta el selector de sucursal del dispositivo'); return; }
  setSel(upd, '2'); await sleep(300);
  if (!fx.updates.some(function(u){ return u.table === 'dispositivos' && u.patch.sucursal_id === 2; })) fail('sucursales: no asignó el dispositivo');
  var otras = fx.updates.filter(function(u){ return u.table !== 'dispositivos'; });
  if (otras.length || fx.inserts.length || fx.deletes.length || fx.fetches.length || fx.rpcs.length) fail('sucursales: el equipo Neumet hizo una escritura ajena al dispositivo: ' + JSON.stringify({ otras: otras, i: fx.inserts.length, d: fx.deletes.length, f: fx.fetches.length, r: fx.rpcs.length }));
  if (toast().indexOf('Dispositivo asignado') === -1) fail('sucursales: falta el aviso de asignación: ' + toast());
  log.push('seccionales-admin: solo lectura, updates=' + fx.updates.length);
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
  if (cpkTxt.indexOf('no se filtra por la sucursal elegida') === -1) fail('reportes: sin la nota de sucursal elegida: ' + cpkTxt);
  if (cpkTxt.indexOf('km recorridos (sin los km previos)') === -1) fail('reportes: sin la definición del costo por km');
  if (d.querySelector('#rep-cpk-csv').disabled) fail('reportes: CSV de costo por km deshabilitado con datos');
  setSel('#sec-select', ''); await sleep(300);
  log.push('selector-flow: ok, vehEqs=' + fx.vehEqs.join(','));
};

window.seccionalesUsuarioFlow = async function(w, d, sleep, fail, log){
  var navS = d.querySelector('.nav-item[data-view="sucursales"]');
  if (navS && navS.getClientRects().length) fail('seccional: el perfil de sucursal no debe ver la entrada Sucursales');
  var sel = d.querySelector('#sec-selector');
  if (sel && sel.style.display !== 'none') fail('sucursal: el selector no debe verse para un perfil de sucursal');
  if (d.querySelector('#user-role').textContent !== 'Usuario de sucursal') fail('sucursal: rol mostrado incorrecto: ' + d.querySelector('#user-role').textContent);
  d.querySelector('.nav-item[data-view="reportes"]').click(); await sleep(400);
  if (!d.querySelector('#rep-cpk-card').hidden) fail('sucursal: el perfil de sucursal no debe ver Costo por km');
  d.querySelector('.nav-item[data-view="flota"]').click(); await sleep(500);
  if (d.querySelectorAll('#flota-grid .flota-card').length < 1) fail('sucursal: Flota vacía');
  log.push('seccional-usuario-flow: ok');
};

// Vista Sucursales del perfil global: alta, renombrar, eliminar (con y sin vehículos), alta y movimiento de vehículos
// con confirmación, escape de nombres y actualización del selector de la barra superior. El alta de vehículos se prueba
// desde la vista Vehículos (botón «Agregar vehículo»).
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
  if (!$('#suc-form') || $('#suc-agregar').type !== 'submit') fail('sucursales: «Agregar sucursal» debe enviar con Enter (form/submit)');
  if (/Asignación/.test($('#view-sucursales').textContent)) fail('sucursales: sobra la etiqueta suelta «Asignación»');
  if ($('#view-sucursales .ficha-card-title').textContent === 'Sucursales') fail('sucursales: el título «Sucursales» está repetido en la tarjeta');
  $('#suc-nombre').value = '  '; $('#suc-form').requestSubmit(); await sleep(100);
  if ($('#suc-error').textContent.indexOf('nombre') === -1 || fx.rpcs.length) fail('sucursales: falta validación de nombre vacío');
  // Doble envío: dos submit seguidos crean una sola sucursal (el segundo daría 23505 tras «Sucursal creada»)
  $('#suc-nombre').value = 'Rivera'; $('#suc-form').requestSubmit(); $('#suc-form').requestSubmit(); await sleep(500);
  if (fx.rpcs.filter(function(r){ return r.name === 'sucursal_crear'; }).length !== 1) fail('sucursales: dos envíos seguidos llamaron más de una vez a sucursal_crear');
  if (toast().indexOf('Ya existe') !== -1) fail('sucursales: el segundo envío mostró el duplicado tras crear');
  if (!fx.rpcs.some(function(r){ return r.name === 'sucursal_crear' && r.args.p_nombre === 'Rivera'; })) fail('sucursales: no llamó a sucursal_crear');
  if (filas() !== 3) fail('sucursales: la lista no creció (' + filas() + ')');
  if (all('#sec-select option').length !== 4) fail('sucursales: el selector de la barra no se actualizó (' + all('#sec-select option').length + ' opciones)');
  $('#suc-nombre').value = 'rivera'; $('#suc-form').requestSubmit(); await sleep(400);
  if (toast().indexOf('Ya existe una sucursal') === -1) fail('sucursales: sin mensaje de duplicado: ' + toast());

  // Renombrar: tres Enter seguidos en el nombre guardan una sola vez
  var nRen0 = fx.rpcs.filter(function(r){ return r.name === 'sucursal_renombrar'; }).length;
  $('#suc-n-1').value = 'Montevideo Centro';
  for (var k = 0; k < 3; k++) $('#suc-n-1').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await sleep(500);
  if (fx.rpcs.filter(function(r){ return r.name === 'sucursal_renombrar'; }).length !== nRen0 + 1) fail('sucursales: tres Enter seguidos llamaron más de una vez a sucursal_renombrar');

  // Renombrar con el botón
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

  // El alta de vehículos ya no vive en Sucursales (se hace desde la vista Vehículos)
  ['suc-veh-numero', 'suc-veh-patente', 'suc-veh-sucursal', 'suc-veh-cargar'].forEach(function(id){ if ($('#' + id)) fail('sucursales: queda el campo de alta de vehículo #' + id); });
  if ($('#view-sucursales [data-action="sucursalVehiculoCrear"]')) fail('sucursales: queda el botón de alta de vehículo');

  // Agregar vehículo desde Vehículos (validación, alta con sucursal, duplicado)
  $('.nav-item[data-view="vehiculos"]').click(); await sleep(700);
  if (!visible($('#btn-veh-agregar')) || $('#btn-veh-agregar').textContent.trim() !== 'Agregar vehículo') fail('vehiculos: falta el botón «Agregar vehículo» del administrador de empresa');
  var nv = function(id){ return $('#veh-nuevo-' + id); };
  $('#btn-veh-agregar').click(); await sleep(200);
  if (!$('#modal-veh-nuevo').classList.contains('show')) { fail('vehiculos: «Agregar vehículo» no abrió el diálogo'); return; }
  if (d.activeElement !== nv('numero')) fail('vehiculos: el foco no quedó en el número de coche');
  var ops = Array.prototype.map.call(nv('sucursal').options, function(o){ return o.textContent; });
  if (ops[0] !== 'Sin sucursal' || ops.length !== 3) fail('vehiculos: opciones de sucursal del alta: ' + ops.join('|'));
  nv('numero').value = ' '; $('#veh-nuevo-guardar').click(); await sleep(100);
  if (nv('error').textContent.indexOf('número de coche') === -1 || fx.rpcs.some(function(r){ return r.name === 'vehiculo_crear'; })) fail('vehiculos: falta validación del número de coche');
  nv('numero').value = '321'; nv('patente').value = 'QQ 0001'; nv('ruedas').value = '16'; nv('sucursal').value = '2';
  // Enter en el campo de matrícula guarda (un clic menos)
  // Dos Enter seguidos: una sola llamada a vehiculo_crear (el segundo ve el botón deshabilitado)
  nv('patente').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  nv('patente').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(500);
  if (fx.rpcs.filter(function(r){ return r.name === 'vehiculo_crear'; }).length !== 1) fail('vehiculos: dos Enter seguidos llamaron más de una vez a vehiculo_crear');
  var cr = fx.rpcs.filter(function(r){ return r.name === 'vehiculo_crear'; }).pop();
  if (!cr || cr.args.p_numero !== '321' || cr.args.p_patente !== 'QQ 0001' || cr.args.p_tipo_ruedas !== 16 || cr.args.p_sucursal_id !== 2) fail('vehiculos: vehiculo_crear con argumentos incorrectos: ' + JSON.stringify(cr));
  if ($('#modal-veh-nuevo').classList.contains('show') || toast().indexOf('Vehículo agregado') === -1) fail('vehiculos: tras agregar debe cerrarse el diálogo y avisar: ' + toast());
  // Duplicado: el diálogo queda abierto con el mensaje
  $('#btn-veh-agregar').click(); await sleep(200);
  if (nv('numero').value !== '') fail('vehiculos: el diálogo reabierto debe empezar vacío');
  nv('numero').value = '321'; $('#veh-nuevo-guardar').click(); await sleep(400);
  if (toast().indexOf('número de coche') === -1 || nv('error').textContent.indexOf('número de coche') === -1 || !$('#modal-veh-nuevo').classList.contains('show')) fail('vehiculos: sin mensaje de número duplicado: ' + toast());
  $('#modal-veh-nuevo [data-action="vehiculoAgregarCerrar"]').click(); await sleep(150);
  if ($('#modal-veh-nuevo').classList.contains('show')) fail('vehiculos: Cancelar no cerró el diálogo');
  // La sucursal elegida en la barra superior es la sucursal por defecto del alta
  $('.nav-item[data-view="sucursales"]').click(); await sleep(600);
  if (vrows().length !== 4) fail('sucursales: el vehículo nuevo no aparece (' + vrows().length + ')');

  // Mover: sin diálogo de confirmación (es reversible, docs/14 §5 regla 5); el vehículo se nombra como en Vehículos
  var selFila = function(id){ return $('#suc-vehiculos tr[data-vehiculo="' + id + '"] select'); };
  setSel(selFila(15), '1'); await sleep(400);
  if ($('#modal-confirm').classList.contains('show')) fail('sucursales: mover no debe pedir confirmación');
  var mv = fx.rpcs.filter(function(r){ return r.name === 'vehiculo_mover_sucursal'; }).pop();
  if (!mv || mv.args.p_vehiculo_id !== 15 || mv.args.p_sucursal_id !== 1) fail('sucursales: mover con argumentos incorrectos: ' + JSON.stringify(mv));
  if (selFila(15).value !== '1' || toast().indexOf('movido de «') === -1) fail('sucursales: el movimiento no se reflejó: ' + toast());
  // Reversible: volver a la sucursal anterior es otro cambio de select, sin pasos intermedios
  setSel(selFila(15), ''); await sleep(400);
  mv = fx.rpcs.filter(function(r){ return r.name === 'vehiculo_mover_sucursal'; }).pop();
  if (!mv || mv.args.p_vehiculo_id !== 15 || mv.args.p_sucursal_id !== null) fail('sucursales: deshacer el movimiento falló: ' + JSON.stringify(mv));
  setSel(selFila(15), '1'); await sleep(400);
  if (!all('#suc-vehiculos td[data-label="Sucursal"]').length) fail('sucursales: falta data-label para la vista apilada en móvil');
  // A "sin sucursal"
  setSel(selFila(10), ''); await sleep(400);
  if ($('#modal-confirm').classList.contains('show')) fail('sucursales: mover a «sin sucursal» no debe pedir confirmación');
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
  $('.nav-item[data-view="vehiculos"]').click(); await sleep(600);
  $('#btn-veh-agregar').click(); await sleep(200);
  if (!/Cargar neumáticos ahora/.test($('#modal-veh-nuevo label.sec-check').textContent) || nv('cargar').checked) fail('vehiculos: falta la opción «Cargar neumáticos ahora» (sin marcar por defecto)');
  nv('numero').value = '322'; nv('cargar').checked = true;
  $('#veh-nuevo-guardar').click(); await sleep(1200);
  // El stub no conoce el vehículo recién creado: basta comprobar que se navegó a su detalle (la base real lo prueba en e2e).
  if (!$('#view-vehiculo-detalle').classList.contains('active') || $('#vd-volver').textContent.indexOf('Volver a Vehículos') === -1) fail('vehiculos: «Cargar neumáticos ahora» no abrió el detalle del vehículo nuevo');
  $('[data-action="detalleVolver"]').click(); await sleep(700);
  if (!$('#view-vehiculos').classList.contains('active')) fail('vehiculos: Volver no regresó a Vehículos');
  log.push('sucursales-cliente: rpcs=' + fx.rpcs.length);
};
