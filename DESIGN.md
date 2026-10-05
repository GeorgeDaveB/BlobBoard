# BlobBoard — Design v1

*Status: draft for review · 2026-10-05 · No code written yet.*

> **In one paragraph:** BlobBoard is an installable web app (PWA) for Windows and Android. You arrange animated "blobs" (items) on free canvases, group them by dropping one into another, connect them with lines and arrows, tag them, and give each a colour or a thumbnail picture. Everything is saved on the device instantly and synced through your Dropbox, so the phone and the PC show the same boards. It is plain HTML/CSS/JavaScript — no framework, no build step — hosted for free on GitHub Pages.

## Contents

1. Words used in this document
2. What was agreed (requirements)
3. Choices I made that you haven't confirmed yet ← **please review**
4. Tech stack
5. Architecture
6. Data model
7. Files and folders
8. Modules and components
9. Interaction spec
10. Visual spec
11. Sync design
12. Challenges and how they're solved
13. Security and privacy
14. Testing and verification
15. Build phases
16. Your one-time setup
17. Not in v1

---

## 1. Words used

| Word | Meaning |
|---|---|
| **Canvas** | A whole workspace (e.g. "Life", "Work"). You can have many and switch between them. One canvas = one file in Dropbox. |
| **Board** | One level of a canvas: the canvas's top level, or the *inside* of an item. |
| **Item** | One thing on a board: title, notes, colour, optional thumbnail, tags, done tick. |
| **Group** | An item that has items inside it. |
| **Blob / Card** | The two looks of an item: an organic animated shape, or a rounded Pinterest-style card with a picture. |
| **Mini shapes** | The up-to-6 little wobbly shapes (2 rows × 3) under a collapsed group. |
| **Tray** | The expanded view: a group's inside items shown smaller underneath it. |
| **Expanded** | An item opened in place (tap it again once selected): its whole description shows and its tray appears underneath. (Separate "inside boards" are parked — see §17.) |
| **Link** | A line connecting two items on the same board, with optional arrowheads at either end. |

---

## 2. What was agreed (requirements)

Numbered so the build phases and tests can refer to them.

**Platform and data**
- **R1** Web app that runs and installs on Windows and Android (PWA). Simple code.
- **R2** Easy sync between desktop and Android through Dropbox: loads on open, saves automatically after changes, works offline.
- **R3** Multiple canvases: switch, new, rename, duplicate, delete.
- **R4** Each canvas exportable as a file (pictures included, importable as a new canvas on either device) and as a PNG picture.

**Items**
- **R5** Item = title (always readable), optional thumbnail, colour, notes, tags, done tick (greys the item out). No due dates.
- **R6** Colour: 8 base colours + a drag colour picker.
- **R7** Thumbnails picked from pictures on the device (multi-file picker) into a shared picture library.
- **R8** Look: animated organic blob. Thumbnails toggle ON → items that have a thumbnail become rounded Pinterest cards, the rest stay blobs. OFF → everything is a blob. The change animates.
- **R9** Notes: the item grows to fit its notes; collapsed it shows up to 4 lines, then "…" — text never shows outside the outline. Fully expanded (R16) it shows the whole description.
- **R10** Tags: reusable, chosen from a dropdown. Typing a new one creates it, and it's available from then on. Shown as chips on the item. A list to rename/delete tags. Shared across all canvases.
- **R11** Tag filter on the board.

**Layout and grouping**
- **R12** Free canvas (pan and zoom) with Pinterest styling (rounded cards, soft shadows).
- **R13** Items are draggable.
- **R14** Drag an item onto another and hold ~0.5 s → the target swells → drop puts the item inside it.
- **R15** A collapsed group shows up to 6 mini shapes (2 rows × 3) just below it, tinted with the inside items' colours, plus a count badge on the corner: exact count 1–6, then "6+".
- **R16** Tap selects an item. Tapping the **selected** item again (or a quick double-click) **expands it fully**: the whole description shows (the outline morphs into a rounded card so it fits) and its inside items appear underneath, smaller (real title, colour, thumbnail), all of them, in rows of 3–4, followed by a **+ tile** that adds a new item inside it. Tap again → collapse. Inside the tray, minis work the same way (tap to select, tap again to expand).
- **R17** Drag a small one out onto the canvas → it leaves the group.
- **R18** ~~Inside boards (⤢), breadcrumb~~ — **parked** (2026-10-05). Everything happens on the one canvas: items are added inside an expanded item with its + tile, taken out by dragging a mini out of the tray.
- **R27** **Inside view option** (⚙ Settings, per canvas): *Tray below the blob* (R16) or *Inside the blob* (container). Container view: when a blob is edited (✎, long-press, right-click, Enter) or tapped again once selected, it springs into a rounded rectangle — title on top, then the full description in a box (tap to edit in place; **−** hides it for this time only, a "▸ Description" pill brings it back), then a grid of its inside blobs that pop in one after another, plus a + tile. Selecting or editing a blob inside keeps it open; an inside blob that is opened becomes a nested container spanning a full row. It floats above its neighbours (the canvas layout is never disturbed). Nothing about it is remembered per blob: it opens with the description shown every time.
- **R28** **Reorder inside items** (both views): drag a mini within its grid; the others slide aside. Over the middle of a sibling (held 0.5 s) it goes inside that sibling instead; past the grid's edge onto the board it leaves the group. Grids use equal cells.
- **R29** **Fast drop into an open blob:** dragging a blob from outside over an expanded blob's grid (tray or container) lights the grid up immediately — no centre-aim, no wait — and dropping puts it inside at the slot under the finger (one undo step). Holding over the middle of a blob in that grid still nests into that blob. An expanded blob never wiggles/flattens against blobs dragged past it.
- **R26** While a dragged blob is held over another (arming), the target swells enough that its edge shows **all around the held blob** (title and notes included), so you can see which blob you're dropping into.
- **R19** ✎ or long-press → edit the item.
- **R20** Duplicate an item into a canvas (any canvas, including the current one) with everything inside it, all its text included. Also "Move to canvas…".

