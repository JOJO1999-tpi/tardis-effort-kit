const triggerSelector = '.agy-composer-footer [data-testid="model-selector-trigger"]';
const groupSelector = '[data-testid="model-selector-effort-group"]';
const orchestratorSelector = '[data-testid="model-selector-orchestrator"]';
const orchestratorRow = '[data-testid="orchestrator-picker-row"]';
const regularRow = '[data-testid="model-selector-item"]';
const radioSelector = '[role="menuitemradio"]';
const disabledSelector = '[aria-disabled="true"],[data-disabled],:disabled';
const nativeMenuAttribute = 'data-antigravity-tardis-native';
const nativeMenuSelectors = [
  '[data-testid="model-selector-panel"]',
  '[data-testid="model-selector-effort-header"]',
  orchestratorRow,
  '[data-testid="orchestrator-picker-effort"]',
].join(',');
const abort = new AbortController();
const chinese = navigator.language.startsWith('zh') || Boolean(ctx.modules?.i18n);
const text = chinese ? {
  models: '模型', placeholder: '搜索模型…', effort: '推理强度', levels: (n) => `${n} 档`,
  orchestrator: '编排器', native: '原生菜单', close: '关闭', unavailable: '不可用',
  empty: '没有匹配的模型', noEffort: '当前模型没有可调档位', loading: '正在读取模型…',
  error: '原生菜单没有确认切换，请重试或打开原生菜单。',
} : {
  models: 'Models', placeholder: 'Search models…', effort: 'Thinking effort', levels: (n) => `${n} levels`,
  orchestrator: 'Orchestrator', native: 'Native menu', close: 'Close', unavailable: 'Unavailable',
  empty: 'No matching models', noEffort: 'No adjustable levels for this model', loading: 'Loading models…',
  error: 'The native menu did not confirm the change. Retry or open the native menu.',
};
const style = document.createElement('style');
style.id = 'antigravity-tardis-effort-css';
style.textContent = panelStyles;
document.head.append(style);

let active = null;
let replaying = false;
let bridgeOwner = null;

const firstLine = (node) => node?.innerText?.trim().split('\n')[0]?.trim() ?? '';
const normalize = (value) => value?.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim() ?? '';
const popup = (owner) => document.getElementById(owner?.getAttribute('aria-controls'));
const opened = (owner) => owner?.getAttribute('aria-expanded') === 'true' ? popup(owner) : null;

function element(tag, className, label) {
  const node = document.createElement(tag);
  node.className = className;
  if (label !== undefined) node.textContent = label;
  if (tag === 'button') node.type = 'button';
  return node;
}

function clickNative(node) {
  replaying = true;
  try { node.click(); } finally { replaying = false; }
}

function assertActive(panel) {
  if (active !== panel || !panel.trigger.isConnected || panel.route !== location.href) {
    throw new Error('The active conversation changed');
  }
}

async function waitFor(panel, read, timeout = 800) {
  const until = performance.now() + timeout;
  let result;
  do {
    assertActive(panel);
    result = read();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (performance.now() < until);
  throw new Error('The native model picker did not finish');
}

async function openSubmenu(panel, row) {
  if (!opened(row)) {
    row.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, bubbles: true, cancelable: true, composed: true,
    }));
  }
  return waitFor(panel, () => opened(row));
}

function ownedRows(menu, selector) {
  return [...menu.querySelectorAll(selector)].filter((row) => row.closest('[role="menu"]') === menu);
}

function mainEntries(root) {
  return ownedRows(root, '[role="menuitem"]').flatMap((row) => {
    const group = row.querySelector(groupSelector);
    const kind = row.matches(orchestratorSelector) ? 'orchestrator'
      : group ? 'group' : row.matches(regularRow) ? 'direct' : null;
    const name = firstLine(group ?? row);
    return kind && name ? [{
      key: `${kind}:${name}`, kind, name, row, disabled: row.matches(disabledSelector),
      selected: row.getAttribute('aria-checked') === 'true' || row.classList.contains('text-foreground'),
    }] : [];
  });
}

function orchestratorEntries(menu) {
  return ownedRows(menu, orchestratorRow).flatMap((row) => {
    const name = row.dataset.modelBase?.trim() || firstLine(row);
    if (!name) return [];
    return [{
      key: `orchestrator-model:${name}`, kind: 'orchestrator-model', name, row,
      disabled: row.matches(disabledSelector), selected: false,
    }];
  });
}

