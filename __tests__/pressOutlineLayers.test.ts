/**
 * 大纲分层导航的读写往返：结构纲、伏笔线索与分卷规划三个段落，顺序与段落标题必须与宿主 writer 的落点表一致。
 * 复用约定：序列化与解析直接调生产代码，测试只拼文档外壳（一级标题与二级段落标题）；
 * 断言覆盖结构纲、线索、卷章与章纲的节奏字段。
 * 关键约束：段落漏测等于回写静默丢字段——每个回写段落都必须有往返断言；
 * 故事核（梗概、冲突、主题、主角弧光）只由作品设定的「作品设定」段解析，旧大纲的全书纲段不再读取；
 * 人物信息只在角色设定（人物卡）里维护，旧大纲的人物纲段同样不再解析；
 * 设定纲、节奏情绪与时间线也不再解析——节奏类型改由章块的「节奏」键承载，旧段落原样留在文件中；
 * 章纲与场景有同名键（结果 / 情绪），必须证明剥离场景块后两者互不污染。
 */
import { describe, expect, it } from 'vitest'
import type { CharacterCard, OutlinePlan, OutlineVolume } from '../src/workflow/press/types'
import { parseProjectWorkspace } from '../src/workflow/press/document'
import { serializeOutlineSections } from '../src/workflow/press/serialize'
import { formatVolumeOutlineText, volumeTitleLabel } from '../src/workflow/press/utils'

/** 设定分组文档留空：本用例只关心大纲段落 */
const EMPTY_SETTING_SECTIONS = { world: '', power: '', faction: '', place: '', item: '' }

/** 角色文档的最小写法：章纲出场人物与线索触发者都按姓名回填 id，必须有姓名索引 */
const CHARACTER_DOC = `# 角色设定

## 林岚

- id：12345678
- 姓名：林岚
- 分类：主角
`

const CHARACTERS: CharacterCard[] = [
    {
        id: '12345678',
        name: '林岚',
        alias: '七号',
        role: 'protagonist',
        gender: 'male',
        age: '27',
        height: '一米七八',
        bodyType: 'average',
        identity: '修表匠',
        appearanceTags: [],
        appearance: '',
        traits: [],
        background: '',
        desire: '查清妹妹失踪',
        weakness: '不信人',
        catchphrase: '',
        ability: '',
        arc: '从独行到结盟',
        relation: '顾青：情报盟友',
        portraits: [],
        coverPortraitId: null,
        portraitStyle: 'auto',
    },
]

const PLAN: OutlinePlan = {
    acts: [
        { id: 'act-1', name: '开端', position: '打破平衡', event: '旧表送来，编号与妹妹一致' },
        { id: 'act-2', name: '中点', position: '真相翻面', event: '顾青的档案是伪造的' },
        { id: 'act-3', name: '高潮', position: '迫使选择', event: '揭发集团即失去妹妹线索' },
    ],
    clues: [
        {
            id: 'clue-1',
            name: '旧表编号',
            plant: { volumeOrder: 1, chapterOrder: 1 },
            payoff: { volumeOrder: 1, chapterOrder: 2 },
            triggerId: '12345678',
            status: 'planted',
            note: '编号与妹妹一致',
        },
        {
            id: 'clue-2',
            name: '顾青的名片',
            plant: { volumeOrder: 1, chapterOrder: 1 },
            payoff: null,
            triggerId: '',
            status: 'paid-off',
            note: '',
        },
    ],
}

const VOLUMES: OutlineVolume[] = [
    {
        id: 'vol-1',
        name: '断线之始',
        expectedChapters: 6,
        coreEvent: '从被动谋生转向主动追查；底层手艺人 vs 地产集团',
        mainPlot: ['客人送来旧表，编号指向失踪的妹妹', '档案被抽走，线索断在旧城医院'],
        turningPoints: ['编号确认', '档案被抽走'],
        result: '线索断在旧城医院',
        granularity: 'medium',
        chapters: [
            {
                id: 'ch-1-1',
                order: 1,
                title: '修表铺的客人',
                stage: '第一阶段：坠落与旧表',
                summary: '客人送来一块停摆的旧表。',
                actualSummary: '林岚拆开后盖，看见妹妹的编号。',
                status: 'written',
                beats: [{ id: 'beat-1', text: '拆开后盖', isDone: true }],
                scenes: [
                    {
                        id: 'scene-1-1-1',
                        order: 1,
                        title: '修表铺',
                        desire: '赶在关门前修完表',
                        obstacle: '旧表结构不认识',
                        choice: '冒险拆开后盖',
                        result: '发现妹妹的编号',
                        emotion: '平静到失手',
                    },
                ],
                pov: '林岚',
                goal: '修好这块旧表',
                obstacle: '没有图纸',
                turn: '后盖内侧刻着编号',
                result: '确认是妹妹的表',
                emotion: '紧张',
                characterIds: ['12345678'],
                location: '城南修表铺',
                wordGoal: 2500,
                wordCount: 2680,
                hook: 'suspense',
                pacing: 'tension',
                tension: 4,
                granularity: 'fine',
            },
        ],
    },
]

