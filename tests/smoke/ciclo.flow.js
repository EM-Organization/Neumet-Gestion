// Recorrido de humo de odómetro y ciclo de vida (admin). Lo invoca harness.html: await window.cicloFlow(w, d, sleep, fail, log)
window.cicloFlow = async function(w, d, sleep, fail, log){
  var fx = w.__cicloFx, $ = function(s){ return d.querySelector(s); };
  var writes = function(t, op){ return fx.writes.filter(function(x){ return x.table === t && (!op || x.op === op); }); };
  function setv(sel, v){ $(sel).value = v; }
  $('.nav-item[data-view="vehiculos"]').click(); await sleep(500);
  var nb = $('#tbody-vehiculos [data-va="ciclo"]');
  if(!nb){ fail('ciclo: sin botón Odómetro y ciclo de vida en la fila del vehículo'); return; }
  nb.click(); await sleep(500);
  if(!$('#modal-ciclo').classList.contains('show')) { fail('ciclo: modal no abierto'); return; }
  // El equipo Neumet solo mira (docs/17 PR 9): sin «Cambiar neumático» (ni su selector) en el modal
  if($('#modal-ciclo [data-action="neumatico-cambiar"]') || $('#ciclo-cambio-pos') || $('#ciclo-cambio-btn') || $('#ciclo-cambio').children.length) fail('ciclo: el equipo Neumet ve «Cambiar neumático»: ' + $('#ciclo-cambio').textContent);

  // El costo del evento llega de eventos_costos (la base no entrega la columna por select): se muestra al admin
  if($('#ciclo-timeline').textContent.indexOf('costo 230.5') === -1) fail('ciclo: la línea de tiempo no muestra el costo del montaje: ' + $('#ciclo-timeline').textContent.slice(0, 200));
  if(!w.__preciosFx.rpcs.some(function(r){ return r.name === 'eventos_costos' && r.args.p_vehiculo === 10; })) fail('ciclo: no pidió los costos del vehículo');

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
    // Ve costos pero no los registra: costo_registrar escribe costos_neumatico, que la migración C2 le corta
    if(cT.querySelector('[data-action="cicloRegistrarCosto"]') || /Registrar costo/.test(cT.innerHTML)) fail('ciclo: el equipo Neumet ve «Registrar costo»');
  }
  // Solo lectura para el equipo Neumet (docs/17 PR 9): sin formulario de odómetro ni de eventos, y ninguna escritura sobre
  // vehículos, neumáticos o eventos. Antes esta vista escribía odómetro, bajas e inspecciones y rotaba por RPC.
  ['#ciclo-odo-input', '#ciclo-odo-save', '#ciclo-form', '#ciclo-admin', '#ciclo-tipo', '#ciclo-ev-save'].forEach(function(sel){ if($(sel)) fail('ciclo: el equipo Neumet ve un control de escritura ' + sel); });
  if(!$('#ciclo-odo-val') || $('#ciclo-odo-val').textContent.trim() === '') fail('ciclo: el odómetro no se muestra en lectura: ' + $('#ciclo-odo').textContent);
  if($('#ciclo-odo').textContent.indexOf('administrador de la empresa') === -1) fail('ciclo: falta la indicación de quién corrige el kilometraje: ' + $('#ciclo-odo').textContent);
  if(writes('vehiculos').length || writes('neumaticos').length || writes('eventos_neumatico').length) fail('ciclo: el equipo Neumet escribió: ' + JSON.stringify(fx.writes));
  if(fx.rpcs.length) fail('ciclo: el equipo Neumet llamó a una RPC de escritura: ' + JSON.stringify(fx.rpcs));
  // Tampoco registra costos (costo_registrar escribe costos_neumatico): lo hace el administrador de empresa. Cubierto arriba y en la ausencia de RPC.
  log.push('ciclo-flow: solo lectura, writes=' + fx.writes.length);
  $('[data-action="closeCicloVida"]').click(); await sleep(100);
  if($('#modal-ciclo').classList.contains('show')) fail('ciclo: modal no cerrado');
  // Entrada desde el detalle: solo para el administrador de empresa. El equipo Neumet no la ve (el modal no es suyo para escribir).
  $('.nav-item[data-view="vehiculos"]').click(); await sleep(400);
  var db = $('#tbody-vehiculos [data-va="detalle"]');
  if(db){ db.click(); await sleep(500); if($('#vd-cab [data-action="openCicloVida"]')) fail('ciclo: el equipo Neumet ve «Odómetro y ciclo de vida» en el detalle'); }
  else fail('ciclo: sin botón de detalle en la lista de vehículos');
};

// Administrador de empresa (cliente sin sucursal): desde el detalle del vehículo, un clic abre el mismo modal de ciclo de vida.
// Lo invoca harness.html con cliMode: await window.cicloEmpresaFlow(w, d, sleep, fail, log)
window.cicloEmpresaFlow = async function(w, d, sleep, fail, log){
  var $ = function(s){ return d.querySelector(s); };
  $('.nav-item[data-view="vehiculos"]').click(); await sleep(500);
  // Como cliente la lista es de filas (#veh-lista .veh-fila); el detalle se abre con un clic en la fila
  var det = $('#veh-lista .veh-fila');
  if(!det){ fail('ciclo-empresa: sin fila de vehículo en la lista'); return; }
  det.click(); await sleep(500);
  var entrada = $('#vd-cab [data-action="openCicloVida"]');
  if(!entrada){ fail('ciclo-empresa: el administrador de empresa no ve «Odómetro y ciclo de vida» en el detalle'); return; }
  entrada.click(); await sleep(500);
  if(!$('#modal-ciclo').classList.contains('show')) { fail('ciclo-empresa: la entrada del detalle no abre el modal'); return; }
  // Mismo modal que la lista: el kilometraje es editable para el cliente y el título nombra el vehículo abierto
  if(!$('#ciclo-odo-input')) fail('ciclo-empresa: falta el formulario de kilometraje para el administrador de empresa');
  if(!/Odómetro y ciclo de vida · /.test($('#ciclo-title').textContent)) fail('ciclo-empresa: título del modal: ' + $('#ciclo-title').textContent);
  // La acción de la rueda ya cubre el cambio: el bloque «Cambiar neumático (taller)» no se duplica con un segundo botón primario
  if($('#ciclo-cambio-btn') || /Cambiar neumático \(taller\)/.test($('#ciclo-cambio').textContent)) fail('ciclo-empresa: el modal abierto desde el detalle repite «Cambiar neumático (taller)»');
  log.push('ciclo-empresa-flow: entrada desde el detalle abre el modal');
  $('[data-action="closeCicloVida"]').click(); await sleep(100);
};
