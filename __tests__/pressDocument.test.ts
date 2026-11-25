/**
 * 作品文档解析用例：验证 README、设定、角色设定与大纲 Markdown 能还原成工作台视图模型。
 * 复用约定：前四组样本沿用旧写法（「# 角色名」+ 键值行），用于守住历史作品的兼容口径；
 * 末组样本是新格式（`## 角色名` + 三级分组 + 四级字段、`### 字段` 承载设定），覆盖标题读取路径。
 * 关键约束：断言覆盖字段映射与容错两条线——键值行优先于区块段落，空文档与缺卷标题都不得抛错；
 * 设定分组文档留空时用于覆盖旧 设定.md 的回落口径。
 */
import { describe, expect, it } from 'vitest'
import { buildProjectDocuments } from '../src/modules/press/projectFactory'
import { parseProjectWorkspace } from '../src/workflow/press/document'

/** 设定分组文档留空：走旧 设定.md 回落路径；条目文档留空即没有资料条目 */
const EMPTY_SETTING_SECTIONS = { world: '', power: '', faction: '', place: '', item: '' }

const README = `# 城南旧事

## 简介

- 目标读者：男频
- 题材：都市、悬疑
- 目标字数：800000

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

## 卷纲

### 断线之始（第1-6章）

#### 预计章节数

6

#### 核心事件

从被动谋生转向主动追查；底层手艺人 vs 地产集团

#### 主要情节

- 客人送来旧表，编号指向失踪的妹妹
- 档案被抽走，线索断在旧城医院

#### 关键转折

- 编号确认

#### 卷末结果

线索断在旧城医院

- 颗粒度：中纲

## 章节内容

### 断线之始（第1-6章）

#### 修表铺的客人

- id：ch-1
- 状态：published｜字数：2680 / 2500｜钩子：suspense｜张力：2
- 人物：林岚、老周｜地点：城南修表铺

##### 计划梗概

客人送来一块停摆的旧表。

##### 节拍

- [x] 客人放下表就走
- [x] 林岚拆开后盖
- [ ] 编号与妹妹一致

#### 失踪的第七天

- 状态：planned
- 人物：顾青｜地点：旧城医院

##### 计划梗概

档案被抽走。

##### 节拍

- [ ] 老周劝他别再查

## 主线

林岚追查妹妹失踪的真相。
`

