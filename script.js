// script.js — bird.png sprite animation + timed flock behaviour (50 birds, 15s)
// MindAR integration: wait for targets.mind, targetFound -> start existing 15s 50-bird animation anchored to image

const settings = {
  birdCount: 50,
  birdSize: 1.0,
  flightSpeed: 1.0,
  flapBaseSpeed: 1.0,
  flapBaseAmount: 1.0,
  glideMinSec: 1.2,
  glideMaxSec: 3.6,
  areaRadius: 28,
  cameraDistance: 35,
  maxBirds: 50
};

// --------------------
// DOM
// --------------------
const video = document.getElementById("cameraFeed");
const canvas = document.getElementById("c");
const startBtn = document.getElementById("startCam");
const resetCamBtn = document.getElementById("resetCam");

// --------------------
// Three.js renderer + scene + camera
// --------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;

const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 8, settings.cameraDistance);
camera.lookAt(0, 3, 0);

// orbit input
let isPointerDown = false, lastX = 0, lastY = 0;
let yaw = 0, pitch = -0.15;
function onPointerDown(e){ isPointerDown = true; lastX = e.clientX; lastY = e.clientY; }
function onPointerMove(e){ if (!isPointerDown) return; const dx = (e.clientX - lastX) * 0.002; const dy = (e.clientY - lastY) * 0.002; lastX = e.clientX; lastY = e.clientY; yaw -= dx; pitch = Math.max(-0.6, Math.min(0.3, pitch - dy)); }
function onPointerUp(){ isPointerDown = false; }
window.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);

// lighting
const hemi = new THREE.HemisphereLight(0xffffff, 0xbccfe8, 0.85); scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 0.9); dir.position.set(-30,60,20); scene.add(dir);
const ambient = new THREE.AmbientLight(0xffffff, 0.25); scene.add(ambient);

// --------------------
// MindAR integration flags & variables
// --------------------
let useMindAR = false;
let mindarThree = null;
let mindarActive = false;
let anchor = null;
let anchorGroup = null; // anchor.group when target found
let birdsParent = null; // group parented to anchorGroup when tracking

// states: WAIT_FOR_TARGET, PLAYING, FINISHED
let STATE = 'WAIT_FOR_TARGET';

// debounce for targetLost
let lastTargetLostTime = 0;
const targetLostTolerance = 0.6; // seconds
let hasPlayedForCurrentRecognition = false;

// --------------------
// bird.png frames -> CanvasTexture (shared)
// --------------------
const birdImage = new Image(); birdImage.src = './bird.png';
const birdTextures = []; let birdImagesReady = false;

birdImage.onload = () => { createBirdFrameTextures(); birdImagesReady = true; createBirds(settings.birdCount); };
birdImage.onerror = () => { console.error('bird.png を読み込めませんでした。パスを確認してください: ./bird.png'); };

function createBirdFrameTextures(){
  birdTextures.length = 0;
  const w = birdImage.naturalWidth, h = birdImage.naturalHeight; if (!w || !h) { console.error('bird.png サイズ取得失敗'); return; }
  const fh = Math.round(h / 3);
  for (let i=0;i<3;i++){
    const c = document.createElement('canvas'); c.width = w; c.height = fh; const ctx = c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height);
    ctx.drawImage(birdImage, 0, i*fh, w, fh, 0, 0, w, fh);
    const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps=false; tex.format = THREE.RGBAFormat;
    birdTextures.push(tex);
  }
}

// --------------------
// Phase timings (15s total) - unchanged
// --------------------
const PHASE = { WAIT:0, APPROACH:1, GATHER:2, FORM:3, CIRCLE:4, EXIT:5, END:6 };
const phaseTimes = { waitEnd:0.2, approachEnd:1.2, gatherEnd:4.0, formEnd:5.0, circleEnd:13.0, exitEnd:15.0 };
function computePhase(now){ if (now < phaseTimes.waitEnd) return PHASE.WAIT; if (now < phaseTimes.approachEnd) return PHASE.APPROACH; if (now < phaseTimes.gatherEnd) return PHASE.GATHER; if (now < phaseTimes.formEnd) return PHASE.FORM; if (now < phaseTimes.circleEnd) return PHASE.CIRCLE; if (now < phaseTimes.exitEnd) return PHASE.EXIT; return PHASE.END; }

