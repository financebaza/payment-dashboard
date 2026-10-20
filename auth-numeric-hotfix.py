from pathlib import Path
p=Path('index.html')
s=p.read_text(encoding='utf-8')
old='window.PAYMENTS=await res.json();'
new='window.PAYMENTS=(await res.json()).map(r=>({...r,amount:Number(r.amount)}));'
if old in s and 'BAZA_AUTH_NUMERIC_V1' not in s:
    s=s.replace(old,new)
    s=s.replace('</body>','<script>/* BAZA_AUTH_NUMERIC_V1 */</script>\n</body>')
    p.write_text(s,encoding='utf-8')
