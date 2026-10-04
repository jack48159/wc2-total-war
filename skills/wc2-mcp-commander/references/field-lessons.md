# Six-game field lessons

All games used seed 20261001 and ScriptedAi.

## Results

- `conquest_mirror_de/de`: unresolved at the manual 30-round cap; de 27 vs dx 15. Save restoration retained RNG/order/plan. Static axes repeatedly aged into stalls (`game_01b_conquest_mirror_de.md:3-16`).
- `battle_nato1/am`: defeat, round 25, 0 stars. A 2/5 defensive line survived locally but did not eliminate enemies; 2209/610 resources were wasted (`game_02_battle_nato1.md:3-15`).
- `battle_nato3/gb`: defeat, round 19, 0 stars. Bought heavy-tank card stayed unusable with `legalTargets=[]`; the envelop plan kept obsolete assignments (`game_03_battle_nato3.md:3-17`).
- `battle_allies3/gb1`: defeat, round 17, 0 stars. Dynamic axis redraw restored progress; explicit defensive arrays worked; battlefield supply healed the whole stack (`game_04_battle_allies3.md:3-16`).
- `battle_wto3/ru`: defeat, round 17, 0 stars. Verified encirclement, armor continuation, bombing splash, manual priority and autoPath concentration (`game_05_battle_wto3.md:3-16`).
- `battle_nato4/am`: defeat, round 17, 0 stars. Multi-start attack worked, but standing attack sacrificed fragile melee units to a 544-HP battleship; resources again remained unspent (`game_06_battle_nato4.md:3-17`).

## What ScriptedAi does well

- Spends early, uses ranged preparation, then focuses and occupies (`game_01b_conquest_mirror_de.md:14`).
- Expands through empty areas and attacks a thin local sector; fixed player axes fall behind (`game_06_battle_nato4.md:6-14`).
- Punishes isolated armor spearheads in the next reply (`game_05_battle_wto3.md:8,12`).
- Allied ScriptedAi can win local exchanges yet fail the global objective; monitor every enemy country's survival (`game_02_battle_nato1.md:16`; `game_04_battle_allies3.md:14`).

## Practical conclusions

- Defense is a means, not the victory condition. In timed elimination campaigns, preserve a base and actively compress every surviving enemy.
- Re-read the strategic front after major captures. Replace stale paths rather than waiting for an opaque stall.
- Use standing orders for throughput, previews/micro for exchange quality. The executor coordinates focus but does not reliably reject suicidal melee attacks.
- Spend continuously and only buy deployable cards. The sample's defeats often ended with large reserves or trapped cards.
- Auto-organize is a starting point, not proof every unit is grouped. Audit and rerun after deployments.
- Opponent summaries and front lists are aids, not authoritative victory accounting; cross-check `eliminated`, current ownership and game result. Eliminated-country territory counts are now normalized to zero.

