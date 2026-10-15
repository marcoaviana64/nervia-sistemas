/* Auditoria de Telefonia Móvel (Nervia) — desenho do relatório.
   Usado pelo app (/apps/telefonia/) e pela demonstração (/demo/telefonia/).
   RelatorioTelefonia.montar(elemento, rel): rel = {id, titulo, empresa, cliente_num, conta, operadora, perfil,
   linhas:[{n, dono, sub, plano, fr, iccid, add:[]}], dados:{cicloInicio, inicio, fim, dataCycle, daily, roam, voice}, fontes, notas:[], atualizado_em} */
(function(){
  const e = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  function esqueleto(R){
    const D = R.dados, ci = D.cicloInicio;
    const meta = [
      R.cliente_num ? `<div>Nº do cliente <b>${e(R.cliente_num)}</b></div>` : '',
      R.conta ? `<div>Conta <b>${e(R.conta)}</b></div>` : '',
      `<div>Período analisado <b id="mPeriodo"></b></div>`,
      `<div>Linhas ativas <b>${R.linhas.length}</b></div>`,
      `<div>Ciclo <b>dia ${ci} → dia ${ci-1||'último'}</b></div>`,
      R.perfil ? `<div>Perfil <b>${e(R.perfil)}</b></div>` : '',
    ].join('');
    const notas = (R.notas||[]).filter(Boolean).map(n => `<div>${e(n)}</div>`).join('');
    return `
<div class="wrap">
  <header class="top">
    <div>
      <div class="eyebrow">Auditoria de Telefonia Móvel · ${e(R.operadora || 'Claro Empresas')}</div>
      <h1>${e(R.titulo)} <span>·</span> Telefonia móvel</h1>
      ${R.empresa ? `<div class="company">${e(R.empresa)}</div>` : ''}
    </div>
    <div class="meta">${meta}</div>
  </header>

  <section class="filterbar" aria-label="Filtro de período">
    <div class="fb-row">
      <span class="eyebrow">Período</span>
      <div class="chips" id="presets" role="group" aria-label="Períodos rápidos"></div>
      <div class="fb-sel">
        <label for="fFrom">De</label><select id="fFrom"></select>
        <label for="fTo">até</label><select id="fTo"></select>
      </div>
      <span class="fb-sum mono" id="fSum"></span>
    </div>
  </section>

  <section>
    <div class="sec-head"><h2>Resumo executivo</h2><p id="periodNote"></p></div>
    <div class="kpis" id="kpis"></div>
  </section>

  <section>
    <div class="sec-head"><h2>Pontos de atenção</h2><p>Situação atual e histórico completo — não mudam com o filtro.</p></div>
    <div class="alerts" id="alerts"></div>
  </section>

  <section>
    <div class="sec-head"><h2>Contratado × consumido</h2><p>Franquia principal = pacote de internet do plano (tráfego Web). Redes sociais, WhatsApp e Waze usam pacotes à parte e não abatem da franquia.</p></div>
    <div class="panel"><div class="table-scroll"><table id="tbl"></table></div></div>
  </section>

  <section>
    <div class="sec-head"><h2>Passaportes internacionais: contratado × consumido</h2><p id="passNote"></p></div>
    <div class="panel"><div class="table-scroll"><table id="passTbl"></table></div><div class="stats" id="passStats"></div></div>
  </section>

  <section>
    <div class="sec-head">
      <h2>Internet por ciclo e por linha frente à franquia</h2>
      <div class="legend"><span><i style="background:var(--web)"></i>Web consumido</span><span><i class="proj"></i>Projeção ciclo atual</span><span><i class="dash"></i>Franquia contratada</span></div>
    </div>
    <div class="multiples" id="mult"></div>
  </section>

  <section class="grid2">
    <div class="panel">
      <div class="sec-head"><h3>Para onde vai o tráfego de dados</h3><span class="eyebrow" id="compPeriod"></span></div>
      <div class="legend" id="compLeg" style="margin-bottom:10px"></div>
      <div class="hbar" id="comp"></div>
    </div>
    <div class="panel">
      <div class="sec-head"><h3 id="roamTitle">Roaming internacional</h3><span class="muted" style="font-size:12px" id="roamAsOf"></span><span class="pill crit" id="roamPill"></span></div>
      <div class="legend" id="roamLeg" style="margin-bottom:6px"><span><i style="background:var(--roam)"></i>Acumulado no passaporte</span><span><i class="dash"></i><span id="roamLimLbl">Limite do pacote</span></span></div>
      <div class="hbar" id="roam"></div>
      <div class="stats" id="roamStats"></div>
    </div>
  </section>

  <section class="panel">
    <div class="sec-head">
      <h3>Consumo diário de dados</h3>
      <div class="chips" id="chips" role="group" aria-label="Escolher linha"></div>
    </div>
    <div class="legend" id="dailyLeg" style="margin-bottom:8px"></div>
    <div class="chart-wide" id="daily"></div>
    <div class="stats" id="dailyStats"></div>
  </section>

  <section class="panel">
    <div class="sec-head"><h3>Voz: minutos originados por linha</h3><p>Em plano com voz ilimitada, o dado serve para dimensionamento e não gera custo extra no Brasil.</p></div>
    <div class="legend" id="voiceLeg" style="margin-bottom:10px"></div>
    <div class="hbar" id="voice"></div>
  </section>

  <section class="panel">
    <div class="sec-head"><h2>Recomendações</h2><p>Leitura de consultoria com base em todo o histórico (não muda com o filtro). Valores em R$ dependem da fatura — envie a fatura para quantificarmos a economia.</p></div>
    <div class="recs" id="recs"></div>
  </section>

  <section class="notes">
    ${R.fontes ? `<div><b>Fontes:</b> ${e(R.fontes)}</div>` : ''}
    <div id="nMetodo"></div>
    <div><b>Donos das linhas:</b> conforme o cadastro informado pelo cliente.</div>
    ${notas}
    <div><b>Voz:</b> "Caixa postal" reúne chamadas para o próprio número (consulta à caixa postal) e recados da operadora.</div>
    <div><b>Relatório Nervia</b>${R.atualizado_em ? ` · atualizado em ${e(new Date(R.atualizado_em).toLocaleDateString('pt-BR'))}` : ''} · atendimento@nervia.com.br</div>
  </section>
</div>
<div id="tip" hidden></div>`;
  }

  function montar(alvo, REL){
    alvo.innerHTML = esqueleto(REL);
    const D = REL.dados;
    const V = D.voice;
    
    const LINES = REL.linhas;
    const shortName = l => l.short || l.dono;
    const CATS = [
      {k:'web',l:'Web (franquia)',c:'var(--web)'},
      {k:'social',l:'Redes sociais',c:'var(--social)'},
      {k:'whats',l:'WhatsApp',c:'var(--whats)'},
      {k:'roam',l:'Roaming',c:'var(--roam)'},
      {k:'waze',l:'Waze',c:'var(--waze)'},
    ];
    const VC = [
      {k:'fixo',l:'Para fixo',c:'var(--web)'},
      {k:'movel',l:'Para móvel',c:'var(--social)'},
      {k:'x0800',l:'0800 / especial',c:'var(--whats)'},
      {k:'cx',l:'Caixa postal',c:'var(--neutral)'},
    ];
    
    const fmt = (v,d=1)=> (v??0).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d});
    const fmtNum = n => `(${n.slice(2,4)}) ${n.slice(4,9)}-${n.slice(9)}`;
    const esc = s => String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    const pad = n=>String(n).padStart(2,'0');
    const ICON = {
      crit:'<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1 11 10.5H1Z" fill="currentColor"/></svg>',
      warn:'<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="currentColor"/></svg>',
      ok:'<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5 5 9l5-6" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
      info:'<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="1" width="10" height="10" rx="2" fill="currentColor"/></svg>'
    };
    const pill = (s,t)=>`<span class="pill ${s}">${ICON[s]}${esc(t)}</span>`;
    
    /* ---------- ciclos de faturamento (dia CI ao dia CI-1) ---------- */
    const CI = D.cicloInicio;
    const DAY = 864e5;
    const d0 = s => new Date(s+'T00:00:00');
    const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const dm = d => `${pad(d.getDate())}/${pad(d.getMonth()+1)}`;
    const DI = d0(D.inicio), DF = d0(D.fim);
    const ALLC = [...new Set(Object.values(D.dataCycle).flatMap(o=>Object.keys(o)))].sort();
    const CYC = {};
    ALLC.forEach(k=>{
      const [y,m] = k.split('-').map(Number);
      const s = new Date(y,m-1,CI), e = new Date(y,m,CI-1);
      const cs = s<DI?DI:s, ce = e>DF?DF:e;
      const len = Math.round((e-s)/DAY)+1, days = Math.round((ce-cs)/DAY)+1;
      CYC[k] = {k,s,e,cs,ce,len,days,frac:days/len,complete:days===len,current:e>DF,startPartial:s<DI,
                lbl:dm(cs), name:`${dm(cs)}–${dm(e)}`};
    });
    const CUR = ALLC[ALLC.length-1];
    
    /* ---------- métricas por linha para um conjunto de ciclos ---------- */
    function compute(sel){
      const frac = sel.reduce((a,k)=>a+CYC[k].frac,0);
      const M = {};
      LINES.forEach(L=>{
        const mm = D.dataCycle[L.n] || {};
        const web = sel.map(k=>(mm[k]?.web)||0);
        const proj = sel.map((k,i)=> CYC[k].complete ? web[i] : web[i]/CYC[k].frac);
        const avg = web.reduce((a,b)=>a+b,0)/frac;
        const peakIdx = sel.map((k,i)=>i).filter(i=>!CYC[sel[i]].startPartial);
        const peak = Math.max(0, ...(peakIdx.length?peakIdx:sel.map((k,i)=>i)).map(i=>proj[i]));
        const tot = {}; CATS.forEach(c=>tot[c.k]=0);
        sel.forEach(k=>CATS.forEach(c=>tot[c.k]+=(mm[k]?.[c.k])||0));
        const vt = {}; VC.forEach(c=>vt[c.k]={n:0,m:0});
        sel.forEach(k=>Object.entries((V[L.n]||{})[k]||{}).forEach(([c,[n,m]])=>{vt[c].n+=n; vt[c].m+=m;}));
        const vout = VC.filter(c=>c.k!=='cx').reduce((a,c)=>a+vt[c.k].m,0);
        M[L.n] = {web,proj,avg,peak,util:avg/L.fr,peakUtil:peak/L.fr,tot,vt,vout};
      });
      return {sel,frac,M};
    }
    const DEFAULT = {from: ALLC.find(k=>!CYC[k].startPartial) || ALLC[0], to: CUR};
    const HIST = compute(ALLC.filter(k=>k>=DEFAULT.from));   // base fixa dos alertas e recomendações
    let S = compute(ALLC.filter(k=>k>=DEFAULT.from));
    const periodTxt = sel => `${dm(CYC[sel[0]].cs)}/${String(CYC[sel[0]].cs.getFullYear()).slice(2)} – ${dm(CYC[sel[sel.length-1]].ce)}/${String(CYC[sel[sel.length-1]].ce.getFullYear()).slice(2)}`;
    
    /* ---------- tooltip ---------- */
    const tip = document.getElementById('tip');
    function showTip(e, title, rows){
      tip.innerHTML = `<div class="t">${esc(title)}</div>` + rows.map(r=>`<div class="row"><span>${r.c?`<i style="background:${r.c}"></i>`:''}${esc(r.l)}</span><span>${esc(r.v)}</span></div>`).join('');
      tip.hidden=false;
      const x = e.clientX+14, y=e.clientY+14, w=tip.offsetWidth, h=tip.offsetHeight;
      tip.style.left = (x+w>innerWidth-8? e.clientX-w-14 : x)+'px';
      tip.style.top = (y+h>innerHeight-8? e.clientY-h-14 : y)+'px';
    }
    function hideTip(){tip.hidden=true}
    const svgEl = (w,h,inner,label)=>`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">${inner}</svg>`;
    function bindHits(root){
      root.querySelectorAll('[data-tip]').forEach(el=>{
        const d = JSON.parse(el.dataset.tip);
        const hl = el.previousElementSibling && el.previousElementSibling.classList.contains('hl') ? el.previousElementSibling : null;
        el.addEventListener('mousemove',e=>{showTip(e,d.t,d.r); if(hl) hl.style.display='';});
        el.addEventListener('mouseleave',()=>{hideTip(); if(hl) hl.style.display='none';});
      });
    }
    const tipAttr = o => `data-tip='${JSON.stringify(o).replace(/'/g,"&#39;")}'`;
    
    /* ---------- roaming (estado atual, independe do filtro) ---------- */
    const passFr = r => r.pac.includes('Mundo') ? 10 : 5;
    const ROAM_ON = r => r.fim >= iso(new Date(d0(D.fim).getTime()-DAY));
    const roam = (D.roam||[]).slice().sort((a,b)=> (ROAM_ON(b)-ROAM_ON(a)) || (b.ciclo.localeCompare(a.ciclo)) || (b.GB/passFr(b)-a.GB/passFr(a)))[0];
    const nomeDe = n => (LINES.find(l=>l.n===n)||{dono:fmtNum(n)}).dono;
    const LIM = roam?passFr(roam):10, ONGOING = roam?ROAM_ON(roam):false, PNAME = roam&&roam.pac.includes('Mundo')?'Passaporte Mundo':'Passaporte Américas';
    const roamLine = roam?{n:roam.n,dono:nomeDe(roam.n)}:null;
    const RD = roam ? (()=>{
      const dd = D.daily[roam.n]||{};
      const days = Object.keys(dd).filter(d=>dd[d].roam && d>=roam.ini && d<=roam.fim).sort();
      let acc=0; const pts = days.map(d=>{acc+=dd[d].roam; return {d,v:dd[d].roam,acc};});
      const last7 = pts.slice(-7).reduce((a,p)=>a+p.v,0)/Math.max(1,Math.min(7,pts.length));
      const left = Math.max(0,LIM-acc); const daysLeft = ONGOING && last7>0 ? left/last7 : 0;
      return {pts,acc,last7,left,daysLeft};
    })() : null;
    const VMAX = (()=>{ let b={m:0,dono:'',k:''};
      Object.entries(V||{}).forEach(([n,cy])=>Object.entries(cy).forEach(([k,o])=>{
        const m=Object.entries(o).filter(([c])=>c!=='cx').reduce((a,[,v])=>a+v[1],0);
        if(m>b.m) b={m,dono:nomeDe(n),k}; }));
      return b; })();
    
    /* ================= seções que seguem o filtro ================= */
    function renderKPIs(){
      const {M,frac,sel}=S;
      const frTot = LINES.reduce((a,l)=>a+l.fr,0);
      const useAvg = LINES.reduce((a,l)=>a+M[l.n].avg,0);
      const pct = useAvg/frTot;
      const voiceAvg = LINES.reduce((a,l)=>a+M[l.n].vout,0)/frac;
      const k = [
        {e:'Franquia contratada', v:`${frTot}<small>GB/ciclo</small>`, d:Object.entries(LINES.reduce((o,l)=>(o[l.fr]=(o[l.fr]||0)+1,o),{})).sort((a,b)=>b[0]-a[0]).map(([fr,q])=>`${q} × ${fr} GB`).join(' + ')},
        {e:'Franquia utilizada', v:`${fmt(pct*100,0)}<small>%</small>`, d:`média de ${fmt(useAvg,0)} GB/ciclo somando as ${LINES.length} linhas`, meter:pct},
        {e:'Linhas superdimensionadas', v:`${LINES.filter(l=>M[l.n].peakUtil<0.3).length}<small>de ${LINES.length}</small>`, d:`pico por ciclo abaixo de 30% da franquia`},
        {e:'Voz originada', v:`${fmt(voiceAvg,0)}<small>min/ciclo</small>`, d:`total das linhas · plano com voz ilimitada`},
      ];
      document.getElementById('kpis').innerHTML = k.map(x=>`<div class="kpi"><div class="eyebrow">${x.e}</div><div class="v">${x.v}</div>${x.meter!=null?`<div class="meter" role="img" aria-label="${fmt(x.meter*100,0)}% utilizado"><i style="width:${Math.min(100,x.meter*100)}%"></i></div>`:''}<div class="d">${x.d}</div></div>`).join('');
      const inc = sel.filter(k=>!CYC[k].complete);
      document.getElementById('periodNote').textContent = `${sel.length} ${sel.length>1?'ciclos':'ciclo'} selecionado${sel.length>1?'s':''}. Ciclos incompletos (${inc.length?inc.map(k=>CYC[k].name+(CYC[k].current?' em andamento':' início dos dados')).join('; '):'nenhum'}) entram na média proporcionalmente aos dias com dados; o ciclo em andamento é projetado até o fim.`;
    }
    
    function renderTable(){
      const {M}=S;
      const rec = l=>{
        const m=HIST.M[l.n];
        if(m.avg<0.01) return pill('warn','Suspender ou reduzir');
        if(m.peakUtil<0.3) return pill('info',`Reduzir para ${m.peak>22?'30 GB':m.peak>18?'25–30 GB':'25 GB'}`);
        return pill('ok','Adequado');
      };
      const used = (l,a)=> D.roam.some(r=>r.n===l.n && S.sel.includes(r.ciclo) && ((a.includes('Américas')&&r.pac.includes('Americas'))||(a.includes('Mundo')&&r.pac.includes('Mundo'))));
      let h = `<thead><tr><th>Usuário / linha</th><th>Plano contratado</th><th>Adicionais</th><th class="r">Média web/ciclo</th><th class="r">Pico por ciclo</th><th>Uso da franquia</th><th>Recomendação</th></tr></thead><tbody>`;
      LINES.forEach(l=>{
        const m=M[l.n];
        h += `<tr>
          <td class="who">${esc(l.dono)}${l.sub?` <span class="muted" style="font-weight:400">(${esc(l.sub)})</span>`:''}<small>${fmtNum(l.n)}</small></td>
          <td><span class="plan">${esc(l.plano)}</span><div class="muted mono" style="font-size:11.5px">ICCID …${l.iccid.slice(-6)}</div></td>
          <td><div class="addons">${l.add.length? l.add.map(a=>`<span class="tag${used(l,a)?' used':''}" title="${used(l,a)?'Usado no período':'Sem uso no período'}">${esc(a)}${used(l,a)?' · usado':''}</span>`).join('') : '<span class="muted">—</span>'}</div></td>
          <td class="r num">${fmt(m.avg)} GB</td>
          <td class="r num">${fmt(m.peak)} GB</td>
          <td class="use"><div class="lbl"><span>${fmt(m.util*100,0)}% médio</span><span>${fmt(m.peakUtil*100,0)}% pico</span></div><div class="bar" role="img" aria-label="Uso médio ${fmt(m.util*100,0)}%, pico ${fmt(m.peakUtil*100,0)}%"><i style="width:${Math.min(100,m.util*100)}%"></i><b style="left:calc(${Math.min(100,m.peakUtil*100)}% - 1px)"></b></div></td>
          <td>${rec(l)}</td></tr>`;
      });
      document.getElementById('tbl').innerHTML = h+'</tbody>';
    }
    
    function renderMult(){
      const {M,sel}=S;
      const W=260,H=160,pl=30,pr=6,pt=16,pb=20, iw=W-pl-pr, ih=H-pt-pb;
      const defs=`<defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="transparent"/><line x1="0" y1="0" x2="0" y2="5" stroke="var(--web)" stroke-width="2"/></pattern></defs>`;
      let out='';
      LINES.forEach(l=>{
        const m=M[l.n], max=l.fr, y=v=>pt+ih-(Math.min(v,max)/max)*ih;
        const step=iw/sel.length, bw=Math.min(28,step-8);
        let g='';
        [0,.5,1].forEach(f=>{const yy=pt+ih-f*ih; g+=`<line class="gl" x1="${pl}" x2="${W-pr}" y1="${yy}" y2="${yy}"/><text x="${pl-5}" y="${yy+3}" text-anchor="end">${max*f}</text>`;});
        g+=`<line class="ref" x1="${pl}" x2="${W-pr}" y1="${pt}" y2="${pt}"/>`;
        sel.forEach((k,i)=>{
          const C=CYC[k], cx=pl+step*i+step/2, x=cx-bw/2, v=m.web[i];
          const yv=y(v), hgt=pt+ih-yv, r=Math.min(3,hgt);
          if(C.current){ const yp=y(m.proj[i]); g+=`<rect x="${x}" y="${yp}" width="${bw}" height="${Math.max(0,yv-yp)}" fill="url(#hatch)" stroke="var(--web)" stroke-width="1"/>`; }
          if(hgt>0) g+=`<path d="M${x},${pt+ih} V${yv+r} q0,-${r} ${r},-${r} H${x+bw-r} q${r},0 ${r},${r} V${pt+ih} Z" fill="var(--web)"${C.startPartial?' opacity=".45"':''}/>`;
          if(sel.length<=8 || i%2===0) g+=`<text x="${cx}" y="${H-6}" text-anchor="middle">${C.lbl}</text>`;
          const rows=[{l:'Web',v:fmt(v)+' GB',c:'var(--web)'}];
          if(C.current) rows.push({l:'Projeção fim do ciclo',v:fmt(m.proj[i])+' GB'});
          rows.push({l:'da franquia',v:fmt((C.current?m.proj[i]:v)/l.fr*100,0)+'%'});
          const note = C.complete?'':` (${C.days} de ${C.len} dias${C.startPartial?' — início dos dados':''})`;
          g+=`<rect class="hl" x="${pl+step*i}" y="${pt}" width="${step}" height="${ih}" style="display:none"/><rect class="hit" x="${pl+step*i}" y="${pt}" width="${step}" height="${ih+pb}" ${tipAttr({t:`${l.dono} · ciclo ${C.name}${note}`,r:rows})}/>`;
        });
        g+=`<line class="ax" x1="${pl}" x2="${W-pr}" y1="${pt+ih}" y2="${pt+ih}"/>`;
        g+=`<text class="reflbl" x="${W-pr}" y="${pt-5}" text-anchor="end">franquia ${l.fr} GB</text>`;
        out+=`<div class="mult"><div class="h"><h3>${esc(l.dono)}</h3><span>${fmtNum(l.n)}</span></div>${svgEl(W,H,defs+g,`Consumo web por ciclo de ${l.dono} frente à franquia de ${l.fr} GB`)}</div>`;
      });
      const el=document.getElementById('mult'); el.innerHTML=out; bindHits(el);
    }
    
    function renderComp(){
      const {M,sel}=S;
      document.getElementById('compPeriod').textContent = `${periodTxt(sel)} · GB`;
      const rows = LINES.filter(l=>Object.values(M[l.n].tot).reduce((a,b)=>a+b,0)>0.01);
      const el=document.getElementById('comp');
      if(!rows.length){ el.innerHTML='<p class="muted">Sem tráfego de dados no período.</p>'; return; }
      const W=520,rh=38,pl=78,pr=46,H=rows.length*rh+6, iw=W-pl-pr;
      const max=Math.max(...rows.map(l=>Object.values(M[l.n].tot).reduce((a,b)=>a+b,0)));
      let g='';
      rows.forEach((l,i)=>{
        const t=M[l.n].tot, sum=Object.values(t).reduce((a,b)=>a+b,0);
        let x=pl; const y=i*rh+8, h=18;
        g+=`<text x="${pl-8}" y="${y+13}" text-anchor="end" style="fill:var(--ink-2);font-family:var(--sans);font-size:12px">${esc(shortName(l))}</text>`;
        CATS.forEach(c=>{const w=t[c.k]/max*iw; if(w>0.3){g+=`<rect x="${x}" y="${y}" width="${Math.max(0,w-(w>3?2:0))}" height="${h}" fill="${c.c}" rx="1"/>`; x+=w;}});
        g+=`<text x="${x+4}" y="${y+13}">${fmt(sum,sum<10?1:0)}</text>`;
        g+=`<rect class="hit" x="0" y="${y-6}" width="${W}" height="${rh}" ${tipAttr({t:`${l.dono} · ${periodTxt(sel)}`,r:CATS.filter(c=>t[c.k]>0.005).map(c=>({l:c.l,v:fmt(t[c.k])+' GB',c:c.c})).concat([{l:'Fora da franquia',v:fmt((sum-t.web)/sum*100,0)+'%'}])})}/>`;
      });
      const all=rows.reduce((a,l)=>a+Object.values(M[l.n].tot).reduce((x,y)=>x+y,0),0);
      const extra=rows.reduce((a,l)=>{const t=M[l.n].tot;return a+t.social+t.whats+t.waze+t.roam},0);
      const missing=LINES.filter(l=>!rows.includes(l)).map(shortName);
      el.innerHTML=svgEl(W,H,g,'Composição do tráfego de dados por linha')+
        `<p class="muted" style="font-size:12.5px;margin-top:8px">Cerca de ${fmt(extra/all*100,0)}% do tráfego corre em pacotes à parte (redes sociais, WhatsApp, Waze, roaming) e não consome a franquia.${missing.length?` Sem tráfego no período: ${esc(missing.join(', '))}.`:''}</p>`;
      bindHits(el);
    }
    
    let cur = LINES[0].n;
    function drawDaily(){
      const dd=D.daily[cur]||{}, L=LINES.find(l=>l.n===cur), sel=S.sel;
      const start=new Date(CYC[sel[0]].cs), end=CYC[sel[sel.length-1]].ce;
      const days=[]; for(let d=new Date(start); d<=end; d.setDate(d.getDate()+1)) days.push(iso(d));
      const W=1100,H=220,pl=34,pr=8,pt=12,pb=24,iw=W-pl-pr,ih=H-pt-pb;
      const sums=days.map(d=>CATS.reduce((a,c)=>a+((dd[d]||{})[c.k]||0),0));
      const rawMax=Math.max(1,...sums); const step=rawMax>4?2:rawMax>2?1:0.5; const max=Math.ceil(rawMax/step)*step;
      const y=v=>pt+ih-(v/max)*ih, bw=iw/days.length;
      let g='';
      for(let v=0; v<=max+1e-9; v+=step){g+=`<line class="gl" x1="${pl}" x2="${W-pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl-6}" y="${y(v)+3}" text-anchor="end">${fmt(v,step<1?1:0)}</text>`;}
      const tickEvery = days.length>60 ? 0 : 7;
      days.forEach((d,i)=>{
        const o=dd[d]||{}; let yy=pt+ih; const x=pl+i*bw;
        CATS.forEach(c=>{const v=o[c.k]||0; if(v>0){const h=v/max*ih; g+=`<rect x="${x+Math.min(0.5,bw*.1)}" y="${yy-h}" width="${Math.max(1,bw-Math.min(1.5,bw*.25))}" height="${h}" fill="${c.c}"/>`; yy-=h;}});
        if(+d.slice(8)===CI) g+=`<line class="gl" x1="${x}" x2="${x}" y1="${pt}" y2="${pt+ih+4}"/><text x="${x+2}" y="${H-6}">ciclo ${pad(CI)}/${d.slice(5,7)}</text>`;
        else if(tickEvery && i%tickEvery===0) g+=`<text x="${x+bw/2}" y="${H-6}" text-anchor="middle">${d.slice(8)}/${d.slice(5,7)}</text>`;
      });
      days.forEach((d,i)=>{const o=dd[d]||{}; const rows=CATS.filter(c=>o[c.k]>0.0005).map(c=>({l:c.l,v:fmt(o[c.k],2)+' GB',c:c.c})); if(!rows.length) rows.push({l:'Sem tráfego',v:'—'}); else rows.push({l:'Total',v:fmt(sums[i],2)+' GB'});
        g+=`<rect class="hl" x="${pl+i*bw}" y="${pt}" width="${bw}" height="${ih}" style="display:none"/><rect class="hit" x="${pl+i*bw}" y="${pt}" width="${bw}" height="${ih}" ${tipAttr({t:`${L.dono} · ${d.slice(8)}/${d.slice(5,7)}/${d.slice(2,4)}`,r:rows})}/>`;});
      g+=`<line class="ax" x1="${pl}" x2="${W-pr}" y1="${y(0)}" y2="${y(0)}"/>`;
      const el=document.getElementById('daily'); el.innerHTML=svgEl(W,H,g,`Consumo diário de dados de ${L.dono}`); bindHits(el);
      const active=sums.filter(s=>s>0.001).length, tot=sums.reduce((a,b)=>a+b,0), mx=Math.max(...sums), mxd=days[sums.indexOf(mx)];
      document.getElementById('dailyStats').innerHTML = tot<0.001 ? `<span class="muted">Nenhum tráfego de dados registrado para esta linha no período.</span>` :
        `<span>Total <b>${fmt(tot)} GB</b></span><span>Dias com uso <b>${active} de ${days.length}</b></span><span>Média nos dias de uso <b>${fmt(tot/active,2)} GB</b></span><span>Maior dia <b>${fmt(mx,2)} GB</b> em ${mxd.slice(8)}/${mxd.slice(5,7)}</span>`;
    }
    
    function renderVoice(){
      const {M,frac,sel}=S;
      const W=1000,rh=36,pl=130,pr=210,H=LINES.length*rh+6, iw=W-pl-pr;
      const max=Math.max(1,...LINES.map(l=>VC.reduce((a,c)=>a+M[l.n].vt[c.k].m,0)));
      let g='';
      LINES.forEach((l,i)=>{
        const t=M[l.n].vt, sum=VC.reduce((a,c)=>a+t[c.k].m,0), out=M[l.n].vout; let x=pl; const y=i*rh+8,h=18;
        g+=`<text x="${pl-10}" y="${y+13}" text-anchor="end" style="fill:var(--ink-2);font-family:var(--sans);font-size:13px">${esc(shortName(l))}</text>`;
        VC.forEach(c=>{const w=t[c.k].m/max*iw; if(w>0.3){g+=`<rect x="${x}" y="${y}" width="${Math.max(0.5,w-(w>3?2:0))}" height="${h}" fill="${c.c}" rx="1"/>`; x+=w;}});
        g+=`<text x="${x+6}" y="${y+13}">${fmt(sum,0)} min · ${fmt(out/frac,0)} min/ciclo úteis</text>`;
        const rows=VC.filter(c=>t[c.k].n).map(c=>({l:c.l,v:`${t[c.k].n} ch · ${fmt(t[c.k].m,0)} min`,c:c.c}));
        g+=`<rect class="hit" x="0" y="${y-6}" width="${W}" height="${rh}" ${tipAttr({t:`${l.dono} · ${periodTxt(sel)}`,r:rows.length?rows:[{l:'Sem chamadas',v:'—'}]})}/>`;
      });
      const el=document.getElementById('voice'); el.innerHTML=`<div class="chart-wide">${svgEl(W,H,g,'Minutos de voz originados por linha no período')}</div><p class="muted" style="font-size:12.5px;margin-top:8px">"Min/ciclo úteis" exclui caixa postal. Em todo o histórico, o maior volume em um ciclo foi cerca de ${fmt(VMAX.m,0)} minutos${VMAX.dono?` (${esc(VMAX.dono)}${CYC[VMAX.k]?', ciclo '+CYC[VMAX.k].name:''})`:''}.</p>`;
      bindHits(el);
    }
    
    /* ---------- passaportes: contratado × consumido ---------- */
    const PASS = [{key:'Americas',lbl:'Passaporte Américas',fr:5},{key:'Mundo',lbl:'Passaporte Mundo',fr:10}];
    function renderPass(){
      const sel=S.sel;
      document.getElementById('passNote').textContent = `Franquia de dados do passaporte por ciclo de faturamento (voz e SMS ilimitados no exterior). Período: ${periodTxt(sel)}. O portal não informa país nem aplicativo — só o consumo diário.`;
      let rows='', nContr=0, nUsed=0, totGB=0;
      LINES.forEach(l=>{
        PASS.forEach(p=>{
          if(!l.add.some(a=>a.includes(p.key==='Americas'?'Américas':'Mundo'))) return;
          nContr++;
          const uses=D.roam.filter(r=>r.n===l.n && r.pac.includes(p.key) && sel.includes(r.ciclo));
          const gb=uses.reduce((a,r)=>a+r.GB,0); totGB+=gb;
          if(uses.length) nUsed++;
          const maxU=uses.reduce((m,r)=>r.GB>m.GB?r:m,{GB:0});
          const pct=maxU.GB/p.fr;
          const st = !uses.length ? pill('info','Sem uso no período') : pct>=0.8 ? pill('crit',`${fmt(pct*100,0)}% do pacote`) : pill('ok',`${fmt(pct*100,0)}% do pacote`);
          const det = uses.length ? uses.map(r=>`ciclo ${CYC[r.ciclo].name}: ${dm(d0(r.ini))}–${dm(d0(r.fim))} · ${r.dias} ${r.dias>1?'dias':'dia'} · <b class="num">${fmt(r.GB,2)} GB</b>${CYC[r.ciclo].current?' <span class="muted">(em andamento)</span>':''}`).join('<br>') : '<span class="muted">—</span>';
          rows+=`<tr>
            <td class="who">${esc(l.dono)}<small>${fmtNum(l.n)}</small></td>
            <td><span class="plan">${p.lbl}</span><div class="muted" style="font-size:12px">${p.fr} GB por ciclo</div></td>
            <td class="r num">${fmt(gb,2)} GB</td>
            <td style="font-size:13px">${det}</td>
            <td class="use"><div class="lbl"><span>${fmt(maxU.GB,2)} de ${p.fr} GB</span><span>${fmt(pct*100,0)}%</span></div><div class="bar" role="img" aria-label="Maior uso em um ciclo: ${fmt(pct*100,0)}% do pacote"><i style="width:${Math.min(100,pct*100)}%;background:var(--roam)"></i></div></td>
            <td>${st}</td></tr>`;
        });
      });
      document.getElementById('passTbl').innerHTML = `<thead><tr><th>Usuário / linha</th><th>Contratado</th><th class="r">Consumido no período</th><th>Quando foi usado</th><th>Maior uso em um ciclo</th><th>Situação</th></tr></thead><tbody>${rows}</tbody>`;
      document.getElementById('passStats').innerHTML = `<span>Passaportes contratados <b>${nContr}</b></span><span>Usados no período <b>${nUsed}</b></span><span>Sem uso <b>${nContr-nUsed}</b></span><span>Dados em roaming <b>${fmt(totGB,2)} GB</b></span>`;
    }
    
    function renderAll(){ renderPass(); renderKPIs(); renderTable(); renderMult(); renderComp(); drawDaily(); renderVoice(); }
    
    /* ---------- filtro de período ---------- */
    (function(){
      const f=document.getElementById('fFrom'), t=document.getElementById('fTo'), pr=document.getElementById('presets'), sum=document.getElementById('fSum');
      const opt = k => `<option value="${k}">${CYC[k].name}${CYC[k].current?' (atual)':CYC[k].startPartial?' (início dos dados)':''}</option>`;
      f.innerHTML = ALLC.map(opt).join(''); t.innerHTML = ALLC.map(opt).join('');
      const closed = ALLC.filter(k=>CYC[k].complete);
      const PRE = [
        {id:'cur',  l:'Ciclo atual',        r:()=>[CUR,CUR]},
        {id:'last', l:'Último ciclo fechado',r:()=>[closed.at(-1),closed.at(-1)]},
        {id:'3',    l:'Últimos 3 ciclos',   r:()=>[ALLC[Math.max(0,ALLC.length-3)],CUR]},
        {id:'def',  l:'Desde o 1º ciclo completo',        r:()=>[DEFAULT.from,CUR]},
        {id:'all',  l:'Todo o histórico',   r:()=>[ALLC[0],CUR]},
      ];
      if(DEFAULT.from===ALLC[0]) PRE.splice(PRE.findIndex(p=>p.id==='def'),1);
      pr.innerHTML = PRE.map(p=>`<button type="button" class="chip" id="pre-${p.id}" data-id="${p.id}">${p.l}</button>`).join('');
      function apply(from,to,fromPreset){
        if(from>to) [from,to]=[to,from];
        f.value=from; t.value=to;
        S = compute(ALLC.filter(k=>k>=from&&k<=to));
        pr.querySelectorAll('button').forEach(b=>{const [a,z]=PRE.find(p=>p.id===b.dataset.id).r(); b.setAttribute('aria-pressed', a===from&&z===to);});
        sum.textContent = `${periodTxt(S.sel)} · ${S.sel.length} ${S.sel.length>1?'ciclos':'ciclo'}`;
        try{ localStorage.setItem('tel-periodo-'+(REL.id||'x'), JSON.stringify([from,to])); }catch(e){}
        renderAll();
      }
      pr.addEventListener('click',e=>{const b=e.target.closest('button'); if(!b) return; const [a,z]=PRE.find(p=>p.id===b.dataset.id).r(); apply(a,z);});
      f.addEventListener('change',()=>apply(f.value,t.value));
      t.addEventListener('change',()=>apply(f.value,t.value));
      let init=[DEFAULT.from,DEFAULT.to];
      try{ const s=JSON.parse(localStorage.getItem('tel-periodo-'+(REL.id||'x'))||'null'); if(s && ALLC.includes(s[0]) && ALLC.includes(s[1])) init=s; }catch(e){}
      document.getElementById('dailyLeg').innerHTML = CATS.map(c=>`<span><i style="background:${c.c}"></i>${c.l}</span>`).join('');
      document.getElementById('compLeg').innerHTML = CATS.map(c=>`<span><i style="background:${c.c}"></i>${c.l}</span>`).join('');
      document.getElementById('voiceLeg').innerHTML = VC.map(c=>`<span><i style="background:${c.c}"></i>${c.l}</span>`).join('');
      const ch=document.getElementById('chips');
      ch.innerHTML = LINES.map(l=>`<button type="button" class="chip" id="chip-${l.n}" data-n="${l.n}" aria-pressed="${l.n===cur}">${esc(l.short?'Linha '+l.short:l.dono)}</button>`).join('');
      ch.addEventListener('click',e=>{const b=e.target.closest('button'); if(!b) return; cur=b.dataset.n; ch.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b)); drawDaily();});
      apply(init[0],init[1]);
    })();
    
    /* ================= estado atual / histórico (fixos) ================= */
    (function(){
      const M=HIST.M;
      const sugere = p => p>22 ? '30 GB' : p>18 ? '25–30 GB' : '25 GB';
      const idles = LINES.filter(l=>M[l.n].avg<0.01 && M[l.n].vout<0.5);
      const cxDe = l => Object.values(V[l.n]||{}).reduce((a,o)=>a+(o.cx?.[0]||0),0);
      const over = LINES.filter(l=>l.fr>=50 && M[l.n].avg>=0.01 && M[l.n].peakUtil<0.3);
      const fortes = LINES.filter(l=>M[l.n].peakUtil>=0.3).sort((a,b)=>M[b.n].avg-M[a.n].avg);
      const a = [];
      if(roam) a.push(ONGOING
         ? {s:'crit', t:'Urgente', h:`Roaming de ${roamLine.dono}: ${fmt(RD.acc)} de ${LIM} GB`, p:`${PNAME} em uso desde ${dm(d0(roam.ini))}. No ritmo dos últimos 7 dias (${fmt(RD.last7,2)} GB/dia) o pacote se esgota em cerca de ${fmt(Math.max(0,RD.daysLeft),0)} dias.`}
         : {s:RD.acc/LIM>=0.8?'warn':'info', t:'Último ciclo', h:`${PNAME} de ${roamLine.dono} chegou a ${fmt(RD.acc/LIM*100,0)}% do pacote`, p:`Viagem de ${dm(d0(roam.ini))} a ${dm(d0(roam.fim))} (${RD.pts.length} dias): ${fmt(RD.acc,2)} de ${LIM} GB, média de ${fmt(RD.acc/Math.max(1,RD.pts.length),2)} GB/dia. Nenhum roaming em curso em ${dm(DF)}.`});
      idles.forEach(l=>a.push({s:'warn', t:'Linha ociosa', h:`Linha de ${l.dono} sem uso desde ${dm(DI)}`, p:`${fmtNum(l.n)}: zero tráfego de dados e zero chamadas originadas desde o início dos dados (${dm(DI)}).${cxDe(l)?` Só registra ${cxDe(l)} eventos de caixa postal — ou seja, recebe ligações que ninguém atende.`:''}`}));
      if(over.length) a.push({s:'info', t:'Oportunidade', h:`${over.length} ${over.length>1?'linhas usam':'linha usa'} menos de 30% da franquia`, p:`${over.map(l=>l.dono).join(', ')}: pico por ciclo entre ${fmt(Math.min(...over.map(l=>M[l.n].peak)),0)} e ${fmt(Math.max(...over.map(l=>M[l.n].peak)),0)} GB. Uma franquia de 25–30 GB atenderia com folga.`});
      if(!a.length) a.push({s:'ok', t:'Sem pendências', h:'Nenhum ponto de atenção', p:'Franquias, roaming e voz dentro do esperado no período analisado.'});
      document.getElementById('alerts').innerHTML = a.slice(0,6).map(x=>`<div class="alert ${x.s}">${pill(x.s,x.t)}<h3>${esc(x.h)}</h3><p>${esc(x.p)}</p></div>`).join('');
    
      /* roaming */
      if(!roam){
        document.getElementById('roamPill').hidden=true;
        document.getElementById('roamLeg').hidden=true;
        document.getElementById('roamTitle').textContent='Roaming internacional';
        document.getElementById('roamAsOf').textContent='';
        document.getElementById('roam').innerHTML='<p class="muted">Nenhum uso de roaming registrado nos dados.</p>';
      } else {
      const rp=document.getElementById('roamPill'); rp.className='pill '+(RD.acc/LIM>=0.8?'crit':'ok'); rp.innerHTML = `${RD.acc/LIM>=0.8?ICON.crit:ICON.ok}${fmt(RD.acc/LIM*100,0)}% usado`;
      document.getElementById('roamTitle').textContent = ONGOING ? `Roaming internacional em curso` : `Roaming internacional · última viagem`;
      document.getElementById('roamAsOf').textContent = ONGOING ? `situação em ${dm(DF)}` : `${PNAME} · ${roamLine.dono} · ${dm(d0(roam.ini))}–${dm(d0(roam.fim))}`;
      document.getElementById('roamLimLbl').textContent = `Limite ${LIM} GB`;
      const pts=RD.pts, W=520,H=210,pl=34,pr=10,pt=14,pb=24, iw=W-pl-pr, ih=H-pt-pb;
      const nDays = pts.length + (ONGOING ? Math.ceil(Math.max(0,RD.daysLeft)) + 1 : 0);
      const YM=LIM*1.1, x=i=>pl+ (i/Math.max(1,nDays-1))*iw, y=v=>pt+ih-(v/YM)*ih;
      let g='';
      (LIM===10?[0,2,4,6,8,10]:[0,1,2,3,4,5]).forEach(v=>{g+=`<line class="gl" x1="${pl}" x2="${W-pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl-6}" y="${y(v)+3}" text-anchor="end">${v}</text>`;});
      g+=`<line class="ref" x1="${pl}" x2="${W-pr}" y1="${y(LIM)}" y2="${y(LIM)}"/><text class="reflbl" x="${pl+4}" y="${y(LIM)-5}">limite ${LIM} GB</text>`;
      g+=`<path d="M${x(0)},${y(0)} `+pts.map((p,i)=>`L${x(i)},${y(p.acc)}`).join(' ')+` L${x(pts.length-1)},${y(0)} Z" fill="var(--roam)" opacity=".18"/>`;
      g+=`<path d="M`+pts.map((p,i)=>`${x(i)},${y(p.acc)}`).join(' L')+`" fill="none" stroke="var(--roam)" stroke-width="2"/>`;
      const li=pts.length-1, endI=li+RD.daysLeft;
      if(ONGOING) g+=`<line x1="${x(li)}" y1="${y(RD.acc)}" x2="${x(endI)}" y2="${y(LIM)}" stroke="var(--roam)" stroke-width="2" stroke-dasharray="3 3"/>`;
      g+=`<circle cx="${x(li)}" cy="${y(RD.acc)}" r="4.5" fill="var(--roam)" stroke="var(--surface)" stroke-width="2"/>`;
      g+=`<text x="${x(li)-6}" y="${y(RD.acc)-9}" text-anchor="end" style="fill:var(--ink);font-weight:600">${fmt(RD.acc)} GB</text>`;
      pts.forEach((p,i)=>{ if(i%3===0||i===li) g+=`<text x="${x(i)}" y="${H-6}" text-anchor="${i===li&&!ONGOING?'end':'middle'}">${p.d.slice(8)}/${p.d.slice(5,7)}</text>`; });
      const sw=iw/Math.max(1,nDays-1);
      pts.forEach((p,i)=>{g+=`<rect class="hit" x="${x(i)-sw/2}" y="${pt}" width="${sw}" height="${ih}" ${tipAttr({t:`${roamLine.dono} · ${p.d.slice(8)}/${p.d.slice(5,7)}`,r:[{l:'No dia',v:fmt(p.v,2)+' GB',c:'var(--roam)'},{l:'Acumulado',v:fmt(p.acc,2)+' GB'},{l:'Restante',v:fmt(Math.max(0,LIM-p.acc),2)+' GB'}]})}/>`;});
      g+=`<line class="ax" x1="${pl}" x2="${W-pr}" y1="${y(0)}" y2="${y(0)}"/>`;
      const el=document.getElementById('roam'); el.innerHTML=svgEl(W,H,g,`Consumo acumulado do ${PNAME}`); bindHits(el);
      const others=D.roam.filter(r=>r!==roam).sort((a,b)=>b.ini.localeCompare(a.ini));
      const hist=others.map(r=>`${nomeDe(r.n)} ${fmt(r.GB,1)} GB (${r.pac.includes('Mundo')?'Mundo':'Américas'}, ${dm(d0(r.ini))}–${dm(d0(r.fim))})`).join('; ');
      document.getElementById('roamStats').innerHTML = `<span>Linha <b>${esc(roamLine.dono)}</b></span><span>Restante <b>${fmt(RD.left,2)} GB</b></span><span>${ONGOING?'Média 7 dias':'Média na viagem'} <b>${fmt(ONGOING?RD.last7:RD.acc/Math.max(1,RD.pts.length),2)} GB/dia</b></span>${hist?`<span class="muted">Outros usos de passaporte: ${esc(hist)}.</span>`:''}`;
      }
    
      /* recomendações */
      const R=[];
      if(roam) R.push(ONGOING
         ? {s:'crit',t:'Urgente · hoje',h:`Ampliar ou monitorar o roaming de ${roamLine.dono}`,p:`O ${PNAME} está em ${fmt(RD.acc)} GB de ${LIM} GB e a viagem continua. Após o limite, a operadora normalmente reduz a velocidade ou cobra pacote adicional, conforme a regra do plano.`,a:`Confirmar com o gerente de conta a regra pós-franquia e, se a viagem seguir, contratar um pacote extra antes de esgotar.`}
         : RD.acc/LIM>=0.8
         ? {s:'warn',t:'Alta',h:`Dimensionar o passaporte antes de viagens longas`,p:`${roamLine.dono} usou ${fmt(RD.acc,2)} de ${LIM} GB do ${PNAME} em ${RD.pts.length} dias (${dm(d0(roam.ini))}–${dm(d0(roam.fim))}), cerca de ${fmt(RD.acc/Math.max(1,RD.pts.length),2)} GB/dia — no ritmo dessa viagem, o pacote dura cerca de ${fmt(LIM/Math.max(0.01,RD.acc/Math.max(1,RD.pts.length)),0)} dias.`,a:`Antes da próxima viagem longa, confirmar com o gerente de conta a regra após o limite (redução de velocidade ou cobrança) e contratar pacote adicional se a estadia for maior que isso.`}
         : {s:'ok',t:'Sem ação',h:`Roaming dentro do pacote`,p:`A última viagem (${roamLine.dono}, ${dm(d0(roam.ini))}–${dm(d0(roam.fim))}) usou ${fmt(RD.acc/LIM*100,0)}% do ${PNAME}.`,a:`Nenhuma mudança necessária.`});
      idles.forEach(l=>R.push({s:'warn',t:'Alta',h:`Readequar a linha de ${l.dono} ${fmtNum(l.n)}`,p:`A linha de ${l.fr} GB não trafegou dados nem originou chamadas desde ${dm(DI)}${cxDe(l)?'; só acumula recados na caixa postal':''}.${l.sub?` Observação do cadastro: ${l.sub}.`:''} O plano está sendo pago integralmente sem uso.`,a:`Avaliar suspensão temporária (quando disponível no contrato), migração para o menor plano da oferta ou cancelamento, reativando quando a linha voltar a ser usada.`}));
      if(over.length){
        const alto = over.filter(l=>M[l.n].peak>22);
        R.push({s:'info',t:'Alta',h:`Readequar a franquia de ${over.map(l=>l.dono).join(', ')}`,p:`${over.length>1?'Essas linhas usam':'Essa linha usa'} em média ${over.map(l=>fmt(M[l.n].avg,0)+' GB').join(' / ')} por ciclo; o maior ciclo registrado foi ${fmt(Math.max(...over.map(l=>M[l.n].peak)),1)} GB. Redes sociais e WhatsApp já correm em pacotes à parte.`,a:`Migrar para 25–30 GB.${alto.length?` Para ${alto.map(l=>l.dono).join(' e ')}, preferir 30 GB: um ciclo chegou a ${alto.map(l=>fmt(M[l.n].peak,0)+' GB').join(' / ')}.`:''} Como plano empresarial costuma ter compartilhamento ou pacote avulso, o risco de estouro é baixo.`});
      }
      if(fortes.length){
        const cr=fortes[0], mc=M[cr.n], ci=HIST.sel.indexOf(CUR);
        const closedMax = Math.max(0,...HIST.sel.map((k,i)=>CYC[k].complete?mc.web[i]:0));
        const menor = cr.fr>50 ? 50 : Math.round(cr.fr/2);
        R.push({s:'ok',t:'Manter',h:`Manter ${cr.fr} GB em ${cr.dono}`,p:`${fortes.length===1?'Única linha com uso intenso':'Linha de maior uso'}: média de ${fmt(mc.avg,0)} GB/ciclo, maior ciclo fechado de ${fmt(closedMax,0)} GB${ci>=0?` e ciclo atual projetado em ${fmt(mc.proj[ci],0)} GB`:''}.${closedMax>menor?` Uma franquia de ${menor} GB seria estourada.`:''}`,a:`Manter o plano atual e reavaliar em 3 meses com o histórico atualizado.`});
      }
      (()=>{const pk=a=>a.includes('Américas')?'Americas':'Mundo';
        const contr=LINES.flatMap(l=>(l.add||[]).filter(a=>a.startsWith('Passaporte')).map(a=>({l,a,k:pk(a)})));
        if(!contr.length) return;
        const usedP=contr.filter(c=>(D.roam||[]).some(r=>r.n===c.l.n&&r.pac.includes(c.k)));
        const nunca=LINES.filter(l=>(l.add||[]).some(a=>a.startsWith('Passaporte'))&&!usedP.some(u=>u.l===l)).map(l=>l.dono);
        const lin=new Set(contr.map(c=>c.l.n)).size;
        const usos=usedP.map(u=>`${u.k==='Mundo'?'Mundo':'Américas'} por ${u.l.dono}`).join(', ');
        R.push({s:'info',t:'Média',h:`Revisar passaportes internacionais fixos`,p:`Há ${contr.length} passaportes contratados em ${lin} ${lin>1?'linhas':'linha'}; ${usedP.length} ${usedP.length===1?'foi usado':'foram usados'} desde ${dm(DI)}${usos?` (${usos})`:''} e ${contr.length-usedP.length} nunca.${nunca.length?` ${nunca.join(' e ')} ${nunca.length>1?'nunca usaram':'nunca usou'} o passaporte.`:''}`,a:`Verificar na fatura se os passaportes geram mensalidade sem uso. Se sim, remover e ativar sob demanda antes de cada viagem.`});
      })();
      R.push(VMAX.m>300
        ? {s:'info',t:'Média',h:`Conferir o uso de voz`,p:`O maior volume em um ciclo foi de cerca de ${fmt(VMAX.m,0)} minutos (${VMAX.dono}). Confirmar na fatura se o plano cobre ligações ilimitadas.`,a:`Conferir a regra de voz do plano.`}
        : {s:'ok',t:'Sem ação',h:`Voz dimensionada corretamente`,p:`O uso de voz é baixo (até ~${fmt(VMAX.m,0)} min por ciclo na linha mais ativa). Em plano com voz ilimitada, não há cobrança variável de voz a otimizar.`,a:`Nenhuma mudança necessária.`});
      document.getElementById('recs').innerHTML = R.map(r=>`<div class="rec"><div>${pill(r.s,r.t)}</div><div><h3>${esc(r.h)}</h3><p>${esc(r.p)}</p><p class="act"><b>Ação:</b> ${esc(r.a)}</p></div></div>`).join('');
    })();
    
    document.getElementById('mPeriodo').textContent = `${dm(DI)} – ${dm(DF)}/${DF.getFullYear()}`;
    document.getElementById('nMetodo').innerHTML = `<b>Método:</b> consumo convertido para GB (1 GB = 1.024 MB) e agrupado pelo ciclo de faturamento, que começa todo dia ${CI} e fecha no dia ${CI-1||'último'} do mês seguinte. Os dados começam em ${dm(DI)}/${DI.getFullYear()}${CYC[ALLC[0]]&&CYC[ALLC[0]].startPartial?` (o primeiro período vai de ${CYC[ALLC[0]].name}, ${CYC[ALLC[0]].days} dias)`:''}. Ciclos incompletos entram nas médias de forma proporcional aos dias com dados; o filtro de período afeta resumo, tabela, gráficos por ciclo, composição, consumo diário e voz. Pontos de atenção e recomendações usam todo o histórico.`;
  }
  window.RelatorioTelefonia = { montar };
})();
