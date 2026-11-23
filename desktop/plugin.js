/**
 * tardis-effort — Standalone Hermes Desktop runtime plugin.
 *
 * Replaces the generic thinking-effort dropdown with an interactive 16-bit
 * Doctor Who TARDIS capsule slider that adapts to each model's real
 * reasoning-effort tiers while keeping top Thinking / Fast / Daybreak
 * switches in sync with the live Hermes gateway.
 *
 * Plain ESM without JSX syntax (loaded directly by Hermes Desktop's runtime loader).
 */

import {
  atom,
  Badge,
  Button,
  catalogProviderMatches,
  cn,
  COMPOSER_AREAS,
  DEFAULT_REASONING_EFFORT,
  haptic,
  host,
  icons,
  PALETTE_AREA,
  pluginSettingsHref,
  Popover,
  PopoverContent,
  PopoverTrigger,
  queryClient,
  REASONING_EFFORTS,
  reasoningEffortLabel,
  Switch,
  Tip,
  ToggleRow,
  useQuery,
  useQueryClient,
  useValue
} from '@hermes/plugin-sdk'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const PLUGIN_ID = 'tardis-effort'
const STYLE_ID = 'hermes-plugin-tardis-effort-style'
const QUERY_PREFIX = [PLUGIN_ID]
const STORAGE_KEYS = {
  hideNativePill: 'hideNativePill',
  hideModelSubmenu: 'hideModelSubmenu',
  muted: 'muted'
}
const DEFAULT_PREFS = {
  hideNativePill: true,
  hideModelSubmenu: true,
  muted: true
}

const $prefs = atom({ ...DEFAULT_PREFS })
const $liveSessionInfo = atom({})

let activeStorage = null
let draftOverride = null
let draftSubmittingAt = 0

function normalizeStr(v) {
  return String(v ?? '').trim().toLowerCase()
}

function readBoolPref(storage, key, fallback) {
  try {
    const val = storage?.get(key, fallback)
    return typeof val === 'boolean' ? val : fallback
  } catch {
    return fallback
  }
}

function loadPrefsFromStorage(storage) {
  return {
    hideNativePill: readBoolPref(storage, STORAGE_KEYS.hideNativePill, DEFAULT_PREFS.hideNativePill),
    hideModelSubmenu: readBoolPref(storage, STORAGE_KEYS.hideModelSubmenu, DEFAULT_PREFS.hideModelSubmenu),
    muted: readBoolPref(storage, STORAGE_KEYS.muted, DEFAULT_PREFS.muted)
  }
}

function updatePref(key, value) {
  const next = { ...$prefs.get(), [key]: Boolean(value) }
  $prefs.set(next)
  try {
    activeStorage?.set(key, Boolean(value))
  } catch {
    // Ignore storage errors outside host context
  }
  if (key === 'muted') {
    tardisAudio.setMuted(Boolean(value))
  }
}

// ============================================================================
// PART 1: SCOPED PLUGIN STYLESHEET (Cleanly removed on ctx.onDispose)
// ============================================================================
const TARDIS_BASE_CSS = `
.tardis-slider-root {
  --slider-accent: #4aa8ff;
  display: flex;
  flex-direction: column;
  gap: 7px;
  width: 100%;
}

.tardis-slider-disabled .tardis-capsule-wrap {
  opacity: 0.58;
  filter: saturate(0.7);
}

.tardis-capsule-wrap {
  position: relative;
  width: 100%;
  height: 68px;
  border-radius: 999px;
  overflow: hidden;
  background: #060a14;
  border: 1px solid var(--ui-stroke-tertiary, rgba(255, 255, 255, 0.14));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    inset 0 -10px 18px rgba(0, 0, 0, 0.35);
  cursor: grab;
  user-select: none;
  touch-action: none;
  transition:
    border-color 160ms ease,
    box-shadow 180ms ease,
    opacity 160ms ease,
    filter 160ms ease;
}

.tardis-capsule-wrap:hover {
  border-color: var(--slider-accent);
}

.tardis-capsule-wrap.is-dragging {
  cursor: grabbing;
  border-color: var(--slider-accent);
}

.tardis-capsule-wrap:focus-visible {
  outline: 2px solid var(--slider-accent);
  outline-offset: 2px;
}

.tardis-canvas {
  display: block;
  width: 100%;
  height: 68px;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}

.tardis-capsule-vignette {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  box-shadow:
    inset 14px 0 18px -12px rgba(0, 0, 0, 0.72),
    inset -14px 0 18px -12px rgba(0, 0, 0, 0.72),
    inset 0 1px 0 rgba(255, 255, 255, 0.14);
}

.tardis-stops {
  display: grid;
  grid-template-columns: repeat(var(--stop-count, 4), minmax(0, 1fr));
  gap: 5px;
}

.tardis-stop-btn {
  appearance: none;
  border: 1px solid var(--ui-stroke-tertiary, rgba(255, 255, 255, 0.1));
  background: var(--ui-bg-quinary, rgba(255, 255, 255, 0.04));
  color: var(--ui-text-secondary, #9e9990);
  border-radius: 7px;
  height: 26px;
  padding: 0 6px;
  font-size: 11.5px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition:
    background-color 140ms ease,
    color 140ms ease,
    border-color 140ms ease,
    box-shadow 140ms ease;
}

.tardis-stop-btn:hover {
  background: var(--ui-bg-tertiary, rgba(255, 255, 255, 0.08));
  color: var(--ui-text-primary, #eceae4);
}

.tardis-stop-btn[aria-checked='true'] {
  background: color-mix(in srgb, var(--slider-accent) 16%, transparent);
  border-color: color-mix(in srgb, var(--slider-accent) 52%, transparent);
  color: var(--ui-text-primary, #eceae4);
  box-shadow: inset 0 -2px 0 var(--slider-accent);
}

.tardis-stop-btn:focus-visible {
  outline: 2px solid var(--slider-accent);
  outline-offset: -2px;
}
`

function buildPluginCss(prefs) {
  const parts = [TARDIS_BASE_CSS]
  if (prefs?.hideNativePill) {
    parts.push(`[data-testid="reasoning-pill"] { display: none !important; }`)
  }
  if (prefs?.hideModelSubmenu) {
    parts.push(
      `[class~="group/model"] > .codicon-chevron-right { display: none !important; }`,
      `body:has([class~="group/model"][data-state="open"]) [data-slot="dropdown-menu-sub-content"] { display: none !important; pointer-events: none !important; }`
    )
  }
  return parts.join('\n')
}

function syncPluginStyles(prefs) {
  if (typeof document === 'undefined' || !document.head) return
  let styleEl = document.getElementById(STYLE_ID)
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = STYLE_ID
    styleEl.setAttribute('data-plugin', PLUGIN_ID)
    document.head.appendChild(styleEl)
  }
  styleEl.textContent = buildPluginCss(prefs)
}

function removePluginStyles() {
  if (typeof document === 'undefined') return
  const styleEl = document.getElementById(STYLE_ID)
  if (styleEl && styleEl.parentNode) {
    styleEl.parentNode.removeChild(styleEl)
  }
}

// ============================================================================
// PART 2: PER-MODEL HERMES REASONING PROFILE RESOLVER (Plan A)
// ============================================================================
const OPTION_DEFS = {
  minimal: { value: 'minimal', label: '极低', shortLabel: 'Min' },
  low: { value: 'low', label: '低', shortLabel: 'Low' },
  medium: { value: 'medium', label: '中', shortLabel: 'Med' },
  high: { value: 'high', label: '高', shortLabel: 'High' },
  xhigh: { value: 'xhigh', label: '极高', shortLabel: 'XHigh' },
  max: { value: 'max', label: '最高', shortLabel: 'Max' },
  ultra: { value: 'ultra', label: '超高', shortLabel: 'Ultra' }
}

const EFFORT_ZH_NAMES = {
  none: '关闭',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高',
  ultra: '超高'
}

const KIMI_K3_SLUG_RE = /(?:^|[^a-z0-9])k3(?:[^a-z0-9]|$)/
const GROK_VERSION_RE = /^grok-(\d+)(?:\.(\d+))?/
const THREE_TIER_PROVIDERS = new Set(['tencent-tokenhub', 'tokenhub', 'nebius', 'upstage'])

function mapEffortToVisualStage(tierIndex, totalTiers, hasUltraHigh) {
  const n = Math.max(1, totalTiers | 0)
  const i = Math.max(0, Math.min(n - 1, tierIndex | 0))
  if (n === 1) return 0
  if (n === 2) return i === 0 ? 0 : hasUltraHigh ? 3 : 2
  if (hasUltraHigh) {
    if (i === 0) return 0
    if (i === n - 1) return 3
    if (i === n - 2) return 2
    return 1
  }
  if (i === 0) return 0
  if (i === n - 1) return 2
  return 1
}

function buildEffortProfile(values, hasUltraStage, hint) {
  const options = values.map(v => OPTION_DEFS[v])
  const stageMap = values.map((_, idx) => mapEffortToVisualStage(idx, values.length, hasUltraStage))
  return { options, stageMap, hasUltraStage, hint }
}

function isCodexMaxCapable(bare) {
  return (
    bare.includes('gpt-5.6') ||
    bare.startsWith('gpt-6-sol') ||
    bare.startsWith('gpt-6-luna') ||
    bare.startsWith('gpt-6.1-sol') ||
    bare === 'gpt-6-astra' ||
    bare === 'gpt-6-astra-900k' ||
    bare === 'gpt-daybreak-blue-latest' ||
    bare === 'gpt-daybreak-blue-latest-900k'
  )
}

function isGrok46OrNewer(bare) {
  const match = GROK_VERSION_RE.exec(bare)
  if (!match) return false
  const major = Number.parseInt(match[1], 10)
  const minor = match[2] ? Number.parseInt(match[2], 10) : 0
  return major > 4 || (major === 4 && minor >= 6)
}

function resolveTardisEffortProfile(provider, model, effortWire = '') {
  const prov = normalizeStr(provider)
  const rawModel = normalizeStr(model)
  const bare = rawModel.includes('/') ? rawModel.slice(rawModel.lastIndexOf('/') + 1) : rawModel
  const wire = normalizeStr(effortWire)

  if (prov === 'openai-codex') {
    const maxCapable = isCodexMaxCapable(bare)
    if (wire === 'ultra' && maxCapable) {
      return buildEffortProfile(['low', 'medium', 'high', 'ultra'], true, '4档 · 含超高 Ultra')
    }
    if (maxCapable) {
      return buildEffortProfile(['low', 'medium', 'high', 'max'], true, '4档 · 最高直发 Max')
    }
    return buildEffortProfile(['low', 'medium', 'high', 'xhigh'], true, '4档 · 最高直发 XHigh')
  }

  if (bare.startsWith('glm-5.2')) {
    return buildEffortProfile(['high', 'max'], false, '2档 · 最高→高')
  }

  if (KIMI_K3_SLUG_RE.test(bare) || bare === 'x-preview-f-free') {
    return buildEffortProfile(['low', 'high', 'max'], false, '3档 · 最高→高')
  }

  if (prov === 'xai' || bare.startsWith('grok-')) {
    if (isGrok46OrNewer(bare)) {
      return buildEffortProfile(['low', 'medium', 'high', 'xhigh'], true, '4档 · 最高直发 XHigh')
    }
    return buildEffortProfile(['low', 'medium', 'high'], false, '3档 · 最高→高')
  }

  if (
    ((bare.startsWith('gemini-4') || bare.startsWith('gemini4')) && wire !== 'max' && wire !== 'ultra') ||
    bare.includes('kimi-k2') ||
    ((prov === 'moonshot' || bare.startsWith('kimi')) && !KIMI_K3_SLUG_RE.test(bare)) ||
    THREE_TIER_PROVIDERS.has(prov) ||
    bare.startsWith('solar-')
  ) {
    return buildEffortProfile(['low', 'medium', 'high'], false, '3档 · 最高→高')
  }

  return buildEffortProfile(['low', 'medium', 'high', 'max'], true, '4档 · 最高直发 Max')
}

function resolveTardisOptionIndex(profile, rawEffort) {
  const norm = normalizeStr(rawEffort)
  const lastIdx = Math.max(0, profile.options.length - 1)
  if (!norm || norm === 'none') return 0

  const exactIdx = profile.options.findIndex(opt => opt.value === norm)
  if (exactIdx >= 0) return exactIdx

  const ranks = Array.isArray(REASONING_EFFORTS)
    ? REASONING_EFFORTS
    : ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']
  let targetRank = ranks.indexOf(norm)
  if (targetRank < 0) {
    targetRank = ranks.indexOf(DEFAULT_REASONING_EFFORT || 'medium')
  }

  for (let i = 0; i < profile.options.length; i++) {
    if (ranks.indexOf(profile.options[i].value) >= targetRank) {
      return i
    }
  }
  return lastIdx
}

function findModelCatalogInfo(modelOptions, provider, model) {
  const providers = Array.isArray(modelOptions?.providers) ? modelOptions.providers : []
  let row = null

  if (provider) {
    row = providers.find(candidate => {
      try {
        return catalogProviderMatches(candidate, provider)
      } catch {
        return candidate?.slug === provider || candidate?.name === provider
      }
    }) || null
  }

  if (!row && model) {
    const baseModel = model.replace(/-fast$/i, '')
    row = providers.find(candidate => {
      const list = Array.isArray(candidate?.models) ? candidate.models : []
      return list.includes(model) || list.includes(baseModel)
    }) || null
  }

  const providerModels = Array.isArray(row?.models) ? row.models : []
  const capsMap = row?.capabilities && typeof row.capabilities === 'object' ? row.capabilities : {}
  const baseModel = typeof model === 'string' ? model.replace(/-fast$/i, '') : ''
  const caps = (model && capsMap[model]) || (baseModel && capsMap[baseModel]) || undefined

  return {
    row,
    matchedProvider: row?.slug || provider || '',
    providerModels,
    caps
  }
}

function resolveFastControl(model, providerModels, paramSupported, currentFastMode) {
  if (paramSupported) {
    return { kind: 'param', on: Boolean(currentFastMode) }
  }
  if (model && /-fast$/i.test(model)) {
    const baseId = model.replace(/-fast$/i, '')
    return providerModels.includes(baseId)
      ? { kind: 'variant', baseId, fastId: model, on: true }
      : { kind: 'none' }
  }
  if (model) {
    const fastId = `${model}-fast`
    if (providerModels.includes(fastId)) {
      return { kind: 'variant', baseId: model, fastId, on: false }
    }
  }
  if (currentFastMode) {
    return { kind: 'param', on: true, canEnable: false }
  }
  return { kind: 'none' }
}

// ============================================================================
// PART 3: SELF-CONTAINED 16-BIT TARDIS PIXEL ENGINE & AUDIO SYNTH
// ============================================================================
const VISUAL_STOPS = [0, 1 / 3, 2 / 3, 1]
const CANONICAL_STAGE_NAMES = ['低', '中', '高', '超高']
const BEATS = [
  '伦敦街头待命 · 10 任博士倚靠 TARDIS',
  '地球近地轨道 · 蓝星之上静谧悬浮',
  '深空星海巡航 · 向右前方稳健跃进',
  '蓝橙时间隧道 · 穿梭时空漩涡湍流'
]
const STAGE_TAGS = ['LONDON · 10TH', 'EARTH ORBIT', 'DEEP SPACE', 'TIME VORTEX']
const ACCENTS = ['#4AA8FF', '#5CE1FF', '#9A7BFF', '#FF9838']
const PX_H = 34

function buildEngineProfileState(profileOpts = {}) {
  const rawLevels = Array.isArray(profileOpts.levels) && profileOpts.levels.length > 0
    ? profileOpts.levels.map(v => String(v))
    : ['低', '中', '高', '最高']
  const hasUltraHigh = typeof profileOpts.hasUltraHigh === 'boolean'
    ? profileOpts.hasUltraHigh
    : rawLevels.length >= 4
  const stageMap = Array.isArray(profileOpts.stageMap) && profileOpts.stageMap.length === rawLevels.length
    ? profileOpts.stageMap.slice()
    : rawLevels.map((_, i) => mapEffortToVisualStage(i, rawLevels.length, hasUltraHigh))
  const visualPs = stageMap.map(s => VISUAL_STOPS[s] ?? 0)
  const maxVisualStage = stageMap.length > 0 ? Math.max(...stageMap) : (hasUltraHigh ? 3 : 2)
  const maxVisualP = VISUAL_STOPS[maxVisualStage] ?? 1
  return {
    levels: rawLevels,
    hasUltraHigh,
    stageMap,
    visualPs,
    maxVisualStage,
    maxVisualP
  }
}