**Links**
- **R21** Connect two items with a line by dragging from a dot on the item's edge.
- **R22** Tap a line → a + / − button at each end adds or removes the arrowhead at that end.
- **R23** When an item moves into a group, its lines are removed. Lines only connect items on the same board.

**Selection**
- **R24** Select several items at once by dragging a selection box over an area (like selecting icons on a desktop), then move them together by dragging any one of them.
- **R25** A new item stays from the moment it's created, even untitled (several items may share the name "Untitled"). Only Delete or Undo removes it.

---

## 3. Choices I made that you haven't confirmed

Please check these. Each one is easy to change now and harder later.

| # | Choice | Why |
|---|---|---|
| **C1** | ✎ and the connect dot appear when you **hover** (PC) or **tap** (phone) an item, not all the time. | Keeps the board clean. Touch screens have no hover. Long-press still opens the editor directly. |
| **C2** | Only **one top-level group is expanded at a time** on a board (expanding another one collapses the first). Expanding further inside it is unlimited. | Two open trays would overlap each other on a free canvas. |
| **C3** | A selected line also gets an **× button in the middle** to delete it. | You need a way to remove a line; it wasn't specified. |
| **C4** | The **thumbnails toggle is per canvas** (and syncs). | Lets one canvas be visual and another plain. |
| **C5** | Sync **merges** both devices' changes instead of "whole board, newest wins". Only when the *same* field of the *same* item was changed on both devices does the newer edit win; the other version is then saved to a backups folder in Dropbox. | **Changes what I told you earlier.** "Newest board wins" would throw away the other device's edits to *different* items. This is strictly safer. |
| **C6** | The tag filter **fades** non-matching items (to ~20%) instead of hiding them. Picking several tags shows items with **any** of them. A group stays bright if anything inside it matches. | Keeps your layout and lines readable while filtering, and you can still find items hidden inside groups. |
| **C7** | **Undo / redo** (buttons + Ctrl+Z / Ctrl+Y). | Dragging and grouping make mistakes easy, and sync would copy a mistake to the other device. |
| **C8** | Deleting a group asks first ("Delete Health and its 12 inside items?") and can be undone. | Prevents losing a whole group by accident. |
| **C9** | **Double-click / double-tap** on empty space creates an item there. A **+** button creates one in the middle of the screen. | Not specified. These are the usual canvas conventions. |
| **C10** | Long-press is decided **on release**: hold then release without moving = edit; hold then move = drag. The phone vibrates lightly when the hold registers. | Stops the editor opening when you just paused before dragging. |
| **C11** | The PNG picture shows **the board you're looking at**, with groups collapsed. | Predictable output. Open trays could cover other items in a picture. |
| **C12** | **Duplicate into canvas**: into the *same* canvas → placed next to the original on the same board. Into *another* canvas → its top level, near the middle. | The most likely intent in each case. |
| **C13** | **Pan / Select mode button** (top bar, ✋ / ⬚; PC shortcuts **H** / **V**; remembered per device). The mode only changes what dragging **empty space** does: Pan mode moves the board, Select mode draws the selection box. Blobs can be dragged in both modes; pinch and the mouse wheel always pan/zoom. Same on PC and phone. | Chosen by you (option A): one simple rule, nothing is lost in either mode. |

---

## 4. Tech stack

| Choice | Why |
|---|---|
| Plain HTML + CSS + JavaScript (ES modules). **No framework, no build step, no external libraries.** | Simple to read and change. Nothing to install (this PC has no Node). Every file works offline once cached. |
| **PWA** (manifest + service worker) | Installs like an app on Windows (Edge/Chrome) and Android (Chrome), works offline, updates itself. |
| **GitHub Pages** hosting (public repo) | Free HTTPS hosting, which Android needs to install a web app. The repo holds code only, never your data. |
| **IndexedDB** on each device | The browser's built-in database. Stores pictures as files (localStorage's ~5 MB limit would fill up fast). |
| **Dropbox HTTP API**, called directly with `fetch` | Sync without running our own server. Sign-in uses OAuth "PKCE", which is made for apps that have no server. No Dropbox SDK needed. |
| HTML elements for items, an SVG layer for lines | Text wrapping, pictures and CSS animation come free with HTML elements. SVG draws arrowheads natively. |
| Pointer Events | One code path for mouse, touchpad, touch screen and pen. |
| System fonts (Segoe UI on Windows, Roboto on Android) | Both include Greek, load instantly, work offline. |
| Python's built-in web server for local testing | Already installed (3.13). ES modules and service workers need `http://localhost`; double-clicking the HTML file won't work. |

---

## 5. Architecture

```
 ┌──────────────────────────────── UI  (js/ui) ────────────────────────────────┐
 │ app (navigation, back button) · topBar · board · itemView · tray · linksLayer│
 │ editSheet · tagPicker · colorPicker · imageLibrary · canvasMenu · dialogs    │
 │ gestures ─► dragDrop                                                         │
 └──────────────▲──────────────────────────────────────────┬───────────────────┘
     re-draw on "changed" events                   calls named actions only
 ┌──────────────┴──────────────────── Core  (js/core) ─────▼───────────────────┐
 │ store: data in memory + actions + undo/redo   model: rules, checks, copying  │
 └──────────────▲──────────────────────────────────────────┬───────────────────┘
          load at start                          save instantly, mark "dirty"
 ┌──────────────┴──────────────── Persistence  (js/persist) ▼──────────────────┐
 │ db: IndexedDB wrapper          localRepo: canvases, tags, pictures, settings │
 └──────────────▲──────────────────────────────────────────┬───────────────────┘
       apply changes from the other device        upload dirty canvases/pictures
 ┌──────────────┴──────────────────── Sync  (js/sync) ─────▼───────────────────┐
 │ syncEngine ── merge          dropboxApi ── dropboxAuth ──────► Dropbox       │
 └──────────────────────────────────────────────────────────────────────────────┘
  Helpers used everywhere (js/services — no screen, no storage):
  layout · geometry · color · imageProcessor · exportJson · exportPng
  Shell: index.html · manifest.webmanifest · sw.js (offline cache, update prompt)
```

