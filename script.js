// script.js — Three.js seagull overlay + phone camera + capture
// NOTE: open via HTTPS (GitHub Pages) for camera access.

// Settings (easy to change)
const settings = {
  birdCount: 3,
  birdSize: 1.0,
  flightSpeed: 1.0,
  flapBaseSpeed: 1.0,
  flapBaseAmount: 1.0,
  glideMinSec: 1.2,
  glideMaxSec: 3.6,
  areaRadius: 28,
  cameraDistance: 35,
  maxBirds: 8,
};

// DOM
const video = document.getElementById('cameraFeed');
const canvas = document.getElementById('c');
const startBtn = document.getElementById('startCam');
const captureBtn = document.getElementById('capture'); // may be null after UI minimization
const resetCamBtn = document.getElementById('resetCam');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
// keep preserveDrawingBuffer false for performance; we composite with drawImage
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;

const scene = new THREE.Scene();
scene.background = null; // no background

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 8, settings.cameraDistance);
camera.lookAt(0, 3, 0);

// lightweight input orbit (canvas pointer events are off by default; enable on pointerdown via body)
let isPointerDown = false, lastX = 0, lastY = 0;
let yaw = 0, pitch = -0.15;
function onPointerDown(e){ isPointerDown = true; lastX = e.clientX; lastY = e.clientY; document.body.style.cursor='grabbing'; }
function onPointerMove(e){
  if (!isPointerDown) return;
  const dx = (e.clientX - lastX) * 0.002;
  const dy = (e.clientY - lastY) * 0.002;
  lastX = e.clientX; lastY = e.clientY;
  yaw -= dx;
  pitch = Math.max(-0.6, Math.min(0.3, pitch - dy));
}
function onPointerUp(){ isPointerDown = false; document.body.style.cursor='default'; }
window.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);

// lighting
const hemi = new THREE.HemisphereLight(0xffffff, 0xbccfe8, 0.85);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 0.9);
dir.position.set(-30, 60, 20);
scene.add(dir);
const ambient = new THREE.AmbientLight(0xffffff, 0.25);
scene.add(ambient);