// --------------------
// flock center preallocated
// --------------------
const flockCenter = new THREE.Vector3();
const circleBase = new THREE.Vector3(0, 6, 6);
const circleRadiusX = 32; const circleRadiusZ = 18;

// --------------------
// Bird class (sprite) with preallocated vectors - unchanged behavior
// --------------------
class Bird extends THREE.Group {
  constructor(params={}){
    super();
    this.params = Object.assign({ size:1.0, flapSpeed:1.0, phaseOffset:Math.random()*Math.PI*2, pathOffset:Math.random()*100, id:0, spawnTime:9999 }, params);
    this._offset = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.localSpeedMul = randRange(0.85, 1.25);
    this.flapTime = Math.random()*10; this.frameIndex = 0; this._spawned = false; this._birthTime = 0;
    const mat = new THREE.SpriteMaterial({ map: birdTextures[0] || null, transparent:true, alphaTest:0.02, depthWrite:false });
    this.sprite = new THREE.Sprite(mat);
    const baseSize = 5.5 * this.params.size;
    this.sprite.scale.set(baseSize * 1.7, baseSize, 1);
    this.add(this.sprite);
    this.visible = false;
  }
  spawn(now){ this._spawned = true; this._birthTime = now; this.visible = true; this.position.set(this._offset.x, 2 + this._offset.y, 80 + this._offset.z); this.sprite.scale.set(0.05*1.7, 0.05, 1); this.flapTime += randRange(0,1.0); }
  update(dt, t, globalElapsed, flockCenterPos, phase, spreadFactor){
    if (!this._spawned){ if (globalElapsed >= this.params.spawnTime) this.spawn(globalElapsed); else return; }
    const flapSpeed = this.params.flapSpeed * settings.flapBaseSpeed * this.localSpeedMul;
    this.flapTime += dt * flapSpeed * 3.8;
    const cycle = [0,1,2,1]; const idx = Math.floor(this.flapTime) % cycle.length; const next = cycle[idx]; if (next !== this.frameIndex){ this.frameIndex = next; this.sprite.material.map = birdTextures[this.frameIndex]; this.sprite.material.needsUpdate = true; }
    this._target.copy(flockCenterPos);
    const ox = this._offset.x * spreadFactor + Math.cos(globalElapsed*0.6 + this.params.pathOffset*0.01)*0.8;
    const oy = this._offset.y * spreadFactor + Math.sin(globalElapsed*0.7 + this.params.id*0.2)*0.6;
    const oz = this._offset.z * spreadFactor + Math.sin(globalElapsed*0.45 + this.params.pathOffset*0.03)*1.2;
    this._target.x += ox; this._target.y += oy; this._target.z += oz;
    this.position.lerp(this._target, 0.12);
    const forward = this.velocity; forward.subVectors(this._target, this.position); this.velocity.lerp(forward, 0.08);
    const bank = THREE.MathUtils.clamp(-this.velocity.x * 0.8, -THREE.MathUtils.degToRad(25), THREE.MathUtils.degToRad(25));
    this.sprite.material.rotation = THREE.MathUtils.lerp(this.sprite.material.rotation || 0, bank, 0.08);
    const minZ = -10; const maxZ = 120; const depthNorm = THREE.MathUtils.clamp((maxZ - this.position.z) / (maxZ - minZ), 0, 1);
    const scaleMul = THREE.MathUtils.lerp(0.5, 1.5, depthNorm);
    const baseSize = 5.5 * this.params.size; const desiredScaleY = baseSize * scaleMul; const curScaleY = THREE.MathUtils.lerp(this.sprite.scale.y, desiredScaleY, 0.08);
    this.sprite.scale.set(curScaleY * 1.7, curScaleY, 1);
    this.sprite.position.y = Math.sin(t*2 + this.params.phaseOffset) * 0.08;
  }
}

function randRange(a,b){ return a + Math.random()*(b-a); }

// --------------------
// spawn scheduling and offset generation with minimum separation - retained
// --------------------
let birds = [];
const minimumSeparation = 3.5;
function scheduleSpawnTimes(count){ const times = []; if (count <= 0) return times; const first = randRange(0.2, 0.5); times.push(first); let t = 1.0; for (let i=1;i<count;i++){ const gap = randRange(0.05, 0.12); t += gap; const spawn = Math.min(4.0, t + randRange(-0.02,0.02)); times.push(spawn); if (t >= 4.0) t = 4.0; } return times; }

