/* Cyberpunk RED Character Sheet for Obsidian
 * Plain JS plugin (no build step).
 * All character data lives in the note's frontmatter, so other plugins
 * (Roll for Initiative) can read hp / hp_current / ref / dex / body /
 * sp_head / sp_body / conditions / death_save_penalty directly.
 */
"use strict";
const obsidian = require("obsidian");
const { Plugin, MarkdownRenderChild, Notice, Modal, PluginSettingTab, Setting, normalizePath, FuzzySuggestModal, addIcon } = obsidian;

const STATS = ["int", "ref", "dex", "tech", "cool", "will", "luck", "move", "body", "emp"];
const STAT_LABEL = { int: "INT", ref: "REF", dex: "DEX", tech: "TECH", cool: "COOL", will: "WILL", luck: "LUCK", move: "MOVE", body: "BODY", emp: "EMP" };
const SW = "Seriously Wounded";
const MW = "Mortally Wounded";
const TABS = [
  ["role", "Role Ability"],
  ["cyberware", "Cyberware"],
  ["gear", "Gear"],
  ["lifepath", "Lifepath"],
  ["notes", "Notes"],
];
const LIFEPATH_FIELDS = [
  ["cultural_origins", "Cultural Origins"],
  ["personality", "Personality"],
  ["clothing_style", "Clothing Style"],
  ["hairstyle", "Hairstyle"],
  ["affectation", "Affectation"],
  ["value_most", "What Do You Value Most?"],
  ["feelings_about_people", "Feelings About People"],
  ["most_valued_person", "Most Valued Person"],
  ["most_valued_possession", "Most Valued Possession"],
  ["family_background", "Family Background"],
  ["childhood_environment", "Childhood Environment"],
  ["family_crisis", "Family Crisis"],
  ["life_goals", "Life Goals"],
];

const MOBILE_PAGES = [["overview", "Overview"], ["skills", "Skills"], ["combat", "Combat"], ["dossier", "Dossier"]];
const DEFAULT_SETTINGS = {
  characterFolder: "2. Hráči",
  itemFolder: "4. Předměty",
  enemyFolder: "3. Nepřátelé",
  npcFolder: "5. NPC",
  autoWoundPenalty: true,
  homebrewRoles: [],   // [{name, ability, desc}]
  homebrewSkills: [],  // [{name, stat, x2}]
};

/* ---------------- helpers ---------------- */
const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const arr = (v) => (Array.isArray(v) ? v : []);
const d10 = () => 1 + Math.floor(Math.random() * 10);
const d6 = () => 1 + Math.floor(Math.random() * 6);
const fmtMod = (n) => (n >= 0 ? `+${n}` : `${n}`);

function hpMax(fm) {
  if (fm.hp !== undefined && fm.hp !== null && fm.hp !== "") return num(fm.hp);
  return 10 + 5 * Math.ceil((num(fm.body) + num(fm.will)) / 2);
}
function hpCur(fm) {
  return fm.hp_current === undefined || fm.hp_current === null || fm.hp_current === "" ? hpMax(fm) : num(fm.hp_current);
}
function swThreshold(fm) {
  return Math.ceil(hpMax(fm) / 2);
}
function woundState(fm) {
  const cur = hpCur(fm);
  if (cur < 1) return MW;
  if (cur < swThreshold(fm)) return SW;
  if (cur < hpMax(fm)) return "Lightly Wounded";
  return "Unharmed";
}
function woundPenalty(fm) {
  const w = woundState(fm);
  if (w === MW) return -4;
  if (w === SW) return fm.ignore_sw_penalty ? 0 : -2;
  return 0;
}
function brawlDamage(body) {
  body = num(body);
  if (body >= 11) return "4d6";
  if (body >= 7) return "3d6";
  if (body >= 5) return "2d6";
  return "1d6";
}
function luckCur(fm) {
  return fm.luck_current === undefined || fm.luck_current === null || fm.luck_current === "" ? num(fm.luck) : num(fm.luck_current);
}
function humanityMax(fm) {
  return num(fm.emp) * 10;
}
function humanityCur(fm) {
  return fm.humanity === undefined || fm.humanity === null || fm.humanity === "" ? humanityMax(fm) : num(fm.humanity);
}
function skillTotal(fm, s) {
  return num(fm[String(s.stat || "").toLowerCase()]) + num(s.lvl) + num(s.bonus);
}
function findSkill(fm, name) {
  if (!name) return null;
  const n = String(name).toLowerCase();
  return arr(fm.skills).find((s) => String(s.name).toLowerCase() === n) || null;
}
function rollDice(expr) {
  // supports "3d6", "4d6+2", "2d6 - 1"
  const m = String(expr || "").replace(/\s+/g, "").match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!m) return null;
  const n = num(m[1]), sides = num(m[2]), mod = num(m[3] || 0);
  const rolls = [];
  for (let i = 0; i < n; i++) rolls.push(1 + Math.floor(Math.random() * sides));
  const total = rolls.reduce((a, b) => a + b, 0) + mod;
  const sixes = sides === 6 ? rolls.filter((r) => r === 6).length : 0;
  return { rolls, mod, total, crit: sixes >= 2 };
}
/** Cyberpunk RED d10 with critical success / failure */
function rollCheck(base) {
  const first = d10();
  let extra = 0, kind = "";
  if (first === 10) { extra = d10(); kind = "crit"; }
  else if (first === 1) { extra = -d10(); kind = "fumble"; }
  return { first, extra, kind, total: base + first + extra };
}
function el(parent, tag, cls, text) {
  const e = parent.createEl(tag, { cls });
  if (text !== undefined && text !== null) e.setText(String(text));
  return e;
}

/* ---------------- list editor modal ---------------- */
class ListModal extends Modal {
  constructor(app, title, fields, items, onSave) {
    super(app);
    this.title = title;
    this.fields = fields; // [{key,label,type,width,options}]
    this.items = JSON.parse(JSON.stringify(items || []));
    this.onSave = onSave;
  }
  onOpen() {
    this.modalEl.addClass("cpr-modal");
    this.titleEl.setText(this.title);
    this.draw();
  }
  draw() {
    const c = this.contentEl;
    c.empty();
    const table = el(c, "table", "cpr-edit-table");
    const head = el(table, "tr");
    for (const f of this.fields) el(head, "th", null, f.label);
    el(head, "th");
    this.items.forEach((item, i) => {
      const tr = el(table, "tr");
      for (const f of this.fields) {
        const td = el(tr, "td");
        let input;
        if (f.type === "select") {
          input = td.createEl("select");
          for (const o of f.options) input.createEl("option", { text: o, value: o });
          input.value = item[f.key] ?? f.options[0];
        } else if (f.type === "textarea") {
          input = td.createEl("textarea");
          input.value = item[f.key] ?? "";
          input.rows = 2;
        } else {
          input = td.createEl("input", { type: f.type === "number" ? "number" : "text" });
          input.value = item[f.key] ?? "";
        }
        if (f.width) input.style.width = f.width;
        input.addEventListener("change", () => {
          item[f.key] = f.type === "number" && input.value !== "" ? Number(input.value) : input.value;
        });
      }
      const act = el(tr, "td", "cpr-edit-actions");
      const up = el(act, "button", null, "↑");
      up.onclick = () => { if (i > 0) { [this.items[i - 1], this.items[i]] = [this.items[i], this.items[i - 1]]; this.draw(); } };
      const del = el(act, "button", "mod-warning", "✕");
      del.onclick = () => { this.items.splice(i, 1); this.draw(); };
    });
    const bar = el(c, "div", "cpr-edit-bar");
    const add = el(bar, "button", null, "+ Add row");
    add.onclick = () => {
      const blank = {};
      for (const f of this.fields) blank[f.key] = f.type === "select" ? f.options[0] : f.type === "number" ? 0 : "";
      this.items.push(blank);
      this.draw();
    };
    const save = el(bar, "button", "mod-cta", "Save");
    save.onclick = async () => {
      // pick up any field still focused
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      await this.onSave(this.items.filter((it) => Object.values(it).some((v) => v !== "" && v !== null)));
      this.close();
    };
  }
  onClose() { this.contentEl.empty(); }
}

class TextModal extends Modal {
  constructor(app, title, value, onSave, multiline = true) {
    super(app);
    this.title = title; this.value = value ?? ""; this.onSave = onSave; this.multiline = multiline;
  }
  onOpen() {
    this.modalEl.addClass("cpr-modal");
    this.titleEl.setText(this.title);
    const input = this.multiline ? this.contentEl.createEl("textarea", { cls: "cpr-text-input" }) : this.contentEl.createEl("input", { type: "text", cls: "cpr-text-input" });
    input.value = this.value;
    if (this.multiline) input.rows = 8;
    const bar = el(this.contentEl, "div", "cpr-edit-bar");
    const save = el(bar, "button", "mod-cta", "Save");
    save.onclick = async () => { await this.onSave(input.value); this.close(); };
    setTimeout(() => input.focus(), 10);
  }
  onClose() { this.contentEl.empty(); }
}

/* ---------------- condition picker ---------------- */
class ConditionModal extends FuzzySuggestModal {
  constructor(app, plugin, onPick) {
    super(app);
    this.plugin = plugin;
    this.onPick = onPick;
    this.setPlaceholder("Pick a condition or Critical Injury (Enter on free text adds it as typed)");
  }
  getItems() { return this.plugin.conditionFiles(); }
  getItemText(f) {
    const fm = this.app.metadataCache.getFileCache(f)?.frontmatter || {};
    return `${f.basename}${fm.quality ? "  ·  " + fm.quality : ""}`;
  }
  onChooseItem(f) { this.onPick(f.basename, f); }
  onNoSuggestion() {
    const v = this.inputEl.value.trim();
    this.emptyStateText = v ? `Press Enter to add "${v}"` : "No conditions found";
  }
  onOpen() {
    super.onOpen();
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !this.getSuggestions(this.inputEl.value).length && this.inputEl.value.trim()) {
        this.onPick(this.inputEl.value.trim(), null);
        this.close();
      }
    });
  }
}

/* ---------------- one rendered block ---------------- */
class SheetBlock extends MarkdownRenderChild {
  constructor(plugin, containerEl, sourcePath, kind, source) {
    super(containerEl);
    this.plugin = plugin;
    this.app = plugin.app;
    this.sourcePath = sourcePath;
    this.kind = kind;
    this.source = (source || "").trim();
  }
  get file() { return this.app.vault.getAbstractFileByPath(this.sourcePath); }
  get fm() {
    const f = this.file;
    return (f && this.app.metadataCache.getFileCache(f)?.frontmatter) || {};
  }
  onload() {
    this.render(this.fm);
    this.registerEvent(this.app.metadataCache.on("changed", (file, _data, cache) => {
      if (file.path === this.sourcePath) this.render(cache?.frontmatter || {});
    }));
    this.registerEvent(this.app.workspace.on("cpr-sheet:refresh", (path, fm) => {
      if (path === this.sourcePath) this.render(fm || this.fm);
    }));
  }
  get editing() { return this.plugin.editing.has(this.sourcePath); }

  // Mark the callouts that contain this block (cpr-has-<kind>) so the CSS can lay out
  // rows and phone pages without the :has() selector. The block may not be attached yet
  // when it first renders, so try again on the next frames.
  tagCallouts() {
    const tag = () => {
      let n = this.containerEl.parentElement, found = false;
      while (n) {
        if (n.classList && n.classList.contains("callout")) { n.classList.add("cpr-in-sheet", `cpr-has-${this.kind}`); found = true; }
        n = n.parentElement;
      }
      return found || this.containerEl.isConnected;
    };
    if (!tag()) { window.setTimeout(tag, 0); window.setTimeout(tag, 250); }
  }

  async update(mutator) {
    const f = this.file;
    if (!f) return;
    let snapshot = null;
    await this.app.fileManager.processFrontMatter(f, (fm) => {
      mutator(fm);
      snapshot = JSON.parse(JSON.stringify(fm));
    });
    // optimistic refresh of every block of this note
    this.app.workspace.trigger("cpr-sheet:refresh", this.sourcePath, snapshot);
  }
  log(text, kind = "") {
    this.plugin.pushLog(this.sourcePath, text, kind);
    new Notice(text, 6000);
  }

  render(fm) {
    const c = this.containerEl;
    c.empty();
    c.addClass("cpr-block", `cpr-block-${this.kind}`);
    this.tagCallouts();
    try {
      const fn = this["r_" + this.kind];
      if (fn) fn.call(this, c, fm || {});
      else el(c, "div", "cpr-error", `Unknown block: ${this.kind}`);
    } catch (e) {
      console.error(e);
      el(c, "div", "cpr-error", `Sheet error: ${e.message}`);
    }
  }

  /* ---- reusable inputs ---- */
  editableNumber(parent, fm, key, cls, fallback) {
    const value = fm[key] ?? fallback ?? "";
    if (this.editing) {
      const i = parent.createEl("input", { type: "number", cls: "cpr-num-input " + (cls || "") });
      i.value = value;
      i.addEventListener("change", () => this.update((f) => { f[key] = i.value === "" ? null : Number(i.value); }));
      return i;
    }
    return el(parent, "span", cls, value === "" ? "-" : value);
  }
  editableText(parent, fm, key, cls, placeholder) {
    const value = fm[key] ?? "";
    if (this.editing) {
      const i = parent.createEl("input", { type: "text", cls: "cpr-text-inline " + (cls || "") });
      i.value = value;
      i.placeholder = placeholder || "";
      i.addEventListener("change", () => this.update((f) => { f[key] = i.value; }));
      return i;
    }
    return el(parent, "span", cls, value || placeholder || "-");
  }
  sectionTools(parent, label, onEdit) {
    const b = el(parent, "button", "cpr-tool", label);
    b.onclick = onEdit;
    return b;
  }

  /* ---------------- HEADER ---------------- */
  r_header(c, fm) {
    const top = el(c, "div", "cpr-header");
    const h = el(top, "div", "cpr-field cpr-handle");
    el(h, "span", "cpr-label", "Handle");
    this.editableText(h, fm, "handle", "cpr-value cpr-big", this.file?.basename);
    const r = el(top, "div", "cpr-field cpr-role");
    el(r, "span", "cpr-label", "Role");
    this.editableText(r, fm, "role", "cpr-value cpr-big", "Role");
    const rk = el(r, "span", "cpr-rank");
    el(rk, "span", "cpr-label", "Rank");
    this.editableNumber(rk, fm, "rank", "cpr-value", 4);

    const meta = el(c, "div", "cpr-meta");
    const pl = el(meta, "div", "cpr-field");
    el(pl, "span", "cpr-label", "Player");
    this.editableText(pl, fm, "player", "cpr-value", "-");
    const eb = el(meta, "div", "cpr-field");
    el(eb, "span", "cpr-label", "Eurobucks");
    this.editableNumber(eb, fm, "eurobucks", "cpr-value", 0);
    if (!this.editing) {
      const ebBtn = el(eb, "button", "cpr-mini", "±");
      ebBtn.title = "Add or spend eurobucks";
      ebBtn.onclick = () => new TextModal(this.app, "Eurobucks change (e.g. 500 or -120)", "", async (v) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return;
        await this.update((f) => { f.eurobucks = num(f.eurobucks) + n; });
      }, false).open();
    }
    const ip = el(meta, "div", "cpr-field");
    el(ip, "span", "cpr-label", "IP");
    this.editableNumber(ip, fm, "ip", "cpr-value", 0);
    if (!this.editing) {
      const up = el(ip, "button", "cpr-mini cpr-mini-red", "⬆ Upgrade");
      up.title = "Spend Improvement Points on skills or Role Rank";
      up.onclick = () => this.file && new UpgradeModal(this.app, this.plugin, this.file).open();
    }
    const rep = el(meta, "div", "cpr-field");
    el(rep, "span", "cpr-label", "Reputation");
    this.editableNumber(rep, fm, "reputation", "cpr-value", 0);

