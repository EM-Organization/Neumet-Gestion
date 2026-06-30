const createClient = window.supabase.createClient;

const SUPABASE_URL = 'https://dqgrlflrjcarxlfetvoj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxZ3JsZmxyamNhcnhsZmV0dm9qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNzE4MzIsImV4cCI6MjA5Mzc0NzgzMn0.i9wnVq_OmBuGtzEEyi_ix-upDpFe4T1clO7mOUnp4_E';

const db = createClient(SUPABASE_URL, SUPABASE_KEY);
let clients = [], modalMode = 'create', activeId = null;

const AVATARS = ['av-1','av-2','av-3','av-4','av-5','av-6'];
const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const avatarFor = id => AVATARS[Math.abs(id) % AVATARS.length];
function relDate(d){
  const s=(Date.now()-new Date(d).getTime())/1000;
  if(s<60)return'hace un momento';
  if(s<3600)return`hace ${Math.floor(s/60)} min`;
  if(s<86400)return`hace ${Math.floor(s/3600)} h`;
  if(s<604800)return`hace ${Math.floor(s/86400)} d`;
  return new Date(d).toLocaleDateString();
}

function setStatus(ok,msg){
  document.getElementById('status-text').textContent=msg;
  document.getElementById('status-pill').classList.toggle('disconnected',!ok);
  const dot=document.querySelector('.status-dot');
  if(dot) dot.style.background=ok?'#34c759':'var(--danger)';
}

function showToast(msg,err=false){
  const t=document.getElementById('toast');
  document.getElementById('toast-msg').textContent=msg;
  t.classList.toggle('error',err);
  t.classList.add('show');
  clearTimeout(window._tt);
  window._tt=setTimeout(()=>t.classList.remove('show'),3000);
}

// ── MODO CLIENTE ─────────────────────────────────
// null = admin (ve todo), número = cliente (ve solo lo suyo)
let currentClienteId=null, currentClienteNombre='';

function isClienteMode(){ return currentClienteId!==null; }

function applyClienteMode(){
  // Ocultar elementos admin-only
  document.querySelectorAll('[data-admin-only]').forEach(el=>{ el.style.display='none'; });
  // Mostrar elementos cliente-only
  document.querySelectorAll('[data-cliente-only]').forEach(el=>{ el.style.display=''; });
  // Badge dispositivos no aplica a clientes
  document.getElementById('nav-unreg-badge').style.display='none';
  // Mostrar nombre del cliente en el sidebar
  document.getElementById('user-email').textContent=currentClienteNombre||'Cliente';
  document.getElementById('user-role').textContent='Cliente';
}

// AUTH — detecta rol
async function checkAuth(){
  const {data:{session}}=await db.auth.getSession();
  if(!session){ showLogin(); return; }
  const {data:clienteRow}=await db.from('clientes').select('id,nombre').eq('auth_user_id',session.user.id).maybeSingle();
  if(clienteRow){
    currentClienteId=clienteRow.id;
    currentClienteNombre=clienteRow.nombre;
  }
  showApp(session.user);
}

function showLogin(){
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}
function showApp(user){
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('user-email').textContent=user.email;
  document.getElementById('user-avatar').textContent=user.email[0].toUpperCase();
  if(isClienteMode()){
    applyClienteMode();
    switchView('dashboard');
  } else {
    loadClients();
    db.rpc('get_unregistered_devices').then(({data})=>{
      if(data&&data.length){
        const badge=document.getElementById('nav-unreg-badge');
        badge.textContent=data.length; badge.style.display='';
      }
    });
  }
}

document.getElementById('login-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const email=document.getElementById('login-email').value.trim();
  const pass=document.getElementById('login-password').value;
  const btn=document.getElementById('login-btn');
  const err=document.getElementById('login-error');
  btn.disabled=true; btn.textContent='Iniciando...'; err.classList.remove('show');
  const {data,error}=await db.auth.signInWithPassword({email,password:pass});
  btn.disabled=false; btn.textContent='Iniciar sesión';
  if(error){
    err.textContent=error.message==='Invalid login credentials'?'Email o contraseña incorrectos':error.message;
    err.classList.add('show'); return;
  }
  const {data:clienteRow}=await db.from('clientes').select('id,nombre').eq('auth_user_id',data.user.id).maybeSingle();
  if(clienteRow){
    currentClienteId=clienteRow.id;
    currentClienteNombre=clienteRow.nombre;
  } else {
    currentClienteId=null; currentClienteNombre='';
  }
  showApp(data.user);
});

document.getElementById('logout-btn').addEventListener('click',async()=>{
  await db.auth.signOut();
  clients=[]; currentClienteId=null; currentClienteNombre='';
  // Restaurar visibilidad original
  document.querySelectorAll('[data-admin-only]').forEach(el=>{ el.style.display=''; });
  document.querySelectorAll('[data-cliente-only]').forEach(el=>{ el.style.display='none'; });
  document.getElementById('user-role').textContent='Administrador';
  showLogin();
});
db.auth.onAuthStateChange(ev=>{ if(ev==='SIGNED_OUT') showLogin(); });

// ── MOBILE SIDEBAR ──
const menuToggle=document.getElementById('menu-toggle');
const sidebarEl=document.querySelector('.sidebar');
const overlayEl=document.getElementById('sidebar-overlay');
function closeSidebar(){ sidebarEl.classList.remove('open'); overlayEl.classList.remove('show'); }
menuToggle.addEventListener('click',()=>{ sidebarEl.classList.toggle('open'); overlayEl.classList.toggle('show'); });
overlayEl.addEventListener('click', closeSidebar);

// ── CONFIRM MODAL ──
function confirmDialog(title, msg){
  return new Promise(resolve=>{
    document.getElementById('confirm-title').textContent=title;
    document.getElementById('confirm-msg').textContent=msg;
    const backdrop=document.getElementById('modal-confirm');
    backdrop.classList.add('show');
    const ok=document.getElementById('confirm-ok');
    const cancel=document.getElementById('confirm-cancel');
    const cleanup=(val)=>{
      backdrop.classList.remove('show');
      ok.replaceWith(ok.cloneNode(true));
      cancel.replaceWith(cancel.cloneNode(true));
      resolve(val);
    };
    document.getElementById('confirm-ok').addEventListener('click',()=>cleanup(true),{once:true});
    document.getElementById('confirm-cancel').addEventListener('click',()=>cleanup(false),{once:true});
  });
}

// ── DASHBOARD CLIENTE ────────────────────────────────────────
async function loadDashboard(){
  if(!isClienteMode()) return;

  const today=new Date().toLocaleDateString('es-AR',{day:'numeric',month:'long',year:'numeric'});
  document.getElementById('dash-title').textContent=`Hola, ${currentClienteNombre}`;
  document.getElementById('dash-subtitle').textContent=`Tu resumen al ${today}`;

  // Queries en paralelo
  const [
    {count:vehCount},
    {count:dispCount},
    {count:medCount},
    {data:vehicles},
    {data:allMed}
  ] = await Promise.all([
    db.from('vehiculos').select('*',{count:'exact',head:true}).eq('cliente_id',currentClienteId).eq('activo',true),
    db.from('dispositivos').select('*',{count:'exact',head:true}).eq('cliente_id',currentClienteId),
    db.from('mediciones').select('*',{count:'exact',head:true}).eq('cliente_id',currentClienteId),
    db.from('vehiculos').select('id,nombre,patente,tipo_ruedas').eq('cliente_id',currentClienteId).eq('activo',true).order('nombre'),
    db.from('mediciones').select('vehiculo_id,posicion,mm1,mm2,mm3,created_at,vehiculos(nombre)')
      .eq('cliente_id',currentClienteId).order('created_at',{ascending:false}).limit(600)
  ]);

  document.getElementById('dash-stat-vehs').textContent = vehCount??0;
  document.getElementById('dash-stat-disps').textContent = dispCount??0;
  document.getElementById('dash-stat-meds').textContent = (medCount??0).toLocaleString('es-AR');

  // Último dato por vehículo+posición
  const latestMap={};
  (allMed||[]).forEach(m=>{
    const k=`${m.vehiculo_id}_${m.posicion}`;
    if(!latestMap[k]) latestMap[k]=m;
  });
  const latestList=Object.values(latestMap);

  function tireStatus(m){
    const vals=[m.mm1,m.mm2,m.mm3].filter(v=>v!=null);
    if(!vals.length) return null;
    const avg=vals.reduce((a,b)=>a+b,0)/vals.length;
    return avg<5?'critico':avg<8?'bajo':'ok';
  }

  const criticos=latestList.filter(m=>tireStatus(m)==='critico');
  document.getElementById('dash-stat-criticos').textContent=criticos.length;
  document.getElementById('dash-kpi-criticos').classList.toggle('alert',criticos.length>0);

  // ── Flota ──
  const fleetGrid=document.getElementById('dash-fleet-grid');
  const vehs=vehicles||[];
  if(!vehs.length){
    fleetGrid.innerHTML='<div class="dash-empty" style="grid-column:1/-1">No hay vehículos activos.</div>';
  } else {
    fleetGrid.innerHTML=vehs.map(v=>{
      const tiresV=latestList.filter(m=>m.vehiculo_id===v.id);
      const total=v.tipo_ruedas||10;
      const ok=tiresV.filter(m=>tireStatus(m)==='ok').length;
      const bajo=tiresV.filter(m=>tireStatus(m)==='bajo').length;
      const crit=tiresV.filter(m=>tireStatus(m)==='critico').length;
      const sinD=total-tiresV.length;
      const pctOk=Math.round(ok/total*100);
      const pctBajo=Math.round(bajo/total*100);
      const pctCrit=Math.round(crit/total*100);
      return `<div class="dash-fleet-card">
        <div class="dash-fleet-name">${esc(v.nombre)}${v.patente?`<span class="dash-fleet-pat">${esc(v.patente)}</span>`:''}</div>
        <div class="dash-fleet-bar">
          <div style="width:${pctOk}%;background:#34c759"></div>
          <div style="width:${pctBajo}%;background:#ff9500"></div>
          <div style="width:${pctCrit}%;background:#ff3b30"></div>
          <div style="flex:1;background:rgba(0,0,0,0.07)"></div>
        </div>
        <div class="dash-fleet-stats">
          ${ok?`<span style="color:#1a7f37">✓ ${ok} OK</span>`:''}
          ${bajo?`<span style="color:#b25000">⚠ ${bajo} bajo</span>`:''}
          ${crit?`<span style="color:#c0392b">✕ ${crit} crítico</span>`:''}
          ${sinD>0?`<span style="color:var(--text-tertiary)">${sinD} sin datos</span>`:''}
        </div>
      </div>`;
    }).join('');
  }

  // ── Tabla recientes ──
  const recentBody=document.getElementById('dash-recent-body');
  const recent=(allMed||[]).slice(0,20);
  if(!recent.length){
    recentBody.innerHTML='<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-tertiary)">No hay mediciones aún.</td></tr>';
    return;
  }
  const sLabel={ok:'<span class="ds-badge ok">OK</span>',bajo:'<span class="ds-badge warn">Bajo</span>',critico:'<span class="ds-badge crit">Crítico</span>'};
  recentBody.innerHTML=recent.map(m=>{
    const s=tireStatus(m);
    const fmt=v=>v!=null?`<b>${parseFloat(v).toFixed(1)}</b>`:'—';
    return `<tr>
      <td>${esc(m.vehiculos?.nombre||'—')}</td>
      <td><span class="tire-pos-badge" style="font-size:11px;padding:2px 7px">P${m.posicion}</span></td>
      <td>${fmt(m.mm1)}</td>
      <td>${fmt(m.mm2)}</td>
      <td>${fmt(m.mm3)}</td>
      <td>${s?sLabel[s]:'—'}</td>
      <td style="color:var(--text-tertiary);font-size:12px">${relDate(m.created_at)}</td>
    </tr>`;
  }).join('');
}

// NAV
const NAV_LABELS={dashboard:'Mi Panel',balance:'Balance',clientes:'Clientes',vehiculos:'Vehículos',dispositivos:'Dispositivos',mediciones:'Mediciones'};

function switchView(v){
  document.querySelectorAll('.nav-item[data-view]').forEach(n=>n.classList.toggle('active',n.dataset.view===v));
  document.querySelectorAll('.view').forEach(vw=>vw.classList.toggle('active',vw.id===`view-${v}`));
  document.getElementById('breadcrumb-current').textContent=NAV_LABELS[v]||v;
  if(v==='dashboard') loadDashboard();
  if(v==='balance') loadBalance();
  if(v==='clientes') loadClients();
  if(v==='vehiculos') loadVehiculos();
  if(v==='dispositivos') loadDispositivos();
  if(v==='mediciones') medInit();
}

document.querySelectorAll('.nav-item[data-view]').forEach(el=>{
  el.addEventListener('click',()=>{ switchView(el.dataset.view); closeSidebar(); });
});

// CLIENTES
function showToastOk(msg){ showToast(msg,false); }

async function loadClients(){
  setStatus(true,'Cargando...');
  const {data,error}=await db.from('clientes')
    .select('id,nombre,created_at,auth_user_id, dispositivos(id,mac_address,activo), vehiculos(id)')
    .order('created_at',{ascending:false});
  if(error){ setStatus(false,'Error de conexión'); showToast('Error: '+error.message,true); return; }
  clients=data||[]; setStatus(true,'Conectado'); renderClientes();
}

async function createClient_(name,email,password){
  const {data:{session}}=await db.auth.getSession();
  const res=await fetch(`${SUPABASE_URL}/functions/v1/crear-cliente`,{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${session.access_token}`,'apikey':SUPABASE_KEY},
    body:JSON.stringify({nombre:name,email,password})
  });
  const result=await res.json();
  if(!result.ok) throw new Error(result.error);
  return result.cliente;
}

async function deleteClient(id){
  const {error}=await db.from('clientes').delete().eq('id',id);
  if(error) throw error;
}

function clientStatus(c){
  const disps=c.dispositivos||[];
  if(disps.length===0) return{cls:'orange',lbl:'Sin dispositivo'};
  if(disps.every(d=>!d.activo)) return{cls:'red',lbl:'Inactivo'};
  return{cls:'green',lbl:'Activo'};
}

function renderClientes(){
  const q=document.getElementById('search-clientes').value.toLowerCase();
  const tbody=document.getElementById('tbody-clientes');
  const filtered=clients.filter(c=>c.nombre.toLowerCase().includes(q));

  // Stats
  document.getElementById('stat-clients').textContent=clients.length;
  const totalVehs=clients.reduce((s,c)=>s+(c.vehiculos||[]).length,0);
  const totalDisps=clients.reduce((s,c)=>s+(c.dispositivos||[]).filter(d=>d.activo).length,0);
  const noDevs=clients.filter(c=>!(c.dispositivos||[]).length).length;
  document.getElementById('stat-vehs').textContent=totalVehs;
  document.getElementById('stat-disps').textContent=totalDisps;
  document.getElementById('stat-nodev').textContent=noDevs;

  if(!clients.length){
    tbody.innerHTML=`<tr><td colspan="5"><div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><div class="empty-title">Sin clientes todavía</div><div class="empty-sub">Creá tu primer cliente con el botón de arriba</div></div></td></tr>`;
    return;
  }
  if(!filtered.length){
    tbody.innerHTML=`<tr><td colspan="5"><div class="empty-state"><div class="empty-title">Sin resultados</div><div class="empty-sub">Probá con otro término</div></div></td></tr>`;
    return;
  }

  tbody.innerHTML=filtered.map(c=>{
    const st=clientStatus(c), av=avatarFor(c.id);
    const disps=c.dispositivos||[];
    const dispCount=disps.length;
    const dispActivos=disps.filter(d=>d.activo).length;
    const dispHtml=dispCount===0
      ?'<span style="color:var(--text-tertiary);font-size:13px">—</span>'
      :`<div style="display:flex;flex-direction:column;gap:3px">
          <span class="badge ${dispActivos>0?'blue':''}">● ${dispCount} dispositivo${dispCount!==1?'s':''}</span>
          ${disps.map(d=>`<span class="mono-cell" style="font-size:11px;color:var(--text-tertiary)">${esc(d.mac_address)}</span>`).join('')}
        </div>`;
    return `<tr>
      <td class="id-cell">#${c.id}</td>
      <td><div class="name-cell"><div class="name-av ${av}">${c.nombre[0].toUpperCase()}</div>${esc(c.nombre)}</div></td>
      <td>${dispHtml}</td>
      <td><span class="badge ${st.cls}">● ${st.lbl}</span></td>
      <td><div class="actions">
        <button class="icon-btn" data-a="edit" data-id="${c.id}" title="Editar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn danger" data-a="del" data-id="${c.id}" title="Eliminar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div></td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('button[data-a]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id=parseInt(btn.dataset.id);
      if(btn.dataset.a==='del') removeClient(id); else openClienteModal('edit',id);
    });
  });
}

