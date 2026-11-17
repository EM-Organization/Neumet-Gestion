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

  // El selector solo aparece donde filtra: Inicio, Vehículos, Alertas, Reportes y Mediciones a revisar; no en Stock, Recauchutado,
  // Sucursales, Usuarios, Umbrales ni el detalle de un vehículo.
  var visibleSel = function(){ var e = $('#sec-selector'); return !!e && e.getClientRects().length > 0; };
  var conSel = ['inicio', 'vehiculos', 'alertas', 'reportes'], sinSel = ['stock', 'sucursales', 'empresa-usuarios', 'empresa-umbrales', 'empresa-dispositivos'];
  for (var i = 0; i < conSel.length; i++) { await nav(conSel[i]); if (!visibleSel()) fail('selector: debe verse en ' + conSel[i]); }
  for (var j = 0; j < sinSel.length; j++) { await nav(sinSel[j]); if (visibleSel()) fail('selector: no debe verse en ' + sinSel[j]); }
  $('#view-stock [data-neu-tab="recauchutado"]') && (await nav('stock'), $('#view-stock [data-neu-tab="recauchutado"]').click(), await sleep(500));
  if (visibleSel()) fail('selector: no debe verse en Recauchutado');
  await nav('inicio'); if (!visibleSel()) fail('selector: debe volver a verse al regresar a Inicio');
  // Stock toma la sucursal de la barra como valor inicial de su propio filtro (solo cuando cambia la elección).
  // Fuera de las vistas con selector la sucursal elegida no filtra nada: con Salto elegida, la búsqueda de la barra
  // (desde Stock y desde el detalle de un vehículo) sigue encontrando un camión de otra sucursal (Camión 01, Montevideo).
  setSel('#sec-select', '2'); await sleep(300);
  await nav('stock'); await sleep(400);
  var buscarBarra = async function(txt){ var bg = $('#busq-global-input'); bg.value = txt; bg.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(400); return all('#busq-global-res .busq-op').length; };
  if (await buscarBarra('AB123CD') !== 1) fail('selector: la barra desde Stock no encontró un camión de otra sucursal; la sucursal elegida no debe filtrar fuera de las vistas con selector');
  $('#busq-global-input').form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await sleep(800);
  if (!$('#view-vehiculo-detalle').classList.contains('active')) fail('selector: Enter en la barra no abrió el detalle del camión de otra sucursal');
  if (await buscarBarra('SAB-1234') !== 1) fail('selector: la barra desde el detalle no encontró un camión sin sucursal con Salto elegida');
  $('#busq-global-input').value = ''; $('#busq-global-input').dispatchEvent(new w.Event('input', { bubbles: true }));
  await nav('stock'); await sleep(400);
  if ($('#filter-sucursal-stock').value !== '2') fail('selector: Stock no tomó la sucursal de la barra como valor inicial: ' + $('#filter-sucursal-stock').value);
  setSel('#filter-sucursal-stock', ''); await nav('stock'); await sleep(400);
  if ($('#filter-sucursal-stock').value !== '') fail('selector: Stock pisó el filtro propio sin que cambiara la sucursal de la barra');
  // «Todas» en la barra también llega a Stock como valor inicial (quita el filtro de sucursal que traía de la elección anterior).
  setSel('#filter-sucursal-stock', '2'); await nav('inicio'); setSel('#sec-select', ''); await sleep(300);
  await nav('stock'); await sleep(400);
  if ($('#filter-sucursal-stock').value !== '') fail('selector: «Todas» en la barra no llegó a Stock como valor inicial: ' + $('#filter-sucursal-stock').value);
  await nav('inicio');
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
  // Reabrir tras un error: el mensaje previo no debe quedar (regresión: errNuevo('') quedó dentro de un comentario)
  $('#btn-veh-agregar').click(); await sleep(200);
  if (nv('error').textContent !== '') fail('vehiculos: el diálogo reabierto conserva el error previo: ' + nv('error').textContent);
  $('#modal-veh-nuevo [data-action="vehiculoAgregarCerrar"]').click(); await sleep(150);
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
  // Operaciones distintas superpuestas (RPC lenta): solo el doble envío de la MISMA operación se descarta
  var cnt = function(nm){ return fx.rpcs.filter(function(r){ return r.name === nm; }).length; };
  fx.rpcDelay = 300;
  var m0 = cnt('vehiculo_mover_sucursal'), c0 = cnt('sucursal_crear'), r0 = cnt('sucursal_renombrar');
  setSel(selFila(10), '1'); await sleep(100);
  setSel(selFila(15), ''); await sleep(50);
  $('#suc-nombre').value = 'Salto'; $('#suc-form').requestSubmit();
  await sleep(2500);
  if (cnt('vehiculo_mover_sucursal') !== m0 + 2) fail('sucursales: dos mover de vehículos distintos superpuestos deben ejecutarse ambos (' + (cnt('vehiculo_mover_sucursal') - m0) + ')');
  if (cnt('sucursal_crear') !== c0 + 1) fail('sucursales: «Agregar sucursal» durante un mover no creó la sucursal');
  if (selFila(10).value !== '1' || selFila(15).value !== '') fail('sucursales: los selects no reflejan el estado real tras mover dos vehículos');
  // Renombrar dos filas seguidas: ambas se guardan y el texto escrito en la segunda no se pierde por la recarga
  var ids = Array.prototype.slice.call(all('#suc-lista tr[data-sucursal]')).map(function(t){ return t.dataset.sucursal; });
  $('#suc-n-' + ids[0]).value = 'Fila uno'; $('#suc-n-' + ids[1]).value = 'Fila dos';
  $('#suc-n-' + ids[0]).dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await sleep(100);
  $('#suc-n-' + ids[1]).dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await sleep(1800);
  if (cnt('sucursal_renombrar') !== r0 + 2) fail('sucursales: renombrar dos filas superpuestas debe guardar ambas (' + (cnt('sucursal_renombrar') - r0) + ')');
  // Texto sin guardar en una fila ajena sobrevive a la recarga de otra operación
  $('#suc-n-' + ids[2]).value = 'Sin guardar'; setSel(selFila(10), ''); await sleep(1500);
  if ($('#suc-n-' + ids[2]).value !== 'Sin guardar') fail('sucursales: la recarga pisó el texto sin guardar de otra fila');
  fx.rpcDelay = 0;
  setSel(selFila(10), ''); setSel(selFila(15), '1'); await sleep(400);
  // Una RPC colgada para un vehículo no bloquea el resto (sin cola global): otro mover y «Agregar sucursal» corren sin esperarla
  var movs = function(id){ return fx.rpcs.filter(function(r){ return r.name === 'vehiculo_mover_sucursal' && r.args.p_vehiculo_id === id; }).length; };
  fx.rpcDelayFn = function(nm, a){ return nm === 'vehiculo_mover_sucursal' ? (a.p_vehiculo_id === 10 ? 1500 : 300) : 0; };
  var m1 = cnt('vehiculo_mover_sucursal'), c1 = cnt('sucursal_crear');
  setSel(selFila(10), '1'); await sleep(100);
  setSel(selFila(15), ''); $('#suc-nombre').value = 'Sin esperar'; $('#suc-form').requestSubmit();
  await sleep(500);
  if (cnt('vehiculo_mover_sucursal') !== m1 + 2 || cnt('sucursal_crear') !== c1 + 1) fail('sucursales: con un mover colgado, otro mover y «Agregar sucursal» deben ejecutarse sin esperar (mover ' + (cnt('vehiculo_mover_sucursal') - m1) + ', crear ' + (cnt('sucursal_crear') - c1) + ')');
  // Re-elegir el destino de un vehículo mientras otra operación sobre OTRO vehículo sigue en curso: se ejecuta y gana la última elección
  var m15 = movs(15);
  await sleep(1200);
  setSel(selFila(10), ''); await sleep(100);
  setSel(selFila(15), '1'); await sleep(500);
  setSel(selFila(15), ''); await sleep(600);
  if (movs(15) !== m15 + 2) fail('sucursales: re-elegir el destino de un vehículo con otra operación en curso se descartó (' + (movs(15) - m15) + ' de 2)');
  if (selFila(15).value !== '') fail('sucursales: el estado final no refleja la última elección (' + selFila(15).value + ')');
  await sleep(1500);
  if (selFila(10).value !== '') fail('sucursales: el mover lento no terminó bien (' + selFila(10).value + ')');
  fx.rpcDelayFn = null;
  setSel(selFila(15), '1'); await sleep(400);
  // Re-elegir el destino del MISMO vehículo con su mover en curso: no se descarta, gana la última elección (como en main)
  var opts = Array.prototype.map.call(selFila(15).options, function(o){ return o.value; }).filter(function(v){ return v !== '' && v !== '1'; });
  var otra = opts[0];
  if (!otra) fail('sucursales: el fixture necesita una segunda sucursal');
  fx.rpcDelayFn = function(nm){ return nm === 'vehiculo_mover_sucursal' ? 400 : 0; };
  setSel(selFila(15), ''); await sleep(1000);
  var mA = movs(15);
  setSel(selFila(15), '1'); await sleep(150);
  setSel(selFila(15), otra); await sleep(1500);
  var ultimoA = fx.rpcs.filter(function(r){ return r.name === 'vehiculo_mover_sucursal' && r.args.p_vehiculo_id === 15; }).pop();
  if (!ultimoA || String(ultimoA.args.p_sucursal_id) !== otra || selFila(15).value !== otra) fail('sucursales: re-elegir el destino del mismo vehículo con su mover en curso dejó ' + selFila(15).value + ' (RPC final ' + (ultimoA && ultimoA.args.p_sucursal_id) + ', esperado ' + otra + ')');
  if (movs(15) > mA + 2) fail('sucursales: el mover del mismo vehículo se ejecutó de más (' + (movs(15) - mA) + ')');
  // Mover colgado y el operario re-elige el valor anterior (el real): se ejecuta y termina en lo último elegido
  fx.rpcDelayFn = function(nm, a){ return nm === 'vehiculo_mover_sucursal' && a.p_vehiculo_id === 10 ? 1200 : 0; };
  var real10 = selFila(10).value;
  var dest10 = real10 === '1' ? otra : '1';
  setSel(selFila(10), dest10); await sleep(200);
  setSel(selFila(10), real10); await sleep(2800);
  var ultimoB = fx.rpcs.filter(function(r){ return r.name === 'vehiculo_mover_sucursal' && r.args.p_vehiculo_id === 10; }).pop();
  if (selFila(10).value !== real10 || !ultimoB || String(ultimoB.args.p_sucursal_id === null ? '' : ultimoB.args.p_sucursal_id) !== real10) fail('sucursales: re-elegir el valor anterior con el mover colgado no quedó en lo último elegido (' + selFila(10).value + ', esperado ' + real10 + ')');
  fx.rpcDelayFn = null;
  // Vuelta al origen con lecturas CLONADAS (como PostgREST) y lentas: la recarga del mover anterior se descarta y la lista queda vieja.
  // El destino pendiente (volver a «Sin sucursal») no puede compararse con ese origen viejo: debe ejecutarse y el aviso nombrar el origen real.
  fx.clonar = true;
  var salto = otra;
  var nombreSalto = Array.prototype.filter.call(selFila(15).options, function(o){ return o.value === salto; })[0].textContent;
  var vueltaAlOrigen = async function(etiqueta, intermedio){
    fx.rpcDelayFn = null; fx.selectDelay = 0;
    setSel(selFila(15), ''); await sleep(1200);
    if (selFila(15).value !== '') { fail('sucursales: ' + etiqueta + ': no se pudo preparar el origen «Sin sucursal»'); return; }
    var antes = movs(15);
    fx.rpcDelayFn = function(nm){ return nm === 'vehiculo_mover_sucursal' ? 400 : 0; }; fx.selectDelay = 300;
    setSel(selFila(15), salto); await sleep(100);
    intermedio(); await sleep(100);
    setSel(selFila(15), ''); await sleep(2500);
    var ult = fx.rpcs.filter(function(r){ return r.name === 'vehiculo_mover_sucursal' && r.args.p_vehiculo_id === 15; }).pop();
    if (selFila(15).value !== '' || !ult || ult.args.p_sucursal_id !== null) fail('sucursales: ' + etiqueta + ': el vehículo no volvió a «Sin sucursal» (select ' + selFila(15).value + ', última RPC ' + JSON.stringify(ult && ult.args) + ')');
    if (movs(15) - antes !== 2) fail('sucursales: ' + etiqueta + ': se esperaban 2 RPC del vehículo y hubo ' + (movs(15) - antes));
    if (toast().indexOf('movido de «' + nombreSalto + '» a «Sin sucursal»') === -1) fail('sucursales: ' + etiqueta + ': el aviso debe nombrar el origen real (' + nombreSalto + '), dice «' + toast() + '»');
  };
  var otroDest = salto === '1' ? otra : '1';
  await vueltaAlOrigen('vuelta al origen con otro mover', function(){ setSel(selFila(10), selFila(10).value === otroDest ? '' : otroDest); });
  await vueltaAlOrigen('vuelta al origen con «Recargar»', function(){ $('[data-action="sucursalesRecargar"]').click(); });
  fx.clonar = false; fx.rpcDelayFn = null; fx.selectDelay = 0;
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
  if (!/Cargar neumáticos ahora/.test($('#modal-veh-nuevo label.sec-check').textContent) || !nv('cargar').checked) fail('vehiculos: «Cargar neumáticos ahora» debe venir marcada por defecto');
  nv('numero').value = '322'; nv('cargar').checked = true;
  $('#veh-nuevo-guardar').click(); await sleep(1200);
  // El stub no conoce el vehículo recién creado: basta comprobar que se navegó a su detalle (la base real lo prueba en e2e).
  if (!$('#view-vehiculo-detalle').classList.contains('active') || $('#vd-volver').textContent.indexOf('Volver a Vehículos') === -1) fail('vehiculos: «Cargar neumáticos ahora» no abrió el detalle del vehículo nuevo');
  $('[data-action="detalleVolver"]').click(); await sleep(700);
  if (!$('#view-vehiculos').classList.contains('active')) fail('vehiculos: Volver no regresó a Vehículos');
  log.push('sucursales-cliente: rpcs=' + fx.rpcs.length);
};
