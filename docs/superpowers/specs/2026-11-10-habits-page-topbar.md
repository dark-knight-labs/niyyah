# Habits page, votes in the habit headers, re-arranged top bar

Web only (apps/web). No API, database or stored-data change.

## Habits page
- `/habits` holds the full Habits board (installing / on rails / watching, retired, the habit card). It moved off the bottom of the Plan
  (`section#plan-habits` is gone). Nav: Overview, Plan, **Habits** (`g h`), Map, Progress. Settings left the nav; it is in the account
  menu and `g s` still works.
- The Plan keeps the habit lines under goals and the week ticks in Now (each Now cell has a `Habits →` link to `/habits`). "Make it a
  habit" works as before and opens the habit card on the Plan. Copy that pointed at the board now links to `/habits`.
- Overview keeps today's habit checklist.

## Votes merged into the habit headers
- The Overview `Votes` strip is removed (`votes-panel.tsx` deleted). Each counted block's header in the Habits panel has 1-3 star
  buttons (`<Block> N stars`, tap the current level to clear; group `<Block> vote`), plus the `Set N` suggestion. A counted block with
  no habit today is a header-only row. The block you are in is bright, the others are dimmed (today only). Same `setVote` call, so
  Progress is unchanged.

## Top bar
- One 44px row: Brand | nav (md+) | page slot | account. Phones: icon-only brand, the page title, the account cell (nav is at the bottom).
- `#nav-cal` became `#page-slot`; `PageSlot` (components/page-slot.tsx) portals a page's compact controls into it from 768px, and
  renders them in place on phones. The Overview's calendar bar uses it from 1280px as before.
- Plan: Label and Block are compact selects (+ Block, One goal ×, Done) in the slot; on phones one row above the table. The table's
  own quarter tabs stay in the table. Plan header (Map link, week strip) is unchanged.
- Overview bar: left = sidebar toggle, ‹ › and range, Today; centre = quick-add, which takes all free width (max 44rem); right =
  Day | Week, the view menu, calendar status. Arrow, scope and menu buttons carry tooltips with their hotkeys.
- Skin picker moved from the fixed bottom-right corner into the account menu (a select). `?skin=` and localStorage behave as before.

## Tests
`apps/web/e2e/habits-topbar.spec.ts`: Habits page via nav and `g h`, Plan has no `#plan-habits`, votes through habit headers
(incl. a habit-less counted block) and Progress's series, skin select, Plan filter menus, no overflow and a 44px bar at
390/768/1024/1280/1440/1920 on Overview, Plan and Habits (screenshots to `e2e/out/`). `plan-v2.spec.ts` uses the Label select.
