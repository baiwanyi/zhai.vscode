/**
 * 编辑器文档快照与区间回写：验证 frontmatter 分离、块偏移、只读判定、块差异定位与按偏移替换。
 * 复用约定：直接调用 editorDocService 与 blockDiff 的纯函数，不触碰 vscode API 与文件系统；
 * 断言全部基于原文切片，确保偏移与 TextDocument 内容同源。
 * 关键约束：不再做整篇白名单判定——只读会让链接、划线、回车一起失效，任何文档都以可编辑状态打开；
 * 管线渲染不出的节点按纯文本段落呈现，既不设源码块标识也不能少块（少一块后面偏移全错位）；
 * 块差异必须按内容对齐而不是按下标，插入 / 删除块后下标错位会把内容写到别的段落上。
 */
import { describe, expect, it } from 'vitest'
import { applyBlockEdits, buildEdits, readEditorSnapshot, splitFrontmatter } from '@modules/editor/editorDocService'
import { buildBlockChanges } from '@webview/editor/blocks/blockDiff'

const SAMPLE_DOC = [
    '---',
    'title: 第一章',
    'status: draft',
    '---',
    '',
    '开头一段。',
    '',
    '## 小标题',
    '',
    '结尾一段。',
].join('\n')

describe('splitFrontmatter', () => {
    it('分离 frontmatter 并给出正文偏移', () => {
        const result = splitFrontmatter(SAMPLE_DOC)
        expect(result.frontmatter.startsWith('---')).toBe(true)
        expect(result.frontmatter.endsWith('---\n')).toBe(true)
        expect(result.offset).toBe(result.frontmatter.length)
        expect(SAMPLE_DOC.slice(result.offset)).toBe(result.body)
    })

    it('无 frontmatter 时正文即全文', () => {
        expect(splitFrontmatter('只有正文')).toEqual({ frontmatter: '', body: '只有正文', offset: 0 })
    })
})

