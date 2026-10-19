const money = n => new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(Math.round(n)) + ' ₽';
const esc = s => String(s ?? '—').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const statusKey = id => 'payment-status-v4-' + id;
const getStatus = id => localStorage.getItem(statusKey(id)) || 'pending';
const setStatus = (id,status) => { localStorage.setItem(statusKey(id),status); };

const state = {source:'',direction:'',entity:'',search:'',status:''};
let filtered = [...PAYMENTS];
let directionChart, sourceChart, entityChart, modalPayment = null;

function unique(field){ return [...new Set(PAYMENTS.map(x=>x[field]).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'ru')); }
function fillSelect(id, vals){ const el=document.getElementById(id); vals.forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;el.appendChild(o)}); }
fillSelect('sourceFilter',unique('source'));
fillSelect('directionFilter',unique('direction'));
fillSelect('entityFilter',unique('entity'));

function matches(r){
  if(state.source && r.source!==state.source) return false;
  if(state.direction && r.direction!==state.direction) return false;
  if(state.entity && r.entity!==state.entity) return false;
  if(state.status && getStatus(r.id)!==state.status) return false;
  if(state.search){
    const hay=[r.counterparty,r.entity,r.direction,r.project,r.subcategory,r.source].join(' ').toLowerCase();
    if(!hay.includes(state.search.toLowerCase())) return false;
  }
  return true;
}
function apply(){ filtered=PAYMENTS.filter(matches); renderAll(); }

function renderKpis(){
  const total=filtered.reduce((s,r)=>s+r.amount,0);
  const own=filtered.filter(r=>r.source==='Собственные').reduce((s,r)=>s+r.amount,0);
  const credit=filtered.filter(r=>r.source==='Кредит').reduce((s,r)=>s+r.amount,0);
  document.getElementById('kpiTotal').textContent=money(total);
  document.getElementById('kpiOwn').textContent=money(own);
  document.getElementById('kpiCredit').textContent=money(credit);
  document.getElementById('kpiShare').textContent=(total?((credit/total)*100).toFixed(1):'0.0')+'%';
  document.getElementById('directionTotal').textContent=money(total);
  document.getElementById('sourceTotal').textContent=money(total);
}

