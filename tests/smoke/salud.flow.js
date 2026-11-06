// Recorrido de humo de salud de dispositivos y ficha de cliente. Lo invoca harness.html:
//   await window.saludFlow(w, d, sleep, fail, log, cliMode)
window.saludFlow = async function(w, d, sleep, fail, log, cliMode){
  var fx = w.__saludFx, $ = function(s){ return d.querySelector(s); };
  var nav = function(v){ $('.nav-item[data-view="'+v+'"]').click(); };
  var rows = function(){ return d.querySelectorAll('#tbody-salud tr[data-estado]').length; };
  var change = function(el, v){ el.value = v; el.dispatchEvent(new w.Event('change',{bubbles:true})); };

  // ── Salud de dispositivos ──
  nav('salud'); await sleep(500);
  if(!$('#view-salud').classList.contains('active')) fail('salud: vista no activa');
  if(rows() !== 4) fail('salud: filas esperadas 4, hay '+rows());
  var first = $('#tbody-salud tr[data-estado]').dataset.estado;
  if(first !== 'caido') fail('salud: el más grave debe ir primero, va '+first);
  if($('#view-salud').innerHTML.indexOf('Sensor <2>') !== -1) fail('salud: nombre sin escapar');
  if($('#tbody-salud').textContent.indexOf('Desactivado') === -1) fail('salud: falta marca de dispositivo desactivado');
  // filtro por estado (chip con data-action y select)
  $('.salud-chip[data-args=\'["caido"]\']').click(); await sleep(100);
  if(rows() !== 1) fail('salud: filtro caido devolvió '+rows());
  change($('#salud-estado'), 'nunca'); await sleep(100);
  if(rows() !== 1 || $('#tbody-salud tr[data-estado]').dataset.estado !== 'nunca') fail('salud: filtro nunca');
  change($('#salud-estado'), ''); await sleep(100);
  // filtro por cliente (solo admin)
  if(!cliMode){
    change($('#salud-cliente'), '2'); await sleep(100);
    if(rows() !== 2) fail('salud: filtro cliente 2 devolvió '+rows());
    change($('#salud-cliente'), ''); await sleep(100);
  }
  log.push('salud: filas='+rows());

  // ── Ficha de cliente ──
  nav('ficha'); await sleep(600);
  if(!$('#view-ficha').classList.contains('active')) fail('ficha: vista no activa');
  var kpis = $('#ficha-kpis').textContent;
  if(!/Vehículos activos/.test(kpis) || !/Críticos/.test(kpis)) fail('ficha: faltan KPIs del resumen');
  if(!$('#fu-umbral_bajo_mm') || $('#fu-umbral_bajo_mm').value !== '8') fail('ficha: umbral bajo no cargado');
  if(cliMode){
    if(!$('#fu-umbral_bajo_mm').disabled) fail('ficha: el cliente no debe poder editar umbrales');
    if($('#ficha-guardar').offsetParent !== null) fail('ficha: el cliente ve el botón guardar');
    log.push('ficha(cliente): ok');
    return;
  }
  var sv = function(k, v){ $('#fu-'+k).value = v; };
  var guardar = async function(){ $('#ficha-guardar').click(); await sleep(250); };
  var errTxt = function(){ return $('#ficha-umbral-error').classList.contains('show') ? $('#ficha-umbral-error').textContent : ''; };
  // validación local: no llega a la BD
  sv('umbral_critico_mm', '9'); await guardar();
  if(fx.updates.length !== 0) fail('ficha: umbrales inválidos llegaron a la BD');
  if(errTxt().indexOf('retiro < crítico < bajo') === -1) fail('ficha: falta error de orden: '+errTxt());
  // error de la BD (check) se muestra
  sv('umbral_critico_mm', '5.5'); fx.error = {code:'23514', message:'violates check constraint "clientes_umbrales_check"'};
  await guardar();
  if(fx.updates.length !== 1) fail('ficha: no se envió el update');
  if(errTxt().indexOf('clientes_umbrales_check') === -1) fail('ficha: no se muestra el error de la BD: '+errTxt());
  // UPDATE que afecta 0 filas (RLS): error visible, nunca éxito silencioso
  fx.error = null; fx.sinFilas = true; await guardar();
  if(fx.updates.length !== 2) fail('ficha: no se envió el update sin filas');
  if(errTxt().indexOf('No se guardó ningún cambio') === -1) fail('ficha: 0 filas sin error visible: '+errTxt());
  if($('#toast-msg').textContent.indexOf('Umbrales actualizados') !== -1) fail('ficha: éxito mostrado con 0 filas afectadas');
  // guardado correcto
  fx.sinFilas = false; await guardar();
  var u = fx.updates[fx.updates.length-1];
  if(fx.updates.length !== 3 || u.umbral_critico_mm !== 5.5 || u.umbral_bajo_mm !== 8) fail('ficha: payload de umbrales: '+JSON.stringify(u));
  if(errTxt()) fail('ficha: queda un error tras guardar bien: '+errTxt());
  if($('#toast-msg').textContent.indexOf('Umbrales actualizados') === -1) fail('ficha: falta aviso de guardado');
  // cambio de cliente y acceso desde la lista de clientes
  change($('#ficha-cliente'), '2'); await sleep(400);
  if($('#ficha-nombre').textContent === '') fail('ficha: sin nombre tras cambiar de cliente');
  nav('clientes'); await sleep(400);
  var b = $('#tbody-clientes [data-action="abrirFichaCliente"]');
  if(!b){ fail('ficha: falta acceso desde clientes'); return; }
  b.click(); await sleep(500);
  if(!$('#view-ficha').classList.contains('active')) fail('ficha: no abre desde clientes');
  log.push('ficha: ok updates='+fx.updates.length);
};
