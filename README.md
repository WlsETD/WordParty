# Handoff: 接字派對 Word Chain Party — Full UI + Scene Assets

## Overview
A web party game where players chain English words. It supports 2–10 players, who join with a 4-character room code. There are two interfaces:
- **Host screen**: TV or laptop, 1920×1080, 16:9, viewed from a distance. It shows the shared game state.
- **Player phone**: 390×844, portrait, used one-handed. It is the controller: join, type words, use items.

There are 7 modes: 閃電搶答 Flash, 精準接龍 Precise, 炸彈傳遞 Bomb Pass, 末位淘汰 Last-place Elimination, 組隊接力 Team Relay, 合作長龍 Co-op Long Chain, 陷阱接龍 Trap Chain.

## About the Design Files
The `.dc.html` files in this bundle are **design references built in HTML**. They show the intended look and motion; they are not production code. Recreate them in the target codebase's environment (e.g. React + Vite, Next.js, Svelte) using its patterns. If no codebase exists yet, a good default is React + TypeScript + CSS Modules or Tailwind, Framer Motion for animation, and WebSocket (e.g. Socket.IO or PartyKit) for room sync.

To view a file, open it in a browser next to `support.js`. Each file includes its own runtime; the `<script>` logic at the bottom of each file holds the mock data.

## Fidelity
**High-fidelity.** Colors, type, spacing, outlines, shadows, copy and animation timings are final. Recreate them pixel-accurately.

The character, bomb and icon artwork is generated as inline SVG strings in `Avatar.dc.html`, `Bomb.dc.html` and `Sprite.dc.html`. Port those SVG paths directly into components; they are the source of truth for the art.

## Visual Language
Thick-painted cartoon party look: every object is a "sticker" placed on a stage.
- **Outline:** `#14112F` (the "ink" color, used instead of pure black). Widths: 3px for details, 4px on phone, 5px standard, 6–8px on TV.
- **Shadow:** a hard drop shadow straight down with zero blur: `0 5px 0 #14112F` (sm), `0 8px 0` (md), `0 14px 0` (lg).
- **Highlight:** a small white ellipse at 55–70% opacity in the top-left of objects.
- **Tape:** a translucent rectangle, 90–140 wide × 28–40 tall, rotated ±3–8°, in yellow, cyan, orange or white at 60–80% opacity. Used on info cards.
- **Big headlines:** use `-webkit-text-stroke: 8–18px #14112F; paint-order: stroke fill;` plus `text-shadow: 0 Npx 0 #14112F`.
- **Never use color alone to carry meaning.** Every state also has a shape or icon (see the table below).

## Design Tokens
### Colors
| Token | Hex | Use |
|---|---|---|
| bg | #1E1B4B | Global background, stage |
| ink | #14112F | Outlines, shadows, text on light fills |
| panel | #2C2870 | Dark cards, panels |
| panel-2 | #3A3580 | Leaderboard rows, inner panels |
| magenta | #FF3D81 | Primary button, error, bomb danger, Team A |
| yellow | #FFD23F | Selected, ending letter, 1st place, timer mid-range |
| cyan | #2EE6D6 | Correct, progress, co-op, Team B |
| orange | #FF8A3D | Warning, danger zone, trap, 3rd place |
| white | #FFFFFF | Card fill, letter tiles |
| Support tints | #FF8FB5 pink, #FFB98A peach, #9AF5EC light cyan, #A79BFF lavender, #C9CCE8 cloud (secondary text on dark), #4A4590 locked, #8D8AB8 disabled, #5B54C9 accent text on white, #3A1640 danger panel, #C2306A bomb critical |

Contrast rules:
- On magenta, use ink text (5.3:1). White text on magenta is allowed only for headlines that have the ink stroke.
- Ink on yellow, cyan, orange or white all pass AA.