**Four rules that keep it simple**

1. **Only `store` actions change data.** The screen never edits data directly, so every change is saved, synced and undoable the same way.
2. **Every change is saved on the device immediately.** The Dropbox upload follows a moment later in the background. Losing the network never loses work.
3. **Helpers are pure** (`services/` and `core/model.js`: input in, result out, no side effects), so they can be tested in the browser.
4. **During a drag, pan or pinch the screen moves elements directly** for smoothness, and calls one action only when you let go: one save, one undo step.

---

## 6. Data model

### 6.1 Canvas document — one per canvas, stored as one JSON file

```json
{
  "schema": 1,
  "id": "c-7f3a…",
  "name": "Life",
  "settings": { "thumbnails": true },
  "createdAt": 1759650000000,
  "updatedAt": 1759650000000,
  "items": { "<itemId>": { "…": "Item" } },
  "links": { "<linkId>": { "…": "Link" } }
}
```

### 6.2 Item

| Field | Type | Notes |
|---|---|---|
| id | string | random UUID |
| parentId | string or null | `null` = top level of the canvas; otherwise the group it's inside |
| title | string | max 200 characters, up to 3 lines shown; empty shows "Untitled" |
| notes | string | max 5,000 characters |
| color | "#rrggbb" | every item has one (auto-picked from the 8 base colours at creation); it also tints the mini shapes |
| thumbId | string or null | picture library id; a missing picture falls back to the colour |
| tagIds | string[] | ids from the shared tag list |
| done | boolean | greys the item out + ✓ |
| x, y | number | position on its board. x = horizontal centre, y = top edge, so growing notes push downward and the blob↔card switch stays centred |
| z | number | stacking order (the last item moved is on top) |
| order | number | position inside its group's tray |
| seed | number | picks the blob's shape and animation timing, so it looks the same on every device |
| createdAt, updatedAt | timestamps (ms) | `updatedAt` decides "newer wins" in sync |

### 6.3 Link

| Field | Notes |
|---|---|
| id, from, to | item ids; both items must have the same parent (same board) |
| arrowFrom, arrowTo | booleans: arrowhead at the `from` end / at the `to` end |
| createdAt, updatedAt | |

Only one link per pair of items.

### 6.4 Shared across all canvases

- **Tags** — one `tags.json` holding `{ id, name, color, createdAt, updatedAt }` per tag. Tag colours are auto-picked soft pastels.
- **Picture library** — each picture is stored once as a WebP file. Its id is a fingerprint (SHA-256) of the file, so the same picture added twice — or on both devices — is stored once. Pictures never change after being added, so they can never conflict in sync.

### 6.5 Device-only (never synced)

Dropbox sign-in tokens, sync bookkeeping (the last-synced version of each file), view position/zoom per board, last opened canvas, motion setting, what's expanded or selected, the active tag filter.

### 6.6 Rules the model always enforces (`model.sanitize`)

Run after every load, import and sync merge, so data can never end up broken.

| Rule | Fix applied if broken |
|---|---|
| An item can't be inside itself or anything inside it (no loops) | move one item of the loop to the top level |
| An item's group must exist | move the item to the top level ("rescued") |
| A link's two items must exist and share a board | delete the link |
| One link per pair of items | keep the newest |
| Fields have valid types, lengths and colours | reset to defaults / trim |
| Tag ids that no longer exist | ignored on screen; removed the next time that item is saved |

---

## 7. Files and folders

```
BlobBoard/
├─ index.html              page shell: top bar, board area, sheet/dialog hosts
├─ manifest.webmanifest    install info (name, icons, colours)
├─ sw.js                   service worker: offline cache + update prompt
├─ config.js               Dropbox App key + redirect URLs (public values, not secrets)
├─ css/
│  ├─ base.css             colour tokens, top bar, sheets, buttons, toasts
│  ├─ board.css            board, background, lines, selection controls
│  └─ items.css            blob/card looks, morph animation, mini shapes, badge, tray
├─ js/
│  ├─ main.js              start-up sequence
│  ├─ core/      store.js · model.js · events.js · ids.js · migrate.js
│  ├─ persist/   db.js · localRepo.js
│  ├─ sync/      dropboxAuth.js · dropboxApi.js · syncEngine.js · merge.js
│  ├─ services/  layout.js · geometry.js · color.js · imageProcessor.js ·
│  │             exportJson.js · exportPng.js
│  └─ ui/        app.js · topBar.js · board.js · itemView.js · tray.js · linksLayer.js ·
│                gestures.js · dragDrop.js · editSheet.js · tagPicker.js · colorPicker.js ·
│                imageLibrary.js · canvasMenu.js · settingsSheet.js · dialogs.js
├─ icons/                  app icons (192 px, 512 px, maskable)
├─ tests/index.html        in-browser test runner + tests for the pure modules
├─ README.md               how to run locally, deploy, set up Dropbox
└─ DESIGN.md               this file
```

About 35 small files. Each has one job and should stay under ~300 lines.

---

## 8. Modules and components

Each block gives **purpose → responsibilities → challenges it handles**.

### 8.0 Start-up (`js/main.js`)

1. Register the service worker (offline support).
2. Open the device database and upgrade old data if the format changed.
3. If returning from Dropbox sign-in, finish it and clean the address bar.
4. Load canvases, tags and the picture index into the store.
5. Take the "editor" lock (one window edits at a time — see `app.js`).
6. Show the last canvas. First run creates "My first canvas".
7. Start sync (if connected) and ask the browser to keep storage permanently.

