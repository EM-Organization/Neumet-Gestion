// Recorrido de humo de Balance sobre las RPC del precio mensual (F10 PR 9b, migración C1). Lo invoca harness.html:
// await window.balanceFlow(w, d, sleep, fail, log, cliMode). Datos y emulación de RPC: privilegios.fixture.js.
//   * Equipo Neumet: los precios llegan por cliente_precios_mensuales, cambiar uno llama a cliente_precio_mensual_fijar,
//     los errores 42501, 22023 y P0002 muestran su aviso y el campo vuelve al valor vigente.
//   * Administrador de empresa y usuario de sucursal: no ven Balance ni se hace ninguna llamada de precios.
//   * Ninguna consulta toca clientes.precio_mensual: el fixture lo registra en __preciosFx.violaciones (lo revisa el harness).
window.balanceFlow = async function(w, d, sleep, fail, log, cliMode){
  var fx = w.__preciosFx, $ = function(s){ return d.querySelector(s); }, all = function(s){ return Array.prototype.slice.call(d.querySelectorAll(s)); };
  var visible = function(el){ return !!el && el.getClientRects().length > 0; };
  var llamadas = function(n){ return fx.balance.filter(function(r){ return r.name === n; }); };
  var rol = cliMode ? 'cliente' : 'admin';

  if(cliMode){
    if(visible($('.nav-item[data-view="balance"]'))) fail('balance(' + rol + '): el menú muestra Balance');
    var b = $('.nav-item[data-view="balance"]'); if(b) b.click();
    await sleep(300);
    if($('#view-balance').classList.contains('active')) fail('balance(' + rol + '): entró a Balance');
    if(fx.balance.length) fail('balance(' + rol + '): pidió precios mensuales: ' + JSON.stringify(fx.balance));
    log.push('balance-flow(' + rol + '): sin acceso');
    return;
  }

  var alt = fx.balance.length;
  $('.nav-item[data-view="balance"]').click(); await sleep(700);
  if(fx.balance.length === alt || !llamadas('cliente_precios_mensuales').length) fail('balance: no pidió los precios por cliente_precios_mensuales');
  var campo = function(id){ return $('.precio-input[data-cid="' + id + '"]'); };
  var set = function(id, v){ var el = campo(id); el.value = v; el.dispatchEvent(new w.Event('change', {bubbles: true})); };
  if(all('.precio-input').length < 2) fail('balance: campos de precio: ' + all('.precio-input').length); // clientesFlow ya pudo dar de alta uno más (precio 0)
  if(!campo(1) || campo(1).value !== '50000' || !campo(2) || campo(2).value !== '75000') fail('balance: los precios no vienen de la RPC: ' + all('.precio-input').map(function(i){ return i.value; }).join());
  if(!/125\.000/.test($('#kpi-ingresos').textContent)) fail('balance: ingresos mensuales: ' + $('#kpi-ingresos').textContent);

  // Cambiar el precio: un solo gesto (escribir y Enter), la misma cantidad de clics que antes del cambio de origen de datos.
  set(1, '60000'); await sleep(500);
  var f = llamadas('cliente_precio_mensual_fijar');
  if(f.length !== 1 || f[0].args.p_cliente_id !== 1 || f[0].args.p_precio !== 60000) fail('balance: llamada a fijar: ' + JSON.stringify(f));
  if($('#toast-msg').textContent !== 'Precio actualizado') fail('balance: aviso tras fijar: ' + $('#toast-msg').textContent);
  if(campo(1).value !== '60000' || !/135\.000/.test($('#kpi-ingresos').textContent)) fail('balance: no actualiza el ingreso tras fijar: ' + $('#kpi-ingresos').textContent);
  // Un negativo se corrige a 0 antes de llamar
  set(2, '-5'); await sleep(500);
  f = llamadas('cliente_precio_mensual_fijar');
  if(f[f.length - 1].args.p_precio !== 0) fail('balance: un precio negativo debe enviarse como 0: ' + JSON.stringify(f[f.length - 1]));
  set(2, '75000'); await sleep(500);

  // Errores de la RPC: aviso en español y el campo recupera el valor vigente
  var casos = [
    ['42501', /^Sin permiso para cambiar precios$/],
    ['22023', /^Precio inválido\. Ingresar un monto entre 0 y 9\.999\.999\.999$/],
    ['P0002', /^El cliente ya no existe\. Recargar la lista$/]
  ];
  for(var i = 0; i < casos.length; i++){
    fx.falla = casos[i][0];
    set(1, '99'); await sleep(500);
    var t = $('#toast-msg').textContent;
    if(!casos[i][1].test(t)) fail('balance: aviso para ' + casos[i][0] + ': ' + t);
    if(!$('#toast').classList.contains('error')) fail('balance: el aviso de ' + casos[i][0] + ' debe marcarse como error');
    if(/[¡!]/.test(t)) fail('balance: exclamación en el aviso de ' + casos[i][0]);
    if(campo(1).value !== '60000') fail('balance: tras ' + casos[i][0] + ' el campo debe volver a 60000: ' + campo(1).value);
  }
  if(!/135\.000/.test($('#kpi-ingresos').textContent)) fail('balance: un error no debe cambiar el ingreso: ' + $('#kpi-ingresos').textContent);
  log.push('balance-flow(admin): rpcs=' + fx.balance.length);
};
