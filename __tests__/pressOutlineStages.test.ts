/**
 * 卷纲与章纲联动的纯函数：阶段分组的章序规则、草案落成章纲、章序规整。
 * 复用约定：直接调用生产代码的 utils，不自造夹具；断言只覆盖用户可见字段（章序、标题、阶段、梗概）。
 * 关键约束：章序是线索与时间线的引用依据——「追加不重排、替换才规整」这两条规则一旦反向，
 * 已写章节的章序会漂移；无前缀标题不得被强行加上「第N章」。
 */
import { describe, expect, it } from 'vitest'
import type { OutlineChapter } from '../src/workflow/press/types'
import {
    createChaptersFromSeeds,
    createChapter,
    groupChaptersByStage,
    renumberChapters,
} from '../src/workflow/press/utils'

/** 构造一章：只关心章序、标题与阶段，其余字段取默认值 */
function chapter(order: number, title: string, stage = ''): OutlineChapter {
    return { ...createChapter(order, 2500), order, title, stage }
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
                },
                {
                    stage: '第一阶段：坠楼与觉醒',
                    title: '第2章 哑巴不死',
                    summary: '濒死觉醒系统。',
                    beats: [],
                },
            ],
            3,
            2500,
        )

        expect(chapters.map((item) => item.order)).toEqual([3, 4])
        expect(chapters.map((item) => item.title)).toEqual(['坠楼之后', '哑巴不死'])
        expect(chapters.map((item) => item.stage)).toEqual(['第一阶段：坠楼与觉醒', '第一阶段：坠楼与觉醒'])
        expect(chapters[0]?.summary).toBe('宋雪坠楼，宋钟被诬入狱。')
    })

    it('草案只写阶段、标题、梗概与节拍，其余字段取默认值', () => {
        const [chapter0] = createChaptersFromSeeds([{ stage: '', title: '开局', summary: '开场', beats: [] }], 1, 3000)

        expect(chapter0).toMatchObject({ pov: '', goal: '', characterIds: [], wordCount: 0, status: 'planned' })
        expect(chapter0?.wordGoal).toBe(3000)
        // 没有细纲时保留一条空节拍，作者可直接落笔
        expect(chapter0?.beats).toHaveLength(1)
    })

    it('生成结果里的节拍按顺序写进章纲', () => {
        const [chapter0] = createChaptersFromSeeds(
            [{ stage: '', title: '开局', summary: '开场', beats: ['坠楼', '被诬入狱', ''] }],
            1,
            3000,
        )

        expect(chapter0?.beats.map((beat) => beat.text)).toEqual(['坠楼', '被诬入狱'])
        expect(chapter0?.beats.every((beat) => !beat.isDone)).toBe(true)
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