const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const lerpNum = (a, b, t) => a + (b - a) * t
const smoothstep = (a, b, x) => {
  const t = clampNum((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

function hexRgb(h) {
  const s = h.charAt(0) === '#' ? h.slice(1) : h
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
}

function mkRng(seed) {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
}

const BAYER4 = [
  0 / 16, 8 / 16, 2 / 16, 10 / 16,
  12 / 16, 4 / 16, 14 / 16, 6 / 16,
  3 / 16, 11 / 16, 1 / 16, 9 / 16,
  15 / 16, 7 / 16, 13 / 16, 5 / 16
]
const bayer4 = (x, y) => BAYER4[((y & 3) << 2) | (x & 3)]

function pxRect(g, x, y, w, h, c) {
  g.fillStyle = c
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
}

function bakeAsciiSprite(rows, palette) {
  const h = rows.length
  const w = rows[0].length
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  if (!g) return c
  for (let y = 0; y < h; y++) {
    const row = rows[y]
    for (let x = 0; x < w; x++) {
      const ch = row[x]
      if (ch !== '.' && palette[ch]) {
        g.fillStyle = palette[ch]
        g.fillRect(x, y, 1, 1)
      }
    }
  }
  return c
}

function flipHorizontalSprite(srcCanvas) {
  const c = document.createElement('canvas')
  c.width = srcCanvas.width
  c.height = srcCanvas.height
  const g = c.getContext('2d')
  if (!g) return c
  g.imageSmoothingEnabled = false
  g.translate(c.width, 0)
  g.scale(-1, 1)
  g.drawImage(srcCanvas, 0, 0)
  return c
}

function bakeTintedSilhouette(srcCanvas, hexColor) {
  const c = document.createElement('canvas')
  c.width = srcCanvas.width
  c.height = srcCanvas.height
  const g = c.getContext('2d')
  if (!g) return c
  g.drawImage(srcCanvas, 0, 0)
  g.globalCompositeOperation = 'source-in'
  g.fillStyle = hexColor
  g.fillRect(0, 0, c.width, c.height)
  g.globalCompositeOperation = 'source-over'
  return c
}

const TARDIS_PAL = {
  L: '#FFFDF0',
  l: '#A6DBFF',
  H: '#4D8CE6',
  B: '#2761BA',
  D: '#194184',
  S: '#0E244D',
  K: '#091120',
  T: '#E7F0FF',
  W: '#FFF4B8',
  Y: '#FFD666',
  P: '#F4F7FC',
  p: '#607394',
  M: '#D8E3F2'
}

const DOC10_PAL = {
  h: '#3B2112',
  H: '#6B3E23',
  F: '#F3C59F',
  f: '#D29B72',
  E: '#241711',
  C: '#F4F6FA',
  R: '#A82433',
  T: '#B07B45',
  t: '#D6A066',
  d: '#6F4926',
  N: '#1C2436',
  n: '#2C3852',
  S: '#EFEBE0',
  s: '#B2ADA0'
}

let SPRITE_TARDIS_UPRIGHT = null
let SPRITE_TARDIS_GHOST_CYAN = null
let SPRITE_TARDIS_GHOST_AMBER = null
let SPRITE_DOCTOR_10 = null
let SPRITE_DOCTOR_10_WALK_R1 = null
let SPRITE_DOCTOR_10_WALK_R2 = null
let SPRITE_DOCTOR_10_WALK_R3 = null
let SPRITE_DOCTOR_10_WALK_L1 = null
let SPRITE_DOCTOR_10_WALK_L2 = null
let SPRITE_DOCTOR_10_WALK_L3 = null
let WALK_CYCLE_R = null
let WALK_CYCLE_L = null

function ensureSpritesBaked() {
  if (SPRITE_TARDIS_UPRIGHT || typeof document === 'undefined') return

  SPRITE_TARDIS_UPRIGHT = bakeAsciiSprite([
    '......L......',
    '.....lLl.....',
    '....DDHDD....',
    '..HHBBBBBBDD.',
    '.HHBBBBBBBBDS',
    '.KTTKTKTTKTKS',
    '.KKKKKKKKKKKS',
    '.HBBBBBBBBDBS',
    '.HBWDBDWDBWDS',
    '.HBDDBDDDDDDS',
    '.HBYDBDYDBYDS',
    '.HBBBBBBBBDBS',
    '.HBPPPBSDSSDS',
    '.HBPpPBSDSSDS',
    '.HBPPPBMDSSDS',
    '.HBBBBBBBBDBS',
    '.HBSSSBSBSSDS',
    '.HBSSSBSBSSDS',
    '.HBSSSBSBSSDS',
    '.HDDDDDDDDDDS',
    'SSSSSSSSSSSSS',
    'SSSSSSSSSSSSS'
  ], TARDIS_PAL)

  SPRITE_TARDIS_GHOST_CYAN = bakeTintedSilhouette(SPRITE_TARDIS_UPRIGHT, '#6AEFFF')
  SPRITE_TARDIS_GHOST_AMBER = bakeTintedSilhouette(SPRITE_TARDIS_UPRIGHT, '#FFAA40')

  SPRITE_DOCTOR_10 = bakeAsciiSprite([
    '...HhH....',
    '..hHHHh...',
    '..hFFEF...',
    '...FFf....',
    '...CRC....',
    '.tdTRTt...',
    'dTTRNNTd..',
    'dTTNNNtd..',
    '.TTNNTTd..',
    '.TTTNNTd..',
    '.dTTNTd...',
    '.dTTnTd...',
    '..TTnT....',
    '..d.nN....',
    '...NNn....',
    '..nN.Nn...',
    '..Ss..Ss..'
  ], DOC10_PAL)

  SPRITE_DOCTOR_10_WALK_R1 = bakeAsciiSprite([
    '....HhH...',
    '..hhHHHH..',
    '..hhFFEF..',
    '...fFFf...',
    '...CRC....',
    '..dTRTt...',
    '.dTTNRtt..',
    '.dTTNNTt..',
    'dTTTNNTd..',
    'dTTTNNT...',
    'dTTTNd....',
    '.dTTnT....',
    '..dTnN....',
    '..nN.nN...',
    '.nN...Nn..',
    '.n.....N..',
    '.Ss....Ss.'
  ], DOC10_PAL)

  SPRITE_DOCTOR_10_WALK_R2 = bakeAsciiSprite([
    '....HhH...',
    '..hhHHHH..',
    '..hhFFEF..',
    '...fFFf...',
    '...CRC....',
    '..dTRTt...',
    '.dTTNRtt..',
    '.dTTNNTt..',
    'dTTTNNTd..',
    '.dTTNNT...',
    '.dTTNd....',
    '..dTnT....',
    '...TnN....',
    '...nNN....',
    '...NNn....',
    '...nNn....',
    '...SsSs...'
  ], DOC10_PAL)

  SPRITE_DOCTOR_10_WALK_R3 = bakeAsciiSprite([
    '....HhH...',
    '..hhHHHH..',
    '..hhFFEF..',
    '...fFFf...',
    '...CRC....',
    '..dTRTt...',
    '.dTTNRtt..',
    '.dTTNNTt..',
    'dTTTNNTd..',
    'dTTTNNT...',
    'dTTTNd....',
    '.dTTnT....',
    '..dTnN....',
    '..nNnN....',
    '..N..Nn...',
    '..n...Nn..',
    '..Ss...Ss.'
  ], DOC10_PAL)

  SPRITE_DOCTOR_10_WALK_L1 = flipHorizontalSprite(SPRITE_DOCTOR_10_WALK_R1)
  SPRITE_DOCTOR_10_WALK_L2 = flipHorizontalSprite(SPRITE_DOCTOR_10_WALK_R2)
  SPRITE_DOCTOR_10_WALK_L3 = flipHorizontalSprite(SPRITE_DOCTOR_10_WALK_R3)

  WALK_CYCLE_R = [
    SPRITE_DOCTOR_10_WALK_R1,
    SPRITE_DOCTOR_10_WALK_R2,
    SPRITE_DOCTOR_10_WALK_R3,
    SPRITE_DOCTOR_10_WALK_R2
  ]
  WALK_CYCLE_L = [
    SPRITE_DOCTOR_10_WALK_L1,
    SPRITE_DOCTOR_10_WALK_L2,
    SPRITE_DOCTOR_10_WALK_L3,
    SPRITE_DOCTOR_10_WALK_L2
  ]
}

function drawTardisOpenDoor(g, drawX, drawY, openAmt, groundY) {
  if (openAmt <= 0.04) return
  const openW = clampNum(Math.round(openAmt * 4), 1, 4)
  const doorX = drawX + 7
  const doorY = drawY + 8
  const doorH = 12

  pxRect(g, doorX, doorY, openW, doorH, '#FFD666')
  if (openW >= 2) {
    pxRect(g, doorX + 1, doorY + 1, Math.max(1, openW - 1), doorH - 2, '#FFF7CE')
  }
  pxRect(g, doorX, doorY, 1, doorH, '#163B7A')

  g.save()
  g.globalAlpha = clampNum(openAmt * 0.45, 0, 0.45)
  g.fillStyle = '#FFE48C'
  g.fillRect(doorX, groundY, openW + 3, 1)
  g.fillStyle = '#FFD060'
  g.fillRect(doorX + 1, groundY + 1, openW + 5, 1)
  g.restore()
}

function getTardisTrackNorm(p, maxVisualP = 1) {
  const s1 = VISUAL_STOPS[1]
  const maxP = Math.max(s1, maxVisualP)
  const s1Track = lerpNum(0.13, 0.81, clampNum(s1 / maxP, 0, 1))
  if (p <= s1) {
    const u = clampNum(p / s1, 0, 1)
    if (u <= 0.46) return 0.13
    return lerpNum(0.13, s1Track, smoothstep(0.46, 1.0, u))
  }
  const spanP = Math.max(0.001, maxP - s1)
  return lerpNum(s1Track, 0.81, clampNum((p - s1) / spanP, 0, 1))
}

const R_BG = mkRng(4099)
const STARS = Array.from({ length: 84 }, () => ({
  x: R_BG(),
  y: R_BG(),
  z: 0.35 + R_BG() * 1.15,
  ph: R_BG() * Math.PI * 2,
  col: R_BG() > 0.72 ? '#8BF5FF' : R_BG() > 0.44 ? '#FFE999' : '#FFFFFF',
  big: R_BG() > 0.84
}))

const ORBIT_CLOUDS = Array.from({ length: 10 }, () => ({
  x: R_BG(),
  y: 0.66 + R_BG() * 0.28,
  w: 7 + Math.floor(R_BG() * 10),
  sp: 0.35 + R_BG() * 0.55
}))

const RAIN_DROPS = Array.from({ length: 28 }, () => ({
  x: R_BG(),
  y: R_BG(),
  sp: 0.8 + R_BG() * 0.8
}))

const R_FX = mkRng(9011)
const SPEED_LINES = Array.from({ length: 26 }, (_, idx) => ({
  x: R_FX(),
  y: 1 + Math.floor(R_FX() * (PX_H - 2)),
  len: 4 + Math.floor(R_FX() * 10),
  sp: 0.75 + R_FX() * 0.75,
  fg: idx % 4 === 0,
  colIdx: idx % 3
}))

const STRATO_CLOUDS = Array.from({ length: 14 }, () => ({
  x: R_FX(),
  y: R_FX(),
  w: 12 + Math.floor(R_FX() * 16),
  h: 2 + Math.floor(R_FX() * 2),
  sp: 0.7 + R_FX() * 0.7
}))

function fillDitheredBandSky(g, pxW, h, hexStops, spread = 0.08) {
  const rgbs = hexStops.map(hexRgb)
  const n = rgbs.length - 1
  for (let y = 0; y < h; y++) {
    const pos = (y / Math.max(1, h - 1)) * n
    const idx = Math.min(n - 1, Math.floor(pos))
    const frac = pos - idx
    for (let x = 0; x < pxW; x++) {
      const d = frac + (bayer4(x, y) - 0.5) * spread
      const rgb = d > 0.5 ? rgbs[idx + 1] : rgbs[idx]
      g.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
      g.fillRect(x, y, 1, 1)
    }
  }
}

function buildStageCaches(pxW) {
  const pxH = PX_H

  const londonBg = document.createElement('canvas')
  londonBg.width = pxW
  londonBg.height = pxH
  const lg = londonBg.getContext('2d')
  if (lg) {
    fillDitheredBandSky(lg, pxW, 27, ['#080E1E', '#0D1730', '#132243', '#1B3056', '#25406B'], 0.25)

    const eyeCx = Math.round(pxW * 0.72)
    const eyeCy = 17
    const eyeR = 8
    for (let a = 0; a < 32; a++) {
      const th = (a / 32) * Math.PI * 2
      pxRect(lg, eyeCx + Math.cos(th) * eyeR, eyeCy + Math.sin(th) * eyeR, 1, 1, '#3B5C8E')
      if (a % 4 === 0) {
        pxRect(lg, eyeCx + Math.cos(th) * (eyeR * 0.55), eyeCy + Math.sin(th) * (eyeR * 0.55), 1, 1, '#263E66')
      }
      if (a % 8 === 0) {
        pxRect(lg, eyeCx + Math.cos(th) * (eyeR - 1), eyeCy + Math.sin(th) * (eyeR - 1), 1, 1, '#79A8DE')
      }
    }
    pxRect(lg, eyeCx - 1, eyeCy, 1, 11, '#223659')
    pxRect(lg, eyeCx + 1, eyeCy, 1, 11, '#223659')

    const rngL = mkRng(771)
    for (let bx = 0; bx < pxW; bx += 11) {
      const bw = 9 + Math.floor(rngL() * 6)
      const bh = 5 + Math.floor(rngL() * 7)
      const by = 27 - bh
      pxRect(lg, bx, by, bw, bh, '#10192D')
      pxRect(lg, bx + 2, by - 2, 2, 2, '#131F36')
      if (rngL() > 0.45) pxRect(lg, bx + 3, by + 2, 1, 1, '#E6B85C')
      if (rngL() > 0.65 && bw > 10) pxRect(lg, bx + 6, by + 3, 1, 1, '#D8A24A')
    }

    const benX = Math.round(pxW * 0.44)
    pxRect(lg, benX - 3, 11, 7, 16, '#141E34')
    pxRect(lg, benX - 4, 9, 9, 3, '#1A2742')
    pxRect(lg, benX - 2, 6, 5, 3, '#17223B')
    pxRect(lg, benX - 1, 3, 3, 3, '#1B2947')
    pxRect(lg, benX, 1, 1, 2, '#2B406B')
    pxRect(lg, benX - 2, 12, 5, 5, '#FFE084')
    pxRect(lg, benX - 1, 13, 3, 3, '#FFF6C8')
    pxRect(lg, benX, 13, 1, 2, '#3C2F1E')
    pxRect(lg, benX, 14, 2, 1, '#3C2F1E')

    const phoneX = Math.round(pxW * 0.87)
    pxRect(lg, phoneX, 20, 4, 7, '#7A1922')
    pxRect(lg, phoneX + 1, 21, 2, 3, '#A82632')
    pxRect(lg, phoneX + 1, 22, 2, 1, '#FFD480')

    const lampX = Math.round(pxW * 0.78)
    pxRect(lg, lampX, 15, 1, 13, '#161D2C')
    pxRect(lg, lampX - 1, 13, 3, 2, '#FFE28A')
    pxRect(lg, lampX, 13, 1, 1, '#FFFFFF')
    pxRect(lg, lampX - 1, 12, 3, 1, '#1E283D')
    lg.fillStyle = 'rgba(255, 214, 110, 0.16)'
    lg.fillRect(lampX - 4, 11, 9, 7)

    pxRect(lg, 0, 27, pxW, 7, '#121826')
    for (let y = 27; y < pxH; y++) {
      for (let x = 0; x < pxW; x++) {
        if ((x + (y % 2) * 2) % 4 === 0 && y % 2 === 0) {
          lg.fillStyle = '#1D263B'
          lg.fillRect(x, y, 2, 1)
        } else if (bayer4(x, y) > 0.8) {
          lg.fillStyle = '#0D121E'
          lg.fillRect(x, y, 1, 1)
        }
      }
    }
    pxRect(lg, lampX - 3, 29, 7, 1, 'rgba(255, 206, 102, 0.25)')
    pxRect(lg, lampX - 2, 31, 5, 1, 'rgba(255, 206, 102, 0.16)')
  }

  const earthBg = document.createElement('canvas')
  earthBg.width = pxW
  earthBg.height = pxH
  const eg = earthBg.getContext('2d')
  const earthCx = pxW * 0.5
  const earthR = Math.max(130, pxW * 1.15)
  const earthCy = pxH + earthR - 13
  if (eg) {
    fillDitheredBandSky(eg, pxW, pxH, ['#040814', '#060D20', '#08132B', '#0B1A38', '#0E2247'], 0.22)
    for (let y = 17; y < pxH; y++) {
      for (let x = 0; x < pxW; x++) {
        const dx = x - earthCx
        const dy = y - earthCy
        const dist = Math.sqrt(dx * dx + dy * dy)
        const rim = dist - earthR
        if (rim < 2.4 && rim >= 0) {
          const alpha = 1 - rim / 2.4
          eg.fillStyle = alpha > 0.55 ? '#84EEFF' : '#2E82EA'
          eg.fillRect(x, y, 1, 1)
        } else if (rim < 0) {
          const lon = x * 0.085
          const lat = (y - 20) * 0.30
          const n = Math.sin(lon * 0.9 + Math.cos(lat * 1.3)) + Math.cos(lon * 1.8 - lat * 0.8) * 0.55
          if (rim > -1.3) {
            eg.fillStyle = '#8CF2FF'
          } else if (n > 0.45) {
            eg.fillStyle = n > 0.88 ? '#C29F58' : (bayer4(x, y) > 0.5 ? '#42A462' : '#2E824E')
          } else {
            eg.fillStyle = rim > -3.4 ? '#287CE6' : (bayer4(x, y) > 0.6 ? '#1754AC' : '#103B82')
          }
          eg.fillRect(x, y, 1, 1)
        }
      }
    }
  }

  const spaceBg = document.createElement('canvas')
  spaceBg.width = pxW
  spaceBg.height = pxH
  const sg = spaceBg.getContext('2d')
  if (sg) {
    const cVoid = hexRgb('#04050F')
    const cDeep = hexRgb('#0D0B28')
    const cIndigo = hexRgb('#1D174E')
    const cViolet = hexRgb('#4D2480')
    const cTeal = hexRgb('#155E7B')
    for (let y = 0; y < pxH; y++) {
      for (let x = 0; x < pxW; x++) {
        const nx = x / pxW
        const ny = y / pxH
        const wave = Math.sin(nx * 5.2 + ny * 3.1) * 0.5 + Math.cos(nx * 9.5 - ny * 4.4) * 0.3
        const band = Math.exp(-Math.pow((ny - 0.52 + Math.sin(nx * 4.0) * 0.14) * 3.1, 2))
        const val = clampNum(band * (0.58 + wave * 0.42), 0, 1)
        const dith = val + (bayer4(x, y) - 0.5) * 0.14
        let rgb = cVoid
        if (dith > 0.74) rgb = nx > 0.5 ? cTeal : cViolet
        else if (dith > 0.48) rgb = cIndigo
        else if (dith > 0.25) rgb = cDeep
        sg.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
        sg.fillRect(x, y, 1, 1)
      }
    }
    const pCx = Math.round(pxW * 0.24)
    const pCy = 9
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx + dy * dy <= 10) {
          sg.fillStyle = dx + dy < -1 ? '#E8B8A2' : dx + dy > 1 ? '#6A3E52' : '#B56E6E'
          sg.fillRect(pCx + dx, pCy + dy, 1, 1)
        }
      }
    }
    for (let rx = -6; rx <= 6; rx++) {
      const ry = Math.round(rx * 0.32)
      if (Math.abs(rx) >= 3 || ry >= 0) {
        sg.fillStyle = Math.abs(rx) > 4 ? '#A894C8' : '#E8D2AA'
        sg.fillRect(pCx + rx, pCy + ry, 1, 1)
      }
    }
  }

  const vx = pxW * 0.94
  const vy = pxH * 0.47
  const count = pxW * pxH
  const vortexR = new Float32Array(count)
  const vortexLogR = new Float32Array(count)
  const vortexAng = new Float32Array(count)
  for (let y = 0; y < pxH; y++) {
    for (let x = 0; x < pxW; x++) {
      const idx = y * pxW + x
      const dx = (x - vx) * 0.56
      const dy = y - vy
      const dist = Math.sqrt(dx * dx + dy * dy)
      vortexR[idx] = dist
      vortexLogR[idx] = Math.log(dist + 1.5)
      vortexAng[idx] = Math.atan2(dy, dx)
    }
  }

  const vortexCanvas = document.createElement('canvas')
  vortexCanvas.width = pxW
  vortexCanvas.height = pxH
  const vg = vortexCanvas.getContext('2d')
  const vortexImg = typeof ImageData === 'function'
    ? new ImageData(pxW, pxH)
    : vg
      ? vg.createImageData(pxW, pxH)
      : { data: new Uint8ClampedArray(pxW * pxH * 4) }

  return {
    pxW,
    pxH,
    londonBg,
    earthBg,
    spaceBg,
    vortexR,
    vortexLogR,
    vortexAng,
    vortexImg,
    vortexCanvas
  }
}

