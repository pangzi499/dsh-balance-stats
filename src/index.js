/**
 * dsh-balance-stats — server half。
 *
 * 提供数据:
 *   1. 余额(balance):  DeepSeek `/user/balance`(含充值/赠送/总额), 轮询缓存。
 *   2. 总花费(totalCost): 跨全部会话累计估算消耗。
 *   3. 当前会话花费: sessionProjections 单元 `balanceStatsSessionCost`,
 *      客户端经 useProjection 实时读取(与 dsh-balance 同款机制)。
 *   4. 百分比(percent): 已用 = 总花费 / (余额 + 总花费) × 100,
 *      剩余 = 100 − 已用。其中"余额"指剩余充值(topped-up)。
 *   5. 7天/30天花费: 按事件发生时间(含 v4 峰谷计价)分天累计,
 *      计算最近 7 天 / 30 天(含今天)合计。
 *
 * 密钥复用 ctx.credentials / 环境变量(默认 DEEPSEEK_API_KEY)。
 * Config 使用 Harness 同版本的 Schemastery 标准 schema；apply() 仍会做防御性归一化。
 */

import z from '@deepseek-ai/schemastery'

export const name = 'dsh-balance-stats'

/** 业务层默认值，与 loader 需要的 Config schema 分离。 */
const DEFAULT_CONFIG = {
  apiKey: '',
  apiKeyRef: 'DEEPSEEK_API_KEY',
  baseUrl: 'https://api.deepseek.com',
  refreshIntervalMs: 300000,
  clientPollIntervalMs: 30000,
  timeoutMs: 8000,
  currency: 'CNY',
  prices: {
    'deepseek-chat': { cacheHit: 0.1, cacheMiss: 1, output: 2 },
    'deepseek-reasoner': { cacheHit: 1, cacheMiss: 4, output: 16 },
    'deepseek-v4-flash': { cacheHit: 0.02, cacheMiss: 0.1, output: 0.2 },
  },
  defaultPrices: { cacheHit: 0.1, cacheMiss: 1, output: 2 },
}

const priceSchema = z.object({
  cacheHit: z.number().default(0.1),
  cacheMiss: z.number().default(1),
  output: z.number().default(2),
})

/** Cordis loader 在启动插件前通过 Standard Schema 验证并填充默认值。 */
export const Config = z.object({
  apiKey: z.string().default(DEFAULT_CONFIG.apiKey),
  apiKeyRef: z.string().default(DEFAULT_CONFIG.apiKeyRef),
  baseUrl: z.string().default(DEFAULT_CONFIG.baseUrl),
  refreshIntervalMs: z.number().default(DEFAULT_CONFIG.refreshIntervalMs),
  clientPollIntervalMs: z.number().default(DEFAULT_CONFIG.clientPollIntervalMs),
  timeoutMs: z.number().default(DEFAULT_CONFIG.timeoutMs),
  currency: z.string().default(DEFAULT_CONFIG.currency),
  prices: z.dict(priceSchema).default(DEFAULT_CONFIG.prices),
  defaultPrices: priceSchema.default(DEFAULT_CONFIG.defaultPrices),
})

/** 归一化配置: 填充缺省值并钳制数值字段。 */
const normalizeConfig = (raw) => {
  const src = raw && typeof raw === 'object' ? raw : {}
  const num = (v, dflt, min) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= min ? n : dflt
  }
  const price = (v, dflt) => {
    const o = v && typeof v === 'object' ? v : {}
    return {
      cacheHit: num(o.cacheHit, dflt.cacheHit, 0),
      cacheMiss: num(o.cacheMiss, dflt.cacheMiss, 0),
      output: num(o.output, dflt.output, 0),
    }
  }
  const prices = {}
  const rawPrices = src.prices && typeof src.prices === 'object' ? src.prices : {}
  for (const [model, p] of Object.entries(rawPrices)) prices[model] = price(p, DEFAULT_CONFIG.defaultPrices)
  return {
    apiKey: typeof src.apiKey === 'string' ? src.apiKey : '',
    apiKeyRef: typeof src.apiKeyRef === 'string' && src.apiKeyRef !== '' ? src.apiKeyRef : 'DEEPSEEK_API_KEY',
    baseUrl: typeof src.baseUrl === 'string' && src.baseUrl !== '' ? src.baseUrl : 'https://api.deepseek.com',
    refreshIntervalMs: num(src.refreshIntervalMs, 300000, 1000),
    clientPollIntervalMs: num(src.clientPollIntervalMs, 30000, 5000),
    timeoutMs: num(src.timeoutMs, 8000, 1000),
    currency: typeof src.currency === 'string' && src.currency !== '' ? src.currency : 'CNY',
    prices,
    defaultPrices: price(src.defaultPrices, DEFAULT_CONFIG.defaultPrices),
  }
}

