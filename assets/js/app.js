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

// AUTH — detecta rol
async function checkAuth(){
  const {data:{session}}=await db.auth.getSession();
  if(!session){ showLogin(); return; }
  // Verificar si es admin (no tiene fila en clientes)
  const {data:clienteRow}=await db.from('clientes').select('id').eq('auth_user_id',session.user.id).maybeSingle();
  if(clienteRow){
    // Es un cliente, no admin — por ahora redirigir al login con mensaje
    await db.auth.signOut();
    showLogin();
    document.getElementById('login-error').textContent='Este acceso es solo para administradores.';
    document.getElementById('login-error').classList.add('show');
    return;
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
  loadClients();
  // Chequear dispositivos no registrados al iniciar para mostrar el badge
  db.rpc('get_unregistered_devices').then(({data})=>{
    if(data&&data.length){
      const badge=document.getElementById('nav-unreg-badge');
      badge.textContent=data.length; badge.style.display='';
    }
  });
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
  // Detectar rol
  const {data:clienteRow}=await db.from('clientes').select('id').eq('auth_user_id',data.user.id).maybeSingle();
  if(clienteRow){
    await db.auth.signOut();
    err.textContent='Este acceso es solo para administradores.';
    err.classList.add('show'); return;
  }
  showApp(data.user);
});