    const tools = el(meta, "div", "cpr-header-tools");
    const editBtn = el(tools, "button", "cpr-tool" + (this.editing ? " is-active" : ""), this.editing ? "✔ Done" : "✎ Edit sheet");
    editBtn.onclick = () => this.plugin.toggleEdit(this.sourcePath);
  }

  /* ---------------- STATS ---------------- */
  r_stats(c, fm) {
    const grid = el(c, "div", "cpr-stats");
    for (const s of STATS) {
      const box = el(grid, "div", `cpr-stat cpr-stat-${s}`);
      el(box, "span", "cpr-label", STAT_LABEL[s]);
      if (s === "luck" && !this.editing) {
        const wrap = el(box, "div", "cpr-luck");
        const minus = el(wrap, "button", "cpr-mini", "−");
        el(wrap, "span", "cpr-value", luckCur(fm));
        el(wrap, "span", "cpr-of", `/ ${num(fm.luck)}`);
        const plus = el(wrap, "button", "cpr-mini", "+");
        minus.onclick = () => this.update((f) => { f.luck_current = Math.max(0, luckCur(f) - 1); });
        plus.onclick = () => this.update((f) => { f.luck_current = Math.min(num(f.luck), luckCur(f) + 1); });
        minus.title = "Spend 1 LUCK";
        plus.title = "Regain 1 LUCK";
      } else {
        this.editableNumber(box, fm, s, "cpr-value", 0);
      }
    }
    if (!this.editing) {
      const tools = el(c, "div", "cpr-row-tools");
      const refill = el(tools, "button", "cpr-tool", "↻ Refill LUCK (new session)");
      refill.onclick = () => this.update((f) => { f.luck_current = num(f.luck); });
    }
  }

  /* ---------------- VITALS ---------------- */
  r_vitals(c, fm) {
    const max = hpMax(fm), cur = hpCur(fm), state = woundState(fm);
    const row = el(c, "div", "cpr-vitals");

    const hp = el(row, "div", "cpr-vital cpr-hp");
    el(hp, "span", "cpr-label", "HP");
    const hv = el(hp, "div", "cpr-hp-values");
    if (this.editing) {
      el(hv, "span", "cpr-of", "max");
      this.editableNumber(hv, fm, "hp", "cpr-value", max);
      el(hv, "span", "cpr-of", "now");
      this.editableNumber(hv, fm, "hp_current", "cpr-value", cur);
    } else {
      el(hv, "span", "cpr-value cpr-hp-cur", cur);
      el(hv, "span", "cpr-of", `/ ${max}`);
    }
    const bar = el(hp, "div", "cpr-hp-bar");
    const fill = el(bar, "div", "cpr-hp-fill");
    fill.style.width = `${Math.max(0, Math.min(100, (cur / max) * 100))}%`;
    fill.addClass(state === MW ? "is-mortal" : state === SW ? "is-serious" : "is-ok");
    const mark = el(bar, "div", "cpr-hp-mark");
    mark.style.left = `${(swThreshold(fm) / max) * 100}%`;

    const sw = el(row, "div", "cpr-vital");
    el(sw, "span", "cpr-label", "Seriously Wounded");
    el(sw, "span", "cpr-value", swThreshold(fm));

    const ds = el(row, "div", "cpr-vital");
    el(ds, "span", "cpr-label", "Death Save");
    el(ds, "span", "cpr-value", num(fm.body));
    if (num(fm.death_save_penalty) > 0) el(ds, "span", "cpr-of", `penalty +${num(fm.death_save_penalty)}`);

    const st = el(c, "div", "cpr-state");
    el(st, "span", `cpr-wound cpr-wound-${state.split(" ")[0].toLowerCase()}`, state);
    const pen = woundPenalty(fm);
    if (pen) el(st, "span", "cpr-of", `${pen} to all Checks`);
    else if (state === SW && fm.ignore_sw_penalty) el(st, "span", "cpr-of", "penalty ignored (Pain Editor)");
    for (const cond of arr(fm.conditions).filter((x) => x !== SW && x !== MW)) {
      const chip = el(st, "span", "cpr-chip");
      const label = el(chip, "span", "cpr-chip-label", cond);
      const note = this.plugin.conditionFile(cond);
      if (note) {
        chip.addClass("is-linked");
        label.title = "Open the condition's rules";
        label.onclick = () => this.app.workspace.getLeaf(true).openFile(note);
      }
      const x = el(chip, "span", "cpr-chip-x", "×");
      x.title = "Remove";
      x.onclick = () => this.update((f) => { f.conditions = arr(f.conditions).filter((c) => c !== cond); });
    }
    const addC = el(st, "button", "cpr-mini", "+ condition");
    addC.onclick = () => new ConditionModal(this.app, this.plugin, async (name, file) => {
      if (!name) return;
      await this.update((f) => { f.conditions = [...new Set([...arr(f.conditions), name])]; });
      const cfm = file && this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (cfm && cfm.death_save_penalty_base) new Notice(`${name}: Base Death Save Penalty ${cfm.death_save_penalty_base}`);
    }).open();

    if (this.editing) return;

    // damage panel
    const dmg = el(c, "div", "cpr-damage");
    const input = dmg.createEl("input", { type: "number", cls: "cpr-num-input", attr: { placeholder: "dmg" } });
    const apply = (mode) => {
      const n = num(input.value);
      if (n <= 0) return;
      this.applyDamage(n, mode);
      input.value = "";
    };
    for (const [mode, label] of [["body", "Body hit"], ["head", "Head hit"], ["direct", "Direct"]]) {
      const b = el(dmg, "button", "cpr-btn cpr-btn-red", label);
      b.onclick = () => apply(mode);
    }
    const heal = el(dmg, "button", "cpr-btn", "Heal");
    heal.onclick = () => {
      const n = num(input.value);
      if (n <= 0) return;
      this.update((f) => {
        f.hp_current = Math.min(hpMax(f), hpCur(f) + n);
        this.syncConditions(f);
      });
      input.value = "";
    };
    const ds2 = el(dmg, "button", "cpr-btn" + (state === MW ? " cpr-btn-red" : ""), "Death Save");
    ds2.onclick = () => this.deathSave();
    const stab = el(dmg, "button", "cpr-btn", "Stabilized");
    stab.title = "Stabilized: back to at least 1 HP, Death Save penalty reset";
    stab.onclick = () => this.update((f) => {
      f.hp_current = Math.max(1, hpCur(f));
      f.death_save_penalty = 0;
      this.syncConditions(f);
    });
  }
  syncConditions(f) {
    const tmp = Object.assign({}, f);
    const state = woundState(tmp);
    let conds = arr(f.conditions).filter((x) => x !== SW && x !== MW);
    if (state === SW) conds.push(SW);
    if (state === MW) conds.push(MW);
    f.conditions = conds;
  }
  applyDamage(n, mode) {
    let msg = "";
    this.update((f) => {
      let through = n;
      if (mode !== "direct") {
        const key = mode === "head" ? "sp_head" : "sp_body";
        const sp = num(f[key]);
        through = Math.max(0, n - sp);
        if (through > 0 && sp > 0) f[key] = sp - 1;
        if (mode === "head") through *= 2;
        msg = `${n} dmg vs SP ${sp} → ${through} through${through > 0 && sp > 0 ? `, ${mode} SP now ${sp - 1}` : ""}`;
      } else msg = `${n} direct damage`;
      f.hp_current = hpCur(f) - through;
      this.syncConditions(f);
      msg += ` · HP ${f.hp_current}/${hpMax(f)}`;
    }).then(() => this.log(msg, "damage"));
  }
  deathSave() {
    const fm = this.fm;
    const r = d10();
    const pen = num(fm.death_save_penalty);
    const total = r + pen;
    const ok = r !== 10 && total < num(fm.body);
    this.update((f) => { f.death_save_penalty = num(f.death_save_penalty) + 1; })
      .then(() => this.log(`Death Save: d10 ${r}${pen ? ` + ${pen}` : ""} = ${total} vs BODY ${num(fm.body)} → ${ok ? "SURVIVED" : "FAILED"}`, ok ? "ok" : "fail"));
  }

  /* ---------------- PORTRAIT ---------------- */
  r_portrait(c, fm) {
    const box = el(c, "div", "cpr-portrait");
    const link = String(fm.image || "").replace(/^!?\[\[|\]\]$/g, "").split("|")[0];
    if (link) {
      const file = this.app.metadataCache.getFirstLinkpathDest(link, this.sourcePath);
      if (file) {
        const img = box.createEl("img");
        img.src = this.app.vault.getResourcePath(file);
        img.alt = fm.handle || "";
      } else el(box, "div", "cpr-portrait-empty", `Image not found: ${link}`);
    } else el(box, "div", "cpr-portrait-empty", "No portrait — set the image property");
    const notes = el(c, "div", "cpr-quicknotes");
    el(notes, "span", "cpr-label", "Notes");
    const t = el(notes, "div", "cpr-quicknotes-text", fm.quick_notes || "");
    notes.onclick = () => new TextModal(this.app, "Notes", fm.quick_notes || "", (v) => this.update((f) => { f.quick_notes = v; })).open();
    notes.title = "Click to edit";
    if (!fm.quick_notes) t.addClass("is-empty");
  }

  /* ---------------- SKILLS ---------------- */
  r_skills(c, fm) {
    const skills = arr(fm.skills);
    const pen = this.plugin.settings.autoWoundPenalty ? woundPenalty(fm) : 0;
    const stake = this.plugin.luckStake.get(this.sourcePath) || 0;

    const bar = el(c, "div", "cpr-row-tools");
    const lk = el(bar, "div", "cpr-luckstake");
    el(lk, "span", "cpr-label", "LUCK on next roll");
    const m = el(lk, "button", "cpr-mini", "−");
    el(lk, "span", "cpr-value", stake);
    const p = el(lk, "button", "cpr-mini", "+");
    m.onclick = () => { this.plugin.luckStake.set(this.sourcePath, Math.max(0, stake - 1)); this.refreshLocal(); };
    p.onclick = () => { this.plugin.luckStake.set(this.sourcePath, Math.min(luckCur(fm), stake + 1)); this.refreshLocal(); };
    if (pen) el(bar, "span", "cpr-pen", `wound penalty ${pen}`);
    this.sectionTools(bar, "✎ Edit skills", () => this.editSkills(fm));

    const half = Math.ceil(skills.length / 2);
    const cols = el(c, "div", "cpr-skill-cols");
    for (const part of [skills.slice(0, half), skills.slice(half)]) {
      const t = el(cols, "table", "cpr-table cpr-skills");
      const hr = el(t, "tr");
      for (const h of ["Skill", "STAT", "+ LVL", "= TOTAL"]) el(hr, "th", null, h);
      for (const s of part) {
        const tr = el(t, "tr", "cpr-skill-row");
        const name = el(tr, "td", "cpr-skill-name", s.name);
        if (String(s.name).toLowerCase() === "brawling") el(name, "span", "cpr-dmg", ` (DMG: ${brawlDamage(fm.body)})`);
        const statTd = el(tr, "td", "cpr-num", num(fm[String(s.stat).toLowerCase()]));
        statTd.title = String(s.stat || "").toUpperCase();
        el(tr, "td", "cpr-num", num(s.lvl) + (num(s.bonus) ? ` (${fmtMod(num(s.bonus))})` : ""));
        el(tr, "td", "cpr-num cpr-total", skillTotal(fm, s));
        tr.title = `Roll ${s.name}: 1d10 + ${skillTotal(fm, s)}`;
        tr.onclick = () => this.rollSkill(s.name, skillTotal(fm, s));
      }
    }
    if (!skills.length) el(c, "div", "cpr-empty", "No skills yet — click Edit skills.");
  }
  refreshLocal() { this.app.workspace.trigger("cpr-sheet:refresh", this.sourcePath, this.fm); }
  rollSkill(label, base) {
    const fm = this.fm;
    const pen = this.plugin.settings.autoWoundPenalty ? woundPenalty(fm) : 0;
    const stake = Math.min(this.plugin.luckStake.get(this.sourcePath) || 0, luckCur(fm));
    const r = rollCheck(base + pen + stake);
    let text = `${label}: ${base}${pen ? ` ${pen}` : ""}${stake ? ` +${stake} LUCK` : ""} + d10 ${r.first}`;
    if (r.kind === "crit") text += ` CRIT +${r.extra}`;
    if (r.kind === "fumble") text += ` FUMBLE ${r.extra}`;
    text += ` = ${r.total}`;
    if (stake) {
      this.plugin.luckStake.set(this.sourcePath, 0);
      this.update((f) => { f.luck_current = Math.max(0, luckCur(f) - stake); });
    } else this.refreshLocal();
    this.log(text, r.kind);
    return r;
  }
  editSkills(fm) {
    new ListModal(this.app, "Skills", [
      { key: "name", label: "Skill", width: "16em" },
      { key: "stat", label: "STAT", type: "select", options: STATS.map((s) => STAT_LABEL[s]) },
      { key: "lvl", label: "LVL", type: "number", width: "4em" },
      { key: "bonus", label: "Bonus", type: "number", width: "4em" },
    ], arr(fm.skills).map((s) => ({ ...s, stat: String(s.stat || "INT").toUpperCase() })), (items) =>
      this.update((f) => { f.skills = items.map((s) => ({ name: s.name, stat: s.stat, lvl: num(s.lvl), ...(num(s.bonus) ? { bonus: num(s.bonus) } : {}) })); })
    ).open();
  }

  /* ---------------- ARMOR ---------------- */
  r_armor(c, fm) {
    const t = el(c, "table", "cpr-table cpr-armor");
    const hr = el(t, "tr");
    for (const h of ["Armor", "Location", "SP", ""]) el(hr, "th", null, h);
    const rows = [
      ["sp_head", "Head", fm.armor_head || fm.armor || "-", "sp_head_max"],
      ["sp_body", "Body", fm.armor_body || fm.armor || "-", "sp_body_max"],
    ];
    for (const [key, loc, name, maxKey] of rows) {
      const tr = el(t, "tr");
      el(tr, "td", null, name);
      el(tr, "td", null, loc);
      const sp = el(tr, "td", "cpr-num");
      if (this.editing) {
        this.editableNumber(sp, fm, key, "cpr-value");
        el(sp, "span", "cpr-of", " max ");
        this.editableNumber(sp, fm, maxKey, "cpr-value");
      } else {
        el(sp, "span", "cpr-value", num(fm[key]));
        el(sp, "span", "cpr-of", ` / ${num(fm[maxKey] ?? fm[key])}`);
      }
      const act = el(tr, "td", "cpr-act");
      if (!this.editing) {
        const ab = el(act, "button", "cpr-mini", "−1");
        ab.title = "Ablate SP by 1";
        ab.onclick = () => this.update((f) => { f[key] = Math.max(0, num(f[key]) - 1); });
        const rp = el(act, "button", "cpr-mini", "↻");
        rp.title = "Repair to full SP";
        rp.onclick = () => this.update((f) => { f[key] = num(f[maxKey] ?? f[key]); });
      }
    }
    if (this.editing) {
      const n = el(c, "div", "cpr-row-tools");
      el(n, "span", "cpr-label", "Armor name");
      this.editableText(n, fm, "armor", null, "Light Armorjack");
    }
  }

  /* ---------------- WEAPONS ---------------- */
  r_weapons(c, fm) {
    const ws = arr(fm.weapons);
    const bar = el(c, "div", "cpr-row-tools");
    this.sectionTools(bar, "✎ Edit weapons", () => this.editWeapons(fm));
    const t = el(c, "table", "cpr-table cpr-weapons");
    const hr = el(t, "tr");
    for (const h of ["Weapon", "DMG", "Ammo", "ROF", "Notes", ""]) el(hr, "th", null, h);
    ws.forEach((w, i) => {
      const tr = el(t, "tr");
      const nm = el(tr, "td", "cpr-weapon-name", w.name);
      if (w.skill) el(nm, "div", "cpr-sub", w.skill);
      el(tr, "td", "cpr-num", w.dmg || "-");
      const am = el(tr, "td", "cpr-num");
      const mag = num(w.ammo, 0);
      if (mag > 0) {
        const curAmmo = w.ammo_current === undefined || w.ammo_current === null || w.ammo_current === "" ? mag : num(w.ammo_current);
        el(am, "span", "cpr-value" + (curAmmo === 0 ? " is-empty" : ""), curAmmo);
        el(am, "span", "cpr-of", `/${mag}`);
        if (num(w.spare) > 0 || w.spare === 0) el(am, "div", "cpr-sub", `spare ${num(w.spare)}`);
      } else el(am, "span", null, "—");
      el(tr, "td", "cpr-num", w.rof ?? "-");
      el(tr, "td", "cpr-notes", w.notes || "");
      const act = el(tr, "td", "cpr-act");
      const atk = el(act, "button", "cpr-mini cpr-mini-red", "Attack");
      atk.onclick = () => this.attack(i);
      const dm = el(act, "button", "cpr-mini", "Dmg");
      dm.onclick = () => this.damageRoll(w);
      if (mag > 0) {
        const rl = el(act, "button", "cpr-mini", "Reload");
        rl.onclick = () => this.reload(i);
      }
    });
    if (!ws.length) el(c, "div", "cpr-empty", "No weapons — click Edit weapons.");
  }
  attack(i) {
    const fm = this.fm;
    const w = arr(fm.weapons)[i];
    if (!w) return;
    const mag = num(w.ammo, 0);
    const curAmmo = w.ammo_current === undefined || w.ammo_current === null || w.ammo_current === "" ? mag : num(w.ammo_current);
    if (mag > 0 && curAmmo <= 0) { new Notice(`${w.name}: out of ammo — reload!`); return; }
    const skill = findSkill(fm, w.skill);
    const statKey = skill ? String(skill.stat).toLowerCase() : mag > 0 ? "ref" : "dex";
    const base = skill ? skillTotal(fm, skill) : num(fm[statKey]);
    this.rollSkill(`${w.name} attack (${skill ? skill.name : STAT_LABEL[statKey] + " only"})`, base);
    if (mag > 0) {
      this.update((f) => {
        const ww = arr(f.weapons)[i];
        if (!ww) return;
        const cur = ww.ammo_current === undefined || ww.ammo_current === null || ww.ammo_current === "" ? num(ww.ammo) : num(ww.ammo_current);
        ww.ammo_current = Math.max(0, cur - 1);
      });
    }
  }
  damageRoll(w) {
    const r = rollDice(w.dmg);
    if (!r) { new Notice(`Can't roll "${w.dmg}"`); return; }
    this.log(`${w.name} damage: ${w.dmg} [${r.rolls.join(", ")}]${r.mod ? fmtMod(r.mod) : ""} = ${r.total}${r.crit ? " · CRITICAL INJURY (two 6s) +5 direct" : ""}`, r.crit ? "crit" : "");
  }
  reload(i) {
    let msg = "";
    this.update((f) => {
      const w = arr(f.weapons)[i];
      if (!w) return;
      const mag = num(w.ammo);
      const cur = w.ammo_current === undefined || w.ammo_current === null || w.ammo_current === "" ? mag : num(w.ammo_current);
      const need = mag - cur;
      if (w.spare === undefined || w.spare === null || w.spare === "") { w.ammo_current = mag; msg = `${w.name} reloaded`; return; }
      const take = Math.min(need, num(w.spare));
      w.ammo_current = cur + take;
      w.spare = num(w.spare) - take;
      msg = take > 0 ? `${w.name} reloaded (+${take}, ${w.spare} spare left)` : `${w.name}: no spare ammo!`;
    }).then(() => msg && this.log(msg));
  }
  editWeapons(fm) {
    new ListModal(this.app, "Weapons", [
      { key: "name", label: "Weapon", width: "12em" },
      { key: "dmg", label: "DMG", width: "4.5em" },
      { key: "ammo", label: "Mag", type: "number", width: "4em" },
      { key: "ammo_current", label: "Loaded", type: "number", width: "4em" },
      { key: "spare", label: "Spare", type: "number", width: "4em" },
      { key: "rof", label: "ROF", type: "number", width: "3.5em" },
      { key: "skill", label: "Skill", width: "9em" },
      { key: "notes", label: "Notes", width: "14em" },
    ], arr(fm.weapons), (items) => this.update((f) => { f.weapons = items; })).open();
  }

  /* ---------------- TABS ---------------- */
  r_tabs(c, fm) {
    const active = this.plugin.activeTab.get(this.sourcePath) || "role";
    const bar = el(c, "div", "cpr-tabbar");
    for (const [key, label] of TABS) {
      const b = el(bar, "button", "cpr-tab" + (key === active ? " is-active" : ""), label);
      b.onclick = () => { this.plugin.activeTab.set(this.sourcePath, key); this.render(this.fm); };
    }
    const panel = el(c, "div", "cpr-tabpanel");
    this["t_" + active].call(this, panel, fm);
  }
  cards(c, items, emptyText) {
    if (!items.length) { el(c, "div", "cpr-empty", emptyText); return; }
    const wrap = el(c, "div", "cpr-cards");
    for (const it of items) {
      const card = el(wrap, "div", "cpr-card-item");
      const head = el(card, "div", "cpr-card-head", it.name || "-");
      if (it.humanity_loss) el(head, "span", "cpr-hl", `HL ${it.humanity_loss}`);
      if (it.desc || it.notes) el(card, "div", "cpr-card-body", it.desc || it.notes);
    }
  }
  t_role(c, fm) {
    const ra = Array.isArray(fm.role_ability) ? fm.role_ability : fm.role_ability ? [fm.role_ability] : [];
    const bar = el(c, "div", "cpr-row-tools");
    el(bar, "span", "cpr-label", `${fm.role || "Role"} · Rank ${num(fm.rank, 4)}`);
    this.sectionTools(bar, "✎ Edit", () => new ListModal(this.app, "Role Ability", [
      { key: "name", label: "Ability", width: "12em" },
      { key: "desc", label: "What it does", type: "textarea", width: "28em" },
    ], ra, (items) => this.update((f) => { f.role_ability = items; })).open());
    this.cards(c, ra, "No Role Ability yet.");
  }
  t_cyberware(c, fm) {
    const cw = arr(fm.cyberware);
    const bar = el(c, "div", "cpr-row-tools");
    const hum = el(bar, "div", "cpr-humanity");
    el(hum, "span", "cpr-label", "Humanity");
    if (this.editing) this.editableNumber(hum, fm, "humanity", "cpr-value", humanityCur(fm));
    else {
      el(hum, "span", "cpr-value", humanityCur(fm));
      el(hum, "span", "cpr-of", ` (EMP ${Math.floor(humanityCur(fm) / 10)})`);
      const loss = el(hum, "button", "cpr-mini", "− loss");
      loss.onclick = () => new TextModal(this.app, "Humanity loss (number)", "", async (v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) return;
        await this.update((f) => {
          f.humanity = humanityCur(f) - n;
          f.emp = Math.max(0, Math.floor(f.humanity / 10));
        });
      }, false).open();
    }
    this.sectionTools(bar, "✎ Edit cyberware", () => new ListModal(this.app, "Cyberware", [
      { key: "name", label: "Cyberware", width: "12em" },
      { key: "desc", label: "Effect", type: "textarea", width: "24em" },
      { key: "humanity_loss", label: "HL", width: "4em" },
    ], cw, (items) => this.update((f) => { f.cyberware = items; })).open());
    this.cards(c, cw, "No cyberware.");
  }
  t_gear(c, fm) {
    const g = arr(fm.gear);
    const bar = el(c, "div", "cpr-row-tools");
    const eb = el(bar, "div", "cpr-field");
    el(eb, "span", "cpr-label", "Eurobucks");
    el(eb, "span", "cpr-value", `${num(fm.eurobucks)}eb`);
    this.sectionTools(bar, "✎ Edit gear", () => new ListModal(this.app, "Gear", [
      { key: "name", label: "Name", width: "12em" },
      { key: "notes", label: "Notes", width: "22em" },
      { key: "qty", label: "Qty", type: "number", width: "4em" },
    ], g, (items) => this.update((f) => { f.gear = items; })).open());
    if (!g.length) { el(c, "div", "cpr-empty", "No gear."); return; }
    const t = el(c, "table", "cpr-table");
    const hr = el(t, "tr");
    for (const h of ["Name", "Notes", "Qty"]) el(hr, "th", null, h);
    for (const it of g) {
      const tr = el(t, "tr");
      el(tr, "td", null, it.name);
      el(tr, "td", "cpr-notes", it.notes || "");
      el(tr, "td", "cpr-num", it.qty ?? 1);
    }
  }
  t_lifepath(c, fm) {
    const lp = fm.lifepath && typeof fm.lifepath === "object" ? fm.lifepath : {};
    const grid = el(c, "div", "cpr-lifepath");
    for (const [key, label] of LIFEPATH_FIELDS) {
      const box = el(grid, "div", "cpr-lp-field");
      el(box, "span", "cpr-label", label);
      const v = el(box, "div", "cpr-lp-value", lp[key] || "");
      if (!lp[key]) v.addClass("is-empty");
      box.title = "Click to edit";
      box.onclick = () => new TextModal(this.app, label, lp[key] || "", (val) => this.update((f) => {
        f.lifepath = Object.assign({}, f.lifepath || {}, { [key]: val });
      })).open();
    }
    const lists = [
      ["friends", "Friends", [{ key: "name", label: "Who", width: "12em" }, { key: "relationship", label: "Relationship", width: "20em" }]],
      ["tragic_love_affairs", "Tragic Love Affairs", [{ key: "name", label: "Who", width: "12em" }, { key: "what_happened", label: "What happened", width: "20em" }]],
      ["enemies", "Enemies", [{ key: "name", label: "Who", width: "10em" }, { key: "cause", label: "What caused it?", width: "14em" }, { key: "outcome", label: "What's gonna happen?", width: "14em" }]],
    ];
    for (const [key, label, fields] of lists) {
      const items = arr(fm[key]);
      const sec = el(c, "div", "cpr-lp-list");
      const bar = el(sec, "div", "cpr-row-tools");
      el(bar, "span", "cpr-label", label);
      this.sectionTools(bar, "✎", () => new ListModal(this.app, label, fields, items, (v) => this.update((f) => { f[key] = v; })).open());
      if (!items.length) { el(sec, "div", "cpr-empty", "—"); continue; }
      const t = el(sec, "table", "cpr-table");
      const hr = el(t, "tr");
      for (const f of fields) el(hr, "th", null, f.label);
      for (const it of items) {
        const tr = el(t, "tr");
        for (const f of fields) el(tr, "td", null, it[f.key] || "");
      }
    }
  }
  t_notes(c, fm) {
    const box = el(c, "div", "cpr-notes-box");
    const bar = el(box, "div", "cpr-row-tools");
    el(bar, "span", "cpr-label", "Additional Notes");
    this.sectionTools(bar, "✎ Edit", () => new TextModal(this.app, "Additional Notes", fm.additional_notes || "", (v) => this.update((f) => { f.additional_notes = v; })).open());
    el(box, "div", "cpr-notes-text" + (fm.additional_notes ? "" : " is-empty"), fm.additional_notes || "Nothing yet.");
    const log = this.plugin.logs.get(this.sourcePath) || [];
    const lbar = el(c, "div", "cpr-row-tools");
    el(lbar, "span", "cpr-label", "Roll log (this session)");
    if (!log.length) el(c, "div", "cpr-empty", "No rolls yet.");
    else {
      const ul = el(c, "ul", "cpr-log");
      for (const entry of log) el(ul, "li", `cpr-log-${entry.kind || "plain"}`, entry.text);
    }
  }

  /* ---------------- ROLL LOG (small strip) ---------------- */
  /* ---------------- MOBILE BAR (phones only, see styles.css) ---------------- */
  r_mobile(c, fm) {
    const page = this.plugin.mobilePageFor(this.sourcePath);
    this.applyMobilePage(page);
    const bar = el(c, "div", "cpr-mbar");
    const top = el(bar, "div", "cpr-mbar-top");
    const who = el(top, "div", "cpr-mbar-who");
    el(who, "span", "cpr-mbar-name", fm.handle || this.file?.basename || "");
    el(who, "span", "cpr-mbar-role", `${fm.role || ""}${fm.rank ? " · R" + fm.rank : ""}`);
    const max = hpMax(fm), cur = hpCur(fm), state = woundState(fm);
    const hp = el(top, "div", "cpr-mbar-hp");
    el(hp, "span", "cpr-mbar-hpnum", `${cur}/${max}`);
    const barEl = el(hp, "div", "cpr-hp-bar");
    const fill = el(barEl, "div", "cpr-hp-fill " + (state === MW ? "is-mortal" : state === SW ? "is-serious" : "is-ok"));
    fill.style.width = `${Math.max(0, Math.min(100, (cur / max) * 100))}%`;
    hp.title = "Tap to take damage or heal";
    hp.onclick = () => { this.plugin.setMobilePage(this.sourcePath, "combat"); };
    const chips = el(bar, "div", "cpr-mbar-chips");
    el(chips, "span", "cpr-mbar-chip", `SP ${num(fm.sp_head)}/${num(fm.sp_body)}`);
    el(chips, "span", "cpr-mbar-chip", `LUCK ${luckCur(fm)}/${num(fm.luck)}`);
    if (num(fm.ip)) el(chips, "span", "cpr-mbar-chip", `IP ${num(fm.ip)}`);
    if (state !== "Unharmed") el(chips, "span", `cpr-wound cpr-wound-${state.split(" ")[0].toLowerCase()}`, state);
    for (const cond of arr(fm.conditions).filter((x) => x !== SW && x !== MW)) el(chips, "span", "cpr-chip", cond);
    const nav = el(bar, "div", "cpr-mbar-nav");
    for (const [key, label] of MOBILE_PAGES) {
      const b = el(nav, "button", "cpr-mbar-tab" + (key === page ? " is-active" : ""), label);
      b.onclick = () => this.plugin.setMobilePage(this.sourcePath, key);
    }
  }
  applyMobilePage(page) {
    const view = this.containerEl.closest(".markdown-preview-view, .markdown-source-view, .markdown-reading-view");
    if (view) view.setAttribute("data-cpr-page", page);
  }

  r_log(c) {
    const log = this.plugin.logs.get(this.sourcePath) || [];
    const strip = el(c, "div", "cpr-logstrip");
    el(strip, "span", "cpr-label", "Last roll");
    el(strip, "span", "cpr-logstrip-text" + (log[0] ? ` cpr-log-${log[0].kind || "plain"}` : ""), log[0] ? log[0].text : "Click a skill or Attack to roll.");
  }
}

