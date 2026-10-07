// ---------------------------------------------------------------------------
// Flipping: a one-tap reflex game. A marker bounces back and forth across a
// track; a glowing zone sits in the middle. Tap the instant the marker is
// inside the zone to score — miss (tap outside, or let it pass untapped)
// and it's game over. Every hit nudges the speed up and the zone in.
// Requires shared.js (tokens, skins, haptics) loaded first.
// ---------------------------------------------------------------------------

const BALANCE = {
  startSpeed: 55,      // % of track width per second
  speedIncrement: 4,   // added per hit
  maxSpeed: 220,
  startHalfWidth: 9,    // zone half-width, in % of track width
  halfWidthShrink: 0.25,
  minHalfWidth: 3,
  reviveCost: 3,          // tokens spent to continue after a miss
  maxNewBestReward: 5,    // reward cap for beating your all-time high score
  minNewBestReward: 1,    // reward floor, so even a 1-point beat earns something
  streakBonusEvery: 5,    // every Nth consecutive hit in a run pays a bonus token
  streakBonusTokens: 1,
  goldenZoneChance: 0.18, // chance a relocated zone turns golden
  goldenZoneTokens: 2,
};

const HIGH_SCORE_KEY = "flipping_high_score";
const LIFETIME_FLIPS_KEY = "flipping_lifetime_flips";
const GAMES_PLAYED_KEY = "flipping_games_played";
const REVIVE_DECIDE_SECONDS = 3;
const END_RUN_LABEL = "No thanks, end run";

// ---------------------------------------------------------------------------
// Sound — tiny synthesized effects via the Web Audio API, no asset files
// needed. The AudioContext is created lazily on the first user tap (Start),
// since browsers block audio until a real user gesture.
// ---------------------------------------------------------------------------

let audioCtx = null;

