# BlobBoard — Handover

*Last updated: 2026-10-06 · live version **2026-10-06e** · commit `f7c1113` + docs · Read this first, then [DESIGN.md](DESIGN.md) for the full spec.*

BlobBoard is a personal life/task tracker: animated "blobs" on a free canvas that you group, reorder, connect with lines and (later) tag. It is a PWA (installable web app) for Windows and Android, plain HTML/CSS/JS with **no build step and no dependencies**, hosted on GitHub Pages. Dropbox sync is planned (phase 8).

| | |
|---|---|
| Live app | https://georgedaveb.github.io/BlobBoard/ |
| Live tests | https://georgedaveb.github.io/BlobBoard/tests/ (must say **ALL PASSED (98)**) |
| Repo | https://github.com/GeorgeDaveB/BlobBoard (public; `main` = production) |
| Local folder | `C:\Users\G.Boulas\Claude\BlobBoard` |
| Owner | GeorgeDaveB (tests on a Windows PC and an Android phone) |
| Rollback tags | `physics-v1` (before liquid physics v2) |

---

## 0. Start here (10-minute orientation for a new engineer or LLM)

1. Read §2 (status), §3 (how to work with the owner), §5 (how the code works) and §6 (gotchas) of this file.
2. Run it: `python -m http.server 8000` inside the folder → http://localhost:8000/ (app) and /tests/ (tests). No install, no Node.
3. The spec is DESIGN.md: requirements **R1–R33**, choices **C1–C14**. "As built" notes there mark where the code differs from the original plan.
4. Every change: code + tests (logic) + a dated line in §4 + DESIGN.md if a requirement changed (back DESIGN.md up first) + bump `js/version.js` + update §2 and the test count. Then push and check the live tests.
5. Next job: **phase 4 (pictures & cards)** — ask the owner the questions in §8 first (one batch, with recommended defaults).

---

## 1. Documents

| File | What it's for | Keep it updated when… |
|---|---|---|
| `HANDOVER.md` (this) | status, decision log, how the code really works, gotchas, how to run/deploy/move | anything is built or decided |
| `DESIGN.md` | the spec: requirements **R1–R33**, choices **C1–C14**, data model, modules, interaction spec, phases | a requirement or design choice changes |
| `README.md` | run locally, deploy (short) | the run/deploy steps change |
| `CLAUDE.md` | working rules for AI assistants in this folder (+ its own "Applied Learning" bullets) | the way of working changes |

---

## 2. Status

| Phase | What | Status |
|---|---|---|
| 0 | Setup, test runner, Pages | ✅ |
| 1 | Board, pan/zoom, blobs, editor, colour picker, undo, device storage | ✅ |
| — | Liquid physics (v2), birth animation | ✅ (owner-tuned) |
| 2 | Groups: drag-hold into, mini shapes + badge, full expansion, tray **or** container view, + tile, reorder, fast drop into an open grid, growth with contents (+ slider, push) | ✅ |
| 3 | Lines: gooey or straight, arrows, colours, thickness, text labels, line editor, ⚙ defaults + apply to all | ✅ — owner checking on phone |
| 3b | Multi-select: Pan/Select mode, box, Ctrl/Shift+click, move/drop/delete many | ✅ — owner checking on phone |
| 3c | Styled descriptions (R32), Motion tab + performance (R33), settings side pane, hover affordances | ✅ — owner checking on phone |
| 4 | Pictures & cards (thumbnail library, card look, thumbnails toggle) | ⏭ **next** — ask §8 questions first |
| 5 | Tags + filter | planned |
| 6 | Multiple canvases, duplicate/move to canvas | planned |
| 7 | Export/import JSON + PNG | planned |
| 8 | Dropbox sync (PKCE, 3-way merge) | planned — owner must create the Dropbox app (DESIGN §16) |
| 9 | PWA polish (service worker, icons, install, offline) | planned |

Tests: **98 passing** locally and live (2026-10-06).

**Important limitations right now (tell anyone taking over):**
- **Data lives only on each device** (IndexedDB per browser). PC and phone are NOT synced yet; there is no export yet. Clearing site data deletes the boards. Phases 7–8 fix this.
- **No service worker yet** → no offline use and browsers may serve stale files for a few minutes after a deploy. ⚙ shows the running version; hard-refresh if it's old.
- Only one canvas ("My first canvas") until phase 6.

---

## 3. Working agreement with the owner