/* ================= Character creation data (Cyberpunk RED Core Rulebook) ================= */
const STAT_KEYS = ["int", "ref", "dex", "tech", "cool", "will", "luck", "move", "body", "emp"];

const BASIC_SKILLS = ["Athletics", "Brawling", "Concentration", "Conversation", "Education", "Evasion", "First Aid",
  "Human Perception", "Language (Streetslang)", "Local Expert (Your Home)", "Perception", "Persuasion", "Stealth"];

// [name, STAT, cost multiplier]
const MASTER_SKILLS = [
  ["Concentration", "WILL", 1], ["Conceal/Reveal Object", "INT", 1], ["Lip Reading", "INT", 1], ["Perception", "INT", 1], ["Tracking", "INT", 1],
  ["Athletics", "DEX", 1], ["Contortionist", "DEX", 1], ["Dance", "DEX", 1], ["Endurance", "WILL", 1], ["Resist Torture/Drugs", "WILL", 1], ["Stealth", "DEX", 1],
  ["Drive Land Vehicle", "REF", 1], ["Pilot Air Vehicle", "REF", 2], ["Pilot Sea Vehicle", "REF", 1], ["Riding", "REF", 1],
  ["Accounting", "INT", 1], ["Animal Handling", "INT", 1], ["Bureaucracy", "INT", 1], ["Business", "INT", 1], ["Composition", "INT", 1],
  ["Criminology", "INT", 1], ["Cryptography", "INT", 1], ["Deduction", "INT", 1], ["Education", "INT", 1], ["Gamble", "INT", 1],
  ["Language (Streetslang)", "INT", 1], ["Language (other)", "INT", 1], ["Library Search", "INT", 1], ["Local Expert (Your Home)", "INT", 1],
  ["Local Expert (other)", "INT", 1], ["Science (choose)", "INT", 1], ["Tactics", "INT", 1], ["Wilderness Survival", "INT", 1],
  ["Brawling", "DEX", 1], ["Evasion", "DEX", 1], ["Martial Arts (choose form)", "DEX", 2], ["Melee Weapon", "DEX", 1],
  ["Acting", "COOL", 1], ["Play Instrument (choose)", "TECH", 1],
  ["Archery", "REF", 1], ["Autofire", "REF", 2], ["Handgun", "REF", 1], ["Heavy Weapons", "REF", 2], ["Shoulder Arms", "REF", 1],
  ["Bribery", "COOL", 1], ["Conversation", "EMP", 1], ["Human Perception", "EMP", 1], ["Interrogation", "COOL", 1], ["Persuasion", "COOL", 1],
  ["Personal Grooming", "COOL", 1], ["Streetwise", "COOL", 1], ["Trading", "COOL", 1], ["Wardrobe & Style", "COOL", 1],
  ["Air Vehicle Tech", "TECH", 1], ["Basic Tech", "TECH", 1], ["Cybertech", "TECH", 1], ["Demolitions", "TECH", 2],
  ["Electronics/Security Tech", "TECH", 2], ["First Aid", "TECH", 1], ["Forgery", "TECH", 1], ["Land Vehicle Tech", "TECH", 1],
  ["Paint/Draw/Sculpt", "TECH", 1], ["Paramedic", "TECH", 2], ["Photography/Film", "TECH", 1], ["Pick Lock", "TECH", 1],
  ["Pick Pocket", "TECH", 1], ["Sea Vehicle Tech", "TECH", 1], ["Weaponstech", "TECH", 1],
];
const SKILL_INFO = Object.fromEntries(MASTER_SKILLS.map(([n, s, c]) => [n, { stat: s, cost: c }]));
SKILL_INFO["Science (choose 1)"] = { stat: "INT", cost: 1 };
SKILL_INFO["Play Instrument (choose 1)"] = { stat: "TECH", cost: 1 };
const BASE_SKILL_COUNT = MASTER_SKILLS.length;
const BASE_SKILL_NAMES = new Set(Object.keys(SKILL_INFO));
function applyHomebrewSkills(list) {
  MASTER_SKILLS.length = BASE_SKILL_COUNT;
  for (const k of Object.keys(SKILL_INFO)) if (!BASE_SKILL_NAMES.has(k)) delete SKILL_INFO[k];
  for (const hs of list || []) {
    const name = String(hs.name || "").trim();
    if (!name || SKILL_INFO[name]) continue;
    const row = [name, String(hs.stat || "INT").toUpperCase(), hs.x2 ? 2 : 1];
    MASTER_SKILLS.push(row);
    SKILL_INFO[name] = { stat: row[1], cost: row[2], homebrew: true };
  }
}

// Streetrat skill levels; the first 13 are the Basic Skills in BASIC_SKILLS order.
const ROLE_SKILLS = {
  Rockerboy: [[2, 6, 2, 2, 2, 6, 6, 6, 2, 4, 2, 6, 2], [["Composition", 6], ["Handgun", 6], ["Melee Weapon", 6], ["Personal Grooming", 4], ["Play Instrument (choose 1)", 6], ["Streetwise", 6], ["Wardrobe & Style", 4]]],
  Solo: [[2, 2, 2, 2, 2, 6, 6, 2, 2, 2, 6, 2, 2], [["Autofire", 6], ["Handgun", 6], ["Interrogation", 6], ["Melee Weapon", 6], ["Resist Torture/Drugs", 6], ["Shoulder Arms", 6], ["Tactics", 6]]],
  Netrunner: [[2, 2, 2, 2, 6, 6, 2, 2, 2, 2, 2, 2, 6], [["Basic Tech", 6], ["Conceal/Reveal Object", 6], ["Cryptography", 6], ["Cybertech", 6], ["Electronics/Security Tech", 6], ["Handgun", 6], ["Library Search", 6]]],
  Tech: [[2, 2, 2, 2, 6, 6, 6, 2, 2, 2, 2, 2, 2], [["Basic Tech", 6], ["Cybertech", 6], ["Electronics/Security Tech", 6], ["Land Vehicle Tech", 6], ["Shoulder Arms", 6], ["Science (choose 1)", 6], ["Weaponstech", 6]]],
  Medtech: [[2, 2, 2, 6, 6, 6, 2, 6, 2, 2, 2, 2, 2], [["Basic Tech", 6], ["Cybertech", 4], ["Deduction", 6], ["Paramedic", 6], ["Resist Torture/Drugs", 4], ["Science (choose 1)", 6], ["Shoulder Arms", 6]]],
  Media: [[2, 2, 2, 6, 2, 6, 2, 6, 2, 6, 6, 6, 2], [["Bribery", 6], ["Composition", 6], ["Deduction", 6], ["Handgun", 6], ["Library Search", 4], ["Lip Reading", 4], ["Photography/Film", 4]]],
  Lawman: [[2, 6, 2, 6, 2, 6, 2, 2, 2, 2, 2, 2, 2], [["Autofire", 6], ["Criminology", 6], ["Deduction", 6], ["Handgun", 6], ["Interrogation", 6], ["Shoulder Arms", 6], ["Tracking", 6]]],
  Exec: [[2, 2, 2, 6, 6, 6, 2, 6, 2, 2, 2, 6, 2], [["Accounting", 6], ["Bureaucracy", 6], ["Business", 6], ["Deduction", 6], ["Handgun", 6], ["Lip Reading", 6], ["Personal Grooming", 4]]],
  Fixer: [[2, 2, 2, 6, 2, 6, 2, 6, 4, 6, 2, 4, 2], [["Bribery", 6], ["Business", 6], ["Forgery", 6], ["Handgun", 6], ["Pick Lock", 4], ["Streetwise", 6], ["Trading", 6]]],
  Nomad: [[2, 6, 2, 2, 2, 6, 6, 2, 2, 2, 4, 2, 6], [["Animal Handling", 6], ["Drive Land Vehicle", 6], ["Handgun", 6], ["Melee Weapon", 6], ["Tracking", 6], ["Trading", 6], ["Wilderness Survival", 6]]],
};

// Streetrat STAT templates: 10 rows of INT REF DEX TECH COOL WILL LUCK MOVE BODY EMP
const ROLE_STATS = {
  Rockerboy: ["7 6 6 5 6 8 7 7 3 8", "3 7 7 7 7 6 7 7 5 8", "4 5 7 7 6 6 7 7 5 8", "4 5 7 7 6 8 7 6 3 8", "3 7 7 7 6 8 6 5 4 7", "5 6 7 5 7 8 5 7 3 7", "5 6 6 7 7 8 7 6 3 6", "5 7 7 5 6 6 6 6 4 8", "3 5 5 6 7 8 7 5 5 7", "4 5 6 5 8 8 7 6 4 7"],
  Solo: ["6 7 7 3 8 6 5 5 6 5", "7 8 6 3 6 6 7 5 6 6", "5 8 7 4 7 7 6 7 8 5", "5 8 6 4 6 7 6 5 7 6", "6 6 7 5 7 6 7 6 8 4", "7 7 6 5 7 6 6 7 7 5", "7 7 6 5 6 7 7 6 6 6", "7 8 7 5 6 6 5 6 8 4", "7 7 6 4 6 6 6 5 6 5", "6 6 8 5 6 6 5 6 6 5"],
  Netrunner: ["5 8 7 7 7 4 8 7 7 4", "5 6 7 5 8 3 8 7 5 5", "5 6 8 6 6 4 7 6 7 4", "5 7 7 7 7 5 8 6 5 5", "5 8 8 5 7 3 7 5 5 6", "6 6 6 7 8 4 7 7 6 6", "6 6 6 7 6 5 7 7 7 6", "5 7 8 6 8 4 8 5 7 4", "7 6 7 7 6 3 6 5 6 5", "7 8 6 6 6 4 7 7 5 6"],
  Tech: ["6 7 7 8 4 4 5 5 7 6", "7 6 6 7 5 3 7 7 5 5", "8 6 5 7 5 4 7 7 5 7", "7 8 7 8 4 4 6 5 6 7", "6 6 7 6 4 3 7 7 6 6", "8 7 5 6 3 3 7 6 6 7", "8 6 7 8 4 4 7 6 7 6", "8 8 7 8 5 4 6 5 6 6", "6 6 7 8 3 3 5 7 7 7", "8 8 5 6 4 4 6 5 6 6"],
  Medtech: ["7 5 6 7 5 3 8 5 5 7", "6 7 7 7 4 4 6 7 7 7", "6 5 5 8 5 3 8 5 7 8", "8 7 6 8 3 5 6 6 5 7", "6 7 5 7 5 5 8 7 6 8", "8 5 5 8 5 5 6 6 5 6", "8 6 5 8 5 4 8 5 7 7", "6 5 7 7 3 5 8 5 5 8", "6 6 7 7 5 4 6 6 5 6", "8 7 6 6 3 4 8 7 6 7"],
  Media: ["6 6 5 5 8 7 5 7 5 7", "8 7 7 3 6 6 6 5 6 8", "6 7 7 5 6 8 5 5 5 7", "6 5 7 5 6 7 5 5 6 6", "6 6 7 4 8 7 6 7 5 8", "7 5 5 4 8 7 6 7 5 8", "8 5 6 3 7 6 6 5 6 7", "6 5 6 5 6 8 6 6 7 8", "7 7 5 4 6 7 6 5 6 7", "7 6 6 3 7 6 7 6 7 6"],
  Lawman: ["5 6 7 5 7 8 5 6 5 6", "6 6 6 5 6 8 5 7 5 5", "5 7 7 7 6 7 5 5 7 6", "6 6 7 6 6 8 5 7 7 6", "6 6 7 6 7 7 6 5 5 6", "7 6 5 5 7 8 5 6 7 4", "7 8 7 5 6 8 7 6 5 4", "5 6 6 5 6 8 5 7 6 4", "7 7 5 5 7 7 6 5 5 6", "6 6 5 6 8 7 5 7 6 6"],
  Exec: ["8 5 5 3 8 6 6 5 5 7", "8 6 6 4 7 6 7 7 5 7", "8 7 6 3 8 6 7 6 4 5", "8 5 7 5 6 5 6 5 5 7", "7 7 6 5 8 5 7 7 5 6", "5 7 7 3 6 7 6 5 5 7", "6 6 7 5 8 7 6 7 4 6", "6 7 7 3 7 5 7 5 5 7", "7 6 7 5 7 5 7 6 5 5", "7 7 5 5 8 6 6 7 4 7"],
  Fixer: ["8 5 7 4 6 5 8 5 5 8", "8 5 5 5 6 7 8 7 5 7", "6 6 6 4 5 6 8 6 3 8", "7 7 5 5 7 6 7 7 5 8", "8 6 6 3 6 5 8 7 5 6", "8 7 5 5 6 7 7 5 3 6", "8 6 6 5 6 5 6 7 5 8", "6 6 7 4 7 6 7 7 4 7", "8 7 7 5 5 5 7 6 5 7", "6 5 6 5 5 6 8 6 4 7"],
  Nomad: ["6 6 8 3 6 7 6 6 6 4", "5 7 6 5 8 8 8 7 5 4", "5 8 6 3 8 7 6 5 6 5", "5 8 7 4 8 6 7 7 7 5", "6 6 6 3 6 7 6 7 7 4", "7 6 8 4 6 7 6 5 6 5", "6 7 8 4 6 6 7 5 7 5", "5 7 8 3 8 6 7 5 5 5", "6 7 6 4 8 6 6 6 6 6", "5 6 7 4 7 8 7 7 7 4"],
};

const ROLE_ABILITY = {
  Rockerboy: ["Charismatic Impact", "Sway your fans - the higher your Rank, the more fans and the bigger the favours they'll do for you. Core p.145."],
  Solo: ["Combat Awareness", "Split your Rank (4 points) between combat perks such as Initiative, Precision Attack, Spot Weakness, Threat Detection, Damage Deflection and Fumble Recovery. Core p.147."],
  Netrunner: ["Interface", "Your Rank is added to every Interface Ability (Backdoor, Cloak, Control, Eye-Dee, Pathfinder, Scanner, Slide, Virus, Zap) and sets your NET Actions per turn. Core p.148."],
  Tech: ["Maker", "Split your Rank between Field Expertise, Upgrade Expertise, Fabrication Expertise and Invention Expertise. Core p.148."],
  Medtech: ["Medicine", "Gives you the Surgery Skill and specialties like Pharmaceuticals and Cryosystem Operation. Core p.150."],
  Media: ["Credibility", "Your stories are believed and reach a bigger audience; you passively pick up rumours. Core p.152."],
  Exec: ["Teamwork", "You run a small corporate team and get corp perks like housing and health cover. Core p.154."],
  Lawman: ["Backup", "Call your agency for backup - the higher your Rank, the bigger and better armed it is. Core p.159."],
  Fixer: ["Operator", "Contacts across the city, haggling, and access to Night Markets. Core p.160."],
  Nomad: ["Moto", "Access to your family's vehicles and upgrades; Rank sets what you can borrow. Core p.162."],
};

// Weapon stats used when building the sheet: dmg, magazine, rof, skill
const WEAPON_STATS = {
  "Medium Pistol": ["2d6", 12, 2, "Handgun"], "Heavy Pistol": ["3d6", 8, 2, "Handgun"], "Very Heavy Pistol": ["4d6", 8, 1, "Handgun"],
  "SMG": ["2d6", 30, 1, "Handgun"], "Heavy SMG": ["3d6", 40, 1, "Handgun"], "Shotgun": ["5d6", 4, 1, "Shoulder Arms"],
  "Assault Rifle": ["5d6", 25, 1, "Shoulder Arms"], "Sniper Rifle": ["5d6", 4, 1, "Shoulder Arms"], "Bow & Crossbow": ["4d6", 0, 1, "Archery"],
  "Grenade Launcher": ["6d6", 2, 1, "Heavy Weapons"], "Rocket Launcher": ["8d6", 1, 1, "Heavy Weapons"],
  "Light Melee Weapon": ["1d6", 0, 2, "Melee Weapon"], "Medium Melee Weapon": ["2d6", 0, 2, "Melee Weapon"],
  "Heavy Melee Weapon": ["3d6", 0, 2, "Melee Weapon"], "Very Heavy Melee Weapon": ["4d6", 0, 1, "Melee Weapon"],
  "Wolvers": ["3d6", 0, 2, "Melee Weapon"], "Rippers": ["2d6", 0, 2, "Melee Weapon"], "Big Knucks": ["2d6", 0, 2, "Melee Weapon"],
  "Scratchers": ["1d6", 0, 2, "Melee Weapon"], "Slice N Dice": ["2d6", 0, 2, "Melee Weapon"], "Cybersnake": ["4d6", 0, 1, "Melee Weapon"],
  "Vampyres": ["1d6", 0, 2, "Melee Weapon"],
};

