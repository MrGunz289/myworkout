/* ============================================================
   IronLog — Lift & Burn  (app.js)
   Weight-training-first tracker with cardio integration.
   All data persisted in localStorage. Syncs to Google Sheet.
   ============================================================ */

// ---------- Keys ----------
const K = {
  settings:'il_settings', split:'il_split', lib:'il_lib', history:'il_history',
  sessions:'il_sessions', cardio:'il_cardio', nutrition:'il_nutrition', recovery:'il_recovery',
  seeded:'il_seeded'
};
const loadLS = (k,d)=>{ try{ const v=JSON.parse(localStorage.getItem(k)); return v??d; }catch{ return d; } };
const saveLS = (k,v)=> localStorage.setItem(k, JSON.stringify(v));
const uid = ()=> Date.now().toString(36)+Math.random().toString(36).slice(2,6);

// ---------- Defaults ----------
const MUSCLE_GROUPS = ['Chest','Back','Shoulders','Arms','Legs','Core'];

const DEFAULT_LIB = [
  // Chest
  {name:'Bench Press',group:'Chest'},{name:'Incline Bench Press',group:'Chest'},
  {name:'Incline Dumbbell Press',group:'Chest'},{name:'Chest Fly',group:'Chest'},{name:'Push-up',group:'Chest'},
  // Back
  {name:'Deadlift',group:'Back'},{name:'Pull-up',group:'Back'},{name:'Barbell Row',group:'Back'},
  {name:'Lat Pulldown',group:'Back'},{name:'Seated Cable Row',group:'Back'},
  // Shoulders
  {name:'Overhead Press',group:'Shoulders'},{name:'Lateral Raise',group:'Shoulders'},
  {name:'Rear Delt Fly',group:'Shoulders'},{name:'Face Pull',group:'Shoulders'},
  // Arms
  {name:'Bicep Curl',group:'Arms'},{name:'Hammer Curl',group:'Arms'},{name:'Preacher Curl',group:'Arms'},
  {name:'Triceps Pushdown',group:'Arms'},{name:'Skull Crusher',group:'Arms'},{name:'Overhead Triceps Extension',group:'Arms'},
  // Legs
  {name:'Squat',group:'Legs'},{name:'Front Squat',group:'Legs'},{name:'Leg Press',group:'Legs'},
  {name:'Romanian Deadlift',group:'Legs'},{name:'Leg Curl',group:'Legs'},{name:'Leg Extension',group:'Legs'},
  {name:'Calf Raise',group:'Legs'},{name:'Walking Lunge',group:'Legs'},
  // Core
  {name:'Plank',group:'Core'},{name:'Hanging Leg Raise',group:'Core'},{name:'Cable Crunch',group:'Core'}
];

// Weekly split keyed by weekday 0=Sun..6=Sat
const DEFAULT_SPLIT = {
  0:{name:'Rest Day', type:'rest', exercises:[]},
  1:{name:'Push · Chest & Triceps', type:'strength',
     exercises:['Bench Press','Incline Dumbbell Press','Overhead Press','Lateral Raise','Triceps Pushdown']},
  2:{name:'Pull · Back & Biceps', type:'strength',
     exercises:['Deadlift','Pull-up','Barbell Row','Lat Pulldown','Bicep Curl']},
  3:{name:'Legs · Quads & Hams', type:'strength',
     exercises:['Squat','Leg Press','Romanian Deadlift','Leg Curl','Calf Raise','Plank']},
  4:{name:'HIIT Cardio', type:'cardio', exercises:[]},
  5:{name:'Upper Body', type:'strength',
     exercises:['Incline Bench Press','Barbell Row','Lateral Raise','Bicep Curl','Triceps Pushdown']},
  6:{name:'Lower + Zone 2', type:'strength',
     exercises:['Front Squat','Leg Press','Leg Curl','Calf Raise']}
};

const DEFAULT_SETTINGS = { url:'', steadyTarget:150, hiitTarget:2, volTarget:15, barWeight:20 };

// ---------- State ----------
let settings  = loadLS(K.settings, {...DEFAULT_SETTINGS});
let split     = loadLS(K.split, DEFAULT_SPLIT);
let lib       = loadLS(K.lib, DEFAULT_LIB);
let history   = loadLS(K.history, {});      // {exName:[{date,sets:[{w,r}]}]}
let sessions  = loadLS(K.sessions, []);     // [{date,name,durationSec,totalSets,totalVol,byGroup:{}}]
let cardioLog = loadLS(K.cardio, []);       // [{date,type,minutes,note,avgHr?}]
let nutrition = loadLS(K.nutrition, {});    // {date:[{name,protein,carb,fat,kcal}]}
let recovery  = loadLS(K.recovery, {});     // {date:{sleep,soreness}}

let session = null;   // active workout
let timerInt=null, restInt=null, restTotal=60, restLeft=0;
let charts = {};

