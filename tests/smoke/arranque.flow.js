// Arranque del panel (?arranque=1): mientras la sesión se resuelve (stub.js la demora 400 ms) no debe verse el formulario de login.
// Variantes: sin más = sesión válida; &nosession=1 = sin sesión; &roto=1 = la lectura de la sesión falla; &sinperfil=1 = sesión sin perfil.
// El harness inyecta antes de los scripts un observador (window.__vistos) que anota si alguna pantalla llegó a verse en cualquier momento.
// Lo invoca harness.html: await window.arranqueFlow(w, d, sleep, fail, log)
window.arranqueFlow = async function(w, d, sleep, fail, log){
  var q = location.search;
  var visible = function(el){ return !!el && el.getClientRects().length > 0; };
  var sinSesion = /[?&](nosession|roto)=1/.test(q), sinPerfil = /[?&]sinperfil=1/.test(q);
  var modo = /[?&]roto=1/.test(q) ? 'sesion-rota' : sinSesion ? 'sin-sesion' : sinPerfil ? 'sin-perfil' : 'con-sesion';
  await sleep(1200);
  var v = w.__vistos;
  if(!v){ fail('arranque('+modo+'): falta el observador de pantallas'); return; }
  if(!v.cargando) fail('arranque('+modo+'): nunca se vio el estado «Cargando»');
  var c = d.getElementById('cargando-screen');
  if(!c){ fail('arranque('+modo+'): no existe la pantalla «Cargando»'); }
  else {
    if(visible(c)) fail('arranque('+modo+'): «Cargando» sigue visible tras resolver la sesión');
    if(!/Cargando/.test(c.textContent) || c.getAttribute('role') !== 'status') fail('arranque('+modo+'): «Cargando» sin texto accesible');
  }
  if(sinSesion){
    if(!visible(d.getElementById('login-screen'))) fail('arranque('+modo+'): no se ve el login');
    if(visible(d.getElementById('app')) || v.app) fail('arranque('+modo+'): se vio el panel sin sesión válida');
    if(w.__llamadas.length) fail('arranque('+modo+'): consultas de datos sin sesión: '+w.__llamadas.join(','));
  } else {
    if(v.login) fail('arranque('+modo+'): el login llegó a verse con la sesión ya iniciada');
    if(sinPerfil){ if(!visible(d.getElementById('sin-acceso-screen'))) fail('arranque('+modo+'): no se ve «Sin acceso»'); }
    else if(!visible(d.getElementById('app'))) fail('arranque('+modo+'): la app no se ve');
  }
  log.push('arranque('+modo+') vistos='+JSON.stringify(v));
};
