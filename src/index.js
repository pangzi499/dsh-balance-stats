/**
 * dsh-balance-stats — server half。
 *
 * 提供数据:
 *   1. 余额(balance):  DeepSeek `/user/balance`(含充值/赠送/总额), 轮询缓存。
 *   2. 总花费(totalCost): 跨全部会话累计估算消耗。
 *   3. 当前会话花费: sessionProjections 单元 `balanceStatsSessionCost`,
 *      客户端经 useProjection 实时读取(与 dsh-balance 同款机制)。
 *   4. 百分比(percent): 已用 = 总花费 / (可用总余额 + 总花费) × 100,
 *      剩余 = 100 − 已用。
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
  platformToken: '',
  platformTokenRef: 'DEEPSEEK_PLATFORM_TOKEN',
  invoiceRefreshIntervalMs: 21600000,
  platformBaseUrl: 'https://platform.deepseek.com',
  prices: {
    'deepseek-chat': { cacheHit: 0.1, cacheMiss: 1, output: 2 },
    'deepseek-reasoner': { cacheHit: 1, cacheMiss: 4, output: 16 },
    'deepseek-v4-flash': { cacheHit: 0.02, cacheMiss: 0.1, output: 0.2 },
    'deepseek-v4-pro': { cacheHit: 0.025, cacheMiss: 3, output: 6 },
  },
  v4PeakPrices: {
    'deepseek-v4-flash': { cacheHit: 0.10, cacheMiss: 3.0, output: 9.0 },
    'deepseek-v4-pro': { cacheHit: 0.30, cacheMiss: 9.0, output: 27.0 },
  },
  v4OffPeakPrices: {
    'deepseek-v4-flash': { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 },
    'deepseek-v4-pro': { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
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
  platformToken: z.string().default(DEFAULT_CONFIG.platformToken),
  platformTokenRef: z.string().default(DEFAULT_CONFIG.platformTokenRef),
  invoiceRefreshIntervalMs: z.number().default(DEFAULT_CONFIG.invoiceRefreshIntervalMs),
  platformBaseUrl: z.string().default(DEFAULT_CONFIG.platformBaseUrl),
  prices: z.dict(priceSchema).default(DEFAULT_CONFIG.prices),
  v4PeakPrices: z.dict(priceSchema).default(DEFAULT_CONFIG.v4PeakPrices),
  v4OffPeakPrices: z.dict(priceSchema).default(DEFAULT_CONFIG.v4OffPeakPrices),
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
  const priceMap = (raw, defaults) => {
    const source = raw && typeof raw === 'object' ? raw : {}
    const prices = {}
    for (const [model, value] of Object.entries({ ...defaults, ...source })) {
      prices[model] = price(value, defaults[model] ?? DEFAULT_CONFIG.defaultPrices)
    }
    return prices
  }
  return {
    apiKey: typeof src.apiKey === 'string' ? src.apiKey : '',
    apiKeyRef: typeof src.apiKeyRef === 'string' && src.apiKeyRef !== '' ? src.apiKeyRef : 'DEEPSEEK_API_KEY',
    baseUrl: typeof src.baseUrl === 'string' && src.baseUrl !== '' ? src.baseUrl : 'https://api.deepseek.com',
    refreshIntervalMs: num(src.refreshIntervalMs, 300000, 1000),
    clientPollIntervalMs: num(src.clientPollIntervalMs, 30000, 5000),
    timeoutMs: num(src.timeoutMs, 8000, 1000),
    currency: typeof src.currency === 'string' && src.currency !== '' ? src.currency : 'CNY',
    platformToken: typeof src.platformToken === 'string' ? src.platformToken : '',
    platformTokenRef: typeof src.platformTokenRef === 'string' && src.platformTokenRef !== '' ? src.platformTokenRef : 'DEEPSEEK_PLATFORM_TOKEN',
    invoiceRefreshIntervalMs: num(src.invoiceRefreshIntervalMs, 21600000, 600000),
    platformBaseUrl: typeof src.platformBaseUrl === 'string' && src.platformBaseUrl !== '' ? src.platformBaseUrl : 'https://platform.deepseek.com',
    prices: priceMap(src.prices, DEFAULT_CONFIG.prices),
    v4PeakPrices: priceMap(src.v4PeakPrices, DEFAULT_CONFIG.v4PeakPrices),
    v4OffPeakPrices: priceMap(src.v4OffPeakPrices, DEFAULT_CONFIG.v4OffPeakPrices),
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

/**
 * 归一化用户粘贴的 platform.deepseek.com userToken。
 * localStorage 原始值可能是纯字符串、JSON 字符串或 {value|token|access_token|
 * accessToken|userToken} 包裹；有效 token 为 ≥20 字符且不含空白。
 */
