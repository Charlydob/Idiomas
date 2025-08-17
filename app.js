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

// ==== Estado / utilidades ====
const LS_KEY   = "deutsch.phrases.v1";
const LS_TEMAS = "deutsch.temas.v1";
const LS_VOCAB = "deutsch.vocab.v1";
const DEFAULT_TEMAS = ["Saludos","Transporte","Direcciones","Compras","Comida","Salud","Trabajo","Escape","Conversación","Emergencias"];
const $  = (s,c=document)=>c.querySelector(s);
const $$ = (s,c=document)=>Array.from(c.querySelectorAll(s));
const state = { phrases:[], temas:[], vocab:[], quizPool:[], quizIdx:0, vocabMode:"es" };

const uid = (s="")=>{ const b=s.normalize("NFKD").toLowerCase(); let h=2166136261>>>0; for(let i=0;i<b.length;i++){ h^=b.charCodeAt(i); h=Math.imul(h,16777619)>>>0;} return "id_"+h.toString(36); };
const nowISO = ()=>new Date().toISOString();
const normalize = v=>(v||"").trim();
const saveLocal = ()=>{ localStorage.setItem(LS_KEY, JSON.stringify(state.phrases)); localStorage.setItem(LS_TEMAS, JSON.stringify(state.temas)); localStorage.setItem(LS_VOCAB, JSON.stringify(state.vocab)); };
const loadLocal = ()=>{ try{
  state.phrases=JSON.parse(localStorage.getItem(LS_KEY)||"[]");
  state.temas=JSON.parse(localStorage.getItem(LS_TEMAS)||"[]");
  state.vocab=JSON.parse(localStorage.getItem(LS_VOCAB)||"[]");
  if(!state.temas.length) state.temas=DEFAULT_TEMAS.slice();
}catch{ state.phrases=[]; state.temas=DEFAULT_TEMAS.slice(); state.vocab=[]; } };

// ==== Parser DLF (con pronunciación suiza y vocabulario manual) ====
// [VOC] pares "es:de" separados por "/":  [VOC] agua:Wasser / pan:Brot
function parseDLF(text){
  const out=[]; const vocabPairs=[];
  const lines=(text||"").split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  for(const line of lines){
    const parts=line.split("|").map(p=>p.trim());
    const obj={ id:"", ale:"", ch:"", pron:"", pronCh:"", es:"", tema:"", variaciones:[], estado:"", dificultad:"", tipo:"", createdAt:nowISO() };
    let vocStr = "";
    for(const p of parts){
      const m=p.match(/^\[(\w+(?:-\w+)?)\]\s*(.*)$/i); if(!m) continue;
      const key=m[1].toUpperCase(); const val=m[2].trim();
      if(key==="ALE") obj.ale=val;
      else if(key==="CH"||key==="SUIZO"||key==="SWISS") obj.ch=val;
      else if(key==="PRON") obj.pron=val;
      else if(key==="PRON-CH"||key==="PRON_CH"||key==="PRONSUIZO") obj.pronCh=val;
      else if(key==="ES"||key==="ESP"||key==="ESPAÑOL") obj.es=val;
      else if(key==="TEMA"||key==="TOPIC") obj.tema=val;
      else if(key==="VAR"||key==="VARIACIONES") obj.variaciones=val.split("/").map(s=>s.trim()).filter(Boolean);
      else if(key==="ESTADO") obj.estado=val.toLowerCase();
      else if(key==="DIFIC"||key==="DIFICULTAD") obj.dificultad=val.toLowerCase();
      else if(key==="TIPO") obj.tipo=val.toLowerCase();
      else if(key==="VOC") vocStr = val;
    }
    obj.id = uid(`${obj.ale}||${obj.es}||${obj.tema}`);
    if(obj.ale && obj.es) out.push(obj);

    if(vocStr){
      const pairs = vocStr.split("/").map(s=>s.trim()).filter(Boolean);
      for(const pair of pairs){
        const m = pair.match(/^(.+?):(.+)$/); // es:de
        if(!m) continue;
        const es = m[1].trim(); const de = m[2].trim();
        const vid = uid(`voc||${es}||${de}`);
        vocabPairs.push({ id:vid, es, de:de.toLowerCase(), tema: obj.tema || "", etiquetas: [], createdAt: nowISO() });
      }
    }
  }
  return { phrases: out, vocab: vocabPairs };
}

