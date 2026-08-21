import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { apply } from '../src/index.js'

const LONG_TOKEN = 'abcdefghijklmnopqrstuvwxyz01'

const invoiceOk = (code = 0) => ({
  ok: true,
  async json() {
    return { code, msg: 'success', data: { biz_data: { invoices: {
      payment_orders: [{ payment_order_status: 'SUCCESS', amount: 130, currency: 'CNY' }],
      bonus_orders: [],
    } } } }
  },
})

const invoiceExpired = () => ({
  ok: true,
  async json() {
    return { code: 40003, msg: 'Authorization Failed (invalid token)', data: null }
  },
})

/** 按 URL 分流的 fetch mock: api.deepseek.com → 余额, platform → 可配置响应。 */
const mockFetch = (platformFactory) => {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    if (String(url).includes('api.deepseek.com')) {
      return {
        ok: true,
        async json() {
          return { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '9.96', topped_up_balance: '130', granted_balance: '0' }] }
        },
      }
    }
    return platformFactory()
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

const setup = (credentials) => {
  let route = null
  const webCtx = {
    effect(fn) { return fn() },
    webServer: { register(value) { route = value; return () => {} } },
  }
  apply({
    effect() {},
    get(key) { return key === 'credentials' ? credentials : undefined },
    inject(deps, callback) { if (deps.includes('webServer')) callback(webCtx) },
    logger: { warn() {} },
  }, {})
  assert.notEqual(route, null)
  return route.handler
}

const mockRes = () => {
  const res = {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) { res.status = status; res.headers = headers ?? {} },
    end(value) { res.body = value?.toString() ?? '' },
  }
  return res
}

const postReq = (payload, headers = {}) => {
  const req = new EventEmitter()
  req.method = 'POST'
  req.url = '/balance-stats'
  req.headers = { ...headers }
  queueMicrotask(() => {
    req.emit('data', Buffer.from(JSON.stringify(payload)))
    req.emit('end')
  })
  return req
}

const credentialsSeam = (overrides = {}) => ({
  resolve: async () => undefined,
  describe: async () => ({ configured: false, writable: true }),
  set: async () => {},
  unset: async () => {},
  ...overrides,
})

test('GET reports invoice block disabled before any token is configured', async () => {
  const handler = setup(undefined)
  const { restore } = mockFetch(invoiceExpired)
  try {
    const res = mockRes()
    await handler({ method: 'GET', url: '/balance-stats' }, res)
    const payload = JSON.parse(res.body)
    assert.equal(payload.invoice.enabled, false)
    assert.equal(payload.invoice.state, 'empty')
    assert.equal(payload.invoice.summary, null)
    assert.equal(payload.invoice.source, null)
  } finally {
    restore()
  }
})

test('POST userToken validates, persists via credentials seam, and updates GET snapshot', async () => {
  let setCalls = 0
  const handler = setup(credentialsSeam({ set: async (ref, value) => { setCalls++; assert.equal(ref, 'DEEPSEEK_PLATFORM_TOKEN'); assert.equal(value, LONG_TOKEN) } }))
  const { restore } = mockFetch(invoiceOk)
  try {
    const saveRes = mockRes()
    await handler(postReq({ userToken: ` ${LONG_TOKEN} ` }), saveRes)
    const saved = JSON.parse(saveRes.body)
    assert.equal(saved.ok, true)
    assert.equal(saved.source, 'file')
    assert.equal(saved.tokenHint, LONG_TOKEN.slice(-4))
    assert.equal(setCalls, 1)

    const getRes = mockRes()
    await handler({ method: 'GET', url: '/balance-stats' }, getRes)
    const payload = JSON.parse(getRes.body)
    assert.equal(payload.invoice.enabled, true)
    assert.equal(payload.invoice.state, 'ok')
    assert.equal(payload.invoice.source, 'file')
    assert.equal(payload.invoice.summarySource, 'auto')
    assert.equal(payload.invoice.summary.totalRecharge, 130)
    assert.equal(payload.invoice.writable, true)
  } finally {
    restore()
  }
})

test('POST userToken rejected as session-expired does not persist or enable', async () => {
  let setCalls = 0
  const handler = setup(credentialsSeam({ set: async () => { setCalls++ } }))
  const { restore } = mockFetch(invoiceExpired)
  try {
    const res = mockRes()
    await handler(postReq({ userToken: LONG_TOKEN }), res)
    const saved = JSON.parse(res.body)
    assert.equal(saved.ok, false)
    assert.equal(saved.error, 'session-expired')
    assert.equal(setCalls, 0)

    const getRes = mockRes()
    await handler({ method: 'GET', url: '/balance-stats' }, getRes)
    assert.equal(JSON.parse(getRes.body).invoice.enabled, false)
  } finally {
    restore()
  }
})

