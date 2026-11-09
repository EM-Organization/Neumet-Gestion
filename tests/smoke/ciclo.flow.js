// Recorrido de humo de odómetro y ciclo de vida (admin). Lo invoca harness.html: await window.cicloFlow(w, d, sleep, fail, log)
window.cicloFlow = async function(w, d, sleep, fail, log){
  var fx = w.__cicloFx, $ = function(s){ return d.querySelector(s); };
  var writes = function(t, op){ return fx.writes.filter(function(x){ return x.table === t && (!op || x.op === op); }); };
  function setv(sel, v){ $(sel).value = v; }
  $('.nav-item[data-view="vehiculos"]').click(); await sleep(500);
  var nb = $('#tbody-vehiculos [data-va="neum"]');
  if(!nb){ fail('ciclo: sin botón neumáticos'); return; }
  nb.click(); await sleep(500);
  var b = $('[data-action="cicloDesdeNeum"]');
  if(!b){ fail('ciclo: falta botón Odómetro y ciclo de vida'); return; }
  b.click(); await sleep(500);
  if(!$('#modal-ciclo').classList.contains('show')) { fail('ciclo: modal no abierto'); return; }
  var cb = $('#modal-ciclo [data-action="neumatico-cambiar"]');
  if(!cb || cb.getAttribute('data-vehiculo-id') !== '10' || !cb.getAttribute('data-posicion')) fail('ciclo: falta el botón Cambiar neumático (punto de entrada temporal)');

  // Sin etiquetas «P<n>»: las posiciones salen con nombre y, en la tabla de km, con mini vehículo
  var opts = Array.prototype.map.call(d.querySelectorAll('#modal-ciclo select option'), function(o){ return o.textContent; }).join(' | ');
  if(/(^|[ |])P\d/.test(opts)) fail('ciclo: opciones con etiqueta «P<n>»: ' + opts);
  if(!/Delantera izquierda|Eje \d/.test(opts)) fail('ciclo: las opciones de neumático no nombran la posición: ' + opts);
  var kmT = $('#ciclo-km');
  if(kmT.querySelector('table')){
    if(!kmT.querySelector('.pos-mini .mini-veh .mv-dest')) fail('ciclo: la tabla de km no muestra el mini vehículo con la rueda resaltada');
    if(/(^|\s)P\d/.test(kmT.textContent)) fail('ciclo: la tabla de km conserva «P<n>»: ' + kmT.textContent.slice(0, 120));
    if(kmT.querySelectorAll('.mini-veh').length !== kmT.querySelectorAll('tbody tr:not(.ciclo-km-nota)').length) fail('ciclo: un mini vehículo por neumático');
    // Km por cubierta (v_km_cubierta): total y tramo actual; nota de confiabilidad solo donde faltan lecturas; «Sin dato», nunca 0
    var kmRows = kmT.querySelectorAll('tbody tr:not(.ciclo-km-nota)'), notas = Array.prototype.map.call(kmT.querySelectorAll('tr.ciclo-km-nota'), function(r){ return r.textContent.trim(); }), kmTxt = function(i){ return kmRows[i] ? kmRows[i].textContent.replace(/\s+/g, ' ') : ''; };
    if(kmT.querySelector('thead').textContent.indexOf('Km recorridos') === -1 || kmT.querySelector('thead').textContent.indexOf('En el tramo actual') === -1) fail('ciclo: la tabla de km sin columnas Km recorridos y En el tramo actual');
    if(kmTxt(0).indexOf('4.000 km') === -1 || kmTxt(0).indexOf('19.000 km') === -1 || /Sin dato/.test(kmTxt(0))) fail('ciclo: fila con datos completos: ' + kmTxt(0))
    if(notas.length !== 2) fail('ciclo: solo las filas con km no confiables llevan nota (' + notas.length + ')');
    if(kmTxt(1).indexOf('1.200 km') === -1 || notas.indexOf('Estimado: faltan lecturas de odómetro') === -1) fail('ciclo: fila estimada sin la nota de confiabilidad: ' + kmTxt(1) + ' / ' + notas.join('|'));
    var c2 = kmRows[2] ? Array.prototype.map.call(kmRows[2].querySelectorAll('td'), function(td){ return td.textContent.trim(); }) : [];
    if(c2[5] !== 'Sin dato' || c2[6] !== 'Sin dato' || c2[7] !== 'Sin dato' || notas.indexOf('Sin dato: faltan lecturas de odómetro') === -1) fail('ciclo: fila sin datos debe decir «Sin dato» (no 0 km): ' + JSON.stringify(c2));
  }
  // Costo y costo por km (v_costo_cubierta): confiable, estimado y sin costos; acción «Registrar costo» por neumático
  var cT = $('#ciclo-costo');
  if($('#ciclo-costo-wrap').hidden) fail('ciclo: sección de costos oculta para quien puede verlos');
  if(cT.querySelector('table')){
    var cTxt = cT.textContent.replace(/\s+/g, ' ');
    if(cTxt.indexOf('UYU 1.900,00') === -1 || cTxt.indexOf('UYU 0,475 por km') === -1) fail('ciclo: costo y CPK confiables: ' + cTxt);
    if(cTxt.indexOf('UYU 0,500 por km') === -1 || cTxt.indexOf('Estimado: faltan lecturas de odómetro') === -1) fail('ciclo: CPK estimado sin la nota: ' + cTxt);
    if(cTxt.indexOf('Sin costos registrados') === -1) fail('ciclo: neumático sin costos: ' + cTxt);
    if(!cT.querySelector('[data-action="cicloRegistrarCosto"]')) fail('ciclo: falta «Registrar costo»');
  }
  var dlg = function(tag, label, danger, icono){
    var ok = $('#confirm-ok'), ic = $('#confirm-icon');
    if(ok.textContent !== label) fail(tag + ': etiqueta del botón «' + ok.textContent + '», se esperaba «' + label + '»');
    if(ok.classList.contains('danger') !== danger || ok.classList.contains('primary') === danger) fail(tag + ': clase del botón ' + ok.className);
    if(ic.classList.contains('danger') !== danger) fail(tag + ': clase del icono ' + ic.className);
    var vis = Array.prototype.filter.call(ic.querySelectorAll('svg'), function(s){ return !s.hasAttribute('hidden'); }).map(function(s){ return s.dataset.icono; });
    if(vis.join() !== (danger ? 'papelera' : icono)) fail(tag + ': icono visible ' + vis.join());
  };
  // Odómetro: inválido no escribe; válido actualiza vehiculos
  setv('#ciclo-odo-input', '-5'); $('#ciclo-odo-save').click(); await sleep(150);
  if(writes('vehiculos').length) fail('ciclo: odómetro negativo llegó a la BD');
  setv('#ciclo-odo-input', '12.5'); $('#ciclo-odo-save').click(); await sleep(150);
  if(writes('vehiculos').length) fail('ciclo: odómetro decimal llegó a la BD');
  setv('#ciclo-odo-input', '5000'); $('#ciclo-odo-save').click(); await sleep(300);
  var vw = writes('vehiculos', 'update');
  if(vw.length !== 1 || vw[0].payload.odometro_km !== 5000 || !vw[0].payload.odometro_actualizado_at) fail('ciclo: no se guardó el odómetro: ' + JSON.stringify(vw));
  if($('#ciclo-odo-val').textContent.indexOf('5') === -1) fail('ciclo: odómetro no se refleja');
  // Bajar el odómetro pide confirmación; cancelar no escribe
  setv('#ciclo-odo-input', '100'); $('#ciclo-odo-save').click(); await sleep(200);
  if(!$('#modal-confirm').classList.contains('show')) fail('ciclo: bajar odómetro no pidió confirmación');
  dlg('ciclo odómetro', 'Continuar', false, 'info');
  $('#confirm-cancel').click(); await sleep(150);
  if(writes('vehiculos', 'update').length !== 1) fail('ciclo: odómetro bajó sin confirmar');

  // Eventos: inspección (solo evento), baja sin motivo (rechazada), baja con motivo (patch + evento)
  setv('#ciclo-tipo', 'inspeccion'); $('#ciclo-tipo').dispatchEvent(new w.Event('change', {bubbles: true}));
  setv('#ciclo-ev-odo', '5000'); $('#ciclo-ev-save').click(); await sleep(300);
  var ev = writes('eventos_neumatico', 'insert');
  if(ev.length !== 1 || ev[0].payload[0].tipo !== 'inspeccion' || ev[0].payload[0].odometro_km !== 5000) fail('ciclo: evento de inspección: ' + JSON.stringify(ev));
  if(writes('neumaticos').length) fail('ciclo: la inspección modificó neumaticos');
  setv('#ciclo-tipo', 'baja'); $('#ciclo-tipo').dispatchEvent(new w.Event('change', {bubbles: true}));
  $('#ciclo-ev-save').click(); await sleep(200);
  if(writes('eventos_neumatico', 'insert').length !== 1) fail('ciclo: baja sin motivo registró evento');
  setv('#ciclo-baja-motivo', 'Corte lateral <b>'); $('#ciclo-ev-save').click(); await sleep(300);
  var nw = writes('neumaticos', 'update');
  if(nw.length !== 1 || nw[0].payload.estado !== 'baja' || nw[0].payload.motivo_baja !== 'Corte lateral <b>' || !nw[0].payload.fecha_baja) fail('ciclo: patch de baja: ' + JSON.stringify(nw));
  ev = writes('eventos_neumatico', 'insert');
  if(ev.length !== 2 || ev[1].payload[0].tipo !== 'baja') fail('ciclo: evento de baja');
  if($('#ciclo-timeline').innerHTML.indexOf('<b>') !== -1) fail('ciclo: HTML sin escapar en la línea de tiempo');
  // Rotación: intercambio P2<->P3 vía RPC atómica (sin UPDATE sueltos); un error de la RPC no da éxito
  var nWrites = fx.writes.length;
  setv('#ciclo-neum', '2'); setv('#ciclo-tipo', 'rotacion'); $('#ciclo-tipo').dispatchEvent(new w.Event('change', {bubbles: true}));
  setv('#ciclo-pos-dest', '3'); setv('#ciclo-ev-odo', '5100');
  var ce = w.console.error; w.console.error = function(){}; // el error esperado se registra en consola
  fx.rpcError = {code: 'P0002', message: 'no hay neumático'};
  $('#ciclo-ev-save').click(); await sleep(200);
  dlg('ciclo rotación', 'Rotar', false, 'intercambio');
  $('#confirm-ok').click(); await sleep(300);
  if(fx.rpcs.length !== 1) fail('ciclo: la rotación no llamó a la RPC: ' + JSON.stringify(fx.rpcs));
  if($('#toast-msg').textContent.indexOf('registrado') !== -1) fail('ciclo: éxito mostrado pese al error de la RPC');
  fx.rpcError = null; w.console.error = ce;
  $('#ciclo-ev-save').click(); await sleep(200);
  $('#confirm-ok').click(); await sleep(300);
  if(fx.rpcs.length !== 2) fail('ciclo: segunda rotación sin RPC');
  var ra = fx.rpcs[1] ? fx.rpcs[1].args : {};
  if(ra.p_vehiculo_id !== 10 || ra.p_pos_a !== 2 || ra.p_pos_b !== 3 || ra.p_odometro_km !== 5100) fail('ciclo: args de la RPC: ' + JSON.stringify(ra));
  if(fx.writes.length !== nWrites) fail('ciclo: la rotación hizo escrituras sueltas: ' + JSON.stringify(fx.writes.slice(nWrites)));
  if($('#toast-msg').textContent.indexOf('registrado') === -1) fail('ciclo: falta aviso de rotación registrada');
  log.push('ciclo-flow: writes=' + fx.writes.length);
  $('[data-action="closeCicloVida"]').click(); await sleep(100);
  if($('#modal-ciclo').classList.contains('show')) fail('ciclo: modal no cerrado');
  $('[data-action="closeNeumaticosModal"]').click(); await sleep(100);
};
