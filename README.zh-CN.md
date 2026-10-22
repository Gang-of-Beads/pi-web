# PI WEB

[English](README.md) | 简体中文

[![Release](https://github.com/Gang-of-Beads/pi-web/actions/workflows/publish.yml/badge.svg)](https://github.com/Gang-of-Beads/pi-web/actions/workflows/publish.yml)
[![npm version](https://img.shields.io/npm/v/@gang-of-beads/pi-web)](https://www.npmjs.com/package/@gang-of-beads/pi-web)
[![Node.js](https://img.shields.io/node/v/@gang-of-beads/pi-web)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**PI WEB 是 [Pi Coding Agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent) 的 Web 界面，让 agent 会话在你的机器或服务器上的真实工作区中持续运行。**

让 agent 在你的代码、工具、凭据和构建缓存所在的地方运行，并在任意浏览器中监督它们。

![PI WEB](docs/assets/pi-web-banner.png)

![PI WEB on a desktop: sessions, a conversation and the project's files](docs/assets/pi-web-desktop.png)

<p align="center">
  <img src="docs/assets/pi-web-mobile.png" alt="The session board on a phone" width="32%">
  <img src="docs/assets/pi-web-mobile-goto.png" alt="The Go to menu on a phone" width="32%">
  <img src="docs/assets/pi-web-mobile-light.png" alt="A conversation on a phone in Material Light" width="32%">
</p>
<p align="center"><em>在手机上：会话看板（session board）、Go to 菜单，以及浅色主题下的一段对话。</em></p>

## 为什么选择 PI WEB？

当工作环境持续存在时，agent 驱动的开发效果更好。PI WEB 让你可以：

- 在浏览器断开连接后，让 Pi Coding Agent 会话继续存活；
- 在真实的代码仓库和 git worktree 中运行 agent；
- 同时监督多个会话；
- 在笔记本电脑、手机、平板和台式机之间切换；
- 把服务器、工作站或远程开发机作为 agent 的运行时；
- 在同一个 Web 界面中管理项目、工作区、文件、终端、会话和其他机器。

浏览器是控制面，工作则留在能够持续运行的地方。参见[远程优先开发（Remote-first development）](docs/remote-first.md)。

## 快速开始

环境要求：

- Node.js 22.19.0 或更高版本以及 npm，需位于登录 shell 的 `PATH` 中，并且无需 `sudo` 即可执行 `npm install -g`；关于 nvm 和发行版软件包，参见[环境要求（Requirements）](docs/install.md#requirements)
- Pi Coding Agent 1.3.0 或更高版本，并已为你的用户完成配置
- git 以及你的 agent 所需的开发工具；在 Linux 上还需要 python3、make 和 C++ 编译器（例如 `build-essential`），npm 会用它们来构建终端
- 带有用户级服务管理器（systemd 或 launchd）的 Linux 或 macOS，Windows 10 或 11（用户级计划任务），或 [Android 上的 Termux（Termux on Android）](docs/install.md#termux-android)（termux-services）

### 推荐配置

在代码所在的机器上运行带 Gang of Beads 预设的 PI WEB，通过 Tailscale Serve 将其发布到你的 tailnet，然后在手机上使用。

1. 将 PI WEB 安装为用户级服务，并附带 [Gang of Beads 预设（Gang of Beads preset）](docs/install.md#gang-of-beads-preset)中的 agent 工具和 Web 插件：

   ```bash
   curl -fsSL https://raw.githubusercontent.com/Gang-of-Beads/pi-web/main/install.sh | sh -s -- --preset gang-of-beads
   ```

   在 Linux 服务器上，还需运行 `sudo loginctl enable-linger "$USER"`，这样在你退出登录后服务仍会继续运行。

   在 Windows 上，改为在 PowerShell 中运行：

   ```powershell
   $env:PI_WEB_PRESET = "gang-of-beads"; irm https://raw.githubusercontent.com/Gang-of-Beads/pi-web/main/install.ps1 | iex
   ```

2. 通过 [Tailscale Serve](docs/install.md#remote-access) 将其发布到你的 tailnet（已启用 MagicDNS 和 HTTPS 证书）。PI WEB 仍保持在 loopback（本机回环地址）上，而你的设备可以获得语音听写和剪贴板所需的 HTTPS：

   ```bash
   tailscale serve --bg --https=8504 http://127.0.0.1:8504
   ```

3. 在已登录同一 tailnet 的手机上打开 `https://<machine>.<tailnet>.ts.net:8504`，并将其添加到主屏幕（Safari：**Share → Add to Home Screen**）。它会像 App 一样打开：参见[在 iPhone 或 iPad 上安装（Install on iPhone or iPad）](docs/install.md#install-on-iphone-or-ipad)。

仅安装 PI WEB，不带预设：

```bash
curl -fsSL https://raw.githubusercontent.com/Gang-of-Beads/pi-web/main/install.sh | sh
```

在 Windows 上，于 PowerShell 中运行（详见 [Windows](docs/install.md#windows)）：

```powershell
irm https://raw.githubusercontent.com/Gang-of-Beads/pi-web/main/install.ps1 | iex
```

然后打开 <http://127.0.0.1:8504>，或按第 2 步的方式发布。

npm、Nix、Home Manager、Docker、通过 Pi 安装、WSL 以及手动运行：参见[安装指南（installation guide）](docs/install.md)。

日常命令：

```bash
pi-web status
pi-web logs
pi-web restart
pi-web doctor
pi-web version
pi-web uninstall
```

## 核心模型

```text
Machine     a PI WEB runtime: the one you opened, or another one you added
Project     a folder on that machine
Workspace   a working folder of the project: the project folder, or with Git, each worktree
Session     a Pi Coding Agent chat running inside a workspace
```

<!-- zh-only -->
| 概念 | 含义 |
|---|---|
| 机器（Machine） | 一个 PI WEB 运行时：你打开的那个，或你添加的另一个 |
| 项目（Project） | 该机器上的一个文件夹 |
| 工作区（Workspace） | 项目的一个工作文件夹：即项目文件夹本身；使用 Git 时，则是每个 worktree |
| 会话（Session） | 在工作区内运行的一个 Pi Coding Agent 聊天 |

典型流程：添加项目，选择工作区或 git worktree，启动会话，让 agent 工作，稍后再从任意浏览器回来。

## 安全

PI WEB 没有用户账户，并假定用户、代码仓库和服务器路径都是可信的；它不是沙箱，也不是多用户平台。请将它保持在 localhost、私有网络、SSH 隧道或经过身份验证的反向代理上，绝不要直接暴露在公网上；可选的[访问令牌（access token）](docs/install.md#require-an-access-token)可以再增加一层保护。威胁模型以及如何报告漏洞，参见 [SECURITY.md](SECURITY.md)。

## 文档

- [安装（Install）](docs/install.md)：环境要求、安装选项、服务、更新、远程访问
- [配置（Configuration）](docs/config.md)：配置文件、配置键、环境变量、重启规则
- [机器（Machines）](docs/machines.md)：在同一个页面中使用多台 PI WEB 机器
- [远程优先开发（Remote-first development）](docs/remote-first.md)
- [插件（Plugins）](docs/plugins.md)：PI WEB 插件和 Pi 包
- [常见问题与故障排查（FAQ and troubleshooting）](docs/faq.md)

与 PI WEB 一同维护的插件和包：[docs/plugins.md](docs/plugins.md#packages)。

## 参与贡献

开发环境搭建、检查项以及对 Pull Request 的要求，参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

MIT © 2026 Federico Jaramillo Martinez 及 Gang of Beads 贡献者。参见 [LICENSE](LICENSE)。

<!-- zh-only -->
> 本文译自英文版 [README.md](README.md)（对应上游提交 `09e8a3db`）。如有出入，以英文版为准。
