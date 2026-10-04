# MCP tools and command shapes

## Browser bridge (Multi-country seats)

- `wc2_bridge_list_games {}`: list online browser games with detailed seats (`[{ country, name, status, online, lastHeartbeat }]`).
- `wc2_bridge_attach {"game_id":"WC2-...", "country":"<seat_country>", "force":false}`: bind this MCP session to a specific country seat in that browser game. If multiple controlled countries exist, `country` is required. If another session is already online for this seat, returns an error unless `force: true` is passed to preempt.
- `wc2_bridge_wait_turn {"game_id":"...", "country":"...", "timeout_sec":20}`: wait for a pending opponent turn for the bound seat, restore an isolated copy, and return the opponent's fog-limited overview. `game_id` and `country` default to the attached seat. A timeout returns `waiting:true` and can be retried.
- Issue commands with top-level Chinese `reason`. Commands MUST strictly belong to the bound seat country. Any attempt to issue orders for other countries will be rejected.
- `wc2_bridge_submit_turn {"turn_id":"...", "reason":"本回合行动已完成。"}`: submit only successfully applied commands for this seat country. `turn_id` defaults to current turn. Never call `wc2_end_turn` in bridge mode.

## Session and views

- `wc2_list_saves {}` then `wc2_resume_game {"slot":"exact_slot"}` before continuing work.
- `wc2_new_game`: only for a genuinely new match; pass an explicit slot and Chinese `reason`.
- `wc2_get_strategic_view`: compact overall state; request detail only for command diagnosis.
- Theater/group/unit views: progressively narrow from command to unit legality.
- `wc2_get_intel(kind=tile|diplomacy|orders|events|commanders)`: focused/paged evidence under fog.
- `wc2_preview_attack`: current unit exchange from engine estimator.
- `wc2_preview_order_path`: graph route or `path`/`line`/`axes` geometry.
- `wc2_preview_order_risk`: coarse formation gate. Hidden targets return null/low confidence; this is not unit win probability.

## Formation commands

Issue commands through `wc2_do`. Put the player-facing explanation in the tool's top-level `reason`, not inside the engine command (except diplomacy's own semantic field when required).

```json
{"command":{"type":"setArmyGroup","country":"de","name":"北方集团军","commanderId":"commander-id","unitIds":[1,2,3]},"reason":"北线单位分散，先编成一个集团军统一推进和补位。"}
```

```json
{"command":{"type":"createTheater","country":"de","name":"东部战区"},"reason":"东线有两支集团军，需要建立军区统一分配进攻方向。"}
```

```json
{"command":{"type":"assignArmyToTheater","country":"de","groupId":"group_1","theaterId":"theater_1"},"reason":"这支集团军就在东线作战，划入东部战区便于协同。"}
```

One-path breakthrough with command-level path generation:

```json
{"command":{"type":"setArmyOrder","country":"de","groupId":"group_1","autoPath":true,"confirmHighRisk":true,"order":{"verb":"breakthrough","from":167,"to":150,"risk":0.7,"priority":8,"expires":4,"depth":2,"guard":"hold","detour":true}}}
```

Two-axis theater envelop:

```json
{"command":{"type":"setTheaterOrder","country":"de","theaterId":"theater_1","confirmHighRisk":true,"order":{"verb":"envelop","from":[123,1021],"to":[124,1020],"axes":[[123,124],[1021,1020]],"mustHold":[123,1021],"guard":"ring","detour":true,"risk":0.8,"priority":9,"expires":6}}}
```

Defensive line (the arrays must match):

```json
{"command":{"type":"setArmyOrder","country":"gb1","groupId":"group_1","order":{"verb":"defend","from":[1383,1384],"to":[1383,1384],"line":[1383,1384],"mustHold":[1383,1384],"guard":"hold","risk":0.5,"priority":8,"expires":4}}}
```

- Cancel with the matching set-order command and `order:null`.
- Pause/resume with `setOrderPaused`; toggle automatic execution with `setOrderAuto`; force a diagnostic execution with `executeOrder`.
- Inspect returned `plan`, `roundsActive`, `progress`, `status`, `warnings`, `rejected`, and `_lastExecKey`.

## Unit, cards, diplomacy

```json
{"command":{"type":"move","from":167,"to":150,"armyId":19},"reason":"目标地块没有守军，用装甲部队前移占住交通点。"}
```

