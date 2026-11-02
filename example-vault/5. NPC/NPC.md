---
tags:
  - Index
---
# NPC

Friendly and neutral characters: fixers, contacts, clients, ripperdocs.
New ones: create a note → **Templater: Open insert template modal** → **CPR NPC** → pick **NPC (contact, civilian)**. It lands here automatically.

```dataview
TABLE WITHOUT ID file.link AS "NPC", role AS "Role", threat AS "Type", hp AS "HP"
FROM "5. NPC"
WHERE type = "npc"
SORT file.name ASC
```