const TOKEN_KEYS = ['value', 'token', 'access_token', 'accessToken', 'userToken']
export const extractUserToken = (raw) => {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  let candidate = trimmed
  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed === 'string') {
      candidate = parsed
    } else if (parsed !== null && typeof parsed === 'object') {
      for (const key of TOKEN_KEYS) {
        if (typeof parsed[key] === 'string' && parsed[key].trim() !== '') {
          candidate = parsed[key]
          break
        }
      }
    }
  } catch {
    /* 非 JSON, 按原样处理 */
  }
  candidate = candidate.trim()
  if (candidate.length >= 2 &&
    ((candidate.startsWith('"') && candidate.endsWith('"')) ||
      (candidate.startsWith("'") && candidate.endsWith("'")))) {
    candidate = candidate.slice(1, -1).trim()
  }
  return candidate.length >= 20 && !/\s/.test(candidate) ? candidate : null
}

/** 掩码展示用: 只保留末 4 位。 */
const tokenHintOf = (token) => typeof token === 'string' && token.length >= 4 ? token.slice(-4) : null

/**
 * 服务端版账单解析(与 client/client.js 的 parseInvoiceExport 同语义:
 * 仅计 payment_order_status === "SUCCESS" 的充值; 赠送单按 status /
 * bonus_order_status 过滤; 币种必须一致)。两份实现需保持同步。
 */
export const parseInvoiceExport = (payload) => {
  const invoices = payload?.data?.biz_data?.invoices
  if (invoices === null || typeof invoices !== 'object' || !Array.isArray(invoices.payment_orders)) {
    throw new Error('invalid-structure')
  }
  const successful = invoices.payment_orders.filter((order) => order?.payment_order_status === 'SUCCESS')
  const currencies = [...new Set(successful.map((order) => order?.currency).filter((value) => typeof value === 'string' && value !== ''))]
  if (currencies.length > 1) throw new Error('mixed-currency')
  const sumAmounts = (orders) => orders.reduce((sum, order) => {
    const amount = Number(order?.amount ?? 0)
    if (!Number.isFinite(amount) || amount < 0) throw new Error('invalid-amount')
    return sum + amount
  }, 0)
  const bonusOrders = Array.isArray(invoices.bonus_orders) ? invoices.bonus_orders : []
  const eligibleBonus = bonusOrders.filter((order) => {
    if (order?.status !== undefined) return order.status === 'SUCCESS'
    if (order?.bonus_order_status !== undefined) return order.bonus_order_status === 'SUCCESS'
    return true
  })
  return {
    totalRecharge: Math.round(sumAmounts(successful) * 1e6) / 1e6,
    totalBonus: Math.round(sumAmounts(eligibleBonus) * 1e6) / 1e6,
    currency: currencies[0] ?? 'CNY',
    paymentOrderCount: successful.length,
    bonusOrderCount: eligibleBonus.length,
    importedAt: Date.now(),
  }
}

