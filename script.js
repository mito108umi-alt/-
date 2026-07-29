// script.js — bird.png sprite animation + timed flock behaviour (50 birds, 15s)

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
// Keep pixel ratio reasonable for mobile; set to 1 if performance issues
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

// lighting (kept for visual consistency; sprites are unaffected by lights)
const hemi = new THREE.HemisphereLight(0xffffff, 0xbccfe8, 0.85); scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 0.9); dir.position.set(-30,60,20); scene.add(dir);
const ambient = new THREE.AmbientLight(0xffffff, 0.25); scene.add(ambient);

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
// Phase timings (15s total)
// --------------------
const PHASE = { WAIT:0, APPROACH:1, GATHER:2, FORM:3, CIRCLE:4, EXIT:5, END:6 };
const phaseTimes = { waitEnd:0.2, approachEnd:1.2, gatherEnd:4.0, formEnd:5.0, circleEnd:13.0, exitEnd:15.0 };

function computePhase(now){ if (now < phaseTimes.waitEnd) return PHASE.WAIT; if (now < phaseTimes.approachEnd) return PHASE.APPROACH; if (now < phaseTimes.gatherEnd) return PHASE.GATHER; if (now < phaseTimes.formEnd) return PHASE.FORM; if (now < phaseTimes.circleEnd) return PHASE.CIRCLE; if (now < phaseTimes.exitEnd) return PHASE.EXIT; return PHASE.END; }

// --------------------
// flock center preallocated
// --------------------
const flockCenter = new THREE.Vector3();

// circle params
const circleBase = new THREE.Vector3(0, 6, 6);
const circleRadiusX = 32; // wide horizontal sweep
const circleRadiusZ = 18; // depth sweep

// --------------------
// Bird class (sprite) with preallocated vectors
// --------------------
class Bird extends THREE.Group {
  constructor(params={}){
    super();
    this.params = Object.assign({ size:1.0, flapSpeed:1.0, phaseOffset:Math.random()*Math.PI*2, pathOffset:Math.random()*100, id:0, spawnTime:9999 }, params);
    // preallocate
    this._offset = new THREE.Vector3(); // assigned later
    this._target = new THREE.Vector3();
    this.velocity = new THREE.Vector3();

    this.localSpeedMul = randRange(0.85, 1.25);
    this.flapTime = Math.random()*10;
    this.frameIndex = 0;
    this._spawned = false;
    this._birthTime = 0;

    // sprite
    const mat = new THREE.SpriteMaterial({ map: birdTextures[0] || null, transparent:true, alphaTest:0.02, depthWrite:false });
    this.sprite = new THREE.Sprite(mat);
    const baseSize = 5.5 * this.params.size;
    this.sprite.scale.set(baseSize * 1.7, baseSize, 1);
    this.add(this.sprite);

    this.visible = false;
  }

  spawn(now){
    this._spawned = true; this._birthTime = now; this.visible = true;
    // initial far position
    this.position.set(this._offset.x, 2 + this._offset.y, 80 + this._offset.z);
    // tiny initial scale
    this.sprite.scale.set(0.05*1.7, 0.05, 1);
    this.flapTime += randRange(0,1.0);
  }

  update(dt, t, globalElapsed, flockCenterPos, phase, spreadFactor){
    if (!this._spawned){ if (globalElapsed >= this.params.spawnTime) this.spawn(globalElapsed); else return; }

    // flap animation
    const flapSpeed = this.params.flapSpeed * settings.flapBaseSpeed * this.localSpeedMul;
    this.flapTime += dt * flapSpeed * 3.8;
    const cycle = [0,1,2,1];
    const idx = Math.floor(this.flapTime) % cycle.length;
    const next = cycle[idx];
    if (next !== this.frameIndex){ this.frameIndex = next; this.sprite.material.map = birdTextures[this.frameIndex]; this.sprite.material.needsUpdate = true; }

    // compute desired target: flockCenter + offset * spreadFactor + small wobble
    this._target.copy(flockCenterPos);
    // rotated offset: allow fan distribution via stored _offset
    const ox = this._offset.x * spreadFactor + Math.cos(globalElapsed*0.6 + this.params.pathOffset*0.01)*0.8;
    const oy = this._offset.y * spreadFactor + Math.sin(globalElapsed*0.7 + this.params.id*0.2)*0.6;
    const oz = this._offset.z * spreadFactor + Math.sin(globalElapsed*0.45 + this.params.pathOffset*0.03)*1.2;
    this._target.x += ox; this._target.y += oy; this._target.z += oz;

    // smooth position
    this.position.lerp(this._target, 0.12);

    // estimate forward = target - position into tmp vector (reuse velocity for smoothing)
    const forward = this.velocity;
    forward.subVectors(this._target, this.position);
    this.velocity.lerp(forward, 0.08);

    // bank rotation limited ±25deg
    const bank = THREE.MathUtils.clamp(-this.velocity.x * 0.8, -THREE.MathUtils.degToRad(25), THREE.MathUtils.degToRad(25));
    this.sprite.material.rotation = THREE.MathUtils.lerp(this.sprite.material.rotation || 0, bank, 0.08);

    // depth-based scaling: map z to [far..near]
    const minZ = -10; const maxZ = 120; // representable depth range
    const depthNorm = THREE.MathUtils.clamp((maxZ - this.position.z) / (maxZ - minZ), 0, 1);
    // map to scale multiplier: far=0.5 mid~0.85 near=1.5
    const scaleMul = THREE.MathUtils.lerp(0.5, 1.5, depthNorm);
    const baseSize = 5.5 * this.params.size;
    const desiredScaleY = baseSize * scaleMul;
    // smooth scale
    const curScaleY = THREE.MathUtils.lerp(this.sprite.scale.y, desiredScaleY, 0.08);
    this.sprite.scale.set(curScaleY * 1.7, curScaleY, 1);

    // small bob
    this.sprite.position.y = Math.sin(t*2 + this.params.phaseOffset) * 0.08;
  }
}