function effortEntries(menu) {
  return ownedRows(menu, radioSelector).flatMap((row) => {
    const label = firstLine(row.querySelector('[data-testid="orchestrator-picker-effort"]') ?? row);
    return label ? [{
      row, label, disabled: row.matches(disabledSelector), selected: row.getAttribute('aria-checked') === 'true',
    }] : [];
  });
}

function effortFromTrigger(trigger) {
  const label = trigger.getAttribute('aria-label') ?? '';
  if (!label.includes('·')) return '';
  return normalize(label.split('·').at(-1));
}

function displayedEffort(levels, row, trigger, current) {
  // Some orchestrator menus mark no radio until switching, but the trigger
  // still includes the exact applied level.
  if (current) {
    const displayed = effortFromTrigger(trigger);
    const fromTrigger = levels.findIndex(({ label, disabled }) => !disabled && normalize(label) === displayed);
    if (fromTrigger >= 0) return fromTrigger;
  }
  const checked = levels.findIndex(({ selected, disabled }) => selected && !disabled);
  if (checked >= 0) return checked;
  const labels = row.innerText.trim().split('\n').slice(1).map(normalize);
  const defaultLevel = levels.findIndex(({ label, disabled }) => !disabled && labels.includes(normalize(label)));
  return defaultLevel >= 0 ? defaultLevel : levels.findIndex(({ disabled }) => !disabled);
}

function routeMatches(trigger, model) {
  const actual = normalize(trigger.getAttribute('aria-label') ?? trigger.innerText);
  const orchestrator = /orchestrator|编排器|編排器/i.test(actual);
  const name = model.kind === 'direct' ? model.name.replace(/\s+\([^()]+\)$/, '') : model.name;
  return actual.includes(normalize(name)) && orchestrator === (model.kind === 'orchestrator-model');
}

const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

async function withPicker(panel, fn) {
  assertActive(panel);
  if (bridgeOwner) await waitFor(panel, () => !bridgeOwner);
  bridgeOwner = panel;
  const focused = panel.node.contains(document.activeElement) ? document.activeElement : null;
  const concealed = new Set();
  function conceal(menu) {
    if (concealed.has(menu)) return;
    concealed.add(menu);
    menu.setAttribute(nativeMenuAttribute, '');
  }
  // Mark only the menus created by the bridge. Toggling a root-level :has()
  // selector for this invalidated styles across the whole chat window.
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element) || panel.node.contains(node)) continue;
        const menus = node.matches('[role="menu"]') ? [node] : node.querySelectorAll('[role="menu"]');
        for (const menu of menus) {
          if (menu.querySelector(nativeMenuSelectors)) conceal(menu);
        }
      }
      const parentMenu = mutation.target.closest?.('[role="menu"]');
      if (parentMenu?.matches('[data-open]') && parentMenu.querySelector(nativeMenuSelectors)) conceal(parentMenu);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  panel.bridgeOpen = true;
  try {
    if (!opened(panel.trigger)) clickNative(panel.trigger);
    const root = await waitFor(panel, () => opened(panel.trigger)?.querySelector('[data-testid="model-selector-panel"]')
      && opened(panel.trigger));
    conceal(root);
    return await fn(root);
  } finally {
    if (opened(panel.trigger)) clickNative(panel.trigger);
    // Let the native popup finish its reduced-cost close before restoring its
    // usual entrance and exit effects for the next manual open.
    await nextPaint();
    observer.disconnect();
    for (const menu of concealed) menu.removeAttribute(nativeMenuAttribute);
    panel.bridgeOpen = false;
    bridgeOwner = null;
    if (active === panel && focused?.isConnected) focused.focus({ preventScroll: true });
  }
}

async function readCatalog(panel, root) {
  const main = mainEntries(root);
  const orchestrator = main.find((model) => model.kind === 'orchestrator' && !model.disabled);
  // Collect the native regular catalog first. Retain it even if the optional
  // orchestrator branch is missing or changes its nested layout.
  let variants = [];
  if (orchestrator) {
    try {
      variants = orchestratorEntries(await openSubmenu(panel, orchestrator.row));
    } catch {
      assertActive(panel);
    }
  }
  const models = main.flatMap((model) => model.kind === 'orchestrator' ? variants : [model]);
  const matchingVariant = orchestrator?.selected
    ? variants.filter((item) => routeMatches(panel.trigger, item)).sort((a, b) => b.name.length - a.name.length)[0]
    : undefined;
  const current = matchingVariant ?? models.find((model) => model.selected)
    ?? models.find((model) => routeMatches(panel.trigger, model));
  return { models, current };
}

