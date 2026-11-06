// Recorrido de humo de clientes (admin). Lo invoca harness.html: await window.clientesFlow(w, d, sleep, fail, log)
window.clientesFlow = async function(w, d, sleep, fail, log){
  var fx = w.__clientesFx, $ = function(s){ return d.querySelector(s); };
  var act = function(n){ return $('[data-action="'+n+'"]'); };
  var toast = function(){ return $('#toast-msg').textContent; };
  var rows = function(f){ return d.querySelectorAll('#tbody-clientes tr'+(f||'')).length; };
  function setv(id, v){ $(id).value = v; }
  async function fillAndSave(name, email, pass){
    act('openClienteModal').click(); await sleep(150);
    setv('#f-name', name); setv('#f-email', email); setv('#f-password', pass);
    $('#cli-save').click(); await sleep(250);
  }
  $('.nav-item[data-view="clientes"]').click(); await sleep(500);

  // Eliminados ocultos por defecto; visibles (diferenciados) con el filtro
  if(rows('[data-deleted="1"]') !== 0) fail('clientes: eliminado visible por defecto');
  var chk = $('#chk-clientes-deleted'); if(!chk){ fail('clientes: falta filtro Mostrar eliminados'); return; }
  chk.checked = true; chk.dispatchEvent(new w.Event('change',{bubbles:true})); await sleep(400);
  if(rows('[data-deleted="1"]') !== 1) fail('clientes: eliminado no aparece con el filtro');
  if($('#tbody-clientes tr[data-deleted="1"]').textContent.indexOf('Eliminado') === -1) fail('clientes: falta badge Eliminado');
  if($('#tbody-clientes tr[data-deleted="1"] [data-a="del"]')) fail('clientes: eliminado ofrece borrar');
  chk.checked = false; chk.dispatchEvent(new w.Event('change',{bubbles:true})); await sleep(400);
  if(rows('[data-deleted="1"]') !== 0) fail('clientes: eliminado sigue visible al desactivar filtro');

  // Alta sin contraseña -> invitación (sin campo password en el body)
  await fillAndSave('Nuevo SinPass', 'nuevo@x.cl', '');
  var f = fx.fetches[fx.fetches.length-1];
  if(!f || 'password' in f) fail('clientes: alta sin contraseña no debe enviar password');
  if(toast().indexOf('invitación') === -1) fail('clientes: falta aviso de invitación: '+toast());
  // Contraseña corta: no llega al servidor
  var n = fx.fetches.length;
  await fillAndSave('Corta', 'corta@x.cl', 'abc12345678');
  if(fx.fetches.length !== n) fail('clientes: contraseña corta llegó al servidor');
  if(toast().indexOf('12 caracteres') === -1) fail('clientes: falta mensaje de 12 caracteres');
  // Contraseña válida
  await fillAndSave('ConPass', 'conpass@x.cl', 'abcdefghijkl');
  f = fx.fetches[fx.fetches.length-1];
  if(!f || f.password !== 'abcdefghijkl') fail('clientes: alta con contraseña no envió password');
  // Errores mapeados (no pasan por userError/console.error)
  await fillAndSave('Dup', 'dup@x.cl', '');
  if(toast().indexOf('Ya existe') === -1) fail('clientes: 409 sin mensaje en español: '+toast());
  await fillAndSave('NoAdmin', 'noadmin@x.cl', '');
  if(toast().indexOf('permiso') === -1) fail('clientes: 403 sin mensaje en español: '+toast());
  act('closeClienteModal').click(); await sleep(100);

  // Baja lógica por RPC
  var before = rows();
  var del = $('#tbody-clientes button[data-a="del"]');
  if(!del){ fail('clientes: sin botón eliminar'); return; }
  del.click(); await sleep(150);
  if($('#confirm-msg').textContent.indexOf('datos históricos se conservan') === -1) fail('clientes: texto de confirmación');
  $('#confirm-ok').click(); await sleep(300);
  var r = fx.rpcs[fx.rpcs.length-1];
  if(!r || r.args.p_id == null) fail('clientes: no se llamó cliente_eliminar_suave');
  if(rows() !== before-1) fail('clientes: la fila no desapareció tras la baja');
  // Cuenta de API en la ficha: email sugerido, credenciales una sola vez, lista
  $('.nav-item[data-view="ficha"]').click(); await sleep(600);
  var em = $('#ficha-api-email');
  if(!em || !/^api-.+@/.test(em.value)) fail('cuenta-api: email sugerido ausente: '+(em&&em.value));
  if($('#ficha-api-cred').style.display !== 'none') fail('cuenta-api: credenciales visibles antes de crear');
  em.value = 'api-test@x.cl';
  act('crearCuentaApi').click(); await sleep(400);
  var af = fx.apiFetches[fx.apiFetches.length-1];
  if(!af || af.email !== 'api-test@x.cl' || typeof af.cliente_id !== 'number' || 'password' in af) fail('cuenta-api: cuerpo inesperado');
  if($('#ficha-api-cred-pass').textContent.indexOf('Zx9-generada') === -1) fail('cuenta-api: no muestra la contraseña');
  if($('#ficha-api-cred').style.display === 'none') fail('cuenta-api: credenciales no visibles');
  if(!act('copiarCredencialesApi')) fail('cuenta-api: falta botón copiar');
  if($('#ficha-api-lista').textContent.indexOf('api-test@x.cl') === -1) fail('cuenta-api: la lista no muestra la cuenta');
  if($('#ficha-api-lista').textContent.indexOf('Zx9-generada') !== -1) fail('cuenta-api: la lista expone la contraseña');
  $('.nav-item[data-view="clientes"]').click(); await sleep(300);
  $('.nav-item[data-view="ficha"]').click(); await sleep(600);
  if($('#ficha-api-cred-pass').textContent !== '') fail('cuenta-api: la contraseña sigue tras recargar la ficha');
  log.push('clientes-flow: fetches='+fx.fetches.length+' rpcs='+fx.rpcs.length);
};
