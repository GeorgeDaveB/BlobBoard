# BlobBoard — Handover

*Last updated: 2026-10-05 (phase 3) · Read this first, then [DESIGN.md](DESIGN.md) for the full spec.*

BlobBoard is a personal life/task tracker: animated "blobs" on a free canvas that you group, reorder, connect and tag. It is a PWA (installable web app) for Windows and Android, plain HTML/CSS/JS with **no build step and no dependencies**, hosted on GitHub Pages, with Dropbox sync planned.

| | |
|---|---|
| Live app | https://georgedaveb.github.io/BlobBoard/ |
| Live tests | https://georgedaveb.github.io/BlobBoard/tests/ |
| Repo | https://github.com/GeorgeDaveB/BlobBoard (public; `main` = production) |
| Local folder | `C:\Users\G.Boulas\Claude\BlobBoard` |
| Owner | GeorgeDaveB (tests on a Windows PC and an Android phone) |

---

## 1. Documents

| File | What it's for | Keep it updated when… |
|---|---|---|
| `HANDOVER.md` (this) | status, decision log, how the code really works, gotchas | anything is built or decided |
| `DESIGN.md` | the spec: requirements **R1–R31**, choices **C1–C13**, modules, phases | a requirement or design choice changes |
| `README.md` | run locally, deploy | the run/deploy steps change |
| `CLAUDE.md` | working rules for AI assistants in this folder | the way of working changes |

Rule: **every change lands with (1) code, (2) tests where logic is involved, (3) a line in the decision log below, (4) DESIGN.md updated if a requirement changed.** Back up DESIGN.md before editing it (the owner's rule for source-of-truth files).

---

## 2. Status

| Phase | What | Status |
|---|---|---|
| 0 | Setup, test runner, Pages | ✅ done |
| 1 | Board, pan/zoom, blobs, editor, colour picker, undo, device storage | ✅ done |
| — | Liquid physics (v2), birth animation | ✅ done (owner-tuned) |
| 2 | Groups: drag-hold into, mini shapes + badge, full expansion, tray **or** container view, + tile, reorder, fast drop into open grid, growth with contents | ✅ done (several owner revisions, see log) |
| 3 | Lines between blobs ("gooey strings"), + / − arrowheads, × delete; growth pushes neighbours | ✅ done — awaiting owner's phone check |
| 3b | Multi-select (Pan/Select mode button, selection box) | ⏭ **next** — confirm details first (§8) |
| 4 | Pictures & cards (thumbnail toggle) | planned |
| 5 | Tags + filter | planned |
| 6 | Multiple canvases, duplicate/move to canvas | planned |
| 7 | Export/import JSON + PNG | planned |
| 8 | Dropbox sync (PKCE, 3-way merge) | planned — owner must create the Dropbox app (DESIGN §16) |
| 9 | PWA polish (service worker, icons, install) | planned |

Tests: **79 passing** (local + live) as of this update.

---

## 3. Working agreement with the owner

- **95% rule:** don't build until ~95% sure what's wanted; ask all questions **in one batch**, each with a recommended default. Exception: the owner writes "build a prototype".
- Replies short: result + decision needed. Plain language next to technical detail.
- Verify before claiming done; say what was checked and what wasn't (Claude can't test real touch — give the owner a short phone checklist).
- Flag any intentional deviation from what was asked.
- **Never read or probe credentials/tokens.** Pushes use a repo-scoped token the owner stored in Windows Credential Manager (`credential.useHttpPath=true` in this repo). Commit email: `39366658+GeorgeDaveB@users.noreply.github.com`.
- Pushing to `main` deploys (~1 min). Tag a rollback point before risky changes (e.g. `physics-v1`).

---

## 4. Decision log (newest last)