function generateFlockOffsets(count){ const offsets = []; const attemptsLimit = 30; for (let i=0;i<count;i++){ let attempt = 0; let ok = false; let ox=0, oy=0, oz=0; while(attempt < attemptsLimit && !ok){ const theta = randRange(0, Math.PI*2); const rX = randRange(12, 20); const rZ = randRange(12, 18); const radiusX = randRange(8, rX); const radiusZ = randRange(6, rZ); ox = Math.cos(theta) * radiusX * randRange(0.6,1.0); oz = Math.sin(theta) * radiusZ * randRange(0.6,1.0); oy = randRange(-8, 12); ok = true; for (let j=0;j<offsets.length;j++){ const other = offsets[j]; const dx = ox - other.x; const dy = oy - other.y; const dist2 = dx*dx + dy*dy; if (dist2 < minimumSeparation*minimumSeparation){ ok = false; break; } } attempt++; } if (!ok){ ox += randRange(-3,3); oy += randRange(-2,2); oz += randRange(-3,3); } offsets.push(new THREE.Vector3(ox, oy, oz)); } return offsets; }

function clearBirds(){ birds.forEach(b=>{ if(b.parent) b.parent.remove(b); if(b.sprite && b.sprite.material) b.sprite.material.dispose(); }); birds = []; }

// Important: createBirds now only creates bird objects and keeps them in birds[]; they will be parented to scene OR to anchorGroup when targetFound
function createBirds(n){ clearBirds(); const finalN = Math.min(n, settings.maxBirds); const spawnTimes = scheduleSpawnTimes(finalN); const offsets = generateFlockOffsets(finalN); for (let i=0;i<finalN;i++){ const b = new Bird({ size: settings.birdSize * randRange(0.9,1.15), flapSpeed: randRange(0.85,1.2), id:i }); b.params.spawnTime = spawnTimes[i] !== undefined ? spawnTimes[i] : randRange(1.0,4.0); b._offset.copy(offsets[i]); b.position.set(0,0,9999); b.visible=false; scene.add(b); birds.push(b); } }

// --------------------
// bird spawn points on the target image (normalized coordinates -1..1 or -0.5..0.5 depending)
// provided as normalized coordinates -1..1 where (0,0) center of image
// --------------------
const birdSpawnPoints = [
  {x:-0.42,y:0.38},{x:-0.28,y:0.27},{x:-0.10,y:0.32},{x:0.08,y:0.36},{x:0.27,y:0.28},{x:0.41,y:0.35},
  {x:-0.35,y:0.08},{x:-0.15,y:0.05},{x:0.10,y:0.10},{x:0.32,y:0.05},{x:-0.38,y:-0.18},{x:-0.18,y:-0.20},
  {x:0.02,y:-0.16},{x:0.23,y:-0.23},{x:0.40,y:-0.18},{x:-0.30,y:-0.38},{x:-0.08,y:-0.34},{x:0.18,y:-0.36},{x:0.35,y:-0.40}
];

// map normalized spawn point to anchor-local position
function spawnPointToLocal(sp){ return new THREE.Vector3(sp.x, sp.y, 0); }

// attach birds to anchorGroup when target found
function attachBirdsToAnchor(g){ if (!g) return; birdsParent = new THREE.Group(); g.add(birdsParent); for (let i=0;i<birds.length;i++){ const b = birds[i]; if (b.parent) b.parent.remove(b); birdsParent.add(b); const sp = birdSpawnPoints[i % birdSpawnPoints.length]; const jitter = 0.06; const local = spawnPointToLocal(sp); local.x += randRange(-jitter, jitter); local.y += randRange(-jitter, jitter); local.multiplyScalar(12); b._offset.copy(local); b.position.copy(local.clone().add(new THREE.Vector3(0,0,6 + randRange(-2,2)))); b.visible = false; } }

// --------------------
// Camera / MindAR start/stop handling
// --------------------
fetch('./targets.mind', {method:'HEAD'}).then(res=>{ if (res.ok) { useMindAR = true; console.log('targets.mind found — MindAR tracking will be enabled on Start.'); } else { console.log('targets.mind not found — fallback to non-targeted mode.'); } }).catch(err=>{ console.warn('Error checking targets.mind', err); });

