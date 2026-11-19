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
  // Un error se dice una sola vez: cuenta los lugares visibles (aviso en línea del modal y toast) que contienen el texto.
  var veces = function(t){ return ['#mont-error', '#toast.show #toast-msg'].filter(function(sel){ return visible(sel) && txt(sel).indexOf(t) !== -1; }).length; };

  // Abrir el coche 301 por número exacto
  $('.nav-item[data-view="vehiculos"]').click(); await sleep(600);
  var inp = $('#search-vehiculos'); inp.value = '301'; inp.dispatchEvent(new w.Event('input', {bubbles: true})); await sleep(150);
  // Un vehículo sin neumáticos dice «Sin neumáticos» (no «Sin datos») en la lista.
  if(txt('#veh-lista').indexOf('Sin neumáticos') === -1 || /Sin datos/.test(txt('#veh-lista'))) fail('montar: la lista debe decir «Sin neumáticos»: ' + txt('#veh-lista'));
  inp.dispatchEvent(new w.KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true})); await sleep(900);
  if(!$('#view-vehiculo-detalle').classList.contains('active') || txt('#vd-cab').indexOf('Coche 301') === -1) { fail('montar: no abrió el coche 301: ' + txt('#vd-cab')); return; }

  if(txt('.vd-cab-titulo').indexOf('Sin neumáticos') === -1 || /Sin datos/.test(txt('#vd-cab'))) fail('montar: el encabezado debe decir «Sin neumáticos»: ' + txt('#vd-cab'));
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
  if($('#mont-pos').value !== '3') fail('montar: la posición inicial debe ser la 3: ' + $('#mont-pos').value);
  // Sin «P3» (docs/14 §3): nombres como en Alertas; el subtítulo cuenta ruedas y el auxilio aparte, como el diagrama.
  if(/\bP\d/.test(txt('#mont-pos')) || txt('#mont-pos option[value="3"]') !== 'Eje 2 izquierda exterior') fail('montar: nombres de posición: ' + txt('#mont-pos'));
  if(!/ · 10 posiciones libres · auxilio libre$/.test(txt('#mont-sub'))) fail('montar: subtítulo de posiciones libres: ' + txt('#mont-sub'));
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
  if(!/^Eje 2 izquierda exterior: entra cubierta S-002/.test(txt('#mont-resumen'))) fail('montar: resumen del montaje desde el stock: ' + txt('#mont-resumen'));
  poner('#mont-odo', '4000'); $('#mont-confirmar').click(); await sleep(200);
  if(rpcs('neumatico_montar').length || !/no puede ser menor al actual/.test(txt('#mont-error'))) fail('montar: odómetro menor debe rechazarse localmente: ' + txt('#mont-error'));
  poner('#mont-odo', '');
  $('#mont-confirmar').click();
  await esperar(function(){ return rpcs('neumatico_montar').length === 1; }, 'la RPC de montar');
  var a = rpcs('neumatico_montar')[0].args;
  if(JSON.stringify([a.p_vehiculo_id, a.p_posicion, a.p_cubierta_id, a.p_nuevo, a.p_odometro_km]) !== '[13,3,3102,null,null]') fail('montar: argumentos de la RPC: ' + JSON.stringify(a));

  // Sigue con la siguiente posición libre sin cerrar el flujo
  await esperar(function(){ return /Montado: Eje 2 izquierda exterior/.test(txt('#mont-aviso')); }, 'el aviso de la siguiente posición');
  log.push('aviso=' + txt('#mont-aviso'));
  if(!$('#modal-montar').classList.contains('show')) fail('montar: el modal debe seguir abierto tras montar');
  if(!/Siguiente posición libre: Eje 2 izquierda interior/.test(txt('#mont-aviso')) || $('#mont-pos').value !== '4') fail('montar: debe ofrecer la posición 4: ' + txt('#mont-aviso') + ' / ' + $('#mont-pos').value);
  if(Array.prototype.some.call(all('#mont-pos option'), function(o){ return o.value === '3'; })) fail('montar: la posición 3 ya no está libre');
  if(all('#mont-lista .mont-fila').length !== 2) fail('montar: la cubierta montada debe salir de la lista (' + all('#mont-lista .mont-fila').length + ')');
  if($('#mont-cerrar').textContent.trim() !== 'Terminar') fail('montar: el botón debe pasar a «Terminar»');
  await esperar(function(){ return /1 neumático/.test(txt('#vd-resumen')); }, 'recargar el detalle');
  if(!/1 neumático/.test(txt('#vd-resumen')) || all('#vd-diagrama .vd-vacia').length !== 9) fail('montar: el detalle no se recargó detrás del modal: ' + txt('#vd-resumen'));

  // Cubierta nueva en P4: validación local y datos completos
  $('#mont-tab-nuevo').click(); await sleep(100);
  if(!visible('#mont-precio')) fail('montar: el perfil global debe ver el precio');
  if($('#mont-km-previos').value !== '') fail('montar: «Km que ya traía» debe empezar vacío: ' + $('#mont-km-previos').value);
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
  if(veces('La posición ya tiene un neumático') !== 1) fail('montar: el error de la RPC debe verse una sola vez, se ve ' + veces('La posición ya tiene un neumático'));
  // Error de red (la promesa se rechaza): también una sola vez y visible dentro del modal
  w.console.error = function(){}; fx.rpcThrow = true;
  $('#mont-confirmar').click(); await sleep(300);
  w.console.error = ce; fx.rpcThrow = false;
  if(rpcs('neumatico_montar').length !== 3 || txt('#mont-error') === '' || veces(txt('#mont-error')) !== 1) fail('montar: el error de red debe verse una sola vez: ' + txt('#mont-error') + ' / ' + veces(txt('#mont-error')));
  if(!visible('#mont-error') || $('#modal-montar').classList.contains('show') === false) fail('montar: el error de red debe quedar visible dentro del modal');
  fx.rpcs.pop(); // el intento sin red no cuenta para el recuento de montajes que sigue

  // «Enter» en un campo envía: el envío del formulario monta una sola vez aunque llegue dos veces (doble Enter).
  poner('#mont-fecha', '2026-05-01');
  $('#mont-form').requestSubmit(); $('#mont-form').requestSubmit();
  await esperar(function(){ return rpcs('neumatico_montar').length === 3; }, 'montar la cubierta nueva');
  await sleep(300);
  if(rpcs('neumatico_montar').length !== 3) fail('montar: doble envío (Enter) llegó a la RPC ' + rpcs('neumatico_montar').length + ' veces');
  var b = rpcs('neumatico_montar')[2].args;
  if(JSON.stringify([b.p_posicion, b.p_cubierta_id, b.p_nuevo]) !== JSON.stringify([4, null, {marca: 'Pirelli', vida: 1, km_previos: 1200, modelo: 'FR85', numero_quema: 'N-77', fecha_compra: '2026-05-01'}])) fail('montar: argumentos de la cubierta nueva: ' + JSON.stringify(b));
  await esperar(function(){ return /Siguiente posición libre: Eje 2 derecha interior/.test(txt('#mont-aviso')); }, 'ofrecer P5');
  // Marca, modelo y fecha de compra pasan a la siguiente posición; lo propio de cada neumático se borra.
  if($('#mont-marca').value !== 'Pirelli' || $('#mont-modelo').value !== 'FR85' || $('#mont-fecha').value !== '2026-05-01') fail('montar: marca, modelo y fecha deben conservarse');
  if($('#mont-quema').value !== '' || $('#mont-km-previos').value !== '' || $('#mont-odo').value !== '') fail('montar: quema, km previos y odómetro deben limpiarse para la siguiente posición');

  // Neumáticos fantasma: tras montar, el formulario conserva marca y modelo; Enter mantenido, doble Enter o clic inmediato no montan otro.
  var enter = function(rep){ var ev = new w.KeyboardEvent('keydown', {key: 'Enter', repeat: rep, bubbles: true, cancelable: true}); $('#mont-marca').dispatchEvent(ev); if(!ev.defaultPrevented) $('#mont-form').requestSubmit(); };
  for(var i = 0; i < 12; i++) enter(true);
  enter(false); enter(false); $('#mont-confirmar').click(); await sleep(400);
  if(rpcs('neumatico_montar').length !== 3) fail('montar: Enter mantenido, doble Enter o clic inmediato montaron de más: ' + rpcs('neumatico_montar').length);
  if(!/Escribir la quema/.test(txt('#mont-error'))) fail('montar: el envío bloqueado debe explicar qué completar: ' + txt('#mont-error'));
  if(d.activeElement !== $('#mont-quema')) fail('montar: el foco debe ir a la quema');
  poner('#mont-quema', 'N-78');
  if(txt('#mont-error') !== '') fail('montar: al editar la quema debe limpiarse el aviso');

  // Terminar: cierra; el detalle muestra 2 neumáticos y ya no el estado vacío
  $('#mont-cerrar').click(); await sleep(400);
  if($('#modal-montar').classList.contains('show')) fail('montar: «Terminar» no cerró el modal');
  // El detalle se repintó detrás del modal: el foco vuelve a un «Montar neumático», no queda en <body>
  if(!d.activeElement || d.activeElement === d.body || !$('#view-vehiculo-detalle').contains(d.activeElement)) fail('montar: tras «Terminar» el foco debe volver al detalle del vehículo, está en ' + (d.activeElement && (d.activeElement.id || d.activeElement.tagName)));
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
  // Enter en la búsqueda del stock: con UNA coincidencia elige y monta; con ninguna o varias, no. Stock restante: S-001 y S-010.
  var abrir = $('#vd-resumen [data-action="neumatico-montar"]'); abrir.click();
  if(!await esperar(function(){ return $('#modal-montar').classList.contains('show'); }, 'reabrir el modal de montar')) return;
  var antes = rpcs('neumatico_montar').length;
  var enviar = function(){ $('#mont-form').requestSubmit(); };
  enviar(); await sleep(200);
  if(rpcs('neumatico_montar').length !== antes) fail('montar: Enter sin texto de búsqueda no debe montar nada');
  teclear('#mont-buscar', 'zzz'); enviar(); await sleep(200);
  if(rpcs('neumatico_montar').length !== antes) fail('montar: Enter sin coincidencias no debe montar');
  teclear('#mont-buscar', 'e'); // coincide con las dos cubiertas
  if(all('#mont-lista .mont-fila').length !== 2) fail('montar: la búsqueda «e» debía dejar 2 cubiertas: ' + all('#mont-lista .mont-fila').length);
  enviar(); await sleep(200);
  if(rpcs('neumatico_montar').length !== antes || !/Elegir una cubierta/.test(txt('#mont-error'))) fail('montar: Enter con varias coincidencias no debe elegir: ' + txt('#mont-error'));
  teclear('#mont-buscar', 'goodyear'); enviar();
  await esperar(function(){ return rpcs('neumatico_montar').length === antes + 1; }, 'montar con Enter y una coincidencia');
  if(rpcs('neumatico_montar')[antes].args.p_cubierta_id !== 3103) fail('montar: Enter con una coincidencia montó otra cubierta: ' + JSON.stringify(rpcs('neumatico_montar')[antes].args));
  await esperar(function(){ return /Montado:/.test(txt('#mont-aviso')); }, 'el aviso tras montar con Enter');
  // Queda una sola cubierta en el stock; con la búsqueda ya vacía, un Enter inmediato (o repetido) no monta otra
  if(all('#mont-lista .mont-fila').length !== 1 || $('#mont-buscar').value !== '') fail('montar: tras montar debe quedar 1 cubierta y la búsqueda vacía');
  enviar(); enviar(); await sleep(300);
  if(rpcs('neumatico_montar').length !== antes + 1) fail('montar: un Enter inmediato tras montar montó la cubierta que quedaba en el stock');
  $('#mont-cerrar').click(); await sleep(300);

  // Eliminar el vehículo (administrador de empresa): el botón está en la cabecera y el diálogo ofrece stock o baja.
  var T = w.__vehFx.T;
  var vivos = function(){ return T.neumaticos.filter(function(x){ return x.vehiculo_id === 13 && x.estado !== 'baja'; }); };
  var nVivos = vivos().length;
  var be = $('#vd-cab [data-action="vehiculo-eliminar"]');
  if(!be || be.textContent.trim() !== 'Eliminar vehículo' || nVivos < 2) { fail('eliminar: falta «Eliminar vehículo» en la cabecera o el coche no tiene neumáticos (' + nVivos + ')'); return; }
  // Vehículo sin neumáticos (todos dados de baja): el diálogo abre como confirmación simple, sin errores de consola,
  // con el foco en «Eliminar vehículo» (Enter confirma) y, al cancelar, el foco vuelve al botón que lo abrió.
  var estados = vivos().map(function(x){ return [x, x.estado]; });
  estados.forEach(function(e){ e[0].estado = 'baja'; });
  be.focus(); be.click();
  var abrio = await esperar(function(){ return $('#modal-veh-eliminar').classList.contains('show'); }, 'el diálogo de eliminar sin neumáticos');
  await sleep(200);
  if(abrio){
    if(!$('#veh-elim-grupo').hidden || txt('#veh-elim-destinos') !== '') fail('eliminar: sin neumáticos no debe haber opciones: ' + txt('#veh-elim-destinos'));
    if(!/no tiene neumáticos/.test(txt('#veh-elim-resumen'))) fail('eliminar: resumen sin neumáticos: ' + txt('#veh-elim-resumen'));
    if(d.activeElement !== $('#veh-elim-confirmar')) fail('eliminar: sin neumáticos el foco debe quedar en «Eliminar vehículo», está en ' + (d.activeElement && (d.activeElement.id || d.activeElement.tagName)));
    $('#veh-elim-cancelar').click(); await sleep(200);
    if($('#modal-veh-eliminar').classList.contains('show')) fail('eliminar: «Cancelar» no cerró el diálogo (sin neumáticos)');
    if(d.activeElement !== be) fail('eliminar: al cancelar el foco debe volver a «Eliminar vehículo», está en ' + (d.activeElement && (d.activeElement.id || d.activeElement.tagName)));
  }
  estados.forEach(function(e){ e[0].estado = e[1]; });
  var conQuema = vivos()[0].numero_quema;
  vivos()[0].numero_quema = null; // un neumático sin quema no puede volver al stock
  be.focus(); be.click();
  if(!await esperar(function(){ return $('#modal-veh-eliminar').classList.contains('show'); }, 'el diálogo de eliminar')) return;
  var radioStock = $('input[name="veh-elim-destino"][value="stock"]');
  if(!radioStock.disabled || d.querySelector('input[name="veh-elim-destino"]:checked')) fail('eliminar: con un neumático sin quema el stock se deshabilita y no se elige nada');
  if(!/1 neumático no tiene número de quema/.test(txt('#veh-elim-aviso'))) fail('eliminar: falta el aviso de la quema: ' + txt('#veh-elim-aviso'));
  $('#veh-elim-form').requestSubmit(); await sleep(200);
  if(rpcs('vehiculo_eliminar').length || !/Elegir qué hacer con los neumáticos/.test(txt('#veh-elim-error'))) fail('eliminar: sin elegir destino no debe llegar a la RPC: ' + txt('#veh-elim-error'));
  $('#veh-elim-cancelar').click(); await sleep(100);
  if($('#modal-veh-eliminar').classList.contains('show')) fail('eliminar: «Cancelar» no cerró el diálogo');
  await sleep(100);
  if(d.activeElement !== be) fail('eliminar: al cancelar el foco debe volver a «Eliminar vehículo», está en ' + (d.activeElement && (d.activeElement.id || d.activeElement.tagName)));
  vivos()[0].numero_quema = conQuema;
  // Con quema en todos: «Enviar al stock» viene elegido; «Dar de baja» no.
  $('#vd-cab [data-action="vehiculo-eliminar"]').click();
  if(!await esperar(function(){ return $('#modal-veh-eliminar').classList.contains('show'); }, 'reabrir el diálogo de eliminar')) return;
  if(!$('input[name="veh-elim-destino"][value="stock"]').checked || $('input[name="veh-elim-destino"][value="baja"]').checked) fail('eliminar: el stock debe venir elegido y la baja no');
  if(txt('#veh-elim-destinos').indexOf('Enviar los ' + nVivos + ' neumáticos al stock') === -1 || txt('#veh-elim-destinos').indexOf('Dar de baja los ' + nVivos + ' neumáticos') === -1) fail('eliminar: opciones: ' + txt('#veh-elim-destinos'));
  if(!/vuelven al stock/.test(txt('#veh-elim-resumen'))) fail('eliminar: resumen: ' + txt('#veh-elim-resumen'));
  // Error de la RPC: mensaje claro dentro del diálogo, que sigue abierto y se puede reintentar.
  var ce2 = w.console.error; w.console.error = function(){};
  fx.rpcError = {code: '42501', message: 'permiso denegado'};
  $('#veh-elim-form').requestSubmit(); await sleep(300);
  w.console.error = ce2; fx.rpcError = null;
  if(rpcs('vehiculo_eliminar').length !== 1 || !/Sin permiso para eliminar este vehículo/.test(txt('#veh-elim-error')) || !$('#modal-veh-eliminar').classList.contains('show')) fail('eliminar: error de la RPC no mostrado: ' + txt('#veh-elim-error'));
  if($('#veh-elim-confirmar').disabled) fail('eliminar: el botón quedó bloqueado tras el error');
  // Doble envío (dos Enter seguidos): una sola eliminación
  $('#veh-elim-form').requestSubmit(); $('#veh-elim-form').requestSubmit();
  await esperar(function(){ return rpcs('vehiculo_eliminar').length === 2; }, 'la RPC de eliminar');
  await sleep(400);
  if(rpcs('vehiculo_eliminar').length !== 2) fail('eliminar: el doble envío llegó a la RPC ' + (rpcs('vehiculo_eliminar').length - 1) + ' veces');
  if(JSON.stringify(rpcs('vehiculo_eliminar')[1].args) !== '{"p_vehiculo_id":13,"p_destino_neumaticos":"stock"}') fail('eliminar: argumentos de la RPC: ' + JSON.stringify(rpcs('vehiculo_eliminar')[1].args));
  if($('#modal-veh-eliminar').classList.contains('show')) fail('eliminar: el diálogo no se cerró al terminar');
  if(!$('#view-vehiculos').classList.contains('active')) fail('eliminar: debe volver a la lista de vehículos');
  if(vivos().length !== 0 || T.neumaticos.filter(function(x){ return x.vehiculo_id === null && x.estado === 'almacenado'; }).length < nVivos) fail('eliminar: los neumáticos debían quedar en el stock');
  var inp2 = $('#search-vehiculos'); inp2.value = '301'; inp2.dispatchEvent(new w.Event('input', {bubbles: true})); await sleep(200);
  if(/Coche 301/.test(txt('#veh-lista'))) fail('eliminar: el vehículo eliminado sigue en la lista: ' + txt('#veh-lista'));

  // Toast de error: sin la marca de éxito (no mezclar ✓ con un mensaje de falla). Se prueba con el módulo real de la interfaz.
  var ui = await new w.Function('return import("/assets/js/core/ui.js")')();
  ui.showToast('Algo falló', true); await sleep(50);
  if(visible('#toast-ico-ok') || !visible('#toast-ico-error')) fail('montar: el toast de error no debe llevar ✓ sino su propio ícono');
  ui.showToast('Todo bien'); await sleep(50);
  if(!visible('#toast-ico-ok') || visible('#toast-ico-error')) fail('montar: el toast de éxito debe llevar ✓');
  log.push('montar-ok rpcs=' + fx.rpcs.length);

};

