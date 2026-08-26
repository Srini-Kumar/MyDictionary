/* ══════════════════════════════════════════════════
   STORAGE
══════════════════════════════════════════════════ */
const Store={
  get(k,d=null){try{const v=localStorage.getItem(k);return v!==null?JSON.parse(v):d;}catch{return d;}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}},
  del(k){localStorage.removeItem(k);}
};
const K={HISTORY:'mdict_history',QUEUE:'mdict_queue',SETTINGS:'mdict_settings',BOOKMARKS:'mdict_bookmarks',LAST_DAILY:'mdict_last_daily'};
const FALLBACK=['ephemeral','serendipity','mellifluous','sonder','hiraeth','perspicacious','resilience','ubiquitous','capricious','ineffable','luminous','tenacious','wanderlust','solitude','eloquent','loquacious','magnanimous','pedantic','quixotic','sanguine'];

/* ══════════════════════════════════════════════════
   SETTINGS
══════════════════════════════════════════════════ */
function getSettings(){
  return Store.get(K.SETTINGS,{
    notifEnabled:false,notifTime:'08:00',fontSize:14,cacheLimitMB:5,
    geminiApiKey:'',targetLanguage:'Tamil',
    useFreeOnly:true,
    merriamDictKey:'',
    merriamThesKey:''
  });
}
function saveSettings(s){Store.set(K.SETTINGS,s);}

/* ══════════════════════════════════════════════════
   LANGUAGE SUPPORT
══════════════════════════════════════════════════ */
const LANG_CODES={
  Tamil:'ta',Hindi:'hi',Bengali:'bn',Telugu:'te',Marathi:'mr',
  Urdu:'ur',Gujarati:'gu',Kannada:'kn',Malayalam:'ml',Odia:'or',
  Punjabi:'pa',Assamese:'as',Maithili:'mai',
  Spanish:'es',French:'fr',Mandarin:'zh',Arabic:'ar',Japanese:'ja',
  Korean:'ko',German:'de',Portuguese:'pt',Russian:'ru',Italian:'it'
};

function getTargetLang(){return getSettings().targetLanguage||'Tamil';}
function getLangCode(name){return LANG_CODES[name]||'ta';}

async function translateWord(text,targetLangName){
  const code=getLangCode(targetLangName||getTargetLang());
  try{
    const r=await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${code}`,{signal:AbortSignal.timeout(7000)});
    const d=await r.json();
    if(d.responseStatus===200&&d.responseData?.translatedText){
      const t=d.responseData.translatedText;
      if(!t.toLowerCase().includes('mymemory')&&t.trim()!==text.trim())return t;
    }
  }catch{}
  try{
    const r=await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${code}&dt=t&q=${encodeURIComponent(text)}`);
    const d=await r.json();
    return d[0]?.map(c=>c[0]).join('')||'—';
  }catch{return'—';}
}

/* ══════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════ */
let currentWord=null;
let _lastMeanings=null;
let _lastExtra=null;
let _currentLangMode='english';

/* ══════════════════════════════════════════════════
   CACHE MANAGER
══════════════════════════════════════════════════ */
function saveToCache(word,data){
  Store.set(`mdict_data_${word}`,data);
  let keys=Store.get('mdict_cache_keys',[]);
  keys=keys.filter(k=>k!==word);keys.push(word);
  Store.set('mdict_cache_keys',keys);enforceCacheLimitMB();
}
function enforceCacheLimitMB(){
  const s=getSettings();const limitBytes=(s.cacheLimitMB||5)*1024*1024;
  let keys=Store.get('mdict_cache_keys',[]);
  let totalBytes=0;const sizes={};
  keys.forEach(w=>{
    const str=(localStorage.getItem(`mdict_data_${w}`)||'')+(localStorage.getItem(`mdict_gemini_${w}`)||'');
    const sz=new Blob([str]).size;sizes[w]=sz;totalBytes+=sz;
  });
  while(keys.length>0&&totalBytes>limitBytes){
    const oldest=keys.shift();
    Store.del(`mdict_data_${oldest}`);Store.del(`mdict_gemini_${oldest}`);
    totalBytes-=(sizes[oldest]||0);
  }
  Store.set('mdict_cache_keys',keys);
}

/* ══════════════════════════════════════════════════
   GEMINI BILINGUAL — LAZY, ON PILL CLICK
══════════════════════════════════════════════════ */
async function fetchGeminiBilingual(word,targetLang){
  const cacheKey=`mdict_bilingual_${word}_${targetLang}`;
  const cached=Store.get(cacheKey);
  if(cached)return cached;

  const s=getSettings();
  const prompt=`Act formal bilingual dictionary. For the word '${word}', provide its common English definitions in bilingual English and ${targetLang}, clear, simple terms. Then, provide a highly accurate translation of that exact definition in ${targetLang} like Google Dictionary. Output strictly valid JSON and nothing else. Do not use Markdown formatting, code blocks, or include any conversational text. Use this exact schema: {"english_def": "...", "translated_def": "..."}"`;
  const url=`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${s.geminiApiKey}`;
  const res=await fetch(url,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      contents:[{parts:[{text:prompt}]}],
      generationConfig:{responseMimeType:'application/json'}
    })
  });
  if(!res.ok)throw new Error('Gemini API error '+res.status);
  const data=await res.json();
  let raw=data.candidates[0].content.parts[0].text.trim();
  raw=raw.replace(/```json|```/g,'').trim();
  const result=JSON.parse(raw);
  Store.set(cacheKey,result);
  return result;
}

async function switchLangMode(mode){
  const s=getSettings();
  const targetLang=s.targetLanguage||'Tamil';

  document.getElementById('pill-english').classList.toggle('active',mode==='english');
  document.getElementById('pill-bilingual').classList.toggle('active',mode==='bilingual');

  const $en=document.getElementById('overview-english');
  const $bi=document.getElementById('overview-bilingual');
  const $bc=document.getElementById('bilingual-content');

  if(mode==='english'){
    _currentLangMode='english';
    $en.style.display='block';
    $bi.style.display='none';
    return;
  }

  if(!s.geminiApiKey){
    showToast('Please add your Gemini API key in Settings to use Bilingual mode');
    document.getElementById('pill-english').classList.add('active');
    document.getElementById('pill-bilingual').classList.remove('active');
    return;
  }

  _currentLangMode='bilingual';
  $en.style.display='none';
  $bi.style.display='block';
  $bc.innerHTML=`<div class="bilingual-loading"><span class="spinner-sm"></span> Generating bilingual definition…</div>`;

  try{
    const result=await fetchGeminiBilingual(currentWord,targetLang);
    $bc.innerHTML=`
      <div class="bilingual-section">
        <div class="bilingual-def-en">${result.english_def||''}</div>
        <div class="bilingual-def-translated">
          <div class="bilingual-lang-badge">${targetLang}</div>
          <div class="bilingual-def-text">${result.translated_def||''}</div>
        </div>
      </div>`;
  }catch{
    $bc.innerHTML=`<div class="bilingual-section" style="color:var(--red);font-size:14px;padding:16px 0">Could not load bilingual definition. Check your API key in Settings.</div>`;
  }
}