function renderTimeVortexLayer(cache, t, opacity) {
  const { pxW, pxH, vortexR, vortexLogR, vortexAng, vortexImg, vortexCanvas } = cache
  const vg = vortexCanvas.getContext('2d')
  if (!vg || !vortexImg) return

  const data = vortexImg.data
  const speed = t * 4.4
  const rot = t * 1.85
  const a255 = Math.round(clampNum(opacity, 0, 1) * 255)

  for (let y = 0; y < pxH; y++) {
    const rowOff = y * pxW
    for (let x = 0; x < pxW; x++) {
      const i = rowOff + x
      const dist = vortexR[i]
      const lr = vortexLogR[i]
      const ang = vortexAng[i]

      const phase = lr * 4.6 - speed * 0.9
      const waveBlue = Math.sin(ang * 2.0 + phase - rot * 0.45 + Math.cos(lr * 2.4 - t * 1.4) * 0.5)
      const waveOrange = Math.sin(ang * 2.0 + Math.PI + phase - rot * 0.45 - Math.sin(lr * 2.0 + t * 1.2) * 0.45)
      const ridge = Math.cos(ang * 6.0 - lr * 3.6 + speed * 1.1) * 0.34

      const bVal = clampNum((waveBlue + ridge + 0.32) * 0.56, 0, 1)
      const oVal = clampNum((waveOrange - ridge * 0.45 + 0.24) * 0.56, 0, 1)

      const throat = Math.exp(-Math.pow((dist - 4.0) / 4.4, 2))
      const coreVoid = smoothstep(0.6, 2.5, dist)
      const dith = bayer4(x, y) - 0.5

      let r = 6
      let g = 12
      let b = 30
      if (oVal > bVal + 0.03) {
        const level = clampNum(oVal + throat * 0.38 + dith * 0.16, 0, 1)
        if (level > 0.87) {
          r = 255; g = 212; b = 96
        } else if (level > 0.64) {
          r = 236; g = 104; b = 18
        } else if (level > 0.36) {
          r = 138; g = 40; b = 8
        } else {
          r = 42; g = 10; b = 8
        }
      } else {
        const level = clampNum(bVal + throat * 0.34 + dith * 0.16, 0, 1)
        if (level > 0.87) {
          r = 136; g = 232; b = 255
        } else if (level > 0.62) {
          r = 38; g = 128; b = 232
        } else if (level > 0.34) {
          r = 16; g = 54; b = 142
        } else {
          r = 7; g = 18; b = 52
        }
      }

      r = Math.round(r * coreVoid + 12 * (1 - coreVoid))
      g = Math.round(g * coreVoid + 22 * (1 - coreVoid))
      b = Math.round(b * coreVoid + 52 * (1 - coreVoid))

      const p4 = i << 2
      data[p4] = r
      data[p4 + 1] = g
      data[p4 + 2] = b
      data[p4 + 3] = a255
    }
  }

  vg.putImageData(vortexImg, 0, 0)
  vg.globalAlpha = clampNum(opacity, 0, 1)
  const vx = pxW * 0.94
  const vy = pxH * 0.47
  for (let s = 0; s < 14; s++) {
    const ang = (s / 14) * Math.PI * 2 + Math.sin(s * 3.1) * 0.2
    const travel = (t * (1.8 + (s % 3) * 0.45) + s * 0.19) % 1
    const r0 = 3 + travel * pxW * 0.88
    const len = 3 + travel * 6
    const sx = Math.round(vx + Math.cos(ang) * r0)
    const sy = Math.round(vy + Math.sin(ang) * r0 * 0.55)
    const ex = Math.round(vx + Math.cos(ang) * (r0 + len))
    if (sx >= 0 && sx < pxW && sy >= 0 && sy < pxH) {
      vg.fillStyle = s % 2 === 0 ? '#A8F2FF' : '#FFE07A'
      vg.fillRect(sx, sy, Math.max(1, Math.abs(ex - sx) > 2 ? 2 : 1), 1)
    }
  }

  const boltPhase = Math.floor(t * 7.5)
  if (boltPhase % 9 === 0 || boltPhase % 13 === 0) {
    const startX = Math.round(vx - 14 - (boltPhase % 5) * 9)
    const topSide = boltPhase % 2 === 0 ? 5 : pxH - 7
    vg.fillStyle = topSide < 15 ? '#D8FAFF' : '#FFE89A'
    for (let k = 0; k < 8; k++) {
      const bx = startX - k * 3
      const by = topSide + ((k + boltPhase) % 3) - 1
      if (bx >= 0 && bx < pxW && by >= 0 && by < pxH) {
        vg.fillRect(bx, by, 2, 1)
      }
    }
  }
  vg.globalAlpha = 1
}

function drawDynamicEarth(g, pxW, cx, topY, r, earthR0, t, reduced) {
  const cy = topY + r
  const minX = Math.max(0, Math.floor(cx - r - 3))
  const maxX = Math.min(pxW - 1, Math.ceil(cx + r + 3))
  const minY = Math.max(0, Math.floor(cy - r - 3))
  const maxY = Math.min(PX_H - 1, Math.ceil(cy + r + 3))
  if (minX > maxX || minY > maxY) return

  const shrinkFrac = clampNum(Math.log(earthR0 / Math.max(2, r)) / Math.log(earthR0 / 4.0), 0, 1)
  const rimW = lerpNum(2.4, 1.3, shrinkFrac)
  const scale = Math.min(4.2, Math.pow(earthR0 / Math.max(2, r), 0.52))
  const cloudShift = reduced ? 0 : t * 1.8

  for (let y = minY; y <= maxY; y++) {
    const dy = y - cy
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx
      const dist = Math.sqrt(dx * dx + dy * dy)
      const rim = dist - r
      if (rim < rimW && rim >= 0) {
        const alpha = 1 - rim / rimW
        g.fillStyle = alpha > 0.55 ? '#84EEFF' : '#2E82EA'
        g.fillRect(x, y, 1, 1)
      } else if (rim < 0) {
        const lon = ((x - cx) * scale + cx) * 0.085
        const lat = (y - topY + 1) * 0.30 * Math.min(2.4, scale)
        const n = Math.sin(lon * 0.9 + Math.cos(lat * 1.3)) + Math.cos(lon * 1.8 - lat * 0.8) * 0.55
        const cloud = Math.sin(lon * 1.4 - cloudShift + lat * 2.1)
        if (rim > -1.2) {
          g.fillStyle = '#8CF2FF'
        } else if (cloud > 0.82) {
          g.fillStyle = '#F2FAFF'
        } else if (n > 0.45) {
          g.fillStyle = n > 0.88 ? '#C29F58' : (bayer4(x, y) > 0.5 ? '#42A462' : '#2E824E')
        } else {
          g.fillStyle = rim > -3.0 ? '#287CE6' : (bayer4(x, y) > 0.6 ? '#1754AC' : '#103B82')
        }
        g.fillRect(x, y, 1, 1)
      }
    }
  }
}

function drawRecedingEarth(g, pxW, u12, t, reduced) {
  const earthR0 = Math.max(130, pxW * 1.15)
  const s = smoothstep(0.0, 0.88, u12)
  if (s >= 0.999) return
  const r = earthR0 * Math.pow(4.0 / earthR0, s)
  const topY = lerpNum(PX_H - 13, 21.5, s)
  const cx = s < 0.52
    ? lerpNum(pxW * 0.5, pxW * 0.16, smoothstep(0, 0.52, s))
    : lerpNum(pxW * 0.16, -12, smoothstep(0.52, 1.0, s))
  drawDynamicEarth(g, pxW, cx, topY, r, earthR0, t, reduced)
}

function drawLondonAtmosphere(g, cache, pxW, dropY, t, reduced) {
  g.drawImage(cache.londonBg, 0, dropY)
  if (!reduced) {
    g.fillStyle = 'rgba(170, 205, 255, 0.26)'
    for (let i = 0; i < RAIN_DROPS.length; i++) {
      const d = RAIN_DROPS[i]
      const rx = Math.floor(((d.x * pxW - t * 14 * d.sp) % pxW + pxW) % pxW)
      const ry = Math.floor((d.y * 28 + t * 28 * d.sp) % 28)
      g.fillRect(rx, ry + dropY, 1, 2)
    }
    const mistShift = Math.round((t * 4) % 18)
    g.fillStyle = 'rgba(130, 165, 215, 0.14)'
    for (let mx = -mistShift; mx < pxW; mx += 18) {
      g.fillRect(mx, 23 + dropY, 10, 1)
      g.fillRect(mx + 6, 25 + dropY, 8, 1)
    }
  }
}

function drawWarpFlashOverlay(cg, pxW, tx, effFlash) {
  if (effFlash <= 0.02) return
  cg.save()
  cg.globalAlpha = effFlash * 0.72
  cg.fillStyle = '#D8FAFF'
  cg.fillRect(0, 0, pxW, PX_H)

  cg.globalAlpha = effFlash * 0.95
  cg.fillStyle = '#FFFFFF'
  const beamH = Math.max(2, Math.round(effFlash * 10))
  cg.fillRect(0, Math.round(PX_H / 2 - beamH / 2), pxW, beamH)

  cg.fillStyle = '#FFE488'
  for (let k = 0; k < 10; k++) {
    const sy = 3 + ((k * 7) % (PX_H - 6))
    const sx = Math.round(tx - 24 + k * 8)
    cg.fillRect(sx, sy, 6 + (k % 5) * 3, 1)
  }
  cg.restore()
}

function ensureRenderBuffers(cacheRef, cssW, pxW) {
  if (!cacheRef.current || cacheRef.current.pxW !== pxW) {
    cacheRef.current = buildStageCaches(pxW)
  }
  const cache = cacheRef.current
  if (!cache.artCanvas) {
    cache.artCanvas = document.createElement('canvas')
    cache.artCanvas.width = pxW
    cache.artCanvas.height = PX_H
  } else if (cache.artCanvas.width !== pxW) {
    cache.artCanvas.width = pxW
  }
  if (!cache.compCanvas) {
    cache.compCanvas = document.createElement('canvas')
    cache.compCanvas.width = cssW
    cache.compCanvas.height = 68
  } else if (cache.compCanvas.width !== cssW) {
    cache.compCanvas.width = cssW
  }
  return cache
}

