<%*
// ---- Cyberpunk RED NPC / enemy (Templater) ----
const name = await tp.system.prompt("NPC / enemy name", tp.file.title);
const threat = await tp.system.suggester(
  ["Mook", "Lieutenant", "Mini-Boss", "Boss", "NPC (contact, civilian)"],
  ["Mook", "Lieutenant", "Mini-Boss", "Boss", "NPC"]
);
const role = await tp.system.prompt("Role or job (Solo, Netrunner, Ganger, Fixer...)", "Ganger");

// starting STATs by tier: INT REF DEX TECH COOL WILL LUCK MOVE BODY EMP
const presets = {
  "Mook":       [3, 5, 5, 3, 4, 4, 0, 5, 5, 3],
  "Lieutenant": [5, 6, 6, 4, 6, 5, 0, 6, 6, 4],
  "Mini-Boss":  [6, 7, 7, 5, 7, 6, 3, 6, 7, 4],
  "Boss":       [7, 8, 8, 6, 8, 7, 5, 7, 8, 5],
  "NPC":        [5, 3, 4, 4, 5, 5, 2, 5, 4, 6],
};
const s = presets[threat] ?? presets["Mook"];
const ref = s[1], dex = s[2], will = s[5], body = s[8];
const hp = 10 + 5 * Math.ceil((body + will) / 2);
const type = threat === "NPC" ? "npc" : "monster";
const folder = threat === "NPC" ? "5. NPC" : "3. Nepřátelé";
await tp.file.move(folder + "/" + (name || tp.file.title));
-%>
---
type: <% type %>
threat: <% threat %>
role: <% role %>
hp: <% hp %>
ref: <% ref %>
dex: <% dex %>
body: <% body %>
sp_head: 7
sp_body: 7
image:
tags:
  - <% threat === "NPC" ? "NPC" : "Monster" %>
---

```statblock
layout: CPR Character
name: <% name %>
threat: <% threat %>
role: <% role %>
desc: "Short description - who they are, what they look like."
stats: [<% s.join(", ") %>]
hp: <% hp %>
sp_head: 7
sp_body: 7
initiative: "1d10 + <% ref %>"
weapons:
  - name: "Heavy Pistol"
    desc: "**3d6** · ROF 2 · Handgun 12"
  - name: "Brawling"
    desc: "**1d6** · Brawling 10"
skills: "Athletics 8, Brawling 10, Evasion 10, Handgun 12, Perception 8, Stealth 8"
cyberware:
  - name: "Cyberoptics"
    desc: "Low-light / IR"
gear: "[[Heavy Pistol]], Agent, 50eb"
abilities:
  - name: "Role Ability"
    desc: "Describe it here, or delete this entry."
tactics: "Takes cover, flees at Seriously Wounded."
loot: "50eb"
```

> [!tip] Keep in sync
> The properties at the top (hp, ref, body, sp) are what **Roll for Initiative** uses in fights. If you change HP, REF, BODY or SP in the statblock, change them up top too.

## Notes
- 
