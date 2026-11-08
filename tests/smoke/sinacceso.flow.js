// Sesión autenticada sin acceso al panel (?sinperfil=1: sin perfil ni vínculo; ?api=1: perfil de rol 'api').
// Debe verse solo la pantalla «Sin acceso»: sin menú, sin vistas y sin consultas de datos más allá de resolver el rol.
// Lo invoca harness.html: await window.sinAccesoFlow(w, d, sleep, fail, log)
window.sinAccesoFlow = async function(w, d, sleep, fail, log){
  var $ = function(s){ return d.querySelector(s); };
  var visible = function(el){ return !!el && el.getClientRects().length > 0; };
  var modo = /[?&]api=1/.test(location.search) ? 'api' : 'sinperfil';
  await sleep(600);
  var sa = $('#sin-acceso-screen');
  if(!visible(sa)) fail('sin-acceso('+modo+'): no se ve la pantalla Sin acceso');
  if(visible($('#app'))) fail('sin-acceso('+modo+'): el panel está visible');
  if(visible($('#login-screen'))) fail('sin-acceso('+modo+'): se ve el login');
  var txt = sa.textContent.replace(/\s+/g, ' ');
  if(!/Sin acceso/.test(txt) || !/Esta cuenta aún no tiene un perfil asignado\. Contactar a la administración\./.test(txt)) fail('sin-acceso('+modo+'): texto inesperado: '+txt);
  if(!/Cerrar sesión/.test($('#sin-acceso-cerrar').textContent)) fail('sin-acceso('+modo+'): falta el botón Cerrar sesión');
  var menu = Array.prototype.filter.call(d.querySelectorAll('.nav-item'), visible).length;
  if(menu) fail('sin-acceso('+modo+'): hay '+menu+' ítems de menú visibles');
  // switchView deja la vista elegida en #contenido[data-vista]: sin sesión de panel nunca debe escribirse.
  if($('#contenido').dataset.vista) fail('sin-acceso('+modo+'): hay una vista cargada: '+$('#contenido').dataset.vista);
  if(/Administrador/.test(d.body.innerText)) fail('sin-acceso('+modo+'): aparece «Administrador»');
  // Solo se consulta lo necesario para decidir el rol.
  var permitidas = ['from:perfiles', 'from:clientes'];
  var extra = w.__llamadas.filter(function(x){ return permitidas.indexOf(x) === -1; });
  if(extra.length) fail('sin-acceso('+modo+'): consultas de datos: '+extra.join(','));
  log.push('sin-acceso('+modo+') llamadas='+w.__llamadas.join(','));

  // Defensa en profundidad: ni switchView ni los loaders consultan datos ni activan vistas.
  var nav = await w.eval("import('/assets/js/core/nav.js')");
  var antes = w.__llamadas.length;
  ['inicio','clientes','vehiculos','dispositivos','balance','flota'].forEach(function(v){ nav.switchView(v); });
  nav.reloadActiveView();
  await sleep(300);
  if(w.__llamadas.length !== antes) fail('sin-acceso('+modo+'): switchView/loaders hicieron consultas: '+w.__llamadas.slice(antes).join(','));
  if($('#contenido').dataset.vista) fail('sin-acceso('+modo+'): switchView cargó '+$('#contenido').dataset.vista);

  // Cerrar sesión vuelve al login.
  $('#sin-acceso-cerrar').click();
  await sleep(400);
  if(!visible($('#login-screen'))) fail('sin-acceso('+modo+'): cerrar sesión no vuelve al login');
  if(visible(sa)) fail('sin-acceso('+modo+'): la pantalla Sin acceso sigue visible tras cerrar sesión');
};
