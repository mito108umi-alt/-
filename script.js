// script.js — bird.png sprite animation + phone camera + capture

const settings = {
  birdCount: 20, // default target flock size for performance
  birdSize: 1.0,
  flightSpeed: 1.0,
  flapBaseSpeed: 1.0,
  flapBaseAmount: 1.0,
  glideMinSec: 1.2,
  glideMaxSec: 3.6,
  areaRadius: 28,
  cameraDistance: 35,
  maxBirds: 30
};

// --------------------
// DOM
// --------------------
const video = document.getElementById("cameraFeed");
const canvas = document.getElementById("c");
const startBtn = document.getElementById("startCam");
const captureBtn = document.getElementById("capture");
const resetCamBtn = document.getElementById("resetCam");

// --------------------
// Three.js
// --------------------
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;

const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.1,
  2000
);

camera.position.set(0, 8, settings.cameraDistance);
camera.lookAt(0, 3, 0);

// --------------------
// Camera orbit (kept light)
// --------------------
let isPointerDown = false;
let lastX = 0;
let lastY = 0;
let yaw = 0;
let pitch = -0.15;

function onPointerDown(e) {
  isPointerDown = true;
  lastX = e.clientX;
  lastY = e.clientY;
}

function onPointerMove(e) {
  if (!isPointerDown) return;
  const dx = (e.clientX - lastX) * 0.002;
  const dy = (e.clientY - lastY) * 0.002;
  lastX = e.clientX;
  lastY = e.clientY;
  yaw -= dx;
  pitch = Math.max(-0.6, Math.min(0.3, pitch - dy));
}

function onPointerUp() { isPointerDown = false; }
window.addEventListener("pointerdown", onPointerDown);
window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);

// --------------------
// bird.png frames
// --------------------
const birdImage = new Image();
birdImage.src = "./bird.png";

const birdTextures = [];
let birdImagesReady = false;

birdImage.onload = () => {
  createBirdFrameTextures();
  birdImagesReady = true;
  createBirds(settings.birdCount);
};

birdImage.onerror = () => {
  console.error("bird.png を読み込めませんでした。パスを確認してください: ./bird.png");
  alert("bird.png を読み込めませんでした。\nscript.js と同じ場所に bird.png があるか確認してください。");
};

function createBirdFrameTextures() {
  birdTextures.length = 0;
  const sourceWidth = birdImage.naturalWidth;
  const sourceHeight = birdImage.naturalHeight;
  if (!sourceWidth || !sourceHeight) {
    console.error("bird.png のサイズを取得できませんでした。");
    return;
  }
  const frameHeight = sourceHeight / 3;
  for (let i = 0; i < 3; i++) {
    const frameCanvas = document.createElement("canvas");
    frameCanvas.width = sourceWidth;
    frameCanvas.height = Math.round(frameHeight);
    const ctx = frameCanvas.getContext("2d");
    ctx.clearRect(0, 0, frameCanvas.width, frameCanvas.height);
    ctx.drawImage(birdImage, 0, i * frameHeight, sourceWidth, frameHeight, 0, 0, sourceWidth, frameCanvas.height);
    const texture = new THREE.CanvasTexture(frameCanvas);
    texture.encoding = THREE.sRGBEncoding;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.format = THREE.RGBAFormat;
    birdTextures.push(texture);
  }
}

// --------------------
// Global animation phases
// --------------------
const PHASE = {
  WAIT: 0,
  APPROACH: 1,
  GATHER: 2,
  FORM: 3,
  CIRCLE: 4,
  EXIT: 5
};

const phaseTimes = {
  waitEnd: 0.2,
  approachEnd: 1.0,
  gatherEnd: 3.0,
  formEnd: 4.0,
  circleEnd: 8.0,
  exitEnd: 10.0
};

let elapsedTime = 0;
let currentPhase = PHASE.WAIT;

// flock center (reused)
const flockCenter = new THREE.Vector3(0, 5, 0);