describe('readEditorSnapshot', () => {
    it('按顶层块切分，偏移可还原原文', async () => {
        const snapshot = await readEditorSnapshot(SAMPLE_DOC, 7, 'press/某作品/01-第一章.md')
        expect(snapshot.version).toBe(7)
        expect(snapshot.blocks).toHaveLength(3)
        expect(snapshot.editable).toBe(true)
        for (const block of snapshot.blocks) {
            expect(SAMPLE_DOC.slice(block.start, block.end).trim().length).toBeGreaterThan(0)
        }
    })

    it('标题块渲染为 h2', async () => {
        const snapshot = await readEditorSnapshot(SAMPLE_DOC, 1, 'x.md')
        const heading = snapshot.blocks[1]
        expect(heading?.html).toContain('<h2>')
    })

    it('无对齐的表格可编辑，且单元格内容被包成段落', async () => {
        const snapshot = await readEditorSnapshot('| a | b |\n| - | - |\n| 1 | 2 |', 1, 'x.md')
        expect(snapshot.editable).toBe(true)
        const html = snapshot.blocks[0]?.html ?? ''
        expect(html).toContain('<table')
        expect(html).toContain('<p>a</p>')
    })

    it('带对齐标记的表格同样以可编辑状态打开', async () => {
        // 曾经整篇转只读；只读会让链接、划线、回车一起失效，现在不再做整篇白名单判定
        const snapshot = await readEditorSnapshot('| a | b |\n| :-- | --: |\n| 1 | 2 |', 1, 'x.md')
        expect(snapshot.editable).toBe(true)
        expect(snapshot.blocks[0]?.html).toContain('<table')
    })

    it('任务列表转成 Tiptap 可识别的结构', async () => {
        const snapshot = await readEditorSnapshot('- [ ] 待办\n- [x] 完成', 1, 'x.md')
        expect(snapshot.editable).toBe(true)
        const html = snapshot.blocks[0]?.html ?? ''
        expect(html).toContain('data-type="taskList"')
        expect(html).toContain('data-checked="false"')
        expect(html).toContain('data-checked="true"')
    })

    it('任务项内嵌列表时仍可编辑', async () => {
        const snapshot = await readEditorSnapshot('- [ ] 待办\n  - 子项', 1, 'x.md')
        expect(snapshot.editable).toBe(true)
    })

    it('裸地址不再自动识别为链接，显式语法仍保留', async () => {
        // 回归：GFM 的 autolink literal 会把裸 URL 重新识别成链接，
        // 取消链接写回裸地址后又被还原，看起来就是「取消不掉」
        const bare = await readEditorSnapshot('见 https://example.com 说明', 1, 'x.md')
        expect(bare.blocks[0]?.html ?? '').not.toContain('<a ')
        const explicit = await readEditorSnapshot('见[文档](https://example.com)说明', 1, 'x.md')
        expect(explicit.blocks[0]?.html ?? '').toContain('href="https://example.com"')
        const angle = await readEditorSnapshot('见 <https://example.com> 说明', 1, 'x.md')
        expect(angle.blocks[0]?.html ?? '').toContain('href="https://example.com"')
    })

    it('链接段落可编辑，回写保留链接语法', async () => {
        const source = '见[文档](https://example.com)。'
        const snapshot = await readEditorSnapshot(source, 1, 'x.md')
        expect(snapshot.editable).toBe(true)
        const html = snapshot.blocks[0]?.html ?? ''
        expect(html).toContain('href="https://example.com"')
        const edits = await buildEdits(source, [{ start: 0, end: source.length, htmls: [html] }])
        expect(edits[0]?.text).toBe('见[文档](https://example.com)。')
    })

    it('原始 HTML 块按纯文本呈现，不丢块也不出现源码块标识', async () => {
        // 回归：管线不认识 html 节点时会渲染成空串，块序列比宿主短一格，
        // 后面所有块的偏移整体错位；现在改为转义成段落文字，既不设只读也不显示源码块
        const source = '<div class="note">手写块</div>\n\n正常段落'
        const snapshot = await readEditorSnapshot(source, 1, 'x.md')
        expect(snapshot.editable).toBe(true)
        expect(snapshot.blocks).toHaveLength(2)
        expect(snapshot.blocks[0]?.html).toContain('&lt;div')
        expect(snapshot.blocks[0]?.html).not.toContain('zhai-source-block')
        expect(snapshot.blocks[1]?.html).toContain('正常段落')
    })

    it('链接定义渲染为空时仍保留一个纯文本块', async () => {
        const source = '[文档]: https://example.com\n\n正文'
        const snapshot = await readEditorSnapshot(source, 1, 'x.md')
        expect(snapshot.blocks).toHaveLength(2)
        expect(snapshot.blocks[0]?.html.length).toBeGreaterThan(0)
    })

    it('独立成段的链接与代码块混排也可编辑', async () => {
        // 回归：带链接的模板文档一度整篇只读，链接现在放开
        const source = [
            '## 安装',
            '',
            '```',
            'npx @tiptap/cli init',
            '```',
            '',
            '[查看全文](https://example.com/demo)',
            '',
        ].join('\n')
        const snapshot = await readEditorSnapshot(source, 1, 'x.md')
        expect(snapshot.editable).toBe(true)
        expect(snapshot.blocks.some((block) => block.html.includes('<a href='))).toBe(true)
        expect(snapshot.blocks.some((block) => block.html.includes('<pre'))).toBe(true)
    })
})