function ensureAudio() {
  if (audioCtx) {
    if (audioCtx.state === "suspended") audioCtx.resume();
    return;
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (Ctx) audioCtx = new Ctx();
}

function playTone(freq, duration, type, delay, peak) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const startAt = audioCtx.currentTime + delay;
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peak, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

function playHitSound() {
  playTone(660, 0.08, "triangle", 0, 0.18);
}

// A filtered-noise sweep — the pizza whiffing past instead of landing.
// Built from white noise (not an oscillator) so it reads as air/motion
// rather than a musical tone, with the bandpass filter sweeping down fast.
function playMissSound() {
  if (!audioCtx) return;
  const duration = 0.32;
  const now = audioCtx.currentTime;

  const bufferSize = Math.floor(audioCtx.sampleRate * duration);
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;

  const filter = audioCtx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 0.9;
  filter.frequency.setValueAtTime(2200, now);
  filter.frequency.exponentialRampToValueAtTime(140, now + duration);

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.35, now + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  noise.connect(filter).connect(gain).connect(audioCtx.destination);
  noise.start(now);
  noise.stop(now + duration + 0.02);
}

function playNewBestSound() {
  playTone(523.25, 0.1, "triangle", 0, 0.18);
  playTone(659.25, 0.1, "triangle", 0.1, 0.18);
  playTone(783.99, 0.16, "triangle", 0.2, 0.2);
}

const els = {
  score: document.getElementById("score"),
  best: document.getElementById("best"),
  tokens: document.getElementById("tokens"),
  track: document.getElementById("track"),
  zone: document.getElementById("zone"),
  marker: document.getElementById("marker"),
  pizza: document.getElementById("pizza"),
  tapArea: document.getElementById("tap-area"),
  startScreen: document.getElementById("start-screen"),
  startBtn: document.getElementById("start-btn"),
  menuBtnStart: document.getElementById("menu-btn-start"),
  reviveScreen: document.getElementById("revive-screen"),
  reviveScore: document.getElementById("revive-score"),
  reviveCost: document.getElementById("revive-cost"),
  reviveBtn: document.getElementById("revive-btn"),
  endRunBtn: document.getElementById("end-run-btn"),
  gameoverScreen: document.getElementById("gameover-screen"),
  retryBtn: document.getElementById("retry-btn"),
  menuBtnGameover: document.getElementById("menu-btn-gameover"),
  finalScore: document.getElementById("final-score"),
  newBestBadge: document.getElementById("new-best-badge"),
  rewardAmount: document.getElementById("reward-amount"),
  leaderboardBtnStart: document.getElementById("leaderboard-btn-start"),
  leaderboardBtnGameover: document.getElementById("leaderboard-btn-gameover"),
  leaderboardScreen: document.getElementById("leaderboard-screen"),
  leaderboardClose: document.getElementById("leaderboard-close"),
  leaderboardBody: document.getElementById("leaderboard-body"),
  myRankLine: document.getElementById("my-rank-line"),
  lifetimeStats: document.getElementById("lifetime-stats"),
  particleLayer: document.getElementById("particle-layer"),
  bonusToast: document.getElementById("bonus-toast"),
};

let state = "start"; // "start" | "playing" | "revive-offer" | "gameover"
let pos = 0;          // marker position, 0-100 (% across track)
let dir = 1;          // 1 = moving right, -1 = moving left
let speed = BALANCE.startSpeed;
let halfWidth = BALANCE.startHalfWidth;
let zoneCenter = 50;  // zone position, 0-100 (% across track)
let isGolden = false; // true while the current zone pays bonus tokens
let score = 0;
let tokens = 0;
let hasRevivedThisRun = false;
let tappedDuringVisit = false;
let lastFrameTime = null;

function saveTokens() {
  setTokens(tokens);
  els.tokens.textContent = tokens + " 🪙";
}

function applySkin() {
  els.pizza.style.filter = getSkinFilter(getSelectedSkin());
}

// ---------------------------------------------------------------------------
// Lifetime stats — cumulative across every run, purely a progression
// flourish shown on the start screen.
// ---------------------------------------------------------------------------

function bumpLifetimeFlips() {
  setCount(LIFETIME_FLIPS_KEY, getCount(LIFETIME_FLIPS_KEY) + 1);
}

function bumpGamesPlayed() {
  setCount(GAMES_PLAYED_KEY, getCount(GAMES_PLAYED_KEY) + 1);
}

function renderLifetimeStats() {
  const flips = getCount(LIFETIME_FLIPS_KEY);
  const games = getCount(GAMES_PLAYED_KEY);
  if (games === 0) {
    els.lifetimeStats.textContent = "";
    return;
  }
  const runWord = games === 1 ? "run" : "runs";
  els.lifetimeStats.textContent = `🍕 ${flips.toLocaleString()} lifetime flips across ${games.toLocaleString()} ${runWord}`;
}

// ---------------------------------------------------------------------------
// Bonus toast + hit particles — lightweight feedback for streaks and golden
// zones, pure DOM/CSS, no canvas needed.
// ---------------------------------------------------------------------------

let toastTimeout = null;

function showBonusToast(text) {
  clearTimeout(toastTimeout);
  els.bonusToast.textContent = text;
  els.bonusToast.classList.remove("show");
  void els.bonusToast.offsetWidth; // restart animation
  els.bonusToast.classList.add("show");
  toastTimeout = setTimeout(() => els.bonusToast.classList.remove("show"), 900);
}

function spawnHitParticles(golden) {
  const colors = golden ? ["#ffd84d", "#ffb703", "#fff2b8"] : ["#f7c948", "#e3a857", "#c0392b"];
  for (let i = 0; i < 7; i++) {
    const particle = document.createElement("div");
    particle.className = "particle";
    const angle = (Math.PI * 2 * i) / 7 + Math.random() * 0.5;
    const distance = 28 + Math.random() * 18;
    particle.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
    particle.style.setProperty("--dy", `${Math.sin(angle) * distance}px`);
    particle.style.background = colors[i % colors.length];
    els.particleLayer.appendChild(particle);
    setTimeout(() => particle.remove(), 600);
  }
}

const ZONE_MIN_CENTER = 12;
const ZONE_MAX_CENTER = 88;
const ZONE_RELOCATE_MIN_DISTANCE = 25; // keeps the new spot reachable, not a cheap gotcha

function isInZone(p) {
  return Math.abs(p - zoneCenter) <= halfWidth;
}

function updateZoneWidth() {
  els.zone.style.width = halfWidth * 2 + "%";
}

function updateZonePosition() {
  els.zone.style.left = zoneCenter + "%";
}

// Picks a new zone spot, away from wherever the marker currently is, so the
// player always gets a fair stretch of track to react before reaching it.
function relocateZone() {
  let candidate;
  let attempts = 0;
  do {
    candidate = ZONE_MIN_CENTER + Math.random() * (ZONE_MAX_CENTER - ZONE_MIN_CENTER);
    attempts++;
  } while (Math.abs(candidate - pos) < ZONE_RELOCATE_MIN_DISTANCE && attempts < 12);
  zoneCenter = candidate;
  isGolden = Math.random() < BALANCE.goldenZoneChance;
  els.zone.classList.toggle("zone--golden", isGolden);
  updateZonePosition();
}

function updatePizzaSpinSpeed() {
  // Spin duration scales inversely with game speed, clamped so it never
  // looks frozen or seizure-inducing.
  const duration = Math.max(0.35, 2.4 * (BALANCE.startSpeed / speed));
  els.pizza.style.animationDuration = duration + "s";
}

function resetRound() {
  pos = 0;
  dir = 1;
  speed = BALANCE.startSpeed;
  halfWidth = BALANCE.startHalfWidth;
  zoneCenter = 50; // starts centered — first catch is predictable, then it starts moving
  isGolden = false;
  els.zone.classList.remove("zone--golden");
  score = 0;
  hasRevivedThisRun = false;
  tappedDuringVisit = false;
  els.score.textContent = "0";
  updateZoneWidth();
  updateZonePosition();
  updatePizzaSpinSpeed();
  els.marker.style.left = "0%";
}

function startGame() {
  ensureAudio();
  resetRound();
  state = "playing";
  els.startScreen.classList.add("hidden");
  els.reviveScreen.classList.add("hidden");
  els.gameoverScreen.classList.add("hidden");
  lastFrameTime = null;
  requestAnimationFrame(tick);
}

// Called on any miss. Offers a one-time revive (if the player can afford it
// and hasn't already used one this run) before finalizing game over.
function handleMiss() {
  playMissSound();
  hapticImpact("MEDIUM");
  els.pizza.classList.add("shake");
  setTimeout(() => els.pizza.classList.remove("shake"), 300);

  if (!hasRevivedThisRun && tokens >= BALANCE.reviveCost) {
    state = "revive-offer";
    els.reviveScore.textContent = String(score);
    els.reviveCost.textContent = String(BALANCE.reviveCost);
    els.reviveScreen.classList.remove("hidden");
    startReviveCountdown();
  } else {
    finalizeGameOver();
  }
}

// The revive offer auto-declines after a few seconds, so a fast-paced run
// never stalls on an open-ended decision.
let reviveCountdownInterval = null;

function startReviveCountdown() {
  clearReviveCountdown();
  let secondsLeft = REVIVE_DECIDE_SECONDS;
  els.endRunBtn.textContent = `${END_RUN_LABEL} (${secondsLeft})`;
  reviveCountdownInterval = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      finalizeGameOver();
    } else {
      els.endRunBtn.textContent = `${END_RUN_LABEL} (${secondsLeft})`;
    }
  }, 1000);
}

