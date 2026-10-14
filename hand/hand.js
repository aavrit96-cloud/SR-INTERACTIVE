/* Sound Redefined: hand control for the interactive deck (v2).
   A webcam above the table watches one hand (MediaPipe Hand Landmarker, bundled offline in this folder).
   Point with the index finger = cursor.
   CLICK modes: TAP (dip the fingertip down onto the table), PINCH (thumb + index), DWELL (hold still),
   OFF (the PointWrite pen or touch does the clicking; the hand only waves).
   Whenever the pen or a real touch is used, hand clicks pause for a moment so the two never double up.
   Press and move = drag. Tap the glowing strips at the left and right edges for previous / next.
   Open hand, wave left = next slide. Open hand, wave right = previous slide.
   Keys: H panel, C calibrate, K next camera, D click mode, W waves on/off. */
(function(){
'use strict';
var BASE=(function(){var s=document.currentScript&&document.currentScript.src||'';return s.slice(0,s.lastIndexOf('/')+1);})();
var STORE='srhand.';
function lsGet(k,d){try{var v=localStorage.getItem(STORE+k);return v==null?d:JSON.parse(v);}catch(e){return d;}}
function lsSet(k,v){try{localStorage.setItem(STORE+k,JSON.stringify(v));}catch(e){}}

/* Tuning. SMOOTH and PINCH have three settings each, switchable from the panel. */
var SMOOTH={
  LOW:{mc:1.0, b:.004, ease:24, dead:.8},
  MED:{mc:.55, b:.0025,ease:15, dead:1.6},
  HIGH:{mc:.3, b:.0015,ease:9,  dead:2.6}
};
var PINCH={              /* thumb-to-index gap divided by knuckle width (index to pinky knuckle) */
  SOFT:{on:.34,off:.55},
  MED:{on:.26,off:.46},
  FIRM:{on:.19,off:.38}
};
var TAP={                /* index finger length seen from above, against its own relaxed length */
  SOFT:{down:.76,up:.87},
  MED:{down:.67,up:.81},
  FIRM:{down:.57,up:.73}
};
var CFG={
  confirm:3,             /* camera frames a pinch change must hold */
  lockR:18, lockMs:350,  /* after a pinch the cursor stays put until it moves this far or this long */
  slop:30,               /* px of movement still counted as a tap */
  dwellMs:1200, dwellR:24,
  wave:{win:520, dist:.16, ratio:1.8, speed:.6, cool:1100},  /* window ms, distance and speed in screen widths */
  calHoldMs:1000, calStill:.012,
  lostMs:350
};
var H={
  on:false, loading:false, ready:false, err:'',
  click:lsGet('click','TAP'), waves:lsGet('waves',true), base:0, dip:1,
  smooth:lsGet('smooth','MED'), pinch:lsGet('pinch','MED'),
  camId:lsGet('cam',null), M:lsGet('M',null),
  cams:[], camLabel:'', stream:null, video:null, lm:null, mode:'',
  hand:null, seen:0, fps:0, _fc:0, _ft:0, gap:0, open:false,
  tx:-999, ty:-999,      /* filtered target from the camera */
  x:-999, y:-999,        /* eased cursor on screen, updated every display frame */
  pressed:false, route:null, downX:0, downY:0, downT:0, locked:false,
  off:{x:0,y:0}, offT:0, hist:[], palm:[], waveT:0,
  dwellT:0, dwellX:0, dwellY:0, dwellArmed:true,
  cal:null, panel:false, visible:false
};
window.__srhand=H;

/* ---------- UI ---------- */
var css=document.createElement('style');
css.textContent=[
'#hcur{position:fixed;left:0;top:0;width:0;height:0;z-index:2147483000;pointer-events:none;opacity:0;transition:opacity .25s}',
'#hcur svg{position:absolute;left:-30px;top:-30px;width:60px;height:60px;overflow:visible;filter:drop-shadow(0 0 2px rgba(0,0,0,.9)) drop-shadow(0 0 6px rgba(0,0,0,.6))}',
'#hcur .r{fill:rgba(0,0,0,.18);stroke:#E8C4AE;stroke-width:2.2;transition:r .12s ease}',
'#hcur .d{fill:#EECAB8;transition:r .12s ease}',
'#hcur .a{fill:none;stroke:#E8C4AE;stroke-width:3;stroke-linecap:round;transform:rotate(-90deg);transform-origin:30px 30px}',
'#hcur.o{opacity:.35!important}',
'.hz{position:fixed;z-index:2147482800;pointer-events:none;opacity:0;transition:opacity .3s ease;display:flex;align-items:center;justify-content:center}',
'.hz.l{background:linear-gradient(90deg,rgba(212,150,125,.20),rgba(212,150,125,0))}.hz.r{background:linear-gradient(270deg,rgba(212,150,125,.20),rgba(212,150,125,0))}',
'.hz svg{width:62px;height:62px;filter:drop-shadow(0 0 4px rgba(0,0,0,.8))}',
'.hz.v{opacity:.5}.hz.h{opacity:1}.hz.h.l{background:linear-gradient(90deg,rgba(212,150,125,.42),rgba(212,150,125,0))}.hz.h.r{background:linear-gradient(270deg,rgba(212,150,125,.42),rgba(212,150,125,0))}',
'#hwave{position:fixed;top:50%;z-index:2147482900;pointer-events:none;opacity:0;transform:translateY(-50%);font-family:P,Poppins,system-ui,sans-serif;font-size:13px;font-weight:700;letter-spacing:5px;color:#E8C4AE;display:flex;align-items:center;gap:18px;transition:opacity .35s ease,transform .35s ease}',
'#hwave svg{width:84px;height:84px}',
'#hwave.l{left:48px}#hwave.r{right:48px;flex-direction:row-reverse}',
'#hwave.on{opacity:1}',
'#hpanel,#hcal{font-family:P,Poppins,system-ui,sans-serif;color:#E8C4AE;letter-spacing:2.5px}',
'#hpanel{position:fixed;right:24px;top:24px;z-index:2147482000;width:400px;padding:18px;background:rgba(0,0,0,.88);border:1px solid rgba(212,150,125,.45);border-radius:6px;display:none}',
'#hpanel.on{display:block}',
'#hpanel h4{margin:0 0 12px;font-size:12px;font-weight:700;letter-spacing:4px}',
'#hpanel canvas{display:block;width:100%;background:#111;border-radius:3px}',
'#hpanel .st{font-size:10.5px;color:#8d7f76;margin:10px 0 12px;line-height:1.7;letter-spacing:1.5px}',
'#hpanel .row{display:flex;flex-wrap:wrap;gap:8px}',
'#hpanel button,#hcal button{all:unset;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:3px;padding:10px 12px;border:1px solid rgba(212,150,125,.55);border-radius:3px;color:#E8C4AE}',
'#hpanel button b{color:#FAF7F4}',
'#hcal{position:fixed;inset:0;z-index:2147482500;background:rgba(0,0,0,.92);display:none}',
'#hcal.on{display:block}',
'#hcal .t{position:absolute;width:0;height:0}',
'#hcal .t svg{position:absolute;left:-46px;top:-46px;width:92px;height:92px;overflow:visible}',
'#hcal .msg{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;width:min(640px,80vw)}',
'#hcal .msg h3{margin:0 0 10px;font-size:22px;font-weight:400;letter-spacing:2px;color:#FAF7F4}',
'#hcal .msg p{margin:0 0 18px;font-size:12px;color:#8d7f76;letter-spacing:2px;line-height:1.8}',
'#hcal canvas{display:block;margin:0 auto 18px;width:320px;background:#111;border-radius:3px}'
].join('\n');
document.head.appendChild(css);

var cur=document.createElement('div'); cur.id='hcur';
cur.innerHTML='<svg viewBox="0 0 60 60"><circle class="r" cx="30" cy="30" r="20"/><circle class="a" cx="30" cy="30" r="26" pathLength="1" stroke-dasharray="0 1"/><circle class="d" cx="30" cy="30" r="3.5"/></svg>';
document.body.appendChild(cur);
var curR=cur.querySelector('.r'), curD=cur.querySelector('.d'), curA=cur.querySelector('.a');

function zoneEl(dir){var z=document.createElement('div');z.className='hz '+(dir>0?'r':'l');
  z.innerHTML='<svg viewBox="0 0 54 54" fill="none"><circle cx="27" cy="27" r="25.5" stroke="#D4967D" stroke-width="1.5"/><path d="'+(dir>0?'M23 17 L33 27 L23 37':'M31 17 L21 27 L31 37')+'" stroke="#E8C4AE" stroke-width="2"/></svg>';
  document.body.appendChild(z);return z;}
var zones={'-1':zoneEl(-1),'1':zoneEl(1)}, zoneRect={};
var ZONE_W=130;           /* stage px */
function layoutZones(){
  var st=document.getElementById('stage'); if(!st) return;
  var r=st.getBoundingClientRect(), w=ZONE_W*r.width/1920;
  zoneRect['-1']={l:r.left,t:r.top,w:w,h:r.height}; zoneRect['1']={l:r.right-w,t:r.top,w:w,h:r.height};
  [-1,1].forEach(function(d){var z=zones[d],q=zoneRect[d];z.style.left=q.l+'px';z.style.top=q.t+'px';z.style.width=q.w+'px';z.style.height=q.h+'px';});
}
function zoneAt(x,y){for(var d in zoneRect){var q=zoneRect[d];if(x>=q.l&&x<=q.l+q.w&&y>=q.t&&y<=q.t+q.h)return +d;}return 0;}
window.addEventListener('resize',layoutZones); setTimeout(layoutZones,50);
var waveEl=document.createElement('div'); waveEl.id='hwave'; document.body.appendChild(waveEl);
function waveShow(dir){
  var ring='<svg viewBox="0 0 54 54" fill="none"><circle cx="27" cy="27" r="25.5" stroke="#D4967D" stroke-width="1.5"/><path d="'+(dir>0?'M23 17 L33 27 L23 37':'M31 17 L21 27 L31 37')+'" stroke="#E8C4AE" stroke-width="2"/></svg>';
  waveEl.className=dir>0?'r':'l'; waveEl.innerHTML=dir>0?ring+'<span>NEXT</span>':ring+'<span>PREVIOUS</span>';
  void waveEl.offsetWidth; waveEl.classList.add('on');
  clearTimeout(waveShow.t); waveShow.t=setTimeout(function(){waveEl.classList.remove('on');},650);
}

var panel=document.createElement('div'); panel.id='hpanel';
panel.innerHTML='<h4>HAND CONTROL</h4><canvas id="hprev" width="640" height="360"></canvas><div class="st" id="hst">Off</div>'+
 '<div class="row"><button id="hb-on">HANDS <b>OFF</b></button><button id="hb-cal">CALIBRATE</button><button id="hb-cam">CAMERA</button>'+
 '<button id="hb-dw">CLICK <b>TAP</b></button><button id="hb-pi">SENS <b>MED</b></button><button id="hb-sm">SMOOTH <b>MED</b></button>'+
 '<button id="hb-wv">WAVES <b>ON</b></button><button id="hb-x">CLOSE</button></div>';
document.body.appendChild(panel);
var prev=panel.querySelector('#hprev'), pctx=prev.getContext('2d'), st=panel.querySelector('#hst');

var calEl=document.createElement('div'); calEl.id='hcal';
calEl.innerHTML='<div class="t" id="hct"><svg viewBox="0 0 92 92"><circle cx="46" cy="46" r="30" fill="none" stroke="#D4967D" stroke-width="1.6"/><circle cx="46" cy="46" r="4.6" fill="#EECAB8"/><circle id="hcp" cx="46" cy="46" r="40" fill="none" stroke="#E8C4AE" stroke-width="3" stroke-linecap="round" pathLength="1" stroke-dasharray="0 1" transform="rotate(-90 46 46)"/></svg></div>'+
 '<div class="msg"><canvas id="hcprev" width="640" height="360"></canvas><h3 id="hch">Point at the ring</h3><p id="hcm">Rest your index fingertip on the ring and hold still.</p><button id="hc-x">CANCEL</button></div>';
document.body.appendChild(calEl);
var calT=calEl.querySelector('#hct'), calP=calEl.querySelector('#hcp'), calH=calEl.querySelector('#hch'), calM=calEl.querySelector('#hcm'), cprev=calEl.querySelector('#hcprev'), cctx=cprev.getContext('2d');

(function(){var opts=document.getElementById('opts'); if(!opts) return;
  var b=document.createElement('button'); b.id='hands'; b.innerHTML='HANDS <b>OFF</b>';
  b.addEventListener('click',function(){togglePanel();}); opts.appendChild(b);})();

function cycle(list,v){var i=list.indexOf(v);return list[(i+1)%list.length];}
function label(){
  var b=document.getElementById('hands'); if(b) b.innerHTML='HANDS <b>'+(H.on?(H.ready?'ON':'…'):'OFF')+'</b>';
  panel.querySelector('#hb-on').innerHTML='HANDS <b>'+(H.on?'ON':'OFF')+'</b>';
  panel.querySelector('#hb-dw').innerHTML='CLICK <b>'+H.click+'</b>';
  panel.querySelector('#hb-wv').innerHTML='WAVES <b>'+(H.waves?'ON':'OFF')+'</b>';
  panel.querySelector('#hb-sm').innerHTML='SMOOTH <b>'+H.smooth+'</b>';
  panel.querySelector('#hb-pi').innerHTML='SENS <b>'+H.pinch+'</b>';
}
function status(){
  var s;
  if(H.err) s='Problem: '+H.err;
  else if(!H.on) s='Off. Press HANDS to start the camera.';
  else if(H.loading) s='Loading hand tracking…';
  else{
    var cam=H.video&&H.video.videoWidth?H.video.videoWidth+'x'+H.video.videoHeight:'';
    s=(H.camLabel||'Camera')+' '+cam+'<br>'+(H.hand?(H.open?'Open hand':(H.pressed?'Pressing':'Hand found'))+(H.click==='PINCH'?' · pinch '+H.gap.toFixed(2):' · finger '+H.dip.toFixed(2)):'No hand in view')+
      ' · '+H.fps+' fps'+(H.fps&&H.fps<20?' (low, add light)':'')+'<br>'+(H.M?'Calibrated':'Not calibrated, press CALIBRATE')+(H.mode?' · '+H.mode:'');
  }
  st.innerHTML=s;
}
function togglePanel(force){
  H.panel=force==null?!H.panel:force; panel.classList.toggle('on',H.panel);
  if(H.panel&&!H.on) start();
  status();
}
function setSmooth(v){H.smooth=v;lsSet('smooth',v);fx=new OneEuro();fy=new OneEuro();label();}
panel.querySelector('#hb-on').addEventListener('click',function(){if(H.on)stop();else start();});
panel.querySelector('#hb-cal').addEventListener('click',function(){calibrate();});
panel.querySelector('#hb-cam').addEventListener('click',function(){nextCam();});
panel.querySelector('#hb-sm').addEventListener('click',function(){setSmooth(cycle(['LOW','MED','HIGH'],H.smooth));});
panel.querySelector('#hb-pi').addEventListener('click',function(){H.pinch=cycle(['SOFT','MED','FIRM'],H.pinch);lsSet('pinch',H.pinch);label();});
panel.querySelector('#hb-wv').addEventListener('click',function(){H.waves=!H.waves;lsSet('waves',H.waves);label();});
function nextClick(){H.click=cycle(['TAP','PINCH','DWELL','OFF'],H.click);lsSet('click',H.click);release(true);label();status();}
panel.querySelector('#hb-dw').addEventListener('click',nextClick);
panel.querySelector('#hb-x').addEventListener('click',function(){togglePanel(false);});
calEl.querySelector('#hc-x').addEventListener('click',function(){endCal(false);});

/* pen / touch / mouse from PointWrite: trusted events in the deck itself, or reported by the slides */
H.realT=0;
function real(){H.realT=performance.now(); if(H.pressed) release(true);}
window.addEventListener('pointerdown',function(e){if(e.isTrusted) real();},true);
window.addEventListener('message',function(e){var d=e.data||{}; if(d.sr==='real') real();});
function penActive(){return performance.now()-H.realT<2500;}
function onKey(k){
  if(k==='h'||k==='H') togglePanel();
  else if(k==='c'||k==='C') calibrate();
  else if(k==='k'||k==='K') nextCam();
  else if(k==='d'||k==='D') nextClick();
  else if(k==='w'||k==='W'){H.waves=!H.waves;lsSet('waves',H.waves);label();}
  else if(k==='Escape'&&H.cal) endCal(false);
}
window.addEventListener('keydown',function(e){onKey(e.key);});
window.addEventListener('message',function(e){var d=e.data||{}; if(d.sr==='key') onKey(d.key);});

/* ---------- loading the bundled MediaPipe (works from file:// and offline) ---------- */
function script(name){return new Promise(function(ok,no){var s=document.createElement('script');s.src=BASE+name;s.onload=ok;s.onerror=function(){no(new Error('missing '+name));};document.head.appendChild(s);});}
function blobOf(b64,type){return fetch('data:'+type+';base64,'+b64).then(function(r){return r.blob();}).then(function(b){return new Blob([b],{type:type});});}
var vision=null;
function loadVision(){
  if(vision) return vision;
  vision=(async function(){
    var MPB=window.__MPB||{};
    if(!MPB.core) await script('mp_core.js');
    if(!MPB.loader) await script('mp_loader.js');
    if(!MPB.wasm) await script('mp_wasm.js');
    if(!MPB.model) await script('mp_model.js');
    MPB=window.__MPB;
    var mod=URL.createObjectURL(await blobOf(MPB.core,'text/javascript'));
    var loader=URL.createObjectURL(await blobOf(MPB.loader,'text/javascript'));
    var wasm=URL.createObjectURL(await blobOf(MPB.wasm,'application/wasm'));
    var model=new Uint8Array(await (await blobOf(MPB.model,'application/octet-stream')).arrayBuffer());
    MPB.core=MPB.loader=MPB.wasm=MPB.model=null;
    var V=await import(mod);
    var files={wasmLoaderPath:loader,wasmBinaryPath:wasm};
    var opts=function(dev){return{baseOptions:{modelAssetBuffer:model,delegate:dev},runningMode:'VIDEO',numHands:2,
      minHandDetectionConfidence:.6,minHandPresenceConfidence:.55,minTrackingConfidence:.55};};
    var lm;
    try{lm=await V.HandLandmarker.createFromOptions(files,opts('GPU'));H.mode='GPU';}
    catch(e){lm=await V.HandLandmarker.createFromOptions(files,opts('CPU'));H.mode='CPU';}
    return lm;
  })();
  vision.catch(function(){vision=null;});
  return vision;
}

/* ---------- camera ---------- */
var BUILTIN=/facetime|built-?in|integrated|iphone|continuity|desk view|virtual|obs/i;
async function listCams(){
  var all=await navigator.mediaDevices.enumerateDevices();
  H.cams=all.filter(function(d){return d.kind==='videoinput';});
}
async function openCam(id){
  if(H.stream){H.stream.getTracks().forEach(function(t){t.stop();});H.stream=null;}
  var c={width:{ideal:1280},height:{ideal:720},frameRate:{ideal:60,min:24}};
  if(id) c.deviceId={exact:id};
  var s;
  try{s=await navigator.mediaDevices.getUserMedia({video:c,audio:false});}
  catch(e){delete c.frameRate.min;s=await navigator.mediaDevices.getUserMedia({video:c,audio:false});}
  H.stream=s;
  var tr=s.getVideoTracks()[0]; H.camLabel=tr.label||'Camera'; H.camId=(tr.getSettings&&tr.getSettings().deviceId)||id||null;
  if(!H.video){H.video=document.createElement('video');H.video.muted=true;H.video.playsInline=true;}
  H.video.srcObject=s; await H.video.play();
}
async function pickCam(){
  try{await openCam(H.camId);}catch(e){H.camId=null;await openCam(null);}
  await listCams();
  if(!lsGet('cam',null)){
    var ext=H.cams.filter(function(d){return !BUILTIN.test(d.label);});
    if(ext.length&&ext[0].deviceId!==H.camId){await openCam(ext[0].deviceId);}
  }
  lsSet('cam',H.camId);
}
async function nextCam(){
  if(!H.on){start();return;}
  await listCams(); if(H.cams.length<2) return;
  var i=H.cams.findIndex(function(d){return d.deviceId===H.camId;});
  var n=H.cams[(i+1)%H.cams.length];
  try{await openCam(n.deviceId);lsSet('cam',H.camId);}catch(e){H.err='camera '+e.message;}
  status();
}

/* ---------- start / stop ---------- */
async function start(){
  if(H.on||H.loading) return;
  H.on=true; H.loading=true; H.err=''; label(); status();
  try{
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia) throw new Error('this browser has no camera access here');
    var lmP=loadVision();
    await pickCam();
    H.lm=await lmP;
    H.loading=false; H.ready=true; lsSet('auto',true);
    requestAnimationFrame(loop);
  }catch(e){H.loading=false;H.on=false;H.ready=false;H.err=(e&&e.message)||String(e);}
  label(); status();
}
function stop(){
  release(true);
  H.on=false; H.ready=false; lsSet('auto',false);
  if(H.stream){H.stream.getTracks().forEach(function(t){t.stop();});H.stream=null;}
  H.visible=false; cur.style.opacity=0; label(); status();
}

/* ---------- main loop: detect on each new camera frame, animate on every display frame ---------- */
var lastVT=-1, lastRAF=0;
function loop(now){
  if(!H.on) return;
  var v=H.video;
  if(v&&v.readyState>=2&&v.currentTime!==lastVT&&H.lm&&H.lm.detectForVideo){
    lastVT=v.currentTime;
    var t=performance.now(), res=null;
    try{res=H.lm.detectForVideo(v,t);}catch(e){}
    if(res) frame(res.landmarks||[],t,v.videoWidth,v.videoHeight);
    H._fc++; if(t-H._ft>1000){H.fps=H._fc;H._fc=0;H._ft=t;if(H.panel)status();}
    if(H.panel) draw(pctx,prev,res);
    if(H.cal) draw(cctx,cprev,res);
  }
  animate(now||performance.now());
  requestAnimationFrame(loop);
}
function draw(ctx,cv,res){
  var v=H.video; ctx.drawImage(v,0,0,cv.width,cv.height);
  ctx.fillStyle='rgba(0,0,0,.25)'; ctx.fillRect(0,0,cv.width,cv.height);
  if(!res||!res.landmarks) return;
  res.landmarks.forEach(function(L){
    ctx.fillStyle=(L===H.hand)?'#E8C4AE':'#8d7f76';
    L.forEach(function(p,j){ctx.beginPath();ctx.arc(p.x*cv.width,p.y*cv.height,(j===8||j===4)?6:3,0,7);ctx.fill();});
  });
}

/* one-euro filter: calm when still, quick when moving */
function OneEuro(){this.x=null;this.dx=0;this.t=0;}
OneEuro.prototype.f=function(x,t){
  var S=SMOOTH[H.smooth]||SMOOTH.MED;
  if(this.x==null){this.x=x;this.t=t;return x;}
  var dt=Math.max(1e-3,(t-this.t)/1000); this.t=t;
  var a=function(c){var r=2*Math.PI*c*dt;return r/(r+1);};
  var dx=(x-this.x)/dt; this.dx+=a(1)*(dx-this.dx);
  var c=S.mc+S.b*Math.abs(this.dx); this.x+=a(c)*(x-this.x); return this.x;
};
var fx=new OneEuro(), fy=new OneEuro(), fax=new OneEuro(), fay=new OneEuro();

function d2(a,b,w,h){var dx=(a.x-b.x)*w,dy=(a.y-b.y)*h;return Math.sqrt(dx*dx+dy*dy);}
function mapCam(x,y){
  var M=H.M;
  if(!M) return [x*innerWidth,y*innerHeight];
  var w=M[6]*x+M[7]*y+1, u=(M[0]*x+M[1]*y+M[2])/w, v=(M[3]*x+M[4]*y+M[5])/w;
  return [u*innerWidth,v*innerHeight];
}
/* a finger counts as straight when its tip is well beyond its middle joint, seen from the wrist */
function straight(L,tip,pip,w,h){return d2(L[0],L[tip],w,h)>d2(L[0],L[pip],w,h)*1.18;}
function isOpen(L,w,h){
  var n=(straight(L,8,6,w,h)?1:0)+(straight(L,12,10,w,h)?1:0)+(straight(L,16,14,w,h)?1:0)+(straight(L,20,18,w,h)?1:0);
  return n>=4;
}

var votes=0;
function frame(hands,now,vw,vh){
  var pick=null,best=1e9;
  hands.forEach(function(L){var p=mapCam(L[8].x,L[8].y),d=Math.hypot(p[0]-H.tx,p[1]-H.ty);if(d<best){best=d;pick=L;}});
  if(!pick){
    H.hand=null;
    if(now-H.seen>CFG.lostMs){ if(H.pressed) release(true); H.visible=false; fx.x=fy.x=fax.x=fay.x=null; H.dwellT=0; H.palm=[]; H.base=0; }
    if(H.cal) calTick(null,now);
    return;
  }
  H.hand=pick; H.seen=now;
  if(H.cal){calTick(pick,now);return;}

  /* pointer: mostly the fingertip, a little of the joint below it, which shakes less */
  var px=pick[8].x*.75+pick[7].x*.25, py=pick[8].y*.75+pick[7].y*.25;
  var raw=mapCam(px,py);
  var fxv=fx.f(raw[0],now), fyv=fy.f(raw[1],now);
  /* the knuckles barely move when a finger dips or pinches, so while pressed the cursor follows them instead */
  var an=mapCam((pick[5].x+pick[9].x+pick[13].x+pick[0].x)/4,(pick[5].y+pick[9].y+pick[13].y+pick[0].y)/4);
  var ax=fax.f(an[0],now), ay=fay.f(an[1],now);
  if(!H.visible){H.x=fxv;H.y=fyv;}
  H.visible=true;
  if(H.pressed){H.tx=H.c0x+(ax-H.a0x);H.ty=H.c0y+(ay-H.a0y);}
  else{H.tx=fxv;H.ty=fyv;}
  H.hist.push({t:now,x:H.x,y:H.y}); while(H.hist.length&&now-H.hist[0].t>400) H.hist.shift();

  /* pinch: thumb-index gap against knuckle width, which stays steady when seen from above */
  var knuckles=d2(pick[5],pick[17],vw,vh)||1;
  H.gap=d2(pick[4],pick[8],vw,vh)/knuckles;
  var P=PINCH[H.pinch]||PINCH.MED, T=TAP[H.pinch]||TAP.MED;
  H.open=isOpen(pick,vw,vh)&&H.gap>P.off;

  /* finger dip: from above, the index finger looks shorter the moment it points down at the table.
     Compared with its own relaxed length, which follows slow changes but not a quick poke. */
  var len=d2(pick[5],pick[8],vw,vh)/knuckles;
  if(!H.pressed) H.base=H.base?Math.max(H.base*.993,len):len;
  H.dip=H.base?len/H.base:1;

  /* waves: an open hand sweeping sideways */
  if(H.waves&&!H.pressed&&wave(pick,now)) return;

  var want=H.pressed;
  if(penActive()||H.click==='OFF') want=false;
  else if(H.click==='TAP') want=H.pressed?(H.dip<T.up):(H.dip<T.down&&!H.open);
  else if(H.click==='PINCH') want=H.pressed?(H.gap<P.off):(H.gap<P.on);
  if(want!==H.pressed) votes++; else votes=0;
  if(votes>=(H.click==='TAP'?2:CFG.confirm)){
    votes=0;
    if(!H.pressed&&!H.open){
      /* the fingertip shifts as the finger dips or pinches: press where the ring was a moment before */
      var back=H.hist[0]; for(var i=H.hist.length-1;i>=0;i--){if(now-H.hist[i].t>=140){back=H.hist[i];break;}}
      H.c0x=back.x; H.c0y=back.y; H.a0x=ax; H.a0y=ay;
      H.off={x:0,y:0}; H.offT=0; H.tx=back.x; H.ty=back.y;
      H.x=back.x; H.y=back.y; press(now);
    }else if(H.pressed){
      release(false);
      /* glide back from the press point to the fingertip instead of jumping */
      H.off={x:H.x-fxv,y:H.y-fyv}; H.offT=now; H.tx=fxv; H.ty=fyv;
    }
  }
}
function wave(L,now){
  var c=mapCam((L[0].x+L[5].x+L[9].x+L[13].x+L[17].x)/5,(L[0].y+L[5].y+L[9].y+L[13].y+L[17].y)/5);
  if(!H.open){H.palm=[];return false;}
  H.palm.push({t:now,x:c[0],y:c[1]}); while(H.palm.length&&now-H.palm[0].t>CFG.wave.win) H.palm.shift();
  if(now-H.waveT<CFG.wave.cool||H.palm.length<4) return false;
  var b=H.palm[H.palm.length-1], W=innerWidth, hit=0;
  /* compare the newest position with every earlier one, so a pause before the sweep does not slow it down */
  for(var i=0;i<H.palm.length-1&&!hit;i++){
    var a=H.palm[i], dx=b.x-a.x, dy=b.y-a.y, dt=Math.max(1,b.t-a.t)/1000;
    if(Math.abs(dx)>CFG.wave.dist*W&&Math.abs(dx)>CFG.wave.ratio*Math.abs(dy)&&Math.abs(dx)/dt>CFG.wave.speed*W) hit=dx<0?1:-1;
  }
  if(hit){
    H.waveT=now; H.palm=[]; H.dwellT=0; H.dwellArmed=false;
    var dir=hit;                     /* hand moves left = next, right = previous */
    var b2=document.getElementById(dir>0?'next':'prev'); if(b2) b2.click();
    waveShow(dir);
    return true;
  }
  return false;
}

/* every display frame: glide the cursor toward the target and feed drags */
function animate(now){
  var dt=Math.min(.05,Math.max(.001,(now-(lastRAF||now))/1000)); lastRAF=now;
  if(!H.visible||H.click==='OFF'||penActive()){cur.style.opacity=0;zones['-1'].className='hz l';zones['1'].className='hz r';if(!H.visible)return;}
  var S=SMOOTH[H.smooth]||SMOOTH.MED;
  var k=1; if(!H.pressed&&H.offT){k=Math.max(0,1-(performance.now()-H.offT)/220);if(k===0){H.offT=0;H.off={x:0,y:0};}}
  var gx=H.tx+H.off.x*k, gy=H.ty+H.off.y*k;
  if(H.pressed&&H.locked){
    if(Math.hypot(gx-H.downX,gy-H.downY)>CFG.lockR||performance.now()-H.downT>CFG.lockMs) H.locked=false;
    else{gx=H.downX;gy=H.downY;}
  }
  var e=1-Math.exp(-S.ease*dt), nx=H.x+(gx-H.x)*e, ny=H.y+(gy-H.y)*e;
  if(Math.hypot(nx-H.x,ny-H.y)>S.dead*e||H.pressed){H.x=nx;H.y=ny;}
  if(H.pressed&&!H.locked) send('move');
  dwell(performance.now());
  if(H.click==='OFF'||penActive()) return;
  var zh=H.pressed?0:zoneAt(H.x,H.y);
  zones['-1'].className='hz l v'+(zh===-1?' h':''); zones['1'].className='hz r v'+(zh===1?' h':'');
  paint();
}
function paint(){
  cur.style.opacity=1;
  cur.classList.toggle('o',H.open&&!H.pressed);
  cur.style.transform='translate('+H.x.toFixed(1)+'px,'+H.y.toFixed(1)+'px)';
  curR.setAttribute('r',H.pressed?12:20); curD.setAttribute('r',H.pressed?6:3.5);
}
function dwell(now){
  var p=0;
  if(H.click==='DWELL'&&!H.pressed&&!H.open&&!penActive()){
    var moved=Math.hypot(H.x-H.dwellX,H.y-H.dwellY);
    if(moved>CFG.dwellR){H.dwellX=H.x;H.dwellY=H.y;H.dwellT=now;if(moved>CFG.dwellR*2)H.dwellArmed=true;}
    else if(H.dwellArmed&&H.dwellT){
      p=Math.min(1,(now-H.dwellT)/CFG.dwellMs);
      if(p>=1){H.dwellArmed=false;p=0;press(now);release(false);}
    }
  }
  curA.setAttribute('stroke-dasharray',p.toFixed(3)+' 1');
}

/* ---------- turning presses into pointer events ---------- */
function local(f,x,y){var r=f.getBoundingClientRect();return{x:(x-r.left)*1920/r.width,y:(y-r.top)*1080/r.height};}
function pe(type,el,x,y,down){
  el.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,composed:true,view:window,clientX:x,clientY:y,screenX:x,screenY:y,
    pointerId:41,pointerType:'touch',isPrimary:true,width:20,height:20,pressure:down?.5:0,button:type==='pointermove'?-1:0,buttons:down?1:0}));
}
function press(now){
  H.pressed=true; H.locked=true; H.downX=H.x; H.downY=H.y; H.downT=now||performance.now();
  layoutZones();
  var z=zoneAt(H.x,H.y);
  if(z){H.route={z:z}; var b=document.getElementById(z>0?'next':'prev'); if(b) b.click(); waveShow(z); return;}
  var el=document.elementFromPoint(H.x,H.y)||document.body;
  H.route=el.tagName==='IFRAME'?{f:el}:{el:el};
  send('down');
}
function send(t){
  var r=H.route; if(!r||r.z) return;
  if(r.f){var p=local(r.f,H.x,H.y);try{r.f.contentWindow.postMessage({sr:'hand',t:t,x:p.x,y:p.y,slop:CFG.slop*1920/r.f.getBoundingClientRect().width},'*');}catch(e){}}
  else{
    var el=r.el;
    if(t==='down') pe('pointerdown',el,H.x,H.y,true);
    else if(t==='move') pe('pointermove',el,H.x,H.y,true);
    else if(t==='up'){
      pe('pointerup',el,H.x,H.y,false);
      var u=document.elementFromPoint(H.x,H.y);
      if(Math.hypot(H.x-H.downX,H.y-H.downY)<CFG.slop&&u&&(u===el||el.contains(u)||u.contains(el)))
        el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window,clientX:H.x,clientY:H.y}));
    }
    else if(t==='cancel') pe('pointercancel',el,H.x,H.y,false);
  }
}
function release(cancel){
  if(!H.pressed) return;
  if(H.locked){H.x=H.downX;H.y=H.downY;}
  H.pressed=false; H.locked=false; send(cancel?'cancel':'up'); H.route=null; if(H.visible) paint();
}

