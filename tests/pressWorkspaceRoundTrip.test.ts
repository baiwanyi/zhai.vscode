/**
 * 草稿回写往返：把工作台草稿序列化成文档段落，再按解析口径读回来，验证键名与格式完全对齐。
 * 复用约定：序列化与解析都直接调用生产代码，不复制格式字符串；断言只覆盖用户可见字段。
 * 关键约束：键名或层级一旦改动而解析端未同步，这里的往返断言会立刻失败——这是回写功能的最后一道防线；
 * 世界观、地理、核心概念、人物背景、卷级情节脉络与关键转折同样纳入往返，导入产出的字段不能写进文档就读不回来。
 */
import { describe, expect, it } from 'vitest'
import type { CharacterCard, OutlineVolume, ProjectSetting } from '../src/workflow/press/types'
import { parseProjectWorkspace } from '../src/workflow/press/document'
import {
    serializeCharacterBlocks,
    serializeOutlineSection,
    serializeReadmeMeta,
    serializeSettingSection,
} from '../src/workflow/press/serialize'

const SETTING: ProjectSetting = {
    title: '娱乐春秋',
    penName: '泥白佛',
    audience: '男频',
    genres: ['仙侠', '系统流'],
    wordGoal: 1_000_000,
    logline: '穿越者用现代娱乐业改造修真界。',
    conflict: '娱乐工业与修真秩序的正面冲突。',
    ending: '开放',
    worldview: '修真界与世俗王朝并存，宗门把持灵脉，凡人只能依附势力生存。',
    geography: '天都居中，北有雪原，南接十万大山。',
    era: '架空修真界',
    factions: '六大宗门、星月宗',
    powerSystem: '真气与武道境界',
    concepts: '真气：天地灵气的内化形态；文抄：把现代作品复刻成修真界的话本',
    taboo: '不写政治隐喻',
    goldenFingerType: '穿越知识',
    goldenFingerAbility: '把现代文艺作品复刻到修真界',
    goldenFingerCost: '暴露来历会被围杀',
    perspective: '第三人称限知',
    tone: '轻松',
    references: '起点男频',
    banned: ['暴力细节', '政治隐喻'],
}

const CHARACTERS: CharacterCard[] = [
    {
        id: '12345678',
        name: '薛牧',
        alias: '薛掌门',
        role: 'protagonist',
        gender: 'male',
        age: '二十',
        height: '一米七八',
        bodyType: 'athletic',
        identity: '星月宗弟子',
        appearance: '清瘦，常带笑意',
        traits: ['隐忍', '护短'],
        background: '穿越前是娱乐公司策划，落地即被当作异端追杀。',
        desire: '让娱乐业立足',
        weakness: '过分自信',
        catchphrase: '我来试试',
        ability: '现代知识',
        arc: '从棋子到棋手',
        relation: '夏侯荻的师弟',
        portraits: [],
        coverPortraitId: 'portrait-20261001120000-12345678',
        portraitStyle: 'guofeng',
    },
]

const VOLUMES: OutlineVolume[] = [
    {
        id: 'vol-1',
        name: '第1卷 天都篇',
        goal: '在星月宗站稳脚跟',
        conflict: '被当成异端',
        plotline: '薛牧借现代娱乐业入宗，先被排挤，再以话本立名，最后卷入宗门内斗。',
        turningPoints: ['文抄成名', '内斗站队', '被逐出宗门'],
        chapters: [
            {
                id: 'ch-1',
                order: 1,
                title: '开局',
                summary: '穿越落鼎，初识修真界。',
                status: 'planned',
                beats: [
                    { id: 'beat-1', text: '落鼎', isDone: false },
                    { id: 'beat-2', text: '遇见夏侯荻', isDone: true },
                ],
                characterIds: ['12345678'],
                location: '星月宗',
                wordGoal: 2500,
                wordCount: 0,
                hook: 'suspense',
                tension: 3,
            },
        ],
    },
]

