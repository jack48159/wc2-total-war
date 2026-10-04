# Troubleshooting

- `missing-operation-reason` / `operation-reason-too-long` / `operation-reason-must-be-chinese`: add a truthful Chinese explanation for this exact mutation, in one or two sentences and at most 80 characters. Read-only tools do not need it.

- `no-game`: list saves, then resume the exact slot.
- `invalid-player-country`: use returned `validCountries`; aliases do not replace stage-specific IDs such as `gb1` (`game_04_battle_allies3.md:3`).
- `not-player-turn`: finish/wait for current controller sequence; refresh state.
- `high-risk-confirmation-required`: read risk/path/unit previews; repeat only deliberately with `confirmHighRisk:true`.
- `illegal-target` / `target-not-attackable`: refresh unit/card view and select a returned legal target. Do not retry stale coordinates.
- `manual-action-priority`: the unit was manually used this round. Wait until next round or intentionally reissue the formation order.
- `防线目标不匹配`: make `to`, `line`, and supplied `mustHold` identical full arrays (`public/src/game/army_groups.js:216-223`).
- `命令包含不可通行地块` / path invalid: preview again; ensure enabled land nodes and adjacency.
- `stalled` with no rejection: inspect actual front, movement, ownership, capacity and obsolete plan; redraw current adjacent goals. The executor may not name the blocked unit (`game_01b_conquest_mirror_de.md:12,15`).
- `failed`: inspect expiry and target ownership/elimination; replace rather than toggling auto repeatedly.
- `buyCard` returns `no-legal-card-target`: the card is affordable but currently unusable. Read `ruleHint` and `legalTargetCount`; take/clear a deployment tile, build an airport, or buy another deployable card. Use `allowNoTarget:true` only when intentionally reserving the card for later (`game_03_battle_nato3.md:14-17`).
- `useCard` returns `illegal-target`: choose from `legalTargets`. The accompanying `ruleHint` states whether the card needs an airport/range, open deployment tile, friendly unit, port, or construction slot.
- `preview_order_path valid=false` despite plausible adjacency: use multi-start/multi-goal attack as a fallback and record the preview defect (`game_06_battle_nato4.md:6,16`).
- defend remains partially staffed: inspect each assignment; current reports may leave `rejected=[]`. Redraw a shorter reachable line or micro the missing posts (`game_02_battle_nato1.md:10-14`).
- An eliminated country's former tile shows `owner:null` with `ownershipStatus=changed-new-owner-unknown`: this is intentional fog-safe correction. The old owner is known to be gone, while the current owner remains unknown until reconnoitred. Refresh strategic/tile intel rather than treating `previousOwner` as current ownership (`game_05_battle_wto3.md:13,16`).
