/* Main BAZA group cash movement bridge. No credentials or external services. */
(function(){
'use strict';
const anchor=document.getElementById('cashBoard');
if(!anchor)return;
const e=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const cent=x=>Math.round(Number(x||0)*100);
const fmt=x=>new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(x/100)+' ₽';
const sign=x=>(x<0?'−':x>0?'+':'')+fmt(Math.abs(x));
const normalize=x=>String(x||'').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/[^a-zа-я0-9]/g,'');
const isOutside=x=>/^(?:м73|m73|ооом73)$/.test(normalize(x))||/^(?:плейэстейт|playestate)/.test(normalize(x));
const day=x=>new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(x+'T12:00:00Z'));
const addDay=(x,n)=>{const d=new Date(x+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
let selectedWeek='',weeks=[],plan=[],original=[],breakdown={},loaded=false,rows=[],mode='';
let legacy=null;
const startHtml=[
'<section id="groupCashBridge"><div class="gcb-heading"><div>',
'<div class="gcb-eyebrow">ФИНАНСОВЫЙ КОНТРОЛЬ · ДВИЖЕНИЕ ДС ГК</div>',
'<h3>Откуда берётся конечный остаток</h3>',
'<p>Расшифровка приходов и расходов, формирующих прогноз недели. Нажми на сумму, чтобы увидеть отдельные операции.</p>',
'</div><div class="gcb-week"><label for="gcbWeek">Неделя</label><select id="gcbWeek"><option>Загрузка…</option></select>',
'<button type="button" id="gcbReload">↻ Обновить</button></div></div>',
'<div class="gcb-cards">',
'<button type="button" class="gcb-card" data-kind="opening"><span>ОСТАТОК НА НАЧАЛО ↗</span><strong id="gcbOpening">—</strong><small>По юридическим лицам</small></button>',
'<button type="button" class="gcb-card" data-kind="income"><span>ПРИХОД В ГК ↗</span><strong id="gcbIncome">—</strong><small>Внешние поступления и нерасшифрованные суммы</small></button>',
'<button type="button" class="gcb-card" data-kind="expense"><span>РАСХОД ИЗ ГК ↗</span><strong id="gcbExpense">—</strong><small>Кому и по каким проектам ушли деньги</small></button>',
'<button type="button" class="gcb-card" data-kind="closing"><span>ОСТАТОК НА КОНЕЦ ↗</span><strong id="gcbClosing">—</strong><small>Начало + приход − расход</small></button>',
'</div><div class="gcb-bottom"><strong id="gcbNet" class="gcb-net">Изменение за неделю: —</strong>',
'<button type="button" id="gcbTransfers" class="gcb-vgo">ВГО внутри ГК: —</button>',
'<span id="gcbCoverage" class="gcb-coverage"></span></div>',
'<p id="gcbAlert" class="gcb-alert" hidden></p></section>'
].join('');
anchor.insertAdjacentHTML('beforebegin',startHtml);
const modal=document.createElement('div');
modal.className='gcb-modal';modal.id='gcbModal';
modal.innerHTML=[
'<div class="gcb-modal-box" role="dialog" aria-modal="true" aria-labelledby="gcbModalTitle">',
'<div class="gcb-modal-head"><div><h3 id="gcbModalTitle"></h3><p id="gcbModalWeek"></p></div>',
'<button id="gcbModalClose" type="button" aria-label="Закрыть">×</button></div>',
'<div class="gcb-modal-tools"><input id="gcbFilter" type="search" placeholder="Поиск: юрлицо, контрагент, проект, статья…">',
'<strong id="gcbModalTotal">—</strong></div>',
'<div class="gcb-modal-table"><table><thead><tr><th>Дата / вид</th><th>Наше юрлицо</th>',
'<th>Контрагент / источник</th><th>Проект / статья</th><th>Сумма</th></tr></thead>',
'<tbody id="gcbModalRows"></tbody></table></div><div id="gcbModalNote" class="gcb-modal-foot"></div></div>'
].join('');
document.body.appendChild(modal);
const get=async path=>{
 const res=await window.BazaSession.fetch(SUPABASE_URL+'/rest/v1/'+path,{headers:window.bazaAuthHeaders()});
 if(!res.ok){const json=await res.json().catch(()=>({}));throw Error(json.message||('HTTP '+res.status))}
 return res.json();
};
const initLegacy=async()=>{
 if(legacy)return legacy;
 const current=window.__BAZA_ALL_PAYMENTS||[];
 if(current.length&&!current.some(x=>String(x.id||'').startsWith('calendar:'))){
  legacy=current;return legacy;
 }
 const raw=await get('payments?select=id,entity,source,direction,amount,counterparty,project,subcategory,is_internal,is_non_expense&order=id.asc&limit=2000');
 const normalized=raw.map(x=>({...x,isInternal:x.is_internal===true,isNonExpense:x.is_non_expense===true,amount:Number(x.amount)}));
 const seen=new Map(),result=[];
 for(const item of normalized){
  if(!item.isInternal){result.push(item);continue;}
  const names=[normalize(item.entity),normalize(item.counterparty)].sort().join('|');
  const key=names+'|'+cent(item.amount)+'|'+normalize(item.project)+'|'+normalize(item.subcategory);
  if(!seen.has(key)){seen.set(key,item);result.push(item);}
  else if(seen.get(key).isNonExpense&&!item.isNonExpense){
   const previous=seen.get(key);const index=result.indexOf(previous);
   if(index>=0)result[index]=item;seen.set(key,item);
  }
 }
 legacy=result;return legacy;
};
function legacyClassify(payments){
 const known=new Set(original.map(r=>normalize(r.entity_name)));
 const nameKey=x=>normalize(x).replace(/^ооо(?:сз|ск)?/,'');
 const knownAlt=new Set(original.map(r=>nameKey(r.entity_name)));
 const inGroup=x=>!isOutside(x)&&(known.has(normalize(x))||knownAlt.has(nameKey(x)));
 const out=payments.filter(p=>!p.isNonExpense&&!isOutside(p.entity)).map(p=>({
  id:p.id,due_date:null,payer:p.entity,counterparty:p.counterparty,project:p.project,
  direction:p.direction,subcategory:p.subcategory,amount:Number(p.amount),origin:p.isInternal?'vgo':'other',
  funding_source:p.source,internal:!!p.isInternal&&inGroup(p.counterparty)
 }));
 const deposits=payments.filter(p=>p.isNonExpense&&/выгрузка кредитных средств/i.test(String(p.subcategory||''))&&!isOutside(p.entity)).map(p=>({
  id:p.id,payer:p.entity,counterparty:p.counterparty,project:p.project,due_date:null,
  source_type:'Кредитный транш',amount:Number(p.amount)
 }));
 const gross=original.reduce((sum,p)=>sum+cent(p.planned_receipts),0);
 const inside=out.filter(p=>p.internal).reduce((sum,p)=>sum+cent(p.amount),0);
 const bank=deposits.reduce((sum,p)=>sum+cent(p.amount),0);
 return {outflows:out,receipts:deposits,manual_receipts:[],externalIn:gross-inside,
  residual:gross-inside-bank,legacy:true};
}
function state(){
 const old=selectedWeek==='2026-10-19';
 const source=old?breakdown:breakdown;
 const outgoing=source.outflows||[];
 const inside=outgoing.filter(x=>x.internal===true);
 const external=outgoing.filter(x=>x.internal!==true);
 const begin=original.reduce((sum,r)=>sum+cent(r.opening_balance),0);
 const income=old?source.externalIn:
  (source.receipts||[]).reduce((sum,r)=>sum+cent(r.amount),0)+
  (source.manual_receipts||[]).reduce((sum,r)=>sum+cent(r.amount),0);
 const expense=external.reduce((sum,r)=>sum+cent(r.amount),0);
 const internal=inside.reduce((sum,r)=>sum+cent(r.amount),0);
 const missing=old?original.filter(r=>r.opening_balance===null||r.planned_receipts===null):
  plan.filter(r=>r.is_complete!==true);
 const historic=original.filter(r=>{
  const m=String(r.source_note||'').match(/дата отчёта\s+(\d{4}-\d{2}-\d{2})/i);
  return m&&m[1]!==addDay(selectedWeek,-1);
 });
 const notes=[];
 if(missing.length)notes.push('У '+missing.length+' из '+(old?original.length:plan.length)+' юрлиц прогноз неполный. Конечный итог предварительный.');
 if(historic.length)notes.push('Начальные остатки '+historic.length+' юрлиц получены из 1С за другую дату.');
 if(old&&Math.abs(source.residual)>1)notes.push('Нерасшифрованная часть прихода: '+sign(source.residual)+'; источник этих денег пока не установлен.');
 if(income<0)notes.push('После исключения ВГО рассчитанный приход отрицательный: требуется проверка состава поступлений.');
 if(external.some(r=>r.origin==='vgo'||r.flow_type==='ВГО'))notes.push('Есть переводы ВГО без подтверждённого получателя внутри ГК; сейчас они включены в расход из группы.');
 if(!old&&(source.manual_receipts||[]).length)notes.push('Часть поступлений введена общей суммой без конкретных траншей.');
 if(!old&&plan.length){
  const computed=plan.reduce((sum,r)=>sum+cent(r.planned_closing),0);
  if(Math.abs(computed-(begin+income-expense))>1)notes.push('Расчётный мост и сумма рассчитанных остатков по юрлицам расходятся из-за неполных исходных данных.');
 }
 return {source,external,inside,begin,income,expense,internal,closing:begin+income-expense,missing,notes};
}
function draw(){
 if(!loaded)return;
 const s=state();
 e('gcbOpening').textContent=fmt(s.begin);
 e('gcbIncome').textContent=fmt(s.income);
 e('gcbExpense').textContent=fmt(s.expense);
 e('gcbClosing').textContent=fmt(s.closing)+(s.missing.length?' *':'');
 e('gcbNet').textContent='Изменение за неделю: '+sign(s.income-s.expense);
 e('gcbTransfers').textContent='ВГО внутри ГК: '+fmt(s.internal)+' · Расшифровать';
 const total=selectedWeek==='2026-10-19'?original.length:plan.length;
 e('gcbCoverage').textContent='Полный прогноз: '+(total-s.missing.length)+' из '+total+' юрлиц';
 e('gcbAlert').hidden=!s.notes.length;
 e('gcbAlert').textContent=s.notes.join(' ');
}
function drill(kind){
 if(!loaded)return;
 const s=state(),d=s.source;rows=[];mode=kind;
 const push=(dateValue,type,entity,party,project,sum,uncertain=false,missing=false)=>{
  rows.push({dateValue,type,entity,party,project,sum,uncertain,missing});
 };
 if(kind==='opening'||kind==='closing'){
  const set=selectedWeek==='2026-10-19'?original:plan;
  for(const r of set){
   const value=kind==='opening'?r.opening_balance:
      selectedWeek==='2026-10-19'?
       (r.opening_balance!=null&&r.planned_receipts!=null?Number(r.opening_balance)+Number(r.planned_receipts)-
         (d.outflows||[]).filter(x=>normalize(x.payer)===normalize(r.entity_name)).reduce((sum,x)=>sum+Number(x.amount),0):null)
       :r.planned_closing;
   push('',kind==='opening'?'Начальный остаток':'Конечный остаток',r.entity_name,
     'По юридическому лицу',value==null?'Не хватает исходных данных':'Прогноз',cent(value),false,value==null);
  }
 }else if(kind==='expense'||kind==='vgo'){
  for(const r of kind==='vgo'?s.inside:s.external)
   push(r.due_date,kind==='vgo'?'ВГО':'Расход',r.payer,r.counterparty,
     [r.project,r.direction,r.subcategory].filter(Boolean).join(' · '),cent(r.amount));
 }else if(kind==='income'){
  for(const r of d.receipts||[])push(r.due_date,r.source_type||'Поступление',
    r.payer||r.entity_name,r.counterparty||'Не указан',r.project||'—',cent(r.amount));
  if(d.legacy){
   if(d.residual!==0)push('','Разница без детализации','ГК BAZA',
      'Источник не установлен','План минус кредитные поступления и входящие ВГО',d.residual,true);
  }else{
   for(const r of d.manual_receipts||[])push('','Без расшифровки',r.entity_name,
     'Источник не установлен','Внесено общей суммой в план',cent(r.amount),true);
  }
 }
 const titles={opening:'Остаток на начало',income:'Приход в ГК',expense:'Расход из ГК',
  closing:'Остаток на конец',vgo:'Внутренние перечисления ГК'};
 e('gcbModalTitle').textContent=titles[kind]+' · расшифровка';
 e('gcbModalWeek').textContent='Неделя '+day(selectedWeek)+' — '+day(addDay(selectedWeek,6));
 e('gcbFilter').value='';
 e('gcbModalNote').textContent=kind==='income'?
  'Суммы без детализации не являются подтверждением отдельного поступления. ВГО исключены из внешнего прихода группы.':
 kind==='expense'?'Внутригрупповые перечисления исключены, операции с М73 и PlayEstate считаются внешними.':
 kind==='vgo'?'ВГО уменьшают остаток отправителя и увеличивают остаток получателя, но не являются расходом группы.':
 'Если некоторые юрлица не имеют полного прогноза, общий остаток нельзя считать окончательным.';
 drawRows();modal.classList.add('open');document.body.style.overflow='hidden';
 e('gcbFilter').focus();
}
function drawRows(){
 const query=e('gcbFilter').value.toLocaleLowerCase('ru-RU').trim();
 const filtered=rows.filter(r=>!query||[r.entity,r.party,r.project,r.type].join(' ').toLocaleLowerCase('ru-RU').includes(query));
 e('gcbModalTotal').textContent=filtered.length+' строк · '+fmt(filtered.reduce((sum,r)=>sum+r.sum,0));
 e('gcbModalRows').innerHTML=filtered.map(r=>'<tr><td>'+esc(r.dateValue?day(r.dateValue):'—')+
  '<div class="'+(r.uncertain?'gcb-unmatched':'')+'">'+esc(r.type)+'</div></td><td>'+
  esc(r.entity)+'</td><td>'+esc(r.party)+'</td><td>'+esc(r.project||'—')+
  '</td><td class="'+(r.uncertain?'gcb-unmatched':'')+'">'+(r.missing?'Нет данных':sign(r.sum))+
  '</td></tr>').join('')||'<tr><td colspan="5">Нет подходящих операций</td></tr>';
}
async function load(){
 if(!selectedWeek||!window.bazaAuthHeaders)return;
 loaded=false;e('gcbAlert').hidden=false;e('gcbAlert').textContent='Загружаем денежные потоки…';
 try{
  const w=encodeURIComponent(selectedWeek);
  const responses=await Promise.all([
   get('weekly_cash_balances?select=entity_key,entity_name,opening_balance,planned_receipts,source_note&week_start=eq.'+w+'&order=entity_name.asc'),
   get('rpc/liquidity_preview_week?p_week_start='+w),
   selectedWeek==='2026-10-19'?initLegacy():get('rpc/liquidity_group_breakdown_week?p_week_start='+w)
  ]);
  original=responses[0];plan=responses[1];
  breakdown=selectedWeek==='2026-10-19'?legacyClassify(responses[2]):responses[2]||{};
  loaded=true;draw();
 }catch(error){e('gcbAlert').hidden=false;e('gcbAlert').textContent='Ошибка загрузки: '+error.message;}
}
async function init(){
 if(!document.body.classList.contains('auth-ready'))return;
 try{
  const data=await get('weekly_cash_balances?select=week_start&order=week_start.desc&limit=1000');
  weeks=[...new Set(data.map(x=>x.week_start))].sort().reverse();
  if(!weeks.length){e('gcbAlert').hidden=false;e('gcbAlert').textContent='Нет недель с прогнозом остатков';return;}
  const requested=new URLSearchParams(location.search).get('week');
  selectedWeek=weeks.includes(requested)?requested:weeks.includes('2026-10-19')?'2026-10-19':weeks[0];
  e('gcbWeek').innerHTML=weeks.map(w=>'<option value="'+esc(w)+'">'+day(w)+' — '+day(addDay(w,6))+'</option>').join('');
  e('gcbWeek').value=selectedWeek;
  await load();
 }catch(err){e('gcbAlert').hidden=false;e('gcbAlert').textContent='Ошибка загрузки сводки: '+err.message;}
}
e('gcbWeek').addEventListener('change',ev=>{selectedWeek=ev.target.value;load();});
e('gcbReload').addEventListener('click',load);
document.querySelectorAll('#groupCashBridge [data-kind]').forEach(btn=>btn.addEventListener('click',()=>drill(btn.dataset.kind)));
e('gcbTransfers').addEventListener('click',()=>drill('vgo'));
e('gcbFilter').addEventListener('input',drawRows);
function closeModal(){modal.classList.remove('open');document.body.style.removeProperty('overflow');}
e('gcbModalClose').addEventListener('click',closeModal);
modal.addEventListener('click',ev=>{if(ev.target===modal)closeModal()});
document.addEventListener('keydown',ev=>{if(ev.key==='Escape'&&modal.classList.contains('open'))closeModal();});
let ready=false;
new MutationObserver(()=>{
 if(document.body.classList.contains('auth-ready')&&!ready){ready=true;init();}
 else if(!document.body.classList.contains('auth-ready')){ready=false;loaded=false;}
}).observe(document.body,{attributes:true,attributeFilter:['class']});
if(document.body.classList.contains('auth-ready')){ready=true;init();}
})();