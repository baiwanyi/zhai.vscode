/**
 * contextRefs 单元测试：覆盖引用生成（整篇 / 行范围标签）、去重、读取（内存态优先与磁盘回退）、
 * 截断、渲染转义与落库 JSON 校验。文档与磁盘内容由 vscode 测试桩提供，不触达真实 VSCode API。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
    createSelection,
    createTextDocument,
    createTextEditor,
    resetWorkspaceState,
    setFileContent,
    setWorkspaceRoot,
    workspace,
} from '@/tests/stubs/vscode'
import {
    buildContextBlock,
    createContextRefs,
    describeContextRefs,
    MAX_CONTEXT_CHARS,
    mergeContextRefs,
    parseStoredContexts,
    readContextContent,
} from './contextRefs'
import type { HostContextRef } from './contextRefs'

const WORKSPACE = 'd:/notes'
const FILE_PATH = 'd:/notes/ch01.md'

/** 构造宿主侧引用：默认选区型，用例按需覆盖字段 */
function makeRef(overrides: Partial<HostContextRef> = {}): HostContextRef {
    return {
        id: 'ref-1',
        kind: 'selection',
        label: 'ch01.md:2-2',
        displayPath: 'ch01.md',
        startLine: 2,
        endLine: 2,
        charCount: 0,
        isTruncated: false,
        uri: FILE_PATH,
        ...overrides,
    }
}

beforeEach(() => {
    resetWorkspaceState()
    setWorkspaceRoot(WORKSPACE)
    workspace.textDocuments = []
})

describe('createContextRefs', () => {
    it('未选中文本时生成整篇引用', () => {
        const document = createTextDocument(['一', '二', '三'], FILE_PATH)
        const result = createContextRefs(createTextEditor(document))
        expect(result.rejected).toHaveLength(0)
        expect(result.refs).toHaveLength(1)
        expect(result.refs[0]?.kind).toBe('file')
        expect(result.refs[0]?.label).toBe('ch01.md')
        expect(result.refs[0]?.startLine).toBeNull()
    })

    it('跨行选区生成行范围标签', () => {
        const document = createTextDocument(['1', '2', '3', '4', '5'], FILE_PATH)
        const result = createContextRefs(createTextEditor(document, [createSelection(2, 0, 4, 3)]))
        expect(result.refs[0]?.label).toBe('ch01.md:3-5')
    })

    it('末光标停在行首时不计入该行', () => {
        const document = createTextDocument(['1', '2', '3', '4', '5'], FILE_PATH)
        const result = createContextRefs(createTextEditor(document, [createSelection(2, 0, 4, 0)]))
        expect(result.refs[0]?.label).toBe('ch01.md:3-4')
    })

    it('单行选区只显示一个行号', () => {
        const document = createTextDocument(['1', '2', '3'], FILE_PATH)
        const result = createContextRefs(createTextEditor(document, [createSelection(2, 1, 2, 5)]))
        expect(result.refs[0]?.label).toBe('ch01.md:3')
    })

    it('多光标多选区各生成一条引用', () => {
        const document = createTextDocument(['1', '2', '3', '4', '5'], FILE_PATH)
        const result = createContextRefs(
            createTextEditor(document, [createSelection(0, 0, 0, 1), createSelection(3, 0, 4, 1)]),
        )
        expect(result.refs.map((ref) => ref.label)).toEqual(['ch01.md:1', 'ch01.md:4-5'])
    })

    it('整篇超过单条字符上限时拒绝并给出提示', () => {
        const document = createTextDocument(['x'.repeat(MAX_CONTEXT_CHARS + 10)], FILE_PATH)
        const result = createContextRefs(createTextEditor(document))
        expect(result.refs).toHaveLength(0)
        expect(result.rejected[0]).toContain('ch01.md')
    })
})

