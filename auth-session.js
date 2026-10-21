/* BAZA_SESSION_V3 — shared and cross-tab safe Supabase session handling. */
(function(){
'use strict';
const ACCESS='baza_access_token',REFRESH='baza_refresh_token',LOCK='baza-supabase-refresh-v3';
let base='',apikey='',pending=null,started=false;
const token=()=>localStorage.getItem(ACCESS)||'';
const refreshToken=()=>localStorage.getItem(REFRESH)||'';
function expiresAt(value){
 try{const chunk=String(value||'').split('.')[1];if(!chunk)return 0;
  const payload=JSON.parse(atob(chunk.replace(/-/g,'+').replace(/_/g,'/')));
  return Number(payload.exp||0)*1000;
 }catch(_){return 0}
}
function currentEnough(value,bufferMs=180000){
 const exp=expiresAt(value);
 return !!value&&exp>Date.now()+bufferMs;
}
function save(data){
 if(!data||!data.access_token)throw Error('Supabase не вернул access token');
 // Save new rotating refresh token BEFORE the access token; other tabs can safely reuse it.
 if(data.refresh_token)localStorage.setItem(REFRESH,data.refresh_token);
 localStorage.setItem(ACCESS,data.access_token);
 return data.access_token;
}
function clear(){
 localStorage.removeItem(ACCESS);
 localStorage.removeItem(REFRESH);
 localStorage.setItem('baza_logout_at',String(Date.now()));
}
async function refresh({force=false,previousToken=''}={}){
 if(pending)return pending;
 pending=(async()=>{
  async function inside(){
   const active=token();
   // Another tab may have refreshed while we waited for the lock.
   if(previousToken&&active!==previousToken&&currentEnough(active,20000))return active;
   if(!force&&currentEnough(active))return active;
   const original=refreshToken();
   if(!original)return currentEnough(active,0)?active:null;
   let response;
   try{
    response=await fetch(base+'/auth/v1/token?grant_type=refresh_token',{
     method:'POST',headers:{apikey,'Content-Type':'application/json'},
     body:JSON.stringify({refresh_token:original})
    });
   }catch(err){console.warn('BAZA: не удалось обновить токен (сеть)',err);return currentEnough(token(),0)?token():null;}
   if(!response.ok){
    // Do not destroy valid saved credentials after a transient failure or rotation.
    const updated=token();
    if((refreshToken()!==original||updated!==active)&&currentEnough(updated,0))return updated;
    console.warn('BAZA: Supabase отказал в обновлении сессии, HTTP',response.status);
    return currentEnough(updated,0)?updated:null;
   }
   const data=await response.json().catch(()=>null);
   return data?.access_token?save(data):null;
  }
  if(navigator.locks?.request){
   return navigator.locks.request(LOCK,{mode:'exclusive'},inside);
  }
  return inside();
 })();
 try{return await pending;}finally{pending=null;}
}
async function validToken(){
 const t=token();
 if(currentEnough(t))return t;
 return (await refresh({previousToken:t}))||(currentEnough(token(),0)?token():null);
}
async function authorizedFetch(url,init={}){
 let t=await validToken();
 if(!t&&refreshToken())t=await refresh({force:true,previousToken:token()});
 const build=jwt=>{
   const headers=new Headers(init.headers||{});
   headers.set('apikey',apikey);
   if(jwt)headers.set('Authorization','Bearer '+jwt);
   return {...init,headers};
 };
 let response=await fetch(url,build(t));
 if(response.status!==401)return response;
 const fresh=await refresh({force:true,previousToken:t||''});
 if(!fresh)return response;
 return fetch(url,build(fresh));
}
function start(){
 if(started)return;started=true;
 const attempt=()=>{if(document.visibilityState==='visible'&&refreshToken())validToken().catch(e=>console.warn('BAZA: обновление сессии отложено',e));};
 setInterval(attempt,60000);
 document.addEventListener('visibilitychange',attempt);
 window.addEventListener('focus',attempt);
 attempt();
}
window.BazaSession={
 configure({url,key}){base=String(url||'').replace(/\/$/,'');apikey=String(key||'');},
 token,refreshToken,setTokens:save,clear,refresh,validToken,fetch:authorizedFetch,start,expiresAt
};
})();
