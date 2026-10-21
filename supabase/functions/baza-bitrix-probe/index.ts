import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2";

const CRM_HOST="crm.baza.bz";
const CRM_ENTITY_TYPE_ID=185;
const CRM_CATEGORY_ID=19;
const ORIGIN="https://financebaza.github.io";
const headers={
 "Access-Control-Allow-Origin":ORIGIN,
 "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
 "Access-Control-Allow-Methods":"OPTIONS, POST",
 "Cache-Control":"no-store",
 "Content-Type":"application/json; charset=utf-8",
 "Vary":"Origin",
};
function respond(status:number,data:unknown){
 return new Response(JSON.stringify(data),{status,headers});
}
function validateWebhook(input:unknown):string{
 if(typeof input!=="string"||input.length<38||input.length>512)throw Error("Укажите полный URL входящего вебхука");
 let url:URL;
 try{url=new URL(input.trim());}catch{throw Error("Некорректная ссылка вебхука");}
 if(url.protocol!=="https:"||url.hostname.toLowerCase()!==CRM_HOST||url.port!==""||url.username||url.password||url.hash||url.search){
  throw Error("Вебхук должен вести на https://crm.baza.bz без параметров и фрагментов");
 }
 const match=url.pathname.match(/^\/rest\/([1-9]\d*)\/([A-Za-z0-9_-]{8,128})\/?$/);
 if(!match)throw Error("Ожидается адрес входящего вебхука формата /rest/ID/СЕКРЕТ/");
 return "https://"+CRM_HOST+"/rest/"+match[1]+"/"+match[2]+"/";
}
async function callBitrix(base:string,method:string,params:Record<string,unknown>){
 const controller=new AbortController();
 const handle=setTimeout(()=>controller.abort(),13000);
 try{
  const response=await fetch(base+method+".json",{
   method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},
   body:JSON.stringify(params),
   signal:controller.signal,
   redirect:"error"
  });
  if(!response.ok)throw Error("Битрикс ответил HTTP "+response.status);
  const data=await response.json();
  if(data?.error)throw Error(String(data.error_description||data.error).slice(0,240));
  if(!("result" in data))throw Error("Метод "+method+" не вернул результат");
  return data.result;
 }finally{clearTimeout(handle)}
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return respond(405,{error:"Разрешён только POST"});
 if(req.headers.get("Origin")&&req.headers.get("Origin")!==ORIGIN)return respond(403,{error:"Недопустимый источник"});
 const supabaseURL=Deno.env.get("SUPABASE_URL"),serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!supabaseURL||!serviceKey)return respond(503,{error:"Supabase не настроен"});
 const match=/^Bearer\s+(.+)$/i.exec(req.headers.get("Authorization")||"");
 if(!match)return respond(401,{error:"Требуется вход в BAZA"});
 const db=createClient(supabaseURL,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:session,error:authError}=await db.auth.getUser(match[1]);
 if(authError||!session?.user)return respond(401,{error:"Сессия недействительна"});
 const {data:profile,error:profileError}=await db.from("user_profiles")
 .select("role,is_active").eq("id",session.user.id).maybeSingle();
 if(profileError||profile?.role!=="admin"||!profile.is_active)return respond(403,{error:"Подключать CRM может только администратор BAZA"});
 let body:any;
 try{body=await req.json();}catch{return respond(400,{error:"Некорректный JSON"});}
 let base:string;
 try{base=validateWebhook(body?.webhook_url);}catch(e){return respond(400,{error:String((e as Error).message)});}
 // The webhook credential is used only in memory during this request.
 // It is never returned, logged, persisted in the database, or sent to the browser in the response.
 try{
  const [fieldsResponse,stagesResponse,typeResponse,itemsResponse]=await Promise.all([
    callBitrix(base,"crm.item.fields",{entityTypeId:CRM_ENTITY_TYPE_ID}),
    callBitrix(base,"crm.status.list",{filter:{ENTITY_ID:"DYNAMIC_"+CRM_ENTITY_TYPE_ID+"_STAGE_"+CRM_CATEGORY_ID},order:{SORT:"ASC"}}),
    callBitrix(base,"crm.type.getByEntityTypeId",{entityTypeId:CRM_ENTITY_TYPE_ID}),
    callBitrix(base,"crm.item.list",{entityTypeId:CRM_ENTITY_TYPE_ID,filter:{categoryId:CRM_CATEGORY_ID},
       select:["id","title","stageId","categoryId","opportunity","currencyId"],start:0})
  ]);
  const fields=fieldsResponse?.fields||fieldsResponse;
  const columns=Object.entries(fields||{}).map(([key,value])=>{
   const f=value as any;
   return {key,title:String(f?.title||f?.formLabel||f?.listLabel||key).slice(0,160),
    type:String(f?.type||"").slice(0,70),required:f?.isRequired===true||f?.isRequired==="Y"};
  });
  const stages=Array.isArray(stagesResponse)?stagesResponse.map(s=>({code:String(s.STATUS_ID||s.statusId||""),
     title:String(s.NAME||s.name||""),sort:Number(s.SORT||s.sort||0)})):[];
  const items=Array.isArray(itemsResponse?.items)?itemsResponse.items:[];
  const typeInfo=typeResponse?.type||typeResponse||{};
  return respond(200,{ok:true,connected:true,portal:CRM_HOST,
   entity_type_id:CRM_ENTITY_TYPE_ID,category_id:CRM_CATEGORY_ID,
   smart_process_title:typeInfo.title||"Смарт-процесс",
   stage_directory:"DYNAMIC_"+CRM_ENTITY_TYPE_ID+"_STAGE_"+CRM_CATEGORY_ID,
   fields:columns,stages,
   sample:items.slice(0,8).map(x=>({id:x.id,title:x.title,stageId:x.stageId,opportunity:x.opportunity,currencyId:x.currencyId})),
   more_available:itemsResponse?.total||itemsResponse?.next||null,
   note:"Проверка доступа без сохранения вебхука. Ни одна заявка не изменена."});
 }catch(e){
  // Never include full webhook URL or underlying network stack in the response.
  const msg=e instanceof Error?e.message:"Ошибка подключения";
  const safe=msg.includes(base)?"Не удалось установить соединение с порталом":msg;
  return respond(502,{error:"Не удалось прочитать смарт-процесс: "+safe.slice(0,250),
    hint:"Проверьте право CRM → чтение смарт-процесса 185 и доступность crm.baza.bz из внешней сети"});
 }
});
