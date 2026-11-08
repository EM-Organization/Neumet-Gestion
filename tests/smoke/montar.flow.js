// Recorrido de humo de montar y retirar neumáticos (cliente global, con montar.fixture.js): coche sin neumáticos con
// estado vacío y «Cargar neumáticos», montar desde el stock y una cubierta nueva sin cerrar el flujo (ofrece la siguiente
// posición libre), error de la RPC, y retirar un neumático (la posición vuelve a quedar vacía).
// Lo invoca harness.html con ?detalle=1&cliente=1&montar=1: await window.montarFlow(w, d, sleep, fail, log)
window.montarFlow = async function(w, d, sleep, fail, log){
  var fx = w.__montarFx, $ = function(s){ return d.querySelector(s); }, all = function(s){ return d.querySelectorAll(s); };
  var txt = function(s){ var e = $(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; };
  var rpcs = function(n){ return fx.rpcs.filter(function(r){ return r.name === n; }); };
  var poner = function(sel, v){ var e = $(sel); e.value = v; e.dispatchEvent(new w.Event('change', {bubbles: true})); };
  var teclear = function(sel, v){ var e = $(sel); e.value = v; e.dispatchEvent(new w.Event('input', {bubbles: true})); };
  var esperar = async function(cond, que){ for(var t = 0; t < 60; t++){ if(cond()) return true; await sleep(50); } fail('montar: timeout esperando ' + que); return false; };
  var visible = function(sel){ var e = $(sel); return !!e && e.getClientRects().length > 0; };

  // Abrir el coche 301 por número exacto
  $('.nav-item[data-view="vehiculos"]').click(); await sleep(600);
  var inp = $('#search-vehiculos'); inp.value = '301'; inp.dispatchEvent(new w.Event('input', {bubbles: true})); await sleep(150);
  inp.dispatchEvent(new w.KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true})); await sleep(900);
  if(!$('#view-vehiculo-detalle').classList.contains('active') || txt('#vd-cab').indexOf('Coche 301') === -1) { fail('montar: no abrió el coche 301: ' + txt('#vd-cab')); return; }

  // Estado vacío claro, con «Cargar neumáticos»; diagrama con 10 ruedas punteadas y sin datos de desgaste
  var vacio = txt('#vd-resumen');
  log.push('vacio=' + vacio.slice(0, 120));
  if(vacio.indexOf('Sin neumáticos montados') === -1 || !$('#vd-resumen [data-action="neumatico-montar"]') || txt('#vd-resumen [data-action="neumatico-montar"]') !== 'Cargar neumáticos') fail('montar: falta el estado vacío con «Cargar neumáticos»: ' + vacio);
  if(all('#vd-diagrama .vd-vacia').length !== 10 || all('#vd-diagrama .vd-rueda').length !== 10) fail('montar: se esperaban 10 ruedas vacías, hay ' + all('#vd-diagrama .vd-vacia').length + ' de ' + all('#vd-diagrama .vd-rueda').length);
  if(all('#vd-diagrama .vd-mm').length) fail('montar: una rueda vacía muestra mm');
  var v3 = $('#vd-diagrama .vd-rueda[data-pos="3"]');
  if(!/vacía/.test(v3.getAttribute('aria-label')) || v3.getAttribute('role') !== 'button' || v3.getAttribute('tabindex') !== '0') fail('montar: la rueda vacía no es accesible: ' + v3.getAttribute('aria-label'));
  if(!/Posición vacía/.test(txt('#vd-leyenda'))) fail('montar: la leyenda no explica la posición vacía');
  if(/Desgaste del neumático en mm/.test(txt('#vd-leyenda'))) fail('montar: la escala de desgaste no corresponde a un coche sin neumáticos');

  // Rueda vacía: el panel ofrece «Montar neumático» y abre el modal en esa posición
  v3.dispatchEvent(new w.MouseEvent('click', {bubbles: true})); await sleep(300);
  if(txt('#vd-panel').indexOf('Sin neumático montado en esta posición') === -1) fail('montar: el panel de una rueda vacía: ' + txt('#vd-panel'));
  var bm = $('#vd-panel [data-action="neumatico-montar"]');
  if(!bm || bm.dataset.posicion !== '3' || bm.textContent.trim() !== 'Montar neumático') { fail('montar: falta «Montar neumático» en el panel'); return; }
  bm.click();
  if(!await esperar(function(){ return $('#modal-montar').classList.contains('show'); }, 'el modal de montar')) return;
  if($('#mont-pos').value !== '3') fail('montar: la posición inicial debe ser P3: ' + $('#mont-pos').value);
  var opciones = Array.prototype.map.call(all('#mont-pos option'), function(o){ return o.value; });
  if(opciones.length !== 11 || opciones[10] !== '99') fail('montar: posiciones libres de un coche de 10 ruedas + auxilio: ' + opciones.join(','));
  if($('#mont-tab-stock').getAttribute('aria-selected') !== 'true' || $('#mont-tab-nuevo').getAttribute('aria-selected') !== 'false') fail('montar: «Del stock» debe ser la pestaña inicial');
  if(all('#mont-lista .mont-fila').length !== 3) fail('montar: se esperaban 3 cubiertas del stock, hay ' + all('#mont-lista .mont-fila').length);
  if(/Z-900|Ajena/.test(txt('#mont-lista'))) fail('montar: ofrece cubiertas de otro cliente');
  if($('#mont-lista').innerHTML.indexOf('<Multi>') !== -1) fail('montar: HTML sin escapar en la lista');
  if(!/Completar los datos/.test(txt('#mont-resumen'))) fail('montar: sin cubierta elegida el resumen debe pedir datos');

  // Buscador: por quema, marca o modelo
  teclear('#mont-buscar', 's-01');
  if(all('#mont-lista .mont-fila').length !== 1 || txt('#mont-lista').indexOf('S-010') === -1) fail('montar: el buscador por quema: ' + txt('#mont-lista'));
  teclear('#mont-buscar', 'pirelli');
  if(all('#mont-lista .mont-fila').length !== 1 || txt('#mont-lista').indexOf('S-002') === -1) fail('montar: el buscador por marca');
  teclear('#mont-buscar', 'zzz');
  if(all('#mont-lista .mont-fila').length !== 0 || !/Ninguna cubierta coincide/.test(txt('#mont-lista'))) fail('montar: sin coincidencias: ' + txt('#mont-lista'));
  teclear('#mont-buscar', '');

  // Sin cubierta elegida: no llega a la RPC
  $('#mont-confirmar').click(); await sleep(200);
  if(rpcs('neumatico_montar').length || !/Elegir una cubierta/.test(txt('#mont-error'))) fail('montar: sin cubierta elegida no debe llamar a la RPC: ' + txt('#mont-error'));

  // Montar la cubierta S-002 en P3 (odómetro menor al actual: rechazo local)
  d.querySelector('input[name="mont-cubierta"][value="3102"]').click(); await sleep(100);
  if(!/^P3: entra cubierta S-002/.test(txt('#mont-resumen'))) fail('montar: resumen del montaje desde el stock: ' + txt('#mont-resumen'));
  poner('#mont-odo', '4000'); $('#mont-confirmar').click(); await sleep(200);
  if(rpcs('neumatico_montar').length || !/no puede ser menor al actual/.test(txt('#mont-error'))) fail('montar: odómetro menor debe rechazarse localmente: ' + txt('#mont-error'));
  poner('#mont-odo', '');
  $('#mont-confirmar').click();
  await esperar(function(){ return rpcs('neumatico_montar').length === 1; }, 'la RPC de montar');
  var a = rpcs('neumatico_montar')[0].args;
  if(JSON.stringify([a.p_vehiculo_id, a.p_posicion, a.p_cubierta_id, a.p_nuevo, a.p_odometro_km]) !== '[13,3,3102,null,null]') fail('montar: argumentos de la RPC: ' + JSON.stringify(a));

  // Sigue con la siguiente posición libre sin cerrar el flujo
  await esperar(function(){ return /Montado en P3/.test(txt('#mont-aviso')); }, 'el aviso de la siguiente posición');
  log.push('aviso=' + txt('#mont-aviso'));
  if(!$('#modal-montar').classList.contains('show')) fail('montar: el modal debe seguir abierto tras montar');
  if(!/Siguiente posición libre: P4/.test(txt('#mont-aviso')) || $('#mont-pos').value !== '4') fail('montar: debe ofrecer P4: ' + txt('#mont-aviso') + ' / ' + $('#mont-pos').value);
  if(Array.prototype.some.call(all('#mont-pos option'), function(o){ return o.value === '3'; })) fail('montar: P3 ya no está libre');
  if(all('#mont-lista .mont-fila').length !== 2) fail('montar: la cubierta montada debe salir de la lista (' + all('#mont-lista .mont-fila').length + ')');
  if($('#mont-cerrar').textContent.trim() !== 'Terminar') fail('montar: el botón debe pasar a «Terminar»');
  await esperar(function(){ return /1 neumático/.test(txt('#vd-resumen')); }, 'recargar el detalle');
  if(!/1 neumático/.test(txt('#vd-resumen')) || all('#vd-diagrama .vd-vacia').length !== 9) fail('montar: el detalle no se recargó detrás del modal: ' + txt('#vd-resumen'));

  // Cubierta nueva en P4: validación local y datos completos
  $('#mont-tab-nuevo').click(); await sleep(100);
  if($('#mont-panel-nuevo').hidden || !$('#mont-panel-stock').hidden) fail('montar: la pestaña «Cubierta nueva» no se mostró');
  $('#mont-confirmar').click(); await sleep(200);
  if(rpcs('neumatico_montar').length !== 1 || !/Falta la marca/.test(txt('#mont-error'))) fail('montar: sin marca no debe llegar a la RPC: ' + txt('#mont-error'));
  poner('#mont-marca', 'Pirelli'); poner('#mont-modelo', 'FR85'); poner('#mont-quema', 'N-77'); poner('#mont-km-previos', '1200'); poner('#mont-vida', '1');
  poner('#mont-km-previos', '-5'); $('#mont-confirmar').click(); await sleep(200);
  if(rpcs('neumatico_montar').length !== 1 || !/km/.test(txt('#mont-error'))) fail('montar: km previos inválidos: ' + txt('#mont-error'));
  poner('#mont-km-previos', '1200');

  // Error de la RPC: mensaje claro, el modal sigue abierto
  var ce = w.console.error; w.console.error = function(){};
  fx.rpcError = {code: '55000', message: 'la posición 4 ya tiene un neumático'};
  $('#mont-confirmar').click(); await sleep(300);
  w.console.error = ce; fx.rpcError = null;
  if(rpcs('neumatico_montar').length !== 2 || !/La posición ya tiene un neumático/.test(txt('#mont-error')) || !$('#modal-montar').classList.contains('show')) fail('montar: error de la RPC no mostrado: ' + txt('#mont-error'));
  if($('#mont-confirmar').disabled) fail('montar: el botón quedó bloqueado tras el error');

  $('#mont-confirmar').click();
  await esperar(function(){ return rpcs('neumatico_montar').length === 3; }, 'montar la cubierta nueva');
  var b = rpcs('neumatico_montar')[2].args;
  if(JSON.stringify([b.p_posicion, b.p_cubierta_id, b.p_nuevo]) !== JSON.stringify([4, null, {marca: 'Pirelli', vida: 1, km_previos: 1200, modelo: 'FR85', numero_quema: 'N-77'}])) fail('montar: argumentos de la cubierta nueva: ' + JSON.stringify(b));
  await esperar(function(){ return /Siguiente posición libre: P5/.test(txt('#mont-aviso')); }, 'ofrecer P5');
  if($('#mont-marca').value !== '' || $('#mont-km-previos').value !== '0') fail('montar: el formulario debe limpiarse para la siguiente posición');

  // Terminar: cierra; el detalle muestra 2 neumáticos y ya no el estado vacío
  $('#mont-cerrar').click(); await sleep(400);
  if($('#modal-montar').classList.contains('show')) fail('montar: «Terminar» no cerró el modal');
  if(all('#vd-diagrama .vd-vacia').length !== 8 || !/2 neumáticos/.test(txt('#vd-resumen')) || /Sin neumáticos montados/.test(txt('#vd-resumen'))) fail('montar: detalle tras montar 2: ' + txt('#vd-resumen'));
  if(!$('#vd-resumen [data-action="neumatico-montar"]') || txt('#vd-resumen [data-action="neumatico-montar"]') !== 'Montar neumático') fail('montar: con posiciones libres debe quedar «Montar neumático»');

  // Retirar el neumático de P4 (baja con motivo): la posición vuelve a quedar vacía
  $('#vd-diagrama .vd-rueda[data-pos="4"]').dispatchEvent(new w.MouseEvent('click', {bubbles: true})); await sleep(400);
  var br = $('#vd-panel [data-action="neumatico-retirar"]');
  if(!br || br.dataset.posicion !== '4' || br.textContent.trim() !== 'Retirar neumático') { fail('montar: falta «Retirar neumático» en el panel'); return; }
  br.click();
  if(!await esperar(function(){ return $('#modal-retirar').classList.contains('show'); }, 'el modal de retirar')) return;
  if(Array.prototype.map.call(all('input[name="ret-destino"]'), function(i){ return i.value; }).join() !== 'almacenado,reparacion,baja') fail('montar: destinos del retiro');
  if(!/quema N-77/.test(txt('#ret-actual')) || !visible('#ret-stock-wrap') || visible('#ret-quema-wrap')) fail('montar: el neumático con quema vuelve al stock sin pedir quema: ' + txt('#ret-actual'));
  d.querySelector('input[name="ret-destino"][value="baja"]').click(); await sleep(100);
  if(visible('#ret-stock-wrap') || !/obligatorio/.test(txt('#ret-motivo-opt'))) fail('montar: la baja pide motivo y oculta el stock');
  $('#ret-confirmar').click(); await sleep(200);
  if(rpcs('neumatico_desmontar').length || !/Falta el motivo/.test(txt('#ret-error'))) fail('montar: baja sin motivo no debe llegar a la RPC: ' + txt('#ret-error'));
  poner('#ret-motivo', 'Montaje equivocado');
  $('#ret-confirmar').click();
  await esperar(function(){ return rpcs('neumatico_desmontar').length === 1; }, 'la RPC de retirar');
  var c = rpcs('neumatico_desmontar')[0].args;
  if(JSON.stringify([c.p_vehiculo_id, c.p_posicion, c.p_destino, c.p_motivo]) !== '[13,4,"baja","Montaje equivocado"]') fail('montar: argumentos del retiro: ' + JSON.stringify(c));
  await esperar(function(){ return $('#vd-diagrama .vd-vacia[data-pos="4"]'); }, 'P4 vacía tras retirar');
  if($('#modal-retirar').classList.contains('show')) fail('montar: el modal de retirar no se cerró');
  if($('#vd-panel').classList.contains('abierto')) fail('montar: el panel debe cerrarse al quedar la posición vacía');
  if(!/1 neumático/.test(txt('#vd-resumen'))) fail('montar: tras retirar queda 1 neumático: ' + txt('#vd-resumen'));
  log.push('montar-ok rpcs=' + fx.rpcs.length);

};
