// Arranque del panel (?arranque=1): mientras la sesión se resuelve (stub.js la demora 400 ms) no debe verse el formulario de login.
// Variantes: sin más = sesión válida; &nosession=1 = sin sesión; &roto=1 = la lectura de la sesión falla; &sinperfil=1 = sesión sin perfil.
// El harness inyecta antes de los scripts un observador (window.__vistos) que anota si alguna pantalla llegó a verse en cualquier momento.
// Lo invoca harness.html: await window.arranqueFlow(w, d, sleep, fail, log)
// Escenas de carrera (?escena=...): arranque.fixture.js controla perfiles, eventos de auth y oyentes. Cada una cubre un caso de #131.
var arranqueVisible = function(el){ return !!el && el.getClientRects().length > 0; };
var arranqueEscenas = {
  // SIGNED_OUT mientras resolverRol espera el perfil: la respuesta tardía no debe mostrar el panel.
  signout: async function(w, d, sleep, fail, log){
    var V = arranqueVisible;
    await sleep(1000);
    w.__auth.emitir('SIGNED_OUT', null);
    await sleep(3500);
    if(!V(d.getElementById('login-screen'))) fail('signout: no se ve el login tras cerrar sesión');
    if(V(d.getElementById('app')) || w.__vistos.app) fail('signout: la respuesta tardía del perfil mostró el panel tras cerrar sesión');
    if(V(d.getElementById('sin-acceso-screen'))) fail('signout: se ve «Sin acceso» tras cerrar sesión');
    log.push('escena signout perfiles='+w.__perfil.calls);
  },
  // Error de red con token válido: «No se pudo cargar» (no «Sin acceso» ni panel), y sin «Cargando…» a la vez.
  red: async function(w, d, sleep, fail, log){
    var V = arranqueVisible;
    await sleep(1500);
    var c = d.getElementById('cargando-screen'), av = d.getElementById('cargando-aviso');
    if(!c.classList.contains('falla')) fail('red: falta la marca de fallo de carga');
    if(!V(av)) fail('red: no se ve «No se pudo cargar»');
    if(V(c.querySelector('.login-sub'))) fail('red: se ven a la vez «Cargando…» y «No se pudo cargar»');
    if(V(d.getElementById('sin-acceso-screen'))) fail('red: se mostró «Sin acceso» ante un error de red');
    if(V(d.getElementById('login-screen'))) fail('red: se mostró el login ante un error de red');
    if(V(d.getElementById('app')) || w.__vistos.app) fail('red: se mostró el panel ante un error de red');
    log.push('escena red perfiles='+w.__perfil.calls);
  },
  // Mismo usuario tras SIGNED_OUT con la consulta anterior colgada: entra sin esperar el tope; el tope viejo no lo saca.
  reingreso: async function(w, d, sleep, fail, log){
    var V = arranqueVisible, c = d.getElementById('cargando-screen');
    var sesion = {user:{id:'u-1',email:'admin@test.local'}};
    await sleep(800);
    w.__auth.emitir('SIGNED_OUT', null);
    if(!V(d.getElementById('login-screen'))) fail('reingreso: no se ve el login tras cerrar sesión');
    w.__auth.emitir('SIGNED_IN', sesion);
    await sleep(1000);
    if(!V(d.getElementById('app'))) fail('reingreso: el mismo usuario no pudo volver a entrar antes del tope de 8 s');
    await sleep(8000);
    if(!V(d.getElementById('app'))) fail('reingreso: el tope de la consulta anterior sacó el panel');
    if(V(c) || c.classList.contains('falla')) fail('reingreso: el fallo de la sesión anterior se mostró');
    if(w.__perfil.calls !== 2) fail('reingreso: consultas de perfil '+w.__perfil.calls+' (esperadas 2)');
    log.push('escena reingreso perfiles='+w.__perfil.calls);
  },
  // Tope de 8 s de getSession: sale el login; luego SIGNED_IN y TOKEN_REFRESHED válidos entran una sola vez, con un oyente.
  tope: async function(w, d, sleep, fail, log){
    var V = arranqueVisible;
    var sesion = {user:{id:'u-1',email:'admin@test.local'}};
    await sleep(9000);
    if(!V(d.getElementById('login-screen'))) fail('tope: no se ve el login tras el tope de 8 s');
    w.__auth.emitir('SIGNED_IN', sesion);
    await sleep(800);
    w.__auth.emitir('TOKEN_REFRESHED', sesion);
    await sleep(800);
    if(!V(d.getElementById('app'))) fail('tope: SIGNED_IN válido tras el tope no mostró el panel');
    if(w.__perfil.calls !== 1) fail('tope: consultas de perfil '+w.__perfil.calls+' (esperada 1)');
    if(w.__auth.registros !== 1) fail('tope: oyentes de auth registrados: '+w.__auth.registros+' (esperado 1)');
    log.push('escena tope perfiles='+w.__perfil.calls+' oyentes='+w.__auth.registros);
  },
  // Login y SIGNED_IN simultáneos: una sola consulta de perfil.
  login: async function(w, d, sleep, fail, log){
    var V = arranqueVisible;
    var sesion = {user:{id:'u-1',email:'admin@test.local'}};
    await sleep(800);
    if(!V(d.getElementById('login-screen'))) fail('login: no se ve el login sin sesión');
    d.getElementById('login-email').value = 'admin@test.local';
    d.getElementById('login-password').value = 'clave-de-prueba';
    d.getElementById('login-form').dispatchEvent(new w.Event('submit', {cancelable:true}));
    w.__auth.emitir('SIGNED_IN', sesion);
    await sleep(1500);
    if(!V(d.getElementById('app'))) fail('login: el panel no se ve tras iniciar sesión');
    if(w.__perfil.calls !== 1) fail('login: consultas de perfil '+w.__perfil.calls+' (esperada 1 con login y SIGNED_IN a la vez)');
    log.push('escena login perfiles='+w.__perfil.calls);
  }
};

