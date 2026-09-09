# DVEA — Visual Direction V1 · Implementation Spec

**Concept:** The app reads as a **technical document rendered in a terminal** — numbered
sections separated by hairline rules instead of cards, a line-number gutter on every
payload, diff-colored fixes, and crimson used at only a few percent of pixels.

The existing **observability panel** is the reference the rest of the app matches. (It was
lost and must be rebuilt to this spec as part of this pass — see Implementation notes.)

> **Note on accent color:** this spec uses crimson (`#E91841`) as the brand accent. The
> DVEA logo currently uses a green terminal mark; that clash is a known, deferred item —
> resolve the logo/app accent later. For now, implement the tokens below as written.

---

## 01 · Reference screen — module page

Fixed section order for every module page:

```
[chrome bar]  X ~/modules/open-redirect      severity 3/5   HOOKS ARMED
[breadcrumb]  ../ all modules
[title]       MOD.01  (Orbitron title with 2px crimson underrule)
[meta row]    deep-link · main-process · difficulty ###  medium · phishing vector
[lede]        One-line Inter description of the vuln.

01 GUIDE — what is happening
   Prose explanation of the mechanism.

   PAYLOAD · <title>                                    [copy]
   1  dvea://?redirect=https://attacker.tld/login
   2  # no allowlist, no scheme check, no address bar

02 IMPACT
   !! Impact statement (callout, critical treatment).

03 FIX  main/protocol.js
   -  win.loadURL(url.searchParams.get('redirect'))       (diff del, tinted row)
   +  const target = new URL(raw)                          (diff add, tinted row)
   +  if (!ALLOWED.includes(target.origin)) return
   +  win.loadURL(target.href)

04 REFERENCES
   — Electron security checklist entries
   — CWE / CVE references

05 DEMO
   One-line description. Fires the same unvalidated code path.
   [ field: redirect=https://example.com ]  [RUN EXPLOIT]  [reset]
   12:04:19.882  main  protocol  dvea:// -> parse ok       (log tail, panel style)
   12:04:19.884  warn  loadURL(untrusted) — no allowlist applied
```

---

## 02 · Tokens — paste into a single theme.css (:root custom properties)

### Surfaces & ink
```
--bg-app         #0A0B0D
--bg-panel       #0C0D10
--bg-raised      #101216
--bg-code        #07080A
--border-subtle  #191D24
--border-default #22262E
--border-strong  #2C313A
--text-primary   #F5F6F8
--text-body      #C6CBD2
--text-muted     #8A9099
--text-faint     #4A5058
```

### Accent & semantic
```
--accent         #E91841
--accent-hover   #C4123A
--accent-text    #FF4D6D
--accent-wash    #160A0E
--critical       #E5484D
--warning        #F5A623
--success        #16A75C
--info           #3B82F6
--diff-add       #4ED18C
--diff-del       #FF8A8D
```

**Crimson is brand-only:** primary action, section numerals, the header rule, focus ring,
live dot. Threat state is `--critical`/`--warning` — never crimson, so "danger" and
"brand" never read the same.

### Type & space
- `--font-display` **Orbitron 800** — page titles, wordmark, index hero. Uppercase, never body.
- `--font-body` **Inter 400/600** — prose, guide text, descriptions. 15.5px / 1.7.
- `--font-mono` **ui-monospace stack** — chrome, tags, paths, payloads, logs, metrics, all UI labels.
- Ramp: 32 display / 16 lede / 15.5 body / 13.5 code / 12 log / 11 chrome / 10.5 eyebrow.
- Eyebrows: uppercase, letter-spacing .16em, 11px, section-colored numeral + white label.
- 4px grid. Section gap 34px, block gap 20px, page padding 28px 44px.
- Radius: 0 for panels/rules, 6px for controls only.
- Measure caps at 800px.
- Motion: 120/180ms, ease-out, no bounce. Only looping animation is the live status dot
  and the demo caret.

---

## 03 · Component treatments

**Buttons** · 6px radius, no scale on press. Hover primary → `#C4123A`. Focus → 3px
`rgba(233,24,65,.4)` ring, never removed. One crimson button per screen.
Variants: `RUN EXPLOIT` (primary), `reset`, `force unsafe` (danger), `disabled`.

**Tags & difficulty** · Tags are square, hairline, lowercase (`deep-link`, `ipc`,
`dvea://`). Difficulty is a **three-block meter** (EASY / MED / HARD), not a pill —
encodes value and level in one glyph.

**Inputs** · placeholder `payload…`; mono.

**Callouts** · 3px left bar, wash fill, no radius, mono uppercase label inline with Inter body:
- `!! IMPACT` (critical)
- `! NOTE` (warning)
- `check FIX` (success)

**Code block** · titled, gutter (line numbers), copy affordance:
```
preload.js                                              [copy]
1  contextBridge.exposeInMainWorld('api', {
2    run: (cmd) => ipcRenderer.invoke('shell:run', cmd)
3  })
```

**Section header** · the core structural device. `01 GUIDE  what is happening`. Numerals
are section-colored, labels always white, rule inherits the section's hue. This replaces
every card border in the current app.