- **95% rule:** don't build until ~95% sure what's wanted; ask all questions **in one batch**, each with a recommended default (the owner usually picks the recommended one). Exception: the owner writes "build a prototype".
- Replies short: result + decision needed. Plain language next to technical detail. No recaps of steps.
- Verify before claiming done; say what was checked and what wasn't (nobody here can test real touch — the owner tests on the phone).
- Flag any intentional deviation from what was asked; log your own unconfirmed choices (like C14).
- **Never read or probe credentials/tokens/env vars.** Pushes use a repo-scoped token the owner stored in Windows Credential Manager (`credential.useHttpPath=true` set in this repo). Commit email (repo config): `39366658+GeorgeDaveB@users.noreply.github.com`.
- Back up DESIGN.md (and HANDOVER.md for big rewrites) before editing — the owner's rule for source-of-truth files.
- Pushing to `main` deploys (~1 min, sometimes much longer — see gotcha 15). Tag a rollback point before risky changes.

---

## 4. Decision log (oldest first)

| Date | Decision | Why / notes |
|---|---|---|
| 2026-10-02 | PWA, vanilla ES modules, no build, no libraries; GitHub Pages | Simple, offline-capable; no Node on the owner's PC |
| 2026-10-02 | Free canvas with Pinterest styling; organic blobs; cards when thumbnails on (phase 4) | Owner choice |
| 2026-10-05 | C1–C12 approved (hover/tap controls, one top-level expansion at a time, × on lines, per-canvas thumbnails toggle, 3-way merge sync, fade-filter, undo, delete confirm, double-tap create, long-press decided on release, PNG = current view, duplicate placement) | DESIGN §3 |
| 2026-10-05 | Sync = per-item 3-way merge (not whole-board newest-wins) | Safer; flagged as a change from the first proposal |
| 2026-10-05 | Physics v1 (stretch along drag) → **v2**: front flattened by "air", mild front-to-back squeeze, contact flattening between blobs, minimal chain push-apart on drop | Owner wanted "liquid"; v1 tagged `physics-v1` |
| 2026-10-05 | Outline wobble moved from CSS keyframes to the JS physics loop (30 fps idle, on-screen only, auto 15 fps if slow) | Needed per-side flattening |
| 2026-10-05 | Birth animation: grow from a dot, overshoot ~1.21×, snappy settle; no ripple | Owner tuned |
| 2026-10-05 | Selection = white edge only | Owner request |
| 2026-10-05 | New untitled items are kept (only Delete/Undo removes them) — R25 | Owner request |
| 2026-10-05 | C13: Pan/Select **mode button** (✋/⬚, H/V) for multi-select; only changes empty-space drags | Owner chose option A |
| 2026-10-05 | **Inside boards (⤢) + breadcrumb built, then PARKED** — everything happens on one canvas | Owner: may never come back; code removed |
| 2026-10-05 | Tap selects; tap selected / double-click = **full expansion** (whole notes + inside items + **+ tile**) | Replaces "open inside board" |
| 2026-10-05 | Armed drop target swells enough to show **around** the held blob (R26) | Owner: to see which blob is targeted |
| 2026-10-05 | Text kept well inside the outline: notes 72% width, 3 lines; title 2 lines; forced wrapping; body clips | Owner: text was escaping |
| 2026-10-05 | **Container view** option (⚙, per canvas) — R27 | Owner spec; nothing remembered per item |
| 2026-10-05 | **Reorder** inside items in both views; grids use equal cells — R28 | Owner request |
| 2026-10-05 | **Fast drop** into an open grid at the pointed slot; expanded blobs don't react to contact — R29 | Owner: dropping in was slow/awkward |
| 2026-10-05 | **Growth with contents** — R30: size × √(1 + k·items inside) | Owner: "adds to diameter"; simplest stable rule = drops merging (area adds) |
| 2026-10-05 | **Growth pushes neighbours aside** (minimal chain push), in the drop's undo step; own step when growing on close; never on undo/redo | Owner answered the open question |
| 2026-10-05 | **Growth slider** in ⚙ (per canvas, `settings.growth` 0–3, default 1); **cap raised to 5×** | Owner request; slider doesn't push neighbours |
| 2026-10-05 | **Lines = "gooey strings"** (thick at the blobs, thin in the middle, thinner when longer, sagging spring middle) | Owner picked this over straight / soft curve |
| 2026-10-05 | New line gets an **arrowhead at the end you drag to**; lines **follow an open blob's edge** | Owner picked the recommended options |
| 2026-10-05 | C14 (my choices, flagged): handle top-left; colour fades between the two blobs; hint on tapping the handle; messages for invalid targets; Undo toast on line delete | Not specified; easy to change |
| 2026-10-05 | **App version** shown in ⚙ (`js/version.js`, bump on every deploy) | Owner couldn't tell which build was running |
| 2026-10-05 | **R31 line look + text:** Gooey/Straight; Gradient/Start/End/Custom colour; ⚙ default + per-line override; label pill at the middle (white border, line colours); line editor (✎ / tap selected line) | Owner; "parent"/"inherited" colours = Start/End blob |
| 2026-10-05 | Connect handle = thin black arrow icon ↗ (was a dot) | Owner request |
| 2026-10-05 | **Bug fix:** string folded back into big blobs — resting middle now between the edges, not the centres; a swung-in middle falls back to rest | Owner report (screenshot) |
| 2026-10-05/06 | GitHub Pages deploys stuck "queued" (GitHub Actions degraded); run #20 became a ghost that couldn't be cancelled. Cleared by GitHub later | Not a code problem — see gotcha 15 |
| 2026-10-06 | Line **thickness** (canvas default + per line), then made a **slider** 0.3×–3× with a Default chip per line | Owner request |
| 2026-10-06 | **"Apply to all lines…"** with confirm: clears per-line style/colour/thickness, keeps text, one undo step. Per-line choices survive default changes (test) | Owner request |
| 2026-10-06 | **⚙ Settings is a side pane** (same `.sheet` as the editors); settings / item editor / line editor close each other | Owner request |
| 2026-10-06 | **Phase 3b multi-select** built per DESIGN §8.7 / C13 | Spec already approved |
| 2026-10-06 | **R32 styled descriptions:** toolbar (B, I, U, Heading, bullets, numbered, bullet type • ◦ ▪ – → ★ ✓), see-as-you-type; stored as sanitized HTML subset in `notesHtml`, plain text in `notes` | Owner chose toolbar + WYSIWYG, recommended bullets |
| 2026-10-06 | **R33 Motion tab** (this device): per-effect switches + presets All on / Light / All off; Light default on touch devices; displacement always kept. Physics loop **stops when idle**; lines skip unchanged frames | Owner: Android was struggling |
| 2026-10-06 | Hover affordances: lines light up + hand cursor; ✎ / ↗ get a dark ring | Owner request |
| 2026-10-06 | Motion switch **drawGoo** ("Gooey line preview", off in Light): drawing preview = thin straight arrow growing to the finger, no physics/bounces | Owner: first simple preview "not good enough" |

