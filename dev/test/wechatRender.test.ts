/**
 * 公众号 HTML 渲染的单元测试：覆盖样式内联、图片收集与常见块级元素。
 * 断言集中在「公众号能接受的形态」上：必须有内联样式、不得残留 style 标签、代码内容不能丢。
 * 不校验具体色值——主题可替换，断言色值会把测试与某一版主题绑死。
 */
import { describe, expect, it } from 'vitest'
import { renderWechatHtml } from '../../src/modules/wechat/render'

describe('renderWechatHtml', () => {
    it('输出正文片段并内联基础样式', async () => {
        const { html } = await renderWechatHtml('段落一\n\n段落二')
        expect(html.startsWith('<section')).toBe(true)
        expect(html).toContain('style="')
        expect(html).toContain('font-size')
    })

    it('不残留 style 标签（公众号不支持）', async () => {
        const { html } = await renderWechatHtml('# 标题\n\n正文')
        expect(html).not.toContain('<style')
        expect(html).not.toContain('class="')
    })

    it('标题与引用块都带上内联样式', async () => {
        const { html } = await renderWechatHtml('## 小标题\n\n> 引用一句')
        expect(html).toContain('<h2')
        expect(html).toContain('<blockquote')
        expect(html).toMatch(/<h2[^>]*style="/)
        expect(html).toMatch(/<blockquote[^>]*style="/)
    })

    it('表格渲染为 table 且单元格有边框样式', async () => {
        const { html } = await renderWechatHtml('| 列一 | 列二 |\n| --- | --- |\n| a | b |')
        expect(html).toContain('<table')
        expect(html).toMatch(/<td[^>]*style="[^"]*border/)
    })

    it('收集图片地址并按出现顺序去重', async () => {
        const markdown = '![一](a.png)\n\n![二](b.png)\n\n![重复](a.png)'
        const { imageUrls } = await renderWechatHtml(markdown)
        expect(imageUrls).toEqual(['a.png', 'b.png'])
    })

    it('代码块内容不会因为高亮失败而丢失', async () => {
        const { html } = await renderWechatHtml('```ts\nconst answer = 42\n```')
        expect(html).toContain('answer')
        expect(html).toContain('42')
    })

    it('自定义主题整段替换默认样式', async () => {
        const { html } = await renderWechatHtml('段落', { themeCss: 'p { color: rgb(255, 0, 0); }' })
        expect(html).toContain('rgb(255, 0, 0)')
    })
})
