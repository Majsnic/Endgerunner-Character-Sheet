---
cssclasses:
  - cpr-home
---
# <span class="cpr-home-head">Crew</span>
`BUTTON[pc]`

```base
formulas:
  Info: |
    "⚔️ " + role + " | ⭐ Rank " + rank.toString()
  HP: |
    "❤️ HP " + hp_current.toString() + " / " + hp.toString()
  SP: |
    "🛡️ SP head " + sp_head.toString() + " · body " + sp_body.toString()
  Stav: |
    if(conditions.length > 0, "⚠️ " + conditions.join(", "), "✅ OK")
views:
  - type: cards
    name: Crew
    filters:
      and:
        - file.inFolder("2. Hráči")
        - file.hasTag("Player")
    order:
      - file.name
      - formula.Info
      - formula.HP
      - formula.SP
      - formula.Stav
    image: note.image
    imageAspectRatio: 1.6
    imageFit: contain
    cardSize: 230
  - type: table
    name: Přehled
    filters:
      and:
        - file.inFolder("2. Hráči")
        - file.hasTag("Player")
    order:
      - file.name
      - role
      - hp_current
      - hp
      - sp_head
      - sp_body
      - conditions
      - death_save_penalty
      - luck_current
```

<div style="height: 30px;"></div>

# <span class="cpr-home-head">NPC</span>
`BUTTON[npc]`

```base
formulas:
  Info: |
    if(role, "💼 " + role, "")
views:
  - type: cards
    name: NPC
    filters:
      and:
        - file.inFolder("5. NPC")
        - type == "npc"
    order:
      - file.name
      - formula.Info
    image: note.image
    imageAspectRatio: 1.6
    imageFit: contain
    cardSize: 200
```

<div style="height: 30px;"></div>

> [!danger]- Nepřátelé
> `BUTTON[enemy]`
>
> ```base
> views:
>   - type: table
>     name: Nepřátelé
>     filters:
>       and:
>         - file.inFolder("3. Nepřátelé")
>         - type == "monster"
>     order:
>       - file.name
>       - threat
>       - hp
>       - ref
>       - body
>       - sp_head
>       - sp_body
>     sort:
>       - property: hp
>         direction: ASC
> ```

> [!example]- Předměty
> `BUTTON[item]`
>
> ```base
> views:
>   - type: table
>     name: Vše
>     filters:
>       and:
>         - file.inFolder("4. Předměty")
>     order:
>       - file.name
>       - category
>       - type
>       - cost
>       - damage
>       - sp
>       - humanity_loss
>     groupBy:
>       property: category
>       direction: ASC
> ```

> [!warning]- Stavy
> ```base
> views:
>   - type: table
>     name: Stavy
>     filters:
>       and:
>         - type == "condition"
>     order:
>       - file.name
>       - quality
>       - roll
>       - quick_fix
>       - treatment
> ```
