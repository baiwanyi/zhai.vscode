/**
 * 公众号排版主题：默认主题 CSS，供渲染时用 juice 内联到标签上。
 * 复用约定：只写标签选择器与元素级样式（公众号不支持 class 依赖，内联后 class 也就不需要了）；
 * 渲染器可传入自定义 CSS 覆盖本默认值，主题以纯字符串维护，便于后续做主题文件与用户自定义。
 * 关键约束：不得使用伪元素、媒体查询与 CSS 变量——这些在 juice 内联与微信编辑器中都会失效；
 * 字号统一取 px，行高用无单位数值，避免不同客户端换算不一致。
 */

/**
 * 默认主题：正文 15px、行高 1.8，标题分级明显，代码与表格用浅灰底。
 * 根选择器用 section 而非 body：输出是正文片段，juice 只对内联到真实元素上的规则生效，
 * body 规则在片段里找不到宿主元素会被丢弃，正文的基础字号与行高就丢了。
 */
export const DEFAULT_WECHAT_THEME_CSS = `
section {
    font-size: 15px;
    line-height: 1.8;
    color: #333333;
    letter-spacing: 0.5px;
}
p {
    margin: 0 0 16px;
}
h1 {
    margin: 24px 0 16px;
    font-size: 22px;
    font-weight: 600;
    line-height: 1.4;
}
h2 {
    margin: 24px 0 12px;
    padding-left: 8px;
    border-left: 4px solid #576b95;
    font-size: 19px;
    font-weight: 600;
    line-height: 1.4;
}
h3 {
    margin: 20px 0 10px;
    font-size: 17px;
    font-weight: 600;
    line-height: 1.4;
}
h4, h5, h6 {
    margin: 16px 0 8px;
    font-size: 15px;
    font-weight: 600;
}
ul, ol {
    margin: 0 0 16px;
    padding-left: 22px;
}
li {
    margin: 0 0 6px;
}
blockquote {
    margin: 0 0 16px;
    padding: 8px 12px;
    border-left: 3px solid #d9d9d9;
    background-color: #f7f7f7;
    color: #666666;
}
blockquote p:last-child {
    margin-bottom: 0;
}
pre {
    margin: 0 0 16px;
    padding: 12px;
    background-color: #f6f8fa;
    border-radius: 6px;
    overflow-x: auto;
}
code {
    font-family: Consolas, Menlo, Monaco, monospace;
    font-size: 13px;
}
p code, li code {
    padding: 2px 4px;
    background-color: #f2f2f2;
    border-radius: 3px;
}
table {
    width: 100%;
    margin: 0 0 16px;
    border-collapse: collapse;
    font-size: 14px;
}
th, td {
    padding: 6px 10px;
    border: 1px solid #e0e0e0;
    text-align: left;
}
th {
    background-color: #f7f7f7;
    font-weight: 600;
}
img {
    max-width: 100%;
    height: auto;
}
a {
    color: #576b95;
    text-decoration: none;
    border-bottom: 1px solid #576b95;
}
hr {
    margin: 24px 0;
    border: none;
    border-top: 1px solid #e0e0e0;
}
`.trim()
