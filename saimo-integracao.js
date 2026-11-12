/* Xena TV — integração local de catálogos no formato público Saimo.
 * Mantém fontes M3U/Xtream independentes; não copia nem hospeda os vídeos.
 * Precisa ser carregado DEPOIS do script principal do index.html.
 */
(function () {
  'use strict';
  const clean = s => String(s == null ? '' : s).trim();
  const norm = s => clean(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+(fhd|hd|sd|uhd|4k)$/i, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const valid = s => /^https?:\/\/\S+$/i.test(clean(s));
  const root = s => clean(s).replace(/\/+$/, '') + '/';
  const make = (sid, kind, name, group, image, sources, more={}) => ({id:sid+'-'+kind+'-'+norm(name), sourceId:sid, kind, name:clean(name), group, image:image||'', url:sources?.[0]?.url||'', sources:sources||[], ...more});
  const urls = {
    canais: 'https://canais-saimo.pages.dev/',
    filmes: 'https://filmes-saimo.pages.dev/'
  };

  async function getText(url) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 18000);
    try {
      const response = await fetch(url, {mode:'cors', credentials:'omit', cache:'no-store', referrerPolicy:'no-referrer', signal:abort.signal});
      if (!response.ok) throw Error('HTTP '+response.status+' ao consultar catálogo');
      const size = +(response.headers.get('content-length')||0);
      if (size>28e6) throw Error('Arquivo remoto grande demais');
      const text = await response.text();
      if (text.length>14e6) throw Error('Texto de catálogo grande demais');
      return text.replace(/^\uFEFF/, '');
    } finally { clearTimeout(timer); }
  }

  function parseChannels(raw, srcId='saimo-canais') {
    const result=[], seen=new Map(); let current=null;
    function finish() {
      if (!current || !current.name || !current.sources.length) return;
      const k=norm(current.name), previous=seen.get(k);
      if (previous) {
        for (const s of current.sources) if (!previous.sources.some(p => p.url===s.url)) previous.sources.push(s);
        if (!previous.image) previous.image=current.logo;
      } else {
        const x=make(srcId, 'live', current.name, current.category||'TV ao vivo', current.logo, current.sources);
        result.push(x); seen.set(k,x);
      }
    }
    for (const rawline of raw.split(/\r?\n/)) {
      const line=rawline.trim(); if (!line||line.startsWith('#')) continue;
      const match=line.match(/^([^:]+):\s*(.*)$/); if (!match) continue;
      const k=match[1].trim().toLowerCase(), value=match[2].trim();
      if (k==='canal') { finish();current={name:value,logo:'',category:'TV ao vivo',sources:[]};continue; }
      if (!current) continue;
      if (k==='logo'&&valid(value)) current.logo=value;
      else if (k==='categoria') current.category=value||'TV ao vivo';
      else if (k==='fonte'&&valid(value)) current.sources.push({url:value,label:'Fonte '+(current.sources.length+1)});
      else if (current.sources.length) {
        const last=current.sources[current.sources.length-1];
        if (k==='nome') last.label=value;
        if (k==='qualidade') last.quality=value;
        if (k==='referer') last.referer=value;
        if (k==='agente') last.agent=value;
      }
    }
    finish();return result;
  }
  function parseExtraM3u(raw, srcId='saimo-canais') {
    const out=[];let data={};
    for (const lineRaw of raw.split(/\r?\n/)) {
      const line=lineRaw.trim();
      if (line.startsWith('#EXTINF')) {
        const attr=x=>line.match(new RegExp('(?:^|\\s)'+x+'="([^"]*)"','i'))?.[1]||'';
        data={name:line.includes(',')?line.slice(line.indexOf(',')+1).trim():attr('tvg-name'),group:attr('group-title')||'TV ao vivo',image:attr('tvg-logo')};
      } else if (valid(line)) {
        out.push(make(srcId,'live',data.name||'Canal '+(out.length+1),data.group||'TV ao vivo',data.image,[{url:line,label:'M3U extra'}]));data={};
      }
    }
    return out;
  }
  function mergeChannels(a,b) {
    const out=[...a], seen=new Map(out.map(i=>[norm(i.name),i]));
    for(const item of b) {
      const old=seen.get(norm(item.name));
      if(old) {for(const s of item.sources)if(!old.sources.some(q=>q.url===s.url))old.sources.push(s);}
      else {seen.set(norm(item.name),item);out.push(item);}
    }
    return out;
  }
  function parseIndex(text) {
    const bases={},letters={};
    for(const line of text.split(/\r?\n/)) {
      const m=line.match(/^base:\s*(\d+)\s+(https?:\/\/\S+)/);
      if(m){bases[m[1]]=root(m[2]);continue;}
      const a=line.split('\t'), letter=clean(a[0]).toUpperCase();
      if(/^[A-Z#]$/.test(letter)&&a.length>=3)letters[letter]={movies:+a[1]||0,series:+a[2]||0};
    }
    return {bases,letters};
  }
  function expand(token,index) {
    token=clean(token);if(valid(token))return token;
    const match=token.match(/^(\d+):(.+)$/);if(!match||!index.bases[match[1]])return '';
    let suffix=match[2];
    if(!/\.[a-z\d]{2,5}(?:[?#]|$)/i.test(suffix)){
      const pos=suffix.search(/[?#]/); suffix=pos<0?suffix+'.mp4':suffix.slice(0,pos)+'.mp4'+suffix.slice(pos);
    }
    return index.bases[match[1]]+suffix.replace(/^\/+/, '');
  }
  function parseSources(text,index,lang) {
    return clean(text).split(',').map((part,j)=>{
      const url=expand(part,index);return url?{url,label:(lang==='dub'?'Dublado':lang==='leg'?'Legendado':'Fonte')+' '+(j+1),language:lang}:null;
    }).filter(Boolean);
  }
  function parseMovies(raw,index,srcId,letter) {
    const out=[];
    for(const line of raw.split(/\r?\n/)){
      if(!line.trim()||line.startsWith('#'))continue;
      const a=line.split('\t');if(a.length<2)continue;
      const sources=[];
      for(const col of a.slice(1)){const m=col.match(/^(dub|leg)=(.+)$/i);if(m)sources.push(...parseSources(m[2],index,m[1].toLowerCase()));}
      if(sources.length)out.push(make(srcId,'movie',a[0],'Filmes','',sources,{saimoLetter:letter}));
    }
    return out;
  }
  function parseSeries(raw,srcId,letter){
    const out=[];
    for(const line of raw.split(/\r?\n/)){
      if(!line.trim()||line.startsWith('#'))continue;
      const a=line.split('\t');if(a.length>=3)out.push(make(srcId,'series',a[0],'Séries','',[],{saimoLetter:letter,saimoYear:a[1]||'',saimoChunk:a[2]||'0'}));
    }
    return out;
  }
  function parseEpisodes(raw,title,year,index){
    const out=[];let active=false;
    for(const line of raw.split(/\r?\n/)){
      if(line.startsWith('@')){const a=line.slice(1).split('\t');active=norm(a[0])===norm(title)&&(!year||!a[1]||a[1]===String(year));continue;}
      if(!active||!line.trim())continue;
      const a=line.split('\t');if(a.length<4)continue;
      const sources=parseSources(a[3],index,a[2]);if(!sources.length)continue;
      out.push({name:'T'+a[0]+' • E'+a[1]+' — '+(a[2]==='dub'?'Dublado':a[2]==='leg'?'Legendado':a[2]),season:+a[0]||0,episode:+a[1]||0,sources,url:sources[0].url});
    }
    return out;
  }
  function coverRows(raw,out,mode){
    let base='';
    for(const line of raw.split(/\r?\n/)){
      if(line.startsWith('capa:')){base=clean(line.slice(5));continue;}
      if(line.startsWith('#')||line.startsWith('fila\t'))continue;
      const a=line.split('\t');if(!['f','s','a','d'].includes(a[0]))continue;
      const path=clean(a[mode==='fichas'?3:4]);if(!path)continue;
      const url=valid(path)?path:base?base.replace(/\/+$/,'')+'/'+path.replace(/^\/+/, ''):'';
      if(url&&!out.has(norm(a[1])))out.set(norm(a[1]),url);
    }
  }
  function parseSearch(raw,srcId,covers){
    const out=[],seen=new Set();
    for(const line of raw.split(/\r?\n/)){
      const a=line.split('\t');if(a.length<3)continue;
      const kind=a[1]==='f'?'movie':a[1]==='s'?'series':'',letter=clean(a[2]).toUpperCase(),name=clean(a[0]);
      if(!kind||!/^[A-Z#]$/.test(letter)||!name)continue;
      const key=kind+'-'+norm(name);if(seen.has(key))continue;seen.add(key);
      out.push(make(srcId,kind,name,kind==='movie'?'Filmes':'Séries',covers.get(norm(name))||'',[],{saimoLetter:letter,saimoYear:a[3]||''}));
    }
    return out;
  }
  async function loadChannels(base,srcId='saimo-canais'){
    base=root(base);const main=parseChannels(await getText(base+'catalogo.txt'),srcId);
    if(!main.length)throw Error('Catálogo de canais vazio');
    let extra=[];try{extra=parseExtraM3u(await getText(base+'canais.txt'),srcId);}catch(_e){}
    return {kind:'live',base,items:mergeChannels(main,extra)};
  }
  async function loadVod(base,srcId='saimo-filmes'){
    base=root(base);const index=parseIndex(await getText(base+'vod/indice.txt'));
    if(!Object.keys(index.letters).length)throw Error('Índice VOD vazio');
    const results=await Promise.allSettled([getText(base+'vod/busca.txt'),getText(base+'vod/destaques.txt'),getText(base+'vod/fichas.txt')]);
    const covers=new Map();if(results[1].status==='fulfilled')coverRows(results[1].value,covers,'destaques');
    if(results[2].status==='fulfilled')coverRows(results[2].value,covers,'fichas');
    let items=results[0].status==='fulfilled'?parseSearch(results[0].value,srcId,covers):[];
    const cache=new Map();
    if(!items.length){
      const letters=Object.keys(index.letters);
      for(let i=0;i<letters.length;i+=4){
        const parts=await Promise.all(letters.slice(i,i+4).map(async letter=>{
          const counts=index.letters[letter],out=[];
          if(counts.movies)try{const raw=await getText(base+'vod/filmes-'+encodeURIComponent(letter)+'.txt');cache.set('f'+letter,raw);out.push(...parseMovies(raw,index,srcId,letter));}catch(_e){}
          if(counts.series)try{const raw=await getText(base+'vod/series-'+encodeURIComponent(letter)+'.txt');cache.set('s'+letter,raw);out.push(...parseSeries(raw,srcId,letter));}catch(_e){}
          return out;
        }));parts.forEach(part=>items.push(...part));
      }
    }
    for(const item of items)if(!item.image)item.image=covers.get(norm(item.name))||'';
    if(!items.length)throw Error('Nenhum título encontrado no acervo');
    return {kind:'vod',base,index,cache,items};
  }
  async function resolveMovie(item,catalog){
    const k='f'+item.saimoLetter;
    let raw=catalog.cache.get(k);
    if(!raw){raw=await getText(catalog.base+'vod/filmes-'+encodeURIComponent(item.saimoLetter)+'.txt');catalog.cache.set(k,raw);}
    const row=parseMovies(raw,catalog.index,item.sourceId,item.saimoLetter).find(x=>norm(x.name)===norm(item.name));
    if(!row)throw Error('Filme sem fonte reproduzível');return row.sources;
  }
  async function resolveSeries(item,catalog){
    const letter=item.saimoLetter;let chunk=item.saimoChunk;
    if(chunk==null){const k='s'+letter;let raw=catalog.cache.get(k);
      if(!raw){raw=await getText(catalog.base+'vod/series-'+encodeURIComponent(letter)+'.txt');catalog.cache.set(k,raw);}
      const row=parseSeries(raw,item.sourceId,letter).find(x=>norm(x.name)===norm(item.name));
      if(!row)throw Error('Série não localizada');chunk=row.saimoChunk;
    }
    const k='e'+letter+'-'+chunk;let raw=catalog.cache.get(k);
    if(!raw){raw=await getText(catalog.base+'vod/series-'+encodeURIComponent(letter)+'-'+chunk+'.txt');catalog.cache.set(k,raw);}
    const episodes=parseEpisodes(raw,item.name,item.saimoYear,catalog.index);
    if(!episodes.length)throw Error('Episódios não encontrados');return episodes;
  }

  const API={parseChannels,parseExtraM3u,mergeChannels,parseIndex,parseMovies,parseSeries,parseEpisodes,parseSearch,loadChannels,loadVod,resolveMovie,resolveSeries};
  window.XenaSaimo=API;

  // A Xena TV mantém o script principal intacto: sobrescrevemos apenas os pontos necessários.
  function install(){
    if(typeof S==='undefined'||typeof loadSource!=='function'||typeof openWatch!=='function')return;
    S.saimoCatalogs=new Map();
    const channels=S.sources.find(s=>s.id==='saimo-canais');
    const movies=S.sources.find(s=>s.id==='saimo-filmes');
    if(channels){channels.type='saimo-tv';channels.name='Saimo • Canais';channels.desc='Catálogo de TV e fontes alternativas';}
    if(movies){movies.type='saimo-vod';movies.name='Saimo • Filmes e séries';movies.desc='Biblioteca VOD, capas e episódios';}
    const normalLoad=loadSource;
    loadSource=async function(src){
      if(src.type!=='saimo-tv'&&src.type!=='saimo-vod')return normalLoad(src);
      S.statusById[src.id]='Consultando catálogo...';renderSources();
      try{
        const cat=src.type==='saimo-tv'?await API.loadChannels(src.url,src.id):await API.loadVod(src.url,src.id);
        S.saimoCatalogs.set(src.id,cat);
        S.items=S.items.filter(x=>x.sourceId!==src.id).concat(cat.items);
        S.statusById[src.id]=cat.items.length.toLocaleString('pt-BR')+' itens disponíveis';
        refreshCounts();renderSources();renderCatalog();return cat.items.length;
      }catch(e){
        S.statusById[src.id]='Falha ao consultar a origem: '+(e.name==='AbortError'?'tempo esgotado':e.message||'erro de rede/CORS');
        renderSources();return 0;
      }
    };

    function offerSources(options){
      if(!options||options.length<2)return;
      const box=document.getElementById('episodeList');box.classList.remove('hidden');box.replaceChildren();
      const title=document.createElement('strong');title.textContent='Escolha uma fonte de reprodução';box.append(title);
      for(let j=0;j<options.length;j++){
        const src=options[j];const b=document.createElement('button');
        b.textContent=(src.label||'Fonte '+(j+1))+(src.quality?' • '+src.quality:'');
        b.addEventListener('click',()=>{S.selected={...S.selected,url:src.url};
          document.getElementById('watchPlay').disabled=false;
          document.getElementById('copyStream').disabled=false;
          document.getElementById('exportM3u').disabled=false;
          tryPlay(src.url);});
        box.append(b);
      }
    }
    const oldOpen=openWatch;
    openWatch=function(item){
      oldOpen(item);
      if(item.sourceId==='saimo-canais') {offerSources(item.sources);return;}
      if(item.sourceId!=='saimo-filmes')return;
      const id=item.id,cat=S.saimoCatalogs.get(item.sourceId);
      document.getElementById('watchStatus').textContent='Consultando fontes de reprodução...';
      const task=item.kind==='movie'?API.resolveMovie(item,cat):API.resolveSeries(item,cat);
      task.then(results=>{
        if(!S.selected||S.selected.id!==id)return;
        const box=document.getElementById('episodeList');box.classList.remove('hidden');box.replaceChildren();
        if(item.kind==='movie') {
          S.selected={...item,url:results[0].url,sources:results};
          document.getElementById('watchPlay').disabled=false;
          document.getElementById('copyStream').disabled=false;
          document.getElementById('exportM3u').disabled=false;
          offerSources(results);tryPlay(results[0].url);
        } else {
          box.textContent='Escolha um episódio:';
          for(const ep of results){const b=document.createElement('button');b.textContent=ep.name;
            b.addEventListener('click',()=>{S.selected={...item,url:ep.url,sources:ep.sources};
              document.getElementById('watchPlay').disabled=false;
              document.getElementById('copyStream').disabled=false;
              document.getElementById('exportM3u').disabled=false;
              tryPlay(ep.url);offerSources(ep.sources);});box.append(b);}
        }
      }).catch(e=>{if(S.selected&&S.selected.id===id)document.getElementById('watchStatus').textContent='Não foi possível consultar o título: '+(e.message||e);});
    };
    renderSources();refreshCounts();
    // Carrega conteúdo público separadamente e sem tocar no catálogo M3U particular.
    setTimeout(async()=>{
      for(const src of [channels,movies])if(src)await loadSource(src);
    },700);
  }
  install();
})();