/** 拼出大纲文档：固定段落标题与 writer 落点表一致，卷段落自带二级标题 */
function buildOutlineDocument(): string {
    const sections = serializeOutlineSections(PLAN, VOLUMES, CHARACTERS)
    return [
        '# 大纲',
        '',
        '## 结构纲',
        '',
        sections.structure,
        '',
        '## 卷纲',
        '',
        sections.volumeOutlines,
        '',
        '## 章节内容',
        '',
        sections.chapters,
        '',
        '## 伏笔线索',
        '',
        sections.clues,
        '',
        '## 主线',
        '',
        '林岚追查妹妹失踪的真相。',
        '',
    ].join('\n')
}

/** 只留一卷一章的文档：用于验证四态迁移 */
function buildStatusOutline(status: string): string {
    return `# 大纲

## 卷纲

### 第1卷 旧卷

## 章节内容

### 第1卷 旧卷

#### 第1章 旧章

- 状态：${status}

##### 计划梗概

旧梗概
`
}

describe('大纲四段落往返', () => {
    it('结构纲可原样解析', () => {
        const parsed = parseProjectWorkspace(
            { readme: '', setting: '', characters: CHARACTER_DOC, outline: buildOutlineDocument() },
            EMPTY_SETTING_SECTIONS,
            '未命名',
        )

        expect(parsed.plan.acts.map((act) => act.name)).toEqual(['开端', '中点', '高潮'])
        expect(parsed.plan.acts[1]).toMatchObject({ position: '真相翻面', event: '顾青的档案是伪造的' })
    })

    it('线索按章节引用往返，触发者按姓名回填', () => {
        const parsed = parseProjectWorkspace(
            { readme: '', setting: '', characters: CHARACTER_DOC, outline: buildOutlineDocument() },
            EMPTY_SETTING_SECTIONS,
            '未命名',
        )

        expect(parsed.plan.clues).toHaveLength(2)
        expect(parsed.plan.clues[0]).toMatchObject({
            name: '旧表编号',
            plant: { volumeOrder: 1, chapterOrder: 1 },
            payoff: { volumeOrder: 1, chapterOrder: 2 },
            triggerId: '12345678',
            status: 'planted',
            note: '编号与妹妹一致',
        })
        expect(parsed.plan.clues[1]).toMatchObject({ name: '顾青的名片', payoff: null, status: 'paid-off' })
    })

    it('卷章的章纲卡与场景纲往返，节奏写进章块且场景字段不污染章纲', () => {
        const parsed = parseProjectWorkspace(
            { readme: '', setting: '', characters: CHARACTER_DOC, outline: buildOutlineDocument() },
            EMPTY_SETTING_SECTIONS,
            '未命名',
        )

        expect(parsed.volumes).toHaveLength(1)
        const volume = parsed.volumes[0]
        expect(volume).toMatchObject({
            name: '断线之始',
            expectedChapters: 6,
            coreEvent: '从被动谋生转向主动追查；底层手艺人 vs 地产集团',
            result: '线索断在旧城医院',
            granularity: 'medium',
        })
        expect(volume?.mainPlot).toEqual(['客人送来旧表，编号指向失踪的妹妹', '档案被抽走，线索断在旧城医院'])
        expect(volume?.turningPoints).toEqual(['编号确认', '档案被抽走'])
        const chapter = volume?.chapters[0]
        expect(chapter).toMatchObject({
            order: 1,
            title: '修表铺的客人',
            stage: '第一阶段：坠落与旧表',
            summary: '客人送来一块停摆的旧表。',
            actualSummary: '林岚拆开后盖，看见妹妹的编号。',
            status: 'written',
            pov: '林岚',
            goal: '修好这块旧表',
            obstacle: '没有图纸',
            turn: '后盖内侧刻着编号',
            result: '确认是妹妹的表',
            emotion: '紧张',
            hook: 'suspense',
            pacing: 'tension',
            tension: 4,
            granularity: 'fine',
            wordCount: 2680,
        })
        // 章纲的「结果 / 情绪」与场景的「结果 / 情绪变化」同名不同层，必须各归其位
        expect(chapter?.scenes[0]).toMatchObject({
            title: '修表铺',
            desire: '赶在关门前修完表',
            obstacle: '旧表结构不认识',
            choice: '冒险拆开后盖',
            result: '发现妹妹的编号',
            emotion: '平静到失手',
        })
    })

    it('四个段落各自成文：卷纲与章节内容互不混入', () => {
        const sections = serializeOutlineSections(PLAN, VOLUMES, CHARACTERS)
        expect(Object.keys(sections)).toHaveLength(4)
        expect(sections.clues).toContain('旧表编号')
        expect(sections.clues).not.toContain('修表铺的客人')
        expect(sections.chapters).toContain('修表铺的客人')
        expect(sections.chapters).not.toContain('旧表编号')
        expect(sections.volumeOutlines).toContain('核心事件')
        expect(sections.volumeOutlines).not.toContain('修表铺的客人')
        expect(sections.structure).toContain('中点')
    })

    it('旧大纲的设定纲 / 节奏情绪 / 时间线段落不参与解析也不影响其它字段', () => {
        const outline = buildOutlineDocument().replace(
            '## 伏笔线索',
            [
                '## 设定纲',
                '',
                '### 听声异能',
                '',
                '- 规则：触碰机械可听见残留声响',
                '',
                '## 节奏情绪',
                '',
                '### 第1章',
                '',
                '- 类型：紧张',
                '',
                '## 时间线',
                '',
                '### 妹妹失踪',
                '',
                '- 时间：事发当夜',
                '',
                '## 伏笔线索',
            ].join('\n'),
        )
        const parsed = parseProjectWorkspace(
            { readme: '', setting: '', characters: CHARACTER_DOC, outline },
            EMPTY_SETTING_SECTIONS,
            '未命名',
        )

        // 三段旧内容不再进 plan，其余字段照常解析
        expect(parsed.plan.acts).toHaveLength(3)
        expect(parsed.plan.clues).toHaveLength(2)
        expect(parsed.volumes[0]?.chapters[0]?.pacing).toBe('tension')
    })

    it('故事核只从作品设定解析：旧大纲的全书纲段落不再参与', () => {
        const readme = `# 作品

## 作品设定

### 主题

记忆与代价

### 主角弧光

从独行到结盟
`
        // 旧作品的大纲里还留着全书纲段：解析必须忽略它，只认 README 的作品设定
        const outline = buildOutlineDocument().replace(
            '## 结构纲',
            '## 全书纲\n\n### 主题\n\n旧大纲里的主题\n\n## 结构纲',
        )
        const parsed = parseProjectWorkspace(
            { readme, setting: '', characters: CHARACTER_DOC, outline },
            EMPTY_SETTING_SECTIONS,
            '未命名',
        )

        expect(parsed.setting.theme).toBe('记忆与代价')
        expect(parsed.setting.arc).toBe('从独行到结盟')
    })
})

