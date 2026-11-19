/**
 * 大纲追加同步：作品列表新增卷章后，把该章补写进 大纲.md 的「分卷规划」段落。
 * 复用约定：写入直接调生产代码 appendChapterToOutline，读回用工作台的 parseProjectWorkspace，
 * 断言只覆盖用户可见字段，不复制格式字符串。
 * 关键约束：补写必须幂等（同卷同章序不重复插入），且只增不删——大纲是草稿，
 * 章节数允许多于作品列表，作品列表也不反向裁剪大纲。
 */
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileContent, resetWorkspaceState, setConfigValue, setFileContent } from './stubs/vscode'
import type { OutlineVolume } from '../src/workflow/press/types'
import { appendChapterToOutline } from '../src/modules/press/outlineSync'
import { parseProjectWorkspace } from '../src/workflow/press/document'

const STORAGE_ROOT = 'd:/vault'
const DIR_PATH = 'press/剑来'
const OUTLINE_PATH = path.join(STORAGE_ROOT, 'press', '剑来', '大纲.md')

/** 只喂大纲原文读回卷章：其余文档留空，断言不关心设定与人物 */
function parseOutline(outline: string): OutlineVolume[] {
    return parseProjectWorkspace(
        { readme: '', setting: '', characters: '', outline },
        { world: '', power: '', faction: '', place: '', item: '' },
        '剑来',
    ).volumes
}

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
    setFileContent(OUTLINE_PATH, '# 大纲\n\n## 主线\n\n真人真事改编。\n\n## 分卷规划\n')
})

describe('appendChapterToOutline', () => {
    it('新卷首章补写成整卷块，且不破坏其它段落', async () => {
        const isWritten = await appendChapterToOutline(DIR_PATH, {
            volumeDir: '01-默认卷',
            order: 1,
            title: '01 未命名章节',
        })

        expect(isWritten).toBe(true)
        const text = readFileContent(OUTLINE_PATH) ?? ''
        expect(text).toContain('### 第1卷 默认卷')
        expect(text).toContain('#### 第1章 未命名章节')
        expect(text).toContain('## 主线\n\n真人真事改编。')
        const volumes = parseOutline(text)
        expect(volumes).toHaveLength(1)
        expect(volumes[0]?.name).toBe('第1卷 默认卷')
        expect(volumes[0]?.chapters[0]).toMatchObject({
            order: 1,
            title: '未命名章节',
            status: 'planned',
            hook: 'none',
            wordGoal: 2500,
            wordCount: 0,
        })
    })

    it('同卷后续章节追加进已有卷块，重复同步不重复插入', async () => {
        await appendChapterToOutline(DIR_PATH, { volumeDir: '01-默认卷', order: 1, title: '01 未命名章节' })
        const isWritten = await appendChapterToOutline(DIR_PATH, {
            volumeDir: '01-默认卷',
            order: 2,
            title: '02 未命名章节',
        })

        expect(isWritten).toBe(true)
        const text = readFileContent(OUTLINE_PATH) ?? ''
        expect(parseOutline(text)[0]?.chapters.map((chapter) => chapter.order)).toEqual([1, 2])
        expect(parseOutline(text)[0]?.name).toBe('第1卷 默认卷')

        const isRepeated = await appendChapterToOutline(DIR_PATH, {
            volumeDir: '01-默认卷',
            order: 2,
            title: '02 未命名章节',
        })
        expect(isRepeated).toBe(false)
        expect(readFileContent(OUTLINE_PATH)).toBe(text)
    })

    it('大纲多出来的章节不会被作品列表裁掉', async () => {
        setFileContent(
            OUTLINE_PATH,
            [
                '# 大纲',
                '',
                '## 分卷规划',
                '',
                '### 第1卷 天都篇',
                '',
                '#### 第1章 开局',
                '',
                '#### 第2章 追兵',
                '',
                '#### 第3章 收束',
                '',
            ].join('\n'),
        )

        // 作品列表只有前两章：同步第2章时大纲里已存在，跳过且不动其余章节
        const isWritten = await appendChapterToOutline(DIR_PATH, {
            volumeDir: '01-天都篇',
            order: 2,
            title: '02 未命名章节',
        })

        expect(isWritten).toBe(false)
        const volumes = parseOutline(readFileContent(OUTLINE_PATH) ?? '')
        expect(volumes[0]?.chapters.map((chapter) => chapter.title)).toEqual(['开局', '追兵', '收束'])
    })

    it('缺少分卷规划段落时补建该段落', async () => {
        setFileContent(OUTLINE_PATH, '# 大纲\n\n## 主线\n')
        const isWritten = await appendChapterToOutline(DIR_PATH, {
            volumeDir: '02-雪原',
            order: 1,
            title: '01 未命名章节',
        })

        expect(isWritten).toBe(true)
        const text = readFileContent(OUTLINE_PATH) ?? ''
        expect(text).toContain('## 分卷规划')
        expect(text).toContain('### 第2卷 雪原')
        expect(parseOutline(text)[0]?.chapters[0]?.order).toBe(1)
    })
})
