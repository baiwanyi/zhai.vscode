# 微博模块安全与性能审计记录（宿主侧）

> 范围：`src/modules/weibo` 全部 26 个文件，以及与之有调用契约的 `shared/types/weibo`、`modules/upload`、`common/webviewHtml`、`modules/note`、`modules/ai`。
> 方法：源码通读 + 定向探索（出网调用点、`child_process`、日志参数、重试与节流实现）；不触真网，结论以代码路径与单测为准。
> 证据以「文件 + 函数 / 常量」定位，不写行号——行号会随重构漂移，符号名更稳。
> 行为变更已同步到 `docs/modules/weibo.md` 的 2.1 / 2.5 / 2.22。

## 1. 结论摘要

- 安全：确认 11 项，9 项已修复、2 项部分修复（`SEC-04` / `SEC-10`）；无「严重」级问题，无远程可利用面（模块不监听对外端口，唯一 HTTP 服务只绑回环）。
- 性能：确认 12 项，6 项已修复、3 项部分修复、1 项需设计评审、2 项评估后不采纳。
- 主要风险不在「能否被远程攻破」，而在信任边界的收窄粒度：Cookie 发送域、重定向逐跳校验、回环服务访问凭证、写操作幂等。
- 极端输入的资源开销集中在两处：正文 HTML 解析（已加长度与锚点闭合前置判断）、图片 base64 内联（未改，需设计评审）。

## 2. 分级标准

| 等级 | 判定依据（满足任一） |
|---|---|
| 严重 | 可读写存储根外任意文件、无交互外泄会话凭证、任意命令执行，且下层无兜底 |
| 高 | 凭证跨域外发、写操作产生不可逆副作用、进程级资源耗尽、SSRF 可读内网响应体 |
| 中 | 需特定前置条件（恶意代理、关闭 `proxyStrictSSL`、上游被篡改、并发窗口）才可造成信息暴露或明显性能劣化；或存在缺口但下层可兜底 |
| 低 | 日志噪声、轻度信息暴露、极端输入下的资源浪费、可维护性问题 |

判定维度：触发条件（无需条件 / 单次点击 / 特定配置 / 需上游可控）、影响对象（凭证 / 文件 / 完整性 / 可用性 / 仅噪声）、既有兜底（无 / 可绕过 / 可靠）。定级取三者最严；修复成本只影响优先级，不影响等级。

## 3. 安全发现

| 编号 | 结论 | 发现 | 处理 | 等级 |
|---|---|---|---|---|
| SEC-01 | 已修复 | `mediaProxy` 在 401/403 时把 weibo.com 的登录 Cookie 附到白名单内**任意**主机的请求上（图床 `sinaimg.cn` / `weibo.cn` 也在白名单） | `buildRequestHeaders(target, cookie)` 按点分后缀只对 `weibo.com` 附加；不可解析的地址不附 | 中 |
| SEC-02 | 已修复 | `mediaProxy` 与 `videoServer` 的内置 fetch 自动跟随重定向，逐跳白名单只作用于 `https.request` 通道，上游一个 302 即可指向内网 | 两处全部 `redirect: 'manual'`，逐跳复用 `normalizeWeiboImageUrl` / `normalizeWeiboVideoUrl`；单测锁定「白名单外不再发第二跳」 | 中 |
| SEC-03 | 已修复 | 回环视频服务无访问凭证，本机任意进程可复用这条带 Referer 的通道 | 启动生成 128 位随机令牌，拼进本地播放地址；请求缺令牌或取值不符即 403 | 中 |
| SEC-04 | 已修复 | 写操作缺幂等：并发双击与网络重发会重复发博 / 重复评论；「评论并转发」是两步非原子写 | 已加「方法 + 载荷」飞行中互斥闸门（`WeiboRoutes.runWriteOnce`）；实测确认 `comments/create` 带 `is_repost=1` 可一次生成评论与转发，已改为单请求（净删约 17 行），原子性问题消除 | 中 |
| SEC-05 | 已修复 | 上游 `msg` 未剥离 HTML 即进入错误文案并原样回传 Webview | `panel.toSafeErrorMessage` 用 `stripWeiboHtml` 剥标签、折行、截断 200 字；分类码不变 | 中低 |
| SEC-06 | 已修复 | 清除凭证不清理 `weibo-media` 图片缓存，换号后旧账号图片残留磁盘 | `WeiboMediaProxy.clearCache()` + `WeiboRouteDeps.clearMediaCache`，清除凭证时整目录删除 | 低 |
| SEC-07 | 排除 | `rejectUnauthorized` 跟随 `http.proxyStrictSSL`，关闭时不校验证书 | 属用户显式配置的企业抓包场景；改为强制校验会让代理环境整体不可用，保持跟随并在文档登记 | 低 |
| SEC-08 | 已修复 | 微博面板把 `upload/*` 全部转交，含 `insert` / `remove` / `reveal`，宽于页面需要 | `WEIBO_UPLOAD_METHODS` 只放行 `pick` / `bytes` / `list`；下层 `isUploadPath` 仍兜底 | 低 |
| SEC-09 | 已修复 | 日志暴露面：`logger.error(msg, error)` 整对象输出；图床日志打印 pid 前缀 | 日志改传文案 + 堆栈字符串；pid 只记长度 | 低 |
| SEC-10 | 部分修复 | `spawn('ffmpeg')` 依赖 PATH 解析，无来源与版本信息 | 先 `resolveExecutablePath` 取绝对路径再启动，成功后记录路径与版本；不做来源白名单（环境由用户决定） | 低 |
| SEC-11 | 已修复 | 频道表内存缓存的键是完整 Cookie 字符串，进程内常驻会话凭证 | 键改为 `toAccountKey(cookie)`（SHA-256 前 16 位） | 低 |