// Bird implementation (kept from previous version, simplified)
class Bird extends THREE.Group {
  constructor(params = {}) {
    super();
    this.params = Object.assign({
      size: 1.0,
      flapSpeed: 1.0,
      flapAmount: 1.0,
      phaseOffset: Math.random()*Math.PI*2,
      glideTime: randRange(settings.glideMinSec, settings.glideMaxSec),
      inGlide: Math.random() > 0.5 ? true : false,
      positionOffset: new THREE.Vector3(randRange(-8,8), randRange(0,6), randRange(-8,8)),
      pathOffset: Math.random()*100,
      id: 0,
    }, params);

    const body = new THREE.Group();
    const bodyGeom = new THREE.SphereGeometry(0.8 * this.params.size, 16, 12);
    bodyGeom.scale(1, 0.8, 1.4);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness:0.7, metalness:0.02 });
    const bodyMesh = new THREE.Mesh(bodyGeom, bodyMat);
    body.add(bodyMesh);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28 * this.params.size, 12, 8), bodyMat);
    head.position.set(0, 0.15*this.params.size, 0.95*this.params.size);
    head.scale.set(0.85,0.85,0.85);
    head.name = 'head';
    body.add(head);

    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.08*this.params.size, 0.35*this.params.size, 8), new THREE.MeshStandardMaterial({ color: 0xffcc33 }));
    beak.rotation.x = Math.PI/2;
    beak.position.set(0, 0.02*this.params.size, 1.19*this.params.size);
    body.add(beak);

    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.28*this.params.size, 0.6*this.params.size, 6), bodyMat);
    tail.rotation.x = -Math.PI/2;
    tail.position.set(0, -0.05*this.params.size, -0.9*this.params.size);
    tail.scale.set(1.1, 1.0, 0.7);
    tail.name='tail';
    body.add(tail);

    this.body = body;
    this.add(body);

    this.leftWing = this._buildWing(true);
    this.rightWing = this._buildWing(false);

    this.leftWing.root.position.set(0.78*this.params.size, 0.05*this.params.size, 0.1*this.params.size);
    this.rightWing.root.position.set(-0.78*this.params.size, 0.05*this.params.size, 0.1*this.params.size);

    body.add(this.leftWing.root);
    body.add(this.rightWing.root);

    this._addFeatherDetails(this.leftWing.tip, true);
    this._addFeatherDetails(this.rightWing.tip, false);

    this.position.copy(this.params.positionOffset);
    this.rotation.order = 'ZYX';

    this.flapPhase = Math.random()*Math.PI*2 + this.params.phaseOffset;
    this.glideTimer = this.params.glideTime * Math.random();
    this.inGlide = this.params.inGlide;
    this.localSpeedMul = randRange(0.85, 1.25);
    this.velocity = new THREE.Vector3();
  }

  _buildWing(isLeft=true){
    const wingMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness:0.8, metalness:0.02, side: THREE.DoubleSide });
    const root = new THREE.Group();
    const rootGeom = new THREE.BoxGeometry(0.08*this.params.size, 0.6*this.params.size, 0.12*this.params.size);
    const rootMesh = new THREE.Mesh(rootGeom, wingMat);
    rootMesh.position.set(0, -0.3*this.params.size, 0);
    root.add(rootMesh);

    const mid = new THREE.Group();
    mid.position.set(0.0, -0.35*this.params.size, 0);
    const midGeom = new THREE.BoxGeometry(0.06*this.params.size, 1.1*this.params.size, 0.08*this.params.size);
    const midMesh = new THREE.Mesh(midGeom, wingMat);
    midMesh.position.set(0, -0.55*this.params.size, 0);
    mid.add(midMesh);

    const tip = new THREE.Group();
    tip.position.set(0, -0.85*this.params.size, 0);
    const tipGeom = new THREE.BoxGeometry(0.04*this.params.size, 1.0*this.params.size, 0.06*this.params.size);
    const tipMesh = new THREE.Mesh(tipGeom, wingMat);
    tipMesh.position.set(0, -0.5*this.params.size, 0);
    tip.add(tipMesh);

    mid.rotation.x = -0.12;
    tip.rotation.x = -0.08;
    mid.add(tip);
    root.add(mid);

    root.rotation.z = isLeft ? -0.25 : 0.25;
    root.scale.set(isLeft ? 1 : -1, 1, 1);

    return { root, mid, tip, meshes: [rootMesh, midMesh, tipMesh] };
  }

  _addFeatherDetails(tipGroup, isLeft){
    const featherMat = new THREE.MeshStandardMaterial({ color: 0xf8fbff, roughness:0.85, side:THREE.DoubleSide });
    const count = 6;
    for (let i=0;i<count;i++){
      const g = new THREE.PlaneGeometry(0.12*this.params.size, 0.45*this.params.size, 1, 1);
      const m = new THREE.Mesh(g, featherMat);
      const spread = (i - (count-1)/2) * 0.09 * this.params.size;
      m.position.set(spread, -0.35*this.params.size, 0.02*this.params.size + i*0.002);
      m.rotation.set(-0.18 - i*0.02, isLeft ? -0.12 : 0.12, isLeft ? -0.15 : 0.15);
      tipGroup.add(m);
    }
  }

  update(dt, t){
    const flapSpeed = this.params.flapSpeed * settings.flapBaseSpeed * this.localSpeedMul;
    this.flapPhase += dt * flapSpeed * 2.0;

    this.glideTimer -= dt;
    if (this.glideTimer <= 0) {
      this.inGlide = !this.inGlide;
      this.glideTimer = randRange(settings.glideMinSec, settings.glideMaxSec);
    }

    const asym = 0.04*Math.sin(t*0.6 + this.params.phaseOffset);
    const leftPhase = this.flapPhase + 0.05;
    const rightPhase = this.flapPhase - 0.02;
    const flapAmount = settings.flapBaseAmount * this.params.flapAmount;

    function strokeVal(phase){
      const s = Math.sin(phase);
      if (s > 0) return Math.pow(s, 0.9) * 1.6;
      return -Math.pow(Math.abs(s), 1.6) * 0.85;
    }

    const lv = strokeVal(leftPhase) * flapAmount * (this.inGlide ? 0.9 : 1.0);
    const rv = strokeVal(rightPhase) * flapAmount * (this.inGlide ? 0.9 : 1.0);

    const rootDownMul = 0.65;
    const midDelay = 0.18;
    const tipDelay = 0.35;

    this.leftWing.root.rotation.x = THREE.MathUtils.lerp(this.leftWing.root.rotation.x, ( -lv * rootDownMul - 0.08 ) * 0.9, 0.3);
    this.leftWing.root.rotation.y = Math.sin(t*0.6 + this.params.phaseOffset)*0.06 + asym;
    this.leftWing.mid.rotation.x = THREE.MathUtils.lerp(this.leftWing.mid.rotation.x, ( - (strokeVal(leftPhase - midDelay) * 0.85) ) * 0.9, 0.25);
    this.leftWing.tip.rotation.x = THREE.MathUtils.lerp(this.leftWing.tip.rotation.x, ( - (strokeVal(leftPhase - tipDelay) * 0.6) ) * 0.9, 0.22);
    this.leftWing.tip.rotation.z = THREE.MathUtils.lerp(this.leftWing.tip.rotation.z || 0, -0.05 - (Math.max(0, lv) * 0.06), 0.15);

    this.rightWing.root.rotation.x = THREE.MathUtils.lerp(this.rightWing.root.rotation.x, ( -rv * rootDownMul + 0.08 ) * 0.9, 0.3);
    this.rightWing.root.rotation.y = Math.sin(t*0.6 + this.params.phaseOffset + 0.4)*0.06 - asym;
    this.rightWing.mid.rotation.x = THREE.MathUtils.lerp(this.rightWing.mid.rotation.x, ( - (strokeVal(rightPhase - midDelay) * 0.85) ) * 0.9, 0.25);
    this.rightWing.tip.rotation.x = THREE.MathUtils.lerp(this.rightWing.tip.rotation.x, ( - (strokeVal(rightPhase - tipDelay) * 0.6) ) * 0.9, 0.22);
    this.rightWing.tip.rotation.z = THREE.MathUtils.lerp(this.rightWing.tip.rotation.z || 0, 0.05 + (Math.max(0, rv) * 0.06), 0.15);

    const bodyUp = (Math.max(0, lv) + Math.max(0, rv)) * 0.07 * (this.inGlide ? 0.25 : 1.0);
    this.body.position.y = THREE.MathUtils.lerp(this.body.position.y, bodyUp, 0.12);
    this.rotation.z = THREE.MathUtils.lerp(this.rotation.z, asym*0.8, 0.06);

    const head = this.body.getObjectByName('head');
    if (head) head.rotation.x = THREE.MathUtils.lerp(head.rotation.x || 0, -0.06, 0.06);

    const baseSpeed = 0.6 * settings.flightSpeed * this.localSpeedMul;
    const time = t*0.4 + this.params.pathOffset;
    const rx = Math.sin(time*0.9 + this.params.id) * settings.areaRadius * 0.7 + Math.sin(time*0.33 + this.params.id*2)*6;
    const rz = Math.cos(time*0.7 + this.params.id*1.3) * settings.areaRadius * 0.5 + Math.cos(time*0.23 + this.params.id*0.9)*6;
    const ry = Math.sin(time*0.5 + this.params.id*0.6)*3 + Math.sin(time*0.12 + this.params.id*0.7)*1.6 + 6;

    const target = new THREE.Vector3(rx, ry, rz);
    target.add(this.params.positionOffset.clone().multiplyScalar(0.25));

    const pos = this.position;
    const desired = target.clone().sub(pos).multiplyScalar(0.6 * dt * baseSpeed);
    this.velocity.lerp(desired, 0.55);
    pos.add(this.velocity);

    const forward = this.velocity.clone();
    forward.y *= 0.6;
    if (forward.lengthSq() > 1e-6) {
      const look = new THREE.Vector3().copy(forward).normalize();
      const yaw = Math.atan2(look.x, look.z);
      const pitch = -Math.asin(THREE.MathUtils.clamp(look.y, -0.9, 0.9)) * 0.6;
      this.rotation.y = THREE.MathUtils.lerp(this.rotation.y, yaw, 0.08);
      this.rotation.x = THREE.MathUtils.lerp(this.rotation.x, pitch, 0.06);
    }

    const tail = this.body.getObjectByName('tail');
    if (tail) tail.rotation.z = THREE.MathUtils.lerp(tail.rotation.z || 0, -this.rotation.z*0.9, 0.08);

    const microNoise = 0.008 * (this.inGlide ? 1.0 : 0.45);
    this.leftWing.tip.rotation.x += Math.sin(t*8 + this.params.phaseOffset)*microNoise;
    this.rightWing.tip.rotation.x += Math.sin(t*8 + this.params.phaseOffset+0.6)*microNoise;
  }
}

