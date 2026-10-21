import {assertEquals,assert} from "jsr:@std/assert@1";
import {suggestMatches} from "./matcher.ts";
const p=(id:number,sum:number,payer="ООО СЗ СТРОЙКАТЕРИНБУРГ",counterparty="ООО СК БАЗА")=>({
 plan_row:id,plan_amount:sum,confirmed_amount:0,payer,counterparty,flow_sign:"-",flow_type:"ВГО",project:"Алиса",subcategory:"ГП",notes:"",payment_purpose:""
});
const f=(id:number,sum:number,payer="БАЗА ООО СК",counterparty="СТРОЙКАТЕРИНБУРГ ООО СЗ")=>({
 fact_row:id,amount_signed:sum,operation_date:"2026-10-14",payer,counterparty,
 flow_type:sum>0?"Поступление":"ВГО",plan_refs:"",suspected_duplicate:"",payment_purpose:"Оплата по договору №А-1 от 01.01.2026"
});
Deno.test("Unique exact 1-to-1",()=>{
 const o=suggestMatches([p(1,10000000)],[f(11,10000000)]);
 assertEquals(o.auto.length,1);assertEquals(o.auto[0].kind,"one_to_one");
});
Deno.test("30M split into three verified transfers",()=>{
 const o=suggestMatches([p(1,30000000)],[f(11,10000000),f(12,10000000),f(13,10000000)]);
 assertEquals(o.auto.length,1);assertEquals(o.auto[0].kind,"one_to_many");assertEquals(o.auto[0].entries.length,3);
});
Deno.test("One fact into two claims requires document proof",()=>{
 const o=suggestMatches([p(1,4000000),p(2,6000000)],[f(11,10000000)]);
 assertEquals(o.auto.length,0);assertEquals(o.review[0].kind,"many_to_one");
});
Deno.test("Partial 4.05M group gives outstanding 27,500",()=>{
 const o=suggestMatches([p(1,4050000)],[f(11,4012500),f(12,10000)]);
 assertEquals(o.auto.length,0);
 assertEquals(o.review[0].kind,"partial");
 assertEquals(o.review[0].amount,4022500);
});
Deno.test("Previously linked fact cannot be reused",()=>{
 const o=suggestMatches([p(1,10000000)],[{...f(11,10000000),plan_refs:"90"}]);
 assertEquals(o.auto.length,0);assertEquals(o.review.length,0);
});
Deno.test("Mirrored income cannot reuse linked original debit",()=>{
 const plan=p(1,4050000,"ООО БАЗА ДЕВЕЛОПМЕНТ","ООО СЗ БАЗА В СЕРДЦЕ ГОРОДА-1");
 const debit=f(12,-10000,"ООО БАЗА ДЕВЕЛОПМЕНТ","ООО СЗ БАЗА В СЕРДЦЕ ГОРОДА-1");
 debit.plan_refs="1";
 const income=f(13,10000,"ООО СЗ БАЗА В СЕРДЦЕ ГОРОДА-1","ООО БАЗА ДЕВЕЛОПМЕНТ");
 const o=suggestMatches([plan],[debit,income]);
 assertEquals(o.auto.length,0);assertEquals(o.review.length,0);
});
Deno.test("Duplicate bank export ignored",()=>{
 const o=suggestMatches([p(1,10000)],[{...f(11,10000),suspected_duplicate:"повтор"}]);
 assertEquals(o.auto.length,0);assertEquals(o.review.length,0);
});
Deno.test("Identical competing plans cannot auto-claim same fact",()=>{
 const o=suggestMatches([p(1,10000000),p(2,10000000)],[f(11,10000000)]);
 assertEquals(o.auto.length,0);
});
