/**
 * 关注分组与备注单元测试：覆盖两个读地址、form 参数形状与回包归一化。
 * 复用约定：读接口用 requestJson 替身，写接口用 vi.stubGlobal('fetch') 接管；
 * 断言只落在 URL 查询参数、form 字段与归一化结果上。
 * 关键约束：origin_list_ids 必须复刻「原始 + 0 + 原始」形态，空分组提交 0；
 * 备注更新回包没有 ok 包装，不能因为缺 ok 就判失败。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WeiboJsonQuery } from '../src/modules/weibo/transport/httpClient'
import { buildUserGroupListUrl, buildUserGroupOfUrl, fetchUserGroups } from '../src/modules/weibo/groups/read'
import {
    buildGroupListIds,
    buildGroupOriginIds,
    createUserGroup,
    saveUserGroups,
    setUserRemark,
} from '../src/modules/weibo/groups/write'

afterEach(() => {
    vi.unstubAllGlobals()
})

/** 取写请求的 form 字段：body 是 form 编码串 */
function readForm(init: RequestInit | undefined): URLSearchParams {
    return new URLSearchParams(typeof init?.body === 'string' ? init.body : '')
}

/** 替身 fetch：记录每次调用并回固定 JSON */
function stubFetch(payload: unknown, status = 200): ReturnType<typeof vi.fn> {
    const mock = vi.fn(() =>
        Promise.resolve(
            new Response(JSON.stringify(payload), {
                status,
                headers: { 'Content-Type': 'application/json' },
            }),
        ),
    )
    vi.stubGlobal('fetch', mock)
    return mock
}

describe('分组地址', () => {
    it('getGroupList 只带 uid', () => {
        const url = new URL(buildUserGroupOfUrl('6402514052'))
        expect(url.pathname).toBe('/ajax/profile/getGroupList')
        expect(url.searchParams.get('uid')).toBe('6402514052')
    })

    it('getGroups 带 target_uid / filterType / hasRecom', () => {
        const url = new URL(buildUserGroupListUrl('6402514052'))
        expect(url.pathname).toBe('/ajax/profile/getGroups')
        expect(url.searchParams.get('target_uid')).toBe('6402514052')
        expect(url.searchParams.get('filterType')).toBe('system')
        expect(url.searchParams.get('hasRecom')).toBe('true')
    })
})

describe('分组 id 拼装', () => {
    it('list_ids 为空提交 0，否则逗号拼接', () => {
        expect(buildGroupListIds([])).toBe('0')
        expect(buildGroupListIds(['5225046125581012', '5368181419414369'])).toBe('5225046125581012,5368181419414369')
    })

    it('origin_list_ids 复刻原始 + 0 + 原始，空集合只提交 0', () => {
        expect(buildGroupOriginIds([])).toBe('0')
        expect(buildGroupOriginIds(['5225046125581012'])).toBe('5225046125581012,0,5225046125581012')
    })
})

describe('fetchUserGroups', () => {
    it('并行取回并归一化所在分组与全部分组', async () => {
        const queries: WeiboJsonQuery[] = []
        const result = await fetchUserGroups({
            cookie: 'SUB=test',
            uid: '6402514052',
            requestJson: (query) => {
                queries.push(query)
                const isMember = query.url.includes('/getGroupList')
                return Promise.resolve({
                    status: 200,
                    record: isMember
                        ? { ok: 1, data: [{ id: 5225046125581012, idstr: '5225046125581012', name: '颜值' }] }
                        : {
                              ok: 1,
                              data: {
                                  total_number: 2,
                                  lists: [
                                      {
                                          id: 5225046125581012,
                                          idstr: '5225046125581012',
                                          name: '颜值',
                                          mode: 'private',
                                          member_count: 133,
                                      },
                                      {
                                          id: 4363617564453706,
                                          idstr: '4363617564453706',
                                          name: '娱乐圈',
                                          mode: 'public',
                                          member_count: 106,
                                      },
                                  ],
                              },
                          },
                })
            },
        })
        expect(queries.map((query) => new URL(query.url).pathname)).toEqual([
            '/ajax/profile/getGroupList',
            '/ajax/profile/getGroups',
        ])
        expect(result.groupIds).toEqual(['5225046125581012'])
        expect(result.groups).toHaveLength(2)
        expect(result.groups[0]).toEqual({
            id: '5225046125581012',
            name: '颜值',
            memberCount: 133,
            isPublic: false,
        })
        expect(result.groups[1]?.isPublic).toBe(true)
    })
})

describe('写接口', () => {
    it('新建分组：公开时带 isOpen，不公开不带', async () => {
        const mock = stubFetch({
            ok: 1,
            data: { id: 5368181583777909, idstr: '5368181583777909', name: '456', mode: 'public' },
        })
        const result = await createUserGroup({ cookie: 'SUB=test', name: '456', isPublic: true })
        const form = readForm(mock.mock.calls[0]?.[1] as RequestInit | undefined)
        expect(form.get('name')).toBe('456')
        expect(form.get('isOpen')).toBe('true')
        expect(result.group.id).toBe('5368181583777909')
        expect(result.group.isPublic).toBe(true)

        mock.mockClear()
        await createUserGroup({ cookie: 'SUB=test', name: '私人', isPublic: false })
        const privateForm = readForm(mock.mock.calls[0]?.[1] as RequestInit | undefined)
        expect(privateForm.get('name')).toBe('私人')
        expect(privateForm.get('isOpen')).toBeNull()
    })

    it('保存分组：form 带 uids / list_ids / origin_list_ids', async () => {
        const mock = stubFetch({ ok: 1, data: { result: true } })
        const result = await saveUserGroups({
            cookie: 'SUB=test',
            uid: '6402514052',
            listIds: ['5225046125581012', '5368181419414369'],
            originListIds: ['5225046125581012'],
        })
        const form = readForm(mock.mock.calls[0]?.[1] as RequestInit | undefined)
        expect(form.get('uids')).toBe('6402514052')
        expect(form.get('list_ids')).toBe('5225046125581012,5368181419414369')
        expect(form.get('origin_list_ids')).toBe('5225046125581012,0,5225046125581012')
        expect(result.saved).toBe(true)
    })

    it('设置备注：没有 ok 包装也算成功，备注取回包字段', async () => {
        const mock = stubFetch({ id: 6402514052, screen_name: '可爱的埋埋', remark: '埋总' })
        const result = await setUserRemark({ cookie: 'SUB=test', uid: '6402514052', remark: '埋总' })
        const form = readForm(mock.mock.calls[0]?.[1] as RequestInit | undefined)
        expect(form.get('uid')).toBe('6402514052')
        expect(form.get('remark')).toBe('埋总')
        expect(result.remark).toBe('埋总')
    })

    it('设置备注：ok 明确为 0 时按失败抛出', async () => {
        stubFetch({ ok: 0, msg: '操作过于频繁' })
        await expect(setUserRemark({ cookie: 'SUB=test', uid: '6402514052', remark: '埋总' })).rejects.toThrow(
            '设置备注失败：操作过于频繁',
        )
    })
})
