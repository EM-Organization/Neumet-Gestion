// Recorrido de humo del stock de cubiertas individuales (vista Stock y buscador global). Lo invoca harness.html:
// await window.stockFlow(w, d, sleep, fail, log, cliMode, secUser). Datos: stub.js (cubiertas S-001, S-002, S-010, S-011 del cliente 1 y
// Z-900 del cliente 2) y sucursales de seccionales.fixture.js; las RPC stock_cubierta_* las registra stock.fixture.js.
window.stockFlow = async function(w, d, sleep, fail, log, cliMode, secUser){
  var fx = w.__stockFx, $ = function(s){ return d.querySelector(s); }, all = function(s){ return Array.prototype.slice.call(d.querySelectorAll(s)); };
  var visible = function(el){ return !!el && el.getClientRects().length > 0; };
  var filas = function(){ return all('#stk-lista .stk-fila'); };
  var quemas = function(){ return filas().map(function(f){ return f.querySelector('.stk-quema').firstChild.textContent.trim(); }); };
  var rpcs = function(n){ return fx.rpcs.filter(function(r){ return r.name === n; }); };
  var set = function(id, v){ var el = $(id); el.value = v; el.dispatchEvent(new w.Event(el.tagName === 'SELECT' ? 'change' : 'input', {bubbles: true})); };
  var rol = secUser ? 'sucursal' : (cliMode ? 'global' : 'admin');
  var nav = function(v){ $('.nav-item[data-view="' + v + '"]').click(); };

  nav('stock'); await sleep(600);
  var esperadas = cliMode ? ['S-001', 'S-002', 'S-010', 'S-011'] : ['S-001', 'S-002', 'S-010', 'S-011', 'Z-900'];
  if(quemas().join() !== esperadas.join()) fail('stock(' + rol + '): cubiertas listadas: ' + quemas().join());
  if(!/Nuevo/.test($('#stk-lista').textContent) || !/Usado/.test($('#stk-lista').textContent) || !/Reparado/.test($('#stk-lista').textContent) || !/Recauchutado/.test($('#stk-lista').textContent)) fail('stock(' + rol + '): faltan las condiciones en la lista');
  if($('#stk-lista').innerHTML.indexOf('<Multi>') !== -1) fail('stock: HTML sin escapar en el modelo');
  if(!/X <Multi> Z/.test($('#stk-lista').textContent)) fail('stock: no muestra el modelo con signos');
  if(!/Sin sucursal/.test($('#stk-lista').textContent) || !/Montevideo/.test($('#stk-lista').textContent)) fail('stock: ubicaciones');
  if(!/^\d+ cubiertas · /.test($('#stk-resumen').textContent)) fail('stock: resumen: ' + $('#stk-resumen').textContent);
  // Sin segunda persona, exclamaciones ni «Todavía» en la vista
  if(/[¡!]|\bTodavía\b|\bacá\b/.test($('#view-stock').textContent)) fail('stock: texto fuera de la guía');

  // Perfil de sucursal: no ve el alta ni las acciones
  if(secUser){
    if(visible($('#btn-cubierta-nueva'))) fail('stock(sucursal): ve «Agregar cubierta»');
    if(all('#stk-lista [data-action^="cubierta"]').length) fail('stock(sucursal): ve acciones sobre cubiertas');
    log.push('stock-flow(sucursal): ok');
    return;
  }
  if(!visible($('#btn-cubierta-nueva'))) fail('stock(' + rol + '): falta «Agregar cubierta»');
  if(rol === 'global' && visible($('#filter-cliente-stock'))) fail('stock(global): ve el filtro de cliente');
  if(rol === 'admin' && !visible($('#filter-cliente-stock'))) fail('stock(admin): falta el filtro de cliente');

  // Filtros: sucursal, condición, búsqueda por quema
  set('#filter-sucursal-stock', 'ninguna'); await sleep(100);
  var sin = cliMode ? ['S-002'] : ['S-002', 'Z-900'];
  if(quemas().join() !== sin.join()) fail('stock: filtro «Sin sucursal»: ' + quemas().join());
  set('#filter-sucursal-stock', ''); set('#filter-condicion-stock', 'reparado'); await sleep(100);
  if(quemas().join() !== 'S-010') fail('stock: filtro de condición: ' + quemas().join());
  set('#filter-condicion-stock', ''); set('#search-stock', 's001'); await sleep(100);
  if(quemas().join() !== 'S-001') fail('stock: búsqueda por quema sin guion: ' + quemas().join());
  set('#search-stock', 'nada que coincida'); await sleep(100);
  if(filas().length || !/Ninguna cubierta coincide/.test($('#stk-lista').textContent) || !/Cambiar la búsqueda o el filtro/.test($('#stk-lista').textContent)) fail('stock: estado vacío del filtro');
  set('#search-stock', ''); await sleep(100);
  if(!cliMode){
    set('#filter-cliente-stock', '2'); await sleep(100);
    if(quemas().join() !== 'Z-900') fail('stock(admin): filtro de cliente: ' + quemas().join());
    set('#filter-cliente-stock', ''); await sleep(100);
  }

  // Agregar cubierta: validación local, error de la base y éxito
  $('#btn-cubierta-nueva').click(); await sleep(300);
  if(!$('#modal-cubierta').classList.contains('show')) { fail('stock: el modal de alta no se abrió'); return; }
  if(visible($('#cb-cliente-wrap')) !== !cliMode) fail('stock: el selector de cliente solo es para el admin');
  if(visible($('#cb-condicion-wrap'))) fail('stock: el alta no ofrece condición (nace «Nuevo»)');
  if(!visible($('#cb-sucursal-wrap'))) fail('stock: falta la sucursal en el alta');
  var opcionesSuc = all('#cb-sucursal option').map(function(o){ return o.textContent; });
  if(opcionesSuc[0] !== 'Sin sucursal' || opcionesSuc.indexOf('Montevideo') === -1 || opcionesSuc.indexOf('Ajena') !== -1) fail('stock: sucursales del alta: ' + opcionesSuc.join('|'));
  var antes = rpcs('stock_cubierta_agregar').length;
  $('#cb-guardar').click(); await sleep(200);
  if(rpcs('stock_cubierta_agregar').length !== antes || !/número de quema/.test($('#cb-error').textContent)) fail('stock: quema vacía llegó a la RPC: ' + $('#cb-error').textContent);
  $('#cb-quema').value = ' S-100 '; $('#cb-guardar').click(); await sleep(200);
  if(rpcs('stock_cubierta_agregar').length !== antes || !/marca/.test($('#cb-error').textContent)) fail('stock: marca vacía llegó a la RPC');
  $('#cb-marca').value = 'Pirelli'; $('#cb-precio').value = '-3'; $('#cb-guardar').click(); await sleep(200);
  if(rpcs('stock_cubierta_agregar').length !== antes) fail('stock: precio negativo llegó a la RPC');
  $('#cb-precio').value = '';
  var ce = w.console.error; w.console.error = function(){};
  fx.rpcError = {code: '23505', message: 'el número de quema ya está registrado en otro neumático'};
  $('#cb-guardar').click(); await sleep(300);
  w.console.error = ce; fx.rpcError = null;
  if(rpcs('stock_cubierta_agregar').length !== antes + 1) fail('stock: el intento con quema repetida no llamó a la RPC');
  if(!/Ese número de quema ya está registrado/.test($('#cb-error').textContent) || !$('#modal-cubierta').classList.contains('show')) fail('stock: quema repetida sin mensaje o modal cerrado');
  if($('#cb-guardar').disabled) fail('stock: botón bloqueado tras el error');
  $('#cb-modelo').value = 'FH88'; $('#cb-fecha').value = '2026-05-01'; $('#cb-precio').value = '390.5'; $('#cb-sucursal').value = '1';
  if(!cliMode) $('#cb-cliente').value = '1';
  $('#cb-guardar').click(); await sleep(400);
  var alta = rpcs('stock_cubierta_agregar'), a = alta[alta.length - 1].args;
  var esperado = {p_numero_quema: 'S-100', p_marca: 'Pirelli', p_modelo: 'FH88', p_fecha_compra: '2026-05-01', p_precio: 390.5, p_sucursal_id: 1};
  if(!cliMode) esperado.p_cliente_id = 1;
  if(JSON.stringify(a) !== JSON.stringify(esperado)) fail('stock: args de stock_cubierta_agregar: ' + JSON.stringify(a));
  if($('#modal-cubierta').classList.contains('show')) fail('stock: el modal no se cerró tras guardar');
  if($('#toast-msg').textContent !== 'Cubierta agregada') fail('stock: aviso de alta: ' + $('#toast-msg').textContent);

  // Editar: la quema no se edita; solo se envía lo que cambió; la condición solo admite Reparado o Recauchutado
  d.querySelector('[data-cubierta="31"] [data-action="cubiertaEditar"]').click(); await sleep(300);
  if(!$('#cb-quema').disabled || $('#cb-quema').value !== 'S-001') fail('stock: la quema debe verse y no editarse');
  if(visible($('#cb-sucursal-wrap')) || !visible($('#cb-condicion-wrap'))) fail('stock: edición: sucursal oculta y condición visible');
  var cond = all('#cb-condicion option').map(function(o){ return o.textContent; });
  if(cond.join('|') !== 'Nuevo (actual)|Reparado|Recauchutado') fail('stock: opciones de condición: ' + cond.join('|'));
  $('#cb-guardar').click(); await sleep(200);
  if(!/No hay cambios/.test($('#cb-error').textContent) || rpcs('stock_cubierta_editar').length) fail('stock: guardar sin cambios llegó a la RPC');
  $('#cb-condicion').value = 'reparado'; $('#cb-marca').value = ' Michelin XZ '; $('#cb-guardar').click(); await sleep(400);
  var ed = rpcs('stock_cubierta_editar');
  if(ed.length !== 1 || JSON.stringify(ed[0].args) !== JSON.stringify({p_id: 31, p_datos: {marca: 'Michelin XZ', condicion: 'reparado'}})) fail('stock: args de stock_cubierta_editar: ' + JSON.stringify(ed.map(function(e){ return e.args; })));
  if($('#modal-cubierta').classList.contains('show')) fail('stock: el modal de edición no se cerró');

  // Mover: destino distinto; mismo destino no llama a la RPC
  d.querySelector('[data-cubierta="31"] [data-action="cubiertaMover"]').click(); await sleep(300);
  if(!$('#modal-cubierta-mover').classList.contains('show')) { fail('stock: el modal de traslado no se abrió'); return; }
  if(!/Quema S-001/.test($('#cubierta-mover-sub').textContent) || !/Montevideo/.test($('#cubierta-mover-sub').textContent)) fail('stock: subtítulo del traslado: ' + $('#cubierta-mover-sub').textContent);
  $('#cbm-guardar').click(); await sleep(200);
  if(rpcs('stock_cubierta_mover').length || !/ya está en esa ubicación/.test($('#cbm-error').textContent)) fail('stock: traslado al mismo lugar llegó a la RPC');
  $('#cbm-sucursal').value = ''; $('#cbm-guardar').click(); await sleep(400);
  var mv = rpcs('stock_cubierta_mover');
  if(mv.length !== 1 || JSON.stringify(mv[0].args) !== JSON.stringify({p_id: 31, p_sucursal_id: null})) fail('stock: args de stock_cubierta_mover: ' + JSON.stringify(mv.map(function(e){ return e.args; })));
  if($('#modal-cubierta-mover').classList.contains('show')) fail('stock: el modal de traslado no se cerró');

  // Eliminar: pide confirmación; con error de la base muestra el mensaje
  d.querySelector('[data-cubierta="32"] [data-action="cubiertaEliminar"]').click(); await sleep(200);
  if(!$('#modal-confirm').classList.contains('show') || !/S-002/.test($('#confirm-msg').textContent)) fail('stock: falta la confirmación para eliminar');
  $('#confirm-cancel').click(); await sleep(100);
  if(rpcs('stock_cubierta_eliminar').length) fail('stock: eliminó sin confirmar');
  var ce3 = w.console.error; w.console.error = function(){};
  fx.rpcError = {code: '55000', message: 'la cubierta ya tuvo uso (montajes, mediciones o eventos): no se puede eliminar'};
  d.querySelector('[data-cubierta="32"] [data-action="cubiertaEliminar"]').click(); await sleep(200);
  $('#confirm-ok').click(); await sleep(300);
  w.console.error = ce3; fx.rpcError = null;
  if(!/ya tuvo uso/.test($('#toast-msg').textContent)) fail('stock: error de eliminación sin traducir: ' + $('#toast-msg').textContent);
  d.querySelector('[data-cubierta="32"] [data-action="cubiertaEliminar"]').click(); await sleep(200);
  $('#confirm-ok').click(); await sleep(400);
  var el = rpcs('stock_cubierta_eliminar');
  if(el.length !== 2 || el[1].args.p_id !== 32) fail('stock: args de stock_cubierta_eliminar: ' + JSON.stringify(el.map(function(e){ return e.args; })));

  // Buscador global: una quema en stock lo encuentra y abre Stock filtrado
  nav('inicio'); await sleep(400);
  var inp = $('#view-inicio.active #busq-inicio-input') || $('#busq-global-input');
  inp.value = 's-010'; inp.dispatchEvent(new w.Event('input', {bubbles: true})); await sleep(700);
  var op = all('.busq-resultados .busq-op').filter(function(b){ return /Quema S-010/.test(b.textContent); })[0];
  if(!op) { fail('buscador: no encontró la cubierta S-010 en stock: ' + all('.busq-resultados').map(function(u){ return u.textContent; }).join('|')); return; }
  if(!/En stock/.test(op.textContent) || !/Reparado/.test(op.textContent) || !/Salto/.test(op.textContent)) fail('buscador: detalle de la cubierta: ' + op.textContent);
  op.click(); await sleep(700);
  if(!$('#view-stock').classList.contains('active')) fail('buscador: no abrió Stock');
  if($('#search-stock').value !== 'S-010' || quemas().join() !== 'S-010') fail('buscador: Stock no quedó filtrado por la quema: ' + $('#search-stock').value + ' / ' + quemas().join());
  // Enter con una única coincidencia abre Stock directamente
  nav('inicio'); await sleep(300);
  var inp2 = $('#view-inicio.active #busq-inicio-input') || $('#busq-global-input');
  inp2.value = 'S-011'; inp2.dispatchEvent(new w.Event('input', {bubbles: true})); await sleep(500);
  inp2.form.dispatchEvent(new w.Event('submit', {bubbles: true, cancelable: true})); await sleep(700);
  if(!$('#view-stock').classList.contains('active') || quemas().join() !== 'S-011') fail('buscador: Enter no abrió Stock filtrado: ' + quemas().join());
  set('#search-stock', ''); await sleep(100);
  log.push('stock-flow(' + rol + '): altas=' + rpcs('stock_cubierta_agregar').length + ' ediciones=' + ed.length + ' traslados=' + mv.length + ' bajas=' + el.length);
};
