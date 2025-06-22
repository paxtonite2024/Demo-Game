const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const buttons = document.querySelectorAll(".noteBtn");
const feedbackText = document.getElementById("feedbackText");
const comboNum = document.getElementById("comboNum");
const scoreDisplay = document.getElementById("score");
const gameContainer = document.getElementById("gameContainer");

const keyMap = {
  KeyC: 0,
  KeyV: 1,
  KeyB: 2,
  KeyN: 3,
  KeyM: 4   // เพิ่มเลนที่ 5
};

const laneCount = 5;
const laneWidth = canvas.width / laneCount;
const hitLine = canvas.height - 80;
const HIT_WINDOW_PERFECT = 35; // ✅ ขยายระยะเพื่อเล่นง่ายขึ้น
const HIT_WINDOW_GREAT = 70;
const HIT_WINDOW_GOOD = 100;
const END_HOLD_TOLERANCE = 150; // ปล่อยได้ก่อนถึงเส้นปลาย XXpx โดยไม่ถือว่า MISS

let combo = 0;
let score = 0;
let notes = [];
let isGameRunning = false;
let spawnNoteInterval = null;
let hitLineEffect = {
  state: "normal",
  timer: 0
};


const laneGlowLeft = document.createElement("div");
laneGlowLeft.classList.add("laneGlow");
gameContainer.appendChild(laneGlowLeft);

const laneGlowRight = document.createElement("div");
laneGlowRight.classList.add("laneGlow");
gameContainer.appendChild(laneGlowRight);

function updateLaneGlowPosition() {
  laneGlowLeft.style.top = "0px";
  laneGlowLeft.style.height = gameContainer.clientHeight + "px";
  laneGlowLeft.style.left = canvas.offsetLeft + "px";
  laneGlowLeft.style.width = "6px";

  laneGlowRight.style.top = "0px";
  laneGlowRight.style.height = gameContainer.clientHeight + "px";
  laneGlowRight.style.left = canvas.offsetLeft + laneWidth * (laneCount) + "px";
  laneGlowRight.style.width = "6px";
}

updateLaneGlowPosition();
window.addEventListener("resize", updateLaneGlowPosition);

let flareElem = null;
function showFlareEffectOnButton(button) {
  if (flareElem) {
    flareElem.remove();
    flareElem = null;
  }
  flareElem = document.createElement("div");
  flareElem.classList.add("flareEffect");
  button.appendChild(flareElem);
  flareElem.style.opacity = "1";

  setTimeout(() => {
    if (flareElem) {
      flareElem.style.opacity = "0";
      setTimeout(() => {
        if (flareElem) {
          flareElem.remove();
          flareElem = null;
        }
      }, 300);
    }
  }, 150);
}

class Note {
  constructor(lane, y, type = "normal", length = 0) {
    this.lane = lane;
    this.x = lane * laneWidth + laneWidth / 4;
    this.y = y;
    this.width = laneWidth / 2;
    this.height = 25;
    this.length = length;
    this.speed = 4.0;
    this.type = type;
    this.active = true;
    this.wasHit = false;
    this.isHolding = false;

    this.holdInterval = null;
    this.holdProgress = 0;
  }

  startHoldScore() {
    if (this.type !== "long" || this.isHolding || !this.active) return;

    this.wasHit = true;
    this.isHolding = true;
    this.holdStartTime = performance.now();
    this.holdProgress = 0;
  }

  stopHoldScore(success = false) {
    if (this.type !== "long" || !this.isHolding) return;

    this.isHolding = false;

    const actualHoldLength = this.holdProgress;

    if (!success && actualHoldLength < this.length - END_HOLD_TOLERANCE) {
      combo = 0;
      showFeedback("MISS");
      updateComboScore();
    } else if (success || actualHoldLength >= this.length - END_HOLD_TOLERANCE) {
      // ✅ สำเร็จแม้จะปล่อยก่อนถึงปลายเล็กน้อย
      score += 100;
      updateComboScore();
    }

    this.active = false;
  }

