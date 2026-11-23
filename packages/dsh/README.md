# TARDIS Model Panel · DSH Plugin (`dsh-tardis-effort` 0.1.1)

[English](#english) | [简体中文](#简体中文)

---

## English

Standalone UI plugin for **DSH (DeepSeek Harness)**. Unifies model search & switching, 16-bit TARDIS reasoning-effort selection, and session access permissions inside the composer model menu (while preserving DSH's built-in team switch).

### Install on Windows Desktop / Web

Quit DSH, open PowerShell, and install the `.tgz` package (download `dsh-tardis-effort-0.1.1.tgz` from [Releases](https://github.com/JOJO1999-tpi/tardis-effort-kit/releases) or build locally with `npm pack`):

```powershell
$dsh = '<path-to-dsh>\resources\runtime\cli\bin\dsh.cmd'
$package = '<path-to>\dsh-tardis-effort-0.1.1.tgz'
& $dsh plugin --profile desktop add "file:$package"
```

- For `dsh web`, replace `--profile desktop` with `--profile web`.
- To upgrade, re-run the `add` command under the same `--profile` with the newer `.tgz`.
- You can disable **TARDIS Model Panel** from DSH's Plugins page, or quit DSH and remove it completely:

```powershell
& $dsh plugin --profile desktop remove dsh-tardis-effort
```

### Usage

- Click the composer model button to open the unified panel.
- Reads only DSH's built-in DeepSeek account and API Key routes (`deepseek-account`, `deepseek-official`). Model names, options, and reasoning-effort stops stay synced with DSH's live catalog (preferring the active session's selected DeepSeek route when both expose the same model).
- Click stops, drag the TARDIS capsule, or use arrow keys to adjust reasoning effort; a model with 2 real stops renders 2 stops. Changes apply cleanly to the next request in the session.
- Session permission presets mirror DSH's configuration, retaining native risk notices and confirmation prompts for Auto-review / Full access without altering default permissions.

### Compatibility & Build from Source

Uses DSH's composer model-options slot (`conversation.input.model.options` / `.label`), session model catalog, and permission APIs. Panel styles and layout live in `src/client.js` and `src/panel.css`, powered by `src/tardis-effort-core.js`.

Zero external dependencies are required to build:

```bash
node build.cjs
npm pack
```

---

## 简体中文

DSH（DeepSeek Harness）的独立界面插件。在输入框模型菜单里集中搜索和切换模型、调整推理强度、查看和切换当前会话的访问权限。团队开关由 DSH 提供。

### 在 Windows 桌面版 / Web 版安装

退出 DSH。打开 PowerShell，用本机 `dsh` 命令安装发布包（可从 [Releases](https://github.com/JOJO1999-tardis-effort-kit/releases) 下载 `dsh-tardis-effort-0.1.1.tgz`，或在源码目录运行 `npm pack` 生成），再启动 DSH：

```powershell
$dsh = '<path-to-dsh>\resources\runtime\cli\bin\dsh.cmd'
$package = '<path-to>\dsh-tardis-effort-0.1.1.tgz'
& $dsh plugin --profile desktop add "file:$package"
```

使用 `dsh web` 时，把 `--profile desktop` 换成 `--profile web`。更新插件时，在同一个 profile 用新版 `.tgz` 重新执行安装命令。

在 DSH 的「插件」页可停用「TARDIS 推理面板」。也可以退出 DSH 后移除整个插件包：

```powershell
& $dsh plugin --profile desktop remove dsh-tardis-effort
```

### 使用说明

- 点击输入框底部的模型按钮。列表只读取 DSH 内置的 DeepSeek 账号和 API Key 渠道所提供的模型。官方目录更新时，模型名称、选项和推理档位会随 DSH 的目录一起更新。两个渠道同时提供同一个模型时，优先使用当前会话已选中的 DeepSeek 渠道。
- 点击档位、拖动动画区域，或在滑块上按方向键。确认操作后，档位应用到当前会话的下一次请求；只有两个实际档位的模型会自适应显示两个选项。
- 权限选项来自 DSH 当前配置。自动审查和完全访问沿用 DSH 的风险说明和勾选确认，插件本身不会更改默认权限。
- 模型条目显示 DSH 模型目录提供的名称和徽标（目录当前不提供供应商剩余额度百分比）。

### 兼容与维护

本插件使用 DSH 的模型菜单扩展位、会话模型目录和权限接口。应用更新与插件文件通过各自的包管理；DSH 预览版若调整这些扩展接口或菜单结构，可能需要同步更新插件。模型图标、面板布局和 CSS 集中在 `src/client.js` 与 `src/panel.css`，动画来自 `src/tardis-effort-core.js`。

源码包含零安装依赖的构建脚本：运行 `node build.cjs` 构建客户端（生成 `lib/client.js`），再运行 `npm pack` 生成 `.tgz` 安装包。