async function initMindAR(){
  if (!useMindAR) return false;
  if (mindarThree) return true;
  if (typeof window.MINDAR === 'undefined' || !window.MINDAR || !window.MINDAR.IMAGE){ console.warn('MindAR library not found. Ensure mindar-image-three script is included.'); return false; }
  mindarThree = new window.MINDAR.IMAGE.MindARThree({ container: document.body, imageTargetSrc: './targets.mind', uiLoading: "", uiError: "", uiScan: "", maxTrack: 1 });
  const {renderer: mRenderer, scene: mScene, camera: mCamera} = mindarThree;
  mindarThreeRenderer = mRenderer; mindarThreeScene = mScene; mindarThreeCamera = mCamera;
  anchor = mindarThree.addAnchor(0);
  anchor.onTargetFound = () => { onTargetFound(); };
  anchor.onTargetLost = () => { onTargetLost(); };
  return true;
}

let mindarThreeRenderer = null, mindarThreeScene = null, mindarThreeCamera = null;

async function startAR(){
  if (useMindAR){
    const ok = await initMindAR();
    if (!ok) { console.warn('MindAR initialization failed — falling back to simple camera start.'); await startCamera(); return; }
    await mindarThree.start();
    mindarActive = true;
    mindarThreeRenderer.setAnimationLoop(() => {
      if (STATE === 'PLAYING') {
        stepAnimationFrame();
      }
      mindarThreeRenderer.render(mindarThreeScene, mindarThreeCamera);
    });
  } else {
    await startCamera();
  }
}

async function stopAR(){
  if (mindarActive && mindarThree){
    await mindarThree.stop();
    mindarThreeRenderer.setAnimationLoop(null);
    mindarActive = false;
    if (birdsParent && birdsParent.parent){ birdsParent.parent.remove(birdsParent); scene.add(birdsParent); }
  }
}

// existing startCamera/stopCamera kept for fallback (non-MindAR)
let stream = null;
async function startCamera(){
  try{ const constraints = { video: { facingMode: { ideal: 'environment' } }, audio:false }; stream = await navigator.mediaDevices.getUserMedia(constraints); video.srcObject = stream; await video.play(); startBtn.textContent = 'Stop Camera'; }catch(err){ console.error('Camera access error', err); alert('カメラへのアクセスが必要です。設定を確認してください。\n' + (err && err.message ? err.message : '')); } }
function stopCamera(){ if(!stream) return; stream.getTracks().forEach(t=>t.stop()); stream=null; video.pause(); video.srcObject=null; startBtn.textContent='Start Camera'; }

startBtn.addEventListener('click', async ()=>{ if ((useMindAR && mindarActive) || (!useMindAR && stream)) { if (useMindAR) { await stopAR(); } else { stopCamera(); } startBtn.textContent = 'Start Camera'; return; } startBtn.textContent = 'Starting...'; if (useMindAR){ await startAR(); startBtn.textContent = 'Stop Camera'; } else { await startCamera(); } });

resetCamBtn.addEventListener('click', async ()=>{ if (useMindAR && mindarActive){ await stopAR(); } if (!useMindAR && stream){ stopCamera(); } for (let b of birds){ b.visible = false; b._spawned = false; } STATE = 'WAIT_FOR_TARGET'; elapsed = 0; hasPlayedForCurrentRecognition = false; lastTargetLostTime = 0; startBtn.textContent = 'Start Camera'; });

// --------------------
// animation driving (shared stepping function)
// --------------------
const clock = new THREE.Clock(); let elapsed = 0;
function smoothstep(a,b,t){ const x = THREE.MathUtils.clamp((t-a)/(b-a),0,1); return x*x*(3-2*x); }

