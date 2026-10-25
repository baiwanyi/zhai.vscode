/**
 * 作品文档解析用例：验证 README、设定、角色设定与大纲四份 Markdown 能还原成工作台视图模型。
 * 复用约定：样本文本沿用作品骨架与角色设定.md 「# 角色名」、大纲.md 「卷 → 章 → 键值行」的既有写法。
 * 关键约束：断言覆盖字段映射与容错两条线——键值行优先于区块段落，空文档与缺卷标题都不得抛错。
 */
import { describe, expect, it } from 'vitest'
import { parseProjectWorkspace } from '../src/workflow/press/document'

const README = `---
title: 城南旧事
audience: 男频
wordGoal: 800000
tags: [都市, 悬疑]
---

# 城南旧事

## 简介

修表匠林岚能从机械里听见残留的声音。

底层手艺人掌握的真相与旧城改造的利益集团正面相撞。

- 笔名：宅
- 结局倾向：开放

## 写作风格

- 视角：第三人称
- 语调：冷峻克制，短句为主
- 禁写项：后宫、降智
`

const SETTING = `# 设定

## 世界观

当代旧城改造期。

## 组织势力

- 旧城原住民
- 地产集团

## 金手指设定

- 类型：异能
- 能力：触碰机械时听见它经历过的关键声响
- 代价：每次读取后失聪数分钟

## 写作约束

不写超自然鬼怪，所有异象必须有机械或人为解释。
`

const CHARACTERS = `# 角色设定

> 每个角色以一级标题起条。

## 角色索引

| 角色 | 分类 |
| --- | --- |

# 林岚

- id：char-林岚
- 别名：七号
- 分类：protagonist（主角）｜性别：male（男）｜年龄：27
- 身份：旧城修表匠
- 特质：隐忍、偏执
- 口头禅：表不会骗人，人会。
- 关系：顾青：情报盟友

# 顾青

- 分类：supporting（配角）｜性别：female（女）｜年龄：26
- 身份：旧城晚报记者
`

const OUTLINE = `# 大纲

## 主线

林岚追查妹妹失踪的真相。

## 分卷规划

| 卷 | 章区间 |
| --- | --- |

### 第1卷 断线之始（第1-6章）

- 卷目标：从被动谋生转向主动追查
- 卷冲突：底层手艺人 vs 地产集团

#### 第1章 修表铺的客人

- id：ch-1
- 状态：published｜字数：2680 / 2500｜钩子：suspense｜张力：2
- 梗概：客人送来一块停摆的旧表。
- 节拍：① [x] 客人放下表就走 ② [x] 林岚拆开后盖 ③ [ ] 编号与妹妹一致
- 人物：林岚、老周｜地点：城南修表铺

#### 第2章 失踪的第七天

- 状态：planned
- 梗概：档案被抽走。
- 节拍：① [ ] 老周劝他别再查
- 人物：顾青｜地点：旧城医院
`

