/**
 * 角色卡产物解析：覆盖模型输出的常见形态——标准列表字段、省略 `-` 前缀的键值行、
 * 顿号与逗号混合分隔的特质、超量标签截断，以及重复键与无姓名块的处理；
 * 同时校验别名、年龄、外貌、背景与口头禅这些「原文才有的细节」不会在解析层丢失。
 * 复用约定：直接调用宿主解析函数，不启动任务、不读写文件；模型输出一律视为不可信输入。
 * 关键约束：解析不得抛错，字段缺失只留空；首个二级标题之前的说明行不进入任何人物卡。
 */
import { describe, expect, it } from 'vitest'
import { parseCharacterDrafts } from '../src/modules/press/importSemanticService'

describe('parseCharacterDrafts', () => {
    it('按二级标题与键值行解析人物卡，并保留原文细节字段', () => {
        const content = [
            '# 角色卡',
            '',
            '> 由 AI 依据出场统计、章节摘要与出场原文生成，未经原著核对。',
            '',
            '## 林尘',
            '- 姓名：林尘',
            '- 别名：小林',
            '- 分类：主角',
            '- 性别：男',
            '- 年龄：二十',
            '- 身高：一米八二',
            '- 体型：清瘦',
            '- 身份：外门弟子',
            '- 外貌：瘦高，左眉一道旧疤',
            '- 特质：隐忍、护短',
            '- 背景：自幼被逐出家门，靠打杂入宗',
            '- 欲望：为父报仇',
            '- 弱点：',
            '- 口头禅：再等等',
            '- 能力：剑意',
            '- 弧线：从隐忍到张扬',
            '- 关系：苏晚（师姐）：引他入门；李四（宿敌）：夺他名额',
        ].join('\n')

        const drafts = parseCharacterDrafts(content)

        expect(drafts).toHaveLength(1)
        expect(drafts[0]).toMatchObject({
            name: '林尘',
            alias: '小林',
            role: '主角',
            gender: '男',
            age: '二十',
            height: '一米八二',
            bodyType: '清瘦',
            identity: '外门弟子',
            appearance: '瘦高，左眉一道旧疤',
            traits: ['隐忍', '护短'],
            background: '自幼被逐出家门，靠打杂入宗',
            desire: '为父报仇',
            weakness: '',
            catchphrase: '再等等',
            ability: '剑意',
            arc: '从隐忍到张扬',
            relation: '苏晚（师姐）：引他入门；李四（宿敌）：夺他名额',
        })
    })

    it('旧版产物缺少细节字段时一律留空，不让解析失败', () => {
        const content = ['## 苏晚', '- 姓名：苏晚', '- 分类：配角', '- 性别：女', '- 身份：星月宗弟子'].join('\n')

        const drafts = parseCharacterDrafts(content)

        expect(drafts).toHaveLength(1)
        expect(drafts[0]).toMatchObject({
            name: '苏晚',
            alias: '',
            age: '',
            appearance: '',
            background: '',
            catchphrase: '',
        })
    })

    it('丢弃分词噪声、自认非人物与全空条目', () => {
        const content = [
            '## 时候',
            '- 分类：龙套',
            '- 性别：男',
            '## 东西',
            '- 分类：龙套',
            '- 身份：原文无对应人物，该名称只出现在「什么东西」等普通语句中',
            '## 能量',
            '- 分类：中立',
            '- 身份：',
            '- 欲望：',
            '## 林尘',
            '- 分类：主角',
            '- 身份：外门弟子',
        ].join('\n')

        const drafts = parseCharacterDrafts(content)

        expect(drafts.map((draft) => draft.name)).toEqual(['林尘'])
    })

    it('模型自述不是人物的块即使姓名像真名也丢弃', () => {
        const content = [
            '## 向陈轩',
            '- 分类：龙套',
            '- 身份：这个角色名在原文中并不是一个人物，而是「看向陈轩」的切分错误',
        ].join('\n')

        expect(parseCharacterDrafts(content)).toHaveLength(0)
    })

    it('容忍省略列表符号的键值行，并把超量特质截断到上限', () => {
        const content = [
            '## 苏晚',
            '姓名：苏晚',
            '分类：配角',
            '性别：女',
            '特质：冷静,果断、克制、孤僻、固执、爽利、沉默、多疑、温吞、急躁',
        ].join('\n')

        const drafts = parseCharacterDrafts(content)

        expect(drafts).toHaveLength(1)
        expect(drafts[0]?.name).toBe('苏晚')
        expect(drafts[0]?.role).toBe('配角')
        expect(drafts[0]?.gender).toBe('女')
        expect(drafts[0]?.traits).toHaveLength(8)
    })

    it('无姓名的块回落为标题，重复键以首次出现为准', () => {
        const content = [
            '## 李四',
            '- 分类：反派',
            '- 姓名：李四',
            '- 姓名：别名李四',
            '- 关系：与林尘有杀父之仇',
        ].join('\n')

        const drafts = parseCharacterDrafts(content)

        expect(drafts).toHaveLength(1)
        expect(drafts[0]?.name).toBe('李四')
        expect(drafts[0]?.identity).toBe('')
    })
})
