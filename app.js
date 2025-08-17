// app.js (ESM + Firebase v10 modular, Firestore + Storage)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore, collection, getDocs, setDoc, deleteDoc, doc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

// === Firebase fijo (proyecto: idiomas-3f0a3) ===
const firebaseConfig = {
  apiKey: "AIzaSyCGcI9PFKZhnAN404yslQO2zurKOFLvoRw",
  authDomain: "idiomas-3f0a3.firebaseapp.com",
  projectId: "idiomas-3f0a3",
  storageBucket: "idiomas-3f0a3.firebasestorage.app",
  messagingSenderId: "1080268564792",
  appId: "1:1080268564792:web:da0c2cef7a0bdc364d39cd"
};
const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);
const storage = getStorage(fbApp);

// === Local state ===
const LS_KEY = "deutsch.phrases.v1";
const LS_TEMAS = "deutsch.temas.v1";
const DEFAULT_TEMAS = ["Saludos","Transporte","Direcciones","Compras","Comida","Salud","Trabajo","Escape","Conversación","Emergencias"];

const $ = (sel, ctx=document)=>ctx.querySelector(sel);
const $$= (sel, ctx=document)=>Array.from(ctx.querySelectorAll(sel));

const state = {
  phrases: [],   // {id, ale, ch, pron, es, tema, variaciones[], estado, dificultad, tipo, createdAt, audioUrl?}
  temas: [],
  quizPool: [],
  quizIdx: 0
};