// --------------------
// Bird class (sprite-based) - with reusable vectors to avoid allocations
// --------------------
class Bird extends THREE.Group {
  constructor(params = {}) {
    super();
    this.params = Object.assign({
      size: 1.0,
      flapSpeed: 1.0,
      phaseOffset: Math.random() * Math.PI * 2,
      positionOffset: new THREE.Vector3(randRange(-2, 2), randRange(-1.2, 1.2), randRange(-2, 2)),
      pathOffset: Math.random() * 100,
      id: 0,
      spawnTime: 0
    }, params);

    // reusable vectors
    this._target = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._forward = new THREE.Vector3();

    this.velocity = new THREE.Vector3();
    this.localSpeedMul = randRange(0.85, 1.25);
    this.flapTime = Math.random() * 10;
    this.frameIndex = 0;
    this.spawned = false; // becomes true after spawnTime

    // per-bird offset within flock
    this.flkOffset = new THREE.Vector3(randRange(-2.0, 2.0), randRange(-1.2, 1.2), randRange(-2.0, 2.0));

    // Sprite material
    this.material = new THREE.SpriteMaterial({ map: birdTextures[0], transparent: true, alphaTest: 0.02, depthWrite: false });
    this.sprite = new THREE.Sprite(this.material);

    const baseSize = 5.5 * this.params.size;
    this.baseScale = baseSize;
    this.sprite.scale.set(baseSize * 1.7, baseSize, 1);
    this.add(this.sprite);

    // set invisible until spawn
    this.visible = false;
  }

  // spawn initialization
  spawn(now) {
    this.spawned = true;
    this.visible = true;
    // place far in z and slightly randomized x,y
    const farZ = settings.areaRadius * 1.8 + randRange(0, 8);
    this.position.set(randRange(-2, 2) + this.params.positionOffset.x, randRange(1.5, 3.5) + this.params.positionOffset.y, farZ + this.params.positionOffset.z);
    // start very small
    const s = this.baseScale * 0.18;
    this.sprite.scale.set(s * 1.7, s, 1);
    // reset velocity small
    this.velocity.set(0, 0, 0);
  }

