import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const loadParser = async () => {
  const source = await readFile(new URL('../client/client.js', import.meta.url), 'utf8')
  let definition
  const sandbox = {
    window: { __ModuleLoader__: { load(value) { definition = value } } },
  }
  vm.runInNewContext(source, sandbox, { filename: 'client/client.js' })
  const react = { memo: (component) => component }
  const exports = definition.factory((id) => {
    if (id === 'react') return react
    if (id === 'react/jsx-runtime') return { jsx() {}, jsxs() {}, Fragment: Symbol('Fragment') }
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return {}
    throw new Error(`unexpected module: ${id}`)
  })
  return exports.__testing.parseInvoiceExport
}

test('invoice parser totals successful payments and eligible bonuses only', async () => {
  const parseInvoiceExport = await loadParser()
  const summary = parseInvoiceExport({
    data: { biz_data: { invoices: {
      payment_orders: [
        { payment_order_status: 'SUCCESS', amount: '20.25', currency: 'CNY' },
        { payment_order_status: 'FAILED', amount: '99', currency: 'CNY' },
        { payment_order_status: 'SUCCESS', amount: 49.75, currency: 'CNY' },
      ],
      bonus_orders: [
        { status: 'SUCCESS', amount: '3' },
        { bonus_order_status: 'FAILED', amount: '8' },
      ],
    } } },
  })

  assert.deepEqual(
    { ...summary, importedAt: 0 },
    {
      totalRecharge: 70,
      totalBonus: 3,
      currency: 'CNY',
      paymentOrderCount: 2,
      bonusOrderCount: 1,
      importedAt: 0,
    },
  )
  assert.equal(typeof summary.importedAt, 'number')
  assert.equal('payment_order_id' in summary, false)
})

test('invoice parser rejects invalid amounts and mixed currencies', async () => {
  const parseInvoiceExport = await loadParser()
  const wrap = (payment_orders) => ({ data: { biz_data: { invoices: { payment_orders } } } })

  assert.throws(() => parseInvoiceExport(wrap([
    { payment_order_status: 'SUCCESS', amount: -1, currency: 'CNY' },
  ])), /invalid-amount/)
  assert.throws(() => parseInvoiceExport(wrap([
    { payment_order_status: 'SUCCESS', amount: 1, currency: 'CNY' },
    { payment_order_status: 'SUCCESS', amount: 1, currency: 'USD' },
  ])), /mixed-currency/)
})