describe('buildBlockChanges', () => {
    const BASELINE = [
        { html: '<p>甲</p>', start: 0, end: 1 },
        { html: '<p>乙</p>', start: 3, end: 4 },
    ]

    it('内容全未变时不产生变更', () => {
        expect(buildBlockChanges(['<p>甲</p>', '<p>乙</p>'], BASELINE)).toHaveLength(0)
    })

    it('中间插入新块：锚点落在前一块的 end，后续块不被错位', () => {
        const changes = buildBlockChanges(['<p>甲</p>', '<table></table>', '<p>乙</p>'], BASELINE)
        expect(changes).toEqual([{ start: 1, end: 1, htmls: ['<table></table>'] }])
    })

    it('末尾新增块：锚点落在最后一块的 end', () => {
        const changes = buildBlockChanges(['<p>甲</p>', '<p>乙</p>', '<p>丙</p>'], BASELINE)
        expect(changes).toEqual([{ start: 4, end: 4, htmls: ['<p>丙</p>'] }])
    })

    it('最前面插入块：锚点落在第一块的 start', () => {
        const changes = buildBlockChanges(['<p>序</p>', '<p>甲</p>', '<p>乙</p>'], BASELINE)
        expect(changes).toEqual([{ start: 0, end: 0, htmls: ['<p>序</p>'] }])
    })

    it('替换块：区间即该块原文', () => {
        const changes = buildBlockChanges(['<p>甲</p>', '<p>乙改</p>'], BASELINE)
        expect(changes).toEqual([{ start: 3, end: 4, htmls: ['<p>乙改</p>'] }])
    })

    it('删除块：区间覆盖被删块且 htmls 为空', () => {
        const changes = buildBlockChanges(['<p>甲</p>'], BASELINE)
        expect(changes).toEqual([{ start: 3, end: 4, htmls: [] }])
    })

    it('基线为空（空文档）时锚点为 0', () => {
        const changes = buildBlockChanges(['<p>第一段</p>'], [])
        expect(changes).toEqual([{ start: 0, end: 0, htmls: ['<p>第一段</p>'] }])
    })
})

