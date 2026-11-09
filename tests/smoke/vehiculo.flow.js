// Recorrido de humo de Vehículos como cliente: buscador (patente / número), detalle con diagrama de 10 ruedas coloreadas,
// panel de una rueda, contrato de acciones del taller. Lo invoca harness.html: await window.detalleFlow(w, d, sleep, fail, log)
window.detalleFlow = async function(w, d, sleep, fail, log){
  var $ = function(s){ return d.querySelector(s); }, all = function(s){ return d.querySelectorAll(s); };
  var escribir = function(v){ var i = $('#search-vehiculos'); i.value = v; i.dispatchEvent(new w.Event('input',{bubbles:true})); return i; };
  var enter = function(i){ i.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})); };
  var filas = function(){ return all('#veh-lista .veh-fila'); };

  $('.nav-item[data-view="vehiculos"]').click(); await sleep(600);
  if(!$('#view-vehiculos').classList.contains('active')) fail('detalle: vista Vehiculos no activa');
  // Cliente: sin ABM visible ni texto de relleno
  if($('#view-vehiculos .table-wrap').offsetParent !== null) fail('detalle: el cliente ve la tabla de administracion');
  if($('[data-action="openVehiculoModal"]').offsetParent !== null) fail('detalle: el cliente ve "Nuevo vehiculo"');
  if($('#veh-lista-wrap').offsetParent === null) fail('detalle: el cliente no ve la lista');
  log.push('veh-lista='+filas().length);
  if(filas().length !== 3) fail('detalle: se esperaban 3 vehiculos, hay '+filas().length);
  if(d.body.innerHTML.indexOf('<Crítica>') !== -1) fail('detalle: nombre sin escapar');
  if(!filas()[0].textContent.match(/Crítico/)) fail('detalle: la lista no pone primero al vehiculo mas urgente / sin chip: '+filas()[0].textContent);

  // Buscar por patente (parcial, sin mayusculas ni espacios)
  escribir('ab 12'); await sleep(100);
  if(filas().length !== 1 || filas()[0].textContent.indexOf('Camión 01') === -1) fail('detalle: busqueda parcial por patente');
  escribir('cr0001'); await sleep(100);
  if(filas().length !== 1 || filas()[0].textContent.indexOf('Crítica') === -1) fail('detalle: busqueda "cr0001" no halla "CR 0001"');
  escribir('cr-00 01'); await sleep(100);
  if(filas().length !== 1 || filas()[0].textContent.indexOf('Crítica') === -1) fail('detalle: busqueda con guion y espacio "cr-00 01" no halla "CR 0001"');
  // Por numero de coche: "7" coincide con 07 y 7; la exacta (Tractor) va primero
  escribir('7'); await sleep(100);
  if(filas().length !== 2 || filas()[0].textContent.indexOf('Tractor') === -1) fail('detalle: busqueda por numero, orden exacta primero');
  escribir('zzzz'); await sleep(100);
  if(filas().length !== 0 || !$('#veh-lista .empty-state')) fail('detalle: sin resultados deberia explicar que hacer');

  // Enter con una sola coincidencia exacta abre directo (patente)
  var inp = escribir('AB123CD'); await sleep(100);
  enter(inp); await sleep(900);
  if(!$('#view-vehiculo-detalle').classList.contains('active')) { fail('detalle: Enter no abrio el detalle'); return; }

  // Cabecera
  var cab = $('#vd-cab').textContent;
  log.push('detalle-cab='+cab.replace(/\s+/g,' ').slice(0,120));
  ['Camión 01','AB123CD','07','123.456 km','Última medición'].forEach(function(t){ if(cab.indexOf(t) === -1) fail('detalle: cabecera sin "'+t+'"'); });

  // Diagrama: 10 ruedas coloreadas, con mm y simbolo
  var ruedas = all('#vd-diagrama .vd-rueda');
  log.push('ruedas='+ruedas.length);
  if(ruedas.length !== 10) fail('detalle: se esperaban 10 ruedas, hay '+ruedas.length);
  var fills = {};
  Array.prototype.forEach.call(ruedas, function(g){
    var f = g.querySelector('rect.vd-goma').getAttribute('fill'); fills[f] = 1;
    if(!g.querySelector('.vd-mm').textContent || !g.querySelector('.vd-sim').textContent) fail('detalle: rueda sin mm o simbolo');
    if(g.getAttribute('tabindex') !== '0' || g.getAttribute('role') !== 'button' || !g.getAttribute('aria-label')) fail('detalle: rueda no accesible');
  });
  log.push('colores='+Object.keys(fills).length);
  if(Object.keys(fills).length < 5) fail('detalle: la escala deberia dar varios colores, hay '+Object.keys(fills).length);
  if(!fills['url(#vd-sin-datos)']) fail('detalle: la rueda sin datos deberia tener patron');
  if(all('#vd-diagrama .vd-alerta-disco').length < 1) fail('detalle: falta marca de desgaste mayor al normal');
  if(!$('#vd-leyenda .vd-escala-barra') || all('#vd-leyenda .vd-escala-marcas span').length !== 3 || all('#vd-leyenda .vd-leyenda-item').length < 2) fail('detalle: leyenda incompleta');

  // Panel de la rueda 3 (critica, desgaste por encima de lo normal) con el teclado
  var r3 = $('#vd-diagrama .vd-rueda[data-pos="3"]');
  r3.focus();
  r3.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})); await sleep(500);
  var panel = $('#vd-panel').textContent;
  log.push('panel='+panel.replace(/\s+/g,' ').slice(0,160));
  if(!$('#vd-panel').classList.contains('abierto')) fail('detalle: el panel no se abrio');
  if(r3.getAttribute('aria-pressed') !== 'true') fail('detalle: rueda seleccionada sin aria-pressed');
  if(d.activeElement !== $('#vd-panel-titulo')) fail('detalle: el foco no paso al panel');
  ['Posición 3','Eje 2 · izquierda externa','Crítico','Desgaste mayor al normal','Interno','4,2','Alertas','Neumático crítico','Rotación'].forEach(function(t){
    if(panel.indexOf(t) === -1) fail('detalle: panel sin "'+t+'"');
  });
  if(panel.indexOf('1,20 mm por semana') === -1) fail('detalle: panel sin tasa');
  // Número de quema y km del neumático (v_km_cubierta): previos 20.000 + tramo actual 3.456 (123.456 - 120.000 del montaje) = 23.456
  ['Número de quema','Q-0103','Km que ya traía','20.000 km','Km recorridos','3.456 km','En el tramo actual','Km totales','23.456 km'].forEach(function(t){
    if(panel.indexOf(t) === -1) fail('detalle: panel sin "'+t+'"');
  });
  if(/Estimado|Sin dato/.test(panel)) fail('detalle: km confiables no deberían llevar nota: '+panel.replace(/\s+/g,' ').slice(0,300));
  if(d.body.innerHTML.indexOf('<programada>') !== -1) fail('detalle: evento sin escapar');
  for(var t = 0; t < 40 && !$('#vd-chart-wrap svg'); t++) await sleep(50);
  var ch = $('#vd-chart-wrap svg');
  if(!ch) fail('detalle: no se dibujo el grafico');
  else {
    log.push('grafico-puntos='+ch.querySelectorAll('circle').length+' proy='+ch.querySelectorAll('.vd-g-proy').length);
    if(ch.querySelectorAll('circle').length !== 10) fail('detalle: el grafico deberia tener 10 puntos');
    if(ch.querySelectorAll('.vd-g-umbral').length !== 3) fail('detalle: faltan lineas de umbral');
    if(ch.querySelectorAll('.vd-g-proy').length !== 1) fail('detalle: falta la proyeccion punteada');
  }

  // Contrato con el taller: botones presentes con data-*; handlers REALES de cambio-neumatico.js (no un stub)
  var rpcs = function(n){ return w.__cicloFx.rpcs.filter(function(r){ return r.name === n; }); };
  var bc = $('#vd-panel [data-action="neumatico-cambiar"]'), br = $('#vd-panel [data-action="neumatico-rotar-pos"]');
  if(!bc || !br) { fail('detalle: faltan botones Cambiar/Rotar'); }
  else {
    if(bc.dataset.vehiculoId !== '10' || bc.dataset.posicion !== '3') fail('detalle: data-* del boton Cambiar incorrectos');
    if(br.dataset.vehiculoId !== '10' || br.dataset.posicion !== '3') fail('detalle: data-* del boton Rotar incorrectos');
    if(!$('#vd-panel label[for="vd-rotar-destino"]')) fail('detalle: el select de destino no tiene etiqueta');
    var sel = $('#vd-rotar-destino');
    if(sel.querySelector('option[value="3"]')) fail('detalle: el destino no deberia incluir la propia posicion');
    // Sin destino elegido: no llama a la RPC y avisa
    br.click(); await sleep(200);
    if(rpcs('neumatico_rotar').length) fail('detalle: rotar sin destino llego a la RPC');
    if($('#toast-msg').textContent.indexOf('Elegir la posición') === -1) fail('detalle: rotar sin destino deberia avisar');
    // Rotar 3 con 1 (ambas ocupadas: intercambio con confirmacion)
    sel.value = '1'; sel.dispatchEvent(new w.Event('change',{bubbles:true}));
    if(br.dataset.args !== '[10,3,1]') fail('detalle: data-args de Rotar incorrectos: '+br.dataset.args);
    br.click(); await sleep(400);
    if(!$('#modal-confirm').classList.contains('show')) fail('detalle: el handler real no pidio confirmar el intercambio');
    else {
      var cok = $('#confirm-ok');
      if(cok.textContent !== 'Rotar' || cok.classList.contains('danger') || !cok.classList.contains('primary')) fail('detalle: el intercambio debe confirmarse con «Rotar» sin rojo: ' + cok.textContent + ' / ' + cok.className);
      if($('#confirm-icon').classList.contains('danger') || $('#confirm-icon').querySelector('svg:not([hidden])').dataset.icono !== 'intercambio') fail('detalle: el intercambio muestra la papelera');
      cok.click(); await sleep(400);
    }
    var rot = rpcs('neumatico_rotar');
    if(rot.length !== 1) fail('detalle: la rotacion no llego a la RPC real ('+rot.length+')');
    else if(JSON.stringify([rot[0].args.p_vehiculo_id, rot[0].args.p_pos_a, rot[0].args.p_pos_b]) !== '[10,3,1]') fail('detalle: args de rotar: '+JSON.stringify(rot[0].args));
    for(var u = 0; u < 20 && $('#vd-panel-body').children.length === 0; u++) await sleep(50);
    // Cambiar: abre el modal real del taller con el neumatico de P3
    r3 = $('#vd-diagrama .vd-rueda[data-pos="3"]');
    r3.dispatchEvent(new w.MouseEvent('click',{bubbles:true})); await sleep(400);
    $('#vd-panel [data-action="neumatico-cambiar"]').click(); await sleep(700);
    if(!$('#modal-cambio').classList.contains('show')) fail('detalle: Cambiar no abrio el modal real');
    else {
      if($('#cambio-actual').textContent.indexOf('P3') === -1) fail('detalle: el modal de cambio no es de P3');
      $('#cambio-motivo').value = 'Desgaste';
      $('#cambio-confirmar').click(); await sleep(600);
      var cam = rpcs('neumatico_cambiar');
      if(cam.length !== 1 || cam[0].args.p_vehiculo_id !== 10 || cam[0].args.p_posicion !== 3) fail('detalle: el cambio no llego a la RPC real: '+JSON.stringify(cam.map(function(c){ return c.args; })));
      if($('#modal-cambio').classList.contains('show')) fail('detalle: el modal de cambio no se cerro');
    }
    // Sin accion registrada: aviso en vez de error (se quita temporalmente el handler real)
    var AC = (await (new w.Function('return import("/assets/js/core/actions.js")'))()).ACTIONS;
    var orig = AC['neumatico-cambiar']; delete AC['neumatico-cambiar'];
    r3.dispatchEvent(new w.MouseEvent('click',{bubbles:true})); await sleep(300);
    $('#vd-panel [data-action="neumatico-cambiar"]').click(); await sleep(200);
    AC['neumatico-cambiar'] = orig;
    if($('#toast-msg').textContent !== 'No disponible') fail('detalle: sin accion registrada deberia decir "No disponible"');
  }

  // Escape cierra el panel y devuelve el foco a la rueda
  d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await sleep(200);
  if($('#vd-panel').classList.contains('abierto') || $('#vd-diagrama .vd-rueda.sel')) fail('detalle: Escape no cerro el panel');
  if(!d.activeElement || d.activeElement.dataset.pos !== '3') fail('detalle: el foco no volvio a la rueda');

  // Click en la rueda sin datos (5) y en una rueda normal
  $('#vd-diagrama .vd-rueda[data-pos="5"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true})); await sleep(300);
  if($('#vd-panel').textContent.indexOf('Sin registrar') === -1 || $('#vd-panel').textContent.indexOf('Sin dato: faltan lecturas de odómetro') === -1) fail('detalle: rueda sin quema ni odómetro deberia decirlo');
  if(/(^|[^\d.])0 km/.test($('#vd-panel-body').textContent.split('Km recorridos')[1] || '')) fail('detalle: sin lecturas no debe mostrar 0 km: '+$('#vd-panel-body').textContent.replace(/\s+/g,' ').slice(0,300));
  // Estimado (falta un tramo) y odómetro decreciente: nota sobria con el motivo, el valor conocido se muestra
  $('#vd-diagrama .vd-rueda[data-pos="6"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true})); await sleep(300);
  if($('#vd-panel').textContent.indexOf('Estimado: faltan lecturas de odómetro') === -1 || $('#vd-panel').textContent.indexOf('9.000 km') === -1) fail('detalle: rueda con un tramo sin odómetro deberia mostrar la nota Estimado y 9.000 km');
  $('#vd-diagrama .vd-rueda[data-pos="7"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true})); await sleep(300);
  if($('#vd-panel').textContent.indexOf('Estimado: hay lecturas de odómetro decrecientes') === -1) fail('detalle: odómetro decreciente deberia indicarse');
  $('#vd-diagrama .vd-rueda[data-pos="5"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true})); await sleep(300);
  if($('#vd-panel').textContent.indexOf('todavía no tiene mediciones') === -1) fail('detalle: rueda sin datos deberia explicarlo');
  $('#vd-panel [data-action="detalleCerrarPanel"]').click(); await sleep(100);

  // Volver y buscar por numero de coche exacto ("112") -> vehiculo 12 con 10 ruedas
  $('[data-action="detalleVolver"]').click(); await sleep(700);
  if(!$('#view-vehiculos').classList.contains('active')) fail('detalle: Volver no regreso a Vehiculos');
  inp = escribir('112'); await sleep(100);
  enter(inp); await sleep(900);
  if(!$('#view-vehiculo-detalle').classList.contains('active') || $('#vd-cab').textContent.indexOf('Unidad') === -1) fail('detalle: Enter por numero de coche no abrio el vehiculo 12');

  // Vehiculo con auxilio (tipo 16): 16 ruedas en el chasis + auxilio fuera
  $('[data-action="detalleVolver"]').click(); await sleep(600);
  inp = escribir('zz999'); await sleep(100); enter(inp); await sleep(900);
  var n16 = all('#vd-diagrama .vd-rueda').length;
  log.push('ruedas-tipo16='+n16);
  if(n16 !== 17) fail('detalle: tipo 16 con auxilio deberia dibujar 17 ruedas, hay '+n16);
  if(!$('#vd-diagrama .vd-rueda[data-pos="99"]')) fail('detalle: falta el auxilio');

  // Buscador global: matrícula, número de coche y número de quema abren el vehículo (la quema, el de su neumático montado)
  var bg = $('#busq-global-input');
  var buscarGlobal = async function(txt, esperado, que){
    $('[data-action="detalleVolver"]').click(); await sleep(500);
    bg.value = txt; bg.dispatchEvent(new w.Event('input',{bubbles:true})); await sleep(400);
    bg.form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})); await sleep(900);
    if(!$('#view-vehiculo-detalle').classList.contains('active') || $('#vd-cab').textContent.indexOf(esperado) === -1) fail('detalle: el buscador global no abrió '+esperado+' por '+que+' ('+txt+')');
  };
  await buscarGlobal('Q1401', 'Tractor 16', 'quema (sin guion ni mayúsculas)');
  await buscarGlobal('cr 0001', 'Unidad', 'matrícula');
  await buscarGlobal('112', 'Unidad', 'número de coche');
  await buscarGlobal('q-0103', 'Camión 01', 'quema');

  await window.calidadDetalleFlow(w,d,sleep,fail,log); // indicador de confiabilidad, invalidar y marcar como válida
  var q = w.__vehFx.queries.join(',');
  if(q.indexOf('v_estado_neumaticos') === -1 || q.indexOf('v_alertas') === -1) fail('detalle: no consulto las vistas SQL');
  // El historial de la rueda sale del neumático montado (vista), no de mediciones por posición.
  if(q.indexOf('v_mediciones_neumatico') === -1 || /(^|,)mediciones(,|$)/.test(q)) fail('detalle: las mediciones deben leerse de v_mediciones_neumatico, no de mediciones por posicion');
  $('[data-action="detalleVolver"]').click(); await sleep(400);
  escribir('');
  // Capturas: ?end=detalle termina en el detalle del camión 01 con el panel de la rueda 3 abierto.
  if(/[?&]end=detalle/.test(w.parent.location.search)){
    enter(escribir('AB123CD')); await sleep(900);
    $('#vd-diagrama .vd-rueda[data-pos="3"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true})); await sleep(800);
  }
};
