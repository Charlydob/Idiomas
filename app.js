// ==== Firebase (compat, no ESM) ====
(function(){
  const firebaseConfig = {
    apiKey: "AIzaSyCGcI9PFKZhnAN404yslQO2zurKOFLvoRw",
    authDomain: "idiomas-3f0a3.firebaseapp.com",
    databaseURL: "https://idiomas-3f0a3-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "idiomas-3f0a3",
    storageBucket: "idiomas-3f0a3.appspot.com",
    messagingSenderId: "1080268564792",
    appId: "1:1080268564792:web:da0c2cef7a0bdc364d39cd"
  };
  firebase.initializeApp(firebaseConfig);
  window.DB = firebase.database();
  window.AUTH = firebase.auth?.();
})();
const PHRASES_PATH = "/deutsch_phrases";
const VOCAB_PATH   = "/deutsch_vocab";
const DICT_PATH    = "/deutsch_dict";

// ==== Estado / utilidades ====
const LS_KEY   = "deutsch.phrases.v1";
const LS_TEMAS = "deutsch.temas.v1";
const LS_VOCAB = "deutsch.vocab.v1";
const LS_DICT  = "deutsch.dict.v1";
const DEFAULT_TEMAS = ["Saludos","Transporte","Direcciones","Compras","Comida","Salud","Trabajo","Escape","Conversación","Emergencias"];
const $  = (s,c=document)=>c.querySelector(s);
const $$ = (s,c=document)=>Array.from(c.querySelectorAll(s));
const state = { phrases:[], temas:[], vocab:[], dict:{}, quizPool:[], quizIdx:0, vocabMode:"es" };

const uid = (s="")=>{ const b=s.normalize("NFKD").toLowerCase(); let h=2166136261>>>0; for(let i=0;i<b.length;i++){ h^=b.charCodeAt(i); h=Math.imul(h,16777619)>>>0;} return "id_"+h.toString(36); };
const nowISO = ()=>new Date().toISOString();
const normalize = v=>(v||"").trim();
const saveLocal = ()=>{
  localStorage.setItem(LS_KEY,   JSON.stringify(state.phrases));
  localStorage.setItem(LS_TEMAS, JSON.stringify(state.temas));
  localStorage.setItem(LS_VOCAB, JSON.stringify(state.vocab));
  localStorage.setItem(LS_DICT,  JSON.stringify(state.dict));
};
const loadLocal = ()=>{ try{
  state.phrases=JSON.parse(localStorage.getItem(LS_KEY)||"[]");
  state.temas=JSON.parse(localStorage.getItem(LS_TEMAS)||"[]");
  state.vocab=JSON.parse(localStorage.getItem(LS_VOCAB)||"[]");
  state.dict =JSON.parse(localStorage.getItem(LS_DICT)||"{}");
  if(!state.temas.length) state.temas=DEFAULT_TEMAS.slice();
}catch{ state.phrases=[]; state.temas=DEFAULT_TEMAS.slice(); state.vocab=[]; state.dict={}; } };

// ==== Diccionario global (PipeDict v1) ====
const did = (s)=> uid("d||"+(s||"")).slice(3); // id estable corto
const dictGet = (id)=> (state.dict?.[id] ?? "");
const dictEnsure = (text)=>{
  const t=(text||"").trim(); if(!t) return "";
  const id=did(t);
  if(!state.dict[id]) state.dict[id]=t;
  return id;
};
async function persistDict(){
  saveLocal();
  try{ await DB.ref(DICT_PATH).set(state.dict); }catch(e){ console.error("RTDB dict", e); }
}