  update() {
    this.y += this.speed;

    // ถ้ากำลัง hold ค้าง
    if (this.isHolding) {
      const now = performance.now();
      const elapsed = now - this.holdStartTime;

      const gain = (elapsed / 1000) * 30;
      this.holdProgress = Math.min(gain, this.length);

      // ✅ เพิ่มคะแนนทุก ๆ 10 หน่วยของ holdProgress
      if (Math.floor(this.holdProgress / 10) > Math.floor((this.holdProgress - gain) / 10)) {
        score += 10;
        updateComboScore();
      }

      if (this.holdProgress >= this.length) {
        this.stopHoldScore(true); // ส่ง true แปลว่า "จบสมบูรณ์"
      }
    }
  }


  draw() {
    if (!this.active && !this.wasHit) return;

    const tailX = this.x + this.width / 2 - 3;
    const tailY = this.y - this.length;

    if (this.type === "long") {
      // กรณี MISS (inactive + wasHit + ไม่ได้ถือ)
      if (!this.active && this.wasHit && !this.isHolding) {
        ctx.fillStyle = "rgba(180, 180, 180, 0.3)"; // สีเส้นจาง ๆ
        ctx.fillRect(tailX, tailY, 10, this.length);

        ctx.fillStyle = "#999"; // หัวโน้ตสีเทา
        ctx.fillRect(this.x, this.y, this.width, this.height);
        return;
      }

      // กรณีกำลัง HOLD
      if (this.isHolding) {
        const heldHeight = (this.holdProgress / this.length) * this.length;

        // เพิ่ม glow effect
        ctx.shadowColor = "rgba(0, 255, 255, 0.7)";
        ctx.shadowBlur = 15;

        // เส้น progress เรืองแสง
        ctx.fillStyle = "rgba(0, 200, 255, 0.8)";
        ctx.fillRect(tailX, this.y - heldHeight, 10, heldHeight);

        // เส้นพื้นหลัง (drop) สีเข้มลง
        ctx.shadowBlur = 0; // ปิด shadow ก่อนวาดอันอื่น
        ctx.fillStyle = "rgba(52, 111, 170, 0.63)";
        ctx.fillRect(tailX, tailY, 10, this.length);

        // วาดหัวโน้ตสีสว่าง
        ctx.fillStyle = "rgba(0, 255, 255, 1)";
        ctx.fillRect(this.x, this.y, this.width, this.height);

        // วาดซ้ำเส้น progress แต่ลดความเข้มลงเล็กน้อย
        ctx.fillStyle = "rgba(0, 200, 255, 0.6)";
        ctx.fillRect(tailX, this.y - heldHeight, 10, heldHeight);
      } else {
      // โน้ตปกติ (ยังไม่ถูกกด)
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(0, 255, 255, 0.3)";
      ctx.fillRect(tailX, tailY, 10, this.length);

      ctx.fillStyle = "#00cccc";
      ctx.fillRect(this.x, this.y, this.width, this.height);
    }
  } else {
    // โน้ตปกติธรรมดา
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff";
    ctx.fillRect(this.x, this.y, this.width, this.height);
  }
} 

  isHittable() {
    return (
      this.active &&
      !this.wasHit &&
      this.y + this.height > hitLine - HIT_WINDOW &&
      this.y < hitLine + HIT_WINDOW
    );
  }
  isMissed() {
    return (
      this.active &&
      !this.wasHit &&
      this.y > hitLine + 50
    );
  }
}

// Rest of the game logic continues...


function spawnNote() {
  const noteCount = Math.random() < 0.3 ? 2 : 1; // 30% ออก 2 โน้ต
  const lanesUsed = [];
  const minSpacing = 100; // ปรับตามความเร็วโน้ต ยิ่งเร็วยิ่งใช้ค่ามาก

  while (lanesUsed.length < noteCount) {
    const lane = Math.floor(Math.random() * laneCount);
    if (lanesUsed.includes(lane)) continue;

    // ✅ ตรวจสอบว่าเลนนี้ไม่มีโน้ตอื่นใกล้ๆ
    const tooClose = notes.some(note =>
      note.lane === lane &&
      Math.abs(note.y + note.height) < minSpacing
    );

    if (tooClose) continue;
    lanesUsed.push(lane);
  }

  lanesUsed.forEach(lane => {
    const isLong = Math.random() < 0.3;

    let noteLength = 0;
    if (isLong) {
      const lengthType = Math.random();
      if (lengthType < 0.5) {
        noteLength = 80 + Math.random() * 60;  // short long note (80-140)
      } else if (lengthType < 0.6) {
        noteLength = 150 + Math.random() * 100; // medium (150-250)
      } else {
        noteLength = 260 + Math.random() * 200; // long long note (260-460)
      }
    } 

    notes.push(new Note(lane, -50, isLong ? "long" : "normal", noteLength));
  });
}

