// Recorrido de humo de precios y costos (privilegios por columna, migración 20261116500000). Lo invoca harness.html tras
// stockFlow: await window.preciosFlow(w, d, sleep, fail, log, cliMode, secUser). Datos y emulación: privilegios.fixture.js.
//   * admin y perfil global: el stock muestra los precios de compra (vienen de neumaticos_precios, no del select).
//   * perfil de sucursal: no llama a neumaticos_precios ni a eventos_costos y ninguna pantalla muestra importes.
window.preciosFlow = async function(w, d, sleep, fail, log, cliMode, secUser){
  var fx = w.__preciosFx, $ = function(s){ return d.querySelector(s); };
  var rol = secUser ? 'sucursal' : (cliMode ? 'global' : 'admin');
  $('.nav-item[data-view="stock"]').click(); await sleep(500);
  var lista = $('#stk-lista').textContent;
  var llamadas = function(n){ return fx.rpcs.filter(function(r){ return r.name === n; }); };
  if(secUser){
    if(fx.rpcs.length) fail('precios(sucursal): el panel pidió precios o costos: ' + JSON.stringify(fx.rpcs));
    if(/455|410[,.]5/.test(lista)) fail('precios(sucursal): la lista de stock muestra precios: ' + lista.slice(0, 160));
  } else {
    var p = llamadas('neumaticos_precios');
    if(!p.length || !p.some(function(r){ return r.args && r.args.p_solo_stock === true; })) fail('precios(' + rol + '): el stock no pidió los precios de las cubiertas sin montar');
    if(!/455/.test(lista)) fail('precios(' + rol + '): falta el precio de la cubierta S-001 en la lista: ' + lista.slice(0, 160));
  }
  if(fx.violaciones.length) fail('precios(' + rol + '): select de columnas sin permiso: ' + fx.violaciones.join(' ; '));
  log.push('precios-flow(' + rol + '): rpcs=' + fx.rpcs.length);
};