function blitCompToDisplay(displayCanvas, compCanvas, cssW) {
  const dpr = Math.min((typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1, 2)
  const targetW = Math.round(cssW * dpr)
  const targetH = Math.round(68 * dpr)
  if (displayCanvas.width !== targetW || displayCanvas.height !== targetH) {
    displayCanvas.width = targetW
    displayCanvas.height = targetH
  }
  const dg = displayCanvas.getContext('2d')
  if (!dg) return
  dg.imageSmoothingEnabled = false
  dg.clearRect(0, 0, targetW, targetH)
  dg.drawImage(compCanvas, 0, 0, targetW, targetH)
}

function drawSpeedLines(g, pxW, t, intensity, inVortex, foreground, reduced) {
  if (intensity <= 0.03) return
  const baseSpeed = lerpNum(52, 138, inVortex ? 0.85 : 0.35)
  const palette = inVortex ? ['#FFFFFF', '#8CF2FF', '#FFD96B'] : ['#FFFFFF', '#8CF2FF', '#A78BFF']

  g.save()
  for (let i = 0; i < SPEED_LINES.length; i++) {
    const ln = SPEED_LINES[i]
    if (ln.fg !== foreground) continue
    const travel = reduced ? 0 : t * baseSpeed * ln.sp
    const len = Math.round(ln.len * (inVortex ? 1.55 : 1.0) * (0.55 + intensity * 0.5))
    const rx = Math.floor((((ln.x * pxW - travel) % (pxW + 24) + (pxW + 24)) % (pxW + 24))) - 12
    g.globalAlpha = intensity * (foreground ? 0.54 : 0.72)
    g.fillStyle = palette[ln.colIdx]
    g.fillRect(rx, ln.y, len, 1)
    if (len >= 9) {
      g.globalAlpha = intensity * (foreground ? 0.24 : 0.32)
      g.fillRect(rx + len, ln.y, 3, 1)
    }
  }
  g.restore()
}

function drawRigidTardis(cg, sprite, cxPx, cyPx, angleRad, scaleX, scaleY) {
  cg.save()
  cg.translate(Math.round(cxPx), Math.round(cyPx))
  if (Math.abs(angleRad) > 0.0005) cg.rotate(angleRad)
  cg.imageSmoothingEnabled = false
  const dw = Math.round(sprite.width * scaleX)
  const dh = Math.round(sprite.height * scaleY)
  cg.drawImage(sprite, Math.round(-dw / 2), Math.round(-dh / 2), dw, dh)
  cg.restore()
}

function drawRotatedBowArc(cg, cxPx, cyPx, angleRad, scaleX, scaleY, ghostMix, inVortexCut) {
  if (ghostMix <= 0.2) return
  cg.save()
  cg.translate(Math.round(cxPx), Math.round(cyPx))
  if (Math.abs(angleRad) > 0.0005) cg.rotate(angleRad)
  cg.scale(scaleX, scaleY)
  cg.globalAlpha = ghostMix * 0.72
  cg.fillStyle = '#A6F4FF'
  cg.fillRect(7, -7, 1, 14)
  if (inVortexCut) {
    cg.globalAlpha = 0.90
    cg.fillStyle = '#FFFFFF'
    cg.fillRect(9, -5, 1, 11)
    cg.fillStyle = '#7CEEFF'
    cg.fillRect(8, -8, 1, 3)
    cg.fillRect(8, 6, 1, 3)
    cg.fillStyle = '#FFD068'
    cg.fillRect(7, -10, 1, 2)
    cg.fillRect(7, 9, 1, 2)
  }
  cg.restore()
}

function renderMaterializeScene(displayCanvas, state, cache, cssW, pxW) {
  const m = clampNum(state.cutscene.progress, 0, 1)
  const t = state.t
  const reduced = state.reducedMotion
  const g = cache.artCanvas.getContext('2d')
  const cg = cache.compCanvas.getContext('2d')
  if (!g || !cg) return
  g.imageSmoothingEnabled = false

  const tx = pxW * 0.13
  const ty = 20.5
  const drawX = Math.round(tx - SPRITE_TARDIS_UPRIGHT.width / 2)
  const drawY = Math.round(ty - SPRITE_TARDIS_UPRIGHT.height / 2)

  drawLondonAtmosphere(g, cache, pxW, 0, t, reduced)

  let tardisAlpha = 0
  let osc = 0
  let matU = 0
  if (m >= 0.11 && m < 0.62) {
    matU = clampNum((m - 0.11) / 0.51, 0, 1)
    osc = Math.sin(matU * Math.PI * 5.0)
    tardisAlpha = matU >= 0.92
      ? 1.0
      : clampNum(Math.pow(matU, 0.72) * 0.92 + osc * 0.34 * (1 - matU * 0.65), 0.04, 1.0)
  } else if (m >= 0.62) {
    tardisAlpha = 1.0
  }

  if (tardisAlpha > 0.02) {
    g.save()
    g.globalAlpha = tardisAlpha * 0.26
    g.fillStyle = '#6AB8FF'
    g.fillRect(drawX, Math.min(PX_H - 1, drawY + 22), 13, 1)
    g.restore()
  }

  if (m >= 0.11 && m < 0.60 && !reduced) {
    g.save()
    g.globalAlpha = (1 - matU) * 0.52
    for (let sx = 0; sx < 13; sx += 2) {
      if (Math.sin(t * 22 + sx * 1.9) > -0.1) {
        g.fillStyle = sx % 4 === 0 ? '#FFE694' : '#7CEEFF'
        g.fillRect(drawX + sx, drawY + 1, 1, 20)
      }
    }
    g.restore()
  }

  const scaleX = cssW / pxW
  const scaleY = 68 / PX_H
  cg.imageSmoothingEnabled = false
  cg.clearRect(0, 0, cssW, 68)
  cg.drawImage(cache.artCanvas, 0, 0, cssW, 68)

  const cxPx = tx * scaleX
  const cyPx = ty * scaleY

  if (m >= 0.11 && m < 0.60 && osc > 0) {
    cg.save()
    cg.globalAlpha = osc * (1 - matU) * 0.52
    drawRigidTardis(cg, SPRITE_TARDIS_GHOST_CYAN, cxPx, cyPx, 0, scaleX, scaleY)
    cg.restore()
  }

  if (tardisAlpha > 0.01) {
    cg.save()
    cg.globalAlpha = tardisAlpha
    drawRigidTardis(cg, SPRITE_TARDIS_UPRIGHT, cxPx, cyPx, 0, scaleX, scaleY)
    cg.restore()
  }

  if (m >= 0.11) {
    const solidFlare = m >= 0.55 && m < 0.66 ? 1.0 : 0
    const beacon = Math.max(solidFlare, m < 0.62 ? Math.max(0.35, osc) * tardisAlpha : 0.68)
    cg.save()
    cg.scale(scaleX, scaleY)
    const lx = Math.round(tx)
    const ly = Math.round(ty - 10.5)
    cg.globalAlpha = clampNum(beacon, 0.25, 1)
    cg.fillStyle = '#FFFFFF'
    cg.fillRect(lx, ly, 1, 1)
    if (solidFlare > 0.5 || (m < 0.62 && osc > 0.35)) {
      cg.fillStyle = '#96E8FF'
      const arm = solidFlare > 0.5 ? 2 : 1
      cg.fillRect(lx - arm, ly, arm * 2 + 1, 1)
      cg.fillRect(lx, ly - arm, 1, arm * 2 + 1)
    }
    cg.restore()
  }

  if (m >= 0.60) {
    const doorOpen = smoothstep(0.60, 0.69, m) * (1 - smoothstep(0.88, 0.96, m))
    cg.save()
    cg.scale(scaleX, scaleY)
    cg.imageSmoothingEnabled = false

    if (doorOpen > 0.04) {
      drawTardisOpenDoor(cg, drawX, drawY, doorOpen, Math.min(PX_H - 2, drawY + 21))
    }

    if (m >= 0.66) {
      const docY = drawY + 5
      let docX = drawX + 12
      let docSprite = SPRITE_DOCTOR_10
      let clipDoor = false
      if (m < 0.91) {
        const exitProg = smoothstep(0.66, 0.91, m)
        docX = Math.round(lerpNum(drawX + 6, drawX + 13, exitProg))
        docSprite = WALK_CYCLE_R[Math.floor(exitProg * 7) % 4]
        clipDoor = exitProg < 0.55
      } else {
        const settleProg = smoothstep(0.91, 1.0, m)
        docX = Math.round(lerpNum(drawX + 13, drawX + 12, settleProg))
      }
      cg.save()
      if (clipDoor) {
        cg.beginPath()
        cg.rect(drawX + 7, drawY - 1, pxW - (drawX + 7), 24)
        cg.clip()
      }
      cg.drawImage(docSprite, docX, docY)
      cg.restore()
    }
    cg.restore()
  }

  if (m < 0.11) {
    const cutFlash = 1 - m / 0.11
    cg.save()
    cg.scale(scaleX, scaleY)
    drawWarpFlashOverlay(cg, pxW, tx, cutFlash * 0.85)
    cg.restore()
  }

  blitCompToDisplay(displayCanvas, cache.compCanvas, cssW)
}

function renderApproachEarthScene(displayCanvas, state, cache, cssW, pxW) {
  const a = clampNum(state.cutscene.progress, 0, 1)
  const s = smoothstep(0.0, 1.0, a)
  const t = state.t
  const reduced = state.reducedMotion
  const g = cache.artCanvas.getContext('2d')
  const cg = cache.compCanvas.getContext('2d')
  if (!g || !cg) return
  g.imageSmoothingEnabled = false

  const maxVisualP = state.maxVisualP !== undefined ? state.maxVisualP : 1
  const tx = pxW * lerpNum(
    getTardisTrackNorm(VISUAL_STOPS[2], maxVisualP),
    getTardisTrackNorm(VISUAL_STOPS[1], maxVisualP),
    smoothstep(0.08, 0.96, a)
  )
  let ty = lerpNum(16.5, 13.8, s)
  if (!reduced) {
    ty += Math.sin(t * 3.0) * lerpNum(0.55, 1.0, s)
  }
  const angleDeg = lerpNum(32, 14, s) + (!reduced ? Math.sin(t * 2.0) * lerpNum(1.2, 2.2, s) : 0)
  const angleRad = (angleDeg * Math.PI) / 180

  g.fillStyle = '#050A18'
  g.fillRect(0, 0, pxW, PX_H)

  const spaceAlpha = 1 - smoothstep(0.18, 0.78, a)
  if (spaceAlpha > 0.02) {
    g.save()
    g.globalAlpha = spaceAlpha
    const slideX = -Math.round(smoothstep(0.0, 0.82, a) * pxW * 0.42)
    g.drawImage(cache.spaceBg, slideX, 0)
    g.restore()
  }

  const starSpeed = lerpNum(42, 0, smoothstep(0.0, 0.88, a))
  for (let i = 0; i < STARS.length; i++) {
    const st = STARS[i]
    const travel = reduced ? 0 : t * starSpeed * st.z
    const sx = Math.floor((((st.x * pxW - travel) % pxW + pxW) % pxW))
    const sy = Math.round(st.y * (PX_H - 2))
    const tw = reduced ? 0.78 : 0.48 + 0.52 * Math.sin(t * 2.6 + st.ph)
    g.globalAlpha = tw
    g.fillStyle = st.col
    g.fillRect(sx, sy, !reduced && starSpeed > 18 && st.z > 1.05 ? 2 : 1, 1)
  }
  g.globalAlpha = 1

  const earthR0 = Math.max(130, pxW * 1.15)
  const r = 4.5 * Math.pow(earthR0 / 4.5, s)
  const topY = lerpNum(22.0, PX_H - 13, s)
  const cx = lerpNum(pxW * 1.08, pxW * 0.50, Math.pow(s, 0.82))
  drawDynamicEarth(g, pxW, cx, topY, r, earthR0, t, reduced)

  if (s > 0.76) {
    g.save()
    g.globalAlpha = smoothstep(0.76, 1.0, s) * 0.85
    for (let i = 0; i < ORBIT_CLOUDS.length; i++) {
      const cl = ORBIT_CLOUDS[i]
      const drift = reduced ? 0 : t * cl.sp * 4.5
      const clx = Math.floor(((cl.x * pxW + drift) % (pxW + 16)) - 8)
      const cly = Math.round(cl.y * PX_H)
      if (cly < PX_H - 1) {
        g.fillStyle = '#FFFFFF'
        g.fillRect(clx, cly, cl.w, 1)
        g.fillStyle = '#C9E7FF'
        g.fillRect(clx + 1, cly + 1, Math.max(2, cl.w - 3), 1)
      }
    }
    g.restore()
  }

  const speedIntensity = lerpNum(0.75, 0.0, smoothstep(0.10, 0.84, a))
  drawSpeedLines(g, pxW, t, speedIntensity, false, false, reduced)

  const wakeStrength = 1 - smoothstep(0.15, 0.72, a)
  if (wakeStrength > 0.03) {
    const wakeLen = Math.round(lerpNum(28, 8, a))
    g.save()
    for (let k = 0; k < wakeLen; k++) {
      const u = k / wakeLen
      const wx = Math.round(tx - 6 - k)
      if (wx < 0) break
      const wave = reduced ? 0 : Math.sin(t * 14 - k * 0.45) * (0.9 + u * 1.4)
      g.globalAlpha = wakeStrength * (1 - u) * 0.82
      g.fillStyle = u < 0.42 ? '#8AF4FF' : '#3C88FF'
      const yMid = Math.round(ty + wave)
      if (yMid >= 0 && yMid < PX_H) g.fillRect(wx, yMid, 1, 1)
    }
    g.restore()
  }

  const scaleX = cssW / pxW
  const scaleY = 68 / PX_H
  cg.imageSmoothingEnabled = false
  cg.clearRect(0, 0, cssW, 68)
  cg.drawImage(cache.artCanvas, 0, 0, cssW, 68)

  const cxPx = tx * scaleX
  const cyPx = ty * scaleY
  const ghostMix = 1 - smoothstep(0.15, 0.72, a)
  if (ghostMix > 0.05) {
    cg.save()
    cg.globalAlpha = ghostMix * 0.22
    drawRigidTardis(cg, SPRITE_TARDIS_GHOST_CYAN, (tx - 3.5) * scaleX, cyPx, angleRad, scaleX, scaleY)
    cg.restore()
  }

  drawRigidTardis(cg, SPRITE_TARDIS_UPRIGHT, cxPx, cyPx, angleRad, scaleX, scaleY)
  drawRotatedBowArc(cg, cxPx, cyPx, angleRad, scaleX, scaleY, ghostMix, false)

  cg.save()
  cg.scale(scaleX, scaleY)
  cg.fillStyle = '#FFFFFF'
  cg.globalAlpha = 0.75
  cg.fillRect(Math.round(tx + Math.sin(angleRad) * 10.5), Math.round(ty - Math.cos(angleRad) * 10.5), 1, 1)
  drawSpeedLines(cg, pxW, t, speedIntensity, false, true, reduced)
  cg.restore()

  blitCompToDisplay(displayCanvas, cache.compCanvas, cssW)
}

function renderFlashCutScene(displayCanvas, state, cache, cssW, pxW) {
  const c = clampNum(state.cutscene.progress, 0, 1)
  const toIdx = state.cutscene.toIdx
  const inTarget = c >= 0.32
  const sceneP = inTarget ? VISUAL_STOPS[toIdx] : VISUAL_STOPS[3]
  const txOffset = inTarget ? -lerpNum(7, 0, smoothstep(0.32, 0.92, c)) : 0
  const flashAmt = inTarget
    ? Math.pow(1 - smoothstep(0.32, 0.76, c), 1.4)
    : smoothstep(0.0, 0.32, c)

  renderTardisScene(displayCanvas, {
    p: sceneP,
    t: state.t,
    hovering: state.hovering,
    reducedMotion: state.reducedMotion,
    maxVisualP: state.maxVisualP,
    txOffset,
    overrideFlash: flashAmt,
    cutscene: null
  }, { current: cache }, cssW, pxW)
}

function renderTardisScene(displayCanvas, state, cacheRef, overrideCssW, overridePxW) {
  ensureSpritesBaked()
  if (!SPRITE_TARDIS_UPRIGHT) return

  const cssW = overrideCssW ?? (displayCanvas.parentElement ? displayCanvas.parentElement.clientWidth : 330)
  if (cssW <= 0) return

  const pxW = overridePxW ?? Math.max(120, Math.round(cssW / 2))
  const cache = ensureRenderBuffers(cacheRef, cssW, pxW)

  if (state.cutscene) {
    if (state.cutscene.type === 'materialize') {
      renderMaterializeScene(displayCanvas, state, cache, cssW, pxW)
      return
    }
    if (state.cutscene.type === 'approachEarth') {
      renderApproachEarthScene(displayCanvas, state, cache, cssW, pxW)
      return
    }
    if (state.cutscene.type === 'flashCut') {
      renderFlashCutScene(displayCanvas, state, cache, cssW, pxW)
      return
    }
  }

  const g = cache.artCanvas.getContext('2d')
  const cg = cache.compCanvas.getContext('2d')
  if (!g || !cg) return
  g.imageSmoothingEnabled = false

  const p = clampNum(state.p, 0, 1)
  const t = state.t
  const reduced = state.reducedMotion

  const s1 = VISUAL_STOPS[1]
  const s2 = VISUAL_STOPS[2]
  const u01 = clampNum(p / s1, 0, 1)
  const u12 = clampNum((p - s1) / (s2 - s1), 0, 1)
  const u23 = clampNum((p - s2) / (1 - s2), 0, 1)

  const wLondon = 1 - smoothstep(0.68, 0.90, u01)
  const wCloud = Math.sin(smoothstep(0.48, 0.92, u01) * Math.PI)
  const wEarth = smoothstep(0.54, 0.86, u01) * (1 - smoothstep(0.76, 0.98, u12))
  const inVortexCut = p >= s2 && u23 >= 0.52
  const wSpace = !inVortexCut ? smoothstep(0.14, 0.72, u12) : 0
  const wVortex = inVortexCut ? 1 : 0
  const flashAmt = state.overrideFlash !== undefined
    ? state.overrideFlash
    : (p >= s2 ? Math.pow(Math.max(0, 1 - Math.abs(u23 - 0.52) / 0.24), 1.5) : 0)

  const maxVisualP = state.maxVisualP !== undefined ? state.maxVisualP : 1
  const trackX = pxW * getTardisTrackNorm(p, maxVisualP) + (state.txOffset || 0)
  let tx = trackX
  let ty = 20.5
  if (p <= s1) {
    if (u01 <= 0.46) {
      ty = 20.5
    } else {
      const up = smoothstep(0.46, 0.78, u01)
      const settle = smoothstep(0.76, 1.0, u01)
      ty = lerpNum(20.5, 12.0, up)
      ty = lerpNum(ty, 13.8, settle)
    }
  } else if (p <= s2) {
    ty = lerpNum(13.8, 16.5, smoothstep(0.08, 0.78, u12))
  } else {
    ty = 16.5
  }

  let angleDeg = 0
  if (p <= s1) {
    if (u01 > 0.46) {
      const liftAng = smoothstep(0.46, 0.96, u01) * 14
      const floatRock = !reduced ? Math.sin(t * 1.6) * 2.4 * smoothstep(0.75, 1.0, u01) : 0
      angleDeg = liftAng + floatRock
    }
  } else if (p <= s2) {
    const baseBank = lerpNum(14, 32, smoothstep(0.10, 0.85, u12))
    const floatRock = !reduced ? Math.sin(t * 1.6) * 2.4 * (1 - smoothstep(0.25, 0.75, u12)) : 0
    const cruiseSway = !reduced ? Math.sin(t * 2.6) * 1.2 * smoothstep(0.35, 0.90, u12) : 0
    angleDeg = baseBank + floatRock + cruiseSway
  } else if (!inVortexCut) {
    angleDeg = 32 + (!reduced ? Math.sin(t * 2.8) * 1.2 : 0)
  } else {
    angleDeg = 36 + (!reduced ? (Math.sin(t * 6.4) * 2.4 + Math.cos(t * 10.2) * 0.9) : 0)
  }
  const angleRad = (angleDeg * Math.PI) / 180

  if (!reduced) {
    if (p <= s1) {
      if (u01 > 0.46) {
        const hover = smoothstep(0.75, 1.0, u01)
        ty += Math.sin(t * 2.3) * 1.0 * hover
        tx += Math.cos(t * 1.4) * 0.35 * hover
      }
    } else if (p <= s2) {
      const bobMix = 1 - smoothstep(0.25, 0.75, u12)
      const glideMix = smoothstep(0.35, 0.9, u12)
      ty += Math.sin(t * 2.3) * 1.0 * bobMix + Math.sin(t * 3.2) * 0.55 * glideMix
    } else if (!inVortexCut) {
      ty += Math.sin(t * 3.6) * 0.65
    } else {
      ty += Math.sin(t * 7.2) * 0.8 + Math.sin(t * 11.8) * 0.35
      tx += Math.cos(t * 5.6) * 0.5
    }
  }

  const drawX = Math.round(tx - SPRITE_TARDIS_UPRIGHT.width / 2)
  const drawY = Math.round(ty - SPRITE_TARDIS_UPRIGHT.height / 2)

  g.fillStyle = '#050814'
  g.fillRect(0, 0, pxW, PX_H)

  const dropY = Math.round(smoothstep(0.46, 0.84, u01) * 34)
  const doorOpen = p <= s1 ? smoothstep(0.03, 0.16, u01) * (1 - smoothstep(0.34, 0.45, u01)) : 0

  if (wLondon > 0.01) {
    g.save()
    g.globalAlpha = wLondon
    drawLondonAtmosphere(g, cache, pxW, dropY, t, reduced)
    g.restore()
  }

  if (wEarth > 0.01) {
    g.save()
    g.globalAlpha = wEarth
    const earthRise = Math.round((1 - smoothstep(0.62, 1.0, u01)) * 22)
    if (u12 <= 0.01) {
      g.drawImage(cache.earthBg, 0, earthRise)
    } else {
      g.fillStyle = '#050A18'
      g.fillRect(0, 0, pxW, PX_H)
      drawRecedingEarth(g, pxW, u12, t, reduced)
    }

    for (let i = 0; i < 36; i++) {
      const s = STARS[i]
      const sx = Math.round(s.x * pxW)
      const sy = Math.round(s.y * 20)
      const tw = reduced ? 0.75 : 0.45 + 0.55 * Math.sin(t * 2.2 + s.ph)
      g.globalAlpha = wEarth * tw
      g.fillStyle = s.col
      g.fillRect(sx, sy, 1, 1)
    }

    if (u12 <= 0.16) {
      g.globalAlpha = wEarth * (1 - u12 / 0.16) * 0.85
      for (let i = 0; i < ORBIT_CLOUDS.length; i++) {
        const cl = ORBIT_CLOUDS[i]
        const drift = reduced ? 0 : t * cl.sp * 4.5
        const cx = Math.floor(((cl.x * pxW + drift) % (pxW + 16)) - 8)
        const cy = Math.round(cl.y * PX_H) + earthRise
        if (cy < PX_H - 1) {
          g.fillStyle = '#FFFFFF'
          g.fillRect(cx, cy, cl.w, 1)
          g.fillStyle = '#C9E7FF'
          g.fillRect(cx + 1, cy + 1, Math.max(2, cl.w - 3), 1)
        }
      }
    }
    g.restore()
  }

  if (wSpace > 0.01) {
    g.save()
    g.globalAlpha = wSpace
    const slideX = Math.round((1 - smoothstep(0.18, 0.92, u12)) * pxW * 0.38)
    g.drawImage(cache.spaceBg, slideX, 0)

    const warpBoost = p >= s2 ? smoothstep(0.05, 0.52, u23) * 65 : 0
    const speedMult = 12 + smoothstep(0.1, 1.0, u12) * 32 + warpBoost
    for (let i = 0; i < STARS.length; i++) {
      const s = STARS[i]
      const travel = reduced ? 0 : t * speedMult * s.z
      const sx = Math.floor((((s.x * pxW - travel) % pxW + pxW) % pxW))
      const sy = Math.round(s.y * (PX_H - 2))
      const tw = reduced ? 0.8 : 0.55 + 0.45 * Math.sin(t * 3.1 + s.ph)
      g.globalAlpha = wSpace * tw
      g.fillStyle = s.col
      const streak = !reduced ? (warpBoost > 15 ? 4 : (s.z > 1.05 ? 2 : 1)) : 1
      g.fillRect(sx, sy, streak, 1)
    }

    if (p >= s2 && u23 > 0.12 && u23 < 0.52) {
      const charge = smoothstep(0.12, 0.52, u23)
      g.globalAlpha = charge * 0.55
      g.fillStyle = '#7CEEFF'
      g.fillRect(Math.round(pxW * 0.92), 6, 3, PX_H - 12)
      g.fillStyle = '#FFFFFF'
      g.fillRect(Math.round(pxW * 0.94), 10, 2, PX_H - 20)
    }
    g.restore()
  }

  if (wVortex > 0.01) {
    renderTimeVortexLayer(cache, reduced ? 0.6 : t, wVortex)
    g.drawImage(cache.vortexCanvas, 0, 0)
  }

  if (wCloud > 0.04) {
    g.save()
    for (let i = 0; i < STRATO_CLOUDS.length; i++) {
      const cl = STRATO_CLOUDS[i]
      const fallY = ((u01 - 0.46) / 0.54) * 42 * cl.sp + cl.y * PX_H
      const cy = Math.floor(((fallY % (PX_H + 8)) + (PX_H + 8)) % (PX_H + 8)) - 4
      const cx = Math.round(cl.x * pxW - cl.w * 0.5)
      g.globalAlpha = wCloud * (i % 2 === 0 ? 0.72 : 0.46)
      g.fillStyle = i % 3 === 0 ? '#DCEEFF' : '#8EB8E8'
      g.fillRect(cx, cy, cl.w, cl.h)
      g.fillStyle = '#FFFFFF'
      g.fillRect(cx + 2, cy, Math.max(2, cl.w - 5), 1)
    }
    g.restore()
  }

  const speedIntensity = inVortexCut
    ? 1.0
    : (p >= s2 ? smoothstep(0.0, 0.5, u23) * 0.4 + 0.68 : smoothstep(0.35, 0.92, u12) * 0.75)
  drawSpeedLines(g, pxW, t, speedIntensity, inVortexCut, false, reduced)

  const wakeStrength = inVortexCut ? 1.0 : smoothstep(0.28, 0.85, u12)
  if (wakeStrength > 0.02) {
    const wakeLen = Math.round(lerpNum(16, 40, inVortexCut ? 1.0 : u12))
    g.save()
    for (let k = 0; k < wakeLen; k++) {
      const u = k / wakeLen
      const wx = Math.round(tx - 6 - k)
      if (wx < 0) break
      const wave = reduced ? 0 : Math.sin(t * 14 - k * 0.45) * (0.9 + u * 1.6)
      g.globalAlpha = wakeStrength * (1 - u) * 0.85
      const col = (k + (reduced ? 0 : Math.floor(t * 18))) % 5 === 0
        ? '#FFE07A'
        : (u < 0.42 ? '#8AF4FF' : '#3C88FF')
      const yMid = Math.round(ty + wave)
      const yTop = Math.round(ty - 6 + wave * 0.7)
      const yBot = Math.round(ty + 7 - wave * 0.7)
      g.fillStyle = col
      if (yMid >= 0 && yMid < PX_H) g.fillRect(wx, yMid, 1, 1)
      if (k % 2 === 0 && yTop >= 0 && yTop < PX_H) g.fillRect(wx, yTop, 1, 1)
      if (k % 2 === 1 && yBot >= 0 && yBot < PX_H) {
        g.fillStyle = inVortexCut ? '#FF9838' : '#7E64FF'
        g.fillRect(wx, yBot, 1, 1)
      }
    }
    g.restore()
  }

  const igniteGlow = p <= s1 ? Math.sin(smoothstep(0.38, 0.58, u01) * Math.PI) : 0
  if (igniteGlow > 0.05 && !reduced) {
    g.save()
    g.globalAlpha = igniteGlow * 0.75
    for (let sx = -5; sx <= 5; sx += 2) {
      const sy = Math.round(drawY + 21 + ((t * 16 + Math.abs(sx)) % 4))
      if (sy < PX_H) {
        g.fillStyle = sx % 4 === 0 ? '#FFE694' : '#7CEEFF'
        g.fillRect(Math.round(tx + sx), sy, 1, 2)
      }
    }
    g.restore()
  }

  if (wLondon > 0.2) {
    g.save()
    g.globalAlpha = wLondon * 0.26
    g.fillStyle = '#6AB8FF'
    g.fillRect(drawX, Math.min(PX_H - 1, drawY + 22), 13, 1)
    g.restore()
  }

  const scaleX = cssW / pxW
  const scaleY = 68 / PX_H
  cg.imageSmoothingEnabled = false
  cg.clearRect(0, 0, cssW, 68)
  cg.drawImage(cache.artCanvas, 0, 0, cssW, 68)

  const cxPx = tx * scaleX
  const cyPx = ty * scaleY

  const ghostMix = inVortexCut ? 1.0 : smoothstep(0.45, 0.95, u12)
  if (ghostMix > 0.05) {
    cg.save()
    cg.globalAlpha = ghostMix * (inVortexCut ? 0.30 : 0.22)
    drawRigidTardis(cg, SPRITE_TARDIS_GHOST_CYAN, (tx - 3.5) * scaleX, cyPx, angleRad, scaleX, scaleY)
    if (inVortexCut) {
      cg.globalAlpha = 0.18
      drawRigidTardis(cg, SPRITE_TARDIS_GHOST_AMBER, (tx - 7.0) * scaleX, cyPx, angleRad, scaleX, scaleY)
    }
    cg.restore()
  }

  drawRigidTardis(cg, SPRITE_TARDIS_UPRIGHT, cxPx, cyPx, angleRad, scaleX, scaleY)

  if (doorOpen > 0.04 || (wLondon > 0.01 && u01 < 0.37)) {
    cg.save()
    cg.scale(scaleX, scaleY)
    cg.imageSmoothingEnabled = false

    if (doorOpen > 0.04) {
      drawTardisOpenDoor(cg, drawX, drawY, doorOpen, Math.min(PX_H - 2, drawY + 21))
    }

    if (wLondon > 0.01 && u01 < 0.37) {
      const walkProg = smoothstep(0.02, 0.36, u01)
      const docY = drawY + 5
      let docSprite = SPRITE_DOCTOR_10
      let docX = drawX + 12
      if (walkProg > 0.01) {
        const stepOut = smoothstep(0.0, 0.28, walkProg)
        const stepIn = smoothstep(0.28, 1.0, walkProg)
        docX = Math.round(lerpNum(drawX + 12, drawX + 13, stepOut) - stepIn * 9)
        docSprite = WALK_CYCLE_L[Math.floor(walkProg * 9) % 4]
      }

      cg.save()
      cg.globalAlpha = wLondon * (1 - smoothstep(0.28, 0.36, u01))
      if (walkProg > 0.36) {
        cg.beginPath()
        cg.rect(drawX + 7, drawY - 1, pxW - (drawX + 7), 24)
        cg.clip()
      }
      cg.drawImage(docSprite, docX, docY)

      if (!reduced && walkProg <= 0.02) {
        if (Math.sin(t * 2.8) > 0.45) pxRect(cg, docX + 1, docY + 11, 1, 2, '#B07B45')
        if (Math.sin(t * 1.1) > 0.96) pxRect(cg, docX + 4, docY + 2, 1, 1, '#F3C59F')
        if (state.hovering) {
          const sonicAlpha = 0.4 + 0.45 * Math.sin(t * 6.0)
          cg.fillStyle = `rgba(92, 238, 255, ${sonicAlpha.toFixed(2)})`
          cg.fillRect(docX + 5, docY + 8, 1, 1)
        }
      }
      cg.restore()
    }
    cg.restore()
  }

  drawRotatedBowArc(cg, cxPx, cyPx, angleRad, scaleX, scaleY, ghostMix, inVortexCut)

  const lampArtX = tx + Math.sin(angleRad) * 10.5
  const lampArtY = ty - Math.cos(angleRad) * 10.5
  const pulse = reduced ? 0.75 : 0.45 + 0.55 * Math.sin(t * (inVortexCut ? 9.5 : 3.6))
  const beaconBoost = Math.max(pulse, igniteGlow)
  if (beaconBoost > 0.35) {
    cg.save()
    cg.scale(scaleX, scaleY)
    const lx = Math.round(lampArtX)
    const ly = Math.round(lampArtY)
    cg.globalAlpha = clampNum(beaconBoost * (0.48 + p * 0.52), 0.3, 1)
    cg.fillStyle = '#FFFFFF'
    cg.fillRect(lx, ly, 1, 1)
    if (inVortexCut || igniteGlow > 0.35 || beaconBoost > 0.78) {
      cg.fillStyle = inVortexCut ? '#FFF3B0' : '#96E8FF'
      const arm = (inVortexCut && beaconBoost > 0.7) || igniteGlow > 0.5 ? 2 : 1
      cg.fillRect(lx - arm, ly, arm * 2 + 1, 1)
      cg.fillRect(lx, ly - arm, 1, arm * 2 + 1)
    }
    cg.restore()
  }

  cg.save()
  cg.scale(scaleX, scaleY)
  drawSpeedLines(cg, pxW, t, speedIntensity, inVortexCut, true, reduced)
  drawWarpFlashOverlay(cg, pxW, tx, reduced ? Math.min(0.25, flashAmt) : flashAmt)
  cg.restore()

  blitCompToDisplay(displayCanvas, cache.compCanvas, cssW)
}

class TardisAudioSynth {
  constructor() {
    this.muted = true
    this.ctx = null
  }

  setMuted(flag) {
    this.muted = Boolean(flag)
    if (!this.muted) {
      this._ensureCtx()
    }
  }

  _ensureCtx() {
    if (typeof window === 'undefined') return null
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    if (!this.ctx) {
      try {
        this.ctx = new AC()
      } catch {
        return null
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {})
    }
    return this.ctx
  }

  playMaterialize() {
    if (this.muted) return
    const ctx = this._ensureCtx()
    if (!ctx) return

    const now = ctx.currentTime
    const dur = 1.35

    const master = ctx.createGain()
    master.gain.setValueAtTime(0.0001, now)
    master.gain.linearRampToValueAtTime(0.11, now + 0.06)
    master.gain.setValueAtTime(0.10, now + 1.12)
    master.gain.exponentialRampToValueAtTime(0.0001, now + dur)
    master.connect(ctx.destination)

    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.Q.setValueAtTime(4.6, now)
    filter.connect(master)

    const osc1 = ctx.createOscillator()
    const osc2 = ctx.createOscillator()
    osc1.type = 'sawtooth'
    osc2.type = 'triangle'
    osc1.frequency.setValueAtTime(76, now)
    osc1.frequency.exponentialRampToValueAtTime(58, now + dur)
    osc2.frequency.setValueAtTime(76 * 1.498, now)
    osc2.frequency.exponentialRampToValueAtTime(58 * 1.498, now + dur)

    const step = 0.40
    for (let i = 0; i < 3; i++) {
      const s = now + i * step
      const peak = 820 - i * 90
      filter.frequency.setValueAtTime(160, s)
      filter.frequency.exponentialRampToValueAtTime(peak, s + step * 0.45)
      filter.frequency.exponentialRampToValueAtTime(175, s + step * 0.95)
    }

    osc1.connect(filter)
    osc2.connect(filter)
    osc1.start(now)
    osc2.start(now)
    osc1.stop(now + dur + 0.02)
    osc2.stop(now + dur + 0.02)

    const thump = ctx.createOscillator()
    const thumpGain = ctx.createGain()
    thump.type = 'sine'
    thump.frequency.setValueAtTime(110, now + 1.20)
    thump.frequency.exponentialRampToValueAtTime(44, now + 1.35)
    thumpGain.gain.setValueAtTime(0.0001, now + 1.20)
    thumpGain.gain.linearRampToValueAtTime(0.08, now + 1.22)
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.36)
    thump.connect(thumpGain)
    thumpGain.connect(ctx.destination)
    thump.start(now + 1.20)
    thump.stop(now + 1.37)
  }

  playVworp(fromIdx, toIdx) {
    if (this.muted) return
    if (toIdx === 0 && fromIdx > 0) {
      this.playMaterialize()
      return
    }
    const ctx = this._ensureCtx()
    if (!ctx) return

    const now = ctx.currentTime
    const pulses = toIdx === 3 ? 2 : 1
    const baseDur = toIdx === 3 ? 0.68 : 0.44

    const master = ctx.createGain()
    master.gain.setValueAtTime(0.0001, now)
    master.gain.linearRampToValueAtTime(0.11, now + 0.04)
    master.gain.exponentialRampToValueAtTime(0.0001, now + baseDur)
    master.connect(ctx.destination)

    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.Q.setValueAtTime(4.2, now)
    filter.connect(master)

    const osc1 = ctx.createOscillator()
    const osc2 = ctx.createOscillator()
    osc1.type = 'sawtooth'
    osc2.type = 'triangle'

    const baseFreq = 64 + toIdx * 12
    osc1.frequency.setValueAtTime(baseFreq, now)
    osc2.frequency.setValueAtTime(baseFreq * 1.498, now)

    const step = baseDur / pulses
    for (let i = 0; i < pulses; i++) {
      const s = now + i * step
      filter.frequency.setValueAtTime(170, s)
      filter.frequency.exponentialRampToValueAtTime(760 + toIdx * 180, s + step * 0.48)
      filter.frequency.exponentialRampToValueAtTime(190, s + step * 0.96)
    }

    osc1.connect(filter)
    osc2.connect(filter)
    osc1.start(now)
    osc2.start(now)
    osc1.stop(now + baseDur + 0.02)
    osc2.stop(now + baseDur + 0.02)
  }
}

