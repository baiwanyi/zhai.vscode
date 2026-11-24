/**
 * 提取范围按作品卷章定位：选项由作品详情构建，范围提取只刷新同卷同位置的大纲章。
 * 复用约定：选项构建与刷新都直接调生产代码，断言只看用户可见字段，不复制格式字符串。
 * 关键约束：大纲允许比作品多章，刷新不得按全局章序——多出的章必须保持原样；
 * 作品草案的卷名可能是目录口径（01-天都篇），卷序解析要兼容「第N卷」与序号前缀两种写法。
 */
import { describe, expect, it } from 'vitest'
import type { PressExtractedChapter, PressExtractedVolume, PressVolumeGroup } from '../src/shared/types/press'
import type { OutlineChapter, OutlineVolume } from '../src/workflow/press/types'
import {
    createOutlineFromDraft,
    createProjectChapterOptions,
    refreshOutlineChapters,
} from '../src/workflow/press/utils'

/** 作品详情里的卷分组：第一卷一整卷，第二组是历史散章（未分卷） */
const PROJECT_VOLUMES: PressVolumeGroup[] = [
    {
        name: '天都篇',
        dirName: '01-天都篇',
        chapters: [
            { path: 'press/剑来/Chapters/01-天都篇/01-开局.md', title: '开局', wordCount: 100, mtime: '' },
            { path: 'press/剑来/Chapters/01-天都篇/02-追兵.md', title: '追兵', wordCount: 200, mtime: '' },
        ],
    },
    {
        name: '',
        dirName: '',
        chapters: [{ path: 'press/剑来/Chapters/01-散章.md', title: '散章', wordCount: 50, mtime: '' }],
    },
]

/** 素材草案里的一章：只填断言用得到的字段 */
function draftChapter(order: number, title: string): PressExtractedChapter {
    return {
        order,
        title,
        summary: `${title}的梗概`,
        hook: '悬念',
        tension: 4,
        wordCount: 1200,
        beats: [`${title}的节点`],
        characters: [],
    }
}

/** 素材草案：卷名沿用目录口径，与宿主的产出保持一致 */
const DRAFTS: PressExtractedVolume[] = [
    {
        name: '01-天都篇',
        coreEvent: '',
        mainPlot: [],
        turningPoints: [],
        chapters: [draftChapter(1, '素材开局'), draftChapter(2, '素材追兵')],
    },
    {
        name: '02-雪原',
        coreEvent: '',
        mainPlot: [],
        turningPoints: [],
        chapters: [draftChapter(3, '素材雪原')],
    },
]

/** 大纲里的一章：标题即断言基线 */
function outlineChapter(order: number, title: string): OutlineChapter {
    return {
        id: `ch-${String(order)}-${title}`,
        order,
        title,
        stage: '',
        summary: '',
        actualSummary: '',
        status: 'planned',
        beats: [],
        scenes: [],
        pov: '',
        goal: '',
        obstacle: '',
        turn: '',
        result: '',
        emotion: '',
        characterIds: [],
        location: '',
        wordGoal: 2500,
        wordCount: 0,
        hook: 'none',
        pacing: 'setup',
        tension: 3,
        granularity: 'medium',
    }
}

/** 现有大纲：第一卷比作品多一章，第二卷各一章 */
const CURRENT: OutlineVolume[] = [
    {
        id: 'vol-1',
        name: '第1卷 天都篇',
        expectedChapters: 3,
        coreEvent: '',
        mainPlot: [],
        turningPoints: [],
        result: '',
        granularity: 'medium',
        chapters: [outlineChapter(1, '开局'), outlineChapter(2, '追兵'), outlineChapter(3, '多出的一章')],
    },
    {
        id: 'vol-2',
        name: '第2卷 雪原',
        expectedChapters: 1,
        coreEvent: '',
        mainPlot: [],
        turningPoints: [],
        result: '',
        granularity: 'medium',
        chapters: [outlineChapter(1, '雪原')],
    },
]

