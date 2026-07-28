// script.js — bird.png sprite animation + phone camera + capture

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
  maxBirds: 8
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
// Camera orbit
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

function onPointerUp() {
  isPointerDown = false;
}

window.addEventListener("pointerdown", onPointerDown);
window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);

// --------------------
// bird.png
//
// 1枚の縦長PNGに
// 上：翼が上
// 中：翼が水平
// 下：翼が下
// の3羽が配置されている前提
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
  alert(
    "bird.png を読み込めませんでした。\n" +
      "script.js と同じ場所に bird.png があるか確認してください。"
  );
};

// PNGから3つの鳥を切り出して個別テクスチャ化
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

    ctx.drawImage(
      birdImage,
      0,
      i * frameHeight,
      sourceWidth,
      frameHeight,
      0,
      0,
      sourceWidth,
      frameCanvas.height
    );

    const texture = new THREE.CanvasTexture(frameCanvas);

    texture.encoding = THREE.sRGBEncoding;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    // ensure transparent areas are preserved
    texture.format = THREE.RGBAFormat;

    birdTextures.push(texture);
  }
}

// --------------------
// Bird
// --------------------

class Bird extends THREE.Group {

  constructor(params = {}) {
    super();

    this.params = Object.assign(
      {
        size: 1.0,
        flapSpeed: 1.0,
        phaseOffset: Math.random() * Math.PI * 2,
        positionOffset: new THREE.Vector3(
          randRange(-8, 8),
          randRange(0, 6),
          randRange(-8, 8)
        ),
        pathOffset: Math.random() * 100,
        id: 0
      },
      params
    );

    this.velocity = new THREE.Vector3();

    this.localSpeedMul = randRange(0.85, 1.25);

    this.flapTime =
      Math.random() * 10;

    this.frameIndex = 0;

    // SpriteMaterial
    this.material = new THREE.SpriteMaterial({
      map: birdTextures[0],
      transparent: true,
      alphaTest: 0.02,
      depthWrite: false
    });

    this.sprite = new THREE.Sprite(this.material);

    /*
      bird.png は横長の鳥なので、
      Spriteも横長にする
    */
    const baseSize =
      5.5 *
      this.params.size;

    this.sprite.scale.set(
      baseSize * 1.7,
      baseSize,
      1
    );

    this.add(this.sprite);

    this.position.copy(
      this.params.positionOffset
    );
  }

  update(dt, t) {

    // --------------------
    // 羽ばたき
    // --------------------

    const flapSpeed =
      this.params.flapSpeed *
      settings.flapBaseSpeed *
      this.localSpeedMul;

    this.flapTime +=
      dt *
      flapSpeed *
      3.8;

    /*
      3ポーズを

      上
      中
      下
      中

      の順で切り替える
    */
    const flapCycle = [
      0,
      1,
      2,
      1
    ];

    const index =
      Math.floor(this.flapTime) %
      flapCycle.length;

    const nextFrame =
      flapCycle[index];

    if (nextFrame !== this.frameIndex) {

      this.frameIndex =
        nextFrame;

      this.material.map =
        birdTextures[this.frameIndex];

      this.material.needsUpdate =
        true;
    }

    // 少し上下に揺らす
    this.sprite.position.y =
      Math.sin(
        t * 2 +
        this.params.phaseOffset
      ) * 0.12;

    // --------------------
    // 飛行経路
    // --------------------

    const baseSpeed =
      0.6 *
      settings.flightSpeed *
      this.localSpeedMul;

    const time =
      t * 0.4 +
      this.params.pathOffset;

    const rx =
      Math.sin(
        time * 0.9 +
        this.params.id
      ) *
        settings.areaRadius *
        0.7 +
      Math.sin(
        time * 0.33 +
        this.params.id * 2
      ) *
        6;

    const rz =
      Math.cos(
        time * 0.7 +
        this.params.id * 1.3
      ) *
        settings.areaRadius *
        0.5 +
      Math.cos(
        time * 0.23 +
        this.params.id * 0.9
      ) *
        6;

    const ry =
      Math.sin(
        time * 0.5 +
        this.params.id * 0.6
      ) *
        3 +
      Math.sin(
        time * 0.12 +
        this.params.id * 0.7
      ) *
        1.6 +
      6;

    const target =
      new THREE.Vector3(
        rx,
        ry,
        rz
      );

    target.add(
      this.params.positionOffset
        .clone()
        .multiplyScalar(0.25)
    );

    const desired =
      target
        .clone()
        .sub(this.position)
        .multiplyScalar(
          0.6 *
          dt *
          baseSpeed
        );

    this.velocity.lerp(
      desired,
      0.55
    );

    this.position.add(
      this.velocity
    );

    // --------------------
    // 飛んでいる方向に合わせる
    // --------------------

    const forward =
      this.velocity.clone();

    if (
      forward.lengthSq() >
      0.000001
    ) {

      /*
        Spriteは常にカメラ方向を向くため、
        3Dモデルのような回転はさせない。

        代わりに画面上で少し傾けて
        飛翔感を出す。
      */

      const bank =
        THREE.MathUtils.clamp(
          -forward.x * 0.8,
          -0.35,
          0.35
        );

      this.sprite.material.rotation =
        THREE.MathUtils.lerp(
          this.sprite.material.rotation || 0,
          bank,
          0.08
        );

      // 進行方向に応じてスケールで遠近を表現
      const speed = forward.length();
      const depthScale = THREE.MathUtils.clamp(1.0 - Math.abs(forward.z) * 0.02, 0.6, 1.3);

      // size varies slightly per bird and with z component to simulate depth
      const baseSize = 5.5 * this.params.size;
      const scaleFactor = baseSize * (0.85 + (this.params.size - 1) * 0.2) * (0.9 + (this.localSpeedMul - 1) * 0.15) * depthScale;

      this.sprite.scale.set(scaleFactor * 1.7, scaleFactor, 1);
    }
  }
}

