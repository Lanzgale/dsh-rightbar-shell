# dsh-rightbar-shell（右栏外壳 / 接口插件）

**这不是一个能单独安装的插件。它的 `package.json` 里写的是官方的包名。**

## 它是干什么的

官方的 `@deepseek-ai/dsh-client-ui-sidebar-right` 一身两职：

1. 提供一整套**停靠面**（标签页 / 分栏 / 浮窗 / 拖拽投放）——我们不要；
2. 提供客户端服务 **`sidebarRight`**——`dsh-client-ui-chat` **硬依赖**它。

于是：既**不能禁用**那个包（禁了就没人提供这个服务，chat 永远 pending、整个界面起不来），
也**无法**从别的插件覆盖它提供的服务（cordis：`provide` 遇到已提供会抛错，`set` 只有提供者自己的 fiber 能用）。

**解法：让那个包名解析到本包。**

```
~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-client-ui-sidebar-right  →  本目录（软链）
```

裸包名从**配置文件所在目录**开始按 Node 规则解析（`dsh` 启动时没有传 `bareModuleBaseUrl`），
所以 profile 自己 `node_modules` 里的这份**排在官方那份前面**。包名不变，别处的引用一条都不悬空 ——
`dsh-client-ui-chat`、`-sidebar-files`、`-sidebar-documentpreview` 三个官方包都在
`dsh.client.inject` 里按这个名字连边，改名会让这三条边悬空、界面起不来。

**所以 `package.json` 的 `name` 必须一字不改地保持官方名。**（目录名、仓库名随便起。）

## 谁画什么

本包占住官方那个 `rightbar` 插槽，画**外壳**；内容是别的插件塞进来的。

| 座位 | 类型 | 谁往里画 |
|:--|:--|:--|
| `rightbar.content` | `single` | 内容插件（`dsh-file-browser`，将来的 `dsh-repo-browser`） |
| `rightbar.actions` | `list` | 内容插件的工具按钮，落在标题行右端 |

外壳自己画这几样：

- **标题行**——左边是「图标 + 当前浏览器名」的切换按钮（`MODES` 表驱动），
  右端依次是 深浅切换 / 内容插件的工具按钮 / 收起侧边栏
- **会话标题栏右上角的展开角标**（右栏收起时出现；新会话页不出现）
- **侧边栏的深浅配色**（`--rb-*` 一组变量，内容插件跟着用）
- 列的开关与宽度（调 `ctx.layout.openRightbar()` / `closeRightbar()`）

内容插件自带标题行时（例如打开了文档），可以发 `present { headless: true }` 让外壳整行让位，
永远只有一行。

## 事件协议

外壳与内容插件之间**只**通过 window 事件耦合，互相不 import：

| 方向 | 事件名 | 载荷 |
|:--|:--|:--|
| 外壳 → 内容 | `dsh:sidebar-right:open` | `{ path, line, sessionId }` |
| 外壳 → 内容 | `dsh:sidebar-right:theme` | `{ dark }` |
| 内容 → 外壳 | `dsh:sidebar-right:request` | `{ action }` |
| 内容 → 外壳 | `dsh:sidebar-right:present` | `{ headless }` |

`open` 这条打通了 chat 里的文件链接：

```
chat 点文件链接
  → ctx.sidebarRight.openResource(address, { params: { line } })   ← 本包接住
  → window 事件 'dsh:sidebar-right:open' { path, line, sessionId }
  → dsh-file-browser 打开面板并载入该文件
```

## 长期风险（要记着）

- **软链可能被清掉**：`dsh plugin add` 或 profile 里跑 pnpm install 时，这条不在 `dependencies`
  里的软链有可能被删。表现是官方停靠面「复活」。重建办法见 `~/file/dsh/plugins/README.md`。
- **冒充官方包名**：将来 DSH 若改 `dsh.client` 的声明契约（比如新增必填字段），本包要跟着改。
- **`sidebarRight` 只有 `openResource` 是真的**：其余成员是空实现。现在全库只有 chat 调它、
  只调这一个方法；将来官方若新增调用者，会拿到一个**静默无效**的空实现（不报错）。
- **改完要重启 DSH**：模块路径是启动时解析的，光刷新页面不够。

## 文件

| 文件 | 作用 |
|:--|:--|
| `lib/index.js` | host 半身，空壳（官方同样是空壳） |
| `lib/client.js` | 浏览器半身：提供 `sidebarRight`、占 `rightbar`、画外壳 |
| `package.json` | **包名写的是官方名字**（这就是全部机关） |