const tardisAudio = new TardisAudioSynth()

function createTardisEffortSlider(hostEl, opts = {}) {
  const {
    levels: optLevels,
    hasUltraHigh: optHasUltraHigh,
    stageMap: optStageMap,
    initialIndex: optInitialIndex = 1,
    disabled: optDisabled = false,
    showStops = true,
    compactCaption = false,
    audio = null,
    onChange = null,
    onCommit = null,
    onStateChange = null
  } = opts

  let profile = buildEngineProfileState({
    levels: optLevels,
    hasUltraHigh: optHasUltraHigh,
    stageMap: optStageMap
  })
  let isDisabled = Boolean(optDisabled)
  const initialIndex = clampNum(optInitialIndex, 0, profile.levels.length - 1)

  const root = document.createElement('div')
  root.className = isDisabled ? 'tardis-slider-root tardis-slider-disabled' : 'tardis-slider-root'

  const wrap = document.createElement('div')
  wrap.className = 'tardis-capsule-wrap'
  wrap.tabIndex = 0
  wrap.setAttribute('role', 'slider')
  wrap.setAttribute('aria-label', 'Thinking effort TARDIS 滑块')
  wrap.setAttribute('aria-valuemin', '0')

  const canvas = document.createElement('canvas')
  canvas.className = 'tardis-canvas'

  const vignette = document.createElement('div')
  vignette.className = 'tardis-capsule-vignette'

  wrap.append(canvas, vignette)

  const stopsBar = document.createElement('div')
  stopsBar.className = 'tardis-stops'
  stopsBar.setAttribute('role', 'radiogroup')
  stopsBar.setAttribute('aria-label', '推理强度档位')

  let stopButtons = []

  const cacheRef = { current: null }
  const mqReduced = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false }

  const initialP = profile.visualPs[initialIndex] ?? 0
  const state = {
    index: initialIndex,
    curP: initialP,
    targetP: initialP,
    tween: null,
    cutscene: null,
    t: 0,
    dragging: false,
    hovering: false,
    visible: true,
    sleeping: false,
    rafId: 0,
    lastTs: 0,
    idleTimer: 0,
    lastTrackU: profile.levels.length > 1 ? initialIndex / (profile.levels.length - 1) : 0,
    dragStartIdx: initialIndex,
    dragStartStage: profile.stageMap[initialIndex] ?? 0,
    dragStartDisabled: isDisabled
  }

  function rebuildStopsBar() {
    stopsBar.innerHTML = ''
    stopsBar.style.setProperty('--stop-count', String(profile.levels.length))
    wrap.setAttribute('aria-valuemax', String(profile.levels.length - 1))
    stopButtons = profile.levels.map((label, idx) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'tardis-stop-btn'
      btn.textContent = label
      btn.setAttribute('role', 'radio')
      btn.setAttribute('aria-checked', String(!isDisabled && idx === state.index))
      btn.addEventListener('click', () => {
        setLevel(idx, true, true)
      })
      stopsBar.appendChild(btn)
      return btn
    })
  }

  root.append(wrap)
  if (showStops) {
    root.append(stopsBar)
  }

  hostEl.innerHTML = ''
  hostEl.appendChild(root)

  rebuildStopsBar()

  function buildChangeDetail(idx) {
    const stage = profile.stageMap[idx] ?? 0
    return {
      index: idx,
      label: profile.levels[idx] ?? '',
      visualStage: stage,
      visualLabel: CANONICAL_STAGE_NAMES[stage],
      stageTag: STAGE_TAGS[stage],
      beat: BEATS[stage],
      profile
    }
  }

  function updateCaptionUI(idx) {
    const stage = profile.stageMap[idx] ?? 0
    const label = profile.levels[idx] ?? ''
    root.style.setProperty('--slider-accent', isDisabled ? '#7A8599' : ACCENTS[stage])
    root.className = isDisabled ? 'tardis-slider-root tardis-slider-disabled' : 'tardis-slider-root'
    wrap.setAttribute('aria-valuenow', String(idx))
    wrap.setAttribute('aria-valuetext', isDisabled ? '关闭' : `${label} · ${BEATS[stage]}`)
    stopButtons.forEach((b, i) => b.setAttribute('aria-checked', String(!isDisabled && i === idx)))
  }

  function getActiveFlashAmt() {
    if (state.cutscene) {
      if (state.cutscene.type === 'materialize') {
        const m = state.cutscene.progress
        return m < 0.11 ? (1 - m / 0.11) * 0.85 : 0
      }
      if (state.cutscene.type === 'flashCut') {
        const c = state.cutscene.progress
        return c >= 0.32 ? Math.pow(1 - smoothstep(0.32, 0.76, c), 1.4) : smoothstep(0.0, 0.32, c)
      }
      return 0
    }
    if (profile.maxVisualStage >= 3 && state.curP >= VISUAL_STOPS[2]) {
      const u23 = clampNum((state.curP - VISUAL_STOPS[2]) / (1 - VISUAL_STOPS[2]), 0, 1)
      return Math.pow(Math.max(0, 1 - Math.abs(u23 - 0.52) / 0.24), 1.5)
    }
    return 0
  }

  function updateCapsuleFlash() {
    const flashAmt = getActiveFlashAmt()
    if (flashAmt > 0.04 && !mqReduced.matches) {
      wrap.style.boxShadow = `0 0 ${Math.round(flashAmt * 22)}px rgba(155, 240, 255, ${(flashAmt * 0.65).toFixed(2)}), inset 0 1px 0 rgba(255,255,255,0.28)`
    } else if (wrap.style.boxShadow) {
      wrap.style.boxShadow = ''
    }
  }

  function computeTweenDuration(fromP, toP) {
    const lo = Math.min(fromP, toP)
    const hi = Math.max(fromP, toP)
    if (hi - lo < 0.002) return 0
    let ms = 0
    if (lo < 0.18 && hi > 0.18) ms += 1250
    if (lo < 0.50 && hi > 0.50) ms += 860
    if (lo < 0.84 && hi > 0.84) ms += 620
    return clampNum(ms || 420, 260, 1750)
  }

  function startTweenTo(targetP, animate) {
    state.targetP = targetP
    if (!animate || mqReduced.matches) {
      state.tween = null
      state.curP = targetP
      return
    }
    const duration = computeTweenDuration(state.curP, targetP)
    if (duration <= 0) {
      state.tween = null
      state.curP = targetP
      return
    }
    state.tween = {
      fromP: state.curP,
      toP: targetP,
      startTs: performance.now(),
      duration
    }
  }

  function nearestIndexFromTrackU(trackU) {
    const n = profile.levels.length
    if (n <= 1) return 0
    return clampNum(Math.round(trackU * (n - 1)), 0, n - 1)
  }

  function notifyEngineState() {
    if (typeof onStateChange === 'function') {
      onStateChange({ sleeping: state.sleeping, visible: state.visible })
    }
  }

  function clearIdleTimer() {
    if (state.idleTimer) {
      clearTimeout(state.idleTimer)
      state.idleTimer = 0
    }
  }

  function scheduleIdleSleep() {
    clearIdleTimer()
    if (state.dragging || state.hovering || !state.visible || state.tween || state.cutscene) return
    if (Math.abs(state.curP - state.targetP) > 0.002) return
    state.idleTimer = window.setTimeout(() => {
      state.idleTimer = 0
      sleep()
    }, 2000)
  }

  function renderFrame() {
    renderTardisScene(canvas, {
      p: state.curP,
      t: state.t,
      hovering: state.hovering,
      reducedMotion: mqReduced.matches,
      maxVisualP: profile.maxVisualP,
      cutscene: state.cutscene
    }, cacheRef)
    updateCapsuleFlash()
  }

  function tick(ts) {
    if (!state.visible || state.sleeping) {
      state.rafId = 0
      return
    }
    if (!state.lastTs) state.lastTs = ts
    const dt = Math.min(0.05, (ts - state.lastTs) / 1000)
    state.lastTs = ts
    state.t += dt

    if (!state.dragging && state.cutscene) {
      const prog = clampNum((ts - state.cutscene.startTs) / state.cutscene.duration, 0, 1)
      state.cutscene.progress = prog
      if (prog >= 1) {
        state.cutscene = null
        state.curP = state.targetP
        if (!state.hovering) scheduleIdleSleep()
      }
    } else if (!state.dragging && state.tween) {
      const raw = clampNum((ts - state.tween.startTs) / state.tween.duration, 0, 1)
      const eased = raw < 0.5 ? 4 * raw * raw * raw : 1 - Math.pow(-2 * raw + 2, 3) / 2
      state.curP = lerpNum(state.tween.fromP, state.tween.toP, eased)
      if (raw >= 1) {
        state.curP = state.tween.toP
        state.tween = null
        if (!state.hovering) scheduleIdleSleep()
      }
    } else if (!state.dragging) {
      const diff = state.targetP - state.curP
      if (mqReduced.matches || Math.abs(diff) < 0.0012) {
        state.curP = state.targetP
        if (!state.idleTimer && !state.hovering) scheduleIdleSleep()
      } else {
        state.curP += diff * (1 - Math.exp(-13 * dt))
      }
    }

    renderFrame()
    state.rafId = requestAnimationFrame(tick)
  }

  function wake() {
    clearIdleTimer()
    if (!state.visible) return
    const wasSleeping = state.sleeping
    state.sleeping = false
    state.lastTs = 0
    if (!state.rafId && typeof requestAnimationFrame === 'function') {
      state.rafId = requestAnimationFrame(tick)
    }
    if (!state.hovering && !state.dragging && !state.tween && !state.cutscene && Math.abs(state.curP - state.targetP) < 0.002) {
      scheduleIdleSleep()
    }
    if (wasSleeping) notifyEngineState()
  }

  function sleep() {
    clearIdleTimer()
    if (state.rafId && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(state.rafId)
      state.rafId = 0
    }
    const changed = !state.sleeping
    state.sleeping = true
    renderFrame()
    if (changed) notifyEngineState()
  }

  function setLevel(idx, animate = true, emit = false) {
    const clampedIdx = clampNum(idx, 0, profile.levels.length - 1)
    const prevIdx = state.index
    const prevStage = profile.stageMap[prevIdx] ?? 0
    const nextStage = profile.stageMap[clampedIdx] ?? 0
    const targetVisualP = profile.visualPs[clampedIdx] ?? 0
    const wasDisabled = isDisabled
    if (emit && isDisabled) {
      isDisabled = false
    }
    state.index = clampedIdx
    state.cutscene = null
    state.tween = null

    if (animate && !mqReduced.matches && nextStage < prevStage) {
      state.targetP = targetVisualP
      state.curP = targetVisualP
      if (nextStage === 0) {
        state.cutscene = { type: 'materialize', startTs: performance.now(), duration: 2350, progress: 0 }
      } else if (prevStage === 3 && (nextStage === 1 || nextStage === 2)) {
        state.cutscene = {
          type: 'flashCut',
          toIdx: nextStage,
          startTs: performance.now(),
          duration: nextStage === 1 ? 960 : 900,
          progress: 0
        }
      } else if (prevStage === 2 && nextStage === 1) {
        state.cutscene = { type: 'approachEarth', startTs: performance.now(), duration: 1450, progress: 0 }
      } else {
        startTweenTo(targetVisualP, animate)
      }
    } else {
      startTweenTo(targetVisualP, animate)
    }

    updateCaptionUI(clampedIdx)
    if (state.visible) {
      wake()
      renderFrame()
      scheduleIdleSleep()
    }
    if (emit && audio && prevIdx !== clampedIdx && prevStage !== nextStage) {
      audio.playVworp(prevStage, nextStage)
    }
    if (emit) {
      const detail = buildChangeDetail(clampedIdx)
      if (typeof onChange === 'function') onChange(clampedIdx, detail)
      if (typeof onCommit === 'function' && (wasDisabled || prevIdx !== clampedIdx)) {
        onCommit(clampedIdx, detail)
      }
    }
  }

  function setProfile(nextOpts = {}) {
    if (typeof nextOpts.disabled === 'boolean') {
      isDisabled = nextOpts.disabled
    }
    profile = buildEngineProfileState({
      levels: nextOpts.levels !== undefined ? nextOpts.levels : profile.levels,
      hasUltraHigh: nextOpts.hasUltraHigh,
      stageMap: nextOpts.stageMap
    })
    const requestedIdx = typeof nextOpts.index === 'number' ? nextOpts.index : state.index
    const nextIdx = clampNum(requestedIdx, 0, profile.levels.length - 1)
    const nextP = profile.visualPs[nextIdx] ?? 0
    state.index = nextIdx
    state.cutscene = null
    state.tween = null
    state.targetP = nextP
    state.curP = nextP
    rebuildStopsBar()
    updateCaptionUI(nextIdx)
    renderFrame()
    if (state.visible) {
      wake()
      scheduleIdleSleep()
    }
    return buildChangeDetail(nextIdx)
  }

  function setDisabled(flag) {
    const next = Boolean(flag)
    if (next === isDisabled) return
    isDisabled = next
    updateCaptionUI(state.index)
    renderFrame()
  }

  function pointerToTrackU(clientX) {
    const rect = wrap.getBoundingClientRect()
    const padLeft = rect.width * 0.13
    const span = Math.max(1, rect.width * 0.68)
    return clampNum((clientX - rect.left - padLeft) / span, 0, 1)
  }

  wrap.addEventListener('pointerenter', () => {
    state.hovering = true
    wake()
  })

  wrap.addEventListener('pointerleave', () => {
    state.hovering = false
    if (!state.dragging) scheduleIdleSleep()
  })

  wrap.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    wrap.focus()
    try {
      wrap.setPointerCapture(e.pointerId)
    } catch {
      // Ignore synthetic events in tests
    }
    state.dragging = true
    state.tween = null
    state.cutscene = null
    state.dragStartIdx = state.index
    state.dragStartStage = profile.stageMap[state.index] ?? 0
    state.dragStartDisabled = isDisabled
    wrap.classList.add('is-dragging')
    clearIdleTimer()
    const trackU = pointerToTrackU(e.clientX)
    state.lastTrackU = trackU
    state.curP = trackU * profile.maxVisualP
    const near = nearestIndexFromTrackU(trackU)
    if (near !== state.index || isDisabled) {
      isDisabled = false
      state.index = near
      updateCaptionUI(near)
      if (typeof onChange === 'function') onChange(near, buildChangeDetail(near))
    }
    wake()
    renderFrame()
  })

  wrap.addEventListener('pointermove', e => {
    if (!state.dragging) return
    const trackU = pointerToTrackU(e.clientX)
    state.lastTrackU = trackU
    state.curP = trackU * profile.maxVisualP
    const near = nearestIndexFromTrackU(trackU)
    if (near !== state.index) {
      state.index = near
      updateCaptionUI(near)
      if (typeof onChange === 'function') onChange(near, buildChangeDetail(near))
    }
    renderFrame()
  })

  function endDrag(e) {
    if (!state.dragging) return
    try {
      if (wrap.hasPointerCapture && wrap.hasPointerCapture(e.pointerId)) {
        wrap.releasePointerCapture(e.pointerId)
      }
    } catch {
      // Ignore
    }
    state.dragging = false
    wrap.classList.remove('is-dragging')
    const snapIdx = nearestIndexFromTrackU(state.lastTrackU)
    const snapStage = profile.stageMap[snapIdx] ?? 0
    isDisabled = false
    state.index = snapIdx
    startTweenTo(profile.visualPs[snapIdx] ?? 0, true)
    updateCaptionUI(snapIdx)
    if (audio && state.dragStartStage !== snapStage) {
      audio.playVworp(state.dragStartStage, snapStage)
    }
    const detail = buildChangeDetail(snapIdx)
    if (typeof onChange === 'function' && (state.dragStartIdx !== snapIdx || state.dragStartStage !== snapStage)) {
      onChange(snapIdx, detail)
    }
    if (typeof onCommit === 'function' && (state.dragStartIdx !== snapIdx || state.dragStartDisabled)) {
      onCommit(snapIdx, detail)
    }
    wake()
    scheduleIdleSleep()
  }

  wrap.addEventListener('pointerup', endDrag)
  wrap.addEventListener('pointercancel', endDrag)

  wrap.addEventListener('focus', () => wake())
  wrap.addEventListener('blur', () => {
    if (!state.hovering && !state.dragging) scheduleIdleSleep()
  })

  wrap.addEventListener('keydown', e => {
    const maxIdx = profile.levels.length - 1
    let next = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(maxIdx, state.index + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(0, state.index - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = maxIdx
    if (next !== null) {
      e.preventDefault()
      setLevel(next, true, true)
    }
  })

  let ro = null
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      if (state.visible && wrap.clientWidth > 0) {
        renderFrame()
      }
    })
    ro.observe(wrap)
  }

  updateCaptionUI(initialIndex)
  renderFrame()
  wake()

  return {
    setLevel,
    setProfile,
    setDisabled,
    getProfile: () => ({ ...profile }),
    getDetail: () => buildChangeDetail(state.index),
    wake,
    sleep,
    isSleeping: () => state.sleeping,
    destroy() {
      clearIdleTimer()
      if (state.rafId && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(state.rafId)
        state.rafId = 0
      }
      if (ro) ro.disconnect()
    }
  }
}