window.openClienteModal=function(mode,id){
  modalMode=mode; activeId=id;
  const fn=document.getElementById('field-name');
  const fe=document.getElementById('field-email');
  const fp=document.getElementById('field-password');
  const save=document.getElementById('cli-save');
  document.getElementById('f-name').value='';
  document.getElementById('f-email').value='';
  document.getElementById('f-password').value='';
  if(mode==='create'){
    document.getElementById('cli-modal-title').textContent='Nuevo cliente';
    document.getElementById('cli-modal-sub').textContent='Creá el cliente y sus credenciales de acceso';
    save.textContent='Crear cliente';
    fn.style.display='block'; fe.style.display='block'; fp.style.display='block';
  } else {
    const c=clients.find(c=>c.id===id);
    document.getElementById('f-name').value=c.nombre;
    fn.style.display='block'; fe.style.display='none'; fp.style.display='none';
    document.getElementById('cli-modal-title').textContent='Editar cliente';
    document.getElementById('cli-modal-sub').textContent=c.nombre;
    save.textContent='Guardar';
  }
  document.getElementById('modal-cliente').classList.add('show');
  setTimeout(()=>document.getElementById('f-name').focus(),60);
};
window.closeClienteModal=()=>document.getElementById('modal-cliente').classList.remove('show');
window.togglePassword=()=>{ const i=document.getElementById('f-password'); i.type=i.type==='password'?'text':'password'; };

window.saveCliente=async function(){
  const name=document.getElementById('f-name').value.trim();
  const email=document.getElementById('f-email').value.trim();
  const password=document.getElementById('f-password').value;
  const btn=document.getElementById('cli-save');
  btn.disabled=true; btn.textContent=modalMode==='create'?'Creando...':'Guardando...';
  try{
    if(modalMode==='create'){
      if(!name||!email||!password){ showToast('Completá todos los campos',true); return; }
      if(password.length<6){ showToast('La contraseña debe tener al menos 6 caracteres',true); return; }
      const created=await createClient_(name,email,password);
      clients.unshift(created);
      showToast(`${name} creado correctamente`);
    } else {
      if(!name){ showToast('Ingresá un nombre',true); return; }
      const {data,error}=await db.from('clientes').update({nombre:name}).eq('id',activeId).select('id,nombre,created_at,auth_user_id, dispositivos(id,mac_address,activo), vehiculos(id)').single();
      if(error) throw error;
      const idx=clients.findIndex(c=>c.id===activeId);
      if(idx>=0) clients[idx]=data;
      showToast('Cliente actualizado');
    }
    closeClienteModal(); renderClientes();
  } catch(e){ showToast('Error: '+e.message,true); }
  finally{ btn.disabled=false; btn.textContent=modalMode==='create'?'Crear cliente':'Guardar'; }
};

window.removeClient=async function(id){
  const c=clients.find(c=>c.id===id);
  const ok=await confirmDialog(`Eliminar cliente`,`¿Eliminar a "${c.nombre}"? Esta acción no se puede deshacer.`);
  if(!ok) return;
  try{ await deleteClient(id); clients=clients.filter(c=>c.id!==id); showToast(`${c.nombre} eliminado`); renderClientes(); }
  catch(e){ showToast('Error: '+e.message,true); }
};

document.getElementById('search-clientes').addEventListener('input',renderClientes);
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeClienteModal(); });
window.loadClients=loadClients;

// MEDICIONES
let medTireData={}, medVehs=[], medSelPos=null, medTipoRuedas='10';

const MED_CFG={
  '10':[
    {positions:[{pos:1,side:'L'},{pos:2,side:'R'}],single:true},
    {positions:[{pos:3,side:'LL'},{pos:4,side:'LR'},{pos:5,side:'RL'},{pos:6,side:'RR'}],single:false},
    {positions:[{pos:7,side:'LL'},{pos:8,side:'LR'},{pos:9,side:'RL'},{pos:10,side:'RR'}],single:false},
  ],
  '16':[
    {positions:[{pos:1,side:'L'},{pos:2,side:'R'}],single:true},
    {positions:[{pos:3,side:'LL'},{pos:4,side:'LR'},{pos:5,side:'RL'},{pos:6,side:'RR'}],single:false},
    {positions:[{pos:7,side:'LL'},{pos:8,side:'LR'},{pos:9,side:'RL'},{pos:10,side:'RR'}],single:false},
    {positions:[{pos:11,side:'LL'},{pos:12,side:'LR'},{pos:13,side:'RL'},{pos:14,side:'RR'}],single:false},
    {positions:[{pos:15,side:'L'},{pos:16,side:'R'}],single:true},
  ],
};

function mAvg(r){ const v=[r.mm1,r.mm2,r.mm3].filter(x=>x!=null); return v.length?v.reduce((a,b)=>a+b,0)/v.length:null; }
function mLast(pos){ const h=medTireData[pos]; return(!h||!h.length)?null:mAvg(h[h.length-1]); }
function mTireColor(pos){
  const a=mLast(pos);
  if(a===null) return{stroke:'#48484a',fill:'rgba(72,72,74,0.08)',text:'#98989d',status:'neutral'};
  if(a>=8)  return{stroke:'#34c759',fill:'rgba(52,199,89,0.12)',text:'#1a7f37',status:'ok'};
  if(a>=5)  return{stroke:'#ff9500',fill:'rgba(255,149,0,0.12)',text:'#b25000',status:'warn'};
  return         {stroke:'#ff3b30',fill:'rgba(255,59,48,0.12)',text:'#c0392b',status:'crit'};
}

