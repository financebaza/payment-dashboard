// BAZA Match v1. The matching engine is pure: it NEVER writes to the database.
// Amount comparisons use integer kopecks; ambiguous matches remain proposals.
export const cents=n=>Math.round(Math.abs(Number(n||0))*100);
const legal=new Set(['ООО','ОАО','АО','ПАО','ИП','СЗ','СПЕЦИАЛИЗИРОВАННЫЙ','ЗАСТРОЙЩИК']);
export function partyKey(x){
 const words=String(x||'').toUpperCase().replace(/Ё/g,'Е').replace(/[^А-ЯA-Z0-9]+/g,' ').trim().split(/\s+/).filter(z=>z&&!legal.has(z));
 if(words.includes('СБЕРБАНК'))return 'BANK:СБЕРБАНК';
 if(words.includes('ДОМ')&&words.includes('РФ')&&words.includes('БАНК'))return 'BANK:ДОМРФ';
 return words.sort().join('|');
}
const agreementIds=x=>{
 const ids=[]; const text=String(x||'').toUpperCase().replace(/Ё/g,'Е');
 const rx=/ДОГ(?:ОВОР[А-Я]*|[.]?)[^№]{0,85}№\s*([A-ZА-Я0-9]+(?:[-/][A-ZА-Я0-9]+)*)/g;
 let m;while((m=rx.exec(text)))ids.push(m[1]);return [...new Set(ids)];
};
const available=p=>Math.max(0,cents(p.plan_amount)-cents(p.confirmed_amount));
const sign=f=>Number(f.amount_signed)>0?'+':'-';
const contractEvidence=fs=>{
 const docs=fs.map(f=>agreementIds(f.payment_purpose));
 return docs.every(x=>x.length>0)&&docs[0].some(id=>docs.every(x=>x.includes(id)));
};
function compatible(p,f){
 const a=partyKey(p.payer),b=partyKey(p.counterparty),x=partyKey(f.payer),y=partyKey(f.counterparty);
 if(!a||!b||a===b)return false;
 const direct=a===x&&b===y,reverse=a===y&&b===x,sgn=sign(f);
 if(p.flow_sign==='+'){
  if(!direct||sgn!=='+'||/депозит|вклад/i.test(f.payment_purpose||''))return false;
 }else{
  if(!((direct&&sgn==='-')||(reverse&&sgn==='+')))return false;
  if(reverse&&!/вго|финансирован|займ/i.test(p.flow_type||''))return false;
 }
 const flow=String(p.flow_type||'').toLowerCase();
 const purpose=String(f.payment_purpose||'').toLowerCase();
 if(/займ|финансирован/.test(flow)&&!/займ|кредит|финансирован/.test(purpose)&&!/займ|финансирован/i.test(f.flow_type||''))return false;
 if(/прочие платежи/.test(flow)&&/выдача кредита|возврат депозита|размещени|перевод между счетами/.test(purpose))return false;
 return true;
}
function subsets(items,target,max=7){
 const arr=items.slice(0,15).sort((a,b)=>cents(b.amount_signed)-cents(a.amount_signed));
 const solutions=[];
 const visit=(start,sum,chosen)=>{
  if(sum===target&&chosen.length>=2){solutions.push(chosen);return;}
  if(solutions.length>=2||chosen.length>=max)return;
  for(let i=start;i<arr.length;i++){const amount=cents(arr[i].amount_signed);
   if(sum+amount<=target)visit(i+1,sum+amount,[...chosen,arr[i]]);
   if(solutions.length>=2)return;
  }
 };
 visit(0,0,[]);return solutions;
}
function proposal(ps,fs,kind,confidence,reason){
 const entries=kind==='many_to_one'?
  ps.map(p=>({plan_row:p.plan_row,fact_row:fs[0].fact_row,amount:available(p)/100,kind,explanation:reason})):
  fs.map(f=>({plan_row:ps[0].plan_row,fact_row:f.fact_row,amount:cents(f.amount_signed)/100,kind,explanation:reason}));
 return {plan_rows:ps.map(p=>p.plan_row),fact_rows:fs.map(f=>f.fact_row),kind,confidence,reason,
  amount:entries.reduce((s,x)=>s+x.amount,0),entries};
}
export function suggestMatches(plansInput,factsInput,options={}){
 const from=options.date_start||'0000-01-01',to=options.date_end||'9999-12-31';
 const plans=plansInput.filter(p=>available(p)>0).sort((a,b)=>a.plan_row-b.plan_row);
 const facts=factsInput.filter(f=>!String(f.plan_refs||'').trim()&&!String(f.suspected_duplicate||'').trim()&&cents(f.amount_signed)>0&&
  (!f.operation_date||(f.operation_date>=from&&f.operation_date<=to))).sort((a,b)=>a.fact_row-b.fact_row);
 const usedP=new Set(),usedF=new Set(),auto=[],review=[];
 const eligible=p=>facts.filter(f=>!usedF.has(f.fact_row)&&compatible(p,f));
 function accept(s){
  if(s.confidence==='auto'){
    if(s.plan_rows.some(x=>usedP.has(x))||s.fact_rows.some(x=>usedF.has(x)))return false;
    auto.push(s);s.plan_rows.forEach(x=>usedP.add(x));s.fact_rows.forEach(x=>usedF.add(x));
  }else review.push(s);
  return true;
 }
 // First: unique exact 1:1, preventing collisions with other plan rows.
 for(const p of plans){
  if(usedP.has(p.plan_row))continue;
  const choices=eligible(p).filter(f=>cents(f.amount_signed)===available(p));
  if(choices.length!==1)continue;
  const f=choices[0];
  const competing=plans.filter(q=>!usedP.has(q.plan_row)&&available(q)===available(p)&&compatible(q,f));
  if(competing.length!==1)continue;
  accept(proposal([p],[f],'one_to_one','auto','Однозначное совпадение сторон, знака и полной суммы'));
 }
 // Then: unique exact 1:N, requiring a shared contract in all payment purposes.
 for(const p of plans){
  if(usedP.has(p.plan_row))continue;
  for(const dir of ['-','+']){
   const items=eligible(p).filter(f=>sign(f)===dir&&cents(f.amount_signed)<=available(p));
   if(items.length<2)continue;
   const groups=subsets(items,available(p));
   if(groups.length!==1)continue;
   const fs=groups[0];const proof=contractEvidence(fs);
   const unique=fs.every(f=>plans.filter(q=>!usedP.has(q.plan_row)&&compatible(q,f)).length===1);
   const autoFlag=proof&&unique;
   accept(proposal([p],fs,'one_to_many',autoFlag?'auto':'review',
    autoFlag?'Группа платежей закрывает заявку; общий договор подтверждён':'Группа по сумме без достаточных документальных признаков'));
   if(autoFlag)break;
  }
 }
 // A single fact can cover several requests only if the total allocation equals the fact.
 for(const f of facts){
  if(usedF.has(f.fact_row))continue;
  const possibles=plans.filter(p=>!usedP.has(p.plan_row)&&compatible(p,f)&&available(p)<cents(f.amount_signed));
  if(possibles.length<2||possibles.length>8)continue;
  const found=[];const target=cents(f.amount_signed);
  const walk=(start,sum,ps)=>{
   if(found.length>=2)return;
   if(sum===target&&ps.length>=2){found.push(ps);return;}
   for(let i=start;i<possibles.length;i++){
    const next=sum+available(possibles[i]);
    if(next<=target)walk(i+1,next,[...ps,possibles[i]]);
   }
  };walk(0,0,[]);
  if(found.length!==1)continue;
  const pp=found[0],docs=agreementIds(f.payment_purpose);
  const proof=docs.length>0&&pp.every(p=>agreementIds([p.notes,p.subcategory,p.payment_purpose].join(' ')).some(id=>docs.includes(id)));
  const sameAccounting=pp.every(p=>p.flow_type===pp[0].flow_type&&p.project===pp[0].project&&p.subcategory===pp[0].subcategory);
  accept(proposal(pp,[f],'many_to_one',proof&&sameAccounting?'auto':'review','Одна платёжка покрывает несколько плановых строк; '+(proof?'совпадает договор':'проверьте счета и основание')));
 }
 // Finally: allocate full real operations towards partial plan amount.
 for(const p of plans){
  if(usedP.has(p.plan_row))continue;
  const optionsBySign=new Map();
  for(const f of eligible(p).filter(f=>cents(f.amount_signed)<available(p))){
   const list=optionsBySign.get(sign(f))||[];list.push(f);optionsBySign.set(sign(f),list);
  }
  const groups=[...optionsBySign.values()].sort((a,b)=>b.reduce((s,f)=>s+cents(f.amount_signed),0)-a.reduce((s,f)=>s+cents(f.amount_signed),0));
  if(!groups.length)continue;
  const fs=groups[0].filter(f=>plans.filter(q=>!usedP.has(q.plan_row)&&compatible(q,f)).length===1);
  const total=fs.reduce((s,f)=>s+cents(f.amount_signed),0);
  if(!total||total>available(p))continue;
  const docs=agreementIds([p.notes,p.subcategory,p.payment_purpose].join(' '));
  const proof=docs.length>0&&fs.every(f=>agreementIds(f.payment_purpose).some(id=>docs.includes(id)));
  accept(proposal([p],fs,'partial',proof?'auto':'review',
   'Найдено '+(total/100).toLocaleString('ru-RU')+' ₽ из '+(available(p)/100).toLocaleString('ru-RU')+' ₽'+
   (proof?', документы совпали':' — проверить документы перед подтверждением')));
 }
 return {engine:'BAZA Match v1',auto,review:review.sort((a,b)=>b.amount-a.amount).slice(0,50),
  stats:{plans_total:plansInput.length,facts_total:factsInput.length,protected_facts:factsInput.length-facts.length,
   auto_groups:auto.length,auto_allocations:auto.reduce((s,x)=>s+x.entries.length,0),review_groups:review.length}};
}
