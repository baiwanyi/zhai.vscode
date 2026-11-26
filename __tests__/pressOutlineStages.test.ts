/**
 * 章纲草案与线索引用的纯函数测试：阶段分组、章序规整、生成上下文与线索引用回写。
 * 复用约定：直接调用生产代码的 utils，不自造夹具。
 * 关键约束：章序是线索引用依据，追加不重排、替换才规整；线索引用按写入后章序生成且不污染章块。
 */
import { describe, expect, it } from 'vitest'
import type { OutlineChapter } from '../src/workflow/press/types'
import {
    buildClueRefPatches,
    createChapter,
    createChaptersFromSeeds,
    createClue,
    createVolume,
    groupChaptersByStage,
    renumberChapters,
    toVolumeClueContexts,
} from '../src/workflow/press/utils'

/** 构造一章：只关心章序、标题与阶段，其余字段取默认值 */
function chapter(order: number, title: string, stage = ''): OutlineChapter {
    return { ...createChapter(order), order, title, stage }
}

describe('按卷生成章纲的草案落成', () => {
    it('章序从起始章序连续续排，标题统一成「第N章 标题」', () => {
        const chapters = createChaptersFromSeeds(
            [
                {
                    stage: '第一阶段：坠楼与觉醒',
                    title: '坠楼之后',
                    summary: '宋雪坠楼，宋钟被诬入狱。',
                    beats: ['宋雪坠楼', '宋钟被带走'],
                    clueRefs: [],
                },
                {
                    stage: '第一阶段：坠楼与觉醒',
                    title: '第2章 哑巴不死',
                    summary: '濒死觉醒系统。',
                    beats: [],
                    clueRefs: [],
                },
            ],
            3,
        )

        expect(chapters.map((item) => item.order)).toEqual([3, 4])
        expect(chapters.map((item) => item.title)).toEqual(['坠楼之后', '哑巴不死'])
        expect(chapters.map((item) => item.stage)).toEqual(['第一阶段：坠楼与觉醒', '第一阶段：坠楼与觉醒'])
        expect(chapters[0]?.summary).toBe('宋雪坠楼，宋钟被诬入狱。')
    })

    it('草案只写阶段、标题、梗概与节拍，其余字段取默认值', () => {
        const [chapter0] = createChaptersFromSeeds(
            [{ stage: '', title: '开局', summary: '开场', beats: [], clueRefs: [] }],
            1,
        )

        expect(chapter0).toMatchObject({ pov: '', goal: '', characterIds: [], wordCount: 0 })
        // 没有细纲时保留一条空节拍，作者可直接落笔
        expect(chapter0?.beats).toHaveLength(1)
    })

    it('生成结果里的节拍按顺序写进章纲', () => {
        const [chapter0] = createChaptersFromSeeds(
            [{ stage: '', title: '开局', summary: '开场', beats: ['坠楼', '被诬入狱', ''], clueRefs: [] }],
            1,
        )

        expect(chapter0?.beats.map((beat) => beat.text)).toEqual(['坠楼', '被诬入狱'])
        expect(chapter0?.beats.every((beat) => !beat.isDone)).toBe(true)
    })

    it('线索关联只用于回写线索表，不落进章块', () => {
        const [chapter0] = createChaptersFromSeeds(
            [
                {
                    stage: '',
                    title: '开局',
                    summary: '开场',
                    beats: [],
                    clueRefs: [{ id: 'clue-1', action: 'plant' }],
                },
            ],
            1,
        )

        expect(chapter0).not.toHaveProperty('clueRefs')
    })
})

describe('结构与伏笔参与章纲生成', () => {
    it('线索引用按写入后的章序生成，同一线索以最后一章为准', () => {
        const patches = buildClueRefPatches(
            [
                {
                    stage: '',
                    title: '埋设',
                    summary: '',
                    beats: [],
                    clueRefs: [{ id: 'clue-1', action: 'plant' }],
                },
                {
                    stage: '',
                    title: '回收',
                    summary: '',
                    beats: [],
                    clueRefs: [{ id: 'clue-1', action: 'payoff' }],
                },
            ],
            3,
            2,
        )

        expect(patches.get('clue-1')).toEqual({
            plant: { volumeOrder: 2, chapterOrder: 3 },
            payoff: { volumeOrder: 2, chapterOrder: 4 },
        })
    })

    it('本卷线索只取埋设章或回收章落在本卷的条目，章节引用写「卷序-章序」', () => {
        const first = { ...createVolume(), id: 'v1', name: '第1卷 觉醒' }
        const second = { ...createVolume(), id: 'v2', name: '第2卷 清算' }
        const inFirst = {
            ...createClue('玉牌裂纹'),
            id: 'clue-1',
            plant: { volumeOrder: 1, chapterOrder: 2 },
            payoff: { volumeOrder: 2, chapterOrder: 3 },
        }
        const elsewhere = {
            ...createClue('无名信'),
            id: 'clue-2',
            plant: { volumeOrder: 3, chapterOrder: 1 },
            payoff: null,
        }

        expect(toVolumeClueContexts([inFirst, elsewhere], [first, second], 'v1')).toEqual([
            { id: 'clue-1', name: '玉牌裂纹', plant: '1-2', payoff: '2-3', note: '' },
        ])
    })
})

describe('卷内章序规整', () => {
    it('带「第N章」前缀的标题按新章序重写，节拍与阶段保持不动', () => {
        const renumbered = renumberChapters([
            chapter(3, '第3章 余波', '第二阶段：清算'),
            chapter(7, '第7章 收网', '第二阶段：清算'),
        ])

        expect(renumbered.map((item) => item.order)).toEqual([1, 2])
        expect(renumbered.map((item) => item.title)).toEqual(['余波', '收网'])
        expect(renumbered.map((item) => item.stage)).toEqual(['第二阶段：清算', '第二阶段：清算'])
    })

    it('作者自写的无前缀标题保持原样，不凭空加序号', () => {
        const renumbered = renumberChapters([chapter(5, '楔子'), chapter(9, '尾声')])

        expect(renumbered.map((item) => item.title)).toEqual(['楔子', '尾声'])
        expect(renumbered.map((item) => item.order)).toEqual([1, 2])
    })
})

describe('阶段分组', () => {
    it('组序按阶段首次出现，未填阶段的章归入末尾的未分组', () => {
        const groups = groupChaptersByStage([
            chapter(1, '第一章', '第一阶段：觉醒'),
            chapter(2, '第二章', '第二阶段：清算'),
            chapter(3, '第三章'),
            chapter(4, '第四章', '第一阶段：觉醒'),
        ])

        expect(groups.map((group) => group.stage)).toEqual(['第一阶段：觉醒', '第二阶段：清算', ''])
        expect(groups[0]?.chapters.map((item) => item.order)).toEqual([1, 4])
        expect(groups[2]?.chapters.map((item) => item.order)).toEqual([3])
    })

    it('全部未填阶段时只有一个未分组', () => {
        const groups = groupChaptersByStage([chapter(1, '第一章'), chapter(2, '第二章')])

        expect(groups).toHaveLength(1)
        expect(groups[0]?.stage).toBe('')
        expect(groups[0]?.chapters).toHaveLength(2)
    })
})