async function medInit(){
  const sel=document.getElementById('med-cliente-select');
  // Panel selector de cliente: ocultar en modo cliente y auto-seleccionar
  document.getElementById('med-panel-vehiculo').querySelector('.field')?.closest
  const clientePanel=document.getElementById('med-cliente-select').closest('.field');
  if(clientePanel) clientePanel.style.display=isClienteMode()?'none':'';
  document.getElementById('med-cliente-search')?.closest('.field') &&
    (document.getElementById('med-cliente-search').closest('.field').style.display=isClienteMode()?'none':'');

  if(isClienteMode()){
    // En modo cliente: cargar vehículos directamente sin seleccionar cliente
    sel.innerHTML=`<option value="${currentClienteId}">${esc(currentClienteNombre)}</option>`;
    sel.value=String(currentClienteId);
    const {data}=await db.from('vehiculos').select('id,nombre,patente,tipo_ruedas')
      .eq('cliente_id',currentClienteId).eq('activo',true).order('nombre');
    medVehs=data||[];
    const vs=document.getElementById('med-vehiculo-select');
    vs.innerHTML='<option value="">— Seleccionar vehículo —</option>'+
      medVehs.map(v=>`<option value="${v.id}">${esc(v.nombre)}${v.patente?' · '+v.patente:''} (${v.tipo_ruedas} WHL)</option>`).join('');
    vs.disabled=false;
  } else {
    const {data}=await db.from('clientes').select('id,nombre').order('nombre');
    sel.innerHTML='<option value="">— Seleccionar cliente —</option>'+
      (data||[]).map(c=>`<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
    document.getElementById('med-vehiculo-select').innerHTML='<option value="">— Seleccionar vehículo —</option>';
    document.getElementById('med-vehiculo-select').disabled=true;
  }
  document.getElementById('med-truck-card').style.display='none';
  document.getElementById('med-counters-card').style.display='none';
  document.getElementById('med-empty').style.display='flex';
  document.getElementById('med-tire-detail').style.display='none';
  document.getElementById('med-loading').style.display='none';
  medTireData={}; medSelPos=null; medSelDevice=null; medSelSession=null;
  const activeMode=document.querySelector('.med-tab.active')?.dataset?.mode||'vehiculo';
  medSwitchMode(activeMode);
}

document.getElementById('med-cliente-search').addEventListener('input',function(){
  const q=this.value.toLowerCase();
  const opts=document.getElementById('med-cliente-select').options;
  for(let i=1;i<opts.length;i++) opts[i].style.display=opts[i].text.toLowerCase().includes(q)?'':'none';
  const vis=Array.from(opts).slice(1).filter(o=>o.style.display!=='none');
  if(vis.length===1){ document.getElementById('med-cliente-select').value=vis[0].value; document.getElementById('med-cliente-select').dispatchEvent(new Event('change')); }
});

document.getElementById('med-cliente-select').addEventListener('change',async function(){
  const cid=parseInt(this.value);
  const vs=document.getElementById('med-vehiculo-select');
  document.getElementById('med-truck-card').style.display='none';
  document.getElementById('med-counters-card').style.display='none';
  document.getElementById('med-empty').style.display='flex';
  document.getElementById('med-tire-detail').style.display='none';
  if(!cid){ vs.innerHTML='<option value="">— Seleccionar vehículo —</option>'; vs.disabled=true; return; }
  const {data}=await db.from('vehiculos').select('id,nombre,patente,tipo_ruedas').eq('cliente_id',cid).eq('activo',true).order('nombre');
  medVehs=data||[];
  vs.innerHTML='<option value="">— Seleccionar vehículo —</option>'+medVehs.map(v=>`<option value="${v.id}">${esc(v.nombre)}${v.patente?' · '+v.patente:''} (${v.tipo_ruedas} WHL)</option>`).join('');
  vs.disabled=false;
});

document.getElementById('med-vehiculo-select').addEventListener('change',async function(){
  const vid=parseInt(this.value);
  if(!vid){ document.getElementById('med-truck-card').style.display='none';
  document.getElementById('med-counters-card').style.display='none'; document.getElementById('med-empty').style.display='flex'; document.getElementById('med-tire-detail').style.display='none'; return; }
  const v=medVehs.find(v=>v.id===vid);
  if(v) medTipoRuedas=String(v.tipo_ruedas);
  document.getElementById('med-loading').style.display='flex';
  document.getElementById('med-empty').style.display='none';
  document.getElementById('med-tire-detail').style.display='none';
  medTireData={}; medSelPos=null;
  const {data,error}=await db.from('mediciones').select('posicion,mm1,mm2,mm3,promedio,created_at,idneumatico').eq('vehiculo_id',vid).order('created_at',{ascending:true});
  if(error){ showToast('Error: '+error.message,true); document.getElementById('med-loading').style.display='none'; return; }
  // Agrupar historial por posición (últimas 10 lecturas por rueda)
  const grp={};
  (data||[]).forEach(r=>{ const p=parseInt(r.posicion); if(!grp[p]) grp[p]=[]; grp[p].push(r); });
  Object.keys(grp).forEach(p=>{ medTireData[parseInt(p)]=grp[p].slice(-10); });
  document.getElementById('med-loading').style.display='none';
  document.getElementById('med-truck-card').style.display='block';
  document.getElementById('med-counters-card').style.display='block';
  document.getElementById('med-empty').style.display='flex';
  document.getElementById('med-tire-detail').style.display='none';
  medDrawTruck(); medUpdateCounters();
});

function medNS(t,a={}){ const e=document.createElementNS('http://www.w3.org/2000/svg',t); Object.entries(a).forEach(([k,v])=>e.setAttribute(k,v)); return e; }

// ─── VISTA SUPERIOR (top-down) — Diseño profesional ───
// frente = izquierda (x pequeño), trasera = derecha (x grande)
// lado izquierdo del vehículo = arriba (y pequeño), derecho = abajo

// ── NEUMÁTICO — plano arquitectónico, vista superior ──
// ── NEUMÁTICO — plano técnico, contorno de estado ──
// TW = espesor (perpendicular al bus). TH = largo de goma (paralelo al bus).
// Se dibuja rotado 90°: RW=TH (horizontal), RH=TW (vertical).
function medDrawTire(svg, cx, cy, pos, TW, TH, isSingle, isAbove){
  const col=mTireColor(pos), isSel=medSelPos===pos, a=mLast(pos);
  const g=medNS('g',{cursor:'pointer'});
  g.addEventListener('click',()=>medSelectTire(pos));

  // Girar 90°: el lado largo queda horizontal (paralelo al bus)
  const RW=TH, RH=TW;
  const rx=3;
  const x=cx-RW/2, y=cy-RH/2;
  const hasData=a!==null;

  // Fondo claro con tinte de estado
  g.appendChild(medNS('rect',{
    x, y, width:RW, height:RH, rx,
    fill: hasData ? col.fill : 'rgba(61,60,32,0.04)'
  }));

  // Contorno de estado — línea principal
  g.appendChild(medNS('rect',{
    x, y, width:RW, height:RH, rx,
    fill:'none',
    stroke: hasData ? col.stroke : 'rgba(61,60,32,0.22)',
    'stroke-width': isSel ? '2.5' : '1.8'
  }));

  // Línea interior paralela (doble contorno estilo plano técnico)
  const inset=3;
  g.appendChild(medNS('rect',{
    x:x+inset, y:y+inset, width:RW-inset*2, height:RH-inset*2, rx:Math.max(1,rx-2),
    fill:'none',
    stroke: hasData ? col.stroke : 'rgba(61,60,32,0.10)',
    'stroke-width':'0.6',
    opacity:'0.5'
  }));

  // Valor mm — centrado dentro
  if(hasData){
    const fs=isSingle?7.5:6.5;
    const t=medNS('text',{
      x:cx, y:cy,
      'text-anchor':'middle', 'dominant-baseline':'middle',
      'font-size':fs, 'font-family':"'Inter',sans-serif",
      'font-weight':'700', fill:col.text
    });
    t.textContent=a.toFixed(1);
    g.appendChild(t);
  }

  // Indicador de selección — borde externo punteado
  if(isSel){
    g.appendChild(medNS('rect',{
      x:x-4, y:y-4, width:RW+8, height:RH+8, rx:rx+3,
      fill:'none', stroke:col.stroke, 'stroke-width':'1.2',
      'stroke-dasharray':'3 2', opacity:'0.6'
    }));
  }

  // Label posición — encima o debajo del neumático
  const ly=isAbove ? y-7 : y+RH+11;
  const pl=medNS('text',{
    x:cx, y:ly, 'text-anchor':'middle',
    'font-size':'7.5', 'font-family':"'Inter',sans-serif",
    'font-weight': isSel?'700':'400',
    fill: isSel ? col.stroke : 'rgba(61,60,32,0.38)',
    'letter-spacing':'0.04em'
  });
  pl.textContent=`P${pos}`;
  g.appendChild(pl);

  svg.appendChild(g);
}

// ── VEHÍCULO — plano técnico, vista superior ──
function medDrawTruck(){
  const key=String(medTipoRuedas);
  const svg=document.getElementById('med-truck-svg');
  svg.innerHTML='';
  const cfg=MED_CFG[key]; if(!cfg) return;

  // ── Dimensiones de neumáticos ──
  const TW_s=20, TH_s=54;   // simple: perfil delgado, ancho largo
  const TW_d=15, TH_d=38;   // dual: más compacto
  const GAP_D=5;             // espacio entre par de duales
  const BGAP=12;             // gap carrocería → neumático

  // ── Posición de ejes según tipo ──
  let axleXs, bodyX1, bodyX2;
  if(key==='10'){
    axleXs=[150, 440, 580]; bodyX1=64; bodyX2=730;
  } else {
    axleXs=[120, 310, 420, 530, 640]; bodyX1=50; bodyX2=780;
  }

  // Altura del canvas: rotado 90°, el lado que "sale" del bus es TW (el corto)
  const outerR_d = BGAP + TW_d + GAP_D + TW_d; // distancia máxima desde borde cuerpo (dual)
  const outerR_s = BGAP + TW_s;                 // distancia máxima (simple)
  const outerR   = Math.max(outerR_d, outerR_s);
  const labelExtra = 22;
  const bodyH = 86;
  const margin = 28;
  const H = bodyH + (outerR + labelExtra + margin) * 2;
  const W = key==='10' ? 860 : 900;
  const midY = H / 2;
  const bodyTop = midY - bodyH/2, bodyBot = midY + bodyH/2;
  const bodyW = bodyX2 - bodyX1;

  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  svg.setAttribute('width','100%');
  svg.setAttribute('height',String(Math.round(H)));

  const INK  = 'rgba(50,49,25,';   // color base de tinta del plano
  const INK2 = '#3D3C20';

  // ── DEFS: patrón de líneas finas (fondo plano técnico) ──
  const defs=medNS('defs',{});

  // Patrón de cuadrícula muy sutil
  const pat=medNS('pattern',{id:'grid',width:'20',height:'20',patternUnits:'userSpaceOnUse'});
  pat.appendChild(medNS('path',{d:'M 20 0 L 0 0 0 20',fill:'none',stroke:INK+'0.06)',
    'stroke-width':'0.5'}));
  defs.appendChild(pat);

  svg.appendChild(defs);

  // Fondo con grid técnico muy tenue
  svg.appendChild(medNS('rect',{x:0,y:0,width:W,height:H,fill:'url(#grid)'}));

  // ── LÍNEAS DE EJE — atraviesan todo el canvas de arriba a abajo ──
  axleXs.forEach((ax,i)=>{
    // Línea de eje de punta a punta
    svg.appendChild(medNS('line',{
      x1:ax, y1:margin/2, x2:ax, y2:H-margin/2,
      stroke:INK+'0.14)', 'stroke-width':'1',
      'stroke-dasharray':'8 5', 'stroke-linecap':'round'
    }));
    // Trazo sólido dentro del cuerpo
    svg.appendChild(medNS('line',{
      x1:ax, y1:bodyTop, x2:ax, y2:bodyBot,
      stroke:INK+'0.28)', 'stroke-width':'1.2'
    }));
    // Pequeño círculo en la intersección eje / borde cuerpo (arriba y abajo)
    [bodyTop, bodyBot].forEach(ey=>{
      svg.appendChild(medNS('circle',{cx:ax,cy:ey,r:'2.5',
        fill:'white',stroke:INK+'0.30)','stroke-width':'0.8'}));
    });
  });

  // Línea de simetría longitudinal
  svg.appendChild(medNS('line',{
    x1:bodyX1-20, y1:midY, x2:bodyX2+20, y2:midY,
    stroke:INK+'0.10)', 'stroke-width':'0.8', 'stroke-dasharray':'10 6'
  }));

  // ── CARROCERÍA — cuerpo principal ──
  // Sombra muy sutil
  svg.appendChild(medNS('rect',{
    x:bodyX1+2, y:bodyTop+2, width:bodyW, height:bodyH, rx:6,
    fill:'rgba(0,0,0,0.05)'
  }));

  // Relleno del cuerpo — color brand muy claro
  svg.appendChild(medNS('rect',{
    x:bodyX1, y:bodyTop, width:bodyW, height:bodyH, rx:6,
    fill:'rgba(61,60,32,0.07)', stroke:INK2,
    'stroke-width':'1.5'
  }));

  // Línea de pared interior (doble contorno estilo arquitectónico)
  const wallInset=5;
  svg.appendChild(medNS('rect',{
    x:bodyX1+wallInset, y:bodyTop+wallInset,
    width:bodyW-wallInset*2, height:bodyH-wallInset*2, rx:3,
    fill:'none', stroke:INK+'0.20)', 'stroke-width':'0.7'
  }));

  // ── FRENTE (izquierda) — parabrisa y detalles ──
  const cabW=90;
  // Zona de cabina con relleno más marcado
  svg.appendChild(medNS('rect',{
    x:bodyX1, y:bodyTop, width:cabW, height:bodyH, rx:6,
    fill:'rgba(61,60,32,0.10)',
    stroke:'none'
  }));
  // Borde derecho de cabina
  svg.appendChild(medNS('line',{
    x1:bodyX1+cabW, y1:bodyTop+wallInset+2,
    x2:bodyX1+cabW, y2:bodyBot-wallInset-2,
    stroke:INK+'0.25)', 'stroke-width':'0.8', 'stroke-dasharray':'4 3'
  }));
  // Parabrisa — arco esquemático
  svg.appendChild(medNS('path',{
    d:`M ${bodyX1+6} ${bodyTop+14} Q ${bodyX1+3} ${midY} ${bodyX1+6} ${bodyBot-14}`,
    fill:'none', stroke:INK+'0.35)', 'stroke-width':'1.2'
  }));

  // ── LUCES delanteras ──
  [[bodyTop+10, 10],[bodyBot-20, 10]].forEach(([fy,fh])=>{
    svg.appendChild(medNS('rect',{
      x:bodyX1-5, y:fy, width:5, height:fh, rx:2,
      fill:'rgba(61,60,32,0.55)', stroke:INK2, 'stroke-width':'0.6'
    }));
  });

  // ── LUCES traseras ──
  [[bodyTop+12, 14],[bodyBot-26, 14]].forEach(([ry,rh])=>{
    svg.appendChild(medNS('rect',{
      x:bodyX2, y:ry, width:5, height:rh, rx:2,
      fill:'rgba(61,60,32,0.25)', stroke:INK2, 'stroke-width':'0.6'
    }));
  });

  // ── ETIQUETAS ──
  // "FRENTE"
  const labelF=medNS('text',{
    x:bodyX1+cabW/2, y:bodyTop-12,
    'text-anchor':'middle', 'font-size':'7',
    'font-family':"'Inter',sans-serif", 'font-weight':'500',
    fill:INK+'0.35)', 'letter-spacing':'0.14em'
  });
  labelF.textContent='FRENTE';
  svg.appendChild(labelF);

  // Número de eje sobre cada línea de eje
  axleXs.forEach((ax,i)=>{
    const t=medNS('text',{
      x:ax, y:bodyTop-12,
      'text-anchor':'middle', 'font-size':'7',
      'font-family':"'Inter',sans-serif", 'font-weight':'400',
      fill:INK+'0.28)', 'letter-spacing':'0.06em'
    });
    t.textContent=`EJE ${i+1}`;
    svg.appendChild(t);
  });

  // ── NEUMÁTICOS ──
  cfg.forEach((axle,ai)=>{
    const ax=axleXs[ai]; if(ax===undefined) return;
    if(axle.single){
      const L=axle.positions.find(p=>p.side==='L');
      const R=axle.positions.find(p=>p.side==='R');
      // Rotado 90°: el lado que separa del bus es TW_s (el corto)
      const cyL=bodyTop-BGAP-TW_s/2;
      const cyR=bodyBot+BGAP+TW_s/2;
      if(L) medDrawTire(svg,ax,cyL,L.pos,TW_s,TH_s,true,true);
      if(R) medDrawTire(svg,ax,cyR,R.pos,TW_s,TH_s,true,false);
    } else {
      const LL=axle.positions.find(p=>p.side==='LL');
      const LR=axle.positions.find(p=>p.side==='LR');
      const RL=axle.positions.find(p=>p.side==='RL');
      const RR=axle.positions.find(p=>p.side==='RR');
      // Rotado 90°: el lado que separa del bus es TW_d (el corto)
      const cyLI=bodyTop-BGAP-TW_d/2;
      const cyLO=cyLI-TW_d-GAP_D;
      const cyRI=bodyBot+BGAP+TW_d/2;
      const cyRO=cyRI+TW_d+GAP_D;
      if(LR) medDrawTire(svg,ax,cyLI,LR.pos,TW_d,TH_d,false,true);
      if(LL) medDrawTire(svg,ax,cyLO,LL.pos,TW_d,TH_d,false,true);
      if(RL) medDrawTire(svg,ax,cyRI,RL.pos,TW_d,TH_d,false,false);
      if(RR) medDrawTire(svg,ax,cyRO,RR.pos,TW_d,TH_d,false,false);
    }
  });
}

function medUpdateCounters(){
  const cfg=MED_CFG[String(medTipoRuedas)]; if(!cfg) return;
  let ok=0,warn=0,crit=0;
  cfg.flatMap(a=>a.positions.map(p=>p.pos)).forEach(p=>{
    const a=mLast(p); if(a===null)return;
    if(a>=8)ok++; else if(a>=5)warn++; else crit++;
  });
  document.getElementById('med-ok').textContent=ok;
  document.getElementById('med-warn').textContent=warn;
  document.getElementById('med-crit').textContent=crit;
}

async function exportMedicionesCSV(){
  const vid=parseInt(document.getElementById('med-vehiculo-select').value);
  if(!vid) return;
  const veh=medVehs.find(v=>v.id===vid);
  const btn=document.getElementById('med-export-btn');
  btn.disabled=true; btn.textContent='Exportando...';

  const {data,error}=await db.from('mediciones')
    .select('posicion,mm1,mm2,mm3,promedio,created_at')
    .eq('vehiculo_id',vid)
    .order('created_at',{ascending:false});

  btn.disabled=false;
  btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Exportar CSV';

  if(error){ showToast('Error al exportar: '+error.message,true); return; }
  if(!data||!data.length){ showToast('No hay mediciones para exportar',true); return; }

  const vehNombre=veh?veh.nombre:'vehiculo';
  const rows=[['Fecha','Posición','Exterior (mm)','Medio (mm)','Interior (mm)','Promedio (mm)']];
  data.forEach(r=>{
    const fecha=new Date(r.created_at).toLocaleString('es-UY',{timeZone:'America/Montevideo',hour12:false});
    rows.push([fecha,r.posicion,r.mm1??'',r.mm2??'',r.mm3??'',r.promedio!=null?parseFloat(r.promedio).toFixed(1):'']);
  });

  const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=`neumet_${vehNombre.replace(/\s+/g,'_')}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

function medSelectTire(pos){
  medSelPos=pos; medDrawTruck();
  const col=mTireColor(pos), hist=medTireData[pos]||[], a=mLast(pos);
  document.getElementById('med-empty').style.display='none';
  document.getElementById('med-tire-detail').style.display='block';

  document.getElementById('med-pos-badge').textContent=`P${pos}`;
  const lr=hist[hist.length-1];
  document.getElementById('med-tire-title').textContent=lr&&lr.idneumatico?`Neumático ID ${lr.idneumatico}`:`Posición ${pos}`;
  document.getElementById('med-tire-sub').textContent=a!=null?`Promedio actual: ${a.toFixed(1)} mm`:'Sin mediciones recientes';

  const statusEl=document.getElementById('med-tire-status');
  const statusMap={ok:{cls:'ok',txt:'Operativo'},warn:{cls:'warn',txt:'Bajo'},crit:{cls:'crit',txt:'Crítico'},neutral:{cls:'',txt:'Sin datos'}};
  const s=statusMap[col.status]||statusMap.neutral;
  statusEl.className=`tire-status ${s.cls}`;
  statusEl.textContent=s.txt+(a!=null?` · ${a.toFixed(1)} mm`:'');

  // mm values
  const mm=['mm1','mm2','mm3'];
  mm.forEach((m,i)=>{
    const val=lr&&lr[m]!=null?parseFloat(lr[m]):null;
    const pct=val!=null?Math.min(100,(val/12)*100):0;
    const c=val==null?'var(--text-tertiary)':val>=8?'#1a7f37':val>=5?'#b25000':'#c0392b';
    const bc=val==null?'rgba(0,0,0,0.15)':val>=8?'#34c759':val>=5?'#ff9500':'#ff3b30';
    document.getElementById(`med-${m}`).textContent=val!=null?val.toFixed(1)+'mm':'—';
    document.getElementById(`med-${m}`).style.color=c;
    document.getElementById(`med-bar${i+1}`).style.width=pct+'%';
    document.getElementById(`med-bar${i+1}`).style.background=bc;
  });

  // History table
  const tbody=document.getElementById('med-hist-body');
  if(!hist.length){
    tbody.innerHTML=`<tr><td colspan="6" style="color:var(--text-tertiary);text-align:center;padding:16px;font-size:12px">Sin registros</td></tr>`;
  } else {
    tbody.innerHTML=hist.slice().reverse().map((r,i)=>{
      const pa=r.promedio!=null?parseFloat(r.promedio):mAvg(r);
      const rc=pa==null?'var(--text-tertiary)':pa>=8?'#1a7f37':pa>=5?'#b25000':'#c0392b';
      const fecha=r.created_at?new Date(r.created_at).toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'2-digit'}):'—';
      const badge=i===0?'<span style="background:var(--accent-light);color:var(--accent);border-radius:4px;padding:1px 5px;font-size:9px;margin-left:4px">Actual</span>':'';
      return `<tr>
        <td style="color:var(--text-secondary)">${fecha}${badge}</td>
        <td style="color:var(--text-secondary)">${r.mm1!=null?parseFloat(r.mm1).toFixed(1):'—'}</td>
        <td style="color:var(--text-secondary)">${r.mm2!=null?parseFloat(r.mm2).toFixed(1):'—'}</td>
        <td style="color:var(--text-secondary)">${r.mm3!=null?parseFloat(r.mm3).toFixed(1):'—'}</td>
        <td style="color:${rc};font-weight:500">${pa!=null?parseFloat(pa).toFixed(1):'—'}</td>
      </tr>`;
    }).join('');
  }
  medDrawChart(hist);
}

function medDrawChart(hist){
  const svgEl=document.getElementById('med-chart-svg');
  const W=svgEl.parentElement.clientWidth||400;
  svgEl.setAttribute('width',W); svgEl.innerHTML='';
  const avgs=hist.map(r=>r.promedio!=null?parseFloat(r.promedio):mAvg(r)).filter(x=>x!=null);
  if(avgs.length<2){
    const t=medNS('text',{x:W/2,y:55,'text-anchor':'middle','font-size':'12','font-family':"'Inter',sans-serif",fill:'var(--text-tertiary)'}); t.textContent='Insuficientes datos para el gráfico'; svgEl.appendChild(t); return;
  }
  const H=120,pL=32,pR=12,pT=10,pB=24,cW=W-pL-pR,cH=H-pT-pB;
  const minV=Math.max(0,Math.min(...avgs)-2), maxV=Math.min(12,Math.max(...avgs)+2);
  const xS=i=>pL+(i/(avgs.length-1))*cW, yS=v=>pT+cH-((v-minV)/(maxV-minV))*cH;

  // Background
  svgEl.appendChild(medNS('rect',{x:pL,y:pT,width:cW,height:cH,fill:'#fafafa',rx:4,stroke:'rgba(0,0,0,0.06)','stroke-width':'0.5'}));

  // Zone fills
  [[8,12,'rgba(52,199,89,0.04)'],[5,8,'rgba(255,149,0,0.04)'],[0,5,'rgba(255,59,48,0.04)']].forEach(([lo,hi,fill])=>{
    const y1=yS(Math.min(hi,maxV)), y2=yS(Math.max(lo,minV));
    if(y2>y1) svgEl.appendChild(medNS('rect',{x:pL,y:y1,width:cW,height:y2-y1,fill}));
  });

  // Grid lines + labels
  [4,6,8,10,12].forEach(v=>{
    if(v<minV||v>maxV) return;
    const y=yS(v);
    svgEl.appendChild(medNS('line',{x1:pL,y1:y,x2:pL+cW,y2:y,stroke:'rgba(0,0,0,0.07)','stroke-width':'0.5','stroke-dasharray':'3 3'}));
    const lbl=medNS('text',{x:pL-4,y:y+3.5,'text-anchor':'end','font-size':'9','font-family':"'Inter',sans-serif",fill:'#98989d'}); lbl.textContent=v; svgEl.appendChild(lbl);
  });

  // Threshold lines
  [[8,'#34c759'],[5,'#ff9500']].forEach(([v,c])=>{
    if(v<minV||v>maxV) return;
    svgEl.appendChild(medNS('line',{x1:pL,y1:yS(v),x2:pL+cW,y2:yS(v),stroke:c,'stroke-width':'0.8','stroke-dasharray':'4 3',opacity:'0.5'}));
  });

  // Area fill
  const lastCol=avgs[avgs.length-1]>=8?'#34c759':avgs[avgs.length-1]>=5?'#ff9500':'#ff3b30';
  const aPath=`M${xS(0)},${yS(avgs[0])}`+avgs.slice(1).map((v,i)=>`L${xS(i+1)},${yS(v)}`).join('')+`L${xS(avgs.length-1)},${pT+cH}L${pL},${pT+cH}Z`;
  svgEl.appendChild(medNS('path',{d:aPath,fill:lastCol+'14',stroke:'none'}));

  // Line
  const lPath=`M${xS(0)},${yS(avgs[0])}`+avgs.slice(1).map((v,i)=>`L${xS(i+1)},${yS(v)}`).join('');
  svgEl.appendChild(medNS('path',{d:lPath,fill:'none',stroke:lastCol,'stroke-width':'2','stroke-linejoin':'round','stroke-linecap':'round'}));

  // Dots
  avgs.forEach((v,i)=>{
    const x2=xS(i), y2=yS(v), isLast=i===avgs.length-1;
    const dc=v>=8?'#34c759':v>=5?'#ff9500':'#ff3b30';
    svgEl.appendChild(medNS('circle',{cx:x2,cy:y2,r:isLast?4:2.5,fill:isLast?dc:'#fff',stroke:dc,'stroke-width':isLast?0:1.5}));
    if(isLast){ const vl=medNS('text',{x:x2+6,y:y2-4,'font-size':'10','font-family':"'Inter',sans-serif",'font-weight':'500',fill:dc}); vl.textContent=v.toFixed(1)+'mm'; svgEl.appendChild(vl); }
    // X axis date labels (every 2nd)
    if(i%2===0||isLast){
      const rl=hist[hist.length-1-i]; // reversed order
      const actHist=hist[i];
      const xl=medNS('text',{x:x2,y:pT+cH+14,'text-anchor':'middle','font-size':'9','font-family':"'Inter',sans-serif",fill:'#98989d'});
      xl.textContent=isLast?'Hoy':`-${avgs.length-1-i}`;
      svgEl.appendChild(xl);
    }
  });
}

// ── BALANCE ──
let gastos=[], gastoModalMode='create', gastoActiveId=null;
let balanceClients=[];

const fmt=n=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',minimumFractionDigits:0,maximumFractionDigits:0}).format(n);

async function loadBalance(){
  setStatus(true,'Cargando...');
  const [{data:cData},{data:gData}]=await Promise.all([
    db.from('clientes').select('id,nombre,precio_mensual,created_at').order('nombre'),
    db.from('gastos').select('*').order('created_at',{ascending:false})
  ]);
  setStatus(true,'Conectado');
  balanceClients=cData||[];
  gastos=gData||[];
  renderBalance();
}

function renderBalance(){
  const totalIngresos=balanceClients.reduce((s,c)=>s+parseFloat(c.precio_mensual||0),0);
  const gastosActivos=gastos.filter(g=>g.activo&&g.recurrente);
  const totalGastos=gastosActivos.reduce((s,g)=>s+parseFloat(g.monto||0),0);
  const resultado=totalIngresos-totalGastos;
  const margen=totalIngresos>0?((resultado/totalIngresos)*100):0;

  // KPIs
  document.getElementById('kpi-ingresos').textContent=fmt(totalIngresos);
  document.getElementById('kpi-ingresos-sub').textContent=`${balanceClients.filter(c=>parseFloat(c.precio_mensual||0)>0).length} clientes con precio`;
  document.getElementById('kpi-gastos').textContent=fmt(totalGastos);
  document.getElementById('kpi-gastos-sub').textContent=`${gastosActivos.length} ítems recurrentes activos`;
  const resEl=document.getElementById('kpi-resultado');
  const resCard=document.getElementById('kpi-resultado-card');
  resEl.textContent=fmt(resultado);
  resEl.className='kpi-value '+(resultado>=0?'positive':'negative');
  resCard.className='balance-kpi '+(resultado>=0?'positive':'negative');
  const margenEl=document.getElementById('kpi-margen');
  margenEl.textContent=totalIngresos>0?margen.toFixed(1)+'%':'—';
  margenEl.className='kpi-value '+(margen>=0?'positive':'negative');

  // Totales
  document.getElementById('total-ingresos-lbl').textContent=fmt(totalIngresos);
  document.getElementById('total-gastos-lbl').textContent=fmt(totalGastos);

  // Tabla ingresos
  const tbody1=document.getElementById('tbody-ingresos');
  if(!balanceClients.length){
    tbody1.innerHTML=`<tr><td colspan="3" style="text-align:center;padding:24px;color:var(--text-tertiary);font-size:13px">Sin clientes</td></tr>`;
  } else {
    tbody1.innerHTML=balanceClients.map(c=>`
      <tr>
        <td style="font-weight:500">${esc(c.nombre)}</td>
        <td style="text-align:right">
          <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end">
            <span style="font-size:12px;color:var(--text-tertiary)">$</span>
            <input class="precio-input" type="number" min="0" step="1"
              value="${parseFloat(c.precio_mensual||0).toFixed(0)}"
              data-cid="${c.id}"
              onchange="updatePrecio(${c.id},this.value)"
              title="Presioná Enter para guardar"/>
          </div>
        </td>
        <td>
          <span style="font-size:11px;font-weight:600;color:${parseFloat(c.precio_mensual||0)>0?'var(--success)':'var(--text-tertiary)'}">${parseFloat(c.precio_mensual||0)>0?'●':'○'}</span>
        </td>
      </tr>`).join('');
  }

  // Tabla gastos
  const tbody2=document.getElementById('tbody-gastos');
  if(!gastos.length){
    tbody2.innerHTML=`<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--text-tertiary);font-size:13px">Sin gastos registrados</td></tr>`;
  } else {
    tbody2.innerHTML=gastos.map(g=>{
      const opacidad=(!g.activo||!g.recurrente)?'opacity:0.45':'';
      return `<tr style="${opacidad}">
        <td>
          <div style="font-weight:500;font-size:13px">${esc(g.nombre)}</div>
          ${g.notas?`<div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">${esc(g.notas)}</div>`:''}
          ${!g.recurrente?'<span style="font-size:10px;color:var(--text-tertiary)">(único)</span>':''}
          ${!g.activo?'<span style="font-size:10px;color:var(--danger)"> · inactivo</span>':''}
        </td>
        <td><span class="cat-pill cat-${g.categoria}">${g.categoria}</span></td>
        <td style="text-align:right;font-family:var(--font-mono);font-size:13px;font-weight:600;color:${g.activo&&g.recurrente?'var(--danger)':'var(--text-tertiary)'}">${fmt(g.monto)}</td>
        <td><div class="actions">
          <button class="icon-btn" data-ga="edit" data-gid="${g.id}" title="Editar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn danger" data-ga="del" data-gid="${g.id}" title="Eliminar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div></td>
      </tr>`;
    }).join('');
    tbody2.querySelectorAll('button[data-ga]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const id=parseInt(btn.dataset.gid);
        if(btn.dataset.ga==='del') removeGasto(id); else openGastoModal('edit',id);
      });
    });
  }

  // Dibujar gráfico (después de renderizar tablas para que el DOM esté listo)
  requestAnimationFrame(renderBalanceChart);
}

// ── GRÁFICO DE BALANCE ──
function bNS(t,a={}){ const e=document.createElementNS('http://www.w3.org/2000/svg',t); Object.entries(a).forEach(([k,v])=>e.setAttribute(k,v)); return e; }

function fmtK(n){
  const abs=Math.abs(n);
  if(abs>=1000000) return (n/1000000).toFixed(1)+'M';
  if(abs>=1000)    return (n/1000).toFixed(0)+'k';
  return String(Math.round(n));
}

function niceGridVals(min,max,count=5){
  const range=max-min||1;
  const rough=range/count;
  const mag=Math.pow(10,Math.floor(Math.log10(rough)));
  const nice=[1,2,2.5,5,10].map(f=>f*mag).find(f=>f>=rough)||rough;
  const start=Math.floor(min/nice)*nice;
  const vals=[];
  for(let v=start; v<=max+nice*0.01; v=Math.round((v+nice)*1e9)/1e9) vals.push(v);
  return vals.filter(v=>v>=min-nice*0.01&&v<=max+nice*0.01);
}

function renderBalanceChart(){
  const svgEl=document.getElementById('balance-chart-svg');
  if(!svgEl) return;
  svgEl.innerHTML='';

  const W=svgEl.parentElement.clientWidth||700;
  svgEl.setAttribute('width',W);
  const H=280, pL=66, pR=28, pT=24, pB=42;
  const cW=W-pL-pR, cH=H-pT-pB;

  // Últimos 12 meses
  const months=[];
  const now=new Date();
  for(let i=11;i>=0;i--){
    const d=new Date(now.getFullYear(),now.getMonth()-i,1);
    months.push({
      label: d.toLocaleDateString('es-AR',{month:'short'}).replace('.','').slice(0,3)
             +' '+(d.getFullYear()+'').slice(2),
      endDate: new Date(d.getFullYear(),d.getMonth()+1,0,23,59,59)
    });
  }

  // Ingresos por mes (clientes creados antes del fin de ese mes)
  const incomes=months.map(m=>
    balanceClients.reduce((s,c)=>{
      const created=new Date(c.created_at);
      return created<=m.endDate ? s+parseFloat(c.precio_mensual||0) : s;
    },0)
  );

  // Gastos fijos mensuales (línea plana)
  const expTotal=gastos.filter(g=>g.activo&&g.recurrente).reduce((s,g)=>s+parseFloat(g.monto||0),0);

  // Resultado neto por mes
  const profits=incomes.map(inc=>inc-expTotal);

  // ── Empty state ──
  const maxInc=Math.max(...incomes);
  if(maxInc===0&&expTotal===0){
    const t=bNS('text',{x:W/2,y:H/2,'text-anchor':'middle','font-size':'14',
      'font-family':"'Inter',sans-serif",fill:'var(--text-tertiary)'});
    t.textContent='Configurá precios de clientes y gastos para ver la evolución';
    svgEl.appendChild(t); return;
  }

  const allVals=[...incomes, expTotal, ...profits, 0];
  const rawMin=Math.min(...allVals), rawMax=Math.max(...allVals,1);
  const pad=(rawMax-rawMin)*0.18||rawMax*0.2||200;
  const vMin=rawMin<0?rawMin-pad*0.5:0;
  const vMax=rawMax+pad;
  const range=vMax-vMin;

  const xS=i=>pL+(i/(months.length-1))*cW;  // puntos en los extremos, no centrados
  const yS=v=>pT+cH-((v-vMin)/range)*cH;
  const y0=yS(0);

  // Catmull-Rom → Bezier cúbico
  function smoothLine(pts){
    if(pts.length<2) return `M${pts[0][0]},${pts[0][1]}`;
    const t=0.4;
    let d=`M${pts[0][0]},${pts[0][1]}`;
    for(let i=0;i<pts.length-1;i++){
      const p0=pts[Math.max(i-1,0)], p1=pts[i], p2=pts[i+1], p3=pts[Math.min(i+2,pts.length-1)];
      const cp1x=p1[0]+(p2[0]-p0[0])*t, cp1y=p1[1]+(p2[1]-p0[1])*t;
      const cp2x=p2[0]-(p3[0]-p1[0])*t, cp2y=p2[1]-(p3[1]-p1[1])*t;
      d+=` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2[0]},${p2[1]}`;
    }
    return d;
  }

  const incPts =months.map((_,i)=>[xS(i), yS(incomes[i])]);
  const profPts=months.map((_,i)=>[xS(i), yS(profits[i])]);
  const lastProfit=profits[profits.length-1];
  const profColor=lastProfit>=0?'#34c759':'#ff3b30';
  const profColorAlpha=lastProfit>=0?'rgba(52,199,89,0.18)':'rgba(255,59,48,0.14)';

  // ── DEFS: gradientes de relleno ──
  const defs=bNS('defs',{});

  // Gradiente ingresos (dorado → transparente)
  const gInc=bNS('linearGradient',{id:'gInc',x1:'0',y1:'0',x2:'0',y2:'1'});
  gInc.appendChild(bNS('stop',{offset:'0%','stop-color':'#C9B96A','stop-opacity':'0.22'}));
  gInc.appendChild(bNS('stop',{offset:'100%','stop-color':'#C9B96A','stop-opacity':'0'}));
  defs.appendChild(gInc);

  // Gradiente resultado (verde o rojo → transparente)
  const gProf=bNS('linearGradient',{id:'gProf',x1:'0',y1:'0',x2:'0',y2:'1'});
  gProf.appendChild(bNS('stop',{offset:'0%','stop-color':profColor,'stop-opacity':'0.25'}));
  gProf.appendChild(bNS('stop',{offset:'100%','stop-color':profColor,'stop-opacity':'0'}));
  defs.appendChild(gProf);

  svgEl.appendChild(defs);

  // ── GRILLA — muy sutil, estilo Apple ──
  niceGridVals(vMin,vMax,5).forEach(v=>{
    const y=yS(v);
    if(y<pT-2||y>pT+cH+2) return;
    svgEl.appendChild(bNS('line',{x1:pL,y1:y,x2:pL+cW,y2:y,
      stroke:'rgba(0,0,0,0.055)','stroke-width':'1'}));
    const lbl=bNS('text',{x:pL-10,y:y+4,'text-anchor':'end',
      'font-size':'11','font-family':"'Inter',sans-serif",fill:'var(--text-tertiary)'});
    lbl.textContent=fmtK(v);
    svgEl.appendChild(lbl);
  });

  // Línea de cero (referencia)
  if(y0>pT&&y0<pT+cH){
    svgEl.appendChild(bNS('line',{x1:pL,y1:y0,x2:pL+cW,y2:y0,
      stroke:'rgba(0,0,0,0.1)','stroke-width':'1','stroke-dasharray':'3 3'}));
  }

  // ── ÁREAS de relleno (con gradiente) ──
  // Ingresos
  if(maxInc>0){
    const aInc=smoothLine(incPts)+` L${xS(months.length-1)},${pT+cH} L${xS(0)},${pT+cH} Z`;
    svgEl.appendChild(bNS('path',{d:aInc,fill:'url(#gInc)',stroke:'none'}));
  }
  // Resultado
  const aProf=smoothLine(profPts)+` L${xS(months.length-1)},${pT+cH} L${xS(0)},${pT+cH} Z`;
  svgEl.appendChild(bNS('path',{d:aProf,fill:'url(#gProf)',stroke:'none'}));

  // ── LÍNEA DE GASTOS (punteada horizontal) ──
  if(expTotal>0){
    svgEl.appendChild(bNS('line',{
      x1:pL,y1:yS(expTotal),x2:pL+cW,y2:yS(expTotal),
      stroke:'rgba(192,57,43,0.55)','stroke-width':'1.8','stroke-dasharray':'7 5'}));
  }

  // ── LÍNEA DE RESULTADO (suavizada) ──
  svgEl.appendChild(bNS('path',{d:smoothLine(profPts),fill:'none',stroke:profColor,
    'stroke-width':'2.5','stroke-linecap':'round','stroke-linejoin':'round'}));

  // ── LÍNEA DE INGRESOS (suavizada, dorada) ──
  svgEl.appendChild(bNS('path',{d:smoothLine(incPts),fill:'none',stroke:'#C9B96A',
    'stroke-width':'2.5','stroke-linecap':'round','stroke-linejoin':'round'}));

  // ── PUNTOS EN CADA MES (pequeños, Apple style) ──
  months.forEach((_,i)=>{
    const isLast=i===months.length-1;
    // Ingresos
    svgEl.appendChild(bNS('circle',{cx:xS(i),cy:yS(incomes[i]),r:isLast?'5':'2.5',
      fill:'white',stroke:'#C9B96A','stroke-width':'2'}));
    // Resultado
    svgEl.appendChild(bNS('circle',{cx:xS(i),cy:yS(profits[i]),r:isLast?'5':'2.5',
      fill:'white',stroke:profColor,'stroke-width':'2'}));
  });

  // ── VALOR DEL ÚLTIMO MES (badge flotante) ──
  [[incPts,'#C9B96A',incomes,'Ingresos'],[profPts,profColor,profits,'Resultado']].forEach(([pts,col,vals])=>{
    const i=pts.length-1;
    const [cx,cy]=pts[i];
    const val=fmtK(vals[i]);
    const tw=val.length*7+16;
    const bx=Math.min(cx-tw/2, pL+cW-tw-4);
    const by=cy-30;
    // Fondo del badge
    svgEl.appendChild(bNS('rect',{x:bx,y:by,width:tw,height:20,rx:'10',
      fill:col,opacity:'0.15'}));
    const lbl=bNS('text',{x:bx+tw/2,y:by+13.5,'text-anchor':'middle',
      'font-size':'11','font-family':"'Inter',sans-serif",'font-weight':'700',fill:col});
    lbl.textContent=val;
    svgEl.appendChild(lbl);
  });

  // Puntos en la línea de ingresos
  incomes.forEach((v,i)=>{
    const isLast=i===months.length-1;
    svgEl.appendChild(bNS('circle',{cx:xS(i),cy:yS(v),r:isLast?'4.5':'2.5',
      fill:isLast?'#C9B96A':'white',stroke:'#C9B96A','stroke-width':'1.8'}));
    // Valor del último punto
    if(isLast&&v>0){
      const lbl=bNS('text',{x:xS(i),y:yS(v)-8,'text-anchor':'middle',
        'font-size':'10','font-family':"'Inter',sans-serif",'font-weight':'600',fill:'#C9B96A'});
      lbl.textContent=fmtK(v);
      svgEl.appendChild(lbl);
    }
  });

  // ── ETIQUETAS EJE X ──
  months.forEach((m,i)=>{
    if(months.length>8&&i%2!==0&&i!==months.length-1) return;
    const lbl=bNS('text',{x:xS(i),y:H-pB+22,'text-anchor':'middle',
      'font-size':'11','font-family':"'Inter',sans-serif",fill:'var(--text-tertiary)'});
    lbl.textContent=m.label;
    svgEl.appendChild(lbl);
  });
}

window.updatePrecio=async function(clienteId,val){
  const precio=Math.max(0,parseFloat(val)||0);
  const {error}=await db.from('clientes').update({precio_mensual:precio}).eq('id',clienteId);
  if(error){ showToast('Error al guardar precio',true); return; }
  const c=balanceClients.find(c=>c.id===clienteId);
  if(c) c.precio_mensual=precio;
  renderBalance();
  showToast('Precio actualizado');
};

window.openGastoModal=function(mode,id){
  gastoModalMode=mode; gastoActiveId=id;
  const save=document.getElementById('gasto-save');
  if(mode==='create'){
    document.getElementById('gasto-modal-title').textContent='Nuevo gasto';
    document.getElementById('gasto-modal-sub').textContent='Agregá un gasto mensual de la empresa';
    document.getElementById('gf-nombre').value='';
    document.getElementById('gf-categoria').value='Operativo';
    document.getElementById('gf-monto').value='';
    document.getElementById('gf-notas').value='';
    document.getElementById('gf-recurrente').checked=true;
    document.getElementById('gf-activo').checked=true;
    save.textContent='Crear gasto';
  } else {
    const g=gastos.find(g=>g.id===id);
    document.getElementById('gasto-modal-title').textContent='Editar gasto';
    document.getElementById('gasto-modal-sub').textContent=g.nombre;
    document.getElementById('gf-nombre').value=g.nombre;
    document.getElementById('gf-categoria').value=g.categoria;
    document.getElementById('gf-monto').value=parseFloat(g.monto).toFixed(2);
    document.getElementById('gf-notas').value=g.notas||'';
    document.getElementById('gf-recurrente').checked=g.recurrente;
    document.getElementById('gf-activo').checked=g.activo;
    save.textContent='Guardar';
  }
  document.getElementById('modal-gasto').classList.add('show');
  setTimeout(()=>document.getElementById('gf-nombre').focus(),60);
};
window.closeGastoModal=()=>document.getElementById('modal-gasto').classList.remove('show');

window.saveGasto=async function(){
  const nombre=document.getElementById('gf-nombre').value.trim();
  const categoria=document.getElementById('gf-categoria').value;
  const monto=parseFloat(document.getElementById('gf-monto').value)||0;
  const notas=document.getElementById('gf-notas').value.trim()||null;
  const recurrente=document.getElementById('gf-recurrente').checked;
  const activo=document.getElementById('gf-activo').checked;
  if(!nombre||monto<0){ showToast('Completá concepto y monto',true); return; }
  const btn=document.getElementById('gasto-save');
  btn.disabled=true; btn.textContent=gastoModalMode==='create'?'Creando...':'Guardando...';
  try{
    if(gastoModalMode==='create'){
      const {data,error}=await db.from('gastos').insert({nombre,categoria,monto,notas,recurrente,activo}).select().single();
      if(error) throw error;
      gastos.unshift(data);
      showToast(`Gasto "${nombre}" creado`);
    } else {
      const {data,error}=await db.from('gastos').update({nombre,categoria,monto,notas,recurrente,activo}).eq('id',gastoActiveId).select().single();
      if(error) throw error;
      const idx=gastos.findIndex(g=>g.id===gastoActiveId);
      if(idx>=0) gastos[idx]=data;
      showToast('Gasto actualizado');
    }
    closeGastoModal(); renderBalance();
  } catch(e){ showToast('Error: '+e.message,true); }
  finally{ btn.disabled=false; btn.textContent=gastoModalMode==='create'?'Crear gasto':'Guardar'; }
};

async function removeGasto(id){
  const g=gastos.find(g=>g.id===id);
  const ok=await confirmDialog('Eliminar gasto',`¿Eliminar "${g.nombre}" de los gastos?`);
  if(!ok) return;
  const {error}=await db.from('gastos').delete().eq('id',id);
  if(error){ showToast('Error: '+error.message,true); return; }
  gastos=gastos.filter(g=>g.id!==id);
  showToast('Gasto eliminado'); renderBalance();
}

window.loadBalance=loadBalance;

// ── DISPOSITIVOS ──
let dispositivos=[], dispModalMode='create', dispActiveId=null;

async function loadDispositivos(){
  setStatus(true,'Cargando...');

  // Cargar dispositivos registrados (+ no registrados solo para admin)
  let dispQuery=db.from('dispositivos')
    .select('id,mac_address,nombre,activo,cliente_id,created_at,clientes(nombre)')
    .order('created_at',{ascending:false});
  if(isClienteMode()) dispQuery=dispQuery.eq('cliente_id',currentClienteId);

  const promises=[dispQuery];
  if(!isClienteMode()) promises.push(db.rpc('get_unregistered_devices'));
  const [{data:dispData,error:dispErr}, unregResult]=await Promise.all(promises);
  const unregData=unregResult?.data||[];

  if(dispErr){ setStatus(false,'Error de conexión'); showToast('Error: '+dispErr.message,true); return; }
  dispositivos=dispData||[];
  setStatus(true,'Conectado');

  // Poblar filtro clientes
  const filterSel=document.getElementById('filter-cliente-disp');
  const cmap=new Map();
  dispositivos.forEach(d=>{ if(d.clientes) cmap.set(d.cliente_id,d.clientes.nombre); });
  filterSel.innerHTML='<option value="">Todos los clientes</option>'+
    [...cmap.entries()].map(([id,n])=>`<option value="${id}">${esc(n)}</option>`).join('');

  // Enriquecer registrados con última medición
  const macs=dispositivos.map(d=>d.mac_address).filter(Boolean);
  let lastMed={};
  if(macs.length){
    const {data:meds}=await db
      .from('mediciones').select('device_id,created_at')
      .in('device_id',macs).order('created_at',{ascending:false});
    (meds||[]).forEach(m=>{ if(!lastMed[m.device_id]) lastMed[m.device_id]=m.created_at; });
  }
  dispositivos.forEach(d=>{ d._lastMed=lastMed[d.mac_address]||null; });

  renderUnregistered(unregData||[]);
  renderDispositivos();
}

function renderUnregistered(list){
  const section=document.getElementById('unreg-section');
  const tbody=document.getElementById('tbody-unreg');
  const countEl=document.getElementById('unreg-count');
  const badge=document.getElementById('nav-unreg-badge');
  // Actualizar badge del nav
  if(list.length){ badge.textContent=list.length; badge.style.display=''; }
  else { badge.style.display='none'; }
  if(!list.length){ section.style.display='none'; return; }
  section.style.display='block';
  countEl.textContent=list.length;
  tbody.innerHTML=list.map(d=>{
    const fecha=d.last_seen
      ?new Date(d.last_seen).toLocaleString('es-AR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})
      :'—';
    return `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:7px;height:7px;border-radius:50%;background:#ff9500;flex-shrink:0"></div>
          <span class="mono-cell" style="font-size:13px;font-weight:600;color:var(--text-primary)">${esc(d.device_id)}</span>
        </div>
      </td>
      <td class="mono-cell" style="font-size:12px">${fecha}</td>
      <td>
        <span class="badge orange">● ${d.total_meds} medición${d.total_meds!=1?'es':''}</span>
      </td>
      <td style="text-align:right">
        <button class="btn primary" style="font-size:12px;padding:5px 10px" onclick="registrarDispositivo('${esc(d.device_id)}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:12px;height:12px"><path d="M12 5v14M5 12h14"/></svg>
          Registrar
        </button>
      </td>
    </tr>`;
  }).join('');
}

function renderDispositivos(){
  document.getElementById('filter-cliente-disp').style.display=isClienteMode()?'none':'';
  const q=document.getElementById('search-dispositivos').value.toLowerCase();
  const cid=isClienteMode()?String(currentClienteId):document.getElementById('filter-cliente-disp').value;
  const tbody=document.getElementById('tbody-dispositivos');
  const filtered=dispositivos.filter(d=>{
    const matchQ=(d.mac_address||'').toLowerCase().includes(q)||(d.nombre||'').toLowerCase().includes(q);
    const matchC=!cid||String(d.cliente_id)===cid;
    return matchQ&&matchC;
  });
  if(!filtered.length){
    tbody.innerHTML=`<tr><td colspan="7"><div class="empty-state"><div class="empty-title">Sin resultados</div><div class="empty-sub">No hay dispositivos registrados aún</div></div></td></tr>`;
    return;
  }
  tbody.innerHTML=filtered.map(d=>{
    const clientNom=d.clientes?esc(d.clientes.nombre):'—';
    const lastMedStr=d._lastMed
      ?new Date(d._lastMed).toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})
      :'<span style="color:var(--text-tertiary)">Sin mediciones</span>';
    const estadoBadge=d.activo
      ?'<span class="badge green">● Activo</span>'
      :'<span class="badge" style="background:rgba(0,0,0,0.06);color:var(--text-tertiary)">● Inactivo</span>';
    return `<tr>
      <td class="id-cell">#${d.id}</td>
      <td><span class="mono-cell" style="font-size:13px;font-weight:500;color:var(--text-primary)">${esc(d.mac_address)}</span></td>
      <td>${d.nombre?esc(d.nombre):'<span style="color:var(--text-tertiary)">—</span>'}</td>
      <td>${clientNom}</td>
      <td class="mono-cell" style="font-size:12px">${lastMedStr}</td>
      <td>${estadoBadge}</td>
      <td><div class="actions">
        <button class="icon-btn" data-da="edit" data-did="${d.id}" title="Editar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn danger" data-da="del" data-did="${d.id}" title="Eliminar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div></td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('button[data-da]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id=parseInt(btn.dataset.did);
      if(btn.dataset.da==='del') removeDispositivo(id); else openDispositivoModal('edit',id);
    });
  });
}

