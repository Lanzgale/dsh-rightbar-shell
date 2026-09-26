/**
 * 右栏「接口插件」——浏览器半身。
 *
 * 它一个人扛三件事：
 *   ① 提供 `dsh-client-ui-chat` 硬依赖的 `sidebarRight` 服务；
 *   ② 占住 `rightbar` 这一列（开合、列宽上报、右上角入口按钮）；
 *   ③ 画标题行，并对外提供 `rightbarShell` 服务，让内容插件来「报到」。
 *
 * 它为什么存在：官方的 `@deepseek-ai/dsh-client-ui-sidebar-right` 一身两职——
 * 既是 `sidebarRight` 的唯一提供者，又被 chat 声明为客户端插件依赖，
 * 所以既不能禁用、也无法从别的 fiber 覆盖它的服务。
 * 解法是让那个**包名解析到本包**（profile 里一条软链），于是官方那套
 * 「停靠面」（标签页 / 分栏 / 浮窗 / 拖拽投放）一行都不会执行。
 *
 * 分层：外壳（本包）管"这一列怎么开、多宽、按钮在哪、标题行长什么样"；
 * 内容（dsh-file-browser 等）只管"画什么"：调一次 rightbarShell.addMode()，把
 * 档位名、图标、内容组件、工具按钮一起交出去。外壳是「有哪些档位」的单一真相，
 * 按当前档位渲染。以后加仓库浏览器 = 对方报一次到，外壳一行都不用改。
 *
 * 与内容插件的窗口事件协议：
 *   shell → 内容  `dsh:sidebar-right:open`    { path, line, sessionId }   打开某个文件
 *   内容 → shell  `dsh:sidebar-right:request` { action: 'open'|'close'|'toggle' }
 */