describe('parseProjectWorkspace', () => {
    it('从 README 与设定.md 还原作品设定', () => {
        const parsed = parseProjectWorkspace(
            { readme: README, setting: SETTING, characters: CHARACTERS, outline: OUTLINE },
            '未命名',
        )
        expect(parsed.setting.title).toBe('城南旧事')
        expect(parsed.setting.audience).toBe('男频')
        expect(parsed.setting.genres).toEqual(['都市', '悬疑'])
        expect(parsed.setting.wordGoal).toBe(800000)
        expect(parsed.setting.penName).toBe('宅')
        expect(parsed.setting.logline).toBe('修表匠林岚能从机械里听见残留的声音。')
        expect(parsed.setting.conflict).toBe('底层手艺人掌握的真相与旧城改造的利益集团正面相撞。')
        expect(parsed.setting.ending).toBe('开放')
        expect(parsed.setting.perspective).toBe('第三人称')
        expect(parsed.setting.banned).toEqual(['后宫', '降智'])
        expect(parsed.setting.goldenFingerType).toBe('异能')
        expect(parsed.setting.goldenFingerAbility).toBe('触碰机械时听见它经历过的关键声响')
        expect(parsed.setting.factions).toContain('旧城原住民')
        expect(parsed.setting.taboo).toContain('超自然')
    })

    it('按一级标题还原人物卡并生成稳定 id', () => {
        const parsed = parseProjectWorkspace(
            { readme: README, setting: SETTING, characters: CHARACTERS, outline: OUTLINE },
            '未命名',
        )
        expect(parsed.characters).toHaveLength(2)
        const [first, second] = parsed.characters
        expect(first?.id).toBe('10845795')
        expect(first?.name).toBe('林岚')
        expect(first?.alias).toBe('七号')
        expect(first?.role).toBe('protagonist')
        expect(first?.gender).toBe('male')
        expect(first?.age).toBe('27')
        expect(first?.traits).toEqual(['隐忍', '偏执'])
        expect(first?.catchphrase).toBe('表不会骗人，人会。')
        expect(second?.role).toBe('supporting')
        expect(second?.gender).toBe('female')
    })

    it('人物标识以宿主白名单为准：非法标识重生成，同名自动加序号', () => {
        const characters = `# 角色设定

# 林岚

- id：char-linlan
- 分类：主角

# 林岚

- id：char-linlan
- 分类：配角

# 顾青

- id：char-顾青
- 分类：配角
`
        const parsed = parseProjectWorkspace({ readme: '', setting: '', characters, outline: '' }, '未命名')
        expect(parsed.characters.map((card) => card.id)).toEqual(['10845795', '12810129', '11248916'])
        expect(parsed.characters.every((card) => /^\d{8}$/.test(card.id))).toBe(true)
    })

    it('按卷与章还原章纲，字数、钩子与节拍各归其位', () => {
        const parsed = parseProjectWorkspace(
            { readme: README, setting: SETTING, characters: CHARACTERS, outline: OUTLINE },
            '未命名',
        )
        expect(parsed.volumes).toHaveLength(1)
        const volume = parsed.volumes[0]
        expect(volume?.name).toBe('第1卷 断线之始（第1-6章）')
        expect(volume?.goal).toBe('从被动谋生转向主动追查')
        expect(volume?.conflict).toBe('底层手艺人 vs 地产集团')
        expect(volume?.chapters).toHaveLength(2)

        const [first, second] = volume?.chapters ?? []
        expect(first?.order).toBe(1)
        expect(first?.title).toBe('修表铺的客人')
        expect(first?.status).toBe('done')
        expect(first?.wordCount).toBe(2680)
        expect(first?.wordGoal).toBe(2500)
        expect(first?.hook).toBe('suspense')
        expect(first?.tension).toBe(2)
        expect(first?.location).toBe('城南修表铺')
        expect(first?.beats.map((beat) => beat.isDone)).toEqual([true, true, false])
        expect(first?.characterIds).toEqual(['10845795'])
        expect(second?.order).toBe(2)
        expect(second?.status).toBe('planned')
        expect(second?.characterIds).toEqual(['11248916'])
    })

    it('无卷标题时把章节收进默认卷，空文档不抛错', () => {
        const outline = '## 分卷规划\n\n#### 第1章 甲\n- 状态：draft\n\n#### 第2章 乙\n'
        const parsed = parseProjectWorkspace({ readme: '', setting: '', characters: '', outline }, '空作品')
        expect(parsed.setting.title).toBe('空作品')
        expect(parsed.setting.genres).toEqual([])
        expect(parsed.characters).toEqual([])
        expect(parsed.volumes[0]?.name).toBe('第1卷')
        expect(parsed.volumes[0]?.chapters.map((chapter) => chapter.order)).toEqual([1, 2])
        expect(parsed.volumes[0]?.chapters[0]?.status).toBe('drafting')
    })
})