function clearReviveCountdown() {
  if (reviveCountdownInterval) {
    clearInterval(reviveCountdownInterval);
    reviveCountdownInterval = null;
  }
  els.endRunBtn.textContent = END_RUN_LABEL;
}

function revive() {
  clearReviveCountdown();
  tokens -= BALANCE.reviveCost;
  saveTokens();
  hasRevivedThisRun = true;
  els.reviveScreen.classList.add("hidden");

  pos = 0;
  dir = 1;
  tappedDuringVisit = false;
  els.marker.style.left = "0%";
  state = "playing";
  lastFrameTime = null;
  requestAnimationFrame(tick);
}

function finalizeGameOver() {
  clearReviveCountdown();
  state = "gameover";
  els.reviveScreen.classList.add("hidden");
  bumpGamesPlayed();
  renderLifetimeStats();
  const best = getCount(HIGH_SCORE_KEY);
  const isNewBest = score > best;
  if (isNewBest) {
    setCount(HIGH_SCORE_KEY, score);
    // Reward scales with how much you beat your old best by (capped), so
    // creeping up one point at a time pays far less than a real jump —
    // beating 10 by 1 point earns 1 token, not the full 5.
    const margin = score - best;
    const reward = Math.min(BALANCE.maxNewBestReward, Math.max(BALANCE.minNewBestReward, margin));
    tokens += reward;
    saveTokens();
    syncScoreIfBest(score);
    els.rewardAmount.textContent = String(reward);
    playNewBestSound();
  }
  els.best.textContent = String(getCount(HIGH_SCORE_KEY));
  els.finalScore.textContent = String(score);
  els.newBestBadge.classList.toggle("show", isNewBest);
  els.gameoverScreen.classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Leaderboard — shared across everyone who opens the published page, via the
// `db` + `user` capabilities. On a local file (no window.claude) or when
// nobody's signed in, this stays quietly disabled and the game is unaffected.
// ---------------------------------------------------------------------------

let dbRef = null;
let userApi = null;
let myId = null;
let cloudReady = false;
let unsubscribeLeaderboard = null;

async function initCloud() {
  if (!window.claude) return; // local file — no platform to talk to
  try {
    const [d, u] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
    dbRef = d;
    userApi = u;
    if (dbRef && userApi) {
      myId = await userApi.id();
      cloudReady = !!myId;
    }
  } catch (e) {
    cloudReady = false;
  }
}

async function syncScoreIfBest(newScore) {
  if (!cloudReady) return;
  try {
    const ref = dbRef.doc("scores/" + myId);
    const snap = await ref.get();
    const existing = snap.exists ? Number(snap.data().score || 0) : 0;
    if (newScore > existing) {
      await ref.set({ score: newScore });
    }
  } catch (e) {
    // Leaderboard sync is best-effort; the local game is unaffected either way.
  }
}

function openLeaderboard() {
  els.leaderboardScreen.classList.remove("hidden");
  els.myRankLine.textContent = "";

  if (!cloudReady) {
    els.leaderboardBody.innerHTML =
      '<p class="lb-empty">🏆 Open the published Flipping page (and sign in) to join the leaderboard.</p>';
    return;
  }

  els.leaderboardBody.innerHTML = '<p class="lb-empty">Loading…</p>';

  if (unsubscribeLeaderboard) unsubscribeLeaderboard();
  const q = dbRef.collection("scores").orderBy("score", "desc").limit(20);
  unsubscribeLeaderboard = q.onSnapshot(
    async (snap) => {
      await renderLeaderboardRows(snap.docs);
    },
    () => {
      els.leaderboardBody.innerHTML = '<p class="lb-empty">Couldn\'t load the leaderboard right now.</p>';
    }
  );

  renderMyRank();
}

async function renderLeaderboardRows(docs) {
  if (docs.length === 0) {
    els.leaderboardBody.innerHTML = '<p class="lb-empty">No scores yet — be the first! 🍕</p>';
    return;
  }
  const ids = docs.map((d) => d.id);
  const profiles = await userApi.profiles(ids);

  els.leaderboardBody.innerHTML = docs
    .map(
      (doc, i) => `
    <div class="lb-row ${doc.id === myId ? "lb-me" : ""}">
      <span class="lb-rank">${i + 1}</span>
      <img class="lb-avatar" src="${(profiles[doc.id] || {}).avatarUrl || ""}" alt="" />
      <span class="lb-name" data-id="${doc.id}"></span>
      <span class="lb-score">${Number(doc.data().score || 0)}</span>
    </div>`
    )
    .join("");

  // Names are other people's input — set with textContent, never innerHTML.
  els.leaderboardBody.querySelectorAll(".lb-name").forEach((el) => {
    const p = profiles[el.dataset.id] || { name: "" };
    el.textContent = (p.name || "Someone") + (el.dataset.id === myId ? " (You)" : "");
  });
}

async function renderMyRank() {
  try {
    const mySnap = await dbRef.doc("scores/" + myId).get();
    if (!mySnap.exists) {
      els.myRankLine.textContent = "Play a round to join the leaderboard!";
      return;
    }
    const myScore = Number(mySnap.data().score || 0);
    const higher = await dbRef.collection("scores").where("score", ">", myScore).get();
    els.myRankLine.textContent = `Your best: ${myScore} · Rank #${higher.size + 1}`;
  } catch (e) {
    els.myRankLine.textContent = "";
  }
}

function closeLeaderboard() {
  els.leaderboardScreen.classList.add("hidden");
  if (unsubscribeLeaderboard) {
    unsubscribeLeaderboard();
    unsubscribeLeaderboard = null;
  }
}

function registerHit() {
  const hitWasGolden = isGolden;
  playHitSound();
  hapticImpact("LIGHT");
  score += 1;
  bumpLifetimeFlips();
  speed = Math.min(BALANCE.maxSpeed, speed + BALANCE.speedIncrement);
  halfWidth = Math.max(BALANCE.minHalfWidth, halfWidth - BALANCE.halfWidthShrink);
  tappedDuringVisit = true;
  els.score.textContent = String(score);
  els.score.classList.remove("pop");
  void els.score.offsetWidth; // restart animation
  els.score.classList.add("pop");
  updateZoneWidth();
  spawnHitParticles(hitWasGolden);

  if (hitWasGolden) {
    tokens += BALANCE.goldenZoneTokens;
    saveTokens();
    showBonusToast(`✨ Golden zone! +${BALANCE.goldenZoneTokens} 🪙`);
  } else if (score % BALANCE.streakBonusEvery === 0) {
    tokens += BALANCE.streakBonusTokens;
    saveTokens();
    showBonusToast(`🔥 Streak x${score}! +${BALANCE.streakBonusTokens} 🪙`);
  }

  relocateZone();
  updatePizzaSpinSpeed();
  els.zone.classList.add("flash");
  setTimeout(() => els.zone.classList.remove("flash"), 120);
}

function handleTap() {
  if (state === "playing" && isInZone(pos) && !tappedDuringVisit) {
    registerHit();
  } else if (state === "playing") {
    handleMiss();
  }
}

function tick(now) {
  if (state !== "playing") return;
  if (lastFrameTime === null) lastFrameTime = now;
  const dt = (now - lastFrameTime) / 1000;
  lastFrameTime = now;

  const prevPos = pos;
  pos += dir * speed * dt;
  if (pos >= 100) { pos = 100; dir = -1; }
  else if (pos <= 0) { pos = 0; dir = 1; }

  const wasIn = isInZone(prevPos);
  const nowIn = isInZone(pos);
  if (!wasIn && nowIn) {
    tappedDuringVisit = false; // entering the zone: fresh chance
  } else if (wasIn && !nowIn) {
    if (!tappedDuringVisit) {
      els.marker.style.left = pos + "%";
      handleMiss();
      return;
    }
  }

  els.marker.style.left = pos + "%";
  requestAnimationFrame(tick);
}

els.best.textContent = String(getCount(HIGH_SCORE_KEY));
tokens = getTokens();
els.tokens.textContent = tokens + " 🪙";
updateZoneWidth();
applySkin();
renderLifetimeStats();

els.startBtn.addEventListener("click", startGame);
els.retryBtn.addEventListener("click", startGame);
els.reviveBtn.addEventListener("click", revive);
els.endRunBtn.addEventListener("click", finalizeGameOver);
els.tapArea.addEventListener("pointerdown", handleTap);
els.leaderboardBtnStart.addEventListener("click", openLeaderboard);
els.leaderboardBtnGameover.addEventListener("click", openLeaderboard);
els.leaderboardClose.addEventListener("click", closeLeaderboard);
els.menuBtnStart.addEventListener("click", () => { location.href = "index.html"; });
els.menuBtnGameover.addEventListener("click", () => { location.href = "index.html"; });

initCloud();