async function findNativeModel(panel, root, item) {
  const entries = mainEntries(root);
  if (item.kind !== 'orchestrator-model') return entries.find(({ key }) => key === item.key);
  const owner = entries.find((model) => model.kind === 'orchestrator' && !model.disabled);
  if (!owner) return undefined;
  return orchestratorEntries(await openSubmenu(panel, owner.row)).find(({ key }) => key === item.key);
}

async function readProfile(panel, native, current) {
  if (native.kind === 'direct') return { levels: [], index: -1 };
  const levels = effortEntries(await openSubmenu(panel, native.row));
  if (!levels.length) throw new Error('No native effort options');
  return { levels, index: displayedEffort(levels, native.row, panel.trigger, current) };
}

function renderModels(panel) {
  const query = normalize(panel.search.value).split(' ').filter(Boolean);
  const visible = panel.models.filter((model) => {
    const name = normalize(model.kind === 'orchestrator-model' ? `${text.orchestrator} ${model.name}` : model.name);
    return query.every((part) => name.includes(part));
  });
  panel.list.replaceChildren();
  panel.visible = visible.filter((model) => !model.disabled);
  if (panel.highlight >= panel.visible.length) panel.highlight = -1;
  if (!visible.length) {
    panel.list.append(element('div', 'ag-tardis-picker-status', panel.initializing ? text.loading : text.empty));
    return;
  }
  for (const model of visible) {
    const row = element('button', 'ag-tardis-picker-model');
    row.disabled = model.disabled;
    row.dataset.modelKey = model.key;
    row.setAttribute('aria-pressed', String(panel.selected?.key === model.key));
    row.dataset.highlighted = String(panel.visible[panel.highlight]?.key === model.key);
    const icon = element('span', 'ag-tardis-picker-icon', '✦');
    icon.setAttribute('aria-hidden', 'true');
    const label = element('span', 'ag-tardis-picker-name', model.name);
    const tag = element('span', 'ag-tardis-picker-tag', model.disabled ? text.unavailable
      : model.kind === 'orchestrator-model' ? text.orchestrator : '');
    const mark = element('span', 'ag-tardis-picker-check', panel.selected?.key === model.key ? '✓' : '');
    mark.setAttribute('aria-hidden', 'true');
    row.append(icon, label, tag, mark);
    row.addEventListener('click', () => { void chooseModel(panel, model); });
    panel.list.append(row);
  }
}

function renderEffort(panel, levels, index) {
  const previousLevels = panel.levels;
  panel.levels = levels;
  panel.index = index;
  panel.effort.hidden = !panel.selected;
  if (!panel.selected || !levels.length || index < 0) {
    panel.slider?.destroy();
    panel.slider = null;
    panel.effortValue = null;
    panel.effortCount = null;
    panel.effort.replaceChildren();
    if (panel.selected) panel.effort.append(element('div', 'ag-tardis-picker-status', text.noEffort));
    return;
  }
  const profile = {
    levels: levels.map(({ label }) => label),
    hasUltraHigh: levels.length >= 4 || /超高|极高|extra[ -]*high|xhigh|max/i.test(levels.at(-1).label),
  };
  if (panel.slider) {
    const sameLevels = levels.length === previousLevels.length
      && levels.every(({ label }, i) => label === previousLevels[i].label);
    if (!sameLevels) panel.slider.setProfile({ ...profile, index, animate: true });
    else if (panel.slider.getIndex() !== index) panel.slider.setLevel(index, true);
  } else {
    const heading = element('div', 'ag-tardis-picker-effort-heading');
    const title = element('strong', '', text.effort);
    panel.effortValue = element('span', 'ag-tardis-picker-effort-value');
    panel.effortCount = element('span', '');
    title.append(panel.effortValue);
    heading.append(title, panel.effortCount);
    const host = element('div', 'ag-tardis-picker-slider');
    panel.effort.replaceChildren(heading, host);
    panel.slider = core.createTardisEffortSlider(host, {
      ...profile, initialIndex: index,
      onChange: (preview) => { panel.effortValue.textContent = panel.levels[preview].label; },
      onCommit: (next) => { void chooseEffort(panel, next); },
    });
    host.querySelector('[role="slider"]').setAttribute('aria-label', text.effort);
    host.querySelector('[role="radiogroup"]').setAttribute('aria-label', text.effort);
  }
  panel.effortValue.textContent = levels[index].label;
  panel.effortCount.textContent = text.levels(levels.length);
  panel.effort.querySelectorAll('.tardis-stop-btn').forEach((button, i) => {
    if (button.disabled !== levels[i].disabled) button.disabled = levels[i].disabled;
  });
}

function restoreEffort(panel, index, animate) {
  panel.slider?.setLevel(index, animate);
  if (active === panel && panel.effortValue) panel.effortValue.textContent = panel.levels[index]?.label ?? '';
}