// Perfil de sucursal montando una cubierta nueva (?cliente=1&secuser=1&detalle=1&montar=1): no ve el precio (la base se lo oculta
// con privilegios por columna, ver precios.flow.js) y «Km que ya traía» arranca vacío, no en 0. El perfil global (montarFlow) sí ve
// el precio. «Del stock» sigue deshabilitado para sucursal: requiere una migración y revisión del DBA (queda fuera de este PR).
window.montarSucursalFlow = async function(w, d, sleep, fail, log){
  var $ = function(s){ return d.querySelector(s); };
  var visible = function(sel){ var e = $(sel); return !!e && e.getClientRects().length > 0; };
  var esperar = async function(cond, que){ for(var t = 0; t < 60; t++){ if(cond()) return true; await sleep(50); } fail('montar-sucursal: timeout esperando ' + que); return false; };
  $('.nav-item[data-view="vehiculos"]').click(); await sleep(600);
  var inp = $('#search-vehiculos'); inp.value = '301'; inp.dispatchEvent(new w.Event('input', {bubbles: true})); await sleep(150);
  inp.dispatchEvent(new w.KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true})); await sleep(900);
  var abrir = $('#vd-resumen [data-action="neumatico-montar"]');
  if(!abrir){ fail('montar-sucursal: el perfil de sucursal debe poder montar (falta «Cargar neumáticos»)'); return; }
  if($('#vd-cab [data-action="vehiculo-eliminar"]')) fail('montar-sucursal: el usuario de sucursal no debe ver «Eliminar vehículo»');
  abrir.click();
  if(!await esperar(function(){ return $('#modal-montar').classList.contains('show'); }, 'el modal de montar')) return;
  $('#mont-tab-nuevo').click(); await sleep(100);
  if(!visible('#mont-km-previos')) fail('montar-sucursal: falta «Km que ya traía»');
  if($('#mont-km-previos').value !== '') fail('montar-sucursal: «Km que ya traía» debe empezar vacío, no «' + $('#mont-km-previos').value + '»');
  if(visible('#mont-precio') || visible('label[for="mont-precio"]')) fail('montar-sucursal: el precio no debe verse para el perfil de sucursal');
  log.push('montar-sucursal-ok');
};
