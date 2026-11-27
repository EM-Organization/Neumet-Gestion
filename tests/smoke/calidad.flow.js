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
  if(!cliMode){
    // F10 PR 10: el equipo Neumet ve las mediciones en revisión sin poder invalidarlas ni validarlas (las RPC son de la empresa).
    ['En revisión','Camión 01','mm'].forEach(function(t){ if(t0.indexOf(t) === -1) fail('calidad(admin): fila sin «'+t+'»: '+t0); });
    if(all('#cal-contenido [data-action="calidad-invalidar"], #cal-contenido [data-action="calidad-corregir"], #cal-contenido [data-action="calidad-revalidar"], #cal-contenido .cal-acciones').length) fail('calidad(admin): ofrece Invalidar o Marcar como válida al equipo Neumet');
    if(/Invalidar|Marcar como válida/.test(txt($('#cal-contenido')))) fail('calidad(admin): textos de acciones de escritura en la lista');
    // Guarda propia de cada acción: un botón ajeno con el mismo data-action no abre el modal ni llama a la RPC.
    var falsos = [['calidad-invalidar', '[9001]'], ['calidad-confirmar', '[]'], ['calidad-revalidar', '[9001]']];
    for(var i = 0; i < falsos.length; i++){
      var f = d.createElement('button'); f.type = 'button'; f.setAttribute('data-action', falsos[i][0]); f.setAttribute('data-args', falsos[i][1]);
      d.body.appendChild(f);
      if(falsos[i][0] === 'calidad-confirmar'){ $('#cal-motivo').value = 'Medidor descalibrado'; }
      f.click(); await sleep(400); f.remove();
      if($('#modal-calidad').classList.contains('show')) fail('calidad(admin): '+falsos[i][0]+' abrió el modal para el equipo Neumet');
    }
    // Corregir tampoco abre su modal para el equipo Neumet (la acción no se ofrece y la guarda la impide).
    var fc = d.createElement('button'); fc.type = 'button'; fc.setAttribute('data-action', 'calidad-corregir'); fc.setAttribute('data-args', '[9001]');
    d.body.appendChild(fc); fc.click(); await sleep(400); fc.remove();
    if($('#modal-corregir').classList.contains('show')) fail('calidad(admin): calidad-corregir abrió el modal para el equipo Neumet');
    var esc = ((w.__flotaFx && w.__flotaFx.rpcs) || []).filter(function(r){ return /^medicion_(invalidar|revalidar|corregir)$/.test(r[0]); });
    if(esc.length) fail('calidad(admin): el equipo Neumet llamó RPC de escritura: '+JSON.stringify(esc));
    log.push('calidad(admin): solo lectura');
    $('.nav-item[data-view="inicio"]').click(); await sleep(400);
    return;
  }
  ['En revisión','Camión 01','Corregir','Invalidar','Marcar como válida','mm'].forEach(function(t){ if(t0.indexOf(t) === -1) fail('calidad('+rol+'): fila sin «'+t+'»: '+t0); });
  if(all('#cal-contenido .cal-valores.tachado').length) fail('calidad('+rol+'): una medición en revisión no debe tacharse');
  log.push('calidad('+rol+'): '+t0.slice(0, 120));

  // Invalidadas: atenuadas y tachadas, sin «Invalidar»
  var sel = $('#cal-filtro'); sel.value = 'invalidada'; sel.dispatchEvent(new w.Event('change', {bubbles:true})); await sleep(200);
  var inv = all('#cal-contenido .cal-fila');
  if(inv.length !== 1 || !inv[0].classList.contains('cal-invalidada')) fail('calidad('+rol+'): se esperaba 1 invalidada');
  else {
    if(!inv[0].querySelector('.cal-valores.tachado')) fail('calidad('+rol+'): la invalidada debe verse tachada');
    if(txt(inv[0]).indexOf('Motivo: Lectura errónea del medidor') === -1) fail('calidad('+rol+'): falta el motivo: '+txt(inv[0]));
    if(inv[0].querySelector('[data-action="calidad-invalidar"]') || inv[0].querySelector('[data-action="calidad-corregir"]') || !inv[0].querySelector('[data-action="calidad-revalidar"]')) fail('calidad('+rol+'): acciones de una invalidada');
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

  // Corregir huellas (F8 ola 4): el modal trae las huellas, avisa antes de llegar a la base y envía una sola vez.
  // flota.fixture.js responde a medicion_* antes que el stub y registra [nombre, args] en __flotaFx.rpcs: de ahí se leen las llamadas.
  var corregirRpcs = function(){ return (w.__flotaFx && w.__flotaFx.rpcs) || []; };
  var llamadas = function(){ return corregirRpcs().filter(function(r){ return r[0] === 'medicion_corregir'; }); };
  var vaciarRpcs = function(){ corregirRpcs().length = 0; };
  var setMotivo = function(v){ $('#corr-motivo').value = v; $('#corr-motivo').dispatchEvent(new w.Event('change', {bubbles:true})); };
  vaciarRpcs();
  $('#cal-contenido [data-action="calidad-corregir"][data-args="[9001]"]').click(); await sleep(400);
  if(!$('#modal-corregir').classList.contains('show')) { fail('calidad('+rol+'): Corregir no abrió el modal'); return; }
  if(!/Camión 01/.test($('#corr-sub').textContent)) fail('calidad('+rol+'): el modal no identifica la medición: '+$('#corr-sub').textContent);
  if($('#corr-mm1').value !== '9,8' || $('#corr-mm2').value !== '9,8' || $('#corr-mm3').value !== '9,8') fail('calidad('+rol+'): el modal no trae las huellas: '+[$('#corr-mm1').value, $('#corr-mm2').value, $('#corr-mm3').value].join(' '));
  var motivos = all('#corr-motivo option').map(function(o){ return o.value; }).join('|');
  if(motivos !== '|error_calibre|huella_mal_tomada|carga_manual|otro') fail('calidad('+rol+'): motivos de corrección: '+motivos);
  $('#modal-corregir [data-action="calidad-corregir-cerrar"]').click(); await sleep(200);
  if($('#modal-corregir').classList.contains('show')) fail('calidad('+rol+'): Cancelar no cerró la corrección');
  $('#cal-contenido [data-action="calidad-corregir"][data-args="[9001]"]').click(); await sleep(300);
  // Antes de la base: sin motivo, sin cambios, decimal de más, «otro» sin texto. Ninguna llega a la RPC.
  $('#corregir-form').requestSubmit(); await sleep(200);
  if(!/Elegir el motivo/.test($('#corr-error').textContent) || llamadas().length) fail('calidad('+rol+'): sin motivo debe avisar sin llamar: '+$('#corr-error').textContent);
  setMotivo('error_calibre');
  $('#corregir-form').requestSubmit(); await sleep(200);
  if(!/Sin cambios en las huellas/.test($('#corr-error').textContent) || llamadas().length) fail('calidad('+rol+'): sin cambios debe avisar sin llamar: '+$('#corr-error').textContent);
  $('#corr-mm1').value = '8,25'; $('#corregir-form').requestSubmit(); await sleep(200);
  if(!/Máximo un decimal/.test($('#corr-error').textContent) || llamadas().length) fail('calidad('+rol+'): 8,25 debe avisar máximo un decimal: '+$('#corr-error').textContent);
  $('#corr-mm1').value = '9,5'; setMotivo('otro');
  if($('#corr-motivo-texto-wrap').style.display === 'none') fail('calidad('+rol+'): con «otro» debe verse el texto del motivo');
  $('#corregir-form').requestSubmit(); await sleep(200);
  if(!/Escribir el motivo/.test($('#corr-error').textContent) || llamadas().length) fail('calidad('+rol+'): «otro» sin texto debe avisar sin llamar: '+$('#corr-error').textContent);
  // Enter mantenido (e.repeat) se ignora en el formulario
  var rep = new w.KeyboardEvent('keydown', {key:'Enter', repeat:true, bubbles:true, cancelable:true});
  $('#corr-mm1').dispatchEvent(rep);
  if(!rep.defaultPrevented) fail('calidad('+rol+'): Enter mantenido debe ignorarse');
  // Recarga de la lista con el modal abierto: lo escrito no se pierde
  setMotivo('error_calibre');
  $('#cal-contenido [data-action="calidad-revalidar"][data-args="[9002]"]').click(); await sleep(500);
  if(!$('#modal-corregir').classList.contains('show') || $('#corr-mm1').value !== '9,5' || $('#corr-motivo').value !== 'error_calibre') fail('calidad('+rol+'): la recarga pisó lo escrito en la corrección');
  // Doble envío: dos envíos seguidos llegan a la base una sola vez
  $('#corregir-form').requestSubmit(); $('#corregir-form').requestSubmit(); await sleep(600);
  var c1 = llamadas();
  if(c1.length !== 1) fail('calidad('+rol+'): doble envío: se esperaba 1 RPC, hay '+c1.length);
  else {
    var a = c1[0][1];
    if(a.p_medicion_id !== 9001 || a.p_mm1 !== 9.5 || a.p_mm2 !== 9.8 || a.p_mm3 !== 9.8 || a.p_motivo_codigo !== 'error_calibre' || a.p_motivo_texto !== null) fail('calidad('+rol+'): argumentos de medicion_corregir: '+JSON.stringify(a));
  }
  if($('#modal-corregir').classList.contains('show')) fail('calidad('+rol+'): el modal no se cerró tras corregir');
  if($('#toast-msg').textContent !== 'Medición corregida') fail('calidad('+rol+'): aviso tras corregir: '+$('#toast-msg').textContent);
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
  $('#breadcrumb-parent').click(); await sleep(500);
};