| Date | Decision | Why / notes |
|---|---|---|
| 2026-10-02 | PWA, vanilla ES modules, no build, no libraries; GitHub Pages | Simple, offline-capable; no Node on the owner's PC |
| 2026-10-02 | Free canvas with Pinterest styling; organic blobs; cards when thumbnails on (phase 4) | Owner choice |
| 2026-10-05 | C1–C12 approved (hover/tap controls, one top-level expansion at a time, × on lines, per-canvas thumbnails toggle, 3-way merge sync, fade-filter, undo, delete confirm, double-tap create, long-press decided on release, PNG = current view, duplicate placement) | DESIGN §3 |
| 2026-10-05 | Sync = per-item 3-way merge (not whole-board newest-wins) | Safer; flagged to owner as a change from the first proposal |
| 2026-10-05 | Physics v1 (stretch along drag) → **v2**: front flattened by "air", mild front-to-back squeeze, contact flattening between blobs, minimal chain push-apart on drop | Owner wanted "liquid"; v1 tagged `physics-v1` |
| 2026-10-05 | Outline wobble moved from CSS keyframes to the JS physics loop (30 fps idle, on-screen only, auto 15 fps if slow) | Needed per-side flattening; cheaper than 60 fps CSS |
| 2026-10-05 | Birth animation: grow from a dot, overshoot ~1.21×, snappy settle; no ripple | Owner tuned |
| 2026-10-05 | Selection = white edge only | Owner request |
| 2026-10-05 | New untitled items are kept (only Delete/Undo removes them) — R25 | Owner request |
| 2026-10-05 | C13: Pan/Select **mode button** (✋/⬚, H/V) for multi-select; only changes empty-space drags | Owner chose option A; built in phase 3b |
| 2026-10-05 | **Inside boards (⤢) + breadcrumb built, then PARKED** — everything happens on one canvas | Owner: may never come back; code removed |
| 2026-10-05 | Tap selects; tap selected / double-click = **full expansion** (whole notes + inside items + **+ tile**) | Replaces "open inside board" |
| 2026-10-05 | Armed drop target swells enough to show **around** the held blob (R26) | Owner: to see which blob is targeted |
| 2026-10-05 | Text kept well inside the outline: notes 72% width, 3 lines; title 2 lines; forced wrapping; body clips | Owner: text was escaping |
| 2026-10-05 | **Container view** option (⚙, per canvas) — R27; opens when edited or tapped again; inline description edit; − hides for that time only; nested containers; floats above neighbours | Owner spec; nothing remembered per item |
| 2026-10-05 | **Reorder** inside items in both views; grids use equal cells — R28 | Owner request |
| 2026-10-05 | **Fast drop** into an open grid at the pointed slot (no centre-aim, no wait); expanded blobs don't react to contact — R29 | Owner: dropping in was slow/awkward |
| 2026-10-05 | **Growth with contents** — R30: size × √(1 + items inside), max 3× | Owner: "adds to diameter"; simplest stable rule = drops merging (area adds) |
| 2026-10-05 | **Growth pushes neighbours aside** (minimal chain push), in the drop's undo step; own step when growing on close; never on undo/redo | Owner answered the open question |
| 2026-10-05 | **Lines = "gooey strings"** (thick at the blobs, thin in the middle, thinner when longer, sagging spring middle) | Owner picked this over straight / soft curve |
| 2026-10-05 | New line gets an **arrowhead at the end you drag to**; lines **follow an open blob's edge** | Owner picked the recommended options |
| 2026-10-05 | **Growth slider** in ⚙ (per canvas, `settings.growth` 0–3, default 1) = blobs' worth of area per inside item; **cap raised to 5×** | Owner request; slider doesn't push neighbours |
| 2026-10-05 | Connect handle shows a dot-with-arrow icon; **app version** shown in ⚙ (`js/version.js`, bump on every deploy) | Owner couldn't find the plain dot (or had a cached old build) |
| 2026-10-05 | **R31 line look + text:** Gooey/Straight style; Gradient/Start/End/Custom colour; per-canvas default in ⚙ + per-line override; label pill at the middle (white border, line colours); line editor (✎ / tap selected line) | Owner request; "parent"/"inherited" colours confirmed as Start/End blob |
| 2026-10-05 | Connect handle = thin black arrow icon | Owner request |
| 2026-10-05 | **Bug fix:** string folded back into big blobs — resting middle now between the edges, not the centres; swung-in middle falls back | Owner report (screenshot) |
| 2026-10-05 | C14 (my choices, flagged): ● dot top-left; colour fades between the two blobs; hint on tapping the dot; messages for invalid targets; Undo toast on line delete | Not specified; easy to change |

---

## 5. How the code really works

