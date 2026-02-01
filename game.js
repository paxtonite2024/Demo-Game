const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const buttons = document.querySelectorAll(".noteBtn");
const feedbackText = document.getElementById("feedbackText");
const comboNum = document.getElementById("comboNum");
const scoreDisplay = document.getElementById("score");
const gameContainer = document.getElementById("gameContainer");

const keyMap = {
  KeyT: 0,
  KeyY: 1,
  KeyU: 2,
  KeyI: 3,
  KeyO: 4   // เพิ่มเลนที่ 5
};

const laneCount = 5;
const laneData = [];

const laneWidth = canvas.width * 0.15;
const laneGap = canvas.width * 0.0;

const totalLaneWidth =
  laneCount * laneWidth + (laneCount - 1) * laneGap;

const laneStartX = (canvas.width - totalLaneWidth) / 2;

for (let i = 0; i < laneCount; i++) {
  laneData.push({
    x: laneStartX + i * (laneWidth + laneGap),
    width: laneWidth,

    pressAlpha: 0,      // highlight ตอนกด
    hitGlowAlpha: 0     // glow ตอนกดโดน
  });
}


const PIXELS_PER_MS = 0.35;
const HIT_WINDOW_PERFECT_MS = 200; // ✅ ขยายระยะเพื่อเล่นง่ายขึ้น
const HIT_WINDOW_GREAT_MS = 300;
const HIT_WINDOW_GOOD_MS = 500;
const END_HOLD_TOLERANCE = 500; // ปล่อยได้ก่อนถึงเส้นปลาย XXpx โดยไม่ถือว่า MISS
const SPAWN_LEAD_TIME = 2000; // ms
const SLIDE_LEAD_TIME = 5000;
const HIT_EARLY_BUFFER = 100; // ms
const NOTE_SPEED = 12.0;
const SLIDE_TIMING = {
  PERFECT: 400,
  GREAT: 500,
  GOOD: 600,
}
const SLIDE_END_BUFFER_MS = 250;
const SAFE_BOTTOM = window.safeAreaInsetBottom || 20;
const hitLine = canvas.height - 80;
const activePointers = new Map();
const PRE_ROLL_TIME = 1000;



let bgCoverImg = null;
let bgAmbientColor = "rgb(0,0,0)";
let currentSong = null;
let gameStarted = false;
let combo = 0;
let score = 0;
let notes = [];
let slideNotes = [];
let isGameRunning = false;
let spawnNoteInterval = null;
let hitLineEffect = {
  state: "normal",
  timer: 0
};
let gameStartTime = 0;
let audioStarted = false;
let holdFeedbackActive = false;
let currentHoldRank = "PERFECT"
let gameNow = 0;
let renderNow = 0;
let judgeEvents = [];
let activeHoldCount = 0;
let hitEffects = [];
let holdEffects = {};
let activeSlide = null
let uiMode = "select";
let isPaused = false;
let pauseStartTime = 0;
let preRollRemaining = PRE_ROLL_TIME;
let phase = "preroll";
let notesReady = false;
let audioTimeOffset = 0;
let lastFrameTime = null;
let justStartedAudio = false;
let audioPrimed = false;
let introPhase = 0; // 0 = ปกติ / 1-4 = intro
let introStartTime = 0;
let bgCanvas = document.createElement("canvas");
let bgCtx = bgCanvas.getContext("2d");

// ===============================
// Camera (Bird Eye View)
// ===============================
const CAMERA = {
  depthScale: 0.00175 // ปรับได้: ยิ่งมากยิ่ง perspective แรง
};

// แปลง world (x,y) -> screen (x,y)
function project(x, y) {
  const dy = hitLine - y; // ระยะจากกล้อง
  const scale = 1 / (1 + dy * CAMERA.depthScale);

  return {
    x: canvas.width / 2 + (x - canvas.width / 2) * scale,
    y: hitLine - dy * scale,
    scale
  };
}


let flareElem = null;
function showFlareEffectOnButton(button) {
  const flare = document.createElement('div');
  flare.className = 'flareEffect';
  button.appendChild(flare);

  setTimeout(() => {
    button.removeChild(flare);
  }, 300);
}

class Note {
  constructor(lane, time, type = "normal", length = 0, path = null) {
  this.lane = lane;
  this.time = time;       // ms
  this.length = length;  // ms (เหมือน editor)
  this.type = type;

  this.bodyLengthPx = this.length * PIXELS_PER_MS;
  this.x = laneData[this.lane].x;
  this.width = laneData[this.lane].width;
  this.height = 25;

  this.active = true;
  this.wasHit = false;
  this.isHolding = false;
  this.releasedEarly = false;
  this.ended = false;
  this.holdProgress = 0;
  this.lastHoldComboTime = 0;
  this.holdComboInterval = 120; // ms ต่อ 1 combo (ปรับฟิลตรงนี้)
  this.wasHeld = false;        // เคยกด Long Note นี้หรือยัง
  this.judgement = "pending";
  this.holdFailed = false;    // เคยกด แต่ปล่อยก่อนหมด
  this.missReported = false;

  this.renderY = null;
  this.renderEndY = null; // ✅ เพิ่มบรรทัดนี้
  this.dead = false;
  }


  startHoldScore() {
    if (this.type !== "long" || this.isHolding || !this.active) return;

    this.isHolding = true;
    activeHoldCount++;
    this.wasHeld = true;
    this.holdProgress = 0;

    this.holdStartTime = gameNow;
    this.lastHoldComboTime = gameNow;

    holdEffects[this.lane] = {
      time: 0
    };
  }


