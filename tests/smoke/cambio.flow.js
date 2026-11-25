// Recorrido de humo del cambio de neumático en el taller (cliente). Lo invoca harness.html:
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
  if($('#cambio-actual').textContent.indexOf('Delantera izquierda') === -1 || /\bP\d/.test($('#cambio-actual').textContent)) fail('cambio: no muestra el neumático actual con nombre de posición: '+$('#cambio-actual').textContent);
  if($('#cambio-actual').textContent.indexOf('Neumático nuevo') === -1 || /vida \d/.test($('#cambio-actual').textContent)) fail('cambio: «vida 0» y km sin formato: '+$('#cambio-actual').textContent);
  if($('#cambio-form').tagName !== 'FORM' || $('#cambio-confirmar').type !== 'submit') fail('cambio: el modal debe ser un formulario con envío por Enter');
  if($('#cambio-actual').innerHTML.indexOf('<MultiWay>') !== -1) fail('cambio: HTML sin escapar');
  if(d.querySelectorAll('input[name="cambio-destino"]').length !== 4) fail('cambio: faltan los 4 destinos');
  if(!$('#cambio-stock').options.length) fail('cambio: no lista el stock del cliente');
  if(!$('#cambio-resumen').textContent) fail('cambio: sin resumen');

  // Campos separados: km que ya traía el neumático (0 por defecto), número de quema y odómetro del vehículo (opcional)
  if($('#cambio-km-previos').value !== '0') fail('cambio: los km previos deben empezar en 0: ' + $('#cambio-km-previos').value);
  if($('#cambio-quema').value !== '') fail('cambio: la quema debe empezar vacía');
  if($('#cambio-odo').value !== '') fail('cambio: el odómetro del vehículo debe empezar vacío');
  if(!/Odómetro del vehículo/.test($('label[for="cambio-odo"]').textContent) || !/Km que ya traía/.test($('label[for="cambio-km-previos"]').textContent)) fail('cambio: etiquetas de km y odómetro');
  if($('#cambio-actual').textContent.indexOf('quema Q-7788') === -1) fail('cambio: no muestra la quema del neumático actual: ' + $('#cambio-actual').textContent);

  // Validación local: baja sin motivo no llama a la RPC
  $('#cambio-motivo').value = '';
  $('#cambio-confirmar').click(); await sleep(200);
  if(cambios().length !== base) fail('cambio: baja sin motivo llegó a la RPC');
  if(!$('#cambio-error').textContent) fail('cambio: sin mensaje de validación');
  $('#cambio-motivo').value = 'desgaste';

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

  // Ingreso manual (los campos de quema y km solo se validan para neumáticos que no vienen de una cubierta del stock)
  d.querySelector('input[name="cambio-origen"][value="nuevo"]').click(); await sleep(100);
  $('#cambio-marca').value = 'Pirelli';
  // Km previos inválidos: no llegan a la RPC
  var antes = cambios().length;
  $('#cambio-km-previos').value = '-5';
  $('#cambio-confirmar').click(); await sleep(200);
  if(cambios().length !== antes) fail('cambio: km previos negativos llegaron a la RPC');
  if($('#cambio-error').textContent.indexOf('km que ya traía') === -1) fail('cambio: mensaje de km previos: ' + $('#cambio-error').textContent);
  $('#cambio-quema').value = 'Q'.repeat(41);
  $('#cambio-km-previos').value = '0';
  $('#cambio-confirmar').click(); await sleep(200);
  if(cambios().length !== antes || $('#cambio-error').textContent.indexOf('hasta 40') === -1) fail('cambio: quema demasiado larga: ' + $('#cambio-error').textContent);
  // Quema repetida en la base: mensaje comprensible y el modal sigue abierto
  var ce2 = w.console.error; w.console.error = function(){};
  $('#cambio-quema').value = 'Q-7789';
  fx.rpcError = {code: '23505', message: 'el número de quema ya está registrado en otro neumático'};
  $('#cambio-confirmar').click(); await sleep(300);
  w.console.error = ce2; fx.rpcError = null;
  if($('#toast-msg').textContent.indexOf('número de quema ya está registrado') === -1) fail('cambio: quema repetida sin traducir: ' + $('#toast-msg').textContent);
  if(!modal.classList.contains('show')) fail('cambio: el modal se cerró pese a la quema repetida');

  // Éxito con neumático nuevo ingresado, quema, km previos y odómetro del vehículo
  var rn = d.querySelector('input[name="cambio-origen"][value="nuevo"]'); rn.click(); await sleep(100);
  $('#cambio-quema').value = '  Q-55 '; $('#cambio-km-previos').value = '35000';
  $('#cambio-marca').value = 'Pirelli <b>'; $('#cambio-modelo').value = 'FR85'; $('#cambio-odo').value = '1200';
  $('#cambio-confirmar').click(); await sleep(400);
  var cs = cambios();
  if(cs.length !== base + 3) { fail('cambio: no se llamó a la RPC en el éxito'); btn.remove(); return; }
  var a = cs[cs.length - 1].args;
  if(a.p_vehiculo_id !== 10 || a.p_posicion !== 1 || a.p_destino_viejo !== 'baja' || a.p_motivo !== null || a.p_motivo_codigo !== 'desgaste' || a.p_motivo_texto !== null ||
     a.p_odometro_km !== 1200 || a.p_numero_quema !== 'Q-55' || a.p_km_previos !== 35000 || a.p_stock_id !== null || !a.p_nuevo || a.p_nuevo.marca !== 'Pirelli <b>' || a.p_nuevo.modelo !== 'FR85') fail('cambio: args de la RPC: ' + JSON.stringify(a));
  if(modal.classList.contains('show')) fail('cambio: el modal no se cerró tras el éxito');
  if($('#toast-msg').textContent.indexOf('Cambio registrado') === -1) fail('cambio: falta el aviso de éxito');
  if(evento !== 1) fail('cambio: no se emitió el evento de refresco');
  log.push('cambio-flow: rpcs=' + cambios().length);

  // Cubierta individual del stock y devolución del neumático retirado al stock (solo admin y perfil global)
  var secUser = /[?&]secuser=1/.test(w.parent.location.search);
  btn.setAttribute('data-posicion', '3');   // P3 no tiene número de quema en los datos de prueba
  btn.click(); await sleep(600);
  var cubRadio = d.querySelector('input[name="cambio-origen"][value="cubierta"]');
  if(secUser){
    if(cubRadio) fail('cambio(sucursal): ofrece cubiertas del stock');
    if($('#cambio-retorno-wrap').style.display !== 'none') fail('cambio(sucursal): ofrece devolver al stock');
  } else {
    if(!cubRadio || !cubRadio.checked) { fail('cambio: falta la opción «Cubierta del stock» (o no es la predeterminada)'); btn.remove(); return; }
    var opts = Array.prototype.map.call($('#cambio-cubierta').options, function(o){ return o.textContent; });
    if(opts.length !== 4 || opts[0] !== 'S-001 · Michelin X <Multi> Z · Nuevo · Montevideo' || opts.join('|').indexOf('Z-900') !== -1) fail('cambio: cubiertas ofrecidas: ' + opts.join(' | '));
    if($('#cambio-quema-km-wrap').style.display !== 'none') fail('cambio: con cubierta del stock no deben verse quema ni km');
    if($('#cambio-actual').innerHTML.indexOf('<Multi>') !== -1) fail('cambio: HTML sin escapar');
    $('#cambio-cubierta').value = '32'; $('#cambio-cubierta').dispatchEvent(new w.Event('change', {bubbles: true}));
    $('#cambio-motivo').value = 'desgaste';
    if($('#cambio-resumen').textContent.indexOf('cubierta S-002 del stock') === -1) fail('cambio: resumen con la cubierta: ' + $('#cambio-resumen').textContent);
    $('#cambio-confirmar').click(); await sleep(400);
    var ca = cambios()[cambios().length - 1].args;
    if(ca.p_cubierta_id !== 32 || ca.p_stock_id !== null || ca.p_nuevo !== null || ca.p_numero_quema !== null || ca.p_km_previos !== 0 || 'p_devolver_stock' in ca) fail('cambio: args con cubierta: ' + JSON.stringify(ca));

    // Almacenar: vuelve al stock en una sucursal; sin quema propia hay que indicarla
    btn.click(); await sleep(600);
    if($('#cambio-retorno-wrap').style.display !== 'none') fail('cambio: la sucursal de destino solo se ofrece al almacenar');
    d.querySelector('input[name="cambio-destino"][value="almacenado"]').click(); await sleep(150);
    if($('#cambio-retorno-wrap').style.display === 'none') fail('cambio: al almacenar falta la sucursal donde queda en stock');
    var sucs = Array.prototype.map.call($('#cambio-retorno-suc').options, function(o){ return o.textContent; });
    if(sucs[0] !== 'Sin sucursal' || sucs.indexOf('Montevideo') === -1 || sucs.indexOf('Ajena') !== -1) fail('cambio: sucursales ofrecidas: ' + sucs.join('|'));
    if($('#cambio-quema-viejo-wrap').style.display === 'none') fail('cambio: el neumático sin quema debe pedirla para volver al stock');
    var antesA = cambios().length;
    d.querySelector('input[name="cambio-origen"][value="nuevo"]').click(); $('#cambio-marca').value = 'Pirelli';
    $('#cambio-confirmar').click(); await sleep(250);
    if(cambios().length !== antesA || $('#cambio-error').textContent.indexOf('número de quema del neumático retirado') === -1) fail('cambio: llegó a la RPC sin quema del neumático retirado: ' + $('#cambio-error').textContent);
    $('#cambio-quema-viejo').value = ' Q-OLD '; $('#cambio-retorno-suc').value = '1';
    $('#cambio-confirmar').click(); await sleep(400);
    var cv = cambios()[cambios().length - 1].args;
    if(cambios().length !== antesA + 1 || cv.p_destino_viejo !== 'almacenado' || cv.p_devolver_stock !== true || cv.p_sucursal_stock !== 1 || cv.p_quema_viejo !== 'Q-OLD' || cv.p_cubierta_id !== undefined) fail('cambio: args al devolver al stock: ' + JSON.stringify(cv));
  }
  // Enter (envío del formulario) y doble clic: un solo cambio. Enter mantenido (e.repeat) se ignora.
  btn.click(); await sleep(600);
  d.querySelector('input[name="cambio-origen"][value="nuevo"]').click(); await sleep(100);
  $('#cambio-marca').value = 'Pirelli'; $('#cambio-motivo').value = 'desgaste';
  var rep = new w.KeyboardEvent('keydown', {key: 'Enter', repeat: true, bubbles: true, cancelable: true});
  $('#cambio-marca').dispatchEvent(rep);
  if(!rep.defaultPrevented) fail('cambio: Enter mantenido debe ignorarse');
  var antesE = cambios().length; fx.rpcDelay = 400;
  $('#cambio-form').requestSubmit(); $('#cambio-form').requestSubmit(); $('#cambio-confirmar').click(); await sleep(800);
  fx.rpcDelay = 0;
  if(cambios().length !== antesE + 1) fail('cambio: Enter/doble envío debe registrar un solo cambio, registró ' + (cambios().length - antesE));
  if(modal.classList.contains('show')) fail('cambio: el modal no se cerró tras enviar con Enter');

  // Un cambio en vuelo no debe mezclarse con otro neumático: abrir otro se rechaza con aviso, el modal sigue siendo el del
  // neumático que se está cambiando, y la respuesta cierra ese modal y avisa éxito una sola vez
  btn.setAttribute('data-posicion', '1');
  btn.click(); await sleep(600);
  d.querySelector('input[name="cambio-origen"][value="nuevo"]').click(); await sleep(100);
  $('#cambio-marca').value = 'Pirelli'; $('#cambio-motivo').value = 'desgaste';
  var antesV = cambios().length; fx.rpcDelay = 500;
  $('#cambio-form').requestSubmit(); await sleep(50);
  var btn2 = d.createElement('button');
  btn2.setAttribute('data-action', 'neumatico-cambiar'); btn2.setAttribute('data-vehiculo-id', '10'); btn2.setAttribute('data-posicion', '3');
  d.body.appendChild(btn2);
  $('#toast-msg').textContent = '';
  btn2.click(); await sleep(100);
  if($('#toast-msg').textContent !== 'Esperar a que termine el cambio en curso') fail('cambio: abrir otro neumático con un cambio en curso debe avisar: ' + $('#toast-msg').textContent);
  if($('#cambio-actual').textContent.indexOf('Delantera izquierda') === -1) fail('cambio: el modal en vuelo pasó a otro neumático: ' + $('#cambio-actual').textContent);
  await sleep(700); fx.rpcDelay = 0;
  if(cambios().length !== antesV + 1) fail('cambio: con un cambio en curso debe salir una sola RPC, salieron ' + (cambios().length - antesV));
  if(modal.classList.contains('show')) fail('cambio: el modal del cambio terminado debe cerrarse');
  if($('#toast-msg').textContent.indexOf('Cambio registrado en Camión 01, Delantera izquierda') !== 0) fail('cambio: aviso de éxito con vehículo y posición: ' + $('#toast-msg').textContent);
  btn2.remove();
  btn.remove();
};