补充：`child_process` 仅 `videoServer` 使用，参数为常量数组 + 白名单收窄后的地址，无 `shell: true`；ffmpeg 另加 `-nostdin` 与 `-protocol_whitelist http,https,tcp,tls`，阻断被重定向到 `file://` / `concat` 的读取路径。全模块无 `eval` / `new Function` / 动态 `require`。

## 4. 性能发现

| 编号 | 结论 | 发现 | 处理 | 等级 |
|---|---|---|---|---|
| PERF-01 | 部分修复 | 图片按 base64 内联回传，单图 4MB 产生约 5.3MB 字符串，且无内存缓存 | `IMAGE_TRANSPORT` 双通道：默认内联（上限 1.5MB + 12 条内存缓存 + bmiddle 兜底）；URI 通道已实现（缓存目录预创建并进 `localResourceRoots`，CSP 无需改动），但首次启用时全部图片被拒，暂默认关闭，待再次验证 | 中 |
| PERF-02 | 已修复 | 归一化早于去重，跨页重复条目仍做完整解析；同一 HTML 至少清洗两遍 | 循环内先取 id 去重再归一化（`readStatusKey`） | 中 |
| PERF-03 | 已修复 | 正文 HTML 无长度上限；`CONTENT_TAG_PATTERN` 的懒匹配在未闭合 `<a` 上退化到平方级；长文正则含嵌套量词 + `$` | `MAX_POST_HTML_LENGTH` + `hasUnbalancedAnchors` 前置判断；长文痕迹只取尾部 200 字符 | 中 |
| PERF-04 | 已修复 | 全局节流在 `await` 之后才写时间戳，并发调用同时放行 | 改「先占位再等待」（`reserveTurn`）；单测断言相邻请求间隔 | 中 |
| PERF-05 | 部分修复 | 缓存清理对全目录并发 `stat`（上限 800 个文件）；命中查找最多 5 次 `access` | `stat` 按 40 条分批、单条失败不中止；`findCached` 评估后不改（见第 5 节） | 中 |
| PERF-06 | 已修复 | 预热失败也计入 15 分钟冷却，一次断网让缓存空置半天；提前跳过被当作成功 | 冷却时刻移到「至少一项真正取到数据」之后，`runQuietly` 返回是否成功；单测覆盖全失败 / 部分成功 | 低中 |
| PERF-07 | 排除 | 翻页纯串行 + 1.2s 节流，加载两页至少约 2.4s | 并发化会破坏全局节流语义（418 的直接来源），属设计约束 | 低中 |
| PERF-08 | 已修复 | 单次超时 15s × 3 次尝试，最坏约 45s 才报错 | 超时类错误不重试，最坏降为一次超时 | 低中 |
| PERF-09 | 部分修复 | 每个播放请求起一个 ffmpeg，无并发上限；转码不可 seek | 并发闸门（上限 2）+ 宿主下发 `seekable`，转码时前端禁用进度拖动；真正的 Range 起点转码仍遗留 | 中 |
| PERF-10 | 已修复 | `AbortSignal.timeout(300_000)` 作用于整个响应，超过 5 分钟的视频被掐断 | 改为首字节 60s 定时器，拿到响应头即 `clearTimeout` | 低中 |
| PERF-11 | 已修复 | `readAttribute` 每次调用重新编译正则，每条 img / 锚点调用 2-3 次 | 按属性名缓存 `RegExp` | 低 |
| PERF-12 | 部分修复 | 元数据缓存 TTL 为无穷，分组写后读拿到旧快照 | 新增可选 `invalidateGroups`，分组新建 / 保存 / 备注写完后失效；TTL 是否开启属产品决策 | 低中 |