function aggregate(field){
  const m={}; filtered.forEach(r=>m[r[field]]=(m[r[field]]||0)+r.amount);
  return Object.entries(m).sort((a,b)=>b[1]-a[1]);
}
function makeChart(id,type,labels,values){
  const el=document.getElementById(id);
  const old={directionChart,sourceChart,entityChart}[id];
  if(old) old.destroy();
  const common={responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>money(c.raw)}}}};
  const cfg=type==='doughnut'
    ? {type,data:{labels,datasets:[{data:values}]},options:{...common,cutout:'66%'}}
    : {type,data:{labels,datasets:[{data:values,borderRadius:5,maxBarThickness:28}]},options:{...common,indexAxis:id==='entityChart'?'y':'x',scales:{x:{grid:{display:false},ticks:{font:{size:10},callback:v=>money(v)}},y:{grid:{color:'#edf0f2'},ticks:{font:{size:10},callback:v=>String(v).slice(0,28)}}}}};
  const chart=new Chart(el,cfg);
  if(id==='directionChart')directionChart=chart;
  if(id==='sourceChart')sourceChart=chart;
  if(id==='entityChart')entityChart=chart;
}
function renderCharts(){
  const d=aggregate('direction').slice(0,8); makeChart('directionChart','bar',d.map(x=>x[0]),d.map(x=>x[1]));
  const s=aggregate('source'); makeChart('sourceChart','doughnut',s.map(x=>x[0]),s.map(x=>x[1]));
  const e=aggregate('entity').slice(0,10); makeChart('entityChart','bar',e.map(x=>x[0]),e.map(x=>x[1]));
}
function statusLabel(s){return s==='approved'?'Согласован':s==='rejected'?'Не согласован':'Ожидает';}
function renderTable(){
  const body=document.getElementById('paymentTable');
  body.innerHTML=filtered.map(r=>{
    const s=getStatus(r.id);
    return `<tr>
      <td class="counterparty" data-open="${esc(r.id)}">${esc(r.counterparty)}</td>
      <td>${esc(r.entity)}</td>
      <td>${esc(r.direction)}</td>
      <td>${esc(r.project)}</td>
      <td class="muted">${esc(r.subcategory)}</td>
      <td><span class="source-badge ${r.source==='Кредит'?'source-credit':'source-own'}">${esc(r.source)}</span></td>
      <td class="num"><b>${money(r.amount)}</b></td>
      <td><div class="status-btns">
        <button class="${s==='approved'?'active approve':''}" data-status="approved" data-id="${esc(r.id)}">✓</button>
        <button class="${s==='rejected'?'active reject':''}" data-status="rejected" data-id="${esc(r.id)}">✕</button>
      </div></td>
    </tr>`;
  }).join('');
  document.getElementById('rowsCount').textContent=`${filtered.length} платежей`;
  body.querySelectorAll('[data-status]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();setStatus(b.dataset.id,b.dataset.status);apply()}));
  body.querySelectorAll('[data-open]').forEach(c=>c.addEventListener('click',()=>openModal(PAYMENTS.find(x=>x.id===c.dataset.open))));
}
function renderLists(){
  const render=(id,items)=>{const total=items.reduce((s,x)=>s+x[1],0), max=items[0]?.[1]||1;document.getElementById(id).innerHTML=items.slice(0,12).map(x=>`<div class="rank"><div><div class="rank-name">${esc(x[0])}</div><div class="bar"><i style="width:${(x[1]/max)*100}%"></i></div></div><div class="rank-value">${money(x[1])}</div></div>`).join('')};
  render('directionList',aggregate('direction')); render('entityList',aggregate('entity'));
}
function renderApproval(){
  const a=PAYMENTS.filter(r=>getStatus(r.id)==='approved').length;
  const rej=PAYMENTS.filter(r=>getStatus(r.id)==='rejected').length;
  const p=PAYMENTS.length-a-rej;
  document.getElementById('approvedCount').textContent=a;
  document.getElementById('rejectedCount').textContent=rej;
  document.getElementById('pendingCount').textContent=p;
}
function renderAll(){renderKpis();renderCharts();renderTable();renderLists();renderApproval();}

['sourceFilter','directionFilter','entityFilter'].forEach(id=>document.getElementById(id).addEventListener('change',e=>{state[id.replace('Filter','')]=e.target.value;apply()}));
document.getElementById('globalSearch').addEventListener('input',e=>{state.search=e.target.value;apply()});
document.getElementById('registrySearch').addEventListener('input',e=>{state.search=e.target.value;document.getElementById('globalSearch').value=e.target.value;apply()});
document.getElementById('payStatus').addEventListener('change',e=>{state.status=e.target.value;apply()});
document.getElementById('reset').addEventListener('click',()=>{Object.assign(state,{source:'',direction:'',entity:'',search:'',status:''});['sourceFilter','directionFilter','entityFilter','payStatus'].forEach(id=>document.getElementById(id).value='');document.getElementById('globalSearch').value='';document.getElementById('registrySearch').value='';apply()});

function openModal(r){
  if(!r)return;
  modalPayment=r;
  const s=getStatus(r.id);
  document.getElementById('modalCounterparty').textContent=r.counterparty;
  document.getElementById('modalAmount').textContent=money(r.amount);
  const st=document.getElementById('modalStatus'); st.textContent=statusLabel(s);
  st.style.background=s==='approved'?'#edf8f2':s==='rejected'?'#fff0ef':'#f1f3f5';
  st.style.color=s==='approved'?'#17683f':s==='rejected'?'#a5261c':'#626a74';
  document.getElementById('modalDetails').innerHTML=[
    ['Юрлицо',r.entity],['Источник финансирования',r.source],['Направление',r.direction],
    ['Проект',r.project],['Подстатья',r.subcategory],['ID платежа',r.id]
  ].map(x=>`<div class="detail"><label>${esc(x[0])}</label><b>${esc(x[1])}</b></div>`).join('');
  document.getElementById('modal').classList.remove('hidden');
}
document.getElementById('modalClose').onclick=()=>document.getElementById('modal').classList.add('hidden');
document.querySelector('.modal-backdrop').onclick=()=>document.getElementById('modal').classList.add('hidden');
document.getElementById('modalApprove').onclick=()=>{setStatus(modalPayment.id,'approved');openModal(modalPayment);apply()};
document.getElementById('modalReject').onclick=()=>{setStatus(modalPayment.id,'rejected');openModal(modalPayment);apply()};

renderAll();
