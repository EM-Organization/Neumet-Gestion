// Recorrido de humo de Vehículos como cliente: buscador (patente / número), detalle con diagrama de 10 ruedas coloreadas,
// panel de una rueda, contrato de acciones del taller. Lo invoca harness.html: await window.detalleFlow(w, d, sleep, fail, log)
window.detalleFlow = async function(w, d, sleep, fail, log){
  var $ = function(s){ return d.querySelector(s); }, all = function(s){ return d.querySelectorAll(s); };
  var escribir = function(v){ var i = $('#search-vehiculos'); i.value = v; i.dispatchEvent(new w.Event('input',{bubbles:true})); return i; };
  var enter = function(i){ i.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})); };
  var filas = function(){ return all('#veh-lista .veh-fila'); };

  // Sin parpadeo de orden: se registra cada pintado de la lista con 2+ filas; la lista no debe aparecer ordenada por nombre
  // para reordenarse por urgencia al llegar el estado de los neumáticos (un solo orden, el final).
  var pintados = [];
  new w.MutationObserver(function(){
    var o = Array.prototype.map.call(filas(), function(f){ return f.querySelector('.veh-fila-nombre').textContent; }).join('|');
    if(filas().length > 1 && pintados[pintados.length-1] !== o) pintados.push(o);
  }).observe($('#veh-lista'), {childList:true, subtree:true});
  $('.nav-item[data-view="vehiculos"]').click(); await sleep(600);
  if(!$('#view-vehiculos').classList.contains('active')) fail('detalle: vista Vehiculos no activa');
  log.push('veh-pintados='+pintados.length);
  if(pintados.length !== 1) fail('detalle: la lista se pinto '+pintados.length+' veces con ordenes distintos (parpadeo): '+pintados.join(' // '));
  // Cliente: sin ABM visible ni texto de relleno
  if($('#view-vehiculos .table-wrap').offsetParent !== null) fail('detalle: el cliente ve la tabla de administracion');
  if($('[data-action="openVehiculoModal"]') || $('#modal-vehiculo')) fail('detalle: queda el alta de vehiculos del panel viejo (la hace Sucursales, no Vehiculos)');
  if($('#veh-lista-wrap').offsetParent === null) fail('detalle: el cliente no ve la lista');
  log.push('veh-lista='+filas().length);
  if(filas().length !== 3) fail('detalle: se esperaban 3 vehiculos, hay '+filas().length);
  if(d.body.innerHTML.indexOf('<Crítica>') !== -1) fail('detalle: nombre sin escapar');
  if(!filas()[0].textContent.match(/Desgaste límite/)) fail('detalle: la lista no pone primero al vehiculo mas urgente / sin chip: '+filas()[0].textContent);

  // Concurrencia de la carga (loadVehiculos, guarda cargaId). Las cargas se disparan cambiando de vista; el estado de
  // neumáticos se retiene (fixture: __vehFx.retener / soltar) para que la carga A siga esperando cuando llega B.
  var contador = function(){ return $('#veh-contador').textContent; };
  var irA = function(){ $('.nav-item[data-view="mediciones"]').click(); return sleep(250).then(function(){ $('.nav-item[data-view="vehiculos"]').click(); return sleep(250); }); };
  var fx = w.__vehFx;
  // A espera el estado; el contador dice «Cargando…» y no un número viejo.
  fx.retener = true; var iA = fx.retenidas.length;
  await irA();
  if(contador() !== 'Cargando…') fail('espera: el contador debe decir «Cargando…» mientras espera el estado: «'+contador()+'»');
  if(!$('#veh-lista .loading-state')) fail('espera: la lista no muestra el estado de carga');
  // B falla mientras A espera: el error no deja «Cargando…» pegado ni el contador con un numero viejo.
  // El error de la carga se registra una vez con userError (console.error): es el fallo esperado, no un ruido del flujo.
  var ceOriginal = w.console.error, registrado = [];
  w.console.error = function(){ registrado.push(arguments[0] && arguments[0].message); };
  fx.fallarVehiculos = true;
  $('.nav-item[data-view="mediciones"]').click(); await sleep(200);
  $('.nav-item[data-view="vehiculos"]').click(); await sleep(300);
  fx.fallarVehiculos = false;
  w.console.error = ceOriginal;
  if(registrado.length !== 1 || registrado[0] !== 'red caída') fail('error: se esperaba un solo error registrado («red caída»): '+JSON.stringify(registrado));
  if(!$('#veh-lista .error-state')) fail('error: la lista no muestra el error de la carga');
  if(contador() !== '') fail('error: el contador debe quedar vacio tras el error: «'+contador()+'»');
  // Liberación tardía de A: no pisa el error de B.
  fx.soltar(iA); await sleep(200);
  if(!$('#veh-lista .error-state') || $('#veh-lista .loading-state')) fail('tardia: la respuesta de A pisó el estado de B');
  if(contador() !== '') fail('tardia: el contador cambió con la respuesta tardía de A: «'+contador()+'»');
  // Al volver a pintar la lista (buscar y borrar) no debe reaparecer «Cargando…» ni las filas de una carga anterior:
  // el estado de error con su botón Reintentar tiene que seguir ahí.
  escribir('x'); await sleep(100); escribir(''); await sleep(100);
  if(/Cargando/.test($('#veh-lista').textContent)) fail('error: «Cargando…» quedó pegado tras una carga fallida');
  if(filas().length || !$('#veh-lista .error-state')) fail('recuperacion: buscar y borrar tras el error pisó el estado de error (filas: '+filas().length+')');
  if(contador() !== '') fail('recuperacion: el contador de una carga anterior reapareció tras el error: «'+contador()+'»');
  // Reintentar (con la red de vuelta) recupera la lista sin recargar la página.
  var reint = $('#veh-lista [data-action="loadVehiculos"]');
  if(!reint) fail('recuperacion: el estado de error no ofrece Reintentar');
  fx.retener = false; reint.click(); await sleep(300);
  if(filas().length !== 3 || $('#veh-lista .error-state') || contador() !== '3 vehículos') fail('recuperacion: Reintentar no recuperó la lista (filas '+filas().length+', contador «'+contador()+'»)');
  fx.retener = false; fx.retenidas = [];
  // Orden: A y B vigente. Soltar A no toca la espera de B; al completar B el contador muestra el total.
  fx.retener = true; var iA2 = fx.retenidas.length;
  await irA(); var iB = fx.retenidas.length;
  $('.nav-item[data-view="mediciones"]').click(); await sleep(200);
  $('.nav-item[data-view="vehiculos"]').click(); await sleep(250);
  fx.soltar(iA2); await sleep(200);
  if(contador() !== 'Cargando…' || !$('#veh-lista .loading-state')) fail('orden: la respuesta tardia de A quito la espera vigente de B');
  fx.soltar(iB); await sleep(200);
  fx.retener = false; fx.retenidas = [];
  if(contador() !== '3 vehículos') fail('completa: el contador debe mostrar el total al completar: «'+contador()+'»');
  if(filas().length !== 3 || !filas()[0].textContent.match(/Desgaste límite/)) fail('completa: la lista no quedo con la carga de B y sus estados');

  // A 390 px: los dos textos y el chip caben sin cortar el nombre letra por letra ni desbordar; cada fila es un objetivo de 44 px o mas.
  var marco = w.frameElement;
  for(var ancho of [360, 375, 390, 481, 768, 1024]){
  marco.style.width = ancho+'px'; await sleep(300);
  var listaEl = $('#veh-lista');
  if(listaEl.scrollWidth > listaEl.clientWidth) fail(ancho+'px: la lista desborda en horizontal ('+listaEl.scrollWidth+' > '+listaEl.clientWidth+')');
  if(d.documentElement.scrollWidth > marco.clientWidth) fail(ancho+'px: la pagina desborda en horizontal ('+d.documentElement.scrollWidth+' > '+marco.clientWidth+')');
  filas().forEach(function(f){
    var r = f.getBoundingClientRect(), nb = f.querySelector('.veh-fila-nombre').getBoundingClientRect();
    if(r.height < 44) fail(ancho+'px: fila de '+r.height+' px, objetivo menor a 44');
    if(nb.width < 120) fail(ancho+'px: el nombre se corta (ancho '+Math.round(nb.width)+' px): '+f.textContent.replace(/\s+/g,' ').slice(0,80));
    if(f.scrollWidth > f.clientWidth) fail(ancho+'px: la fila desborda: '+f.textContent.replace(/\s+/g,' ').slice(0,80));
    var fe = f.querySelector('.veh-fila-estado');
    if(fe && fe.getBoundingClientRect().right > r.right + 0.5) fail(ancho+'px: el estado se sale de la fila');
  });
  }
  marco.style.width = '';

  // Buscar por patente (parcial, sin mayusculas ni espacios)
  escribir('ab 12'); await sleep(100);
  if(filas().length !== 1 || filas()[0].textContent.indexOf('Camión 01') === -1) fail('detalle: busqueda parcial por patente');
  escribir('cr0001'); await sleep(100);
  if(filas().length !== 1 || filas()[0].textContent.indexOf('Crítica') === -1) fail('detalle: busqueda "cr0001" no halla "CR 0001"');
  escribir('cr-00 01'); await sleep(100);
  if(filas().length !== 1 || filas()[0].textContent.indexOf('Crítica') === -1) fail('detalle: busqueda con guion y espacio "cr-00 01" no halla "CR 0001"');
  // Por numero de coche: "7" coincide con 07 y 7; la exacta (Tractor) va primero
  escribir('7'); await sleep(100);
  if(filas().length !== 2 || filas()[0].textContent.indexOf('Tractor') === -1) fail('detalle: busqueda por numero, orden exacta primero');
  escribir('zzzz'); await sleep(100);
  if(filas().length !== 0 || !$('#veh-lista .empty-state')) fail('detalle: sin resultados deberia explicar que hacer');

  // Enter con una sola coincidencia exacta abre directo (patente)
  var inp = escribir('AB123CD'); await sleep(100);
  enter(inp); await sleep(900);
  if(!$('#view-vehiculo-detalle').classList.contains('active')) { fail('detalle: Enter no abrio el detalle'); return; }

  // Escritorio de 1440 x 900: la medida de U1 (el panel no desplaza la página) y de U2 (colores de las etiquetas).
  var marcoDet = w.frameElement; marcoDet.style.width = '1440px'; marcoDet.style.height = '900px'; await sleep(300);
  // Color de un token resuelto por el navegador (sonda con background: var(...)): lo que debe pintar la etiqueta.
  var colorDe = function(token){ var sonda = d.createElement('div'); sonda.style.background = 'var(--' + token + ')'; d.body.appendChild(sonda); var c = w.getComputedStyle(sonda).backgroundColor; sonda.remove(); return c; };
  var etiquetaPinta = function(el, estilo, que){
    var cs = w.getComputedStyle(el);
    if(cs.backgroundColor !== colorDe('est-' + estilo + '-fill') || cs.borderTopColor !== colorDe('est-' + estilo + '-stroke')) fail('detalle: la etiqueta «' + que + '» debe pintar los tokens de ' + estilo + ' (fondo ' + cs.backgroundColor + ', borde ' + cs.borderTopColor + ')');
  };

  var llamadasScroll = [], scrollOriginal = w.Element.prototype.scrollIntoView;
  w.Element.prototype.scrollIntoView = function(o){ if(this.id === 'vd-panel') llamadasScroll.push({block: o && o.block}); return scrollOriginal.apply(this, arguments); };
  // Cabecera
  var cab = $('#vd-cab').textContent;
  log.push('detalle-cab='+cab.replace(/\s+/g,' ').slice(0,120));
  ['Camión 01','AB123CD','07','123.456 km','Última medición'].forEach(function(t){ if(cab.indexOf(t) === -1) fail('detalle: cabecera sin "'+t+'"'); });
  etiquetaPinta($('#vd-cab .vd-tag'), 'limite', 'Desgaste límite de la cabecera');
  // «Eliminar vehículo» (solo admin de empresa) vive en el menú «Más» de la cabecera, nunca como botón suelto.
  if(Array.prototype.some.call(all('#vd-cab .btn'), function(b){ return b.textContent.trim() === 'Eliminar vehículo'; })) fail('detalle: «Eliminar vehículo» no debe ser un botón suelto en la cabecera');
  var menuCab = $('#vd-cab [data-menu-mas]');
  if(!menuCab || !/Eliminar vehículo/.test(menuCab.textContent)) fail('detalle: el menú «Más» de la cabecera debe contener «Eliminar vehículo»');
  if(!$('#vd-cab .vd-tag.est-limite')) fail('detalle: el estado del vehículo (peor neumático) debe ser una etiqueta con estilo de desgaste límite');

  // Diagrama: 10 ruedas con una clase por estado, mm y símbolo (el color nunca va solo)
  var ruedas = all('#vd-diagrama .vd-rueda');
  log.push('ruedas='+ruedas.length);
  if(ruedas.length !== 10) fail('detalle: se esperaban 10 ruedas, hay '+ruedas.length);
  var estilos = {};
  Array.prototype.forEach.call(ruedas, function(g){
    var m = /est-(bueno|poco|mayor|limite|sinDatos)/.exec(g.getAttribute('class')); if(!m) { fail('detalle: rueda sin clase de estado'); return; }
    estilos[m[1]] = (estilos[m[1]] || 0) + 1;
    if(!g.querySelector('.vd-mm').textContent) fail('detalle: rueda sin mm');
    if(m[1] !== 'sinDatos' && !g.querySelector('.vd-sim').textContent) fail('detalle: rueda sin símbolo');
    if(g.getAttribute('tabindex') !== '0' || g.getAttribute('role') !== 'button' || !g.getAttribute('aria-label')) fail('detalle: rueda no accesible');
    if(g.querySelector('rect.vd-goma').hasAttribute('fill')) fail('detalle: el relleno de la rueda debe venir del CSS, no de un atributo');
  });
  log.push('estilos='+JSON.stringify(estilos));
  if(estilos.bueno !== 5 || estilos.poco !== 2 || estilos.mayor !== 1 || estilos.limite !== 1 || estilos.sinDatos !== 1) fail('detalle: estilos de las ruedas: '+JSON.stringify(estilos));
  if(all('#vd-diagrama .vd-bandera').length < 1) fail('detalle: falta la insignia de desgaste acelerado');
  var r4 = $('#vd-diagrama .vd-rueda[data-pos="4"]'), r5 = $('#vd-diagrama .vd-rueda[data-pos="5"]');
  if(!/^Posición P4, .+, 2,5 milímetros, desgaste límite$/.test(r4.getAttribute('aria-label'))) fail('detalle: aria-label de la rueda 4: '+r4.getAttribute('aria-label'));
  if(r5.querySelector('.vd-mm').textContent !== '—') fail('detalle: la rueda sin datos debe mostrar —');

  // Chips: leyenda y filtro a la vez. La suma de los estados es el total y «Desgaste límite» se conserva (decisión del 2026-11-21).
  var chips = all('#vd-resumen .vd-chip[data-filtro]');
  var cuenta = {}; Array.prototype.forEach.call(chips, function(c){ cuenta[c.dataset.filtro] = c.textContent.replace(/\s+/g,' ').trim(); });
  log.push('chips='+JSON.stringify(cuenta));
  if(!/^.*1 Desgaste límite/.test(cuenta.limite || '') || !/1 Mayor desgaste/.test(cuenta.mayor || '') || !/2 Poco desgaste/.test(cuenta.poco || '') || !/5 Buen estado/.test(cuenta.bueno || '') || !/1 Sin datos/.test(cuenta.sinDatos || '')) fail('detalle: chips de estado: '+JSON.stringify(cuenta));
  if($('#vd-resumen .vd-chip-total')) fail('detalle: no debe haber chip del total: el total va en la cabecera');
  if(!/10 neumáticos/.test($('#vd-cab').textContent.replace(/\s+/g, ' '))) fail('detalle: la cabecera debe mostrar «10 neumáticos»');
  if(/Desconocido|Nuevo|mayor al normal/.test($('#vd-resumen').textContent)) fail('detalle: texto viejo en los chips');
  // Filtrar atenúa sin cambiar la selección; las atenuadas siguen siendo tocables; el total limpia.
  chips[0].click(); await sleep(100);
  if(chips[0].getAttribute('aria-pressed') !== 'true') fail('detalle: el chip filtro no marca aria-pressed');
  if(all('#vd-diagrama .vd-rueda.dim').length !== 9) fail('detalle: el filtro debe atenuar las ruedas que no coinciden: '+all('#vd-diagrama .vd-rueda.dim').length);
  if($('#vd-diagrama .vd-rueda.dim').getAttribute('tabindex') !== '0') fail('detalle: una rueda atenuada debe seguir siendo tocable');
  chips[0].click(); await sleep(100);
  if(all('#vd-diagrama .vd-rueda.dim').length !== 0 || all('#vd-resumen [aria-pressed="true"]').length) fail('detalle: tocar el chip activo debe limpiar el filtro');
  if($('#vd-leyenda')) fail('detalle: la leyenda de la escala continua ya no existe');


  // Panel de la rueda 3 (critica, desgaste por encima de lo normal) con el teclado
  var r3 = $('#vd-diagrama .vd-rueda[data-pos="3"]');
  r3.focus();
  r3.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})); await sleep(500);
  var panel = $('#vd-panel').textContent;
  log.push('panel='+panel.replace(/\s+/g,' ').slice(0,160));
  if(!$('#vd-panel').classList.contains('abierto')) fail('detalle: el panel no se abrio');
  if(r3.getAttribute('aria-pressed') !== 'true') fail('detalle: rueda seleccionada sin aria-pressed');
  if(d.activeElement !== $('#vd-panel-titulo')) fail('detalle: el foco no paso al panel');
  // U1 (docs/21 §5.6): elegir un neumático no desplaza la página si el panel ya se ve; el título no queda bajo la barra.
  if(d.scrollingElement.scrollTop !== 0) fail('detalle: elegir P3 desplazó la página a ' + d.scrollingElement.scrollTop + ' (debe quedar en 0)');
  if($('#vd-panel').getBoundingClientRect().top < $('.topbar, #topbar, header').getBoundingClientRect().bottom - 1) fail('detalle: el panel quedó bajo la barra superior');
  // En el arnés el desplazamiento suave no avanza, así que además se mide la llamada: no hubo ningún scrollIntoView del panel.
  if(llamadasScroll.length) fail('detalle: elegir P3 con el panel a la vista no debe desplazar nada, llamadas: ' + JSON.stringify(llamadasScroll));
  // Escritorio: el panel va pegado (sticky, styles.css) y sigue a la vista al bajar la página, así que elegir otra rueda no desplaza nada.
  d.scrollingElement.scrollTop = 700; await sleep(200);
  if($('#vd-panel').getBoundingClientRect().top < $('.topbar, #topbar, header').getBoundingClientRect().bottom - 1) fail('detalle: el panel pegado quedó bajo la barra superior al bajar la página');
  $('#vd-diagrama .vd-rueda[data-pos="1"]').dispatchEvent(new w.MouseEvent('click', {bubbles: true})); await sleep(300);
  if(llamadasScroll.length) fail('detalle: con el panel pegado elegir otra rueda no debe desplazar: ' + JSON.stringify(llamadasScroll));
  d.scrollingElement.scrollTop = 0; llamadasScroll.length = 0;
  $('#vd-diagrama .vd-rueda[data-pos="3"]').dispatchEvent(new w.MouseEvent('click', {bubbles: true})); await sleep(500);
  // U2: las etiquetas de estado del panel pintan los tokens de su estado (mayor desgaste en P3, límite en P4).
  etiquetaPinta($('#vd-panel .vd-p-estado .vd-tag'), 'mayor', 'Mayor desgaste del panel');
  // P3 no tiene alertas en el fixture (la alerta es de P4): el panel no muestra la sección «Alertas» aquí.
  ['Eje 2 izquierda exterior','P3','Mayor desgaste','Desgaste acelerado','Interna','4,2','Desgaste límite','Rotación'].forEach(function(t){
    if(panel.indexOf(t) === -1) fail('detalle: panel sin "'+t+'"');
  });
  if(panel.indexOf('1,20 mm por semana') === -1) fail('detalle: panel sin tasa');
  // Aviso de P3 (desgaste acelerado): la etiqueta y el aviso dicen lo mismo una sola vez; sin «RN-» ni «Sin alertas activas».
  if(panel.split('Desgaste acelerado').length !== 2) fail('detalle: «Desgaste acelerado» debe aparecer exactamente una vez en el panel: '+(panel.split('Desgaste acelerado').length - 1));
  if(/RN-/.test(panel)) fail('detalle: el panel no debe llevar códigos de regla (RN-)');
  if(/Sin alertas activas/.test(panel)) fail('detalle: el panel no muestra «Sin alertas activas» cuando hay alertas en la posición');
  // «Ver más» (datos de la rueda) arranca cerrado.
  if(!$('#vd-panel .vd-mas') || $('#vd-panel .vd-mas').open !== false) fail('detalle: «Ver más» debe arrancar cerrado');
  // Número de quema y km del neumático (v_km_cubierta): previos 20.000 + tramo actual 3.456 (123.456 - 120.000 del montaje) = 23.456
  ['Quema Q-0103','Km que ya traía','20.000 km','Km recorridos','3.456 km','En el tramo actual','Km totales','23.456 km'].forEach(function(t){
    if(panel.indexOf(t) === -1) fail('detalle: panel sin "'+t+'"');
  });
  if(/Estimado|Sin dato/.test(panel)) fail('detalle: km confiables no deberían llevar nota: '+panel.replace(/\s+/g,' ').slice(0,300));
  // Costo y costo por km (v_costo_cubierta): 1.500 / 3.456 km recorridos, sin nota; acción «Registrar costo» para el perfil global
  ['Costo','UYU 1.500,00','Costo por km','UYU 0,434 por km','Registrar costo'].forEach(function(t){
    if(panel.indexOf(t) === -1) fail('detalle: panel sin "'+t+'" (costo)');
  });
  if(d.body.innerHTML.indexOf('<programada>') !== -1) fail('detalle: evento sin escapar');
  // El gráfico se carga al abrir «Ver más» (cerrado por defecto): se abre y se espera el dibujo.
  var masC = $('#vd-panel .vd-mas'); if(masC) masC.open = true;
  for(var t = 0; t < 40 && !$('#vd-chart-wrap svg'); t++) await sleep(50);
  var ch = $('#vd-chart-wrap svg');
  if(!ch) fail('detalle: no se dibujo el grafico');
  else {
    log.push('grafico-puntos='+ch.querySelectorAll('circle').length+' bandas='+ch.querySelectorAll('.vd-g-banda').length);
    if(ch.querySelectorAll('circle').length !== 10) fail('detalle: el grafico deberia tener 10 puntos');
    if(ch.querySelectorAll('.vd-g-banda').length < 3) fail('detalle: faltan las bandas de estado del grafico');
    var tipPunto = ch.querySelector('circle title').textContent;
    if(!/Interna \d+,\d · Centro \d+,\d · Externa \d+,\d · Mínimo \d+,\d mm \(decide el estado\) · Promedio \d+,\d mm \(informativo\) · (Buen estado|Poco desgaste|Mayor desgaste|Desgaste límite)$/.test(tipPunto)) fail('detalle: el tooltip del punto debe traer fecha, interna, centro, externa, mínimo (que decide), promedio (informativo) y estado: '+tipPunto);
    if(ch.querySelectorAll('.vd-g-proy,.vd-g-umbral').length) fail('detalle: el grafico no lleva proyeccion ni lineas de umbral');
    if(ch.getAttribute('role') !== 'img' || !/^Evolución del desgaste de /.test(ch.getAttribute('aria-label') || '')) fail('detalle: el grafico necesita role img y aria-label');
    var vd = $('#vd-chart-wrap details.vd-datos-det'); if(!vd || vd.querySelectorAll('tbody tr').length !== 10) fail('detalle: falta la tabla Ver datos con 10 filas');
  }

  // RN-08: la rueda 4 mide 2,5 mm (bajo el límite de retiro). No se ofrece rotar a otro eje; se muestra el retiro.
  var r4s = $('#vd-diagrama .vd-rueda[data-pos="4"]');
  r4s.dispatchEvent(new w.MouseEvent('click', {bubbles: true})); await sleep(500);
  if($('#vd-rotar-destino') || $('#vd-panel [data-action="neumatico-rotar-pos"]')) fail('detalle RN-08: bajo retiro no debe ofrecerse rotar a otro eje');
  if(!/Retirar ya/.test($('#vd-panel').textContent)) fail('detalle RN-08: bajo retiro falta el aviso «Retirar ya»');
  if(!/Alertas/.test($('#vd-panel').textContent)) fail('detalle: la posición 4 tiene una alerta y el panel debe mostrar «Alertas»');
  if(!$('#vd-panel [data-action="neumatico-retirar"]')) fail('detalle RN-08: bajo retiro falta el botón Retirar neumático');
  // Móvil (390 px): el encabezado visible de la última columna es «Prom.»; «Promedio» queda como nombre accesible.
  // El promedio ya no es columna de la tabla de mediciones: va en «Ver datos» del gráfico (la tabla decide por el mínimo).
  var thMM = $('#vd-panel .vd-mm-tabla thead');
  if(!thMM || /Prom/.test(thMM.textContent)) fail('detalle: la tabla de mediciones no debe tener columna de promedio: '+(thMM && thMM.textContent));
  $('#vd-diagrama .vd-rueda[data-pos="3"]').dispatchEvent(new w.MouseEvent('click', {bubbles: true})); await sleep(500);

  // Contrato con el taller: botones presentes con data-*; handlers REALES de cambio-neumatico.js (no un stub)
  var rpcs = function(n){ return w.__cicloFx.rpcs.filter(function(r){ return r.name === n; }); };
  // «Rotar» carga el vehículo y los motivos antes de abrir el diálogo: se espera a que aparezca.
  var esperarRotar = async function(){ for(var i = 0; i < 60 && !$('#modal-rotar').classList.contains('show'); i++) await sleep(25); };
  var bc = $('#vd-panel [data-action="neumatico-cambiar"]'), br = $('#vd-panel [data-action="neumatico-rotar-pos"]');
  if(!bc || !br) { fail('detalle: faltan botones Cambiar/Rotar'); }
  else {
    if(bc.dataset.vehiculoId !== '10' || bc.dataset.posicion !== '3') fail('detalle: data-* del boton Cambiar incorrectos');
    if(br.dataset.vehiculoId !== '10' || br.dataset.posicion !== '3') fail('detalle: data-* del boton Rotar incorrectos');
    if(!$('#vd-panel label[for="vd-rotar-destino"]')) fail('detalle: el select de destino no tiene etiqueta');
    var sel = $('#vd-rotar-destino');
    if(sel.querySelector('option[value="3"]')) fail('detalle: el destino no deberia incluir la propia posicion');
    // Sin destino elegido: no llama a la RPC y avisa
    br.click(); await sleep(200);
    if(rpcs('neumatico_rotar').length) fail('detalle: rotar sin destino llego a la RPC');
    if($('#toast-msg').textContent.indexOf('Elegir la posición') === -1) fail('detalle: rotar sin destino deberia avisar');
    // Rotar 3 con 1 (ambas ocupadas): es reversible, no pide confirmación; el aviso nombra el intercambio con nombres de posición
    var optTxt = Array.prototype.map.call(sel.options, function(o){ return o.textContent; }).join('|');
    if(/(^|\|)P\d/.test(optTxt) || optTxt.indexOf('Delantera izquierda') === -1) fail('detalle: el select de Rotar debe usar nombres de posición, no «P<n>»: '+optTxt);
    var evRot = 0, cuentaEv = function(){ evRot++; }; d.addEventListener('neumet:neumatico-cambiado', cuentaEv);
    sel.value = '1'; sel.dispatchEvent(new w.Event('change',{bubbles:true}));
    if(br.dataset.args !== '[10,3,1]') fail('detalle: data-args de Rotar incorrectos: '+br.dataset.args);
    br.focus(); br.click(); br.click(); await sleep(500);   // doble clic: un solo diálogo (con el ratón, Chrome enfoca el botón)
    if($('#modal-confirm').classList.contains('show')) fail('detalle: rotar no debe pedir confirmación (el motivo va en el diálogo de rotar)');
    if(!$('#modal-rotar').classList.contains('show')) fail('detalle: Rotar debe abrir el diálogo de motivo y odómetro');
    // Foco (modal-a11y): al abrir, el foco va al motivo; al cancelar, vuelve al botón Rotar que abrió el diálogo.
    var nombreFoco = function(el){ return el ? (el.id || el.getAttribute('data-action') || el.tagName) : 'ninguno'; };
    if(d.activeElement !== $('#rotar-motivo')) fail('detalle: al abrir Rotar el foco debe ir a «Motivo»: '+nombreFoco(d.activeElement));
    $('#modal-rotar [data-action="neumatico-rotar-cerrar"]').click(); await sleep(100);
    if(!d.activeElement || d.activeElement.getAttribute('data-action') !== 'neumatico-rotar-pos') fail('detalle: al cancelar Rotar el foco debe volver al botón Rotar: '+nombreFoco(d.activeElement));
    br.click(); await esperarRotar();   // reabre el diálogo para seguir el recorrido
    if(!$('#modal-rotar').classList.contains('show')) fail('detalle: Rotar debe reabrir el diálogo tras cancelar');
    if(rpcs('neumatico_rotar').length) fail('detalle: abrir el diálogo de rotar no debe llamar a la RPC');
    // Motivo obligatorio: sin motivo no sale la RPC y el diálogo muestra la guía
    $('#rotar-form').requestSubmit(); await sleep(150);
    if(rpcs('neumatico_rotar').length || !$('#rotar-error').textContent) fail('detalle: rotar sin motivo debe avisar y no llamar a la RPC: '+$('#rotar-error').textContent);
    $('#rotar-motivo').value = 'swap_20000'; $('#rotar-motivo').dispatchEvent(new w.Event('change',{bubbles:true}));
    $('#rotar-form').requestSubmit(); await sleep(500);
    if($('#modal-rotar').classList.contains('show')) fail('detalle: el diálogo de rotar debe cerrarse tras el éxito');
    if($('#toast-msg').textContent !== 'Rotación registrada en Camión 01: Eje 2 izquierda exterior ↔ Delantera izquierda') fail('detalle: aviso de rotación: '+$('#toast-msg').textContent);
    if(!d.activeElement || !d.activeElement.classList.contains('vd-rueda') || d.activeElement.dataset.pos !== '3') fail('detalle: tras rotar el foco debe volver a la rueda: '+(d.activeElement && (d.activeElement.id || d.activeElement.tagName)));
    var rot = rpcs('neumatico_rotar');
    if(rot.length !== 1) fail('detalle: la rotacion (con doble clic) debe llegar una sola vez a la RPC ('+rot.length+')');
    else if(JSON.stringify([rot[0].args.p_vehiculo_id, rot[0].args.p_pos_a, rot[0].args.p_pos_b]) !== '[10,3,1]') fail('detalle: args de rotar: '+JSON.stringify(rot[0].args));
    else if(rot[0].args.p_motivo_codigo !== 'swap_20000' || rot[0].args.p_motivo_texto !== null || rot[0].args.p_odometro_km !== null) fail('detalle: motivo u odómetro de rotar: '+JSON.stringify(rot[0].args));
    // Otra rotación mientras una lenta sigue en curso: se avisa (no se descarta en silencio) y sale una sola RPC
    var ACr = (await (new w.Function('return import("/assets/js/core/actions.js")'))()).ACTIONS;
    for(var u0 = 0; u0 < 20 && !$('#vd-rotar-destino'); u0++) await sleep(50);
    sel = $('#vd-rotar-destino'); sel.value = '2'; sel.dispatchEvent(new w.Event('change',{bubbles:true}));
    w.__cicloFx.rpcDelay = 500; var rot0 = rpcs('neumatico_rotar').length;
    $('#vd-rotar-btn').click(); await esperarRotar();
    $('#rotar-motivo').value = 'swap_20000'; $('#rotar-motivo').dispatchEvent(new w.Event('change',{bubbles:true}));
    $('#rotar-form').requestSubmit(); await sleep(100);   // la RPC tarda 500 ms: queda en curso
    $('#toast-msg').textContent = '';
    await ACr['neumatico-rotar-pos'](10, 3, 4);
    if($('#toast-msg').textContent !== 'Esperar a que termine la rotación') fail('detalle: rotar otra rueda con una rotación en curso debe avisar: '+$('#toast-msg').textContent);
    await sleep(700); w.__cicloFx.rpcDelay = 0;
    if(rpcs('neumatico_rotar').length !== rot0 + 1) fail('detalle: durante una rotación en curso debe salir una sola RPC ('+(rpcs('neumatico_rotar').length - rot0)+')');
    for(var u1 = 0; u1 < 20 && !$('#vd-rotar-destino'); u1++) await sleep(50);
    // Respuesta que nunca llega: no se reintenta, se recarga el detalle y la respuesta tardía no pinta nada
    var cambioMod = await (new w.Function('return import("/assets/js/views/cambio-neumatico.js")'))();
    cambioMod.config.timeoutMs = 300; w.__cicloFx.rpcDelay = 1000;
    evRot = 0; var lect0 = w.__cicloFx.lecturas.v_estado_neumaticos || 0;
    sel = $('#vd-rotar-destino'); sel.value = '2'; sel.dispatchEvent(new w.Event('change',{bubbles:true}));
    $('#vd-rotar-btn').click(); await esperarRotar();
    $('#rotar-motivo').value = 'swap_20000'; $('#rotar-motivo').dispatchEvent(new w.Event('change',{bubbles:true}));
    $('#rotar-form').requestSubmit(); await sleep(700);
    if($('#toast-msg').textContent !== 'No se pudo confirmar la rotación en Camión 01. Revisar el vehículo antes de reintentar') fail('detalle: rotar sin respuesta debe avisar que no se pudo confirmar: '+$('#toast-msg').textContent);
    if((w.__cicloFx.lecturas.v_estado_neumaticos || 0) <= lect0) fail('detalle: rotar sin respuesta debe recargar el detalle');
    if(rpcs('neumatico_rotar').length !== 3) fail('detalle: rotar sin respuesta no debe reintentar solo');
    await sleep(900);
    if($('#toast-msg').textContent.indexOf('Rotación registrada') !== -1 || evRot) fail('detalle: la respuesta tardía de rotar pintó éxito: '+$('#toast-msg').textContent);
    w.__cicloFx.rpcDelay = 0; cambioMod.config.timeoutMs = 20000;
    d.removeEventListener('neumet:neumatico-cambiado', cuentaEv);
    for(var u = 0; u < 20 && $('#vd-panel-body').children.length === 0; u++) await sleep(50);
    // Ola 3 (RN-15, RN-16): rotar en disco desde el select «En disco» y registrar alineación desde la cabecera.
    var esperarFila = async function(){ for(var k = 0; k < 40 && !$('#vd-rotar-destino'); k++) await sleep(50); };
    var abrirDisco = async function(){ await esperarFila(); var s = $('#vd-rotar-destino'); s.value = 'disco'; s.dispatchEvent(new w.Event('change',{bubbles:true})); $('#vd-rotar-btn').click(); await esperarRotar(); };
    var motivosDe = function(){ return Array.prototype.map.call($('#rotar-motivo').options, function(o){ return o.value; }).join('|'); };
    var r3d = $('#vd-diagrama .vd-rueda[data-pos="3"]');
    r3d.dispatchEvent(new w.MouseEvent('click',{bubbles:true})); await sleep(400);
    await esperarFila();
    var selD = $('#vd-rotar-destino');
    if(!selD || selD.options[1].value !== 'disco' || selD.options[1].textContent !== 'En disco (misma posición)') fail('disco: «En disco» debe ser la primera opción del select');
    selD.value = 'disco'; selD.dispatchEvent(new w.Event('change',{bubbles:true}));
    if($('#vd-rotar-btn').dataset.args !== '[10,3,"disco"]') fail('disco: data-args de Rotar: '+$('#vd-rotar-btn').dataset.args);
    var nDisco = rpcs('neumatico_rotar_disco').length;
    $('#vd-rotar-btn').click(); await esperarRotar();
    if($('#rotar-title').textContent !== 'Rotar en disco') fail('disco: título del diálogo: '+$('#rotar-title').textContent);
    if($('#rotar-sub').textContent.indexOf('se invierten interior y exterior') === -1) fail('disco: subtítulo: '+$('#rotar-sub').textContent);
    if(motivosDe() !== '|desgaste_lateral|swap_20000|otro') fail('disco: motivos del modo disco: '+motivosDe());
    $('#rotar-form').requestSubmit(); await sleep(150);   // sin motivo: no sale la RPC
    if(rpcs('neumatico_rotar_disco').length !== nDisco) fail('disco: sin motivo no debe llamar a la RPC');
    $('#rotar-motivo').value = 'desgaste_lateral'; $('#rotar-motivo').dispatchEvent(new w.Event('change',{bubbles:true}));
    // Enter mantenido: se ignora (como en Montar), sin enviar.
    var kr = new w.KeyboardEvent('keydown',{key:'Enter',repeat:true,bubbles:true,cancelable:true}); $('#rotar-form').dispatchEvent(kr);
    if(!kr.defaultPrevented) fail('disco: Enter mantenido debe ignorarse');
    // Doble envío (dos Enter seguidos): una sola llamada a la RPC.
    $('#rotar-form').requestSubmit(); $('#rotar-form').requestSubmit(); await sleep(500);
    if($('#modal-rotar').classList.contains('show')) fail('disco: el diálogo debe cerrarse tras el éxito');
    var rd = rpcs('neumatico_rotar_disco');
    if(rd.length !== nDisco + 1) fail('disco: una sola llamada a neumatico_rotar_disco ('+(rd.length - nDisco)+')');
    else {
      var ad = rd[nDisco].args;
      if(ad.p_vehiculo_id !== 10 || ad.p_posicion !== 3 || ad.p_odometro_km !== null || ad.p_motivo_codigo !== 'desgaste_lateral' || ad.p_motivo_texto !== null) fail('disco: args de neumatico_rotar_disco: '+JSON.stringify(ad));
    }
    if($('#toast-msg').textContent.indexOf('rotada en disco en Camión 01') === -1) fail('disco: aviso de éxito: '+$('#toast-msg').textContent);
    // Error 22023 en línea: el diálogo sigue abierto, el botón vuelve y el reintento sale bien.
    await sleep(400); await abrirDisco();
    $('#rotar-motivo').value = 'swap_20000'; $('#rotar-motivo').dispatchEvent(new w.Event('change',{bubbles:true}));
    var ceDisco = w.console.error, regDisco = [];
    w.console.error = function(){ regDisco.push(arguments[0] && arguments[0].message); };
    w.__cicloFx.rpcError = {code:'22023', message:'el auxilio no se rota en disco'};
    $('#rotar-form').requestSubmit(); await sleep(300);
    w.__cicloFx.rpcError = null; w.console.error = ceDisco;
    if(regDisco.length !== 1) fail('disco: el error 22023 debe registrarse una vez en consola ('+regDisco.length+')');
    if($('#rotar-error').textContent !== 'El auxilio no se rota en disco') fail('disco: error en línea: '+$('#rotar-error').textContent);
    if(!$('#modal-rotar').classList.contains('show')) fail('disco: con error el diálogo debe quedar abierto');
    if($('#rotar-confirmar').disabled) fail('disco: con error el botón debe rehabilitarse');
    $('#rotar-form').requestSubmit(); await sleep(400);
    // nDisco + 1 es la rotación de éxito, + 1 la que falló con 22023 y + 1 el reintento.
    if(rpcs('neumatico_rotar_disco').length !== nDisco + 3) fail('disco: el reintento debe llamar a la RPC una vez ('+(rpcs('neumatico_rotar_disco').length - nDisco)+')');
    // Alineación (RN-16): botón en la cabecera; motivos de alineación; una llamada a vehiculo_alinear.
    await sleep(400); await esperarFila();
    var bAl = $('#vd-alinear-btn');
    if(!bAl) fail('alinear: falta el botón «Registrar alineación» en la cabecera');
    else {
      // «Ver más» abierto antes de registrar la alineación: la recarga del vehículo repinta el panel y debe conservarlo abierto.
      var masPanel = $('#vd-panel .vd-mas'); if(masPanel){ masPanel.open = true; await sleep(50); }
      var nodoMas = $('#vd-panel .vd-mas');
      bAl.click(); await esperarRotar();
      if($('#rotar-title').textContent !== 'Registrar alineación') fail('alinear: título del diálogo: '+$('#rotar-title').textContent);
      if(motivosDe() !== '|desgaste_lateral|control|reparacion_tren|otro') fail('alinear: motivos de alineación: '+motivosDe());
      $('#rotar-motivo').value = 'control'; $('#rotar-motivo').dispatchEvent(new w.Event('change',{bubbles:true}));
      var nAl = rpcs('vehiculo_alinear').length;
      var ka = new w.KeyboardEvent('keydown',{key:'Enter',repeat:true,bubbles:true,cancelable:true}); $('#rotar-form').dispatchEvent(ka);
      if(!ka.defaultPrevented) fail('alinear: Enter mantenido debe ignorarse');
      $('#rotar-form').requestSubmit(); await sleep(500);
      var ra = rpcs('vehiculo_alinear');
      if(ra.length !== nAl + 1) fail('alinear: una sola llamada a vehiculo_alinear ('+(ra.length - nAl)+')');
      else if(ra[nAl].args.p_vehiculo_id !== 10 || ra[nAl].args.p_motivo_codigo !== 'control' || ra[nAl].args.p_odometro_km !== null) fail('alinear: args de vehiculo_alinear: '+JSON.stringify(ra[nAl].args));
      if($('#toast-msg').textContent !== 'Alineación registrada en 2 neumáticos en Camión 01') fail('alinear: aviso de éxito: '+$('#toast-msg').textContent);
      // Tras recargar el vehículo el panel se repinta (nodo nuevo) y «Ver más» sigue abierto.
      for(var u2 = 0; u2 < 40 && $('#vd-panel .vd-mas') === nodoMas; u2++) await sleep(50);
      var masTras = $('#vd-panel .vd-mas');
      if(!masTras || masTras === nodoMas || !masTras.open) fail('detalle: tras recargar el vehículo «Ver más» debe seguir abierto (repintado: '+(masTras !== nodoMas)+', abierto: '+(!!masTras && masTras.open)+')');
    }
    // Cambiar: abre el modal real del taller con el neumatico de P3
    r3 = $('#vd-diagrama .vd-rueda[data-pos="3"]');
    r3.dispatchEvent(new w.MouseEvent('click',{bubbles:true})); await sleep(400);
    $('#vd-panel [data-action="neumatico-cambiar"]').click(); await sleep(700);
    if(!$('#modal-cambio').classList.contains('show')) fail('detalle: Cambiar no abrio el modal real');
    else {
      if($('#cambio-actual').textContent.indexOf('Eje 2 izquierda exterior') === -1 || /\bP\d/.test($('#cambio-actual').textContent)) fail('detalle: el modal de cambio no es de la posición 3 con nombre: '+$('#cambio-actual').textContent);
      if($('#vd-panel [data-action="neumatico-cambiar"]') && !$('#vd-panel [data-action="neumatico-cambiar"]').classList.contains('primary')) fail('detalle: Cambiar neumático debe ser la acción primaria');
      $('#cambio-motivo').value = 'desgaste';
      $('#cambio-confirmar').click(); await sleep(600);
      var cam = rpcs('neumatico_cambiar');
      if(cam.length !== 1 || cam[0].args.p_vehiculo_id !== 10 || cam[0].args.p_posicion !== 3) fail('detalle: el cambio no llego a la RPC real: '+JSON.stringify(cam.map(function(c){ return c.args; })));
      if($('#modal-cambio').classList.contains('show')) fail('detalle: el modal de cambio no se cerro');
      // Respuesta que nunca llega: el modal se cierra (no se reintenta: el cambio pudo aplicarse), se recarga el detalle
      // y la respuesta tardía no pinta nada
      var cm = await (new w.Function('return import("/assets/js/views/cambio-neumatico.js")'))();
      cm.config.timeoutMs = 300; w.__cicloFx.rpcDelay = 1000;
      var evCam = 0, cuentaCam = function(){ evCam++; }; d.addEventListener('neumet:neumatico-cambiado', cuentaCam);
      var lect1 = w.__cicloFx.lecturas.v_estado_neumaticos || 0;
      $('#vd-diagrama .vd-rueda[data-pos="3"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true})); await sleep(400);
      $('#vd-panel [data-action="neumatico-cambiar"]').click(); await sleep(700);
      $('#cambio-motivo').value = 'desgaste';
      $('#cambio-confirmar').click(); await sleep(700);
      if($('#modal-cambio').classList.contains('show')) fail('detalle: sin respuesta, el modal de cambio debe cerrarse (no dejarlo listo para reintentar)');
      if($('#toast-msg').textContent !== 'No se pudo confirmar el cambio en Camión 01. Revisar el vehículo antes de reintentar') fail('detalle: aviso de cambio sin respuesta: '+$('#toast-msg').textContent);
      if((w.__cicloFx.lecturas.v_estado_neumaticos || 0) <= lect1) fail('detalle: cambio sin respuesta debe recargar el detalle');
      await sleep(900);
      if($('#toast-msg').textContent.indexOf('Cambio registrado') !== -1 || evCam || $('#modal-cambio').classList.contains('show')) fail('detalle: la respuesta tardía del cambio pintó algo: '+$('#toast-msg').textContent);
      if(rpcs('neumatico_cambiar').length !== 2) fail('detalle: cambio sin respuesta no debe reintentar solo');
      w.__cicloFx.rpcDelay = 0; cm.config.timeoutMs = 20000; d.removeEventListener('neumet:neumatico-cambiado', cuentaCam);
    }
    // Sin accion registrada: aviso en vez de error (se quita temporalmente el handler real)
    var AC = (await (new w.Function('return import("/assets/js/core/actions.js")'))()).ACTIONS;
    var orig = AC['neumatico-cambiar']; delete AC['neumatico-cambiar'];
    r3.dispatchEvent(new w.MouseEvent('click',{bubbles:true})); await sleep(300);
    $('#vd-panel [data-action="neumatico-cambiar"]').click(); await sleep(200);
    AC['neumatico-cambiar'] = orig;
    if($('#toast-msg').textContent !== 'No disponible') fail('detalle: sin accion registrada deberia decir "No disponible"');
  }

  // H4: con la rueda 3 elegida, un Esc que cierra algo encima (menú «Más», modal) no debe cerrar también el panel.
  // Se despacha como una tecla real: cancelable y sobre el elemento con foco.
  var escTecla = function(){ (d.activeElement || d).dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})); };
  if(!$('#vd-diagrama .vd-rueda.sel[data-pos="3"]')) { r3.dispatchEvent(new w.MouseEvent('click',{bubbles:true})); await sleep(400); }
  $('#vd-cab [data-menu-mas-btn]').click(); await sleep(200);
  escTecla(); await sleep(200);
  if(!$('#vd-cab .menu-mas-lista').hidden) fail('detalle: Esc en «Más» debe cerrar el menú');
  if(!$('#vd-panel').classList.contains('abierto') || !$('#vd-diagrama .vd-rueda.sel[data-pos="3"]') || /Elegir una rueda/.test($('#vd-panel').textContent)) fail('detalle: Esc en «Más» no debe cerrar el panel de la rueda');
  if(d.activeElement !== $('#vd-cab [data-menu-mas-btn]')) fail('detalle: Esc en «Más» debe devolver el foco a «Más»');
  // El foco va al botón antes de abrir: el modal devuelve el foco a quien lo tenía (click() por sí solo no lo mueve).
  var abreModal = async function(boton, modal){
    if(!boton) { fail('detalle: no hay botón para abrir '+modal+' (el panel no está abierto)'); return false; }
    boton.focus(); boton.click(); await sleep(700);
    if(!$(modal).classList.contains('show')) { fail('detalle: no abrió '+modal+' para probar Esc'); return false; }
    return true;
  };
  var vuelveAlPanel = function(boton, modal){
    if($(modal).classList.contains('show')) fail('detalle: Esc no cerró '+modal);
    if(!$('#vd-panel').classList.contains('abierto') || !$('#vd-diagrama .vd-rueda.sel[data-pos="3"]')) fail('detalle: Esc con '+modal+' abierto no debe cerrar el panel de la rueda 3');
    if(d.activeElement !== boton) fail('detalle: al cerrar '+modal+' con Esc el foco debe volver a su botón, está en '+(d.activeElement && (d.activeElement.dataset.action || d.activeElement.tagName)));
  };
  if(await abreModal($('#vd-panel [data-action="neumatico-retirar"]'), '#modal-retirar')) {
    var btnRetirar = $('#vd-panel [data-action="neumatico-retirar"]');
    escTecla(); await sleep(200);
    vuelveAlPanel(btnRetirar, '#modal-retirar');
  }
  if(await abreModal($('#vd-panel [data-action="neumatico-cambiar"]'), '#modal-cambio')) {
    var btnCambiar = $('#vd-panel [data-action="neumatico-cambiar"]');
    escTecla(); await sleep(200);
    vuelveAlPanel(btnCambiar, '#modal-cambio');
  }

  // Escape cierra el panel y devuelve el foco a la rueda (sin nada encima)
  escTecla(); await sleep(200);
  if($('#vd-panel').classList.contains('abierto') || $('#vd-diagrama .vd-rueda.sel')) fail('detalle: Escape no cerro el panel');
  if(!d.activeElement || d.activeElement.dataset.pos !== '3') fail('detalle: el foco no volvio a la rueda');

  // Click en la rueda sin datos (5) y en una rueda normal
  $('#vd-diagrama .vd-rueda[data-pos="5"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true})); await sleep(300);
  // El neumático 1005 tiene km previos en 0 (no es «Sin registrar»: null y 0 son cosas distintas) y sin odómetro: la nota lo dice.
  if(!/Km que ya traía0 km/.test($('#vd-panel').textContent) || $('#vd-panel').textContent.indexOf('Sin dato: faltan lecturas de odómetro') === -1) fail('detalle: rueda sin odómetro debe mostrar «0 km» de km previos y la nota de odómetro');
  if(/(^|[^\d.])0 km/.test($('#vd-panel-body').textContent.split('Km recorridos')[1] || '')) fail('detalle: sin lecturas no debe mostrar 0 km: '+$('#vd-panel-body').textContent.replace(/\s+/g,' ').slice(0,300));
  // Estimado (falta un tramo) y odómetro decreciente: nota sobria con el motivo, el valor conocido se muestra
  $('#vd-diagrama .vd-rueda[data-pos="6"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true})); await sleep(300);
  if($('#vd-panel').textContent.indexOf('Estimado: faltan lecturas de odómetro') === -1 || $('#vd-panel').textContent.indexOf('9.000 km') === -1) fail('detalle: rueda con un tramo sin odómetro deberia mostrar la nota Estimado y 9.000 km');
  if($('#vd-panel').textContent.indexOf('UYU 0,100 por km') === -1) fail('detalle: CPK provisional sin valor');
  // Monedas mixtas (rueda 5, sin km): sin total ni CPK inventados
  $('#vd-diagrama .vd-rueda[data-pos="5"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true})); await sleep(300);
  if($('#vd-panel').textContent.indexOf('Monedas mixtas') === -1 || /UYU 0,000/.test($('#vd-panel').textContent)) fail('detalle: monedas mixtas deberían mostrarse sin total');
  // Registrar costo: abre el formulario, valida y guarda
  // Moneda precargada con la del cliente (F8 ola 4); una moneda que no tiene formato de código cae a USD
  w.__clientesStub[0].moneda_default = 'UYU';
  $('#vd-panel [data-action="detalleRegistrarCosto"]').click(); await sleep(150);
  if(!$('#modal-costo').classList.contains('show')) fail('detalle: «Registrar costo» no abrió el formulario');
  if($('#costo-moneda').value !== 'UYU') fail('detalle: el costo no precarga la moneda del cliente: '+$('#costo-moneda').value);
  w.__clientesStub[0].moneda_default = 'DOLARES';
  $('#modal-costo [data-action="costoCerrar"]').click(); await sleep(100);
  $('#vd-panel [data-action="detalleRegistrarCosto"]').click(); await sleep(150);
  if($('#costo-moneda').value !== 'USD') fail('detalle: una moneda sin formato de código debe caer a USD: '+$('#costo-moneda').value);
  w.__clientesStub[0].moneda_default = 'USD';
  $('#modal-costo [data-action="costoCerrar"]').click(); await sleep(100);
  $('#vd-panel [data-action="detalleRegistrarCosto"]').click(); await sleep(150);
  $('#costo-guardar').click(); await sleep(100);
  if($('#costo-error').textContent.indexOf('Elegir el concepto') === -1) fail('detalle: el formulario de costo no valida el concepto: '+$('#costo-error').textContent);
  $('#costo-concepto').value = 'reparacion'; $('#costo-monto').value = '250.50';
  $('#costo-guardar').click(); await sleep(300);
  if($('#modal-costo').classList.contains('show')) fail('detalle: el formulario de costo no se cerró al guardar: '+$('#costo-error').textContent);
  $('#vd-diagrama .vd-rueda[data-pos="7"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true})); await sleep(300);
  if($('#vd-panel').textContent.indexOf('Estimado: hay lecturas de odómetro decrecientes') === -1) fail('detalle: odómetro decreciente deberia indicarse');
  $('#vd-diagrama .vd-rueda[data-pos="5"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true})); await sleep(300);
  if($('#vd-panel').textContent.indexOf('todavía no tiene mediciones') === -1) fail('detalle: rueda sin datos deberia explicarlo');
  $('#vd-panel [data-action="detalleCerrarPanel"]').click(); await sleep(100);

  // Volver y buscar por numero de coche exacto ("112") -> vehiculo 12 con 10 ruedas
  $('#breadcrumb-parent').click(); await sleep(700);
  if(!$('#view-vehiculos').classList.contains('active')) fail('detalle: la miga no regreso a Vehiculos');
  inp = escribir('112'); await sleep(100);
  enter(inp); await sleep(900);
  if(!$('#view-vehiculo-detalle').classList.contains('active') || $('#vd-cab').textContent.indexOf('Unidad') === -1) fail('detalle: Enter por numero de coche no abrio el vehiculo 12');

  // Vehiculo con auxilio (tipo 16): 16 ruedas en el chasis + auxilio fuera
  $('#breadcrumb-parent').click(); await sleep(600);
  inp = escribir('zz999'); await sleep(100); enter(inp); await sleep(900);
  var n16 = all('#vd-diagrama .vd-rueda').length;
  log.push('ruedas-tipo16='+n16);
  if(n16 !== 17) fail('detalle: tipo 16 con auxilio deberia dibujar 17 ruedas, hay '+n16);
  if(!$('#vd-diagrama .vd-rueda[data-pos="99"]')) fail('detalle: falta el auxilio');
  // Decision del dueno (TODO-STATUS-MEASURE): el estado se decide con el valor crudo y el numero se muestra truncado.
  // P3 = 7,97 mm -> «7,9» y «Poco desgaste» (no «Buen estado»). El auxilio (2,0 mm) no cuenta como advertencia (PR 140):
  // ni el chip «Desgaste limite» ni la cabecera; si cuenta en el total y se dibuja con su estado real.
  var rP3 = $('#vd-diagrama .vd-rueda[data-pos="3"]');
  if(!rP3 || rP3.querySelector('.vd-mm').textContent !== '7,9' || !/poco desgaste/.test(rP3.getAttribute('aria-label')) || !/7,9 milímetros/.test(rP3.getAttribute('aria-label'))) fail('detalle: 7,97 mm debe mostrarse «7,9» y ser poco desgaste: '+(rP3 && rP3.getAttribute('aria-label')));
  if(!/7,9 mm · Poco desgaste/.test(rP3.querySelector('title').textContent)) fail('detalle: tooltip de P3: '+rP3.querySelector('title').textContent);
  var rAux = $('#vd-diagrama .vd-rueda[data-pos="99"]');
  if(rAux.querySelector('.vd-mm').textContent !== '2,0' || !/desgaste límite/.test(rAux.getAttribute('aria-label'))) fail('detalle: el auxilio debe dibujarse con su estado real: '+rAux.getAttribute('aria-label'));
  if($('#vd-resumen [data-filtro="limite"]') || $('#vd-resumen [data-filtro="mayor"]')) fail('detalle: el auxilio cuenta como advertencia en los chips: '+$('#vd-resumen').textContent);
  if(!/3 neumáticos/.test($('#vd-cab').textContent.replace(/\s+/g, ' ')) ||!/1 Buen estado/.test($('#vd-resumen [data-filtro="bueno"]').textContent) || !/2 Poco desgaste/.test($('#vd-resumen [data-filtro="poco"]').textContent)) fail('detalle: chips del auxilio: '+$('#vd-resumen').textContent.replace(/\s+/g,' '));
  // R3: el auxilio irregular no lleva insignia ni cuenta en «Desgaste acelerado» (una sola regla para chip, insignia y filtro).
  if($('#vd-diagrama .vd-bandera[data-pos="99"]') || $('#vd-resumen [data-filtro="acelerado"]')) fail('detalle: el auxilio lleva insignia o cuenta como acelerado');
  $('#vd-resumen [data-filtro="poco"]').click(); await sleep(100);
  if(all('#vd-diagrama .vd-rueda.dim').length !== 1) fail('detalle: el filtro «Poco desgaste» debe atenuar solo P1: P3 y el auxilio (que cuenta como poco) coinciden con el chip');
  $('#vd-resumen [data-filtro="poco"]').click(); await sleep(100);
  if(!/Poco desgaste/.test($('#vd-cab .vd-tag').textContent)) fail('detalle: la cabecera cuenta el auxilio como advertencia: '+$('#vd-cab .vd-tag').textContent);

  // Buscador global: matrícula, número de coche y número de quema abren el vehículo (la quema, el de su neumático montado)
  var bg = $('#busq-global-input');
  var buscarGlobal = async function(txt, esperado, que){
    $('#breadcrumb-parent').click(); await sleep(500);
    bg.value = txt; bg.dispatchEvent(new w.Event('input',{bubbles:true})); await sleep(400);
    bg.form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})); await sleep(900);
    if(!$('#view-vehiculo-detalle').classList.contains('active') || $('#vd-cab').textContent.indexOf(esperado) === -1) fail('detalle: el buscador global no abrió '+esperado+' por '+que+' ('+txt+')');
  };
  await buscarGlobal('Q1401', 'Tractor 16', 'quema (sin guion ni mayúsculas)');
  await buscarGlobal('cr 0001', 'Unidad', 'matrícula');
  await buscarGlobal('112', 'Unidad', 'número de coche');
  await buscarGlobal('q-0103', 'Camión 01', 'quema');

  await window.calidadDetalleFlow(w,d,sleep,fail,log); // indicador de confiabilidad, invalidar y marcar como válida
  var q = w.__vehFx.queries.join(',');
  if(q.indexOf('v_estado_neumaticos') === -1 || q.indexOf('v_alertas') === -1) fail('detalle: no consulto las vistas SQL');
  // Recuadro de la cabecera: el camión 01 tiene una alerta de desgaste límite abierta (vehiculo.fixture).
  if(!/× 1 cambiar/.test($('#vd-cab').textContent.replace(/\s+/g, ' ')) || /0 revisar/.test($('#vd-cab').textContent)) fail('detalle: el recuadro de la cabecera debe ser «× 1 cambiar», sin «0 revisar»');
  // Color (RN-20): «cambiar» en rojo (hay uno); sin «revisar», porque es cero y no se muestra.
  var recD = $('#vd-cab .vd-cab-titulo');
  if(!recD || !recD.querySelector('.badge.red') || recD.querySelector('.badge.orange')) fail('detalle: el recuadro de la cabecera debe ser solo «cambiar», en rojo');
  // El historial de la rueda sale del neumático montado (vista), no de mediciones por posición.
  if(q.indexOf('v_mediciones_neumatico') === -1 || /(^|,)mediciones(,|$)/.test(q)) fail('detalle: las mediciones deben leerse de v_mediciones_neumatico, no de mediciones por posicion');
  $('#breadcrumb-parent').click(); await sleep(400);
  escribir('');
  // Capturas: ?end=detalle termina en el detalle del camión 01 con el panel de la rueda 3 abierto.
  if(/[?&]end=detalle/.test(w.parent.location.search)){
    enter(escribir('AB123CD')); await sleep(900);
    $('#vd-diagrama .vd-rueda[data-pos="3"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true})); await sleep(800);
  }
};

// El equipo Neumet (admin interno) abre el detalle desde la tabla de Vehículos y solo mira: ve costos y km, pero ninguna acción
// de escritura (docs/17 PR 9). Contraparte positiva: detalleFlow (administrador de empresa) exige Cambiar, Rotar y Registrar costo.
window.detalleAdminFlow = async function(w, d, sleep, fail, log){
  var $ = function(s){ return d.querySelector(s); }, all = function(s){ return d.querySelectorAll(s); };
  $('.nav-item[data-view="vehiculos"]').click(); await sleep(600);
  var b = $('#tbody-vehiculos [data-va="detalle"][data-vid="10"]');
  if(!b){ fail('detalle(admin): sin botón de detalle del vehículo 10'); return; }
  b.click(); await sleep(900);
  if(all('#vd-diagrama .vd-rueda').length !== 10){ fail('detalle(admin): el detalle no mostró las 10 ruedas'); return; }
  // Ola 3: registrar alineación es una acción de escritura; el equipo Neumet no la ve (puedeOperar).
  if($('#vd-alinear-btn')) fail('detalle(admin): el equipo Neumet no debe ver «Registrar alineación»');
  var prohibidas = '[data-action="neumatico-cambiar"],[data-action="neumatico-rotar-pos"],[data-action="neumatico-retirar"],[data-action="neumatico-montar"],[data-action="detalleRegistrarCosto"]';
  if(all('[data-action="vehiculo-eliminar"]').length) fail('detalle(admin): el equipo Neumet no debe ver «Eliminar vehículo»');
  if(all(prohibidas).length) fail('detalle(admin): acciones de escritura en la vista: ' + Array.prototype.map.call(all(prohibidas), function(x){ return x.dataset.action; }).join(','));
  $('#vd-diagrama .vd-rueda[data-pos="3"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true})); await sleep(600);
  var panel = $('#vd-panel').textContent;
  if(all('#vd-panel ' + prohibidas.split(',').join(',#vd-panel ')).length) fail('detalle(admin): el panel de la rueda ofrece escrituras: ' + panel.replace(/\s+/g,' ').slice(0,200));
  if(/Registrar costo|Cambiar neumático|Retirar neumático/.test(panel)) fail('detalle(admin): textos de acciones de escritura en el panel');
  // Sigue viendo lo que le corresponde: el costo del neumático
  if(panel.indexOf('UYU 1.500,00') === -1) fail('detalle(admin): dejó de ver el costo: ' + panel.replace(/\s+/g,' ').slice(0,200));
  if(w.__cicloFx.rpcs.length) fail('detalle(admin): llamó RPC: ' + JSON.stringify(w.__cicloFx.rpcs));
  // Guardas propias: aunque otro botón o una vista nueva emita estas acciones, el equipo Neumet no abre ningún modal de escritura.
  // (cicloRegistrarCosto además la rechaza costos.js: es una segunda barrera, así que ese caso no distingue la guarda propia.)
  var falsos = [['neumatico-cambiar', { 'data-vehiculo-id': '10', 'data-posicion': '3' }], ['neumatico-montar', { 'data-vehiculo-id': '10' }],
    ['neumatico-retirar', { 'data-vehiculo-id': '10', 'data-posicion': '3' }], ['cicloRegistrarCosto', { 'data-args': '[1]' }],
    // F10 PR 10: la rotación no pide confirmación cuando el destino está libre; sin guarda propia llegaría a neumatico_rotar.
    ['neumatico-rotar-pos', { 'data-args': '[10,3,99]' }], ['vehiculo-eliminar', { 'data-vehiculo-id': '10' }], ['neumatico-cambiar-confirmar', {}], ['neumatico-retirar-confirmar', {}]];
  for(var i = 0; i < falsos.length; i++){
    var f = d.createElement('button'); f.type = 'button'; f.setAttribute('data-action', falsos[i][0]);
    Object.keys(falsos[i][1]).forEach(function(k){ f.setAttribute(k, falsos[i][1][k]); });
    d.body.appendChild(f); f.click(); await sleep(600); f.remove();
    ['#modal-cambio', '#modal-rotar', '#modal-montar', '#modal-retirar', '#modal-costo', '#modal-veh-eliminar'].forEach(function(sel){
      if($(sel) && $(sel).classList.contains('show')) fail('detalle(admin): ' + falsos[i][0] + ' abrió ' + sel + ' para el equipo Neumet');
    });
  }
  if(w.__cicloFx.rpcs.length) fail('detalle(admin): una acción con guarda llamó RPC: ' + JSON.stringify(w.__cicloFx.rpcs));
  log.push('detalle-admin: solo lectura');
};
