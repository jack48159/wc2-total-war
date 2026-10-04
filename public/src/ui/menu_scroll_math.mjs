// Pure geometry shared by menu scroll input and its focused self-test.
export const clampScroll = (scroll, delta, max) => Math.max(0, Math.min(max, scroll + delta));
export const contentPoint = (point, ox, oy) => ({ x: point.x - ox, y: point.y - oy });
export const dragScroll = (scrollAtDown, yAtDown, yNow, max) => clampScroll(scrollAtDown, yAtDown - yNow, max);
export const scrollMax = (count, itemHeight, viewportHeight) => Math.max(0, count * itemHeight - viewportHeight);