// Abre el modal desde un dispositivo no registrado (MAC ya conocida)
window.registrarDispositivo=function(mac){
  openDispositivoModal('create', null, mac);
};

window.openDispositivoModal=async function(mode, id, prefillMac=null){
  dispModalMode=mode; dispActiveId=id;
  const {data}=await db.from('clientes').select('id,nombre').order('nombre');
  document.getElementById('df-cliente').innerHTML=(data||[]).map(c=>`<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
  const save=document.getElementById('disp-save');

  if(mode==='create'){
    document.getElementById('disp-modal-title').textContent=
      prefillMac ? 'Registrar dispositivo' : 'Nuevo dispositivo';
    document.getElementById('disp-modal-sub').textContent=
      prefillMac ? `MAC detectada: ${prefillMac}` : 'Registrá el medidor y asignalo a un cliente';
    document.getElementById('df-mac').value=prefillMac||'';
    document.getElementById('df-mac').disabled=!!prefillMac; // si viene de "no registrado", la MAC no se edita
    document.getElementById('df-nombre').value='';
    document.getElementById('df-activo').checked=true;
    save.textContent='Registrar dispositivo';
  } else {
    const d=dispositivos.find(d=>d.id===id);
    document.getElementById('disp-modal-title').textContent='Editar dispositivo';
    document.getElementById('disp-modal-sub').textContent=d.mac_address;
    document.getElementById('df-cliente').value=d.cliente_id;
    document.getElementById('df-mac').value=d.mac_address;
    document.getElementById('df-mac').disabled=true;
    document.getElementById('df-nombre').value=d.nombre||'';
    document.getElementById('df-activo').checked=d.activo;
    save.textContent='Guardar';
  }
  document.getElementById('modal-dispositivo').classList.add('show');
  setTimeout(()=>{
    const focus = prefillMac ? 'df-nombre' : (mode==='create' ? 'df-mac' : 'df-nombre');
    document.getElementById(focus).focus();
  }, 60);
};
window.closeDispositivoModal=()=>document.getElementById('modal-dispositivo').classList.remove('show');

window.saveDispositivo=async function(){
  const mac=document.getElementById('df-mac').value.trim().toUpperCase();
  const nombre=document.getElementById('df-nombre').value.trim()||null;
  const cliente_id=parseInt(document.getElementById('df-cliente').value);
  const activo=document.getElementById('df-activo').checked;
  if(!mac||!cliente_id){ showToast('Completá MAC y cliente',true); return; }
  // Validar formato MAC básico
  if(!/^([0-9A-F]{2}[:\-]){5}[0-9A-F]{2}$/.test(mac)){
    showToast('Formato de MAC inválido (Ej: AA:BB:CC:DD:EE:FF)',true); return;
  }
  const btn=document.getElementById('disp-save');
  btn.disabled=true; btn.textContent=dispModalMode==='create'?'Creando...':'Guardando...';
  try{
    if(dispModalMode==='create'){
      // Llama al RPC que: registra el dispositivo, re-vincula mediciones existentes
      // al cliente asignado y crea vehículos nuevos si la patente no existe bajo ese cliente.
      const {data:res,error}=await db.rpc('asignar_dispositivo_a_cliente',{
        p_mac: mac,
        p_cliente_id: cliente_id,
        p_nombre: nombre
      });
      if(error) throw error;
      let msg=`Dispositivo ${mac} registrado`;
      if(res.vehiculos_creados>0) msg+=` · ${res.vehiculos_creados} vehículo${res.vehiculos_creados>1?'s':''} creado${res.vehiculos_creados>1?'s':''}`;
      if(res.mediciones_vinculadas>0) msg+=` · ${res.mediciones_vinculadas} medición${res.mediciones_vinculadas>1?'es':''} vinculadas`;
      showToast(msg);
    } else {
      const {data,error}=await db.from('dispositivos')
        .update({nombre,cliente_id,activo})
        .eq('id',dispActiveId)
        .select('id,mac_address,nombre,activo,cliente_id,created_at,clientes(nombre)').single();
      if(error) throw error;
      const idx=dispositivos.findIndex(d=>d.id===dispActiveId);
      if(idx>=0){ data._lastMed=dispositivos[idx]._lastMed; dispositivos[idx]=data; }
      showToast('Dispositivo actualizado');
    }
    closeDispositivoModal(); loadDispositivos(); // recarga todo incluyendo no registrados
  } catch(e){ showToast('Error: '+e.message,true); }
  finally{ btn.disabled=false; btn.textContent=dispModalMode==='create'?'Registrar dispositivo':'Guardar'; }
};

async function removeDispositivo(id){
  const d=dispositivos.find(d=>d.id===id);
  const ok=await confirmDialog('Eliminar dispositivo',`¿Eliminar el dispositivo ${d.mac_address}?`);
  if(!ok) return;
  const {error}=await db.from('dispositivos').delete().eq('id',id);
  if(error){ showToast('Error: '+error.message,true); return; }
  dispositivos=dispositivos.filter(d=>d.id!==id);
  showToast('Dispositivo eliminado');
  renderDispositivos();
}

document.getElementById('search-dispositivos').addEventListener('input',renderDispositivos);
document.getElementById('filter-cliente-disp').addEventListener('change',renderDispositivos);
window.loadDispositivos=loadDispositivos;

// ── VEHÍCULOS ──
let vehiculos=[], vehModalMode='create', vehActiveId=null;

async function loadVehiculos(){
  setStatus(true,'Cargando...');
  let q=db.from('vehiculos')
    .select('id,nombre,patente,numero,tipo_ruedas,activo,cliente_id,fecha_compra,ultimo_servicio,notas,clientes(nombre)')
    .order('nombre');
  if(isClienteMode()) q=q.eq('cliente_id',currentClienteId);
  const {data,error}=await q;
  if(error){ setStatus(false,'Error de conexión'); showToast('Error: '+error.message,true); return; }
  vehiculos=data||[];
  setStatus(true,'Conectado');
  // Poblar filtro de clientes
  const filterSel=document.getElementById('filter-cliente-veh');
  const clientSet=new Map();
  vehiculos.forEach(v=>{ if(v.clientes) clientSet.set(v.cliente_id, v.clientes.nombre); });
  filterSel.innerHTML='<option value="">Todos los clientes</option>'+
    [...clientSet.entries()].map(([id,n])=>`<option value="${id}">${esc(n)}</option>`).join('');
  renderVehiculos();
}

function renderVehiculos(){
  // En modo cliente ocultamos el filtro y columna de cliente
  document.getElementById('filter-cliente-veh').style.display=isClienteMode()?'none':'';
  const q=document.getElementById('search-vehiculos').value.toLowerCase();
  const cid=isClienteMode()?String(currentClienteId):document.getElementById('filter-cliente-veh').value;
  const tbody=document.getElementById('tbody-vehiculos');
  let filtered=vehiculos.filter(v=>{
    const matchQ=v.nombre.toLowerCase().includes(q)||(v.patente||'').toLowerCase().includes(q);
    const matchC=!cid||String(v.cliente_id)===cid;
    return matchQ&&matchC;
  });
  if(!filtered.length){
    tbody.innerHTML=`<tr><td colspan="7"><div class="empty-state"><div class="empty-title">Sin resultados</div><div class="empty-sub">Probá con otro término o filtro</div></div></td></tr>`;
    return;
  }
  tbody.innerHTML=filtered.map(v=>{
    const av=avatarFor(v.id);
    const clientNom=v.clientes?esc(v.clientes.nombre):'—';
    const estadoBadge=v.activo
      ?'<span class="badge green">● Activo</span>'
      :'<span class="badge" style="background:rgba(0,0,0,0.06);color:var(--text-tertiary)">● Inactivo</span>';
    return `<tr>
      <td class="id-cell">#${v.id}</td>
      <td><div class="name-cell"><div class="name-av ${av}">${v.nombre[0].toUpperCase()}</div>${esc(v.nombre)}</div></td>
      <td class="mono-cell">${v.patente?esc(v.patente):'—'}</td>
      <td>${clientNom}</td>
      <td><span class="badge blue">${v.tipo_ruedas} WHL</span></td>
      <td>${estadoBadge}</td>
      <td><div class="actions">
        <button class="icon-btn" data-va="neum" data-vid="${v.id}" title="Neumáticos">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="3" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="21"/><line x1="3" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="21" y2="12"/></svg>
        </button>
        <button class="icon-btn" data-va="edit" data-vid="${v.id}" title="Editar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn danger" data-va="del" data-vid="${v.id}" title="Eliminar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div></td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('button[data-va]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id=parseInt(btn.dataset.vid);
      if(btn.dataset.va==='del') removeVehiculo(id);
      else if(btn.dataset.va==='neum') openNeumaticosModal(id);
      else openVehiculoModal('edit',id);
    });
  });
}