function updateNotes() {
  notes.forEach(note => {
    note.update();

    if (note.isMissed() && !note.isHolding) {  // <-- เพิ่ม !note.isHolding
      note.active = false;
      note.wasHit = true;
      combo = 0;
      showFeedback("MISS");
    }
  });

  notes = notes.filter(note => note.y < canvas.height + 50 && note.active);
}

function drawNotes() {
  notes.forEach(note => note.draw());
}

function checkHit(lane) {
  const hittableNotes = notes.filter(note =>
    note.lane === lane &&
    note.active &&
    !note.wasHit
  );

  if (hittableNotes.length === 0) {
    combo = 0;
    showFeedback("MISS");
    updateComboScore();
    return;
  }

  let closestNote = hittableNotes[0];
  let minDist = Math.abs((closestNote.y + closestNote.height / 2) - hitLine);

  for (let note of hittableNotes) {
    const dist = Math.abs((note.y + note.height / 2) - hitLine);
    if (dist < minDist) {
      closestNote = note;
      minDist = dist;
    }
  }

  if (closestNote.type === "normal") {
    if (minDist <= HIT_WINDOW_PERFECT) {
      closestNote.wasHit = true;
      closestNote.active = false;
      combo++;
      score += 300;
      showFeedback("PERFECT");
      hitLineEffect.state = "perfect";
      hitLineEffect.timer = 30;
    } else if (minDist <= HIT_WINDOW_GREAT) {
      closestNote.wasHit = true;
      closestNote.active = false;
      combo++;
      score += 200;
      showFeedback("GREAT");
      hitLineEffect.state = "normal";
      hitLineEffect.timer = 0;
    } else if (minDist <= HIT_WINDOW_GOOD) {
      closestNote.wasHit = true;
      closestNote.active = false;
      combo++;
      score += 100;
      showFeedback("GOOD");
      hitLineEffect.state = "normal";
      hitLineEffect.timer = 0;
    } else {
      combo = 0;
      showFeedback("MISS");
      hitLineEffect.state = "miss";
      hitLineEffect.timer = 30;
    }
    updateComboScore();
    showFlareEffectOnButton(buttons[lane]);
    return;
  }

  if (closestNote.type === "long") {
    if (minDist <= HIT_WINDOW_PERFECT) {
      closestNote.startHoldScore();
      combo++;
      showFeedback("PERFECT");
      updateComboScore();
      hitLineEffect.state = "perfect";
      hitLineEffect.timer = 30;
      showFlareEffectOnButton(buttons[lane]);
   } else if (minDist <= HIT_WINDOW_GREAT) {
      closestNote.startHoldScore();
      combo++;
      showFeedback("GREAT");
      updateComboScore();
      hitLineEffect.state = "normal";
     hitLineEffect.timer = 0;
      showFlareEffectOnButton(buttons[lane]);
   } else if (minDist <= HIT_WINDOW_GOOD) {
      closestNote.startHoldScore();
      combo++;
    showFeedback("GOOD");
      updateComboScore();
      hitLineEffect.state = "normal";
      hitLineEffect.timer = 0;
      showFlareEffectOnButton(buttons[lane]);
    } else {
      combo = 0;
      showFeedback("MISS");
     updateComboScore();
      hitLineEffect.state = "miss";
      hitLineEffect.timer = 30;
    }
   return;
  }

  combo = 0;
  showFeedback("MISS");
  updateComboScore();
}

  // ถ้าไม่ผ่านเกณฑ์กดได้ ถือว่า MISS
  combo = 0;
  showFeedback("MISS");
  updateComboScore();

function updateComboScore() {
  comboNum.textContent = combo;
  scoreDisplay.textContent = score.toString().padStart(6, "0");
}

function showFeedback(text) {
  feedbackText.textContent = text;
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
    feedbackText.style.opacity = "0";
    comboNum.style.opacity = "0";
  }, 400);
}