// ============================================================================
// PART 4: REACT WIDGETS, GATEWAY SYNC & SETTINGS UI
// ============================================================================
function PixelTardisBadgeIcon({ accent, muted }) {
  const fillColor = muted ? 'currentColor' : accent || '#4AA8FF'
  return jsxs('svg', {
    width: 11,
    height: 15,
    viewBox: '0 0 11 15',
    fill: 'none',
    'aria-hidden': 'true',
    className: 'shrink-0',
    children: [
      jsx('rect', { x: 5, y: 0, width: 1, height: 1, fill: muted ? 'currentColor' : '#FFFDF0' }),
      jsx('rect', { x: 4, y: 1, width: 3, height: 1, fill: fillColor }),
      jsx('rect', { x: 2, y: 2, width: 7, height: 1, fill: fillColor }),
      jsx('rect', { x: 1, y: 3, width: 9, height: 2, fill: '#091120' }),
      jsx('rect', { x: 2, y: 3, width: 7, height: 1, fill: '#E7F0FF' }),
      jsx('rect', { x: 1, y: 5, width: 9, height: 9, fill: fillColor }),
      jsx('rect', { x: 2, y: 6, width: 2, height: 2, fill: muted ? '#1C2436' : '#FFF4B8' }),
      jsx('rect', { x: 7, y: 6, width: 2, height: 2, fill: muted ? '#1C2436' : '#FFF4B8' }),
      jsx('rect', { x: 2, y: 9, width: 2, height: 2, fill: '#F4F7FC' }),
      jsx('rect', { x: 0, y: 14, width: 11, height: 1, fill: fillColor })
    ]
  })
}