/* ══════════════════════════════════════════════════
   INLINE TRANSLATION
══════════════════════════════════════════════════ */
async function toggleInlineTranslation(btn,englishText){
  const container=btn.parentElement.querySelector('.def-translated');
  const targetLang=getTargetLang();
  const cacheObjKey=`mdict_gemini_${currentWord}`;
  const itemKey=`${englishText}__${targetLang}`;

  if(container.dataset.loaded==='1'){
    const isShowing=container.classList.contains('show');
    container.classList.toggle('show',!isShowing);
    btn.innerHTML=isShowing
      ?`<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg> Translate to ${targetLang}`
      :`Hide`;
    return;
  }

  container.classList.add('show');
  container.innerHTML=`<span class="spinner-sm"></span> Translating…`;
  btn.innerHTML=`Hide`;

  let cachedObj=Store.get(cacheObjKey,{});
  if(cachedObj[itemKey]){container.innerHTML=cachedObj[itemKey];container.dataset.loaded='1';return;}

  try{
    let translated;
    const s=getSettings();
    if(s.geminiApiKey){
      const prompt=`Translate this English dictionary definition into ${targetLang} accurately and naturally. Return ONLY the ${targetLang} text with no markdown, no quotes, no extra text: "${englishText}"`;
      const url=`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${s.geminiApiKey}`;
      const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({contents:[{parts:[{text:prompt}]}]})});
      if(!res.ok)throw new Error();
      const d=await res.json();
      translated=d.candidates[0].content.parts[0].text.trim();
    }else{
      translated=await translateWord(englishText,targetLang);
    }
    cachedObj[itemKey]=translated;Store.set(cacheObjKey,cachedObj);
    container.innerHTML=translated;container.dataset.loaded='1';
  }catch{
    container.innerHTML=`<span style="color:var(--red)">Translation failed. Try again.</span>`;
    container.dataset.loaded='0';btn.innerHTML=`Try Again`;
  }
}

/* ══════════════════════════════════════════════════
   DICTIONARY APIS (OPTIMIZED FALLBACKS & SIMULTANEOUS FETCHING)
══════════════════════════════════════════════════ */
async function fetchFreeDictionary(word) {
  const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
  if (!res.ok) throw new Error('Free Dict failed');
  const data = await res.json();
  if (!data || data.length === 0) throw new Error('Free Dict empty');
  return data[0];
}

async function fetchMerriamWebsterDict(word) {
  const s = getSettings();
  const key = s.merriamDictKey;
  if (!key) throw new Error("No MW Dictionary Key provided");
  
  const res = await fetch(`https://dictionaryapi.com/api/v3/references/collegiate/json/${encodeURIComponent(word)}?key=${key}`, {signal:AbortSignal.timeout(8000)});
  if (!res.ok) {
    const errText = await res.text();
    console.error("MW Dictionary API Error:", res.status, errText);
    throw new Error('MW Dict API failed');
  }
  
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0 || typeof data[0] === 'string') throw new Error('MW Dict empty');
  
  const meanings = [];
  const phonetics = [];
  let phoneticText = '';
  
  data.forEach(entry => {
    if (entry.hwi?.prs) {
      entry.hwi.prs.forEach(p => {
        const audioName = p.sound?.audio;
        let audioUrl = '';
        if (audioName) {
          const subDir = audioName.charAt(0);
          audioUrl = `https://media.merriam-webster.com/audio/prons/en/us/mp3/${subDir}/${audioName}.mp3`;
        }
        if (p.mw && !phonetics.some(ph => ph.text === p.mw)) {
          phonetics.push({ text: p.mw, audio: audioUrl });
        } else if (audioUrl && !phonetics.some(ph => ph.audio === audioUrl)) {
          phonetics.push({ text: p.mw || '', audio: audioUrl });
        }
      });
    }
    
    if (entry.shortdef && entry.shortdef.length > 0) {
      let existingPos = meanings.find(m => m.partOfSpeech === (entry.fl || ''));
      if (!existingPos) {
        meanings.push({
          partOfSpeech: entry.fl || '',
          definitions: entry.shortdef.map(def => ({ definition: def, example: '' }))
        });
      } else {
        existingPos.definitions.push(...entry.shortdef.map(def => ({ definition: def, example: '' })));
      }
    }
  });
  
  if (meanings.length === 0) throw new Error('MW Dict no meanings extracted');
  if (phonetics.length > 0 && !phoneticText) phoneticText = phonetics[0].text;
  
  return {
    word: word,
    phonetic: phoneticText,
    phonetics: phonetics,
    meanings: meanings
  };
}

async function fetchWiktionaryRest(word) {
  const res = await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`);
  if (!res.ok) throw new Error('Wiktionary REST failed');
  const data = await res.json();
  if (!data.en || data.en.length === 0) throw new Error('Wiktionary REST empty');
  
  const meanings = [];
  data.en.forEach(item => {
    const defs = (item.definitions || []).map(def => {
      const text = (def.definition || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return { definition: text, example: '' };
    }).filter(d => d.definition);
    
    if (defs.length > 0) {
      meanings.push({
        partOfSpeech: item.partOfSpeech || '',
        definitions: defs
      });
    }
  });
  
  if (meanings.length === 0) throw new Error('No valid meanings in Wiktionary');
  
  return {
    word: word,
    phonetic: '',
    phonetics: [],
    meanings: meanings
  };
}

async function fetchUrbanDictionary(word) {
  const urbanRes = await fetch(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(word)}`);
  if (!urbanRes.ok) throw new Error('Urban Dict failed');
  const urbanData = await urbanRes.json();
  if (!urbanData.list || urbanData.list.length === 0) throw new Error('Urban Dict empty');
  
  const first = urbanData.list[0];
  return {
    word: first.word,
    phonetic: '',
    phonetics: [],
    meanings: [{
      partOfSpeech: 'slang',
      definitions: [{
        definition: first.definition.replace(/\[([^\]]+)\]/g, '$1'),
        example: first.example ? first.example.replace(/\[([^\]]+)\]/g, '$1') : ''
      }]
    }]
  };
}

async function fetchDefinition(word) {
  word = word.trim().toLowerCase();
  const s = getSettings();
  
  // 1. If Free Mode is OFF and MW Key is provided, try MW FIRST
  if (!s.useFreeOnly && s.merriamDictKey) {
    try {
      return await fetchMerriamWebsterDict(word);
    } catch (mwError) {
      console.warn("MW Dictionary failed, falling back to Free APIs...", mwError.message);
    }
  }
  
  // 2. Run Free Dictionary AND Wiktionary SIMULTANEOUSLY. Return the first one that works.
  try {
    return await Promise.any([
      fetchFreeDictionary(word),
      fetchWiktionaryRest(word)
    ]);
  } catch (freeError) {
    console.warn("Free Dict and Wiktionary both failed, trying Urban Dictionary...");
  }
  
  // 3. Ultimate fallback: Urban Dictionary
  return await fetchUrbanDictionary(word);
}

/* ══════════════════════════════════════════════════
   MERRIAM-WEBSTER THESAURUS API (STRICTLY SEPARATED)
══════════════════════════════════════════════════ */
async function fetchMerriamWebsterThesaurus(word){
  const s = getSettings();
  // Bypass completely if Free Mode is ON or no key is provided
  if (s.useFreeOnly || !s.merriamThesKey) return { syns: [], ants: [] };
  
  try {
    const res = await fetch(`https://dictionaryapi.com/api/v3/references/thesaurus/json/${encodeURIComponent(word)}?key=${s.merriamThesKey}`, {signal: AbortSignal.timeout(7000)});
    if (!res.ok) {
      const errText = await res.text();
      console.error("MW Thesaurus API Error:", res.status, errText);
      return { syns: [], ants: [] };
    }
    
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0 || typeof data[0] === 'string') return { syns: [], ants: [] };
    
    const syns = new Set();
    const ants = new Set();
    
    data.forEach(entry => {
        const defArray = entry?.def;
        if (!defArray || !Array.isArray(defArray)) return;
        
        defArray.forEach(defBlock => {
            const sseq = defBlock?.sseq;
            if (!sseq) return;
            
            sseq.forEach(senseGroup => {
                if (!Array.isArray(senseGroup)) return;
                senseGroup.forEach(sense => {
                    if (sense && sense[1]) {
                        const synList = sense[1].syn_list;
                        if (Array.isArray(synList)) {
                            synList.forEach(synGroup => {
                                if (Array.isArray(synGroup)) {
                                    synGroup.forEach(term => {
                                        if (term.wd) syns.add(term.wd);
                                    });
                                }
                            });
                        }
                        const antList = sense[1].ant_list;
                        if (Array.isArray(antList)) {
                            antList.forEach(antGroup => {
                                if (Array.isArray(antGroup)) {
                                    antGroup.forEach(term => {
                                        if (term.wd) ants.add(term.wd);
                                    });
                                }
                            });
                        }
                    }
                });
            });
        });
    });
    
    return { syns: Array.from(syns), ants: Array.from(ants) };
  } catch (e) {
    console.error("MW Thesaurus Exception:", e);
    return { syns: [], ants: [] };
  }
}