function randRange(a,b){ return a + Math.random()*(b-a); }

// create birds
let birds = [];
function createBirds(n){
  birds.forEach(b => b.parent && b.parent.remove(b));
  birds = [];
  for (let i=0;i<n;i++){
    const b = new Bird({ size: settings.birdSize * randRange(0.9,1.15), flapSpeed: randRange(0.85,1.2), flapAmount: randRange(0.85,1.15), id:i });
    b.position.set(randRange(-6,6), randRange(2,7), randRange(-6,6));
    scene.add(b);
    birds.push(b);
  }
}
createBirds(settings.birdCount);

// UI bindings
const countEl = document.getElementById('count');
const flapSpeedEl = document.getElementById('flapSpeed');
const flapAmountEl = document.getElementById('flapAmount');
const flightSpeedEl = document.getElementById('flightSpeed');

if (countEl){
  countEl.value = settings.birdCount;
  countEl.oninput = (e)=> {
    let val = Math.min(settings.maxBirds, parseInt(e.target.value));
    settings.birdCount = val;
    createBirds(val);
  };
}
if (flapSpeedEl){
  flapSpeedEl.value = settings.flapBaseSpeed;
  flapSpeedEl.oninput = (e)=> settings.flapBaseSpeed = parseFloat(e.target.value);
}
if (flapAmountEl){
  flapAmountEl.value = settings.flapBaseAmount;
  flapAmountEl.oninput = (e)=> settings.flapBaseAmount = parseFloat(e.target.value);
}
if (flightSpeedEl){
  flightSpeedEl.value = settings.flightSpeed;
  flightSpeedEl.oninput = (e)=> settings.flightSpeed = parseFloat(e.target.value);
}
resetCamBtn.onclick = ()=>{ yaw = 0; pitch = -0.15; camera.position.set(0,8,settings.cameraDistance); };

