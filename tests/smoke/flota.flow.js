// Recorrido de humo de Flota y Alertas (admin). Lo invoca harness.html: await window.flotaFlow(w, d, sleep, fail, log)
// Alerta «Primera rotación» con km del tramo: el modal de resolver debe decir «… km desde el montaje» (no «swap»).
var ALERTA_SWAP_EXTRA = [{cliente_id:1,vehiculo_id:10,vehiculo_nombre:'Camión 01',patente:'AB123CD',posicion:null,tipo:'swap',severidad:2,valor:null,km_actual:52300,mensaje:'Hacer el swap: intercambiar el juego de neumáticos entre ejes',ultima_medicion_at:new Date(Date.now()-4*86400000).toISOString(),alerta_id:105,estado:'abierta',silenciada_hasta:null}];

window.flotaFlow = async function(w, d, sleep, fail, log){
  var fx = w.__flotaFx, $ = function(s){ return d.querySelector(s); }, all = function(s){ return d.querySelectorAll(s); };
  var setSel = function(id, v){ var el = $(id); el.value = v; el.dispatchEvent(new w.Event('change',{bubbles:true})); };
  var nav = function(v){ var el = $('.nav-item[data-view="'+v+'"]'); if(!el){ fail('no existe nav '+v); return false; } el.click(); return true; };

  // --- Flota ---
  if(!nav('flota')) return;
  await sleep(500);
  if(!$('#view-flota').classList.contains('active')) fail('flota: vista no activa');
  var cards = all('#flota-grid .flota-card');
  log.push('flota-cards='+cards.length);
  if(cards.length !== 4) fail('flota: se esperaban 4 vehiculos, hay '+cards.length);
  var orden = Array.prototype.map.call(cards, function(c){ return c.dataset.semaforo; }).join(',');
  log.push('flota-orden='+orden);
  if(orden !== 'desgaste_limite,desgaste_limite,desconocido,nuevo') fail('flota: orden por severidad incorrecto: '+orden);
  var kp = Array.prototype.map.call(all('#flota-kpis .dash-kpi-val'), function(k){ return k.textContent; }).join(',');
  log.push('flota-kpis='+kp);
  if(kp !== '4,3,0,1,4') fail('flota: KPIs inesperados: '+kp);
  if(d.body.innerHTML.indexOf('<Crítica>') !== -1) fail('flota: nombre de vehiculo sin escapar');
  if(all('#flota-cliente option').length !== 3) fail('flota: select de clientes incompleto');
  setSel('#flota-cliente', '2'); await sleep(100);
  if(all('#flota-grid .flota-card').length !== 2) fail('flota: filtro por cliente');
  setSel('#flota-cliente', ''); setSel('#flota-estado', 'desgaste_limite'); await sleep(100);
  if(all('#flota-grid .flota-card').length !== 2) fail('flota: filtro por estado');
  setSel('#flota-estado', '');

  // Enlace al vehículo: abre el detalle
  var link = $('#flota-grid .flota-card [data-action="verVehiculo"]');
  if(!link){ fail('flota: sin enlace Ver vehiculo'); return; }
  link.click(); await sleep(900);
  if(!$('#view-vehiculo-detalle').classList.contains('active')) fail('flota: el enlace no abre el detalle');
  if($('#breadcrumb-parent').hidden || !/Estado de la flota/.test($('#breadcrumb-parent').textContent)) fail('flota: la miga debe mostrar Estado de la flota ('+$('#breadcrumb-parent').textContent+')');

  // --- Alertas ---
  if(!nav('alertas')) return;
  await sleep(500);
  if(!$('#view-alertas').classList.contains('active')) fail('alertas: vista no activa');
  var rows = function(){ return all('#alert-tbody tr[data-severidad]'); };
  log.push('alertas-filas='+rows().length);
  if(rows().length !== 2) fail('alertas: al entrar se esperaban 2 filas abiertas (sin la reconocida ni la silenciada), hay '+rows().length);
  if(rows()[0].dataset.severidad !== '3') fail('alertas: la primera no es la mas severa');
  if(rows()[0].textContent.indexOf('2,9 mm (umbral 3 mm)') === -1) fail('alertas: falta mensaje');
  // El chip ya nombra el tipo: el mensaje no repite el prefijo «Desgaste límite:» que trae la base (detalleAlerta).
  if(/Desgaste límite:/.test(rows()[0].textContent)) fail('alertas: el mensaje repite el tipo: ' + rows()[0].textContent.replace(/\s+/g, ' ').slice(0, 160));
  if(!rows()[0].querySelector('[data-action="verVehiculo"]')) fail('alertas: falta enlace al vehiculo');
  if(Array.prototype.filter.call(rows(), function(r){ return r.querySelector('.pos-mini .mini-veh .mv-dest'); }).length !== 2) fail('alertas: cada alerta de rueda debe mostrar el mini vehículo con la rueda resaltada');
  if(!/Delantera izquierda/.test(rows()[0].textContent) || /(^|\s)P\d/.test(rows()[0].textContent)) fail('alertas: posición sin nombre: '+rows()[0].textContent);
  // Cinco columnas: vehículo y posición, problema, abierta hace, reconocer y más (docs/10 ola 5).
  if($('#view-alertas thead').querySelectorAll('th').length !== 5) fail('alertas: la tabla debe tener 5 columnas');
  if(!/Vehículo y posición/.test($('#view-alertas thead').textContent)) fail('alertas: falta la columna Vehículo y posición');
  if(d.body.innerHTML.indexOf('<Crítica>') !== -1 || d.body.innerHTML.indexOf('<Beta>') !== -1) fail('alertas: HTML sin escapar');
  // F10 PR 10: el equipo Neumet no opera dentro de una empresa. Ve las alertas y puede ir al vehículo, sin reconocer, silenciar ni resolver.
  var GESTION = '[data-action="alertasReconocer"],[data-action="alertasSilenciar"],[data-action="alertasQuitarSilencio"],[data-action="alertasResolver"]';
  if(all('#view-alertas ' + GESTION.split(',').join(',#view-alertas ')).length) fail('alertas(admin): ofrece reconocer/silenciar/resolver al equipo Neumet');
  if(Array.prototype.filter.call(rows(), function(r){ return r.querySelector('[data-action="verVehiculo"]'); }).length !== 2) fail('alertas(admin): cada alerta debe seguir ofreciendo «Ver vehículo»');
  if(rows()[0].querySelector('[data-action="verVehiculo"]').dataset.args !== '[12,1]') fail('alertas: el enlace debe llevar al vehículo y la posición');
  // Un solo mecanismo de estado: los chips con conteo (sin select «Todos los estados»); clic filtra, otro clic quita el filtro.
  if($('#alert-estado')) fail('alertas: sigue el select de estado junto a los chips');
  var chipN = function(i){ return all('#alert-chips [data-action="alertasEstado"]')[i]; };
  var activoChip = all('#alert-chips [aria-pressed="true"]')[0];
  if(!activoChip || !/Abiertas/.test(activoChip.textContent)) fail('alertas: al entrar, el chip Abiertas debe estar activo');
  chipN(2).click(); await sleep(100);
  if(rows().length !== 1 || rows()[0].querySelector('[data-action="alertasReconocer"]')) fail('alertas: filtro reconocidas');
  if(chipN(2).getAttribute('aria-pressed') !== 'true' || chipN(1).getAttribute('aria-pressed') !== 'false') fail('alertas: aria-pressed del chip activo');
  chipN(3).click(); await sleep(100);
  if(rows().length !== 1 || rows()[0].querySelector('[data-action="alertasQuitarSilencio"]')) fail('alertas: filtro silenciadas');
  chipN(0).click(); await sleep(100);
  if(rows().length !== 4) fail('alertas: «Todas» debía mostrar 4 filas, hay ' + rows().length);
  chipN(1).click(); await sleep(100);
  if(rows().length !== 2) fail('alertas: el chip Abiertas debía mostrar 2 filas, hay ' + rows().length);
  // Rojo solo para lo crítico: ningún estado de la alerta va en rojo.
  if(all('#alert-chips .badge.red, #alert-tbody .alerta-estado .badge.red').length) fail('alertas: el estado de la alerta usa rojo');
  setSel('#alert-cliente', '1'); await sleep(100);
  if(rows().length !== 2) fail('alertas: filtro cliente');
  setSel('#alert-cliente', '');
  if(!/Abiertas 2/.test(chipN(1).textContent)) fail('alertas: el chip Abiertas debía contar 2: '+chipN(1).textContent);
  // El nivel crítico ya no se edita en Alertas (vive en Empresa > Umbrales): sin tarjeta, sin campos y sin la RPC.
  if($('#alert-config') || $('#alert-umbral') || $('#alert-histeresis') || $('[data-action="alertasGuardarConfig"]')) fail('alertas: sigue la tarjeta de nivel crítico');
  if(!$('#alert-umbral-aviso') || !$('#alert-umbral-aviso').hidden) fail('alertas: el aviso de Empresa > Umbrales es solo para el administrador de empresa');
  if(fx.rpcs && fx.rpcs.some(function(r){ return r[0] === 'alerta_configurar'; })) fail('alertas: llamó a alerta_configurar');
  // Guarda propia de cada acción: aunque otro botón emita la acción, el equipo Neumet no llama a la RPC ni abre el modal.
  var falsos = ['alertasReconocer', 'alertasSilenciar', 'alertasQuitarSilencio', 'alertasResolver', 'alertasConfirmarResolver'];
  for(var i = 0; i < falsos.length; i++){
    var f = d.createElement('button'); f.type = 'button'; f.setAttribute('data-action', falsos[i]); f.setAttribute('data-args', '[501]');
    d.body.appendChild(f); f.click(); await sleep(400); f.remove();
    if($('#modal-alerta').classList.contains('show')) fail('alertas(admin): ' + falsos[i] + ' abrió el modal de resolver');
  }
  var esc = (fx.rpcs || []).filter(function(r){ return /^alerta_(reconocer|silenciar|resolver)$/.test(r[0]); });
  if(esc.length) fail('alertas(admin): el equipo Neumet llamó RPC de escritura: ' + JSON.stringify(esc));
  var qs = fx.queries.join(',');
  log.push('flota-consultas='+qs);
  if(qs.indexOf('v_estado_neumaticos') === -1 || qs.indexOf('v_alertas') === -1 || qs.indexOf('v_resumen_flota_cliente') === -1) fail('flota: no consulto las vistas SQL');
  // Recuadro de Inicio con estas alertas: tres sin silenciar (dos abiertas y una reconocida) y una silenciada, que no cuenta.
  // Las cifras en cero no se muestran (docs/10 ola 5).
  if(!nav('inicio')) return;
  await sleep(700);
  var inicioTxt = $('#inicio-contenido').textContent.replace(/\s+/g, ' ');
  if(!/× 3 cambiar/.test(inicioTxt) || /0 revisar/.test(inicioTxt)) fail('inicio (flota): el recuadro debe ser «× 3 cambiar», sin «0 revisar» (la silenciada no cuenta): ' + inicioTxt.slice(0, 200));
  // El texto cuenta alertas de cualquier tipo: un swap o un «Pasar atrás» no son desgaste límite (sinReconocer).
  if(/de desgaste límite sin reconocer/.test(inicioTxt)) fail('inicio (flota): el texto dice «de desgaste límite» y cuenta alertas de cualquier tipo: ' + inicioTxt.slice(0, 200));
  if(!/Ver alertas abiertas \(2\)/.test(inicioTxt)) fail('inicio (flota): falta el enlace «Ver alertas abiertas (2)»: ' + inicioTxt.slice(0, 200));
  // Color (RN-20): «cambiar» en rojo (hay tres) y sin «revisar», porque es cero. Rojo solo para lo crítico (docs/14).
  var recI = $('#inicio-contenido .inicio-linea');
  if(!recI || !recI.querySelector('.badge.red') || recI.querySelector('.badge.gray') || recI.querySelector('.badge.orange')) fail('inicio (flota): el recuadro debe ser solo «cambiar», en rojo');
  // Tipo de cada alerta (presentacionAlerta, docs/14): cada límite lleva «× Desgaste límite» en rojo; una alerta de cambio de
  // posición va en amarillo con «◎ Primera rotación» y nada en rojo. Va al final, con una alerta propia, para no mover las cifras de arriba.
  fx.alertasExtra = ALERTA_SWAP_EXTRA;
  if(!nav('alertas')) return;
  await sleep(700);
  var limites = all('#alert-tbody tr[data-tipo="limite"]');
  if(limites.length !== 2 || Array.prototype.some.call(limites, function(r){ var b = r.querySelector('.badge.red'); return !b || !/× Desgaste límite/.test(b.textContent); })) fail('alertas: cada alerta de desgaste límite debe llevar «× Desgaste límite» en rojo');
  // El chip de tipo no se parte en el móvil («Desgaste / límite»): el envoltorio .alerta-tipo va con nowrap (styles.css).
  var tipoEl = limites[0] && limites[0].querySelector('.alerta-tipo');
  if(!tipoEl || w.getComputedStyle(tipoEl).whiteSpace !== 'nowrap') fail('alertas: el chip de tipo debe ir sin salto de línea (.alerta-tipo): ' + (tipoEl ? w.getComputedStyle(tipoEl).whiteSpace : 'sin .alerta-tipo'));
  var swap = $('#alert-tbody tr[data-tipo="swap"]');
  if(!swap) fail('alertas: falta la alerta de cambio de posición');
  else {
    var tSwap = swap.textContent.replace(/\s+/g, ' ');
    if(/Neumático crítico/.test(tSwap) || swap.querySelector('.badge.red')) fail('alertas: la alerta de cambio de posición no debe ir en rojo ni decir «Neumático crítico»: ' + tSwap);
    if(!swap.querySelector('.badge.orange') || !/◎ Primera rotación/.test(tSwap)) fail('alertas: la alerta de cambio de posición debe llevar «◎ Primera rotación» en amarillo: ' + tSwap);
    if(/swap/i.test(tSwap)) fail('alertas: la alerta de cambio de posición no debe decir «swap» (jerga, docs/14 §5): ' + tSwap);
  }
  fx.alertasExtra = null;
};