// Starting packages (Streetrat & Edgerunner). Entry = item or {or:[...]} ; item = {w|ammo|gear|prog, ...}
const W = (name) => ({ w: name });
const A = (forW, n, label) => ({ ammo: forW, n, label });
const G = (name, qty = 1, notes = "") => ({ gear: name, qty, notes });
const P = (name) => ({ gear: name, qty: 1, notes: "Program" });
const ROLE_WEAPONS = {
  Rockerboy: [W("Very Heavy Pistol"), A("Very Heavy Pistol", 50, "Basic VH Pistol Ammo"), { or: [W("Heavy Melee Weapon"), G("Flashbang Grenade")] }, G("Teargas Grenade", 2)],
  Solo: [W("Assault Rifle"), W("Very Heavy Pistol"), { or: [W("Heavy Melee Weapon"), G("Bulletproof Shield", 1, "10 HP")] }, A("Very Heavy Pistol", 30, "Basic VH Pistol Ammo"), A("Assault Rifle", 70, "Basic Rifle Ammo")],
  Netrunner: [W("Very Heavy Pistol"), A("Very Heavy Pistol", 30, "Basic VH Pistol Ammo")],
  Tech: [{ or: [[W("Shotgun"), A("Shotgun", 100, "Basic Shotgun Shells")], [W("Assault Rifle"), A("Assault Rifle", 100, "Basic Rifle Ammo")]] }, G("Flashbang Grenade")],
  Medtech: [{ or: [[W("Shotgun"), A("Shotgun", 100, "Basic Shotgun Shells"), G("Incendiary Shotgun Shells", 10)], [W("Assault Rifle"), A("Assault Rifle", 100, "Basic Rifle Ammo"), G("Incendiary Rifle Ammo", 10)]] }, G("Smoke Grenade", 2), G("Bulletproof Shield", 1, "10 HP")],
  Media: [{ or: [[W("Heavy Pistol"), A("Heavy Pistol", 50, "Basic H Pistol Ammo")], [W("Very Heavy Pistol"), A("Very Heavy Pistol", 50, "Basic VH Pistol Ammo")]] }],
  Lawman: [{ or: [[W("Assault Rifle"), A("Assault Rifle", 100, "Basic Rifle Ammo")], [W("Shotgun"), A("Shotgun", 100, "Basic Shotgun Shells")], [W("Shotgun"), A("Shotgun", 100, "Basic Slug Ammo")]] }, W("Heavy Pistol"), A("Heavy Pistol", 30, "Basic H Pistol Ammo"), { or: [G("Bulletproof Shield", 1, "10 HP"), G("Smoke Grenade", 2)] }],
  Exec: [W("Very Heavy Pistol"), A("Very Heavy Pistol", 50, "Basic VH Pistol Ammo")],
  Fixer: [{ or: [W("Heavy Pistol"), W("Very Heavy Pistol")] }, { or: [W("Heavy Pistol"), W("Very Heavy Pistol")] }, W("Light Melee Weapon"), { or: [A("Heavy Pistol", 100, "Basic H Pistol Ammo"), A("Very Heavy Pistol", 100, "Basic VH Pistol Ammo")] }],
  Nomad: [{ or: [[W("Heavy Pistol"), A("Heavy Pistol", 100, "Basic H Pistol Ammo")], [W("Very Heavy Pistol"), A("Very Heavy Pistol", 100, "Basic VH Pistol Ammo")]] }, { or: [W("Heavy Melee Weapon"), W("Heavy Pistol")] }],
};
const ROLE_OUTFIT = {
  Rockerboy: [[G("Agent"), G("Computer"), { or: [G("Electric Guitar or other Instrument"), G("Bug Detector")] }, G("Glow Paint", 5), G("Pocket Amplifier"), G("Radio Scanner & Music Player"), G("Video Camera")], "Generic Chic: Jacket, Jewelry x3, Top x4 · Leisurewear: Jewelry, Mirrorshades, Footwear · Urbanflash: Bottoms, Top"],
  Solo: [[G("Agent")], "Leisurewear: Footwear x2, Jacket x3, Mirrorshades, Bottoms x2, Top x2"],
  Netrunner: [[G("Agent"), G("Cyberdeck (Standard Quality)"), G("Virtuality Goggles"), P("Armor (Program)"), P("Sword"), { or: [P("See Ya"), P("Eraser")] }, { or: [P("Sword"), P("Vrizzbolt")] }, { or: [P("Worm"), P("Sword")] }], "Generic Chic: Top x10 · Leisurewear: Footwear x2, Jewelry, Bottoms x2 · Urban Flash: Jacket"],
  Tech: [[G("Agent"), G("Anti-Smog Breathing Mask"), G("Disposable Cell Phone"), G("Duct Tape", 5), G("Flashlight"), G("Road Flare", 6), G("Tech Bag")], "Generic Chic: Bottoms x8, Tops x10 · Leisurewear: Footwear x2"],
  Medtech: [[G("Agent"), G("Airhypo"), G("Handcuffs"), G("Flashlight"), G("Glow Paint"), G("Medtech Bag")], "Generic Chic: Jacket x3 · Leisurewear: Footwear, Bottoms x3, Top x5"],
  Media: [[G("Agent"), G("Audio Recorder"), G("Binoculars"), { or: [G("Disposable Cell Phone", 2), G("Grapple Gun")] }, G("Flashlight"), G("Computer"), G("Radio Scanner & Music Player"), G("Scrambler & Descrambler"), G("Video Camera")], "Generic Chic: Footwear, Bottoms, Top · Leisurewear: Jacket · Urbanflash: Mirrorshades"],
  Lawman: [[G("Agent"), G("Flashlight"), G("Handcuffs", 2), G("Radio Communicator"), G("Road Flare", 10)], "Generic Chic: Jacket, Bottoms x2, Top x3 · Leisurewear: Footwear x2, Jacket x2, Bottoms x2, Mirrorshades, Top x2"],
  Exec: [[G("Radio Communicator", 4), G("Scrambler & Descrambler")], "Businesswear: Footwear, Jacket, Bottoms, Mirrorshades, Top, Jewelry x2"],
  Fixer: [[G("Agent"), G("Bug Detector"), G("Computer"), G("Disposable Cell Phone", 2)], "Generic Chic: Contacts, Jewelry · Leisurewear: Mirrorshades · Urbanflash: Footwear, Jacket, Bottoms, Top"],
  Nomad: [[G("Agent"), G("Anti-Smog Breathing Mask"), G("Duct Tape"), G("Flashlight"), G("Grapple Gun"), G("Inflatable Bed & Sleep-bag"), G("Medtech Bag"), G("Radio Communicator", 2), G("Rope (60m)"), G("Techtool"), G("Tent & Camping Equipment")], "Bohemian: Jewelry · Nomad Leathers: Top x4, Bottom x2, Footwear x2, Jacket, Hat"],
};
// cyberware list (vault note names) + fixed Humanity Loss total
const C = (name) => ({ cw: name });
const ROLE_CYBER = {
  Rockerboy: [[C("Audio Recorder (Cyberaudio)"), C("Chemskin"), C("Cyberaudio Suite"), C("Techhair")], 9],
  Solo: [[C("Biomonitor"), C("Neural Link"), { or: [C("Sandevistan"), C("Wolvers")] }], 14],
  Netrunner: [[C("Interface Plugs"), C("Neural Link"), C("Shift Tacts")], 14],
  Tech: [[C("Cybereye"), C("MicroOptics"), C("Skinwatch"), C("Tool Hand")], 12],
  Medtech: [[C("Biomonitor"), C("Cybereye"), { or: [C("Nasal Filters"), C("Toxin Binders")] }, C("TeleOptics")], 12],
  Media: [[{ or: [C("Amplified Hearing"), C("Voice Stress Analyzer")] }, C("Cyberaudio Suite"), C("Light Tattoo")], 10],
  Lawman: [[C("Hidden Holster"), C("Subdermal Pocket")], 10],
  Exec: [[{ or: [C("Biomonitor"), C("Techhair")] }, C("Cyberaudio Suite"), C("Internal Agent"), { or: [C("Toxin Binders"), C("Nasal Filters")] }], 12],
  Fixer: [[C("Cyberaudio Suite"), C("Internal Agent"), C("Subdermal Pocket"), { or: [C("Voice Stress Analyzer"), C("Amplified Hearing")] }], 16],
  Nomad: [[{ or: [C("Interface Plugs"), C("Wolvers")] }, C("Neural Link")], 14],
};

// Lifepath (general) tables
const LP_CULTURE = [
  ["North American", "Chinese, Cree, Creole, English, French, Navajo, Spanish"],
  ["South/Central American", "Creole, English, German, Guarani, Mayan, Portuguese, Quechua, Spanish"],
  ["Western European", "Dutch, English, French, German, Italian, Norwegian, Portuguese, Spanish"],
  ["Eastern European", "English, Finnish, Polish, Romanian, Russian, Ukrainian"],
  ["Middle Eastern/North African", "Arabic, Berber, English, Farsi, French, Hebrew, Turkish"],
  ["Sub-Saharan African", "Arabic, English, French, Hausa, Lingala, Oromo, Portuguese, Swahili, Twi, Yoruba"],
  ["South Asian", "Bengali, Dari, English, Hindi, Nepali, Sinhalese, Tamil, Urdu"],
  ["South East Asian", "Arabic, Burmese, English, Filipino, Hindi, Indonesian, Khmer, Malayan, Vietnamese"],
  ["East Asian", "Cantonese Chinese, English, Japanese, Korean, Mandarin Chinese, Mongolian"],
  ["Oceania/Pacific Islander", "English, French, Hawaiian, Maori, Pama-Nyungan, Tahitian"],
];
const LP_TABLES = {
 "personality": [
  "Personality",
  [
   "Shy and secretive",
   "Rebellious, antisocial, and violent",
   "Arrogant, proud, and aloof",
   "Moody, rash, and headstrong",
   "Picky, fussy, and nervous",
   "Stable and serious",
   "Silly and fluff-headed",
   "Sneaky and deceptive",
   "Intellectual and detached",
   "Friendly and outgoing"
  ]
 ],
 "clothing_style": [
  "Clothing Style",
  [
   "Generic Chic (Standard, Colorful, Modular)",
   "Leisurewear (Comfort, Agility, Athleticism)",
   "Urban Flash (Flashy, Technological, Streetwear)",
   "Businesswear (Leadership, Presence, Authority)",
   "High Fashion (Exclusive, Designer, Couture)",
   "Bohemian (Folksy, Retro, Free-spirited)",
   "Bag Lady Chic (Homeless, Ragged, Vagrant)",
   "Gang Colors (Dangerous, Violent, Rebellious)",
   "Nomad Leathers (Western, Rugged, Tribal)",
   "Asia Pop (Bright, Costume-like, Youthful)"
  ]
 ],
 "hairstyle": [
  "Hairstyle",
  [
   "Mohawk",
   "Long and ratty",
   "Short and spiked",
   "Wild and all over",
   "Bald",
   "Striped",
   "Wild colors",
   "Neat and short",
   "Short and curly",
   "Long and straight"
  ]
 ],
 "affectation": [
  "Affectation",
  [
   "Tattoos",
   "Mirrorshades",
   "Ritual scars",
   "Spiked gloves",
   "Nose rings",
   "Tongue or other piercings",
   "Strange fingernail implants",
   "Spiked boots or heels",
   "Fingerless gloves",
   "Strange contacts"
  ]
 ],
 "value_most": [
  "What Do You Value Most?",
  [
   "Money",
   "Honor",
   "Your word",
   "Honesty",
   "Knowledge",
   "Vengeance",
   "Love",
   "Power",
   "Family",
   "Friendship"
  ]
 ],
 "feelings_about_people": [
  "Feelings About People",
  [
   "I stay neutral.",
   "I stay neutral.",
   "I like almost everyone.",
   "I hate almost everyone.",
   "People are tools. Use them for your own goals then discard them.",
   "Every person is a valuable individual.",
   "People are obstacles to be destroyed if they cross me.",
   "People are untrustworthy. Don't depend on anyone.",
   "Wipe ‘em all out and let the cockroaches take over.",
   "People are wonderful!"
  ]
 ],
 "most_valued_person": [
  "Most Valued Person",
  [
   "A parent",
   "A brother or sister",
   "A lover",
   "A friend",
   "Yourself",
   "A pet",
   "A teacher or mentor",
   "A public figure",
   "A personal hero",
   "No one"
  ]
 ],
 "most_valued_possession": [
  "Most Valued Possession",
  [
   "A weapon",
   "A tool",
   "A piece of clothing",
   "A photograph",
   "A book or diary",
   "A recording",
   "A musical instrument",
   "A piece of jewelry",
   "A toy",
   "A letter"
  ]
 ],
 "family_background": [
  "Family Background",
  [
   "Corporate Execs - Wealthy, powerful, with servants, luxury homes, and the best of everything. Private security made sure you were always safe. You definitely went to a big-name private school.",
   "Corporate Managers - Well to do, with large homes, safe neighborhoods, nice cars, etc. Sometimes your parent(s) would hire servants, although this was rare. You had a mix of private and corporate education.",
   "Corporate Technicians - Middle-middle class, with comfortable conapts or Beaverville suburban homes, minivans and corporate-run technical schools. Kind of like living 1950s America crossed with 1984.",
   "Nomad Pack - You had a mix of rugged trailers, vehicles, and huge road kombis for your home. You learned to drive and fight at an early age, but the family was always there to care for you. Food was actually fresh and abundant. Mostly home schooled.",
   "Ganger \"Family\" - A savage, violent home in any place the gang could take over. You were usually hungry, cold, and scared. You probably didn't know who your actual parents were. Education? The Gang taught you how to fight, kill, and steal—what else did you need to know?",
   "Combat Zoners - A step up from a gang \"family,\" your home was a decaying building somewhere in the ‘Zone', heavily fortified. You were hungry at times, but regularly could score a bed and a meal. Home schooled.",
   "Urban Homeless - You lived in cars, dumpsters, or abandoned shipping modules. If you were lucky. You were usually hungry, cold, and scared, unless you were tough enough to fight for the scraps. Education? School of Hard Knocks.",
   "Megastructure Warren Rats - You grew up in one of the huge new megastructures that went up after the War. A tiny conapt, kibble and scop for food, a mostly warm bed. Some better educated adult warren dwellers or a local Corporation may have set up a school.",
   "Reclaimers - You started out on the road, but then moved into one of the deserted ghost towns or cities to rebuild it. A pioneer life: dangerous, but with plenty of simple food and a safe place to sleep. You were home schooled if there was anyone who had the time.",
   "Edgerunners - Your home was always changing based on your parents' current \"job.\" Could be a luxury apartment, an urban conapt, or a dumpster if you were on the run. Food and shelter ran the gamut from gourmet to kibble."
  ]
 ],
 "childhood_environment": [
  "Childhood Environment",
  [
   "Ran on The Street, with no adult supervision.",
   "Spent in a safe Corp Zone walled off from the rest of the City.",
   "In a Nomad pack moving from place to place.",
   "In a Nomad pack with roots in transport (ships, planes, caravans).",
   "In a decaying, once upscale neighborhood, now holding off the boosters to survive.",
   "In the heart of the Combat Zone, living in a wrecked building or other squat.",
   "In a huge \"megastructure\" building controlled by a Corp or the City.",
   "In the ruins of a deserted town or city taken over by Reclaimers.",
   "In a Drift Nation (a floating offshore city) that is a meeting place for all kinds of people.",
   "In a Corporate luxury \"starscraper,\" high above the rest of the teeming rabble."
  ]
 ],
 "family_crisis": [
  "Family Crisis",
  [
   "Your family lost everything through betrayal.",
   "Your family lost everything through bad management.",
   "Your family was exiled or otherwise driven from their original home/nation/Corporation.",
   "Your family is imprisoned, and you alone escaped.",
   "Your family vanished. You are the only remaining member.",
   "Your family was killed, and you were the only survivor.",
   "Your family is involved in a long-term conspiracy, organization, or association, such as a crime family or revolutionary group.",
   "Your family was scattered to the winds due to misfortune.",
   "Your family is cursed with a hereditary feud that has lasted for generations.",
   "You are the inheritor of a family debt; you must honor this debt before moving on with your life."
  ]
 ],
 "life_goals": [
  "Life Goals",
  [
   "Get rid of a bad reputation.",
   "Gain power and control.",
   "Get off The Street no matter what it takes.",
   "Cause pain and suffering to anyone who crosses you.",
   "Live down your past life and try to forget it.",
   "Hunt down those responsible for your miserable life and make them pay.",
   "Get what's rightfully yours.",
   "Save, if possible, anyone else involved in your background, like a lover, or family member.",
   "Gain fame and recognition.",
   "Become feared and respected."
  ]
 ]
};
const LP_FRIEND = ["Like an older sibling to you.", "Like a younger sibling to you.", "A teacher or mentor.", "A partner or coworker.", "A former lover.", "An old enemy.", "Like a parent to you.", "An old childhood friend.", "Someone you know from The Street.", "Someone with a common interest or goal."];
const LP_ENEMY_WHO = ["Ex-friend", "Ex-lover", "Estranged relative", "Childhood enemy", "Person working for you", "Person you work for", "Partner or coworker", "Corporate exec", "Government official", "Boosterganger"];
const LP_ENEMY_CAUSE = ["Caused the other to lose face or status.", "Caused the loss of lover, friend, or relative.", "Caused a major public humiliation.", "Accused the other of cowardice or some other major personal flaw.", "Deserted or betrayed the other.", "Turned down the other's offer of a job or romantic involvement.", "You just don't like each other.", "One of you was a romantic rival.", "One of you was a business rival.", "One of you set the other up for a crime they didn't commit."];
const LP_ENEMY_RES = ["Just themselves and even they won't go out of their way.", "Just themselves.", "Just themselves and a close friend.", "Themselves and a few (1d6/2) friends.", "Themselves and a few (1d10/2) friends.", "An entire gang (at least 1d10 + 5 people).", "The local cops or other Lawmen.", "A powerful gang lord or small Corporation.", "A powerful Corporation.", "An entire city or government or agency."];
const LP_ENEMY_DO = ["Avoid the scum.", "Avoid the scum.", "Go into a murderous rage and try to physically rip their face off.", "Go into a murderous rage and try to physically rip their face off.", "Backstab them indirectly.", "Backstab them indirectly.", "Verbally attack them.", "Verbally attack them.", "Set them up for a crime or other transgression they didn't commit.", "Set out to murder or maim them."];
const LP_LOVE = ["Your lover died in an accident.", "Your lover mysteriously vanished.", "It just didn't work out.", "A personal goal or vendetta came between you and your lover.", "Your lover was kidnapped.", "Your lover went insane or cyberpsycho.", "Your lover committed suicide.", "Your lover was killed in a fight.", "A rival cut you out of the action.", "Your lover is imprisoned or exiled."];


/* ================= Upgrade (spend Improvement Points) ================= */
// Core Rulebook p.411: next Level costs Level x 20 IP (x40 for (x2) skills), next Rank costs Rank x 60. No skipping, max 10.
const IP_MAX = 10;
function skillMult(name) {
  const n = String(name || "");
  if (SKILL_INFO[n]) return SKILL_INFO[n].cost || 1;
  const base = n.replace(/\s*\(.*\)\s*$/, "").trim().toLowerCase();
  const hit = MASTER_SKILLS.find(([m]) => m.toLowerCase() === base || m.toLowerCase().startsWith(base + " ("));
  return hit ? hit[2] : 1;
}
function skillStat(name) {
  const n = String(name || "");
  if (SKILL_INFO[n]) return SKILL_INFO[n].stat;
  const base = n.replace(/\s*\(.*\)\s*$/, "").trim().toLowerCase();
  const hit = MASTER_SKILLS.find(([m]) => m.toLowerCase() === base || m.toLowerCase().startsWith(base + " ("));
  return hit ? hit[1] : "INT";
}
const skillStepCost = (name, nextLvl) => nextLvl * 20 * skillMult(name);
const rankStepCost = (nextRank) => nextRank * 60;

class UpgradeModal extends Modal {
  constructor(app, plugin, file) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.fm = JSON.parse(JSON.stringify(app.metadataCache.getFileCache(file)?.frontmatter || {}));
    this.newSkill = "";
    this.newSpec = "";
  }
  onOpen() {
    this.modalEl.addClass("cpr-modal", "cpr-upgrade");
    this.titleEl.setText(`Upgrade — ${this.fm.handle || this.file.basename}`);
    this.draw();
  }
  async apply(mutator, logText) {
    let snap = null;
    await this.app.fileManager.processFrontMatter(this.file, (f) => {
      mutator(f);
      if (logText) {
        const hist = Array.isArray(f.ip_history) ? f.ip_history : [];
        hist.unshift(`${window.moment ? window.moment().format("YYYY-MM-DD") : new Date().toISOString().slice(0, 10)}: ${logText}`);
        f.ip_history = hist.slice(0, 50);
      }
      snap = JSON.parse(JSON.stringify(f));
    });
    this.fm = snap;
    this.app.workspace.trigger("cpr-sheet:refresh", this.file.path, snap);
    if (logText) this.plugin.pushLog(this.file.path, logText, "ok");
    this.draw();
  }
  draw() {
    const c = this.contentEl;
    c.empty();
    const fm = this.fm;
    const ip = num(fm.ip);

    // ---- IP bank
    const bank = el(c, "div", "cpr-up-bank");
    el(bank, "span", "cpr-label", "Improvement Points");
    el(bank, "span", "cpr-up-ip", ip);
    const award = bank.createEl("input", { type: "number", cls: "cpr-num-input", attr: { placeholder: "+IP" } });
    const awardBtn = el(bank, "button", "cpr-btn cpr-btn-red", "+ Award IP");
    awardBtn.onclick = () => {
      const n = Math.round(Number(award.value));
      if (!Number.isFinite(n) || n === 0) return;
      this.apply((f) => { f.ip = Math.max(0, num(f.ip) + n); }, `${n > 0 ? "+" : ""}${n} IP awarded (now ${Math.max(0, ip + n)})`);
    };
    el(c, "div", "cpr-wz-note", "Next Level costs Level × 20 IP (× 40 for (x2) skills). Next Rank costs Rank × 60 IP. One step at a time, max 10 — Core p.411.");

    // ---- Role Rank
    const rank = num(fm.rank, 4);
    const rr = el(c, "div", "cpr-up-rank");
    el(rr, "span", "cpr-label", `${fm.role || "Role"} Ability Rank`);
    el(rr, "span", "cpr-value", rank);
    if (rank < IP_MAX) {
      const cost = rankStepCost(rank + 1);
      const b = el(rr, "button", "cpr-btn" + (ip >= cost ? " cpr-btn-red" : ""), `Rank ${rank + 1} · ${cost} IP`);
      b.disabled = ip < cost;
      b.onclick = () => this.apply((f) => {
        const cur = num(f.rank, 4);
        if (num(f.ip) < rankStepCost(cur + 1)) return;
        f.ip = num(f.ip) - rankStepCost(cur + 1);
        f.rank = cur + 1;
        if (Array.isArray(f.role_ability) && f.role_ability[0] && /\(Rank \d+\)/.test(f.role_ability[0].name || "")) {
          f.role_ability[0].name = f.role_ability[0].name.replace(/\(Rank \d+\)/, `(Rank ${cur + 1})`);
        }
      }, `${fm.role || "Role"} Rank ${rank} → ${rank + 1} (−${cost} IP)`);
    } else el(rr, "span", "cpr-sub", "maxed");

    // ---- Skills
    const skills = arr(fm.skills);
    const t = el(c, "table", "cpr-table cpr-up-skills");
    const hr = el(t, "tr");
    for (const h of ["Skill", "STAT", "LVL", "Total", "Next level"]) el(hr, "th", null, h);
    skills.forEach((sk, i) => {
      const lvl = num(sk.lvl);
      const tr = el(t, "tr");
      const mult = skillMult(sk.name);
      el(tr, "td", "cpr-skill-name", sk.name + (mult > 1 ? " (x2)" : ""));
      el(tr, "td", "cpr-num", String(sk.stat || "").toUpperCase());
      el(tr, "td", "cpr-num", lvl);
      el(tr, "td", "cpr-num cpr-total", skillTotal(fm, sk));
      const td = el(tr, "td", "cpr-act");
      if (lvl >= IP_MAX) { el(td, "span", "cpr-sub", "maxed"); return; }
      const cost = skillStepCost(sk.name, lvl + 1);
      const b = el(td, "button", "cpr-mini" + (ip >= cost ? " cpr-mini-red" : ""), `→ ${lvl + 1} · ${cost} IP`);
      b.disabled = ip < cost;
      b.onclick = () => this.apply((f) => {
        const s2 = arr(f.skills)[i];
        if (!s2) return;
        const c2 = skillStepCost(s2.name, num(s2.lvl) + 1);
        if (num(f.ip) < c2) return;
        f.ip = num(f.ip) - c2;
        s2.lvl = num(s2.lvl) + 1;
      }, `${sk.name} ${lvl} → ${lvl + 1} (−${cost} IP)`);
    });

    // ---- Learn a new skill
    const have = new Set(skills.map((x) => String(x.name).toLowerCase()));
    const add = el(c, "div", "cpr-up-add");
    el(add, "span", "cpr-label", "Learn new skill (level 1)");
    const sel = add.createEl("select", { cls: "dropdown" });
    sel.createEl("option", { value: "", text: "— pick a skill —" });
    for (const [n, st, m] of MASTER_SKILLS) {
      const open = /\((other|choose[^)]*)\)/.test(n);
      if (!open && have.has(n.toLowerCase())) continue;
      sel.createEl("option", { value: n, text: `${n} · ${st}${m > 1 ? " · x2" : ""} · ${20 * m} IP` });
    }
    sel.value = this.newSkill;
    const spec = add.createEl("input", { type: "text", attr: { placeholder: "which one? (e.g. Japanese, Karate, Chemistry)" } });
    spec.value = this.newSpec;
    const needsSpec = () => /\((other|choose[^)]*)\)/.test(sel.value);
    spec.style.display = needsSpec() ? "" : "none";
    sel.addEventListener("change", () => { this.newSkill = sel.value; spec.style.display = needsSpec() ? "" : "none"; });
    spec.addEventListener("input", () => (this.newSpec = spec.value));
    const learn = el(add, "button", "cpr-btn cpr-btn-red", "Learn");
    learn.onclick = () => {
      const base = sel.value;
      if (!base) return;
      let name = base;
      if (needsSpec()) {
        const sp = spec.value.trim();
        if (!sp) { new Notice("Say which one (e.g. the language or martial art)."); return; }
        name = base.replace(/\((other|choose[^)]*)\)/, `(${sp})`);
      }
      if (have.has(name.toLowerCase())) { new Notice("You already have that skill — raise it in the table."); return; }
      const cost = 20 * skillMult(base);
      if (num(this.fm.ip) < cost) { new Notice(`Not enough IP (needs ${cost}).`); return; }
      this.newSkill = ""; this.newSpec = "";
      this.apply((f) => {
        if (num(f.ip) < cost) return;
        f.ip = num(f.ip) - cost;
        f.skills = [...arr(f.skills), { name, stat: skillStat(base), lvl: 1 }];
      }, `Learned ${name} 1 (−${cost} IP)`);
    };

    // ---- History
    const hist = arr(fm.ip_history);
    if (hist.length) {
      el(c, "div", "cpr-label cpr-up-histlabel", "History");
      const ul = el(c, "ul", "cpr-log");
      for (const h of hist.slice(0, 8)) el(ul, "li", null, h);
    }
  }
  onClose() { this.contentEl.empty(); }
}