describe('createProjectChapterOptions', () => {
    it('按作品卷章摊平，卷序取目录前缀，未分卷归到下一卷序', () => {
        const options = createProjectChapterOptions(PROJECT_VOLUMES)

        expect(options.map((option) => option.order)).toEqual([1, 2, 3])
        expect(options[0]).toMatchObject({
            volumeOrder: 1,
            chapterIndex: 1,
            volumeId: '01-天都篇',
            volumeLabel: '天都篇',
            title: '开局',
            label: '天都篇 · 开局',
        })
        expect(options[1]).toMatchObject({ volumeOrder: 1, chapterIndex: 2, title: '追兵' })
        // 未分卷组：卷序按数组位置兜底，卷筛选取值不能是空串
        expect(options[2]).toMatchObject({
            volumeOrder: 2,
            chapterIndex: 1,
            volumeId: 'unassigned',
            volumeLabel: '未分卷',
            title: '散章',
        })
    })

    it('作品没有章节时返回空数组', () => {
        expect(createProjectChapterOptions([])).toEqual([])
        expect(createProjectChapterOptions([{ name: '空卷', dirName: '01-空卷', chapters: [] }])).toEqual([])
    })
})

describe('createOutlineFromDraft', () => {
    it('素材草案的核心事件与主要情节直接落进卷纲', () => {
        const [volume] = createOutlineFromDraft(
            [
                {
                    name: '01-天都篇',
                    coreEvent: '本卷目标；与旧城改造集团正面相撞',
                    mainPlot: ['客人送来旧表', '档案被抽走'],
                    turningPoints: ['编号确认'],
                    chapters: [draftChapter(1, '开局')],
                },
            ],
            2500,
        )

        expect(volume).toMatchObject({
            expectedChapters: 1,
            coreEvent: '本卷目标；与旧城改造集团正面相撞',
            mainPlot: ['客人送来旧表', '档案被抽走'],
            turningPoints: ['编号确认'],
            result: '',
            granularity: 'medium',
        })
        expect(volume?.chapters[0]?.title).toBe('开局')
    })
})

describe('refreshOutlineChapters', () => {
    it('只刷新指定卷章位置的章纲，其它卷不受影响', () => {
        const { volumes, refreshed } = refreshOutlineChapters(
            CURRENT,
            DRAFTS,
            [{ volumeOrder: 2, chapterIndex: 1 }],
            2500,
        )

        expect(refreshed).toBe(1)
        expect(volumes[0]?.chapters.map((chapter) => chapter.title)).toEqual(['开局', '追兵', '多出的一章'])
        expect(volumes[1]?.chapters[0]).toMatchObject({
            title: '素材雪原',
            summary: '素材雪原的梗概',
            hook: 'suspense',
            tension: 4,
            wordCount: 1200,
        })
    })

    it('大纲比作品多出的章保持原样，不会被素材清空或删除', () => {
        const { volumes, refreshed } = refreshOutlineChapters(
            CURRENT,
            DRAFTS,
            [
                { volumeOrder: 1, chapterIndex: 2 },
                { volumeOrder: 1, chapterIndex: 3 },
            ],
            2500,
        )

        expect(refreshed).toBe(1)
        expect(volumes[0]?.chapters.map((chapter) => chapter.title)).toEqual(['开局', '素材追兵', '多出的一章'])
        // 章 id、状态等结构字段一律沿用现有草稿
        expect(volumes[0]?.chapters[1]?.id).toBe('ch-2-追兵')
        expect(volumes[0]?.chapters[1]?.status).toBe('planned')
    })

    it('卷名与草案对不上时不刷新，返回 0', () => {
        const { volumes, refreshed } = refreshOutlineChapters(
            CURRENT,
            DRAFTS,
            [{ volumeOrder: 9, chapterIndex: 1 }],
            2500,
        )

        expect(refreshed).toBe(0)
        expect(volumes).toEqual(CURRENT)
    })
})
