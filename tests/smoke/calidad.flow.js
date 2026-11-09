// Recorridos de humo de la calidad de las mediciones (F3).
//   calidadListaFlow: aviso de Inicio -> lista «Mediciones a revisar» -> filtro -> invalidar con motivo (datos del stub base).
//   calidadDetalleFlow: indicador del vehículo y del neumático, invalidar y marcar como válida con recarga (vehiculo.fixture.js).
// Los invoca harness.html / vehiculo.flow.js. Cualquier console.error o «Acción desconocida» hace fallar el arnés.
window.calidadListaFlow = async function(w, d, sleep, fail, log, cliMode){
  var $ = function(s){ return d.querySelector(s); }, all = function(s){ return Array.prototype.slice.call(d.querySelectorAll(s)); };
  var rol = cliMode ? 'cliente' : 'admin';
  var txt = function(el){ return el.textContent.replace(/\s+/g, ' '); };
  $('.nav-item[data-view="inicio"]').click(); await sleep(700);

  // Aviso sobrio en Inicio: solo si hay sospechosas (el stub tiene 2; la invalidada no cuenta)
  var av = $('#inicio-contenido .inicio-aviso');
  if(!av) { fail('calidad('+rol+'): Inicio sin el aviso de mediciones por revisar'); return; }
  if(txt(av).indexOf('2 mediciones requieren revisión') === -1) fail('calidad('+rol+'): texto del aviso: '+txt(av));
  if(/!|¡|Todavía|acá/.test(txt(av))) fail('calidad('+rol+'): el aviso no sigue la guía de textos: '+txt(av));
  if(av.querySelector('.badge.red')) fail('calidad('+rol+'): el aviso no debe usar rojo');
  av.querySelector('[data-action="irA"]').click(); await sleep(600);

  // Lista de revisión
  if(!$('#view-calidad').classList.contains('active')) { fail('calidad('+rol+'): el aviso no lleva a la lista'); return; }
  if($('#breadcrumb-current').textContent !== 'Mediciones a revisar') fail('calidad('+rol+'): breadcrumb '+$('#breadcrumb-current').textContent);
  var act = $('.nav-item.active');
  if(!act || act.dataset.view !== 'inicio') fail('calidad('+rol+'): el menú debe resaltar Inicio');
  var ops = all('#cal-filtro option').map(function(o){ return o.textContent; });
  if(ops.join('|') !== 'En revisión (2)|Invalidadas (1)') fail('calidad('+rol+'): opciones del filtro: '+ops.join('|'));
  var filas = all('#cal-contenido .cal-fila');
  if(filas.length !== 2) fail('calidad('+rol+'): se esperaban 2 mediciones en revisión, hay '+filas.length);
  var t0 = filas.length ? txt(filas[0]) : '';
  ['En revisión','Camión 01','Invalidar','Marcar como válida','mm'].forEach(function(t){ if(t0.indexOf(t) === -1) fail('calidad('+rol+'): fila sin «'+t+'»: '+t0); });
  if(all('#cal-contenido .cal-valores.tachado').length) fail('calidad('+rol+'): una medición en revisión no debe tacharse');
  log.push('calidad('+rol+'): '+t0.slice(0, 120));

  // Invalidadas: atenuadas y tachadas, sin «Invalidar»
  var sel = $('#cal-filtro'); sel.value = 'invalidada'; sel.dispatchEvent(new w.Event('change', {bubbles:true})); await sleep(200);
  var inv = all('#cal-contenido .cal-fila');
  if(inv.length !== 1 || !inv[0].classList.contains('cal-invalidada')) fail('calidad('+rol+'): se esperaba 1 invalidada');
  else {
    if(!inv[0].querySelector('.cal-valores.tachado')) fail('calidad('+rol+'): la invalidada debe verse tachada');
    if(txt(inv[0]).indexOf('Motivo: Lectura errónea del medidor') === -1) fail('calidad('+rol+'): falta el motivo: '+txt(inv[0]));
    if(inv[0].querySelector('[data-action="calidad-invalidar"]') || !inv[0].querySelector('[data-action="calidad-revalidar"]')) fail('calidad('+rol+'): acciones de una invalidada');
    if(!/Invalidada/.test(inv[0].querySelector('.badge').textContent)) fail('calidad('+rol+'): el estado debe decirse con texto');
  }
  sel.value = 'sospechosa'; sel.dispatchEvent(new w.Event('change', {bubbles:true})); await sleep(200);

  // Invalidar: el motivo es obligatorio; cancelar no llama a la RPC
  $('#cal-contenido [data-action="calidad-invalidar"]').click(); await sleep(300);
  if(!$('#modal-calidad').classList.contains('show')) { fail('calidad('+rol+'): Invalidar no abrió el modal'); return; }
  if(!/Camión 01/.test($('#cal-sub').textContent)) fail('calidad('+rol+'): el modal no identifica la medición: '+$('#cal-sub').textContent);
  $('#cal-confirmar').click(); await sleep(200);
  if(!/motivo/i.test($('#cal-error').textContent)) fail('calidad('+rol+'): sin motivo debe avisar: '+$('#cal-error').textContent);
  if(!$('#modal-calidad').classList.contains('show')) fail('calidad('+rol+'): el modal no debe cerrarse sin motivo');
  $('#modal-calidad [data-action="calidad-cerrar"]').click(); await sleep(200);
  if($('#modal-calidad').classList.contains('show')) fail('calidad('+rol+'): Cancelar no cerró el modal');
  // Con motivo: llega a la RPC y avisa
  $('#cal-contenido [data-action="calidad-invalidar"]').click(); await sleep(200);
  $('#cal-motivo').value = 'Medidor descalibrado';
  $('#cal-confirmar').click(); await sleep(600);
  if($('#modal-calidad').classList.contains('show')) fail('calidad('+rol+'): el modal no se cerró tras invalidar');
  if($('#toast-msg').textContent !== 'Medición invalidada') fail('calidad('+rol+'): aviso tras invalidar: '+$('#toast-msg').textContent);
  $('#cal-contenido [data-action="calidad-revalidar"]').click(); await sleep(600);
  if($('#toast-msg').textContent !== 'Medición marcada como válida') fail('calidad('+rol+'): aviso tras revalidar: '+$('#toast-msg').textContent);
  $('.nav-item[data-view="inicio"]').click(); await sleep(400);
};