describe('buildEdits', () => {
    it('按区间替换，偏移原样用于写入', async () => {
        const source = '第一段\n\n第二段'
        const snapshot = await readEditorSnapshot(source, 1, 'x.md')
        const target = snapshot.blocks[1]
        expect(target).toBeDefined()
        const edits = await buildEdits(source, [
            { start: target?.start ?? 0, end: target?.end ?? 0, htmls: ['<p>改动后的第二段</p>'] },
        ])
        expect(edits).toHaveLength(1)
        expect(edits[0]?.start).toBe(target?.start)
        expect(edits[0]?.end).toBe(target?.end)
        expect(edits[0]?.text).toBe('改动后的第二段')
    })

    it('纯插入时给新块补空行分隔', async () => {
        const source = '只有一段'
        const edits = await buildEdits(source, [
            { start: source.length, end: source.length, htmls: ['<p>新增的一段</p>'] },
        ])
        expect(applyBlockEdits(source, edits)).toBe('只有一段\n\n新增的一段')
    })

    it('空区间的空内容不产生写入', async () => {
        const edits = await buildEdits('只有一段', [{ start: 4, end: 4, htmls: ['<p></p>'] }])
        expect(edits).toHaveLength(0)
    })

    it('越界区间被丢弃', async () => {
        const edits = await buildEdits('只有一段', [{ start: 0, end: 99, htmls: ['<p>x</p>'] }])
        expect(edits).toHaveLength(0)
    })

    it('重叠区间只保留一条', async () => {
        const edits = await buildEdits('第一段\n\n第二段', [
            { start: 0, end: 3, htmls: ['<p>改一</p>'] },
            { start: 2, end: 8, htmls: ['<p>改二</p>'] },
        ])
        expect(edits).toHaveLength(1)
    })

    it('块上的运行期 id 不会写进 Markdown', async () => {
        const edits = await buildEdits('第一段', [{ start: 0, end: 3, htmls: ['<p id="blk-9f2a">改后的正文</p>'] }])
        expect(edits).toHaveLength(1)
        expect(edits[0]?.text).toBe('改后的正文')
        expect(edits[0]?.text).not.toContain('id=')
    })

    it('删除线回写成 GFM 语法，不因未知节点失败', async () => {
        // 回归：stringify 管线缺 GFM 扩展时会抛 `Cannot handle unknown node 'delete'`，
        // 含删除线的段落一被编辑就整块写不回去（Strike 渲染成 <s>）
        const edits = await buildEdits('第一段', [{ start: 0, end: 3, htmls: ['<p>正常<s>删掉</s>尾巴</p>'] }])
        expect(edits).toHaveLength(1)
        expect(edits[0]?.text).toBe('正常~~删掉~~尾巴')
    })

    it('图片段落可编辑，且保留 @zhai 原始引用', async () => {
        const snapshot = await readEditorSnapshot('![山](@zhai/uploads/202611/a.png)', 1, 'x.md')
        expect(snapshot.editable).toBe(true)
        const html = snapshot.blocks[0]?.html ?? ''
        expect(html).toContain('<img')
        expect(html).toContain('@zhai/uploads/202611/a.png')
    })

    it('图片回写成原始引用，不出现 webview 地址', async () => {
        const edits = await buildEdits('第一段', [
            { start: 0, end: 3, htmls: ['<p><img src="@zhai/uploads/202611/a.png" alt="山"></p>'] },
        ])
        expect(edits[0]?.text).toBe('![山](@zhai/uploads/202611/a.png)')
        expect(edits[0]?.text).not.toContain('vscode-resource')
    })

    it('表格回写成 GFM 表格', async () => {
        const source = '| a |\n| - |\n| 1 |'
        const html =
            '<table><tbody><tr><th><p>列一</p></th><th><p>列二</p></th></tr><tr><td><p>甲</p></td><td><p>乙</p></td></tr></tbody></table>'
        const edits = await buildEdits(source, [{ start: 0, end: source.length, htmls: [html] }])
        expect(edits[0]?.text).toBe('| 列一 | 列二 |\n| --- | --- |\n| 甲 | 乙 |')
    })

    it('合并单元格的表格放弃改写，区间不清空原文', async () => {
        const source = '| a |\n| - |\n| 1 |'
        const html =
            '<table><tbody><tr><th colspan="2"><p>跨列</p></th></tr><tr><td><p>甲</p></td><td><p>乙</p></td></tr></tbody></table>'
        const edits = await buildEdits(source, [{ start: 0, end: source.length, htmls: [html] }])
        expect(edits).toHaveLength(0)
    })

    it('任务列表回写成 GFM 语法且不带转义', async () => {
        const html =
            '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked="checked"><span></span></label><div><p>已完成</p></div></li><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>未完成</p></div></li></ul>'
        const source = '- [ ] 待办'
        const edits = await buildEdits(source, [{ start: 0, end: source.length, htmls: [html] }])
        expect(edits[0]?.text).toBe('- [x] 已完成\n- [ ] 未完成')
    })

    it('多区间按偏移倒序排列，便于从后往前应用', async () => {
        const source = '第一段\n\n第二段\n\n第三段'
        const edits = await buildEdits(source, [
            { start: 0, end: 3, htmls: ['<p>改一</p>'] },
            { start: 10, end: 13, htmls: ['<p>改三</p>'] },
        ])
        expect(edits).toHaveLength(2)
        expect(edits[0]?.start).toBeGreaterThan(edits[1]?.start ?? 0)
        expect(applyBlockEdits(source, edits)).toBe('改一\n\n第二段\n\n改三')
    })
})

describe('applyBlockEdits', () => {
    it('倒序应用替换后得到预期全文，未编辑块保持原样', async () => {
        const source = '第一段\n\n第二段\n\n第三段'
        const snapshot = await readEditorSnapshot(source, 1, 'x.md')
        const [first, , third] = snapshot.blocks
        const edits = await buildEdits(source, [
            { start: first?.start ?? 0, end: first?.end ?? 0, htmls: ['<p>改一</p>'] },
            { start: third?.start ?? 0, end: third?.end ?? 0, htmls: ['<p>改三</p>'] },
        ])
        expect(applyBlockEdits(source, edits)).toBe('改一\n\n第二段\n\n改三')
    })

    it('无变化的清单不改变原文', () => {
        expect(applyBlockEdits('原文', [])).toBe('原文')
    })
})