// --------------------
// Utility
// --------------------

function randRange(a, b) {
  return (
    a +
    Math.random() *
      (b - a)
  );
}

// --------------------
// Create birds
// --------------------

let birds = [];

function clearBirds() {

  birds.forEach((bird) => {

    if (bird.parent) {
      bird.parent.remove(bird);
    }

    if (bird.material) {
      bird.material.dispose();
    }

  });

  birds = [];
}

function createBirds(n) {

  if (!birdImagesReady) {
    return;
  }

  clearBirds();

  for (let i = 0; i < n; i++) {

    const bird =
      new Bird({
        size:
          settings.birdSize *
          randRange(
            0.82,
            1.15
          ),

        flapSpeed:
          randRange(
            0.85,
            1.2
          ),

        id: i
      });

    bird.position.set(
      randRange(-6, 6),
      randRange(2, 7),
      randRange(-6, 6)
    );

    scene.add(bird);

    birds.push(bird);
  }
}

// --------------------
// UI
// --------------------

const countEl =
  document.getElementById(
    "count"
  );

const flapSpeedEl =
  document.getElementById(
    "flapSpeed"
  );

const flapAmountEl =
  document.getElementById(
    "flapAmount"
  );

const flightSpeedEl =
  document.getElementById(
    "flightSpeed"
  );

if (countEl) {

  countEl.value =
    settings.birdCount;

  countEl.oninput = (e) => {

    const val =
      Math.min(
        settings.maxBirds,
        parseInt(
          e.target.value,
          10
        )
      );

    settings.birdCount =
      val;

    createBirds(val);
  };
}

if (flapSpeedEl) {

  flapSpeedEl.value =
    settings.flapBaseSpeed;

  flapSpeedEl.oninput =
    (e) => {

      settings.flapBaseSpeed =
        parseFloat(
          e.target.value
        );

    };
}

/*
  旧UIとの互換用。
  PNG方式では翼そのものを変形しないため
  Flap Sizeは表示上残す。
*/
if (flapAmountEl) {

  flapAmountEl.value =
    settings.flapBaseAmount;

  flapAmountEl.oninput =
    (e) => {

      settings.flapBaseAmount =
        parseFloat(
          e.target.value
        );

    };
}

if (flightSpeedEl) {

  flightSpeedEl.value =
    settings.flightSpeed;

  flightSpeedEl.oninput =
    (e) => {

      settings.flightSpeed =
        parseFloat(
          e.target.value
        );

    };
}

if (resetCamBtn) {

  resetCamBtn.onclick =
    () => {

      yaw = 0;
      pitch = -0.15;

      camera.position.set(
        0,
        8,
        settings.cameraDistance
      );
    };
}

