import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {createClient} from 'npm:@supabase/supabase-js@2';
import {suggestMatches} from './matcher.ts';

const URL=Deno.env.get('SUPABASE_URL')||'';
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const ANON=Deno.env.get('SUPABASE_ANON_KEY')||'';
const ORIGIN='https://financebaza.github.io';
const CORS={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
 'Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin'};
function reply(status:number,body:unknown){return new Response(JSON.stringify(body),{status,headers:CORS});}
function keyOf(s:any){return [s.kind,s.plan_rows.join(','),s.fact_rows.join(',')].join('|');}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});
 if(req.method!=='POST')return reply(405,{error:'Используйте POST'});
 if(req.headers.get('Origin')&&req.headers.get('Origin')!==ORIGIN)return reply(403,{error:'Недопустимый источник'});
 if(!URL||!SERVICE||!ANON)return reply(503,{error:'Не настроено подключение к Supabase'});
 const bearer=/^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization')||'');
 if(!bearer)return reply(401,{error:'Сначала войдите в систему'});
 const admin=createClient(URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:account,error:authError}=await admin.auth.getUser(bearer[1]);
 if(authError||!account?.user)return reply(401,{error:'Сессия недействительна'});
 const {data:profile,error:roleError}=await admin.from('user_profiles').select('role,is_active').eq('id',account.user.id).maybeSingle();
 if(roleError||!profile||!profile.is_active||!['viewer','approver','admin'].includes(profile.role))
   return reply(403,{error:'Нет разрешения на доступ к план/факту'});
 let body:any;try{body=await req.json();}catch{return reply(400,{error:'Некорректный JSON'});}
 const period=String(body?.period_id||'').trim();
 const action=String(body?.action||'preview');
 if(!/^[\w-]{5,64}$/.test(period))return reply(400,{error:'Некорректный период'});
 if(!['preview','apply_auto','approve_review','manual_link','save_note'].includes(action))return reply(400,{error:'Неизвестное действие'});
 if(action!=='preview'&&!['admin','approver'].includes(profile.role))return reply(403,{error:'Подтверждение сверки доступно только согласователю и администратору'});
 async function readAll(table:string,fields:string,sort:string,limit:number){
   const all:any[]=[];
   for(let start=0;start<limit;start+=1000){
     const {data,error}=await admin.from(table).select(fields).eq('period_id',period).order(sort).range(start,start+999);
     if(error)throw Error(error.message);
     all.push(...(data||[]));
     if(!data||data.length<1000)return all;
   }
   throw Error('Слишком много строк для одного периода. Данные не должны сверяться частично.');
 }
 let periodData:any,plans:any[],facts:any[];
 try{
   const {data,error}=await admin.from('reconciliation_periods').select('period_id,title,date_start,date_end,summary').eq('period_id',period).maybeSingle();
   if(error||!data)throw Error(error?.message||'Период не найден');
   periodData=data;
   [plans,facts]=await Promise.all([
     readAll('reconciliation_plan_rows','plan_row,payer,counterparty,flow_sign,flow_type,plan_amount,confirmed_amount,subcategory,project,notes,payment_purpose','plan_row',3000),
     readAll('reconciliation_fact_operations','fact_row,operation_date,payer,counterparty,amount_signed,flow_type,reconciliation_status,plan_refs,payment_purpose,suspected_duplicate','fact_row',5000)
   ]);
 }catch(e){return reply(502,{error:'Не удалось загрузить весь период сверки',details:e instanceof Error?e.message:String(e)});}
 const result=suggestMatches(plans,facts,{date_start:periodData.date_start,date_end:periodData.date_end});
 const suggestions={auto:result.auto.map((x:any)=>({...x,id:keyOf(x)})),review:result.review.map((x:any)=>({...x,id:keyOf(x)}))};
 if(action==='preview')return reply(200,{ok:true,period:periodData.title,period_id:period,result:{stats:result.stats,...suggestions}});
 if(action==='save_note'){
   const planRow=Number(body?.plan_row);
   const comment=String(body?.user_comment??'').trim();
   if(!Number.isInteger(planRow)||planRow<1)return reply(400,{error:'Некорректная строка плана'});
   if(comment.length>2000)return reply(400,{error:'Пометка не должна превышать 2000 символов'});
   const {data,error}=await admin.from('reconciliation_plan_rows').update({user_comment:comment})
     .eq('period_id',period).eq('plan_row',planRow).select('plan_row,user_comment').maybeSingle();
   if(error)return reply(409,{error:'Не удалось сохранить пометку: '+error.message});
   if(!data)return reply(404,{error:'Строка плана не найдена'});
   return reply(200,{ok:true,saved:true,plan_row:planRow});
 }
 if(action==='manual_link'){
   const planRow=Number(body?.plan_row);
   const rawRows=body?.fact_rows;
   if(!Number.isInteger(planRow)||planRow<1)return reply(400,{error:'Некорректная строка плана'});
   if(!Array.isArray(rawRows)||rawRows.length<1||rawRows.length>30||!rawRows.every((x:any)=>Number.isInteger(Number(x))&&Number(x)>0))
     return reply(400,{error:'Выберите от 1 до 30 операций 1С'});
   const factRows=rawRows.map((x:any)=>Number(x));
   if(new Set(factRows).size!==factRows.length)return reply(400,{error:'Операция 1С выбрана несколько раз'});
   const plan=plans.find(x=>Number(x.plan_row)===planRow);
   if(!plan)return reply(404,{error:'Строка плана не найдена'});
   if(plan.flow_sign!=='-')return reply(409,{error:'Вручную связывать можно только расходные строки плана'});
   const selectedFacts=factRows.map((row:number)=>facts.find(x=>Number(x.fact_row)===row));
   if(selectedFacts.some((x:any)=>!x))return reply(409,{error:'Одна из операций не найдена. Обновите страницу и выберите снова.'});
   if(selectedFacts.some((x:any)=>Number(x.amount_signed)>=0||String(x.plan_refs||'').trim()||String(x.suspected_duplicate||'').trim()))
     return reply(409,{error:'Выбрана нерасходная, уже связанная или помеченная как повтор операция'});
   const {data:queue,error:queueError}=await admin.from('reconciliation_unlinked_facts').select('fact_row')
     .eq('period_id',period).in('fact_row',factRows);
   if(queueError)return reply(502,{error:'Не удалось проверить операции без связи',details:queueError.message});
   if((queue||[]).length!==factRows.length)return reply(409,{error:'Часть операций уже распределена или исключена из списка сверки. Обновите страницу.'});
   const amountCents=selectedFacts.reduce((sum:number,x:any)=>sum+Math.round(Math.abs(Number(x.amount_signed))*100),0);
   const remainingCents=Math.round((Number(plan.plan_amount)-Number(plan.confirmed_amount||0))*100);
   if(amountCents>remainingCents+1)return reply(409,{error:'Выбранные операции превышают неподтверждённый остаток строки плана'});
   const kind=factRows.length>1?'one_to_many':amountCents>=remainingCents-1?'one_to_one':'partial';
   const explanation='Ручная связь: операции выбраны и подтверждены пользователем. Стороны, назначение и суммы следует проверить по документам.';
   const entries=selectedFacts.map((fact:any)=>({plan_row:planRow,fact_row:Number(fact.fact_row),
     amount:(Math.round(Math.abs(Number(fact.amount_signed))*100)/100).toFixed(2),kind,explanation}));
   const sessionClient=createClient(URL,ANON,{auth:{persistSession:false,autoRefreshToken:false},
     global:{headers:{Authorization:'Bearer '+bearer[1]}}});
   const {data:applied,error:applyError}=await sessionClient.rpc('reconciliation_apply_suggestions',{
     p_period_id:period,p_entries:entries,p_explanation:explanation
   });
   if(applyError)return reply(409,{error:'Связи не сохранены: '+applyError.message});
   return reply(200,{ok:true,applied,refresh_required:true});
 }
 const selected=body?.selected_ids;
 if(!Array.isArray(selected)||selected.length<1||selected.length>100||!selected.every(x=>typeof x==='string'&&x.length<=200))
   return reply(400,{error:'Выберите предложения для подтверждения'});
 if(new Set(selected).size!==selected.length)return reply(400,{error:'Найдены повторяющиеся предложения'});
 const pool=action==='apply_auto'?suggestions.auto:suggestions.review;
 const chosen=selected.map(id=>pool.find((x:any)=>x.id===id));
 if(chosen.some(x=>!x))return reply(409,{error:'Данные изменились или предложение больше не актуально. Запустите сверку ещё раз.'});
 const entries=chosen.flatMap((x:any)=>x.entries);
 const occupied=new Set();
 for(const e of entries){const slot=e.plan_row+':'+e.fact_row;if(occupied.has(slot))return reply(409,{error:'Дублирование связи'});
  occupied.add(slot);
 }
 const byFact=new Map<number,number>(),byPlan=new Map<number,number>();
 for(const e of entries){byFact.set(e.fact_row,(byFact.get(e.fact_row)||0)+Math.round(e.amount*100));
  byPlan.set(e.plan_row,(byPlan.get(e.plan_row)||0)+Math.round(e.amount*100));}
 for(const [fact,amt] of byFact){const f=facts.find(x=>x.fact_row===fact);
  if(!f||amt!==Math.round(Math.abs(Number(f.amount_signed))*100))
    return reply(409,{error:'Сумма распределений по операции '+fact+' не совпадает с исходным фактом'});
 }
 for(const [plan,amt] of byPlan){const p=plans.find(x=>x.plan_row===plan);
  if(!p||amt>Math.round((Number(p.plan_amount)-Number(p.confirmed_amount))*100)+1)
   return reply(409,{error:'Сумма распределений по заявке '+plan+' превышает остаток'});
 }
 const sessionClient=createClient(URL,ANON,{auth:{persistSession:false,autoRefreshToken:false},
  global:{headers:{Authorization:'Bearer '+bearer[1]}}});
 const label=action==='apply_auto'?'Автоматическая сверка BAZA Match v1':'Ручное подтверждение предложенного соответствия BAZA Match v1';
 const {data:applied,error:applyError}=await sessionClient.rpc('reconciliation_apply_suggestions',{
   p_period_id:period,p_entries:entries,p_explanation:label
 });
 if(applyError)return reply(409,{error:'Операции не применены: '+applyError.message});
 return reply(200,{ok:true,applied,refresh_required:true});
});