// ---------- Generic UI helpers ----------
function esc(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function el(id){ return document.getElementById(id); }
function show(id){ el(id).classList.remove('hidden'); }
function hide(id){ el(id).classList.add('hidden'); }
function closeModal(id){ hide(id); }

function toast(msg, ok=true){
  const t=el('toast'), i=el('toastInner');
  i.textContent=msg;
  i.className='px-5 py-3 rounded-xl text-sm font-semibold shadow-lg pop text-center '+(ok?'bg-emerald-600':'bg-red-600')+' text-white';
  show('toast'); clearTimeout(t._t); t._t=setTimeout(()=>hide('toast'),2600);
}

let _promptRes=null;
function askText(title, initial=''){
  return new Promise(res=>{
    _promptRes=res; el('promptTitle').textContent=title;
    const inp=el('promptInput'); inp.value=initial; show('promptModal');
    setTimeout(()=>{ inp.focus(); inp.select(); },50);
  });
}
function closePrompt(ok){
  const v=el('promptInput').value.trim(); hide('promptModal');
  if(_promptRes){ _promptRes(ok?v:null); _promptRes=null; }
}
el('promptInput').addEventListener('keydown',e=>{ if(e.key==='Enter') closePrompt(true); });

let _confRes=null;
function askConfirm(text, okLabel='ยืนยัน'){
  return new Promise(res=>{
    _confRes=res; el('confirmText').textContent=text; el('confirmOkBtn').textContent=okLabel; show('confirmModal');
  });
}
function closeConfirm(ok){ hide('confirmModal'); if(_confRes){ _confRes(ok); _confRes=null; } }

function openSheet(html){ el('sheetBody').innerHTML=html; show('sheetModal'); }

// ---------- Date helpers ----------
function todayISO(){ return new Date().toISOString().slice(0,10); }
function startOfWeek(d=new Date()){ const x=new Date(d); const day=(x.getDay()+6)%7; x.setHours(0,0,0,0); x.setDate(x.getDate()-day); return x; }
function isThisWeek(iso){ const sow=startOfWeek(); const dt=new Date(iso+'T00:00:00'); return dt>=sow; }
function fmtTime(sec){ const m=String(Math.floor(sec/60)).padStart(2,'0'), s=String(sec%60).padStart(2,'0'); return m+':'+s; }
function groupOf(exName){ const e=lib.find(x=>x.name===exName); return e?e.group:'Core'; }

// ---------- Settings ----------
function openSettings(){
  el('urlInput').value=settings.url||'';
  el('setSteady').value=settings.steadyTarget; el('setHiit').value=settings.hiitTarget;
  el('setVolTarget').value=settings.volTarget; el('setBar').value=settings.barWeight;
  show('settingsModal');
}
function saveSettings(){
  settings.url=el('urlInput').value.trim();
  settings.steadyTarget=+el('setSteady').value||150;
  settings.hiitTarget=+el('setHiit').value||2;
  settings.volTarget=+el('setVolTarget').value||15;
  settings.barWeight=+el('setBar').value||20;
  saveLS(K.settings,settings); hide('settingsModal'); toast('บันทึกการตั้งค่าแล้ว');
  updateHeaderSub(); renderHome();
}
function updateHeaderSub(){ el('headerSub').textContent = settings.url?'เชื่อมต่อ Sheet แล้ว ✓':'Lift & Burn'; }
async function resetAllData(){
  if(!(await askConfirm('ลบข้อมูลทั้งหมดและรีเซ็ตเป็นค่าเริ่มต้น?','ลบทั้งหมด'))) return;
  Object.values(K).forEach(k=>localStorage.removeItem(k)); location.reload();
}

// ---------- Tabs ----------
function switchTab(name){
  document.querySelectorAll('.tabview').forEach(v=>v.classList.add('hidden'));
  el('tab-'+name).classList.remove('hidden');
  document.querySelectorAll('.navbtn').forEach(b=>{
    b.classList.toggle('text-brand-400', b.dataset.tab===name);
    b.classList.toggle('text-slate-500', b.dataset.tab!==name);
  });
  if(name==='home') renderHome();
  if(name==='routines') renderRoutines();
  if(name==='stats') renderStats();
  if(name==='recovery') renderRecovery();
  window.scrollTo(0,0);
}

/* ============================================================
   1) DASHBOARD
   ============================================================ */
function weeklyVolumeByGroup(){
  const v={}; MUSCLE_GROUPS.forEach(g=>v[g]=0);
  sessions.filter(s=>isThisWeek(s.date)).forEach(s=>{
    Object.entries(s.byGroup||{}).forEach(([g,n])=>{ v[g]=(v[g]||0)+n; });
  });
  return v;
}
function weeklyCardio(){
  let steady=0, hiit=0;
  cardioLog.filter(c=>isThisWeek(c.date)).forEach(c=>{
    if(c.type==='HIIT') hiit++; else steady+=(+c.minutes||0);
  });
  return {steady,hiit};
}

function renderHome(){
  const wd=new Date().getDay();
  const today=split[wd]||{name:'Rest',type:'rest',exercises:[]};
  const vol=weeklyVolumeByGroup();
  const cardio=weeklyCardio();
  const sug=smartSuggestion();

  const todayCard = today.type==='cardio' ? `
    <div class="rounded-3xl p-5 bg-gradient-to-br from-burn-500 to-burn-600 shadow-lg shadow-orange-900/30">
      <p class="text-xs font-semibold text-orange-100">วันนี้ · ${new Date().toLocaleDateString('th-TH',{weekday:'long'})}</p>
      <h2 class="text-2xl font-extrabold mt-1">🔥 ${esc(today.name)}</h2>
      <p class="text-sm text-orange-100 mt-1">วันคาร์ดิโอ — เผาผลาญแบบไม่ทำลายกล้ามเนื้อ</p>
      <button onclick="openHiitTimer()" class="mt-4 w-full py-3.5 rounded-2xl bg-white text-burn-600 font-bold text-base active:scale-[.99] transition">เริ่ม HIIT Timer ▶</button>
    </div>`
    : today.type==='rest' ? `
    <div class="rounded-3xl p-5 bg-slate-900 border border-slate-800">
      <p class="text-xs font-semibold text-slate-400">วันนี้ · ${new Date().toLocaleDateString('th-TH',{weekday:'long'})}</p>
      <h2 class="text-2xl font-extrabold mt-1">😴 ${esc(today.name)}</h2>
      <p class="text-sm text-slate-400 mt-1">พักฟื้นกล้ามเนื้อ — เดินเบาๆ ได้</p>
      <button onclick="startWorkoutFromSplit()" class="mt-4 w-full py-3.5 rounded-2xl bg-slate-800 font-bold active:bg-slate-700">ฝึกเสริมก็ได้ +</button>
    </div>`
    : `
    <div class="rounded-3xl p-5 bg-gradient-to-br from-brand-500 to-brand-700 shadow-lg shadow-indigo-900/30">
      <p class="text-xs font-semibold text-indigo-200">วันนี้ · ${new Date().toLocaleDateString('th-TH',{weekday:'long'})}</p>
      <h2 class="text-2xl font-extrabold mt-1 leading-tight">${esc(today.name)}</h2>
      <p class="text-sm text-indigo-200 mt-1">${today.exercises.length} ท่า · เป้าหมาย Progressive Overload</p>
      <button onclick="startWorkoutFromSplit()" class="mt-4 w-full py-3.5 rounded-2xl bg-white text-brand-700 font-bold text-base active:scale-[.99] transition">เริ่มฝึก (Start Workout) ▶</button>
    </div>`;

  const volBars = MUSCLE_GROUPS.map(g=>{
    const cur=vol[g]||0, tgt=settings.volTarget, pct=Math.min(100,Math.round(cur/tgt*100));
    const done=cur>=tgt;
    return `<div>
      <div class="flex justify-between text-[11px] mb-1"><span class="font-semibold">${g}</span>
        <span class="${done?'text-emerald-400':'text-slate-400'}">${cur}/${tgt} เซ็ต</span></div>
      <div class="h-2 rounded-full bg-slate-800 overflow-hidden">
        <div class="h-full rounded-full ${done?'bg-emerald-500':'bg-brand-500'}" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');

  const steadyPct=Math.min(100,Math.round(cardio.steady/settings.steadyTarget*100));
  const hiitPct=Math.min(100,Math.round(cardio.hiit/settings.hiitTarget*100));

  el('tab-home').innerHTML = `
    ${todayCard}

    ${sug ? `<div class="rounded-2xl p-4 ${sug.tone} flex gap-3 items-start fadein">
        <span class="text-xl shrink-0">${sug.icon}</span>
        <div><p class="text-sm font-bold">${sug.title}</p><p class="text-xs opacity-90 mt-0.5">${esc(sug.body)}</p></div>
      </div>`:''}

    <section class="rounded-2xl p-4 bg-slate-900 border border-slate-800">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold">Weekly Volume</h3>
        <span class="text-[11px] text-slate-500">รีเซ็ตทุกจันทร์</span>
      </div>
      <div class="space-y-2.5">${volBars}</div>
    </section>

    <section class="rounded-2xl p-4 bg-slate-900 border border-slate-800">
      <h3 class="font-bold mb-3">Cardio Target</h3>
      <div class="grid grid-cols-2 gap-3">
        <div class="rounded-xl bg-slate-800/60 p-3">
          <p class="text-[11px] text-slate-400">Steady (Zone 2)</p>
          <p class="text-lg font-extrabold">${cardio.steady}<span class="text-xs text-slate-400">/${settings.steadyTarget} นาที</span></p>
          <div class="h-1.5 rounded-full bg-slate-700 mt-2 overflow-hidden"><div class="h-full bg-emerald-500" style="width:${steadyPct}%"></div></div>
        </div>
        <div class="rounded-xl bg-slate-800/60 p-3">
          <p class="text-[11px] text-slate-400">HIIT</p>
          <p class="text-lg font-extrabold">${cardio.hiit}<span class="text-xs text-slate-400">/${settings.hiitTarget} เซสชัน</span></p>
          <div class="h-1.5 rounded-full bg-slate-700 mt-2 overflow-hidden"><div class="h-full bg-burn-500" style="width:${hiitPct}%"></div></div>
        </div>
      </div>
      <button onclick="openCardioLog()" class="mt-3 w-full py-2.5 rounded-xl bg-slate-800 active:bg-slate-700 text-sm font-semibold">+ บันทึกคาร์ดิโอ</button>
    </section>
  `;
}

/* ============================================================
   2) WORKOUT TRACKER
   ============================================================ */
function startWorkoutFromSplit(){
  const wd=new Date().getDay();
  const today=split[wd]||{name:'Custom Workout',exercises:[]};
  startSession(today.name, today.exercises.slice());
}
function startSession(name, exNames){
  session={ name, startedAt:Date.now(),
    exercises: exNames.map(n=>({ id:uid(), name:n, sets:[ blankSet(n) ] })) };
  if(session.exercises.length===0) session.exercises.push();
  el('trkTitle').textContent=name;
  show('trackerView'); document.body.style.overflow='hidden';
  startTimer(); renderTracker();
}
function blankSet(exName){
  const prev=lastSession(exName);
  const ps=prev&&prev.sets.length?prev.sets[prev.sets.length-1]:null;
  return { w: ps?ps.w:'', r: ps?ps.r:'', done:false };
}
function lastSession(exName){ const h=history[exName]; return h&&h.length?h[h.length-1]:null; }
function bestE1RM(exName){
  const h=history[exName]; if(!h) return 0; let best=0;
  h.forEach(s=>s.sets.forEach(st=>{ const e=st.w*(1+st.r/30); if(e>best)best=e; }));
  return Math.round(best);
}

function startTimer(){
  stopTimer();
  timerInt=setInterval(()=>{
    const s=Math.floor((Date.now()-session.startedAt)/1000);
    el('trkTimer').textContent=fmtTime(s);
  },1000);
}
function stopTimer(){ if(timerInt) clearInterval(timerInt); timerInt=null; }

async function confirmExitTracker(){
  if(await askConfirm('ออกจากการฝึกโดยไม่บันทึก?','ออก')){ closeTracker(); }
}
function closeTracker(){
  stopTimer(); stopRest(); session=null;
  hide('trackerView'); document.body.style.overflow='';
}

async function addExerciseToSession(){
  const choice = await pickExercise();
  if(!choice) return;
  session.exercises.push({ id:uid(), name:choice, sets:[ blankSet(choice) ] });
  renderTracker();
}
function pickExercise(){
  return new Promise(res=>{
    window._pickRes=res;
    const byG={}; lib.forEach(e=>{ (byG[e.group]=byG[e.group]||[]).push(e.name); });
    const groups=MUSCLE_GROUPS.map(g=>`
      <p class="text-[11px] font-bold text-slate-400 mt-3 mb-1">${g}</p>
      <div class="flex flex-wrap gap-2">${(byG[g]||[]).map(n=>
        `<button onclick="resolvePick('${esc(n)}')" class="px-3 py-2 rounded-xl bg-slate-800 active:bg-brand-600 text-sm">${esc(n)}</button>`).join('')}</div>`).join('');
    openSheet(`
      <h3 class="text-lg font-bold mb-1">เลือกท่าฝึก</h3>
      <button onclick="resolvePickNew()" class="w-full py-2.5 mt-2 rounded-xl bg-brand-600 active:bg-brand-700 font-semibold text-sm">+ สร้างท่าใหม่</button>
      ${groups}
      <div class="h-4"></div>`);
  });
}
function resolvePick(name){ hide('sheetModal'); if(window._pickRes){ window._pickRes(name); window._pickRes=null; } }
async function resolvePickNew(){
  hide('sheetModal');
  const name=await askText('ชื่อท่าใหม่','');
  if(name){
    if(!lib.find(x=>x.name===name)){ lib.push({name,group:'Core'}); saveLS(K.lib,lib); }
    if(window._pickRes){ window._pickRes(name); window._pickRes=null; }
  } else if(window._pickRes){ window._pickRes(null); window._pickRes=null; }
}

function renderTracker(){
  const wrap=el('trkExercises');
  wrap.innerHTML = session.exercises.map(ex=>{
    const prev=lastSession(ex.name);
    const e1rm=bestE1RM(ex.name);
    let prevTxt='ยังไม่มีประวัติ';
    if(prev){ const best=prev.sets.reduce((a,b)=>b.w>a.w?b:a,prev.sets[0]);
      prevTxt=`ครั้งก่อน ${best.w}kg×${best.r}` + (e1rm?` · 1RM~${e1rm}kg`:''); }
    const sets=ex.sets.map((st,i)=>`
      <div class="flex items-center gap-2">
        <div class="w-6 text-center text-xs text-slate-500 font-bold shrink-0">${i+1}</div>
        <div class="flex-1 relative">
          <input type="number" inputmode="decimal" value="${st.w}" placeholder="kg"
            oninput="setField('${ex.id}',${i},'w',this.value)"
            class="w-full text-center rounded-lg ${st.done?'bg-emerald-900/30 border-emerald-700':'bg-slate-800 border-slate-700'} border py-2.5 text-base focus:border-brand-500 outline-none"></div>
        <span class="text-slate-600 text-sm">×</span>
        <div class="flex-1 relative">
          <input type="number" inputmode="numeric" value="${st.r}" placeholder="reps"
            oninput="setField('${ex.id}',${i},'r',this.value)"
            class="w-full text-center rounded-lg ${st.done?'bg-emerald-900/30 border-emerald-700':'bg-slate-800 border-slate-700'} border py-2.5 text-base focus:border-brand-500 outline-none"></div>
        <button onclick="toggleDone('${ex.id}',${i})" class="w-10 h-10 grid place-items-center rounded-lg ${st.done?'bg-emerald-600':'bg-slate-800'} active:opacity-80 text-base shrink-0">✓</button>
        <button onclick="delSet('${ex.id}',${i})" class="w-8 h-10 grid place-items-center rounded-lg bg-slate-800 active:bg-red-900/60 text-red-400 shrink-0">−</button>
      </div>`).join('');
    return `<div class="pop bg-slate-900 rounded-2xl p-4 border border-slate-800">
      <div class="flex items-start justify-between gap-2 mb-2">
        <div class="min-w-0">
          <h3 class="font-bold text-base truncate">${esc(ex.name)} <span class="text-[10px] font-semibold text-slate-500">${groupOf(ex.name)}</span></h3>
          <p class="text-[11px] text-amber-400/90 mt-0.5">📊 ${esc(prevTxt)}</p>
        </div>
        <button onclick="delExercise('${ex.id}')" class="w-8 h-8 grid place-items-center rounded-lg bg-slate-800 active:bg-slate-700 text-sm shrink-0">🗑️</button>
      </div>
      <div class="space-y-2">${sets}</div>
      <button onclick="addSet('${ex.id}')" class="mt-2.5 w-full py-2 rounded-lg bg-brand-600/20 text-brand-400 font-semibold text-sm active:bg-brand-600/30">+ เพิ่มเซ็ต</button>
    </div>`;
  }).join('') || `<p class="text-center text-slate-500 py-10 text-sm">กดปุ่มด้านล่างเพื่อเพิ่มท่าฝึก</p>`;
  updateTrackerStats();
}
function setField(exId,i,f,v){ const ex=session.exercises.find(x=>x.id===exId); ex.sets[i][f]=v; updateTrackerStats(); }
function addSet(exId){ const ex=session.exercises.find(x=>x.id===exId); const l=ex.sets[ex.sets.length-1]||{}; ex.sets.push({w:l.w||'',r:l.r||'',done:false}); renderTracker(); }
function delSet(exId,i){ const ex=session.exercises.find(x=>x.id===exId); ex.sets.splice(i,1); if(!ex.sets.length) ex.sets.push({w:'',r:'',done:false}); renderTracker(); }
async function delExercise(exId){ const ex=session.exercises.find(x=>x.id===exId); if(await askConfirm(`ลบ ${ex.name}?`,'ลบ')){ session.exercises=session.exercises.filter(x=>x.id!==exId); renderTracker(); } }
function toggleDone(exId,i){
  const ex=session.exercises.find(x=>x.id===exId); const st=ex.sets[i];
  st.done=!st.done; renderTracker();
  if(st.done && st.w!=='' && st.r!==''){ startRest(restTotal); }
}
function updateTrackerStats(){
  let sets=0, vol=0;
  session.exercises.forEach(ex=>ex.sets.forEach(st=>{
    if(st.w!=='' && st.r!==''){ sets++; vol+=(+st.w)*(+st.r); }
  }));
  el('trkSets').textContent=sets; el('trkVol').textContent=vol.toLocaleString();
}

// ---- Rest timer ----
function startRest(sec){
  restTotal=sec; restLeft=sec; show('restBar'); drawRest();
  clearInterval(restInt);
  restInt=setInterval(()=>{
    restLeft--; drawRest();
    if(restLeft<=0){ clearInterval(restInt); restDone(); }
  },1000);
}
function setRest(sec){ startRest(sec); }
function addRest(sec){ restLeft+=sec; restTotal=Math.max(restTotal,restLeft); drawRest(); }
function stopRest(){ clearInterval(restInt); hide('restBar'); }
function drawRest(){
  el('restCount').textContent=Math.max(0,restLeft);
  const C=2*Math.PI*24; const off=C*(1-Math.max(0,restLeft)/restTotal);
  el('restRing').style.strokeDashoffset=off;
}
function restDone(){ beep(); vibrate([200,100,200]); el('restCount').textContent='พร้อม!'; setTimeout(stopRest,1500); }
function beep(){
  try{ const ctx=new (window.AudioContext||window.webkitAudioContext)();
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.frequency.value=880; o.type='sine';
    g.gain.setValueAtTime(.001,ctx.currentTime); g.gain.exponentialRampToValueAtTime(.4,ctx.currentTime+.02);
    g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.6); o.start(); o.stop(ctx.currentTime+.6);
  }catch(e){}
}
function vibrate(p){ if(navigator.vibrate) navigator.vibrate(p); }

// ---- Plate calculator ----
function openPlateCalc(){
  openSheet(`
    <h3 class="text-lg font-bold mb-1">Plate Calculator</h3>
    <p class="text-xs text-slate-400 mb-3">บาร์ ${settings.barWeight}kg · คำนวณแผ่นต่อข้าง</p>
    <div class="flex gap-2">
      <input id="plateTarget" type="number" inputmode="decimal" placeholder="น้ำหนักรวม (kg)"
        class="flex-1 rounded-xl bg-slate-800 border border-slate-700 px-3 py-3 text-base focus:border-brand-500 outline-none">
      <button onclick="calcPlates()" class="px-5 rounded-xl bg-brand-600 active:bg-brand-700 font-bold">คิด</button>
    </div>
    <div id="plateResult" class="mt-4"></div>`);
  setTimeout(()=>el('plateTarget').focus(),60);
}
function calcPlates(){
  const target=+el('plateTarget').value;
  const bar=settings.barWeight;
  const out=el('plateResult');
  if(!target||target<bar){ out.innerHTML=`<p class="text-sm text-red-400">น้ำหนักต้องมากกว่าบาร์ (${bar}kg)</p>`; return; }
  let perSide=(target-bar)/2;
  const plates=[25,20,15,10,5,2.5,1.25]; const used=[];
  plates.forEach(p=>{ while(perSide>=p-0.001){ used.push(p); perSide=+(perSide-p).toFixed(3); } });
  const colors={25:'bg-red-600',20:'bg-blue-600',15:'bg-yellow-500',10:'bg-green-600',5:'bg-slate-300 text-slate-900',2.5:'bg-slate-500',1.25:'bg-slate-600'};
  const chips=used.length?used.map(p=>`<span class="px-3 py-2 rounded-lg ${colors[p]||'bg-slate-700'} text-sm font-bold">${p}</span>`).join('')
    :'<span class="text-sm text-slate-400">บาร์เปล่า</span>';
  const leftover=perSide>0.01?`<p class="text-xs text-amber-400 mt-2">เหลือ ${perSide.toFixed(2)}kg/ข้าง (แผ่นไม่ลงตัว)</p>`:'';
  out.innerHTML=`<p class="text-xs text-slate-400 mb-2">แผ่นต่อข้าง (รวม 2 ข้าง = ${target}kg):</p>
    <div class="flex flex-wrap gap-2 items-center">${chips}</div>${leftover}`;
}

// ---- Finish & sync ----
async function finishWorkout(){
  const dateStr=todayISO();
  const durationSec=Math.floor((Date.now()-session.startedAt)/1000);
  const setsDetail=[]; const byGroup={}; let totalVol=0;
  session.exercises.forEach(ex=>{
    let n=0;
    ex.sets.forEach(st=>{
      if(st.w===''||st.r==='') return;
      n++; const w=+st.w,r=+st.r; totalVol+=w*r;
      const g=groupOf(ex.name); byGroup[g]=(byGroup[g]||0)+1;
      setsDetail.push({date:dateStr,activity:session.name,exercise:ex.name,setNo:n,weight:w,reps:r});
    });
    // save to history
    const valid=ex.sets.filter(s=>s.w!==''&&s.r!=='').map(s=>({w:+s.w,r:+s.r}));
    if(valid.length){ (history[ex.name]=history[ex.name]||[]).push({date:dateStr,sets:valid}); if(history[ex.name].length>60) history[ex.name].shift(); }
  });
  if(setsDetail.length===0){ toast('กรอกอย่างน้อย 1 เซ็ตก่อนบันทึก',false); return; }

  const sessionRec={date:dateStr,name:session.name,durationSec,totalSets:setsDetail.length,totalVol,byGroup};
  sessions.push(sessionRec);
  saveLS(K.history,history); saveLS(K.sessions,sessions);

  const payload={ type:'workout',
    session:{date:dateStr,activity:session.name,duration:fmtTime(durationSec),totalSets:setsDetail.length,totalVolume:totalVol},
    sets:setsDetail };

  await syncToSheet(payload, 'บันทึกการฝึกแล้ว');
  closeTracker(); switchTab('home');
}

async function syncToSheet(payload, okMsg){
  if(!settings.url){ toast(okMsg+' (ในเครื่อง)'); return; }
  el('loadingText').textContent='กำลังส่งข้อมูล...'; show('loadingOverlay');
  try{
    await fetch(settings.url,{ method:'POST', mode:'no-cors',
      headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify(payload) });
    hide('loadingOverlay'); toast(okMsg+' & ส่งเข้า Sheet ✓');
  }catch(e){ hide('loadingOverlay'); toast('ส่ง Sheet ล้มเหลว — บันทึกในเครื่องแล้ว',false); console.error(e); }
}

/* ============================================================
   3) ROUTINES & CARDIO BUILDER
   ============================================================ */
const PRESETS={
  PPL:{label:'PPL (Push/Pull/Legs)',plan:{1:'Push · Chest & Triceps',2:'Pull · Back & Biceps',3:'Legs · Quads & Hams',4:'HIIT Cardio',5:'Push · Shoulders',6:'Pull + Zone 2',0:'Rest Day'}},
  UL:{label:'Upper / Lower Split',plan:{1:'Upper Body',2:'Lower Body',3:'HIIT Cardio',4:'Upper Body',5:'Lower Body',6:'Zone 2 Cardio',0:'Rest Day'}},
  FB:{label:'Full Body 3x/สัปดาห์',plan:{1:'Full Body A',2:'Zone 2 Cardio',3:'Full Body B',4:'HIIT Cardio',5:'Full Body C',6:'Rest Day',0:'Rest Day'}}
};
function renderRoutines(){
  const days=['อา','จ','อ','พ','พฤ','ศ','ส'];
  const wd=new Date().getDay();
  const splitRows=[0,1,2,3,4,5,6].map(d=>{
    const s=split[d]||{name:'Rest',type:'rest',exercises:[]};
    const icon=s.type==='cardio'?'🔥':s.type==='rest'?'😴':'🏋️';
    return `<div onclick="editSplitDay(${d})" class="flex items-center gap-3 p-3 rounded-xl ${d===wd?'bg-brand-600/20 border border-brand-600/40':'bg-slate-800/50'} active:bg-slate-800">
      <div class="w-9 h-9 grid place-items-center rounded-lg bg-slate-800 font-bold text-xs">${days[d]}</div>
      <div class="flex-1 min-w-0"><p class="text-sm font-semibold truncate">${icon} ${esc(s.name)}</p>
        <p class="text-[11px] text-slate-400">${s.type==='strength'?s.exercises.length+' ท่า':s.type==='cardio'?'คาร์ดิโอ':'พัก'}</p></div>
      <span class="text-slate-600">›</span></div>`;
  }).join('');

  const presetBtns=Object.entries(PRESETS).map(([k,p])=>
    `<button onclick="applyPreset('${k}')" class="px-3 py-2 rounded-xl bg-slate-800 active:bg-brand-600 text-sm font-semibold">${esc(p.label)}</button>`).join('');

  el('tab-routines').innerHTML=`
    <div><h2 class="text-lg font-bold">โปรแกรมการฝึก</h2>
      <p class="text-xs text-slate-400">แตะแต่ละวันเพื่อแก้ไขท่าฝึก</p></div>

    <section class="rounded-2xl p-4 bg-slate-900 border border-slate-800">
      <h3 class="font-bold mb-2 text-sm">Strength Routines สำเร็จรูป</h3>
      <div class="flex flex-wrap gap-2">${presetBtns}</div>
    </section>

    <section class="rounded-2xl p-4 bg-slate-900 border border-slate-800 space-y-2">
      <h3 class="font-bold text-sm mb-1">ตารางสัปดาห์ (Weekly Split)</h3>
      ${splitRows}
    </section>

    <section class="rounded-2xl p-4 bg-slate-900 border border-slate-800">
      <h3 class="font-bold text-sm mb-3">Cardio Integration</h3>
      <div class="grid grid-cols-2 gap-3">
        <button onclick="openCardioLog('LISS')" class="p-3 rounded-xl bg-emerald-600/15 border border-emerald-700/40 active:bg-emerald-600/25 text-left">
          <p class="font-bold text-emerald-400">LISS / MISS</p><p class="text-[11px] text-slate-400 mt-0.5">เดินเร็ว / Zone 2 เผาไขมัน</p></button>
        <button onclick="openHiitTimer()" class="p-3 rounded-xl bg-burn-500/15 border border-burn-600/40 active:bg-burn-500/25 text-left">
          <p class="font-bold text-burn-500">HIIT / Tabata</p><p class="text-[11px] text-slate-400 mt-0.5">Interval เข้มข้นสูง</p></button>
      </div>
    </section>

    <section class="rounded-2xl p-4 bg-slate-900 border border-slate-800">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-sm">Exercise Library</h3>
        <button onclick="addLibExercise()" class="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-600 active:bg-brand-700">+ เพิ่ม</button>
      </div>
      ${MUSCLE_GROUPS.map(g=>{
        const items=lib.filter(e=>e.group===g);
        return `<p class="text-[11px] font-bold text-slate-400 mt-3 mb-1">${g} · ${items.length}</p>
        <div class="flex flex-wrap gap-2">${items.map(e=>`<span class="px-2.5 py-1.5 rounded-lg bg-slate-800 text-xs">${esc(e.name)}</span>`).join('')}</div>`;
      }).join('')}
    </section>`;
}
function applyPreset(k){
  const p=PRESETS[k];
  Object.entries(p.plan).forEach(([d,nm])=>{
    const type=/cardio|hiit/i.test(nm)?'cardio':/rest/i.test(nm)?'rest':'strength';
    if(split[d] && split[d].name===nm){ return; }
    split[d]={name:nm,type, exercises: type==='strength'?(split[d]?.exercises||[]):[]};
  });
  saveLS(K.split,split); renderRoutines(); toast('ใช้โปรแกรม '+p.label+' แล้ว');
}
async function editSplitDay(d){
  const s=split[d]||{name:'Rest',type:'rest',exercises:[]};
  const days=['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'];
  const types=[['strength','🏋️ เวท'],['cardio','🔥 คาร์ดิโอ'],['rest','😴 พัก']];
  openSheet(`
    <h3 class="text-lg font-bold mb-3">วัน${days[d]}</h3>
    <label class="text-xs text-slate-400">ชื่อโปรแกรม</label>
    <input id="sdName" value="${esc(s.name)}" class="mt-1 w-full rounded-xl bg-slate-800 border border-slate-700 px-3 py-2.5 text-base focus:border-brand-500 outline-none">
    <label class="text-xs text-slate-400 block mt-3">ประเภท</label>
    <div class="flex gap-2 mt-1">${types.map(t=>`<button onclick="sdSetType('${t[0]}')" data-t="${t[0]}" class="sdtype flex-1 py-2.5 rounded-xl ${s.type===t[0]?'bg-brand-600':'bg-slate-800'} text-sm font-semibold">${t[1]}</button>`).join('')}</div>
    <div id="sdExWrap" class="${s.type==='strength'?'':'hidden'} mt-3">
      <label class="text-xs text-slate-400">ท่าฝึก (แตะเพื่อสลับ)</label>
      <div class="flex flex-wrap gap-2 mt-1">${lib.map(e=>`<button onclick="sdToggleEx('${esc(e.name)}',this)" class="px-2.5 py-1.5 rounded-lg text-xs ${s.exercises.includes(e.name)?'bg-brand-600':'bg-slate-800'}">${esc(e.name)}</button>`).join('')}</div>
    </div>
    <div class="flex gap-2 mt-5">
      <button onclick="closeModal('sheetModal')" class="flex-1 py-3 rounded-xl bg-slate-800 font-semibold">ยกเลิก</button>
      <button onclick="saveSplitDay(${d})" class="flex-1 py-3 rounded-xl bg-brand-600 font-semibold">บันทึก</button>
    </div>`);
  window._sdType=s.type; window._sdEx=s.exercises.slice();
}
function sdSetType(t){ window._sdType=t; document.querySelectorAll('.sdtype').forEach(b=>{ b.classList.toggle('bg-brand-600',b.dataset.t===t); b.classList.toggle('bg-slate-800',b.dataset.t!==t); }); el('sdExWrap').classList.toggle('hidden',t!=='strength'); }
function sdToggleEx(name,btn){ const i=window._sdEx.indexOf(name); if(i>=0){ window._sdEx.splice(i,1); btn.classList.remove('bg-brand-600'); btn.classList.add('bg-slate-800'); } else { window._sdEx.push(name); btn.classList.add('bg-brand-600'); btn.classList.remove('bg-slate-800'); } }
function saveSplitDay(d){
  split[d]={ name:el('sdName').value.trim()||'Workout', type:window._sdType, exercises:window._sdType==='strength'?window._sdEx:[] };
  saveLS(K.split,split); hide('sheetModal'); renderRoutines(); toast('บันทึกตารางแล้ว');
}
async function addLibExercise(){
  const name=await askText('ชื่อท่าใหม่',''); if(!name) return;
  const groups=MUSCLE_GROUPS;
  openSheet(`<h3 class="text-lg font-bold mb-3">"${esc(name)}" เป็นกล้ามเนื้อกลุ่มไหน?</h3>
    <div class="grid grid-cols-2 gap-2">${groups.map(g=>`<button onclick="saveLibEx('${esc(name)}','${g}')" class="py-3 rounded-xl bg-slate-800 active:bg-brand-600 font-semibold">${g}</button>`).join('')}</div>`);
}
function saveLibEx(name,group){ if(!lib.find(x=>x.name===name)) lib.push({name,group}); saveLS(K.lib,lib); hide('sheetModal'); renderRoutines(); toast('เพิ่มท่าแล้ว'); }

// ---- Cardio log ----
function openCardioLog(preType){
  openSheet(`
    <h3 class="text-lg font-bold mb-3">บันทึกคาร์ดิโอ</h3>
    <label class="text-xs text-slate-400">ประเภท</label>
    <div class="flex gap-2 mt-1 mb-3">
      ${['LISS','MISS','HIIT'].map(t=>`<button onclick="clSetType('${t}')" data-t="${t}" class="cltype flex-1 py-2.5 rounded-xl ${(preType||'LISS')===t?'bg-brand-600':'bg-slate-800'} text-sm font-semibold">${t}</button>`).join('')}
    </div>
    <label class="text-xs text-slate-400">เวลา (นาที)</label>
    <input id="clMin" type="number" inputmode="numeric" value="30" class="mt-1 w-full rounded-xl bg-slate-800 border border-slate-700 px-3 py-2.5 text-base focus:border-brand-500 outline-none">
    <label class="text-xs text-slate-400 block mt-3">โน้ต (ออปชัน เช่น avg HR)</label>
    <input id="clNote" type="text" placeholder="เช่น เดินลู่ 6.0, HR 130" class="mt-1 w-full rounded-xl bg-slate-800 border border-slate-700 px-3 py-2.5 text-base focus:border-brand-500 outline-none">
    <button onclick="saveCardio()" class="w-full mt-4 py-3 rounded-xl bg-brand-600 active:bg-brand-700 font-semibold">บันทึก</button>`);
  window._clType=preType||'LISS';
}
function clSetType(t){ window._clType=t; document.querySelectorAll('.cltype').forEach(b=>{ b.classList.toggle('bg-brand-600',b.dataset.t===t); b.classList.toggle('bg-slate-800',b.dataset.t!==t); }); }
async function saveCardio(){
  const rec={date:todayISO(),type:window._clType,minutes:+el('clMin').value||0,note:el('clNote').value.trim()};
  cardioLog.push(rec); saveLS(K.cardio,cardioLog); hide('sheetModal');
  await syncToSheet({type:'cardio',cardio:rec},'บันทึกคาร์ดิโอแล้ว');
  renderHome();
}

// ---- HIIT / Tabata timer ----
let hiitState=null;
function openHiitTimer(){
  openSheet(`
    <h3 class="text-lg font-bold mb-1">HIIT / Tabata Timer</h3>
    <p class="text-xs text-slate-400 mb-3">ตั้งค่าแล้วกดเริ่ม</p>
    <div class="grid grid-cols-3 gap-2 mb-3">
      <div><label class="text-[11px] text-slate-400">Work (s)</label><input id="hWork" type="number" value="20" class="mt-1 w-full rounded-xl bg-slate-800 border border-slate-700 px-2 py-2 text-base text-center outline-none focus:border-brand-500"></div>
      <div><label class="text-[11px] text-slate-400">Rest (s)</label><input id="hRest" type="number" value="10" class="mt-1 w-full rounded-xl bg-slate-800 border border-slate-700 px-2 py-2 text-base text-center outline-none focus:border-brand-500"></div>
      <div><label class="text-[11px] text-slate-400">Rounds</label><input id="hRound" type="number" value="8" class="mt-1 w-full rounded-xl bg-slate-800 border border-slate-700 px-2 py-2 text-base text-center outline-none focus:border-brand-500"></div>
    </div>
    <div id="hiitDisplay" class="rounded-2xl bg-slate-800 p-6 text-center mb-3">
      <p id="hiitPhase" class="text-sm font-semibold text-slate-400">พร้อมเริ่ม</p>
      <p id="hiitBig" class="text-5xl font-extrabold my-1">--</p>
      <p id="hiitRound" class="text-xs text-slate-400">รอบ 0/0</p>
    </div>
    <div class="flex gap-2">
      <button id="hiitStartBtn" onclick="startHiit()" class="flex-1 py-3 rounded-xl bg-burn-500 active:bg-burn-600 font-bold">เริ่ม</button>
      <button onclick="stopHiit()" class="flex-1 py-3 rounded-xl bg-slate-800 active:bg-slate-700 font-semibold">หยุด</button>
    </div>`);
}
function startHiit(){
  const work=+el('hWork').value||20, rest=+el('hRest').value||10, rounds=+el('hRound').value||8;
  hiitState={work,rest,rounds,round:1,phase:'work',left:work};
  el('hiitStartBtn').textContent='กำลังทำ...';
  clearInterval(hiitState._int);
  hiitTick(true);
  hiitState._int=setInterval(()=>hiitTick(false),1000);
}
function hiitTick(first){
  if(!hiitState) return;
  if(!first) hiitState.left--;
  if(hiitState.left<0){
    if(hiitState.phase==='work'){ hiitState.phase='rest'; hiitState.left=hiitState.rest; beep(); vibrate(150); }
    else { hiitState.round++; if(hiitState.round>hiitState.rounds){ return finishHiit(); } hiitState.phase='work'; hiitState.left=hiitState.work; beep(); vibrate(150); }
  }
  const isWork=hiitState.phase==='work';
  el('hiitDisplay').className='rounded-2xl p-6 text-center mb-3 '+(isWork?'bg-burn-500/30':'bg-emerald-600/20');
  el('hiitPhase').textContent=isWork?'🔥 WORK':'😮‍💨 REST';
  el('hiitBig').textContent=Math.max(0,hiitState.left);
  el('hiitRound').textContent=`รอบ ${hiitState.round}/${hiitState.rounds}`;
  if(hiitState.left<=3 && hiitState.left>0) beep();
}
function finishHiit(){
  clearInterval(hiitState._int);
  const totalMin=Math.round((hiitState.rounds*(hiitState.work+hiitState.rest))/60);
  el('hiitPhase').textContent='✅ เสร็จสิ้น!'; el('hiitBig').textContent='✓';
  beep(); vibrate([200,100,200,100,200]);
  const rec={date:todayISO(),type:'HIIT',minutes:totalMin,note:`${hiitState.rounds}r ${hiitState.work}/${hiitState.rest}s`};
  cardioLog.push(rec); saveLS(K.cardio,cardioLog);
  hiitState=null;
  syncToSheet({type:'cardio',cardio:rec},'บันทึก HIIT แล้ว');
}
function stopHiit(){ if(hiitState){ clearInterval(hiitState._int); hiitState=null; } el('hiitPhase').textContent='หยุดแล้ว'; el('hiitBig').textContent='--'; }

/* ============================================================
   4) STRENGTH ANALYTICS
   ============================================================ */
function renderStats(){
  const exNames=Object.keys(history).sort();
  el('tab-stats').innerHTML=`
    <h2 class="text-lg font-bold">Strength Analytics</h2>

    <section class="rounded-2xl p-4 bg-slate-900 border border-slate-800">
      <h3 class="font-bold text-sm mb-2">Total Volume รายสัปดาห์ (kg)</h3>
      <canvas id="volChart" height="160"></canvas>
    </section>

    <section class="rounded-2xl p-4 bg-slate-900 border border-slate-800">
      <div class="flex items-center justify-between mb-2">
        <h3 class="font-bold text-sm">Strength Progression</h3>
        <select id="exSelect" onchange="drawStrengthChart()" class="text-xs bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 outline-none max-w-[55%]">
          ${exNames.length?exNames.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join(''):'<option>— ยังไม่มีข้อมูล —</option>'}
        </select>
      </div>
      <canvas id="strChart" height="160"></canvas>
      <p id="strNote" class="text-[11px] text-slate-400 mt-2"></p>
    </section>

    <section class="rounded-2xl p-4 bg-slate-900 border border-slate-800">
      <h3 class="font-bold text-sm mb-2">Muscle Group Frequency (เดือนนี้)</h3>
      <canvas id="freqChart" height="180"></canvas>
    </section>`;
  setTimeout(()=>{ drawVolChart(); drawStrengthChart(); drawFreqChart(); },40);
}
function destroyChart(id){ if(charts[id]){ charts[id].destroy(); delete charts[id]; } }
const CH_GRID='rgba(148,163,184,.12)', CH_TXT='#94a3b8';

function drawVolChart(){
  destroyChart('vol');
  const weeks={};
  sessions.forEach(s=>{ const k=startOfWeek(new Date(s.date+'T00:00:00')).toISOString().slice(5,10); weeks[k]=(weeks[k]||0)+(s.totalVol||0); });
  const labels=Object.keys(weeks).slice(-8); const data=labels.map(l=>weeks[l]);
  charts['vol']=new Chart(el('volChart'),{type:'bar',
    data:{labels:labels.length?labels:['—'],datasets:[{data:data.length?data:[0],backgroundColor:'#6366f1',borderRadius:6}]},
    options:baseOpts()});
}
function drawStrengthChart(){
  destroyChart('str');
  const sel=el('exSelect'); const name=sel?sel.value:null; const h=name&&history[name];
  const note=el('strNote');
  if(!h||!h.length){ if(note) note.textContent=''; charts['str']=new Chart(el('strChart'),{type:'line',data:{labels:['—'],datasets:[{data:[0]}]},options:baseOpts()}); return; }
  const labels=h.map(s=>s.date.slice(5));
  const top=h.map(s=>Math.max(...s.sets.map(st=>st.w)));
  const e1rm=h.map(s=>Math.round(Math.max(...s.sets.map(st=>st.w*(1+st.r/30)))));
  charts['str']=new Chart(el('strChart'),{type:'line',
    data:{labels,datasets:[
      {label:'น้ำหนักสูงสุด',data:top,borderColor:'#f97316',backgroundColor:'rgba(249,115,22,.15)',tension:.3,fill:true},
      {label:'Est. 1RM',data:e1rm,borderColor:'#818cf8',borderDash:[5,4],tension:.3}
    ]},options:baseOpts(true)});
  if(note){ const best=Math.max(...e1rm); note.textContent=`Est. 1RM สูงสุด: ${best} kg · บันทึก ${h.length} ครั้ง`; }
}
function drawFreqChart(){
  destroyChart('freq');
  const now=new Date(); const m=now.getMonth(), y=now.getFullYear();
  const cnt={}; MUSCLE_GROUPS.forEach(g=>cnt[g]=0);
  sessions.forEach(s=>{ const d=new Date(s.date+'T00:00:00'); if(d.getMonth()===m&&d.getFullYear()===y){ Object.entries(s.byGroup||{}).forEach(([g,n])=>cnt[g]=(cnt[g]||0)+n); } });
  const data=MUSCLE_GROUPS.map(g=>cnt[g]);
  const colors=['#6366f1','#f97316','#10b981','#eab308','#ec4899','#06b6d4'];
  charts['freq']=new Chart(el('freqChart'),{type:'doughnut',
    data:{labels:MUSCLE_GROUPS,datasets:[{data:data.some(x=>x)?data:[1,1,1,1,1,1],backgroundColor:colors,borderWidth:0}]},
    options:{responsive:true,plugins:{legend:{position:'bottom',labels:{color:CH_TXT,boxWidth:12,padding:10,font:{size:11}}}}}});
}
function baseOpts(legend=false){
  return {responsive:true,plugins:{legend:{display:legend,labels:{color:CH_TXT,boxWidth:12,font:{size:11}}}},
    scales:{x:{ticks:{color:CH_TXT,font:{size:10}},grid:{color:CH_GRID}},
            y:{ticks:{color:CH_TXT,font:{size:10}},grid:{color:CH_GRID},beginAtZero:true}}};
}

/* ============================================================
   5) RECOVERY & FUEL
   ============================================================ */
function todayNutrition(){ return nutrition[todayISO()]||[]; }
function nutritionTotals(list){ return list.reduce((a,f)=>({protein:a.protein+(+f.protein||0),carb:a.carb+(+f.carb||0),fat:a.fat+(+f.fat||0),kcal:a.kcal+(+f.kcal||0)}),{protein:0,carb:0,fat:0,kcal:0}); }

function renderRecovery(){
  const list=todayNutrition(); const t=nutritionTotals(list);
  const rec=recovery[todayISO()]||{};
  const readiness=readinessScore();

  el('tab-recovery').innerHTML=`
    <h2 class="text-lg font-bold">Recovery & Fuel</h2>

    <section class="rounded-2xl p-5 bg-gradient-to-br from-slate-900 to-slate-900 border border-slate-800">
      <p class="text-xs text-slate-400 font-semibold">โปรตีนวันนี้</p>
      <p class="text-4xl font-extrabold text-emerald-400 mt-1">${t.protein}<span class="text-lg text-slate-400"> g</span></p>
      <div class="flex gap-4 mt-2 text-xs text-slate-400">
        <span>คาร์บ <b class="text-slate-200">${t.carb}g</b></span>
        <span>ไขมัน <b class="text-slate-200">${t.fat}g</b></span>
        <span>~<b class="text-slate-200">${t.kcal||(t.protein*4+t.carb*4+t.fat*9)}</b> kcal</span>
      </div>
      <button onclick="openFoodLog()" class="mt-4 w-full py-3 rounded-xl bg-emerald-600 active:bg-emerald-700 font-semibold">+ เพิ่มมื้ออาหาร</button>
      ${list.length?`<div class="mt-3 space-y-1.5">${list.map((f,i)=>`<div class="flex items-center justify-between text-sm bg-slate-800/50 rounded-lg px-3 py-2"><span class="truncate">${esc(f.name)}</span><span class="text-slate-400 text-xs shrink-0 ml-2">P${f.protein} C${f.carb} F${f.fat} <button onclick="delFood(${i})" class="text-red-400 ml-1">✕</button></span></div>`).join('')}</div>`:''}
    </section>

    <section class="rounded-2xl p-4 bg-slate-900 border border-slate-800">
      <h3 class="font-bold text-sm mb-3">เช็คความพร้อมวันนี้</h3>
      <p class="text-xs text-slate-400 mb-1">คุณภาพการนอน (1 แย่ – 5 ดีเยี่ยม)</p>
      <div class="flex gap-2 mb-3">${[1,2,3,4,5].map(n=>`<button onclick="setRecovery('sleep',${n})" class="flex-1 py-2.5 rounded-xl ${rec.sleep===n?'bg-brand-600':'bg-slate-800'} font-bold">${n}</button>`).join('')}</div>
      <p class="text-xs text-slate-400 mb-1">ความปวดล้ากล้ามเนื้อ (1 ไม่ปวด – 5 ปวดมาก)</p>
      <div class="flex gap-2">${[1,2,3,4,5].map(n=>`<button onclick="setRecovery('soreness',${n})" class="flex-1 py-2.5 rounded-xl ${rec.soreness===n?'bg-burn-500':'bg-slate-800'} font-bold">${n}</button>`).join('')}</div>
    </section>

    <section class="rounded-2xl p-5 ${readiness.tone} fadein">
      <div class="flex items-center gap-3">
        <div class="text-3xl">${readiness.icon}</div>
        <div><p class="text-xs font-semibold opacity-80">คำแนะนำการฝึกวันนี้</p>
          <p class="text-lg font-extrabold">${readiness.label}</p></div>
      </div>
      <p class="text-sm opacity-90 mt-2">${esc(readiness.body)}</p>
    </section>`;
}
function setRecovery(field,val){
  const d=todayISO(); recovery[d]=recovery[d]||{}; recovery[d][field]=val; saveLS(K.recovery,recovery);
  syncToSheet({type:'readiness',readiness:{date:d,sleep:recovery[d].sleep||'',soreness:recovery[d].soreness||''}},'บันทึกแล้ว');
  renderRecovery();
}
function openFoodLog(){
  openSheet(`
    <h3 class="text-lg font-bold mb-3">เพิ่มมื้ออาหาร</h3>
    <input id="fName" placeholder="ชื่ออาหาร (เช่น อกไก่ 200g)" class="w-full rounded-xl bg-slate-800 border border-slate-700 px-3 py-2.5 text-base mb-2 outline-none focus:border-brand-500">
    <div class="grid grid-cols-3 gap-2">
      <div><label class="text-[11px] text-slate-400">โปรตีน g</label><input id="fP" type="number" inputmode="decimal" value="0" class="mt-1 w-full rounded-xl bg-slate-800 border border-slate-700 px-2 py-2 text-base text-center outline-none focus:border-brand-500"></div>
      <div><label class="text-[11px] text-slate-400">คาร์บ g</label><input id="fC" type="number" inputmode="decimal" value="0" class="mt-1 w-full rounded-xl bg-slate-800 border border-slate-700 px-2 py-2 text-base text-center outline-none focus:border-brand-500"></div>
      <div><label class="text-[11px] text-slate-400">ไขมัน g</label><input id="fF" type="number" inputmode="decimal" value="0" class="mt-1 w-full rounded-xl bg-slate-800 border border-slate-700 px-2 py-2 text-base text-center outline-none focus:border-brand-500"></div>
    </div>
    <button onclick="saveFood()" class="w-full mt-4 py-3 rounded-xl bg-emerald-600 active:bg-emerald-700 font-semibold">บันทึก</button>`);
  setTimeout(()=>el('fName').focus(),60);
}
async function saveFood(){
  const name=el('fName').value.trim(); if(!name){ toast('ใส่ชื่ออาหาร',false); return; }
  const p=+el('fP').value||0,c=+el('fC').value||0,f=+el('fF').value||0;
  const rec={name,protein:p,carb:c,fat:f,kcal:Math.round(p*4+c*4+f*9)};
  const d=todayISO(); (nutrition[d]=nutrition[d]||[]).push(rec); saveLS(K.nutrition,nutrition); hide('sheetModal');
  await syncToSheet({type:'nutrition',nutrition:{date:d,...rec}},'บันทึกอาหารแล้ว');
  renderRecovery();
}
function delFood(i){ const d=todayISO(); if(nutrition[d]){ nutrition[d].splice(i,1); saveLS(K.nutrition,nutrition); renderRecovery(); } }

function readinessScore(){
  const r=recovery[todayISO()]||{};
  if(!r.sleep&&!r.soreness) return {label:'ยังไม่ได้ประเมิน',icon:'📝',tone:'bg-slate-900 border border-slate-800',body:'เลือกคะแนนการนอนและความปวดล้าด้านบนเพื่อรับคำแนะนำ'};
  const sleep=r.sleep||3, sore=r.soreness||3;
  const score=sleep+(6-sore); // 2..10
  if(score>=8) return {label:'Heavy Day 💪',icon:'🟢',tone:'bg-emerald-600/15 border border-emerald-700/40 text-emerald-100',body:'ร่างกายพร้อมเต็มที่ — ลุย Progressive Overload เพิ่มน้ำหนักได้เลย'};
  if(score>=5) return {label:'Moderate',icon:'🟡',tone:'bg-amber-500/15 border border-amber-600/40 text-amber-100',body:'พร้อมปานกลาง — ฝึกตามปกติ แต่ฟังร่างกาย อย่าฝืนสถิติถ้ารู้สึกล้า'};
  return {label:'Deload / เบาลง',icon:'🔴',tone:'bg-red-600/15 border border-red-700/40 text-red-100',body:'นอนน้อยและปวดล้าสูง — ลดน้ำหนัก 40-50% หรือเปลี่ยนเป็นเดิน Zone 2 เพื่อฟื้นฟู'};
}

/* ============================================================
   SMART SUGGESTION (rule-based)
   ============================================================ */
function smartSuggestion(){
  const c=weeklyCardio();
  const wd=new Date().getDay();
  const today=split[wd]||{};
  const r=recovery[todayISO()]||{};
  // recent recovery avg (last 3 days)
  let sl=[],so=[];
  for(let i=0;i<3;i++){ const d=new Date(); d.setDate(d.getDate()-i); const k=d.toISOString().slice(0,10);
    if(recovery[k]){ if(recovery[k].sleep) sl.push(recovery[k].sleep); if(recovery[k].soreness) so.push(recovery[k].soreness); } }
  const avgSleep=sl.length?sl.reduce((a,b)=>a+b)/sl.length:null;
  const avgSore=so.length?so.reduce((a,b)=>a+b)/so.length:null;

  if(avgSore!==null&&avgSore>=4 && avgSleep!==null&&avgSleep<=2)
    return {icon:'🔴',title:'ร่างกายล้าสะสม',body:'3 วันที่ผ่านมานอนน้อยและปวดล้าสูง — แนะนำ Deload หรือพักเพิ่ม เพื่อเลี่ยง Overtraining',tone:'bg-red-600/15 border border-red-700/40 text-red-100'};

  if(c.steady>settings.steadyTarget*1.2 || c.hiit>settings.hiitTarget)
    if(/leg|squat|lower/i.test(today.name||''))
      return {icon:'⚠️',title:'คาร์ดิโอสัปดาห์นี้เยอะ',body:'อาจกระทบแรงในการสควอท/ขา — วันนี้แนะนำเดิน Zone 2 แทน HIIT และโฟกัสฟอร์มการยก',tone:'bg-amber-500/15 border border-amber-600/40 text-amber-100'};

  const vol=weeklyVolumeByGroup();
  const lagging=MUSCLE_GROUPS.filter(g=>vol[g]<settings.volTarget*0.4);
  if((new Date().getDay()>=5) && lagging.length)
    return {icon:'📌',title:'เก็บวอลลุ่มยังไม่ครบ',body:`สัปดาห์นี้ ${lagging.join(', ')} ยังน้อย — อย่าลืมเก็บให้ครบเพื่อกล้ามเนื้อสมส่วน`,tone:'bg-brand-600/15 border border-brand-600/40 text-indigo-100'};

  return {icon:'✅',title:'พร้อมลุย!',body:'การฝึกสมดุลดี ทั้งเวทและคาร์ดิโอ รักษาความสม่ำเสมอไว้แบบนี้',tone:'bg-emerald-600/15 border border-emerald-700/40 text-emerald-100'};
}

/* ============================================================
   INIT
   ============================================================ */
(function init(){
  if(!localStorage.getItem(K.seeded)){ localStorage.setItem(K.seeded,'1'); saveLS(K.split,split); saveLS(K.lib,lib); saveLS(K.settings,settings); }
  updateHeaderSub();
  switchTab('home');
})();