function TardisSliderCanvasMount({
  profileInfo,
  activeIndex,
  disabled,
  onCommit,
  onEngineStateChange
}) {
  const containerRef = useRef(null)
  const sliderRef = useRef(null)
  const onCommitRef = useRef(onCommit)
  const onStateRef = useRef(onEngineStateChange)
  const lastCommittedIdxRef = useRef(null)

  onCommitRef.current = onCommit
  onStateRef.current = onEngineStateChange

  const levels = useMemo(() => profileInfo.options.map(o => o.label), [profileInfo])
  const profileKey = useMemo(
    () => `${levels.join('|')}:${profileInfo.hasUltraStage ? '1' : '0'}:${profileInfo.stageMap.join(',')}`,
    [levels, profileInfo.hasUltraStage, profileInfo.stageMap]
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ctrl = createTardisEffortSlider(el, {
      levels,
      hasUltraHigh: profileInfo.hasUltraStage,
      stageMap: profileInfo.stageMap,
      initialIndex: activeIndex,
      disabled,
      showStops: true,
      compactCaption: false,
      audio: tardisAudio,
      onCommit: (idx, detail) => {
        lastCommittedIdxRef.current = idx
        onCommitRef.current?.(idx, detail)
      },
      onStateChange: st => {
        onStateRef.current?.(st)
      }
    })
    sliderRef.current = ctrl
    onStateRef.current?.({ sleeping: ctrl.isSleeping(), visible: true })

    return () => {
      sliderRef.current = null
      ctrl.destroy()
      if (el) el.innerHTML = ''
    }
  }, [profileKey])

  useEffect(() => {
    const ctrl = sliderRef.current
    if (!ctrl) return
    ctrl.setDisabled(disabled)
  }, [disabled])

  useEffect(() => {
    const ctrl = sliderRef.current
    if (!ctrl) return
    if (lastCommittedIdxRef.current === activeIndex && !disabled) {
      lastCommittedIdxRef.current = null
      return
    }
    lastCommittedIdxRef.current = null
    if (ctrl.getDetail().index !== activeIndex) {
      ctrl.setLevel(activeIndex, true, false)
    }
  }, [activeIndex, disabled])

  return jsx('div', {
    ref: containerRef,
    className: 'w-full'
  })
}

function TardisComposerControl({ ctx }) {
  const gatewayState = useValue(host.state.gateway)
  const profile = useValue(host.state.profile)
  const focusedSessionId = useValue(host.state.focusedSessionId)
  const focusedStoredSessionId = useValue(host.state.focusedStoredSessionId)
  const activeSessionId = useValue(host.state.activeSessionId)
  const focusedSessionOwner = useValue(host.state.focusedSessionOwner)
  const hostModel = useValue(host.state.model)
  const prefs = useValue($prefs)
  const liveMap = useValue($liveSessionInfo)
  const qc = useQueryClient()

  // Note: when focusedStoredSessionId is set on a tile that has not hydrated a runtime yet,
  // focusedSessionId is intentionally null; otherwise on primary chat use focusedSessionId || activeSessionId.
  const sessionId = focusedSessionId || (!focusedStoredSessionId ? activeSessionId : null) || null
  const sessionKey = sessionId || '__primary__'

  const [open, setOpen] = useState(false)
  const [sleeping, setSleeping] = useState(false)
  const [optimistic, setOptimistic] = useState(null)
  const lastActiveEffortRef = useRef(DEFAULT_REASONING_EFFORT || 'medium')

  const ownerRoute = useMemo(() => {
    if (
      focusedSessionOwner?.connectionId &&
      focusedSessionOwner?.profile &&
      (focusedSessionOwner.profile !== (profile || 'default') ||
        (focusedSessionOwner.connectionId !== 'local' && focusedSessionOwner.connectionId !== host.state.connectionId?.get?.()))
    ) {
      return focusedSessionOwner
    }
    return null
  }, [focusedSessionOwner, profile])

  const requestRpc = useCallback(
    (method, params = {}) => {
      if (ownerRoute && typeof host.requestProfile === 'function') {
        return host.requestProfile(ownerRoute, method, params)
      }
      return host.request(method, params)
    },
    [ownerRoute]
  )

  const modelOptionsQuery = useQuery({
    queryKey: [PLUGIN_ID, 'model-options', profile || 'default', sessionId || 'draft', ownerRoute?.connectionId || ''],
    enabled: gatewayState === 'open',
    staleTime: 30_000,
    queryFn: () =>
      requestRpc('model.options', {
        explicit_only: true,
        ...(sessionId ? { session_id: sessionId } : {})
      })
  })

  const activeProvider = useMemo(() => {
    const live = liveMap[sessionKey]
    if (live?.provider) return String(live.provider)
    if (modelOptionsQuery.data?.provider) return String(modelOptionsQuery.data.provider)
    return ''
  }, [liveMap, sessionKey, modelOptionsQuery.data])

  const activeModel = useMemo(() => {
    const live = liveMap[sessionKey]
    if (live?.model) return String(live.model)
    if (hostModel) return String(hostModel)
    if (modelOptionsQuery.data?.model) return String(modelOptionsQuery.data.model)
    return ''
  }, [liveMap, sessionKey, hostModel, modelOptionsQuery.data])

  const catalogInfo = useMemo(
    () => findModelCatalogInfo(modelOptionsQuery.data, activeProvider, activeModel),
    [modelOptionsQuery.data, activeProvider, activeModel]
  )

  const daybreakSupported = Boolean(catalogInfo.caps?.daybreak)

  const effortConfigQuery = useQuery({
    queryKey: [
      PLUGIN_ID,
      'effort-state',
      profile || 'default',
      sessionId || 'draft',
      activeModel,
      daybreakSupported ? 'db1' : 'db0'
    ],
    enabled: gatewayState === 'open',
    staleTime: 15_000,
    queryFn: async () => {
      const reqs = [
        requestRpc('config.get', { key: 'reasoning', ...(sessionId ? { session_id: sessionId } : {}) }),
        requestRpc('config.get', { key: 'fast', ...(sessionId ? { session_id: sessionId } : {}) })
      ]
      if (daybreakSupported) {
        reqs.push(requestRpc('config.get', { key: 'daybreak', profile: ownerRoute?.profile || profile || 'default' }).catch(() => null))
      }
      const [reasoningRes, fastRes, daybreakRes] = await Promise.all(reqs)
      return {
        reasoning: String(reasoningRes?.value ?? ''),
        fast: String(fastRes?.value ?? 'normal'),
        daybreak: daybreakRes ? daybreakRes.value === true : undefined
      }
    }
  })

  // Clear local optimistic overrides when session or model changes
  useEffect(() => {
    setOptimistic(null)
  }, [sessionId, activeModel])

  // Clear draftOverride if user switched into a pre-existing session without submitting
  useEffect(() => {
    if (sessionId && Date.now() - draftSubmittingAt > 12_000) {
      draftOverride = null
    }
  }, [sessionId])

  if (gatewayState !== 'open') {
    return null
  }

  if (catalogInfo.caps?.reasoning === false) {
    return null
  }

  const liveInfo = liveMap[sessionKey] || null
  const cfgData = effortConfigQuery.data || null

  const serverEffort =
    (typeof liveInfo?.reasoning_effort === 'string' && liveInfo.reasoning_effort) ||
    cfgData?.reasoning ||
    (!sessionId && draftOverride?.reasoning) ||
    DEFAULT_REASONING_EFFORT ||
    'medium'

  const effectiveEffort = optimistic?.reasoning ?? serverEffort
  const effectiveWire = optimistic?.reasoning ? '' : String(liveInfo?.reasoning_effort_wire || '')

  const thinkingOn = normalizeStr(effectiveEffort) !== 'none'
  if (thinkingOn && effectiveEffort) {
    lastActiveEffortRef.current = effectiveEffort
  }

  const serverFastWord =
    optimistic?.fast ??
    (liveInfo?.service_tier === 'ultrafast' || cfgData?.fast === 'ultrafast'
      ? 'ultrafast'
      : liveInfo?.fast === true || liveInfo?.service_tier === 'priority' || cfgData?.fast === 'fast'
        ? 'fast'
        : 'normal')

  const daybreakOn = optimistic?.daybreak ?? cfgData?.daybreak ?? false

  const profileInfo = resolveTardisEffortProfile(
    catalogInfo.matchedProvider || activeProvider,
    activeModel,
    effectiveWire
  )
  const activeIdx = resolveTardisOptionIndex(profileInfo, thinkingOn ? effectiveEffort : lastActiveEffortRef.current)
  const visualStage = profileInfo.stageMap[activeIdx] ?? 0
  const pillAccent = ACCENTS[visualStage] || '#4AA8FF'

  const pillLabel = thinkingOn
    ? reasoningEffortLabel(effectiveEffort, effectiveWire) || profileInfo.options[activeIdx]?.shortLabel || 'Med'
    : 'Off'

  const fastControl = resolveFastControl(
    activeModel,
    catalogInfo.providerModels,
    Boolean(catalogInfo.caps?.fast),
    serverFastWord !== 'normal'
  )
  const ultrafastSupported = Boolean(catalogInfo.caps?.ultrafast)
  const showThinkingToggle = catalogInfo.caps?.can_disable_reasoning !== false
  const showFastToggle = fastControl.kind !== 'none'

  const commitReasoning = async nextValue => {
    const val = normalizeStr(nextValue)
    haptic('selection')
    setOptimistic(prev => ({ ...(prev || {}), reasoning: val }))
    if (val !== 'none') {
      lastActiveEffortRef.current = val
    }

    if (!sessionId) {
      draftOverride = { ...(draftOverride || {}), reasoning: val }
      try {
        window.localStorage?.setItem('hermes.desktop.composer.reasoning-effort', val)
      } catch {
        // Ignore storage errors
      }
    }

    try {
      const res = await requestRpc('config.set', {
        key: 'reasoning',
        value: val,
        ...(sessionId ? { session_id: sessionId } : {})
      })
      if (res?.status === 'deferred') {
        host.notify?.({
          id: `${PLUGIN_ID}-deferred-${sessionId || 'draft'}`,
          kind: 'info',
          message: `已排入下一轮生效：${EFFORT_ZH_NAMES[val] || val}`
        })
      }
      if (sessionId) {
        const curLive = $liveSessionInfo.get()
        $liveSessionInfo.set({
          ...curLive,
          [sessionKey]: {
            ...(curLive[sessionKey] || {}),
            reasoning_effort: val,
            reasoning_effort_wire: ''
          }
        })
      }
      await qc.invalidateQueries({ queryKey: [PLUGIN_ID, 'effort-state'] })
      setOptimistic(prev => {
        if (!prev || prev.reasoning !== val) return prev
        const { reasoning: _drop, ...rest } = prev
        return Object.keys(rest).length ? rest : null
      })
    } catch (err) {
      setOptimistic(prev => {
        if (!prev) return null
        const { reasoning: _drop, ...rest } = prev
        return Object.keys(rest).length ? rest : null
      })
      host.notifyError?.(err, '更新推理强度失败')
    }
  }

  const commitFast = async targetMode => {
    haptic('selection')
    if (fastControl.kind === 'variant') {
      const targetModel = targetMode === 'normal' ? fastControl.baseId : fastControl.fastId
      setOptimistic(prev => ({ ...(prev || {}), fast: targetMode }))
      try {
        await requestRpc('config.set', {
          key: 'model',
          value: targetModel,
          ...(sessionId ? { session_id: sessionId } : {})
        })
        await qc.invalidateQueries({ queryKey: QUERY_PREFIX })
      } catch (err) {
        host.notifyError?.(err, '切换 Fast 变体模型失败')
      } finally {
        setOptimistic(prev => {
          if (!prev) return null
          const { fast: _drop, ...rest } = prev
          return Object.keys(rest).length ? rest : null
        })
      }
      return
    }

    const wireWord = targetMode === 'priority' ? 'fast' : targetMode
    setOptimistic(prev => ({ ...(prev || {}), fast: wireWord }))
    if (!sessionId) {
      draftOverride = { ...(draftOverride || {}), fast: wireWord }
    }

    try {
      await requestRpc('config.set', {
        key: 'fast',
        value: wireWord,
        ...(sessionId ? { session_id: sessionId } : {})
      })
      if (sessionId) {
        const curLive = $liveSessionInfo.get()
        $liveSessionInfo.set({
          ...curLive,
          [sessionKey]: {
            ...(curLive[sessionKey] || {}),
            fast: wireWord !== 'normal',
            service_tier: wireWord === 'ultrafast' ? 'ultrafast' : wireWord === 'fast' ? 'priority' : 'normal'
          }
        })
      }
      await qc.invalidateQueries({ queryKey: [PLUGIN_ID, 'effort-state'] })
      setOptimistic(prev => {
        if (!prev || prev.fast !== wireWord) return prev
        const { fast: _drop, ...rest } = prev
        return Object.keys(rest).length ? rest : null
      })
    } catch (err) {
      setOptimistic(prev => {
        if (!prev) return null
        const { fast: _drop, ...rest } = prev
        return Object.keys(rest).length ? rest : null
      })
      host.notifyError?.(err, '更新速度模式失败')
    }
  }

  const commitDaybreak = async nextOn => {
    haptic('selection')
    setOptimistic(prev => ({ ...(prev || {}), daybreak: nextOn }))
    try {
      await requestRpc('config.set', {
        key: 'daybreak',
        value: nextOn ? 'true' : 'false',
        profile: ownerRoute?.profile || profile || 'default'
      })
      await qc.invalidateQueries({ queryKey: [PLUGIN_ID, 'effort-state'] })
      setOptimistic(prev => {
        if (!prev || prev.daybreak !== nextOn) return prev
        const { daybreak: _drop, ...rest } = prev
        return Object.keys(rest).length ? rest : null
      })
    } catch (err) {
      setOptimistic(prev => {
        if (!prev) return null
        const { daybreak: _drop, ...rest } = prev
        return Object.keys(rest).length ? rest : null
      })
      host.notifyError?.(err, '更新 Daybreak 开关失败')
    }
  }

  const tipLabel = thinkingOn
    ? `TARDIS 推理强度: ${EFFORT_ZH_NAMES[normalizeStr(effectiveEffort)] || pillLabel}${effectiveWire && normalizeStr(effectiveWire) !== normalizeStr(effectiveEffort) ? ` (路由发送 ${EFFORT_ZH_NAMES[normalizeStr(effectiveWire)] || effectiveWire})` : ''}`
    : 'TARDIS 推理强度: 已关闭'

  const VolumeIcon = prefs.muted ? icons.VolumeX : icons.Volume2
  const SettingsIcon = icons.SlidersHorizontal
  const isClamped = Boolean(
    thinkingOn && effectiveWire && normalizeStr(effectiveWire) !== normalizeStr(effectiveEffort)
  )

  return jsxs(Popover, {
    open,
    onOpenChange: setOpen,
    children: [
      jsx(Tip, {
        label: tipLabel,
        side: 'top',
        children: jsx(PopoverTrigger, {
          asChild: true,
          children: jsxs(Button, {
            type: 'button',
            variant: 'ghost',
            'aria-label': tipLabel,
            className: 'h-(--composer-control-size) shrink-0 gap-1.5 rounded-md px-2 text-xs font-normal text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground',
            children: [
              jsx(PixelTardisBadgeIcon, { accent: pillAccent, muted: !thinkingOn }),
              jsx('span', { className: 'tabular-nums', children: pillLabel }),
              jsx(icons.ChevronDown, { className: 'size-2.5 shrink-0 opacity-50' })
            ]
          })
        })
      }),
      jsxs(PopoverContent, {
        variant: 'menu',
        side: 'top',
        align: 'end',
        sideOffset: 8,
        className: 'w-[356px] max-w-[calc(100vw-1rem)] p-0 overflow-hidden',
        children: open
          ? [
              (showThinkingToggle || showFastToggle || daybreakSupported) &&
                jsxs('div', {
                  className: 'border-b border-(--ui-stroke-tertiary) px-3 py-2 flex flex-col gap-2',
                  children: [
                    showThinkingToggle &&
                      jsxs('div', {
                        className: 'flex items-center justify-between gap-2',
                        children: [
                          jsxs('div', {
                            className: 'min-w-0',
                            children: [
                              jsx('div', {
                                className: 'text-xs font-medium text-foreground',
                                children: '思考'
                              }),
                              jsx('div', {
                                className: 'text-[10.5px] text-(--ui-text-tertiary)',
                                children: thinkingOn ? '已启用深度推理' : '已关闭（发送 none）'
                              })
                            ]
                          }),
                          jsx(Switch, {
                            size: 'xs',
                            'aria-label': '思考开关',
                            checked: thinkingOn,
                            onCheckedChange: next => {
                              const target = next
                                ? profileInfo.options[activeIdx]?.value || lastActiveEffortRef.current || 'medium'
                                : 'none'
                              void commitReasoning(target)
                            }
                          })
                        ]
                      }),
                    showFastToggle &&
                      jsxs('div', {
                        className: 'flex items-center justify-between gap-2',
                        children: [
                          jsxs('div', {
                            className: 'min-w-0',
                            children: [
                              jsx('div', {
                                className: 'text-xs font-medium text-foreground',
                                children: ultrafastSupported ? '极速模式' : '快速模式'
                              }),
                              jsx('div', {
                                className: 'text-[10.5px] text-(--ui-text-tertiary)',
                                children:
                                  fastControl.kind === 'variant'
                                    ? '切换 -fast 模型变体'
                                    : ultrafastSupported
                                      ? '优先 Ultrafast 服务通道'
                                      : '优先 Fast 响应通道'
                              })
                            ]
                          }),
                          jsx(Switch, {
                            size: 'xs',
                            'aria-label': ultrafastSupported ? '极速模式' : '快速模式',
                            checked: serverFastWord !== 'normal',
                            disabled: fastControl.canEnable === false && serverFastWord === 'normal',
                            onCheckedChange: next => {
                              const nextTier = !next ? 'normal' : ultrafastSupported ? 'ultrafast' : 'fast'
                              void commitFast(nextTier)
                            }
                          })
                        ]
                      }),
                    daybreakSupported &&
                      jsxs('div', {
                        className: 'flex items-center justify-between gap-2',
                        children: [
                          jsxs('div', {
                            className: 'min-w-0',
                            children: [
                              jsx('div', {
                                className: 'text-xs font-medium text-foreground',
                                children: 'Daybreak'
                              }),
                              jsx('div', {
                                className: 'text-[10.5px] text-(--ui-text-tertiary)',
                                children: 'Profile 级 Codex 服务开关'
                              })
                            ]
                          }),
                          jsx(Switch, {
                            size: 'xs',
                            'aria-label': 'Daybreak',
                            checked: daybreakOn,
                            onCheckedChange: next => {
                              void commitDaybreak(Boolean(next))
                            }
                          })
                        ]
                      })
                  ]
                }),
              jsxs('div', {
                className: 'px-3 py-2.5 flex flex-col gap-2',
                children: [
                  jsxs('div', {
                    className: 'flex items-center justify-between gap-2',
                    children: [
                      jsxs('div', {
                        className: 'flex items-center gap-1.5 min-w-0',
                        children: [
                          jsx('span', {
                            className: 'text-xs font-medium text-foreground',
                            children: '推理强度'
                          }),
                          jsx(Badge, {
                            variant: 'outline',
                            size: 'xs',
                            children: profileInfo.hint
                          })
                        ]
                      }),
                      jsxs('div', {
                        className: 'flex items-center gap-1 shrink-0',
                        children: [
                          jsx(Badge, {
                            variant: 'muted',
                            size: 'xs',
                            children: sleeping ? '已休眠' : '运行中'
                          }),
                          jsx(Tip, {
                            label: prefs.muted ? '取消静音 (Vworp 音效)' : '静音',
                            children: jsx(Button, {
                              type: 'button',
                              variant: 'ghost',
                              size: 'icon',
                              className: 'size-6 rounded-md text-(--ui-text-tertiary) hover:text-foreground',
                              'aria-label': prefs.muted ? '取消静音' : '静音',
                              onClick: () => updatePref('muted', !prefs.muted),
                              children: jsx(VolumeIcon, { className: 'size-3.5' })
                            })
                          }),
                          jsx(Tip, {
                            label: '打开 TARDIS 插件设置',
                            children: jsx(Button, {
                              type: 'button',
                              variant: 'ghost',
                              size: 'icon',
                              className: 'size-6 rounded-md text-(--ui-text-tertiary) hover:text-foreground',
                              'aria-label': '打开 TARDIS 插件设置',
                              onClick: () => {
                                setOpen(false)
                                host.navigate?.(pluginSettingsHref(PLUGIN_ID))
                              },
                              children: jsx(SettingsIcon, { className: 'size-3.5' })
                            })
                          })
                        ]
                      })
                    ]
                  }),
                  isClamped &&
                    jsx('div', {
                      className: 'rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-quinary) px-2 py-1 text-[10.5px] text-(--ui-text-secondary)',
                      children: `当前配置「${EFFORT_ZH_NAMES[normalizeStr(effectiveEffort)] || effectiveEffort}」在本路由实际发送「${EFFORT_ZH_NAMES[normalizeStr(effectiveWire)] || effectiveWire}」，点击下方档位可直发真实强度`
                    }),
                  jsx(TardisSliderCanvasMount, {
                    profileInfo,
                    activeIndex: activeIdx,
                    disabled: !thinkingOn,
                    onCommit: idx => {
                      const picked = profileInfo.options[idx]?.value
                      if (picked) {
                        void commitReasoning(picked)
                      }
                    },
                    onEngineStateChange: st => setSleeping(Boolean(st?.sleeping))
                  }),
                  activeModel &&
                    jsxs('div', {
                      className: 'flex items-center justify-between gap-2 pt-0.5 text-[10px] text-(--ui-text-quaternary)',
                      children: [
                        jsx('span', {
                          className: 'truncate font-mono',
                          children: `${catalogInfo.matchedProvider || activeProvider || 'default'} · ${activeModel}`
                        }),
                        jsx('span', {
                          className: 'shrink-0',
                          children: thinkingOn ? (profileInfo.options[activeIdx]?.shortLabel || '') : 'Off'
                        })
                      ]
                    })
                ]
              })
            ]
          : []
      })
    ]
  })
}