function setBusy(panel, busy) {
  panel.busy = busy;
  panel.node.setAttribute('aria-busy', String(busy));
  if (busy) panel.notice.hidden = true;
}

function showError(panel) {
  if (active !== panel) return;
  panel.notice.textContent = text.error;
  panel.notice.hidden = false;
}

async function confirmSelection(panel, item, effort) {
  const expected = normalize(effort?.label);
  await waitFor(panel, () => {
    if (opened(panel.trigger) || !routeMatches(panel.trigger, item)) return false;
    const actual = effortFromTrigger(panel.trigger);
    return !expected || !actual || actual === expected;
  });
}

async function chooseModel(panel, item) {
  if (panel.busy || item.disabled || item.key === panel.selected?.key) return;
  setBusy(panel, true);
  panel.slider?.wake();
  try {
    await nextPaint();
    const result = await withPicker(panel, async (root) => {
      const model = await findNativeModel(panel, root, item);
      if (!model || model.disabled) throw new Error('Model unavailable');
      const profile = await readProfile(panel, model, false);
      const option = profile.levels[profile.index];
      if (model.kind !== 'direct' && !option) throw new Error('No selectable effort');
      clickNative(option?.row ?? model.row);
      await confirmSelection(panel, item, option);
      return profile;
    });
    assertActive(panel);
    panel.selected = item;
    // Native menu rows are transient. Retain just labels and availability.
    renderEffort(panel, result.levels.map(({ label, disabled }) => ({ label, disabled })), result.index);
    for (const row of panel.list.querySelectorAll('.ag-tardis-picker-model')) {
      const selected = row.dataset.modelKey === item.key;
      if (row.getAttribute('aria-pressed') === String(selected)) continue;
      row.setAttribute('aria-pressed', String(selected));
      row.querySelector('.ag-tardis-picker-check').textContent = selected ? '✓' : '';
    }
    const selectedRow = [...panel.list.children].find((row) => row.dataset.modelKey === item.key);
    selectedRow?.focus({ preventScroll: true });
  } catch {
    showError(panel);
  } finally {
    setBusy(panel, false);
  }
}

async function chooseEffort(panel, index) {
  const level = panel.levels[index];
  if (panel.busy || !level || level.disabled) {
    restoreEffort(panel, panel.index, false);
    return;
  }
  if (index === panel.index || !panel.selected) return;
  const item = panel.selected;
  setBusy(panel, true);
  try {
    await nextPaint();
    await withPicker(panel, async (root) => {
      const model = await findNativeModel(panel, root, item);
      if (!model || model.disabled) throw new Error('Model unavailable');
      const profile = await readProfile(panel, model, true);
      const target = profile.levels.find((candidate) => candidate.label === level.label && !candidate.disabled);
      if (!target) throw new Error('Effort unavailable');
      clickNative(target.row);
      await confirmSelection(panel, item, target);
    });
    assertActive(panel);
    panel.index = index;
  } catch {
    if (active === panel) restoreEffort(panel, panel.index, false);
    showError(panel);
  } finally {
    setBusy(panel, false);
  }
}

function position(panel) {
  if (active !== panel) return;
  if (!panel.trigger.isConnected || panel.route !== location.href) {
    closePanel();
    return;
  }
  const box = panel.trigger.getBoundingClientRect();
  const padding = 10;
  const width = Math.min(470, window.innerWidth - 2 * padding);
  const above = box.top - padding - 7;
  const below = window.innerHeight - box.bottom - padding - 7;
  const openAbove = above >= 250 || above >= below;
  panel.node.style.width = `${width}px`;
  panel.node.style.left = `${Math.max(padding, Math.min(box.left, window.innerWidth - width - padding))}px`;
  panel.node.style.maxHeight = `${Math.max(60, openAbove ? above : below)}px`;
  panel.node.style.top = openAbove ? '' : `${box.bottom + 7}px`;
  panel.node.style.bottom = openAbove ? `${window.innerHeight - box.top + 7}px` : '';
}

function closePanel({ focus = false, native = false } = {}) {
  const panel = active;
  if (!panel) return;
  active = null;
  panel.slider?.destroy();
  panel.resize.disconnect();
  panel.node.remove();
  panel.trigger.removeAttribute('data-antigravity-tardis-open');
  if (!panel.trigger.isConnected) return;
  if (native && !opened(panel.trigger)) clickNative(panel.trigger);
  else if (focus && !panel.bridgeOpen) panel.trigger.focus({ preventScroll: true });
}

