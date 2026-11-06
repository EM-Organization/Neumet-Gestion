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
  log.push('ciclo-flow: writes=' + fx.writes.length);
  $('[data-action="closeCicloVida"]').click(); await sleep(100);
  if($('#modal-ciclo').classList.contains('show')) fail('ciclo: modal no cerrado');
  $('[data-action="closeNeumaticosModal"]').click(); await sleep(100);
};