---

## 5. How the code really works

### Module map

| File | Role |
|---|---|
| `index.html` | shell + Content-Security-Policy (only own files + Dropbox addresses; inline styles via CSSOM only) |
| `js/main.js` | boot: open IndexedDB → load + sanitize canvases (first run creates one) → store → `mountApp` → flush on hide |
| `js/version.js` | `APP_VERSION`, shown in ⚙ |
| `js/core/model.js` | pure data rules: creators (`newCanvas`, `newItem`, `newLink`), patches (`applyItemPatch`, `applyLinkPatch`), tree helpers, `canMoveInto`, `linkProblem`, `lineLook`, `badgeText`, `sanitizeCanvas` |
| `js/core/store.js` | the only place data changes (see actions below); undo/redo; screen state `ui` |
| `js/core/events.js · ids.js · migrate.js` | emitter; uuid + seeded random; schema upgrades |
| `js/persist/db.js · localRepo.js` | IndexedDB wrapper; `loadCanvases`, `saveCanvas` (debounced 300 ms), `getSetting/setSetting`, `flush` |
| `js/services/color.js` | palette (8), conversions, readable text colour |
| `js/services/geometry.js` | screen ↔ world, zoom, fit, rects |
| `js/services/layout.js` | ellipse helpers, `ellipseContact`, `resolveOverlaps` (one or many fixed), `ellipseTouchesRect`, `findFreeSpot`, `spotInside` |
| `js/services/strand.js` | line geometry: edges, gooey/straight outline, arrowheads, thickness |
| `js/ui/app.js` | shell: top bar (mode ✋/⬚, undo/redo, zoom, fit, ⚙), FAB, back stack, side panels (item editor, line editor, settings), selection bar, keyboard, motion load/save |
| `js/ui/board.js` | world (pan/zoom), rendering of top-level items + trays, drag/drop (single + group), growth push, line drawing, selection box, `geom()` for lines |
| `js/ui/itemView.js` | one blob: DOM, controls (✎, ↗), description box (rich editor in container view), growth `--grow`, roundness |
| `js/ui/tray.js` | grids of inside items (tray view / container view), + tile |
| `js/ui/physics.js` | shared animation loop, springs, `MOTION` switches, `tick`, `onFrame`, `kick` |
| `js/ui/gestures.js` | pointer state machine: tap / hold / drag / pan / pinch / link / linePress / box |
| `js/ui/linksLayer.js` | SVG lines + labels + selected-line controls + drawing preview |
| `js/ui/lineSheet.js · lineLookFields.js` | line editor; shared style/colour/thickness controls |
| `js/ui/richText.js` | rich editor + sanitizer (R32) |
| `js/ui/settingsSheet.js · motionPanel.js` | ⚙ side pane (Canvas / Motion tabs) |
| `js/ui/editSheet.js · colorPicker.js · dialogs.js` | item editor; colour picker; confirm/toast |
| `css/base.css · board.css · items.css` | app chrome & sheets; board, lines, selection; blobs, grids, rich text |
| `tests/*.test.js` | in-browser unit tests (list in `tests/index.html`) |