// === Helpers ===
const uid = (s="")=>{
  const base = s.normalize("NFKD").toLowerCase();
  let h = 2166136261 >>> 0;
  for (let i=0;i<base.length;i++){ h ^= base.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return "id_"+h.toString(36);
};
const nowISO = ()=> new Date().toISOString();
const saveLocal = ()=>{
  localStorage.setItem(LS_KEY, JSON.stringify(state.phrases));
  localStorage.setItem(LS_TEMAS, JSON.stringify(state.temas));
};
const loadLocal = ()=>{
  try{
    state.phrases = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    state.temas = JSON.parse(localStorage.getItem(LS_TEMAS) || "[]");
    if(!state.temas.length) state.temas = DEFAULT_TEMAS.slice();
  }catch(e){ state.phrases = []; state.temas = DEFAULT_TEMAS.slice(); }
};
const toast = (m)=>{ try{navigator.vibrate?.(10);}catch{} alert(m); };
const normalize = (v)=> (v||"").trim();

// === DLF Parser ===
function parseDLF(text, defaults={}){
  const out = [];
  const lines = (text||"").split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  for(const line of lines){
    const parts = line.split("|").map(p=>p.trim());
    const obj = { ale:"", ch:"", pron:"", es:"", tema:"", variaciones:[], estado:"", dificultad:"", tipo:"", createdAt: nowISO() };
    for(const p of parts){
      const m = p.match(/^\[(\w+)\]\s*(.*)$/i);
      if(!m) continue;
      const key = m[1].toUpperCase();
      const val = m[2].trim();
      if(key==="ALE") obj.ale = val;
      else if(key==="CH"||key==="SUIZO"||key==="SWISS") obj.ch = val;
      else if(key==="PRON") obj.pron = val;
      else if(key==="ES"||key==="ESP"||key==="ESPAÑOL") obj.es = val;
      else if(key==="TEMA"||key==="TOPIC") obj.tema = val;
      else if(key==="VAR"||key==="VARIACIONES") obj.variaciones = val.split("/").map(s=>s.trim()).filter(Boolean);
      else if(key==="ESTADO") obj.estado = val.toLowerCase();
      else if(key==="DIFIC"||key==="DIFICULTAD") obj.dificultad = val.toLowerCase();
      else if(key==="TIPO") obj.tipo = val.toLowerCase();
    }
    if(!obj.tema && defaults.tema) obj.tema = defaults.tema;
    if(!obj.estado && defaults.estado) obj.estado = defaults.estado;
    if(!obj.dificultad && defaults.dificultad) obj.dificultad = defaults.dificultad;
    const keyStr = `${obj.ale}||${obj.es}||${obj.tema}`;
    obj.id = uid(keyStr);
    if(obj.ale && obj.es) out.push(obj);
  }
  return out;
}

// === Render helpers ===
function updateTemaSelects(){
  const selects = ["#defaultTema","#fTema","#rTema"].map(id=>$(id));
  for(const sel of selects){
    const current = sel.value;
    sel.innerHTML = `<option value="">Tema</option>${state.temas.map(t=>`<option>${t}</option>`).join("")}`;
    if(current) sel.value = current;
  }
}
function renderPreview(list){
  const wrap = $("#preview");
  wrap.innerHTML = "";
  if(!list.length){ wrap.innerHTML = `<div class="hint">Nada que mostrar.</div>`; return; }
  for(const it of list){
    const el = document.createElement("div");
    el.className = "card-item";
    el.innerHTML = `
      <div class="item-top">
        <div class="ale">${it.ale}</div>
        <div class="pill">${it.tema || "Sin tema"}</div>
      </div>
      <div class="meta">🇪🇸 ${it.es}</div>
      <div class="meta">🇨🇭 ${it.ch || "—"} · 🔊 ${it.pron || "—"}</div>
      ${it.variaciones?.length? `<div class="tagrow">${it.variaciones.map(v=>`<span class="tag">${v}</span>`).join("")}</div>`:""}
      <div class="meta">Estado: ${it.estado||"nuevo"} · Dificultad: ${it.dificultad||"—"} · Tipo: ${it.tipo||"—"}</div>
    `;
    wrap.appendChild(el);
  }
}
function renderList(){
  const q = normalize($("#q").value).toLowerCase();
  const tema = $("#fTema").value;
  const est = $("#fEstado").value;
  const dif = $("#fDificultad").value;
  const tipo = $("#fTipo").value;

  let arr = state.phrases.slice().sort((a,b)=> (a.tema||"").localeCompare(b.tema||"") || (a.ale||"").localeCompare(b.ale||""));

  if(q){
    arr = arr.filter(p =>
      [p.ale,p.es,p.ch,p.pron,(p.variaciones||[]).join(" ")].join(" ").toLowerCase().includes(q)
    );
  }
  if(tema) arr = arr.filter(p=>p.tema===tema);
  if(est) arr = arr.filter(p=>p.estado===est);
  if(dif) arr = arr.filter(p=>p.dificultad===dif);
  if(tipo) arr = arr.filter(p=>p.tipo===tipo);

  const list = $("#phraseList");
  list.innerHTML = arr.map(p=>`
    <div class="card-item" data-id="${p.id}">
      <div class="item-top">
        <div class="ale">${p.ale}</div>
        <div class="pill">${p.tema || "Sin tema"}</div>
      </div>
      <div class="meta">🇪🇸 ${p.es}</div>
      <div class="meta">🇨🇭 ${p.ch || "—"} · 🔊 ${p.pron || "—"}</div>
      ${(p.variaciones?.length? `<div class="tagrow">${p.variaciones.map(v=>`<span class="tag">${v}</span>`).join("")}</div>`:"")}
      <div class="row2">
        <select class="sel-estado">
          ${["nuevo","practicada","repasada","difícil"].map(x=>`<option ${p.estado===x?"selected":""}>${x}</option>`).join("")}
        </select>
        <select class="sel-dif">
          ${["","fácil","normal","difícil","útil"].map(x=>`<option ${p.dificultad===x?"selected":""}>${x}</option>`).join("")}
        </select>
        <select class="sel-tipo">
          ${["","afirmación","pregunta","negación"].map(x=>`<option ${p.tipo===x?"selected":""}>${x}</option>`).join("")}
        </select>
        <button class="ghost btn-edit">✎</button>
        <button class="ghost btn-audio">🎙️</button>
        <button class="ghost btn-del">🗑️</button>
      </div>
    </div>
  `).join("");

  $$("#phraseList .card-item").forEach(item=>{
    const id = item.dataset.id;
    const p = state.phrases.find(x=>x.id===id);
    item.querySelector(".sel-estado").addEventListener("change", (e)=>{ p.estado = e.target.value; persist(p); });
    item.querySelector(".sel-dif").addEventListener("change", (e)=>{ p.dificultad = e.target.value; persist(p); });
    item.querySelector(".sel-tipo").addEventListener("change", (e)=>{ p.tipo = e.target.value; persist(p); });
    item.querySelector(".btn-del").addEventListener("click", ()=>{ delPhrase(id); });
    item.querySelector(".btn-edit").addEventListener("click", ()=>{ quickEdit(p); });
    item.querySelector(".btn-audio").addEventListener("click", ()=>{ recordAudioFor(p); });
  });
}

// === Firestore sync ===
const PHRASES_COL = "deutsch_phrases";

async function syncFromFirestore(){
  try{
    const snap = await getDocs(collection(db, PHRASES_COL));
    const cloud = snap.docs.map(d=>d.data());
    const map = new Map();
    for(const p of state.phrases) map.set(p.id, p);
    for(const p of cloud) map.set(p.id, p); // cloud gana
    state.phrases = Array.from(map.values());
    // temas desde datos
    for(const p of state.phrases){
      if(p.tema && !state.temas.includes(p.tema)) state.temas.push(p.tema);
    }
    saveLocal();
    renderList();
  }catch(e){
    console.warn("Firestore sync error", e);
  }
}

async function persist(p){
  const i = state.phrases.findIndex(x=>x.id===p.id);
  if(i>=0) state.phrases[i] = p; else state.phrases.push(p);
  saveLocal();
  try{
    await setDoc(doc(db, PHRASES_COL, p.id), p);
  }catch(e){ console.warn("FS setDoc", e); }
}

async function delPhrase(id){
  state.phrases = state.phrases.filter(x=>x.id!==id);
  saveLocal();
  try{
    await deleteDoc(doc(db, PHRASES_COL, id));
  }catch(e){ console.warn("FS delete", e); }
  renderList();
}

// === Export ===
function exportDLF(arr){
  const lines = arr.map(p=>{
    const parts = [];
    parts.push(`[ALE] ${p.ale}`);
    if(p.ch) parts.push(`[CH] ${p.ch}`);
    if(p.pron) parts.push(`[PRON] ${p.pron}`);
    parts.push(`[ES] ${p.es}`);
    if(p.tema) parts.push(`[TEMA] ${p.tema}`);
    if(p.variaciones?.length) parts.push(`[VAR] ${p.variaciones.join(" / ")}`);
    if(p.estado) parts.push(`[ESTADO] ${p.estado}`);
    if(p.dificultad) parts.push(`[DIFIC] ${p.dificultad}`);
    if(p.tipo) parts.push(`[TIPO] ${p.tipo}`);
    return parts.join(" | ");
  });
  return lines.join("\n");
}

// === Quick Edit ===
function quickEdit(p){
  const ale = prompt("Alemán:", p.ale); if(ale===null) return;
  const es  = prompt("Español:", p.es); if(es===null) return;
  const ch  = prompt("Suizo:", p.ch||""); if(ch===null) return;
  const pron= prompt("Pronunciación:", p.pron||""); if(pron===null) return;
  const tema= prompt("Tema:", p.tema||""); if(tema===null) return;
  const vari= prompt("Variaciones (sep. /):", (p.variaciones||[]).join(" / "));
  Object.assign(p, {ale, es, ch, pron, tema, variaciones: (vari||"").split("/").map(s=>s.trim()).filter(Boolean)});
  persist(p); renderList();
}

// === Audio opcional (Storage) ===
async function recordAudioFor(p){
  if(!navigator.mediaDevices?.getUserMedia){ toast("Tu navegador no permite grabar audio."); return; }
  try{
    const stream = await navigator.mediaDevices.getUserMedia({audio:true});
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = e=> chunks.push(e.data);
    rec.onstop = async ()=>{
      const blob = new Blob(chunks, {type:"audio/webm"});
      const url = URL.createObjectURL(blob);
      const save = confirm("Grabación lista. ¿Subir a Firebase Storage o descargar?\nAceptar = subir; Cancelar = descargar.");
      if(save){
        const path = `audio/${p.id}_${Date.now()}.webm`;
        const sref = storageRef(storage, path);
        await uploadBytes(sref, blob);
        const dl = await getDownloadURL(sref);
        p.audioUrl = dl; await persist(p); renderList();
        toast("Audio subido.");
      }else{
        const a = document.createElement("a");
        a.href = url; a.download = `deutsch_${p.id}.webm`; a.click();
      }
      stream.getTracks().forEach(t=>t.stop());
    };
    rec.start();
    toast("Grabando… se detiene automáticamente en 6s.");
    setTimeout(()=>{ if(rec.state!=="inactive") rec.stop(); }, 6000);
  }catch(e){ console.warn(e); toast("No se pudo grabar audio."); }
}

// === UI / filtros / import ===
function updateTemaSelects(){
  const selects = ["#defaultTema","#fTema","#rTema"].map(id=>$(id));
  for(const sel of selects){
    const current = sel.value;
    sel.innerHTML = `<option value="">Tema</option>${state.temas.map(t=>`<option>${t}</option>`).join("")}`;
    if(current) sel.value = current;
  }
}
function setupUI(){
  $$(".tab, .tablink").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const tab = btn.dataset.tab;
      $$(".tab, .tablink").forEach(b=>b.classList.toggle("active", b.dataset.tab===tab));
      $$(".panel").forEach(p=>p.classList.toggle("active", p.id===`tab-${tab}`));
    });
  });

  $("#btnSettings").addEventListener("click", ()=>{
    $("#fbInfo").textContent = JSON.stringify({
      projectId: firebaseConfig.projectId,
      storageBucket: firebaseConfig.storageBucket
    }, null, 2);
    $("#settingsDlg").showModal();
  });

  function redrawTemas(){
    const c = $("#temaManager"); c.innerHTML = "";
    for(const t of state.temas){
      const chip = document.createElement("div");
      chip.className = "chip"; chip.textContent = t;
      chip.title = "Clic para eliminar";
      chip.addEventListener("click", ()=>{
        if(confirm(`Eliminar tema "${t}"?`)){
          state.temas = state.temas.filter(x=>x!==t);
          saveLocal(); updateTemaSelects(); redrawTemas();
        }
      });
      c.appendChild(chip);
    }
    updateTemaSelects();
  }
  $("#btnAddTema").addEventListener("click",(e)=>{
    e.preventDefault();
    const v = normalize($("#temaNew").value);
    if(!v) return;
    if(!state.temas.includes(v)) state.temas.push(v);
    $("#temaNew").value="";
    saveLocal(); redrawTemas();
  });

  let previewItems = [];
  $("#btnParse").addEventListener("click", ()=>{
    const defaults = {
      tema: $("#defaultTema").value || "",
      estado: $("#defaultEstado").value || "",
      dificultad: $("#defaultDificultad").value || "",
    };
    previewItems = parseDLF($("#importText").value, defaults);
    if(!previewItems.length){ toast("No se detectaron frases válidas."); $("#btnImport").disabled = true; renderPreview([]); return; }
    for(const it of previewItems){
      if(it.tema && !state.temas.includes(it.tema)) state.temas.push(it.tema);
    }
    saveLocal();
    updateTemaSelects();
    renderPreview(previewItems);
    $("#btnImport").disabled = false;
  });

  $("#btnImport").addEventListener("click", async ()=>{
    if(!previewItems.length) return;
    const map = new Map(state.phrases.map(p=>[p.id,p]));
    for(const it of previewItems) map.set(it.id, it);
    state.phrases = Array.from(map.values());
    saveLocal();
    // subir en lote (secuencial simple)
    for(const it of previewItems){
      try{ await setDoc(doc(db, PHRASES_COL, it.id), it); }catch(e){ console.warn(e); }
    }
    previewItems = [];
    renderPreview(previewItems);
    $("#btnImport").disabled = true;
    $("#importText").value = "";
    renderList();
    toast("Frases importadas.");
  });

  $("#btnClearInput").addEventListener("click", ()=> $("#importText").value="");

  ["#q","#fTema","#fEstado","#fDificultad","#fTipo"].forEach(id=>{
    $(id).addEventListener("input", renderList);
    $(id).addEventListener("change", renderList);
  });

  $("#btnExportDLF").addEventListener("click", ()=>{
    const txt = exportDLF(state.phrases);
    navigator.clipboard.writeText(txt).then(()=> toast("DLF copiado."));
  });
  $("#btnExportJSON").addEventListener("click", ()=>{
    const txt = JSON.stringify(state.phrases, null, 2);
    navigator.clipboard.writeText(txt).then(()=> toast("JSON copiado."));
  });

  $("#btnAddQuick").addEventListener("click", ()=>{
    const ale = prompt("Alemán:"); if(!ale) return;
    const es  = prompt("Español:"); if(!es) return;
    const tema= prompt("Tema:", ($("#fTema").value||state.temas[0]||""));
    const ch  = prompt("Suizo (opcional):","")||"";
    const pron= prompt("Pronunciación (opcional):","")||"";
    const vari= prompt("Variaciones (sep. /):","")||"";
    const p = {
      id: uid(`${ale}||${es}||${tema}`),
      ale, es, ch, pron, tema,
      variaciones: vari.split("/").map(s=>s.trim()).filter(Boolean),
      estado:"nuevo", dificultad:"", tipo:"", createdAt: nowISO()
    };
    persist(p); renderList();
  });

  // Repaso
  $("#btnStartQuiz").addEventListener("click", ()=>{
    const tema = $("#rTema").value;
    const est = $("#rEstado").value;
    let arr = state.phrases.slice();
    if(tema) arr = arr.filter(p=>p.tema===tema);
    if(est) arr = arr.filter(p=>p.estado===est);
    arr.sort((a,b)=>{
      const w = (x)=> x==="difícil"?0: x==="nuevo"?1: x==="practicada"?2:3;
      return w(a.estado)-w(b.estado);
    });
    if(!arr.length){ toast("No hay frases para repasar con esos filtros."); return; }
    state.quizPool = arr;
    state.quizIdx = 0;
    $("#quiz").classList.remove("hidden");
    $("#quizReveal").classList.add("hidden");
    renderQuiz();
  });

  $("#btnReveal").addEventListener("click", ()=> $("#quizReveal").classList.remove("hidden"));
  $("#btnNext").addEventListener("click", ()=>{
    state.quizIdx = (state.quizIdx+1) % state.quizPool.length;
    $("#quizReveal").classList.add("hidden");
    renderQuiz();
  });
  $$(".mark").forEach(btn=>{
    btn.addEventListener("click", async (e)=>{
      const mark = e.target.dataset.mark;
      const p = state.quizPool[state.quizIdx];
      p.estado = mark;
      await persist(p);
      $("#quizReveal").classList.add("hidden");
      state.quizIdx = (state.quizIdx+1) % state.quizPool.length;
      renderQuiz();
    });
  });

  function renderQuiz(){
    const p = state.quizPool[state.quizIdx];
    $("#quizTema").textContent = p.tema || "—";
    $("#quizAle").textContent = p.ale;
    $("#quizCh").textContent = p.ch || "—";
    $("#quizPron").textContent = p.pron || "—";
    $("#quizEs").textContent = p.es;
  }

  // Inicial
  redrawTemas();
}

// === Bootstrap ===
function bootstrap(){
  loadLocal();
  updateTemaSelects();
  renderList();
  setupUI();
  syncFromFirestore(); // trae y fusiona con local
}

document.addEventListener("DOMContentLoaded", bootstrap);