describe('草稿回写往返', () => {
    it('README、设定、角色设定与大纲回写后可被原样解析', () => {
        const meta = serializeReadmeMeta(SETTING)
        const readme = [
            '---',
            `title: ${meta.title}`,
            `audience: ${meta.audience}`,
            `tags: ${meta.genres.join(', ')}`,
            `wordGoal: ${String(meta.wordGoal)}`,
            'status: ongoing',
            'createdAt: 2026-10-01',
            '---',
            '',
            `# ${meta.title}`,
            '',
            '## 简介',
            '',
        ].join('\n')
        const parsed = parseProjectWorkspace(
            {
                readme,
                setting: `# 设定\n\n## 提取设定\n\n${serializeSettingSection(SETTING)}\n`,
                characters: `# 角色设定\n\n> 提示\n\n${serializeCharacterBlocks(CHARACTERS)
                    .map((block) => block.text)
                    .join('\n\n')}\n`,
                outline: `# 大纲\n\n## 主线\n\n## 分卷规划\n\n${serializeOutlineSection(VOLUMES, CHARACTERS)}\n`,
            },
            '兜底书名',
        )

        expect(parsed.setting).toMatchObject({
            title: '娱乐春秋',
            penName: '泥白佛',
            audience: '男频',
            genres: ['仙侠', '系统流'],
            wordGoal: 1_000_000,
            logline: SETTING.logline,
            conflict: SETTING.conflict,
            worldview: SETTING.worldview,
            geography: SETTING.geography,
            era: SETTING.era,
            factions: SETTING.factions,
            powerSystem: SETTING.powerSystem,
            concepts: SETTING.concepts,
            taboo: SETTING.taboo,
            goldenFingerType: SETTING.goldenFingerType,
            goldenFingerAbility: SETTING.goldenFingerAbility,
            goldenFingerCost: SETTING.goldenFingerCost,
            perspective: SETTING.perspective,
            tone: SETTING.tone,
            ending: '开放',
            banned: ['暴力细节', '政治隐喻'],
        })

        expect(parsed.characters).toHaveLength(1)
        expect(parsed.characters[0]).toMatchObject({
            id: '12345678',
            name: '薛牧',
            alias: '薛掌门',
            role: 'protagonist',
            gender: 'male',
            age: '二十',
            height: '一米七八',
            bodyType: 'athletic',
            traits: ['隐忍', '护短'],
            background: '穿越前是娱乐公司策划，落地即被当作异端追杀。',
            catchphrase: '我来试试',
            // 封面与画风必须能往返：只存 id，图片本体在 Portraits 下
            portraitStyle: 'guofeng',
            coverPortraitId: 'portrait-20261001120000-12345678',
        })

        expect(parsed.volumes).toHaveLength(1)
        expect(parsed.volumes[0]).toMatchObject({
            name: '第1卷 天都篇',
            goal: '在星月宗站稳脚跟',
            conflict: '被当成异端',
            plotline: '薛牧借现代娱乐业入宗，先被排挤，再以话本立名，最后卷入宗门内斗。',
            turningPoints: ['文抄成名', '内斗站队', '被逐出宗门'],
        })
        expect(parsed.volumes[0]?.chapters).toHaveLength(1)
        expect(parsed.volumes[0]?.chapters[0]).toMatchObject({
            order: 1,
            title: '开局',
            summary: '穿越落鼎，初识修真界。',
            status: 'planned',
            hook: 'suspense',
            tension: 3,
            wordGoal: 2500,
            wordCount: 0,
            location: '星月宗',
            characterIds: ['12345678'],
        })
        expect(parsed.volumes[0]?.chapters[0]?.beats.map((beat) => beat.text)).toEqual(['落鼎', '遇见夏侯荻'])
        expect(parsed.volumes[0]?.chapters[0]?.beats[1]?.isDone).toBe(true)
    })
})
