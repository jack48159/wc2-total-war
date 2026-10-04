const ORDER_VERB_LABELS = {
  attack:'\u8fdb\u653b', breakthrough:'\u7eb5\u6df1\u7a81\u7834', envelop:'\u5408\u56f4',
  counterattack:'\u53cd\u7a81\u51fb', defend:'\u56fa\u5b88', delay:'\u8fdf\u6ede',
  concentrate:'\u96c6\u7ed3', screen:'\u7275\u5236', withdraw:'\u64a4\u9000', support:'\u914d\u5408', allout:'全线总攻'
};
// This is the single UI gate for player-issued orders. Remove one verb here to hide it
// from both the command workbench and the right-click/theater order submenu.
export const ENABLED_VERBS = ['attack', 'breakthrough', 'envelop', 'counterattack', 'defend', 'delay', 'concentrate', 'screen', 'withdraw', 'support', 'allout'];
export const ORDER_VERBS = Object.fromEntries(ENABLED_VERBS.map(verb => [verb, ORDER_VERB_LABELS[verb]]));
export function orderMenuItems(game, level, id) {
  const target=level==='army' ? game.armyGroups.find(g=>g.id===id) : game.theatres.find(t=>t.id===id);
  const current=game.orders?.findLast(o=>o.level===level&&o.targetId===id&&!['cancelled','failed','achieved'].includes(o.status));
  const turn=target?.country===game.activeCountry&&game.phase==='playing';
  const item=(id,label,enabled=true,reason='')=>({id,label,enabled,reason:enabled?'':reason});
  const wait='\u4e0d\u662f\u4f60\u7684\u56de\u5408', none='\u65e0\u547d\u4ee4';
  return [
    item('order','\u4e0b\u4ee4 \u25b6',turn,wait),
    item('now','\u7acb\u5373\u6267\u884c',turn&&!!current,turn?none:wait),
    item('cancel','\u53d6\u6d88\u5f53\u524d\u547d\u4ee4',turn&&!!current,turn?none:wait),
    item('report','\u67e5\u770b\u62a5\u544a',!!current?.report,none),
    item('auto','\u56de\u5408\u7ed3\u675f\u81ea\u52a8\u6267\u884c '+(current?.auto?'\u2611':'\u2610'),turn&&!!current,turn?none:wait),
    ...(level==='theater'?[
      item('appoint','\u4efb\u547d / \u66f4\u6362\u5143\u5e05',turn,wait),
      item('ai','\u6258\u7ba1\u8be5\u6218\u533a '+(target?.ai?'\u2611':'\u2610'),turn,wait),
    ]:[]),
    item('rename','\u6539\u540d',turn,wait),
    item('dissolve','\u89e3\u6563',turn,wait)
  ];
}

export function orderSummary(order) {
  if(!order)return '\u65e0\u547d\u4ee4';
  if(order.verb==='allout')return '全线总攻' + (order.expires ? ` · 持续${order.expires}回合` : ' · 当回合');
  const risk=order.risk<.34?'\u4fdd\u5b88':order.risk>.66?'\u5192\u8fdb':'\u5747\u8861';
  return (ORDER_VERBS[order.verb]||order.verb)+' '+order.from+'\u2192'+(Array.isArray(order.to)?order.to.join(','):order.to)+' \u00b7 '+risk+' \u00b7 '+order.priority;
}

export const ORDER_STATUS = {
  pending:'\u5f85\u6267\u884c', progressing:'\u8fdb\u884c\u4e2d', achieved:'\u8fbe\u6210',
  stalled:'\u53d7\u963b', failed:'\u5931\u8d25', cancelled:'\u5df2\u53d6\u6d88'
};
