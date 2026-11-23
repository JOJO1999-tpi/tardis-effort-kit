const FRAME_MS = 1000 / 60;

function createSceneClock(canvas) {
  const cache = {};
  const state = { p: 0, t: 0, maxVisualP: 1, cssWidth: 0, pixelRatio: 1, reducedMotion: false, hovering: false, cutscene: null };
  let target = 0;
  let tween = null;
  let dragging = false;
  let frame = 0;
  let idleTimer = 0;
  let lastFrame = null;
  let nextFrame = 0;
  let drawRequested = false;

  function stop() {
    cancelAnimationFrame(frame);
    clearTimeout(idleTimer);
    idleTimer = 0;
    frame = 0;
    lastFrame = null;
  }

  function render(ts) {
    frame = requestAnimationFrame(render);
    if (!drawRequested && nextFrame > ts + 0.9) return;
    drawRequested = false;
    nextFrame = Math.max(nextFrame, ts - FRAME_MS / 2) + FRAME_MS;
    const elapsed = lastFrame === null ? 0 : Math.min(FRAME_MS * 2, ts - lastFrame);
    lastFrame = ts;
    state.t += elapsed / 1000;

    if (state.cutscene) {
      const scene = state.cutscene;
      scene.elapsed += elapsed;
      scene.progress = Math.min(scene.elapsed / scene.duration, 1);
      if (scene.progress === 1) state.cutscene = null;
    } else if (tween) {
      tween.elapsed += elapsed;
      const progress = Math.min(tween.elapsed / tween.duration, 1);
      const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
      state.p = lerp(tween.from, target, eased);
      if (progress === 1) tween = null;
    }

    renderTardisScene(canvas, state, cache);
    if ((!state.hovering || state.reducedMotion) && !dragging && !tween && !state.cutscene && !idleTimer) {
      idleTimer = setTimeout(stop, state.reducedMotion ? 0 : 2000);
    }
  }

  function apply(change) {
    for (const key of ['cssWidth', 'pixelRatio', 'maxVisualP', 'reducedMotion', 'hovering']) {
      if (change[key] !== undefined) state[key] = change[key];
    }
    if (change.dragging !== undefined) dragging = change.dragging;
    if (change.reducedMotion) {
      state.cutscene = null;
      tween = null;
      state.p = target;
    }
    if (change.position !== undefined) {
      target = change.position;
      tween = null;
      state.cutscene = null;
      if (!change.animate || state.reducedMotion) {
        state.p = target;
      } else if (change.fromStage > change.toStage) {
        state.p = target;
        const type = change.toStage === 0 ? 'materialize' : change.fromStage === 3 ? 'flashCut' : 'approachEarth';
        const duration = type === 'materialize' ? 2350 : type === 'approachEarth' ? 1450 : change.toStage === 1 ? 960 : 900;
        state.cutscene = { type, duration, elapsed: 0, progress: 0, toIdx: change.toStage };
      } else if (Math.abs(state.p - target) < 0.002) {
        state.p = target;
      } else {
        const min = Math.min(state.p, target);
        const max = Math.max(state.p, target);
        const crosses = (point) => min < point && max > point;
        const duration = (crosses(0.18) ? 1250 : 0) + (crosses(0.50) ? 860 : 0) + (crosses(0.84) ? 620 : 0);
        tween = { from: state.p, elapsed: 0, duration: Math.min(duration || 420, 1750) };
      }
    }
    if (!state.cssWidth) {
      stop();
      return;
    }
    clearTimeout(idleTimer);
    idleTimer = 0;
    if (change.dragging !== true) drawRequested = true;
    if (!frame) {
      nextFrame = 0;
      frame = requestAnimationFrame(render);
    }
  }

  return { apply, destroy: stop };
}