### Data
- Canvas document: DESIGN §6. `settings` = `{ thumbnails, insideView, growth, lineStyle, lineColor, lineWidth }`. Item adds `notesHtml` (R32). Link = `{ from, to, arrowFrom, arrowTo, style, color, width, label }` (`null` look fields = canvas default).
- Device settings (IndexedDB `settings`, never synced): `lastCanvasId`, `view:<canvasId>:root`, `mode` ('pan'|'select'), `motion` (R33 switches).
- Store actions: `select`, `selectLink`, `selectMany`, `toggleSelected`, `selectedItems`, `setExpanded`, `expandTo`, `toggleExpand`, `setCanvasSetting(key, value, {coalesce})`, `reorderItem`, `createItem`, `updateItem`, `moveItem`, `moveItems`, `reparentItem`, `reparentItems`, `deleteItem`, `deleteItems`, `createLink`, `toggleArrow`, `updateLink`, `resetLineLooks`, `deleteLink`, `undo`, `redo` (+ getters `canvas`, `item`, `link`, `canUndo`, `canRedo`).
- Flow: `ui event → store action → commit()` → (1) JSON snapshot onto the per-canvas undo stack (same `coalesce` key = same step, e.g. one editor session or one slider drag), (2) `repo.saveCanvas`, (3) `fixUi()` repairs screen state, (4) `emit` → `app.js` renders board + chrome. Undo/redo replace the whole doc and emit `history: true`.
- Screen state `store.ui`: `canvasId`, `expanded` (path, one per level), `selectedId` | `selectedIds` (2+) | `selectedLinkId` — only one kind at a time.
- `model.sanitizeCanvas()` repairs loops, orphans, bad links/fields/settings; run on load (and planned for import/merge).

### Rendering
- `board.js` renders **top-level items** keyed by id (`els`), and every visible mini via trays (`allEls`, rebuilt each render).
- `tray.js`: **tray view** = grid floating under the item (`.tray-root`); **container view** = grid inside the body (`.tray-inline`). Each grid has `data-owner`; last cell = `.tray-add` (+ tile).
- Item DOM: `.item` (position, JS) › `.item-jelly` (physics transform) › `.item-body` (outline via `border-radius` from physics; CSS `bob`; `overflow:hidden`) + `.item-done` + `.item-kids`; controls `.item-link` (↗) and `.item-edit` (✎) are children of `.item`. Each layer owns its own `transform`.
- Minis = same component with class `mini` and CSS `zoom: .62`.
- R30 growth: `itemView.updateItemEl` sets `--grow` = min(5, √(1 + growth·n)); CSS multiplies min/max sizes.
- Stacking (world): SVG lines (under items) → items (z = item.z; open item 900000; dragged 1000000; group members 999999) → line labels (899999) → line controls (1000001).