/** 归一化 DeepSeek 余额响应中的金额字符串。 */
const toAmount = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** 归一化 `/user/balance` 响应体。 */
const normalizeBalances = (data) => {
  const infos = Array.isArray(data?.balance_infos) ? data.balance_infos : []
  return infos.map((info) => ({
    currency: typeof info?.currency === 'string' && info.currency !== '' ? info.currency : 'CNY',
    total: toAmount(info?.total_balance),
    granted: toAmount(info?.granted_balance),
    toppedUp: toAmount(info?.topped_up_balance),
  }))
}

/** 本地日期键 YYYY-MM-DD(服务器本地时区)。 */
const dayKeyOf = (ms) => {
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 会话花费折叠(与 dsh-token-meter 的 tokenUsage 同语义:
 * 同 (turn,step) 的 usage 样本替换而非重复计数; 模型取自
 * request/header / request/context, last-wins)。
 *
 * 每收到一条新的用量样本, 用样本发生时间(event.time)计价(含 v4 峰谷),
 * 按替换语义做增量: costDelta = 新样本价 − 被替换旧样本价。
 * 按天累计到 state.costByDay。
 */
const makeSessionFolder = (config) => {
  const zero = () => ({ uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 })
  const bucketsOf = (usage) => ({
    uncachedInputTokens: usage.inputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    outputTokens: usage.outputTokens,
  })
  const bucketsEqual = (a, b) =>
    a.uncachedInputTokens === b.uncachedInputTokens && a.cacheReadTokens === b.cacheReadTokens &&
    a.cacheWriteTokens === b.cacheWriteTokens && a.outputTokens === b.outputTokens
  const addBuckets = (a, b) => ({
    uncachedInputTokens: a.uncachedInputTokens + b.uncachedInputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  })
  const subBuckets = (a, b) => ({
    uncachedInputTokens: a.uncachedInputTokens - b.uncachedInputTokens,
    cacheReadTokens: a.cacheReadTokens - b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens - b.cacheWriteTokens,
    outputTokens: a.outputTokens - b.outputTokens,
  })
  const priceOf = (model, timestamp) => {
    const isV4Flash = model === 'deepseek-v4-flash'
    const isV4Pro = model === 'deepseek-v4-pro'
    if (!isV4Flash && !isV4Pro) return config.prices[model] ?? config.defaultPrices
    const t = typeof timestamp === 'number' && timestamp > 0 ? timestamp : Date.now()
    // 2026-08-17T00:00:00+08:00 起 v4 峰谷计价
    const isAfterCutoff = t >= 1786896000000
    if (!isAfterCutoff) {
      if (isV4Flash) return { cacheHit: 0.02, cacheMiss: 1, output: 2 }
      if (isV4Pro) return { cacheHit: 0.025, cacheMiss: 3, output: 6 }
    }
    const d = new Date(t)
    const hourBJT = (d.getUTCHours() + 8) % 24
    const isPeak = (hourBJT >= 9 && hourBJT < 12) || (hourBJT >= 14 && hourBJT < 18)
    if (isPeak) {
      if (isV4Flash) return { cacheHit: 0.10, cacheMiss: 3.0, output: 9.0 }
      if (isV4Pro) return { cacheHit: 0.30, cacheMiss: 9.0, output: 27.0 }
    }
    if (isV4Flash) return { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 }
    if (isV4Pro) return { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 }
    return config.defaultPrices
  }
  const costOf = (buckets, model, timestamp) => {
    const p = priceOf(model, timestamp)
    return ((buckets.uncachedInputTokens + buckets.cacheWriteTokens) * p.cacheMiss +
      buckets.cacheReadTokens * p.cacheHit +
      buckets.outputTokens * p.output) / 1e6
  }
  const round6 = (n) => Math.round(n * 1e6) / 1e6

  return {
    init: () => ({ currentModel: null, last: null, byModel: {}, modelOrder: [], costByDay: {}, totalCost: 0 }),
    /** 喂入一条会话事件; 返回新的状态。 */
    apply(state, event) {
      let nextModel = state.currentModel
      if (event.type === 'request/header') {
        const model = event.data?.header?.config?.model
        if (typeof model === 'string' && model !== '') nextModel = model
      } else if (event.type === 'request/context') {
        const model = event.data?.model
        if (typeof model === 'string' && model !== '') nextModel = model
      }
      let usage = null
      let turn = 0
      let step = 0
      let timestamp = typeof event.time === 'number' ? event.time : Date.now()
      if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'usage') {
        ;({ turn, step } = event.data)
        usage = event.data.chunk.usage
      } else if (event.type === 'assistant/message' && event.data?.usage !== undefined) {
        ;({ turn, step, usage } = event.data)
      }
      if (usage === null) {
        return nextModel === state.currentModel ? state : { ...state, currentModel: nextModel }
      }
      const model = nextModel ?? 'unknown'
      const buckets = bucketsOf(usage)
      const previous = state.last !== null && state.last.turn === turn && state.last.step === step ? state.last : null
      if (previous !== null && previous.model === model && bucketsEqual(previous.buckets, buckets)) {
        return nextModel === state.currentModel ? state : { ...state, currentModel: nextModel }
      }
      // 替换语义的增量计价: 新样本价 − 旧样本价
      const delta = costOf(buckets, model, timestamp) - (previous !== null ? costOf(previous.buckets, previous.model, previous.time) : 0)
      const dayKey = dayKeyOf(timestamp)
      const isNewModel = !(model in state.byModel)
      let byModel = state.byModel
      if (previous !== null) {
        byModel = { ...byModel, [previous.model]: subBuckets(byModel[previous.model] ?? zero(), previous.buckets) }
      }
      byModel = { ...byModel, [model]: addBuckets(byModel[model] ?? zero(), buckets) }
      return {
        ...state,
        currentModel: nextModel,
        last: { turn, step, model, buckets, time: timestamp },
        byModel,
        modelOrder: isNewModel ? [...state.modelOrder, model] : state.modelOrder,
        costByDay: { ...state.costByDay, [dayKey]: round6((state.costByDay[dayKey] ?? 0) + delta) },
        totalCost: round6(state.totalCost + delta),
      }
    },
    view: (state) => {
      const tokens = { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
      const costByModel = {}
      for (const model of state.modelOrder) {
        const b = state.byModel[model] ?? zero()
        tokens.uncachedInput += b.uncachedInputTokens
        tokens.cacheRead += b.cacheReadTokens
        tokens.cacheWrite += b.cacheWriteTokens
        tokens.output += b.outputTokens
        const c = costOf(b, model, Date.now())
        if (c > 0) costByModel[model] = round6(c)
      }
      return { cost: state.totalCost, costByModel, tokens, costByDay: state.costByDay }
    },
  }
}

/** 最近 n 天(含今天)花费合计。 */
const sumLastDays = (costByDay, n) => {
  const now = Date.now()
  let sum = 0
  for (let i = 0; i < n; i++) {
    const key = dayKeyOf(now - i * 86400000)
    sum += costByDay[key] ?? 0
  }
  return Math.round(sum * 1e6) / 1e6
}

/** 仅供纯计算单元测试使用；插件运行入口仍为 apply。 */
export const __testing = { makeSessionFolder, sumLastDays }

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)

  /** 解析本次刷新使用的密钥(每次操作重新解析, 遵循 credentials seam)。 */
  const resolveKey = async () => {
    if (config.apiKey !== '') return config.apiKey
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      try {
        const hit = await credentials.resolve(config.apiKeyRef)
        if (hit !== undefined) return hit.value
      } catch {
        /* 解析失败视为未配置 */
      }
    }
    return process.env[config.apiKeyRef] ?? ''
  }

  let cache = { state: 'empty', payload: null, error: null, fetchedAt: 0, lastErrorAt: 0 }
  let inflight = null
  let consecutiveFailures = 0

  const refresh = () => {
    if (inflight !== null) return inflight
    inflight = (async () => {
      const key = await resolveKey()
      if (key === '') {
        cache = { state: 'error', payload: null, error: 'api-key-missing', fetchedAt: 0, lastErrorAt: Date.now() }
        consecutiveFailures++
        return
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), config.timeoutMs)
      try {
        const res = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/user/balance`, {
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`DeepSeek API HTTP ${res.status}`)
        const data = await res.json()
        cache = {
          state: 'ok',
          payload: {
            isAvailable: data?.is_available === true,
            balances: normalizeBalances(data),
          },
          error: null,
          fetchedAt: Date.now(),
          lastErrorAt: 0,
        }
        consecutiveFailures = 0
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        consecutiveFailures++
        if (consecutiveFailures === 1) ctx.logger.warn(`[dsh-balance-stats] balance fetch failed: ${message}`)
        // 保留上次成功值(stale-while-error), 仅标记错误。
        cache = {
          state: cache.state === 'ok' ? 'ok' : 'error',
          payload: cache.payload,
          error: message,
          fetchedAt: cache.fetchedAt,
          lastErrorAt: Date.now(),
        }
      } finally {
        clearTimeout(timer)
      }
    })().finally(() => {
      inflight = null
    })
    return inflight
  }

  // ---- 总花费折叠(跨全部会话, 按天聚合) ----
  let costCache = { state: 'empty', cost: 0, costByDay: {}, costByModel: {}, tokens: null, sessions: 0, error: null, at: 0 }
  let costInflight = null

  const foldOneSession = async (folder, sessionQuery, sessionId) => {
    const loaded = await sessionQuery.readSession(sessionId)
    const events = loaded?.events ?? []
    let state = folder.init()
    for (const event of events) state = folder.apply(state, event)
    return folder.view(state)
  }

  const computeTotalCost = async () => {
    const sessionQuery = ctx.get('sessionQuery')
    if (sessionQuery === undefined) {
      costCache = { state: 'error', cost: 0, costByDay: {}, costByModel: {}, tokens: null, sessions: 0, error: 'sessionQuery unavailable', at: Date.now() }
      return
    }
    const folder = makeSessionFolder(config)
    let totalCost = 0
    const totalCostByDay = {}
    const totalCostByModel = {}
    const totalTokens = { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
    let sessions = 0
    try {
      const list = await sessionQuery.listSessions()
      const CONCURRENCY = 4
      const queue = [...list]
      const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        while (queue.length > 0) {
          const record = queue.shift()
          const id = record?.header?.id ?? record?.id
          if (typeof id !== 'string') continue
          try {
            const view = await foldOneSession(folder, sessionQuery, id)
            totalCost += view.cost
            sessions++
            for (const [model, c] of Object.entries(view.costByModel)) {
              totalCostByModel[model] = (totalCostByModel[model] ?? 0) + c
            }
            for (const [day, c] of Object.entries(view.costByDay)) {
              totalCostByDay[day] = (totalCostByDay[day] ?? 0) + c
            }
            if (view.tokens !== null) {
              totalTokens.uncachedInput += view.tokens.uncachedInput
              totalTokens.cacheRead += view.tokens.cacheRead
              totalTokens.cacheWrite += view.tokens.cacheWrite
              totalTokens.output += view.tokens.output
            }
          } catch {
            /* 单个会话失败跳过 */
          }
        }
      })
      await Promise.all(workers)
      const round6 = (n) => Math.round(n * 1e6) / 1e6
      for (const day of Object.keys(totalCostByDay)) totalCostByDay[day] = round6(totalCostByDay[day])
      for (const model of Object.keys(totalCostByModel)) totalCostByModel[model] = round6(totalCostByModel[model])
      costCache = {
        state: 'ok',
        cost: round6(totalCost),
        costByDay: totalCostByDay,
        costByModel: totalCostByModel,
        tokens: totalTokens,
        sessions,
        error: null,
        at: Date.now(),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger.warn(`[dsh-balance-stats] total cost fold failed: ${message}`)
      costCache = { ...costCache, error: message, at: Date.now() }
    }
  }

  const computeTotalCostDebounced = () => {
    if (costInflight !== null) return costInflight
    costInflight = computeTotalCost().finally(() => {
      costInflight = null
    })
    return costInflight
  }

  ctx.effect(() => {
    let timer = null
    let run = () => {
      void refresh().then(() => {
        const missingKey = cache.state === 'error' && cache.error === 'api-key-missing'
        const delay = missingKey ? 5000 : config.refreshIntervalMs
        timer = setTimeout(run, delay)
      })
    }
    timer = setTimeout(run, 1000)
    return () => clearTimeout(timer)
  }, 'dsh-balance-stats: refresh loop')

  ctx.effect(() => {
    let timer = null
    let run = () => {
      void computeTotalCostDebounced().then(() => {
        timer = setTimeout(run, config.refreshIntervalMs)
      })
    }
    timer = setTimeout(run, 1500)
    return () => clearTimeout(timer)
  }, 'dsh-balance-stats: cost fold loop')

  // 当前会话花费投影: 客户端 useProjection("balanceStatsSessionCost") 实时读取。
  // schema 只需带 parse(投影边界只调用 schema.parse(view)); 避免引入 zod 依赖。
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    const folder = makeSessionFolder(config)
    projectionCtx.sessionProjections.register({
      key: 'balanceStatsSessionCost',
      schema: { parse: (v) => v },
      init: () => folder.init(),
      apply: (state, event) => folder.apply(state, event),
      view: (state) => {
        const v = folder.view(state)
        return {
          cost: v.cost,
          costByDay: v.costByDay,
          currency: config.currency,
        }
      },
      stateVersion: 1,
    })
  })

  // 可选 webServer: 提供浏览器读取的缓存端点(headless 组合不受影响)。
  ctx.inject(['webServer'], (webCtx) => {
    const serialize = () => {
      const base = {
        ok: cache.state === 'ok',
        fetchedAt: cache.fetchedAt,
        refreshIntervalMs: config.refreshIntervalMs,
        clientPollIntervalMs: config.clientPollIntervalMs,
        currency: config.currency,
        prices: config.prices,
        defaultPrices: config.defaultPrices,
      }
      let out
      if (cache.state === 'ok') {
        out = {
          ...base,
          isAvailable: cache.payload.isAvailable,
          balances: cache.payload.balances,
          ...(cache.error !== null ? { error: cache.error, stale: true } : {}),
        }
      } else {
        out = { ...base, error: cache.error ?? 'unknown' }
      }
      const primary = out.balances?.[0]
      const balance = typeof primary?.toppedUp === 'number' ? primary.toppedUp : 0
      const totalCost = costCache.state === 'ok' ? costCache.cost : 0
      const costByDay = costCache.state === 'ok' ? costCache.costByDay : {}
      out.stats = {
        state: costCache.state,
        totalCost,
        // 用户口径: 百分比 = 总花费 / (余额 + 总花费) × 100
        percent: (balance + totalCost) > 0
          ? Math.round((totalCost / (balance + totalCost)) * 1000) / 10
          : 0,
        today: sumLastDays(costByDay, 1),
        day7: sumLastDays(costByDay, 7),
        day30: sumLastDays(costByDay, 30),
        costByDay,
        costByModel: costCache.state === 'ok' ? costCache.costByModel : {},
        tokens: costCache.state === 'ok' ? costCache.tokens : null,
        sessions: costCache.state === 'ok' ? costCache.sessions : 0,
        ...(costCache.error !== null ? { error: costCache.error } : {}),
      }
      return out
    }
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/balance-stats',
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { Allow: 'GET, HEAD' })
          res.end()
          return
        }
        // 手动刷新: GET ?force=1 时立即向 DeepSeek 重新拉取余额
        // (refresh() 内部 inflight 去重, 与 5 分钟定时循环互斥),
        // 并在后台重算总花费(不阻塞响应; 客户端轮询会拿到新结果)。
        if (req.method === 'GET') {
          const url = new URL(req.url ?? '/', 'http://localhost')
          if (url.searchParams.get('force') === '1') {
            await refresh()
            void computeTotalCostDebounced()
          }
        }
        const body = JSON.stringify(serialize())
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Length': Buffer.byteLength(body),
        })
        res.end(req.method === 'HEAD' ? undefined : body)
      },
    }), 'dsh-balance-stats: route')
  })
}