// === Heurísticas etiquetas (solo VOCAB) + auto-vocab desde frases ===
const DET_SET = new Set(["ein","eine","einen","einem","einer","eines","der","die","das","den","dem","des","kein","keine","keinen","keinem","keiner","keines","mein","dein","sein","ihr","unser","euer","ihr","ihr".toLowerCase()]);
const PRON_SET = new Set(["ich","du","er","sie","es","wir","ihr","sie","mich","dich","ihn","uns","euch","ihnen","mir","dir","ihm","ihr"]);
const PREP_SET = new Set(["an","auf","aus","bei","mit","nach","seit","von","zu","über","unter","vor","hinter","neben","zwischen","durch","für","gegen","ohne","um","bis","entlang","trotz","während","wegen","ausser","außer","gegenüber","innerhalb","außerhalb"]);
const ADV_SET  = new Set(["heute","morgen","gestern","jetzt","gleich","hier","dort","da","sehr","gern","gerne","immer","nie","oft","bald","später"]);
const COURTESY_SET = new Set(["bitte","danke","entschuldigung","tschüss","hallo","servus","grüezi","grüß","gruss","gruess"]);
const BASE_ES_MAP = {
  // determinantes / cortesía / conectores frecuentes
  "ein":"un", "eine":"una", "einen":"un", "einem":"a un", "einer":"a una",
  "der":"el", "die":"la", "das":"el", "den":"el", "dem":"al", "des":"del",
  "kein":"ningún", "keine":"ninguna",
  "bitte":"por favor",
  "und":"y", "oder":"o", "aber":"pero", "danke":"gracias", "hallo":"hola", "tschüss":"adiós",
};
function guessTags(originalToken, lower){
  const tags = [];
  if(DET_SET.has(lower)) tags.push("determinante");
  if(PRON_SET.has(lower)) tags.push("pronombre");
  if(PREP_SET.has(lower)) tags.push("preposición");
  if(ADV_SET.has(lower))  tags.push("adverbio");
    if(ADV_SET.has(lower))  tags.push("adjetivo");

  if(COURTESY_SET.has(lower)) tags.push("cortesía");
  if(!tags.length && /[a-zäöüß\-]{3,}en$/.test(lower)) tags.push("verbo"); // infinitivo aprox
  if(!tags.length && /^[A-ZÄÖÜ]/.test(originalToken)) tags.push("sustantivo"); // heurística
  if(!tags.length) tags.push("otro");
  return Array.from(new Set(tags));
}
function extractVocabFromPhrases(phrases){
  const created = nowISO();
  const existing = new Set(state.vocab.map(v=> (v.de||"").toLowerCase()));
  const out = [];
  for(const p of phrases){
    const tema = p.tema || "";
    const aleOriginal = (p.ale || "");
    const words = aleOriginal
      .replace(/[.,;:!?(){}\[\]"“”‘’´`…]/g, " ")
      .split(/\s+/)
      .map(w => w.trim())
      .filter(Boolean)
      .filter(w => /^[A-Za-zÄÖÜäöüß\-]{2,}$/.test(w)); // no 1 letra, no números
    for(const token of words){
      const deLower = token.toLowerCase();
      if(existing.has(deLower)) continue;
      existing.add(deLower);
      out.push({
        id: uid(`voc||${deLower}`),
        es: "",                      // se intenta rellenar automáticamente después
        de: deLower,
        tema,
        etiquetas: guessTags(token, deLower),
        createdAt: created
      });
    }
  }
  return out;
}

// === Autorrelleno ES de vocab a partir de frases ===
// 1) usa [VOC] manual si existe (ya viene con ES)
// 2) si no hay ES: intenta diccionario BASE_ES_MAP
// 3) si sigue vacío: busca tokens del ES de la frase que coincidan por reglas simples (muy básico)
function fillVocabEsFromPhrases(phrases, vocabList){
  // índice rápido por tema para limitar búsqueda
  const byTema = new Map();
  for(const p of phrases){
    const key = p.tema || "_";
    if(!byTema.has(key)) byTema.set(key, []);
    byTema.get(key).push(p);
  }
  for(const v of vocabList){
    if(v.es) continue; // ya tiene ES (por [VOC] o edición)
    // diccionario base
    if(BASE_ES_MAP[v.de]){ v.es = BASE_ES_MAP[v.de]; continue; }

    // buscar dentro de frases del mismo tema (si no, en todas)
    const candidates = (byTema.get(v.tema||"_") || []).concat(byTema.get("_")||[], ...byTema.values());
    let guessed = "";
    for(const p of candidates){
      if(!p.es) continue;
      const esSent = p.es.toLowerCase();
      // reglas super simples: cortesía
      if(v.de==="bitte" && esSent.includes("por favor")) { guessed="por favor"; break; }
      if(v.de==="danke" && esSent.includes("gracias")) { guessed="gracias"; break; }
      // artículos
      if(v.de==="ein"  && /\bun\b/.test(esSent)) { guessed="un"; break; }
      if(v.de==="eine" && /\buna\b/.test(esSent)) { guessed="una"; break; }
      // si el token alemán es capitalizado y el ES tiene una palabra similar (primer char igual y >3), aprox:
      if(v.de.length>=4){
        const wordsES = esSent.split(/\s+/);
        const cand = wordsES.find(w=> w[0]===v.de[0] && Math.abs(w.length - v.de.length)<=2 );
        if(cand){ guessed = cand; break; }
      }
    }
    v.es = guessed || ""; // si no encuentra, queda vacío
  }
  return vocabList;
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
  let arr=state.phrases.slice().sort((a,b)=>(a.tema||"").localeCompare(b.tema||"")||(a.ale||"").localeCompare(b.ale||""));
  if(q) arr=arr.filter(p=>[p.ale,p.es,p.ch,p.pron,p.pronCh,(p.variaciones||[]).join(" ")].join(" ").toLowerCase().includes(q));
  if(tema) arr=arr.filter(p=>p.tema===tema);
  if(est) arr=arr.filter(p=>p.estado===est);
  if(dif) arr=arr.filter(p=>p.dificultad===dif);
  if(tipo) arr=arr.filter(p=>p.tipo===tipo);

  const list=$("#phraseList"); if(!list) return;
  list.innerHTML = arr.map(renderCard).join("");

  $$("#phraseList .card-item").forEach(item=>{
    const id=item.dataset.id; const p=state.phrases.find(x=>x.id===id);
    item.querySelector(".btn-del").addEventListener("click", (e)=>{ e.stopPropagation(); delPhrase(id); }); // sin confirmación
    item.querySelector(".btn-edit").addEventListener("click", (e)=>{ e.stopPropagation(); quickEdit(p); });
  });
}

// ==== Vocab: UI + modal detalle + editar/borrar (sin confirm) ====
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
        ${["sustantivo","verbo","determinante","pronombre","preposición","adverbio", "adjetivo","cortesía","otro"].map(t=>`
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
    await delVocab(item.id);  // sin confirmación
    renderVocab();
    dlg.close();
  };
}
function renderVocab(){
  const mode = state.vocabMode; // "es" o "de"
  const list = $("#vocabList"); if(!list) return;
  const data = state.vocab.slice().sort((a,b)=>{
    const ta = (a.tema||"").localeCompare(b.tema||"");
    if(ta!==0) return ta;
    return (mode==="es" ? (a.es||a.de||"").localeCompare(b.es||b.de||"") : (a.de||a.es||"").localeCompare(b.de||b.es||""));
  });
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
      await delVocab(id);   // sin confirmación
      renderVocab();
    });
  });
}

// ==== RTDB sync ====
async function syncFromRTDB(){
  try{
    const snapP = await DB.ref(PHRASES_PATH).get();
    const cloudP = Object.values(snapP.val()||{});
    const map = new Map(state.phrases.map(p=>[p.id,p]));
    for(const p of cloudP) map.set(p.id,p);
    state.phrases = Array.from(map.values());
    for(const p of state.phrases){ if(p.tema && !state.temas.includes(p.tema)) state.temas.push(p.tema); }

    const snapV = await DB.ref(VOCAB_PATH).get();
    const cloudV = Object.values(snapV.val()||{});
    const vmap = new Map(state.vocab.map(v=>[v.id,v]));
    for(const v of cloudV) vmap.set(v.id,v);
    state.vocab = Array.from(vmap.values());

    saveLocal(); updateTemaSelects(); renderList(); renderVocab();
  }catch(e){ console.warn("RTDB sync error", e); }
}

// ==== Persistencia ====
async function persistPhrase(p){
  const i=state.phrases.findIndex(x=>x.id===p.id);
  if(i>=0) state.phrases[i]=p; else state.phrases.push(p);
  saveLocal();
  try{ await DB.ref(`${PHRASES_PATH}/${p.id}`).set(p); }catch(e){ console.error("RTDB set phrase", e); }
}
async function persistVocab(v){
  const i=state.vocab.findIndex(x=>x.id===v.id);
  if(i>=0) state.vocab[i]=v; else state.vocab.push(v);
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

// ==== Exportaciones ====
function exportDLF(arr){
  return arr.map(p=>{
    const parts = [];
    parts.push(`[ALE] ${p.ale}`);
    if(p.ch) parts.push(`[CH] ${p.ch}`);
    if(p.pron) parts.push(`[PRON] ${p.pron}`);
    if(p.pronCh) parts.push(`[PRON-CH] ${p.pronCh}`);
    parts.push(`[ES] ${p.es}`);
    if(p.tema) parts.push(`[TEMA] ${p.tema}`);
    if(p.variaciones?.length) parts.push(`[VAR] ${p.variaciones.join(" / ")}`);
    if(p.estado) parts.push(`[ESTADO] ${p.estado}`);
    if(p.dificultad) parts.push(`[DIFIC] ${p.dificultad}`);
    if(p.tipo) parts.push(`[TIPO] ${p.tipo}`);
    return parts.join(" | ");
  }).join("\n");
}
function exportVocabSimple(arr, mode="es"){
  return arr
    .slice()
    .sort((a,b)=> mode==="es" ? (a.es||a.de||"").localeCompare(b.es||b.de||"") : (a.de||a.es||"").localeCompare(b.de||b.es||""))
    .map(v => mode==="es" ? `${(v.es||v.de||"—")} — ${(v.de||"(DE)")}` : `${(v.de||v.es||"—")} — ${(v.es||"(ES)")}`)
    .join("\n");
}

// ==== UI / Import (directo) ====
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

  // Importar directo (frases + vocab manual + auto-vocab + autotraducción ES)
  $("#btnImport")?.addEventListener("click", async ()=>{
    const txt = $("#importText")?.value || "";
    const { phrases, vocab } = parseDLF(txt);
    if(!phrases.length && !vocab.length) return;

    const autoVocab = extractVocabFromPhrases(phrases);
    fillVocabEsFromPhrases(phrases, autoVocab); // autocompleta ES cuando sea posible

    // Temas nuevos
    for(const it of phrases){ if(it.tema && !state.temas.includes(it.tema)) state.temas.push(it.tema); }
    saveLocal(); updateTemaSelects();

    // Merge frases (local)
    const pmap=new Map(state.phrases.map(p=>[p.id,p]));
    for(const it of phrases) pmap.set(it.id,it);
    state.phrases = Array.from(pmap.values());

    // Merge vocab (local) manual + auto
    const vmap=new Map(state.vocab.map(v=>[v.id,v]));
    for(const v of [...vocab, ...autoVocab]) vmap.set(v.id, Object.assign({etiquetas:[]}, v));
    state.vocab = Array.from(vmap.values());

    saveLocal(); renderList(); renderVocab();

    // Subir a RTDB
    for(const it of phrases){ try{ await DB.ref(`${PHRASES_PATH}/${it.id}`).set(it); }catch(e){ console.error("Error frase", it, e); } }
    for(const v of [...vocab, ...autoVocab]){ try{ await DB.ref(`${VOCAB_PATH}/${v.id}`).set(v); }catch(e){ console.error("Error vocab", v, e); } }

    if($("#importText")) $("#importText").value = ""; // limpiar sin alertas
  });

  $("#btnClearInput")?.addEventListener("click", ()=> $("#importText") && ($("#importText").value=""));

  // Filtros de la lista
  ["#q","#fTema","#fEstado","#fDificultad","#fTipo"].forEach(id=>{
    const el=$(id); if(!el) return;
    el.addEventListener("input",renderList);
    el.addEventListener("change",renderList);
  });

  // Export simple DLF → portapapeles
  $("#btnExportSimpleDLF")?.addEventListener("click", ()=>{
    const txt = exportDLF(state.phrases);
    navigator.clipboard?.writeText(txt).catch(console.warn);
  });

  // Vocab UI
  $("#vocabMode")?.addEventListener("change", (e)=>{
    state.vocabMode = e.target.value || "es";
    renderVocab();
  });
  $("#btnExportVocab")?.addEventListener("click", ()=>{
    const mode = $("#vocabMode")?.value || "es";
    const txt = exportVocabSimple(state.vocab, mode);
    navigator.clipboard?.writeText(txt).catch(console.warn);
  });
}

// ==== Bootstrap ====
function bootstrap(){
  loadLocal(); updateTemaSelects(); renderList(); renderVocab(); setupUI();
  syncFromRTDB();
}
document.addEventListener("DOMContentLoaded", bootstrap);