/* ================= Homebrew: items, enemies, roles, skills ================= */
const HB_TIERS = [[10, "Cheap"], [20, "Everyday"], [50, "Costly"], [100, "Premium"], [500, "Expensive"], [1000, "Very Expensive"], [5000, "Luxury"], [Infinity, "Super Luxury"]];
const hbTier = (cost) => (HB_TIERS.find(([lim]) => cost <= lim) || [0, ""])[1];
const HB_CATS = {
  Weapon: "Zbraně", Armor: "Zbroj", Ammo: "Zbraně/Munice", Attachment: "Zbraně/Doplňky zbraní",
  Cyberware: "Cyberware", Gear: "Vybavení", Drug: "Drogy", Program: "Netrunning/Programy", Hardware: "Netrunning/Hardware",
};
const HB_WEAPON_KIND = { Ranged: "Střelné zbraně", Melee: "Chladné zbraně", Exotic: "Exotické zbraně" };
const HB_CYBER_TYPES = ["Fashionware", "Neuralware", "Chipware", "Cyberoptics", "Cyberaudio", "Internal Body", "External Body", "Cyberlimbs", "Borgware"];
const HB_HL = [["0", "0 (none)"], ["1d6/2 (2)", "1d6/2 (2)"], ["1d6 (3)", "1d6 (3)"], ["2d6 (7)", "2d6 (7)"], ["3d6 (10)", "3d6 (10)"], ["4d6 (14)", "4d6 (14)"]];
const HB_PROGRAM_CLASSES = ["Booster", "Defender", "Anti-Program Attacker", "Anti-Personnel Attacker", "Anti-Personnel Black ICE", "Anti-Program Black ICE"];
const HB_WEAPON_SKILLS = ["Handgun", "Shoulder Arms", "Heavy Weapons", "Archery", "Autofire", "Melee Weapon", "Brawling", "Martial Arts"];
const HB_THREATS = ["Mook", "Lieutenant", "Mini-Boss", "Boss"];
const HB_STAT_PRESETS = {
  Mook: [3, 6, 5, 2, 4, 4, 0, 4, 5, 3], Lieutenant: [5, 6, 6, 4, 6, 5, 0, 5, 6, 4],
  "Mini-Boss": [6, 8, 7, 5, 6, 6, 0, 6, 6, 5], Boss: [6, 8, 8, 5, 6, 7, 0, 7, 9, 3], NPC: [5, 4, 4, 4, 6, 5, 0, 5, 4, 6],
};
const HB_SKILL_BONUS = { Mook: 4, Lieutenant: 5, "Mini-Boss": 6, Boss: 7, NPC: 3 };
const yamlStr = (v) => JSON.stringify(v); // JSON strings are valid YAML scalars
function hbYaml(obj, indent = "") {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
    if (Array.isArray(v)) {
      out.push(`${indent}${k}:`);
      for (const it of v) {
        if (it && typeof it === "object") {
          const ent = Object.entries(it).filter(([, x]) => x !== undefined && x !== null && x !== "");
          ent.forEach(([kk, vv], j) => out.push(`${indent}${j === 0 ? "  - " : "    "}${kk}: ${typeof vv === "number" ? vv : yamlStr(String(vv))}`));
        } else out.push(`${indent}  - ${typeof it === "number" ? it : yamlStr(String(it))}`);
      }
    } else if (typeof v === "number" || typeof v === "boolean") out.push(`${indent}${k}: ${v}`);
    else out.push(`${indent}${k}: ${yamlStr(String(v))}`);
  }
  return out.join("\n");
}
async function hbEnsureFolder(app, path) {
  const parts = normalizePath(path).split("/");
  let cur = "";
  for (const part of parts) {
    cur = cur ? `${cur}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(cur)) await app.vault.createFolder(cur);
  }
}
async function hbCreateNote(app, folder, name, text) {
  const safe = String(name).replace(/[\\/:*?"<>|#^[\]]/g, "-").trim();
  if (!safe) { new Notice("Give it a name first."); return null; }
  await hbEnsureFolder(app, folder);
  const path = normalizePath(`${folder}/${safe}.md`);
  if (app.vault.getAbstractFileByPath(path)) { new Notice(`"${safe}" already exists in ${folder}.`); return null; }
  const file = await app.vault.create(path, text);
  await app.workspace.getLeaf(true).openFile(file);
  new Notice(`Created ${safe}`);
  return file;
}
function vaultItems(app, category) {
  const out = [];
  for (const f of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    if (fm && fm.category === category && fm.type !== "Rule") out.push({ name: f.basename, fm });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/* small form helpers shared by the homebrew modals */
class HbForm extends Modal {
  row(parent, label, hint) {
    const r = el(parent, "div", "cpr-hb-row");
    el(r, "span", "cpr-hb-label", label);
    const box = el(r, "div", "cpr-hb-field");
    if (hint) el(r, "span", "cpr-hb-hint", hint);
    return box;
  }
  input(parent, value, placeholder, type = "text", onInput) {
    const i = parent.createEl("input", { type, attr: { placeholder: placeholder || "" } });
    i.value = value ?? "";
    i.addEventListener("input", () => onInput(type === "number" ? (i.value === "" ? "" : Number(i.value)) : i.value));
    return i;
  }
  sel(parent, options, value, onChange) {
    const s = parent.createEl("select", { cls: "dropdown" });
    for (const o of options) {
      const [v, t] = Array.isArray(o) ? o : [o, o];
      s.createEl("option", { value: String(v), text: t });
    }
    s.value = String(value ?? "");
    s.addEventListener("change", () => onChange(s.value));
    return s;
  }
  area(parent, value, placeholder, onInput, rows = 3) {
    const t = parent.createEl("textarea", { attr: { placeholder: placeholder || "", rows } });
    t.value = value ?? "";
    t.addEventListener("input", () => onInput(t.value));
    return t;
  }
  section(parent, text) { el(parent, "div", "cpr-wz-h", text); }
  onClose() { this.contentEl.empty(); }
}

/* ---------------- Homebrew item ---------------- */
class HomebrewItemModal extends HbForm {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.d = {
      name: "", category: "Weapon", quality: "Standard", cost: 100, source: "", desc: "", effects: "",
      kind: "Ranged", type: "", damage: "3d6", rof: 2, magazine: 8, ammo_type: "", skill: "Handgun", hands: 1, concealable: true,
      sp: 11, penalty: "None", eligible: "", slots: 1,
      cyberType: "Neuralware", install: "Clinic", hl: "2d6 (7)",
      duration: "4 hours", dv: 15,
      pclass: "Booster", per: "", spd: "", atk: 0, def: 0, rez: 7,
    };
  }
  onOpen() {
    this.modalEl.addClass("cpr-modal", "cpr-hb");
    this.titleEl.setText("Create Homebrew Item Note");
    this.draw();
  }
  folder() {
    const d = this.d, root = this.plugin.settings.itemFolder || "4. Předměty";
    if (d.category === "Weapon") return `${root}/Zbraně/${HB_WEAPON_KIND[d.kind]}`;
    if (d.category === "Cyberware") return `${root}/Cyberware/${d.cyberType}`;
    if (d.category === "Program") return `${root}/Netrunning/${/Black ICE/.test(d.pclass) ? "Black ICE" : "Programy"}`;
    return `${root}/${HB_CATS[d.category]}`;
  }
  draw() {
    const c = this.contentEl, d = this.d;
    c.empty();
    el(c, "div", "cpr-wz-note", "Creates a real item note with the item card, tagged Homebrew, filed into the matching folder of your item library. It shows up in the character wizard's Night Market right away.");
    this.section(c, "Basics");
    this.input(this.row(c, "Name"), d.name, "e.g. Arasaka Shiden", "text", (v) => (d.name = v));
    this.sel(this.row(c, "Category"), Object.keys(HB_CATS), d.category, (v) => { d.category = v; this.draw(); });
    const cr = this.row(c, "Cost (eb)", "availability is set from the price");
    this.input(cr, d.cost, "500", "number", (v) => { d.cost = v; tier.setText(hbTier(Number(v) || 0)); });
    const tier = el(cr, "span", "cpr-sub", hbTier(Number(d.cost) || 0));
    this.input(this.row(c, "Source", "blank = Homebrew"), d.source, "e.g. our campaign, Black Chrome…", "text", (v) => (d.source = v));

    const cat = d.category;
    if (cat === "Weapon") {
      this.section(c, "Weapon");
      this.sel(this.row(c, "Kind"), Object.keys(HB_WEAPON_KIND), d.kind, (v) => { d.kind = v; this.draw(); });
      this.sel(this.row(c, "Quality", "Poor jams on a 1 · Excellent +1 to hit"), ["Poor", "Standard", "Excellent"], d.quality, (v) => (d.quality = v));
      this.input(this.row(c, "Type"), d.type, "e.g. Heavy Pistol, Heavy Melee Weapon", "text", (v) => (d.type = v));
      const r = this.row(c, "Damage · ROF");
      this.input(r, d.damage, "3d6", "text", (v) => (d.damage = v));
      this.input(r, d.rof, "2", "number", (v) => (d.rof = v));
      this.sel(this.row(c, "Skill"), [...HB_WEAPON_SKILLS, ...(this.plugin.settings.homebrewSkills || []).map((x) => x.name)], d.skill, (v) => (d.skill = v));
      if (d.kind !== "Melee") {
        const m = this.row(c, "Magazine · Ammo");
        this.input(m, d.magazine, "8", "number", (v) => (d.magazine = v));
        this.input(m, d.ammo_type, "e.g. H Pistol, Rifle, Slug", "text", (v) => (d.ammo_type = v));
      }
      const h = this.row(c, "Hands · Concealable");
      this.input(h, d.hands, "1", "number", (v) => (d.hands = v));
      const cb = h.createEl("input", { type: "checkbox" });
      cb.checked = !!d.concealable;
      cb.addEventListener("change", () => (d.concealable = cb.checked));
    } else if (cat === "Armor") {
      this.section(c, "Armor");
      this.input(this.row(c, "SP"), d.sp, "11", "number", (v) => (d.sp = v));
      this.input(this.row(c, "Penalty"), d.penalty, "None, or e.g. -2 REF, DEX, MOVE", "text", (v) => (d.penalty = v));
    } else if (cat === "Ammo" || cat === "Attachment") {
      this.section(c, cat);
      this.input(this.row(c, "Fits"), d.eligible, "e.g. All Non-Exotic Ranged Weapons", "text", (v) => (d.eligible = v));
      if (cat === "Attachment") this.input(this.row(c, "Slots"), d.slots, "1", "number", (v) => (d.slots = v));
    } else if (cat === "Cyberware") {
      this.section(c, "Cyberware");
      this.sel(this.row(c, "Type"), HB_CYBER_TYPES, d.cyberType, (v) => { d.cyberType = v; this.draw(); });
      this.sel(this.row(c, "Install"), ["Mall", "Clinic", "Hospital", "N/A"], d.install, (v) => (d.install = v));
      this.sel(this.row(c, "Humanity Loss"), HB_HL, d.hl, (v) => (d.hl = v));
    } else if (cat === "Drug") {
      this.section(c, "Drug");
      this.input(this.row(c, "Duration"), d.duration, "4 hours", "text", (v) => (d.duration = v));
      this.input(this.row(c, "Addiction DV"), d.dv, "15", "number", (v) => (d.dv = v));
    } else if (cat === "Program") {
      this.section(c, "Program");
      this.sel(this.row(c, "Class"), HB_PROGRAM_CLASSES, d.pclass, (v) => { d.pclass = v; this.draw(); });
      const r = this.row(c, /Black ICE/.test(d.pclass) ? "PER · SPD · ATK · DEF · REZ" : "ATK · DEF · REZ");
      if (/Black ICE/.test(d.pclass)) {
        this.input(r, d.per, "PER", "number", (v) => (d.per = v));
        this.input(r, d.spd, "SPD", "number", (v) => (d.spd = v));
      }
      this.input(r, d.atk, "ATK", "number", (v) => (d.atk = v));
      this.input(r, d.def, "DEF", "number", (v) => (d.def = v));
      this.input(r, d.rez, "REZ", "number", (v) => (d.rez = v));
    }
    this.section(c, "Rules & description");
    this.area(this.row(c, "Effects", "one per line, shown on the card"), d.effects, "+1 to Perception\nNeeds a Neural Link", (v) => (d.effects = v), 3);
    this.area(this.row(c, "Description"), d.desc, "What it looks like, who makes it, where to get it…", (v) => (d.desc = v), 3);
    const foot = el(c, "div", "cpr-edit-bar");
    el(foot, "span", "cpr-sub", `→ ${this.folder()}`);
    const go = el(foot, "button", "mod-cta", "Create item note");
    go.onclick = () => this.create();
  }
  async create() {
    const d = this.d, cost = Number(d.cost) || 0, cat = d.category;
    const fm = { cssclasses: ["cpr-item"], tags: ["Item", cat, "Homebrew"], category: cat, homebrew: true };
    if (cat === "Weapon") Object.assign(fm, { type: d.type || d.kind, quality: d.quality, damage: d.damage, rof: Number(d.rof) || 1, ...(d.kind !== "Melee" ? { magazine: Number(d.magazine) || undefined, ammo_type: d.ammo_type } : {}), skill: d.skill, hands: Number(d.hands) || 1, concealable: !!d.concealable });
    if (cat === "Armor") Object.assign(fm, { sp: Number(d.sp) || 0, penalty: d.penalty || "None" });
    if (cat === "Ammo") Object.assign(fm, { eligible: d.eligible });
    if (cat === "Attachment") Object.assign(fm, { eligible: d.eligible, slots: Number(d.slots) || 1 });
    if (cat === "Cyberware") Object.assign(fm, { type: d.cyberType, install: d.install, humanity_loss: d.hl });
    if (cat === "Drug") Object.assign(fm, { duration: d.duration, dv: Number(d.dv) || 15 });
    if (cat === "Program") Object.assign(fm, { type: d.pclass, ...(/Black ICE/.test(d.pclass) ? { per: Number(d.per) || 0, spd: Number(d.spd) || 0 } : {}), atk: Number(d.atk) || 0, def: Number(d.def) || 0, rez: Number(d.rez) || 0 });
    Object.assign(fm, {
      cost: `${cost.toLocaleString("en")}eb`, availability: hbTier(cost),
      effects: String(d.effects || "").split("\n").map((x) => x.trim()).filter(Boolean),
      source: d.source.trim() || "Homebrew",
    });
    if (fm.tags.includes("Program") && /Black ICE/.test(d.pclass)) fm.tags.push("BlackICE");
    const body = "```dataviewjs\nawait dv.view(\"_scripts/cpr-item-card\")\n```\n\n" + (d.desc || "") + "\n";
    const file = await hbCreateNote(this.app, this.folder(), d.name, `---\n${hbYaml(fm)}\n---\n\n${body}`);
    if (file) this.close();
  }
}

/* ---------------- Homebrew enemy / NPC ---------------- */
class HomebrewEnemyModal extends HbForm {
  constructor(app, plugin, npc = false) {
    super(app);
    this.plugin = plugin;
    const threat = npc ? "NPC" : "Mook";
    this.d = {
      npc, name: "", threat, job: "", desc: "", image: null, source: "",
      stats: [...HB_STAT_PRESETS[threat]], hp: "", armor: "", sph: 7, spb: 7,
      weapons: [], skills: "", cyber: [], gear: "", abilities: "", tactics: "", loot: "",
    };
    this.d.skills = this.defaultSkills();
  }
  onOpen() {
    this.modalEl.addClass("cpr-modal", "cpr-hb");
    this.titleEl.setText(this.d.npc ? "Create Homebrew NPC" : "Create Homebrew Enemy");
    this.draw();
  }
  st(k) { return Number(this.d.stats[STATS.indexOf(k)]) || 0; }
  hpAuto() { return 10 + 5 * Math.ceil((this.st("body") + this.st("will")) / 2); }
  defaultSkills() {
    const b = HB_SKILL_BONUS[this.d.threat] ?? 4;
    const pick = [["Athletics", "dex"], ["Brawling", "dex"], ["Evasion", "dex"], ["Perception", "int"], ["Stealth", "dex"], ["Handgun", "ref"], ["Melee Weapon", "dex"], ["Human Perception", "emp"], ["Persuasion", "cool"], ["Resist Torture/Drugs", "will"]];
    return pick.map(([n, k]) => `${n} ${(Number(this.d.stats[STATS.indexOf(k)]) || 0) + b}`).join(", ");
  }
  draw() {
    const c = this.contentEl, d = this.d;
    c.empty();
    el(c, "div", "cpr-wz-note", d.npc
      ? "Creates an NPC note in your NPC folder with a CPR Character statblock. Roll for Initiative treats it as neutral."
      : "Creates an enemy note like the Core Rulebook's Mooks and Grunts: a CPR Character statblock plus the properties Roll for Initiative reads. Skill numbers are bases (STAT + skill), ready to roll.");
    this.section(c, "Who");
    this.input(this.row(c, "Name"), d.name, d.npc ? "e.g. Rogue Amendiares" : "e.g. Maelstrom Ganger", "text", (v) => (d.name = v));
    const tr = this.row(c, "Threat", "loads starting STATs");
    this.sel(tr, [...HB_THREATS, "NPC"], d.threat, (v) => { d.threat = v; d.stats = [...HB_STAT_PRESETS[v]]; d.skills = this.defaultSkills(); this.draw(); });
    this.input(this.row(c, d.npc ? "Job / Role" : "Gang / Job"), d.job, d.npc ? "e.g. Fixer, Ripperdoc" : "e.g. Maelstrom, Arasaka security", "text", (v) => (d.job = v));
    this.area(this.row(c, "Description"), d.desc, "Look, attitude, hooks…", (v) => (d.desc = v), 2);
    const pr = this.row(c, "Portrait");
    const pb = el(pr, "button", "cpr-mini", d.image ? d.image.name : "Pick image…");
    pb.onclick = () => new PortraitSuggest(this.app, (f) => { d.image = f; this.draw(); }).open();
    this.input(this.row(c, "Source", "blank = Homebrew"), d.source, "", "text", (v) => (d.source = v));

    this.section(c, "STATs");
    const grid = el(c, "div", "cpr-hb-stats");
    STATS.forEach((k, i) => {
      const box = el(grid, "div", "cpr-hb-stat");
      el(box, "span", "cpr-label", STAT_LABEL[k]);
      this.input(box, d.stats[i], "", "number", (v) => { d.stats[i] = v; hpAuto.setText(`auto ${this.hpAuto()}`); });
    });
    const hr = this.row(c, "HP", "blank = 10 + 5 × (BODY+WILL)/2");
    this.input(hr, d.hp, "", "number", (v) => (d.hp = v));
    const hpAuto = el(hr, "span", "cpr-sub", `auto ${this.hpAuto()}`);
    const sk = this.row(c, "Skill bases", "comma-separated, already STAT + level");
    const sb = el(sk, "button", "cpr-mini", "↻ from STATs");
    sb.onclick = () => { d.skills = this.defaultSkills(); this.draw(); };
    this.area(sk, d.skills, "Handgun 12, Evasion 10…", (v) => (d.skills = v), 3);

    this.section(c, "Armor & weapons");
    const armors = vaultItems(this.app, "Armor");
    const ar = this.row(c, "Armor", "from your item notes");
    this.sel(ar, [["", "— none / custom —"], ...armors.map((a) => [a.name, `${a.name} (SP ${a.fm.sp ?? "?"})`])], d.armor, (v) => {
      d.armor = v;
      const a = armors.find((x) => x.name === v);
      if (a && a.fm.sp) { d.sph = Number(a.fm.sp); d.spb = Number(a.fm.sp); }
      this.draw();
    });
    const spr = this.row(c, "SP head · body");
    this.input(spr, d.sph, "head", "number", (v) => (d.sph = v));
    this.input(spr, d.spb, "body", "number", (v) => (d.spb = v));
    const weapons = vaultItems(this.app, "Weapon").filter((w) => w.fm.damage);
    d.weapons.forEach((w, i) => {
      const r = this.row(c, `Weapon ${i + 1}`);
      this.input(r, w.name, "name", "text", (v) => (w.name = v));
      this.input(r, w.dmg, "3d6", "text", (v) => (w.dmg = v)).addClass("cpr-hb-narrow");
      this.input(r, w.rof, "ROF", "number", (v) => (w.rof = v)).addClass("cpr-hb-narrow");
      this.input(r, w.skill, "skill + base, e.g. Handgun 12", "text", (v) => (w.skill = v));
      const x = el(r, "button", "cpr-mini", "✕");
      x.onclick = () => { d.weapons.splice(i, 1); this.draw(); };
    });
    const addW = this.row(c, "Add weapon", "fills damage/ROF/skill from the note");
    this.sel(addW, [["", "— pick from your weapons —"], ...weapons.map((w) => [w.name, `${w.name} · ${w.fm.damage}`]), ["__custom", "custom weapon…"]], "", (v) => {
      if (!v) return;
      if (v === "__custom") d.weapons.push({ name: "", dmg: "", rof: 1, skill: "" });
      else {
        const w = weapons.find((x) => x.name === v);
        const skill = w.fm.skill || "Melee Weapon";
        const statKey = /melee|brawling|martial/i.test(skill) ? "dex" : "ref";
        d.weapons.push({ name: `[[${w.name}]]`, dmg: w.fm.damage, rof: Number(w.fm.rof) || 1, skill: `${skill} ${this.st(statKey) + (HB_SKILL_BONUS[d.threat] ?? 4)}` });
      }
      this.draw();
    });

    this.section(c, "Chrome, gear & tactics");
    const cyber = vaultItems(this.app, "Cyberware");
    if (d.cyber.length) el(c, "div", "cpr-wz-note", d.cyber.join(", "));
    const cr = this.row(c, "Cyberware");
    this.sel(cr, [["", "— add cyberware —"], ...cyber.map((x) => [x.name, `${x.name}${x.fm.humanity_loss ? " · HL " + x.fm.humanity_loss : ""}`])], "", (v) => { if (v) { d.cyber.push(v); this.draw(); } });
    if (d.cyber.length) { const cl = el(cr, "button", "cpr-mini", "clear"); cl.onclick = () => { d.cyber = []; this.draw(); }; }
    this.input(this.row(c, "Gear"), d.gear, "Agent, Rope, VH Pistol Ammo ×20…", "text", (v) => (d.gear = v));
    this.area(this.row(c, "Special abilities", "one per line: Name: what it does"), d.abilities, "Combat Awareness 4: +2 Initiative…", (v) => (d.abilities = v), 2);
    this.input(this.row(c, "Tactics"), d.tactics, "Takes cover, flees at Seriously Wounded", "text", (v) => (d.tactics = v));
    this.input(this.row(c, "Loot"), d.loot, "50eb, Heavy Pistol", "text", (v) => (d.loot = v));

    const foot = el(c, "div", "cpr-edit-bar");
    el(foot, "span", "cpr-sub", `→ ${d.threat === "NPC" ? this.plugin.settings.npcFolder || "5. NPC" : this.plugin.settings.enemyFolder || "3. Nepřátelé"}`);
    const go = el(foot, "button", "mod-cta", d.threat === "NPC" ? "Create NPC" : "Create enemy");
    go.onclick = () => this.create();
  }
  async create() {
    const d = this.d;
    const stats = d.stats.map((x) => Number(x) || 0);
    const hp = Number(d.hp) || this.hpAuto();
    const isNpc = d.threat === "NPC";
    const ref = stats[1], body = stats[8];
    const fm = {
      type: isNpc ? "npc" : "monster", threat: d.threat, role: d.job, hp, ref, dex: stats[2], body,
      sp_head: Number(d.sph) || 0, sp_body: Number(d.spb) || 0,
      image: d.image ? `[[${d.image.name}]]` : "", source: d.source.trim() || "Homebrew", homebrew: true,
      tags: [isNpc ? "NPC" : "Monster", d.threat, "Homebrew"],
    };
    const sb = {
      layout: "CPR Character", name: d.name, threat: d.threat, role: d.job || (isNpc ? "NPC" : "Homebrew"),
      desc: d.desc, hp, sp_head: Number(d.sph) || 0, sp_body: Number(d.spb) || 0, initiative: `1d10 + ${ref}`,
      skills: d.skills,
      gear: [d.armor ? `Armor: [[${d.armor}]] (SP ${Number(d.spb) || 0})` : "", d.gear].filter(Boolean).join(" · "),
      tactics: d.tactics, loot: d.loot,
    };
    const lines = [`layout: ${yamlStr(sb.layout)}`, `name: ${yamlStr(sb.name)}`, `threat: ${yamlStr(sb.threat)}`, `role: ${yamlStr(sb.role)}`];
    if (sb.desc) lines.push(`desc: ${yamlStr(sb.desc)}`);
    lines.push(`stats: [${stats.join(", ")}]`, `hp: ${hp}`, `sp_head: ${sb.sp_head}`, `sp_body: ${sb.sp_body}`, `initiative: ${yamlStr(sb.initiative)}`);
    if (d.weapons.length) {
      lines.push("weapons:");
      for (const w of d.weapons) lines.push(`  - name: ${yamlStr(w.name || "Weapon")}`, `    desc: ${yamlStr(`**${w.dmg || "?"}** · ROF ${w.rof || 1}${w.skill ? " · " + w.skill : ""}`)}`);
    }
    if (sb.skills) lines.push(`skills: ${yamlStr(sb.skills)}`);
    if (d.cyber.length) {
      lines.push("cyberware:");
      for (const cw of d.cyber) {
        const n = vaultItems(this.app, "Cyberware").find((x) => x.name === cw);
        lines.push(`  - name: ${yamlStr(`[[${cw}]]`)}`, `    desc: ${yamlStr(n ? [].concat(n.fm.effects || [])[0] || "" : "")}`);
      }
    }
    if (sb.gear) lines.push(`gear: ${yamlStr(sb.gear)}`);
    const abil = String(d.abilities || "").split("\n").map((x) => x.trim()).filter(Boolean);
    if (abil.length) {
      lines.push("abilities:");
      for (const a of abil) { const [n, ...rest] = a.split(":"); lines.push(`  - name: ${yamlStr(n.trim())}`, `    desc: ${yamlStr(rest.join(":").trim())}`); }
    }
    if (sb.tactics) lines.push(`tactics: ${yamlStr(sb.tactics)}`);
    if (sb.loot) lines.push(`loot: ${yamlStr(sb.loot)}`);
    const text = `---\n${hbYaml(fm)}\n---\n\n\`\`\`statblock\n${lines.join("\n")}\n\`\`\`\n\n## Notes\n- \n`;
    const folder = isNpc ? this.plugin.settings.npcFolder || "5. NPC" : this.plugin.settings.enemyFolder || "3. Nepřátelé";
    const file = await hbCreateNote(this.app, folder, d.name, text);
    if (file) this.close();
  }
}

/* ---------------- Homebrew role / skill editors (settings lists) ---------------- */
class HbRoleModal extends HbForm {
  constructor(app, role, onSave) { super(app); this.r = { name: "", ability: "", desc: "", ...(role || {}) }; this.onSave = onSave; }
  onOpen() {
    this.modalEl.addClass("cpr-modal", "cpr-hb");
    this.titleEl.setText(this.r.name ? `Edit Role: ${this.r.name}` : "Add Homebrew Role");
    const c = this.contentEl;
    el(c, "div", "cpr-wz-note", "A homebrew Role appears in the character wizard next to the 10 core Roles. It has no template tables, so it always uses the Complete Package method.");
    this.input(this.row(c, "Role name"), this.r.name, "e.g. Trauma Team Medic, Corp Spy", "text", (v) => (this.r.name = v));
    this.input(this.row(c, "Role Ability"), this.r.ability, "e.g. Shadow Protocol", "text", (v) => (this.r.ability = v));
    this.area(this.row(c, "What it does"), this.r.desc, "How the ability works and what Rank changes…", (v) => (this.r.desc = v), 5);
    const foot = el(c, "div", "cpr-edit-bar");
    const ok = el(foot, "button", "mod-cta", "Save Role");
    ok.onclick = async () => {
      if (!this.r.name.trim()) { new Notice("Give the Role a name."); return; }
      if (ROLE_ABILITY[this.r.name.trim()]) { new Notice("That's a core Role name - pick another."); return; }
      this.r.name = this.r.name.trim();
      await this.onSave(this.r);
      this.close();
    };
  }
}
class HbSkillModal extends HbForm {
  constructor(app, skill, onSave) { super(app); this.k = { name: "", stat: "INT", x2: false, ...(skill || {}) }; this.onSave = onSave; }
  onOpen() {
    this.modalEl.addClass("cpr-modal", "cpr-hb");
    this.titleEl.setText(this.k.name ? `Edit Skill: ${this.k.name}` : "Add Homebrew Skill");
    const c = this.contentEl;
    el(c, "div", "cpr-wz-note", "A homebrew Skill can be bought in the character wizard (Complete Package), learned in the Upgrade window, and picked as a weapon skill.");
    this.input(this.row(c, "Skill name"), this.k.name, "e.g. Braindance Editing", "text", (v) => (this.k.name = v));
    this.sel(this.row(c, "Linked STAT"), STATS.map((s2) => STAT_LABEL[s2]), this.k.stat, (v) => (this.k.stat = v));
    const r = this.row(c, "Difficult (x2)", "costs double to buy and to raise");
    const cb = r.createEl("input", { type: "checkbox" });
    cb.checked = !!this.k.x2;
    cb.addEventListener("change", () => (this.k.x2 = cb.checked));
    const foot = el(c, "div", "cpr-edit-bar");
    const ok = el(foot, "button", "mod-cta", "Save Skill");
    ok.onclick = async () => {
      const n = this.k.name.trim();
      if (!n) { new Notice("Give the skill a name."); return; }
      if (BASE_SKILL_NAMES.has(n)) { new Notice("That's a core skill already."); return; }
      this.k.name = n;
      await this.onSave(this.k);
      this.close();
    };
  }
}

/* ================= Character creation wizard ================= */
const WZ_STEPS = ["Role", "Lifepath", "STATs", "Skills", "Gear", "Cyberware", "Review"];
const WZ_METHODS = {
  streetrat: ["Streetrat", "Fastest. Roll 1d10 for a STAT line from your Role's table; skills, gear and cyberware come from the Role's package."],
  edgerunner: ["Edgerunner", "Roll 1d10 for each STAT separately. Your Role's 20 skills, 86 points to spread (2–6). Gear and cyberware from the Role's package."],
  complete: ["Complete Package", "Full control. 62 points for STATs (2–8), 86 skill points for any skills, 2,550eb to buy weapons, armor, gear and cyberware."],
};
const wzRoll = (n = 10) => 1 + Math.floor(Math.random() * n);
const wzStatRow = (role, i) => ROLE_STATS[role][i].split(" ").map(Number);
const wzHp = (s) => 10 + 5 * Math.ceil((s.body + s.will) / 2);
const wzCostNum = (c) => {
  const m = String(c ?? "").replace(/,/g, "").match(/\d+/);
  return m ? Number(m[0]) : 0;
};
const wzHlNum = (h) => {
  const m = String(h ?? "").match(/\((\d+)\)/);
  return m ? Number(m[1]) : (Number(h) || 0);
};

class PortraitSuggest extends FuzzySuggestModal {
  constructor(app, onPick) { super(app); this.onPick = onPick; this.setPlaceholder("Pick a portrait image from the vault"); }
  getItems() { return this.app.vault.getFiles().filter((f) => /^(png|jpe?g|webp|gif|avif|bmp)$/i.test(f.extension)); }
  getItemText(f) { return f.path; }
  onChooseItem(f) { this.onPick(f); }
}

class CreateWizard extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.step = 0;
    const lp = {};
    this.s = {
      handle: "", player: "", image: null,
      role: "Solo", method: "streetrat",
      region: null, language: "",
      lp, friends: [], enemies: [], loves: [],
      statRow: null, edgeRolls: {}, cp: Object.fromEntries(STAT_KEYS.map((k) => [k, 6])),
      chooseText: {}, edgeLv: null, cpSkills: null,
      choices: {}, cart: [], clothing: "", shopFilter: "All", shopSearch: "",
    };
  }

  /* ---------- derived state ---------- */
  stats() {
    const s = this.s, out = {};
    if (s.method === "streetrat") {
      if (s.statRow === null) return null;
      const row = wzStatRow(s.role, s.statRow);
      STAT_KEYS.forEach((k, i) => (out[k] = row[i]));
    } else if (s.method === "edgerunner") {
      for (const [i, k] of STAT_KEYS.entries()) {
        const r = s.edgeRolls[k];
        if (!r) return null;
        out[k] = wzStatRow(s.role, r - 1)[i];
      }
    } else Object.assign(out, s.cp);
    return out;
  }
  roleSkillDefs() {
    if (!ROLE_SKILLS[this.s.role]) return BASIC_SKILLS.map((n) => [n, 2]); // homebrew Role: no template
    const [basic, extra] = ROLE_SKILLS[this.s.role];
    return BASIC_SKILLS.map((n, i) => [n, basic[i]]).concat(extra);
  }
  skillName(n) {
    if (n.includes("(choose")) {
      const t = (this.s.chooseText[n] || "").trim();
      return n.replace(/\(choose[^)]*\)/, t ? `(${t})` : "").trim();
    }
    if (n === "Language (other)" || n === "Local Expert (other)") {
      const t = (this.s.chooseText[n] || "").trim();
      return t ? n.replace("other", t) : n;
    }
    return n;
  }
  ensureSkillState() {
    const s = this.s;
    if (!s.edgeLv || s.edgeLv._role !== s.role) {
      s.edgeLv = { _role: s.role };
      for (const [n, l] of this.roleSkillDefs()) s.edgeLv[n] = l;
    }
    if (!s.cpSkills) s.cpSkills = BASIC_SKILLS.map((n) => ({ name: n, lvl: 2 }));
  }
  skillCost(list) { return list.reduce((a, [n, l]) => a + l * ((SKILL_INFO[n] || {}).cost || 1), 0); }
  finalSkills() {
    const s = this.s;
    this.ensureSkillState();
    let pairs;
    if (s.method === "streetrat") pairs = this.roleSkillDefs();
    else if (s.method === "edgerunner") pairs = this.roleSkillDefs().map(([n]) => [n, s.edgeLv[n]]);
    else pairs = s.cpSkills.filter((x) => x.lvl > 0).map((x) => [x.name, x.lvl]);
    const out = pairs.map(([n, l]) => ({ name: this.skillName(n), stat: (SKILL_INFO[n] || { stat: "INT" }).stat, lvl: l }));
    if (s.language) out.push({ name: `Language (${s.language})`, stat: "INT", lvl: 4 });
    return out;
  }
  pick(entries, prefix) {
    const out = [];
    entries.forEach((e, i) => {
      if (e && e.or) {
        const idx = this.s.choices[`${prefix}${i}`] ?? 0;
        const opt = e.or[idx];
        (Array.isArray(opt) ? opt : [opt]).forEach((x) => out.push(x));
      } else out.push(e);
    });
    return out;
  }
  vaultNote(name) {
    const f = this.app.vault.getMarkdownFiles().find((x) => x.basename.toLowerCase() === String(name).toLowerCase());
    return f ? { file: f, fm: this.app.metadataCache.getFileCache(f)?.frontmatter || {} } : null;
  }
  shopItems() {
    if (this._shop) return this._shop;
    const items = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      if (!fm || !fm.category || fm.category === "Condition" || fm.type === "Rule") continue;
      const cost = wzCostNum(fm.cost);
      if (!cost) continue;
      items.push({ name: f.basename, category: fm.category, cost, fm });
    }
    items.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    return (this._shop = items);
  }
  cartTotal() { return this.s.cart.reduce((a, c) => a + c.cost * c.qty, 0); }
  gear() {
    const s = this.s, res = { weapons: [], gear: [], cyber: [], hl: 0, eb: 0, armor: null, spHead: 0, spBody: 0 };
    const addWeapon = (name, notes = "") => {
      const st = WEAPON_STATS[name] || ["", 0, 1, ""];
      res.weapons.push({ name, dmg: st[0], ...(st[1] ? { ammo: st[1], ammo_current: st[1], spare: 0 } : {}), rof: st[2], skill: st[3], notes });
    };
    if (s.method !== "complete") {
      for (const x of this.pick(ROLE_WEAPONS[s.role], "w")) {
        if (x.w) addWeapon(x.w);
        else if (x.ammo) {
          const w = res.weapons.find((ww) => ww.name === x.ammo && ww.ammo);
          if (w) { w.spare += x.n; w.notes = `${x.label} x${x.n}`; } else res.gear.push({ name: x.label, notes: "", qty: x.n });
        } else if (x.gear) res.gear.push({ name: x.gear, notes: x.notes || "", qty: x.qty });
      }
      res.armor = "Light Armorjack"; res.spHead = 11; res.spBody = 11;
      res.gear.push({ name: "Light Armorjack (head + body)", notes: "SP11", qty: 1 });
      for (const x of this.pick(ROLE_OUTFIT[s.role][0], "o")) res.gear.push({ name: x.gear, notes: x.notes || "", qty: x.qty });
      const [cws, hl] = ROLE_CYBER[s.role];
      for (const x of this.pick(cws, "c")) {
        const n = this.vaultNote(x.cw);
        res.cyber.push({ name: x.cw, desc: n ? [].concat(n.fm.effects || [])[0] || "" : "", humanity_loss: n ? n.fm.humanity_loss : "" });
        if (WEAPON_STATS[x.cw]) addWeapon(x.cw, "Cyberware");
      }
      res.hl = hl; res.eb = 500;
    } else {
      for (const c of s.cart) {
        const fm = c.fm;
        if (c.category === "Weapon" && fm.type !== "Rule") {
          for (let i = 0; i < c.qty; i++) res.weapons.push({ name: c.name, dmg: fm.damage || "", ...(Number(fm.magazine) ? { ammo: Number(fm.magazine), ammo_current: Number(fm.magazine), spare: 0 } : {}), rof: fm.rof ?? 1, skill: fm.skill || "", notes: fm.type || "" });
        } else if (c.category === "Armor" && fm.sp) {
          const sp = Number(fm.sp);
          const both = /bodyweight/i.test(c.name);
          if (c.loc === "Head" || both) res.spHead = Math.max(res.spHead, sp);
          if (c.loc !== "Head" || both) { if (sp >= res.spBody) res.armor = c.name; res.spBody = Math.max(res.spBody, sp); }
          res.gear.push({ name: `${c.name} (${both ? "head + body" : c.loc.toLowerCase()})`, notes: `SP${sp}${fm.penalty && fm.penalty !== "None" ? ", " + fm.penalty : ""}`, qty: c.qty });
        } else if (c.category === "Cyberware") {
          for (let i = 0; i < c.qty; i++) {
            res.cyber.push({ name: c.name, desc: [].concat(fm.effects || [])[0] || "", humanity_loss: fm.humanity_loss || "" });
            res.hl += wzHlNum(fm.humanity_loss);
            if (WEAPON_STATS[c.name]) addWeapon(c.name, "Cyberware");
          }
        } else res.gear.push({ name: c.name, notes: c.category === "Program" ? "Program" : fm.type || "", qty: c.qty });
      }
      res.eb = 2550 - this.cartTotal();
      if (!res.armor && !res.spBody) res.armor = "";
    }
    if (s.clothing || s.method !== "complete") res.gear.push({ name: "Clothing", notes: s.method === "complete" ? s.clothing : (s.clothing || ROLE_OUTFIT[s.role][1]), qty: 1 });
    return res;
  }

  /* ---------- UI scaffolding ---------- */
  onOpen() {
    this.modalEl.addClass("cpr-wizard");
    this.titleEl.setText("");
    const c = this.contentEl;
    c.empty();
    this.topEl = el(c, "div", "cpr-wz-top");
    const nb = el(c, "div", "cpr-wz-namebar");
    const prev = el(nb, "button", "cpr-wz-arrow", "‹");
    prev.onclick = () => this.go(this.step - 1);
    this.portraitEl = el(nb, "div", "cpr-wz-portrait");
    this.portraitEl.title = "Pick a portrait";
    this.portraitEl.onclick = () => new PortraitSuggest(this.app, (f) => { this.s.image = f; this.drawPortrait(); }).open();
    const names = el(nb, "div", "cpr-wz-names");
    const h = names.createEl("input", { type: "text", cls: "cpr-wz-handle", attr: { placeholder: "Handle (street name)" } });
    h.value = this.s.handle;
    h.addEventListener("input", () => { this.s.handle = h.value; });
    const pl = names.createEl("input", { type: "text", cls: "cpr-wz-player", attr: { placeholder: "Player" } });
    pl.value = this.s.player;
    pl.addEventListener("input", () => { this.s.player = pl.value; });
    const next = el(nb, "button", "cpr-wz-arrow", "›");
    next.onclick = () => this.go(this.step + 1);
    this.bodyEl = el(c, "div", "cpr-wz-body");
    this.footEl = el(c, "div", "cpr-wz-foot");
    this.drawPortrait();
    this.render();
  }
  drawPortrait() {
    const p = this.portraitEl;
    p.empty();
    if (this.s.image) { const img = p.createEl("img"); img.src = this.app.vault.getResourcePath(this.s.image); }
    else el(p, "span", null, "+");
  }
  go(i) {
    this.step = Math.max(0, Math.min(WZ_STEPS.length - 1, i));
    this.render();
    this.bodyEl.scrollTop = 0;
  }
  render() {
    const t = this.topEl;
    t.empty();
    WZ_STEPS.forEach((name, i) => {
      const b = el(t, "button", "cpr-wz-tab" + (i === this.step ? " is-active" : ""), `${i + 1}. ${name}`);
      b.onclick = () => this.go(i);
    });
    const b = this.bodyEl;
    b.empty();
    this["p" + WZ_STEPS[this.step].replace(/\W/g, "")](b);
    const f = this.footEl;
    f.empty();
    const back = el(f, "button", "cpr-btn", "‹ Back");
    back.disabled = this.step === 0;
    back.onclick = () => this.go(this.step - 1);
    el(f, "span", "cpr-wz-steptxt", `${WZ_STEPS[this.step]} · ${WZ_METHODS[this.s.method][0]} ${this.s.role}`);
    if (this.step < WZ_STEPS.length - 1) {
      const nx = el(f, "button", "cpr-btn cpr-btn-red", "Next ›");
      nx.onclick = () => this.go(this.step + 1);
    } else {
      const cr = el(f, "button", "cpr-btn cpr-btn-red", "✔ Create character");
      cr.onclick = () => this.create();
    }
  }
  h(parent, text, sub) {
    const w = el(parent, "div", "cpr-wz-h");
    el(w, "span", null, text);
    if (sub) el(w, "span", "cpr-wz-sub", sub);
  }
  select(parent, options, value, onChange, cls = "") {
    const sel = parent.createEl("select", { cls: "dropdown " + cls });
    for (const [v, label] of options) sel.createEl("option", { value: String(v), text: label });
    sel.value = String(value);
    sel.addEventListener("change", () => onChange(sel.value));
    return sel;
  }
  dice(parent, title, fn) {
    const b = el(parent, "button", "cpr-mini cpr-mini-red", "🎲");
    b.title = title;
    b.onclick = fn;
    return b;
  }
  choiceRow(parent, entries, prefix, labelFn) {
    entries.forEach((e, i) => {
      const row = el(parent, "div", "cpr-wz-li");
      if (e && e.or) {
        const opts = e.or.map((o, j) => [j, (Array.isArray(o) ? o : [o]).map(labelFn).join(" + ")]);
        this.select(row, opts, this.s.choices[`${prefix}${i}`] ?? 0, (v) => { this.s.choices[`${prefix}${i}`] = Number(v); this.render(); });
        el(row, "span", "cpr-wz-or", "choose one");
      } else el(row, "span", null, labelFn(e));
    });
  }

  /* ---------- homebrew roles ---------- */
  hbRoles() { return (this.plugin.settings.homebrewRoles || []).filter((r) => r && r.name); }
  isHbRole(role) { return !ROLE_ABILITY[role] && this.hbRoles().some((r) => r.name === role); }
  roleAb(role = this.s.role) {
    if (ROLE_ABILITY[role]) return ROLE_ABILITY[role];
    const r = this.hbRoles().find((x) => x.name === role);
    return r ? [r.ability || `${r.name} Ability`, r.desc || ""] : ["Role Ability", ""];
  }

  /* ---------- pages ---------- */
  pRole(b) {
    const hb = this.isHbRole(this.s.role);
    if (hb) this.s.method = "complete";
    this.h(b, "Creation method", "Core Rulebook p.40-42");
    const ms = el(b, "div", "cpr-wz-cards cpr-wz-methods");
    for (const [k, [name, desc]] of Object.entries(WZ_METHODS)) {
      const locked = hb && k !== "complete";
      const card = el(ms, "div", "cpr-wz-card" + (this.s.method === k ? " is-active" : "") + (locked ? " is-locked" : ""));
      el(card, "div", "cpr-wz-card-t", name);
      el(card, "div", "cpr-wz-card-d", locked ? "Not available for a homebrew Role (it has no template tables)." : desc);
      card.onclick = () => { if (locked) return; this.s.method = k; this.render(); };
    }
    this.h(b, "Role", "Your Role Ability starts at Rank 4");
    const grid = el(b, "div", "cpr-wz-cards cpr-wz-roles");
    const roles = [...Object.keys(ROLE_ABILITY).map((r) => [r, false]), ...this.hbRoles().filter((r) => !ROLE_ABILITY[r.name]).map((r) => [r.name, true])];
    for (const [role, isHb] of roles) {
      const card = el(grid, "div", "cpr-wz-card" + (this.s.role === role ? " is-active" : ""));
      el(card, "div", "cpr-wz-card-t", role + (isHb ? " ✦" : ""));
      el(card, "div", "cpr-wz-card-a", this.roleAb(role)[0] + (isHb ? " · homebrew" : ""));
      card.onclick = () => {
        if (this.s.role !== role) { this.s.statRow = null; this.s.edgeRolls = {}; this.s.choices = {}; }
        this.s.role = role;
        if (isHb) this.s.method = "complete";
        this.render();
      };
    }
    const ab = el(b, "div", "cpr-wz-note");
    el(ab, "b", null, `${this.roleAb()[0]} (Rank 4): `);
    el(ab, "span", null, this.roleAb()[1]);
  }

  pLifepath(b) {
    const s = this.s;
    const tools = el(b, "div", "cpr-row-tools");
    const all = el(tools, "button", "cpr-tool", "🎲 Roll whole Lifepath");
    all.onclick = () => {
      s.region = wzRoll() - 1;
      const langs = LP_CULTURE[s.region][1].split(", ");
      s.language = langs[wzRoll(langs.length) - 1];
      for (const k of Object.keys(LP_TABLES)) s.lp[k] = LP_TABLES[k][1][wzRoll() - 1];
      this.rollFriends(); this.rollEnemies(); this.rollLoves();
      this.render();
    };
    this.h(b, "Cultural Origins", "you get one of its languages at level 4");
    const co = el(b, "div", "cpr-wz-li");
    this.select(co, [["", "— region —"], ...LP_CULTURE.map((r, i) => [i, r[0]])], s.region ?? "", (v) => { s.region = v === "" ? null : Number(v); s.language = ""; this.render(); });
    this.dice(co, "Roll region", () => { s.region = wzRoll() - 1; s.language = ""; this.render(); });
    if (s.region !== null) {
      const langs = LP_CULTURE[s.region][1].split(", ");
      this.select(co, [["", "— language —"], ...langs.map((l) => [l, l])], s.language, (v) => { s.language = v; });
    }
    this.h(b, "Who you are");
    const grid = el(b, "div", "cpr-wz-lp");
    for (const [k, [label, opts]] of Object.entries(LP_TABLES)) {
      const box = el(grid, "div", "cpr-wz-lpf");
      el(box, "span", "cpr-label", label);
      const row = el(box, "div", "cpr-wz-li");
      const short = (t) => (t.length > 70 ? t.slice(0, 68) + "…" : t);
      this.select(row, [["", "—"], ...opts.map((o, i) => [i, `${i + 1}. ${short(o)}`])], opts.indexOf(s.lp[k]) >= 0 ? opts.indexOf(s.lp[k]) : "", (v) => { s.lp[k] = v === "" ? "" : opts[Number(v)]; });
      this.dice(row, "Roll 1d10", () => { s.lp[k] = opts[wzRoll() - 1]; this.render(); });
    }
    // friends / enemies / love
    const list = (title, arr, rollFn, addFn, drawRow) => {
      const bar = el(b, "div", "cpr-wz-h");
      el(bar, "span", null, title);
      const r = el(bar, "button", "cpr-mini cpr-mini-red", "🎲 1d10−7");
      r.onclick = () => { rollFn(); this.render(); };
      const a = el(bar, "button", "cpr-mini", "+ add");
      a.onclick = () => { addFn(); this.render(); };
      if (!arr.length) el(b, "div", "cpr-wz-empty", "None.");
      arr.forEach((x, i) => {
        const row = el(b, "div", "cpr-wz-li cpr-wz-rel");
        const n = row.createEl("input", { type: "text", attr: { placeholder: "Name" } });
        n.value = x.name || "";
        n.addEventListener("input", () => (x.name = n.value));
        drawRow(row, x);
        const del = el(row, "button", "cpr-mini", "✕");
        del.onclick = () => { arr.splice(i, 1); this.render(); };
      });
    };
    const opt = (arr) => arr.map((t, i) => [t, `${i + 1}. ${t}`]);
    list("Friends", s.friends, () => this.rollFriends(), () => s.friends.push({ name: "", rel: LP_FRIEND[wzRoll() - 1] }),
      (row, x) => this.select(row, opt(LP_FRIEND), x.rel, (v) => (x.rel = v)));
    list("Enemies", s.enemies, () => this.rollEnemies(), () => s.enemies.push(this.newEnemy()), (row, x) => {
      this.select(row, opt(LP_ENEMY_WHO), x.who, (v) => (x.who = v));
      this.select(row, opt(LP_ENEMY_CAUSE), x.cause, (v) => (x.cause = v));
      this.select(row, [["You", "you were wronged"], ["They", "they were wronged"]], x.wronged, (v) => (x.wronged = v));
      this.select(row, opt(LP_ENEMY_RES), x.res, (v) => (x.res = v));
      this.select(row, opt([...new Set(LP_ENEMY_DO)]), x.act, (v) => (x.act = v));
    });
    list("Tragic Love Affairs", s.loves, () => this.rollLoves(), () => s.loves.push({ name: "", what: LP_LOVE[wzRoll() - 1] }),
      (row, x) => this.select(row, opt(LP_LOVE), x.what, (v) => (x.what = v)));
    el(b, "div", "cpr-wz-note", "Role-based Lifepath (Core p.54-70) can be added on the sheet's Lifepath tab later.");
  }
  rollFriends() { this.s.friends = Array.from({ length: Math.max(0, wzRoll() - 7) }, () => ({ name: "", rel: LP_FRIEND[wzRoll() - 1] })); }
  newEnemy() { return { name: "", who: LP_ENEMY_WHO[wzRoll() - 1], cause: LP_ENEMY_CAUSE[wzRoll() - 1], wronged: wzRoll(2) === 1 ? "You" : "They", res: LP_ENEMY_RES[wzRoll() - 1], act: LP_ENEMY_DO[wzRoll() - 1] }; }
  rollEnemies() { this.s.enemies = Array.from({ length: Math.max(0, wzRoll() - 7) }, () => this.newEnemy()); }
  rollLoves() { this.s.loves = Array.from({ length: Math.max(0, wzRoll() - 7) }, () => ({ name: "", what: LP_LOVE[wzRoll() - 1] })); }

  pSTATs(b) {
    const s = this.s;
    const head = ["#", ...STAT_KEYS.map((k) => k.toUpperCase())];
    if (s.method === "complete") {
      const used = STAT_KEYS.reduce((a, k) => a + s.cp[k], 0);
      this.h(b, "Buy your STATs", `${used} / 62 points · each STAT 2–8`);
      const grid = el(b, "div", "cpr-stats");
      for (const k of STAT_KEYS) {
        const box = el(grid, "div", "cpr-stat");
        el(box, "span", "cpr-label", k.toUpperCase());
        const w = el(box, "div", "cpr-luck");
        const m = el(w, "button", "cpr-mini", "−");
        el(w, "span", "cpr-value", s.cp[k]);
        const p = el(w, "button", "cpr-mini", "+");
        m.onclick = () => { if (s.cp[k] > 2) { s.cp[k]--; this.render(); } };
        p.onclick = () => { if (s.cp[k] < 8 && used < 62) { s.cp[k]++; this.render(); } };
      }
      if (used !== 62) el(b, "div", "cpr-wz-warn", used < 62 ? `${62 - used} points left to spend.` : "Over budget.");
    } else {
      const edge = s.method === "edgerunner";
      this.h(b, `${s.role} STAT table`, edge ? "roll 1d10 for each STAT (column)" : "roll 1d10 once and take that whole line");
      const tools = el(b, "div", "cpr-row-tools");
      const r = el(tools, "button", "cpr-tool", edge ? "🎲 Roll all STATs" : "🎲 Roll 1d10");
      r.onclick = () => {
        if (edge) for (const k of STAT_KEYS) s.edgeRolls[k] = wzRoll();
        else s.statRow = wzRoll() - 1;
        this.render();
      };
      const t = el(b, "table", "cpr-table cpr-wz-stattable");
      const hr = el(t, "tr");
      head.forEach((x) => el(hr, "th", null, x));
      for (let i = 0; i < 10; i++) {
        const tr = el(t, "tr", !edge && s.statRow === i ? "is-picked" : "");
        el(tr, "td", "cpr-num", i + 1);
        wzStatRow(s.role, i).forEach((v, j) => {
          const td = el(tr, "td", "cpr-num" + (edge && s.edgeRolls[STAT_KEYS[j]] === i + 1 ? " is-picked" : ""), v);
          if (edge) { td.onclick = () => { s.edgeRolls[STAT_KEYS[j]] = i + 1; this.render(); }; td.title = "Pick this value"; }
        });
        if (!edge) { tr.onclick = () => { s.statRow = i; this.render(); }; tr.title = "Pick this line"; }
      }
      el(b, "div", "cpr-wz-note", "Click a cell or line to set it by hand (e.g. a roll made at the table).");
    }
    const st = this.stats();
    if (st) {
      const hp = wzHp(st);
      const d = el(b, "div", "cpr-vitals");
      for (const [l, v] of [["HP", hp], ["Seriously Wounded", Math.ceil(hp / 2)], ["Death Save", st.body], ["Humanity (before cyberware)", st.emp * 10]]) {
        const box = el(d, "div", "cpr-vital"); el(box, "span", "cpr-label", l); el(box, "span", "cpr-value", v);
      }
    }
  }

  pSkills(b) {
    const s = this.s;
    this.ensureSkillState();
    const chooseInputs = (names) => names.filter((n) => /\(choose|\(other\)/.test(n)).forEach((n) => {
      const row = el(b, "div", "cpr-wz-li");
      el(row, "span", "cpr-label", n);
      const i = row.createEl("input", { type: "text", attr: { placeholder: n.includes("Science") ? "e.g. Chemistry" : n.includes("Instrument") ? "e.g. Guitar" : n.includes("Martial") ? "e.g. Karate" : "which one?" } });
      i.value = s.chooseText[n] || "";
      i.addEventListener("input", () => (s.chooseText[n] = i.value));
    });
    if (s.method === "streetrat") {
      const defs = this.roleSkillDefs();
      this.h(b, `${s.role} skills`, "fixed by the Streetrat template");
      chooseInputs(defs.map((d) => d[0]));
      const t = el(b, "table", "cpr-table");
      const hr = el(t, "tr"); ["Skill", "STAT", "LVL"].forEach((x) => el(hr, "th", null, x));
      for (const [n, l] of defs) { const tr = el(t, "tr", BASIC_SKILLS.includes(n) ? "is-basic" : ""); el(tr, "td", null, this.skillName(n)); el(tr, "td", "cpr-num", SKILL_INFO[n].stat); el(tr, "td", "cpr-num", l); }
    } else if (s.method === "edgerunner") {
      const defs = this.roleSkillDefs();
      const used = this.skillCost(defs.map(([n]) => [n, s.edgeLv[n]]));
      this.h(b, `${s.role} skills`, `${used} / 86 points · each 2–6 · (x2) skills cost double`);
      chooseInputs(defs.map((d) => d[0]));
      const t = el(b, "table", "cpr-table");
      const hr = el(t, "tr"); ["Skill", "STAT", "Cost", "LVL"].forEach((x) => el(hr, "th", null, x));
      for (const [n] of defs) {
        const tr = el(t, "tr", BASIC_SKILLS.includes(n) ? "is-basic" : "");
        const cost = SKILL_INFO[n].cost;
        el(tr, "td", null, this.skillName(n) + (cost > 1 ? " (x2)" : ""));
        el(tr, "td", "cpr-num", SKILL_INFO[n].stat);
        el(tr, "td", "cpr-num", s.edgeLv[n] * cost);
        const td = el(tr, "td", "cpr-num cpr-wz-pm");
        const m = el(td, "button", "cpr-mini", "−"); el(td, "span", "cpr-value", s.edgeLv[n]); const p = el(td, "button", "cpr-mini", "+");
        m.onclick = () => { if (s.edgeLv[n] > 2) { s.edgeLv[n]--; this.render(); } };
        p.onclick = () => { if (s.edgeLv[n] < 6 && used + cost <= 86) { s.edgeLv[n]++; this.render(); } };
      }
      if (used !== 86) el(b, "div", "cpr-wz-warn", used < 86 ? `${86 - used} points left.` : "Over budget.");
    } else {
      const used = this.skillCost(s.cpSkills.map((x) => [x.name, x.lvl]));
      this.h(b, "Buy skills", `${used} / 86 points · max 6 · Basic Skills at least 2 · (x2) skills cost double`);
      chooseInputs(s.cpSkills.map((x) => x.name));
      const t = el(b, "table", "cpr-table");
      const hr = el(t, "tr"); ["Skill", "STAT", "Cost", "LVL", ""].forEach((x) => el(hr, "th", null, x));
      s.cpSkills.forEach((x, i) => {
        const basic = BASIC_SKILLS.includes(x.name);
        const cost = (SKILL_INFO[x.name] || {}).cost || 1;
        const tr = el(t, "tr", basic ? "is-basic" : "");
        el(tr, "td", null, this.skillName(x.name) + (cost > 1 ? " (x2)" : ""));
        el(tr, "td", "cpr-num", (SKILL_INFO[x.name] || {}).stat || "");
        el(tr, "td", "cpr-num", x.lvl * cost);
        const td = el(tr, "td", "cpr-num cpr-wz-pm");
        const m = el(td, "button", "cpr-mini", "−"); el(td, "span", "cpr-value", x.lvl); const p = el(td, "button", "cpr-mini", "+");
        m.onclick = () => { if (x.lvl > (basic ? 2 : 1)) { x.lvl--; this.render(); } };
        p.onclick = () => { if (x.lvl < 6 && used + cost <= 86) { x.lvl++; this.render(); } };
        const act = el(tr, "td", "cpr-act");
        if (!basic) { const d = el(act, "button", "cpr-mini", "✕"); d.onclick = () => { s.cpSkills.splice(i, 1); this.render(); }; }
      });
      const add = el(b, "div", "cpr-wz-li");
      const have = new Set(s.cpSkills.map((x) => x.name));
      this.select(add, [["", "+ add a skill…"], ...MASTER_SKILLS.filter(([n]) => !have.has(n) || /\(other\)|\(choose/.test(n)).map(([n, st, c]) => [n, `${n} (${st}${c > 1 ? ", x2" : ""})`])], "", (v) => {
        if (!v) return;
        if (used + (SKILL_INFO[v].cost) > 86) { new Notice("Not enough skill points."); return; }
        s.cpSkills.push({ name: v, lvl: 1 }); this.render();
      });
      if (used !== 86) el(b, "div", "cpr-wz-warn", used < 86 ? `${86 - used} points left.` : "Over budget.");
    }
    el(b, "div", "cpr-wz-note", s.language ? `Free: Language (${s.language}) at level 4 from your Cultural Origin.` : "Pick a Cultural Origin language on the Lifepath step to get it free at level 4.");
  }

  itemLabel(x) {
    if (x.w) return x.w;
    if (x.ammo) return `${x.label} x${x.n}`;
    if (x.cw) return x.cw;
    return `${x.gear}${x.qty > 1 ? " x" + x.qty : ""}${x.notes && x.notes !== "Program" ? " (" + x.notes + ")" : x.notes === "Program" ? " (Program)" : ""}`;
  }
  shop(b, onlyCat) {
    const s = this.s;
    const items = this.shopItems();
    const cats = ["All", ...new Set(items.map((i) => i.category))];
    const bar = el(b, "div", "cpr-row-tools");
    if (!onlyCat) this.select(bar, cats.map((c) => [c, c]), s.shopFilter, (v) => { s.shopFilter = v; this.render(); });
    const q = bar.createEl("input", { type: "text", attr: { placeholder: "Search…" } });
    q.value = s.shopSearch;
    q.addEventListener("input", () => { s.shopSearch = q.value; clearTimeout(this._qt); this._qt = setTimeout(() => { this.render(); const nq = this.bodyEl.querySelector(".cpr-row-tools input"); if (nq) { nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); } }, 250); });
    const list = el(b, "div", "cpr-wz-shop");
    const term = s.shopSearch.toLowerCase();
    const shown = items.filter((i) => (onlyCat ? i.category === onlyCat : s.shopFilter === "All" || i.category === s.shopFilter) && (!term || i.name.toLowerCase().includes(term)));
    if (!shown.length) el(list, "div", "cpr-wz-empty", items.length ? "Nothing matches." : "No item notes with a cost found in the vault.");
    for (const it of shown.slice(0, 200)) {
      const row = el(list, "div", "cpr-wz-shoprow");
      el(row, "span", "cpr-wz-shopname", it.name);
      el(row, "span", "cpr-sub", it.category + (it.fm.humanity_loss ? ` · HL ${it.fm.humanity_loss}` : "") + (it.fm.damage ? ` · ${it.fm.damage}` : "") + (it.fm.sp ? ` · SP${it.fm.sp}` : ""));
      el(row, "span", "cpr-num", `${it.cost.toLocaleString("en")}eb`);
      const add = el(row, "button", "cpr-mini cpr-mini-red", "+");
      add.onclick = () => {
        const ex = s.cart.find((c) => c.name === it.name && it.category !== "Armor");
        if (ex) ex.qty++; else s.cart.push({ ...it, qty: 1, loc: "Body" });
        this.render();
      };
    }
  }
  cartTable(b, filter) {
    const s = this.s;
    const rows = s.cart.filter(filter);
    if (!rows.length) { el(b, "div", "cpr-wz-empty", "Nothing bought yet."); return; }
    const t = el(b, "table", "cpr-table");
    const hr = el(t, "tr"); ["Item", "", "Qty", "Cost", ""].forEach((x) => el(hr, "th", null, x));
    for (const c of rows) {
      const tr = el(t, "tr");
      el(tr, "td", null, c.name);
      const loc = el(tr, "td");
      if (c.category === "Armor" && !/shield|bodyweight/i.test(c.name)) this.select(loc, [["Body", "Body"], ["Head", "Head"]], c.loc, (v) => { c.loc = v; });
      else if (c.category === "Cyberware") el(loc, "span", "cpr-sub", `HL ${c.fm.humanity_loss || 0}`);
      const q = el(tr, "td", "cpr-num cpr-wz-pm");
      const m = el(q, "button", "cpr-mini", "−"); el(q, "span", "cpr-value", c.qty); const p = el(q, "button", "cpr-mini", "+");
      m.onclick = () => { c.qty--; if (c.qty <= 0) s.cart.splice(s.cart.indexOf(c), 1); this.render(); };
      p.onclick = () => { c.qty++; this.render(); };
      el(tr, "td", "cpr-num", `${(c.cost * c.qty).toLocaleString("en")}eb`);
      const d = el(el(tr, "td", "cpr-act"), "button", "cpr-mini", "✕");
      d.onclick = () => { s.cart.splice(s.cart.indexOf(c), 1); this.render(); };
    }
  }
  pGear(b) {
    const s = this.s;
    if (s.method !== "complete") {
      this.h(b, "Weapons & Armor", `${s.role} starting package · Core p.98`);
      this.choiceRow(b, ROLE_WEAPONS[s.role], "w", (x) => this.itemLabel(x));
      el(el(b, "div", "cpr-wz-li"), "span", null, "Light Armorjack, head and body (SP11)");
      this.h(b, "Outfit", "Core p.103");
      this.choiceRow(b, ROLE_OUTFIT[s.role][0], "o", (x) => this.itemLabel(x));
      el(b, "div", "cpr-wz-note", `Clothing: ${ROLE_OUTFIT[s.role][1]}`);
      el(b, "div", "cpr-wz-note", "You also start with 500eb to spend or keep. It goes onto the sheet as Eurobucks.");
    } else {
      const total = this.cartTotal();
      this.h(b, "Shopping", `${total.toLocaleString("en")} / 2,550eb spent · cyberware is bought here too`);
      if (total > 2550) el(b, "div", "cpr-wz-warn", "Over budget!");
      this.cartTable(b, () => true);
      this.h(b, "Night Market", "every item note in your vault with a cost");
      this.shop(b);
      this.h(b, "Clothing", "Complete Package gets a separate 800eb for fashion");
      const ta = b.createEl("textarea", { cls: "cpr-wz-ta", attr: { rows: 2, placeholder: "e.g. Nomad Leathers: Top, Bottom, Jacket · Mirrorshades" } });
      ta.value = s.clothing;
      ta.addEventListener("input", () => (s.clothing = ta.value));
    }
  }
  pCyberware(b) {
    const s = this.s;
    const st = this.stats();
    const g = this.gear();
    if (s.method !== "complete") {
      this.h(b, "Cyberware", `${s.role} package · ${ROLE_CYBER[s.role][1]} Humanity Loss · Core p.117`);
      this.choiceRow(b, ROLE_CYBER[s.role][0], "c", (x) => this.itemLabel(x));
      const cards = el(b, "div", "cpr-cards");
      for (const c of g.cyber) {
        const card = el(cards, "div", "cpr-card-item");
        const head = el(card, "div", "cpr-card-head", c.name);
        if (c.humanity_loss) el(head, "span", "cpr-hl", `HL ${c.humanity_loss}`);
        if (c.desc) el(card, "div", "cpr-card-body", c.desc);
      }
    } else {
      this.h(b, "Your cyberware", "bought from the 2,550eb · Humanity Loss uses the average value");
      this.cartTable(b, (c) => c.category === "Cyberware");
      this.h(b, "Ripperdoc", `${this.cartTotal().toLocaleString("en")} / 2,550eb spent`);
      this.shop(b, "Cyberware");
    }
    if (st) {
      const hum = st.emp * 10 - g.hl;
      const d = el(b, "div", "cpr-vitals");
      for (const [l, v] of [["Humanity Loss", g.hl], ["Humanity", hum], ["EMP", `${st.emp} → ${Math.max(0, Math.floor(hum / 10))}`]]) {
        const box = el(d, "div", "cpr-vital"); el(box, "span", "cpr-label", l); el(box, "span", "cpr-value", v);
      }
    } else el(b, "div", "cpr-wz-warn", "Set your STATs first to see the Humanity result.");
  }
  pReview(b) {
    const s = this.s, st = this.stats(), g = this.gear(), skills = this.finalSkills();
    const problems = [];
    if (!s.handle.trim()) problems.push("Give the character a Handle (top bar).");
    if (!st) problems.push("STATs are not set yet.");
    if (!s.language) problems.push("No Cultural Origin language picked (Lifepath).");
    if (s.method === "complete" && this.cartTotal() > 2550) problems.push("Shopping is over 2,550eb.");
    for (const p of problems) el(b, "div", "cpr-wz-warn", p);
    this.h(b, `${s.handle || "?"} — ${s.role}`, WZ_METHODS[s.method][0]);
    if (st) {
      const grid = el(b, "div", "cpr-stats");
      for (const k of STAT_KEYS) { const box = el(grid, "div", "cpr-stat"); el(box, "span", "cpr-label", k.toUpperCase()); el(box, "span", "cpr-value", k === "emp" ? Math.max(0, Math.floor((st.emp * 10 - g.hl) / 10)) : st[k]); }
      const hp = wzHp(st);
      el(b, "div", "cpr-wz-note", `HP ${hp} · Seriously Wounded ${Math.ceil(hp / 2)} · Death Save ${st.body} · Humanity ${st.emp * 10 - g.hl} · Armor ${g.armor || "none"} (head ${g.spHead} / body ${g.spBody}) · ${g.eb}eb`);
    }
    el(b, "div", "cpr-wz-note", "Skills: " + skills.map((x) => `${x.name} ${x.lvl}`).join(", "));
    el(b, "div", "cpr-wz-note", "Weapons: " + (g.weapons.map((w) => w.name).join(", ") || "none"));
    el(b, "div", "cpr-wz-note", "Cyberware: " + (g.cyber.map((c) => c.name).join(", ") || "none"));
    el(b, "div", "cpr-wz-note", "Gear: " + g.gear.map((x) => x.name + (x.qty > 1 ? " x" + x.qty : "")).join(", "));
  }

  /* ---------- create ---------- */
  async create() {
    const s = this.s, st = this.stats();
    const handle = s.handle.trim();
    if (!handle) { new Notice("Give the character a Handle first."); return; }
    if (!st) { new Notice("Set the STATs first."); this.go(2); return; }
    const g = this.gear();
    const hp = wzHp(st);
    const humanity = st.emp * 10 - g.hl;
    const lp = { ...s.lp };
    if (s.region !== null) lp.cultural_origins = `${LP_CULTURE[s.region][0]}${s.language ? " (" + s.language + ")" : ""}`;
    const folder = normalizePath(this.plugin.settings.characterFolder || "");
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    const path = normalizePath(`${folder ? folder + "/" : ""}${handle.replace(/[\\/:*?"<>|]/g, "-")}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) { new Notice("A note with that name already exists."); return; }
    const file = await this.app.vault.create(path, newCharacterBody(handle));
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      Object.assign(fm, {
        cssclasses: ["cpr-sheet"], type: "player", handle, role: s.role, rank: 4, player: s.player,
        ...st, emp: Math.max(0, Math.floor(humanity / 10)), luck_current: st.luck,
        hp, hp_current: hp, humanity,
        armor: g.armor || "", sp_head: g.spHead, sp_head_max: g.spHead, sp_body: g.spBody, sp_body_max: g.spBody,
        conditions: [], death_save_penalty: 0,
        eurobucks: g.eb, ip: 0, reputation: 0,
        image: s.image ? `[[${s.image.name}]]` : "",
        skills: this.finalSkills(),
        weapons: g.weapons,
        role_ability: [{ name: `${this.roleAb()[0]} (Rank 4)`, desc: this.roleAb()[1] }],
        cyberware: g.cyber, gear: g.gear,
        lifepath: lp,
        friends: s.friends.map((f) => ({ name: f.name || "?", relationship: f.rel })),
        enemies: s.enemies.map((e) => ({ name: `${e.name || "?"} — ${e.who}`, cause: `${e.cause} (${e.wronged === "You" ? "you were wronged" : "they were wronged"})`, outcome: `${e.act} Resources: ${e.res}` })),
        tragic_love_affairs: s.loves.map((l) => ({ name: l.name || "?", what_happened: l.what })),
        source: `Created with the wizard (${WZ_METHODS[s.method][0]})`,
        tags: ["Player"],
      });
    });
    this.close();
    await this.app.workspace.getLeaf(true).openFile(file);
    new Notice(`${handle} is ready, choomba.`);
  }
  onClose() { this.contentEl.empty(); }
}

/* ---------------- new character ---------------- */
function newCharacterBody(handle) {
  return `# ${handle}

\`\`\`cpr-mobile
\`\`\`

> [!cpr-row]
>> [!cpr-panel] Edgerunner
>> \`\`\`cpr-header
>> \`\`\`
>> \`\`\`cpr-stats
>> \`\`\`
>> \`\`\`cpr-vitals
>> \`\`\`
>
>> [!cpr-side] Portrait
>> \`\`\`cpr-portrait
>> \`\`\`

\`\`\`cpr-log
\`\`\`

> [!cpr-panel] Skills
> \`\`\`cpr-skills
> \`\`\`

> [!cpr-row]
>> [!cpr-panel] Armor
>> \`\`\`cpr-armor
>> \`\`\`
>
>> [!cpr-panel|wide] Weapons
>> \`\`\`cpr-weapons
>> \`\`\`

> [!cpr-panel] Dossier
> \`\`\`cpr-tabs
> \`\`\`
`;
}

/* ---------------- plugin ---------------- */
module.exports = class CprSheetPlugin extends Plugin {
  onunload() {
    document.body.classList.remove("cpr-ui");
  }

  async onload() {
    // styles.css scopes its overrides under body.cpr-ui (instead of !important)
    document.body.classList.add("cpr-ui");
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (!Array.isArray(this.settings.homebrewRoles)) this.settings.homebrewRoles = [];
    if (!Array.isArray(this.settings.homebrewSkills)) this.settings.homebrewSkills = [];
    applyHomebrewSkills(this.settings.homebrewSkills);
    this.editing = new Set();
    this.activeTab = new Map();
    this.luckStake = new Map();
    this.logs = new Map();
    this.mobilePages = new Map();

    for (const kind of ["mobile", "header", "stats", "vitals", "portrait", "skills", "armor", "weapons", "tabs", "log"]) {
      this.registerMarkdownCodeBlockProcessor(`cpr-${kind}`, (source, el, ctx) => {
        ctx.addChild(new SheetBlock(this, el, ctx.sourcePath, kind, source));
      });
    }

    this.addCommand({ id: "new-character", name: "Create character (wizard)", callback: () => new CreateWizard(this.app, this).open() });
    this.addCommand({
      id: "upgrade-character",
      name: "Upgrade character (spend IP)",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        const fm = f && this.app.metadataCache.getFileCache(f)?.frontmatter;
        if (!fm || !Array.isArray(fm.skills)) return false;
        if (!checking) new UpgradeModal(this.app, this, f).open();
        return true;
      },
    });
    this.addCommand({ id: "homebrew-item", name: "Create homebrew item", callback: () => new HomebrewItemModal(this.app, this).open() });
    this.addCommand({ id: "homebrew-enemy", name: "Create homebrew enemy", callback: () => new HomebrewEnemyModal(this.app, this, false).open() });
    this.addCommand({ id: "homebrew-npc", name: "Create homebrew NPC", callback: () => new HomebrewEnemyModal(this.app, this, true).open() });
    this.addCommand({ id: "new-blank-character", name: "Create blank character sheet", callback: () => this.newCharacter() });
    this.addCommand({
      id: "toggle-edit",
      name: "Toggle edit mode on current sheet",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f) return false;
        if (!checking) this.toggleEdit(f.path);
        return true;
      },
    });
    addIcon("cpr-new-character", '<g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><circle cx="38" cy="30" r="16"/><path d="M8 88c0-17 13-30 30-30s30 13 30 30"/><path d="M80 34v28M66 48h28"/></g>');
    this.addRibbonIcon("cpr-new-character", "Create Cyberpunk RED character", () => new CreateWizard(this.app, this).open());
    this.addSettingTab(new CprSettingTab(this.app, this));
  }

  mobilePageFor(path) {
    return this.mobilePages.get(path) || "overview";
  }
  setMobilePage(path, page) {
    this.mobilePages.set(path, page);
    const f = this.app.vault.getAbstractFileByPath(path);
    const fm = (f && this.app.metadataCache.getFileCache(f)?.frontmatter) || {};
    this.app.workspace.trigger("cpr-sheet:refresh", path, fm);
    window.scrollTo && window.scrollTo(0, 0);
  }
  async saveSettings() {
    await this.saveData(this.settings);
    applyHomebrewSkills(this.settings.homebrewSkills);
  }
  toggleEdit(path) {
    if (this.editing.has(path)) this.editing.delete(path);
    else this.editing.add(path);
    const f = this.app.vault.getAbstractFileByPath(path);
    const fm = (f && this.app.metadataCache.getFileCache(f)?.frontmatter) || {};
    this.app.workspace.trigger("cpr-sheet:refresh", path, fm);
  }
  conditionFiles() {
    return this.app.vault.getMarkdownFiles().filter((f) => {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      return fm && String(fm.type).toLowerCase() === "condition";
    });
  }
  conditionFile(name) {
    return this.conditionFiles().find((f) => f.basename.toLowerCase() === String(name).toLowerCase()) || null;
  }
  pushLog(path, text, kind) {
    const list = this.logs.get(path) || [];
    list.unshift({ text, kind, at: Date.now() });
    this.logs.set(path, list.slice(0, 30));
  }

  async newCharacter() {
    new TextModal(this.app, "Handle of the new character", "", async (handle) => {
      handle = (handle || "").trim();
      if (!handle) return;
      const folder = normalizePath(this.settings.characterFolder || "");
      if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
      const path = normalizePath(`${folder ? folder + "/" : ""}${handle.replace(/[\\/:*?"<>|]/g, "-")}.md`);
      if (this.app.vault.getAbstractFileByPath(path)) { new Notice("A note with that name already exists."); return; }
      const file = await this.app.vault.create(path, newCharacterBody(handle));
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        Object.assign(fm, {
          cssclasses: ["cpr-sheet"],
          type: "player",
          handle, role: "Solo", rank: 4, player: "",
          int: 5, ref: 5, dex: 5, tech: 5, cool: 5, will: 5, luck: 5, luck_current: 5, move: 5, body: 5, emp: 5,
          hp: 35, hp_current: 35, humanity: 50,
          armor: "Light Armorjack", sp_head: 11, sp_head_max: 11, sp_body: 11, sp_body_max: 11,
          conditions: [], death_save_penalty: 0,
          eurobucks: 0, ip: 0, reputation: 0,
          image: "",
          skills: [
            { name: "Athletics", stat: "DEX", lvl: 2 }, { name: "Brawling", stat: "DEX", lvl: 2 },
            { name: "Concentration", stat: "WILL", lvl: 2 }, { name: "Conversation", stat: "EMP", lvl: 2 },
            { name: "Education", stat: "INT", lvl: 2 }, { name: "Evasion", stat: "DEX", lvl: 2 },
            { name: "First Aid", stat: "TECH", lvl: 2 }, { name: "Human Perception", stat: "EMP", lvl: 2 },
            { name: "Language (Streetslang)", stat: "INT", lvl: 2 }, { name: "Local Expert", stat: "INT", lvl: 2 },
            { name: "Perception", stat: "INT", lvl: 2 }, { name: "Persuasion", stat: "COOL", lvl: 2 },
            { name: "Stealth", stat: "DEX", lvl: 2 },
          ],
          weapons: [], role_ability: [], cyberware: [], gear: [],
          lifepath: {}, friends: [], tragic_love_affairs: [], enemies: [],
          tags: ["Player"],
        });
      });
      await this.app.workspace.getLeaf(true).openFile(file);
      this.editing.add(file.path);
      new Notice("Character created — fill in the sheet (edit mode is on).");
    }, false).open();
  }
};

class CprSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  async save() { await this.plugin.saveSettings(); this.display(); }
  folderSetting(c, key, name, desc) {
    new Setting(c).setName(name).setDesc(desc).addText((t) => t.setValue(this.plugin.settings[key] || "").onChange(async (v) => {
      this.plugin.settings[key] = v.trim();
      await this.plugin.saveSettings();
    }));
  }
  display() {
    const { containerEl: c } = this;
    c.empty();
    c.createEl("h2", { text: "Edgerunner Character Sheet" });
    c.createEl("p", { cls: "setting-item-description", text: "Edgerunner Character Sheet is unofficial content provided under the Homebrew Content Policy of R. Talsorian Games and is not approved or endorsed by RTG. This content references materials that are the property of R. Talsorian Games and its licensees." });

    c.createEl("h3", { text: "Folders" });
    this.folderSetting(c, "characterFolder", "New character folder", "Where the character wizard puts new sheets.");
    this.folderSetting(c, "itemFolder", "Item library folder", "Root of your item notes. Homebrew items are filed into its subfolders (Zbraně, Zbroj, Cyberware/…, Netrunning/…).");
    this.folderSetting(c, "enemyFolder", "Enemy folder", "Where new homebrew enemies go.");
    this.folderSetting(c, "npcFolder", "NPC folder", "Where new homebrew NPCs go.");

    c.createEl("h3", { text: "Rules" });
    new Setting(c)
      .setName("Apply wound penalties to rolls")
      .setDesc("Seriously Wounded −2, Mortally Wounded −4 on every Check rolled from the sheet. Set ignore_sw_penalty: true on a character with Pain Editor.")
      .addToggle((t) => t.setValue(this.plugin.settings.autoWoundPenalty).onChange(async (v) => {
        this.plugin.settings.autoWoundPenalty = v;
        await this.plugin.saveSettings();
      }));

    c.createEl("h3", { text: "Homebrew Content" });
    c.createEl("p", {
      cls: "setting-item-description",
      text: "Roles and Skills are saved here and show up in the character wizard and Upgrade window next to the core ones. Items, enemies and NPCs are created as real notes in your vault, tagged Homebrew with a Source, so you can filter them on the home page.",
    });

    c.createEl("h4", { text: "Roles" });
    const roles = this.plugin.settings.homebrewRoles;
    roles.forEach((r, i) => {
      new Setting(c).setName(r.name || "(unnamed)").setDesc(`Role Ability: ${r.ability || "—"}`)
        .addExtraButton((b) => b.setIcon("pencil").setTooltip("Edit").onClick(() => new HbRoleModal(this.app, r, async (data) => { roles[i] = data; await this.save(); }).open()))
        .addExtraButton((b) => b.setIcon("trash-2").setTooltip("Remove role").onClick(async () => { roles.splice(i, 1); await this.save(); }));
    });
    new Setting(c).addButton((b) => b.setButtonText("+ Add Role").onClick(() => new HbRoleModal(this.app, null, async (data) => { roles.push(data); await this.save(); }).open()));

    c.createEl("h4", { text: "Skills" });
    const skills = this.plugin.settings.homebrewSkills;
    skills.forEach((k, i) => {
      new Setting(c).setName(k.name || "(unnamed)").setDesc(`${k.stat}${k.x2 ? " · x2" : ""}`)
        .addExtraButton((b) => b.setIcon("pencil").setTooltip("Edit").onClick(() => new HbSkillModal(this.app, k, async (data) => { skills[i] = data; await this.save(); }).open()))
        .addExtraButton((b) => b.setIcon("trash-2").setTooltip("Remove skill").onClick(async () => { skills.splice(i, 1); await this.save(); }));
    });
    new Setting(c).addButton((b) => b.setButtonText("+ Add Skill").onClick(() => new HbSkillModal(this.app, null, async (data) => { skills.push(data); await this.save(); }).open()));

    c.createEl("h4", { text: "Items" });
    c.createEl("p", { cls: "setting-item-description", text: "Weapons, armor, ammo, attachments, cyberware, gear, drugs, programs and cyberdeck hardware - with the item card, filed under the Item library folder." });
    new Setting(c).addButton((b) => b.setButtonText("+ Create Homebrew Item Note").onClick(() => new HomebrewItemModal(this.app, this.plugin).open()));

    c.createEl("h4", { text: "Enemies & NPCs" });
    c.createEl("p", { cls: "setting-item-description", text: "A CPR Character statblock plus the properties Roll for Initiative reads, like the Core Rulebook's Mooks and Grunts." });
    new Setting(c)
      .addButton((b) => b.setButtonText("+ Create Homebrew Enemy").onClick(() => new HomebrewEnemyModal(this.app, this.plugin, false).open()))
      .addButton((b) => b.setButtonText("+ Create Homebrew NPC").onClick(() => new HomebrewEnemyModal(this.app, this.plugin, true).open()));
  }
}
