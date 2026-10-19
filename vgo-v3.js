/* BAZA_VGO_V3 */
(function(){
 if(window.__BAZA_VGO_V3)return; window.__BAZA_VGO_V3=true;
 const all=window.__BAZA_ALL_PAYMENTS||[];
 const isExcluded=r=>/\bм73\b|плейэстейт/i.test(String(r.entity||''))||/\bм73\b|плейэстейт/i.test(String(r.counterparty||''));
 const base=()=>all.filter(r=>r.isInternal&&!r.isNonExpense&&!isExcluded(r));
 const section=document.getElementById('vgo'); if(!section)return;
 const esc=s=>String(s??'—').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
 const fmt=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(Math.round(Number(n)||0))+' ₽';
 const fields=['entity','counterparty','project','direction','subcategory'];
 const filterSelects=[...section.querySelectorAll('[data-vgo-filter]')];
 const state={q:'',filters:{}};
 function fillFilters(){filterSelects.forEach(sel=>{const f=sel.dataset.vgoFilter,old=state.filters[f]||'';sel.innerHTML='<option value="">Все</option>';[...new Set(base().map(r=>r[f]).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'ru')).forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;sel.appendChild(o)});sel.value=old;if(sel.value!==old)state.filters[f]=''});}
 const match=r=>fields.every(f=>!state.filters[f]||r[f]===state.filters[f])&&(!state.q||[r.entity,r.counterparty,r.project,r.direction,r.subcategory].join(' ').toLowerCase().includes(state.q));
 const rows=()=>base().filter(match);
 let board=document.getElementById('vgoClearBoard');
 if(!board){board=document.createElement('div');board.id='vgoClearBoard';board.className='vgo-clear-board';const old=section.querySelector('.vgo-flow-board');if(old)old.after(board);else section.insertBefore(board,section.querySelector('.table-card'));}
 function render(rs){
   document.getElementById('vgoTotal').textContent=fmt(rs.reduce((s,r)=>s+Number(r.amount||0),0));
   document.getElementById('vgoCount').textContent=rs.length;
   const p={};rs.forEach(r=>p[r.project]=(p[r.project]||0)+Number(r.amount||0));const top=Object.entries(p).sort((a,b)=>b[1]-a[1])[0];document.getElementById('vgoTop').textContent=top?top[0]+' · '+fmt(top[1]):'—';
   document.getElementById('vgoTable').innerHTML=rs.slice().sort((a,b)=>b.amount-a.amount).map(r=>`<tr><td class="vgo-flow">${esc(r.entity)}</td><td class="vgo-flow">${esc(r.counterparty)}</td><td>${esc(r.project)}</td><td>${esc(r.direction)}</td><td>${esc(r.subcategory)}</td><td class="num"><b>${fmt(r.amount)}</b></td></tr>`).join('')||'<tr><td colspan="6" style="padding:18px;color:#7890a7">Нет операций</td></tr>';
   const pairs={};rs.forEach(r=>{const k=r.entity+'|||'+r.counterparty;pairs[k]=(pairs[k]||0)+Number(r.amount||0)});
   const bySource={};Object.entries(pairs).forEach(([k,v])=>{const [a,b]=k.split('|||');(bySource[a]??=[]).push([b,v])});
   const groups=Object.entries(bySource).sort((a,b)=>b[1].reduce((s,x)=>s+x[1],0)-a[1].reduce((s,x)=>s+x[1],0));
   let html='<div class="vgo-clear-title"><h3>Куда уходят деньги внутри группы</h3><span>стрелка = направление · сумма = оборот</span></div><div class="vgo-excluded-note">М73 и Плэйэстейт исключены из ВГО.</div><div class="vgo-flow-groups">';
   groups.slice(0,12).forEach(([src,dests])=>{const total=dests.reduce((s,x)=>s+x[1],0);html+=`<div class="vgo-flow-group"><div class="vgo-flow-source"><span>${esc(src)}</span><b>${fmt(total)}</b></div>`+dests.sort((a,b)=>b[1]-a[1]).slice(0,6).map(([dst,v])=>`<div class="vgo-flow-link"><span>${esc(dst)}</span><span class="vgo-flow-arrow">→</span><span class="vgo-flow-amount">${fmt(v)}</span></div>`).join('')+'</div>'});
   if(!groups.length)html+='<div style="color:#7890a7;font-size:10px;padding:10px">Нет операций по текущим фильтрам</div>';
   html+='</div>';board.innerHTML=html;
 }
 fillFilters();
 document.getElementById('vgoSearch').oninput=e=>{state.q=e.target.value.toLowerCase();render(rows())};
 filterSelects.forEach(sel=>sel.onchange=e=>{state.filters[e.target.dataset.vgoFilter]=e.target.value;render(rows())});
 render(rows());
})();