window.arranqueFlow = async function(w, d, sleep, fail, log){
  var q = location.search;
  var escena = (q.match(/[?&]escena=(\w+)/) || [])[1];
  if(escena){
    if(!arranqueEscenas[escena]) fail('escena desconocida: '+escena);
    else await arranqueEscenas[escena](w, d, sleep, fail, log);
    return;
  }
  var visible = function(el){ return !!el && el.getClientRects().length > 0; };
  var sinSesion = /[?&](nosession|roto)=1/.test(q), sinPerfil = /[?&]sinperfil=1/.test(q);
  var modo = /[?&]roto=1/.test(q) ? 'sesion-rota' : sinSesion ? 'sin-sesion' : sinPerfil ? 'sin-perfil' : 'con-sesion';
  var colgada = (q.match(/[?&]colgada=(\w+)/)||[])[1] || '';
  if(colgada) modo = 'colgada-'+colgada;
  // Con colgada el tope de espera de auth.js es 8 s: se mira a los 9 s, antes de que la CSS muestre el aviso por su cuenta (10 s).
  await sleep(colgada ? 9000 : 1200);
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
      // A los 9 s el aviso solo puede estar por la marca «falla» de showFalloCarga() (tope de entrar), no por la animación CSS.
      if(!cg.classList.contains('falla')) fail('arranque('+modo+'): el tope de espera de la consulta de perfil no marcó el fallo de carga (falla)');
      if(!visible(cg) || !visible(av)) fail('arranque('+modo+'): sin aviso visible con la consulta de perfil '+(colgada==='lanza'?'fallida':'sin respuesta'));
      if(visible(d.getElementById('login-screen')) || visible(d.getElementById('sin-acceso-screen'))) fail('arranque('+modo+'): se mostró login o «Sin acceso» en vez del aviso');
    }
    if(colgada === 'tardia'){
      // La consulta de perfil responde a los 9,5 s, ya vencido el tope: el panel nunca debe aparecer (no se llama a showApp).
      await sleep(2500);
      if(visible(d.getElementById('app')) || w.__vistos.app) fail('arranque('+modo+'): la respuesta tardía del perfil mostró el panel');
      if(!cg.classList.contains('falla')) fail('arranque('+modo+'): la respuesta tardía quitó el aviso de fallo de carga');
    }
    log.push('arranque('+modo+') vistos='+JSON.stringify(w.__vistos));
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