window.openVehiculoModal=async function(mode,id){
  vehModalMode=mode; vehActiveId=id;
  const save=document.getElementById('veh-save');
  // Poblar select de clientes
  const {data}=await db.from('clientes').select('id,nombre').order('nombre');
  document.getElementById('vf-cliente').innerHTML=(data||[]).map(c=>`<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
  // Ocultar selector de cliente en modo cliente
  document.getElementById('vf-cliente').closest('.field').style.display=isClienteMode()?'none':'';
  if(isClienteMode()) document.getElementById('vf-cliente').value=currentClienteId;

  if(mode==='create'){
    document.getElementById('veh-modal-title').textContent='Nuevo vehículo';
    document.getElementById('veh-modal-sub').textContent='Completá los datos del vehículo';
    document.getElementById('vf-nombre').value='';
    document.getElementById('vf-patente').value='';
    document.getElementById('vf-numero').value='';
    document.getElementById('vf-ruedas').value='10';
    document.getElementById('vf-fecha-compra').value='';
    document.getElementById('vf-ultimo-servicio').value='';
    document.getElementById('vf-notas').value='';
    document.getElementById('vf-activo').checked=true;
    save.textContent='Crear vehículo';
  } else {
    const v=vehiculos.find(v=>v.id===id);
    document.getElementById('veh-modal-title').textContent=`Editar · ${v.nombre}`;
    document.getElementById('veh-modal-sub').textContent='Modificá los datos del vehículo';
    document.getElementById('vf-cliente').value=v.cliente_id;
    document.getElementById('vf-nombre').value=v.nombre;
    document.getElementById('vf-patente').value=v.patente||'';
    document.getElementById('vf-numero').value=v.numero||'';
    document.getElementById('vf-ruedas').value=String(v.tipo_ruedas);
    document.getElementById('vf-fecha-compra').value=v.fecha_compra||'';
    document.getElementById('vf-ultimo-servicio').value=v.ultimo_servicio||'';
    document.getElementById('vf-notas').value=v.notas||'';
    document.getElementById('vf-activo').checked=v.activo;
    save.textContent='Guardar';
  }
  document.getElementById('modal-vehiculo').classList.add('show');
  setTimeout(()=>document.getElementById('vf-nombre').focus(),60);
};
window.closeVehiculoModal=()=>document.getElementById('modal-vehiculo').classList.remove('show');

window.saveVehiculo=async function(){
  const nombre=document.getElementById('vf-nombre').value.trim();
  const patente=document.getElementById('vf-patente').value.trim().toUpperCase()||null;
  const numero=document.getElementById('vf-numero').value.trim()||null;
  const cliente_id=parseInt(document.getElementById('vf-cliente').value);
  const tipo_ruedas=parseInt(document.getElementById('vf-ruedas').value);
  const activo=document.getElementById('vf-activo').checked;
  const fecha_compra=document.getElementById('vf-fecha-compra').value||null;
  const ultimo_servicio=document.getElementById('vf-ultimo-servicio').value||null;
  const notas=document.getElementById('vf-notas').value.trim()||null;
  if(!nombre||!cliente_id){ showToast('Completá nombre y cliente',true); return; }
  const btn=document.getElementById('veh-save');
  btn.disabled=true; btn.textContent=vehModalMode==='create'?'Creando...':'Guardando...';
  const fields={nombre,patente,numero,cliente_id,tipo_ruedas,activo,fecha_compra,ultimo_servicio,notas};
  const sel='id,nombre,patente,numero,tipo_ruedas,activo,cliente_id,fecha_compra,ultimo_servicio,notas,clientes(nombre)';
  try{
    if(vehModalMode==='create'){
      const {data,error}=await db.from('vehiculos').insert(fields).select(sel).single();
      if(error) throw error;
      vehiculos.unshift(data);
      showToast(`${nombre} creado`);
    } else {
      const {data,error}=await db.from('vehiculos').update(fields).eq('id',vehActiveId).select(sel).single();
      if(error) throw error;
      const idx=vehiculos.findIndex(v=>v.id===vehActiveId);
      if(idx>=0) vehiculos[idx]=data;
      showToast('Vehículo actualizado');
    }
    closeVehiculoModal(); renderVehiculos();
  } catch(e){ showToast('Error: '+e.message,true); }
  finally{ btn.disabled=false; btn.textContent=vehModalMode==='create'?'Crear vehículo':'Guardar'; }
};

// ══════════════════════════════════════════════════
// MODAL NEUMÁTICOS — vista visual con SVG
// ══════════════════════════════════════════════════
let neumVehiculoId=null, neumSelPos=null, neumAssignments={}, neumStockCache=[];

// ── Dibujo del vehículo en modo asignación ──
function namedNS(t,a={}){ const e=document.createElementNS('http://www.w3.org/2000/svg',t); Object.entries(a).forEach(([k,v])=>e.setAttribute(k,v)); return e; }

function neumTireColor(pos){
  const n=neumAssignments[pos];
  if(!n||(!n.marca&&!n.modelo)) return {fill:'rgba(61,60,32,0.04)',stroke:'rgba(61,60,32,0.22)',text:'rgba(61,60,32,0.35)'};
  return {fill:'rgba(61,60,32,0.10)',stroke:'#3D3C20',text:'#3D3C20'};
}

function neumDrawTire(svg, cx, cy, pos, TW, TH, isAbove){
  const col=neumTireColor(pos);
  const isSel=neumSelPos===pos;
  const n=neumAssignments[pos];
  const RW=TH, RH=TW, rx=3;
  const x=cx-RW/2, y=cy-RH/2;
  const g=namedNS('g',{cursor:'pointer'});
  g.addEventListener('click',()=>neumSelectTire(pos));
  // fondo
  g.appendChild(namedNS('rect',{x,y,width:RW,height:RH,rx,fill:col.fill}));
  // borde
  g.appendChild(namedNS('rect',{x,y,width:RW,height:RH,rx,fill:'none',
    stroke:col.stroke,'stroke-width':isSel?'2.5':'1.8'}));
  // doble contorno interior
  const ins=3;
  g.appendChild(namedNS('rect',{x:x+ins,y:y+ins,width:RW-ins*2,height:RH-ins*2,rx:Math.max(1,rx-2),
    fill:'none',stroke:col.stroke,'stroke-width':'0.6',opacity:'0.5'}));
  // halo selección
  if(isSel) g.appendChild(namedNS('rect',{x:x-4,y:y-4,width:RW+8,height:RH+8,rx:rx+3,
    fill:'none',stroke:'#3D3C20','stroke-width':'1.2','stroke-dasharray':'3 2',opacity:'0.5'}));
  // marca abreviada o "P{n}"
  const label=n?.marca ? n.marca.substring(0,6) : `P${pos}`;
  const t=namedNS('text',{x:cx,y:cy,'text-anchor':'middle','dominant-baseline':'middle',
    'font-size':'6.5','font-family':"'Inter',sans-serif",'font-weight':'600',fill:col.text});
  t.textContent=label;
  g.appendChild(t);
  // label posición
  const ly=isAbove ? y-7 : y+RH+11;
  const pl=namedNS('text',{x:cx,y:ly,'text-anchor':'middle',
    'font-size':'7','font-family':"'Inter',sans-serif",'font-weight':'400',
    fill:isSel?'#3D3C20':'rgba(61,60,32,0.38)','letter-spacing':'0.04em'});
  pl.textContent=`P${pos}`;
  g.appendChild(pl);
  svg.appendChild(g);
}

function neumDrawTruck(){
  const v=vehiculos.find(x=>x.id===neumVehiculoId);
  const key=String(v?.tipo_ruedas||10);
  const cfg=MED_CFG[key]; if(!cfg) return;
  const svg=document.getElementById('neum-assign-svg');
  svg.innerHTML='';
  const TW_s=20,TH_s=54,TW_d=15,TH_d=38,GAP_D=5,BGAP=12;
  let axleXs,bodyX1,bodyX2;
  if(key==='10'){ axleXs=[150,440,580]; bodyX1=64; bodyX2=730; }
  else           { axleXs=[120,310,420,530,640]; bodyX1=50; bodyX2=780; }
  const outerR=Math.max(BGAP+TW_d+GAP_D+TW_d, BGAP+TW_s);
  const bodyH=86, margin=28, labelExtra=22;
  const H=bodyH+(outerR+labelExtra+margin)*2;
  const W=key==='10'?860:900;
  const midY=H/2, bodyTop=midY-bodyH/2, bodyBot=midY+bodyH/2;
  const bodyW=bodyX2-bodyX1, cabW=90;
  const INK='rgba(50,49,25,';
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  svg.setAttribute('height',String(Math.round(H)));

  // Grid fondo
  const defs=namedNS('defs',{});
  const pat=namedNS('pattern',{id:'ngrid',width:'20',height:'20',patternUnits:'userSpaceOnUse'});
  pat.appendChild(namedNS('path',{d:'M 20 0 L 0 0 0 20',fill:'none',stroke:INK+'0.06)','stroke-width':'0.5'}));
  defs.appendChild(pat); svg.appendChild(defs);
  svg.appendChild(namedNS('rect',{x:0,y:0,width:W,height:H,fill:'url(#ngrid)'}));

  // Ejes
  axleXs.forEach(ax=>{
    svg.appendChild(namedNS('line',{x1:ax,y1:margin/2,x2:ax,y2:H-margin/2,
      stroke:INK+'0.14)','stroke-width':'1','stroke-dasharray':'8 5','stroke-linecap':'round'}));
    svg.appendChild(namedNS('line',{x1:ax,y1:bodyTop,x2:ax,y2:bodyBot,
      stroke:INK+'0.28)','stroke-width':'1.2'}));
    [bodyTop,bodyBot].forEach(ey=>{
      svg.appendChild(namedNS('circle',{cx:ax,cy:ey,r:'2.5',
        fill:'white',stroke:INK+'0.30)','stroke-width':'0.8'}));
    });
  });
  // Línea central
  svg.appendChild(namedNS('line',{x1:bodyX1-20,y1:midY,x2:bodyX2+20,y2:midY,
    stroke:INK+'0.10)','stroke-width':'0.8','stroke-dasharray':'10 6'}));

  // Carrocería
  svg.appendChild(namedNS('rect',{x:bodyX1+2,y:bodyTop+2,width:bodyW,height:bodyH,rx:6,fill:'rgba(0,0,0,0.05)'}));
  svg.appendChild(namedNS('rect',{x:bodyX1,y:bodyTop,width:bodyW,height:bodyH,rx:6,
    fill:'rgba(61,60,32,0.07)',stroke:'#3D3C20','stroke-width':'1.5'}));
  const wi=5;
  svg.appendChild(namedNS('rect',{x:bodyX1+wi,y:bodyTop+wi,width:bodyW-wi*2,height:bodyH-wi*2,rx:3,
    fill:'none',stroke:INK+'0.20)','stroke-width':'0.7'}));
  // Cabina
  svg.appendChild(namedNS('rect',{x:bodyX1,y:bodyTop,width:cabW,height:bodyH,rx:6,fill:'rgba(61,60,32,0.10)',stroke:'none'}));
  svg.appendChild(namedNS('line',{x1:bodyX1+cabW,y1:bodyTop+wi+2,x2:bodyX1+cabW,y2:bodyBot-wi-2,
    stroke:INK+'0.25)','stroke-width':'0.8','stroke-dasharray':'4 3'}));
  svg.appendChild(namedNS('path',{d:`M ${bodyX1+6} ${bodyTop+14} Q ${bodyX1+3} ${midY} ${bodyX1+6} ${bodyBot-14}`,
    fill:'none',stroke:INK+'0.35)','stroke-width':'1.2'}));
  // Luces
  [[bodyTop+10,10],[bodyBot-20,10]].forEach(([fy,fh])=>{
    svg.appendChild(namedNS('rect',{x:bodyX1-5,y:fy,width:5,height:fh,rx:2,fill:'rgba(61,60,32,0.55)',stroke:'#3D3C20','stroke-width':'0.6'}));
  });
  [[bodyTop+12,14],[bodyBot-26,14]].forEach(([ry,rh])=>{
    svg.appendChild(namedNS('rect',{x:bodyX2,y:ry,width:5,height:rh,rx:2,fill:'rgba(61,60,32,0.25)',stroke:'#3D3C20','stroke-width':'0.6'}));
  });
  // Etiqueta frente
  const lf=namedNS('text',{x:bodyX1+cabW/2,y:bodyTop-12,'text-anchor':'middle','font-size':'7',
    'font-family':"'Inter',sans-serif",'font-weight':'500',fill:INK+'0.35)','letter-spacing':'0.14em'});
  lf.textContent='FRENTE'; svg.appendChild(lf);

  // Neumáticos
  cfg.forEach((axle,ai)=>{
    const ax=axleXs[ai]; if(ax===undefined) return;
    if(axle.single){
      const L=axle.positions.find(p=>p.side==='L');
      const R=axle.positions.find(p=>p.side==='R');
      if(L) neumDrawTire(svg,ax,bodyTop-BGAP-TW_s/2,L.pos,TW_s,TH_s,true);
      if(R) neumDrawTire(svg,ax,bodyBot+BGAP+TW_s/2,R.pos,TW_s,TH_s,false);
    } else {
      const LL=axle.positions.find(p=>p.side==='LL');
      const LR=axle.positions.find(p=>p.side==='LR');
      const RL=axle.positions.find(p=>p.side==='RL');
      const RR=axle.positions.find(p=>p.side==='RR');
      const cyLI=bodyTop-BGAP-TW_d/2, cyLO=cyLI-TW_d-GAP_D;
      const cyRI=bodyBot+BGAP+TW_d/2, cyRO=cyRI+TW_d+GAP_D;
      if(LR) neumDrawTire(svg,ax,cyLI,LR.pos,TW_d,TH_d,true);
      if(LL) neumDrawTire(svg,ax,cyLO,LL.pos,TW_d,TH_d,true);
      if(RL) neumDrawTire(svg,ax,cyRI,RL.pos,TW_d,TH_d,false);
      if(RR) neumDrawTire(svg,ax,cyRO,RR.pos,TW_d,TH_d,false);
    }
  });
}

function neumSelectTire(pos){
  neumSelPos=pos;
  neumDrawTruck();
  renderNeumDetailPanel(pos);
}

function renderNeumDetailPanel(pos){
  const n=neumAssignments[pos]||{};
  const stockOpts=neumStockCache.map(s=>
    `<option value="${s.id}" ${n.stock_id===s.id?'selected':''}>
      ${esc(s.marca)}${s.modelo?' '+esc(s.modelo):''} ${s.precio_unidad?'· $'+s.precio_unidad:''} ${s.fecha_compra?'· '+s.fecha_compra:''}
    </option>`).join('');
  const panel=document.getElementById('neum-detail-panel');
  panel.innerHTML=`
    <div class="ndp-header">
      <div class="ndp-title">Posición <strong>P${pos}</strong></div>
      <button class="ndp-clear" onclick="neumClearPos(${pos})" title="Quitar neumático">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="field" style="margin-bottom:10px">
      <label>Seleccionar del stock</label>
      <select id="ndp-stock" onchange="neumFillFromStock(${pos})">
        <option value="">— Ingresar manualmente —</option>
        ${stockOpts}
      </select>
    </div>
    <div class="field-row" style="gap:8px">
      <div class="field"><label>Marca</label><input id="ndp-marca" value="${esc(n.marca||'')}" placeholder="Michelin"/></div>
      <div class="field"><label>Modelo</label><input id="ndp-modelo" value="${esc(n.modelo||'')}" placeholder="X MultiWay"/></div>
    </div>
    <div class="field-row" style="gap:8px">
      <div class="field"><label>Precio/ud</label><input id="ndp-precio" type="number" value="${n.precio_unidad??''}" placeholder="0.00" min="0" step="0.01"/></div>
      <div class="field"><label>Fecha compra</label><input id="ndp-fecha" type="date" value="${n.fecha_compra||''}"/></div>
    </div>
    <div class="field"><label>Notas</label><textarea id="ndp-notas" rows="2" placeholder="Dimensión, observaciones...">${esc(n.notas||'')}</textarea></div>
    <button class="btn primary ndp-btn" onclick="neumApplyPos(${pos})">Aplicar</button>
  `;
}

window.neumFillFromStock=function(pos){
  const sid=parseInt(document.getElementById('ndp-stock').value);
  if(!sid) return;
  const s=neumStockCache.find(x=>x.id===sid); if(!s) return;
  document.getElementById('ndp-marca').value=s.marca||'';
  document.getElementById('ndp-modelo').value=s.modelo||'';
  document.getElementById('ndp-precio').value=s.precio_unidad??'';
  document.getElementById('ndp-fecha').value=s.fecha_compra||'';
};

window.neumApplyPos=function(pos){
  const sid=parseInt(document.getElementById('ndp-stock').value)||null;
  const precio=document.getElementById('ndp-precio').value;
  neumAssignments[pos]={
    ...( neumAssignments[pos]||{} ),
    stock_id:sid,
    marca:document.getElementById('ndp-marca').value.trim()||null,
    modelo:document.getElementById('ndp-modelo').value.trim()||null,
    precio_unidad:precio!==''&&precio!=null?parseFloat(precio):null,
    fecha_compra:document.getElementById('ndp-fecha').value||null,
    notas:document.getElementById('ndp-notas').value.trim()||null
  };
  neumDrawTruck(); // actualizar colores
  showToast(`P${pos} actualizada — guardá para confirmar`,false);
};

window.neumClearPos=function(pos){
  delete neumAssignments[pos];
  neumSelPos=null;
  document.getElementById('neum-detail-panel').innerHTML=
    '<div class="neum-no-sel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:32px;height:32px;color:var(--text-tertiary)"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg><span>Seleccioná una rueda</span></div>';
  neumDrawTruck();
};

window.openNeumaticosModal=async function(vehiculoId){
  neumVehiculoId=vehiculoId; neumSelPos=null; neumAssignments={};
  const v=vehiculos.find(x=>x.id===vehiculoId);
  document.getElementById('neum-modal-title').textContent=`Neumáticos · ${v?.nombre||''}`;
  document.getElementById('modal-neumaticos').classList.add('show');
  document.getElementById('neum-detail-panel').innerHTML=
    '<div class="neum-no-sel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:32px;height:32px;color:var(--text-tertiary)"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg><span>Seleccioná una rueda</span></div>';

  // Carga paralela: registros existentes + stock del cliente
  const [{data:nData},{data:sData}]=await Promise.all([
    db.from('neumaticos').select('*').eq('vehiculo_id',vehiculoId),
    db.from('stock_neumaticos').select('*').eq('cliente_id',v.cliente_id).order('marca')
  ]);
  (nData||[]).forEach(n=>{ neumAssignments[n.posicion]=n; });
  neumStockCache=sData||[];
  neumDrawTruck();
};

window.closeNeumaticosModal=function(){
  document.getElementById('modal-neumaticos').classList.remove('show');
};

window.saveNeumaticos=async function(){
  const v=vehiculos.find(x=>x.id===neumVehiculoId); if(!v) return;
  const btn=document.getElementById('neum-save');
  btn.disabled=true; btn.textContent='Guardando...';
  try{
    const rows=Object.entries(neumAssignments).map(([pos,n])=>({
      vehiculo_id:neumVehiculoId,
      cliente_id:v.cliente_id,
      posicion:parseInt(pos),
      stock_id:n.stock_id||null,
      marca:n.marca||null,
      modelo:n.modelo||null,
      precio_unidad:n.precio_unidad!=null?n.precio_unidad:null,
      fecha_compra:n.fecha_compra||null,
      notas:n.notas||null
    }));
    if(rows.length){
      const {error}=await db.from('neumaticos').upsert(rows,{onConflict:'vehiculo_id,posicion'});
      if(error) throw error;
    }
    showToast('Neumáticos guardados');
    closeNeumaticosModal();
  } catch(e){ showToast('Error: '+e.message,true); }
  finally{ btn.disabled=false; btn.textContent='Guardar todo'; }
};

// ══════════════════════════════════════════════════
// STOCK DE NEUMÁTICOS
// ══════════════════════════════════════════════════
let stockItems=[], stockModalMode='create', stockActiveId=null;
let stockAssignMap={}; // stock_id → [{vehiculo_nombre, count}]

async function loadStockAssignments(){
  // Carga asignaciones de neumaticos con stock_id para el cliente actual
  let q=db.from('neumaticos').select('stock_id,vehiculos(nombre)').not('stock_id','is',null);
  if(isClienteMode()) q=q.eq('cliente_id',currentClienteId);
  const {data}=await q;
  stockAssignMap={};
  (data||[]).forEach(n=>{
    if(!n.stock_id) return;
    const vnom=n.vehiculos?.nombre||'Vehículo desconocido';
    if(!stockAssignMap[n.stock_id]) stockAssignMap[n.stock_id]={};
    stockAssignMap[n.stock_id][vnom]=(stockAssignMap[n.stock_id][vnom]||0)+1;
  });
}

async function loadStock(){
  const tbody=document.getElementById('tbody-stock');
  tbody.innerHTML='<tr><td colspan="9"><div class="loading-state"><div class="spinner"></div></div></td></tr>';
  let sq=db.from('stock_neumaticos')
    .select('id,marca,modelo,cliente_id,precio_unidad,fecha_compra,cantidad,notas,clientes(nombre)')
    .order('created_at',{ascending:false});
  if(isClienteMode()) sq=sq.eq('cliente_id',currentClienteId);
  const {data,error}=await sq;
  if(error){ showToast('Error: '+error.message,true); return; }
  stockItems=data||[];
  // Poblar filtro clientes
  const sel=document.getElementById('filter-cliente-stock');
  const cmap=new Map();
  stockItems.forEach(s=>{ if(s.clientes) cmap.set(s.cliente_id,s.clientes.nombre); });
  sel.innerHTML='<option value="">Todos los clientes</option>'+
    [...cmap.entries()].map(([id,n])=>`<option value="${id}">${esc(n)}</option>`).join('');
  await loadStockAssignments();
  renderStock();
}

function renderStock(){
  document.getElementById('filter-cliente-stock').style.display=isClienteMode()?'none':'';
  const q=document.getElementById('search-stock').value.toLowerCase();
  const cid=isClienteMode()?String(currentClienteId):document.getElementById('filter-cliente-stock').value;
  const tbody=document.getElementById('tbody-stock');
  const filtered=stockItems.filter(s=>{
    const mq=(s.marca||'').toLowerCase().includes(q)||(s.modelo||'').toLowerCase().includes(q);
    const mc=!cid||String(s.cliente_id)===cid;
    return mq&&mc;
  });
  if(!filtered.length){
    tbody.innerHTML=`<tr><td colspan="9"><div class="empty-state"><div class="empty-title">Sin resultados</div></div></td></tr>`;
    return;
  }
  tbody.innerHTML=filtered.map(s=>{
    const assigns=stockAssignMap[s.id]||{};
    const totalAsig=Object.values(assigns).reduce((a,b)=>a+b,0);
    const libre=(s.cantidad||0)-totalAsig;
    const hasAsig=totalAsig>0;
    const asigBadge=hasAsig
      ? `<button class="stock-asig-btn" data-sid="${s.id}" title="Ver detalle de asignación">
           <span class="badge green">${totalAsig} asig.</span>
           <span style="color:var(--text-tertiary);font-size:11px">/ ${s.cantidad} ud.</span>
         </button>`
      : `<span class="badge" style="background:var(--surface-secondary);color:var(--text-tertiary);border:1px solid var(--border)">0 / ${s.cantidad} ud.</span>`;
    return `<tr data-srow="${s.id}">
      <td><strong>${esc(s.marca)}</strong></td>
      <td>${s.modelo?esc(s.modelo):'<span style="color:var(--text-tertiary)">—</span>'}</td>
      <td>${s.clientes?esc(s.clientes.nombre):'—'}</td>
      <td>${s.precio_unidad!=null?'$'+parseFloat(s.precio_unidad).toLocaleString('es-AR',{minimumFractionDigits:2}):'—'}</td>
      <td>${s.fecha_compra?new Date(s.fecha_compra+'T00:00:00').toLocaleDateString('es-AR'):'—'}</td>
      <td>${asigBadge}</td>
      <td style="max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-secondary);font-size:12px">${s.notas?esc(s.notas):'—'}</td>
      <td><div class="actions">
        <button class="icon-btn" data-sa="edit" data-sid="${s.id}" title="Editar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn danger" data-sa="del" data-sid="${s.id}" title="Eliminar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div></td>
    </tr>
    <tr class="stock-asig-detail" data-detail="${s.id}" style="display:none">
      <td colspan="8" style="padding:0">
        <div class="stock-asig-expand">
          <div class="stock-asig-expand-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
            Asignado a:
          </div>
          ${Object.entries(assigns).map(([vnom,cnt])=>`
            <div class="stock-asig-row">
              <span class="stock-asig-veh">${esc(vnom)}</span>
              <span class="badge blue">${cnt} ud.</span>
            </div>`).join('')}
          ${libre>0?`<div class="stock-asig-row" style="opacity:.6">
            <span style="color:var(--text-tertiary)">Sin asignar</span>
            <span class="badge" style="background:var(--surface-secondary);color:var(--text-tertiary);border:1px solid var(--border)">${libre} ud.</span>
          </div>`:''}
        </div>
      </td>
    </tr>`;
  }).join('');

  // Botón asignados: toggle detalle
  tbody.querySelectorAll('.stock-asig-btn').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      const sid=btn.dataset.sid;
      const detail=tbody.querySelector(`tr[data-detail="${sid}"]`);
      const isOpen=detail.style.display!=='none';
      // Cerrar todos
      tbody.querySelectorAll('.stock-asig-detail').forEach(r=>r.style.display='none');
      tbody.querySelectorAll('.stock-asig-btn').forEach(b=>b.classList.remove('active'));
      if(!isOpen){ detail.style.display=''; btn.classList.add('active'); }
    });
  });

  tbody.querySelectorAll('button[data-sa]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id=parseInt(btn.dataset.sid);
      if(btn.dataset.sa==='del') removeStock(id); else openStockModal('edit',id);
    });
  });
}

window.openStockModal=async function(mode,id){
  stockModalMode=mode; stockActiveId=id;
  const sfClienteField=document.getElementById('sf-cliente').closest('.field');
  if(isClienteMode()){
    sfClienteField.style.display='none';
    document.getElementById('sf-cliente').innerHTML=`<option value="${currentClienteId}">${esc(currentClienteNombre)}</option>`;
  } else {
    sfClienteField.style.display='';
    const {data}=await db.from('clientes').select('id,nombre').order('nombre');
    document.getElementById('sf-cliente').innerHTML=(data||[]).map(c=>`<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
  }
  if(mode==='create'){
    document.getElementById('stock-modal-title').textContent='Nueva compra de neumáticos';
    document.getElementById('sf-marca').value='';
    document.getElementById('sf-modelo').value='';
    document.getElementById('sf-cantidad').value='1';
    document.getElementById('sf-precio').value='';
    document.getElementById('sf-fecha').value='';
    document.getElementById('sf-notas').value='';
    document.getElementById('stock-save').textContent='Guardar';
  } else {
    const s=stockItems.find(x=>x.id===id);
    document.getElementById('stock-modal-title').textContent='Editar compra';
    document.getElementById('sf-cliente').value=s.cliente_id;
    document.getElementById('sf-marca').value=s.marca||'';
    document.getElementById('sf-modelo').value=s.modelo||'';
    document.getElementById('sf-cantidad').value=s.cantidad||1;
    document.getElementById('sf-precio').value=s.precio_unidad??'';
    document.getElementById('sf-fecha').value=s.fecha_compra||'';
    document.getElementById('sf-notas').value=s.notas||'';
    document.getElementById('stock-save').textContent='Guardar';
  }
  document.getElementById('modal-stock').classList.add('show');
  setTimeout(()=>document.getElementById('sf-marca').focus(),60);
};
window.closeStockModal=()=>document.getElementById('modal-stock').classList.remove('show');

