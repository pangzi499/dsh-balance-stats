import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function setup() {
  let definition
  const requests = []
  let source = await readFile(new URL('../client/client.js', import.meta.url), 'utf8')
  // Expose the real store in the old bundle too, so this reproduces the regression.
  source = source.replace('exports.__testing = {', 'exports.__testing = { legacyStore: typeof statsStore === "undefined" ? null : statsStore,')
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load(value) { definition = value } } },
    setTimeout() { return 1 }, clearTimeout() {}, AbortController,
    fetch(url) { return new Promise(resolve => requests.push({ url, reply(cost) {
      resolve({ ok: true, async json() { return { currentSession: { cost } } } })
    } })) },
  })
  const api = definition.factory(id => id === 'react' ? { memo: x => x } : {}).__testing
  return { requests, create: api.createStatsStore ?? (() => api.legacyStore), api }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

test('switch starts an independent request without forcing account-wide refresh', async () => {
  const { create, requests } = await setup()
  const store = create()
  store.setSessionId('workspace-A/session-A')
  const stop = store.subscribe(() => {})
  store.setSessionId('workspace-B/session-B')
  assert.equal(requests.length, 2)
  assert.ok(requests.every(r => !r.url.includes('force=1')))
  requests[1].reply(2)
  await tick()
  requests[0].reply(3.42)
  await tick()
  assert.equal(store.getSnapshot().payload.currentSession.cost, 2)
  store.setSessionId(null)
  assert.equal(store.getSnapshot().payload?.currentSession ?? null, null)
  stop()
})

test('two mounted workspace widgets cannot overwrite each other', async () => {
  const { create, requests } = await setup()
  const a = create(), b = create()
  a.setSessionId('A'); b.setSessionId('B')
  const stopA = a.subscribe(() => {}), stopB = b.subscribe(() => {})
  assert.equal(requests.length, 2)
  requests[0].reply(1); requests[1].reply(2)
  await tick()
  assert.equal(a.getSnapshot().payload.currentSession.cost, 1)
  assert.equal(b.getSnapshot().payload.currentSession.cost, 2)
  stopA(); stopB()
})

test('live projection wins over old polling data; switching never renders another session', async () => {
  const { api } = await setup()
  const stats = { status: 'ok', sessionId: 'A', payload: { currentSession: { cost: 3.42 } } }
  assert.equal(api.selectSessionCost('A', { cost: 4.5 }, stats), 4.5)
  assert.equal(api.selectSessionCost('B', undefined, stats), null)
  assert.equal(api.selectSessionCost(null, { cost: 3.42 }, stats), null)
  assert.equal(api.selectSessionCost('A', undefined, stats), 3.42)
  assert.equal(api.selectSessionCost('A', { cost: 0 }, stats), 0)
})