function randRange(a,b){ return a + Math.random()*(b-a); }

// --------------------
// spawn scheduling and offset generation with minimum separation
// --------------------
let birds = [];
const minimumSeparation = 3.5;
function scheduleSpawnTimes(count){
  const times = [];
  if (count <= 0) return times;
  const first = randRange(0.2, 0.5); times.push(first);
  // distribute remaining between 1.0 and 4.0 with small gaps 0.05..0.12
  let t = 1.0;
  for (let i=1;i<count;i++){
    const gap = randRange(0.05, 0.12);
    t += gap;
    const spawn = Math.min(4.0, t + randRange(-0.02,0.02));
    times.push(spawn);
    if (t >= 4.0) t = 4.0;
  }
  return times;
}

function generateFlockOffsets(count){
  const offsets = [];
  const attemptsLimit = 30;
  for (let i=0;i<count;i++){
    let attempt = 0; let ok = false; let ox=0, oy=0, oz=0;
    while(attempt < attemptsLimit && !ok){
      // generate in fan/ellipse distribution
      const theta = randRange(0, Math.PI*2);
      const rX = randRange(12, 20); // radius multiplier along X
      const rZ = randRange(12, 18);
      // bias so more birds are forward than extreme back
      const radiusX = randRange(8, rX);
      const radiusZ = randRange(6, rZ);
      ox = Math.cos(theta) * radiusX * randRange(0.6,1.0);
      oz = Math.sin(theta) * radiusZ * randRange(0.6,1.0);
      oy = randRange(-8, 12);
      ok = true;
      // check minimum separation in X/Y plane primarily
      for (let j=0;j<offsets.length;j++){
        const other = offsets[j];
        const dx = ox - other.x; const dy = oy - other.y; const dist2 = dx*dx + dy*dy;
        if (dist2 < minimumSeparation*minimumSeparation){ ok = false; break; }
      }
      attempt++;
    }
    if (!ok){ // accept last generated to avoid infinite loop
      // if failed, jitter around a less crowded area
      ox += randRange(-3,3); oy += randRange(-2,2); oz += randRange(-3,3);
    }
    offsets.push(new THREE.Vector3(ox, oy, oz));
  }
  return offsets;
}

function clearBirds(){ birds.forEach(b=>{ if(b.parent) b.parent.remove(b); if(b.sprite && b.sprite.material) b.sprite.material.dispose(); }); birds = []; }

function createBirds(n){
  clearBirds();
  const finalN = Math.min(n, settings.maxBirds);
  const spawnTimes = scheduleSpawnTimes(finalN);
  const offsets = generateFlockOffsets(finalN);
  for (let i=0;i<finalN;i++){
    const b = new Bird({ size: settings.birdSize * randRange(0.9,1.15), flapSpeed: randRange(0.85,1.2), id:i });
    b.params.spawnTime = spawnTimes[i] !== undefined ? spawnTimes[i] : randRange(1.0,4.0);
    b._offset.copy(offsets[i]);
    b.position.set(0,0,9999); b.visible=false; scene.add(b); birds.push(b);
  }
}

// if images already ready
if (birdImagesReady) createBirds(settings.birdCount);

// --------------------
// Camera start/stop (unchanged behavior)
// --------------------
let stream = null;
async function startCamera(){
  try{ const constraints = { video: { facingMode: { ideal: 'environment' } }, audio:false }; stream = await navigator.mediaDevices.getUserMedia(constraints); video.srcObject = stream; await video.play(); startBtn.textContent = 'Stop Camera'; }catch(err){ console.error('Camera access error', err); alert('カメラへのアクセスが必要です。設定を確認してください。\n' + (err && err.message ? err.message : '')); } }