/* ══════════════════════════════════════════════════
   DATAMUSE API (ONLY USED WHEN FREE MODE IS ON)
══════════════════════════════════════════════════ */
async function fetchDatamuse(word){
  const out={syns:[],ants:[]};
  try{
    const res=await fetch(`https://api.datamuse.com/words?rel_syn=${encodeURIComponent(word)}`,{signal:AbortSignal.timeout(6000)});
    if(res.ok){const d=await res.json();out.syns=d.map(x=>x.word);}
  }catch{}
  try{
    const res=await fetch(`https://api.datamuse.com/words?rel_ant=${encodeURIComponent(word)}`,{signal:AbortSignal.timeout(6000)});
    if(res.ok){const d=await res.json();out.ants=d.map(x=>x.word);}
  }catch{}
  return out;
}

/* ══════════════════════════════════════════════════
   WIKTIONARY API (Wikitext for Etymology & Extra Synonyms)
══════════════════════════════════════════════════ */
async function fetchWikiExtra(word){
  try{
    const url=`https://en.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(word)}&prop=wikitext&format=json&origin=*`;
    const r=await fetch(url,{signal:AbortSignal.timeout(7000)});
    if(!r.ok)return{};
    const d=await r.json();
    return parseWiki(d?.parse?.wikitext?.['*']||'',word);
  }catch{return{};}
}