/* ---------- calibration: four rings, fingertip held on each ---------- */
var CAL_PTS=[[.1,.1],[.9,.1],[.9,.9],[.1,.9]];
function calibrate(){
  if(!H.on){start().then(function(){if(H.on)calibrate();});return;}
  release(true); H.visible=false; cur.style.opacity=0;
  H.cal={i:0,got:[],buf:[],pause:0};
  calEl.classList.add('on'); calShow();
}
function calShow(){
  var c=H.cal, p=CAL_PTS[c.i];
  calT.style.left=(p[0]*100)+'%'; calT.style.top=(p[1]*100)+'%';
  calH.textContent='Point at the ring  '+(c.i+1)+' / 4';
  calM.textContent='Rest your index fingertip on the ring and hold still.';
  calP.setAttribute('stroke-dasharray','0 1');
}
function calTick(L,now){
  var c=H.cal; if(!c) return;
  if(now<c.pause) return;
  if(!L){c.buf=[];calP.setAttribute('stroke-dasharray','0 1');return;}
  var tip={x:L[8].x*.75+L[7].x*.25,y:L[8].y*.75+L[7].y*.25,t:now};
  for(var g=0;g<c.got.length;g++){if(Math.hypot(tip.x-c.got[g][0],tip.y-c.got[g][1])<.06){c.buf=[];calP.setAttribute('stroke-dasharray','0 1');return;}}
  c.buf.push(tip); while(c.buf.length&&now-c.buf[0].t>CFG.calHoldMs) c.buf.shift();
  var mx=0,my=0; c.buf.forEach(function(b){mx+=b.x;my+=b.y;}); mx/=c.buf.length; my/=c.buf.length;
  var wander=0; c.buf.forEach(function(b){wander=Math.max(wander,Math.hypot(b.x-mx,b.y-my));});
  if(wander>CFG.calStill){c.buf=[tip];}
  var prog=Math.min(1,(c.buf[c.buf.length-1].t-c.buf[0].t)/(CFG.calHoldMs*.95));
  calP.setAttribute('stroke-dasharray',prog.toFixed(3)+' 1');
  if(prog>=1){
    c.got.push([mx,my]); c.buf=[]; c.i++;
    if(c.i>=CAL_PTS.length){
      var M=homography(c.got,CAL_PTS);
      if(M){H.M=M;lsSet('M',M);endCal(true);}
      else{calM.textContent='That did not line up. Starting again.';c.i=0;c.got=[];c.pause=now+900;setTimeout(calShow,900);}
    }else{c.pause=now+500;calShow();}
  }
}
function endCal(ok){
  H.cal=null; calEl.classList.remove('on'); status();
  if(ok){fx.x=fy.x=null;}
}
function homography(src,dst){
  var A=[],b=[];
  for(var i=0;i<4;i++){
    var x=src[i][0],y=src[i][1],u=dst[i][0],v=dst[i][1];
    A.push([x,y,1,0,0,0,-u*x,-u*y]); b.push(u);
    A.push([0,0,0,x,y,1,-v*x,-v*y]); b.push(v);
  }
  for(var c=0;c<8;c++){
    var p=c; for(var r=c+1;r<8;r++) if(Math.abs(A[r][c])>Math.abs(A[p][c])) p=r;
    if(Math.abs(A[p][c])<1e-9) return null;
    var t=A[c];A[c]=A[p];A[p]=t; t=b[c];b[c]=b[p];b[p]=t;
    for(r=0;r<8;r++){ if(r===c) continue; var f=A[r][c]/A[c][c]; for(var k=c;k<8;k++) A[r][k]-=f*A[c][k]; b[r]-=f*b[c]; }
  }
  return b.map(function(v,i){return v/A[i][i];});
}

/* test hook: feed fake hands without a camera */
H.feed=function(hands,vw,vh){frame(hands,performance.now(),vw||1280,vh||720);};
H.CFG=CFG; H.SMOOTH=SMOOTH; H.PINCH=PINCH; H.TAP=TAP;

label(); status();
if(lsGet('auto',false)) setTimeout(start,400);
})();