// ==== Parser PipeDict v1 ====
// Línea: a|s|pa|ps|e1,e2(,eN)[|t]  → todos son IDs en DICT
function parsePipeDict(text){
  const outP=[]; const outV=[];
  const lines=(text||"").split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  for(const line of lines){
    if(/^#|^\/\//.test(line)) continue;
    const parts=line.split("|");
    if(parts.length<5) continue;
    const [a,s,pa,ps,elist,temaId=""] = parts.map(x=>x.trim());

    const ale   = dictGet(a);
    const ch    = dictGet(s);
    const pron  = dictGet(pa);
    const pronC = dictGet(ps);
    const esArr = (elist?elist.split(","):[]).map(id=>dictGet(id)).filter(Boolean);
    const es    = esArr.join(" / ");
    const tema  = dictGet(temaId)||"";

    const obj = {
      id: uid(`${ale}||${es}||${tema}`),
      ale, ch, pron, pronCh: pronC, es, tema,
      variaciones:[], estado:"", dificultad:"", tipo:"", createdAt:nowISO()
    };
    if(obj.ale && obj.es) outP.push(obj);

    for(const esOne of esArr){
      const vid = uid(`voc||${esOne}||${(ale||"").toLowerCase()}`);
      outV.push({ id:vid, es: esOne, de:(ale||"").toLowerCase(), tema, etiquetas:[], createdAt: nowISO() });
    }
  }
  return { phrases: outP, vocab: outV };
}

// ==== Heurísticas (no usadas por PipeDict, se mantienen por compat) ====
const DET_SET = new Set(["ein","eine","einen","einem","einer","eines","der","die","das","den","dem","des","kein","keine","keinen","keinem","keiner","keines","mein","dein","sein","ihr","unser","euer","ihr","ihr".toLowerCase()]);
const PRON_SET = new Set(["ich","du","er","sie","es","wir","ihr","sie","mich","dich","ihn","uns","euch","ihnen","mir","dir","ihm","ihr"]);
const PREP_SET = new Set(["an","auf","aus","bei","mit","nach","seit","von","zu","über","unter","vor","hinter","neben","zwischen","durch","für","gegen","ohne","um","bis","entlang","trotz","während","wegen","ausser","außer","gegenüber","innerhalb","außerhalb"]);
const ADV_SET  = new Set(["heute","morgen","gestern","jetzt","gleich","hier","dort","da","sehr","gern","gerne","immer","nie","oft","bald","später"]);
const COURTESY_SET = new Set(["bitte","danke","entschuldigung","tschüss","hallo","servus","grüezi","grüß","gruss","gruess"]);
function guessTags(originalToken, lower){
  const tags = [];
  if(DET_SET.has(lower)) tags.push("determinante");
  if(PRON_SET.has(lower)) tags.push("pronombre");
  if(PREP_SET.has(lower)) tags.push("preposición");
  if(ADV_SET.has(lower))  tags.push("adverbio");
  if(ADV_SET.has(lower))  tags.push("adjetivo");
  if(COURTESY_SET.has(lower)) tags.push("cortesía");
  if(!tags.length && /[a-zäöüß\-]{3,}en$/.test(lower)) tags.push("verbo");
  if(!tags.length && /^[A-ZÄÖÜ]/.test(originalToken)) tags.push("sustantivo");
  if(!tags.length) tags.push("otro");
  return Array.from(new Set(tags));
}

// ==== Render tarjetas (Frases) ====
function updateTemaSelects(){
  ["#fTema","#rTema"].forEach(id=>{
    const sel=$(id); if(!sel) return;
    const cur=sel.value;
    sel.innerHTML=`<option value="">Tema</option>${state.temas.map(t=>`<option>${t}</option>`).join("")}`;
    if(cur) sel.value=cur;
  });
}
function renderCard(p){
  return `
    <div class="card-item" data-id="${p.id}">
      <div class="item-top">
        <div class="pill">${p.tema || "Sin tema"}</div>
      </div>
      <div class="ale">🇩🇪 ${p.ale}</div>
      <div class="meta">🔊 Pron (DE): ${p.pron || "—"}</div>
      <div class="meta">🇨🇭 ${p.ch || "—"}</div>
      <div class="meta">🔊 Pron (CH): ${p.pronCh || "—"}</div>
      <div class="meta">🇪🇸 ${p.es}</div>
      ${p.variaciones?.length ? 
        `<div class="tagrow">
           ${p.variaciones.map(v=>`<span class="tag">${v}</span>`).join("")}
         </div>` : ""
      }
      <div class="meta">
        Estado: ${p.estado||"nuevo"} · 
        Dificultad: ${p.dificultad||"—"} · 
        Tipo: ${p.tipo||"—"}
      </div>
      <div class="row2">
        <button class="ghost btn-edit">✎</button>
        <button class="ghost btn-del">🗑️</button>
      </div>
    </div>
  `;
}
function renderList(){
  const q=(normalize($("#q")?.value)).toLowerCase();
  const tema=$("#fTema")?.value, est=$("#fEstado")?.value, dif=$("#fDificultad")?.value, tipo=$("#fTipo")?.value;

  let arr = state.phrases.slice();
  if(q)   arr = arr.filter(p=>[p.ale,p.es,p.ch,p.pron,p.pronCh,(p.variaciones||[]).join(" ")].join(" ").toLowerCase().includes(q));
  if(tema)arr = arr.filter(p=>p.tema===tema);
  if(est) arr = arr.filter(p=>p.estado===est);
  if(dif) arr = arr.filter(p=>p.dificultad===dif);
  if(tipo)arr = arr.filter(p=>p.tipo===tipo);
  arr.sort((a,b)=> (a.ale||"").localeCompare(b.ale||"", "de", {sensitivity:"base"}));

  const list=$("#phraseList"); if(!list) return;
  list.innerHTML = arr.map(renderCard).join("");

  $$("#phraseList .card-item").forEach(item=>{
    const id=item.dataset.id; const p=state.phrases.find(x=>x.id===id);
    item.querySelector(".btn-del").addEventListener("click", (e)=>{ e.stopPropagation(); delPhrase(id); });
    item.querySelector(".btn-edit").addEventListener("click", (e)=>{ e.stopPropagation(); quickEdit(p); });
  });
}

// ==== Vocab: UI + modal ====
function ensureVocabDialog(){
  if($("#vocabDlg")) return $("#vocabDlg");
  const dlg = document.createElement("dialog");
  dlg.id = "vocabDlg";
  dlg.className = "settings";
  dlg.innerHTML = `
    <form method="dialog" style="padding:12px; min-width:280px">
      <h3 id="vocabTitle" style="margin:0 0 8px 0">Vocabulario</h3>
      <div class="row">
        <input id="vocabEs" placeholder="Español" />
        <input id="vocabDe" placeholder="Deutsch" />
      </div>
      <div class="row">
        <input id="vocabTema" placeholder="Tema" />
      </div>
      <div class="chiprow" style="gap:6px; margin:8px 0" id="vocabTagPicker">
        ${["sustantivo","verbo","determinante","pronombre","preposición","adverbio","adjetivo","cortesía","otro"].map(t=>`
          <button type="button" class="chip" data-tag="${t}">${t}</button>
        `).join("")}
      </div>
      <menu style="display:flex; gap:8px; justify-content:flex-end">
        <button id="vocabDelete" type="button" class="ghost">Eliminar</button>
        <button id="vocabSave"   type="button" class="primary">Guardar</button>
        <button value="cancel" class="ghost">Cerrar</button>
      </menu>
    </form>
  `;
  document.body.appendChild(dlg);
  return dlg;
}
function applyTagPicker(dlg, item){
  const container = $("#vocabTagPicker", dlg);
  container.querySelectorAll(".chip").forEach(btn=>{
    const tag = btn.dataset.tag;
    const active = (item.etiquetas||[]).includes(tag);
    btn.classList.toggle("active", active);
    btn.onclick = ()=>{
      const idx = (item.etiquetas||[]).indexOf(tag);
      if(idx>=0){ item.etiquetas.splice(idx,1); }
      else { (item.etiquetas ||= []).push(tag); }
      btn.classList.toggle("active");
    };
  });
}
async function openVocabModal(item){
  const dlg = ensureVocabDialog();
  $("#vocabTitle", dlg).textContent = item.id;
  $("#vocabEs", dlg).value   = item.es || "";
  $("#vocabDe", dlg).value   = item.de || "";
  $("#vocabTema", dlg).value = item.tema || "";
  item.etiquetas ||= [];
  applyTagPicker(dlg, item);
  dlg.showModal();

  $("#vocabSave", dlg).onclick = async ()=>{
    item.es   = normalize($("#vocabEs", dlg).value);
    item.de   = normalize($("#vocabDe", dlg).value);
    item.tema = normalize($("#vocabTema", dlg).value);
    await persistVocab(item);
    renderVocab();
    dlg.close();
  };
  $("#vocabDelete", dlg).onclick = async ()=>{
    await delVocab(item.id);
    renderVocab();
    dlg.close();
  };
}
function renderVocab(){
  const mode = state.vocabMode;
  const list = $("#vocabList"); if(!list) return;
  let data = state.vocab.slice();
  data.sort((a,b)=> (a.de||"").localeCompare(b.de||"", "de", {sensitivity:"base"}));
  list.innerHTML = data.map(v=>{
    const head = mode==="es" ? (v.es || v.de || "—") : (v.de || v.es || "—");
    const tail = mode==="es" ? (v.de || "(DE pendiente)") : (v.es || "(ES pendiente)");
    const tags = v.etiquetas?.length ? v.etiquetas : [];
    return `
      <div class="card-item vocab" data-id="${v.id}" tabindex="0">
        <div class="item-top">
          <div class="pill">${v.tema || "—"}</div>
          ${tags.length? `<div class="tagrow" style="margin-left:auto">${tags.map(t=>`<span class="tag">${t}</span>`).join("")}</div>`:""}
        </div>
        <div class="ale">${head}</div>
        <div class="meta detail">${tail}</div>
        <div class="row2">
          <button class="ghost btn-v-edit">✎</button>
          <button class="ghost btn-v-del">🗑️</button>
        </div>
      </div>
    `;
  }).join("");

  $$("#vocabList .card-item.vocab").forEach(el=>{
    const id = el.dataset.id;
    const item = state.vocab.find(v=>v.id===id);
    el.addEventListener("click", (e)=>{
      if(e.target.closest(".btn-v-edit") || e.target.closest(".btn-v-del")) return;
      openVocabModal(item);
    });
    el.addEventListener("keydown", (e)=>{ if(e.key==="Enter"||e.key===" ") { e.preventDefault(); openVocabModal(item);} });
    el.querySelector(".btn-v-edit").addEventListener("click", (e)=>{ e.stopPropagation(); openVocabModal(item); });
    el.querySelector(".btn-v-del").addEventListener("click", async (e)=>{ 
      e.stopPropagation();
      await delVocab(id);
      renderVocab();
    });
  });
}

// ==== RTDB sync ====
async function syncFromRTDB(){
  try{
    const [snapP, snapV, snapD] = await Promise.all([
      DB.ref(PHRASES_PATH).get(),
      DB.ref(VOCAB_PATH).get(),
      DB.ref(DICT_PATH).get()
    ]);

    const cloudP = Object.values(snapP.val()||{});
    const pmap = new Map(state.phrases.map(p=>[p.id,p]));
    for(const p of cloudP) pmap.set(p.id,p);
    state.phrases = Array.from(pmap.values());
    for(const p of state.phrases){ if(p.tema && !state.temas.includes(p.tema)) state.temas.push(p.tema); }
    sortPhrases();

    const cloudV = Object.values(snapV.val()||{});
    const vmap = new Map(state.vocab.map(v=>[v.id,v]));
    for(const v of cloudV) vmap.set(v.id,v);
    state.vocab = Array.from(vmap.values());
    sortVocab();

    state.dict = Object.assign({}, state.dict, (snapD.val()||{}));

    saveLocal(); updateTemaSelects(); renderList(); renderVocab();
  }catch(e){ console.warn("RTDB sync error", e); }
}

// ==== Persistencia ====
async function persistPhrase(p){
  const i=state.phrases.findIndex(x=>x.id===p.id);
  if(i>=0) state.phrases[i]=p; else state.phrases.push(p);
  sortPhrases();
  saveLocal();
  try{ await DB.ref(`${PHRASES_PATH}/${p.id}`).set(p); }catch(e){ console.error("RTDB set phrase", e); }
}
async function persistVocab(v){
  const i=state.vocab.findIndex(x=>x.id===v.id);
  if(i>=0) state.vocab[i]=v; else state.vocab.push(v);
  sortVocab();
  saveLocal();
  try{ await DB.ref(`${VOCAB_PATH}/${v.id}`).set(v); }catch(e){ console.error("RTDB set vocab", e); }
}
async function delPhrase(id){
  state.phrases=state.phrases.filter(x=>x.id!==id);
  saveLocal();
  try{ await DB.ref(`${PHRASES_PATH}/${id}`).remove(); }catch(e){ console.warn(e); }
  renderList();
}
async function delVocab(id){
  state.vocab = state.vocab.filter(x=>x.id!==id);
  saveLocal();
  try{ await DB.ref(`${VOCAB_PATH}/${id}`).remove(); }catch(e){ console.warn(e); }
}
function quickEdit(p){
  const ale=prompt("Alemán:", p.ale); if(ale===null) return;
  const pron=prompt("Pronunciación (DE):", p.pron||""); if(pron===null) return;
  const ch=prompt("Suizo (CH):", p.ch||""); if(ch===null) return;
  const pronCh=prompt("Pronunciación (CH):", p.pronCh||""); if(pronCh===null) return;
  const es=prompt("Español:", p.es); if(es===null) return;
  const tema=prompt("Tema:", p.tema||""); if(tema===null) return;
  const vari=prompt("Variaciones (sep. /):", (p.variaciones||[]).join(" / "));
  Object.assign(p,{
    ale,pron,pronCh,ch,es,tema,
    variaciones:(vari||"").split("/").map(s=>s.trim()).filter(Boolean)
  });
  persistPhrase(p); renderList();
}
function sortPhrases(){
  state.phrases.sort((a,b)=>
    (a.ale||"").localeCompare(b.ale||"", "de", {sensitivity:"base"})
  );
}
function sortVocab(){
  state.vocab.sort((a,b)=>
    (a.de||"").localeCompare(b.de||"", "de", {sensitivity:"base"})
  );
}

// ==== Exportaciones ====
function exportVocabSimple(arr, mode="es"){
  return arr
    .slice()
    .sort((a,b)=> mode==="es" ? (a.es||a.de||"").localeCompare(b.es||b.de||"") : (a.de||a.es||"").localeCompare(b.de||b.es||""))
    .map(v => mode==="es" ? `${(v.es||v.de||"—")} — ${(v.de||"(DE)")}` : `${(v.de||v.es||"—")} — ${(v.es||"(ES)")}`)
    .join("\n");
}
// PipeDict v1: a|s|pa|ps|e1,e2[,..]|t
function exportPipeDict(arr){
  const lines=[];
  for(const p of arr){
    const a  = dictEnsure(p.ale);
    const s  = dictEnsure(p.ch||"");
    const pa = dictEnsure(p.pron||"");
    const ps = dictEnsure(p.pronCh||"");
    const eIDs = (p.es||"").split("/").map(x=>x.trim()).filter(Boolean).map(dictEnsure);
    const t  = dictEnsure(p.tema||"");
    lines.push([a,s,pa,ps,eIDs.join(","),t].join("|"));
  }
  persistDict();
  return lines.join("\n");
}

// ==== UI / Import ====
function setupUI(){
  // Tabs
  $$(".tab, .tablink").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const tab=btn.dataset.tab;
      $$(".tab, .tablink").forEach(b=>b.classList.toggle("active", b.dataset.tab===tab));
      $$(".panel").forEach(p=>p.classList.toggle("active", p.id===`tab-${tab}`));
    });
  });

  // Ajustes (info Firebase)
  $("#btnSettings")?.addEventListener("click", ()=>{
    $("#fbInfo") && ($("#fbInfo").textContent = JSON.stringify({ projectId:firebase.app().options.projectId, db:"RTDB" }, null, 2));
    $("#settingsDlg")?.showModal();
  });

  // Importar (PipeDict v1)
  $("#btnImport")?.addEventListener("click", async ()=>{
    const txt = $("#importText")?.value || "";
    if(!txt.trim()) return;

    const { phrases, vocab } = parsePipeDict(txt);
    if(!phrases.length && !vocab.length) return;

    for(const it of phrases){ if(it.tema && !state.temas.includes(it.tema)) state.temas.push(it.tema); }
    saveLocal(); updateTemaSelects();

    const pmap=new Map(state.phrases.map(p=>[p.id,p]));
    for(const it of phrases) pmap.set(it.id,it);
    state.phrases = Array.from(pmap.values());
    sortPhrases();

    const vmap=new Map(state.vocab.map(v=>[v.id,v]));
    for(const v of vocab) vmap.set(v.id, Object.assign({etiquetas:[]}, v));
    state.vocab = Array.from(vmap.values());
    sortVocab();

    saveLocal(); renderList(); renderVocab();

    await persistDict();
    for(const it of phrases){ try{ await DB.ref(`${PHRASES_PATH}/${it.id}`).set(it); }catch(e){ console.error("Error frase", it, e); } }
    for(const v of vocab){ try{ await DB.ref(`${VOCAB_PATH}/${v.id}`).set(v); }catch(e){ console.error("Error vocab", v, e); } }

    if($("#importText")) $("#importText").value = "";
  });

  $("#btnClearInput")?.addEventListener("click", ()=> $("#importText") && ($("#importText").value=""));

  // Filtros de la lista
  ["#q","#fTema","#fEstado","#fDificultad","#fTipo"].forEach(id=>{
    const el=$(id); if(!el) return;
    el.addEventListener("input",renderList);
    el.addEventListener("change",renderList);
  });

 // Export PipeDict v1 (frases) → portapapeles