test('POST userToken falls back to memory when the seam rejects the write', async () => {
  const handler = setup(credentialsSeam({ set: async () => { throw new Error('shadowed') }, describe: async () => ({ configured: true, source: 'env', writable: false }) }))
  const { restore } = mockFetch(invoiceOk)
  try {
    const res = mockRes()
    await handler(postReq({ userToken: LONG_TOKEN }), res)
    const saved = JSON.parse(res.body)
    assert.equal(saved.ok, true)
    assert.equal(saved.source, 'memory')

    const getRes = mockRes()
    await handler({ method: 'GET', url: '/balance-stats' }, getRes)
    const payload = JSON.parse(getRes.body)
    assert.equal(payload.invoice.source, 'memory')
    assert.equal(payload.invoice.writable, false)
  } finally {
    restore()
  }
})

test('POST userToken accepts legacy code 200 success envelopes too', async () => {
  const handler = setup(credentialsSeam())
  const { restore } = mockFetch(() => invoiceOk(200))
  try {
    const res = mockRes()
    await handler(postReq({ userToken: LONG_TOKEN }), res)
    assert.equal(JSON.parse(res.body).ok, true)
  } finally {
    restore()
  }
})

test('POST raw invoice JSON stores a manual summary without enabling auto-fetch', async () => {
  const handler = setup(undefined)
  const { restore } = mockFetch(invoiceExpired)
  try {
    const rawInvoice = { data: { biz_data: { invoices: {
      payment_orders: [
        { payment_order_status: 'SUCCESS', amount: 10, currency: 'CNY' },
        { payment_order_status: 'SUCCESS', amount: 120, currency: 'CNY' },
      ],
      bonus_orders: [],
    } } } }
    const res = mockRes()
    await handler(postReq(rawInvoice), res)
    const saved = JSON.parse(res.body)
    assert.equal(saved.ok, true)
    assert.equal(saved.mode, 'invoice')

    const getRes = mockRes()
    await handler({ method: 'GET', url: '/balance-stats' }, getRes)
    const payload = JSON.parse(getRes.body)
    assert.equal(payload.invoice.enabled, false)
    assert.equal(payload.invoice.state, 'empty')
    assert.equal(payload.invoice.summarySource, 'manual')
    assert.equal(payload.invoice.summary.totalRecharge, 130)
  } finally {
    restore()
  }
})

test('POST clear drops token, summaries, and unsets the persisted copy', async () => {
  let unsetCalls = 0
  const handler = setup(credentialsSeam({ unset: async () => { unsetCalls++ } }))
  const { restore } = mockFetch(invoiceOk)
  try {
    await handler(postReq({ userToken: LONG_TOKEN }), mockRes())
    const clearRes = mockRes()
    await handler(postReq({ clear: true }), clearRes)
    assert.equal(JSON.parse(clearRes.body).ok, true)
    assert.equal(unsetCalls, 1)

    const getRes = mockRes()
    await handler({ method: 'GET', url: '/balance-stats' }, getRes)
    const payload = JSON.parse(getRes.body)
    assert.equal(payload.invoice.enabled, false)
    assert.equal(payload.invoice.state, 'empty')
    assert.equal(payload.invoice.summary, null)
  } finally {
    restore()
  }
})

test('OPTIONS allows the platform origin with PNA header and rejects others', async () => {
  const handler = setup(undefined)
  const allowRes = mockRes()
  await handler({
    method: 'OPTIONS',
    url: '/balance-stats',
    headers: {
      origin: 'https://platform.deepseek.com',
      'access-control-request-private-network': 'true',
    },
  }, allowRes)
  assert.equal(allowRes.status, 204)
  assert.equal(allowRes.headers['Access-Control-Allow-Origin'], 'https://platform.deepseek.com')
  assert.equal(allowRes.headers['Access-Control-Allow-Private-Network'], 'true')

  const denyRes = mockRes()
  await handler({ method: 'OPTIONS', url: '/balance-stats', headers: { origin: 'https://evil.example' } }, denyRes)
  assert.equal(denyRes.status, 405)
  assert.equal(denyRes.headers['Access-Control-Allow-Origin'], undefined)
})

test('POST rejects malformed and oversized bodies without crashing', async () => {
  const handler = setup(undefined)
  const badJsonReq = new EventEmitter()
  badJsonReq.method = 'POST'
  badJsonReq.url = '/balance-stats'
  badJsonReq.headers = {}
  queueMicrotask(() => { badJsonReq.emit('data', Buffer.from('{oops')); badJsonReq.emit('end') })
  const badRes = mockRes()
  await handler(badJsonReq, badRes)
  assert.equal(badRes.status, 400)

  const bigReq = new EventEmitter()
  bigReq.method = 'POST'
  bigReq.url = '/balance-stats'
  bigReq.headers = {}
  bigReq.destroy = () => {}
  queueMicrotask(() => { bigReq.emit('data', Buffer.alloc(257 * 1024)) })
  const bigRes = mockRes()
  await new Promise((resolve) => {
    bigRes.end = () => resolve()
    bigRes.writeHead = (status, headers) => { bigRes.status = status; bigRes.headers = headers ?? {} }
    void handler(bigReq, bigRes)
  })
  assert.equal(bigRes.status, 413)
})
