// ---------------------------------------------------------------------------
// Shared across every game in the arcade: the token currency, pizza skins,
// and haptics. Kept as plain globals (no bundler/module step) so every page
// just adds <script src="shared.js"> before its own game script.
// ---------------------------------------------------------------------------

const TOKENS_KEY = "flipping_tokens";
const UNLOCKED_SKINS_KEY = "flipping_unlocked_skins";
const SELECTED_SKIN_KEY = "flipping_selected_skin";

const FLIPPING_HIGH_SCORE_KEY = "flipping_high_score";

// Cosmetic-only reskins of the pizza, applied as a CSS filter on the same
// emoji glyph — no new art assets needed. "classic" is always unlocked.
const SKINS = [
  { id: "classic", name: "Classic", cost: 0, filter: "none" },
  { id: "fire", name: "Firehouse", cost: 5, filter: "hue-rotate(-28deg) saturate(1.3)" },
  { id: "mint", name: "Mint Mozz", cost: 10, filter: "hue-rotate(130deg) saturate(1.4)" },
  { id: "grape", name: "Grape Pie", cost: 15, filter: "hue-rotate(220deg) saturate(1.6)" },
  { id: "golden", name: "24k", cost: 25, filter: "saturate(1.8) brightness(1.25) hue-rotate(-8deg)" },
];

function getTokens() {
  return Number(localStorage.getItem(TOKENS_KEY) || 0);
}

function setTokens(amount) {
  localStorage.setItem(TOKENS_KEY, String(amount));
}

function getCount(key) {
  return Number(localStorage.getItem(key) || 0);
}

function setCount(key, value) {
  localStorage.setItem(key, String(value));
}

function bumpCount(key) {
  const next = getCount(key) + 1;
  setCount(key, next);
  return next;
}

function getUnlockedSkins() {
  try {
    const raw = JSON.parse(localStorage.getItem(UNLOCKED_SKINS_KEY) || "[]");
    return Array.isArray(raw) && raw.includes("classic") ? raw : ["classic", ...raw];
  } catch (e) {
    return ["classic"];
  }
}

function saveUnlockedSkins(ids) {
  localStorage.setItem(UNLOCKED_SKINS_KEY, JSON.stringify(ids));
}

function getSelectedSkin() {
  return localStorage.getItem(SELECTED_SKIN_KEY) || "classic";
}

function setSelectedSkin(skinId) {
  localStorage.setItem(SELECTED_SKIN_KEY, skinId);
}

function getSkinFilter(skinId) {
  const skin = SKINS.find((s) => s.id === skinId) || SKINS[0];
  return skin.filter;
}

// ---------------------------------------------------------------------------
// Haptics — real vibration feedback via Capacitor's native bridge. Reached
// through the global Capacitor object (no ES module import needed) and
// silently no-ops anywhere it isn't present, e.g. a plain browser preview.
// ---------------------------------------------------------------------------

function hapticImpact(style) {
  try {
    const haptics = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
    if (haptics) haptics.impact({ style });
  } catch (e) {
    // best-effort only
  }
}