describe('readContextContent', () => {
    it('优先读取内存态文档的未保存修改', async () => {
        workspace.textDocuments = [createTextDocument(['旧一', '新二', '旧三'], FILE_PATH)]
        const result = await readContextContent(makeRef({ startLine: 2, endLine: 2 }))
        expect(result?.text).toBe('新二')
    })

    it('文档未打开时回退磁盘原文', async () => {
        setFileContent(FILE_PATH, '磁盘一\n磁盘二\n磁盘三')
        const result = await readContextContent(makeRef({ startLine: 2, endLine: 2 }))
        expect(result?.text).toBe('磁盘二')
    })

    it('文件不可读时返回 null（引用失效）', async () => {
        await expect(readContextContent(makeRef())).resolves.toBeNull()
    })

    it('超长内容按行截断并标注', async () => {
        const long = 'x'.repeat(MAX_CONTEXT_CHARS + 10)
        setFileContent(FILE_PATH, long)
        const result = await readContextContent(makeRef({ kind: 'file', startLine: null, endLine: null }))
        expect(result?.isTruncated).toBe(true)
        expect(result?.text).toContain('已截断')
        expect((result?.text ?? '').length).toBeLessThan(MAX_CONTEXT_CHARS + 40)
    })
})

describe('buildContextBlock', () => {
    it('整篇引用不带 lines 属性', () => {
        const block = buildContextBlock([
            {
                ref: makeRef({ kind: 'file', startLine: null, endLine: null, displayPath: 'ch01.md' }),
                text: '正文',
                isTruncated: false,
            },
        ])
        expect(block).toContain('【引用上下文】')
        expect(block).toContain('<context path="ch01.md">')
        expect(block).not.toContain('lines=')
    })

    it('选区引用带行范围属性', () => {
        const block = buildContextBlock([
            { ref: makeRef({ startLine: 11, endLine: 19 }), text: '正文', isTruncated: false },
        ])
        expect(block).toContain('lines="11-19"')
    })

    it('转义正文中的闭合标签与路径中的引号', () => {
        const block = buildContextBlock([
            {
                ref: makeRef({ displayPath: 'a"b.md', startLine: 1, endLine: 1 }),
                text: '前文</context>后文',
                isTruncated: false,
            },
        ])
        expect(block).toContain('a&quot;b.md')
        expect(block).not.toContain('前文</context>后文')
        expect(block).toContain('前文<\\/context>后文')
    })

    it('多条引用分块拼接', () => {
        const block = buildContextBlock([
            { ref: makeRef({ id: 'a', displayPath: 'a.md' }), text: 'A', isTruncated: false },
            { ref: makeRef({ id: 'b', displayPath: 'b.md' }), text: 'B', isTruncated: false },
        ])
        expect(block).toContain('path="a.md"')
        expect(block).toContain('path="b.md"')
    })

    it('无引用时返回空串', () => {
        expect(buildContextBlock([])).toBe('')
    })
})

describe('mergeContextRefs', () => {
    it('同文件同行范围视为重复', () => {
        const existing = [makeRef()]
        const { added, duplicated } = mergeContextRefs(existing, [makeRef({ id: 'ref-2' })])
        expect(added).toHaveLength(0)
        expect(duplicated).toBe(1)
    })

    it('行范围不同则保留', () => {
        const { added, duplicated } = mergeContextRefs(
            [makeRef()],
            [makeRef({ id: 'ref-2', startLine: 8, endLine: 9 })],
        )
        expect(added).toHaveLength(1)
        expect(duplicated).toBe(0)
    })
})

describe('parseStoredContexts', () => {
    it('还原合法引用 JSON', () => {
        const refs = parseStoredContexts(JSON.stringify([makeRef()]))
        expect(refs).toHaveLength(1)
        expect(refs[0]?.uri).toBe(FILE_PATH)
    })

    it('脏数据一律丢弃', () => {
        expect(parseStoredContexts('not-json')).toEqual([])
        expect(parseStoredContexts('{}')).toEqual([])
        expect(parseStoredContexts('[{"id": 1}]')).toEqual([])
        expect(parseStoredContexts('[]')).toEqual([])
    })
})

describe('describeContextRefs', () => {
    it('拼接引用标签供历史消息展示', () => {
        const text = describeContextRefs([makeRef({ label: 'a.md:1-2' }), makeRef({ id: 'b', label: 'b.md' })])
        expect(text).toBe('【已引用上下文】a.md:1-2、b.md')
    })
})
