/**
 * 公众号账号契约的单元测试：覆盖名称规整、类型回落、请求收窄、错误归一与密钥尾号。
 * 纯函数测试，不触网、不落库；账号服务与 Token 并发合并依赖宿主与 fetch，留待接入推送链路时以桩补齐。
 * 断言集中在「哪些输入被拒绝」与「提示是否可执行」两处，避免只验证快乐路径。
 */
import { describe, expect, it } from 'vitest'
import { describeWechatError, NETWORK_ERROR_CODE } from '../../src/modules/wechat/client'
import { formatWechatSecretHint } from '../../src/modules/wechat/credentials'
import {
    isCreateWechatAccountRequest,
    isSelectWechatAccountRequest,
    isUpdateWechatAccountRequest,
    isWechatAccountId,
    readWechatAccountName,
    readWechatAccountType,
    WECHAT_ACCOUNT_NAME_MAX,
} from '../../src/shared/types/wechat'

/** 合法 AppID：形态收窄只要求字母数字与下划线，长度 6~64 */
const APP_ID = 'wx1234567890abcdef'

/** 合法 AppSecret：16~64 位字母数字 */
const APP_SECRET = 'abcdefghijklmnop1234'

describe('readWechatAccountName', () => {
    it('折叠连续空白并去掉首尾空格', () => {
        expect(readWechatAccountName('  宅写作   笔记  ')).toBe('宅写作 笔记')
    })

    it('超长名称截断到上限', () => {
        const long = 'a'.repeat(WECHAT_ACCOUNT_NAME_MAX + 10)
        expect(readWechatAccountName(long)).toHaveLength(WECHAT_ACCOUNT_NAME_MAX)
    })

    it('非字符串与全空白都返回空串，由调用方判定非法', () => {
        expect(readWechatAccountName(undefined)).toBe('')
        expect(readWechatAccountName('   ')).toBe('')
    })
})

describe('readWechatAccountType', () => {
    it('service 原样保留，其余一律回落订阅号', () => {
        expect(readWechatAccountType('service')).toBe('service')
        expect(readWechatAccountType('subscription')).toBe('subscription')
        expect(readWechatAccountType('unknown')).toBe('subscription')
        expect(readWechatAccountType(undefined)).toBe('subscription')
    })
})

describe('isWechatAccountId', () => {
    it('接受本地生成的短 id', () => {
        expect(isWechatAccountId('acc-1a2b3c4d5e')).toBe(true)
    })

    it('拒绝大写、路径片段与超长输入', () => {
        expect(isWechatAccountId('ACC-1')).toBe(false)
        expect(isWechatAccountId('acc/../etc')).toBe(false)
        expect(isWechatAccountId('a'.repeat(65))).toBe(false)
        expect(isWechatAccountId(null)).toBe(false)
    })
})

describe('isCreateWechatAccountRequest', () => {
    it('名称、AppID 与密钥齐备时通过', () => {
        expect(isCreateWechatAccountRequest({ name: '宅写作', appId: APP_ID, appSecret: APP_SECRET })).toBe(true)
    })

    it('缺密钥、名称空白或 AppID 形态不符都拒绝', () => {
        expect(isCreateWechatAccountRequest({ name: '宅写作', appId: APP_ID })).toBe(false)
        expect(isCreateWechatAccountRequest({ name: '  ', appId: APP_ID, appSecret: APP_SECRET })).toBe(false)
        expect(isCreateWechatAccountRequest({ name: '宅写作', appId: 'a/b', appSecret: APP_SECRET })).toBe(false)
    })
})

describe('isUpdateWechatAccountRequest', () => {
    it('密钥缺省表示沿用旧值', () => {
        expect(isUpdateWechatAccountRequest({ id: 'acc-1', name: '宅写作', appId: APP_ID })).toBe(true)
    })

    it('密钥传入但形态不符时拒绝', () => {
        expect(isUpdateWechatAccountRequest({ id: 'acc-1', name: '宅写作', appId: APP_ID, appSecret: 'short' })).toBe(
            false,
        )
    })
})

describe('isSelectWechatAccountRequest', () => {
    it('null 表示清除选择，合法 id 表示切换', () => {
        expect(isSelectWechatAccountRequest({ id: null })).toBe(true)
        expect(isSelectWechatAccountRequest({ id: 'acc-1' })).toBe(true)
        expect(isSelectWechatAccountRequest({})).toBe(false)
    })
})

describe('describeWechatError', () => {
    it('40164 给出 IP 白名单指引', () => {
        const hint = describeWechatError(40164)
        expect(hint.status).toBe('error')
        expect(hint.hint).toContain('白名单')
    })

    it('额度与权限错误归一为 limited', () => {
        expect(describeWechatError(45009).status).toBe('limited')
        expect(describeWechatError(48001).status).toBe('limited')
    })

    it('未登记错误码回落到通用提示', () => {
        expect(describeWechatError(99999).hint).toContain('AppID')
    })

    it('网络错误码与服务端错误码分开表达', () => {
        expect(NETWORK_ERROR_CODE).toBe(0)
        expect(describeWechatError(NETWORK_ERROR_CODE).hint).toContain('AppID')
    })
})

describe('formatWechatSecretHint', () => {
    it('只暴露末四位', () => {
        expect(formatWechatSecretHint('0123456789abcdef')).toBe('****cdef')
    })

    it('过短密钥整体打码', () => {
        expect(formatWechatSecretHint('abc')).toBe('****')
    })
})
