const {
  createElement: h, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
} = require('react');

const inject = ['slots', 'locale', 'modelDirectories', 'sessions', 'remote', 'remote.permissionPresets'];
const slot = 'conversation.input.model.options';
const labelSlot = 'conversation.input.model.label';
const noOptions = [];
const officialProviders = ['deepseek-account', 'deepseek-official'];

const copy = {
  zh: {
    search: '搜索模型…', searchLabel: '搜索模型', models: 'DeepSeek 模型',
    empty: '没有匹配的模型', noModels: '暂无可用的 DeepSeek 模型',
    loading: '正在读取模型…', retry: '重试', unavailable: 'DeepSeek 模型目录加载失败',
    effort: '推理强度', stops: (n) => `${n} 档`, defaultEffort: '默认',
    effortNames: { off: '关闭', none: '关闭', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '超高' },
    access: '访问权限', permissionNames: {
      'danger-full-access': '完全访问', auto: '自动', 'workspace-write': '工作区', 'read-only': '只读',
    },
  },
  en: {
    search: 'Search models…', searchLabel: 'Search models', models: 'DeepSeek models',
    empty: 'No matching models', noModels: 'No DeepSeek models available',
    loading: 'Loading models…', retry: 'Retry', unavailable: 'Could not load the DeepSeek model catalog',
    effort: 'Reasoning effort', stops: (n) => `${n} levels`, defaultEffort: 'Default', effortNames: {},
    access: 'Session access', permissionNames: {
      'danger-full-access': 'Full access', auto: 'Auto', 'workspace-write': 'Workspace', 'read-only': 'Read only',
    },
  },
};

function officialModels(groups, currentProvider) {
  // The same model can be offered by both official routes. Keep the selected
  // route first so changing models only changes credentials when required.
  const providers = currentProvider === 'deepseek-official'
    ? officialProviders.toReversed()
    : officialProviders;
  const items = new Map();
  for (const provider of providers) {
    const group = groups.find(({ id }) => id === provider);
    for (const model of group?.models ?? []) {
      if (!items.has(model.id)) {
        items.set(model.id, { group, model, key: JSON.stringify([provider, model.id]) });
      }
    }
  }
  return [...items.values()];
}

function errorMessage(error) {
  return error?.message ?? String(error);
}

function ModelMark() {
  return h('span', { className: 'dsh-tardis-mark', 'aria-hidden': true }, '≋');
}

function ModelLabel({ provider, model, placement, resolveText }) {
  const badge = model.badge && resolveText(model.badge.text);
  return h('span', { className: placement === 'trigger' ? 'dsh-tardis-trigger-name' : undefined },
    placement === 'trigger' && officialProviders.includes(provider.id) && h(ModelMark),
    h('span', { className: 'dsh-tardis-name' }, model.name),
    badge && h('small', { className: 'dsh-tardis-badge' }, badge));
}