## 补给经验
- 战地补给（26）：默认开启地区产出补给（沿用 supplyByInfrastructure 字段），依据地块显示的金币、工业产出计算：金币×2＋工业×5，整格共享且最多250点。仅有正恢复额度的己方陆地、有伤兵时可用，不再要求城市或工业建筑仍然存在。关闭时任意己方地块共享200点；旧存档缺少开关时保持固定200点。平均分配，满血后的余额重新分配；价格与三回合冷却不变，不恢复行动力。读取合法目标及 supplyTargets.maxRecovery。
- 公平规则：对手地块只能看到最顶层单位与层数(stack.count/hiddenUnits)，下层单位详情/伤亡事件被隐藏；不要试图推断
- **叠放前排**：同一地块里，后移入的单位会自动成为最前排(被攻击的就是前排)。坦克和炮兵一起移进同一地块后，必须用 `frontArmy` 把坦克排到最前，否则脆弱的炮兵(60hp)会先被打死。实战：德国A关第 1 回合我把炮兵 17 放进前线没调前排，被对面坦克第一轮打掉。
- **突出部风险**：夺下敌方无人守的城(如波茨坦南 168)很划算，但如果它同时紧挨敌方 3 堆满编兵力(柏林、莱比锡、科特布斯)，下一回合丢失概率约 71%，应当及时后撤到有要塞/战壕的地块，不要硬守。`wc2_get_strategic_view` 的 `dangerousAreas.pLose` 就是这个估计。
- **防御战术(卡 23)**：已有同类战术的地块不能重复使用，legalTargets 里没有该地块就跳过，别再试。
- **每回合先盘点己方单位，别凭记忆**：德国A关第 3 回合我没核对，以为 167 要塞里有 3 个单位，实际两辆坦克已在对手回合被打掉，第 4 回合下令时才发现 `no-army`。新回合先用 `wc2_get_intel kind=tile` 逐个查己方有兵的地块(units 列表)，确认存活和血量再下令。
- **刚打完的单位没有移动力**：坦克攻击并占领目标后 `movementAfter` 往往为 0，同回合不能再撤回，孤身留在前线。打之前要想好它占领后的处境(带不带支援)。
- **空袭(卡10)只有约 20 点伤害**，90 元不划算；坦克/装甲车从要塞里先发制人击杀 60 血炮兵更划算。受伤害 ×1.3 的步兵(60hp)一辆满血坦克一击即可击杀。
- **炮兵"先射后动"**：炮兵移动后当回合不能再攻击(`no-movement`)，所以要把炮兵提前一回合放到射程内，下回合直接 `attack`(无反击)。炮兵 35 点/发打满血坦克，持续消耗对面前排很划算。
- **大炮集火+步兵/装甲车接力是劣势下最有效的反击**：3 门大炮(无反击)先打同一个前排目标，把它打到残血，再用受伤害小的单位补刀(`preview_attack` 看 killProbability)。德国A关第 8 回合这样连杀两辆 87、106 经验的老兵坦克，零炮兵损失。补刀时先上步兵挨第一次反击，最后装甲车补杀(目标已残，反击很弱)。杀死目标后单位会自动占领空地并保留部分移动力，记得立刻 `move` 回安全地块。
- **孤立据点别硬守**：被 3 堆以上敌军包围的前线阵地(`dangerousAreas.pLose` > 0.9)，炮兵开火后不能撤，留着就是送人头。应当在 pLose 升高的上一回合就把单位撤到下一道有互相支援的防线(城市+战壕+防御战术)。

## 首都被占时(玩家复盘，2026-10-03 de1 对 de2 德国内战)
- 首都被空降/突袭占领时，**第 1 回合就全力夺回**：集中所有能打的单位强攻，不要因为单次预估"换血不划算"就放弃——首都不丢才有稳定度和收入。
- **每回合把钱花掉**：回合开始先给出买兵清单(坦克/大炮/步兵)，并给买兵留出部署格(很多兵种只能在某个工业城部署，别先把该格塞满)。
- 兵不要停在没有壕沟/要塞的平地上；有壕沟的地块(如柏林北、波茨坦)才是集结点，先修战壕/要塞炮再摆兵。
- 后方兵力要持续调往前线夺回首都，别只留一个局部堆栈等对手来打。

## 工事与战术的使用(玩家复盘，2026-10-03 第二局)
- **工事(战壕/要塞炮/防空机枪)只修在有军队驻守、或敌人必经的地块**；不要把钱花在空地上(如没有兵的 146、143)，没有守军的工事等于白花。
- **战术卡只给确有用途的单位**：没有海战/渡江需求，不要买"强行军/运输船"这类海上/渡江战术；买前先看卡的用途和目标单位类型。
- **别过度保守**：整局守势、等对手来攻会输；有火力优势(炮兵无反击)时要先发制人，主动打击对手集结点和首都附近的弱兵，而不是只守。

## 先发制人≠孤军突入(玩家复盘，2026-10-03 第三局)
- 抢占敌方空地前先看**侧翼和后续掩护**：装甲车单独插进对手阵地会形成突出部，两翼都能被打，对手后方还有炮兵和预备队就是送人头。
- 进攻要成梯队：炮兵/坦克在同一或相邻地块互相掩护，推进的前锋不要超出后队一个地块以上；抢空地只在后面有兵能接应、且对手没有成建制兵力贴近时做。
- "别过于保守"的正确做法是：集中火力打对手的**前沿弱兵**(炮兵先打，无反击)，不是把单位撒到外面。