window.saveStock=async function(){
  const marca=document.getElementById('sf-marca').value.trim();
  if(!marca){ showToast('La marca es obligatoria',true); return; }
  const cliente_id=parseInt(document.getElementById('sf-cliente').value);
  const precio=document.getElementById('sf-precio').value;
  const fields={
    cliente_id,
    marca,
    modelo:document.getElementById('sf-modelo').value.trim()||null,
    cantidad:parseInt(document.getElementById('sf-cantidad').value)||1,
    precio_unidad:precio!==''?parseFloat(precio):null,
    fecha_compra:document.getElementById('sf-fecha').value||null,
    notas:document.getElementById('sf-notas').value.trim()||null
  };
  const btn=document.getElementById('stock-save');
  btn.disabled=true; btn.textContent='Guardando...';
  // Buscar el nombre del cliente desde el select del formulario
  const clienteNombre=document.getElementById('sf-cliente').selectedOptions[0]?.text||'';
  try{
    if(stockModalMode==='create'){
      const {data,error}=await db.from('stock_neumaticos').insert(fields)
        .select('id,marca,modelo,cliente_id,precio_unidad,fecha_compra,cantidad,notas').single();
      if(error) throw error;
      stockItems.unshift({...data, clientes:{nombre:clienteNombre}});
    } else {
      const {data,error}=await db.from('stock_neumaticos').update(fields).eq('id',stockActiveId)
        .select('id,marca,modelo,cliente_id,precio_unidad,fecha_compra,cantidad,notas').single();
      if(error) throw error;
      const idx=stockItems.findIndex(x=>x.id===stockActiveId);
      if(idx>=0) stockItems[idx]={...data, clientes:{nombre:clienteNombre}};
    }
    renderStock();
    closeStockModal();
    showToast('Guardado');
  } catch(e){ showToast('Error: '+e.message,true); }
  finally{ btn.disabled=false; btn.textContent='Guardar'; }
};