describe('parseProjectWorkspace', () => {
    it('从 README 与设定.md 还原作品设定', () => {
        const parsed = parseProjectWorkspace(
            { readme: README, setting: SETTING, characters: CHARACTERS, outline: OUTLINE },
            EMPTY_SETTING_SECTIONS,
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
            EMPTY_SETTING_SECTIONS,
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
        const parsed = parseProjectWorkspace(
            { readme: '', setting: '', characters, outline: '' },
            EMPTY_SETTING_SECTIONS,
            '未命名',
        )
        expect(parsed.characters.map((card) => card.id)).toEqual(['10845795', '12810129', '11248916'])
        expect(parsed.characters.every((card) => /^\d{8}$/.test(card.id))).toBe(true)
    })

    it('按卷与章还原章纲，字数、钩子与节拍各归其位', () => {
        const parsed = parseProjectWorkspace(
            { readme: README, setting: SETTING, characters: CHARACTERS, outline: OUTLINE },
            EMPTY_SETTING_SECTIONS,
            '未命名',
        )
        expect(parsed.volumes).toHaveLength(1)
        const volume = parsed.volumes[0]
        expect(volume?.name).toBe('断线之始（第1-6章）')
        expect(volume?.expectedChapters).toBe(6)
        expect(volume?.coreEvent).toBe('从被动谋生转向主动追查；底层手艺人 vs 地产集团')
        expect(volume?.mainPlot).toEqual(['客人送来旧表，编号指向失踪的妹妹', '档案被抽走，线索断在旧城医院'])
        expect(volume?.turningPoints).toEqual(['编号确认'])
        expect(volume?.result).toBe('线索断在旧城医院')
        expect(volume?.chapters).toHaveLength(2)

        const [first, second] = volume?.chapters ?? []
        expect(first?.order).toBe(1)
        expect(first?.title).toBe('修表铺的客人')
        expect(first?.status).toBe('written')
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

    it('旧格式「分卷规划」不再解析，空文档不抛错', () => {
        const outline = '## 分卷规划\n\n#### 第1章 甲\n- 状态：draft\n\n#### 第2章 乙\n'
        const parsed = parseProjectWorkspace(
            { readme: '', setting: '', characters: '', outline },
            EMPTY_SETTING_SECTIONS,
            '空作品',
        )
        expect(parsed.setting.title).toBe('空作品')
        expect(parsed.setting.genres).toEqual([])
        expect(parsed.characters).toEqual([])
        // 新结构每卷一个二级段落：旧的分卷规划段落不解析，卷章为空
        expect(parsed.volumes).toEqual([])
    })

    it('标题承载的新格式：设定字段、角色分组与条目字段都能还原', () => {
        const readme = `# 长夜行

## 作品设定

### 目标读者
女频

### 题材
仙侠

### 目标字数
600000

### 笔名
青梧

### 章节字数
3200

### 时间
古代

### 结局
开放

### 一句话简介
她替人补命，也替自己补了一笔旧债。

### 作品简介
补命者以他人余寿换命，代价记在自己的命数上。

### 禁写项
血腥细节、政治隐喻
`
        const characters = `# 角色设定

> 每个角色以二级标题起条。

## 沈青梧

### 身份档案

#### id
12345678

#### 姓名
沈青梧

#### 分类
主角

#### 性别
女

#### 年龄
二十四

#### 身高
一米六五

#### 体型
纤细

### 外貌形象

#### 外貌标签
素衣、腕上缠红线

#### 外貌
眉眼清淡，说话时习惯垂眼。

#### 封面
20261001120000AbCd12

### 性格与能力

#### 特质
隐忍、护短

#### 口头禅
这笔账记我名下。

#### 能力
替人补命

### 背景与关系

#### 背景
幼年被命簿选中。

#### 关系
与守簿人亦师亦敌。
`
        const parsed = parseProjectWorkspace(
            { readme, setting: '', characters, outline: '' },
            {
                world: `# 世界观

## 提取设定

### 世界观总述
命簿定人寿数，补命者可改写一笔。

### 核心概念
命簿：记载凡人寿数的册子；补命：以他人余寿换回一条命
`,
                power: `# 金手指

## 提取设定

### 类型
补命术

### 能力
能看见他人的剩余寿数

### 代价
每改一笔折自己的寿

### 限制
只能改与自己有因果的人

### 升级体系
先改一笔，再改一卷，最后能改命簿本身
`,
                faction: `# 势力

## 守簿人

### id
87654321

### 关联人物
沈青梧

### 封面
20261001120002IjKl56

### 描述
守着命簿的旧人。

又一代的代价在这里结算。
`,
                place: '',
                item: '',
            },
            '未命名',
        )

        expect(parsed.setting).toMatchObject({
            title: '长夜行',
            audience: '女频',
            penName: '青梧',
            genres: ['仙侠'],
            wordGoal: 600000,
            chapterWordGoal: 3200,
            period: '古代',
            ending: '开放',
            logline: '她替人补命，也替自己补了一笔旧债。',
            summary: '补命者以他人余寿换命，代价记在自己的命数上。',
            banned: ['血腥细节', '政治隐喻'],
            worldview: '命簿定人寿数，补命者可改写一笔。',
            goldenFingerType: '补命术',
            goldenFingerCost: '每改一笔折自己的寿',
            goldenFingerLimit: '只能改与自己有因果的人',
            goldenFingerUpgrade: '先改一笔，再改一卷，最后能改命簿本身',
        })
        expect(parsed.setting.concepts).toContain('命簿：')

        const [character] = parsed.characters
        expect(character).toMatchObject({
            id: '12345678',
            name: '沈青梧',
            role: 'protagonist',
            gender: 'female',
            age: '二十四',
            height: '一米六五',
            bodyType: 'slim',
            appearanceTags: ['素衣', '腕上缠红线'],
            appearance: '眉眼清淡，说话时习惯垂眼。',
            traits: ['隐忍', '护短'],
            catchphrase: '这笔账记我名下。',
            ability: '替人补命',
            background: '幼年被命簿选中。',
            relation: '与守簿人亦师亦敌。',
            coverPortraitId: '20261001120000AbCd12',
        })

        const [faction] = parsed.lore
        expect(faction).toMatchObject({
            id: '87654321',
            kind: 'faction',
            name: '守簿人',
            description: '守着命簿的旧人。\n\n又一代的代价在这里结算。',
            coverImageId: '20261001120002IjKl56',
        })
        expect(faction?.memberIds).toEqual(['12345678'])
    })
})

describe('新建作品的大纲骨架', () => {
    it('自带一卷一章，打开卷纲与章纲即可编辑', () => {
        const documents = buildProjectDocuments('剑来', '男频')
        const outline = documents.find((item) => item.relativePath === '大纲.md')?.content ?? ''
        const parsed = parseProjectWorkspace(
            { readme: '', setting: '', characters: '', outline },
            EMPTY_SETTING_SECTIONS,
            '剑来',
        )

        expect(parsed.plan.acts.map((act) => act.name)).toEqual(['开端', '对抗', '高潮'])
        expect(parsed.volumes).toHaveLength(1)
        const volume = parsed.volumes[0]
        expect(volume).toMatchObject({ name: '默认卷', expectedChapters: 1, granularity: 'medium' })
        expect(volume?.coreEvent).toContain('本卷核心事件')
        expect(volume?.mainPlot).toHaveLength(1)
        const chapter = volume?.chapters[0]
        expect(chapter).toMatchObject({
            order: 1,
            title: '未命名章节',
            status: 'planned',
            hook: 'suspense',
            pacing: 'setup',
            tension: 3,
            granularity: 'fine',
        })
        expect(chapter?.summary).toContain('本章梗概')
        expect(chapter?.beats.map((beat) => beat.text)).toEqual([
            '主角因「开端」被卷入新的阻碍',
            '推进过程中暴露一条新线索',
        ])
    })
})