  update(dt, t) {
    // if not spawned yet, skip
    if (!this.spawned) return;

    // wing/flap
    const flapSpeed = this.params.flapSpeed * settings.flapBaseSpeed * this.localSpeedMul;
    this.flapTime += dt * flapSpeed * 3.8;
    const flapCycle = [0, 1, 2, 1];
    const idx = Math.floor(this.flapTime) % flapCycle.length;
    const nextFrame = flapCycle[idx];
    if (nextFrame !== this.frameIndex) {
      this.frameIndex = nextFrame;
      this.material.map = birdTextures[this.frameIndex];
      this.material.needsUpdate = true;
    }

    // spawn growth: during 1s after spawn, scale up smoothly
    const sinceSpawn = Math.max(0, elapsedTime - this.params.spawnTime);
    if (sinceSpawn < 1.0) {
      const p = THREE.MathUtils.smoothstep(sinceSpawn / 1.0, 0, 1);
      const desiredScale = this.baseScale * (0.7 + (this.params.size - 1) * 0.1);
      const s = THREE.MathUtils.lerp(this.baseScale * 0.18, desiredScale, p);
      this.sprite.scale.set(s * 1.7, s, 1);
    }

    // compute target depending on global phase
    if (currentPhase < PHASE.FORM) {
      // APPROACH / GATHER: use procedural path (keeps original flavor)
      const time = t * 0.4 + this.params.pathOffset;
      const rx = Math.sin(time * 0.9 + this.params.id) * settings.areaRadius * 0.7 + Math.sin(time * 0.33 + this.params.id * 2) * 6;
      const rz = Math.cos(time * 0.7 + this.params.id * 1.3) * settings.areaRadius * 0.5 + Math.cos(time * 0.23 + this.params.id * 0.9) * 6;
      const ry = Math.sin(time * 0.5 + this.params.id * 0.6) * 3 + Math.sin(time * 0.12 + this.params.id * 0.7) * 1.6 + 6;

      this._target.set(rx, ry, rz);

      // slight per-bird jitter
      this._target.x += this.params.positionOffset.x * 0.25;
      this._target.y += this.params.positionOffset.y * 0.25;
      this._target.z += this.params.positionOffset.z * 0.25;

      // if in GATHER phase and after 3s->4s transition we start blending toward flock center
      if (elapsedTime >= phaseTimes.gatherEnd) {
        // transition alpha 0 at gatherEnd, 1 at formEnd
        const a = THREE.MathUtils.clamp((elapsedTime - phaseTimes.gatherEnd) / (phaseTimes.formEnd - phaseTimes.gatherEnd), 0, 1);
        // compute flock target
        this._desired.copy(flockCenter).add(this.flkOffset);
        // blend
        this._target.lerp(this._desired, a);
      }
    } else {
      // FORM/CIRCLE/EXIT phases: move relative to flock center + offsets + oscillation
      // compute ellipse motion for flockCenter in animate(); here we just use flockCenter
      // per-bird desired position
      this._target.copy(flockCenter).add(this.flkOffset);
      // add small local sin/cos oscillation for natural look
      const w = 2.0 + this.params.id * 0.05;
      this._target.x += Math.sin(elapsedTime * (0.6 + (this.params.id % 3) * 0.02) + this.params.id) * 0.6;
      this._target.y += Math.cos(elapsedTime * (0.8 + (this.params.id % 4) * 0.03) + this.params.id * 0.7) * 0.4;
      this._target.z += Math.sin(elapsedTime * (0.4 + (this.params.id % 5) * 0.01) + this.params.id * 0.9) * 0.6;
    }

    // move toward target with smoothing
    this._desired.copy(this._target).sub(this.position).multiplyScalar(0.6 * dt * (0.6 + this.localSpeedMul * 0.6));
    this.velocity.lerp(this._desired, 0.55);
    this.position.add(this.velocity);

    // orientation: bank toward movement direction
    this._forward.copy(this.velocity);
    this._forward.y *= 0.6;
    if (this._forward.lengthSq() > 1e-6) {
      const bank = THREE.MathUtils.clamp(-this._forward.x * 0.8, -0.4363, 0.4363); // +-25deg in radians
      this.sprite.material.rotation = THREE.MathUtils.lerp(this.sprite.material.rotation || 0, bank, 0.08);
    }

    // depth-based scale: birds further in z appear smaller
    // map z to scale factor (assume z ~ -area..+area, but our z is positive further away)
    const z = this.position.z;
    // heuristic: nearer (smaller z) -> larger scale; farther (larger z) -> smaller
    const depthScale = THREE.MathUtils.clamp(1.2 - (z / (settings.areaRadius * 2.2)), 0.45, 1.6);
    const desiredScale = this.baseScale * (0.85 + (this.params.size - 1) * 0.12) * depthScale;
    // smooth scale
    const curSx = this.sprite.scale.x;
    const curSy = this.sprite.scale.y;
    const targetSx = desiredScale * 1.7;
    const targetSy = desiredScale;
    this.sprite.scale.x = THREE.MathUtils.lerp(curSx, targetSx, 0.08);
    this.sprite.scale.y = THREE.MathUtils.lerp(curSy, targetSy, 0.08);

    // if exit phase, progressively move out
    if (currentPhase === PHASE.EXIT) {
      // accelerate outward (toward top-right-away)
      const outDir = new THREE.Vector3(1.3, 0.6, -1.6).normalize();
      this.position.addScaledVector(outDir, dt * 18 * this.localSpeedMul);
      // hide when clearly off-screen (z negative deep enough or x large)
      if (this.position.z < -50 || Math.abs(this.position.x) > 150 || this.position.y > 120) {
        this.visible = false;
      }
    }
  }
}

// --------------------
// Utility
// --------------------
function randRange(a, b) { return a + Math.random() * (b - a); }

// --------------------
// Create birds (with spawn times)
// --------------------
let birds = [];

function clearBirds() {
  birds.forEach((bird) => {
    if (bird.parent) bird.parent.remove(bird);
    if (bird.material) bird.material.dispose();
  });
  birds = [];
}

