# Customer Doc — CS Demo Analyst

Documentation aimed at whoever **uses** the app day to day (analysts and
coaches), not at whoever touches the code. Here you'll find, field by
field, what every number on screen means, where it comes from, and how
it's calculated — with the formula behind each score written as a **math
formula**, not as programming code, so anyone who isn't a programmer can
follow along.

If you want the technical side (file names, types, implementation
decisions), that's in [README.md](../README.md) — this document is its
"translator" mirror.

---

## Table of contents

1. [How to read the formulas in this doc](#how-to-read-the-formulas-in-this-doc)
2. [Base concepts of a round](#base-concepts-of-a-round)
3. [Consolidated tab — the player score](#consolidated-tab--the-player-score)
4. [Tactical Patterns tab](#tactical-patterns-tab)
5. [Matchup tab](#matchup-tab)
6. [Quick glossary of every field](#quick-glossary-of-every-field)
7. [What these scores are NOT](#what-these-scores-are-not)

---

## How to read the formulas in this doc

Every formula here is written using only `+`, `−`, `×`, `÷` and nothing
else — it's not code, it's the same math you'd do on a calculator or a
spreadsheet. Two building blocks repeat through almost every formula in
this document:

**1. Normalizing a number onto a 0-100 scale.** Every raw metric (e.g.
"23% headshot accuracy") is converted to a 0-100 scale by comparing it
against a **reference range** — a "weak" value and an "elite" value set
for the app:

```
normalized = (value − worst_reference) ÷ (best_reference − worst_reference) × 100

If normalized < 0   → becomes 0
If normalized > 100 → becomes 100
```

Example: an Accuracy of 15%, with a reference range of 8% (worst) to
21.4% (elite):

```
normalized = (15 − 8) ÷ (21.4 − 8) × 100 = 7 ÷ 13.4 × 100 ≈ 52.2
```

For metrics where **lower is better** (reaction time, wasted grenades,
damage to teammates...), the "worst reference" is simply a number bigger
than the "elite reference" — the same math flips direction on its own.
Example: a Crosshair Placement of 12°, in a range of 18.4° (worst) to
6.2° (elite):

```
normalized = (12 − 18.4) ÷ (6.2 − 18.4) × 100 = (−6.4) ÷ (−12.2) × 100 ≈ 52.5
```

**2. Combining several normalized metrics into one score, each with its
own weight** (some count more than others):

```
category_score = ( weight₁ × normalized₁ + weight₂ × normalized₂ + ... + weightₙ × normalizedₙ )
                  ÷ ( weight₁ + weight₂ + ... + weightₙ )
```

The weights of each category (Aim, Utility, Positioning, Rating) add up to
100% within that category — the tables below already show them as
percentages to make them easier to read.

---

## Base concepts of a round

Before player scores, the app classifies every round (per side, CT and T
separately) along three axes. These classifications feed the **Tactical
Patterns** tab and the **Matchup** engine.

### Buy Type

Calculated from the **team's average equipment value** (weapon + armor +
grenades) at the start of the round:

```
buy_type =
  if average_equipment <  US$ 2,000              → "eco"
  if average_equipment <  US$ 3,000              → "force" (force buy)
  if average_equipment <  US$ 4,000              → "semi" (semi-buy)
  else                                            → "full" (full buy)
```

### Tempo and Stance

Measured by each player's **displacement** in the first 15 seconds of the
round (from freeze time to the round's midpoint) and by **how many
different map areas** the team visited in that window.

What counts as "high" or "low" displacement **is not a fixed number** — it
would be unfair to use the same ruler for Dust2 (long corridors) and Nuke
(compact map). Instead, the app looks at the displacement distribution
**of that same demo** and uses its 33rd and 67th percentile as the cutoff:

```
low_threshold  = percentile_33(displacements observed in this demo)
high_threshold = percentile_67(displacements observed in this demo)
```

With fewer than 6 valid rounds to calculate this from, the demo is too
small to trust its own percentiles, and the app falls back to a generic
fixed value (250 units / 900 units). When that happens, the demo shows up
flagged as a low calibration sample (`tempoStanceThresholdSource:
default`) — both in the UI and in the AI prompt — to warn that the
classification for that specific demo is less reliable.

```
tempo (per side, per round) =
  if average_displacement ≥ high_threshold  AND  areas_visited ≤ 1  → "rush"
  else if areas_visited ≥ 2                                          → "split"
  else if average_displacement ≤ low_threshold                       → "slow"
  else                                                                → "default"

stance (per side, per round) =
  if ≥ 60% of players had displacement ≥ high_threshold  → "aggressive"
  if ≥ 60% of players had displacement ≤ low_threshold   → "passive"
  else                                                     → "passive-aggressive"
```

### Site

The bombsite where the bomb was planted (or, with no plant, where the
round's last relevant fight happened): `A`, `B`, `mid`, or `unknown`.

---

## Consolidated tab — the player score

Every player gets 4 **sub-scores** (Aim, Utility, Positioning, Rating) and
1 **Overall score**, all on a 0-100 scale, computed **per demo** and then
averaged across every demo in the slot where the team roster was marked.
How many demos went into that average is what sets the **confidence
badge** (see below).

> An upfront warning: these reference ranges (the "worst → elite" column
> in every table below) came from an externally supplied importance
> matrix (Leetify-style) and, in some cases, from **a single** real
> stat-line (FACEIT Level 10) used as an anchor — they are not a
> statistically validated model built from a large labeled dataset. Treat
> the score as "directionally useful," not as absolute truth. Details in
> [What these scores are NOT](#what-these-scores-are-not).

### Aim score

| Field on screen | What it measures | Weight | Worst reference | Elite reference |
|---|---|---:|---:|---:|
| Accuracy | % of shots that hit any enemy (hits ÷ shots fired), guns only | 2.9% | 8% | 21.4% |
| Head Acc. | Of the shots that hit, % that landed on the head (excludes sniper and shotgun) | 10.3% | 10% | 25.9% |
| HS Kill % | % of your kills that were headshots | 5.9% | 20% | 60% |
| First Bullet | % accuracy on the **first shot** of every burst (a new burst starts after a gap > 0.4s since the previous shot) | 11.8% | 15% | 45% |
| Spray Acc. | % accuracy from the 3rd shot onward in the same burst (spray control), rifles/SMGs only | 8.8% | 17% | 41.4% |
| Counter-Strafe | % of shots fired while the player was essentially stationary (or crouched) at the moment of firing | 13.2% | 36% | 89.7% |
| Crosshair Placement | In degrees: how close your crosshair already was to the enemy the instant they appeared (lower = better) | 14.7% | 18.4° | 6.2° |
| Spotted Accuracy | % accuracy only on shots fired **after** the enemy was confirmed spotted (filters out blind wallbangs/pre-fires) | 7.4% | 16% | 39.2% |
| Time to Damage | Time (ms) between the enemy appearing and you dealing the first damage on them (lower = better) | 13.2% | 1180 ms | 393 ms |
| Time to Kill | Time (ms) between the enemy appearing and the kill (lower = better) | 11.8% | 2000 ms | 600 ms |

```
Aim score = ( 2.9% × normalized(Accuracy)
            + 10.3% × normalized(Head Acc.)
            + 5.9% × normalized(HS Kill %)
            + 11.8% × normalized(First Bullet)
            + 8.8% × normalized(Spray Acc.)
            + 13.2% × normalized(Counter-Strafe)
            + 14.7% × normalized(Crosshair Placement)
            + 7.4% × normalized(Spotted Accuracy)
            + 13.2% × normalized(Time to Damage)
            + 11.8% × normalized(Time to Kill) )
          ÷ sum of the weights actually used
```

(If some metric doesn't exist for that demo — e.g. no pitch/yaw aim
coordinates available — it simply doesn't enter the calculation, and the
sum of weights in the denominator shrinks along with it, so the score
still lands on a coherent 0-100 scale.)

### Utility score

Two parts: **70% quality** (what the grenade actually achieved) + **30%
quantity** (how many grenades you threw per round).

**Quality (70% of the Utility score):**

| Field on screen | What it measures | Weight within quality | Worst reference | Elite reference |
|---|---|---:|---:|---:|
| Flashbang Efficiency | % of flashes thrown that blinded an enemy for ≥ 1.5s | 16.4% | 29.7% | 90.2% |
| Friends Flashed *(penalty)* | Teammates blinded per flashbang thrown (a raw ratio, not a %) | 12.7% | 1.25 | 0 |
| Avg HE Dmg | Average damage dealt to enemies per HE (not counting "overkill" past the victim's remaining health) | 14.6% | 3.8 | 11.7 |
| Avg Molotov Dmg | Average damage dealt to enemies per Molotov (same overkill rule) | 12.7% | 5 | 22 |
| Team damage *(penalty)* | Average damage to teammates, HE + Molotov combined | 10.9% | 0.75 | 0 |
| Wasted smokes *(penalty)* | Smokes per round that landed within 150 units of where you were standing (an obvious waste) | 10.9% | 0.3/round | 0/round |
| Flashbangs Leading to Kills | % of flashes thrown that resulted in a teammate kill right after | 7.3% | 4.1% | 12.3% |
| Unused Utility on Death *(penalty)* | $ worth of grenades bought but **not thrown** when you die that round | 14.6% | $657.50 | $0 |

**Quantity (30% of the Utility score):** grenades thrown per round
(flashes + smokes + molotovs/incendiaries + HEs, added together), with a
reference range between 0.3 and 1.2 grenades per round.

```
quality = ( 16.4% × normalized(Flashbang Efficiency)
          + 12.7% × normalized(Friends Flashed)
          + 14.6% × normalized(Avg HE Dmg)
          + 12.7% × normalized(Avg Molotov Dmg)
          + 10.9% × normalized(team damage)
          + 10.9% × normalized(Wasted smokes)
          + 7.3% × normalized(Flashbangs Leading to Kills)
          + 14.6% × normalized(Unused Utility on Death) )
        ÷ sum of the weights actually used

quantity = normalized(grenades per round, range 0.3 → 1.2)

Utility score = quality × 70% + quantity × 30%
```

### Positioning score

| Field on screen | What it measures | Weight | Worst reference | Elite reference |
|---|---|---:|---:|---:|
| Traded Death % | % of your deaths that a teammate avenged (killed whoever killed you) within 3s and 1500 map units | 9.4% | 20% | 55% |
| Isolated Death % *(penalty)* | % of your deaths where no living teammate was within 1200 units | 9.4% | 40% | 10% |
| Trade Kill % | % of your kills that were "revenge" kills — killing whoever had just killed a teammate, within that same 3s window | 6.3% | 5% | 25% |
| Avg Trade Delay | Average time (ms) between the teammate's death and your revenge kill (lower = better) | 6.3% | 2500 ms | 1200 ms |
| Opening Duel Win% | % of times you won the round's first engagement (the round's first death involving you) | 25% | 35% | 65% |
| Overexposed Death % *(penalty)* | % of your deaths where 2+ enemies had a plausible line of sight on you at the same time (within 1600 units and a 50° field of view) | 25% | 35% | 5% |
| Avg Dist. to Teammate | Average distance to the nearest living teammate at the moment of death (lower = better, higher trade chance) | 18.8% | 1200 units | 400 units |

> "Overexposed Death" discounts justifiable exposure: bomb already planted
> (retake), you were blinded, or a smoke was active nearby — it only
> counts as "avoidable exposure" outside those cases.

```
Positioning score = ( 9.4% × normalized(Traded Death %)
                     + 9.4% × normalized(Isolated Death %)
                     + 6.3% × normalized(Trade Kill %)
                     + 6.3% × normalized(Avg Trade Delay)
                     + 25% × normalized(Opening Duel Win%)
                     + 25% × normalized(Overexposed Death %)
                     + 18.8% × normalized(Avg Dist. to Teammate) )
                   ÷ sum of the weights actually used
```

### Rating (Impact) score

Measures raw production and the real value of winning the round —
including the "sacrifice" of dying first if it still helped the team win.

| Field on screen | What it measures | Weight | Worst reference | Elite reference |
|---|---|---:|---:|---:|
| KPR | Kills per round | 35% | 0.5 | 1.0 |
| ADR | Average damage per round | 30% | 60 | 95 |
| Clutch Win % | % of clutches won (last player alive on your team, 1 vs 1+, and you won) | 15% | 15% | 50% |
| Opening Sacrifice | Of the rounds where you were the **first death**, in how many did your team still win | 20% | 30% | 60% |

```
Rating score = ( 35% × normalized(KPR)
               + 30% × normalized(ADR)
               + 15% × normalized(Clutch Win %)
               + 20% × normalized(Opening Sacrifice) )
             ÷ sum of the weights actually used
```

> "Opening Sacrifice" is different from "Opening Duel Win%" (Positioning
> score): one measures **who wins** the opening engagement, the other
> measures whether dying first bought enough information/space for the
> team to close out the round anyway.

### Overall score

A fixed blend of the four sub-scores:

```
Overall score = Aim score × 50%
              + Rating score × 25%
              + Utility score × 15%
              + Positioning score × 10%
```

### Confidence badge

Next to each player's consolidated score you'll see a **Low / Medium /
High confidence** badge — based **only** on how many demos went into that
player's average, with no statistical calculation behind it (it's not a
standard deviation or a real confidence interval):

```
confidence =
  if demos < 3   → "Low confidence"
  if demos < 8   → "Medium confidence"
  else           → "High confidence"
```

It's just a visual cue so you don't treat a 2-demo average with the same
weight as a 40-demo average.

### Model version

The grey tag next to the player's name (e.g. `v1-heuristic`) shows which
reference "ruler" produced that score. It changes when the reference
ranges are recalibrated with real data (via
`scripts/calibrate-scores.js`) — it exists so you can tell when a score
changed because the ruler changed, not because the player played
differently.

---

## Tactical Patterns tab

Consolidates, per team (yours vs. the opponent's — using the roster marked
in each demo), how each side tends to play.

### Win rate by buy type / tempo / stance

Simply the round win rate split by category:

```
win_rate(category) = rounds won in that category ÷ rounds played in that category
```

### Most recurring patterns

The exact `buy type + tempo + stance + site` combination that repeats most
often across your demo history, with occurrence count and win rate — the
top 10 most frequent show up in the tab's table; **every** combination
(with no top-10 cutoff) feeds the Matchup Engine behind the scenes.

### Player movement profile

| Field on screen | What it measures |
|---|---|
| ADR | The player's average damage per round, across every demo in the slot |
| Entry% | `successful entries ÷ entry attempts` — win rate in the round's opening engagement |
| Clutch% | `clutches won ÷ (won + lost)` |
| Favorite areas | The 5 map areas (CS2's own `last_place_name`) where the player shows up most, by position-sample count |

---

## Matchup tab

Only shown for "own" slots (your team). Cross-references your slot's
already-consolidated **Tactical Patterns** against an opponent slot's, for
a map both have in common — no AI, no token cost, fully local and
instant.

**Exploitable weaknesses** — takes every pattern the opponent tends to run
(buy type + tempo + stance + site) and cross-references it with your
historical win rate **defending** that exact pattern (from your own demo
history, not necessarily against this specific opponent):

```
your_response_rate = 100% − historical_win_rate_of_whoever_ran_that_pattern_against_you
```

**Own advantages** — the mirror: a pattern **your** team tends to run,
cross-referenced with the opponent's historical win rate defending that
same pattern.

An insight only shows up if **both sides** (whoever executes it and
whoever responds to it) have at least `3 occurrences` of that exact
pattern — below that, the app would rather show nothing than show "low
confidence" on a 1-2 round sample.

### Confidence and Severity/Strength

```
confidence = same criteria as the score's confidence badge (< 3 = low, < 8 = medium, ≥ 8 = high),
             just counting pattern occurrences instead of demos

severity / strength =
  if response_rate ≤ 30%  → "High"
  if response_rate ≤ 45%  → "Medium"
  else                     → "Low"
```

### The "inferred, not head-to-head" disclaimer

Every Matchup report carries a fixed warning on screen: since it's very
likely the two teams never actually played each other in the available
demos, this is a **statistical correlation between two separate
histories**, not an actual head-to-head track record between them.

---

## Quick glossary of every field

A quick-reference lookup — every field, its unit, and where it shows up.

| Field | Unit | Where it shows up | Direction |
|---|---|---|---|
| Accuracy | % | Aim | higher is better |
| Head Acc. | % | Aim | higher is better |
| HS Kill % | % | Aim | higher is better |
| First Bullet | % | Aim | higher is better |
| Spray Acc. | % | Aim | higher is better |
| Counter-Strafe | % | Aim | higher is better |
| Crosshair Placement | degrees (°) | Aim | lower is better |
| Spotted Accuracy | % | Aim | higher is better |
| Time to Damage | ms | Aim | lower is better |
| Time to Kill | ms | Aim | lower is better |
| Flashes / Smokes / Molotovs / HEs | count | Utility | informational |
| Flash Assists | count | Utility | higher is better |
| Enemies Flashed | % | Utility | higher is better |
| Flashbang Efficiency | % | Utility | higher is better |
| Friends Flashed | count / ratio | Utility | lower is better |
| Avg Blind / Avg Friendly Blind | seconds | Utility | context-dependent (enemy: higher is better; teammate: lower is better) |
| Avg HE Dmg / Avg Molotov Dmg | damage | Utility | higher is better |
| Avg HE Team Dmg / Avg Molotov Team Dmg | damage | Utility | lower is better |
| Wasted smokes | count | Utility | lower is better |
| Rounds w/ unused utility | count | Utility | lower is better |
| Unused value | US$ | Utility | lower is better |
| Opening Duel Win% | % | Positioning | higher is better |
| Opening Duel Participation | % | Positioning | context (involvement, not quality) |
| Traded Death % | % | Positioning | higher is better |
| Isolated Death % | % | Positioning | lower is better |
| Trade Kill % | % | Positioning | higher is better |
| Trade Kills | count | Positioning | informational |
| Avg Trade Delay | ms | Positioning | lower is better |
| Overexposed Death % | % | Positioning | lower is better |
| Avg Dist. to Teammate | map units | Positioning | lower is better |
| Kills / Deaths / Assists | count | Rating | informational |
| KPR | kills/round | Rating | higher is better |
| ADR | damage/round | Rating | higher is better |
| Clutches Won / Lost | count | Rating | informational |
| Clutch Win % | % | Rating | higher is better |
| Rounds Opened / Rounds Opened and Won | count | Rating | informational |
| Opening Sacrifice | % | Rating | higher is better |

---

## What these scores are NOT

- **They are not a statistically validated model.** The weights came from
  an externally supplied importance matrix (0-5 per metric,
  "Leetify-style"), not from a regression fit against a large labeled
  match dataset.
- **The "floor" and "ceiling" reference values, for most metrics, came
  from a single real stat-line** (a FACEIT Level 10 player) used as an
  anchor, not from a statistical sample. The Positioning score in
  particular doesn't have any real reference point yet — its ranges are a
  competitive-CS heuristic, still to be calibrated.
- **The confidence badge and the Matchup's severity are not real
  confidence intervals** — there's no standard deviation or statistical
  test behind them, it's just a sample-size count meant to signal "trust
  this less" vs. "trust this more."
- **The Matchup is never an actual head-to-head record** between the two
  teams — it's an inference cross-referencing two separate histories.
- **Some round-level fields match players by name, not Steam ID** (e.g.
  who died first in the round) — it's the only information available at
  that point in the parser, but in theory two players with the same
  displayed name could collide.
- Run `node scripts/calibrate-scores.js <path-to-demos-folder>`
  periodically to recompute the reference ranges from real percentiles of
  your own demo pool instead of a single reference point — see the
  "Recalibrating the ranges" section in [README.md](../README.md) for the
  step-by-step.