// Contraparte positiva (F10 PR 10): el cliente (administrador de empresa o global) conserva reconocer, silenciar y resolver.
// Se corre con ?cliente=1&alertas=1; la RPC es simulada por flota.fixture.js, que registra la llamada en fx.rpcs.
window.alertasClienteFlow = async function(w, d, sleep, fail, log){
  var fx = w.__flotaFx, $ = function(s){ return d.querySelector(s); }, all = function(s){ return d.querySelectorAll(s); };
  fx.alertasExtra = ALERTA_SWAP_EXTRA; // para el modal de resolver con «km desde el montaje» (al final de este recorrido)
  $('.nav-item[data-view="alertas"]').click(); await sleep(700);
  if(!$('#view-alertas').classList.contains('active')) { fail('alertas(cliente): vista no activa'); return; }
  var filas = all('#alert-tbody tr[data-severidad]');
  if(!filas.length) { fail('alertas(cliente): sin filas'); return; }
  var conAcciones = Array.prototype.filter.call(filas, function(r){ return r.querySelector('[data-action="alertasResolver"]') && r.querySelector('[data-action="alertasSilenciar"], [data-action="alertasQuitarSilencio"]'); });
  if(conAcciones.length !== filas.length) fail('alertas(cliente): cada alerta debe ofrecer reconocer/silenciar/resolver (' + conAcciones.length + ' de ' + filas.length + ')');
  // Jerarquía de acciones (H10): «Reconocer» y «Ver vehículo» a la vista; Silenciar y Resolver dentro de «Más».
  var vis = function(e){ return !!(e && e.getClientRects().length); };
  var fila1 = filas[0], tx = function(e){ return e.textContent.trim(); };
  // Una sola acción visible además del nombre del vehículo: «Reconocer»; el resto va en «Más».
  var visibles1 = Array.prototype.filter.call(fila1.querySelectorAll('td > button:not(.alert-veh), td > .menu-mas > button'), vis).map(tx).join('|');
  if(visibles1 !== 'Reconocer|Más') fail('alertas(cliente): acciones visibles de la primera fila: ' + visibles1);
  var menu1 = Array.prototype.map.call(fila1.querySelectorAll('.menu-mas-item'), tx).join('|');
  if(!/^(Silenciar \d+ días|Quitar silencio)\|Resolver\|Ver vehículo$/.test(menu1)) fail('alertas(cliente): ítems del menú Más: ' + menu1);
  var mas1 = fila1.querySelector('[data-menu-mas-btn]');
  mas1.click(); await sleep(100);
  if(mas1.getAttribute('aria-expanded') !== 'true' || !vis(fila1.querySelector('.menu-mas-lista'))) fail('alertas(cliente): Más no abrió el menú');
  // Abrir «Más» no abre la ficha: la fila sigue siendo de Alertas.
  if(!$('#view-alertas').classList.contains('active')) fail('alertas(cliente): abrir Más abrió la ficha del vehículo');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(100);
  if(mas1.getAttribute('aria-expanded') !== 'false' || d.activeElement !== mas1) fail('alertas(cliente): Esc no cerró el menú ni devolvió el foco');
  // Clic en una celda (no en un botón) de la fila: abre la ficha del vehículo con la rueda de la alerta.
  fila1.querySelector('td[data-label="Problema"]').click(); await sleep(500);
  if(!$('#view-vehiculo-detalle').classList.contains('active')) { fail('alertas(cliente): el clic en la fila no abrió la ficha'); return; }
  $('.nav-item[data-view="alertas"]').click(); await sleep(500);
  // Ancho (H1/H10): sin desplazamiento horizontal del documento y con las acciones dentro de la tarjeta, a 940 y 390 px.
  var marco = w.frameElement, anchoOrig = marco.style.width;
  for(var wi = 0, anchos = [360, 390, 940, 1280, 1400]; wi < anchos.length; wi++){
    marco.style.width = anchos[wi] + 'px'; await sleep(250);
    var de = d.documentElement, tarj = $('#alert-tbody').closest('.card, .table-wrap').getBoundingClientRect();
    if(de.scrollWidth > de.clientWidth) fail('alertas(' + anchos[wi] + 'px): el documento se desplaza en horizontal (' + de.scrollWidth + ' > ' + de.clientWidth + ')');
    Array.prototype.forEach.call(all('#alert-tbody td > button, #alert-tbody td > .menu-mas'), function(b){
      var r = b.getBoundingClientRect();
      if(r.width && (r.left < tarj.left - 1 || r.right > tarj.right + 1)) fail('alertas(' + anchos[wi] + 'px): una acción se sale de la tarjeta (' + Math.round(r.left) + '-' + Math.round(r.right) + ' vs ' + Math.round(tarj.left) + '-' + Math.round(tarj.right) + ')');
    });
  }
  marco.style.width = anchoOrig; await sleep(250);
  var rec = $('#alert-tbody [data-action="alertasReconocer"]');
  if(!rec) { fail('alertas(cliente): sin «Reconocer»'); return; }
  rec.click(); await sleep(500);
  if(!(fx.rpcs || []).some(function(r){ return r[0] === 'alerta_reconocer'; })) fail('alertas(cliente): Reconocer no llamó a alerta_reconocer');
  if($('#toast-msg').textContent !== 'Alerta reconocida') fail('alertas(cliente): aviso tras reconocer: ' + $('#toast-msg').textContent);
  // Silenciadas: a un clic en su chip, sin el botón «Reconocer».
  all('#alert-chips [data-action="alertasEstado"]')[3].click(); await sleep(200);
  if(!all('#alert-tbody tr[data-severidad]').length || $('#alert-tbody [data-action="alertasReconocer"]')) fail('alertas(cliente): la silenciada no debe ofrecer «Reconocer»');
  all('#alert-chips [data-action="alertasEstado"]')[1].click(); await sleep(200);
  var sil = $('#alert-tbody [data-action="alertasSilenciar"]');
  if(sil){ sil.click(); await sleep(500); if(!(fx.rpcs || []).some(function(r){ return r[0] === 'alerta_silenciar'; })) fail('alertas(cliente): Silenciar no llamó a alerta_silenciar'); }
  $('#alert-tbody [data-action="alertasResolver"]').click(); await sleep(300);
  if(!$('#modal-alerta').classList.contains('show')) { fail('alertas(cliente): Resolver no abrió el modal'); return; }
  $('#alerta-nota').value = 'Neumático cambiado'; $('#alerta-confirmar').click(); await sleep(600);
  if(!(fx.rpcs || []).some(function(r){ return r[0] === 'alerta_resolver'; })) fail('alertas(cliente): Resolver no llamó a alerta_resolver');
  // La alerta de cambio de posición: el modal dice los km del tramo, no la jerga «swap».
  $('#alert-tbody tr[data-tipo="swap"] [data-action="alertasResolver"]').click(); await sleep(300);
  var subSwap = $('#alerta-sub').textContent;
  if(!/km desde el montaje/.test(subSwap) || /swap/i.test(subSwap)) fail('alertas(cliente): el modal de la primera rotación debe decir «… km desde el montaje»: ' + subSwap);
  $('#modal-alerta [data-action="alertasCerrarResolver"]').click(); await sleep(200);
  fx.alertasExtra = null;
  log.push('alertas-cliente: reconocer, silenciar y resolver conservados');
};
