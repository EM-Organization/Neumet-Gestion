// Recorrido de humo del cambio de neumático en el taller (admin y cliente). Lo invoca harness.html:
// await window.cambioFlow(w, d, sleep, fail, log). Usa el contrato del botón del detalle de vehículo:
// data-action="neumatico-cambiar" data-vehiculo-id data-posicion (aquí un botón sintético).
window.cambioFlow = async function(w, d, sleep, fail, log){
  var fx = w.__cicloFx, $ = function(s){ return d.querySelector(s); };
  var cambios = function(){ return fx.rpcs.filter(function(r){ return r.name === 'neumatico_cambiar'; }); };
  var base = cambios().length, evento = 0;
  d.addEventListener('neumet:neumatico-cambiado', function(){ evento++; });
  var btn = d.createElement('button');
  btn.setAttribute('data-action', 'neumatico-cambiar'); btn.setAttribute('data-vehiculo-id', '10'); btn.setAttribute('data-posicion', '1');
  d.body.appendChild(btn);
  btn.click(); await sleep(600);
  var modal = $('#modal-cambio');
  if(!modal || !modal.classList.contains('show')){ fail('cambio: el modal no se abrió'); btn.remove(); return; }
  if($('#cambio-actual').textContent.indexOf('P1') === -1) fail('cambio: no muestra el neumático actual');
  if($('#cambio-actual').innerHTML.indexOf('<MultiWay>') !== -1) fail('cambio: HTML sin escapar');
  if(d.querySelectorAll('input[name="cambio-destino"]').length !== 4) fail('cambio: faltan los 4 destinos');
  if(!$('#cambio-stock').options.length) fail('cambio: no lista el stock del cliente');
  if(!$('#cambio-resumen').textContent) fail('cambio: sin resumen');

  // Validación local: baja sin motivo no llama a la RPC
  $('#cambio-motivo').value = '';
  $('#cambio-confirmar').click(); await sleep(200);
  if(cambios().length !== base) fail('cambio: baja sin motivo llegó a la RPC');
  if(!$('#cambio-error').textContent) fail('cambio: sin mensaje de validación');
  $('#cambio-motivo').value = 'Desgaste';

  // Error de la RPC: mensaje comprensible, el modal sigue abierto, ningún éxito
  var ce = w.console.error; w.console.error = function(){};
  fx.rpcError = {code: '55000', message: 'sin unidades en el stock seleccionado'};
  $('#cambio-confirmar').click(); await sleep(300);
  w.console.error = ce; fx.rpcError = null;
  if(cambios().length !== base + 1) fail('cambio: el intento con error no llamó a la RPC');
  if($('#toast-msg').textContent.indexOf('No quedan unidades') === -1) fail('cambio: error no traducido: ' + $('#toast-msg').textContent);
  if(!modal.classList.contains('show')) fail('cambio: el modal se cerró pese al error');
  if(evento) fail('cambio: se notificó éxito pese al error');
  if($('#cambio-confirmar').disabled) fail('cambio: el botón quedó bloqueado tras el error');

  // Éxito con neumático nuevo ingresado y odómetro
  var rn = d.querySelector('input[name="cambio-origen"][value="nuevo"]'); rn.click(); await sleep(100);
  $('#cambio-marca').value = 'Pirelli <b>'; $('#cambio-modelo').value = 'FR85'; $('#cambio-odo').value = '1200';
  $('#cambio-confirmar').click(); await sleep(400);
  var cs = cambios();
  if(cs.length !== base + 2) { fail('cambio: no se llamó a la RPC en el éxito'); btn.remove(); return; }
  var a = cs[cs.length - 1].args;
  if(a.p_vehiculo_id !== 10 || a.p_posicion !== 1 || a.p_destino_viejo !== 'baja' || a.p_motivo !== 'Desgaste' ||
     a.p_odometro_km !== 1200 || a.p_stock_id !== null || !a.p_nuevo || a.p_nuevo.marca !== 'Pirelli <b>' || a.p_nuevo.modelo !== 'FR85') fail('cambio: args de la RPC: ' + JSON.stringify(a));
  if(modal.classList.contains('show')) fail('cambio: el modal no se cerró tras el éxito');
  if($('#toast-msg').textContent.indexOf('Cambio registrado') === -1) fail('cambio: falta el aviso de éxito');
  if(evento !== 1) fail('cambio: no se emitió el evento de refresco');
  log.push('cambio-flow: rpcs=' + cambios().length);
  btn.remove();
};
