// Arranque del panel (?arranque=1): mientras la sesión se resuelve (stub.js la demora 400 ms) no debe verse el formulario de login.
// Variantes: sin más = sesión válida; &nosession=1 = sin sesión; &roto=1 = la lectura de la sesión falla; &sinperfil=1 = sesión sin perfil.
// El harness inyecta antes de los scripts un observador (window.__vistos) que anota si alguna pantalla llegó a verse en cualquier momento.
// Lo invoca harness.html: await window.arranqueFlow(w, d, sleep, fail, log)
window.arranqueFlow = async function(w, d, sleep, fail, log){
  var q = location.search;
  var visible = function(el){ return !!el && el.getClientRects().length > 0; };
  var sinSesion = /[?&](nosession|roto)=1/.test(q), sinPerfil = /[?&]sinperfil=1/.test(q);
  var modo = /[?&]roto=1/.test(q) ? 'sesion-rota' : sinSesion ? 'sin-sesion' : sinPerfil ? 'sin-perfil' : 'con-sesion';
  var colgada = (q.match(/[?&]colgada=(\w+)/)||[])[1] || '';
  if(colgada) modo = 'colgada-'+colgada;
  // Con colgada el tope de espera de auth.js es 8 s: se espera más que eso.
  await sleep(colgada ? 11000 : 1200);
  var v = w.__vistos;
  // El aviso «No se pudo cargar» existe en el HTML inicial, con enlace de recarga y su aparición diferida solo con CSS.
  var av = d.getElementById('cargando-aviso');
  if(!av || !/No se pudo cargar/.test(av.textContent) || !av.querySelector('a[href=""]')) fail('arranque('+modo+'): falta el aviso «No se pudo cargar» con enlace a recargar en la pantalla «Cargando»');
  else if(!d.getElementById('cargando-screen').classList.contains('falla') && w.getComputedStyle(av).animationDelay !== '10s') fail('arranque('+modo+'): el aviso no aparece con retraso CSS de 10 s');
  if(colgada){
    var cg = d.getElementById('cargando-screen');
    if(visible(d.getElementById('app')) || v.app) fail('arranque('+modo+'): se vio el panel sin rol resuelto');
    if(colgada === 'sesion'){
      if(visible(cg)) fail('arranque('+modo+'): «Cargando» colgado con getSession sin respuesta');
      if(!visible(d.getElementById('login-screen'))) fail('arranque('+modo+'): no se ve el login');
    } else {
      if(!visible(cg) || !visible(av)) fail('arranque('+modo+'): sin aviso visible con la consulta de perfil '+(colgada==='lanza'?'fallida':'sin respuesta'));
      if(visible(d.getElementById('login-screen')) || visible(d.getElementById('sin-acceso-screen'))) fail('arranque('+modo+'): se mostró login o «Sin acceso» en vez del aviso');
    }
    log.push('arranque('+modo+') vistos='+JSON.stringify(v));
    return;
  }

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