function stepAnimationFrame(){ const dt = Math.min(0.06, clock.getDelta()); if (STATE === 'PLAYING') elapsed += dt; const phase = computePhase(elapsed); let spreadFactor = 1.0; if (phase === PHASE.WAIT || phase === PHASE.APPROACH || phase === PHASE.GATHER) { const p = THREE.MathUtils.clamp((elapsed - phaseTimes.approachEnd)/(phaseTimes.gatherEnd - phaseTimes.approachEnd),0,1); spreadFactor = THREE.MathUtils.lerp(0.35, 0.55, p); } else if (phase === PHASE.FORM){ spreadFactor = 0.6; } else if (phase === PHASE.CIRCLE){ const t0 = phaseTimes.formEnd; const t1 = (phaseTimes.formEnd + phaseTimes.circleEnd)/2; const t = THREE.MathUtils.clamp((elapsed - t0)/(t1 - t0),0,1); spreadFactor = THREE.MathUtils.lerp(0.6, 1.0, smoothstep(0,1,t)); } else if (phase === PHASE.EXIT){ spreadFactor = 1.0; }
  if (phase === PHASE.WAIT){ flockCenter.set(0,6,30); }
  else if (phase === PHASE.APPROACH){ const p = THREE.MathUtils.clamp((elapsed - 0.2)/(1.2 - 0.2),0,1); flockCenter.lerpVectors(new THREE.Vector3(0,6,30), circleBase, p); }
  else if (phase === PHASE.GATHER){ flockCenter.copy(circleBase); }
  else if (phase === PHASE.FORM){ const p = THREE.MathUtils.clamp((elapsed - phaseTimes.gatherEnd)/(phaseTimes.formEnd - phaseTimes.gatherEnd),0,1); flockCenter.lerpVectors(circleBase, circleBase, p); }
  else if (phase === PHASE.CIRCLE){ const t = (elapsed - phaseTimes.formEnd)/(phaseTimes.circleEnd - phaseTimes.formEnd); const angle = -t * Math.PI * 2; flockCenter.x = circleRadiusX * Math.cos(angle); flockCenter.y = circleBase.y + Math.sin(angle * 0.6) * 3.0; flockCenter.z = circleBase.z + circleRadiusZ * Math.sin(angle); }
  else if (phase === PHASE.EXIT){ const p = THREE.MathUtils.clamp((elapsed - phaseTimes.circleEnd)/(phaseTimes.exitEnd - phaseTimes.circleEnd),0,1); const exitTarget = new THREE.Vector3(40, 22, 120); flockCenter.lerpVectors(flockCenter, exitTarget, smoothstep(0,1,p)); }
  for (let i=0;i<birds.length;i++){ birds[i].update(dt, elapsed * settings.flightSpeed, elapsed, flockCenter, phase, spreadFactor); }
  const radius = settings.cameraDistance; const cx = Math.sin(yaw)*radius, cz = Math.cos(yaw)*radius; const cy = THREE.MathUtils.lerp(camera.position.y, 6 + pitch*6 + Math.sin(elapsed*0.2)*1.4, 0.08); camera.position.set(cx, cy, cz); camera.lookAt(0, 3, 0);
}

// --------------------
// animate loop fallback when MindAR not used
// --------------------
function animate(){ requestAnimationFrame(animate); if (!useMindAR){ stepAnimationFrame(); renderer.render(scene, camera); } }
animate();

// --------------------
// MindAR handlers: targetFound / targetLost behavior
// --------------------
function onTargetFound(){ console.log('targetFound'); lastTargetLostTime = 0; if (STATE === 'PLAYING' || hasPlayedForCurrentRecognition) return; anchorGroup = anchor.group; attachBirdsToAnchor(anchorGroup); if (mindarThreeScene && birdsParent){ }
  elapsed = 0; STATE = 'PLAYING'; hasPlayedForCurrentRecognition = true; }

function onTargetLost(){ console.log('targetLost'); lastTargetLostTime = performance.now() / 1000; setTimeout(()=>{ const now = performance.now() / 1000; if ((now - lastTargetLostTime) >= targetLostTolerance){ if (STATE === 'PLAYING'){ STATE = 'WAIT_FOR_TARGET'; for (let b of birds){ b.visible = false; b._spawned = false; } elapsed = 0; hasPlayedForCurrentRecognition = false; } } }, (targetLostTolerance+0.05)*1000); }

// --------------------
// Finalization: ensure resize and cleanup behaviour
// --------------------
window.addEventListener('resize', ()=>{ const w = window.innerWidth, h = window.innerHeight; if (mindarThreeRenderer){ mindarThreeRenderer.setSize(w,h); } renderer.setSize(w,h); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); camera.aspect = w/h; camera.updateProjectionMatrix(); });
window.addEventListener('pagehide', ()=>{ if (stream) stopCamera(); if (mindarActive && mindarThree) mindarThree.stop(); });

// --------------------
// Safety: ensure birds are not visible until PLAYING (initial state)
// --------------------
STATE = 'WAIT_FOR_TARGET';
for (let b of birds){ if (b) { b.visible = false; b._spawned = false; } }