### Data flow
`ui event → store action → commit()` → (1) JSON snapshot pushed to the per-canvas undo stack (consecutive commits with the same `coalesce` key share one step, e.g. one editor session), (2) `repo.saveCanvas` (IndexedDB, debounced 300 ms, flushed on hide), (3) `fixUi()` repairs screen state, (4) `emit` → `app.js` re-renders the board and chrome. Only `core/store.js` actions mutate data.

- Canvas doc shape: DESIGN §6. `settings` = `{ thumbnails, insideView: 'tray'|'container' }`.
- Screen state (`store.ui`, not saved): `canvasId`, `expanded` (path of item ids from top level down, one per level), `selectedId`.
- `model.sanitizeCanvas()` repairs loops, orphans, bad links/fields; run on load (and planned for import/merge).

### Rendering
- `board.js` renders **top-level items** keyed by id (`els`), and every visible mini via trays (`allEls`, rebuilt each render).
- `tray.js` renders an expanded item's grid. **Tray view**: grid floats under the item (`.tray-root`); an open mini's grid is a full-width row after its row (`.tray-nested`). **Container view**: grid sits *inside* the item's body (`.tray-inline`); an open mini becomes a container spanning a full row. Each grid has `data-owner` = its item id. Last cell = `.tray-add` (+ tile).
- Item DOM: `.item` (position via `transform`, set by JS) › `.item-jelly` (physics transform) › `.item-body` (outline via `border-radius` set by physics; CSS `bob` animation; `overflow:hidden`) + `.item-done` + `.item-kids` (mini shapes + badge). Each layer owns its own `transform` — don't merge them.
- Minis are the same component with class `mini` and CSS `zoom: .62`.
- R30 growth: `itemView.updateItemEl` sets `--grow` on the body; CSS multiplies min/max sizes by it.

### Physics (`ui/physics.js`)
One shared `requestAnimationFrame` loop over all items; damped springs (`[stiffness, damping]` in `SPRING`), knobs in `TUNING`. Per item: air (vector), press (contacts), lift, squash `q`, size bounce `sx/sy`, glide `ox/oy`, side flattening `fr/fl/ft/fb`, birth `g`, roundness `rd` (1 = blob, 0.16 = container rectangle). Idle items only update the outline (~30 fps, on-screen only). `tick()` is exported so tests can step frames. A NaN guard resets any runaway spring.