### 8.1 Core

**`core/model.js` — the rules**
- Creators: `newCanvas`, `newItem`, `newLink`, `newTag`.
- Tree helpers: `childrenOf`, `descendantsOf`, `ancestorsOf`, `boardItems(canvas, parentId)`, `countInside`.
- `sanitize(canvas)` — the rule table in §6.6.
- `copySubtree(canvas, itemId)` → fresh ids for the item, everything inside it, and the lines among those items (lines to items outside the copy are dropped). Used by duplicate item, duplicate canvas and import.
- `badgeText(n)` → "1"…"6", then "6+".
- *Challenge handled:* one place for the rules, so the screen, sync and import can never disagree.

**`core/store.js` — the single source of truth in memory**
- Holds all canvases, tags, the picture index, and screen state (current canvas, board path, expanded path, selected item, selected line, tag filter).
- **Actions** — the only way to change data:
  - Canvas: `createCanvas`, `renameCanvas`, `duplicateCanvas`, `deleteCanvas`, `setThumbnails`, `importCanvas`
  - Item: `createItem`, `updateItem`, `moveItem`, `reparentItem` (also removes the item's lines — R23), `deleteItem` (with everything inside), `duplicateItemTo(canvasId)`, `moveItemTo(canvasId)`
  - Link: `createLink`, `toggleArrow(end)`, `deleteLink`
  - Tags: `createTag`, `renameTag`, `deleteTag` · Pictures: `addImages`, `deleteImage`
  - History: `undo`, `redo`
- Every action: check the rules → change the data → stamp `updatedAt` → record an undo step → save on the device → mark the canvas "dirty" for sync → announce what changed.
- **Undo:** before each action a copy of the affected canvas(es) is kept (last 50 steps). One editor session = one undo step, not one per keystroke. When a change arrives from the other device, that canvas's undo history is cleared; otherwise undo would also revert the other device's work.
- **Move to another canvas:** writes the target canvas first, then removes from the source. If anything fails halfway you get a duplicate, never a loss.

**`core/events.js`** tiny publish/subscribe · **`core/ids.js`** UUIDs · **`core/migrate.js`** upgrades older saved data when the format changes (`schema` number), so old canvases, old exports and the other device's files always open.

### 8.2 Persistence

**`persist/db.js`** — small promise-based IndexedDB wrapper. Stores: `canvases`, `syncMeta`, `tags`, `images`, `settings`.

**`persist/localRepo.js`**
- Loads everything at start. Saves a canvas ~300 ms after a change, and immediately when the app goes to the background.
- Keeps, per canvas: a `dirty` flag, the Dropbox version (`rev`), and a **base copy** — the last version both devices agreed on. The merge needs it (§11).
- Pictures: stores the file and its size; hands out reusable `blob:` URLs for display.
- Asks the browser for **persistent storage**, so Android doesn't clear it when space runs low.

### 8.3 Sync (details in §11)

**`sync/dropboxAuth.js`** — connect / disconnect. PKCE sign-in: go to Dropbox, come back with a one-time code, swap it for an access token (4 h) plus a long-lived refresh token. Refreshes automatically. "Disconnect" revokes the token at Dropbox and deletes it from the device.

**`sync/dropboxApi.js`** — thin wrapper around the 8 Dropbox endpoints used (list folder, continue listing, long-poll, download, upload, delete, token, revoke). Handles: retry with back-off on network errors, Dropbox's "slow down" replies (429 + Retry-After), expired token → refresh and retry once, and clear error types (conflict, not found, Dropbox full, signed out).

**`sync/syncEngine.js`** — decides when to sync and what. **Pull** at start, when the app comes back to the front, and when Dropbox reports a change. **Push** dirty canvases ~2 s after you stop editing (at most every 10 s while you keep editing) and when the app goes to the background. Publishes the status shown in the top bar.

**`sync/merge.js`** — pure 3-way merge of a canvas and of the tag list (rules in §11.3), followed by `sanitize`.

### 8.4 Services (pure helpers)

| Module | Job | Challenges handled |
|---|---|---|
| `layout.js` | Item size rules (blob width from title length; growth for notes up to the max; card width 180 px), tray grid (3 per row up to 9 items, then 4), `findFreeSpot` so new or dropped-in items don't land on top of others | the same sizes feed lines, trays and the PNG |
| `geometry.js` | screen ↔ board coordinates; where a line meets an item's outline (ellipse for blobs, rounded rectangle for cards); bounds of a board; "is this point near a line" | arrowheads sit on the edge instead of hiding under the item |
| `color.js` | the 8 base colours, colour conversions, **text colour chosen automatically** (black or white) from the background brightness, pastel tag colours | titles stay readable on any custom colour |
| `imageProcessor.js` | read picked files, fix phone-photo rotation, shrink to max 640 px, save as WebP (keeps transparency), fingerprint | huge camera photos, rotated photos, PNG icons with transparency, duplicates, unsupported formats (e.g. some HEIC) → clear message |
| `exportJson.js` | build an export package (canvas + its tags + its pictures embedded as text) and **validate** an imported one (format, sizes, types, picture types) before anything reaches the store | import files are untrusted: broken or hostile files are rejected or cleaned, never executed |
| `exportPng.js` | draws the current board on an off-screen canvas: background, lines + arrowheads, blobs (same shape formula as the CSS), cards with pictures, titles, notes, tag chips, mini shapes + badges, ✓ marks; caps the picture size so phones don't run out of memory | screenshot libraries are unreliable with animation and pictures; drawing from the data is exact and works offline |

### 8.5 UI

**`ui/app.js` — shell, navigation, back button**
- The address bar records where you are (`#/canvasId/insideItemId`), so a reload reopens the same board.
- Keeps a **back stack**: open sheet or menu → expanded tray → canvas. Android's back gesture (and Esc on PC) closes the top layer first instead of exiting the app.
- **One window edits at a time** (Web Locks API). If BlobBoard is open in a second tab or window, that one shows "Open in another window — Use here", so two windows can't overwrite each other.
- Shows "Update available — Reload" when a new version has been deployed.

**`ui/topBar.js`** — compact enough for a phone (in phase 1–5 just the canvas name and tools; the switcher arrives in phase 6).
- **Canvas switcher** `[≡ Life ▾]` → list of canvases + New, Rename, Duplicate, Delete, Export file, Export picture, Import file.
- ~~Breadcrumb~~ — parked with inside boards.
- Tag filter button, thumbnails toggle (per canvas), undo/redo, sync status pill, settings ⚙.

**`ui/board.js` — the canvas you see**
- Shows one board at a time. A "world" layer is moved with `translate + scale` (pan, zoom 20%–250%, a "fit to screen" button).
- Layers, bottom to top: dotted background → SVG lines → items (with their trays) → controls overlay (✎ ● and the line's + / − / ×). Controls are drawn at a fixed screen size so they stay tappable at any zoom.
- Redraws by id: only items that changed are redrawn.
- Pauses blob animation for items off screen and while you pan or zoom.
- An empty canvas shows a hint: "Double-tap empty space or press + to add an item".

**`ui/itemView.js` — one item**
- Builds the blob or card (per R8), title, notes (cut off with "…"), up to 3 tag chips (+N more), ✓ when done, mini shapes + badge when collapsed, the tray when expanded.
- Two sizes: normal, and **mini** (~60%, used in trays) — same component.
- Animation: three layers — `.item` holds the position (moved by JavaScript), `.item-jelly` carries the physics transform, `.item-body` has the outline (set by physics) and a CSS bob of ±3 px. Each layer owns its own `transform`, so they never fight.
- **Physics (`ui/physics.js`, v2):** one shared loop. Idle on-screen blobs update their organic outline ~30×/s (15×/s automatically if the loop gets slow). While dragging: the front is pressed flat by "air" and the blob squeezes slightly front-to-back (no long stretch); swells when picked up, splats and wobbles on drop. Hovering over another blob flattens both touching edges without moving it. Dropping pushes overlapped blobs aside by the minimum distance, and pushed blobs push their neighbours (chain reaction; one undo step; pushed blobs glide). Size changes (notes) spring with overshoot. Off with "reduce motion". Rollback point for v1 physics: git tag `physics-v1`.
- Blob ↔ card switch: measures the old and new shape and animates between them; text fades during the 300 ms morph so it doesn't stretch.

**`ui/tray.js` — expanded view (R16, R17)**
- A panel floating under the group, above other items, with a soft shadow. Holds all inside items as minis, wrapping 3–4 per row.
- Tap a mini → it expands inside the tray (nested). Tap again → collapse.
- Minis drag like any item: out onto empty board = leave the group; onto another item (held) = go inside that item.
- No lines inside trays. Minis have no connect dot.
- The tray ends with a **+ tile** (R16) that creates a new item inside, with the birth animation, and opens the editor.

**`ui/linksLayer.js` — lines (R21–R23)**
- Straight lines from edge to edge; arrowheads (SVG markers) at either end.
- An invisible 20 px-wide line on top of each one makes it easy to tap on a phone.
- Selected line: highlighted, with **+** or **−** near each end (+ adds the arrowhead there, − removes it) and **×** in the middle (delete).
- While an item is dragged, only its own lines are redrawn.

**`ui/gestures.js` — one state machine for every finger and mouse**

```
 idle ──down on item──► pressing ──moved > 6 px──► dragging item ──up──► drop (dragDrop)
  │                       │ held 500 ms, not moved ─► holding ──moved──► dragging item
  │                       │                              └─────up─────► open editor
  │                       └──up before 500 ms──► tap (select; expand/collapse a group)
  ├──down on ● dot───► drawing a line ──up on an item on the same board──► create link
  ├──down on empty───► panning ──second finger──► pinch-zooming
  └──down on a line──► select the line
 Second finger during any item drag → the drag is cancelled (item goes back), pinch starts.
```

- Distances are in screen pixels, so it feels the same at any zoom.
- Phase 3b adds a **selecting** state: in Select mode, moving from `emptyPress` starts the box instead of panning (same on PC and phone); from then on moving the pointer resizes the box. Pinch and wheel are unaffected.
- Stops the browser interfering: no page scrolling, no pull-to-refresh, no double-tap zoom, no text selection, no Android long-press menu on the board.

**`ui/dragDrop.js` — where a dragged item lands (R14, R17, R26)**
- While dragging, finds what's under the finger, ignoring the dragged item and everything inside it (so a group can't be dropped into itself).
- Over an item for 500 ms → the target **swells** (plus a tiny vibration on Android) = armed. Moving off disarms it.
- Drop on an armed item → `reparentItem`: lines removed, added to the end of its tray. While armed, the target swells to show around the held blob (R26).
- Drop on empty board → move there (and leave its group if it came from a tray). Drop anywhere else (a tray, a mini without holding) → snaps back.
- Auto-scrolls the board when you drag near the screen edge (needed on phones).
- Drawing a line only accepts items on the same board; anything else shows "not allowed".

**`ui/editSheet.js` — the editor (R5, R9, R19, R20)**
- Bottom sheet on phone, side panel on PC. Fields: title, notes, tags, colour, thumbnail, done.
- Actions: Duplicate to canvas…, Move to canvas…, Delete.
- Changes apply live (you see the item update behind the sheet); one undo step per opening.
- A new item stays when the editor closes, even if untitled (R25).
- Stays above the Android keyboard: the page resizes for the keyboard and the focused field scrolls into view.

**`ui/tagPicker.js` — tags (R10, R11)**
- Type to filter. Matching ignores upper/lower case and accents, Greek included ("υγεια" finds "Υγεία").
- Enter or "Create 'xyz'" adds a new tag to the shared list; it appears in every dropdown from then on. Duplicate names are prevented.
- Tag manager (opened from settings): rename, delete.
- Filter mode: pick one or more tags; drives the fading on the board (C6).

**`ui/colorPicker.js`** — the 8 base swatches + "Custom": a square you drag in (saturation/brightness) and a hue bar. Works with finger or mouse, live preview, hex field.

**`ui/imageLibrary.js`** — "Add pictures" (multi-select from the device), a grid of library pictures (loaded as you scroll), pick one as the thumbnail, "Remove thumbnail", delete from the library (warns how many items use it; those fall back to their colour).

**`ui/canvasMenu.js`** — the canvas actions (R3, R4). Export file: `Life.blobboard.json`. Export picture: `Life-Health-2026-10-05.png`. On Android also offers **Share** (straight to Drive, mail, etc.). Import always creates a **new** canvas with fresh ids, so importing twice on one device can't clash; tags are matched by name; pictures dedupe by fingerprint.

**`ui/settingsSheet.js`** — *(phase 2 version: per-canvas "Show inside items: Tray / Inside the blob", R27; the rest arrives in later phases)* — Dropbox connect/disconnect + last sync time; motion (Full / Calm / Off, following the device's "reduce motion" setting by default); tag manager; picture library; app version + "Check for update".

**`ui/dialogs.js`** — confirm, rename prompt, toast messages, an "Undo" toast after deletes.

### 8.6 PWA shell

- **`manifest.webmanifest`** — name "BlobBoard", opens in its own window, start URL and scope `./` (so it works under `/BlobBoard/` on GitHub Pages), icons including a "maskable" one for Android.
- **`sw.js`** — caches all app files under a version name and serves them offline. Never caches Dropbox traffic. A new deployment means a new version, which triggers "Update available — Reload" (no stale-app confusion).
- **`index.html`** — a Content-Security-Policy that only allows the app's own files and the three Dropbox addresses.

---

### 8.7 Multi-select (phase 3b)

- **Mode button** (`topBar.js`): ✋ Pan / ⬚ Select, H / V on PC, saved in device settings.
- **`ui/selection.js`** — the selection box (a dashed, softly tinted rounded rectangle drawn in screen space), hit-testing items against it (an item is selected if the box *touches* its outline, like Windows), and the selected-set in the store's screen state (`ui.selectedIds`). Shows a small bar: "3 selected · Delete · ✕".
- **Moving many:** dragging any selected item moves all of them, keeping their spacing. Each gets the liquid "air" physics. On drop, all moved items are treated as fixed and only *other* blobs are pushed aside (`resolveOverlaps` takes a set of fixed ids). One undo step.
- **Dropping many onto an item** (held 0.5 s) puts them all inside it; each one's lines are removed (R23).
- **Delete** (key or bar button) removes all selected items, asking first if any of them has items inside. One undo step.
- **Store actions:** `moveItems` (exists), plus `reparentItems` and `deleteItems` (batch versions, one undo step each).
- **Limits:** only items on the board you're viewing can be box-selected (not minis inside a tray). ✎ is hidden while more than one item is selected. Tap empty space or Esc clears the selection.

## 9. Interaction spec

| Where | PC | Phone | Result |
|---|---|---|---|
| Item | click | tap | select (shows ✎ ●) |
| Selected item | click again / double-click | tap again | expand fully (whole notes + tray with + tile); again → collapse |
| + tile in a tray / container | click | tap | new item inside that item |
| Mini in a grid | drag within the grid | drag within the grid | reorder; the others slide aside (R28) |
| Description box (container) | click | tap | edit it in place; **−** hides it for now |
| ⚙ | click | tap | Settings: tray or container view (per canvas) |
| Item | right-click, or ✎ | long-press then release, or ✎ | open the editor |
| Item | drag | drag | move |
| Item dragged over another item, held 0.5 s | | | target swells to show around the held blob → drop = put inside |
| Mini (in a tray) dropped on empty board | | | leaves the group, lands where dropped |
| ● dot dragged to another item on the same board | | | new line |
| Line | click | tap | select → + / − at each end, × in the middle |
| Empty board, Pan mode | drag | one-finger drag | pan |
| Empty board | mouse wheel / two-finger scroll | — | pan |
| Empty board | Ctrl + wheel / touchpad pinch | two-finger pinch | zoom (20%–250%) |
| Empty board | double-click | double-tap | new item there |
| Empty board | click | tap | deselect, collapse the tray |
| Empty board, Select mode (C13) | drag | drag | selection box: every item it touches gets selected |
| ✋ / ⬚ button, or H / V on PC | click | tap | switch Pan / Select mode (only changes empty-space drags) |
| Item | Ctrl/Shift + click | — | add / remove that item from the selection |
| Any selected item | drag | drag | all selected items move together |
| + button | click | tap | new item in the middle of the screen |
| Back | Esc | Android back | close sheet → collapse tray → (exit) |
| Keyboard | Ctrl+Z / Ctrl+Y undo/redo · Delete removes the selected line or item · Enter edits the selected item | | |

All buttons are at least 40 × 40 px on touch screens.

---

## 10. Visual spec

```
 Blob (collapsed group)    Card (thumbnails ON)      Expanded (after tap)
     .-~~~~~~-.             ┌──────────────┐             .-~~~~~~-.
   (   Health   )           │   picture    │           (   Health   )
   (  notes…    )           │ ┌──────────┐ │            `-.______.-'
    `-.______.-'            │ │  Title   │ │      ┌──────────────────────────┐
      ▢ ▢ ▢ (5)             │ └──────────┘ │      │ (Gym)  (Diet)  [Sleep▣]  │
      ▢ ▢                   │ notes…       │      │ (Meds) (Run)             │
                            │ #tag #tag    │      └──────────────────────────┘
                            └──────────────┘
 Selected line:   (A) ─[+]──────────[×]──────────[−]─▶ (B)
```

- **Board** — warm off-white with a faint dot grid; white cards; soft layered shadows; 18 px corner radius.
- **8 base colours** (soft, Pinterest-like): coral, tangerine, sunflower, mint, teal, sky, lavender, rose.
- **Blob** — organic outline from 4 slow oscillators driving the 8-value `border-radius` (timing from `seed`), with enough padding that text never touches the moving edge. Width 110–200 px depending on the title; grows with notes up to ~240 × 300 px, then "…".
- **Card** — 180 px wide; the picture keeps its own shape (height/width limited to 0.6–1.6); the title sits on a dark see-through pill at the bottom of the picture (readable on any picture); notes and tags underneath.
- **Mini shapes** — 2 rows × 3, ~14 px each, wobbling slightly, tinted with the colours of the first 6 inside items; badge "1"–"6" or "6+" at the corner.
- **Done** — greyed out (less colour, lower opacity) + ✓ badge.
- **Filter** — non-matching items at ~20% opacity.
- **Dragging** — the dragged item lifts (bigger shadow, liquid physics above); blobs it touches flatten where they meet; an armed target swells 12% with a coloured glow.
- **Motion setting** — Full (morph + bob), Calm (bob only), Off.

---

## 11. Sync design

### 11.1 What lives in your Dropbox

The app only gets its own folder, `Dropbox/Apps/<your app name>/`, and cannot see anything else in your Dropbox.

```
canvases/<canvasId>.json                   one file per canvas
tags.json                                  the shared tag list
images/<fingerprint>.webp                  the picture library
backups/<canvasId>/<time>-<device>.json    only written on true conflicts (newest 20 kept)
```

Files are named by id, not by canvas name: renaming a canvas needs no file move, and Greek names can't break Dropbox's request headers (which must be plain ASCII).

### 11.2 Flow

```
 You change something
   └► store action ─► saved on this device instantly ─► canvas marked "dirty"
                                   │  (2 s after you stop · ≤ 10 s while editing · or app → background)
                                   ▼
        upload "only if Dropbox still has the version I last saw"
          ├─ accepted ──► remember the new version; base copy = this one; not dirty
          └─ rejected (the other device saved first)
                └► download theirs ─► 3-way merge (base, mine, theirs) ─► upload again

 The other device
   Dropbox says "something changed" (long-poll; falls back to checking every 30 s while open),
   or the app is opened / brought to the front
     └► download the changed files ─► not dirty: take theirs · dirty: merge
        (if you're mid-drag or in the editor, it waits until you finish)

 Pictures: uploaded before the canvas that uses them; downloaded when first needed.
```

### 11.3 Merge rules (3-way: the last agreed version vs. mine vs. theirs)

| Situation | Result |
|---|---|
| Changed on one device only | that change is kept |
| Both changed **different fields** of the same item (e.g. title here, notes there) | both kept |
| Both changed the **same field** | the newer edit wins; the full losing version is saved to `backups/` |
| Both changed the tags of the same item | combined (additions and removals from both) |
| Deleted on one device, untouched on the other | deleted |
| Deleted on one device, **edited** on the other | kept — an edit is never silently lost |
| An item's group was deleted on the other device | the item moves to the top level |
| One device put A into B, the other put B into A | one of them goes back to the top level |
| Canvas deleted on the other device while you edited it here | kept, re-uploaded, and a message tells you |
| A line's two items are no longer on the same board | line removed |

### 11.4 Status pill

`Not connected` (tap to connect) · `✓ Synced` · `Saving…` · `Offline – 3 changes waiting` · `Sign in again` · `Dropbox full` · `Sync problem – tap for details`. In every state your data is safe on the device.

### 11.5 Limits to know

- If you edit on the phone and close the app **while offline**, the PC sees the change the next time the phone app is opened online. (Uploading from a closed app — "Background Sync" — is a possible later add-on.)
- "Newer wins" uses each device's clock. Phones and PCs set their time automatically, so this is fine in practice.

---

## 12. Challenges and how they're solved

| # | Challenge | Solution |
|---|---|---|
| 1 | Tap vs long-press vs drag vs pinch on the same item | one gesture state machine (§8.5); long-press decided on release; a second finger turns a drag into a pinch |
| 2 | The browser stealing gestures (scroll, pull-to-refresh, double-tap zoom, text selection, long-press menu) | `touch-action: none`, `overscroll-behavior: none`, `user-select: none`, context menu blocked on the board |
| 3 | Android back gesture closing the app | back stack mirrored in browser history (`app.js`) |
| 4 | Constant animation draining phone batteries | animation on an inner element, paused off screen and during pan/zoom; Calm/Off settings; respects "reduce motion" |
| 5 | Lines attached to wobbling shapes | lines attach to the item's steady outline; the bob is only ±3 px |
| 6 | Trays overlapping other items | the tray floats above with a shadow; one top-level tray at a time (C2) |
| 7 | Text unreadable on custom colours or busy pictures | automatic black/white text; title pill over pictures |
| 8 | Groups in loops, orphaned items, dangling lines | rules enforced in actions + `sanitize` after every load, merge and import |
| 9 | Both devices editing the same canvas | one file per canvas, version-checked uploads, 3-way merge, backups only on true conflicts |
| 10 | Work lost if the app closes mid-sync | saved on the device instantly; upload when going to background; upload again on next open; the pill shows what's waiting |
| 11 | Dropbox sign-in without a server | OAuth PKCE + refresh token. If sign-in misbehaves inside the installed app, connecting once in the browser carries over (same storage) |
| 12 | Huge, rotated or odd-format photos | shrunk to 640 px WebP, rotation fixed, clear message for unsupported formats |
| 13 | Same picture added twice or on both devices | fingerprint ids → stored once, never conflicts |
| 14 | Android clearing app storage | persistent-storage request; Dropbox holds a full copy anyway |
| 15 | Old cached version after an update | versioned offline cache + "Update available" prompt |
| 16 | Broken or malicious import files | validated before import; text always inserted as text, never HTML; strict CSP; fresh ids |
| 17 | Greek text | system fonts with Greek; accent-insensitive tag search; ASCII-only file names in Dropbox |
| 18 | PNG export of a big board on a phone | drawn from the data, not a screenshot; size capped |
| 19 | Two windows open at once | Web Locks: one editor, the other read-only with "Use here" |
| 20 | Future format changes | `schema` number + upgrade steps for local data, Dropbox files and imports |
| 21 | Moving an item between canvases isn't one atomic step | write the target first, then remove from the source |
| 22 | Keyboard covering the editor on Android | the page resizes for the keyboard; the focused field scrolls into view |
| 23 | Tiny controls when zoomed out | controls drawn at a fixed screen size; ≥ 40 px touch targets; wide invisible tap line for lines |
| 24 | Speed with many items | redraw by id, only moving lines redrawn during drags, animations paused off screen; tested with a generated 300-item canvas |

---

## 13. Security and privacy

- **Your data** lives only on your devices and in the app's own Dropbox folder. The app's Dropbox permission is "App folder", so it can't read the rest of your Dropbox.
- **The public GitHub repo** contains code only. The Dropbox **App key** in `config.js` is public by design (PKCE needs no secret). The **App secret** is never used — don't put it anywhere.
- **Tokens** are stored in the browser database on each device. "Disconnect" revokes them at Dropbox.
- **No third-party scripts**, a strict Content-Security-Policy, and user text is never inserted as HTML, so an imported file can't run code.
- **Shared-address caveat:** every GitHub Pages site under your account shares the address `<username>.github.io`, and with it browser storage. Only publish your own trusted code there, or later give BlobBoard its own address with a custom domain.

---

## 14. Testing and verification

| What | How | Who |
|---|---|---|
| Pure logic: merge (~15 scenarios), sanitize, copy/duplicate, move between canvases, import validation (including hostile files), badge text, colour contrast, geometry, free-spot placement, upgrades | `tests/index.html` runs in the browser and shows pass/fail | me, every phase |
| Screens and flows at PC and phone sizes | the in-app browser pane (mouse-driven) | me |
| Real touch: pinch, long-press, drag-hold-drop, back gesture, keyboard over the editor, installing, smoothness with 300 items | checklist on your Android phone | you (I can't touch a real phone) |
| Dropbox sign-in and two-device sync | scripted scenarios, e.g. edit different items offline on both → both kept; same title on both → newer wins + backup file; delete a canvas on one while editing it on the other → kept | you, with my checklist |

After each phase I'll report what passed, what failed and what I couldn't test.

---

## 15. Build phases

Each phase ends with a deploy to GitHub Pages so you can try it on your phone.

| Phase | Delivers | Done when |
|---|---|---|
| 0 Setup | folder, local server config, test runner; repo + Pages (you); a "hello" page live | page opens on PC and phone |
| 1 Board basics | model, store, device database, pan/zoom, animated blobs, create/edit (title, notes, colour picker, done), move, undo | items survive a reload; tests pass |
| 2 Groups | drag-hold-into (target swells around the held blob), mini shapes + badge, tap-again full expansion with tray + add tile (nested), container view option (R27), reorder (R28), drag minis out, back stack | R14–R17, R26–R28 checklist passes |
| 3 Lines | connect dot, lines, select, + / − arrows, × delete, removal on regrouping | R21–R23 pass |
| 3b Multi-select | Pan/Select mode button (✋/⬚, H/V), selection box, Ctrl/Shift+click, move many with physics and push-apart, drop many into a group, delete many | R24 checklist passes |
| 4 Pictures and cards | picture library, processing, card look, thumbnails toggle + morph | R7–R8 pass |
| 5 Tags | picker with create, chips, manager, filter | R10–R11 pass |
| 6 Canvases | switcher, new/rename/duplicate/delete, duplicate/move item to canvas | R3, R20 pass |
| 7 Export / import | file export/import, PNG picture, Android share | round-trip test passes |
| 8 Dropbox sync | sign-in, sync engine, merge, status pill, live updates, one-window lock | two-device scenarios pass |
| 9 App polish | offline cache, update prompt, icons, install on both devices, speed pass | installed on both; works offline |

---

## 16. Your one-time setup

**GitHub (before phase 0)**
1. Create a **public** repo named `BlobBoard` (empty).
2. Settings → Pages → Source: *Deploy from a branch* → `main`, `/ (root)`.
3. Tell me your GitHub username (needed for the app's address and the Dropbox redirect). You push with your own login; I'll give you the commands.

**Dropbox (before phase 8)**
1. dropbox.com/developers/apps → *Create app* → *Scoped access* → *App folder* → a unique name (e.g. `BlobBoard-GB`).
2. *Permissions* tab: tick `files.metadata.read`, `files.content.read`, `files.content.write` → Submit.
3. *Settings* tab: Redirect URIs → add `https://<username>.github.io/BlobBoard/` and `http://localhost:8000/`. Set *Allow public clients (Implicit Grant & PKCE)* to **Allow**.
4. Paste the **App key** into `config.js`. (Ignore the App secret.)

---

## 17. Not in v1 (possible later)

**Parked:** inside boards / sub-canvases (⤢ + breadcrumb) — built in phase 2, removed 2026-10-05 at your request; may or may not come back.

Search · due dates / reminders · sharing with other people or live collaboration · dark mode (colours are set up as tokens to make this easy) · picking a whole folder of pictures · uploading from a closed app (Background Sync) · reordering items inside a tray · lines between different levels · iPhone testing.
