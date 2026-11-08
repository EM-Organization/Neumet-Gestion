// Recorrido de humo de Inicio (¿qué requiere mi atención hoy?), visibilidad del menú por rol y accesibilidad básica.
// Lo invoca harness.html: await window.inicioFlow(w, d, sleep, fail, log, cliMode). Corre justo tras el login, sin navegar antes.
window.inicioFlow = async function(w, d, sleep, fail, log, cliMode){
  var $ = function(s){ return d.querySelector(s); }, all = function(s){ return Array.prototype.slice.call(d.querySelectorAll(s)); };
  var rol = cliMode ? 'cliente' : 'admin';
  var visible = function(el){ return !!el && el.getClientRects().length > 0; };
  var key = function(k, shift){ d.dispatchEvent(new w.KeyboardEvent('keydown', {key:k, shiftKey:!!shift, bubbles:true, cancelable:true})); };

  // --- Inicio es la vista de entrada para ambos roles ---
  await sleep(600);
  if(!$('#view-inicio').classList.contains('active')) fail('inicio('+rol+'): no es la vista inicial');
  if($('#breadcrumb-current').textContent !== 'Inicio') fail('inicio('+rol+'): breadcrumb '+$('#breadcrumb-current').textContent);
  var cont = $('#inicio-contenido');
  var txt = cont.textContent.replace(/\s+/g, ' ');
  // Fixtures de flota: 7 neumáticos (3 ok, 2 bajo, 1 crítico, 1 sin datos) en 4 vehículos
  if(!/3 de 7 neumáticos en buen estado/.test(txt)) fail('inicio('+rol+'): falta la frase de proporción: '+txt.slice(0,120));
  if(all('#inicio-contenido .inicio-seg').length < 3) fail('inicio('+rol+'): falta la barra segmentada');
  var filas = all('#inicio-contenido [data-action="verVehiculo"]');
  if(!filas.length) fail('inicio('+rol+'): sin lista de vehículos que requieren atención');
  if(!/Requieren atención/.test(txt) || !/Próximos cambios/.test(txt)) fail('inicio('+rol+'): faltan bloques');
  if(!/1 neumático crítico/.test(txt)) fail('inicio('+rol+'): falta la causa del vehículo crítico');
  if(!/~6 semanas/.test(txt)) fail('inicio('+rol+'): faltan los próximos cambios con semanas');
  if(!/Dispositivos: \d+ de \d+ activos/.test(txt)) fail('inicio('+rol+'): falta la línea de dispositivos');
  if(!$('#inicio-contenido [data-action="irA"][data-args=\'["alertas"]\']')) fail('inicio('+rol+'): falta "Ver todas las alertas"');
  // Dispositivos: el cliente ve el dato sin enlace (no gestiona hardware); administración abre la vista.
  var enlDisp = $('#inicio-contenido [data-action="irA"][data-args=\'["dispositivos"]\']');
  if(cliMode && enlDisp) fail('inicio(cliente): enlaza a Dispositivos');
  if(!cliMode && !enlDisp) fail('inicio(admin): los dispositivos sin actividad no enlazan a Dispositivos');
  // Últimas mediciones (fixture de flota.fixture.js): 3 vehículos, comparativa solo con medición previa
  var um = all('#inicio-contenido #inicio-h-ultimas ~ ul > li');
  if(um.length !== 3) fail('inicio('+rol+'): últimas mediciones: se esperaban 3 vehículos, hay '+um.length);
  else {
    var t0 = um[0].textContent.replace(/\s+/g, ' ');
    if(!/Coche 101/.test(t0) || /Camión/.test(t0) || /Coche 101 · Coche/.test(t0) || !/AB123CD/.test(t0) || !/14\/6\/2026/.test(t0)) fail('inicio('+rol+'): últimas mediciones: falta nombre, matrícula, coche o fecha: '+t0);
    if(!/13,0 → 12,6 mm/.test(t0) || !/\u22120,4/.test(t0)) fail('inicio('+rol+'): últimas mediciones: falta la comparativa: '+t0);
    var sin = um[0].querySelectorAll('.um-sin');
    if(sin.length !== 1 || !/15,5 mm/.test(um[0].querySelector('.um-neu:nth-child(3)').textContent)) fail('inicio('+rol+'): el neumático sin medición previa debe mostrar solo los mm y "Sin previa"');
    if(/→/.test(um[0].querySelector('.um-neu:nth-child(3)').textContent)) fail('inicio('+rol+'): comparativa sin medición previa');
    var t2 = um[2].textContent.replace(/\s+/g, ' ');
    if(!/7,3 → 5,9 mm/.test(t2) || !/\u22121,4/.test(t2) || !um[2].querySelector('.um-dif.alto')) fail('inicio('+rol+'): desgaste alto no destacado: '+t2);
    if(!/9,0 → 9,2 mm/.test(t2) || !/\+0,2/.test(t2)) fail('inicio('+rol+'): diferencia positiva: '+t2);
    if(um[1].textContent.indexOf('<Crítica>') === -1 || um[1].innerHTML.indexOf('<Crítica>') !== -1) fail('inicio: nombre en últimas mediciones sin escapar');
    if(um[2].querySelectorAll('.um-dif.sube').length !== 0) fail('inicio: +0,2 no debería marcarse como lectura mayor');
    um[1].querySelector('[data-action="verVehiculo"]').click(); await sleep(700);
    if(!$('#view-vehiculo-detalle').classList.contains('active')) fail('inicio('+rol+'): la fila de últimas mediciones no abre el detalle');
    $('.nav-item[data-view="inicio"]').click(); await sleep(500);
  }
  var rpcs = (w.__flotaFx && w.__flotaFx.rpcs) || [];
  if(!rpcs.length || rpcs[0][1].p_limite !== 8) fail('inicio('+rol+'): no pidió ultimas_mediciones con p_limite 8');
  // El rojo solo como punto de neumáticos críticos: ni tarjetas ni chips rojos en Inicio
  if(cont.querySelector('.badge.red')) fail('inicio('+rol+'): chip rojo en Inicio');
  all('#inicio-contenido .inicio-card').forEach(function(c){
    var cs = w.getComputedStyle(c);
    if(/rgb\(192, 57, 43\)/.test(cs.borderLeftColor+cs.backgroundColor)) fail('inicio('+rol+'): tarjeta con borde o fondo rojo');
  });
  if(all('#inicio-contenido .inicio-fila .inicio-punto.critico').length !== 1) fail('inicio('+rol+'): debe haber un punto rojo (un vehículo crítico)');
  var titulo = $('#inicio-title').textContent;
  if(titulo !== 'Inicio') fail('inicio('+rol+'): título '+titulo);
  if(/Todavía no hay datos|Todavía no hay vehículos/.test(txt)) fail('inicio('+rol+'): muestra "sin datos" teniendo datos');
  var listaClientes = /Clientes con más urgencias/.test(txt);
  if(cliMode && listaClientes) fail('inicio(cliente): ve la lista de clientes (solo admin)');
  if(!cliMode && !listaClientes) fail('inicio(admin): falta la lista de clientes');
  if(d.body.innerHTML.indexOf('<Crítica>') !== -1) fail('inicio: nombre de vehículo sin escapar');
  log.push('inicio('+rol+'): '+txt.slice(0,160));

  // --- Buscador de Inicio: Enter abre el detalle con una coincidencia; lista si hay varias ---
  var bi = $('#busq-inicio-input');
  if(!bi || !visible(bi)) fail('inicio('+rol+'): falta el buscador prominente');
  else {
    if(bi.placeholder !== 'Matrícula, número de coche o quema') fail('inicio: placeholder del buscador: '+bi.placeholder);
    var escribirB = async function(inp, v){ inp.value = v; inp.dispatchEvent(new w.Event('input',{bubbles:true})); await sleep(350); };
    var enviar = async function(inp){ inp.form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})); await sleep(700); };
    await escribirB(bi, 'cam'); await enviar(bi);
    if(all('#busq-inicio-res .busq-op').length < 2) fail('inicio: varias coincidencias deben mostrar lista');
    if($('#view-vehiculo-detalle').classList.contains('active')) fail('inicio: con varias coincidencias no debe abrir el detalle');
    await escribirB(bi, 'sab 1234'); // matrícula guardada como SAB-1234, escrita con espacio
    if(all('#busq-inicio-res .busq-op').length !== 1) fail('inicio: la matrícula con guion/espacio no se encuentra');
    await escribirB(bi, 'ab123cd'); await enviar(bi);
    if(!$('#view-vehiculo-detalle').classList.contains('active')) fail('inicio: Enter con una coincidencia no abre el detalle');
    if($('.nav-item.active').dataset.view !== 'vehiculos') fail('detalle: el menú debe resaltar Vehículos');
    if(!/Volver a Inicio/.test($('#vd-volver').textContent)) fail('detalle: "Volver" debe nombrar la vista de origen: '+$('#vd-volver').textContent);
    $('#vd-volver').click(); await sleep(500);
    if(!$('#view-inicio').classList.contains('active') || $('.nav-item.active').dataset.view !== 'inicio') fail('detalle: "Volver" no regresa a Inicio');
    await escribirB(bi, '205'); await enviar(bi); // por número de coche
    if(!$('#view-vehiculo-detalle').classList.contains('active')) fail('inicio: el número de coche no abre el detalle');
    $('.nav-item[data-view="inicio"]').click(); await sleep(400);
    // Por número de quema: el resultado nombra la quema y Enter abre el vehículo donde está montado el neumático
    await escribirB(bi, 'q 7788');
    var opq = all('#busq-inicio-res .busq-op');
    if(opq.length !== 1 || opq[0].textContent.indexOf('Quema Q-7788') === -1) fail('inicio: la quema no lista el vehículo con su quema: '+$('#busq-inicio-res').textContent);
    await enviar(bi);
    if(!$('#view-vehiculo-detalle').classList.contains('active') || $('#vd-cab').textContent.indexOf('Camión 01') === -1) fail('inicio: la quema no abre el vehículo donde está montado');
    $('.nav-item[data-view="inicio"]').click(); await sleep(400);
    await escribirB(bi, 'Q-9999');
    if(!/Ningún vehículo coincide/.test($('#busq-inicio-res').textContent)) fail('inicio: una quema inexistente debe decir que no hay coincidencias');
    await escribirB(bi, 'zzz'); 
    if(!/Ningún vehículo coincide/.test($('#busq-inicio-res').textContent)) fail('inicio: falta el mensaje sin coincidencias');
    bi.value = ''; bi.dispatchEvent(new w.Event('input',{bubbles:true})); await sleep(100);
  }
  // Lista "Requieren atención" -> detalle
  var primera = $('#inicio-contenido .inicio-fila[data-action="verVehiculo"]');
  if(primera){ primera.click(); await sleep(700);
    if(!$('#view-vehiculo-detalle').classList.contains('active')) fail('inicio: la fila no abre el detalle');
    $('.nav-item[data-view="inicio"]').click(); await sleep(500); }

  // --- Sin "Conectando…" permanente: el aviso de conexión solo existe ante un problema real ---
  var pill = $('#status-pill');
  if(!pill.hidden || visible(pill)) fail('conexion('+rol+'): el aviso de conexión se ve con todo funcionando');
  if(/Conectando/.test(d.body.innerText)) fail('conexion('+rol+'): se lee "Conectando…"');
  var textoPill = pill.textContent;
  if(!/Sin conexión/.test(textoPill) || !pill.querySelector('[data-action="reintentarConexion"]')) fail('conexion: el aviso de problema no tiene texto claro ni reintento');
  // Problema real: al perder la red aparece el aviso con reintento; "Reintentar" lo oculta y recarga la vista.
  w.dispatchEvent(new w.Event('offline')); await sleep(50);
  if(pill.hidden || !visible(pill)) fail('conexion: no aparece el aviso al perder la red');
  pill.querySelector('[data-action="reintentarConexion"]').click(); await sleep(300);
  if(!pill.hidden) fail('conexion: "Reintentar" no oculta el aviso');

  // --- Menú por rol ---
  var navVisible = function(v){ return visible($('.nav-item[data-view="'+v+'"]')); };
  ['inicio','vehiculos','alertas','stock','reportes'].concat(cliMode ? [] : ['dispositivos']).forEach(function(v){
    if(!navVisible(v)) fail('menu('+rol+'): falta '+v);
  });
  ['salud','dashboard','ficha'].forEach(function(v){ if($('.nav-item[data-view="'+v+'"]')) fail('menu('+rol+'): sigue la entrada '+v); });
  var visibles = all('.nav-item[data-view]').filter(function(n){ return visible(n); }).map(function(n){ return n.dataset.view; });
  if(cliMode){
    // Sucursales solo para el perfil global; el de sucursal no lo ve.
    var esperado = /[?&]secuser=1/.test(w.parent.location.search) ? 'inicio,vehiculos,alertas,stock,reportes' : 'inicio,vehiculos,alertas,stock,reportes,sucursales';
    if(visibles.join(',') !== esperado) fail('menu(cliente): menú inesperado: '+visibles.join(','));
    // Defensa en el router: aunque se fuerce la vista Dispositivos (botón de menú oculto o acción), el cliente sigue en Inicio
    $('.nav-item[data-view="dispositivos"]').click(); await sleep(400);
    if($('#view-dispositivos').classList.contains('active') || !$('#view-inicio').classList.contains('active')) fail('dispositivos(cliente): el router abrió la vista');
    var forzar = d.createElement('button'); forzar.setAttribute('data-action','irA'); forzar.setAttribute('data-args','["dispositivos"]'); d.body.appendChild(forzar);
    forzar.click(); await sleep(400); forzar.remove();
    if($('#view-dispositivos').classList.contains('active') || !$('#view-inicio').classList.contains('active')) fail('dispositivos(cliente): irA("dispositivos") abrió la vista');
    if($('.nav-item.active').dataset.view !== 'inicio') fail('dispositivos(cliente): el menú no resalta Inicio tras el rechazo');
    all('[data-admin-only]').forEach(function(el){ if(visible(el)) fail('menu(cliente): elemento admin visible: '+(el.id||el.className||el.textContent.trim().slice(0,30))); });
    if(/administración|mi panel|mi resumen|mediciones|balance|clientes/i.test($('.sidebar-nav').innerText)) fail('menu(cliente): se lee texto de administración');
    if(visible($('[data-action="openStockModal"]'))) fail('stock(cliente): ve el alta de compras');
  } else {
    ['flota','mediciones','clientes','balance'].forEach(function(v){ if(!navVisible(v)) fail('menu(admin): falta '+v); });
    if(!/administración/i.test($('.sidebar-nav').innerText)) fail('menu(admin): falta sección Administración');
  }
  var activos = all('.nav-item.active');
  if(activos.length !== 1 || activos[0].dataset.view !== 'inicio' || activos[0].getAttribute('aria-current') !== 'page') fail('menu: Inicio debe ser el único activo con aria-current');
  all('.nav-item').forEach(function(n){ if(n.tagName !== 'BUTTON') fail('menu: el ítem '+n.dataset.view+' no es un botón (no se alcanza con teclado)'); });

  // --- Recorrido de TODO el menú: vista activa, ítem resaltado único y título coherentes (sin errores de consola: lo vigila el arnés) ---
  for(var mi = 0; mi < visibles.length; mi++){
    var vv = visibles[mi];
    $('.nav-item[data-view="'+vv+'"]').click(); await sleep(500);
    var act = all('.nav-item.active');
    if(act.length !== 1 || act[0].dataset.view !== vv) fail('menu('+rol+'): al abrir '+vv+' el resaltado es '+act.map(function(n){ return n.dataset.view; }).join(','));
    if(!$('#view-'+vv) || !$('#view-'+vv).classList.contains('active')) fail('menu('+rol+'): '+vv+' no muestra su vista');
    if(all('.view.active').length !== 1) fail('menu('+rol+'): más de una vista activa en '+vv);
    if(!$('#breadcrumb-current').textContent.trim()) fail('menu('+rol+'): '+vv+' sin título');
    var bus = vv === 'inicio' ? '#busq-inicio-input' : vv === 'vehiculos' ? '#search-vehiculos' : '#busq-global-input';
    if(!visible($(bus))) fail('buscador ('+rol+'): no hay buscador visible en '+vv);
  }
  // --- Buscador global (barra superior, atajo "/") desde otra pantalla ---
  $('.nav-item[data-view="vehiculos"]').click(); await sleep(500);
  d.body.focus(); key('/');
  if(d.activeElement !== $('#search-vehiculos')) fail('buscador('+rol+'): "/" en Vehículos no enfoca su buscador');
  $('.nav-item[data-view="alertas"]').click(); await sleep(400);
  var bg = $('#busq-global-input');
  d.body.focus(); key('/'); 
  if(d.activeElement !== bg) fail('buscador global('+rol+'): "/" no enfoca el buscador');
  bg.value = 'ab 123-cd'; bg.dispatchEvent(new w.Event('input',{bubbles:true})); await sleep(400);
  if(all('#busq-global-res .busq-op').length !== 1) fail('buscador global('+rol+'): no encuentra AB123CD escrito como "ab 123-cd"');
  bg.form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})); await sleep(800);
  if(!$('#view-vehiculo-detalle').classList.contains('active')) fail('buscador global('+rol+'): Enter no abre el detalle');
  if(!/Volver a Alertas/.test($('#vd-volver').textContent)) fail('buscador global: "Volver" debe regresar a Alertas');
  if(bg.value !== '') fail('buscador global: no se limpia tras abrir');
  var tinp = d.createElement('input'); d.body.appendChild(tinp); tinp.focus(); tinp.dispatchEvent(new w.KeyboardEvent('keydown',{key:'/',bubbles:true,cancelable:true}));
  if(d.activeElement !== tinp) fail('buscador global: "/" no debe robar el foco de otro campo');
  tinp.remove();
  $('.nav-item[data-view="inicio"]').click(); await sleep(500);

  // --- Accesibilidad estática ---
  all('th').forEach(function(th){ if(!th.getAttribute('scope')) fail('a11y: <th> sin scope: '+th.textContent.trim().slice(0,30)); });
  all('label[for]').forEach(function(l){ if(!d.getElementById(l.getAttribute('for'))) fail('a11y: label for="'+l.getAttribute('for')+'" sin control'); });
  all('input:not([type=hidden]):not([type=checkbox]),select,textarea').forEach(function(c){
    if(c.closest('#view-ficha .ficha-umbrales')) return; // generado por otra vista
    var etiquetado = (c.id && d.querySelector('label[for="'+c.id+'"]')) || c.closest('label') || c.getAttribute('aria-label') || c.getAttribute('aria-labelledby');
    if(!etiquetado) fail('a11y: control sin etiqueta: '+(c.id||c.name||c.type)+' '+c.outerHTML.slice(0,100));
  });
  if($('#sr-live').getAttribute('aria-live') !== 'polite' || $('#sr-alert').getAttribute('role') !== 'alert') fail('a11y: faltan regiones vivas para avisos');
  if(!$('.skip-link')) fail('a11y: falta el enlace "Saltar al contenido"');

  // --- Modal: role=dialog, foco dentro, Tab atrapado, Esc cierra y devuelve el foco ---
  $('.nav-item[data-view="vehiculos"]').click(); await sleep(400);
  var abre = $('[data-action="openVehiculoModal"]');
  // El cliente no ve "Nuevo vehículo" (data-admin-only): se muestra solo para probar la accesibilidad del modal.
  if(abre.offsetParent === null) abre.style.display = '';
  abre.focus();
  abre.click(); await sleep(400);
  var dlg = $('#modal-vehiculo .modal');
  if(dlg.getAttribute('role') !== 'dialog' || dlg.getAttribute('aria-modal') !== 'true') fail('modal: sin role=dialog/aria-modal');
  if(!dlg.getAttribute('aria-labelledby')) fail('modal: sin aria-labelledby');
  if(!dlg.contains(d.activeElement)) fail('modal: el foco no entró al diálogo');
  var foco = all('#modal-vehiculo .modal button, #modal-vehiculo .modal input, #modal-vehiculo .modal select, #modal-vehiculo .modal textarea').filter(function(e){ return !e.disabled && visible(e); });
  foco[foco.length - 1].focus(); key('Tab');
  if(d.activeElement !== foco[0]) fail('modal: Tab desde el último control no vuelve al primero');
  key('Tab', true);
  if(d.activeElement !== foco[foco.length - 1]) fail('modal: Shift+Tab desde el primero no va al último');
  key('Escape'); await sleep(200);
  if($('#modal-vehiculo').classList.contains('show')) fail('modal: Esc no cierra');
  if(d.activeElement !== abre) fail('modal: el foco no vuelve al botón que lo abrió');
  // --- Cliente CON vehículos pero sin neumáticos medidos (vistas derivadas vacías): NO es "sin datos" ---
  var fxv = w.__flotaFx;
  if(fxv){
    // Si ultimas_mediciones falla (p. ej. migración sin aplicar), solo ese bloque muestra el error
    fxv.rpcError = true;
    $('.nav-item[data-view="inicio"]').click(); await sleep(500);
    var tErr = $('#inicio-contenido').textContent;
    if(!/Requieren atención/.test(tErr) || !/Últimas mediciones/.test(tErr)) fail('inicio('+rol+'): un fallo de ultimas_mediciones rompe el resto de Inicio');
    if(!$('#inicio-contenido #inicio-h-ultimas ~ .error-state')) fail('inicio('+rol+'): sin error en el bloque de últimas mediciones');
    fxv.rpcError = false;
    fxv.vacio = true;
    $('.nav-item[data-view="inicio"]').click(); await sleep(500);
    var txt = $('#inicio-contenido').textContent;
    if(/Sin vehículos registrados/.test(txt)) fail('inicio('+rol+'): "sin datos" con vehículos registrados: '+txt.slice(0,80));
    if(!/vehículos registrados, sin mediciones/.test(txt)) fail('inicio('+rol+'): falta el estado "vehículos sin mediciones": '+txt.slice(0,80));
    if(cliMode && $('#inicio-contenido [data-action="irA"]')) fail('inicio(cliente): el estado sin mediciones ofrece ir a Dispositivos');
    if(!cliMode && !$('#inicio-contenido [data-action="irA"]')) fail('inicio(admin): el estado sin mediciones no ofrece acción');
    fxv.vacio = false;
  }
  log.push('inicio('+rol+'): menu+a11y ok');
  $('.nav-item[data-view="inicio"]').click(); await sleep(300);
};