// Camera handling
let stream = null;
async function startCamera(){
  try{
    // Prefer environment (rear) camera on phones
    const constraints = { video: { facingMode: { ideal: "environment" } }, audio: false };
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    await video.play();
    if (captureBtn) captureBtn.disabled = false;
    startBtn.textContent = 'Stop Camera';
  }catch(err){
    console.error('Camera access error', err);
    alert('カメラへのアクセスが必要です。設定を確認してください。\n' + (err && err.message ? err.message : ''));
  }
}
function stopCamera(){
  if (!stream) return;
  stream.getTracks().forEach(track => track.stop());
  stream = null;
  video.pause();
  video.srcObject = null;
  if (captureBtn) captureBtn.disabled = true;
  startBtn.textContent = 'Start Camera';
}

startBtn.addEventListener('click', async ()=>{
  if (stream) { stopCamera(); return; }
  await startCamera();
});

// Capture photo: composite video frame + WebGL canvas
if (captureBtn){
  captureBtn.addEventListener('click', ()=>{
    try {
      // use the renderer canvas resolution (device pixels)
      const webglCanvas = renderer.domElement;
      const w = webglCanvas.width;
      const h = webglCanvas.height;

      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const ctx = out.getContext('2d');

      // draw video to fill (stretched to canvas). This keeps it simple.
      // Option: compute cropping to preserve aspect ratio. For now, stretch cover.
      try {
        ctx.drawImage(video, 0, 0, w, h);
      } catch (e){
        console.warn('Video draw warning', e);
        // if video not ready, fill black
        ctx.fillStyle = '#000';
        ctx.fillRect(0,0,w,h);
      }

      // draw WebGL canvas on top
      ctx.drawImage(webglCanvas, 0, 0, w, h);

      // open data URL in new tab (or trigger download)
      out.toBlob((blob) => {
        if (!blob) {
          alert('キャプチャに失敗しました');
          return;
        }
        const url = URL.createObjectURL(blob);
        // open in new tab for user to save/share
        window.open(url, '_blank');
        // optional: revoke after a while
        setTimeout(()=>URL.revokeObjectURL(url), 60000);
      }, 'image/jpeg', 0.92);
    } catch(e){
      console.error('Capture failed', e);
      alert('キャプチャに失敗しました: ' + (e && e.message));
    }
  });
}

// main animation
let clock = new THREE.Clock();
let elapsed = 0;
function animate(){
  const dt = Math.min(0.06, clock.getDelta());
  elapsed += dt;

  for (let b of birds){
    b.params.flapSpeed = 1.0;
    b.params.flapAmount = 1.0;
    b.update(dt, elapsed * settings.flightSpeed);
  }

  const radius = settings.cameraDistance;
  const cx = Math.sin(yaw)*radius, cz = Math.cos(yaw)*radius;
  const cy = THREE.MathUtils.lerp(camera.position.y, 6 + pitch*6 + Math.sin(elapsed*0.2)*1.4, 0.08);
  camera.position.set(cx, cy, cz);
  camera.lookAt(0, 3, 0);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

// responsive
window.addEventListener('resize', ()=>{
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w,h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
});

// cleanup on page unload
window.addEventListener('pagehide', ()=> stopCamera());