document.getElementById('logout-btn').addEventListener('click',async()=>{
  await db.auth.signOut(); clients=[]; showLogin();
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

// NAV
document.querySelectorAll('.nav-item[data-view]').forEach(el=>{
  el.addEventListener('click',()=>{
    const v=el.dataset.view;
    document.querySelectorAll('.nav-item[data-view]').forEach(n=>n.classList.toggle('active',n.dataset.view===v));
    document.querySelectorAll('.view').forEach(vw=>vw.classList.toggle('active',vw.id===`view-${v}`));
    document.getElementById('breadcrumb-current').textContent={balance:'Balance',clientes:'Clientes',vehiculos:'Vehículos',dispositivos:'Dispositivos',mediciones:'Mediciones'}[v];
    if(v==='balance') loadBalance();
    if(v==='clientes') loadClients();
    if(v==='vehiculos') loadVehiculos();
    if(v==='dispositivos') loadDispositivos();
    if(v==='mediciones') medInit();
    closeSidebar();
  });
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
  const {data}=await db.from('clientes').select('id,nombre').order('nombre');
  const sel=document.getElementById('med-cliente-select');
  sel.innerHTML='<option value="">— Seleccionar cliente —</option>'+(data||[]).map(c=>`<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
  document.getElementById('med-vehiculo-select').innerHTML='<option value="">— Seleccionar vehículo —</option>';
  document.getElementById('med-vehiculo-select').disabled=true;
  document.getElementById('med-truck-card').style.display='none';
  document.getElementById('med-counters-card').style.display='none';
  document.getElementById('med-empty').style.display='flex';
  document.getElementById('med-tire-detail').style.display='none';
  document.getElementById('med-loading').style.display='none';
  medTireData={}; medSelPos=null; medSelDevice=null; medSelSession=null;
  // Resetear al tab activo y recargar dispositivos siempre
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

// ── NEUMÁTICO — diseño minimalista ──
function medDrawTire(svg, cx, cy, pos, TW, TH, isSingle, isAbove){
  const col=mTireColor(pos), isSel=medSelPos===pos, a=mLast(pos);
  const R=4; // border-radius del rectángulo
  const tx=cx-TW/2, ty=cy-TH/2;
  const g=medNS('g',{cursor:'pointer'});
  g.addEventListener('click',()=>medSelectTire(pos));

  // Glow exterior al seleccionar
  if(isSel){
    g.appendChild(medNS('rect',{
      x:tx-5,y:ty-5,width:TW+10,height:TH+10,rx:R+4,
      fill:'none',stroke:col.stroke,'stroke-width':'2',opacity:'0.5'
    }));
  }

  // Carcasa — negro con borde según estado
  g.appendChild(medNS('rect',{
    x:tx,y:ty,width:TW,height:TH,rx:R,
    fill:'#18181A',
    stroke:col.stroke,'stroke-width': isSel?'2':'1.5'
  }));

  // Relleno interior de color (estado)
  const pad=3;
  g.appendChild(medNS('rect',{
    x:tx+pad,y:ty+pad,width:TW-pad*2,height:TH-pad*2,rx:R-1,
    fill:col.fill
  }));

  // Hub — círculo central sutil
  const hr=isSingle?4:3;
  g.appendChild(medNS('circle',{cx,cy,r:hr,
    fill:'#18181A',stroke:col.stroke,'stroke-width':'1',opacity:'0.7'
  }));

  // Valor mm — dentro del neumático, tipografía limpia
  if(a!==null){
    const fs=isSingle?8:6.5;
    const vl=medNS('text',{
      x:cx, y:cy+(fs*0.38),
      'text-anchor':'middle','dominant-baseline':'middle',
      'font-size':fs,'font-family':"'Inter',sans-serif",
      'font-weight':'700',fill:col.text,
      'letter-spacing':'-0.02em'
    });
    vl.textContent=a.toFixed(1);
    g.appendChild(vl);
  }

  // Label posición — fuera del neumático
  const gap=TH/2+9;
  const ly=isAbove ? cy-gap : cy+gap+3;
  const pl=medNS('text',{
    x:cx,y:ly,'text-anchor':'middle',
    'font-size':'8.5','font-family':"'Inter',sans-serif",
    'font-weight': isSel?'600':'400',
    fill: isSel?col.stroke:'rgba(255,255,255,0.35)'
  });
  pl.textContent=`P${pos}`;
  g.appendChild(pl);

  svg.appendChild(g);
}

// ── CAMIÓN — diseño flat moderno ──
function medDrawTruck(){
  const key=String(medTipoRuedas);
  const svg=document.getElementById('med-truck-svg');
  svg.innerHTML='';
  const cfg=MED_CFG[key]; if(!cfg) return;

  const W=600, H=270;
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  svg.setAttribute('width','100%');
  svg.setAttribute('height','270');

  const midY=135, bodyH=76;
  const bodyTop=midY-bodyH/2, bodyBot=midY+bodyH/2;

  let axleXs, bodyX1, bodyX2;
  if(key==='10'){
    axleXs=[122,362,464]; bodyX1=52; bodyX2=544;
  } else {
    axleXs=[98,252,330,408,480]; bodyX1=40; bodyX2=556;
  }
  const bodyW=bodyX2-bodyX1;
  const cabW=88, cabX2=bodyX1+cabW;

  // ── DEFS ──
  const defs=medNS('defs',{});

  // Gradiente sutil del cuerpo (top-down depth)
  const gBody=medNS('linearGradient',{id:'trBody',x1:'0',y1:'0',x2:'0',y2:'1'});
  [{off:'0%',c:'#2C2C2E'},{off:'50%',c:'#242424'},{off:'100%',c:'#2C2C2E'}]
    .forEach(({off,c})=>{ const s=medNS('stop',{offset:off,'stop-color':c}); gBody.appendChild(s); });
  defs.appendChild(gBody);

  // Gradiente cabina (ligeramente más clara)
  const gCab=medNS('linearGradient',{id:'trCab',x1:'0',y1:'0',x2:'0',y2:'1'});
  [{off:'0%',c:'#38383A'},{off:'100%',c:'#2E2E30'}]
    .forEach(({off,c})=>{ const s=medNS('stop',{offset:off,'stop-color':c}); gCab.appendChild(s); });
  defs.appendChild(gCab);

  svg.appendChild(defs);

  // ── SOMBRA DEL CUERPO ──
  svg.appendChild(medNS('rect',{
    x:bodyX1+2,y:bodyTop+3,width:bodyW,height:bodyH,rx:12,
    fill:'rgba(0,0,0,0.5)'
  }));

  // ── CUERPO PRINCIPAL ──
  svg.appendChild(medNS('rect',{
    x:bodyX1,y:bodyTop,width:bodyW,height:bodyH,rx:12,
    fill:'url(#trBody)',stroke:'rgba(255,255,255,0.07)','stroke-width':'1'
  }));

  // ── CABINA (zona frontal) ──
  // Máscara de la cabina con clip (rx sólo en la izquierda)
  const cabPath=`M${bodyX1+12},${bodyTop} L${cabX2},${bodyTop} L${cabX2},${bodyBot} L${bodyX1+12},${bodyBot} Q${bodyX1},${bodyBot} ${bodyX1},${bodyBot-12} L${bodyX1},${bodyTop+12} Q${bodyX1},${bodyTop} ${bodyX1+12},${bodyTop} Z`;
  svg.appendChild(medNS('path',{d:cabPath,fill:'url(#trCab)'}));

  // Línea divisoria cabina / carga
  svg.appendChild(medNS('line',{
    x1:cabX2,y1:bodyTop+8,x2:cabX2,y2:bodyBot-8,
    stroke:'rgba(255,255,255,0.1)','stroke-width':'1.5','stroke-dasharray':'4 3'
  }));

  // ── TECHO / LUZ SUPERIOR ──
  // Línea de highlight en el borde superior del cuerpo
  svg.appendChild(medNS('line',{
    x1:bodyX1+14,y1:bodyTop+1,x2:bodyX2-8,y2:bodyTop+1,
    stroke:'rgba(255,255,255,0.1)','stroke-width':'1'
  }));

  // ── FRENTE DEL CAMIÓN ──
  // Nariz (path curvo limpio)
  const nx=bodyX1, n=14;
  svg.appendChild(medNS('path',{
    d:`M${nx},${bodyTop+n} Q${nx-12},${midY} ${nx},${bodyBot-n}`,
    fill:'none',stroke:'rgba(255,255,255,0.06)','stroke-width':'1'
  }));

  // Faros — dos píldoras pequeñas, dorado
  [[bodyTop+10,8],[bodyBot-18,8]].forEach(([fy,fh])=>{
    svg.appendChild(medNS('rect',{
      x:bodyX1-10,y:fy,width:8,height:fh,rx:3,
      fill:'#C9B96A',opacity:'0.9'
    }));
  });

  // ── PARTE TRASERA — luces rojas ──
  [[bodyTop+10,14],[bodyBot-24,14]].forEach(([ry,rh])=>{
    svg.appendChild(medNS('rect',{
      x:bodyX2+2,y:ry,width:5,height:rh,rx:2,
      fill:'#ff3b30',opacity:'0.75'
    }));
  });

  // ── EJES ──
  axleXs.forEach(ax=>{
    svg.appendChild(medNS('line',{
      x1:ax,y1:bodyTop-3,x2:ax,y2:bodyBot+3,
      stroke:'rgba(255,255,255,0.12)','stroke-width':'1.5','stroke-linecap':'round'
    }));
  });

  // Línea de transmisión central (muy sutil)
  svg.appendChild(medNS('line',{
    x1:axleXs[0],y1:midY,x2:axleXs[axleXs.length-1],y2:midY,
    stroke:'rgba(255,255,255,0.05)','stroke-width':'1','stroke-dasharray':'5 4'
  }));

  // Etiqueta FRENTE
  const fl=medNS('text',{x:bodyX1-2,y:bodyTop-7,'text-anchor':'middle',
    'font-size':'8','font-family':"'Inter',sans-serif",'font-weight':'600',
    fill:'rgba(255,255,255,0.25)','letter-spacing':'0.08em'});
  fl.textContent='FRENTE';
  svg.appendChild(fl);

  // ── NEUMÁTICOS ──
  const TW_s=20, TH_s=46;
  const TW_d=14, TH_d=32;
  const gap_d=5, bGap=9;

  cfg.forEach((axle,ai)=>{
    const ax=axleXs[ai]; if(!ax) return;
    if(axle.single){
      const L=axle.positions.find(p=>p.side==='L');
      const R=axle.positions.find(p=>p.side==='R');
      if(L) medDrawTire(svg,ax,bodyTop-bGap-TH_s/2,L.pos,TW_s,TH_s,true,true);
      if(R) medDrawTire(svg,ax,bodyBot+bGap+TH_s/2,R.pos,TW_s,TH_s,true,false);
    } else {
      const LL=axle.positions.find(p=>p.side==='LL');
      const LR=axle.positions.find(p=>p.side==='LR');
      const RL=axle.positions.find(p=>p.side==='RL');
      const RR=axle.positions.find(p=>p.side==='RR');
      const cyLI=bodyTop-bGap-TH_d/2;
      const cyLO=cyLI-TH_d-gap_d;
      const cyRI=bodyBot+bGap+TH_d/2;
      const cyRO=cyRI+TH_d+gap_d;
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

  // Cargar dispositivos registrados + no registrados en paralelo
  const [
    {data: dispData, error: dispErr},
    {data: unregData}
  ] = await Promise.all([
    db.from('dispositivos')
      .select('id,mac_address,nombre,activo,cliente_id,created_at,clientes(nombre)')
      .order('created_at',{ascending:false}),
    db.rpc('get_unregistered_devices')
  ]);

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
  const q=document.getElementById('search-dispositivos').value.toLowerCase();
  const cid=document.getElementById('filter-cliente-disp').value;
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
      const {data,error}=await db.from('dispositivos')
        .insert({mac_address:mac,nombre,cliente_id,activo})
        .select('id,mac_address,nombre,activo,cliente_id,created_at,clientes(nombre)').single();
      if(error) throw error;
      data._lastMed=null;
      dispositivos.unshift(data);
      showToast(`Dispositivo ${mac} creado`);
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
  const {data,error}=await db
    .from('vehiculos')
    .select('id,nombre,patente,tipo_ruedas,activo,cliente_id,clientes(nombre)')
    .order('nombre');
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
  const q=document.getElementById('search-vehiculos').value.toLowerCase();
  const cid=document.getElementById('filter-cliente-veh').value;
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
      if(btn.dataset.va==='del') removeVehiculo(id); else openVehiculoModal('edit',id);
    });
  });
}

window.openVehiculoModal=async function(mode,id){
  vehModalMode=mode; vehActiveId=id;
  const save=document.getElementById('veh-save');
  // Poblar select de clientes
  const {data}=await db.from('clientes').select('id,nombre').order('nombre');
  document.getElementById('vf-cliente').innerHTML=(data||[]).map(c=>`<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
  if(mode==='create'){
    document.getElementById('veh-modal-title').textContent='Nuevo vehículo';
    document.getElementById('veh-modal-sub').textContent='Completá los datos del vehículo';
    document.getElementById('vf-nombre').value='';
    document.getElementById('vf-patente').value='';
    document.getElementById('vf-numero').value='';
    document.getElementById('vf-ruedas').value='10';
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
  if(!nombre||!cliente_id){ showToast('Completá nombre y cliente',true); return; }
  const btn=document.getElementById('veh-save');
  btn.disabled=true; btn.textContent=vehModalMode==='create'?'Creando...':'Guardando...';
  try{
    if(vehModalMode==='create'){
      const {data,error}=await db.from('vehiculos').insert({nombre,patente,numero,cliente_id,tipo_ruedas,activo}).select('id,nombre,patente,numero,tipo_ruedas,activo,cliente_id,clientes(nombre)').single();
      if(error) throw error;
      vehiculos.unshift(data);
      showToast(`${nombre} creado`);
    } else {
      const {data,error}=await db.from('vehiculos').update({nombre,patente,numero,cliente_id,tipo_ruedas,activo}).eq('id',vehActiveId).select('id,nombre,patente,numero,tipo_ruedas,activo,cliente_id,clientes(nombre)').single();
      if(error) throw error;
      const idx=vehiculos.findIndex(v=>v.id===vehActiveId);
      if(idx>=0) vehiculos[idx]=data;
      showToast('Vehículo actualizado');
    }
    closeVehiculoModal(); renderVehiculos();
  } catch(e){ showToast('Error: '+e.message,true); }
  finally{ btn.disabled=false; btn.textContent=vehModalMode==='create'?'Crear vehículo':'Guardar'; }
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

  // Todos los MACs con mediciones
  const {data:macRows}=await db.from('mediciones').select('device_id').not('device_id','is',null);
  const allMacs=[...new Set((macRows||[]).map(m=>m.device_id))].sort();

  // Dispositivos registrados
  const {data:regDevs}=await db.from('dispositivos')
    .select('mac_address,nombre,clientes(nombre)');
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
    .select('posicion,mm1,mm2,mm3,promedio,created_at,vehiculo_id,vehiculos(nombre,patente,tipo_ruedas)')
    .eq('device_id',mac)
    .order('created_at',{ascending:false})
    .limit(2000);

  if(error){ showToast('Error: '+error.message,true); return; }

  // Agrupar por (vehiculo_id + día)
  const map={};
  (data||[]).forEach(m=>{
    const day=new Date(m.created_at).toISOString().slice(0,10);
    const key=`${m.vehiculo_id}-${day}`;
    if(!map[key]) map[key]={key,firstDate:m.created_at,day,vehiculo_id:m.vehiculo_id,vehiculo:m.vehiculos,meds:[]};
    map[key].meds.push(m);
  });
  medDeviceSessions=Object.values(map).sort((a,b)=>new Date(b.firstDate)-new Date(a.firstDate));
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
    const vehNom=veh?`${esc(veh.nombre)}${veh.patente?' · '+esc(veh.patente):''}`:' Vehículo sin nombre';
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
