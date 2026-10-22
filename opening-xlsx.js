/* BAZA native read-only XLSX parser for "Плоский" 1C bank account export.
   Reads the user's workbook locally without uploading its full content. */
(function(){
 'use strict';
 const normalize=x=>String(x??'').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/[^a-zа-я0-9]/g,'');
 const toIso=d=>{
  const m=String(d||'').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if(!m)return '';
  const date=new Date(Date.UTC(+m[3],+m[2]-1,+m[1]));
  return date.getUTCDate()===+m[1]&&date.getUTCMonth()===+m[2]-1&&date.getUTCFullYear()===+m[3]
   ?m[3]+'-'+m[2]+'-'+m[1]:'';
 };
 async function parse(file){
  const bytes=await file.arrayBuffer();
  if(bytes.byteLength>5*1024*1024)throw Error('Файл XLSX больше 5 МБ.');
  const v=new DataView(bytes);
  let eocd=-1;
  for(let i=bytes.byteLength-22;i>=Math.max(0,bytes.byteLength-65557);i--){
   if(v.getUint32(i,true)===0x06054b50){eocd=i;break;}
  }
  if(eocd<0)throw Error('Это не XLSX: неверная ZIP-структура.');
  const entryCount=v.getUint16(eocd+10,true);
  let pos=v.getUint32(eocd+16,true);
  if(entryCount>2000||pos>=bytes.byteLength)throw Error('Повреждён каталог XLSX.');
  const zip=new Map();
  for(let i=0;i<entryCount;i++){
   if(v.getUint32(pos,true)!==0x02014b50)throw Error('Ошибка структуры ZIP.');
   const nameLen=v.getUint16(pos+28,true),extraLen=v.getUint16(pos+30,true),commentLen=v.getUint16(pos+32,true);
   const name=new TextDecoder().decode(new Uint8Array(bytes,pos+46,nameLen));
   zip.set(name,{method:v.getUint16(pos+10,true),size:v.getUint32(pos+20,true),
     rawSize:v.getUint32(pos+24,true),local:v.getUint32(pos+42,true)});
   pos+=46+nameLen+extraLen+commentLen;
  }
  async function xml(name){
   const e=zip.get(name);if(!e)return null;
   if(e.rawSize>25*1024*1024)throw Error('Слишком большой лист XLSX.');
   const l=e.local;
   if(v.getUint32(l,true)!==0x04034b50)throw Error('Повреждён лист '+name);
   const start=l+30+v.getUint16(l+26,true)+v.getUint16(l+28,true);
   if(start+e.size>bytes.byteLength)throw Error('Повреждён размер '+name);
   const content=new Uint8Array(bytes,start,e.size);
   let output;
   if(e.method===0)output=content;
   else if(e.method===8){
    if(typeof DecompressionStream!=='function')throw Error('Браузер не поддерживает распаковку XLSX.');
    output=new Uint8Array(await new Response(new Blob([content]).stream().pipeThrough(
      new DecompressionStream('deflate-raw'))).arrayBuffer());
   }else throw Error('Неподдерживаемый метод сжатия XLSX.');
   if(output.byteLength!==e.rawSize)throw Error('Ошибка целостности файла XLSX.');
   const documentXml=new DOMParser().parseFromString(new TextDecoder().decode(output),'application/xml');
   if(documentXml.getElementsByTagName('parsererror').length)throw Error('Некорректный XML в XLSX.');
   return documentXml;
  }
  const shared=await xml('xl/sharedStrings.xml');
  const strings=shared?[...shared.getElementsByTagName('si')].map(item=>
    [...item.getElementsByTagName('t')].map(t=>t.textContent).join('')):[];
  const sheets=[...zip.keys()].filter(name=>/^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if(!sheets.length)throw Error('В XLSX нет листов с данными.');
  function readRows(sheet){
   const out=[];
   for(const r of sheet.getElementsByTagName('row')){
    const rowNumber=Number(r.getAttribute('r'));
    if(!Number.isInteger(rowNumber)||rowNumber<1||rowNumber>20000)continue;
    const fields=[];
    for(const c of r.getElementsByTagName('c')){
     const address=c.getAttribute('r')||'';
     const letters=(address.match(/^[A-Z]+/i)||[])[0]||'';
     let col=0;for(const ch of letters.toUpperCase())col=col*26+ch.charCodeAt(0)-64;col--;
     if(col<0||col>150)continue;
     const t=c.getAttribute('t')||'',raw=c.getElementsByTagName('v')[0]?.textContent;
     if(t==='inlineStr')fields[col]=[...c.getElementsByTagName('t')].map(x=>x.textContent).join('');
     else if(t==='s')fields[col]=strings[Number(raw)]??'';
     else if(t==='b')fields[col]=raw==='1';
     else if(raw!=null&&raw!=='')fields[col]=t==='str'||t==='e'?raw:Number(raw);
    }
    out[rowNumber-1]=fields;
   }
   return out;
  }
  let rows,head,rowStart;
  for(const name of sheets){
   const sheet=await xml(name),candidate=readRows(sheet);
   for(let i=0;i<Math.min(candidate.length,24);i++){
    const normalized=(candidate[i]||[]).map(normalize);
    if(['организация','счет','собственныесредства','суммасобственные'].every(v=>normalized.includes(v))){
     rows=candidate;head=normalized;rowStart=i;break;
    }
   }
   if(rows)break;
  }
  if(!rows)throw Error('Отчёт не похож на «Плоский»: нет колонок «Организация», «Счет», «Собственные средства», «Сумма собственные».');
  const col=x=>head.indexOf(normalize(x));
  const org=col('Организация'),acc=col('Счет'),kind=col('Вид средств'),
    own=col('Собственные средства'),value=col('Сумма собственные'),gross=col('Сумма');
  const reportText=(rows.slice(0,12).flatMap(r=>r||[]).map(x=>String(x||'')).
    find(x=>/Дата\s*:\s*\d{2}\.\d{2}\.\d{4}/i.test(x))||'');
  const md=reportText.match(/Дата\s*:\s*(\d{2}\.\d{2}\.\d{4})/i);
  const reportDate=md?toIso(md[1]):'';
  let restricted=0,otherAccounts=0,missing=0;
  const groups=new Map();
  for(let i=rowStart+1;i<rows.length;i++){
   const row=rows[i]||[],company=String(row[org]||'').trim();
   if(!company||normalize(company)==='итого')continue;
   const account=String(row[acc]??'').trim(),flow=normalize(row[kind]),ownFlag=normalize(row[own]);
   if(account!=='51'||flow!=='расчетныесчета'){otherAccounts++;continue}
   if(ownFlag!=='да'){restricted++;continue}
   const raw=row[value]!==null&&row[value]!==undefined&&row[value]!==''?row[value]:row[gross];
   if(raw==null||raw===''||!Number.isFinite(Number(raw))){missing++;continue}
   const num=Number(raw);if(Math.abs(num)>1e14)throw Error('Недопустимо большая сумма в строке '+(i+1));
   const key=normalize(company),item=groups.get(key)||{name:company,cents:0,accounts:0};
   item.cents+=Math.round(num*100);item.accounts++;groups.set(key,item);
  }
  return {groups:[...groups.values()],reportDate,excluded:{restricted,otherAccounts,missing}};
 }
 window.BazaOpeningXlsx={parse,normalize};
})();