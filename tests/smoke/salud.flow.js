// Recorrido de humo de salud de dispositivos y ficha de cliente. Lo invoca harness.html:
//   await window.saludFlow(w, d, sleep, fail, log, cliMode)
window.saludFlow = async function(w, d, sleep, fail, log, cliMode){
  var fx = w.__saludFx, $ = function(s){ return d.querySelector(s); };
  var nav = function(v){ $('.nav-item[data-view="'+v+'"]').click(); };
  var rows = function(){ return d.querySelectorAll('#tbody-dispositivos tr[data-estado]').length; };
  var change = function(el, v){ el.value = v; el.dispatchEvent(new w.Event('change',{bubbles:true})); };

  // ── Dispositivos (vista única con estado de actividad) ──
  nav('dispositivos'); await sleep(500);
  if(!$('#view-dispositivos').classList.contains('active')) fail('dispositivos: vista no activa');
  if($('.nav-item[data-view="salud"]')) fail('dispositivos: queda la entrada de menú "Salud de dispositivos"');
  if(rows() !== 4) fail('dispositivos: filas esperadas 4, hay '+rows());
  var first = $('#tbody-dispositivos tr[data-estado]').dataset.estado;
  if(first !== 'caido') fail('dispositivos: el más grave debe ir primero, va '+first);
  if($('#view-dispositivos').innerHTML.indexOf('Sensor <2>') !== -1) fail('dispositivos: nombre sin escapar');
  if($('#tbody-dispositivos').textContent.indexOf('Desactivado') === -1) fail('dispositivos: falta marca de dispositivo desactivado');
  if($('#tbody-dispositivos').textContent.indexOf('Sin mediciones') === -1) fail('dispositivos: falta "Sin mediciones" del que nunca midió');
  // Rol cliente: solo lectura (sin editar, eliminar ni alta); admin: acciones por fila y alta
  var edit = d.querySelectorAll('#tbody-dispositivos [data-action="editarDispositivo"],#tbody-dispositivos [data-action="eliminarDispositivo"]').length;
  var alta = Array.prototype.some.call(d.querySelectorAll('#view-dispositivos [data-action="openDispositivoModal"]'), function(b){ return b.getClientRects().length > 0; });
  if(cliMode){
    if(edit) fail('dispositivos(cliente): ve botones de editar/eliminar ('+edit+')');
    if(alta) fail('dispositivos(cliente): ve el alta de dispositivos');
    if($('#unreg-section').style.display !== 'none') fail('dispositivos(cliente): ve dispositivos sin cliente asignado');
    if(d.querySelectorAll('#view-dispositivos thead th').length && Array.prototype.some.call(d.querySelectorAll('#view-dispositivos thead th'), function(t){ return t.getClientRects().length > 0 && /Cliente|Acciones/.test(t.textContent); })) fail('dispositivos(cliente): columnas de administración visibles');
  } else {
    if(edit !== 8) fail('dispositivos(admin): faltan acciones por fila ('+edit+')');
    if(!alta) fail('dispositivos(admin): falta el alta');
  }
  // filtro por estado (chip con data-action y select)
  $('.salud-chip[data-args=\'["caido"]\']').click(); await sleep(100);
  if(rows() !== 1) fail('dispositivos: filtro caido devolvió '+rows());
  change($('#disp-estado'), 'nunca'); await sleep(100);
  if(rows() !== 1 || $('#tbody-dispositivos tr[data-estado]').dataset.estado !== 'nunca') fail('dispositivos: filtro nunca');
  change($('#disp-estado'), ''); await sleep(100);
  // filtro por cliente (solo admin)
  if(!cliMode){
    change($('#filter-cliente-disp'), '2'); await sleep(100);
    if(rows() !== 2) fail('dispositivos: filtro cliente 2 devolvió '+rows());
    change($('#filter-cliente-disp'), ''); await sleep(100);
  }
  log.push('dispositivos: filas='+rows());
  if(cliMode) return; // el cliente no accede a la ficha de administración

  // ── Ficha de cliente ──
  nav('clientes'); await sleep(500);
  if($('.nav-item[data-view="ficha"]')) fail('menu: queda la entrada "Ficha de cliente" (se abre desde Clientes)');
  $('#tbody-clientes [data-action="abrirFichaCliente"]').click(); await sleep(600);
  if($('.nav-item.active').dataset.view !== 'clientes') fail('ficha: el menú debe resaltar Clientes');
  if($('#breadcrumb-current').textContent === 'Inicio' || $('#breadcrumb-parent').hidden) fail('ficha: título sin migas (Clientes › nombre)');
  if(!$('#view-ficha').classList.contains('active')) fail('ficha: vista no activa');
  var kpis = $('#ficha-kpis').textContent;
  if(!/Vehículos activos/.test(kpis) || !/Críticos/.test(kpis)) fail('ficha: faltan KPIs del resumen');
  if(!$('#fu-umbral_bajo_mm') || $('#fu-umbral_bajo_mm').value !== '8') fail('ficha: umbral bajo no cargado');
  var sv = function(k, v){ $('#fu-'+k).value = v; };
  var guardar = async function(){ $('#ficha-guardar').click(); await sleep(250); };
  var errTxt = function(){ return $('#ficha-umbral-error').classList.contains('show') ? $('#ficha-umbral-error').textContent : ''; };
  // validación local: no llega a la BD
  sv('umbral_critico_mm', '9'); await guardar();
  if(fx.updates.length !== 0) fail('ficha: umbrales inválidos llegaron a la BD');
  if(errTxt().indexOf('retiro < crítico < bajo') === -1) fail('ficha: falta error de orden: '+errTxt());
  // error de la BD (check) se muestra
  sv('umbral_critico_mm', '5.5'); fx.error = {code:'23514', message:'violates check constraint "clientes_umbrales_check"'};
  await guardar();
  if(fx.updates.length !== 1) fail('ficha: no se envió el update');
  if(errTxt().indexOf('clientes_umbrales_check') === -1) fail('ficha: no se muestra el error de la BD: '+errTxt());
  // UPDATE que afecta 0 filas (RLS): error visible, nunca éxito silencioso
  fx.error = null; fx.sinFilas = true; await guardar();
  if(fx.updates.length !== 2) fail('ficha: no se envió el update sin filas');
  if(errTxt().indexOf('No se guardó ningún cambio') === -1) fail('ficha: 0 filas sin error visible: '+errTxt());
  if($('#toast-msg').textContent.indexOf('Umbrales actualizados') !== -1) fail('ficha: éxito mostrado con 0 filas afectadas');
  // guardado correcto
  fx.sinFilas = false; await guardar();
  var u = fx.updates[fx.updates.length-1];
  if(fx.updates.length !== 3 || u.umbral_critico_mm !== 5.5 || u.umbral_bajo_mm !== 8) fail('ficha: payload de umbrales: '+JSON.stringify(u));
  if(errTxt()) fail('ficha: queda un error tras guardar bien: '+errTxt());
  if($('#toast-msg').textContent.indexOf('Umbrales actualizados') === -1) fail('ficha: falta aviso de guardado');
  // volver a Clientes y reabrir otra ficha
  $('#ficha-volver').click(); await sleep(400);
  if(!$('#view-clientes').classList.contains('active')) fail('ficha: "Volver" no regresa a Clientes');
  var b = $('#tbody-clientes [data-action="abrirFichaCliente"]');
  if(!b){ fail('ficha: falta acceso desde clientes'); return; }
  b.click(); await sleep(500);
  if(!$('#view-ficha').classList.contains('active')) fail('ficha: no abre desde clientes');
  log.push('ficha: ok updates='+fx.updates.length);
};