### Physics (`ui/physics.js`) and motion switches (R33)
- One shared `requestAnimationFrame` loop; damped springs (`SPRING`), knobs in `TUNING`. Per item: air, press, lift, squash `q`, size bounce `sx/sy`, glide `ox/oy`, side flattening, birth `g`, roundness `rd`. `tick()` exported for tests; NaN guard.
- `MOTION` = { wobble, bob, lines, drawGoo, drag, contact, bounce, glide, birth, morph, swell, ui }. `setMotion(m)`; checks sit where each effect starts (`spawn`, `glideFrom`, `resized`, `poke/drop`, `targets()`, `_shape`, `setRoundness`), `linksLayer.stepMid` (lines), `startTemp` (drawGoo), `board.placeMini` (ui), `board.updateContacts` (contact); CSS classes `m-no-bob`, `m-no-ui` on `#app`.
- **The loop runs only while something moves**: active springs, idle wobble on, or a frame hook returning true. Anything that changes geometry without physics must call `kick()` (board's ResizeObserver does).
- Saved as device setting `motion`; default `defaultMotion()` (touch → Light = wobble, bob, lines, drawGoo off).

### Gestures and dragging
- `gestures.js` states: pressing → tap / hold (500 ms, decided on release) / drag; emptyPress → pan (Pan mode) or **box** (Select mode); `link` (down on ↗); `linePress` (down on a line or label: tap = select/edit, move = pan); pinch on a second finger (cancels drag/link/box). Ignores `.item-ctl` (except ↗), `[data-no-gesture]`, and grid backgrounds. Taps carry `{ add }` for Ctrl/Shift.
- Drag: top-level items move directly; a **mini** is dragged as a full-size **ghost**; a **group** (multi-select) moves all members with their offsets.
- Drop precedence (`drop()` / `dropGroup()`): **0** reorder in own grid → **0b** drop into another open grid at the slot → **1** armed target (held 500 ms; swells) → **2** board: land + `resolveOverlaps` push-apart (one undo step with the move) → **3** snap back.

### Lines (`linksLayer.js` + `strand.js`)
- Each frame `board.geom(id)` gives each blob as drawn now (store/drag/group position + body size + `phys.visual()`); `strandGeometry(A, B, mid, arrows, style, width)` builds outline + arrowheads + spine; unchanged lines are skipped; DOM written only on change.
- Look: `model.lineLook(link, settings, fromColor, toColor)` → `{ style, width, c0, c1 }` (gradient stops c0/c1). Labels are HTML at `at(0.5)`. Hover highlight in CSS (`@media (hover: hover)`).
- Drawing: ↗ handle → temp line; targets via `elementsFromPoint`; minis and already-linked pairs refused with a toast.

### Multi-select
- `ui.selectedIds` (2+ top-level). Box: screen-space `.select-box`, hits = `ellipseTouchesRect` in world coords, `.box-hit` while dragging, `selectMany` on release. `.board.multi` hides ✎/↗. Group drop → `reparentItems` (one step) or `moveItems` + `pushesForMany`.

### Styled descriptions (R32)
- `createRichEditor` = toolbar + `contenteditable`; buttons `preventDefault` on pointerdown (keep selection); `execCommand` with `styleWithCSS=false`; lists from a heading convert the heading first; paste = plain text.
- `sanitizeHtml` keeps b i u h3 ul ol li div br (+ `ul[data-b]`), unwraps the rest, drops scripts; used on save and on display (`notesHtmlOf`, cached). `htmlToPlain` → `notes`.

### Growth push (`board.checkGrowth`)
From the ResizeObserver for closed top-level blobs: inside count went up and the body got bigger → `pushesFor` + `moveItems`, coalesced with the drop's undo key (`growKey`). Skipped for undo/redo renders.

### Back stack and side panels (`app.js`)
Layers (item editor, line editor, settings, expanded tray) each `pushState` an entry tagged with an id. UI closes just close the layer (no `history.back()` from code); `popstate` closes every layer above the target and skips stale entries. The three side panels share the `.sheet` style and close each other.

---

## 6. Gotchas (learned the hard way)

1. **CSS state selectors must use direct-child chains** (`.item.x > .item-jelly > .item-body > …`). Minis live inside their parent's body in container view; descendant selectors leak.
2. Specificity: container sizing uses `.item.expanded.container-open > …` to beat `.item.expanded.has-notes > …`.
3. `.item { width: max-content }` — absolutely positioned items otherwise shrink-wrap and split words.
4. Size math uses **body** sizes (ResizeObserver on `.item-body`), never `.item`.
5. **Hidden browser pane** (Claude's in-app browser when not displayed): no `requestAnimationFrame`, no ResizeObserver until something renders (take a screenshot), timers throttled (~1 s), `focus()`/`focusout` don't work → step physics with `tick()`, wait ≥1.3 s for 500 ms timers, dispatch focus events by hand. The pane can also collapse to 0×0 → `elementsFromPoint` finds nothing; set a viewport size first.
6. Local `python -m http.server` lets the browser cache ES modules → `fetch(url, {cache: 'reload'})` each changed file, then reload.
7. Git prints LF→CRLF warnings on every commit — harmless (files are LF in the tree).
8. FLIP transforms on minis are cleared when a mini drag ends; `render()` restores DOM order.
9. SVG path with overlapping sub-paths of opposite winding leaves a hole → line and arrowheads are separate paths; opacity on the group.
10. A blob's `.item-jelly` box is a rectangle: its invisible corners catch hit-tests → line labels live on a layer above the items.
11. `contenteditable` + `execCommand`: a list made from a heading nests inside it (handled); scripted `insertParagraph` ≠ a real Enter — test formatting via `innerHTML` + an `input` event.
12. Anything that moves geometry without physics must `kick()` the loop, or lines won't follow (the loop sleeps when idle).
13. Line resting middle must be between the blob **edges** (between centres it can sit inside a big blob and the curve folds back).
14. Writing multi-line patches through a Bash heredoc breaks on quotes on this PC → write the script to a file, then run it.
15. **GitHub Pages deploys can sit "queued" for a long time** when GitHub Actions is degraded; a stuck run blocks newer ones. Check https://www.githubstatus.com, re-run the newest run, or toggle Settings → Pages source None → main. Don't poll the GitHub API unauthenticated (60 calls/hour) — poll the live `js/version.js` instead.
16. The desktop app sometimes stops the local preview server; restart it (`.claude/launch.json` entry `blobboard` in the parent folder) before testing.

---

## 7. Run, test, deploy, roll back

```bash
cd C:\Users\G.Boulas\Claude\BlobBoard
python -m http.server 8000
```
- App: http://localhost:8000/ · Tests: http://localhost:8000/tests/ (must say **ALL PASSED**).
- Tests: `smoke` (browser features) · `model` · `services` (colour, geometry, layout, growth, push-apart) · `store` · `physics` (stepped with `tick`) · `links` (link actions, look, strand geometry) · `select` (multi-select, box hit, group push) · `richtext` (sanitizer, plain text, motion switches). UI flows were checked by dispatching `PointerEvent`s in the browser.
- Owner's phone checklist after UI changes: drag/drop, hold-to-put-inside, draw a line from ↗, tap a thin line, selection box with a finger, the rich-text toolbar, Motion tab presets.
- Deploy: bump `APP_VERSION` in `js/version.js` (date + letter), commit, `git push origin main`, wait until the live `js/version.js` shows it, then open the live `/tests/` (reload changed files with `cache:'reload'`) → ALL PASSED.
- Roll back: `git revert <commit>` + push. Tag before risky work (`git tag -a name -m … && git push origin name`).

---

## 8. Open questions / next steps

- **Owner to check on the phone:** lines (drawing, tapping, editor), multi-select box, rich-text toolbar, Motion → Light feel and speed.
- **Phase 4 (pictures & cards) — ask before building** (DESIGN R7/R8, §8.4 imageProcessor, §8.5 imageLibrary): card size/shape; where the title sits on a picture; picture size limit / quality; what the thumbnails toggle does to blobs without a picture; whether pictures appear in minis.
- **Not built (possible later):** auto-pan while drawing a line near the screen edge; lines between inside items; add/remove single blobs to a selection on a phone; "connect all selected"; rich text in line labels.
- **Parked:** inside boards / sub-canvases; Background Sync.

---

## 9. Moving the project elsewhere (another PC, account or team)

1. **Code:** `git clone https://github.com/GeorgeDaveB/BlobBoard.git` (public). Nothing to install; any static web server works (`python -m http.server`).
2. **Hosting:** GitHub Pages from `main`, folder `/ (root)` (repo Settings → Pages). Any static host works; the app uses relative paths. A new address means: update the Dropbox redirect URIs (DESIGN §16) and note that browser storage is per address (users' boards don't move with it — export/sync first once phases 7–8 exist).
3. **Push access:** use your own GitHub credentials or a fine-grained token scoped to the repo. Set the commit email in the repo config. Never commit tokens.
4. **Data:** each device's boards are in that browser's IndexedDB (`blobboard` database: `canvases`, `settings`, `images`, `tags`, `syncMeta`). Until export (phase 7) exists, the only way to move them is the browser's own storage tools.
5. **AI assistants:** point them at `CLAUDE.md` → this file → DESIGN.md. The owner's global preferences (95% rule, batched questions, short replies, never touch credentials, back up source-of-truth files) are summarised in §3.