  stopHoldScore() {
    activeHoldCount = Math.max(0, activeHoldCount - 1);

    if (this.type !== "long" || !this.isHolding || this.ended) return;

      this.isHolding = false;
      holdFeedbackActive = false;
      delete holdEffects[this.lane];
      laneHitState[this.lane].active = false;

      const holdRatio = this.holdProgress / this.length;

      if (holdRatio >= 0.90) {
        score += 300;
        showFeedback("PERFECT");
        this.ended = true;          // ✅ จบแบบสำเร็จ
      }
      else if (holdRatio >= 0.80) {
        score += 200;
        showFeedback("GREAT");
        this.ended = true;
      }
      else if (holdRatio >= 0.60) {
        score += 100;
        showFeedback("GOOD");
        this.ended = true;
      }
      else {
        // ❗ MISS หลังจากเคยกด
        this.holdFailed = true;     // ✅ สีเทา
        combo = 0;
        updateComboScore();
        showFeedback("MISS");
        laneHitState[this.lane].active = false;
      }

      updateComboScore();
    }


update() {
  const now = gameNow;
  this.y = hitLine - (this.time - now) * PIXELS_PER_MS * NOTE_SPEED;

  if (this.renderY === null) {
    this.renderY = this.y; // ตั้งค่าเริ่มต้นครั้งแรก
  } else {
    this.renderY = smooth(this.renderY, this.y, 0.12);
  }

  this.endY = hitLine - (this.time + this.length - now) * PIXELS_PER_MS * NOTE_SPEED;

  if (this.renderEndY === null) {
    this.renderEndY = this.endY;
  } else {
    this.renderEndY = smooth(this.renderEndY, this.endY, 0.12);
  }

  if (this.isHolding && !this.ended && this.active) {

    this.holdProgress = Math.min(
      now - this.holdStartTime,
      this.length
    );

    if (now - this.lastHoldComboTime >= this.holdComboInterval) {
      combo++;
      updateComboScore();
      showHoldFeedback(currentHoldRank);
      this.lastHoldComboTime = now;
    }

    if (this.holdProgress >= this.length && !this.ended) {
      this.stopHoldScore(true);
    }
  }
  for (let i = 0; i < laneCount; i++) {
    const target = keysPressed[i] ? 5 : 0; // ความลึกเป้าหมาย
    pressDepth[i] += (target - pressDepth[i]) * 0.35;
  }
}


draw() {
  if (this.type === "normal" && this.wasHit) {
    return;
  }

  if (!this.active && !this.wasHit) return;

  if (this.type === "long") {

    let bodyColor   = "rgba(0,200,255,0.5)";
    let headColor   = "rgba(0,255,255,1)";
    let endColor    = "rgba(0,255,255,0.9)";

    // 🟢 State B : Hold อยู่ → สว่างเฉพาะ Body
    if (this.isHolding) {
      bodyColor = "rgba(100,255,255,0.7)";
    }

    // ⚫ State C : ปล่อยพลาด
    if (this.holdFailed) {
      bodyColor = "rgba(160,160,160,0.35)";
      headColor = "rgba(160,160,160,0.8)";
      endColor  = "rgba(160,160,160,0.8)";
    }

    // 🟢 State A : วิ่งปกติ
    // → ไม่ต้องทำอะไรเพิ่ม (ใช้ค่าปกติ)

    const headY = this.renderY;
    const endY  = this.renderEndY;

    if (endY < hitLine) {

      const topY    = Math.min(headY, endY);
      const bottomY = Math.min(hitLine, Math.max(headY, endY));

      if (bottomY - topY > 1) {
        const centerX = this.x + this.width / 2;

        const nearP = project(centerX, bottomY);
        const farP  = project(centerX, topY);

        if (nearP.scale > 0.001 && farP.scale > 0.001) {
          const nearW = this.width * nearP.scale * 0.2;
          const farW  = this.width * farP.scale  * 0.2;

          ctx.fillStyle = bodyColor;
          ctx.beginPath();
          ctx.moveTo(nearP.x - nearW / 2, nearP.y);
          ctx.lineTo(nearP.x + nearW / 2, nearP.y);
          ctx.lineTo(farP.x + farW / 2, farP.y);
          ctx.lineTo(farP.x - farW / 2, farP.y);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // ===== END NOTE =====
    const endP = project(this.x + this.width / 2, endY);
    const endScale = 0.5;

    const endW = this.width * endP.scale * endScale;
    const endH = this.height * endP.scale * endScale;

    ctx.fillStyle = endColor;
    ctx.fillRect(
      endP.x - endW / 2,
      endP.y - endH / 2,
      endW,
      endH
    );


    // ===== HEAD =====
    ctx.fillStyle = headColor;
    const p = project(this.x + this.width / 2, this.renderY);
    const w = this.width * p.scale;
    const h = this.height * p.scale;

    ctx.fillRect(
      p.x - w / 2,
      p.y - h / 2,
      w,
      h
    );
  }

  else {
    // normal note
    ctx.fillStyle = "#fff";
    const p = project(this.x + this.width / 2, this.y);
    const w = this.width * p.scale;
    const h = this.height * p.scale;

    ctx.fillRect(
      p.x - w / 2,
      p.y - h / 2,
      w,
      h
    );
  }
}

  isHittable() {
    return (
      this.active &&
      !this.wasHit &&
      this.y + this.height > hitLine - HIT_WINDOW_PERFECT_MS &&
      this.y < hitLine + HIT_WINDOW_PERFECT_MS
    );
  }
  
  isMissed() {
    if (!this.active || this.wasHit) return false;

    // ===== LONG NOTE =====
    if (this.type === "long") {
      if (this.holdFailed) {
        if (gameNow > this.time + this.length + END_HOLD_TOLERANCE) {
          this.dead = true;
        }
        return false;
      }

      if (this.isHolding || this.ended) return false;

      if (gameNow > this.time + this.length + END_HOLD_TOLERANCE) {
        this.dead = true;
        return true;
      }
    }

    // ===== NORMAL NOTE =====
    // คำนวณตำแหน่งตาม logic (ไม่ใช่ render)
    const logicY = hitLine - (this.time - gameNow) * PIXELS_PER_MS;

    // MISS เมื่อ "ผ่าน hitLine ลงไปแล้ว"
    return logicY > hitLine + this.height;
  }
}

class SlideNote {
  constructor(time, points) {
    this.type = "slide"
    this.time = time

    // ===== POINT DATA (ห้ามหาย) =====
    this.points = points
      .map(p => ({ lane: p.lane, t: p.t }))
      .sort((a, b) => a.t - b.t)

    this.cachedPoints = this.points.map(p => ({
      lane: p.lane,
      t: p.t,
      x: laneData[p.lane].x + laneData[p.lane].width / 2
    }))

    this.renderPoints = this.cachedPoints.map(p => ({
      x: p.x,
      y: hitLine,
      scale: 1
    }))

    // ===== STATE (เหมือน Long Note) =====
    this.active = true          // ❗ ต้อง true ตั้งแต่ spawn
    this.started = false
    this.failed = false
    this.finished = false
    this.dead = false

    this.currentIndex = 0

    this.headRank = null
    this.endRank = null

    this.holdTickTimer = 0
    this.lastHoldTime = 0
    this.releaseGrace = 0

    this.waitingForEnd = false
    this.endJudged = false
  }


  update() {
    const now = gameNow;
    if (this.renderPoints.length !== this.cachedPoints.length) {
      this.renderPoints = this.cachedPoints.map(p => ({
        x: p.x,
        y: hitLine,
        scale: 1
      }));
    }


    for (let i = 0; i < this.cachedPoints.length; i++) {
      const p = this.cachedPoints[i];
      const noteTime = this.time + p.t;
      const targetY = hitLine - (noteTime - now) * PIXELS_PER_MS * NOTE_SPEED;
      const proj = project(p.x, targetY);

      this.renderPoints[i].y = targetY;
      this.renderPoints[i].scale = Math.max(proj.scale, 0.01);
    }
    
  }

  draw() {
    if (this.dead) return;
    const len = this.renderPoints.length;
    if (len < 2) return;

    // ===== BODY =====
    for (let i = 0; i < len - 1; i++) {
      const p0 = this.renderPoints[i];
      const p1 = this.renderPoints[i+1];

      if (!p0 || !p1) continue;

      const y0 = Math.min(p0.y, canvas.height + 200);
      const y1 = Math.min(p1.y, canvas.height + 200);
      const x0 = Math.max(0, Math.min(canvas.width, p0.x));
      const x1 = Math.max(0, Math.min(canvas.width, p1.x));

      const nearP = project(x0, y0);
      const farP  = project(x1, y1);

      const nearScale = Math.max(nearP.scale, 0.01);
      const farScale  = Math.max(farP.scale, 0.01);

      // width ตาม lane × scale ของ point
      const nearW = laneData[this.cachedPoints[i].lane].width * nearScale * 0.25;
      const farW  = laneData[this.cachedPoints[i+1].lane].width * farScale * 0.25;

      // minimum segment height ป้องกันแว้บ
      if (Math.abs(farP.y - nearP.y) < 2) farP.y = nearP.y + 2;

      ctx.fillStyle = "rgba(0,200,255,0.45)";
      ctx.beginPath();
      ctx.moveTo(nearP.x - nearW/2, nearP.y);
      ctx.lineTo(nearP.x + nearW/2, nearP.y);
      ctx.lineTo(farP.x + farW/2, farP.y);
      ctx.lineTo(farP.x - farW/2, farP.y);
      ctx.closePath();
      ctx.fill();
    }

    // ===== HEAD / END =====
    this.renderPoints.forEach((p, i) => {
      const proj = project(p.x, p.y);
      if (proj.scale < 0.001) return;

      let w, h, color;
      const lane = this.cachedPoints[i].lane;

      if (i === 0) {        // HEAD
        w = laneData[lane].width * proj.scale;
        h = 25 * proj.scale;
        color = "rgba(0,255,255,1)";
      } else if (i === len - 1) { // END
        w = laneData[lane].width * proj.scale * 0.5;
        h = 25 * proj.scale * 0.5;
        color = "rgba(0,255,255,0.9)";
      } else {              // NODE
        w = laneData[lane].width * proj.scale * 0.35;
        h = 25 * proj.scale * 0.35;
        color = "rgba(0,255,255,0.85)";
      }

      ctx.fillStyle = color;
      ctx.fillRect(proj.x - w/2, proj.y - h/2, w, h);
    });
  }
}

class HitEffect {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.life = 1;
    this.rotation = Math.random() * Math.PI * 2;
  }

  update() {
    this.life -= 0.08;
    this.rotation += 0.1;
  }

  draw() {
    if (this.life <= 0) return;

    const p = project(this.x, this.y);

    const pulse = 1 + Math.sin((1 - this.life) * Math.PI) * 0.15;
    const baseRadius = 24 * p.scale * pulse;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(this.rotation);
    ctx.globalAlpha = this.life * 0.6;
    ctx.strokeStyle = "#E8FFFF";
    ctx.lineWidth = 2 * p.scale;
    ctx.shadowColor = "#BFFFFF";
    ctx.shadowBlur = 25 * p.scale;

    // จำนวนวง
    const rings = 4;
    const waveSpeed = 0.6;
    
    for (let i = 0; i < rings; i++) {
      const phaseOffset = i * 0.6; // 👈 สำคัญ
      const wave =
        Math.sin((1 - this.life) * Math.PI * waveSpeed - phaseOffset) * 0.2;

      const r = baseRadius + i * 12 * p.scale + wave * 12 * p.scale;

      ctx.globalAlpha = this.life * (0.6 - i * 0.1);

      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }
}

function updateLaneHitState() {
  laneHitState.forEach(s => {
    if (!s.active && s.life > 0) {
      s.life -= 0.08;
      if (s.life < 0) s.life = 0;
    }
  });
}

function updateHitEffects() {
  hitEffects.forEach(e => e.update());
  hitEffects = hitEffects.filter(e => e.life > 0);
}

function drawHitEffects() {
  hitEffects.forEach(e => e.draw());
}

function drawHoldEffects() {
  for (const lane in holdEffects) {
    const effect = holdEffects[lane];
    effect.time += 0.1;

    const l = laneData[lane];
    const centerX = l.x + l.width / 2;

    const pulse = 1 + Math.sin(effect.time) * 0.1;
    const rotation = effect.time * 0.15;

    const p = project(centerX, hitLine);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(rotation);
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "#AFFFFF";
    ctx.lineWidth = 2.5 * p.scale;

    const rings = 4;
    const baseRadius = 24 * p.scale * pulse;

    for (let i = 0; i < rings; i++) {
      const wave =
        Math.sin(effect.time - i * 0.7) * 0.15;

      const r = baseRadius + i * 14 * p.scale + wave * 12 * p.scale;

      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }
}

// Rest of the game logic continues...

let noteData = [];
let noteIndex = 0;
let startTime = 0;



function spawnNotesByTime() {
  if (!gameStarted) return;
  if (!noteData || noteData.length === 0) return;

  const currentTime = gameNow;

  while (
    noteIndex < noteData.length &&
    noteData[noteIndex].time <= currentTime + SPAWN_LEAD_TIME
  ) {
    const n = noteData[noteIndex];
    const lead =
      (n.type === "slide" || n.type === "path")
        ? SLIDE_LEAD_TIME
        : SPAWN_LEAD_TIME;

    if (n.time <= currentTime + lead) {
      if (n.type === "slide" || n.type === "path") {
        slideNotes.push(new SlideNote(n.time, n.points));
      } else {
        notes.push(
          new Note(n.lane, n.time, n.type || "normal", n.length || 0)
        );
      }
      noteIndex++;
    } else {
      break;
    }
  }
}

function updateNotes() {
  notes.forEach(note => {
    // คำนวณตำแหน่งตามเวลาปัจจุบัน + SPAWN_LEAD_TIME
    const timeUntilHit = note.time - gameNow;

    // ให้โน้ตเริ่มจากด้านบนล่วงหน้า SPAWN_LEAD_TIME
    note.y = hitLine - timeUntilHit * PIXELS_PER_MS * NOTE_SPEED;

    // สำหรับ Long Note / body
    note.update();

    if (note.isMissed()) {
      // ===== NORMAL NOTE =====
      if (note.type === "normal") {
        note.active = false;
        note.wasHit = true;
        judgeEvents.push({
          time: gameNow,
          type: "MISS",
          rank: null,
          lane: note.lane,
          noteId: note.time
        });
      }

      // ===== LONG NOTE : ไม่เคยกดเลย =====
      if (
        note.type === "long" &&
        !note.wasHeld &&
        !note.holdFailed &&
        !note.missReported
      ) {
        judgeEvents.push({
          time: note.time + HIT_WINDOW_GOOD_MS,
          type: "MISS",
          rank: null,
          lane: note.lane,
          noteId: note.time
        });

        note.missReported = true;
      }
    }
  });

  // ลบโน้ตที่ตายแล้ว
  notes = notes.filter(note => !note.dead);

  slideNotes.forEach(slide => {
    slide.update();
    if (activeSlide && activeSlide.dead) activeSlide = null;
    updateSlideGameplay(slide);
  });
  slideNotes = slideNotes.filter(slide => !slide.dead);
}

function updateSlideGameplay(slide) {
  if (!slide.active || slide.dead || slide.failed) return

  // หลังจากสร้าง cachedPoints แล้ว
  if (slide.endTime === undefined) {
    const last = slide.cachedPoints.at(-1)
    slide.endTime = slide.time + last.t
  }

  if (slide.laneChangePending === undefined) {
    slide.laneChangePending = false
    slide.laneChangeIndex = null
  }

  const i = slide.currentIndex
  const point = slide.cachedPoints[i]
  if (!point) return

  const targetLane = getSlideLaneAtTime(slide, gameNow)

  // กรณีถือปกติ
  let keyHolding =
    keysPressed[targetLane] ||
    keysPressed[targetLane - 1] ||
    keysPressed[targetLane + 1]

  const pointTime = slide.time + point.t
  const dt = gameNow - pointTime
  const adt = Math.abs(dt)

  /* ===============================
     INIT
  =============================== */
  if (slide.releaseGrace === undefined) slide.releaseGrace = 0
  if (slide.holdTickTimer === undefined) slide.holdTickTimer = 0

  /* ===============================
     START (HEAD)
  =============================== */
  if (!slide.started) {
    const START_EARLY = 200

    // กดรอได้
    if (keyHolding && dt < -START_EARLY) return

    if (keyHolding && adt <= SLIDE_TIMING.GOOD + START_EARLY) {
      slide.started = true
      activeSlide = slide

      slide.headRank =
        adt <= SLIDE_TIMING.PERFECT ? "PERFECT" :
        adt <= SLIDE_TIMING.GREAT   ? "GREAT"   :
                                      "GOOD"

      showFeedback(slide.headRank)

      slide.currentIndex = 1
      slide.lastHoldTime = gameNow
      slide.holdTickTimer = 0
      slide.releaseGrace = 0
      return
    }

    // เลยหัวไปจริง ๆ
    if (dt > SLIDE_TIMING.GOOD) {
      slide.failed = true
      combo = 0
      updateComboScore()
      showFeedback("MISS")
    }

    return
  }

  // ===== ENTER END PHASE BY TIME =====
  if (!slide.waitingForEnd && gameNow >= slide.endTime) {
    slide.waitingForEnd = true
  }

  /* ===============================
     HOLDING (LIKE LONG NOTE)
  =============================== */
  const delta = gameNow - slide.lastHoldTime
  slide.lastHoldTime = gameNow

  if (!slide.waitingForEnd) {
    const RELEASE_GRACE = 100

    if (!keyHolding) {
      slide.releaseGrace += delta
      if (slide.releaseGrace > RELEASE_GRACE) {
        slide.failed = true
        combo = 0
        updateComboScore()
        showFeedback("MISS")
        clearActiveSlide(slide)
        return
      }
    } else {
      slide.releaseGrace = 0
    }
  }

  /* ===============================
     HOLD COMBO TICK (TIME-BASED)
  =============================== */
  const HOLD_INTERVAL = 120
  slide.holdTickTimer += delta

  while (slide.holdTickTimer >= HOLD_INTERVAL) {
    combo++
    updateComboScore()
    showHoldFeedback(slide.headRank)
    slide.holdTickTimer -= HOLD_INTERVAL
  }

  // ===== FORCE LANE CHANGE CHECK =====
  if (
    !slide.waitingForEnd &&
    isLaneChange(slide, slide.currentIndex) &&
    !slide.laneChangePending
  ) {
    slide.laneChangePending = true
    slide.laneChangeIndex = slide.currentIndex
  }

  if (slide.laneChangePending) {
    const p = slide.cachedPoints[slide.laneChangeIndex]
    const laneTime = slide.time + p.t
    const dtLane = gameNow - laneTime
    const adtLane = Math.abs(dtLane)

    const requiredLane = p.lane
    const SLIDE_LANE_WINDOW = SLIDE_TIMING.GOOD * 0.6

    // ===== กดย้ายเลนสำเร็จ =====
    if (keysPressed[requiredLane] && adtLane <= SLIDE_LANE_WINDOW) {
      slide.laneChangePending = false
      slide.laneChangeIndex++
      slide.currentIndex = slide.laneChangeIndex
    }

    // ===== เลย window จริง =====
    if (dtLane > SLIDE_TIMING.GOOD) {
      slide.failed = true
      combo = 0
      updateComboScore()
      showFeedback("MISS")
      clearActiveSlide(slide)
      return
    }
  }

  /* ===============================
    END JUDGE (LIKE LONG NOTE)
  =============================== */
  const SLIDE_RELEASE_WINDOW = SLIDE_TIMING.GOOD * 2.0
  
  if (slide.waitingForEnd && !slide.endJudged) {
    const dtEnd = gameNow - slide.endTime
    const adtEnd = Math.abs(dtEnd)

    // รอให้ "ผู้เล่นปล่อย"
    if (!keyHolding) {

      if (adtEnd <= SLIDE_RELEASE_WINDOW) {

        slide.endRank =
          adtEnd <= SLIDE_TIMING.PERFECT ? "PERFECT" :
          adtEnd <= SLIDE_TIMING.GREAT   ? "GREAT"   :
                                            "GOOD"

        const finalRank = mergeRank(slide.headRank, slide.endRank)
        showFeedback(finalRank)

        combo++
        updateComboScore()

        slide.endJudged = true
        slide.finished = true
        clearActiveSlide(slide)
        return
      }

      // ปล่อยช้าเกิน
      slide.failed = true
      combo = 0
      updateComboScore()
      showFeedback("MISS")
      clearActiveSlide(slide)
      return
    }

    // ยังถืออยู่ → รอ
    if (dtEnd > SLIDE_RELEASE_WINDOW) {
      slide.failed = true
      combo = 0
      updateComboScore()
      showFeedback("MISS")
      clearActiveSlide(slide)
      return
    }
  }

  /* ===============================
     FINALIZE
  =============================== */
  if (slide.finished) {
    if (gameNow > slide.endTime + SLIDE_END_BUFFER_MS) {
      slide.dead = true
    }
  }
}

function clearActiveSlide(slide) {
  if (activeSlide === slide) {
    activeSlide = null
  }
}

function getSlideLaneAtTime(slide, now) {
  for (let i = slide.cachedPoints.length - 1; i >= 0; i--) {
    if (now >= slide.time + slide.cachedPoints[i].t) {
      return slide.cachedPoints[i].lane
    }
  }
  return slide.cachedPoints[0].lane
}

function isLaneChange(slide, index) {
  if (index <= 0) return false
  return slide.cachedPoints[index].lane !==
         slide.cachedPoints[index - 1].lane
}

function isSlidePointHittable(slide, index) {
  const p = slide.cachedPoints[index]
  const t = slide.time + p.t
  return Math.abs(gameNow - t) <= HIT_WINDOW_GOOD_MS
}

function getTimingRank(dist) {
  if (dist <= SLIDE_TIMING.PERFECT) return "PERFECT"
  if (dist <= SLIDE_TIMING.GREAT)   return "GREAT"
  if (dist <= SLIDE_TIMING.GOOD)    return "GOOD"
  return "MISS"
}

function mergeRank(a, b) {
  if (a === "PERFECT" && b === "GOOD") return "GREAT"
  const order = ["MISS", "GOOD", "GREAT", "PERFECT"]
  return order[Math.max(order.indexOf(a), order.indexOf(b))]
}

function updateLaneEffects() {
  laneData.forEach((lane, i) => {

    // กดอยู่ → เติม highlight
    if (keysPressed[i]) {
      lane.pressAlpha = Math.min(lane.pressAlpha + 0.2, 1);
    } else {
      lane.pressAlpha *= 0.85;
    }

    // glow จากการ hit → fade เร็ว
    lane.hitGlowAlpha *= 0.75;
  });
}

function resolveJudgeEvents() {
  if (judgeEvents.length === 0) return;

  judgeEvents.sort((a, b) => a.time - b.time);

  for (const e of judgeEvents) {
    if (e.type === "MISS") {
      if (activeHoldCount > 0) {
        combo = 0;
      } else {
        combo = 0;
        lastJudgeText = "MISS";
      }
    }

    if (e.type === "HIT") {
      combo = combo === 0 ? 1 : combo + 1;
      lastJudgeText = e.rank;
    }
  }

  updateComboScore();
  showFeedback(lastJudgeText);

  judgeEvents.length = 0;
}

function loadNoteData(filePath) {
  return fetch(filePath)
    .then(response => response.json())
    .then(data => {
      noteData = data;
      noteIndex = 0;
      console.log("Loaded note data:", noteData);
    })
    .catch(err => {
      console.error("Error loading note data:", err);
    });
}

function drawNotes() {
  notes.forEach(note => note.draw());
}

function drawSlideNotes() {
  slideNotes.forEach(note => note.draw());
}

function drawLaneVisual() {
  ctx.save();

  const laneTopY = hitLine - canvas.height * 12;

  const laneGrad = ctx.createLinearGradient(0, laneTopY, 0, hitLine);
  laneGrad.addColorStop(0.9, "rgba(0, 0, 0, 0.2)");
  laneGrad.addColorStop(0.95, "rgba(0, 0, 0, 0.5)");
  laneGrad.addColorStop(1, "rgba(0,0,0,0.9)");
  ctx.fillStyle = laneGrad;

  if (introPhase === 2) {
    ctx.shadowColor = "rgba(255, 255, 255, 0.6)";
    ctx.shadowBlur = 20;
  }

  // ===== LANE SURFACE + HIGHLIGHT =====
  for (let i = 0; i < laneData.length; i++) {
    const lane = laneData[i];

    const topLeft     = project(lane.x, laneTopY);
    const topRight    = project(lane.x + lane.width, laneTopY);
    const bottomLeft  = project(lane.x, hitLine);
    const bottomRight = project(lane.x + lane.width, hitLine);

    ctx.beginPath();
    ctx.moveTo(topLeft.x, topLeft.y);
    ctx.lineTo(topRight.x, topRight.y);
    ctx.lineTo(bottomRight.x, bottomRight.y);
    ctx.lineTo(bottomLeft.x, bottomLeft.y);
    ctx.closePath();
    ctx.fill();

    if (lane.pressAlpha > 0.01) {
      ctx.save();
      ctx.fillStyle = `rgba(255,255,255,${lane.pressAlpha * 0.12})`;
      ctx.beginPath();
      ctx.moveTo(topLeft.x, topLeft.y);
      ctx.lineTo(topRight.x, topRight.y);
      ctx.lineTo(bottomRight.x, bottomRight.y);
      ctx.lineTo(bottomLeft.x, bottomLeft.y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    if (lane.hitGlowAlpha > 0.01) {
      const glowP = project(lane.x + lane.width / 2, hitLine);
      const glowW = lane.width * glowP.scale * 1.1;

      ctx.save();
      ctx.globalAlpha = lane.hitGlowAlpha * 0.6;
      ctx.shadowColor = "#0ff";
      ctx.shadowBlur = 30;
      ctx.fillStyle = "#0ff";
      ctx.fillRect(glowP.x - glowW / 2, glowP.y - 10, glowW, 20);
      ctx.restore();
    }
  }

  // ===== LANE DIVIDERS =====
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(180,220,255,0.25)";

  laneData.forEach(lane => {
    const tl = project(lane.x, laneTopY);
    const bl = project(lane.x, hitLine);
    const tr = project(lane.x + lane.width, laneTopY);
    const br = project(lane.x + lane.width, hitLine);

    ctx.beginPath();
    ctx.moveTo(tl.x, tl.y);
    ctx.lineTo(bl.x, bl.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(tr.x, tr.y);
    ctx.lineTo(br.x, br.y);
    ctx.stroke();
  });

  // ===== OUTER GLOW (PERSPECTIVE EXTENDED) =====
  const GLOW_OFFSET = 10;

  // ให้โลก lane ยาวลงไปอีก (ต่ำกว่า hitline)
  const laneBottomWorldY = hitLine + canvas.height * 0.15;

  ctx.lineWidth = 5;
  ctx.shadowBlur = 20;
  ctx.shadowColor = "rgba(120,255,255,0.8)";
  ctx.strokeStyle = "rgba(0,255,255,0.5)";

  // LEFT MOST
  {
    const lane = laneData[0];

    const top = project(lane.x, laneTopY);
    const bottom = project(lane.x, laneBottomWorldY);

    ctx.beginPath();
    ctx.moveTo(top.x - GLOW_OFFSET, top.y);
    ctx.lineTo(bottom.x - GLOW_OFFSET, bottom.y);
    ctx.stroke();
  }

  // RIGHT MOST
  {
    const lane = laneData[laneData.length - 1];

    const top = project(lane.x + lane.width, laneTopY);
    const bottom = project(lane.x + lane.width, laneBottomWorldY);

    ctx.beginPath();
    ctx.moveTo(top.x + GLOW_OFFSET, top.y);
    ctx.lineTo(bottom.x + GLOW_OFFSET, bottom.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHitLineByLane() {
  laneData.forEach((lane, i) => {
    const left  = project(lane.x, hitLine);
    const right = project(lane.x + lane.width, hitLine);

    const state = laneHitState[i];
    const isPressed = keysPressed[i];

    // intensity หลัก
    const hitIntensity = state.active ? 1 : state.life;

    // สีหลัก
    let coreColor = "rgba(255,255,255,0.4)";
    if (state.active || state.life > 0) {
      coreColor = "rgba(120,255,255,1)";
    } else if (isPressed) {
      coreColor = "rgba(255,255,255,0.9)";
    }

    // ความหนาพื้นฐาน (ปรับได้)
    let baseThickness = 3;
    if (state.active) baseThickness = 6;
    else if (state.life > 0) baseThickness = 5;
    else if (isPressed) baseThickness = 4;

    // ===== Outer Glow =====
    if (hitIntensity > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(left.x, left.y);
      ctx.lineTo(right.x, right.y);

      ctx.lineWidth = baseThickness + 6;
      ctx.strokeStyle = `rgba(120,255,255,${0.25 * hitIntensity})`;
      ctx.shadowColor = "rgba(120,255,255,0.6)";
      ctx.shadowBlur = 14;

      ctx.stroke();
      ctx.restore();
    }

    // ===== Mid Soft Layer =====
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);

    ctx.lineWidth = baseThickness + 2;
    ctx.strokeStyle =
      state.active || state.life > 0
        ? "rgba(120,255,255,0.6)"
        : "rgba(255,255,255,0.4)";

    ctx.stroke();
    ctx.restore();

    // ===== Core Line =====
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);

    ctx.lineWidth = baseThickness;
    ctx.strokeStyle = coreColor;
    ctx.shadowBlur = 0; // สำคัญ: ไม่ให้ core เบลอ

    ctx.stroke();
    ctx.restore();
  });
}

function drawLaneButtons() {
  const BUTTON_OFFSET = 60 + SAFE_BOTTOM; 
  laneData.forEach((lane, i) => {
    const isPressed = keysPressed[i];
    const buttonTopY = hitLine - BUTTON_OFFSET;
    const buttonBottomY = hitLine + 120;
    const pressOffset = pressDepth[i];

    const tl = project(lane.x, buttonTopY + pressOffset);
    const tr = project(lane.x + lane.width, buttonTopY + pressOffset);
    const bl = project(lane.x, buttonBottomY + pressOffset);
    const br = project(lane.x + lane.width, buttonBottomY + pressOffset);


    // === BUTTON SHAPE ===
    ctx.save();

    let fill;
    let glow = 0;

    if (isPressed) {
      fill = "rgb(150, 150, 150)";
      glow = 18;
    } else {
      fill = "rgba(40,40,40,1)";
    }

    ctx.beginPath();
    ctx.moveTo(tl.x, tl.y);
    ctx.lineTo(tr.x, tr.y);
    ctx.lineTo(br.x, br.y);
    ctx.lineTo(bl.x, bl.y);
    ctx.closePath();

    ctx.fillStyle = fill;
    ctx.shadowColor = fill;
    ctx.shadowBlur = glow;
    ctx.fill();

    ctx.restore();

    // === KEY LABEL ===
    const keyLabels = ["T", "Y", "U", "I", "O"];
    const labelY = (buttonTopY + buttonBottomY) / 2;
    const left  = project(lane.x, labelY);
    const right = project(lane.x + lane.width, labelY);

    const cx = (left.x + right.x) / 2;
    const cy = (left.y + right.y) / 2 - 5;

    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,1)";
    ctx.font = "20px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(keyLabels[i], cx, cy);
    ctx.restore();
  });
}

function getLaneButtonCenter(i) {
  const lane = laneData[i];

  const y = hitLine + 60; // กลางปุ่ม (ปรับได้)
  const left  = project(lane.x, y);
  const right = project(lane.x + lane.width, y);

  return {
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2
  };
}

function updateLaneHitState() {
  laneHitState.forEach(state => {
    if (state.life > 0) {
      state.life -= 0.08; // ปรับความเร็ว fade ตรงนี้
      if (state.life < 0) state.life = 0;
    }
  });
}

function drawLaneReceivers() {
  laneData.forEach((lane, i) => {
    const p = project(
      lane.x + lane.width / 2,
      hitLine + 40
    );

    const w = lane.width * p.scale * 0.9;
    const h = 20 * p.scale;

    ctx.save();
    ctx.globalAlpha = keysPressed[i] ? 0.6 : 0.25;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(
      p.x - w / 2,
      p.y - h / 2,
      w,
      h
    );
    ctx.restore();
  });
}

function checkHit(lane) {
  const now = gameNow

  const hittableNotes = notes.filter(note =>
    note.lane === lane &&
    note.active &&
    !note.wasHit &&
    Math.abs(now - note.time) <= HIT_WINDOW_GOOD_MS + HIT_EARLY_BUFFER
  );

  if (hittableNotes.length === 0) {
    // ไม่ทำอะไร ถ้าไม่มีโน้ตในเลนเวลานี้
    return;
  }

  let closestNote = hittableNotes[0];
  let minTimeDiff = Math.abs(now - closestNote.time);

  for (let note of hittableNotes) {
  const diff = Math.abs(now - note.time);
  if (diff < minTimeDiff) {
    closestNote = note;
    minTimeDiff = diff;
    }
  }

  if (closestNote.type === "normal") {
    if (minTimeDiff <= HIT_WINDOW_PERFECT_MS) {
      closestNote.wasHit = true;
      closestNote.active = false;
      score += 300;
      laneData[lane].hitGlowAlpha = 1;
      judgeEvents.push({
        time: now,
        type: "HIT",
        rank: "PERFECT",
        lane: lane,
        noteId: closestNote.time
      });
      hitLineEffect.state = "perfect";
      hitLineEffect.timer = 30;
      const cx = laneData[lane].x + laneData[lane].width / 2;
      hitEffects.push(new HitEffect(cx, hitLine));
      laneHitState[lane].life = 1;
    } else if (minTimeDiff <= HIT_WINDOW_GREAT_MS) {
      closestNote.wasHit = true;
      closestNote.active = false;
      score += 200;
      laneData[lane].hitGlowAlpha = 1;
      judgeEvents.push({
        time: now,
        type: "HIT",
        rank: "GREAT",
        lane: lane,
        noteId: closestNote.time
      });
      hitLineEffect.state = "normal";
      hitLineEffect.timer = 0;
      const cx = laneData[lane].x + laneData[lane].width / 2;
      hitEffects.push(new HitEffect(cx, hitLine));
      laneHitState[lane].life = 1;
    } else if (minTimeDiff <= HIT_WINDOW_GOOD_MS) {
      closestNote.wasHit = true;
      closestNote.active = false;
      score += 100;
      laneData[lane].hitGlowAlpha = 1;
      judgeEvents.push({
        time: now,
        type: "HIT",
        rank: "GOOD",
        lane: lane,
        noteId: closestNote.time
      });
      hitLineEffect.state = "normal";
      hitLineEffect.timer = 0;
      const cx = laneData[lane].x + laneData[lane].width / 2;
      hitEffects.push(new HitEffect(cx, hitLine));
      laneHitState[lane].life = 1;
    } else {
      judgeEvents.push({
        time: now,
        type: "MISS",
        rank: null,
        lane: lane,
        noteId: closestNote.time
      });
      hitLineEffect.state = "miss";
      hitLineEffect.timer = 30;
    }
    showFlareEffectOnButton(buttons[lane]);
    return;
  }

  if (closestNote.type === "long") {
    if (minTimeDiff <= HIT_WINDOW_PERFECT_MS) {
      closestNote.startHoldScore();
      laneHitState[lane].active = true;
      showFeedback("PERFECT");
      updateComboScore();
      hitLineEffect.state = "perfect";
      hitLineEffect.timer = 30;
      showFlareEffectOnButton(buttons[lane]);
      currentHoldRank = "PERFECT";
   } else if (minTimeDiff <= HIT_WINDOW_GREAT_MS) {
      closestNote.startHoldScore();
      laneHitState[lane].active = true;
      showFeedback("GREAT");
      updateComboScore();
      hitLineEffect.state = "normal";
      hitLineEffect.timer = 0;
      showFlareEffectOnButton(buttons[lane]);
      currentHoldRank = "GREAT";
   } else if (minTimeDiff <= HIT_WINDOW_GOOD_MS) {
      closestNote.startHoldScore();
      laneHitState[lane].active = true;
      showFeedback("GOOD");
      updateComboScore();
      hitLineEffect.state = "normal";
      hitLineEffect.timer = 0;
      showFlareEffectOnButton(buttons[lane]);
      currentHoldRank = "GOOD";
    } else {
      combo = 0;
      updateComboScore();
      showFeedback("MISS");
      comboNum.textContent = 0;
      updateComboScore();
      hitLineEffect.state = "miss";
      hitLineEffect.timer = 30;
    }
   return;
  }
}


function updateComboScore() {
  comboNum.textContent = combo;
  comboNum.style.transform = "scale(1.5)";
  comboNum.style.transition = "transform 0.2s ease";
  setTimeout(() => {
    comboNum.style.transform = "scale(1)";
  }, 50);
  scoreDisplay.textContent = score.toString().padStart(6, "0");
}

// helper
function smooth(value, target, factor = 0.15) {
  return value + (target - value) * factor;
}

function showFeedback(text) {
  feedbackText.textContent = text;
  feedbackText.style.transform = "scale(1.5)";
  feedbackText.style.transition = "transform 0.2s ease";
  setTimeout(() => {
    feedbackText.style.transform = "scale(1)";
  }, 50);
  feedbackText.style.opacity = "1";
  comboNum.style.opacity = "1";

  // เปลี่ยนสีตาม timing rank
  switch (text) {
    case "PERFECT":
      feedbackText.style.color = "#FFD700"; // เหลืองทอง
      break;
    case "GREAT":
      feedbackText.style.color = "#00FF00"; // เขียว
      break;
    case "GOOD":
      feedbackText.style.color = "#00BFFF"; // ฟ้า
      break;
    case "MISS":
      feedbackText.style.color = "#FF3333"; // แดง
      break;
    default:
      feedbackText.style.color = "#FFFFFF"; // สีขาวเป็นค่าเริ่มต้น
  }

  setTimeout(() => {
    if (!holdFeedbackActive) {
      feedbackText.style.opacity = "0";
      comboNum.style.opacity = "0";
    } 
  }, 400);
}

function showHoldFeedback(rank) {
  holdFeedbackActive = true;

  feedbackText.textContent = rank;
  feedbackText.style.opacity = "1";
  feedbackText.style.transform = "scale(1.2)";
  
  comboNum.style.opacity = "1";
  comboNum.textContent = combo;
  switch (rank) {
    case "PERFECT":
      feedbackText.style.color = "#FFD700";
      break;
    case "GREAT":
      feedbackText.style.color = "#00FF00";
      break;
    case "GOOD":
      feedbackText.style.color = "#00BFFF";
      break;
  }
}

function getAmbientColorFromImage(img) {
  const temp = document.createElement("canvas");
  const tctx = temp.getContext("2d");

  const size = 32;
  temp.width = size;
  temp.height = size;

  tctx.drawImage(img, 0, 0, size, size);
  const data = tctx.getImageData(0, 0, size, size).data;

  let r = 0, g = 0, b = 0;
  const count = data.length / 4;

  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }

  r = Math.floor(r / count);
  g = Math.floor(g / count);
  b = Math.floor(b / count);

  return `rgb(${r},${g},${b})`;
}

function drawCoverFit(ctx, canvas, img) {
  if (!img) return;

  const cw = canvas.width;
  const ch = canvas.height;
  const iw = img.width;
  const ih = img.height;

  const scale = Math.min(cw / iw, ch / ih);
  const w = iw * scale;
  const h = ih * scale;

  const x = (cw - w) / 2;
  const y = (ch - h) / 2;

  ctx.drawImage(img, x, y, w, h);
}

function easeInOut(t) {
  return t < 0.5
    ? 2 * t * t
    : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function buildStaticBackground() {
  bgCanvas.width = canvas.width;
  bgCanvas.height = canvas.height;

  // 2. ambient gradient (อิงปกเพลงได้เต็มที่)
  const grad = bgCtx.createRadialGradient(
    bgCanvas.width / 2,
    bgCanvas.height / 2,
    bgCanvas.width * 0.1,
    bgCanvas.width / 2,
    bgCanvas.height / 2,
    bgCanvas.width * 0.8
  );

  grad.addColorStop(0, bgAmbientColor);
  grad.addColorStop(1, "rgba(0,0,0,0.85)");

  bgCtx.fillStyle = grad;
  bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);

  // 1. วาดปกเพลง
  drawCoverFit(bgCtx, bgCanvas, bgCoverImg);
  
  // 3. overlay มืด
  const v = bgCtx.createLinearGradient(0, 0, 0, bgCanvas.height);
  v.addColorStop(0, "rgba(0,0,0,0.2)");
  v.addColorStop(1, "rgba(0,0,0,0.45)");

  bgCtx.fillStyle = v;
  bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
}

function loop() {

  // 🔒 RESET CANVAS STATE (ต้องอยู่บนสุดจริง ๆ)
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.filter = "none";
  ctx.globalCompositeOperation = "source-over";

  ctx.drawImage(bgCanvas, 0, 0);

  let introP = 1; // default = ปกติ

  if (gameStarted) {
    // ใช้ช่วง pre-roll ที่คุณมีอยู่แล้ว
    const INTRO_TIME = 2000; // 2 วิ
    introP = clamp01((gameNow + INTRO_TIME) / INTRO_TIME);
    introP = easeInOut(introP);
  }

  if (introPhase > 0) {
    const t = performance.now() - introStartTime;

    if (t < 500) introPhase = 1;
    else if (t < 1000) introPhase = 2;
    else if (t < 2000) introPhase = 3;
    else introPhase = 4;
  }

  if (!isPaused) {
    updateLaneEffects();
    updateLaneHitState();

    updateHitEffects();
  }

  applyLaneIntroStyle();

  ctx.save();
  ctx.globalAlpha = introP;

  if (introPhase > 0) {
    ctx.filter = `blur(${(1 - introP) * 10}px)`;
  } else {
    ctx.filter = "none";
  }

  drawLaneVisual();
  ctx.restore();

  drawHitLineByLane();

  ctx.save();
  ctx.globalAlpha = introP;

  drawLaneReceivers();
  drawLaneButtons();

  ctx.restore();

  drawHitEffects();
  drawHoldEffects();

  if (gameStarted && !isPaused && notesReady) {

    // เดินเวลาเองก่อนเพลง
    if (!audioStarted) {

      const now = performance.now();

      if (lastFrameTime === null) {
        lastFrameTime = now;
      }

      let dt = now - lastFrameTime;
      lastFrameTime = now;

      // กันเฟรมกระโดดแรงเกิน
      dt = Math.min(dt, 33);

      gameNow += dt;

       // 🔥 อุ่น audio ล่วงหน้า (ก่อนถึง 0)
      if (!audioPrimed && gameNow >= -150) {
        audio.muted = true;
        audio.play();
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;

        audioPrimed = true;
      }

      if (gameNow >= 0) {
        audio.play();
        audioStarted = true;
        audioTimeOffset = gameNow - audio.currentTime * 1000;
        justStartedAudio = true;
        lastFrameTime = null;
      }
    }
    // หลังเพลงเริ่ม ใช้ audio เป็น master
    else {
      gameNow = audio.currentTime * 1000 + audioTimeOffset;
    }
  }

  // smooth render time (กัน jitter)
  if (!isPaused) {

    if (justStartedAudio) {
      // 🔑 snap แค่ 1 เฟรม ตอนเปลี่ยนระบบเวลา
      renderNow = gameNow;
      justStartedAudio = false;
    } else {
      renderNow += (gameNow - renderNow) * 0.2;
    }

  }
  

  if (!isPaused) {
    spawnNotesByTime();
    updateNotes();
    resolveJudgeEvents();
  }

    drawSlideNotes();
    drawNotes();
    
    if (isPaused) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "#fff";
      ctx.font = "bold 48px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("PAUSED", canvas.width / 2, canvas.height / 2);
    }

    if (introPhase === 3) {
      const pulse = Math.sin(performance.now() * 0.004) * 0.5 + 0.5;

      ctx.fillStyle = `rgba(255,200,150,${0.08 * pulse})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    if (introPhase === 4) {
      introPhase = 0; // ปิดระบบ intro
    }

    requestAnimationFrame(loop);
}

function applyLaneIntroStyle() {
  if (introPhase === 1) {
    ctx.globalAlpha = 0.3;
    ctx.filter = "blur(8px)";
  }
}

function pressLane(lane) {
  if (isPaused) return; 
  if (keysPressed[lane]) return;

  keysPressed[lane] = true;
  buttons[lane].classList.add("active");

  checkHit(lane);
}

function releaseLane(lane) {
  if (isPaused) return; 
  if (!keysPressed[lane]) return;

  keysPressed[lane] = false;
  buttons[lane].classList.remove("active");

  // stop long note
  notes.forEach(note => {
    if (note.lane === lane && note.type === "long" && note.isHolding) {
      note.stopHoldScore();
      laneHitState[lane].active = false;
    }
  });
}

const keysPressed = [false, false, false, false, false];
const laneHitState = Array(laneCount).fill().map(() => ({
  active: false,
  life: 0
}));
const pressDepth = Array(laneCount).fill(0);

document.addEventListener("keydown", e => {
  if (keyMap[e.code] !== undefined) {
    pressLane(keyMap[e.code]);
  }
});

document.addEventListener("keyup", e => {
  if (keyMap[e.code] !== undefined) {
    releaseLane(keyMap[e.code]);
  }
});

loop();
const startScreen = document.getElementById("startScreen")
const audio = document.getElementById("audio");


document.addEventListener("keydown", e => {
  if (!gameStarted && e.code === "Space" && currentSong) {
    startGame();
  }
});
startScreen.addEventListener("click", () => {
  if (!gameStarted && currentSong) {
    startGame();
  }
});

const startButton = document.getElementById("startButton");

startButton.addEventListener("click", () => {
  if (!gameStarted && currentSong) {
    startGame();
  }
});
startScreen.addEventListener("touchstart", () => {
  if (!gameStarted && currentSong) {
    startGame();
  }
});

function startGame() {
  if (gameStarted) return;

  startScreen.style.display = "none";
  uiMode = "game";
  canvas.style.touchAction = "none";
  gameStarted = true;

  buildStaticBackground();

  introPhase = 1;
  introStartTime = performance.now();

  // reset
  notes = [];
  slideNotes = [];  
  activeSlide = null;
  noteIndex = 0;
  combo = 0;
  score = 0;
  updateComboScore();
  showFeedback("");

  audio.pause();
  audio.currentTime = 0;
  audioStarted = false;

  notesReady = false;

  if (bgCoverImg && bgCoverImg.complete) {
    buildStaticBackground();
  }

  if (currentSong.noteFile) {
    loadNoteData(currentSong.noteFile).then(() => {
      notesReady = true;

      gameNow = -(SPAWN_LEAD_TIME + PRE_ROLL_TIME);
      renderNow = gameNow;
    });
  } else {
    noteData = [];
    notesReady = true;
    gameNow = -(SPAWN_LEAD_TIME + PRE_ROLL_TIME);
    renderNow = gameNow;
  }
}

const songs = [
  {
    name: "Chocolate",
    file: "audio/Chocolate.mp3",
    noteFile: "noteData/Chocolate.json",
    cover: "images/videoframe_117532.png",
    artist: "Plasui Plasui"
  },
  {
    name: "น้ำค้าง",
    file: "audio/Desktop Error  น้ำค้าง.mp3",
    noteFile: "noteData/น้ำค้าง.json",
    cover: "images/videoframe_3108.png",
    artist: "Desktop Error"
  },
  {
    name: "เก็บผ้า",
    file: "audio/เก็บผ้า.mp3",
    noteFile: "noteData/เก็บผ้า.json",
    cover: "images/videoframe_3361.png",
    artist: "Yellow Fang"
  },
  {
    name: "ขอบคุณ",
    file: "audio/ขอบคุณ.mp3",
    noteFile: "noteData/ขอบคุณ.json",
    cover: "images/ab67616d0000b273833f0c6f8b181691f396aadc.jpg",
    artist: "Slur"
  },
  {
    name: "04.00 A.M.",
    file: "audio/04.00 A.M..mp3",
    noteFile: "noteData/noteData (2).json",
    cover: "images/videoframe_7243.png",
    artist: "Solitude Is Bliss"
  }
];

const songSelectScreen = document.getElementById("songSelectScreen");
const songListDiv = document.getElementById("songList");

function initSongSelect() {
  uiMode = "select";
  canvas.style.touchAction = "auto";
  songListDiv.innerHTML = "";
  songs.forEach((song, index) => {
    const btn = document.createElement("button");
    btn.textContent = `${song.name} - ${song.artist}`;
    btn.style.display = "block";
    btn.style.margin = "10px auto";
    btn.style.padding = "10px 20px";
    btn.style.fontSize = "18px";
    btn.addEventListener("click", () => {
      selectSong(index);
    });
    songListDiv.appendChild(btn);
  });
}

function selectSong(index) {
  currentSong = songs[index];
  audio.src = currentSong.file;

  document.querySelector("#coverArt img").src = currentSong.cover;
  bgCoverImg = new Image();
  bgCoverImg.onload = () => {
    bgAmbientColor = getAmbientColorFromImage(bgCoverImg);
  };
  bgCoverImg.src = currentSong.cover;
  document.querySelector("#coverArt .songInfo h3").textContent = currentSong.name;
  document.querySelector("#coverArt .songInfo p").textContent = currentSong.artist;
  {
    songSelectScreen.style.display = "none";
    startScreen.style.display = "block";
    resetGame();
  }
}

function resetGame() {
  canvas.style.touchAction = "auto";
  uiMode = "select";
  combo = 0;
  score = 0;
  notes = [];
  gameStarted = false;
  noteData = [];
  noteIndex = 0;

  updateComboScore();
  showFeedback("");

  clearInterval(spawnNoteInterval);
  audio.pause();
  audio.currentTime = 0;
}

function togglePause() {
  if (!gameStarted) return;

  if (!isPaused) {
    // ⏸ pause
    isPaused = true;
    pauseStartTime = performance.now();
    audio.pause();

    keysPressed.fill(false);
    buttons.forEach(btn => btn.classList.remove("active"));
  } else {
    // ▶ resume
    isPaused = false;

    // ขยับ gameStartTime เพื่อชดเชยเวลาที่หยุด
    const pausedDuration = performance.now() - pauseStartTime;
    gameStartTime += pausedDuration;

    audio.play();
  }
}

function endGame() {
  isGameRunning = false;
  clearInterval(spawnNoteInterval);
  notes = [];

  // แสดงหน้าสรุป
  document.getElementById("resultScreen").style.display = "flex";

  // อัปเดตคะแนน/คอมโบ
  document.getElementById("finalScore").textContent = "Score: " + score.toString().padStart(6, "0");
  document.getElementById("finalCombo").textContent = "Max Combo: " + combo;
}

function goToSongSelect() {
  document.getElementById("resultScreen").style.display = "none";
  songSelectScreen.style.display = "block";
  resetGame();
}

initSongSelect();

function resizeGame() {
  const baseW = 1000
  const baseH = 600

  const vw = window.innerWidth
  const vh = window.innerHeight

  const scale = Math.min(vw / baseW, vh / baseH)

  const wrapper = document.getElementById("game-wrapper")
  wrapper.style.transform =
    `translate(-50%, -50%) scale(${scale})`
}

window.addEventListener("resize", resizeGame)
resizeGame()

function getLaneFromX(x) {
  for (let i = 0; i < laneData.length; i++) {
    const lane = laneData[i];
    if (x >= lane.x && x <= lane.x + lane.width) {
      return i;
    }
  }
  return null; // ไม่อยู่ในเลน
}

function getLaneIndexByX(x) {
  for (let i = 0; i < laneData.length; i++) {
    const lane = laneData[i];
    if (x >= lane.x && x <= lane.x + lane.width) {
      return i;
    }
  }
  return null;
}

function rebuildLanes() {
  laneData.length = 0;

  const laneWidth = canvas.width * 0.15;
  const laneGap = canvas.width * 0.0;
  const totalLaneWidth =
    laneCount * laneWidth + (laneCount - 1) * laneGap;
  const laneStartX = (canvas.width - totalLaneWidth) / 2;

  for (let i = 0; i < laneCount; i++) {
    laneData.push({
      x: laneStartX + i * (laneWidth + laneGap),
      width: laneWidth,
      pressAlpha: 0,
      hitGlowAlpha: 0
    });
  }
}

function getCanvasX(e) {
  const rect = canvas.getBoundingClientRect();
  return (e.clientX - rect.left) * (canvas.width / rect.width);
}

canvas.addEventListener("pointerdown", e => {
  if (uiMode !== "game") return;
  e.preventDefault();

  const x = getCanvasX(e);
  const lane = getLaneIndexByX(x);
  if (lane === null) return;

  // map pointerId → lane
  activePointers.set(e.pointerId, lane);

  // แค่กด lane นั้น ไม่ไป touch lane อื่น
  if (!keysPressed[lane]) pressLane(lane);
});

function releasePointer(e) {
  const lane = activePointers.get(e.pointerId);
  if (lane === undefined) return;

  activePointers.delete(e.pointerId);

  // release lane เฉพาะ pointer นี้
  // ถ้ามี pointer อื่นถืออยู่ lane นี้อยู่ ก็ไม่ release
  const stillPressed = [...activePointers.values()].includes(lane);
  if (!stillPressed) releaseLane(lane);
}


canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);
canvas.addEventListener("pointerleave", releasePointer);

canvas.addEventListener("pointermove", e => {
  if (!gameStarted) return;
  if (!activePointers.has(e.pointerId)) return;

  e.preventDefault();

  const x = getCanvasX(e);
  const newLane = getLaneIndexByX(x);
  if (newLane === null) return;

  const oldLane = activePointers.get(e.pointerId);
  if (oldLane === newLane) return;

  // อัพเดต pointer → lane
  activePointers.set(e.pointerId, newLane);

  // release เฉพาะ oldLane ถ้าไม่มี pointer อื่นถือ
  const stillPressed = [...activePointers.values()].includes(oldLane);
  if (!stillPressed) releaseLane(oldLane);

  // press lane ใหม่
  if (!keysPressed[newLane]) pressLane(newLane);
});

canvas.addEventListener("wheel", e => {
  if (uiMode === "game") {
    e.preventDefault();
  }
}, { passive: false });

audio.addEventListener("ended", () => {
  endGame();
});

window.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    togglePause();
  }
});

const pauseBtn = document.getElementById("pauseBtn");

pauseBtn.addEventListener("click", e => {
  e.stopPropagation();   // ⛔ กันไม่ให้ทะลุไปโดน canvas
  togglePause();
});

pauseBtn.addEventListener("touchstart", e => {
  e.preventDefault();    // ⛔ กัน double event (mobile)
  e.stopPropagation();  // ⛔ กันกดเลน
  togglePause();
});