/** 本地日期键 YYYY-MM-DD(服务器本地时区)。 */
const dayKeyOf = (ms) => {
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const round6 = (n) => Math.round(n * 1e6) / 1e6

/** 将独立舍入产生的微小尾差归入绝对值最大的现有分组。 */
const reconcileRoundedBreakdown = (breakdown, total, positiveOnly = false) => {
  const rounded = {}
  for (const [key, value] of Object.entries(breakdown)) {
    const amount = round6(value)
    if (!positiveOnly || amount > 0) rounded[key] = amount
  }
  const keys = Object.keys(rounded)
  if (keys.length === 0) return rounded
  const sum = round6(Object.values(rounded).reduce((acc, amount) => acc + amount, 0))
  const residual = round6(round6(total) - sum)
  if (residual !== 0) {
    const target = keys.reduce((best, key) => Math.abs(rounded[key]) > Math.abs(rounded[best]) ? key : best)
    rounded[target] = round6(rounded[target] + residual)
  }
  return rounded
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
    if (!isAfterCutoff) return config.prices[model] ?? DEFAULT_CONFIG.prices[model] ?? config.defaultPrices
    const d = new Date(t)
    const hourBJT = (d.getUTCHours() + 8) % 24
    const isPeak = (hourBJT >= 9 && hourBJT < 12) || (hourBJT >= 14 && hourBJT < 18)
    const prices = isPeak
      ? config.v4PeakPrices ?? DEFAULT_CONFIG.v4PeakPrices
      : config.v4OffPeakPrices ?? DEFAULT_CONFIG.v4OffPeakPrices
    return prices[model] ?? config.defaultPrices
  }
  const costOf = (buckets, model, timestamp) => {
    const p = priceOf(model, timestamp)
    return ((buckets.uncachedInputTokens + buckets.cacheWriteTokens) * p.cacheMiss +
      buckets.cacheReadTokens * p.cacheHit +
      buckets.outputTokens * p.output) / 1e6
  }
  return {
    init: () => ({ currentModel: null, last: null, byModel: {}, modelOrder: [], costByDay: {}, costByModel: {}, totalCost: 0 }),
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
      const currentCost = costOf(buckets, model, timestamp)
      const previousCost = previous !== null ? costOf(previous.buckets, previous.model, previous.time) : 0
      const delta = currentCost - previousCost
      const dayKey = dayKeyOf(timestamp)
      const isNewModel = !(model in state.byModel)
      let byModel = state.byModel
      if (previous !== null) {
        byModel = { ...byModel, [previous.model]: subBuckets(byModel[previous.model] ?? zero(), previous.buckets) }
      }
      byModel = { ...byModel, [model]: addBuckets(byModel[model] ?? zero(), buckets) }
      let costByModel = { ...(state.costByModel ?? {}) }
      if (previous !== null) {
        costByModel[previous.model] = round6((costByModel[previous.model] ?? 0) - previousCost)
      }
      costByModel[model] = round6((costByModel[model] ?? 0) + currentCost)
      return {
        ...state,
        currentModel: nextModel,
        last: { turn, step, model, buckets, time: timestamp },
        byModel,
        modelOrder: isNewModel ? [...state.modelOrder, model] : state.modelOrder,
        costByDay: { ...state.costByDay, [dayKey]: round6((state.costByDay[dayKey] ?? 0) + delta) },
        costByModel,
        totalCost: round6(state.totalCost + delta),
      }
    },
    view: (state) => {
      const tokens = { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
      for (const model of state.modelOrder) {
        const b = state.byModel[model] ?? zero()
        tokens.uncachedInput += b.uncachedInputTokens
        tokens.cacheRead += b.cacheReadTokens
        tokens.cacheWrite += b.cacheWriteTokens
        tokens.output += b.outputTokens
      }
      const cost = round6(state.totalCost)
      return {
        cost,
        costByModel: reconcileRoundedBreakdown(state.costByModel ?? {}, cost, true),
        tokens,
        costByDay: reconcileRoundedBreakdown(state.costByDay, cost),
      }
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

/** 本地估算已用比例；余额使用 `/user/balance` 的可用总额。 */
const estimatedUsedPercent = (totalCost, totalBalance) => (totalBalance + totalCost) > 0
  ? Math.round((totalCost / (totalBalance + totalCost)) * 1000) / 10
  : 0

/** 仅供纯计算单元测试使用；插件运行入口仍为 apply。 */
export const __testing = { makeSessionFolder, sumLastDays, estimatedUsedPercent, extractUserToken, parseInvoiceExport, tokenHintOf }

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
      const roundedTotalCost = round6(totalCost)
      costCache = {
        state: 'ok',
        cost: roundedTotalCost,
        costByDay: reconcileRoundedBreakdown(totalCostByDay, roundedTotalCost),
        costByModel: reconcileRoundedBreakdown(totalCostByModel, roundedTotalCost, true),
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

  // ---- 账单自动获取(platform.deepseek.com get_all_invoice, userToken 认证) ----
  // token 来源优先级: UI 内存粘贴 > cordis 配置 platformToken >
  // credentials seam(platformTokenRef, 持久化文件) > 环境变量。
  const PLATFORM_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  let invoiceState = { state: 'empty', summary: null, error: null, fetchedAt: 0, consecutiveFailures: 0 }
  let invoiceManualSummary = null // JSON 粘贴导入(无 token)的服务端汇总
  let invoiceToken = null         // 本次会话内 UI 提交的 token(优先于持久来源)
  let invoiceTokenSource = null   // 'memory' | 'file' | 'config' | 'env'
  let invoiceFromSave = false     // UI 刚保存过: 来源以保存时的持久化结果为准, 不被轮询解析覆盖
  let invoiceWritable = null      // credentials seam describe().writable
  let nextInvoiceRefreshAt = 0
  let invoiceInflight = null

  /** 解析当前生效的 platform token; 无则返回 null。 */
  const resolvePlatformToken = async () => {
    if (invoiceToken !== null) return { token: invoiceToken, source: 'memory' }
    if (config.platformToken !== '') return { token: config.platformToken, source: 'config' }
    const credentials = ctx.get('credentials')
    if (credentials !== undefined && typeof credentials.resolve === 'function') {
      try {
        const hit = await credentials.resolve(config.platformTokenRef)
        if (hit !== undefined && typeof hit.value === 'string' && hit.value !== '') {
          return { token: hit.value, source: hit.source === 'env' ? 'env' : 'file' }
        }
      } catch {
        /* 解析失败视为未配置 */
      }
    }
    const fromEnv = process.env[config.platformTokenRef]
    if (typeof fromEnv === 'string' && fromEnv !== '') return { token: fromEnv, source: 'env' }
    return null
  }

  /** 拉取 get_all_invoice 原始响应; 会话失效返回 { ok:false, reason }, 其余异常抛出。 */
  const fetchInvoiceDocument = async (token) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.timeoutMs)
    try {
      const res = await fetch(`${config.platformBaseUrl.replace(/\/+$/, '')}/auth-api/v0/users/get_all_invoice`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          // 平台前置 WAF 会拦截非浏览器 UA 的请求
          'User-Agent': PLATFORM_UA,
        },
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`DeepSeek Platform HTTP ${res.status}`)
      const data = await res.json()
      const code = data !== null && typeof data === 'object' ? data.code : undefined
      // auth-api 系列成功码为 0(部分端点亦见 200); 40002/40003 为会话失效
      if (code === 40002 || code === 40003) return { ok: false, reason: 'session-expired' }
      if (code !== undefined && code !== 0 && code !== 200) {
        throw new Error(`DeepSeek Platform code ${code}`)
      }
      return { ok: true, data }
    } finally {
      clearTimeout(timer)
    }
  }

  /** 单次账单刷新: 解析 token → 拉取 → 解析汇总 → 更新状态机。 */
  const refreshInvoices = () => {
    if (invoiceInflight !== null) return invoiceInflight
    invoiceInflight = (async () => {
      const resolved = await resolvePlatformToken()
      // UI 保存过的 token: 来源已在保存时确定(file/memory), 不被解析结果覆盖
      if (!invoiceFromSave) invoiceTokenSource = resolved?.source ?? null
      const credentials = ctx.get('credentials')
      if (credentials !== undefined && typeof credentials.describe === 'function') {
        try {
          const info = await credentials.describe(config.platformTokenRef)
          invoiceWritable = info?.writable !== false
        } catch {
          invoiceWritable = null
        }
      }
      if (resolved === null) {
        invoiceState = { state: 'empty', summary: null, error: null, fetchedAt: 0, consecutiveFailures: 0 }
        return
      }
      try {
        const result = await fetchInvoiceDocument(resolved.token)
        if (!result.ok) {
          // 会话过期/无效: 保留上次成功汇总(stale-while-error), 固定间隔重试
          ctx.logger.warn(`[dsh-balance-stats] invoice fetch: session expired (${resolved.source} token)`)
          invoiceState = { ...invoiceState, state: 'session-expired', error: 'session-expired', consecutiveFailures: 0 }
          return
        }
        const summary = parseInvoiceExport(result.data)
        invoiceState = {
          state: 'ok',
          summary,
          error: null,
          fetchedAt: Date.now(),
          consecutiveFailures: 0,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const failures = invoiceState.consecutiveFailures + 1
        if (failures === 1) ctx.logger.warn(`[dsh-balance-stats] invoice fetch failed: ${message}`)
        // 失败保留旧汇总; 汇总从未成功时置为空态避免展示半途数据
        invoiceState = {
          ...invoiceState,
          state: invoiceState.summary !== null ? 'error' : 'empty',
          error: message,
          consecutiveFailures: failures,
        }
      }
    })().finally(() => {
      invoiceInflight = null
    })
    return invoiceInflight
  }

  ctx.effect(() => {
    let timer = null
    let disposed = false
    let run = () => {
      void refreshInvoices().then(() => {
        if (disposed) return
        let delay
        if (invoiceState.state === 'empty') delay = 60000
        else if (invoiceState.state === 'error') delay = Math.min(60000 * 2 ** invoiceState.consecutiveFailures, config.invoiceRefreshIntervalMs)
        else delay = config.invoiceRefreshIntervalMs // ok / session-expired 固定间隔
        nextInvoiceRefreshAt = Date.now() + delay
        timer = setTimeout(run, delay)
      })
    }
    timer = setTimeout(run, 2500)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, 'dsh-balance-stats: invoice loop')


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
      stateVersion: 2,
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
      const balance = typeof primary?.total === 'number' ? primary.total : 0
      const totalCost = costCache.state === 'ok' ? costCache.cost : 0
      const costByDay = costCache.state === 'ok' ? costCache.costByDay : {}
      out.stats = {
        state: costCache.state,
        totalCost,
        percent: estimatedUsedPercent(totalCost, balance),
        today: sumLastDays(costByDay, 1),
        day7: sumLastDays(costByDay, 7),
        day30: sumLastDays(costByDay, 30),
        costByDay,
        costByModel: costCache.state === 'ok' ? costCache.costByModel : {},
        tokens: costCache.state === 'ok' ? costCache.tokens : null,
        sessions: costCache.state === 'ok' ? costCache.sessions : 0,
        ...(costCache.error !== null ? { error: costCache.error } : {}),
      }
      // 账单块: state 描述自动获取链路健康度; 汇总在失败时保留旧值
      // (stale-while-error); summarySource 区分自动获取与手动 JSON 导入。
      const summary = invoiceState.summary ?? invoiceManualSummary
      out.invoice = {
        enabled: invoiceTokenSource !== null,
        state: invoiceState.state,
        fetchedAt: invoiceState.fetchedAt,
        nextRefreshAt: nextInvoiceRefreshAt,
        summary: summary !== null && summary !== undefined ? summary : null,
        summarySource: invoiceState.summary !== null ? 'auto' : invoiceManualSummary !== null ? 'manual' : null,
        error: invoiceState.error,
        tokenHint: invoiceToken !== null ? tokenHintOf(invoiceToken) : null,
        source: invoiceTokenSource,
        writable: invoiceWritable,
      }
      return out
    }

    // ---- 导入端点(POST /balance-stats) ----
    // 书签/油猴脚本从 https://platform.deepseek.com 同源读取 userToken 后
    // POST 到本机; 详情卡 UI 也走同一端点。仅放行平台来源的跨域请求。
    const CORS_ORIGIN = 'https://platform.deepseek.com'
    const IMPORT_BODY_LIMIT = 256 * 1024

    const corsHeadersFor = (req) => {
      const origin = req.headers?.origin
      return typeof origin === 'string' && origin === CORS_ORIGIN
        ? { 'Access-Control-Allow-Origin': CORS_ORIGIN, Vary: 'Origin' }
        : {}
    }

    const optionsHeadersFor = (req) => {
      const cors = corsHeadersFor(req)
      if (cors['Access-Control-Allow-Origin'] === undefined) return {}
      const headers = {
        ...cors,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type',
        'Access-Control-Max-Age': '600',
      }
      // Chrome 私有网络访问(PNA): HTTPS 页面 → http://127.0.0.1 需显式允许
      if (req.headers?.['access-control-request-private-network'] === 'true') {
        headers['Access-Control-Allow-Private-Network'] = 'true'
      }
      return headers
    }

    const jsonRespond = (res, status, payload, cors) => {
      const body = JSON.stringify(payload)
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...cors,
        'Content-Length': Buffer.byteLength(body),
      })
      res.end(body)
    }

    const readJsonBody = (req) => new Promise((resolveBody, reject) => {
      const chunks = []
      let size = 0
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > IMPORT_BODY_LIMIT) {
          const error = new Error('payload-too-large')
          error.code = 'payload-too-large'
          reject(error)
          if (typeof req.destroy === 'function') req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        if (size === 0) {
          resolveBody({})
          return
        }
        try {
          resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch {
          const error = new Error('invalid-json')
          error.code = 'invalid-json'
          reject(error)
        }
      })
      req.on('error', reject)
    })

    /** 保存 token: 先验证一次拉取, 成功后尽量持久化到 credentials 文档。 */
    const importUserToken = async (raw) => {
      const token = extractUserToken(raw)
      if (token === null) return { ok: false, error: 'invalid-token' }
      let document
      try {
        const result = await fetchInvoiceDocument(token)
        if (!result.ok) return { ok: false, error: result.reason }
        document = result.data
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
      let summary
      try {
        summary = parseInvoiceExport(document)
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'invalid-structure' }
      }
      // 持久化: seam 可写则写入凭证文档(重启自动恢复); 失败降级为内存并记录原因
      let source = 'memory'
      const credentials = ctx.get('credentials')
      if (credentials !== undefined && typeof credentials.set === 'function') {
        try {
          if (typeof credentials.describe === 'function') {
            const info = await credentials.describe(config.platformTokenRef)
            invoiceWritable = info?.writable !== false
          }
          await credentials.set(config.platformTokenRef, token)
          source = 'file'
        } catch (error) {
          source = 'memory'
          ctx.logger.warn(`[dsh-balance-stats] credential persist failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      invoiceToken = token
      invoiceTokenSource = source
      invoiceFromSave = true
      invoiceState = {
        state: 'ok',
        summary,
        error: null,
        fetchedAt: Date.now(),
        consecutiveFailures: 0,
      }
      return { ok: true, source, summary, tokenHint: tokenHintOf(token) }
    }

    /** 清除: 丢弃内存 token、服务端汇总, 并尽量 unset 凭证文档中的持久副本。 */
    const clearImport = async () => {
      invoiceToken = null
      invoiceTokenSource = null
      invoiceFromSave = false
      invoiceManualSummary = null
      invoiceState = { state: 'empty', summary: null, error: null, fetchedAt: 0, consecutiveFailures: 0 }
      const credentials = ctx.get('credentials')
      if (credentials !== undefined && typeof credentials.unset === 'function' && invoiceWritable !== false) {
        try {
          await credentials.unset(config.platformTokenRef)
        } catch {
          /* 无法清除(遮蔽/权限)时忽略, 由 remainingSource 反映现状 */
        }
      }
      const remaining = await resolvePlatformToken()
      invoiceTokenSource = remaining?.source ?? null
      return { ok: true, cleared: true, remainingSource: remaining?.source ?? null }
    }

    const handleImport = async (req, res) => {
      const cors = corsHeadersFor(req)
      let bodyPayload
      try {
        bodyPayload = await readJsonBody(req)
      } catch (error) {
        jsonRespond(res, error.code === 'payload-too-large' ? 413 : 400, { ok: false, error: error.code ?? 'invalid-json' }, cors)
        return
      }
      if (bodyPayload === null || typeof bodyPayload !== 'object' || Array.isArray(bodyPayload)) {
        jsonRespond(res, 400, { ok: false, error: 'invalid-json' }, cors)
        return
      }
      if (bodyPayload.clear === true) {
        jsonRespond(res, 200, await clearImport(), cors)
        return
      }
      if (typeof bodyPayload.userToken === 'string' && bodyPayload.userToken.trim() !== '') {
        jsonRespond(res, 200, await importUserToken(bodyPayload.userToken), cors)
        return
      }
      // 其余情况: 整个 body 视为 get_all_invoice 原始响应(手动 JSON 导入, 不保存 token)
      try {
        invoiceManualSummary = parseInvoiceExport(bodyPayload)
      } catch (error) {
        jsonRespond(res, 200, { ok: false, error: error instanceof Error ? error.message : 'invalid-structure' }, cors)
        return
      }
      jsonRespond(res, 200, { ok: true, mode: 'invoice', summary: invoiceManualSummary }, cors)
    }

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/balance-stats',
      handler: async (req, res) => {
        if (req.method === 'OPTIONS') {
          const headers = optionsHeadersFor(req)
          res.writeHead(headers['Access-Control-Allow-Origin'] !== undefined ? 204 : 405, headers['Access-Control-Allow-Origin'] !== undefined ? headers : { Allow: 'GET, HEAD, POST, OPTIONS' })
          res.end()
          return
        }
        if (req.method === 'POST') {
          await handleImport(req, res)
          return
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { Allow: 'GET, HEAD, POST, OPTIONS' })
          res.end()
          return
        }
        // 手动刷新: GET ?force=1 时同时刷新余额与总花费，避免返回
        // “新余额 + 旧成本”的混合快照。
        if (req.method === 'GET') {
          const url = new URL(req.url ?? '/', 'http://localhost')
          if (url.searchParams.get('force') === '1') {
            await Promise.all([refresh(), computeTotalCostDebounced()])
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
