# TARDIS 5-Stage Effort Animation (`codex-animation`)

[English](#english) | [简体中文](#简体中文)

![5-Stage TARDIS Effort Preview](../../assets/codex-5stage-preview.png)

---

## English

Standalone 5-stage 16-bit TARDIS pixel-art Canvas animation component (`codex-tardis.mjs`) and offline interactive HTML preview (`codex-tardis-preview.html`).

> **Note**: Codex Desktop's public plugin API does not currently expose a composer reasoning-effort slider UI slot, so this package is distributed as an embeddable ES module asset plus a standalone offline preview page.

### 5 Effort Stages

| Effort ID | Stop Label | Visual Scene | Behavior |
| --- | --- | --- | --- |
| `low` | 最低 | **London Lights Off** | Static London rain-night street with all TARDIS lamp & window lights turned off |
| `medium` | 低 | **London Standby** | Glowing TARDIS & 10th Doctor on London street; sequential light-on / light-off transitions with `low` |
| `high` | 中 | **Earth Orbit** | Low-Earth orbit hover above the sunlit planet |
| `xhigh` | 极高 | **Deep Space** | Deep-space starfield cruise with 90° leap transition |
| `max` | 最高 | **Time Vortex** | 10th Doctor blue-orange Time Vortex turbulence |

### Build & Embed

Run zero-dependency build inside `packages/codex-animation/`:

```bash
node build.cjs
```

This generates `codex-tardis.mjs` and `codex-tardis-preview.html`. Open `codex-tardis-preview.html` directly in any browser for offline preview, or embed `codex-tardis.mjs` and call `setEffort` whenever the host selection changes:

```js
import { mountTardisAnimation } from './codex-tardis.mjs';

const animation = mountTardisAnimation(canvas, { effort: 'low' });
animation.setEffort('medium');
// Call animation.destroy() when the component unmounts.
```

---

## 简体中文

独立 5 档 TARDIS 16-bit 像素动画组件（`codex-tardis.mjs`）与离线交互预览页（`codex-tardis-preview.html`）。

> **说明**：当前 Codex 桌面版公开插件接口未提供原生推理滑块的界面渲染入口，因此本组件以可嵌入动画资产与离线预览页的形式分发。

### 五档视觉阶段

| 档位 ID | 标签 | 场景 | 表现 |
| --- | --- | --- | --- |
| `low` | 最低 | **伦敦熄灯** | 静帧展示灯光全灭的雨夜伦敦街景，与「伦敦待命」之间支持顺序点灯/关灯过渡 |
| `medium` | 低 | **伦敦待命** | TARDIS 灯箱亮起、第 10 任博士倚靠待命 |
| `high` | 中 | **地球轨道** | 地球近地轨道蓝星弧光悬浮 |
| `xhigh` | 极高 | **深空巡航** | 深空星海高速穿梭 |
| `max` | 最高 | **时间漩涡** | 蓝橙时间隧道湍流 |

### 构建与调用

在 `packages/codex-animation/` 目录运行零依赖构建脚本：

```bash
node build.cjs
```

将生成 `codex-tardis.mjs` 与 `codex-tardis-preview.html`。双击 `codex-tardis-preview.html` 即可在浏览器中离线预览；代码集成只需向 `mountTardisAnimation` 传入目标 `<canvas>` 并在档位变化时调用 `setEffort`：

```js
import { mountTardisAnimation } from './codex-tardis.mjs';

const animation = mountTardisAnimation(canvas, { effort: 'low' });
animation.setEffort('medium');
// 组件卸载时调用 animation.destroy()。
```
