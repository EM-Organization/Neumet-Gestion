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
  var tarjetas = all('#inicio-contenido .atencion-card');
  var nums = tarjetas.map(function(t){ return t.querySelector('.atencion-n').textContent; }).join(',');
  log.push('inicio('+rol+'): tarjetas='+nums);
  // críticos, alertas, dispositivos sin actividad (caído + sin actividad), vehículos sin medir (fixtures de flota y salud)
  if(nums !== '1,4,2,2') fail('inicio('+rol+'): contadores inesperados '+nums);
  tarjetas.forEach(function(t){
    if(!t.querySelector('.atencion-estado .badge') || !/\S/.test(t.querySelector('.atencion-estado').textContent)) fail('inicio: tarjeta sin chip con texto');
  });
  var titulo = $('#inicio-title').textContent;
  if(cliMode ? titulo.indexOf('Hola, ') !== 0 : titulo !== 'Inicio') fail('inicio('+rol+'): título '+titulo);
  if(!$('#inicio-contenido .atencion-veh [data-action="verVehiculoEnLista"]')) fail('inicio('+rol+'): sin lista de vehículos que urgen');
  var listaClientes = /Clientes con más urgencias/.test($('#inicio-contenido').textContent);
  if(cliMode && listaClientes) fail('inicio(cliente): ve la lista de clientes (solo admin)');
  if(!cliMode && !listaClientes) fail('inicio(admin): falta la lista de clientes');
  if(d.body.innerHTML.indexOf('<Crítica>') !== -1) fail('inicio: nombre de vehículo sin escapar');

  // --- Menú por rol: el cliente nunca ve secciones de administración ---
  var navVisible = function(v){ return visible($('.nav-item[data-view="'+v+'"]')); };
  ['inicio','flota','alertas','vehiculos','mediciones','dispositivos','salud','reportes','ficha'].forEach(function(v){
    if(!navVisible(v)) fail('menu('+rol+'): falta '+v);
  });
  if(cliMode){
    ['clientes','balance'].forEach(function(v){ if(navVisible(v)) fail('menu(cliente): ve la sección de administración '+v); });
    all('[data-admin-only]').forEach(function(el){ if(visible(el)) fail('menu(cliente): elemento admin visible: '+(el.id||el.className||el.textContent.trim().slice(0,30))); });
    if(!navVisible('dashboard')) fail('menu(cliente): falta Mi panel');
    if(/administración/i.test($('.sidebar-nav').innerText)) fail('menu(cliente): se lee "Administración"');
    if(!/Mi resumen/.test($('.nav-item[data-view="ficha"]').innerText)) fail('menu(cliente): la ficha debe llamarse "Mi resumen"');
  } else {
    ['clientes','balance'].forEach(function(v){ if(!navVisible(v)) fail('menu(admin): falta '+v); });
    if(navVisible('dashboard')) fail('menu(admin): ve "Mi panel" (solo cliente)');
    if(!/administración/i.test($('.sidebar-nav').innerText)) fail('menu(admin): falta sección Administración');
  }
  var activos = all('.nav-item.active');
  if(activos.length !== 1 || activos[0].dataset.view !== 'inicio' || activos[0].getAttribute('aria-current') !== 'page') fail('menu: Inicio debe ser el único activo con aria-current');
  all('.nav-item').forEach(function(n){ if(n.tagName !== 'BUTTON') fail('menu: el ítem '+n.dataset.view+' no es un botón (no se alcanza con teclado)'); });

  // --- Las tarjetas llevan a la vista correspondiente ---
  var destinos = {alertas:'alertas', salud:'salud', flota:'flota'};
  for(var v in destinos){
    $('#inicio-contenido .atencion-card[data-tarjeta="'+v+'"]').click(); await sleep(400);
    if(!$('#view-'+destinos[v]).classList.contains('active')) fail('inicio('+rol+'): la tarjeta '+v+' no abre su vista');
    $('.nav-item[data-view="inicio"]').click(); await sleep(500);
  }

  // --- Accesibilidad estática ---
  all('th').forEach(function(th){ if(!th.getAttribute('scope')) fail('a11y: <th> sin scope: '+th.textContent.trim().slice(0,30)); });
  all('label[for]').forEach(function(l){ if(!d.getElementById(l.getAttribute('for'))) fail('a11y: label for="'+l.getAttribute('for')+'" sin control'); });
  all('input:not([type=hidden]):not([type=checkbox]),select,textarea').forEach(function(c){
    if(c.closest('#view-ficha .ficha-umbrales')) return; // generado por otra vista
    var etiquetado = (c.id && d.querySelector('label[for="'+c.id+'"]')) || c.closest('label') || c.getAttribute('aria-label') || c.getAttribute('aria-labelledby');
    if(!etiquetado) fail('a11y: control sin etiqueta: '+(c.id||c.name||c.type));
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
  log.push('inicio('+rol+'): menu+a11y ok');
  $('.nav-item[data-view="inicio"]').click(); await sleep(300);
};