function stopCamera(){ if(!stream) return; stream.getTracks().forEach(t=>t.stop()); stream=null; video.pause(); video.srcObject=null; startBtn.textContent='Start Camera'; }
startBtn.addEventListener('click', async ()=>{ if (stream){ stopCamera(); return; } await startCamera(); });
resetCamBtn.addEventListener('click', ()=>{ yaw=0; pitch=-0.15; camera.position.set(0,8,settings.cameraDistance); });

// --------------------
// main animation with phase-controlled flock
// --------------------
const clock = new THREE.Clock(); let elapsed = 0;

function smoothstep(a,b,t){ const x = THREE.MathUtils.clamp((t-a)/(b-a),0,1); return x*x*(3-2*x); }

function animate(){ requestAnimationFrame(animate); const dt = Math.min(0.06, clock.getDelta()); elapsed += dt; const phase = computePhase(elapsed);

  // compute spreadFactor depending on phase and smooth interpolation
  let spreadFactor = 1.0;
  if (phase === PHASE.WAIT || phase === PHASE.APPROACH || phase === PHASE.GATHER) {
    // small spread while gathering
    const p = THREE.MathUtils.clamp((elapsed - phaseTimes.approachEnd)/(phaseTimes.gatherEnd - phaseTimes.approachEnd),0,1);
    spreadFactor = THREE.MathUtils.lerp(0.35, 0.55, p); // tighter earlier
  } else if (phase === PHASE.FORM){
    spreadFactor = 0.6; // form end
  } else if (phase === PHASE.CIRCLE){
    // ramp from 0.6 at t=phaseTimes.formEnd to 1.0 at circle midpoint
    const t0 = phaseTimes.formEnd; const t1 = (phaseTimes.formEnd + phaseTimes.circleEnd)/2; const t = THREE.MathUtils.clamp((elapsed - t0)/(t1 - t0),0,1);
    spreadFactor = THREE.MathUtils.lerp(0.6, 1.0, smoothstep(0,1,t));
  } else if (phase === PHASE.EXIT){
    spreadFactor = 1.0;
  }

  // update flockCenter depending on phase
  if (phase === PHASE.WAIT){ flockCenter.set(0,6,30); }
  else if (phase === PHASE.APPROACH){ const p = THREE.MathUtils.clamp((elapsed - 0.2)/(1.2 - 0.2),0,1); flockCenter.lerpVectors(new THREE.Vector3(0,6,30), circleBase, p); }
  else if (phase === PHASE.GATHER){ flockCenter.copy(circleBase); }
  else if (phase === PHASE.FORM){ // small transition to starting circle
    const p = THREE.MathUtils.clamp((elapsed - phaseTimes.gatherEnd)/(phaseTimes.formEnd - phaseTimes.gatherEnd),0,1); flockCenter.lerpVectors(circleBase, circleBase, p);
  }
  else if (phase === PHASE.CIRCLE){ const t = (elapsed - phaseTimes.formEnd)/(phaseTimes.circleEnd - phaseTimes.formEnd); const angle = -t * Math.PI * 2; flockCenter.x = circleRadiusX * Math.cos(angle); flockCenter.y = circleBase.y + Math.sin(angle * 0.6) * 3.0; flockCenter.z = circleBase.z + circleRadiusZ * Math.sin(angle); }
  else if (phase === PHASE.EXIT){ const p = THREE.MathUtils.clamp((elapsed - phaseTimes.circleEnd)/(phaseTimes.exitEnd - phaseTimes.circleEnd),0,1); const exitTarget = new THREE.Vector3(40, 22, 120); flockCenter.lerpVectors(flockCenter, exitTarget, smoothstep(0,1,p)); }

  // update birds
  for (let i=0;i<birds.length;i++){ birds[i].update(dt, elapsed * settings.flightSpeed, elapsed, flockCenter, phase, spreadFactor); }

  // camera orbit
  const radius = settings.cameraDistance; const cx = Math.sin(yaw)*radius, cz = Math.cos(yaw)*radius; const cy = THREE.MathUtils.lerp(camera.position.y, 6 + pitch*6 + Math.sin(elapsed*0.2)*1.4, 0.08); camera.position.set(cx, cy, cz); camera.lookAt(0, 3, 0);

  renderer.render(scene, camera);
}

animate();

// responsive
window.addEventListener('resize', ()=>{ const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w,h); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); camera.aspect = w/h; camera.updateProjectionMatrix(); });

// cleanup
window.addEventListener('pagehide', ()=>{ if (stream) stopCamera(); });