describe('大纲状态迁移', () => {
    it('旧状态归一到四态：published 与 draft 进「已写」，stale 进「待改」，废弃单独保留', () => {
        const parseStatus = (status: string): string => {
            const parsed = parseProjectWorkspace(
                { readme: '', setting: '', characters: '', outline: buildStatusOutline(status) },
                EMPTY_SETTING_SECTIONS,
                '未命名',
            )
            return parsed.volumes[0]?.chapters[0]?.status ?? ''
        }

        expect(parseStatus('published')).toBe('written')
        expect(parseStatus('done')).toBe('written')
        expect(parseStatus('draft')).toBe('written')
        expect(parseStatus('待写')).toBe('planned')
        expect(parseStatus('stale')).toBe('revise')
        expect(parseStatus('需复核')).toBe('revise')
        expect(parseStatus('废弃')).toBe('discarded')
    })
})

describe('卷纲展示', () => {
    it('名称没有卷号时按位置补上，已带卷号的保持原样', () => {
        expect(volumeTitleLabel('断线之始', 0)).toBe('第1卷 断线之始')
        expect(volumeTitleLabel('', 1)).toBe('第2卷')
        // 已带卷号（阿拉伯与中文）都不再重复追加
        expect(volumeTitleLabel('第3卷 雪原', 0)).toBe('第3卷 雪原')
        expect(volumeTitleLabel('第五卷 归墟', 4)).toBe('第五卷 归墟')
    })

    it('卷纲快照只保留有内容的字段，供添加到对话使用', () => {
        const base = VOLUMES[0]
        if (base === undefined) {
            throw new Error('测试数据缺少第一卷')
        }

        const text = formatVolumeOutlineText(base, 0)
        expect(text).toContain('【第1卷 断线之始】')
        expect(text).toContain('预计章节数：6')
        expect(text).toContain('核心事件：从被动谋生转向主动追查；底层手艺人 vs 地产集团')
        expect(text).toContain('- 客人送来旧表，编号指向失踪的妹妹')
        expect(text).toContain('卷末结果：线索断在旧城医院')

        const empty = formatVolumeOutlineText(
            { ...base, expectedChapters: 0, coreEvent: '', mainPlot: [], turningPoints: [], result: '' },
            1,
        )
        expect(empty).toBe('【第2卷 断线之始】')
    })
})
