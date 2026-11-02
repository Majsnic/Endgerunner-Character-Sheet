// Cyberpunk RED item card — renders the current note's properties as a card.
// Used from an item note with:
//   ```dataviewjs
//   await dv.view("_scripts/cpr-item-card")   (script lives in 0. Kompendium/_scripts)
//   ```
// Empty properties are skipped, so one card works for weapons, armor, cyberware and gear.

const p = dv.current();
const has = (k) => p[k] !== undefined && p[k] !== null && String(p[k]).trim() !== "";
const txt = (v) => (Array.isArray(v) ? v.join(", ") : String(v));

const category = has("category") ? txt(p.category) : "Gear";

const card = dv.container.createDiv({ cls: "cpr-card" });
card.setAttr("data-category", category.toLowerCase());
card.createDiv({ cls: "cpr-card__stripe" });
const body = card.createDiv({ cls: "cpr-card__body" });

// tag line:  WEAPON // EXCELLENT // HEAVY PISTOL
const tag = [category, p.quality, p.type].filter((v) => v && String(v).trim()).map(txt)
  .filter((v, i, a) => a.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i);
body.createDiv({ cls: "cpr-card__tag", text: tag.join("  //  ") });
body.createEl("h2", { cls: "cpr-card__name", text: p.file.name });

// [property, label] — shown only when filled in
const fields = [
  ["cost", "Cost"],
  ["availability", "Availability"],
  ["damage", "Damage"],
  ["rof", "ROF"],
  ["magazine", "Magazine"],
  ["ammo_type", "Ammo"],
  ["skill", "Skill"],
  ["hands", "Hands"],
  ["concealable", "Concealable"],
  ["sp", "SP"],
  ["penalty", "Penalty"],
  ["humanity_loss", "Humanity Loss"],
  ["install", "Install"],
  ["slots", "Slots"],
  ["eligible", "Fits"],
  ["duration", "Duration"],
  ["dv", "Addiction DV"],
  ["per", "PER"],
  ["spd", "SPD"],
  ["atk", "ATK"],
  ["def", "DEF"],
  ["rez", "REZ"],
  ["threshold", "Threshold"],
  ["stabilize", "Stabilize"],
  ["roll", "Roll"],
  ["quick_fix", "Quick Fix"],
  ["treatment", "Treatment"],
  ["death_save_penalty_base", "Base Death Save"],
];

const grid = body.createDiv({ cls: "cpr-card__grid" });
for (const [key, label] of fields) {
  if (!has(key)) continue;
  let value = p[key];
  if (typeof value === "boolean") value = value ? "Yes" : "No";
  const cell = grid.createDiv({ cls: "cpr-card__cell" });
  cell.createSpan({ cls: "cpr-card__label", text: label });
  cell.createSpan({ cls: "cpr-card__value", text: txt(value) });
}
if (!grid.childElementCount) grid.remove();

if (has("effects")) {
  body.createDiv({ cls: "cpr-card__section", text: "Effects" });
  const ul = body.createEl("ul", { cls: "cpr-card__effects" });
  const list = Array.isArray(p.effects) ? p.effects : [p.effects];
  for (const e of list) ul.createEl("li", { text: txt(e) });
}

const foot = body.createDiv({ cls: "cpr-card__foot" });
foot.createSpan({ text: "NC//INV-" + p.file.name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) });
foot.createSpan({ text: has("source") ? txt(p.source) : "NIGHT CITY" });