Inline `code`: mono 13.5px, `--accent-text` on `--accent-wash`, 1px default border, 1px 5px padding.

---

## 04 · Build brief — hand this to Claude Code

Restyle the DVEA renderer to the "terminal manpage" direction above. Structure and markup
semantics stay; the visual layer is replaced wholesale. No new dependencies, no CSS
framework, no component library — plain CSS custom properties plus a small set of BEM-ish
class names.

- Create `renderer/styles/theme.css` holding every token from section 02 as `:root` custom
  properties.
- Bundle Orbitron (800) and Inter (400/600) locally as woff2 under
  `renderer/assets/fonts/` with `@font-face` and `font-display:swap` — no remote font
  requests (the app ships offline and the CSP must stay strict).
- **Delete every hardcoded hex in existing stylesheets; nothing outside `theme.css` may
  name a color.**

Build these in `renderer/styles/components.css`, matching section 03 exactly:
- `.chrome-bar` — app strip: mark + wordmark, breadcrumb path, severity, pulsing live dot.
- `.sec / .sec__num / .sec__label / .sec__rule / .sec__hint` — numbered section header;
  modifier classes `--brand --critical --success --muted` set numeral and rule color.
- `.code / .code__title / .code__gutter / .code__body` — titled payload block with line
  numbers and copy button.
- `.diff` with `.diff__del / .diff__add` — full-bleed tinted rows, +/- prefixes as content,
  not glyph spans.
- `.callout--critical / --warning / --success` — 3px left bar, wash fill, mono uppercase
  label inline with Inter body.
- `.tag, .tag--brand, .meter` (difficulty three-block), `.btn / .btn--primary /
  .btn--danger, .field, .logline`.
- `code` inline: mono 13.5px, accent-text on accent-wash, 1px default border, 1px 5px padding.

Rewrite the module template to the fixed section order shown in 01: chrome bar → breadcrumb
→ Orbitron title with 2px crimson underrule + `MOD.NN` → pipe-separated meta row (surface,
difficulty meter, threat class) → one-line Inter lede → `01 GUIDE / 02 IMPACT / 03 FIX /
04 REFERENCES / 05 DEMO`. Every module uses the same numbering so the app is learnable
after one page. Remove all card wrappers, box shadows and rounded panel corners; sections
are separated by the header rule and 34px of space only. Demo area keeps its own bordered
panel plus a log tail beneath a hairline divider — that panel is the one place with a
raised background.

Replace the card grid with a dense table: ID / MODULE / SURFACE / DIFFICULTY, hairline row
dividers, no card borders. Row hover/selection = raised background plus a 2px inset crimson
left edge. Module name in mono 700, description in Inter muted, sub-variants (the three XSS
challenges, the deep-link routes) as indented child rows that are themselves links. Header:
Orbitron two-line "DAMN VULNERABLE ELECTRON APP" + one Inter line + a mono filter strip,
active filter = solid crimson.

### Hard rules
- One crimson primary action per screen. Crimson never fills a large area, never a
  background, never a border on more than one element at a time.
- Threat state uses `--critical`/`--warning` only. Brand crimson never means "danger."
- Monospace for anything machine-precise: paths, payloads, CVEs, timestamps, IPC channel
  names, tags, all UI chrome labels. Inter only for explanatory prose.
- Zero border-radius on panels, rules, code blocks, tags, callouts. 6px only on buttons and inputs.
- Structure comes from 1px borders and whitespace. No shadows anywhere except modal overlays.
- Focus ring is always visible: 3px crimson at 40%. Never `outline:none` without a replacement.
- No emoji, no gradients, no decorative illustration. Sentence case in prose; uppercase
  reserved for eyebrows, section labels and the wordmark.
- Body copy measure caps at 800px even in a maximised window; the chrome bar and tables run full width.
- Respect `prefers-reduced-motion`: disable the status-dot pulse and demo caret.
- The observability panel's terminal visual language is the reference the rest of the app
  matches. Reuse its log-row treatment for the demo log tail.

---

## 05 · Implementation notes (for the build)

- **The observability panel must be REBUILT** (the previous terminal-styled version was
  lost by not being committed). Rebuild it to this spec's terminal aesthetic as part of
  this pass — it is the reference the rest of the app matches, so it must exist and cohere.
- **Phased rollout:** build `theme.css` + `components.css`, rebuild the observability panel,
  and apply the full design to ONE module page (the reference screen) and the index page
  FIRST. Show these for review and confirm fidelity BEFORE rolling out to all module pages.
- **Commit before starting, and commit after EACH verified phase** so no work is ever lost
  again (this is why this spec is being re-applied — the panel was lost to an uncommitted
  state).
- **Styling/presentation only** — do not change vuln logic, IPC, demo behavior, flag
  gating, or the observability panel's capture logic. Visual layer only.
- **Projector legibility:** the design is dense (11px chrome, 12px logs). Chrome/log text
  may stay small, but content (guide prose, payloads, impact) must be readable from a
  distance on a projector.
- **Do NOT delete or break** any per-page functionality while restyling (challenge tasks,
  flag logic, demos, tests must all still pass after each phase).
