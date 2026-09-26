/**
 * 纯 host 半身：这个替身对 host 组合没有任何贡献。
 *
 * 官方同名包在 host 侧同样是空壳（它的一切都在浏览器里），所以这里只需要
 * 导出 apply，让 Loader 能把它当成一个合法的插件装配起来。
 */
function apply() {}

export { apply };
