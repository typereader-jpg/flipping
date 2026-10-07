// ---------------------------------------------------------------------------
// Mode Select — the arcade's front door. Lists every game, shows shared
// tokens, and hosts the skins shop (cosmetic currency spend applies to
// Flipping's pizza). Requires shared.js loaded first.
// ---------------------------------------------------------------------------

const els = {
  tokens: document.getElementById("menu-tokens"),
  skinsBtn: document.getElementById("menu-skins-btn"),
  skinsScreen: document.getElementById("skins-screen"),
  skinsClose: document.getElementById("skins-close"),
  skinsBody: document.getElementById("skins-body"),
  flippingBest: document.getElementById("flipping-best-line"),
  cardFlipping: document.getElementById("card-flipping"),
};

let tokens = getTokens();

function renderTokens() {
  els.tokens.textContent = tokens + " 🪙";
}

function renderBestLines() {
  const flippingBest = getCount(FLIPPING_HIGH_SCORE_KEY);
  els.flippingBest.textContent = flippingBest > 0 ? `Best: ${flippingBest}` : "Not played yet";
}

function renderSkinsScreen() {
  const unlocked = getUnlockedSkins();
  const selected = getSelectedSkin();
  els.skinsBody.innerHTML = SKINS.map((skin) => {
    const isUnlocked = unlocked.includes(skin.id);
    const isSelected = selected === skin.id;
    const action = isSelected ? "Selected" : isUnlocked ? "Select" : `Unlock ${skin.cost} 🪙`;
    const disabled = isSelected || (!isUnlocked && tokens < skin.cost) ? "disabled" : "";
    const btnClass = isSelected ? "skin-action-btn skin-action-btn--selected" : "skin-action-btn";
    return `
      <div class="skin-card ${isSelected ? "skin-card--selected" : ""}">
        <div class="skin-preview" style="filter:${skin.filter}">🍕</div>
        <div class="skin-name">${skin.name}</div>
        <button class="${btnClass}" data-skin="${skin.id}" ${disabled}>${action}</button>
      </div>`;
  }).join("");
}

function unlockOrSelectSkin(skinId) {
  const skin = SKINS.find((s) => s.id === skinId);
  if (!skin) return;
  const unlocked = getUnlockedSkins();
  if (!unlocked.includes(skinId)) {
    if (tokens < skin.cost) return;
    tokens -= skin.cost;
    setTokens(tokens);
    renderTokens();
    unlocked.push(skinId);
    saveUnlockedSkins(unlocked);
  }
  setSelectedSkin(skinId);
  renderSkinsScreen();
}

function openSkinsScreen() {
  renderSkinsScreen();
  els.skinsScreen.classList.remove("hidden");
}

function closeSkinsScreen() {
  els.skinsScreen.classList.add("hidden");
}

renderTokens();
renderBestLines();

els.skinsBtn.addEventListener("click", openSkinsScreen);
els.skinsClose.addEventListener("click", closeSkinsScreen);
els.skinsBody.addEventListener("click", (e) => {
  const btn = e.target.closest(".skin-action-btn");
  if (btn && !btn.disabled) unlockOrSelectSkin(btn.dataset.skin);
});
els.cardFlipping.addEventListener("click", () => { location.href = "flipping.html"; });