### State encoding (shape + color)
| State | Color | Shape / icon |
|---|---|---|
| Correct | cyan | ✓ circle |
| Error / already used | magenta | ✕ circle + 420ms shake |
| Warning / danger | orange | triangle with "!" + hazard stripes |
| Locked letter | #4A4590 | 45° stripes + lock badge |
| Ending letter | yellow | glow + dashed outer ring |
| Team A / Team B | magenta / cyan | circle / triangle |
| Lost life | #8D8AB8 | heart with a crack |

### Typography
- **Display:** `'Fredoka', 'Huninn' (粉圓), sans-serif`, weight 700. Fredoka renders Latin and digits; CJK characters fall back to Huninn.
- **Body:** `'Nunito', 'Noto Sans TC', sans-serif`, weights 700–900. Never use a weight below 700.
- Google Fonts URL: `https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Huninn&family=Nunito:wght@600;700;800;900&family=Noto+Sans+TC:wght@500;700;900&display=swap`

TV scale:
| Style | Size | Font | Example |
|---|---|---|---|
| Display XL | 400–440 | Display | countdown |
| Display L | 200–230 | Display | logo |
| H1 | 72–96 | Display | |
| H2 | 48–64 | Display | |
| H3 | 40–44 | Display | |
| Body L | 32–36 | Body 900 | |
| Caption | **28 (minimum)** | Body 800 | |

Phone scale:
| Style | Size | Font |
|---|---|---|
| Display | 44–54 | Display |
| H1 | 28–30 | Display |
| H2 | 22–24 | Display |
| Input | 42 | Display |
| Body | 17–19 | Body 900 |
| Small | 14–15 (minimum) | Body 800 |

### Spacing, radius, shadow
- **Spacing:** 4-based scale: 4, 8, 12, 16, 24, 32, 48, 64, 96. TV safe margin is 64px.
- **Radius:**
  - 12: tags
  - 20: inputs, phone cards
  - 24–28: cards, buttons
  - 32–40: TV panels
  - 999: pills
- **Shadow:** sm, md and lg as described in Visual Language.

## Components (see `Design System.dc.html`)
### Button
- **Primary:** fill magenta, 5px ink border, radius 24, shadow `0 7px 0 ink`. Label in Display font with a 4px ink stroke, white fill.
- **Secondary:** fill yellow, ink text.
- **Confirm:** fill cyan, ink text.
- **Ghost:** 4px white border, no fill.
- **Icon button:** 72px circle, white fill.
- **Disabled:** fill #4A4590, 5px dashed #8D8AB8 border, 70% opacity.
- **States:**
  - Hover: `translateY(-3px)`, shadow grows to 10px.
  - Pressed: `translateY(6px)`, shadow drops to 1px, 120ms `cubic-bezier(.3,0,.5,1)`.
  - Focus: `0 0 0 4px bg, 0 0 0 8px #FFD23F` ring.
- **Sizes:** TV height 150 (hero) or 170 (Start), font 64–76. Phone height 68–76, font 28.

### Card
- **Mode card:** 186×246, panel fill.
  - Selected: yellow fill, `translateY(-16px) rotate(-2deg)`, check badge at the top-right.
  - Disabled: dashed border, lock icon, 60% opacity.
- **Player slot:**
  - Filled: panel fill, avatar 120, name 30px.
  - Empty: 5px dashed `rgba(255,255,255,.35)` border, "+" circle, label 「等待加入」.
- **Info card:** white fill, tape strip, slight rotation.

### Input
- Default: white fill, 4px ink border.
- Focus: 5px cyan border + 4px ink outline.
- Error: #FFE6EF fill, 5px magenta border, ✕ icon, shake.
- Success: #E0FBF8 fill, cyan border, ✓ icon.
- **Room code:** 4 boxes. Filled boxes are white; the current box is #FFF8D6 with a 5px dashed yellow border and a blinking caret.

### Timer bar
- Pill shape, ink track.
- Above 50%: cyan fill. 25–50%: yellow fill.
- Below 25%: magenta/orange 45° stripes, and the icon switches to the warning triangle and shakes (120ms loop).
- Ring timer: conic-gradient fill with a white inner disc showing the number.