window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-ui-sidebar-right",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var react = require("react");

		const OPEN_FILE_EVENT = 'dsh:sidebar-right:open';
		const REQUEST_EVENT = 'dsh:sidebar-right:request';
		// 内容插件宣告"这一行我自己来"（比如打开文档时，预览自带标题行）
		const PRESENT_EVENT = 'dsh:sidebar-right:present';
		// 侧边栏主题：外壳拥有它，并广播给所有内容插件（f-b / 以后的 r-b）
		const THEME_EVENT = 'dsh:sidebar-right:theme';

		/** `dsh-resource://file/session/<会话id>/<路径>` */
		const FILE_ADDRESS = /^dsh-resource:\/\/file\/session\/([^/]+)\/(.+)$/;

		function parseFileAddress(address) {
			const m = FILE_ADDRESS.exec(address == null ? '' : String(address));
			if (m === null) return null;
			let path = m[2];
			try { path = decodeURIComponent(path) } catch (e) { /* 解不开就原样用 */ }
			return { sessionId: m[1], path: path };
		}

		// ---------- 这一列的状态 ----------
		// 跨会话一份：browser 这类是"跨会话工具"，不该跟着会话走。
		//
		// 深浅也存浏览器（跟宽度同一套 localStorage）：刷新、重启 DSH 都还在；
		// 但换端口 / 换浏览器 / 无痕窗口在浏览器看来是"另一个地方"，会是空的。
		// 没存过 = 深色（跟 DSH 自己的默认一致）。
		const THEME_KEY = 'dsh-rightbar-shell:theme';
		const readSavedDark = () => {
			try {
				const v = window.localStorage.getItem(THEME_KEY);
				return v === null ? true : v !== 'light';
			} catch (e) { return true }
		};
		const panel = { open: false, mode: '', contentOwnsHeader: false, dark: readSavedDark(), listeners: new Set() };
		const emit = () => { for (const fn of Array.from(panel.listeners)) fn() };
		const subscribe = (fn) => { panel.listeners.add(fn); return () => { panel.listeners.delete(fn) } };
		const usePanel = () => {
			const [, bump] = react.useState(0);
			react.useEffect(() => subscribe(() => bump((x) => x + 1)), []);
			return panel;
		};
		const setOpen = (v) => {
			const next = !!v;
			if (next === panel.open) return;
			panel.open = next;
			if (!next) panel.contentOwnsHeader = false;   // 收起时复位，免得下次打开少一行
			emit();
		};
		const setDark = (v) => {
			const next = !!v;
			if (next === panel.dark) return;
			panel.dark = next;
			try { window.localStorage.setItem(THEME_KEY, next ? 'dark' : 'light') } catch (e) { /* 存不下就算了 */ }
			// 广播：内容插件各自的调色板跟着切（背景由外壳统一负责）
			window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: { dark: next } }));
			emit();
		};
		const setContentOwnsHeader = (v) => {
			const next = !!v;
			if (next === panel.contentOwnsHeader) return;
			panel.contentOwnsHeader = next;
			emit();
		};
		const setMode = (m) => { if (panel.mode === m) return; panel.mode = m; emit() };

		// ---------- 档位登记表（方案 B）----------
		// 外壳是「这个位置有哪些浏览器」的单一真相：登记表里有什么，左端下拉
		// 就有什么、内容区就画谁。加一个浏览器 = 对方来报到一次，外壳不动。
		const modes = [];
		const findMode = (id) => modes.filter((m) => m.id === id)[0] || null;
		const activeMode = () => findMode(panel.mode) || modes[0] || null;

		const rightbarShell = {
			version: '1',
			// desc: { id, label, icon, render, actions? } —— render/actions 是组件
			addMode(desc) {
				if (!desc || typeof desc.id !== 'string' || desc.id === '') {
					throw new Error('rightbarShell.addMode: 缺少 id');
				}
				if (findMode(desc.id) !== null) {
					throw new Error('rightbarShell.addMode: 档位 id 重复: ' + desc.id);
				}
				if (typeof desc.render !== 'function') {
					throw new Error('rightbarShell.addMode: 缺少 render: ' + desc.id);
				}
				modes.push({
					id: desc.id,
					label: desc.label || desc.id,
					icon: desc.icon || '',
					render: desc.render,
					actions: typeof desc.actions === 'function' ? desc.actions : null,
				});
				if (findMode(panel.mode) === null) panel.mode = modes[0].id;
				emit();
				// 注销：卸载时摘掉这一档；当前档位恰好是它就退回第一档
				return () => {
					const i = modes.map((m) => m.id).indexOf(desc.id);
					if (i < 0) return;
					modes.splice(i, 1);
					if (findMode(panel.mode) === null && modes.length > 0) panel.mode = modes[0].id;
					emit();
				};
			},
			getModes() { return modes.map((m) => ({ id: m.id, label: m.label, icon: m.icon })) },
			getMode() { return panel.mode },
			setMode(id) { if (findMode(id) !== null) setMode(id) },
			getSnapshot() {
				return { open: panel.open, mode: panel.mode, dark: panel.dark, modes: modes.map((m) => m.id) };
			},
			subscribe,
		};

		// ---------- 框架服务 ----------
		// ---------- 右栏宽度 ----------
		// 官方：宽度 = `layoutInfo.rightbar ?? 视口 × 45%`，纯内存态、刷新即丢。
		//
		// 关键：**手柄的位置也是用这个数算的**——外框里写的是
		// `left: viewport - normal.rightbar`，normal.rightbar 取自框架自己那份 store。
		// 所以"只把样式表里那一列改窄"是错的：屏幕上的列窄了、框架记的数没变，
		// 手柄就飘到离边界几百像素的地方，边界上再也抓不到它。
		// 唯一正确的着力点是那份 store——它在 LayoutController 的 `panels` 字段上
		// （就是构造它时传进去的 instance.actions），setRightbar 就在里面。
		// 写它 => 列宽、手柄位置、拖拽基准、上下限一次性全部对齐。
		// 键名带 v2：v1 那版逻辑会把"我们自己写的默认值"也存进去，沿用它会把旧的 300 带过来。
		const WIDTH_KEY = 'dsh-rightbar-shell:width:v2';
		const DEFAULT_WIDTH = 350;          // 官方下限是 300；上限是视口 ×70%

		const readSavedWidth = () => {
			try {
				const v = parseInt(window.localStorage.getItem(WIDTH_KEY), 10);
				return Number.isFinite(v) ? v : null;
			} catch (e) { return null }
		};
		const saveWidth = (px) => {
			try { window.localStorage.setItem(WIDTH_KEY, String(Math.round(px))) } catch (e) { /* 存不下就算了 */ }
		};
		const findFrame = () => {
			const col = document.querySelector('[data-rightbar-col]');
			return col ? col.parentElement : null;   // 不用哈希类名，它随构建变
		};
		// 拿不到就**大声说**——静默失败已经害过两次了
		const setFrameworkWidth = (controller, px) => {
			const panels = controller && controller.panels;
			const set = panels && panels.setRightbar;
			if (typeof set !== 'function') {
				console.warn('[rightbar-shell] 改不了右栏宽度：ctx.layout.panels.setRightbar 不存在，'
					+ '多半是 DSH 换了内部结构。右栏会停在框架默认的 45%。'
					+ ' controller=' + (controller === null ? 'null' : typeof controller)
					+ ' panels=' + (panels === null ? 'null' : typeof panels)
					+ ' keys=' + Object.keys(controller || {}).join(','));
				return false;
			}
			set.call(panels, px);
			return true;
		};
		const currentTrackWidth = () => {
			const frame = findFrame();
			if (!frame) return null;
			// 中间那列是 minmax(0, 1fr)，**含空格**，不能按空白切三段（会切成四段）
			const m = String(frame.style.gridTemplateColumns || '').match(/^(\S+)\s+(.+)\s+(\S+)$/);
			if (!m) return null;
			const px = parseFloat(m[3]);
			return Number.isFinite(px) ? px : null;
		};
		// 展开的那一刻定宽：先让框架自己开（它会填 45%），再覆盖成我们的值
		const applyOpenWidth = (controller) => {
			const saved = readSavedWidth();
			setFrameworkWidth(controller, saved === null ? DEFAULT_WIDTH : saved);
		};
		// 用户松开手柄时把结果记下来，下次展开/刷新复原（只读，绝不写样式）
		const watchDrag = () => {
			const frame = findFrame();
			if (!frame) {
				console.warn('[rightbar-shell] 找不到右栏外框（[data-rightbar-col] 的父节点），拖出来的宽度不会被记住。');
				return () => {};
			}
			let dragging = frame.hasAttribute('data-dragging');
			const obs = new MutationObserver(() => {
				const now = frame.hasAttribute('data-dragging');
				if (now === dragging) return;
				dragging = now;
				if (now) return;                  // 刚开始拖：什么都别做
				const px = currentTrackWidth();   // 拖完了：读实际落地的宽度
				if (px !== null) saveWidth(px);
			});
			obs.observe(frame, { attributes: true, attributeFilter: ['data-dragging'] });
			return () => obs.disconnect();
		};

		let LAYOUT = null;
		let CTX = null;
		const getLayout = () => LAYOUT || (CTX ? CTX.get('layout') : null) || null;

		// ---------- chat 要的那个服务 ----------
		const sidebarRight = {
			openResource(address, options) {
				const parsed = parseFileAddress(address);
				if (parsed === null) return;
				const params = (options && options.params) || {};
				setOpen(true);
				window.dispatchEvent(new CustomEvent(OPEN_FILE_EVENT, {
					detail: { path: parsed.path, line: params.line, sessionId: parsed.sessionId },
				}));
			},
			openTab() {},
			close() {},
			active() { return undefined },
			isExpanded() { return panel.open },
			toggleExpanded() { setOpen(!panel.open) },
			focus() {},
			split() { return undefined },
			float() {},
			dock() {},
		};

		// ---------- 图标（16×16）----------
		// 官方「展开右栏」按钮的同款图标：IconPanelLeftOutline16 + 水平翻转
		const PanelLeftIcon = () => react.createElement('svg', {
			width: 16, height: 16, viewBox: '0 0 16 16', fill: 'currentColor',
			xmlns: 'http://www.w3.org/2000/svg',
			style: { display: 'block', transform: 'scaleX(-1)' },
		}, react.createElement('path', {
			fillRule: 'evenodd', clipRule: 'evenodd',
			d: 'M9.67272 0.522841C10.8339 0.522841 11.76 0.522714 12.4963 0.602493C13.2453 0.683657 13.8789 0.854248 14.4264 1.25197C14.7504 1.48739 15.0355 1.77247 15.2709 2.0965C15.6686 2.64394 15.8392 3.27758 15.9204 4.02655C16.0002 4.7629 16 5.68895 16 6.85014V9.14986C16 10.3111 16.0002 11.2371 15.9204 11.9735C15.8392 12.7224 15.6686 13.3561 15.2709 13.9035C15.0355 14.2275 14.7504 14.5126 14.4264 14.748C13.8789 15.1458 13.2453 15.3163 12.4963 15.3975C11.76 15.4773 10.8339 15.4772 9.67272 15.4772H6.3273C5.16611 15.4772 4.24006 15.4773 3.50371 15.3975C2.75474 15.3163 2.1211 15.1458 1.57366 14.748C1.24963 14.5126 0.964549 14.2275 0.729131 13.9035C0.331407 13.3561 0.160817 12.7224 0.0796529 11.9735C-0.000126137 11.2371 1.25338e-09 10.3111 1.25338e-09 9.14986V6.85014C1.25329e-09 5.68895 -0.000126137 4.7629 0.0796529 4.02655C0.160817 3.27758 0.331407 2.64394 0.729131 2.0965C0.964549 1.77247 1.24963 1.48739 1.57366 1.25197C2.1211 0.854248 2.75474 0.683657 3.50371 0.602493C4.24006 0.522714 5.16611 0.522841 6.3273 0.522841H9.67272ZM5.54303 1.88715V14.1118C5.78636 14.1128 6.04709 14.1169 6.3273 14.1169H9.67272C10.8639 14.1169 11.7032 14.1164 12.3493 14.0465C12.9824 13.9779 13.3497 13.8494 13.6268 13.6482C13.8354 13.4966 14.0195 13.3125 14.1711 13.1039C14.3723 12.8268 14.5007 12.4595 14.5693 11.8264C14.6393 11.1803 14.6398 10.341 14.6398 9.14986V6.85014C14.6398 5.65896 14.6393 4.81967 14.5693 4.1736C14.5007 3.54048 14.3723 3.17318 14.1711 2.89609C14.0195 2.68747 13.8354 2.50337 13.6268 2.35179C13.3497 2.1506 12.9824 2.02212 12.3493 1.95353C11.7032 1.88358 10.8639 1.88307 9.67272 1.88307H6.3273C6.04709 1.88307 5.78636 1.8862 5.54303 1.88715ZM4.1828 1.91166C3.99125 1.9216 3.8148 1.93577 3.65076 1.95353C3.01764 2.02212 2.65034 2.1506 2.37325 2.35179C2.16463 2.50337 1.98052 2.68747 1.82895 2.89609C1.62776 3.17318 1.49928 3.54048 1.43069 4.1736C1.36074 4.81967 1.36023 5.65896 1.36023 6.85014V9.14986C1.36023 10.341 1.36074 11.1803 1.43069 11.8264C1.49928 12.4595 1.62776 12.8268 1.82895 13.1039C1.98052 13.3125 2.16463 13.4966 2.37325 13.6482C2.65034 13.8494 3.01764 13.9779 3.65076 14.0465C3.81478 14.0642 3.99127 14.0774 4.1828 14.0873V1.91166Z',
		}));

		// 图标一律取 Material Design Icons（mdi）的 24×24 路径，
		// 与内容插件（f-b）的图标同源同风格，避免粗细/圆角混搭。
		// 取值来源：~/file/dsh/plugins/_reference/mdi.js
		const Mdi = (d, size) => react.createElement('svg', {
			width: size || 16, height: size || 16, viewBox: '0 0 24 24', fill: 'currentColor',
			xmlns: 'http://www.w3.org/2000/svg', style: { display: 'block' },
		}, react.createElement('path', { d }));

		const CloseIcon = () => Mdi('M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z');

		// 左上角那个「当前在哪个浏览器」的图标：每个模式各一个。
		const MODE_ICONS = {
			// 仓库浏览器
			github: 'M12 0C5.37 0 0 5.37 0 12c0 5.31 3.44 9.82 8.2 11.41.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.11-3.18 0 0 1.01-.32 3.3 1.23.96-.27 1.98-.4 3-.4s2.04.13 3 .4c2.28-1.55 3.29-1.23 3.29-1.23.65 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.62-5.49 5.92.43.37.82 1.1.82 2.22v3.29c0 .32.22.7.83.58C20.57 21.82 24 17.31 24 12 24 5.37 18.63 0 12 0z',
			folderOpen: 'M19,20H4C2.89,20 2,19.1 2,18V6C2,4.89 2.89,4 4,4H10L12,6H19A2,2 0 0,1 21,8H21L4,8V18L6.14,10H23.21L20.93,18.5C20.7,19.37 19.92,20 19,20Z',
		};
		const ModeIcon = (name) => MODE_ICONS[name] ? Mdi(MODE_ICONS[name], 16) : null;

		// 深/浅开关：dark 时显示太阳（点一下转浅）
		const ThemeIcon = (dark) => Mdi(dark
			? 'M3.55 19.09L4.96 20.5L6.76 18.71L5.34 17.29M12 6C8.69 6 6 8.69 6 12S8.69 18 12 18 18 15.31 18 12C18 8.68 15.31 6 12 6M20 13H23V11H20M17.24 18.71L19.04 20.5L20.45 19.09L18.66 17.29M20.45 5L19.04 3.6L17.24 5.39L18.66 6.81M13 1H11V4H13M6.76 5.39L4.96 3.6L3.55 5L5.34 6.81L6.76 5.39M1 13H4V11H1M13 20H11V23H13'
			: 'M17.75,4.09L15.22,6.03L16.13,9.09L13.5,7.28L10.87,9.09L11.78,6.03L9.25,4.09L12.44,4L13.5,1L14.56,4L17.75,4.09M21.25,11L19.61,12.25L20.2,14.23L18.5,13.06L16.8,14.23L17.39,12.25L15.75,11L17.81,10.95L18.5,9L19.19,10.95L21.25,11M18.97,15.95C19.8,15.87 20.69,17.05 20.16,17.8C19.84,18.25 19.5,18.67 19.08,19.07C15.17,23 8.84,23 4.94,19.07C1.03,15.17 1.03,8.83 4.94,4.93C5.34,4.53 5.76,4.17 6.21,3.85C6.96,3.32 8.14,4.21 8.06,5.04C7.79,7.9 8.75,10.87 10.95,13.06C13.14,15.26 16.1,16.22 18.97,15.95M17.33,17.97C14.5,17.81 11.7,16.64 9.53,14.5C7.36,12.31 6.2,9.5 6.04,6.68C3.23,9.82 3.34,14.64 6.35,17.66C9.37,20.67 14.19,20.78 17.33,17.97Z');

		// 模式切换按钮上的箭头：收着时指右（表示还有下一层可翻），展开菜单时朝下。
		// 注意：它是当 React 组件用的（createElement），所以拿到的是 props 对象，
		// 不能写成 (open) => —— 那样 open 收到的是 {open:false}，恒为真。
		const CaretIcon = (props) => Mdi(props && props.open
			? 'M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z'
			: 'M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z', 14);

		// ---------- 标题行 ----------
		// 高度 38 = 10 上边距 + 28 按钮：上半截与会话标题栏的入口按钮同高对齐。
		const HeaderBar = (props) => {
			const s = usePanel();
			const [menuOpen, setMenuOpen] = react.useState(false);
			const mode = activeMode();

			react.useEffect(() => {
				if (!menuOpen) return;
				const close = () => setMenuOpen(false);
				document.addEventListener('mousedown', close);
				return () => document.removeEventListener('mousedown', close);
			}, [menuOpen]);

			// 内容插件自带标题行时（例如打开了文档），本行整体让位 —— 永远只有一行。
			// 注意：这个判断必须放在所有 hook 之后，否则 hook 顺序会在两次渲染间变化。
			if (s.contentOwnsHeader) return null;

			return react.createElement('div', { className: 'dsh-rb-header' },
				react.createElement('div', { className: 'dsh-rb-modebox' },
					react.createElement('button', {
						type: 'button',
						className: 'dsh-rb-modebtn',
						title: '切换侧边栏内容',
						'aria-haspopup': 'menu',
						'aria-expanded': menuOpen ? 'true' : 'false',
						onClick: () => setMenuOpen((v) => !v),
					},
						react.createElement('span', { className: 'dsh-rb-modeicon' }, mode ? ModeIcon(mode.icon) : null),
						react.createElement('span', null, mode ? mode.label : ''),
						react.createElement(CaretIcon, { open: menuOpen }),
					),
					// 关键：菜单项要能点到。外壳在 document 上挂了 mousedown 关菜单，
					// 若不放行，鼠标一按下菜单就被卸载，随后的 click 落空，选项永远选不中。
					menuOpen ? react.createElement('div', {
						className: 'dsh-rb-menu', role: 'menu',
						onMouseDown: (e) => e.stopPropagation(),
					},
						modes.map((m) => react.createElement('button', {
							key: m.id,
							type: 'button',
							role: 'menuitem',
							className: 'dsh-rb-menuitem' + (m.id === s.mode ? ' is-on' : ''),
							onClick: () => { setMode(m.id); setMenuOpen(false) },
						}, m.label)),
					) : null,
				),
				react.createElement('div', { className: 'dsh-rb-corner' },
					// 深/浅开关：和内容插件的工具按钮排成一组，就在它们左边
					react.createElement('button', {
						type: 'button',
						className: 'dsh-rb-iconbtn dsh-rb-themebtn' + (s.dark ? ' is-on' : ''),
						title: s.dark ? '切换到浅色' : '切换到深色',
						'aria-label': s.dark ? '切换到浅色' : '切换到深色',
						onClick: () => setDark(!panel.dark),
					}, ThemeIcon(s.dark)),
					// 工具按钮跟着档位走：当前浏览器报到的哪一组就画哪一组
					react.createElement('div', { className: 'dsh-rb-actions' },
						mode && mode.actions ? react.createElement(mode.actions, props) : null,
					),
					react.createElement('button', {
						type: 'button',
						className: 'dsh-rb-iconbtn',
						title: '收起侧边栏',
						'aria-label': '收起右侧边栏',
						'data-sidebar-right-collapse': true,
						onClick: () => setOpen(false),
					}, react.createElement(CloseIcon, null)),
				),
			);
		};

		// ---------- 这一列 ----------
		const RightbarShell = (props) => {
			const s = usePanel();
			const mode = activeMode();
			react.useEffect(() => {
				const layout = getLayout();
				if (!layout) return;
				if (!s.open) {
					layout.closeRightbar();
					return () => { const l = getLayout(); if (l) l.closeRightbar() };
				}
				layout.openRightbar(true, false);
				// 框架刚刚把宽度填成 45%，这里换成 300（或上次拖出来的值）
				applyOpenWidth(layout);
				// 展开期间只做一件事：用户拖完手柄时把宽度记下来
				const stopWatch = watchDrag();
				return () => {
					stopWatch();
					const l = getLayout();
					if (l) l.closeRightbar();
				};
			}, [s.open]);

			// 内容挂载后立刻广播一次当前主题（子组件的 effect 先于父组件运行，
			// 所以这时内容的监听已经就位），避免两边主题不一致。
			react.useEffect(() => {
				window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: { dark: panel.dark } }));
			}, []);

			if (!s.open) return null;
			return react.createElement('div', { className: 'dsh-rb ' + (s.dark ? 'is-dark' : 'is-light') },
				react.createElement(HeaderBar, props),
				react.createElement('div', { className: 'dsh-rb-body' },
					mode && mode.render ? react.createElement(mode.render, props) : null,
				),
			);
		};

		// ---------- 右上角入口（会话标题栏最右角）----------
		const ExpandCorner = (props) => {
			const s = usePanel();
			const heroPage = props.useSessions((st) => {
				const id = st.current;
				if (id === undefined) return true;
				const entry = st.byId[id];
				return entry !== undefined && entry.blank === true;
			});
			if (s.open || heroPage) return null;
			return react.createElement('button', {
				type: 'button',
				className: 'dsh-rb-cornerbtn',
				title: '打开侧边栏',
				'aria-label': '打开右侧边栏',
				'data-sidebar-right-expand': true,
				onClick: () => setOpen(true),
			}, react.createElement(PanelLeftIcon, null));
		};

		// ---------- 样式 ----------
		const CSS = `
.dsh-rb {
  display: flex; flex-direction: column;
  /* 显式撑满框架给的那一列：父级宽度不确定时 width:100% 会缩成内容宽，
     所以四个方向都给死（flex + stretch + 100%）。 */
  flex: 1 1 auto; align-self: stretch;
  width: 100%; height: 100%; min-width: 0; min-height: 0;
  box-sizing: border-box;
  background: var(--dsw-specific-sidebar-fill, transparent);
  border-left: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.28));
  color: var(--dsw-alias-label-primary, inherit);
  font-size: 13px; line-height: 1.45;
}
/* 侧边栏主题调色板：外壳拥有它，内容插件（f-b / r-b）通过 --rb-* 跟随，
   所以点标题行那个太阳/月亮，整条侧边栏（含背景）一起变。 */
.dsh-rb.is-dark {
  --rb-bg: #1B1B1C; --rb-bg-1: #2D2D2E; --rb-border: #3a3a3b;
  --rb-fg: #e8eaee; --rb-fg-2: #9aa2ad; --rb-accent: #679EFE;
  background: var(--rb-bg); color: var(--rb-fg); border-left-color: var(--rb-border);
}
.dsh-rb.is-light {
  --rb-bg: #f9fafb; --rb-bg-1: #ffffff; --rb-border: #d7dbe3;
  --rb-fg: #1f2430; --rb-fg-2: #5c6470; --rb-accent: #4d6bfe;
  background: var(--rb-bg); color: var(--rb-fg); border-left-color: var(--rb-border);
}
.dsh-rb-body { position: relative; z-index: 1; }
.dsh-rb-header {
  position: relative; z-index: 10;
  box-sizing: border-box; flex: none;
  /* 高度 48 = 10(上) + 28(按钮) + 10(下)：上下留白相等，
     上边距仍取 10 以便与会话标题栏的入口按钮同高对齐。 */
  min-height: 48px; padding: 10px 28px 10px 6px;
  display: flex; align-items: flex-start; gap: 8px;
  border-bottom: .5px solid var(--rb-border, var(--dsw-alias-border-l3, rgba(127,127,127,.22)));
}
.dsh-rb-actions { display: flex; align-items: center; gap: 2px; }
.dsh-rb-modebox { position: relative; display: flex; align-items: center; }
.dsh-rb-modebtn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 28px; padding: 0 8px;
  border: none; border-radius: 6px; background: 0 0;
  color: var(--rb-fg, var(--dsw-alias-label-primary, inherit));
  font: inherit; font-weight: 600; cursor: pointer;
}
.dsh-rb-modebtn:hover { background: rgba(127,127,127,.14); }
.dsh-rb-modeicon { display: flex; align-items: center; color: inherit; }
.dsh-rb-menu {
  position: absolute; top: 32px; left: 0; z-index: 200;
  min-width: 148px; padding: 4px;
  border: 1px solid var(--rb-border, var(--dsw-alias-border-l1, rgba(127,127,127,.28)));
  border-radius: 8px;
  background: var(--rb-bg-1, var(--dsw-alias-bg-overlay, #fff));
  box-shadow: 0 6px 24px rgba(0,0,0,.18);
  display: flex; flex-direction: column; gap: 2px;
}
.dsh-rb-menuitem {
  display: block; width: 100%; text-align: left;
  padding: 6px 10px; border: none; border-radius: 5px;
  background: 0 0; color: inherit; font: inherit; cursor: pointer;
}
.dsh-rb-menuitem:hover { background: rgba(127,127,127,.14); }
.dsh-rb-menuitem.is-on { color: var(--rb-accent, var(--dsw-alias-brand-primary, inherit)); font-weight: 600; }
.dsh-rb-corner { margin-left: auto; margin-right: -16px; display: flex; align-items: center; gap: 2px; }
.dsh-rb-iconbtn, .dsh-rb-cornerbtn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 6px;
  border: none; border-radius: 28px; background: 0 0;
  cursor: pointer; flex: none;
}
/* 外壳里的按钮：跟随侧边栏主题 */
.dsh-rb-iconbtn { color: var(--rb-fg-2, var(--dsw-alias-label-secondary, inherit)); }
/* 深色模式下太阳用点缀蓝，比灰色好看 */
.dsh-rb-themebtn.is-on { color: var(--rb-accent, #679EFE); }
/* 右上角入口按钮长在会话标题栏里（不在 .dsh-rb 内），只能跟官方主题 */
.dsh-rb-cornerbtn { color: var(--dsw-alias-label-secondary, inherit); }
.dsh-rb-iconbtn:hover, .dsh-rb-cornerbtn:hover { background: rgba(127,127,127,.16); }
.dsh-rb-body { flex: 1 1 auto; min-height: 0; min-width: 0; overflow: hidden; display: flex; }
.dsh-rb-body > * { flex: 1 1 auto; min-width: 0; min-height: 0; }
`;

		function apply(ctx) {
			CTX = ctx;
			LAYOUT = ctx.get('layout') || null;

			const styleEl = document.createElement('style');
			styleEl.dataset.plugin = 'dsh-rightpanel';
			styleEl.textContent = CSS;
			document.head.appendChild(styleEl);
			ctx.effect(() => () => { styleEl.remove() }, 'rightpanel: styles');

			// 过渡态护栏：组合热重载期间旧提供者可能还没让位，抢着 provide 会抛错。
			if (ctx.get('sidebarRight') === undefined) {
				const dispose = ctx.reflect.provide('sidebarRight', sidebarRight);
				ctx.effect(() => dispose, 'rightpanel: sidebarRight service');
			}

			// 档位登记服务：内容插件靠它报到（方案 B 的那个"柜台"）
			if (ctx.get('rightbarShell') === undefined) {
				const disposeShell = ctx.reflect.provide('rightbarShell', rightbarShell);
				ctx.effect(() => disposeShell, 'rightpanel: rightbarShell service');
			}

			// 内容插件的开合请求（标题行的开合由本包决定，内容插件只能"请求"）
			const onRequest = (e) => {
				const d = e && e.detail;
				if (!d) return;
				if (d.action === 'open') setOpen(true);
				else if (d.action === 'close') setOpen(false);
				else setOpen(!panel.open);
			};
			window.addEventListener(REQUEST_EVENT, onRequest);
			ctx.effect(() => () => { window.removeEventListener(REQUEST_EVENT, onRequest) }, 'rightpanel: requests');

			// 内容插件宣告"标题行我自己来"（打开文档时预览自带一行）
			const onPresent = (e) => {
				const d = e && e.detail;
				if (!d) return;
				setContentOwnsHeader(!!d.headless);
			};
			window.addEventListener(PRESENT_EVENT, onPresent);
			ctx.effect(() => () => { window.removeEventListener(PRESENT_EVENT, onPresent) }, 'rightpanel: present');

			const slots = ctx.get('slots');
			if (slots === undefined) return;

			// 占住这一列。内容不再走子座位，改由 rightbarShell 服务登记（方案 B）
			slots.inject('rightbar', () => slots.register({
				name: 'rightbar',
				id: 'rightpanel',
			}, (props) => react.createElement(RightbarShell, props)));

			// 右上角入口（官方那个"展开侧边栏"按钮的原位置）
			slots.inject('conversation.session.header.corner', () => slots.register(
				{ name: 'conversation.session.header.corner', id: 'rightpanel-expand' },
				(props) => react.createElement(ExpandCorner, props),
			));
		}

		exports.apply = apply;
		exports.inject = ['slots', 'layout'];
		return module.exports;
	},
});