async function removeStock(id){
  const s=stockItems.find(x=>x.id===id);
  const ok=await confirmDialog('Eliminar','¿Eliminar esta entrada del stock?'); if(!ok) return;
  const {error}=await db.from('stock_neumaticos').delete().eq('id',id);
  if(error){ showToast('Error: '+error.message,true); return; }
  stockItems=stockItems.filter(x=>x.id!==id);
  renderStock();
  showToast('Eliminado');
}

document.getElementById('search-stock').addEventListener('input',renderStock);
document.getElementById('filter-cliente-stock').addEventListener('change',renderStock);

// ── Sub-tabs de Vehículos ──
window.switchSubTab=function(tabId, btn){
  document.querySelectorAll('.sub-view').forEach(v=>v.style.display='none');
  document.querySelectorAll('.sub-tab').forEach(t=>t.classList.remove('active'));
  document.getElementById(tabId).style.display='';
  btn.classList.add('active');
  if(tabId==='sv-stock') loadStock();
};

async function removeVehiculo(id){
  const v=vehiculos.find(v=>v.id===id);
  const ok=await confirmDialog('Eliminar vehículo',`¿Eliminar "${v.nombre}"? Se perderán sus mediciones asociadas.`);
  if(!ok) return;
  const {error}=await db.from('vehiculos').delete().eq('id',id);
  if(error){ showToast('Error: '+error.message,true); return; }
  vehiculos=vehiculos.filter(v=>v.id!==id);
  showToast(`${v.nombre} eliminado`);
  renderVehiculos();
}

