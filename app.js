// ==== Firebase (compat, no ESM) ====
(function(){
  const firebaseConfig = {
    apiKey: "AIzaSyCGcI9PFKZhnAN404yslQO2zurKOFLvoRw",
    authDomain: "idiomas-3f0a3.firebaseapp.com",
    databaseURL: "https://idiomas-3f0a3-default-rtdb.europe-west1.firebasedatabase.app", // RTDB
    projectId: "idiomas-3f0a3",
    storageBucket: "idiomas-3f0a3.appspot.com",
    messagingSenderId: "1080268564792",
    appId: "1:1080268564792:web:da0c2cef7a0bdc364d39cd"
  };
  firebase.initializeApp(firebaseConfig);
  window.DB = firebase.database();   // ← RTDB
  window.AUTH = firebase.auth?.();
})();
const PHRASES_PATH = "/deutsch_phrases"; // nodo en RTDB

// ==== Estado / utilidades ====
const LS_KEY = "deutsch.phrases.v1";
const LS_TEMAS = "deutsch.temas.v1";
const DEFAULT_TEMAS = ["Saludos","Transporte","Direcciones","Compras","Comida","Salud","Trabajo","Escape","Conversación","Emergencias"];
const $ = (s,c=document)=>c.querySelector(s);
const $$ = (s,c=document)=>Array.from(c.querySelectorAll(s));
const state = { phrases:[], temas:[], quizPool:[], quizIdx:0 };

const uid = (s="")=>{ const b=s.normalize("NFKD").toLowerCase(); let h=2166136261>>>0; for(let i=0;i<b.length;i++){ h^=b.charCodeAt(i); h=Math.imul(h,16777619)>>>0;} return "id_"+h.toString(36); };
const nowISO = ()=>new Date().toISOString();
const normalize = v=>(v||"").trim();
const saveLocal = ()=>{ localStorage.setItem(LS_KEY, JSON.stringify(state.phrases)); localStorage.setItem(LS_TEMAS, JSON.stringify(state.temas)); };
const loadLocal = ()=>{ try{ state.phrases=JSON.parse(localStorage.getItem(LS_KEY)||"[]"); state.temas=JSON.parse(localStorage.getItem(LS_TEMAS)||"[]"); if(!state.temas.length) state.temas=DEFAULT_TEMAS.slice(); }catch{ state.phrases=[]; state.temas=DEFAULT_TEMAS.slice(); } };

// ==== Parser DLF (con pronunciación suiza) ====
function parseDLF(text){
  const out=[]; const lines=(text||"").split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  for(const line of lines){
    const parts=line.split("|").map(p=>p.trim());
    const obj={ id:"", ale:"", ch:"", pron:"", pronCh:"", es:"", tema:"", variaciones:[], estado:"", dificultad:"", tipo:"", createdAt:nowISO() };
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
    }
    obj.id = uid(`${obj.ale}||${obj.es}||${obj.tema}`);
    if(obj.ale && obj.es) out.push(obj);
  }
  return out;
}

// ==== UI ====
function updateTemaSelects(){
  // Solo actualiza selects de filtros si existen (no hay selects en importar)
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
    item.querySelector(".btn-del").addEventListener("click", ()=>{ delPhrase(id); });
    item.querySelector(".btn-edit").addEventListener("click", ()=>{ quickEdit(p); });
  });
}

// ==== Realtime Database (RTDB) ====
async function syncFromRTDB(){
  try{
    const snap = await DB.ref(PHRASES_PATH).get();
    const cloudObj = snap.val() || {};
    const cloud = Object.values(cloudObj);
    const map = new Map(state.phrases.map(p=>[p.id,p]));
    for(const p of cloud) map.set(p.id,p);
    state.phrases = Array.from(map.values());
    for(const p of state.phrases){ if(p.tema && !state.temas.includes(p.tema)) state.temas.push(p.tema); }
    saveLocal(); updateTemaSelects(); renderList();
  }catch(e){ console.warn("RTDB sync error", e); }
}
async function persist(p){
  const i=state.phrases.findIndex(x=>x.id===p.id);
  if(i>=0) state.phrases[i]=p; else state.phrases.push(p);
  saveLocal();
  try{
    await DB.ref(`${PHRASES_PATH}/${p.id}`).set(p);
  }catch(e){
    console.error("RTDB set", e);
    alert("No se pudo guardar en Firebase RTDB: " + (e.code || e.message || e));
  }
}
async function delPhrase(id){
  state.phrases=state.phrases.filter(x=>x.id!==id);
  saveLocal();
  try{ await DB.ref(`${PHRASES_PATH}/${id}`).remove(); }catch(e){ console.warn(e); }
  renderList();
}

// ==== Quick edit ====
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
  persist(p); renderList();
}

// ==== UI / Import (sin previsualización, sin selects de defaults) ====
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

  // Importar directo (guardar y limpiar textarea; sin alertas de éxito)
  $("#btnImport")?.addEventListener("click", async ()=>{
    const txt = $("#importText")?.value || "";
    const parsed = parseDLF(txt);
    if(!parsed.length) return;

    // añadir temas nuevos
    for(const it of parsed){ if(it.tema && !state.temas.includes(it.tema)) state.temas.push(it.tema); }
    saveLocal(); updateTemaSelects();

    // merge local
    const map=new Map(state.phrases.map(p=>[p.id,p]));
    for(const it of parsed) map.set(it.id,it);
    state.phrases = Array.from(map.values());
    saveLocal(); renderList();

    // subir a RTDB (secuencial simple)
    for(const it of parsed){
      try{ await DB.ref(`${PHRASES_PATH}/${it.id}`).set(it); }
      catch(e){ console.error("Error guardando", it, e); alert("Error guardando: "+(it.ale||it.es)+"\n"+(e.code||e.message||e)); }
    }

    // limpiar textarea SIN avisos
    if($("#importText")) $("#importText").value = "";
  });

  $("#btnClearInput")?.addEventListener("click", ()=> $("#importText") && ($("#importText").value=""));

  // Filtros de la lista (se mantienen)
  ["#q","#fTema","#fEstado","#fDificultad","#fTipo"].forEach(id=>{
    const el=$(id); if(!el) return;
    el.addEventListener("input",renderList);
    el.addEventListener("change",renderList);
  });
}

// ==== Bootstrap ====
function bootstrap(){
  loadLocal(); updateTemaSelects(); renderList(); setupUI();
  // Si tus reglas requieren auth, descomenta:
  // AUTH?.onAuthStateChanged(u=>{ if(!u) AUTH.signInAnonymously().catch(console.error); });
  syncFromRTDB();
}
document.addEventListener("DOMContentLoaded", bootstrap);
