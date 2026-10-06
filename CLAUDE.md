# BlobBoard — rules for AI assistants

Start every session by reading `HANDOVER.md` (start with §0; status, decision log, how it works, gotchas, how to move the project), then the relevant part of `DESIGN.md` (requirements R1–R33, choices C1–C14).

- Vanilla ES modules, no build step, no external libraries. Only `core/store.js` actions change data.
- Every change: code + tests (for logic) + a dated line in HANDOVER.md's decision log + DESIGN.md if a requirement changed (back DESIGN.md up first). Update HANDOVER "Status" and test count. Bump `js/version.js` before every deploy.
- Ask the owner all open questions in one batch, each with a recommended default, before building (95% rule).
- Anything that moves geometry without physics must call `physics.kick()` (the loop sleeps when idle). New effects get a `MOTION` switch.
- State selectors in CSS use direct-child chains (`.item.x > .item-jelly > .item-body > …`) — minis live inside parents.
- Verify with `tests/` (ALL PASSED) locally and on the live site after pushing; say what wasn't tested (real touch).
- Never read credentials. Push with `git push origin main` (repo-scoped token already stored). Commit email is set in repo config.

## Applied Learning
One bullet, ≤15 words, no explanation.

- Hidden browser pane: no rAF/ResizeObserver, throttled timers, no focus; use `tick()`, screenshots.

- Pages deploy stuck queued: poll live js/version.js, not GitHub API.

Bullet count: 2/30
