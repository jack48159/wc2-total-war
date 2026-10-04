export function createOrderSketch(verb) { return { verb, axes: [], points: [], status: 'drawing' }; }
export function orderSketchPoint(state, point, areaId) {
  if (state.status !== 'drawing' || areaId == null) return state;
  const last = state.points.at(-1);
  if (last?.areaId === areaId) return state;
  state.points.push({ point, areaId });
  return state;
}
export function orderSketchBack(state) {
  if (state.points.length) state.points.pop();
  else if (state.axes.length) state.points = state.axes.pop();
  else state.status = 'cancelled';
  return state;
}
export function orderSketchFinishAxis(state) {
  if (!state.points.length) return false;
  if (state.verb === 'envelop' && state.axes.length === 0) {
    state.axes.push(state.points); state.points = []; return false;
  }
  state.status = 'settings';
  return true;
}
