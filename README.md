# dsh-balance-stats

`dsh-balance-stats` 是 DeepSeek Harness Web 的余额与用量统计插件。它在对话输入框下方的
`conversation.composer.dock` 底部栏中显示三个核心读数：

```text
余额 ¥40.22 ｜ 本次会话 ¥0.15 ｜ 累计消耗 42.5%
```

点击整行可打开详情卡，查看余额构成、Harness 本地用量估算、按模型花费、Token
用量及历史账单汇总。

> DeepSeek Harness 尚处于开发者预览阶段，插件所使用的槽位和客户端接口可能随上游版本变化。

## 兼容性

- 已验证 DeepSeek Harness：`0.1.0-rc.6`
- Node.js：`>=22.19.0`
- pnpm：需要在 `PATH` 中可用（Harness 使用 pnpm 管理 profile 插件）
- 已验证运行环境：OrbStack Ubuntu、Node.js `24.19.0`

这是 DeepSeek Harness 社区插件，不是 `@deepseek-ai` 官方插件。

安装插件前，先检查 pnpm：

```sh
pnpm --version
command -v pnpm
```

如果提示 `pnpm: command not found` 或没有输出，可通过 Corepack 安装：

```sh
corepack enable
corepack prepare pnpm@10 --activate
pnpm --version
```

如果当前 Node.js 环境没有 Corepack，可改用 npm：

```sh
npm install --global pnpm@10
pnpm --version
```

## 功能

- **余额**：读取 DeepSeek 官方余额接口，显示当前可用余额、充值余额和赠送余额。
- **本次会话**：通过 composer 作用域的 `balanceStatsSessionCost` projection 实时估算当前会话花费。
- **累计消耗**：导入账单后优先显示账务口径百分比；未导入时回退到 Harness 本地估算。
- **详情卡**：显示今天、最近 7/30 天花费、按模型分解、Token 用量和更新时间。
- **JSON 账单导入**：直接粘贴 `get_all_invoice` 的 JSON 响应，计算历史充值与账务总消费。
- **容错与缓存**：余额请求失败时保留上次成功数据；服务端和客户端均按配置周期刷新。

## 数据口径

### 余额

服务端请求：

```text
GET https://api.deepseek.com/user/balance
```

密钥默认复用 Harness credentials 中的 `DEEPSEEK_API_KEY`，不会发送给浏览器。

### Harness 本地估算

插件遍历 Harness 会话日志中的 usage 事件，按模型单价计算：

- 非缓存输入 Token
- 缓存命中/写入 Token
- 输出 Token
- 按日期和模型聚合的花费

这是本地估算，可能遗漏 Harness 之外、旧日志已删除或未写入标准 usage 事件的调用。

### 历史账单

DeepSeek 公开余额 API 不返回历史总充值。如需账务口径：

1. 登录 `https://platform.deepseek.com/`。
2. 在浏览器开发者工具中获取
   `https://platform.deepseek.com/auth-api/v0/users/get_all_invoice` 的 JSON 响应。
3. 点击 composer 底部统计栏。
4. 将完整 JSON 粘贴到详情卡顶部，点击“导入”。

插件仅统计 `payment_order_status === "SUCCESS"` 的充值订单，并单独累加有效赠送订单。

```text
账务总额 = 历史总充值 + 历史总赠送
账务总消费 = max(0, 账务总额 - 当前总余额)
累计消耗 = 账务总消费 / 账务总额 × 100%
```

未导入账单时：

```text
累计消耗 = Harness 本地估算总花费
             / (剩余充值余额 + Harness 本地估算总花费)
             × 100%
```

## 隐私与存储

- 插件不会请求 `get_all_invoice`，也不会保存 DeepSeek Platform Cookie。
- 粘贴的原始 JSON 只在当前页面内存中解析，导入成功后立即清空。
- 仅将历史充值、历史赠送、订单数、币种和导入时间保存到当前浏览器的 `localStorage`。
- 订单号、支付渠道和时间明细不会持久化。
- 清理该站点的浏览器数据后，需要重新导入账单。

`get_all_invoice` 属于 DeepSeek Platform 的登录态私有接口，响应结构可能变化。请不要向他人分享 Cookie、
Authorization header 或包含订单明细的原始 JSON。

## 安装

### GitHub（推荐）

安装固定版本：

```sh
npx @deepseek-ai/dsh plugin --profile web add https://github.com/pangzi499/dsh-balance-stats.git#v0.1.0
npx @deepseek-ai/dsh web
```

源码仓库：<https://github.com/pangzi499/dsh-balance-stats>

也可以从 GitHub Release 下载 `dsh-balance-stats-0.1.0.tgz`，再按下方 tarball 方式安装。

### 本地目录

```sh
npx @deepseek-ai/dsh plugin --profile web add /absolute/path/to/dsh-balance-stats
npx @deepseek-ai/dsh web
```

### tarball

打包：

```sh
cd /path/to/dsh-balance-stats
npm pack
```

安装：

```sh
npx @deepseek-ai/dsh plugin --profile web add /absolute/path/to/dsh-balance-stats-0.1.0.tgz
npx @deepseek-ai/dsh web
```

安装后对浏览器执行一次强制刷新：

```text
Command + Shift + R
```

## 更新

安装新的 Git tag：

```sh
npx @deepseek-ai/dsh plugin --profile web add https://github.com/pangzi499/dsh-balance-stats.git#v0.1.1
```

本地目录或 tarball 安装：使用新版本路径再执行一次 `add`，然后重启 `dsh web`。

## 配置

在 `$DSH_HOME/profiles/web/cordis.patch.yml` 中覆盖插件配置。配置层为整体替换，所以请重述需要保留的键：

```yaml
- id: dsh-balance-stats
  config:
    apiKey: ''
    apiKeyRef: DEEPSEEK_API_KEY
    baseUrl: https://api.deepseek.com
    refreshIntervalMs: 300000
    clientPollIntervalMs: 30000
    timeoutMs: 8000
    currency: CNY
    prices:
      deepseek-chat: { cacheHit: 0.1, cacheMiss: 1, output: 2 }
      deepseek-reasoner: { cacheHit: 1, cacheMiss: 4, output: 16 }
    defaultPrices: { cacheHit: 0.1, cacheMiss: 1, output: 2 }
```

优先使用 `apiKeyRef`引用 Harness credentials。不要在要分享的 `cordis.patch.yml` 中写入真实 API Key。

## 验证

启动 Web profile 后：

```sh
curl http://127.0.0.1:3080/balance-stats
curl http://127.0.0.1:3080/plugins/dsh-balance-stats/client.js
```

统计接口示例（金额仅为示例）：

```json
{
  "ok": true,
  "currency": "CNY",
  "balances": [
    { "currency": "CNY", "total": 40.22, "granted": 0, "toppedUp": 40.22 }
  ],
  "stats": {
    "state": "ok",
    "totalCost": 2.103612,
    "percent": 5,
    "today": 2.103612,
    "day7": 2.103612,
    "day30": 2.103612,
    "sessions": 10
  }
}
```

## 已知限制

- Harness 本地花费是估算值，不等于 DeepSeek 官方账单。
- 历史账单汇总依赖非公开 `get_all_invoice` 响应结构。
- 账单汇总按浏览器存储，不在不同浏览器或设备之间同步。
- 余额、账单和估算价格币种必须一致。
- 上游 DSH 客户端槽位或 projection API 变更后，插件可能需要同步适配。

## 卸载

```sh
npx @deepseek-ai/dsh plugin --profile web remove dsh-balance-stats
```

## License

MIT
