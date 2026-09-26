# dsh-rightbar-shell（右栏替身 / shim）

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
所以 profile 自己 `node_modules` 里的这份**排在官方那份前面**。包名不变，别处的引用一条都不悬空。

## 谁来画界面

**本包不渲染任何东西。** 右栏那一列由 `dsh-file-browser` 负责：
它注册 `rightbar` 座位、调 `ctx.layout.openRightbar()` 报列宽、自己画面板。

两边靠一个窗口事件衔接：

```
chat 点文件链接
  → ctx.sidebarRight.openResource(address, { params: { line } })   ← 本包接住
  → window 事件 'dsh:sidebar-right:open' { path, line, sessionId }
  → dsh-file-browser 打开面板并载入该文件
```

## 长期风险（要记着）

- **软链可能被清掉**：`dsh plugin add` 或 profile 里跑 pnpm install 时，这条不在 `dependencies`
  里的软链有可能被删。表现是官方停靠面「复活」。重建办法见 `~/file/dsh/index.md`。
- **冒充官方包名**：将来 DSH 若改 `dsh.client` 的声明契约（比如新增必填字段），本包要跟着改。
- **只有 `openResource` 是真的**：其余成员是空实现。现在全库只有 chat 调它、只调这一个方法；
  将来官方若新增调用者，会拿到一个**静默无效**的空实现（不报错）。

## 文件

| 文件 | 作用 |
|:--|:--|
| `lib/index.js` | host 半身，空壳（官方同样是空壳） |
| `lib/client.js` | 浏览器半身：提供 `sidebarRight` 服务 |
| `package.json` | **包名写的是官方名字**（这就是全部机关） |