window.calidadDetalleFlow = async function(w, d, sleep, fail, log){
  var $ = function(s){ return d.querySelector(s); }, all = function(s){ return Array.prototype.slice.call(d.querySelectorAll(s)); };
  var txt = function(el){ return el.textContent.replace(/\s+/g, ' '); };
  var fx = w.__vehFx;
  // Detalle del Camión 01 (3 observaciones: 1 en revisión + 1 invalidada en P3, 1 en revisión en P2)
  $('.nav-item[data-view="vehiculos"]').click(); await sleep(500);
  var i = $('#search-vehiculos'); i.value = 'AB123CD'; i.dispatchEvent(new w.Event('input', {bubbles:true})); await sleep(150);
  i.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true})); await sleep(900);
  var cal = $('#vd-calidad');
  if(!/3 mediciones con observaciones/.test(txt(cal)) || !/2 en revisión · 1 invalidada/.test(txt(cal))) fail('calidad-detalle: indicador del vehículo: '+txt(cal));
  var det = cal.querySelector('details');
  if(!det || det.open) fail('calidad-detalle: el detalle debe estar cerrado al inicio');
  det.querySelector('summary').click(); await sleep(200);
  var filas = all('#vd-calidad .cal-fila');
  if(filas.length !== 3) fail('calidad-detalle: se esperaban 3 filas, hay '+filas.length);
  var inval = all('#vd-calidad .cal-fila.cal-invalidada');
  if(inval.length !== 1 || !inval[0].querySelector('.cal-valores.tachado')) fail('calidad-detalle: la invalidada debe verse tachada');
  if(inval.length && inval[0].querySelector('[data-action="calidad-invalidar"]')) fail('calidad-detalle: una invalidada no se invalida de nuevo');
  if(d.body.innerHTML.indexOf('<errónea>') !== -1) fail('calidad-detalle: motivo sin escapar');
  if(txt(cal).indexOf('Lectura <errónea> del medidor') === -1) fail('calidad-detalle: falta el motivo escapado');
  log.push('calidad-detalle='+txt(cal).slice(0, 140));

  // Panel de la rueda 3: sus 2 observaciones; la rueda 1 no tiene ninguna
  $('#vd-diagrama .vd-rueda[data-pos="3"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true})); await sleep(500);
  var panel = $('#vd-panel');
  if(txt(panel).indexOf('Calidad de las mediciones') === -1 || !/2 mediciones con observaciones/.test(txt(panel))) fail('calidad-detalle: el panel de P3 no indica sus observaciones');
  if(all('#vd-panel .cal-fila').length !== 2) fail('calidad-detalle: el panel de P3 debe listar 2 mediciones, lista '+all('#vd-panel .cal-fila').length);

  // Invalidar desde el panel: motivo obligatorio
  var btn = all('#vd-panel .cal-fila:not(.cal-invalidada) [data-action="calidad-invalidar"]')[0];
  if(!btn) { fail('calidad-detalle: falta el botón Invalidar'); return; }
  btn.click(); await sleep(300);
  if(!$('#modal-calidad').classList.contains('show')) { fail('calidad-detalle: Invalidar no abrió el modal'); return; }
  $('#cal-confirmar').click(); await sleep(200);
  if(!/motivo/i.test($('#cal-error').textContent) || fx.calRpcs.length) fail('calidad-detalle: sin motivo no debe llegar a la RPC');
  // Error de permiso: el mensaje es el de la guía y el modal sigue abierto
  var ce = w.console.error; w.console.error = function(){};   // el error esperado se registra con console.error
  fx.calError = {code:'42501', message:'permiso denegado'};
  $('#cal-motivo').value = 'Medidor descalibrado';
  $('#cal-confirmar').click(); await sleep(400);
  w.console.error = ce;
  if($('#cal-error').textContent !== 'Sin permiso para modificar esta medición') fail('calidad-detalle: error de permiso: '+$('#cal-error').textContent);
  if(!$('#modal-calidad').classList.contains('show')) fail('calidad-detalle: el modal debe seguir abierto ante un error');
  fx.calError = null; fx.calRpcs.length = 0;
  $('#cal-confirmar').click(); await sleep(900);
  if($('#modal-calidad').classList.contains('show')) fail('calidad-detalle: el modal no se cerró');
  var r = fx.calRpcs[0];
  if(!r || r.name !== 'medicion_invalidar' || r.args.p_medicion_id !== 9001 || r.args.p_motivo !== 'Medidor descalibrado') fail('calidad-detalle: RPC de invalidar: '+JSON.stringify(fx.calRpcs));
  // Recarga: el panel sigue abierto, el detalle desplegado y ahora hay 2 invalidadas
  if(!/1 en revisión · 2 invalidadas/.test(txt($('#vd-calidad')))) fail('calidad-detalle: indicador tras invalidar: '+txt($('#vd-calidad')));
  if(!$('#vd-calidad details').open) fail('calidad-detalle: el detalle debe seguir desplegado tras la acción');
  if(!$('#vd-panel').classList.contains('abierto')) fail('calidad-detalle: el panel debe seguir abierto');
  if(all('#vd-panel .cal-fila.cal-invalidada').length !== 2) fail('calidad-detalle: P3 debe tener 2 invalidadas');

  // Marcar como válida: sale de la lista de observaciones
  var rev = all('#vd-panel .cal-fila.cal-invalidada [data-action="calidad-revalidar"]')[0];
  rev.click(); await sleep(900);
  var r2 = fx.calRpcs[1];
  if(!r2 || r2.name !== 'medicion_revalidar') fail('calidad-detalle: RPC de revalidar: '+JSON.stringify(fx.calRpcs));
  if(!/2 mediciones con observaciones/.test(txt($('#vd-calidad')))) fail('calidad-detalle: indicador tras revalidar: '+txt($('#vd-calidad')));
  if($('#toast-msg').textContent !== 'Medición marcada como válida') fail('calidad-detalle: aviso tras revalidar: '+$('#toast-msg').textContent);

  $('#vd-diagrama .vd-rueda[data-pos="1"]').dispatchEvent(new w.MouseEvent('click', {bubbles:true})); await sleep(400);
  if(txt($('#vd-panel')).indexOf('Calidad de las mediciones') !== -1) fail('calidad-detalle: una rueda sin observaciones no debe mostrar la sección');
  $('#vd-panel [data-action="detalleCerrarPanel"]').click(); await sleep(200);
  var q = fx.queries.join(',');
  if(q.indexOf('mediciones#calidad') === -1) fail('calidad-detalle: no consultó las mediciones con observaciones');
  $('[data-action="detalleVolver"]').click(); await sleep(500);
};