### Gestures and dragging
- `gestures.js`: one pointer state machine (tap / hold 500 ms / drag / pan / pinch). Ignores `.item-ctl`, `[data-no-gesture]` (description box), and a grid's background.
- `board.js` drag: top-level items move directly; a **mini** is dragged as a full-size **ghost** while the mini stays faded in place.
- Drop precedence in `drop()`: **0** reorder in own grid → **0b** fast drop into another open grid (`drag.pane`, slot index) → **1** armed target (held 500 ms; swells to show around the held blob) → **2** board (empty or over a closed top-level blob): land + `resolveOverlaps` push-apart → **3** otherwise snap back (incl. its own parent's container).
- Reorder uses grid **slots measured at drag start** (fractions of the grid box), and a FLIP slide animation for siblings.

### Lines (`ui/linksLayer.js` + `services/strand.js`)
- Data: `doc.links[id] = { from, to, arrowFrom, arrowTo }`; store actions `createLink` (refuses self / different boards / existing pair — `model.linkProblem`), `toggleArrow(id, 'from'|'to')`, `deleteLink`; `ui.selectedLinkId` (an item or a line is selected, never both). Reparent/delete already remove lines (R23).
- Drawing: SVG layer inserted **before** `.items-layer` in `.world` (so lines are under every blob); `overflow: visible`, 1×1 px, `pointer-events: none` except the invisible `.link-hit` centre line (`vector-effect: non-scaling-stroke`, 22 px). Line controls (`.link-ctls`) are HTML above the items.
- Each frame (`physics.onFrame`) `board.geom(id)` gives each blob as drawn now (store/drag position + body size + `phys.visual()` offset/squash/roundness); `strandGeometry()` builds the path; DOM is written only if the path string changed.
- Look (R31): `model.lineLook(link, settings, fromColor, toColor)` → `{ style, c0, c1 }`; gradient stops get c0/c1 (equal = solid). Straight style skips the middle spring. Labels are HTML (`.link-labels`, z 899999: above blobs, below open trays 900000 / drag 1000000), positioned at `at(0.5)`; tapping a label = tapping the line. Editors: `ui/lineSheet.js` (one line) and ⚙, both built from `ui/lineLookFields.js`.
- Gestures: `pointerdown` on `.item-link` (connect handle) → `link` mode (`linkStart/Move/End/Cancel`); on `.link-hit` → `linePress` (tap = `tapLine`, move = pan). Only top-level blobs have a dot (CSS hides it on minis); targets come from `elementsFromPoint`.

### Growth push (`board.checkGrowth`)
Runs from the ResizeObserver for closed top-level blobs: if its inside count went up since its last closed measurement and its body got bigger → `pushesFor` + `store.moveItems`, coalesced with the drop's undo key (`growKey`) when it came straight from a drop. Skipped while the render came from undo/redo (`board.render(change)` gets `change.history`).

### Back stack (`app.js`)
Layers (editor, settings, tray/expanded) each `pushState` an entry tagged with an id. UI closes just close the layer (no `history.back()` from code — it caused races); on `popstate` we close every layer above the target entry and skip stale entries.

---

## 6. Gotchas (learned the hard way)

1. **CSS state selectors must use direct-child chains** (`.item.x > .item-jelly > .item-body > .item-title`). Minis live *inside* their parent's body in container view, so descendant selectors leak parent state into children.
2. Specificity: container sizing uses `.item.expanded.container-open > …` to beat `.item.expanded.has-notes > …`.
3. `.item { width: max-content }` — absolutely positioned items otherwise shrink-wrap to min-content and split words. Title uses `overflow-wrap: break-word` (not `anywhere`) except on fixed-width blobs.
4. Grow/size math uses **body** sizes (ResizeObserver on `.item-body`), never `.item` (which includes the badge/tray).
5. Browser pane testing: when the pane is hidden, `requestAnimationFrame` stops, timers are throttled (~1 s) and `focus()` doesn't work → step physics with `tick()`, wait ≥1.3 s for 500 ms timers, dispatch `blur` manually.
6. The local `python -m http.server` lets the browser cache ES modules → `fetch(url, {cache: 'reload'})` each changed file before retesting.
7. Git prints LF→CRLF warnings on every commit — harmless.
8. FLIP transforms on minis are cleared when a mini drag ends; `render()` restores DOM order from the store.
9. Hidden browser pane also delays **ResizeObserver** until something renders (e.g. a screenshot) → growth push/bounce only appear then. Take a screenshot before and after a drop when testing R30.
11. A blob's `.item-jelly` box is a rectangle: its invisible corners catch taps/hit-tests. Anything that must stay tappable near blobs (line labels) goes on a layer above the items.
10. SVG `<path>` with two overlapping sub-paths of opposite winding leaves a hole (white seam) → string and arrowheads are separate paths, with opacity on the group.

---

## 7. Run, test, deploy, roll back

```bash
cd C:\Users\G.Boulas\Claude\BlobBoard
python -m http.server 8000
```
- App: http://localhost:8000/ · Tests: http://localhost:8000/tests/ (must say **ALL PASSED**).
- Tests are in-browser ES modules (`tests/*.test.js`, list in `tests/index.html`); logic modules are pure and unit-tested; UI flows were checked by dispatching `PointerEvent`s + `tick()` (see gotcha 5).
- Deploy: bump `APP_VERSION` in `js/version.js`, commit + `git push origin main` → live in ~1 min (check `/tests/` on the live site).
- Roll back: `git revert <commit>` + push. Tag before risky work (`git tag -a name -m … && git push origin name`).

---

## 8. Open questions / next steps

- **Owner to check on the phone (phase 3):** drawing from the ● dot, tapping thin lines, + / − / × buttons, gooey look while dragging, growth push.
- **Not built (possible later):** auto-pan while drawing a line near the screen edge; lines between inside items (minis); line labels.
- **Phase 3b (multi-select) — confirm before building:** DESIGN §8.7 is the plan; ask how lines between selected blobs behave when moved together (they just follow), and whether a selection bar should offer "connect all".
- Parked: inside boards/sub-canvases; Background Sync; multi-select details beyond DESIGN §8.7.