function createBirds(n) {
  clearBirds();
  const target = Math.min(settings.maxBirds, Math.max(1, n));

  // schedule spawn times: first bird in 0.2-0.5s, others between 1-3s at ~0.1-0.25s intervals
  const spawnTimes = [];
  const first = randRange(0.2, 0.5);
  spawnTimes.push(first);
  let t = 1.0;
  for (let i = 1; i < target; i++) {
    t += randRange(0.08, 0.25);
    // clamp to gatherEnd
    t = Math.min(t, phaseTimes.gatherEnd - 0.02);
    spawnTimes.push(t);
  }

  for (let i = 0; i < target; i++) {
    const bird = new Bird({
      size: settings.birdSize * randRange(0.82, 1.15),
      flapSpeed: randRange(0.85, 1.2),
      id: i,
      spawnTime: spawnTimes[i] || 1.0
    });
    bird.visible = false;
    scene.add(bird);
    birds.push(bird);
  }
}

// --------------------
// UI bindings (kept)
// --------------------
const countEl = document.getElementById("count");
const flapSpeedEl = document.getElementById("flapSpeed");
const flapAmountEl = document.getElementById("flapAmount");
const flightSpeedEl = document.getElementById("flightSpeed");

if (countEl) {
  countEl.value = settings.birdCount;
  countEl.oninput = (e) => {
    const val = Math.min(settings.maxBirds, parseInt(e.target.value, 10));
    settings.birdCount = val;
    createBirds(val);
  };
}
if (flapSpeedEl) { flapSpeedEl.value = settings.flapBaseSpeed; flapSpeedEl.oninput = (e) => { settings.flapBaseSpeed = parseFloat(e.target.value); }; }
if (flapAmountEl) { flapAmountEl.value = settings.flapBaseAmount; flapAmountEl.oninput = (e) => { settings.flapBaseAmount = parseFloat(e.target.value); }; }
if (flightSpeedEl) { flightSpeedEl.value = settings.flightSpeed; flightSpeedEl.oninput = (e) => { settings.flightSpeed = parseFloat(e.target.value); }; }
if (resetCamBtn) { resetCamBtn.onclick = () => { yaw = 0; pitch = -0.15; camera.position.set(0, 8, settings.cameraDistance); }; }

// --------------------
// Phone camera (kept)
// --------------------
let stream = null;
async function startCamera() {
  try {
    const constraints = { video: { facingMode: { ideal: "environment" } }, audio: false };
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    await video.play();
    captureBtn.disabled = false;
    startBtn.textContent = 'Stop Camera';
  } catch (err) {
    console.error('Camera access error', err);
    alert('カメラへのアクセスが必要です。設定を確認してください。\n' + (err && err.message ? err.message : ''));
  }
}
function stopCamera(){ if (!stream) return; stream.getTracks().forEach(track => track.stop()); stream = null; video.pause(); video.srcObject = null; captureBtn.disabled = true; startBtn.textContent = 'Start Camera'; }
startBtn.addEventListener('click', async ()=>{ if (stream) { stopCamera(); return; } await startCamera(); });

// --------------------
// Capture (kept)
// --------------------
captureBtn.addEventListener('click', ()=>{
  try {
    const webglCanvas = renderer.domElement;
    const w = webglCanvas.width; const h = webglCanvas.height;
    const out = document.createElement('canvas'); out.width = w; out.height = h; const ctx = out.getContext('2d');
    try { ctx.drawImage(video, 0, 0, w, h); } catch (e) { console.warn('Video draw warning', e); ctx.fillStyle = '#000'; ctx.fillRect(0,0,w,h); }
    ctx.drawImage(webglCanvas, 0, 0, w, h);
    out.toBlob((blob) => { if (!blob) { alert('キャプチャに失敗しました'); return; } const url = URL.createObjectURL(blob); window.open(url, '_blank'); setTimeout(()=>URL.revokeObjectURL(url), 60000); }, 'image/jpeg', 0.92);
  } catch(e){ console.error('Capture failed', e); alert('キャプチャに失敗しました: ' + (e && e.message)); }
});

// --------------------
// Main animation with phase control
// --------------------
const clock = new THREE.Clock();
let elapsed = 0;

