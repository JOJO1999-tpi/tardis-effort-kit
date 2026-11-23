const EFFORT_STAGES = Object.freeze([
  { id: 'low', label: '最低', position: -1, scene: '伦敦熄灯' },
  { id: 'medium', label: '低', position: 0, scene: '伦敦待命' },
  { id: 'high', label: '中', position: 1 / 3, scene: '地球轨道' },
  { id: 'xhigh', label: '极高', position: 2 / 3, scene: '深空巡航' },
  { id: 'max', label: '最高', position: 1, scene: '时间漩涡' },
].map(Object.freeze));

function mountTardisAnimation(canvas, { effort = 'low' } = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('Expected an existing canvas');
  const indexOf = (id) => {
    const next = EFFORT_STAGES.findIndex((stage) => stage.id === id);
    if (next < 0) throw new RangeError(`Unknown reasoning effort: ${id}`);
    return next;
  };
  let index = indexOf(effort);
  let width = 0;
  const animation = createSceneClock(canvas);
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const onMotion = () => animation.apply({ reducedMotion: motion.matches });
  const onResize = () => animation.apply({ cssWidth: width, pixelRatio: Math.min(devicePixelRatio || 1, 2) });
  const observer = new ResizeObserver(([entry]) => {
    width = Math.round(entry.contentRect.width);
    onResize();
  });
  animation.apply({ position: EFFORT_STAGES[index].position, reducedMotion: motion.matches });
  observer.observe(canvas);
  window.addEventListener('resize', onResize);
  motion.addEventListener('change', onMotion);

  return {
    setEffort(id, { animate = true } = {}) {
      const next = indexOf(id);
      if (next === index) return;
      const fromStage = index - 1;
      index = next;
      animation.apply({ position: EFFORT_STAGES[index].position, fromStage, toStage: index - 1, animate });
    },
    destroy() {
      observer.disconnect();
      window.removeEventListener('resize', onResize);
      motion.removeEventListener('change', onMotion);
      animation.destroy();
    },
  };
}