document.getElementById('search-vehiculos').addEventListener('input',renderVehiculos);
document.getElementById('filter-cliente-veh').addEventListener('change',renderVehiculos);
window.loadVehiculos=loadVehiculos;

// ── MEDICIONES TABS ──
let medMode='vehiculo';

document.querySelectorAll('.med-tab').forEach(tab=>{
  tab.addEventListener('click',()=>medSwitchMode(tab.dataset.mode));
});

function medSwitchMode(mode){
  medMode=mode;
  document.querySelectorAll('.med-tab').forEach(t=>t.classList.toggle('active',t.dataset.mode===mode));

  const isVeh=mode==='vehiculo';
  document.getElementById('med-panel-vehiculo').style.display   = isVeh?'block':'none';
  document.getElementById('med-panel-dispositivo').style.display= isVeh?'none':'block';
  document.getElementById('med-counters-card').style.display    = 'none';
  document.getElementById('med-sessions-card').style.display    = isVeh?'none':'flex';
  document.getElementById('med-truck-card').style.display       = 'none';
  document.getElementById('med-empty').style.display            = 'flex';
  document.getElementById('med-tire-detail').style.display      = 'none';
  document.getElementById('med-loading').style.display          = 'none';
  document.getElementById('med-empty-title').textContent        = isVeh?'Seleccioná un vehículo':'Seleccioná una sesión';
  document.getElementById('med-empty-sub').textContent          = isVeh?'Luego hacé clic en un neumático para ver sus mediciones':'Elegí un dispositivo y una sesión para ver el estado del camión';
  medTireData={}; medSelPos=null;
  if(!isVeh) medDeviceLoadDevices();
}

// ── MODO DISPOSITIVO ──
let medAllDevices=[], medSelDevice=null, medDeviceSessions=[], medSelSession=null;

async function medDeviceLoadDevices(){
  document.getElementById('med-device-list').innerHTML='<div class="loading-state"><div class="spinner"></div></div>';

  // MACs con mediciones (filtrar por cliente si aplica)
  let macQuery=db.from('mediciones').select('device_id').not('device_id','is',null);
  if(isClienteMode()) macQuery=macQuery.eq('cliente_id',currentClienteId);
  const {data:macRows}=await macQuery;
  const allMacs=[...new Set((macRows||[]).map(m=>m.device_id))].sort();

  // Dispositivos registrados (filtrar por cliente si aplica)
  let regQuery=db.from('dispositivos').select('mac_address,nombre,clientes(nombre)');
  if(isClienteMode()) regQuery=regQuery.eq('cliente_id',currentClienteId);
  const {data:regDevs}=await regQuery;
  const regMap={};
  (regDevs||[]).forEach(d=>{ regMap[d.mac_address]=d; });

  medAllDevices=allMacs.map(mac=>({
    mac,
    nombre: regMap[mac]?.nombre||null,
    cliente: regMap[mac]?.clientes?.nombre||null,
    registered: !!regMap[mac]
  }));

  medDeviceRenderList();
}

function medDeviceRenderList(){
  const q=(document.getElementById('med-device-search').value||'').toLowerCase();
  const container=document.getElementById('med-device-list');
  const filtered=medAllDevices.filter(d=>
    d.mac.toLowerCase().includes(q)||
    (d.nombre||'').toLowerCase().includes(q)||
    (d.cliente||'').toLowerCase().includes(q)
  );
  if(!filtered.length){
    container.innerHTML='<div style="padding:20px;text-align:center;font-size:13px;color:var(--text-tertiary)">Sin dispositivos</div>';
    return;
  }
  container.innerHTML=filtered.map(d=>`
    <div class="device-item ${medSelDevice===d.mac?'active':''}" onclick="medDeviceSelect('${d.mac.replace(/'/g,"\\'")}')">
      <div style="font-family:var(--font-mono);font-size:12px;font-weight:600;color:var(--text-primary)">${esc(d.mac)}</div>
      ${d.nombre?`<div style="font-size:11px;color:var(--text-secondary);margin-top:1px">${esc(d.nombre)}${d.cliente?' · '+esc(d.cliente):''}</div>`:''}
      ${!d.registered?'<div style="font-size:10px;color:var(--warning);margin-top:1px">● No registrado</div>':''}
    </div>`).join('');
}

document.getElementById('med-device-search').addEventListener('input',medDeviceRenderList);

window.medDeviceSelect=async function(mac){
  medSelDevice=mac; medDeviceRenderList();
  document.getElementById('med-sessions-sub').textContent=mac;
  document.getElementById('med-sessions-list').innerHTML='<div class="loading-state"><div class="spinner"></div>Cargando sesiones...</div>';
  document.getElementById('med-sessions-card').style.display='flex';

  const {data,error}=await db
    .from('mediciones')
    .select('posicion,mm1,mm2,mm3,promedio,created_at,vehiculo_id,patente_raw,numero_raw,vehiculos(nombre,patente,tipo_ruedas)')
    .eq('device_id',mac)
    .order('created_at',{ascending:false})
    .limit(2000);

  if(error){ showToast('Error: '+error.message,true); return; }

  // Agrupar por (vehiculo_id + segundo) — todos los inserts de un POST tienen el mismo timestamp
  const map={};
  (data||[]).forEach(m=>{
    const sec=new Date(m.created_at).toISOString().slice(0,19);
    const patchKey=m.vehiculo_id??m.patente_raw??m.numero_raw??'sin-veh';
    const key=`${patchKey}-${sec}`;
    if(!map[key]) map[key]={key,firstDate:m.created_at,sec,vehiculo_id:m.vehiculo_id,vehiculo:m.vehiculos,patente_raw:m.patente_raw,numero_raw:m.numero_raw,meds:[]};
    map[key].meds.push(m);
  });
  // Solo mostrar sesiones con todas las ruedas del vehículo
  medDeviceSessions=Object.values(map)
    .filter(s=>{
      const expected=s.vehiculo?.tipo_ruedas;
      if(!expected) return true;
      const positions=new Set(s.meds.map(m=>m.posicion)).size;
      return positions>=expected;
    })
    .sort((a,b)=>new Date(b.firstDate)-new Date(a.firstDate));
  medSelSession=null;
  medDeviceRenderSessions();
};

function medDeviceRenderSessions(){
  const container=document.getElementById('med-sessions-list');
  if(!medDeviceSessions.length){
    container.innerHTML='<div style="padding:32px;text-align:center;font-size:13px;color:var(--text-tertiary)">Sin sesiones registradas</div>';
    return;
  }
  container.innerHTML=medDeviceSessions.map((s,i)=>{
    const isActive=medSelSession===i;
    const fecha=new Date(s.firstDate).toLocaleString('es-AR',{
      day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'
    });
    const posiciones=new Set(s.meds.map(m=>m.posicion)).size;
    const avgs=s.meds.map(m=>m.promedio!=null?parseFloat(m.promedio):null).filter(v=>v!=null);
    const prom=avgs.length?(avgs.reduce((a,b)=>a+b,0)/avgs.length).toFixed(1):null;
    const veh=s.vehiculo;
    const rawLabel=s.patente_raw||s.numero_raw||null;
    const vehNom=veh
      ?`${esc(veh.nombre)}${veh.patente?' · '+esc(veh.patente):''}`
      :rawLabel?`<span style="color:var(--warning)">Sin asignar · ${esc(rawLabel)}</span>`:'Sin matrícula';
    const dotColor=isActive?'var(--accent-dark)':'var(--text-tertiary)';
    return `<div class="session-item ${isActive?'active':''}" onclick="medDeviceSessionSelect(${i})">
      <div class="session-dot" style="background:${dotColor}"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:${isActive?'600':'500'};color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${vehNom}</div>
        <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">
          ${fecha} &nbsp;·&nbsp; ${posiciones} rueda${posiciones!==1?'s':''}${prom?' &nbsp;·&nbsp; prom. <b>'+prom+'mm</b>':''}
        </div>
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;color:var(--text-tertiary);flex-shrink:0"><path d="M9 18l6-6-6-6"/></svg>
    </div>`;
  }).join('');
}

window.medDeviceSessionSelect=function(i){
  medSelSession=i;
  medDeviceRenderSessions();
  const session=medDeviceSessions[i];
  if(!session) return;

  // Tomar el tipo_ruedas del vehículo (o inferirlo de las posiciones)
  const tipoRuedas=session.vehiculo?.tipo_ruedas;
  const maxPos=Math.max(...session.meds.map(m=>parseInt(m.posicion)));
  medTipoRuedas=String(tipoRuedas||(maxPos>10?16:10));

  // Construir medTireData con la medición MÁS RECIENTE por posición de esta sesión
  medTireData={}; medSelPos=null;
  session.meds.forEach(m=>{
    const p=parseInt(m.posicion);
    if(!medTireData[p]) medTireData[p]=[];
    medTireData[p].push(m);
  });

  // Mostrar diagrama
  document.getElementById('med-truck-card').style.display='block';
  document.getElementById('med-counters-card').style.display='block';
  document.getElementById('med-empty').style.display='flex';
  document.getElementById('med-tire-detail').style.display='none';
  medDrawTruck();
  medUpdateCounters();
};

checkAuth();
