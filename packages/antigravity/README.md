# TARDIS Effort Slider · Antigravity Desktop (`0.2.1`)

[English](#english) | [简体中文](#简体中文)

---

## English

User frontend extension for the **[Chuanban Antigravity theme patch (`chuanban-antigravity-theme-patch`)](https://github.com/Anarcadia/chuanban-antigravity-theme-patch)** (`customJs`), tested on Antigravity Desktop `2.34.0`. Clicking the composer's model trigger opens a unified TARDIS popup to search/switch models and adjust reasoning effort, sourcing both standard models and orchestrator models/tiers directly from Antigravity's native selector.

### Features

- Drag the TARDIS capsule, press arrow keys, or click stops to set reasoning effort for the active conversation; the panel remains open until clicking outside, clicking Close, or pressing `Esc`.
- Live theme-color inheritance from Antigravity's active theme.
- Dedicated **Native menu** button to open Antigravity's original model menu at any time.
- Offloads canvas rendering to an **OffscreenCanvas** Worker thread when supported, reuses the canvas across model switches, and respects `prefers-reduced-motion`.

### Install & Uninstall

Requires [Anarcadia/chuanban-antigravity-theme-patch](https://github.com/Anarcadia/chuanban-antigravity-theme-patch) installed with `customJs` enabled.

1. Download and extract `antigravity-tardis-effort-0.2.1.zip` from [Releases](https://github.com/JOJO1999-tpi/tardis-effort-kit/releases) (or run `node build.cjs` in this source directory first to generate `tardis-antigravity.js`).
2. Inside the package directory, run:

```powershell
node install.cjs install
```

The installer manages only a fenced marker block (`/* BEGIN TARDIS ANTIGRAVITY EFFORT */` … `/* END TARDIS ANTIGRAVITY EFFORT */`) inside `~/.gemini/antigravity/theme-patch/user/custom.js` (or pass a custom path as the 2nd argument) and hot-reloads when the Chuanban patch is active.

To remove cleanly:

```powershell
node install.cjs remove
```

### Maintenance & Build

Because models and tiers come from the native selector via exposed DOM/ARIA controls, future Antigravity updates that alter selector markup may require selector adjustments in `src/client.js`. After modifying `src/`, run:

```bash
node build.cjs
```

---

## 简体中文

面向 **[船板 Antigravity 主题、字体与汉化补丁 (`chuanban-antigravity-theme-patch`)](https://github.com/Anarcadia/chuanban-antigravity-theme-patch)** 的用户前端扩展（依赖其 `customJs` 钩子注入），适配本机 Antigravity `2.34.0`。点击输入框底部的模型按钮，就能在同一面板搜索模型、切换模型和调节推理档位；普通模型和编排器的模型与档位均来自反重力原生选择器。

### 核心特性

- 拖动太空舱、按方向键或点击档位即可调整当前会话的推理强度；选档后面板保持打开，直到点击外部、关闭按钮或按 `Esc`。
- 面板配色实时继承反重力当前主题。
- 面板内的「原生菜单」按钮可直接打开反重力原有的模型菜单。
- 动画优先由独立的 OffscreenCanvas 画布线程绘制，切换模型时复用原有画布，并支持系统减弱动态效果设置。

### 安装与卸载

需先安装 [Anarcadia/chuanban-antigravity-theme-patch](https://github.com/Anarcadia/chuanban-antigravity-theme-patch) 并启用 `customJs`。

1. 从 [Releases](https://github.com/JOJO1999-tpi/tardis-effort-kit/releases) 下载并解压 `antigravity-tardis-effort-0.2.1.zip`（如直接使用本源码目录，请先运行 `node build.cjs` 生成 `tardis-antigravity.js`）。
2. 在该目录运行：

```powershell
node install.cjs install
```

安装脚本只在主题 `user/custom.js` 中管理带首尾标记的扩展块，已启用船板主题时支持热加载。卸载时会干净移除该扩展块：

```powershell
node install.cjs remove
```

### 维护与构建

模型和档位更新直接读取原生菜单公开给界面的控件标识，如后续 Antigravity 调整控件结构，可检查 `src/client.js`。修改 `src/` 后运行 `node build.cjs` 即可重新生成 `tardis-antigravity.js`。