```json
{"command":{"type":"attack","from":167,"to":150,"armyId":19},"reason":"敌军前排已被远程火力削弱，用装甲部队收尾并争取占领。"}
```

- Query the unit immediately before micro; legal actions can change after any move/attack.
- For cards, inspect `deployable`, `legalTargetCount`, `reason`, and `ruleHint` in the strategic shop or `wc2_list_actions`. `wc2_do buyCard` refuses a card with no current legal target by default. Pass `allowNoTarget:true` only when deliberately banking it for a later position. If `useCard` is rejected, follow returned `legalTargets` and `ruleHint`.
- Use `proposeDiplomacy` for negotiated NAP/alliance/peace. `setDiplomacy` is scenario/admin state mutation, not ordinary play.
- Amphibious movement is unit/card behavior, not a standing-order verb; use returned `amphibiousMoves`.

## End, save, diagnostics

- `wc2_end_turn` requires a reason explaining why no further useful action remains; it is compact by default. Use `detail:true` or paged events only when needed.
- Missing, blank, over-80-character, or non-Chinese reasons are rejected before state changes. Successful responses echo the reason and the event is available through `wc2_get_intel(kind=events)`.
- Every successful mutation atomically replaces `scratch/ai_lab/mcp/saves/<slot>.json`.
- `wc2_save_record` saves an evaluation record; it does not replace the required human-readable game log.
- `wc2_list_actions` exposes current API version, rules fingerprint, command schemas, and aliases (`us→am`, `uk→gb`, `su→ru`). Stage-specific IDs can still be `gb1`, etc.; trust `validCountries`.

## Safety interpretation

- High-risk confirmation is a deliberate gate; preview before repeating with `confirmHighRisk:true`.
- Country elimination is public: `eliminated=true` now carries `territoryCount=0` and `territoryStatus=transferred`. Under fog, `ownershipChangesUnknown` means the remembered old owner was eliminated but the new owner has not been reconnoitred; do not infer the beneficiary (`game_05_battle_wto3.md:13,16`).
- Do not treat an empty `rejected` list as proof that a stalled order is feasible (`game_01b_conquest_mirror_de.md:12,15`).

## 桥接工具补充
- `wc2_bridge_wait_turn`：默认最长等 600 秒(10 分钟)，内部分段长轮询；返回 `waiting:true` 就继续调用。
- `wc2_bridge_submit_turn`：提交前会在回合初始快照上重放校验；`reason` 与本回合每次操作的 `reason` 会作为弹幕发给浏览器。
- `wc2_get_turn_brief`：一次取回合/阶段/战略视图/生效指令/警告/动作类型。
- `wc2_do_batch` 的 attack 可带 `when:{minKill,maxAttackerLoss,minDamage}`，不满足则跳过(skipped)。
- `wc2_bridge_attach`：对局还没在桥上登记时自动重试，默认最长 300 秒(`wait_sec`，最大 1800)。
- `wc2_bridge_say`：在玩家屏幕弹幕里发话(每条 ≤1200 字)；对局结束(wait_turn 返回 gameOver)后用它发表心理历程和较长的总结感言。
- `wc2_bridge_wait_turn` 可能返回 `gameOver:true`：对局已结束，不会再有新回合。

## 全局地图工具

`wc2_get_map_view {"image":true}` 返回结构化地图文本与 PNG 图像两块 MCP content。`image:false` 仅返回文本。普通对局默认玩家视角，桥接对局固定绑定国家视角，不接受任意国家参数。

地图覆盖关卡启用的全部地块，节点位于真实地图中心坐标，连线表示真实邻接；节点数字对应 nodes 的 id/name。蓝=本国、绿=盟友、红=敌方、灰=未知；暗色表示过往归属。大节点带白心表示可见部队，兵种、血量和移动力在 nodes.units 中。图片为位置与通路示意，不是地块边界图。

nodes 包含 x/y、neighbours、owner、ownershipStatus、visible、公开建筑与可见兵力。迷雾外当前兵力和建筑不返回，敌方仅显示前排单位，堆叠数不代表后排详情。每个新 gameId 的首次可行动 bridge_wait_turn 自动附图；需要更新时主动调用本工具。已有 MCP 进程需重连加载新工具，客户端需保留并向模型转交 image content。