function EffortControl({ choices, selected, locked, onPick, t }) {
  const host = useRef(null);
  const slider = useRef(null);
  const commit = useRef(onPick);
  const [preview, setPreview] = useState(selected);
  commit.current = onPick;

  useLayoutEffect(() => {
    const element = host.current;
    const labels = choices.map((item) => item.label);
    const top = choices.at(-1)?.id?.toLowerCase();
    setPreview(selected);
    slider.current = core.createTardisEffortSlider(element, {
      levels: labels,
      initialIndex: selected,
      hasUltraHigh: labels.length >= 4 || /^(max|x-?high|extra-?high|ultra-?high)$/.test(top ?? ''),
      onChange: setPreview,
      onCommit: (index) => commit.current(choices[index].id),
    });
    const sliders = element.querySelectorAll('[role="slider"],[role="radiogroup"]');
    sliders.forEach((node) => node.setAttribute('aria-label', t.effort));
    return () => {
      slider.current.destroy();
      slider.current = null;
      element.replaceChildren();
    };
  }, [choices, t.effort]);

  useLayoutEffect(() => {
    if (locked || slider.current === null || slider.current.getDetail().index === selected) return;
    slider.current.setLevel(selected, false);
    setPreview(selected);
  }, [selected, locked, choices]);

  const label = choices[preview]?.label ?? choices[selected]?.label;
  return h('section', { className: 'dsh-tardis-effort', 'aria-label': t.effort },
    h('div', { className: 'dsh-tardis-effort-head' },
      h('strong', null, t.effort, h('span', { className: 'dsh-tardis-effort-value' }, label)),
      h('span', null, t.stops(choices.length))),
    h('div', {
      ref: host, 'aria-busy': locked || undefined,
      onPointerDownCapture: (event) => { if (locked) event.stopPropagation(); },
      onClickCapture: (event) => { if (locked) event.stopPropagation(); },
      onKeyDownCapture: (event) => {
        if (locked && !['Escape', 'Tab'].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
    }));
}

function AccessControl({ t, accessText, selection, load, choose, locked }) {
  const [options, setOptions] = useState(noOptions);
  const [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');
  const current = selection?.currentValue;

  useEffect(() => {
    if (current === undefined || !load) return;
    let active = true;
    load().then((value) => {
      if (!active) return;
      setOptions(value);
      setError('');
    }).catch((cause) => {
      if (active) setError(errorMessage(cause));
    });
    return () => { active = false; };
  }, [current, load]);

  if (current === undefined || (!options.length && !error)) return null;
  const permissionRank = Object.keys(t.permissionNames);
  const order = (value) => {
    const index = permissionRank.indexOf(value);
    return index < 0 ? permissionRank.length : index;
  };
  const ordered = [...options].sort((left, right) => order(left.value) - order(right.value));

  function cancel() {
    setConfirmation(null);
    setAcknowledged(false);
  }

  async function submit(value) {
    setPending(true);
    setError('');
    cancel();
    try {
      await choose(value);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  function pick(value) {
    if (locked || pending || current === value || confirmation !== null) return;
    if (value === 'danger-full-access' || value === 'auto') setConfirmation(value);
    else void submit(value);
  }

  const confirmKey = confirmation === 'auto' ? 'auto.confirm' : 'confirm';
  return h('section', { className: 'dsh-tardis-access', 'aria-label': t.access },
    h('div', { className: 'dsh-tardis-access-row' },
      h('span', null, t.access),
      h('div', { className: 'dsh-tardis-segments', role: 'group', 'aria-label': t.access },
        ordered.map((option) => h('button', {
          key: option.value, type: 'button', 'aria-pressed': option.value === current,
          'aria-disabled': locked || pending || confirmation !== null,
          title: option.description, onClick: () => pick(option.value),
        }, t.permissionNames[option.value] ?? option.name)))),
    confirmation !== null && h('div', { className: 'dsh-tardis-confirm' },
      h('strong', null, accessText(`${confirmKey}.title`)),
      h('p', null, accessText(`${confirmKey}.description`)),
      h('label', null, h('input', {
        type: 'checkbox', checked: acknowledged, onChange: (event) => setAcknowledged(event.target.checked),
      }), ' ', accessText(`${confirmKey}.acknowledge`)),
      h('div', { className: 'dsh-tardis-confirm-actions' },
        h('button', { type: 'button', onClick: cancel }, accessText('confirm.cancel')),
        h('button', {
          type: 'button', disabled: !acknowledged || locked,
          onClick: () => { if (acknowledged && !locked) void submit(confirmation); },
        }, accessText(`${confirmKey}.enable`)))),
    error && h('div', { className: 'dsh-tardis-error', role: 'alert' }, error));
}

function ModelPanel({ directory, sessionKey, locked, useProjection, loadPermissions, choosePermission, t, accessText, resolveText }) {
  const state = useSyncExternalStore(
    (listener) => directory.store.subscribe(listener),
    () => directory.store.getSnapshot(),
  );
  const panel = useRef(null);
  const search = useRef(null);
  const inFlight = useRef(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(null);
  const [error, setError] = useState('');
  const permissions = useProjection('permissions');
  const currentProvider = state.current?.provider;
  const items = useMemo(() => officialModels(state.groups, currentProvider), [state.groups, currentProvider]);
  const current = items.find(({ group, model }) => state.current?.provider === group.id && state.current?.model === model.id);
  const failures = state.failures.filter(({ id }) => officialProviders.includes(id));
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const visible = items.filter(({ model }) => {
    const searchable = `${model.name} ${model.id}`.toLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
  const highlighted = cursor === null ? null : visible[Math.min(cursor, visible.length - 1)];
  const reasoning = current?.model.reasoning;
  const effort = state.current?.reasoningEffort ?? reasoning?.defaultEffort;
  // The directory can publish a new catalog object while a selection settles.
  // Keep the live canvas and its keyboard focus when its levels are identical.
  const effortSpec = JSON.stringify([
    reasoning?.defaultEffort,
    reasoning?.efforts?.map(({ id, name }) => [id, name]) ?? [],
  ]);
  const choices = useMemo(() => {
    const [defaultEffort, configured] = JSON.parse(effortSpec);
    if (configured.length === 0) return noOptions;
    const options = configured.map(([id, name]) => ({
      id, label: name?.toLowerCase() === id.toLowerCase() ? t.effortNames[id] ?? name : name ?? id,
    }));
    if (defaultEffort === null) options.unshift({ id: undefined, label: t.defaultEffort });
    return options;
  }, [effortSpec, t]);
  const effortIndex = choices.findIndex((option) => option.id === effort);
  const busy = locked || state.pending !== null;
  const shortcut = /mac/i.test(navigator.platform) ? '⌘K' : 'Ctrl K';

  useEffect(() => {
    if (window.matchMedia('(pointer: coarse)').matches) return;
    // Let the host attach the portaled menu ref before moving focus into it.
    const frame = requestAnimationFrame(() => search.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (cursor === null) return;
    panel.current?.querySelector('[data-tardis-highlighted="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [highlighted?.key, cursor]);

  async function select(item, reasoningEffort) {
    if (busy || inFlight.current) return;
    if (item.key === current?.key && reasoningEffort === effort) return;
    inFlight.current = true;
    setError('');
    try {
      const result = await directory.select({
        provider: item.group.id,
        model: item.model.id,
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      });
      if (!result.ok) throw result.error;
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      inFlight.current = false;
    }
  }

  function chooseModel(item) {
    if (item.key === current?.key) return;
    void select(item, item.model.reasoning?.defaultEffort);
  }

  function keydown(event) {
    if (event.key === 'Escape') return;
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      search.current?.focus();
      search.current?.select();
      return;
    }
    if (event.target !== search.current || !visible.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const offset = event.key === 'ArrowDown' ? 1 : -1;
      const index = highlighted ? visible.indexOf(highlighted) : offset > 0 ? -1 : 0;
      setCursor((index + offset + visible.length) % visible.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      chooseModel(highlighted ?? visible[0]);
    }
  }

  const reload = () => { setError(''); void directory.load().catch(() => {}); };

  return h('div', {
    className: 'dsh-tardis-panel', ref: panel, onKeyDown: keydown,
    onMouseDown: (event) => event.stopPropagation(),
  },
  h('label', { className: 'dsh-tardis-search' },
    h('span', { className: 'dsh-tardis-search-icon', 'aria-hidden': true }),
    h('input', {
      ref: search, type: 'search', value: query, placeholder: t.search, 'aria-label': t.searchLabel,
      onChange: (event) => { setQuery(event.target.value); setCursor(null); },
    }),
    h('kbd', { 'aria-hidden': true }, shortcut)),
  h('div', { className: 'dsh-tardis-models', role: 'group', 'aria-label': t.models },
    visible.map((item) => {
      const { key, model, group } = item;
      const active = key === current?.key;
      return h('button', {
        type: 'button', key, className: 'dsh-tardis-model',
        'aria-pressed': active, 'aria-disabled': busy, 'data-tardis-highlighted': key === highlighted?.key,
        title: `${model.name} · ${group.name}`, onClick: () => chooseModel(item),
      },
      h(ModelMark),
      h('span', { className: 'dsh-tardis-name' }, model.name),
      model.badge && h('small', { className: 'dsh-tardis-badge' }, resolveText(model.badge.text)),
      h('span', { className: 'dsh-tardis-check', 'aria-hidden': true }, active ? '✓' : ''));
    }),
    !visible.length && h('div', { className: 'dsh-tardis-status', role: 'status' },
      state.status === 'loading' ? t.loading : !items.length ? t.noModels : t.empty)),
  (error || state.error) && h('div', { className: 'dsh-tardis-error', role: 'alert' },
    error || state.error, ' ', h('button', { type: 'button', onClick: reload }, t.retry)),
  failures.length > 0 && h('details', { className: 'dsh-tardis-failures' },
    h('summary', null, t.unavailable),
    failures.map(({ id, name, message }) => h('div', { key: id }, `${name ?? id} · ${message}`))),
  current && choices.length > 0 && h(EffortControl, {
    key: current.key, choices, selected: Math.max(0, effortIndex), locked: busy,
    onPick: (value) => { void select(current, value); }, t,
  }),
  h(AccessControl, {
    key: sessionKey, t, accessText, selection: permissions, load: loadPermissions,
    choose: choosePermission, locked: busy,
  }));
}

function apply(ctx) {
  ctx.effect(() => {
    const element = document.createElement('style');
    element.setAttribute('data-dsh-tardis-effort', '');
    element.textContent = styles;
    document.head.append(element);
    return () => element.remove();
  }, 'tardis-effort: scoped styles');

  ctx.slots.inject(slot, () => ctx.slots.register({
    name: slot,
    id: 'tardis-effort',
    order: -100,
    locale: 'tardis-effort',
    inject: (sessionId) => ({
      sessionKey: String(sessionId),
      directory: ctx.modelDirectories.directoryFor(sessionId),
      accessText: ctx.locale.bind('permission.access'),
      resolveText: (value) => ctx.locale.resolveText(value),
      loadPermissions: async () => {
        const result = await ctx.remote.permissionPresets.catalog();
        if (!result.ok) throw result.error;
        return result.value.options;
      },
      choosePermission: async (value) => {
        // The host owns the permission presets and their command implementation.
        if (!/^[\w-]+$/.test(value)) throw new Error('Invalid permission preset');
        const session = ctx.sessions.binding(sessionId)?.session;
        if (!session) throw new Error('Session is unavailable');
        const result = await session.command(`/permission ${value}`);
        if (!result.ok) throw result.error;
        if (!result.value.matched) throw new Error('The session has no /permission command');
      },
    }),
  }, (props) => h(ModelPanel, { ...props, key: props.sessionKey, t: copy[props.t('language')] ?? copy.en })));

  ctx.effect(() => ctx.locale.register('tardis-effort', {
    zh: { language: 'zh' }, en: { language: 'en' },
  }), 'tardis-effort: locales');

  ctx.slots.inject(labelSlot, () => ctx.slots.register({
    name: labelSlot,
    inject: () => ({ resolveText: (value) => ctx.locale.resolveText(value) }),
  }, ModelLabel));
}
