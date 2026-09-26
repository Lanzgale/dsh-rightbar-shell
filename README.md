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

本包占住官方那个 `rightbar` 插槽，画**外壳**；内容是别的插件**报到**进来的。

内容插件在 `apply` 里登记一个**档位**（id / 名字 / 图标 / 内容 / 标题行右端的按钮）：

```js
ctx.effect(() => ctx.rightbarShell.addMode({
  id: 'files',
  label: '文件浏览器',
  icon: 'folderOpen',
  render: (props) => react.createElement(ExplorerPanel, props),
  actions: (props) => react.createElement(Toolbar, props),
}), 'file-browser: rightbar mode');
```

`addMode` 返回 disposer；同一个 id 登记两次会**抛错**，不静默覆盖。

外壳自己画这几样：

- **标题行**——左边是「图标 + 当前档位名」的切换菜单，
  右端依次是 深浅切换 / 当前档位的按钮 / 收起侧边栏
- **会话标题栏右上角的展开角标**（右栏收起时出现；新会话页不出现）
- **侧边栏的深浅配色**（`--rb-*` 一组变量，内容插件跟着用）
- **全屏时的铺满**（`.dsh-rb.is-fullscreen`，见「全屏」一节）
- 列的开关、宽度与边界拖拽手柄

**档位互斥是结构性的**：外壳只有一个「当前档位」，切档就是换内容，
不存在两个浏览器同时开着的情况——所以内容插件之间**不需要**互相通知收起
（旧的两两广播 `dsh:panel:open` 已删除）。

内容插件自带标题行时（例如打开了文档），可以发 `present { headless: true }` 让外壳整行让位，
永远只有一行。

## 列宽

官方把右栏宽度存在自己的 store 里（`layoutInfo.rightbar`），而 **`ctx.layout` 上没有设置它的方法**。
偏偏**拖拽手柄的位置也是用这个数算的**（外框里写的是 `left: viewport - normal.rightbar`），
所以「只把屏幕上那一列改窄」会让手柄飘到离边界几百像素的地方——边界上再也抓不到它。

本包的做法是直接写框架自己那份数：

```js
ctx.layout.panels.setRightbar(px)   // panels = 构造 LayoutController 时传进去的 instance.actions
```

- 默认 **350**（官方下限 300、上限视口 ×70%），在展开的那一刻写入；
- 用户拖动后的宽度存进 `localStorage['dsh-rightbar-shell:width:v2']`，下次展开或刷新复原；
- 拿不到 `panels.setRightbar` 时会在控制台**大声报警并打出实际字段名**，不静默失效。

## 全屏

**框架不管铺满**。`ctx.layout.openRightbar(track, fullscreen)` 里的 `fullscreen` 只做两件事：
藏掉拖拽手柄、关掉宽度过渡动画；真正"盖住整个窗口"是**面板自己画的**——官方那套也是自己写
`position: fixed; inset: 0; z-index: 40`。所以本包除了把状态报给框架，还给根节点挂
`is-fullscreen`，由 `.dsh-rb.is-fullscreen` 铺满（父级那一列有 `position: relative`
但没建包含块，fixed 仍相对视口）。

对外接口（内容插件用，目前是文件浏览器的预览工具栏）：

| 成员 | 用途 |
|:--|:--|
| `isFullscreen()` | 当前是否全屏 |
| `setFullscreen(v)` / `toggleFullscreen()` | 切换全屏 |
| `getSnapshot().fullscreen` + `subscribe` | 订阅全屏状态变化 |

**收起侧边栏会一并退出全屏**（`setOpen(false)` 里复位），否则下次打开会直接糊住整屏。

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
- **`ctx.layout.panels` 是内部字段**：官方没给「设置右栏宽度」的公开方法，只能伸进
  `LayoutController.panels` 拿 `setRightbar`。DSH 改了这里，右栏会退回框架默认的 45%，
  并在控制台留下一条带实际字段名的警告。
- **改完要重启 DSH**：模块路径（软链 / `package.json` / profile 依赖）是启动时解析的，
  光刷新页面不够；只改 `lib/client.js` 刷新即可。

## 文件

| 文件 | 作用 |
|:--|:--|
| `lib/index.js` | host 半身，空壳（官方同样是空壳） |
| `lib/client.js` | 浏览器半身：提供 `sidebarRight` 与 `rightbarShell`、占 `rightbar`、画外壳、管列宽 |
| `package.json` | **包名写的是官方名字**（这就是全部机关） |