### Leaderboard row
Row height 110 on TV, 78 on phone. Contents, left to right: rank badge, avatar, name, score, movement.
- **Rank badge:**
  - 1st: crown sprite.
  - 2nd and 3rd: medal circle with the number (silver #E6E8F7, bronze #FF8A3D).
  - 4th and below: plain number.
- **Row fill:** 1st is yellow; others are #3A3580; the player's own row gets a yellow border; an eliminated row is dashed and dimmed.
- **Movement:** ▲ / ▼ / — glyphs.

## Screens — Host TV (1920×1080, `TV Screens.dc.html`)
Every screen sits on `StageBG`: lobby mood for all modes except Bomb, which uses tense mood. Most game screens add a darkening overlay of `rgba(20,17,47,.35–.55)`.

1. **01 Home**
   - Row of letter tiles: C A T, a link ring, T O P.
   - Logo 「接字派對」 at 230px with an 18px stroke, rotated -3°.
   - Magenta ribbon reading "WORD CHAIN PARTY".
   - 「建立房間」 button: 150px tall, with a yellow "+" disc.
   - 「怎麼玩？」 link.
   - Avatars peek up from the bottom edge, bobbing.
2. **02 Lobby**
   - Left: white card 560×500 containing:
     - room code as 4 LetterTiles at 108px
     - QR code 196px
     - 「jiezi.party」
   - Right: player grid, 5×2, each cell 200px tall. The host has a crown. Header shows 「6 / 10」 in a cyan pill.
   - Bottom: 7 mode cards and a 170px-tall 「開始！」 button.
3. **03 Countdown**
   - Rotating yellow rays.
   - 600px magenta disc.
   - Numbers 3 → 2 → 1 → GO! at 440px, 1s each.
   - Mode chip at the top; 「看向你的手機！」 at the bottom.
4. **04A Flash**
   - Top: mode chip, a 64px-tall timer bar, 「12s」.
   - Glowing starting-letter tile at 270px.
   - Grid of grabbed words, 3 columns of 86px chips (avatar, word, +points). The newest chip is yellow with a NEW tag.
   - Right: 470px leaderboard panel with 6 rows.
5. **04B Precise**
   - Six 132px lanes. Each lane has:
     - avatar 92 and name
     - "最新 WORD"
     - a 52px progress track with 5 checkpoint dots and a finish flag
     - a flame (3 tiers) with ×combo
     - 3 error slots (✕ or a dashed empty circle)
   - A lane with 3 errors gets a #3A1640 fill and a bombed face.
6. **04C Bomb Pass**
   - 10 players on an ellipse: centre (960,560), rx 740, ry 340, starting at the top and going clockwise in 36° steps.
   - Each node: avatar 128, name pill, 3 hearts at 34px.
   - Holder: yellow glow, rotating dashed ring, blinking 「接招！」 tag, avatar jitter.
   - Centre card 640×340 shows the previous word as tiles, with the last letter glowing, and 「Kiki：接 R 開頭！」.
   - Throw animation: the bomb travels a quadratic arc from the previous holder to the new holder using `offset-path` (see the timing table). A dashed white trail shows the arc.
   - An eliminated player gets an 「出局」 stamp.
7. **04C-2 Explosion**
   - Whole-screen shake, white flash, BOOM starburst at 360px on the holder.
   - Large 「BOOM!」 text at 200px.
   - A "-1 💔" (cracked-heart icon) floats up.
   - Status card: 「Kiki 剩 1 條命 · 下一位 大雄」.
8. **04D Last-place Elimination**
   - 5×2 cards, each 388px tall: rank, avatar 170, name, score.
   - Lowest surviving player: hazard-stripe top band, dashed orange border, 「危險區」 tag, jitter.
   - Eliminated players: card in grayscale plus a magenta stamp 「淘汰 OUT」 rotated -14°.
   - 110px ring timer at the top-right.
9. **04E Team Relay**
   - Left panel 洋紅隊 (Team A, circle marker) and right panel 青綠隊 (Team B, triangle marker), each 420px wide: big score / 20, member rows, a 「接力中」 badge for the active player.
   - Centre: vertical zigzag chain of word chips (team marker, avatar, word with the last letter in a yellow box). Chips are joined by link rings colored per team; the top of the chain fades out.
   - Bottom: dashed yellow "next" slot reading 「E _ _ _ _」 with a timer.
10. **04F Co-op Long Chain**
    - 「23 / 30」 counter.
    - 1400px progress bar with star milestones at 1/3 and 2/3 and a trophy at the end.
    - Horizontal chain: word chips alternate ±30px vertically, a link ring between each, the left edge fades, and the chain drifts slowly.
    - The next slot shows 「T ?」.
    - Bottom: avatar row with a ×contribution badge on each.
11. **04G Trap Chain**
    - Left: current-player card with a ring timer.
    - Centre: current word as 150px tiles; the last letter is 170px, glowing, inside an 8px yellow frame with a glow. Below it: 「下一個字以 Y 開頭 ↓」 and the history of previous words.
    - Right: 本輪陷阱 (this round's traps) card with locked tiles E and S plus rule rows.
    - Bottom: magenta toast announcing an item hit.
12. **05 Round Results**
    - 8 horizontal bars: rank, avatar, name, bar with +score. Width is proportional to the top score. Colors cycle through the palette, but every bar is also labelled with a number.
    - MVP card on the right: yellow, rotated 2.5°, spinning rays behind it. Contains a "MVP" ribbon, a crowned avatar at 260px, name, +score and the longest word.
13. **06 Final Awards**
    - Banner at the top.
    - Podium blocks in the order 2 – 1 – 3, each 400 wide; heights 330, 470, 240; colors silver, gold, bronze. Each block shows a trophy and the rank number.
    - Avatars stand on the blocks; the winner wears the crown.
    - Confetti, plus 「再玩一局」 and 「回大廳」 buttons.

## Screens — Phone (390×844, `Phone Screens.dc.html`)
Status bar is 44px. Main actions sit in the bottom half (thumb zone). On input screens, the system keyboard occupies about the bottom 290px; the Send button always sits directly above it.

- **P1 Join:** logo; 4 room-code boxes (78px tall); nickname input (58px, with an "n / 8" counter); a 4×3 character picker (74px cells; the selected cell gets a cyan border and a check badge); 「加入派對！」 button, 68px.
- **P2 Waiting:**
  - 「已加入房間 PQ7K」 pill.
  - Bobbing avatar at 190px over rotating rays.
  - Name, then 「等待主持人開始…」.
  - Stacked joined-player avatars.
  - Tip card with tape.
  - 「換角色」 ghost button.
- **P3 Input:**
  - Mode chip and score.
  - Timer bar (22px).
  - Prompt card: glowing letter tile, 「用 S 開頭！」, words already grabbed, 2 item buttons (48px, each with a count).
  - Input 86px tall: 42px Fredoka with a magenta caret, cyan focus border.
  - 「送出 →」 button, 72px.
- **P3B Error:**
  - Magenta banner 「RABBIT 已經用過了！再想一個」 with ✕.
  - Input turns pink with a magenta border and ✕, and shakes for 420ms.
  - Trigger the phone's vibration (`navigator.vibrate(120)`).
  - The timer is in its critical state; the bomb is critical.
- **P4 Spectator** (shown after elimination):
  - Out-face header: 「你被淘汰了… 但還能搗蛋！」.
  - 2×2 item cards, 138px tall. Each card has an icon, a name, an effect and a ×count. Cards can be selected (yellow), on cooldown (conic overlay showing 「12s」) or unavailable (dashed border, 45% opacity).
  - Target picker: horizontal avatars; the selected one gets a yellow ring.
  - Pulsing primary button: 「丟沙漏給 Momo！」.
- **P5 Results:**
  - Placement with a trophy.
  - Score avatar.
  - Score in 54px yellow, and the gap to 1st place.
  - 2×2 stat cards: 最長單字 (longest word), 最高連擊 (best combo), 成功單字 (words accepted), 道具使用 (items used).
  - 「再玩一局」 primary button and 「離開房間」 ghost button.

## Scene Assets (`Scene Assets.dc.html`; source in the child components)
- **Bomb** (`Bomb.dc.html`, viewBox 170)
  - States, by remaining fuse length:
    - idle: 100%, smile, ±4° wobble over 2s
    - fuse1: 72%
    - fuse2: 46%, brows
    - fuse3: 22%, sweat, wobble 0.6s
    - critical: 6%, body #C2306A, magenta glow, 90ms shake, panic face
    - boom: 12-point starburst with "BOOM!", 450ms snap pop
  - The fuse is a cubic Bezier from P0(116,42) through P1(130,8), P2(158,40) to P3(156,6). Sample it from t = 0 to the remaining fraction; the spark sits at the endpoint.
- **Spark:** 3 frames — a 4-point star, an 8-point burst and a white 6-point flash. Swap frames every 160ms with `steps(2)` (90ms when critical).
- **Avatars** (`Avatar.dc.html`, viewBox 120)
  - 12 characters:
    - 0 cat #FF3D81
    - 1 bear #FFB98A
    - 2 bunny #FFFFFF
    - 3 frog #9AF5EC
    - 4 robot #C9CCE8
    - 5 alien #A79BFF
    - 6 ghost #F4F1FF
    - 7 octopus #FF8FB5
    - 8 chick #FFD23F
    - 9 dino #2EE6D6
    - 10 penguin #6A62E0
    - 11 fox #FF8A3D
  - 4 moods:
    - normal
    - score: ^^ eyes, open mouth, sparkles
    - bombed: dazed eyes, wavy mouth, soot, smoke puffs
    - out: X eyes, flat mouth, grayscale filter
- **LetterTile** (`LetterTile.dc.html`)
  - Variants:
    - normal: white
    - glow: yellow + glow + pulsing dashed ring (marks the ending letter)
    - locked: #4A4590 + stripes + lock badge
    - active: magenta
    - used: cyan
  - Sizing formulas (s = tile size): radius = s × 0.22, border = s × 0.05, font size = s × 0.6, shadow = 0 (s × 0.07) 0 ink.
- **Sprite icons** (`Sprite.dc.html`, viewBox 100)
  - Status objects: heart (full / lost / empty), flame (1 / 2 / 3), crown, trophy (gold / silver / bronze)
  - Items: hourglass, lock, shield, star2x
  - Other art: star, link (y / c / m / o / w), balloon (m / y / c / o), spark (a / b / c)
  - Mode icons: zap, target, bomb, out, team, coop, trap
  - Feedback icons: check, cross, slot, clock, flag
- **Items:**
  - 縮時沙漏 Hourglass: target loses 3s
  - 封鎖鎖頭 Lock: blocks one letter for the next player
  - 護盾 Shield: blocks one explosion or one error
  - 雙倍星星 Star ×2: next word scores double
- **StageBG** (`StageBG.dc.html`)
  - lobby mood:
    - garland of candy-colored flags alternating with warm bulbs (sags in 2 scallops of 120px)
    - 2 white spotlight cones sweeping ±14° over 6s
    - balloon clusters on both sides, floating
    - elliptical stage floor
  - tense mood (Bomb mode):
    - red/orange bulbs blinking every 0.5s
    - magenta cones sweeping over 2.4s
    - rising embers
    - yellow/ink hazard band at the bottom
    - magenta vignette pulsing every 1.1s, plus a dark vignette

## Interactions & Animation
Easing curves:
- **overshoot** = `cubic-bezier(.34,1.56,.64,1)`
- **snap** = `cubic-bezier(.2,1.4,.4,1)`
- **expo-out** = `cubic-bezier(.22,1,.36,1)`

| Animation | Duration | Easing | Notes |
|---|---|---|---|
| Button press | 120ms (release 160ms ease-out) | (.3,0,.5,1) | down 6px, shadow → 1px |
| Card / player join pop | 320ms | overshoot | scale .4 → 1.12 → 1, stagger 60ms |
| Countdown digit | 1000ms each | overshoot | scale 2.4 → .92 → 1, fade out over the last 200ms; GO! is yellow with a 120ms white flash |
| New word pop | 280ms | overshoot | yellow + NEW tag for 2s, then turns white |
| Timer bar | length of the round | linear | below 25%: stripes + icon shake 120ms |
| Input error shake | 420ms | ease-in-out | X offsets 0, −14, 12, −8, 6, 0; vibrate 120ms |
| Fuse spark | 160ms (critical 90ms) | steps(2) alternate | scale .75 ↔ 1.3, rotate 25° |
| Bomb idle / critical | 2s / 90ms | ease-in-out / linear | ±4° wobble / position shake |
| Bomb throw | 600ms | (.45,0,.55,1) | along a quadratic arc with apex 240px above, rotate 720°, landing squash 1.18 / .82 over 120ms |
| Explosion | 450ms | snap | scale .2 → 1.2 → 1; white flash 120ms; screen shake 300ms; "-1" floats up over 1.2s |
| Elimination stamp | 350ms | snap | scale 3 → 1, rotate −12° (−14° on TV); card goes grayscale over 400ms |
| Combo flame | 400ms | ease-in-out alternate | scaleY 1.1; tier changes at 3 and 6 |
| Bar chart grow | 800ms | expo-out | scaleX from the left, stagger 60ms |
| MVP pop / rays | 500ms / 12s | overshoot / linear | |
| Podium rise | 600ms | expo-out | order 3rd → 2nd → 1st, 200ms apart; crown drops last |
| Confetti | 2.6–4.2s | linear loop | random delay 0–3s, rotate 720°, 5 colors × circle/rectangle |
| Balloon / avatar idle | 2.4–3.8s | ease-in-out alternate | 12–20px float, phase offset |
| Bulbs / spotlights | 1.6s / 6s (tense: 0.5s / 2.4s) | steps / ease-in-out alternate | |

`prefers-reduced-motion`:
- Replace shakes and screen shake with a 150ms opacity flash.
- Stop confetti and spotlight sweeps.
- Keep only essential fades.

## State Management (suggested)
- **Room:** code; hostId; players[] (id, name, avatarKind 0–11, connected, lives, score, eliminated, team); mode; phase (`lobby | countdown | playing | roundResult | final`); round; totalRounds.
- **Turn:** currentWord, requiredLetter (the last letter of currentWord), activePlayerId(s), deadline (server timestamp), usedWords (Set), blockedLetters[], trapRules[].
- **Mode-specific:**
  - flash: startLetter, grabbed[] (word, playerId, points)
  - precise: per-player progress, combo, errors
  - bomb: holderId, fuseStage (derived from the remaining-time fraction), lastThrow (from, to)
  - team: teams[2] (score, members, chain[])
  - coop: chain[], target
  - trap: as Turn above
- **Phone (local):** input text, validation result (`idle | sending | ok | error(reason)`), items (type, count, cooldownUntil), selectedTarget.
- **Server-authoritative:** word validation (dictionary + already-used + blocked letters + trap rules) and the timers. Clients render from `deadline` so countdowns stay in sync.

## Assets
- All artwork is original vector art defined in the component files; there are no external images.
- Fonts come from Google Fonts: Fredoka, Huninn, Nunito, Noto Sans TC.
- The QR code is a placeholder; generate a real one from the join URL `https://jiezi.party/PQ7K`.

## Files
- `TV Screens.dc.html`: all 13 host screens; mock data is in the logic class at the bottom.
- `Phone Screens.dc.html`: 6 phone screens.
- `Design System.dc.html`: tokens, components, animation table with live previews.
- `Scene Assets.dc.html`: catalogue of every asset and state.
- `Avatar.dc.html`, `Bomb.dc.html`, `Sprite.dc.html`, `LetterTile.dc.html`, `StageBG.dc.html`: reusable art components; their SVG source is in each file's logic class.
- `support.js`: the runtime needed only to open these HTML references in a browser. Not needed in production.
"# WordParty" 
"# WordParty" 
"# WordParty" 
"# WordParty" 