async function openPanel(trigger) {
  const node = element('div', 'ag-tardis-picker');
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-label', text.models);
  const top = element('div', 'ag-tardis-picker-top');
  const search = element('input', 'ag-tardis-picker-search');
  search.type = 'search';
  search.placeholder = text.placeholder;
  search.setAttribute('aria-label', text.placeholder);
  const native = element('button', 'ag-tardis-picker-native', text.native);
  native.addEventListener('click', () => {
    if (!panel.busy) closePanel({ native: true });
  });
  const dismiss = element('button', 'ag-tardis-picker-dismiss', '×');
  dismiss.title = text.close;
  dismiss.setAttribute('aria-label', text.close);
  dismiss.addEventListener('click', () => closePanel({ focus: true }));
  top.append(search, native, dismiss);
  const list = element('div', 'ag-tardis-picker-list');
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', text.models);
  const effort = element('section', 'ag-tardis-picker-effort');
  effort.setAttribute('aria-label', text.effort);
  effort.hidden = true;
  const notice = element('div', 'ag-tardis-picker-error');
  notice.setAttribute('role', 'alert');
  notice.hidden = true;
  node.append(top, list, effort, notice);
  const resize = new ResizeObserver(() => position(panel));
  const panel = {
    trigger, node, search, list, effort, notice, resize, models: [], visible: [], highlight: -1,
    selected: null, slider: null, levels: [], index: -1, initializing: true, busy: false,
    bridgeOpen: false, route: location.href,
  };
  active = panel;
  trigger.setAttribute('data-antigravity-tardis-open', '');
  document.body.append(node);
  resize.observe(trigger);
  position(panel);
  renderModels(panel);
  search.addEventListener('input', () => {
    panel.highlight = -1;
    renderModels(panel);
  });
  search.addEventListener('keydown', (event) => {
    const visible = panel.visible;
    if (!visible.length || event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      void chooseModel(panel, visible[Math.max(0, panel.highlight)]);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const first = direction === 1 ? 0 : visible.length - 1;
      panel.highlight = panel.highlight < 0 ? first : (panel.highlight + direction + visible.length) % visible.length;
      renderModels(panel);
      list.querySelector('[data-highlighted="true"]')?.scrollIntoView({ block: 'nearest' });
    }
  });
  for (const type of ['pointerdown', 'click', 'keydown']) {
    effort.addEventListener(type, (event) => {
      if (panel.busy && !['Escape', 'Tab'].includes(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  }

  setBusy(panel, true);
  try {
    const result = await withPicker(panel, async (root) => {
      const catalog = await readCatalog(panel, root);
      if (!catalog.models.length) throw new Error('No recognizable models');
      const native = catalog.current && await findNativeModel(panel, root, catalog.current);
      const profile = native ? await readProfile(panel, native, true) : { levels: [], index: -1 };
      return { ...catalog, profile };
    });
    assertActive(panel);
    panel.models = result.models.map(({ key, kind, name, disabled }) => ({ key, kind, name, disabled }));
    panel.selected = result.current ?? null;
    panel.initializing = false;
    renderModels(panel);
    renderEffort(panel, result.profile.levels.map(({ label, disabled }) => ({ label, disabled })), result.profile.index);
    search.focus({ preventScroll: true });
  } catch {
    if (active !== panel) return;
    closePanel({ native: true });
  } finally {
    setBusy(panel, false);
  }
}

document.addEventListener('click', (event) => {
  if (replaying || !(event.target instanceof Element)) return;
  const trigger = event.target.closest(triggerSelector);
  if (!trigger || trigger.matches(disabledSelector)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (active?.trigger === trigger) closePanel({ focus: true });
  else {
    closePanel();
    void openPanel(trigger);
  }
}, { capture: true, signal: abort.signal });
document.addEventListener('pointerdown', (event) => {
  if (!active || active.node.contains(event.target) || event.target.closest?.(triggerSelector)) return;
  closePanel();
}, { capture: true, signal: abort.signal });
document.addEventListener('keydown', (event) => {
  if (!active || event.key !== 'Escape' || event.isComposing) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  closePanel({ focus: true });
}, { capture: true, signal: abort.signal });
window.addEventListener('resize', () => { if (active) position(active); }, { signal: abort.signal });
window.addEventListener('scroll', (event) => {
  if (active && !active.bridgeOpen && event.target.contains?.(active.trigger)) position(active);
}, { capture: true, passive: true, signal: abort.signal });
window.addEventListener('popstate', () => closePanel(), { signal: abort.signal });

ctx.onCleanup(() => {
  closePanel();
  abort.abort();
  style.remove();
});
