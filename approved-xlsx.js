/* BAZA_APPROVED_CALENDAR_XLSX_V1 */
(function(){
  'use strict';

  const encoder = new TextEncoder();
  const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

  function columnName(n){
    let out='';
    while(n){n--;out=String.fromCharCode(65+n%26)+out;n=Math.floor(n/26);}
    return out;
  }
  function crc32(bytes){
    let c=0xffffffff;
    for(let i=0;i<bytes.length;i++){
      c^=bytes[i];
      for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);
    }
    return (c^0xffffffff)>>>0;
  }
  function join(parts){
    const size=parts.reduce((n,p)=>n+p.length,0),out=new Uint8Array(size);
    let offset=0;
    for(const p of parts){out.set(p,offset);offset+=p.length;}
    return out;
  }
  function u16(view,offset,value){view.setUint16(offset,value,true);}
  function u32(view,offset,value){view.setUint32(offset,value>>>0,true);}

  function zip(files){
    const local=[],central=[];
    let offset=0;
    for(const [name,content] of files){
      const filename=encoder.encode(name),data=encoder.encode(content),crc=crc32(data);
      const header=new Uint8Array(30),hv=new DataView(header.buffer);
      u32(hv,0,0x04034b50);u16(hv,4,20);u16(hv,6,0x0800);u16(hv,8,0);
      u16(hv,10,0);u16(hv,12,0);u32(hv,14,crc);u32(hv,18,data.length);
      u32(hv,22,data.length);u16(hv,26,filename.length);u16(hv,28,0);
      local.push(header,filename,data);

      const ch=new Uint8Array(46),cv=new DataView(ch.buffer);
      u32(cv,0,0x02014b50);u16(cv,4,20);u16(cv,6,20);u16(cv,8,0x0800);
      u16(cv,10,0);u16(cv,12,0);u16(cv,14,0);u32(cv,16,crc);
      u32(cv,20,data.length);u32(cv,24,data.length);u16(cv,28,filename.length);
      u16(cv,30,0);u16(cv,32,0);u16(cv,34,0);u16(cv,36,0);u32(cv,38,0);
      u32(cv,42,offset);
      central.push(ch,filename);
      offset+=header.length+filename.length+data.length;
    }
    const centralBytes=join(central),end=new Uint8Array(22),ev=new DataView(end.buffer);
    u32(ev,0,0x06054b50);u16(ev,4,0);u16(ev,6,0);
    u16(ev,8,files.length);u16(ev,10,files.length);u32(ev,12,centralBytes.length);
    u32(ev,16,offset);u16(ev,20,0);
    return new Blob([join([...local,centralBytes,end])],{
      type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  function worksheetXml(rows){
    const maxCols=Math.max(...rows.map(r=>r.length),1);
    const sheetRows=rows.map((row,ri)=>{
      const cells=[];
      for(let ci=0;ci<row.length;ci++){
        const value=row[ci];
        if(value===null||value===undefined||value==='')continue;
        const ref=columnName(ci+1)+(ri+1);
        if(typeof value==='number'&&Number.isFinite(value)){
          const style=ri>=5&&ci===5?' s="2"':'';
          const numeric=ci===5&&ri>=5?value.toFixed(2):String(value);
          cells.push('<c r="'+ref+'"'+style+'><v>'+numeric+'</v></c>');
        }else{
          const style=ri===4?' s="1"':'';
          cells.push('<c r="'+ref+'" t="inlineStr"'+style+'><is><t xml:space="preserve">'+xml(value)+'</t></is></c>');
        }
      }
      return '<row r="'+(ri+1)+'">'+cells.join('')+'</row>';
    }).join('');
    const widths=[6,19,15,30,31,17,22,25,29,24,34,42,20,26,36];
    const cols=widths.slice(0,maxCols).map((w,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>').join('');
    const lastRow=rows.length,lastCol=columnName(maxCols);
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
      '<dimension ref="A1:'+lastCol+lastRow+'"/>'+
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'+
      '<cols>'+cols+'</cols><sheetData>'+sheetRows+'</sheetData>'+
      '<autoFilter ref="A5:'+lastCol+lastRow+'"/>'+
      '<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>'+
      '</worksheet>';
  }

  function build({weekStart,version,lockedAt,approvalNote,items}){
    const rows=[
      ['Платёжный календарь — согласованная версия'],
      ['Неделя',weekStart,'Версия','v'+version],
      ['Дата фиксации',lockedAt||'','Основание фиксации',approvalNote||''],
      [],
      ['№','Статус согласования','Дата платежа','Плательщик','Получатель','Сумма, ₽','Источник средств',
       'Направление','Проект','Тип потока','Подстатья','Назначение / комментарий','Источник заявки','ID заявки','ID платежа']
    ];
    items.forEach((r,i)=>rows.push([
      i+1,'Согласован',r.dueDate||'',r.entity||'',r.counterparty||'',Number(r.amount)||0,
      r.source||'',r.direction||'',r.project||'',r.flowType||'',r.subcategory||'',r.memo||'',
      r.origin==='bitrix'?'Битрикс24':r.origin==='vgo'?'ВГО':r.origin==='other'?'Прочие':r.origin||'',
      r.sourceRef||'',r.calendarItemId||r.id||''
    ]));
    return rows;
  }

  function download(options){
    if(!options||!options.items||!options.items.length)throw new Error('В утверждённом платёжном календаре нет платежей для выгрузки.');
    const rows=build(options);
    const contentTypes='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
      '<Default Extension="xml" ContentType="application/xml"/>'+
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'+
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+
      '</Types>';
    const rootRels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'+
      '</Relationships>';
    const workbook='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+
      '<sheets><sheet name="Согласованные платежи" sheetId="1" r:id="rId1"/></sheets></workbook>';
    const workbookRels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'+
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'+
      '</Relationships>';
    const styles='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00 &quot;₽&quot;"/></numFmts>'+
      '<fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Arial"/></font></fonts>'+
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF123B67"/><bgColor indexed="64"/></patternFill></fill></fills>'+
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'+
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
      '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'+
      '<xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'+
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'+
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    const file=zip([
      ['[Content_Types].xml',contentTypes],['_rels/.rels',rootRels],
      ['xl/workbook.xml',workbook],['xl/_rels/workbook.xml.rels',workbookRels],
      ['xl/styles.xml',styles],['xl/worksheets/sheet1.xml',worksheetXml(rows)]
    ]);
    const link=document.createElement('a'),url=URL.createObjectURL(file);
    link.href=url;
    link.download='Платёжный_календарь_'+options.weekStart+'_согласован.xlsx';
    link.style.display='none';document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }

  window.BazaApprovedXlsx={download,build};
})();