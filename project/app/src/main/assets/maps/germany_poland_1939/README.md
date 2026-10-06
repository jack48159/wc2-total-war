# 德国与波兰：九月战役

这是独立重绘的1939年9月战场，没有复用原版世界地图底图。投影为以中欧为中心的 Lambert Azimuthal Equal Area，地图坐标4800×3400，点击栅格4单位。背景、地块轮廓、邻接、点击栅格和领土蒙版来自同一份几何数据。

## 历史与游戏的界限

波兰保留战前东部领土、维尔诺、利沃夫和波兰走廊；东普鲁士没有被画成1945年后的波兰领土。德国控制范围包括1938年吞并的奥地利、1939年占领的波希米亚—摩拉维亚和1939年3月取得的梅梅尔地区。但泽按9月1日德国控制处理。占领区的控制颜色不表示其吞并具有合法性。

这不是行政区复原图。内部地块是约数十公里尺度的战术分区，命名城市使用历史时期的中文名称。国界资料在地方尺度仍有简化；河流是示意线，不是精确水文数据，也不会无提示阻断移动。

此关只有德国、波兰两国参与。斯洛伐克、苏联、英法等作为战外历史背景，未被错误划入德国或波兰。历史上斯洛伐克参加进攻、英法9月3日宣战、苏联9月17日入侵；双国玩法省略其直接行动，这是明确的关卡取舍。

兵力和财政是游戏数值，不是历史师级兵力或真实军费。双方科技从2级开始；德国有装甲与机动优势，波兰有纵深、防御工事、两次有限动员资源。此战役禁购火箭炮、重坦克、航母、核弹及科技研发，避免后期军备进入1939年的有限战场；沙盒模式不套用这项限制。德国20回合内控制华沙、罗兹、克拉科夫、布列斯特并守住柏林获胜；波兰守住华沙、卢布林、利沃夫至21回合，或反攻占领柏林获胜。波兰三处防御支点同时失守才触发战场失败。上述目标允许改写历史，不强制照历史结局输赢。

## 来源及许可

- ETH Zürich, International Conflict Research：CShapes 2.0历史国界数据，按1939-09-01选取，并补足上述占领范围。https://icr.ethz.ch/data/cshapes/
- Schvitz, G. et al. (2022), *Mapping the International System, 1886–2019: The CShapes 2.0 Dataset*, Journal of Conflict Resolution.
- United States Holocaust Memorial Museum：欧洲1939地图及波兰战役资料。https://encyclopedia.ushmm.org/content/en/map/europe-1939 ；https://encyclopedia.ushmm.org/content/en/article/invasion-of-poland-fall-1939?series=7

CShapes数据及本目录衍生的国界几何、栅格、地图图片采用 **CC BY-NC-SA 4.0**：署名、非商业、相同方式共享。https://creativecommons.org/licenses/by-nc-sa/4.0/ 。商业发行需要另行取得数据授权或更换为允许商业使用的数据源。本许可不改变游戏代码及其他原有资产的许可。

## 产物

`战场底图.png`供查看；`assets/preview.webp`为游戏预览；`assets/tiles/`为带6单位边缘重叠的地图切片；`assets/zones/`为逐地块蒙版；`data/`包含元数据、几何、邻接和点击栅格；`stage.json`包含初始部署、外交、剧情和目标。`geometry_report.json`记录生成时的几何检查，不等同于真机游玩验收。

源脚本为上级目录的`build_poland.py`、`install_poland.py`。AGY此前的原稿没有覆盖或删除。