// --------------------
// Phone camera
// --------------------

let stream = null;

async function startCamera() {

  try {

    const constraints = {
      video: {
        facingMode: {
          ideal: "environment"
        }
      },
      audio: false
    };

    stream =
      await navigator.mediaDevices
        .getUserMedia(
          constraints
        );

    video.srcObject =
      stream;

    await video.play();

    captureBtn.disabled =
      false;

    startBtn.textContent =
      "Stop Camera";

  } catch (err) {

    console.error(
      "Camera access error",
      err
    );

    alert(
      "カメラへのアクセスが必要です。設定を確認してください。\n" +
      (
        err &&
        err.message
          ? err.message
          : ""
      )
    );
  }
}

function stopCamera() {

  if (!stream) {
    return;
  }

  stream
    .getTracks()
    .forEach(
      (track) =>
        track.stop()
    );

  stream = null;

  video.pause();

  video.srcObject =
    null;

  captureBtn.disabled =
    true;

  startBtn.textContent =
    "Start Camera";
}

startBtn.addEventListener(
  "click",
  async () => {

    if (stream) {

      stopCamera();
      return;
    }

    await startCamera();
  }
);

// --------------------
// Capture
// --------------------

captureBtn.addEventListener(
  "click",
  () => {

    try {

      const webglCanvas =
        renderer.domElement;

      const w =
        webglCanvas.width;

      const h =
        webglCanvas.height;

      const out =
        document.createElement(
          "canvas"
        );

      out.width = w;
      out.height = h;

      const ctx =
        out.getContext("2d");

      try {

        ctx.drawImage(
          video,
          0,
          0,
          w,
          h
        );

      } catch (e) {

        console.warn(
          "Video draw warning",
          e
        );

        ctx.fillStyle =
          "#000";

        ctx.fillRect(
          0,
          0,
          w,
          h
        );
      }

      ctx.drawImage(
        webglCanvas,
        0,
        0,
        w,
        h
      );

      out.toBlob(
        (blob) => {

          if (!blob) {

            alert(
              "キャプチャに失敗しました"
            );

            return;
          }

          const url =
            URL.createObjectURL(
              blob
            );

          window.open(
            url,
            "_blank"
          );

          setTimeout(
            () =>
              URL.revokeObjectURL(
                url
              ),
            60000
          );
        },
        "image/jpeg",
        0.92
      );

    } catch (e) {

      console.error(
        "Capture failed",
        e
      );

      alert(
        "キャプチャに失敗しました: " +
        (
          e &&
          e.message
            ? e.message
            : ""
        )
      );
    }
  }
);

// --------------------
// Main animation
// --------------------

const clock =
  new THREE.Clock();

let elapsed = 0;

function animate() {

  requestAnimationFrame(
    animate
  );

  const dt =
    Math.min(
      0.06,
      clock.getDelta()
    );

  elapsed += dt;

  for (
    const bird of birds
  ) {

    bird.params.flapSpeed =
      1.0;

    bird.update(
      dt,
      elapsed *
        settings.flightSpeed
    );
  }

  const radius =
    settings.cameraDistance;

  const cx =
    Math.sin(yaw) *
    radius;

  const cz =
    Math.cos(yaw) *
    radius;

  const cy =
    THREE.MathUtils.lerp(
      camera.position.y,
      6 +
        pitch * 6 +
        Math.sin(
          elapsed * 0.2
        ) *
          1.4,
      0.08
    );

  camera.position.set(
    cx,
    cy,
    cz
  );

  camera.lookAt(
    0,
    3,
    0
  );

  renderer.render(
    scene,
    camera
  );
}

animate();

// --------------------
// Resize
// --------------------

window.addEventListener(
  "resize",
  () => {

    const w =
      window.innerWidth;

    const h =
      window.innerHeight;

    renderer.setSize(
      w,
      h
    );

    renderer.setPixelRatio(
      Math.min(
        window.devicePixelRatio ||
          1,
        2
      )
    );

    camera.aspect =
      w / h;

    camera.updateProjectionMatrix();
  }
);

// --------------------
// Cleanup
// --------------------

window.addEventListener(
  "pagehide",
  () => {
    stopCamera();
  }
);