function updatePhase(now) {
  elapsedTime = now;
  if (now < phaseTimes.waitEnd) currentPhase = PHASE.WAIT;
  else if (now < phaseTimes.approachEnd) currentPhase = PHASE.APPROACH;
  else if (now < phaseTimes.gatherEnd) currentPhase = PHASE.GATHER;
  else if (now < phaseTimes.formEnd) currentPhase = PHASE.FORM;
  else if (now < phaseTimes.circleEnd) currentPhase = PHASE.CIRCLE;
  else currentPhase = PHASE.EXIT;
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.06, clock.getDelta());
  elapsed += dt; // elapsed is used for bird update time scaling

  // update current overall time and phase
  updatePhase(elapsed);

  // compute flockCenter movement depending on phase
  if (currentPhase === PHASE.WAIT) {
    // before anything, push flock center far away
    flockCenter.set(0, 6, settings.areaRadius * 1.6);
  } else if (currentPhase === PHASE.APPROACH) {
    // move center a bit toward screen center as first bird approaches
    const p = THREE.MathUtils.clamp((elapsed - phaseTimes.waitEnd) / (phaseTimes.approachEnd - phaseTimes.waitEnd), 0, 1);
    const target = new THREE.Vector3(0, 5, 8);
    flockCenter.lerp(target, p * 0.25 + 0.05); // slight movement
  } else if (currentPhase === PHASE.GATHER) {
    // gradually move center forward while birds spawn
    const p = THREE.MathUtils.clamp((elapsed - phaseTimes.approachEnd) / (phaseTimes.gatherEnd - phaseTimes.approachEnd), 0, 1);
    flockCenter.lerp(new THREE.Vector3(0, 5, 6), 0.02 + p * 0.06);
  } else if (currentPhase === PHASE.FORM) {
    // during formation transition, move center to start of circle path
    const t = THREE.MathUtils.clamp((elapsed - phaseTimes.gatherEnd) / (phaseTimes.formEnd - phaseTimes.gatherEnd), 0, 1);
    const start = flockCenter.clone();
    const circleStart = new THREE.Vector3(-12, 5, 6);
    flockCenter.lerp(circleStart, t * 0.18 + 0.02);
  } else if (currentPhase === PHASE.CIRCLE || currentPhase === PHASE.EXIT) {
    // circle motion: large right-handed clockwise orbit across screen
    const circleT = THREE.MathUtils.clamp((elapsed - phaseTimes.formEnd) / (phaseTimes.circleEnd - phaseTimes.formEnd), 0, 1);
    const angle = -Math.PI * 1.2 * circleT + Math.PI * 0.5; // clockwise sweep
    const rx = 18 * Math.cos(angle);
    const rz = 12 * Math.sin(angle) + 6; // offset forward a bit
    const ry = 5 + Math.sin(angle * 0.6) * 2.2;
    flockCenter.set(rx, ry, rz);
    // if EXIT phase, push further out
    if (currentPhase === PHASE.EXIT) {
      const exitT = THREE.MathUtils.clamp((elapsed - phaseTimes.circleEnd) / (phaseTimes.exitEnd - phaseTimes.circleEnd), 0, 1);
      // move flock center up/right/backwards
      flockCenter.x += 80 * exitT;
      flockCenter.y += 30 * exitT;
      flockCenter.z -= 60 * exitT;
    }
  }

  // spawn birds when their spawnTime arrives
  for (let i = 0; i < birds.length; i++) {
    const b = birds[i];
    if (!b.spawned && elapsed >= (b.params.spawnTime || 0)) {
      b.spawn();
    }
    // update each bird (pass dt and elapsed)
    b.update(dt, elapsed * settings.flightSpeed);
  }

  // camera orbit smoothing
  const radius = settings.cameraDistance;
  const cx = Math.sin(yaw) * radius;
  const cz = Math.cos(yaw) * radius;
  const cy = THREE.MathUtils.lerp(camera.position.y, 6 + pitch * 6 + Math.sin(elapsed * 0.2) * 1.4, 0.08);
  camera.position.set(cx, cy, cz);
  camera.lookAt(0, 3, 0);

  renderer.render(scene, camera);
}

animate();

// --------------------
// Resize & Cleanup
// --------------------
window.addEventListener("resize", () => {
  const w = window.innerWidth; const h = window.innerHeight;
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  camera.aspect = w / h; camera.updateProjectionMatrix();
});
window.addEventListener("pagehide", () => { stopCamera(); });
