<%*
// ---- Cyberpunk RED item (Templater) ----
const name = await tp.system.prompt("Item name", tp.file.title);
const category = await tp.system.suggester(
  ["Weapon", "Armor", "Cyberware", "Gear", "Drug", "Program"],
  ["Weapon", "Armor", "Cyberware", "Gear", "Drug", "Program"]
);
const sub = {"Weapon": "Zbraně", "Armor": "Zbroj", "Cyberware": "Cyberware", "Gear": "Vybavení", "Drug": "Drogy", "Program": "Netrunning/Programy"}[category] ?? "";
await tp.file.move("4. Předměty/" + (sub ? sub + "/" : "") + (name || tp.file.title));

// extra properties per category (only these show up on the card)
const extra = {
  "Weapon":    "type: Heavy Pistol\ndamage: 3d6\nrof: 2\nmagazine: 8\nskill: Handgun\nhands: 1\nconcealable: true",
  "Armor":     "type: Light Armorjack\nsp: 11\npenalty: 0",
  "Cyberware": "type: Fashionware\nhumanity_loss: 2d6 (7)\ninstall: Clinic\nslots: \"-\"",
  "Gear":      "type: Tool",
  "Drug":      "type: Street Drug\nduration: 1 hour",
  "Program":   "type: Booster",
}[category] ?? "";
-%>
---
cssclasses:
  - cpr-item
tags:
  - Item
category: <% category %>
quality: Standard
<% extra %>
cost: 100eb
availability: Common
effects:
  - "Describe special rules here"
source: ""
---

```dataviewjs
await dv.view("_scripts/cpr-item-card")
```

Description, history, who sells it, where the party found it...
