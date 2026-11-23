function createSceneSurface(canvas, initial) {
  let worker;
  let local;
  let transferable = false;
  let closed = false;
  let sourceUrl;
  const latest = { ...initial };
  const configKeys = ['position', 'maxVisualP', 'cssWidth', 'pixelRatio', 'reducedMotion', 'hovering', 'dragging'];

  function releaseUrl() {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    sourceUrl = undefined;
  }

  function fallback() {
    releaseUrl();
    worker?.terminate();
    worker = null;
    if (closed || local) return;
    if (transferable) {
      const replacement = canvas.cloneNode();
      canvas.replaceWith(replacement);
      canvas = replacement;
    }
    canvas.dataset.tardisRenderer = 'local';
    local = createSceneClock(canvas);
    local.apply(latest);
  }

  try {
    if (!workerProgram || typeof Worker !== 'function' || !canvas.transferControlToOffscreen) {
      fallback();
    } else {
      sourceUrl = URL.createObjectURL(new Blob([workerProgram], { type: 'text/javascript' }));
      worker = new Worker(sourceUrl, { name: 'TARDIS scene renderer' });
      worker.addEventListener('message', () => {
        canvas.dataset.tardisRenderer = 'worker';
        releaseUrl();
      }, { once: true });
      worker.addEventListener('error', (event) => {
        event.preventDefault();
        fallback();
      }, { once: true });
      const surface = canvas.transferControlToOffscreen();
      transferable = true;
      worker.postMessage({ surface, change: initial }, [surface]);
    }
  } catch {
    fallback();
  }

  return {
    apply(change) {
      for (const key of configKeys) if (change[key] !== undefined) latest[key] = change[key];
      if (worker) worker.postMessage({ change });
      else local.apply(change);
    },
    destroy() {
      closed = true;
      releaseUrl();
      worker?.terminate();
      local?.destroy();
    },
  };
}

function createTardisEffortSlider(host, options) {
  let profile = buildProfileState(options);
  let index = clamp(options.initialIndex ?? 0, 0, profile.levels.length - 1);
  let track = null;
  let cssWidth = 0;
  const root = document.createElement('div');
  root.className = 'tardis-slider-root';
  const wrap = document.createElement('div');
  wrap.className = 'tardis-capsule-wrap';
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'slider');
  wrap.setAttribute('aria-valuemin', '0');
  const canvas = document.createElement('canvas');
  canvas.className = 'tardis-canvas';
  const vignette = document.createElement('div');
  vignette.className = 'tardis-capsule-vignette';
  wrap.append(canvas, vignette);
  const stops = document.createElement('div');
  stops.className = 'tardis-stops';
  stops.setAttribute('role', 'radiogroup');
  root.append(wrap, stops);
  host.replaceChildren(root);

  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const size = () => ({ cssWidth, pixelRatio: Math.min(globalThis.devicePixelRatio || 1, 2) });
  const scene = createSceneSurface(canvas, {
    ...size(), reducedMotion: motion.matches, position: profile.visualPs[index], maxVisualP: profile.maxVisualP,
  });
  function updateSelection() {
    wrap.setAttribute('aria-valuenow', String(index));
    wrap.setAttribute('aria-valuetext', profile.levels[index]);
    [...stops.children].forEach((button, i) => button.setAttribute('aria-checked', String(i === index)));
  }
  function renderStops() {
    stops.style.setProperty('--stop-count', String(profile.levels.length));
    wrap.setAttribute('aria-valuemax', String(profile.levels.length - 1));
    stops.replaceChildren(...profile.levels.map((label, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tardis-stop-btn';
      button.textContent = label;
      button.setAttribute('role', 'radio');
      button.addEventListener('click', () => setLevel(i, true, true));
      return button;
    }));
    updateSelection();
  }

  function setLevel(next, animate = true, commit = false) {
    const previous = index;
    index = clamp(next, 0, profile.levels.length - 1);
    scene.apply({
      position: profile.visualPs[index], animate,
      fromStage: profile.stageMap[previous], toStage: profile.stageMap[index],
    });
    updateSelection();
    if (commit && previous !== index) {
      options.onChange?.(index);
      options.onCommit?.(index);
    }
  }

  function setProfile(next) {
    profile = buildProfileState(next);
    index = clamp(next.index, 0, profile.levels.length - 1);
    scene.apply({ position: profile.visualPs[index], maxVisualP: profile.maxVisualP, animate: next.animate });
    renderStops();
  }

  function drag(clientX) {
    const position = clamp((clientX - track.left) / track.span, 0, 1) * profile.maxVisualP;
    const next = profile.visualPs.reduce((nearest, stop, i, list) =>
      Math.abs(stop - position) < Math.abs(list[nearest] - position) ? i : nearest, 0);
    scene.apply({ position, dragging: true });
    if (index !== next) {
      index = next;
      updateSelection();
      options.onChange?.(index);
    }
  }

  wrap.addEventListener('pointerdown', (event) => {
    if (track || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const rect = wrap.getBoundingClientRect();
    track = { id: event.pointerId, left: rect.left + rect.width * 0.13, span: Math.max(1, rect.width * 0.68), initial: index };
    wrap.focus({ preventScroll: true });
    wrap.setPointerCapture(track.id);
    wrap.classList.add('is-dragging');
    drag(event.clientX);
  });
  wrap.addEventListener('pointermove', (event) => {
    if (track?.id === event.pointerId) drag(event.clientX);
  });
  function endDrag(event) {
    if (track?.id !== event.pointerId) return;
    const committed = event.type === 'pointerup';
    if (!committed) index = track.initial;
    track = null;
    wrap.classList.remove('is-dragging');
    if (wrap.hasPointerCapture(event.pointerId)) wrap.releasePointerCapture(event.pointerId);
    scene.apply({ position: profile.visualPs[index], animate: true, dragging: false });
    updateSelection();
    options.onChange?.(index);
    if (committed) options.onCommit?.(index);
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) wrap.addEventListener(type, endDrag);
  wrap.addEventListener('pointerenter', () => scene.apply({ hovering: true }));
  wrap.addEventListener('pointerleave', () => scene.apply({ hovering: false }));
  wrap.addEventListener('focus', () => scene.apply({}));
  wrap.addEventListener('keydown', (event) => {
    let next;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = index + 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = profile.levels.length - 1;
    else return;
    event.preventDefault();
    setLevel(next, true, true);
  });

  const onMotion = () => scene.apply({ reducedMotion: motion.matches });
  const onResize = () => scene.apply(size());
  const observer = new ResizeObserver(([entry]) => {
    const width = Math.round(entry.contentRect.width);
    if (width === cssWidth) return;
    cssWidth = width;
    onResize();
  });
  observer.observe(wrap);
  motion.addEventListener('change', onMotion);
  window.addEventListener('resize', onResize);
  renderStops();

  return {
    setLevel, setProfile,
    getIndex: () => index,
    wake: () => scene.apply({}),
    destroy() {
      observer.disconnect();
      motion.removeEventListener('change', onMotion);
      window.removeEventListener('resize', onResize);
      scene.destroy();
    },
  };
}