function parseWiki(wt,word){
  const out={forms:null,etymology:null,syns:[],ants:[]};
  const synMatches = [...wt.matchAll(/\{\{(?:syn|synonyms)\|en\|([^}]+)\}\}/g)];
  synMatches.forEach(m => {
    m[1].split('|').forEach(s => {
      const clean = s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').trim();
      if(clean && !clean.includes('=')) out.syns.push(clean);
    });
  });
  const antMatches = [...wt.matchAll(/\{\{(?:ant|antonyms)\|en\|([^}]+)\}\}/g)];
  antMatches.forEach(m => {
    m[1].split('|').forEach(s => {
      const clean = s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').trim();
      if(clean && !clean.includes('=')) out.ants.push(clean);
    });
  });

  const eM=wt.match(/={2,3}\s*Etymology[^=]*={2,3}\n+([\s\S]*?)(?=\n={2,4})/);
  if(eM){
    let e=eM[1].replace(/\{\{(?:w|l|m)\|(?:[^|}]+\|)?([^|}]+)[^}]*\}\}/g,'$1').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g,'$1').replace(/\{\{[^{}]*\}\}/g,'').replace(/'''|''/g,'').replace(/<[^>]+>/g,'').replace(/\n+/g,' ').trim();
    const sent=e.match(/[^.!?]{15,}[.!?]/)?.[0]?.trim();
    out.etymology=(sent||e).slice(0,280).trim();
  }
  const vM=wt.match(/\{\{en-verb([^}]*)\}\}/);
  if(vM){
    const raw=vM[1];const np=raw.match(/\|past=([^|}\s]+)/)?.[1];const npp=raw.match(/\|past_ptc=([^|}\s]+)/)?.[1]||np;
    if(np)out.forms=`past tense: ${np}; past participle: ${npp}`;
    else{const args=raw.split('|').slice(1).map(s=>s.trim()).filter(s=>s&&!s.includes('='));if(args.length>=3)out.forms=`past tense: ${args[2]}; past participle: ${args[3]||args[2]}`;else{const p=regularPast(word);out.forms=`past tense: ${p}; past participle: ${p}`;}}
  }
  if(!out.forms){const nM=wt.match(/\{\{en-noun([^}]*)\}\}/);if(nM){const args=nM[1].split('|').slice(1).map(s=>s.trim()).filter(Boolean);if(!args.length||args[0]==='s')out.forms=`plural: ${word}s`;else if(args[0]==='-')out.forms='uncountable';else if(args[0]==='es')out.forms=`plural: ${word}es`;else if(!args[0].includes('='))out.forms=`plural: ${args[0]}`;}}
  if(!out.forms){const aM=wt.match(/\{\{en-adj([^}]*)\}\}/);if(aM){const args=aM[1].split('|').slice(1).map(s=>s.trim()).filter(Boolean);if(!args.length||args[0]==='more')out.forms=`comparative: more ${word}; superlative: most ${word}`;else if(args[0]!=='-'&&args.length>=2)out.forms=`comparative: ${args[0]}; superlative: ${args[1]}`;}}
  return out;
}
function regularPast(w){
  if(/e$/i.test(w))return w+'d';
  if(/[^aeiou]y$/i.test(w))return w.slice(0,-1)+'ied';
  if(/[aeiou][^aeiouwy]$/i.test(w)&&w.length<=5)return w+w.slice(-1)+'ed';
  return w+'ed';
}

/* ══════════════════════════════════════════════════
   NGRAM
══════════════════════════════════════════════════ */
async function fetchNgram(word){
  const base=`https://books.google.com/ngrams/json?content=${encodeURIComponent(word)}&year_start=1800&year_end=2019&corpus=26&smoothing=3`;
  const proxies=[
    `https://corsproxy.io/?${encodeURIComponent(base)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(base)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(base)}`
  ];
  
  const fetchGoogleNgram = async url => {
    const r=await fetch(url,{signal:AbortSignal.timeout(8000)});
    if(!r.ok)throw 0;
    const txt=await r.text();
    const j=JSON.parse(txt);
    const arr=Array.isArray(j)?j:(j.contents?JSON.parse(j.contents):null);
    if(!arr?.[0]?.timeseries?.length)throw 0;
    return arr[0].timeseries;
  };

  const fetchNgramsDev = async () => {
    const r = await fetch(`https://api.ngrams.dev/word/${encodeURIComponent(word)}`, {signal:AbortSignal.timeout(8000)});
    if(!r.ok) throw 0;
    const d = await r.json();
    if(!d?.timeseries?.length) throw 0;
    return d.timeseries;
  };

  return Promise.any([...proxies.map(fetchGoogleNgram), fetchNgramsDev()]).catch(()=>null);
}

function drawNgram(ts){
  const ngL=document.getElementById('ngram-loading');
  const canvas=document.getElementById('ngram-canvas');
  if(!ts?.length){ngL.textContent='No usage data available';ngL.style.display='flex';canvas.style.display='none';return;}
  ngL.style.display='none';canvas.style.display='block';
  const dpr=window.devicePixelRatio||1;const W=canvas.parentElement.clientWidth-20;const H=145;
  canvas.width=W*dpr;canvas.height=H*dpr;canvas.style.width=W+'px';canvas.style.height=H+'px';
  const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
  const n=ts.length,mn=Math.min(...ts),mx=Math.max(...ts),rng=mx-mn||1;
  const pad={t:8,b:22,l:46,r:6};const pw=W-pad.l-pad.r,ph=H-pad.t-pad.b;
  const gx=i=>pad.l+(i/(n-1))*pw;const gy=v=>pad.t+ph-((v-mn)/rng)*ph;
  const grad=ctx.createLinearGradient(0,pad.t,0,pad.t+ph);
  grad.addColorStop(0,'rgba(138,180,248,.38)');grad.addColorStop(1,'rgba(138,180,248,.02)');
  ctx.beginPath();ctx.moveTo(gx(0),H-pad.b);ts.forEach((v,i)=>ctx.lineTo(gx(i),gy(v)));
  ctx.lineTo(gx(n-1),H-pad.b);ctx.closePath();ctx.fillStyle=grad;ctx.fill();
  ctx.beginPath();ts.forEach((v,i)=>i===0?ctx.moveTo(gx(i),gy(v)):ctx.lineTo(gx(i),gy(v)));
  ctx.strokeStyle='rgba(138,180,248,.88)';ctx.lineWidth=1.8;ctx.lineJoin='round';ctx.stroke();
  ctx.save();ctx.fillStyle='rgba(154,160,166,.8)';ctx.font='10px Roboto,Arial';ctx.textAlign='center';
  ctx.translate(10,pad.t+ph/2);ctx.rotate(-Math.PI/2);ctx.fillText('Mentions',0,0);ctx.restore();
  ctx.fillStyle='rgba(154,160,166,.75)';ctx.font='10px Roboto,Arial';ctx.textAlign='center';
  [1800,1850,1900,1950,2000,2019].forEach(yr=>{const i=yr-1800;if(i>=0&&i<n)ctx.fillText(yr,gx(i),H-5);});
}

/* ══════════════════════════════════════════════════
   MAIN LOOKUP (STRICT SYNONYM/ANTONYM SEPARATION)
══════════════════════════════════════════════════ */
async function lookupWord(word){
  word=word.trim().toLowerCase();
  if(!word)return;
  currentWord=word;
  _currentLangMode='english';
  switchTab(0);
  if(!document.getElementById('screen-home').classList.contains('active'))navigate('home');

  const $e=document.getElementById('empty-state');
  const $l=document.getElementById('loading-state');
  const $err=document.getElementById('error-state');
  const $c=document.getElementById('word-content');

  $e.style.display='none';$err.style.display='none';$c.style.display='none';$l.style.display='block';

  const s=getSettings();
  const targetLang=s.targetLanguage||'Tamil';

  try{
    let data,extra;
    const cacheKey=`mdict_data_${word}`;
    const cachedDict=Store.get(cacheKey);
    if(cachedDict){
      data=cachedDict.data;
      extra=cachedDict.extra;
    } else {
      // Fetch Main Definition
      const dictData = await fetchDefinition(word); 
      data = dictData;
      
      let wikiExtra = {}, datamuseExtra = { syns: [], ants: [] }, mwThesExtra = { syns: [], ants: [] };
      
      // STRICT API SEPARATION FOR SIMILAR & OPPOSITE
      if (s.useFreeOnly) {
          // FREE MODE: Use Wiki & Datamuse for Syns/Ants
          [wikiExtra, datamuseExtra] = await Promise.all([
              fetchWikiExtra(word), 
              fetchDatamuse(word)
          ]);
      } else {
          // MW MODE: Use Wiki ONLY for Forms/Etymology, MW ONLY for Syns/Ants
          [wikiExtra, mwThesExtra] = await Promise.all([
              fetchWikiExtra(word), 
              fetchMerriamWebsterThesaurus(word)
          ]);
      }
      
      const apiSyns = data.meanings?.flatMap(m => (m.synonyms || []).concat(m.definitions.flatMap(d => d.synonyms || []))) || [];
      const apiAnts = data.meanings?.flatMap(m => (m.antonyms || []).concat(m.definitions.flatMap(d => d.antonyms || []))) || [];
      
      if (s.useFreeOnly) {
          extra = {
              forms: wikiExtra?.forms || null,
              etymology: wikiExtra?.etymology || null,
              syns: [...new Set([...apiSyns, ...(wikiExtra?.syns || []), ...(datamuseExtra?.syns || [])])],
              ants: [...new Set([...apiAnts, ...(wikiExtra?.ants || []), ...(datamuseExtra?.ants || [])])]
          };
      } else {
          // STRICTLY MW THESAURUS ONLY FOR SYNONYMS & ANTONYMS
          extra = {
              forms: wikiExtra?.forms || null,
              etymology: wikiExtra?.etymology || null,
              syns: [...new Set([...(mwThesExtra?.syns || [])])],
              ants: [...new Set([...(mwThesExtra?.ants || [])])]
          };
      }
      
      saveToCache(word, {data, extra});
    }

    _lastMeanings=data.meanings;
    _lastExtra=extra;

    $l.style.display='none';$c.style.display='block';window.scrollTo(0,0);

    document.getElementById('overview-english').style.display='block';
    document.getElementById('overview-bilingual').style.display='none';
    document.getElementById('bilingual-content').innerHTML='';
    document.getElementById('pill-english').classList.add('active');
    document.getElementById('pill-bilingual').classList.remove('active');

    document.getElementById('pill-lang-label').textContent=targetLang;
    document.getElementById('lang-pill-row').classList.add('visible');

    document.getElementById('wd-word').textContent=data.word;
    const ph=data.phonetic||data.phonetics?.find(p=>p.text)?.text||'';
    document.getElementById('wd-phonetic').textContent=ph;

    document.getElementById('translate-ta-label').textContent=targetLang;

    renderMeanings(data.meanings,extra?.forms,targetLang);
    renderExamplesTab(data.meanings);
    renderPhoneticsTab(data.phonetics||[]);
    renderSimilarTab(data.meanings, extra?.syns || [], extra?.ants || []);
    renderOverviewSyns(data.meanings, extra?.syns || [], extra?.ants || []);

    if(extra?.etymology){
      document.getElementById('origin-text').textContent=extra.etymology;
      document.getElementById('origin-block').style.display='block';
    }else{
      document.getElementById('origin-block').style.display='none';
    }

    document.getElementById('translate-en').textContent=data.word;
    document.getElementById('translate-ta').innerHTML='<span class="spinner-sm"></span>';
    translateWord(data.word,targetLang).then(t=>{
      if(currentWord===word)document.getElementById('translate-ta').textContent=t;
    });

    const ngL=document.getElementById('ngram-loading');
    const ngC=document.getElementById('ngram-canvas');
    ngL.style.display='flex';ngL.textContent='Loading usage data…';ngC.style.display='none';
    fetchNgram(word).then(ts=>{
      if(currentWord===word)drawNgram(ts);
    }).catch(()=>{
      if(currentWord===word){ngL.textContent='Usage data unavailable';ngL.style.display='flex';}
    });

    updateQueueBtn(word);
    updateBookmarkBtn(word);
    addToHistory(word);

  }catch{
    $l.style.display='none';$err.style.display='block';
    $err.textContent=`"${word}" was not found. Please check the spelling.`;
  }
}

/* ══════════════════════════════════════════════════
   ACTION BUTTONS STATE (QUEUE & BOOKMARK)
══════════════════════════════════════════════════ */
function updateQueueBtn(word){
  const btn=document.getElementById('queue-add-btn');if(!btn)return;
  const inQueue=getQueue().includes(word);
  btn.classList.toggle('queued',inQueue);
  btn.title=inQueue?'Remove from Queue':'Add to Queue';
  btn.innerHTML=inQueue
    ?`<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`
    :`<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`;
}
function updateBookmarkBtn(word){
  const btn=document.getElementById('bookmark-btn');if(!btn)return;
  const isBm=isBookmarked(word);
  btn.classList.toggle('queued',isBm);
  btn.title=isBm?'Remove Bookmark':'Add to Bookmarks';
  btn.innerHTML=isBm
    ?`<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>`
    :`<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2zm-5 14.5l-5 2.14V5h10v14.64l-5-2.14z"/></svg>`;
}

/* ══════════════════════════════════════════════════
   RENDER MEANINGS
══════════════════════════════════════════════════ */
const spkSVG=`<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>`;

function renderMeanings(meanings,gramForms,targetLang){
  const el=document.getElementById('wd-meanings-section');
  el.innerHTML='';
  const tl=targetLang||getTargetLang();
  const SHOW=3;
  meanings.forEach((m,mi)=>{
    const blk=document.createElement('div');blk.className='pos-block';
    blk.innerHTML=`<div class="pos-label">${m.partOfSpeech}</div>`;
    if(gramForms&&mi===0){
      const fmtd=gramForms.split(';').map(f=>{
        const [lbl,...rest]=f.split(':');
        return `<b>${lbl.trim()}:</b> ${rest.join(':').trim()}`;
      }).join(' &nbsp;·&nbsp; ');
      blk.innerHTML+=`<div class="grammar-forms">${fmtd}</div>`;
    }
    el.appendChild(blk);
    const extras=[];
    m.definitions.forEach((def,i)=>{
      const item=document.createElement('div');item.className='definition-item';
      const safeEn=def.definition.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,"\\'");
      const safeEx=def.example?(def.example.replace(/\\/g,'\\\\').replace(/'/g,"\\'")):'';
      item.innerHTML=`
        <span class="def-num">${i+1}.</span>
        <div class="def-body">
          <div class="def-text">${def.definition}</div>
          <button class="translate-inline-btn" onclick="toggleInlineTranslation(this,'${safeEn}')">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>
            Translate to ${tl}
          </button>
          <div class="def-translated" data-loaded="0"></div>
          ${def.example?`
          <div class="example-row">
            <div class="def-example">"${def.example}"</div>
            <button class="ex-speak" title="Speak example" onclick="speak('${safeEx}','en-US')">${spkSVG}</button>
          </div>`:''}
        </div>`;
      if(i<SHOW){el.appendChild(item);}
      else{item.style.display='none';extras.push(item);el.appendChild(item);}
    });
    if(extras.length){
      const sb=document.createElement('button');sb.className='show-more-btn';
      sb.textContent=`Show ${extras.length} more definition${extras.length>1?'s':''}`;
      sb.onclick=()=>{extras.forEach(e=>e.style.display='');sb.remove();};
      el.appendChild(sb);
    }
  });
}

/* ══════════════════════════════════════════════════
   EXAMPLES TAB
══════════════════════════════════════════════════ */
function renderExamplesTab(meanings){
  const el=document.getElementById('examples-list');el.innerHTML='';let n=0;
  const sv16=`<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>`;
  meanings.forEach(m=>{
    m.definitions.forEach(def=>{
      if(!def.example)return;n++;
      const safeEx=def.example.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      const d=document.createElement('div');d.className='example-tab-item';
      d.innerHTML=`<div class="example-tab-pos">${m.partOfSpeech}</div><div class="example-tab-row"><div class="example-tab-text">"${def.example}"</div><button class="ex-speak" title="Speak" onclick="speak('${safeEx}','en-US')">${sv16}</button></div>`;
      el.appendChild(d);
    });
  });
  if(!n)el.innerHTML='<div class="list-empty">No usage examples available.</div>';
}

/* ══════════════════════════════════════════════════
   PHONETICS TAB
══════════════════════════════════════════════════ */
function renderPhoneticsTab(phonetics){
  const el=document.getElementById('phonetics-list');el.innerHTML='';
  const sv16=`<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>`;
  const labels=['American','British','Australian','Other'];
  const valid=phonetics.filter(p=>p.text||p.audio);
  if(!valid.length){el.innerHTML='<div style="color:var(--text2);font-size:14px;padding:8px 0">No phonetic data available.</div>';return;}
  valid.forEach((p,i)=>{
    const d=document.createElement('div');d.className='phonetic-item';
    d.innerHTML=`<span class="phonetic-accent">${labels[i]||'Variant'}</span><span class="phonetic-text">${p.text||'—'}</span>${p.audio?`<button class="phonetic-play" onclick="playAudio('${p.audio}')" title="Play audio">${sv16}</button>`:''}`;
    el.appendChild(d);
  });
}
function playAudio(url){try{new Audio(url).play();}catch{}}

/* ══════════════════════════════════════════════════
   SIMILAR & OPPOSITE TAB
══════════════════════════════════════════════════ */
function renderSimilarTab(meanings, extraSyns = [], extraAnts = []){
  const apiSyns = meanings.flatMap(m => (m.synonyms || []).concat(m.definitions.flatMap(d => d.synonyms || [])));
  const apiAnts = meanings.flatMap(m => (m.antonyms || []).concat(m.definitions.flatMap(d => d.antonyms || [])));
  const syns = [...new Set([...apiSyns, ...extraSyns])];
  const ants = [...new Set([...apiAnts, ...extraAnts])];
  const el=document.getElementById('similar-list');el.innerHTML='';
  if(!syns.length&&!ants.length){el.innerHTML='<div class="list-empty">No synonyms or antonyms available.</div>';return;}
  if(syns.length)buildChips(el,'Similar words',syns,false,null);
  if(ants.length){if(syns.length){const sp=document.createElement('div');sp.style.marginTop='20px';el.appendChild(sp);}buildChips(el,'Antonyms',ants,true,null);}
}
function renderOverviewSyns(meanings, extraSyns = [], extraAnts = []){
  const apiSyns = meanings.flatMap(m => (m.synonyms || []).concat(m.definitions.flatMap(d => d.synonyms || [])));
  const apiAnts = meanings.flatMap(m => (m.antonyms || []).concat(m.definitions.flatMap(d => d.antonyms || [])));
  const syns = [...new Set([...apiSyns, ...extraSyns])];
  const ants = [...new Set([...apiAnts, ...extraAnts])];
  const wrap=document.getElementById('overview-syn-block');const el=document.getElementById('overview-syn-content');
  el.innerHTML='';
  if(!syns.length&&!ants.length){wrap.style.display='none';return;}
  wrap.style.display='block';
  if(syns.length)buildChips(el,'Similar words',syns,false,5);
  if(ants.length){if(syns.length){const sp=document.createElement('div');sp.style.marginTop='16px';el.appendChild(sp);}buildChips(el,'Antonyms',ants,true,5);}
}
function buildChips(container,label,words,isAnt,limit){
  if(label){const h=document.createElement('div');h.className='section-title';h.textContent=label;container.appendChild(h);}
  const list=document.createElement('div');list.className='chip-list';
  words.forEach((w,i)=>{
    const c=document.createElement('button');c.className='chip'+(isAnt?' ant':'');c.textContent=w;
    if(limit&&i>=limit)c.style.display='none';
    c.onclick=()=>{document.getElementById('search-input').value=w;lookupWord(w);};
    list.appendChild(c);
  });
  if(limit&&words.length>limit){
    const btn=document.createElement('button');btn.className='chip expand-btn';btn.textContent='∨';btn.title=`Show ${words.length-limit} more`;
    btn.onclick=()=>{list.querySelectorAll('.chip[style*="none"]').forEach(c=>c.style.display='');btn.remove();};
    list.appendChild(btn);
  }
  container.appendChild(list);
}

/* ══════════════════════════════════════════════════
   TTS
══════════════════════════════════════════════════ */
function speak(text,lang){
  if(!window.speechSynthesis){showToast('TTS not supported');return;}
  window.speechSynthesis.cancel();
  const utt=new SpeechSynthesisUtterance(text);
  utt.lang=lang||document.getElementById('accent-select').value;
  utt.rate=parseFloat(document.getElementById('speed-slider')?.value||'1');
  const voices=window.speechSynthesis.getVoices();
  const match=voices.find(v=>v.lang===utt.lang)||voices.find(v=>v.lang.startsWith(utt.lang.split('-')[0]));
  if(match)utt.voice=match;
  const mainBtn=document.getElementById('speak-btn');
  const hdrBtn=document.getElementById('header-speak-btn');
  const setSpeaking=on=>{if(mainBtn)mainBtn.classList.toggle('speaking',on);if(hdrBtn)hdrBtn.classList.toggle('speaking',on);};
  setSpeaking(true);utt.onend=utt.onerror=()=>setSpeaking(false);
  window.speechSynthesis.speak(utt);
}

/* ══════════════════════════════════════════════════
   HISTORY
══════════════════════════════════════════════════ */
function addToHistory(word){
  let h=Store.get(K.HISTORY,[]);h=h.filter(x=>x.word!==word);
  h.unshift({word,date:new Date().toLocaleDateString()});
  if(h.length>200)h=h.slice(0,200);Store.set(K.HISTORY,h);
}
function renderHistory(){
  const f=(document.getElementById('history-filter').value||'').toLowerCase();
  let h=Store.get(K.HISTORY,[]);
  if(f)h=h.filter(x=>x.word.toLowerCase().includes(f));
  const el=document.getElementById('history-list-inner');
  if(!h.length){el.innerHTML=`<div class="list-empty">${f?'No matches.':'No words searched yet.'}</div>`;return;}
  el.innerHTML=h.map((x,i)=>`
    <div class="history-item" onclick="navigate('home');document.getElementById('search-input').value='${x.word}';lookupWord('${x.word}')">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="color:var(--text2);flex-shrink:0"><path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21L9.5 12.21V8H12z"/></svg>
      <span class="history-word">${x.word}</span>
      <span class="history-date">${x.date}</span>
      <button class="history-del" onclick="event.stopPropagation();delHistory(${i})">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </button>
    </div>`).join('');
}
function delHistory(i){let h=Store.get(K.HISTORY,[]);h.splice(i,1);Store.set(K.HISTORY,h);renderHistory();}

/* ══════════════════════════════════════════════════
   BOOKMARKS
══════════════════════════════════════════════════ */
function getBookmarks(){return Store.get(K.BOOKMARKS,[]);}
function saveBookmarks(b){Store.set(K.BOOKMARKS,b);}
function isBookmarked(word){return getBookmarks().some(b=>b.word===word);}
function addBookmark(word,def,pos){
  if(isBookmarked(word)){showToast(`"${word}" already bookmarked`);return;}
  const b=getBookmarks();
  b.unshift({word,def,pos,date:new Date().toLocaleDateString()});
  saveBookmarks(b);showToast(`"${word}" added to bookmarks`);
  updateBookmarkBtn(word);
  if(document.getElementById('screen-settings').classList.contains('active')) {
    const el=document.getElementById('bookmark-count'); if(el) el.textContent=`${getBookmarks().length} words bookmarked`;
  }
}
function removeBookmark(word){
  saveBookmarks(getBookmarks().filter(b=>b.word!==word));
  showToast(`"${word}" removed from bookmarks`);
  updateBookmarkBtn(word);
  if(document.getElementById('screen-settings').classList.contains('active')) {
    const el=document.getElementById('bookmark-count'); if(el) el.textContent=`${getBookmarks().length} words bookmarked`;
  }
  if(document.getElementById('screen-bookmarks').classList.contains('active')) renderBookmarks();
}
function renderBookmarks(){
  const b=getBookmarks();
  const el=document.getElementById('bookmarks-content');
  if(!b.length){
    el.innerHTML=`<div class="list-empty">No bookmarks yet.<br>Search a word and tap the bookmark icon to save it here.</div>`;
    return;
  }
  el.innerHTML=b.map(item=>`
    <div class="daily-card" style="margin-bottom:16px">
      <div class="daily-word-title">${item.word}</div>
      <div class="daily-pos">${item.pos||''}</div>
      <div class="daily-def">${item.def||''}</div>
      <div class="divider" style="margin:16px 0"></div>
      <div class="daily-actions">
        <button class="btn-primary" onclick="navigate('home');document.getElementById('search-input').value='${item.word}';lookupWord('${item.word}')">View Full Definition</button>
        <button class="btn-secondary" onclick="removeBookmark('${item.word}')">Remove</button>
      </div>
    </div>`).join('');
}

/* ══════════════════════════════════════════════════
   DAILY WORD & QUEUE
══════════════════════════════════════════════════ */
function getQueue(){return Store.get(K.QUEUE,[]);}
function saveQueue(q){Store.set(K.QUEUE,q);}
function addToQueue(word){
  if(!word)return;const q=getQueue();
  if(q.includes(word)){showToast(`"${word}" already in queue`);return;}
  q.push(word);saveQueue(q);showToast(`"${word}" added to daily queue`);
  updateQueueLabel();updateQueueBtn(word);
}
function updateQueueLabel(){const el=document.getElementById('queue-count');if(el)el.textContent=`${getQueue().length} words queued`;}
function updateHistoryLabel(){const el=document.getElementById('history-count');if(el)el.textContent=`${Store.get(K.HISTORY,[]).length} words`;}

function openBulkQueueModal(){
  document.getElementById('bulk-queue-input').value='';
  document.getElementById('bulk-queue-modal').classList.add('open');
}
function closeBulkQueueModal(){document.getElementById('bulk-queue-modal').classList.remove('open');}
function addBulkToQueue(){
  const raw=document.getElementById('bulk-queue-input').value;
  const words=raw.split(',').map(w=>w.trim().toLowerCase()).filter(Boolean);
  if(!words.length){showToast('No valid words entered');return;}
  const q=getQueue();let added=0;
  words.forEach(w=>{if(w&&!q.includes(w)){q.push(w);added++;}});
  saveQueue(q);updateQueueLabel();
  closeBulkQueueModal();
  showToast(`Added ${added} word${added!==1?'s':''} to queue`);
}

function removeFromQueue(index){
  let q=getQueue();
  q.splice(index,1);
  saveQueue(q);
  updateQueueLabel();
  showToast('Removed from queue');
  renderDailyWord(); // Refresh the daily screen to update the list
}

async function pickNextWord(){
  const q=getQueue();if(q.length){const w=q.shift();saveQueue(q);return w;}
  return FALLBACK[Math.floor(Math.random()*FALLBACK.length)];
}

async function renderDailyWord(){
  const el=document.getElementById('daily-content');
  const today=new Date().toDateString();
  const saved=Store.get(K.LAST_DAILY,null);
  if(saved&&saved.date===today){buildDailyCard(el,saved);return;}
  el.innerHTML='<div class="spinner"></div>';
  const word=await pickNextWord();
  const targetLang=getTargetLang();
  try{
    const data=await fetchDefinition(word);
    const def=data.meanings?.[0]?.definitions?.[0]?.definition||'';
    const pos=data.meanings?.[0]?.partOfSpeech||'';
    const translated=await translateWord(data.word,targetLang);
    const obj={word:data.word,date:today,pos,definition:def,translated,targetLang};
    Store.set(K.LAST_DAILY,obj);buildDailyCard(el,obj);addToHistory(data.word);
    updateQueueLabel(); 
  }catch{el.innerHTML='<div class="error-state">Could not load daily word.</div>';}
}
function buildDailyCard(el,d){
  const tl=d.targetLang||getTargetLang();
  el.innerHTML=`
    <div style="padding:8px 0 14px">
      <div class="section-title">Word of the Day</div>
      <div style="font-size:12px;color:var(--text2)">${d.date}</div>
    </div>
    <div class="daily-card">
      <div class="daily-word-title">${d.word}</div>
      <div class="daily-pos">${d.pos}</div>
      <div class="daily-def">${d.definition}</div>
      <div class="divider" style="margin:16px 0"></div>
      <div class="daily-grid">
        <div><div class="daily-lang-label">English</div><div class="daily-lang-text">${d.word}</div></div>
        <div><div class="daily-lang-label">${tl}</div><div class="daily-lang-text">${d.translated||'—'}</div></div>
      </div>
    </div>
    <div class="daily-actions">
      <button class="btn-primary" onclick="navigate('home');document.getElementById('search-input').value='${d.word}';lookupWord('${d.word}')">View Full Definition</button>
      <button class="btn-secondary" onclick="Store.del('${K.LAST_DAILY}');renderDailyWord()">New Word</button>
    </div>`;

  const q=getQueue();
  if(q.length>0){
    el.innerHTML+=`
      <div style="margin-top:24px">
        <div class="section-title">Upcoming Queue (${q.length})</div>
        <div style="background:var(--surface);border-radius:12px;padding:0 16px;">
          ${q.map((w,i)=>`
            <div class="history-item" style="padding:13px 0;cursor:pointer" onclick="navigate('home');document.getElementById('search-input').value='${w}';lookupWord('${w}')">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="color:var(--text2);flex-shrink:0"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 9V3.5L18.5 9H13z"/></svg>
              <span class="history-word">${w}</span>
              ${i===0?'<span style="font-size:11px;color:var(--accent);background:rgba(138,180,248,.13);padding:2px 8px;border-radius:4px">Next</span>':''}
              <button class="history-del" onclick="event.stopPropagation();removeFromQueue(${i})" title="Remove from queue">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
              </button>
            </div>
          `).join('')}
        </div>
      </div>`;
  }
}
/* ══════════════════════════════════════════════════
   NOTIFICATIONS
══════════════════════════════════════════════════ */
async function requestPermission(){
  if(!('Notification' in window))return false;
  if(Notification.permission==='granted')return true;
  return(await Notification.requestPermission())==='granted';
}
let _nt;
function scheduleNotification(){
  const s=getSettings();if(!s.notifEnabled)return;clearTimeout(_nt);
  const[h,m]=s.notifTime.split(':').map(Number);
  const now=new Date(),tgt=new Date();tgt.setHours(h,m,0,0);
  if(tgt<=now)tgt.setDate(tgt.getDate()+1);
  _nt=setTimeout(async()=>{
    const ok=await requestPermission();
    if(ok){const word=await pickNextWord();try{
      const data=await fetchDefinition(word);
      const def=data.meanings?.[0]?.definitions?.[0]?.definition||'';
      new Notification('📖 Word of the Day: '+data.word,{body:def.length>120?def.slice(0,117)+'…':def});
      const translated=await translateWord(data.word,getTargetLang());
      Store.set(K.LAST_DAILY,{word:data.word,date:new Date().toDateString(),pos:data.meanings?.[0]?.partOfSpeech||'',definition:def,translated,targetLang:getTargetLang()});
    }catch{}}
    scheduleNotification();
  },tgt-now);
}
function showNotifBanner(){
  if(!('Notification' in window))return;
  const s=getSettings();
  if(s.notifEnabled||Notification.permission==='denied')return;
  if(Notification.permission!=='granted')document.getElementById('notif-banner').classList.add('show');
}

/* ══════════════════════════════════════════════════
   BACKUP & RESTORE
══════════════════════════════════════════════════ */
function openBackupModal(){
  document.getElementById('bc-history-sub').textContent=`${Store.get(K.HISTORY,[]).length} words`;
  document.getElementById('bc-bookmarks-sub').textContent=`${getBookmarks().length} words bookmarked`;
  document.getElementById('bc-queue-sub').textContent=`${getQueue().length} words queued`;
  document.getElementById('bc-cache-sub').textContent=`${Store.get('mdict_cache_keys',[]).length} words cached`;
  document.getElementById('backup-modal').classList.add('open');
}
function closeBackupModal(){document.getElementById('backup-modal').classList.remove('open');}

function exportSelectedBackup(){
  const backup={app:'MyDictionary',date:new Date().toISOString()};
  if(document.getElementById('bc-settings').checked)backup.settings=getSettings();
  if(document.getElementById('bc-history').checked)backup.history=Store.get(K.HISTORY,[]);
  if(document.getElementById('bc-bookmarks').checked)backup.bookmarks=getBookmarks();
  if(document.getElementById('bc-queue').checked)backup.queue=getQueue();
  if(document.getElementById('bc-cache').checked){
    backup.cacheKeys=Store.get('mdict_cache_keys',[]);backup.cacheData={};
    backup.cacheKeys.forEach(w=>{
      const dictData=Store.get(`mdict_data_${w}`);const geminiData=Store.get(`mdict_gemini_${w}`);
      if(dictData||geminiData)backup.cacheData[w]={dict:dictData,gemini:geminiData};
    });
  }
  const blob=new Blob([JSON.stringify(backup)],{type:'application/json'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');
  a.href=url;a.download=`MyDictionary_Backup_${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
  closeBackupModal();showToast('Backup downloaded!');
}

function importBackup(inputEl){
  const file=inputEl.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=async e=>{
    try{
      const backup=JSON.parse(e.target.result);
      if(backup.app!=='MyDictionary'){showToast('Invalid backup file');return;}
      closeBackupModal();
      const currentLang=getSettings().targetLanguage||'Tamil';
      const backupLang=backup.settings?.targetLanguage;

      const doRestore=switchLang=>{
        if(backup.history)Store.set(K.HISTORY,backup.history);
        if(backup.bookmarks)Store.set(K.BOOKMARKS,backup.bookmarks);
        if(backup.queue)Store.set(K.QUEUE,backup.queue);
        if(backup.lastDaily)Store.set(K.LAST_DAILY,backup.lastDaily);
        if(backup.cacheKeys&&backup.cacheData){
          backup.cacheKeys.forEach(w=>{
            if(backup.cacheData[w]?.dict)Store.set(`mdict_data_${w}`,backup.cacheData[w].dict);
            if(backup.cacheData[w]?.gemini)Store.set(`mdict_gemini_${w}`,backup.cacheData[w].gemini);
          });
          Store.set('mdict_cache_keys',backup.cacheKeys);
        }
        if(backup.settings){
          saveSettings({...backup.settings,targetLanguage:switchLang?backupLang:currentLang});
        }
        renderSettingsPage();showToast('Backup restored!');
        if(switchLang&&backupLang&&backupLang!==currentLang)retranslateCachedBilingualDefs(currentLang,backupLang);
      };

      if(backupLang&&backupLang!==currentLang){
        document.getElementById('lang-change-text').textContent=
          `This backup uses "${backupLang}" as the target language, but your current setting is "${currentLang}". Switch to "${backupLang}" and re-translate cached bilingual definitions?`;
        document.getElementById('lang-change-yes').onclick=()=>{document.getElementById('lang-change-modal').classList.remove('open');doRestore(true);};
        document.getElementById('lang-change-no').onclick=()=>{document.getElementById('lang-change-modal').classList.remove('open');doRestore(false);};
        document.getElementById('lang-change-modal').classList.add('open');
      }else{doRestore(false);}
    }catch{showToast('Failed to read backup file');}
  };
  reader.readAsText(file);inputEl.value='';
}

async function retranslateCachedBilingualDefs(oldLang,newLang){
  const keys=Store.get('mdict_cache_keys',[]);
  let count=0;showToast(`Re-translating cached definitions…`);
  for(const word of keys){
    const oldKey=`mdict_bilingual_${word}_${oldLang}`;
    const cached=Store.get(oldKey);
    if(cached?.english_def){
      try{
        const translated=await translateWord(cached.english_def,newLang);
        Store.set(`mdict_bilingual_${word}_${newLang}`,{english_def:cached.english_def,translated_def:translated});
        Store.del(oldKey);count++;
      }catch{}
    }
  }
  showToast(`Re-translated ${count} word${count!==1?'s':''}`);
}

/* ══════════════════════════════════════════════════
   TOAST
══════════════════════════════════════════════════ */
let _tt;
function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');clearTimeout(_tt);_tt=setTimeout(()=>t.classList.remove('show'),2600);}

/* ══════════════════════════════════════════════════
   NAVIGATION / TABS
══════════════════════════════════════════════════ */
function navigate(s){
  document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));
  document.getElementById('screen-'+s).classList.add('active');
  const nb=document.getElementById('nav-'+s);if(nb)nb.classList.add('active');
  const T={home:'MyDictionary',history:'History',bookmarks:'Bookmarks',daily:'Daily Word',settings:'Settings'};
  document.getElementById('topbar-title').textContent=T[s]||'MyDictionary';
  if(s==='history')renderHistory();
  if(s==='bookmarks')renderBookmarks();
  if(s==='daily')renderDailyWord();
  if(s==='settings')renderSettingsPage();
  window.scrollTo(0,0);
}
function switchTab(idx){
  document.querySelectorAll('.tab-btn').forEach((b,i)=>b.classList.toggle('active',i===idx));
  document.querySelectorAll('.tab-pane').forEach((p,i)=>p.classList.toggle('active',i===idx));
}

/* ══════════════════════════════════════════════════
   SETTINGS PAGE
══════════════════════════════════════════════════ */
function renderSettingsPage(){
  const s=getSettings();
  document.getElementById('notif-toggle').checked=s.notifEnabled;
  document.getElementById('notif-time').value=s.notifTime;
  document.getElementById('cache-limit-mb').value=s.cacheLimitMB||5;
  const apiKeyEl=document.getElementById('gemini-api-key');
  if(apiKeyEl)apiKeyEl.value=s.geminiApiKey||'';
  
  const freeToggleEl=document.getElementById('free-dict-toggle');
  if(freeToggleEl) freeToggleEl.checked = s.useFreeOnly;
  
  const mwDictEl=document.getElementById('mw-dict-key');
  if(mwDictEl)mwDictEl.value=s.merriamDictKey||'';
  const mwThesEl=document.getElementById('mw-thes-key');
  if(mwThesEl)mwThesEl.value=s.merriamThesKey||'';
  
  const mwBlock=document.getElementById('mw-keys-block');
  if(mwBlock) mwBlock.style.display = s.useFreeOnly ? 'none' : 'flex';

  const langEl=document.getElementById('target-language');
  if(langEl)langEl.value=s.targetLanguage||'Tamil';
  updateFontLabel(s.fontSize);updateQueueLabel();updateHistoryLabel();
  const bmCountEl=document.getElementById('bookmark-count'); if(bmCountEl) bmCountEl.textContent=`${getBookmarks().length} words bookmarked`;
}
const FSIZES=[12,14,16,18],FLABELS={12:'Small',14:'Medium',16:'Large',18:'Extra Large'};
function updateFontLabel(sz){
  document.getElementById('font-size-label').textContent=FLABELS[sz]||'Medium';
  document.documentElement.style.setProperty('--base-size',sz+'px');
}

/* ══════════════════════════════════════════════════
   EVENT LISTENERS
══════════════════════════════════════════════════ */
document.getElementById('search-btn').onclick=()=>{const v=document.getElementById('search-input').value.trim();if(v)lookupWord(v);};
document.getElementById('search-input').addEventListener('keydown',e=>{if(e.key==='Enter'){const v=e.target.value.trim();if(v)lookupWord(v);}});

document.getElementById('header-speak-btn').onclick=()=>{if(currentWord)speak(currentWord,document.getElementById('accent-select').value);};
document.getElementById('speak-btn').onclick=()=>{if(currentWord)speak(currentWord,document.getElementById('accent-select').value);};
document.getElementById('speak-en-btn').onclick=()=>{if(currentWord)speak(currentWord,'en-US');};
document.getElementById('speak-ta-btn').onclick=()=>{
  const ta=document.getElementById('translate-ta').textContent.trim();
  if(ta&&ta!=='—')speak(ta,getLangCode(getTargetLang()));
};

document.getElementById('queue-add-btn').onclick=()=>{
  if(!currentWord){showToast('Search a word first');return;}
  const q=getQueue();
  if(q.includes(currentWord)){saveQueue(q.filter(w=>w!==currentWord));showToast(`"${currentWord}" removed from queue`);}
  else{addToQueue(currentWord);}
  updateQueueBtn(currentWord);updateQueueLabel();
};

document.getElementById('bookmark-btn').onclick=()=>{
  if(!currentWord){showToast('Search a word first');return;}
  if(isBookmarked(currentWord)){
    removeBookmark(currentWord);
  }else{
    const def=_lastMeanings?.[0]?.definitions?.[0]?.definition||'';
    const pos=_lastMeanings?.[0]?.partOfSpeech||'';
    addBookmark(currentWord,def,pos);
  }
};

document.getElementById('history-filter').addEventListener('input',renderHistory);

document.getElementById('cache-limit-mb').addEventListener('change',e=>{
  const s=getSettings();s.cacheLimitMB=parseInt(e.target.value);saveSettings(s);
  enforceCacheLimitMB();showToast(`Cache limit set to ${s.cacheLimitMB} MB`);
});

document.getElementById('clear-cache-btn').onclick=()=>{
  if(!confirm('Clear all cached word data?'))return;
  const keys=Store.get('mdict_cache_keys',[]);
  keys.forEach(k=>{
    Store.del(`mdict_data_${k}`);
    Store.del(`mdict_gemini_${k}`);
  });
  Store.set('mdict_cache_keys',[]);
  updateCacheLabel();
  showToast('Cache cleared');
};

function updateCacheLabel(){
  const el=document.getElementById('cache-count');
  if(el) el.textContent=`${Store.get('mdict_cache_keys',[]).length} words cached`;
}

document.getElementById('backup-btn').addEventListener('click',openBackupModal);
document.getElementById('restore-file-input').addEventListener('change',function(){importBackup(this);});

document.getElementById('gemini-api-key').addEventListener('change',e=>{
  const s=getSettings();s.geminiApiKey=e.target.value.trim();saveSettings(s);
  showToast(s.geminiApiKey?'API key saved':'API key cleared');
});

document.getElementById('free-dict-toggle').addEventListener('change',e=>{
  const s=getSettings();
  s.useFreeOnly = e.target.checked;
  saveSettings(s);
  renderSettingsPage();
  showToast(s.useFreeOnly ? 'Free APIs enabled' : 'Merriam-Webster enabled (Primary)');
});

document.getElementById('mw-dict-key').addEventListener('change',e=>{
  const s=getSettings();s.merriamDictKey=e.target.value.trim();saveSettings(s);
  showToast('Merriam-Webster Dictionary Key saved');
});

document.getElementById('mw-thes-key').addEventListener('change',e=>{
  const s=getSettings();s.merriamThesKey=e.target.value.trim();saveSettings(s);
  showToast('Merriam-Webster Thesaurus Key saved');
});

document.getElementById('target-language').addEventListener('change',e=>{
  const s=getSettings();s.targetLanguage=e.target.value;saveSettings(s);
  showToast(`Target language set to ${e.target.value}`);
  const pill=document.getElementById('pill-lang-label');
  if(pill)pill.textContent=e.target.value;
});

document.getElementById('notif-toggle').addEventListener('change',async e=>{
  const s=getSettings();
  if(e.target.checked){
    const ok=await requestPermission();
    if(!ok){showToast('Permission denied');e.target.checked=false;return;}
    s.notifEnabled=true;saveSettings(s);scheduleNotification();
    document.getElementById('notif-banner').classList.remove('show');showToast('Notifications enabled');
  }else{s.notifEnabled=false;saveSettings(s);clearTimeout(_nt);showToast('Notifications disabled');}
});
document.getElementById('notif-time').addEventListener('change',e=>{
  const s=getSettings();s.notifTime=e.target.value;saveSettings(s);
  if(s.notifEnabled)scheduleNotification();showToast('Notification time updated');
});
document.getElementById('notif-allow-btn').addEventListener('click',async()=>{
  const ok=await requestPermission();
  if(ok){const s=getSettings();s.notifEnabled=true;saveSettings(s);scheduleNotification();
    document.getElementById('notif-banner').classList.remove('show');showToast('Notifications enabled');
  }else showToast('Permission denied — allow in browser settings');
});
document.getElementById('font-increase').onclick=()=>{const s=getSettings();const i=FSIZES.indexOf(s.fontSize);if(i<FSIZES.length-1){s.fontSize=FSIZES[i+1];saveSettings(s);updateFontLabel(s.fontSize);}};
document.getElementById('font-decrease').onclick=()=>{const s=getSettings();const i=FSIZES.indexOf(s.fontSize);if(i>0){s.fontSize=FSIZES[i-1];saveSettings(s);updateFontLabel(s.fontSize);}};
document.getElementById('clear-history-btn').onclick=()=>{if(!confirm('Clear all search history?'))return;Store.del(K.HISTORY);updateHistoryLabel();showToast('History cleared');};
document.getElementById('clear-bookmarks-btn').onclick=()=>{if(!confirm('Clear all bookmarks?'))return;Store.del(K.BOOKMARKS);renderSettingsPage();showToast('Bookmarks cleared');};
document.getElementById('clear-queue-btn').onclick=()=>{if(!confirm('Clear the daily word queue?'))return;Store.del(K.QUEUE);updateQueueLabel();showToast('Queue cleared');};

/* ══════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════ */
(function(){
  const s=getSettings();updateFontLabel(s.fontSize);
  if(window.speechSynthesis){window.speechSynthesis.getVoices();window.speechSynthesis.addEventListener('voiceschanged',()=>window.speechSynthesis.getVoices());}
  if(s.notifEnabled&&'Notification' in window&&Notification.permission==='granted')scheduleNotification();
  else setTimeout(showNotifBanner,3000);
})();
