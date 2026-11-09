// Recorrido de humo de Flota y Alertas (admin). Lo invoca harness.html: await window.flotaFlow(w, d, sleep, fail, log)
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
  if(orden !== 'critico,bajo,sin_datos,ok') fail('flota: orden por severidad incorrecto: '+orden);
  var kp = Array.prototype.map.call(all('#flota-kpis .dash-kpi-val'), function(k){ return k.textContent; }).join(',');
  log.push('flota-kpis='+kp);
  if(kp !== '4,1,2,4') fail('flota: KPIs inesperados: '+kp);
  if(d.body.innerHTML.indexOf('<Crítica>') !== -1) fail('flota: nombre de vehiculo sin escapar');
  if(all('#flota-cliente option').length !== 3) fail('flota: select de clientes incompleto');
  setSel('#flota-cliente', '2'); await sleep(100);
  if(all('#flota-grid .flota-card').length !== 2) fail('flota: filtro por cliente');
  setSel('#flota-cliente', ''); setSel('#flota-estado', 'critico'); await sleep(100);
  if(all('#flota-grid .flota-card').length !== 1) fail('flota: filtro por estado');
  setSel('#flota-estado', '');

  // Enlace al vehículo: abre el detalle
  var link = $('#flota-grid .flota-card [data-action="verVehiculo"]');
  if(!link){ fail('flota: sin enlace Ver vehiculo'); return; }
  link.click(); await sleep(400);
  if(!$('#view-vehiculo-detalle').classList.contains('active')) fail('flota: el enlace no abre el detalle');
  if(!/Volver a /.test($('#vd-volver').textContent)) fail('flota: falta el botón Volver');

  // --- Alertas ---
  if(!nav('alertas')) return;
  await sleep(500);
  if(!$('#view-alertas').classList.contains('active')) fail('alertas: vista no activa');
  var rows = function(){ return all('#alert-tbody tr[data-severidad]'); };
  log.push('alertas-filas='+rows().length);
  if(rows().length !== 4) fail('alertas: se esperaban 4 filas, hay '+rows().length);
  if(rows()[0].dataset.severidad !== '3') fail('alertas: la primera no es la mas severa');
  if(rows()[0].textContent.indexOf('Neumático crítico: 3 mm') === -1) fail('alertas: falta mensaje');
  if(!rows()[0].querySelector('[data-action="verVehiculo"]')) fail('alertas: falta enlace al vehiculo');
  if(Array.prototype.filter.call(rows(), function(r){ return r.querySelector('.pos-mini .mini-veh .mv-dest'); }).length !== 4) fail('alertas: cada alerta de rueda debe mostrar el mini vehículo con la rueda resaltada');
  if(!/Delantera izquierda/.test(rows()[0].textContent) || /(^|\s)P\d/.test(rows()[0].textContent)) fail('alertas: posición sin nombre: '+rows()[0].textContent);
  if(!/Posición/.test($('#view-alertas thead').textContent)) fail('alertas: falta la columna Posición');
  if(d.body.innerHTML.indexOf('<Crítica>') !== -1 || d.body.innerHTML.indexOf('<Beta>') !== -1) fail('alertas: HTML sin escapar');
  if(Array.prototype.filter.call(rows(), function(r){ return r.querySelector('[data-action="alertasResolver"]') && r.querySelector('[data-action="alertasSilenciar"], [data-action="alertasQuitarSilencio"]'); }).length !== 4) fail('alertas: cada alerta debe ofrecer reconocer/silenciar/resolver');
  if(rows()[0].querySelector('[data-action="verVehiculo"]').dataset.args !== '[12,1]') fail('alertas: el enlace debe llevar al vehículo y la posición');
  setSel('#alert-estado', 'reconocida'); await sleep(100);
  if(rows().length !== 1 || rows()[0].querySelector('[data-action="alertasReconocer"]')) fail('alertas: filtro reconocidas');
  setSel('#alert-estado', 'silenciada'); await sleep(100);
  if(rows().length !== 1 || !rows()[0].querySelector('[data-action="alertasQuitarSilencio"]')) fail('alertas: filtro silenciadas');
  setSel('#alert-estado', ''); setSel('#alert-cliente', '1'); await sleep(100);
  if(rows().length !== 2) fail('alertas: filtro cliente');
  setSel('#alert-cliente', '');
  var chip = $('#alert-chips [data-action="alertasEstado"]'); // primer chip = Abiertas (la silenciada no cuenta como abierta)
  if(!chip){ fail('alertas: sin chips'); return; }
  if(!/2/.test(chip.textContent)) fail('alertas: el chip Abiertas debía contar 2: '+chip.textContent);
  chip.click(); await sleep(100);
  if(rows().length !== 2) fail('alertas: chip de estado abiertas');
  $('#alert-chips [data-action="alertasEstado"]').click(); await sleep(100);
  if(rows().length !== 4) fail('alertas: chip no alterna');
  if(!$('#alert-config').hidden) fail('alertas: el bloque de nivel crítico solo es para el cliente global');
  var qs = fx.queries.join(',');
  log.push('flota-consultas='+qs);
  if(qs.indexOf('v_estado_neumaticos') === -1 || qs.indexOf('v_alertas') === -1 || qs.indexOf('v_resumen_flota_cliente') === -1) fail('flota: no consulto las vistas SQL');
};