const PREVIEW_PRESETS = [
  { id: 'deepseek', label: 'DeepSeek 4档', provider: 'deepseek', model: 'deepseek-flash', wire: 'max', defaultIdx: 3 },
  { id: 'gemini', label: 'Gemini / Kimi K2 3档', provider: 'google', model: 'gemini-4', wire: '', defaultIdx: 2 },
  { id: 'glm52', label: 'GLM-5.2 2档', provider: 'zhipu', model: 'glm-5.2', wire: 'max', defaultIdx: 1 },
  { id: 'codex-ultra', label: 'Codex Ultra 4档', provider: 'openai-codex', model: 'gpt-5.6-codex', wire: 'ultra', defaultIdx: 3 }
]

function TardisSettingsPage() {
  const prefs = useValue($prefs)
  const [presetId, setPresetId] = useState('deepseek')
  const [previewIdx, setPreviewIdx] = useState(3)
  const [previewDisabled, setPreviewDisabled] = useState(false)
  const [previewSleeping, setPreviewSleeping] = useState(false)

  const currentPreset = useMemo(
    () => PREVIEW_PRESETS.find(p => p.id === presetId) || PREVIEW_PRESETS[0],
    [presetId]
  )
  const previewProfile = useMemo(
    () => resolveTardisEffortProfile(currentPreset.provider, currentPreset.model, currentPreset.wire),
    [currentPreset]
  )

  return jsxs('div', {
    className: 'flex flex-col gap-5 py-2 max-w-2xl',
    children: [
      jsxs('div', {
        className: 'rounded-xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-quinary) p-4 flex flex-col gap-3',
        children: [
          jsxs('div', {
            className: 'flex items-center justify-between gap-2 flex-wrap',
            children: [
              jsxs('div', {
                className: 'flex items-center gap-2',
                children: [
                  jsx(PixelTardisBadgeIcon, {
                    accent: ACCENTS[previewProfile.stageMap[previewIdx] ?? 0],
                    muted: previewDisabled
                  }),
                  jsx('span', {
                    className: 'text-sm font-semibold text-foreground',
                    children: '16-bit TARDIS 交互预览'
                  }),
                  jsx(Badge, { variant: 'outline', size: 'xs', children: previewProfile.hint }),
                  jsx(Badge, { variant: 'muted', size: 'xs', children: previewSleeping ? '已休眠' : '运行中' })
                ]
              }),
              jsxs('div', {
                className: 'flex items-center gap-2',
                children: [
                  jsx(Button, {
                    type: 'button',
                    variant: 'outline',
                    size: 'sm',
                    onClick: () => setPreviewDisabled(v => !v),
                    children: previewDisabled ? '模拟开启思考' : '模拟关闭思考'
                  }),
                  jsx(Button, {
                    type: 'button',
                    variant: 'outline',
                    size: 'sm',
                    onClick: () => updatePref('muted', !prefs.muted),
                    children: prefs.muted ? '开启音效试听' : '已开启 Vworp 音效'
                  })
                ]
              })
            ]
          }),
          jsx('div', {
            className: 'flex flex-wrap gap-1.5',
            children: PREVIEW_PRESETS.map(item =>
              jsx(
                Button,
                {
                  type: 'button',
                  variant: item.id === presetId ? 'default' : 'outline',
                  size: 'sm',
                  onClick: () => {
                    setPresetId(item.id)
                    setPreviewIdx(item.defaultIdx)
                    setPreviewDisabled(false)
                  },
                  children: item.label
                },
                item.id
              )
            )
          }),
          jsx(TardisSliderCanvasMount, {
            profileInfo: previewProfile,
            activeIndex: Math.min(previewIdx, previewProfile.options.length - 1),
            disabled: previewDisabled,
            onCommit: idx => {
              setPreviewDisabled(false)
              setPreviewIdx(idx)
            },
            onEngineStateChange: st => setPreviewSleeping(Boolean(st?.sleeping))
          })
        ]
      }),
      jsxs('div', {
        className: 'rounded-xl border border-(--ui-stroke-tertiary) bg-(--ui-bg-quinary) px-4 divide-y divide-(--ui-stroke-tertiary)',
        children: [
          jsx(ToggleRow, {
            label: '隐藏原生推理强度按钮',
            description: '在底部输入框保留本插件的 TARDIS 按钮，并隐藏原有的文字推理强度按钮；关闭或停用插件后会立刻恢复原样。',
            checked: prefs.hideNativePill,
            onChange: next => updatePref('hideNativePill', next)
          }),
          jsx(ToggleRow, {
            label: '隐藏模型列表悬停子菜单',
            description: '隐藏模型选择器右侧的「>」箭头及悬停弹出的冗余推理等级菜单，保留收藏星标与模型切换功能。',
            checked: prefs.hideModelSubmenu,
            onChange: next => updatePref('hideModelSubmenu', next)
          }),
          jsx(ToggleRow, {
            label: '默认静音 (Vworp 音效)',
            description: '切换推理档位时默认静音；取消勾选后每次星际跃迁与物化将播放 16-bit 合成器音效。',
            checked: prefs.muted,
            onChange: next => updatePref('muted', next)
          })
        ]
      })
    ]
  })
}

export const __TEST_ONLY__ = {
  PLUGIN_ID,
  STYLE_ID,
  mapEffortToVisualStage,
  resolveTardisEffortProfile,
  resolveTardisOptionIndex,
  findModelCatalogInfo,
  resolveFastControl,
  buildPluginCss,
  syncPluginStyles,
  removePluginStyles
}

export default {
  id: PLUGIN_ID,
  name: 'TARDIS 推理强度滑块',
  description: '16-bit 神秘博士 TARDIS 像素动画推理强度控制器，按模型真实档位自适应，升级 Hermes 不受影响。',
  defaultEnabled: true,

  register(ctx) {
    activeStorage = ctx.storage
    const initialPrefs = loadPrefsFromStorage(ctx.storage)
    $prefs.set(initialPrefs)
    tardisAudio.setMuted(initialPrefs.muted)
    syncPluginStyles(initialPrefs)

    const unlistenPrefs = $prefs.listen(next => {
      syncPluginStyles(next)
    })

    let refreshTimer = null
    const scheduleRefresh = (delayMs = 150) => {
      if (refreshTimer) refreshTimer()
      refreshTimer = ctx.setTimeout(() => {
        refreshTimer = null
        void queryClient.invalidateQueries({ queryKey: QUERY_PREFIX })
      }, delayMs)
    }

    ctx.onEvent('*', ev => {
      const evType = String(ev?.type || '')
      if (evType === 'session.info') {
        const sid = String(ev?.session_id || '') || '__primary__'
        const payload = ev?.payload && typeof ev.payload === 'object' ? ev.payload : {}
        const prevMap = $liveSessionInfo.get()
        const prevEntry = prevMap[sid] || {}
        const nextEntry = {
          ...prevEntry,
          ...(typeof payload.reasoning_effort === 'string' ? { reasoning_effort: payload.reasoning_effort } : {}),
          ...(typeof payload.reasoning_effort_wire === 'string'
            ? { reasoning_effort_wire: payload.reasoning_effort_wire }
            : {}),
          ...(typeof payload.fast === 'boolean' ? { fast: payload.fast } : {}),
          ...(typeof payload.service_tier === 'string' ? { service_tier: payload.service_tier } : {}),
          ...(typeof payload.model === 'string' ? { model: payload.model } : {}),
          ...(typeof payload.provider === 'string' ? { provider: payload.provider } : {})
        }
        $liveSessionInfo.set({ ...prevMap, [sid]: nextEntry })

        // Reconcile fresh draft override if user clicked Send right after adjusting effort on a draft
        if (ev?.session_id && draftOverride && Date.now() - draftSubmittingAt < 12_000) {
          const override = draftOverride
          draftOverride = null
          draftSubmittingAt = 0
          if (override.reasoning && normalizeStr(payload.reasoning_effort) !== normalizeStr(override.reasoning)) {
            void host.request('config.set', {
              key: 'reasoning',
              value: override.reasoning,
              session_id: ev.session_id
            }).catch(() => {})
          }
          if (override.fast && override.fast !== 'normal') {
            void host.request('config.set', {
              key: 'fast',
              value: override.fast,
              session_id: ev.session_id
            }).catch(() => {})
          }
        }

        if (prevEntry.model !== nextEntry.model || prevEntry.provider !== nextEntry.provider) {
          scheduleRefresh(120)
        }
        return
      }

      if (
        evType === 'model.switched' ||
        evType === 'config.updated' ||
        evType === 'session.created' ||
        evType === 'session.resumed'
      ) {
        scheduleRefresh(150)
      }
    })

    ctx.registerSettingsPage?.({
      id: 'tardis-effort',
      title: 'TARDIS 推理强度',
      icon: 'sparkle',
      order: 5,
      render: () => jsx(TardisSettingsPage, {})
    })

    ctx.registerMany([
      {
        id: 'composer-pill',
        area: COMPOSER_AREAS.actions,
        order: 90,
        render: () => jsx(TardisComposerControl, { ctx })
      },
      {
        id: 'draft-sync-middleware',
        area: COMPOSER_AREAS.middleware,
        order: 100,
        data: {
          handler: draft => {
            if (!host.state.activeSessionId.get() && !host.state.focusedSessionId.get() && draftOverride) {
              draftSubmittingAt = Date.now()
            }
            return draft
          }
        }
      },
      {
        id: 'open-settings',
        area: PALETTE_AREA,
        data: {
          id: `${PLUGIN_ID}.settings`,
          label: '打开 TARDIS 推理强度设置与预览',
          keywords: ['tardis', 'thinking', 'reasoning', 'effort', '推理强度', '滑块'],
          run: () => host.navigate(pluginSettingsHref(PLUGIN_ID))
        }
      }
    ])

    ctx.onDispose(() => {
      if (refreshTimer) {
        refreshTimer()
        refreshTimer = null
      }
      unlistenPrefs()
      removePluginStyles()
      activeStorage = null
      draftOverride = null
      draftSubmittingAt = 0
    })
  }
}
