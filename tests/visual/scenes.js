// Escenas de QA visual: dejan una vista concreta en pantalla (con el stub de tests/smoke) para que Chrome la fotografíe.
// Las invoca tests/smoke/harness.html con ?shot=<escena>. Una escena = una captura. No hace aserciones: solo prepara la pantalla.
// Los errores de consola / recursos que ocurran mientras tanto igual hacen fallar el título (SMOKE:FAIL).
window.visualScene = async function(name, w, d, sleep, fail, log){
  var $ = function(s){ return d.querySelector(s); };
  var nav = function(v){ var b = $('.nav-item[data-view="'+v+'"]'); if(!b) fail('escena '+name+': no existe nav '+v); else b.click(); };
  var click = function(s){ var b = $(s); if(!b) fail('escena '+name+': no existe '+s); else b.click(); };
  var escribir = function(v){ var i = $('#search-vehiculos'); i.value = v; i.dispatchEvent(new w.Event('input',{bubbles:true})); return i; };
  var abrirDetalle = async function(){
    nav('vehiculos'); await sleep(600);
    var i = escribir('AB123CD'); await sleep(150);
    i.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})); await sleep(1000);
  };
  // Coche 301 sin neumáticos (montar.fixture.js: ?montar=1)
  var abrirVacio = async function(){
    nav('vehiculos'); await sleep(600);
    var i = escribir('301'); await sleep(150);
    i.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})); await sleep(1000);
  };
  var abrirMontar = async function(){ await abrirVacio(); click('#vd-resumen [data-action="neumatico-montar"]'); await sleep(900); };
  var rueda3 = function(){ var r = $('#vd-diagrama .vd-rueda[data-pos="3"]'); if(r) r.dispatchEvent(new w.MouseEvent('click',{bubbles:true})); else fail('escena '+name+': sin rueda 3'); };

  var escenas = {
    'login': async function(){ /* la sesión se anula con ?nosession=1 */ },
    'sin-acceso': async function(){ if(!$('#sin-acceso-screen') || $('#sin-acceso-screen').classList.contains('hidden')) fail('escena '+name+': no se ve Sin acceso'); },
    'inicio': async function(){ nav('inicio'); await sleep(800); },
    'ultimas-mediciones': async function(){ nav('inicio'); await sleep(800); var h = $('#inicio-h-ultimas'); if(h) h.scrollIntoView(); else fail('escena '+name+': sin el bloque Últimas mediciones'); await sleep(300); },
    'ciclo-vida': async function(){ nav('vehiculos'); await sleep(600); click('#tbody-vehiculos [data-va="neum"]'); await sleep(600); click('[data-action="cicloDesdeNeum"]'); await sleep(900); var k = $('#ciclo-km'); if(k) k.scrollIntoView(); await sleep(300); },
    'ciclo-costo': async function(){ nav('vehiculos'); await sleep(600); click('#tbody-vehiculos [data-va="neum"]'); await sleep(600); click('[data-action="cicloDesdeNeum"]'); await sleep(900); var k = $('#ciclo-costo'); if(k) k.scrollIntoView(); await sleep(300); },
    'vehiculos': async function(){ nav('vehiculos'); await sleep(700); },
    'vehiculos-busqueda': async function(){ nav('vehiculos'); await sleep(600); escribir('7'); await sleep(300); },
    'detalle': async function(){ await abrirDetalle(); },
    'detalle-rueda': async function(){ await abrirDetalle(); rueda3(); await sleep(900); },
    'detalle-vacio': async function(){ await abrirVacio(); },
    'detalle-vacio-rueda': async function(){ await abrirVacio(); var r = $('#vd-diagrama .vd-rueda[data-pos="4"]'); if(r) r.dispatchEvent(new w.MouseEvent('click',{bubbles:true})); else fail('escena '+name+': sin rueda 4'); await sleep(700); },
    'montar-neumatico': async function(){ await abrirMontar(); },
    'montar-nueva': async function(){ await abrirMontar(); click('#mont-tab-nuevo'); await sleep(300); },
    'montar-siguiente': async function(){ await abrirMontar(); click('input[name="mont-cubierta"]'); await sleep(200); click('#mont-confirmar'); await sleep(900); click('#mont-tab-nuevo'); await sleep(300); },
    'retirar-neumatico': async function(){ await abrirMontar(); click('input[name="mont-cubierta"]'); await sleep(200); click('#mont-confirmar'); await sleep(900); click('#mont-cerrar'); await sleep(600); var r = $('#vd-diagrama .vd-rueda[data-pos="1"]'); if(r) r.dispatchEvent(new w.MouseEvent('click',{bubbles:true})); await sleep(500); click('#vd-panel [data-action="neumatico-retirar"]'); await sleep(900); },
    'detalle-rueda-km': async function(){ await abrirDetalle(); var r = $('#vd-diagrama .vd-rueda[data-pos="6"]'); if(r) r.dispatchEvent(new w.MouseEvent('click',{bubbles:true})); else fail('escena '+name+': sin rueda 6'); await sleep(900); },
    'detalle-rueda-costo': async function(){ await abrirDetalle(); var r = $('#vd-diagrama .vd-rueda[data-pos="3"]'); if(r) r.dispatchEvent(new w.MouseEvent('click',{bubbles:true})); else fail('escena '+name+': sin rueda 6'); await sleep(900); },
    'cambio-neumatico': async function(){ await abrirDetalle(); rueda3(); await sleep(600); click('#vd-panel [data-action="neumatico-cambiar"]'); await sleep(900); },
    'cambio-cubierta': async function(){ await abrirDetalle(); rueda3(); await sleep(600); click('#vd-panel [data-action="neumatico-cambiar"]'); await sleep(900); $('#cambio-confirmar').scrollIntoView(); },
    'cambio-almacenar': async function(){ await abrirDetalle(); rueda3(); await sleep(600); click('#vd-panel [data-action="neumatico-cambiar"]'); await sleep(900); click('input[name="cambio-destino"][value="almacenado"]'); await sleep(300); $('#cambio-retorno-wrap').scrollIntoView(); },
    'stock-alta': async function(){ nav('stock'); await sleep(800); click('#btn-cubierta-nueva'); await sleep(500); },
    'confirmar-intercambio': async function(){ await abrirDetalle(); rueda3(); await sleep(700); var sel = $('#vd-rotar-destino'); var br = $('#vd-panel [data-action="neumatico-rotar-pos"]'); if(!sel || !br){ fail('escena '+name+': sin selector de rotar'); return; } sel.value = '1'; sel.dispatchEvent(new w.Event('change',{bubbles:true})); br.click(); await sleep(500); },
    'confirmar-eliminar': async function(){ nav('clientes'); await sleep(800); click('#tbody-clientes button[data-a="del"]'); await sleep(500); },
    'stock-mover': async function(){ nav('stock'); await sleep(800); click('[data-cubierta="31"] [data-action="cubiertaMover"]'); await sleep(500); },
    'stock-busqueda': async function(){ nav('inicio'); await sleep(600); var i = $('#view-inicio.active #busq-inicio-input') || $('#busq-global-input'); i.value = 's-0'; i.dispatchEvent(new w.Event('input',{bubbles:true})); await sleep(700); },
    'alertas': async function(){ nav('alertas'); await sleep(800); },
    'flota': async function(){ nav('flota'); await sleep(800); },
    'dispositivos': async function(){ nav('dispositivos'); await sleep(800); },
    'reportes': async function(){ nav('reportes'); await sleep(800); },
    'reportes-cpk': async function(){ nav('reportes'); await sleep(900); var c = $('#rep-cpk-card'); if(!c || c.hidden) fail('escena '+name+': sin Costo por km'); else c.scrollIntoView(); await sleep(300); },
    'mediciones': async function(){ nav('mediciones'); await sleep(800); },
    'clientes': async function(){ nav('clientes'); await sleep(800); },
    'ficha': async function(){ nav('clientes'); await sleep(800); click('#tbody-clientes [data-action="abrirFichaCliente"]'); await sleep(900); },
    'stock': async function(){ nav('stock'); await sleep(800); },
    'busqueda': async function(){ var i = $('#view-inicio.active #busq-inicio-input') || $('#busq-global-input'); i.value = 'cam'; i.dispatchEvent(new w.Event('input',{bubbles:true})); await sleep(700); },
    'selector-seccional': async function(){ nav('flota'); await sleep(800); }
  };
  if(!escenas[name]){ fail('escena desconocida: '+name); return; }
  await escenas[name]();
  await sleep(300);
  var nv = $('.nav-item.active'), vw = $('.view.active');
  log.push('escena='+name+' nav='+(nv ? nv.dataset.view : '-')+' vista='+(vw ? vw.id : '-'));
  var colgadas = {'view-vehiculo-detalle':'vehiculos','view-ficha':'clientes'};
  if(nv && vw && (colgadas[vw.id] ? colgadas[vw.id] !== nv.dataset.view : vw.id !== 'view-'+nv.dataset.view)) fail('escena '+name+': el menu resalta "'+nv.dataset.view+'" pero la vista activa es '+vw.id);
};
