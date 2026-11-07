// Se carga justo después del UMD real de supabase-js y ANTES de los módulos del panel.
// Reemplaza SOLO la capa de autenticación (getSession / login / logout / eventos) por la sesión de prueba que el
// arnés deja en window.__E2E (JWT firmado para un usuario con perfil real en la base). Las consultas de datos
// (from / rpc) las ejecuta el cliente real de supabase-js por HTTP contra PostgREST, con ese JWT como Bearer.
// Punto de inyección: supabase-js obtiene el token de cada petición con this.auth.getSession(); basta sobrescribirlo.
(function () {
  var E = window.__E2E;
  if (!E) throw new Error('E2E: falta window.__E2E (el arnés lo define antes de cargar la página)');
  var original = window.supabase.createClient;
  window.supabase.createClient = function () {
    var client = original.apply(this, arguments);
    var user = { id: E.sub, email: E.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
    var session = { access_token: E.jwt, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'e2e', user: user };
    var auth = client.auth;
    auth.getSession = function () { return Promise.resolve({ data: { session: session }, error: null }); };
    auth.getUser = function () { return Promise.resolve({ data: { user: user }, error: null }); };
    auth.signInWithPassword = function () { return Promise.resolve({ data: { user: user, session: session }, error: null }); };
    auth.signOut = function () { return Promise.resolve({ error: null }); };
    auth.onAuthStateChange = function () { return { data: { subscription: { unsubscribe: function () {} } } }; };
    return client;
  };
})();
