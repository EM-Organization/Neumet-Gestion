// Recorrido de humo de Recauchutado (F10 PR 10). Lo invoca harness.html tras la lista de calidad, en admin, cliente y secuser.
//   * Administrador de empresa (cliente global): ve «Enviar a recauchutar» y las acciones de cada proceso y abre el modal.
//   * Equipo Neumet (admin): conserva la lista en solo lectura, sin ver acciones; las acciones con guarda
//     propia no abren el modal ni llaman a recauchutado_* (flota.fixture.js las registra en __flotaFx.rpcs).
//   * Usuario de sucursal: sin pestaña Recauchutado (Neumáticos muestra solo Stock, sin tablist).
// Menú: «Neumáticos» une Stock y Recauchutado como pestañas; ya no hay ítem de menú Recauchutado.
window.recauchutadoFlow = async function(w, d, sleep, fail, log, cliMode, secuser){
  var $ = function(s){ return d.querySelector(s); }, all = function(s){ return Array.prototype.slice.call(d.querySelectorAll(s)); };
  var rol = !cliMode ? 'admin' : secuser ? 'sucursal' : 'cliente';
  var esVisible = function(el){ return !!el && el.getClientRects().length > 0; };
  if($('.nav-item[data-view="recauchutado"]')) fail('reca('+rol+'): sigue el ítem de menú Recauchutado');
  var irA = async function(){
    var b = d.createElement('button'); b.type = 'button'; b.setAttribute('data-action', 'irA'); b.setAttribute('data-args', '["recauchutado"]');
    d.body.appendChild(b); b.click(); await sleep(700); b.remove();
  };
  // Pestañas (a11y y rol): se miran desde Neumáticos > Stock.
  $('.nav-item[data-view="stock"]').click(); await sleep(600);
  if($('.nav-item[data-view="stock"]').textContent.trim() !== 'Neumáticos') fail('reca('+rol+'): el ítem de menú no se llama Neumáticos');
  var tablist = $('#view-stock [role="tablist"]'), tabReca = $('#view-stock [data-neu-tab="recauchutado"]'), tabStock = $('#view-stock [data-neu-tab="stock"]');
  var visible = esVisible(tabReca);
  if(tablist.getAttribute('aria-label') !== 'Neumáticos' || tabStock.getAttribute('aria-selected') !== 'true' || tabStock.tabIndex !== 0 || tabReca.getAttribute('aria-selected') !== 'false' || tabReca.tabIndex !== -1) fail('reca('+rol+'): atributos ARIA de las pestañas');
  if(all('#view-stock [role="tab"]').some(function(t){ var p = d.getElementById(t.getAttribute('aria-controls')); return !p || p.getAttribute('role') !== 'tabpanel'; })) fail('reca('+rol+'): una pestaña no apunta a un tabpanel');
  if(rol === 'sucursal'){
    if(visible || esVisible(tablist)) fail('reca(sucursal): ve la pestaña Recauchutado o un tablist de una sola pestaña');
    var f0 = d.createElement('button'); f0.type = 'button'; f0.setAttribute('data-action', 'irA'); f0.setAttribute('data-args', '["recauchutado"]'); d.body.appendChild(f0); f0.click(); await sleep(500); f0.remove();
    if(!$('#view-stock').classList.contains('active') || $('#view-recauchutado').classList.contains('active')) fail('reca(sucursal): irA(recauchutado) no redirigió a Stock');
    log.push('reca(sucursal): sin pestaña');
    $('.nav-item[data-view="inicio"]').click(); await sleep(300);
    return;
  }
  if(!visible) { fail('reca('+rol+'): falta la pestaña Recauchutado'); return; }
  // Teclado: flecha derecha en Stock pasa a Recauchutado (foco en la pestaña activa) y flecha izquierda vuelve.
  tabStock.focus();
  tabStock.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await sleep(700);
  if(!$('#view-recauchutado').classList.contains('active') || $('.nav-item.active').dataset.view !== 'stock') fail('reca('+rol+'): ArrowRight no abrió Recauchutado con Neumáticos resaltado');
  var tr = $('#view-recauchutado [data-neu-tab="recauchutado"]');
  if(d.activeElement !== tr || tr.getAttribute('aria-selected') !== 'true') fail('reca('+rol+'): el foco no pasó a la pestaña Recauchutado');
  if($('#breadcrumb-current').textContent !== 'Recauchutado' || $('#breadcrumb-parent').textContent !== 'Neumáticos') fail('reca('+rol+'): migas '+$('#breadcrumb-parent').textContent+' > '+$('#breadcrumb-current').textContent);
  tr.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); await sleep(700);
  if(!$('#view-stock').classList.contains('active')) fail('reca('+rol+'): ArrowLeft no volvió a Stock');
  // Clic: una sola pestaña a Recauchutado y una de vuelta
  $('#view-stock [data-neu-tab="recauchutado"]').click(); await sleep(700);
  if(!$('#view-recauchutado').classList.contains('active')) fail('reca('+rol+'): el clic en la pestaña no abrió Recauchutado');
  if(d.activeElement !== $('#view-recauchutado [data-neu-tab="recauchutado"]')) fail('reca('+rol+'): tras el clic el foco no quedó en la pestaña activa');
  $('#view-recauchutado [data-neu-tab="stock"]').click(); await sleep(700);
  if(!$('#view-stock').classList.contains('active')) fail('reca('+rol+'): el clic en Stock no volvió');
  await irA(); // Recauchutado queda abierto para lo que sigue
  if(rol === 'cliente'){
    if($('#btn-reca-enviar').style.display === 'none') fail('reca(cliente): falta «Enviar a recauchutar»');
    var acc = all('#reca-lista [data-action="recaAbrir"]');
    if(acc.length < 2) fail('reca(cliente): faltan las acciones por proceso (hay '+acc.length+')');
    if(acc.length){ acc[0].click(); await sleep(300); if(!$('#modal-reca').classList.contains('show')) fail('reca(cliente): la acción no abrió el modal'); $('#modal-reca [data-action="recaCerrar"]').click(); await sleep(200); }
    $('.nav-item[data-view="inicio"]').click(); await sleep(300);
    log.push('reca(cliente): acciones conservadas');
    return;
  }
  // El equipo Neumet conserva la lista en solo lectura (pestaña Recauchutado).
  if($('#btn-reca-enviar').style.display !== 'none') fail('reca(admin): ofrece «Enviar a recauchutar» al equipo Neumet');
  if(all('#reca-lista [data-action="recaAbrir"]').length) fail('reca(admin): ofrece acciones por proceso al equipo Neumet');
  var falsos = [['recaEnviar', '[]'], ['recaAbrir', '["dictamen",2]'], ['recaAbrir', '["aceptar",3]'], ['recaGuardar', '[]']];
  for(var i = 0; i < falsos.length; i++){
    var f = d.createElement('button'); f.type = 'button'; f.setAttribute('data-action', falsos[i][0]); f.setAttribute('data-args', falsos[i][1]);
    d.body.appendChild(f); f.click(); await sleep(300); f.remove();
    if($('#modal-reca').classList.contains('show')) fail('reca(admin): '+falsos[i][0]+' abrió el modal para el equipo Neumet');
  }
  var esc = ((w.__flotaFx && w.__flotaFx.rpcs) || []).filter(function(r){ return /^recauchutado_/.test(r[0]); });
  if(esc.length) fail('reca(admin): el equipo Neumet llamó RPC de escritura: '+JSON.stringify(esc));
  $('.nav-item[data-view="inicio"]').click(); await sleep(300);
  log.push('reca(admin): solo lectura');
};
