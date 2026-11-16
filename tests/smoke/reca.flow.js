// Recorrido de humo de Recauchutado (F10 PR 10). Lo invoca harness.html tras la lista de calidad, en admin, cliente y secuser.
//   * Administrador de empresa (cliente global): ve «Enviar a recauchutar» y las acciones de cada proceso y abre el modal.
//   * Equipo Neumet (admin): conserva la lista en solo lectura, sin ver acciones; las acciones con guarda
//     propia no abren el modal ni llaman a recauchutado_* (flota.fixture.js las registra en __flotaFx.rpcs).
//   * Usuario de sucursal: sin entrada en el menú.
window.recauchutadoFlow = async function(w, d, sleep, fail, log, cliMode, secuser){
  var $ = function(s){ return d.querySelector(s); }, all = function(s){ return Array.prototype.slice.call(d.querySelectorAll(s)); };
  var rol = !cliMode ? 'admin' : secuser ? 'sucursal' : 'cliente';
  var item = $('.nav-item[data-view="recauchutado"]');
  var visible = !!item && item.style.display !== 'none';
  var irA = async function(){
    var b = d.createElement('button'); b.type = 'button'; b.setAttribute('data-action', 'irA'); b.setAttribute('data-args', '["recauchutado"]');
    d.body.appendChild(b); b.click(); await sleep(700); b.remove();
  };
  if(rol === 'cliente'){
    if(!visible) { fail('reca(cliente): falta la entrada Recauchutado del administrador de empresa'); return; }
    item.click(); await sleep(700);
    if($('#btn-reca-enviar').style.display === 'none') fail('reca(cliente): falta «Enviar a recauchutar»');
    var acc = all('#reca-lista [data-action="recaAbrir"]');
    if(acc.length < 2) fail('reca(cliente): faltan las acciones por proceso (hay '+acc.length+')');
    if(acc.length){ acc[0].click(); await sleep(300); if(!$('#modal-reca').classList.contains('show')) fail('reca(cliente): la acción no abrió el modal'); $('#modal-reca [data-action="recaCerrar"]').click(); await sleep(200); }
    $('.nav-item[data-view="inicio"]').click(); await sleep(300);
    log.push('reca(cliente): acciones conservadas');
    return;
  }
  if(rol === 'sucursal'){ if(visible) fail('reca(sucursal): la entrada Recauchutado no es para este rol'); return; }
  // El equipo Neumet conserva la lista en solo lectura (menú de e2e/recorrido.mjs).
  if(!visible) fail('reca(admin): el equipo Neumet debe conservar la lista de Recauchutado');
  await irA();
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
