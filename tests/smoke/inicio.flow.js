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
  if(/Todavía no hay datos|Todavía no hay vehículos/.test($('#inicio-contenido').textContent)) fail('inicio('+rol+'): muestra "sin datos" teniendo datos');
  if(/¿Qué requiere/.test($('#view-inicio').textContent)) fail('inicio('+rol+'): queda el subtítulo de relleno');
  if(!$('#inicio-contenido .atencion-veh [data-action="verVehiculoEnLista"]')) fail('inicio('+rol+'): sin lista de vehículos que urgen');
  var listaClientes = /Clientes con más urgencias/.test($('#inicio-contenido').textContent);
  if(cliMode && listaClientes) fail('inicio(cliente): ve la lista de clientes (solo admin)');
  if(!cliMode && !listaClientes) fail('inicio(admin): falta la lista de clientes');
  if(d.body.innerHTML.indexOf('<Crítica>') !== -1) fail('inicio: nombre de vehículo sin escapar');

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

  // --- Menú por rol: el cliente ve solo Inicio, Vehículos, Alertas, Reportes y Dispositivos ---
  var navVisible = function(v){ return visible($('.nav-item[data-view="'+v+'"]')); };
  ['inicio','vehiculos','alertas','reportes','dispositivos'].forEach(function(v){
    if(!navVisible(v)) fail('menu('+rol+'): falta '+v);
  });
  ['salud','dashboard'].forEach(function(v){ if($('.nav-item[data-view="'+v+'"]')) fail('menu('+rol+'): sigue la entrada duplicada '+v); });
  if(cliMode){
    var visibles = all('.nav-item[data-view]').filter(function(n){ return visible(n); }).map(function(n){ return n.dataset.view; }).join(',');
    if(visibles !== 'inicio,vehiculos,alertas,reportes,dispositivos') fail('menu(cliente): menú inesperado: '+visibles);
    all('[data-admin-only]').forEach(function(el){ if(visible(el)) fail('menu(cliente): elemento admin visible: '+(el.id||el.className||el.textContent.trim().slice(0,30))); });
    if(/administración|mi panel|mi resumen|mediciones/i.test($('.sidebar-nav').innerText)) fail('menu(cliente): se lee texto de administración o duplicados');
  } else {
    ['flota','mediciones','clientes','ficha','balance'].forEach(function(v){ if(!navVisible(v)) fail('menu(admin): falta '+v); });
    if(!/administración/i.test($('.sidebar-nav').innerText)) fail('menu(admin): falta sección Administración');
  }
  var activos = all('.nav-item.active');
  if(activos.length !== 1 || activos[0].dataset.view !== 'inicio' || activos[0].getAttribute('aria-current') !== 'page') fail('menu: Inicio debe ser el único activo con aria-current');
  all('.nav-item').forEach(function(n){ if(n.tagName !== 'BUTTON') fail('menu: el ítem '+n.dataset.view+' no es un botón (no se alcanza con teclado)'); });

  // --- Las tarjetas llevan a la vista correspondiente ---
  var destinos = {alertas:'alertas', dispositivos:'dispositivos', flota: cliMode ? 'vehiculos' : 'flota'};
  for(var v in destinos){
    var card = $('#inicio-contenido .atencion-card[data-tarjeta="'+destinos[v]+'"]');
    if(!card){ fail('inicio('+rol+'): falta la tarjeta que lleva a '+destinos[v]); continue; }
    card.click(); await sleep(400);
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
  // --- Cliente CON vehículos pero sin neumáticos medidos (vistas derivadas vacías): NO es "sin datos" ---
  var fxv = w.__flotaFx;
  if(fxv){
    fxv.vacio = true;
    $('.nav-item[data-view="inicio"]').click(); await sleep(500);
    var txt = $('#inicio-contenido').textContent;
    if(/Todavía no hay datos|Todavía no hay vehículos/.test(txt)) fail('inicio('+rol+'): "sin datos" con vehículos registrados: '+txt.slice(0,80));
    if(!/vehículos registrados, sin mediciones todavía/.test(txt)) fail('inicio('+rol+'): falta el estado "vehículos sin mediciones": '+txt.slice(0,80));
    if(!$('#inicio-contenido [data-action="irA"]')) fail('inicio('+rol+'): el estado sin mediciones no ofrece acción');
    fxv.vacio = false;
  }
  log.push('inicio('+rol+'): menu+a11y ok');
  $('.nav-item[data-view="inicio"]').click(); await sleep(300);
};