function loop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // วาด gradient hit line ก่อน
  const gradient = ctx.createLinearGradient(0, hitLine - 10, 0, hitLine + 10);
  gradient.addColorStop(0, "transparent");
  gradient.addColorStop(0.5, "#ffff00");
  gradient.addColorStop(1, "transparent");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, hitLine - 10, canvas.width, 20);

  // ✅✅ เอฟเฟกต์เรืองแสง
  if (hitLineEffect.timer > 0) {
    hitLineEffect.timer--;

    if (hitLineEffect.state === "perfect") {
      ctx.shadowColor = "#0ff";
      ctx.shadowBlur = 20;
      ctx.fillStyle = "#0ff";
    } else if (hitLineEffect.state === "miss") {
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#888";
    }
  } else {
    hitLineEffect.state = "normal";
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ff0";
  }

  ctx.fillRect(0, hitLine - 6, canvas.width, 12);
  ctx.shadowBlur = 0;

  updateNotes();
  drawNotes();

  requestAnimationFrame(loop);
}

const keysPressed = [false, false, false, false, false];

document.addEventListener("keydown", e => {
  if (keyMap[e.code] !== undefined && !keysPressed[keyMap[e.code]]) {
    const lane = keyMap[e.code];
    keysPressed[lane] = true;
    buttons[lane].classList.add("active");

    // ตรวจสอบการกด
    checkHit(lane);
  }
});

document.addEventListener("keyup", e => {
  if (keyMap[e.code] !== undefined) {
    const lane = keyMap[e.code];
    keysPressed[lane] = false;
    buttons[lane].classList.remove("active");

    // หยุด hold note ทุกตัวใน lane นี้ (ไม่จำกัดแค่ตัวที่กำลังมี holdInterval)
    notes.forEach(note => {
      if (note.lane === lane && note.type === "long" && note.isHolding) {
        note.stopHoldScore();
      }
    });
  }
});

loop();
const startScreen = document.getElementById("startScreen");
const audio = document.getElementById("audio");

let gameStarted = false;

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
  startScreen.style.display = "none";
  gameStarted = true;

  setTimeout(() => {
    audio.play();
    spawnNoteInterval = setInterval(spawnNote, currentSong.spawnInterval);
  }, 3000);
}

const songs = [
  {
    name: "Chocolate",
    file: "audio/Chocolate.mp3",
    spawnInterval: 667,
    cover: "images/videoframe_117532.png",
    artist: "Plasui Plasui"
  },
  {
    name: "น้ำค้าง",
    file: "audio/Desktop Error  น้ำค้าง.mp3",
    spawnInterval: 682,
    cover: "images/videoframe_3108.png",
    artist: "Desktop Error"
  },
  {
    name: "Song C",
    file: "SongC.mp3",
    spawnInterval: 750,
    cover: "cover_song_c.png",
    artist: "Artist C"
  }
];

let currentSong = null;

const songSelectScreen = document.getElementById("songSelectScreen");
const songListDiv = document.getElementById("songList");

function initSongSelect() {
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

  // อัพเดตข้อมูลเพลงใน UI
  document.querySelector("#coverArt img").src = currentSong.cover;
  document.querySelector("#coverArt .songInfo h3").textContent = currentSong.name;
  document.querySelector("#coverArt .songInfo p").textContent = currentSong.artist;

  // ซ่อนหน้าเลือกเพลง แสดงหน้า start screen
  songSelectScreen.style.display = "none";
  startScreen.style.display = "block";

  resetGame();
}

function resetGame() {
  combo = 0;
  score = 0;
  notes = [];
  gameStarted = false;

  updateComboScore();
  showFeedback("");

  clearInterval(spawnNoteInterval);
  audio.pause();
  audio.currentTime = 0;
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

buttons.forEach((button, lane) => {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault(); // ป้องกันพฤติกรรมอื่น ๆ เช่น scroll บนมือถือ
    button.classList.add("active");
    checkHit(lane);
  });

  button.addEventListener("pointerup", () => {
    button.classList.remove("active");
    notes.forEach(note => {
      if (note.lane === lane && note.type === "long" && note.isHolding) {
        note.stopHoldScore();
      }
    });
  });

  button.addEventListener("pointerleave", () => {
    button.classList.remove("active");
    notes.forEach(note => {
      if (note.lane === lane && note.type === "long" && note.isHolding) {
        note.stopHoldScore();
      }
    });
  });
});

audio.addEventListener("ended", () => {
  endGame();
});