$("#btnExportPipeDict")?.addEventListener("click", ()=>{
  const txt = exportPipeDict(state.phrases);
  navigator.clipboard?.writeText(txt).catch(console.warn);
});

// === UTIL: copiar con fallback a descarga ===
async function copyTextOrDownload(filename, text){
  try{
    if(navigator.clipboard && window.isSecureContext){
      await navigator.clipboard.writeText(text);
      return true;
    }
  }catch{}
  const blob=new Blob([text],{type:"text/plain;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download=filename; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); },0);
  return false;
}

// === setupUI(): handlers correctos ===

// Export SIMPLE (vocab) → portapapeles o descarga
(() => {
  const btn = document.getElementById("btnExportSimple");
  if(!btn) return;
  btn.addEventListener("click", async ()=>{
    const mode = $("#vocabMode")?.value || "es";
    const txt  = exportVocabSimple(state.vocab, mode);
    await copyTextOrDownload(`vocab_${mode}.txt`, txt);
  });
})();

// Export PipeDict v1 (frases) → portapapeles o descarga
(() => {
  const btn = document.getElementById("btnExportPipeDict");
  if(!btn) return;
  btn.addEventListener("click", async ()=>{
    const txt = exportPipeDict(state.phrases);
    await copyTextOrDownload("phrases_pipe.txt", txt);
  });
})();
  // Vocab UI mode
  $("#vocabMode")?.addEventListener("change", (e)=>{
    state.vocabMode = e.target.value || "es";
    renderVocab();
  });
}

// ==== Bootstrap ====
function bootstrap(){
  loadLocal(); updateTemaSelects(); renderList(); renderVocab(); setupUI();
  syncFromRTDB();
}
document.addEventListener("DOMContentLoaded", bootstrap);