## 5. 评估后排除 / 复核后推翻

| 项 | 原判断 | 复核结论 |
|---|---|---|
| `webPublish` 超时参数「默认值分支不可达」 | 疑似 bug | **排除**：上传与发布各用 `30_000` 的独立常量，`timeoutMs` 为「覆盖本次所有请求」的单一语义，两者一致，不存在不可达分支 |
| `findCached` 改单次 `readdir` | 建议降为一次目录扫描 | **不采纳**：800 项目录的字符串处理比 5 次 `access` 更贵，除非引入带失效管理的索引 |
| 翻页并发化 | 提升加载速度 | **不采纳**：会绕开 1.2s 全局节流，直接撞上游频控 |
| `rejectUnauthorized` 强制开启 | 收紧 MITM 面 | **不采纳**：会让企业抓包代理环境整体不可用，改为文档登记 |

## 6. 遗留项

| 项 | 原因 | 建议 |
|---|---|---|
| 图片通道 base64 改造（PERF-01） | 涉及 CSP、`localResourceRoots`、Webview 取址三处联动，无法边改边试 | 单独立项，先出设计评审：候选是自定义协议或 `asWebviewUri` + 短时效目录 |
| 「评论并转发」原子化（SEC-04） | 已闭环：实测确认单请求（`is_repost=1`）可同时生成评论与转发，两步与补偿逻辑已删除 | — |
| 视频 Range 起点转码（PERF-09） | 已按 `seekable` 禁用拖动消除坏体验；**2026-11-23 决定不做**——`-ss` 起点转码 + 206 的改造成本高于收益 | 不再评估 |
| 缓存 TTL（PERF-12） | 无穷 TTL 命中率高，改有限值会增加回源与 418 风险 | 需要产品权衡「新鲜度」与「请求量」 |
| `ffmpeg` 来源校验（SEC-10） | 环境由用户决定，宿主不应替其做白名单 | 保持现状：路径与版本进日志，便于排查劫持 |
| 伪设备指纹 `fp`（2.18 已知风险） | 无法还原官网算法 | 若上游开始校验绑定关系，再从浏览器会话取真实值 |

## 7. 复核与回归方式

1. 静态：`pnpm run typecheck`、`pnpm exec eslint src/modules/weibo`、`pnpm exec prettier --check`。
2. 单测：`pnpm exec vitest run __tests__/weibo`；加固行为集中在 `__tests__/weiboHardening.test.ts`（11 项）：
   - Cookie 只发 `weibo.com` 域；
   - 并发请求按最小间隔排队；
   - 超时只发起一次请求；
   - 超长正文与未闭合锚点退化为纯文本；
   - 跨页重复条目计入 `droppedDuplicates` 且保持首见顺序；
   - 写操作并发重复被拒、完成后放行；
   - 视频重定向到白名单外不再发第二跳、白名单内正常跟随；
   - 预热全失败不记冷却、至少一项成功才记冷却。
3. 手工（界面与播放效果由使用者核对）：时间线加载与加载更多、图片与视频播放（含超过 5 分钟的长视频拖动）、发表 / 评论 / 转发 / 点赞、保存为笔记、清除凭证后 `weibo-media` 是否清空。

## 8. 变更清单

`mediaProxy.ts`、`videoServer.ts`、`webClient.ts`、`webTimeline.ts`、`weiboRoutes.ts`、`panel.ts`、`warmup.ts`、`weiboCache.ts`、`webFeed.ts`、`webPublish.ts`、`webInteraction.ts`、`webComments.ts`、`webReposts.ts`、`shared/types/weibo.ts`（`WeiboVideoResult.seekable`）、`src/weibo/block/WeiboVideoPlayer.tsx`、`src/weibo/block/WeiboPostMediaGrid.tsx`、`src/weibo/hooks/useWeiboCommentActions.ts`、`__tests__/weiboHardening.test.ts`（新增）、`__tests__/weiboCache.test.ts`、`__tests__/weiboCommentLike.test.ts`、`__tests__/weiboRepostLike.test.ts`、`docs/modules/weibo.md`（1.6 / 2.1 / 2.5 / 2.14 / 2.18 / 新增 2.22）。
