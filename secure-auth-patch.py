from pathlib import Path

p = Path('index.html')
s = p.read_text(encoding='utf-8')
s = s.replace('<script src="data.js"></script>', '<script>window.PAYMENTS = [];</script>')
s = s.replace('''function isExpense(r){
  if(r.subcategory==='Возврат займа') return false;
  if(r.subcategory==='Выгрузка кредитных средств') return false;
  if(r.id==='80-7000000.0-ООО СЗ "СТРОЙКАТЕРИНБУРГ"-ООО СК "БАЗА"') return false;
  return true;
}
function expenseRows(){ return filtered.filter(isExpense); }''', '''function isExpense(r){ return !r.is_non_expense && !r.is_internal; }
function expenseRows(){ return filtered.filter(isExpense); }''')

if 'BAZA_AUTH_V1' not in s:
    css = r'''/* BAZA_AUTH_V1 */
body.auth-locked .page{display:none!important}
.auth-screen{position:fixed;inset:0;background:#eef4f9;display:grid;place-items:center;z-index:9999}
.auth-card{width:min(420px,calc(100vw - 32px));background:#fff;border:1px solid #d9e5ef;border-radius:18px;padding:30px;box-shadow:0 25px 70px rgba(0,26,51,.14)}
.auth-brand{font-size:34px;font-weight:900;letter-spacing:-2px;color:#e51d2a}.auth-sub{font-size:9px;color:#7890a7;font-weight:800;letter-spacing:.12em;margin-top:2px}
.auth-card h2{margin:28px 0 6px;color:#0a3155;font-size:22px}.auth-card p{margin:0 0 18px;color:#7890a7;font-size:11px;line-height:1.5}
.auth-field{margin:10px 0}.auth-field label{display:block;font-size:9px;color:#7890a7;font-weight:800;text-transform:uppercase;margin:0 0 5px 2px}.auth-field input{width:100%;height:42px;border:1px solid #cfdfeb;border-radius:9px;padding:0 11px;color:#173d60;font-size:12px;outline:none}.auth-field input:focus{border-color:#789ab7}
.auth-submit{width:100%;height:42px;margin-top:10px;border:0;border-radius:9px;background:#0a3155;color:#fff;font-weight:800;cursor:pointer}.auth-submit:disabled{opacity:.6;cursor:wait}.auth-error{min-height:18px;margin-top:10px;color:#c41d25;font-size:10px}.auth-user{display:none;position:fixed;right:20px;top:16px;z-index:40;background:#fff;border:1px solid #d9e5ef;border-radius:9px;padding:7px 10px;font-size:9px;color:#49667f}.auth-user button{margin-left:8px;border:0;background:none;color:#c41d25;cursor:pointer;font-size:9px}
body.auth-ready .auth-screen{display:none}.auth-guard-note{font-size:9px;color:#9aabb9;margin-top:14px}'''
    html = r'''<div class="auth-screen" id="authScreen">
  <form class="auth-card" id="authForm">
    <div class="auth-brand">BAZA</div><div class="auth-sub">ПЛАТЕЖНЫЙ КОНТРОЛЬ</div>
    <h2>Вход в систему</h2>
    <p>Доступ к платежному календарю только для авторизованных пользователей.</p>
    <div class="auth-field"><label>Email</label><input id="authEmail" type="email" autocomplete="username" value="a.semin@baza.bz" required></div>
    <div class="auth-field"><label>Пароль</label><input id="authPassword" type="password" autocomplete="current-password" required></div>
    <button class="auth-submit" id="authSubmit" type="submit">Войти</button>
    <div class="auth-error" id="authError"></div>
    <div class="auth-guard-note">Сессия защищена Supabase Auth · данные платежей загружаются только после входа.</div>
  </form>
</div>
<div class="auth-user" id="authUser"><span id="authUserText"></span><button id="authLogout">Выйти</button></div>
'''
    js = r'''/* BAZA_AUTH_V1 */
(function(){
  document.body.classList.add('auth-locked');
  let accessToken = localStorage.getItem('baza_access_token') || '';
  let refreshToken = localStorage.getItem('baza_refresh_token') || '';
  let currentUser = null;
  let currentProfile = null;
  const authHeaders = extra => Object.assign({apikey:SUPABASE_KEY,Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},extra||{});
  window.bazaAuthHeaders=authHeaders;
  window.bazaAuthRole=()=>currentProfile?.role||'';
  function setTokens(data){accessToken=data.access_token||'';refreshToken=data.refresh_token||'';if(accessToken)localStorage.setItem('baza_access_token',accessToken);else localStorage.removeItem('baza_access_token');if(refreshToken)localStorage.setItem('baza_refresh_token',refreshToken);else localStorage.removeItem('baza_refresh_token');}
  function clearSession(){accessToken='';refreshToken='';currentUser=null;currentProfile=null;localStorage.removeItem('baza_access_token');localStorage.removeItem('baza_refresh_token');document.body.classList.remove('auth-ready');document.body.classList.add('auth-locked');document.getElementById('authUser').style.display='none';}
  function showError(msg){document.getElementById('authError').textContent=msg||'';}
  async function refreshSession(){if(!refreshToken)return false;try{const res=await fetch(SUPABASE_URL+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:SUPABASE_KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:refreshToken})});if(!res.ok)throw new Error();setTokens(await res.json());return !!accessToken;}catch(e){clearSession();return false;}}
  async function getUser(){if(!accessToken)return null;let res=await fetch(SUPABASE_URL+'/auth/v1/user',{headers:authHeaders()});if(res.ok)return await res.json();if(res.status===401&&await refreshSession()){res=await fetch(SUPABASE_URL+'/auth/v1/user',{headers:authHeaders()});if(res.ok)return await res.json();}return null;}
  async function getProfile(user){const res=await fetch(SUPABASE_URL+'/rest/v1/user_profiles?select=id,email,full_name,role,is_active&id=eq.'+encodeURIComponent(user.id),{headers:authHeaders()});if(!res.ok)return null;const rows=await res.json();return rows[0]||null;}
  async function login(email,password){const res=await fetch(SUPABASE_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:SUPABASE_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,password})});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error_description||data.msg||'Не удалось войти');setTokens(data);return boot();}
  async function loadPayments(){const res=await fetch(SUPABASE_URL+'/rest/v1/payments?select=id,entity,source,direction,amount,counterparty,project,subcategory,is_internal,is_non_expense&order=id.asc',{headers:authHeaders()});if(!res.ok)throw new Error('Не удалось загрузить платежи: HTTP '+res.status);window.PAYMENTS=await res.json();}
  function refillFilters(){[['sourceFilter','source','Все источники'],['directionFilter','direction','Все направления'],['entityFilter','entity','Все юрлица']].forEach(([id,field,first])=>{const el=document.getElementById(id);if(!el)return;const old=el.value;el.innerHTML='<option value="">'+first+'</option>';[...new Set(PAYMENTS.map(x=>x[field]).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'ru')).forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;el.appendChild(o)});if([...el.options].some(o=>o.value===old))el.value=old;});}
  async function loadApprovalsSecure(){try{const res=await fetch(APPROVALS_ENDPOINT+'?select=payment_id,status,comment,approved_by,updated_at,approved_by_user_id',{headers:authHeaders()});if(!res.ok)throw new Error('HTTP '+res.status);const rows=await res.json();approvals.clear();rows.forEach(x=>approvals.set(String(x.payment_id),x));setConnectionState(true,'Синхронизировано');renderAll();}catch(e){console.error(e);setConnectionState(false,'Ошибка подключения');renderAll();}}
  window.loadApprovals=loadApprovalsSecure;
  window.approvalHeaders=function(extra={}){return Object.assign({apikey:SUPABASE_KEY,Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},extra);};
  async function boot(){const user=await getUser();if(!user){clearSession();return false;}const profile=await getProfile(user);if(!profile||!profile.is_active){clearSession();showError('Нет активного профиля доступа.');return false;}currentUser=user;currentProfile=profile;try{await loadPayments();}catch(e){clearSession();showError(e.message);return false;}refillFilters();document.body.classList.remove('auth-locked');document.body.classList.add('auth-ready');document.getElementById('authUserText').textContent=(profile.full_name||profile.email||user.email||'')+' · '+profile.role;document.getElementById('authUser').style.display='block';renderAll();await loadApprovalsSecure();return true;}
  document.getElementById('authForm').addEventListener('submit',async e=>{e.preventDefault();showError('');const btn=document.getElementById('authSubmit');btn.disabled=true;btn.textContent='Входим…';try{if(!await login(document.getElementById('authEmail').value.trim(),document.getElementById('authPassword').value))throw new Error('Не удалось войти');}catch(err){showError(err.message||'Ошибка входа');}finally{btn.disabled=false;btn.textContent='Войти';}});
  document.getElementById('authLogout').onclick=()=>clearSession();
  window.addEventListener('storage',e=>{if(e.key==='baza_access_token'&&!e.newValue)clearSession();});
  (async()=>{if(!(await boot()))document.getElementById('authScreen').style.display='grid';})();
})();'''
    block = '<style>\n'+css+'\n</style>\n'+html+'<script>\n'+js+'\n</script>\n'
    s=s.replace('</body>',block+'</body>')

p.write_text(s,encoding='utf-8')
Path('data.js').unlink(missing_ok=True)
