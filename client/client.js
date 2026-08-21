/**
 * dsh-balance-stats — browser half (lazy-CJS 客户端 bundle)。
 *
 * 布局: 输入框下方 `conversation.composer.dock` 底部栏。
 *   - 一行三读数 —— 余额 ¥X / 当前会话花费 ¥Y / 累计消耗 Z%,
 *     右侧刷新; 点击整行弹出详情卡。
 *   - 详情卡(浮层): 完整六项 ——
 *       余额(总额/充值/赠送)、总花费(累计)、当前会话花费、已用百分比、
 *       最近 7 天、最近 30 天, 外加按模型分解与 token 明细。
 *
 * 数据来源: 服务器 `/balance-stats` 只读缓存端点(余额 + 总花费 + 7/30 天)。
 * "当前会话花费" 直接从 composer 作用域的
 * `useProjection("balanceStatsSessionCost")` 读取。
 */
window.__ModuleLoader__.load({
	id: "dsh-balance-stats",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let _ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		//#region styles
		const CSS_ID = "dsh-balance-stats/styles.css";
		if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + CSS_ID + '"]') === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-balance-stats";
			tag.dataset.pluginCss = CSS_ID;
			tag.textContent = [
				".dshbs_root{display:flex;justify-content:center;width:100%;min-width:0;text-align:center}",
				".dshbs_widget{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:8px;cursor:pointer;color:var(--dsw-alias-label-secondary);user-select:none;min-width:0}",
				".dshbs_widget:hover{background:var(--dsw-alias-interactive-bg-hover)}",
				".dshbs_main{display:flex;align-items:baseline;gap:4px;font-size:12px;line-height:1.4;white-space:nowrap;min-width:0}",
				".dshbs_label{color:var(--dsw-alias-label-secondary);font-size:11px}",
				".dshbs_value{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}",
				".dshbs_pct{color:var(--dsw-alias-state-business-primary);font-variant-numeric:tabular-nums}",
				".dshbs_sep{color:var(--dsw-alias-separator-primary);margin:0 6px}",
				".dshbs_refresh{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border:none;border-radius:50%;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;padding:0}",
				".dshbs_refresh:hover{background:var(--dsw-alias-interactive-bg-hover)}",
				".dshbs_refresh.dshbs_spin svg{animation:dshbs-spin .8s linear infinite}",
				"@keyframes dshbs-spin{to{transform:rotate(360deg)}}",
				".dshbs_collapsed{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:50%;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0;font-size:13px;font-weight:600;font-family:inherit}",
				".dshbs_collapsed:hover{background:var(--dsw-alias-interactive-bg-hover)}",
				".dshbs_card{position:fixed;z-index:1000;box-sizing:border-box;min-width:300px;max-width:360px;max-height:calc(100vh - 24px);overflow-y:auto;padding:12px 14px;border-radius:12px;background:var(--dsw-alias-bg-overlay,#222327);color:var(--dsw-alias-label-primary);box-shadow:0 8px 30px rgba(0,0,0,.35);font-size:12px;line-height:1.65}",
				".dshbs_card h4{margin:10px 0 4px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);letter-spacing:.02em}",
				".dshbs_card h4:first-child{margin-top:0}",
				".dshbs_row{display:flex;justify-content:space-between;gap:14px;align-items:baseline}",
				".dshbs_row+.dshbs_row{margin-top:2px}",
				".dshbs_muted{color:var(--dsw-alias-label-secondary)}",
				".dshbs_note{margin-top:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.5}",
				".dshbs_import{display:grid;grid-template-columns:1fr auto;gap:6px;margin-top:8px;padding-top:8px}",
				".dshbs_import_text{grid-column:1/-1;box-sizing:border-box;width:100%;min-height:64px;resize:vertical;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:11px/1.4 ui-monospace,SFMono-Regular,monospace;padding:6px 8px}",
				".dshbs_import_btn{border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;padding:4px 8px;cursor:pointer}",
				".dshbs_import_btn:hover{background:var(--dsw-alias-interactive-bg-hover)}",
				".dshbs_import_status{color:var(--dsw-alias-label-secondary);font-size:11px;text-align:right}",
				".dshbs_err{color:var(--dsw-alias-state-error-primary)}",
				".dshbs_loading{opacity:.55}",
				".dshbs_sec{margin-top:8px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:6px}",
				".dshbs_sec_head{display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer;user-select:none;padding:2px;border-radius:6px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);letter-spacing:.02em}",
				".dshbs_sec_head:hover{background:var(--dsw-alias-interactive-bg-hover)}",
				".dshbs_sec_head_right{display:flex;align-items:center;gap:6px;font-weight:400}",
				".dshbs_chev{transition:transform .15s ease;color:var(--dsw-alias-label-secondary);font-size:10px}",
				".dshbs_sec.dshbs_open .dshbs_chev{transform:rotate(90deg)}",
				".dshbs_sec_body{display:none;padding:4px 2px 2px}",
				".dshbs_sec.dshbs_open .dshbs_sec_body{display:block}",
				".dshbs_dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;vertical-align:1px;background:var(--dsw-alias-label-secondary)}",
				".dshbs_dot_ok{background:var(--dsw-alias-state-success-primary,#46a758)}",
				".dshbs_dot_warn{background:var(--dsw-alias-state-warning-primary,#f5a623)}",
				".dshbs_dot_err{background:var(--dsw-alias-state-error-primary)}",
				".dshbs_warn{color:var(--dsw-alias-state-warning-primary,#f5a623)}",
				".dshbs_token_line{display:flex;align-items:center;gap:6px;margin-top:6px}",
				".dshbs_token_input{flex:1 1 auto;width:auto;min-width:0;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:11px/1.4 ui-monospace,SFMono-Regular,monospace;padding:6px 8px}",
				".dshbs_token_input:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}",
				".dshbs_token_input.dshbs_invalid{border-color:var(--dsw-alias-state-error-primary)}",
				".dshbs_icon_btn,.dshbs_btn{flex:none;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;padding:4px 8px;cursor:pointer;white-space:nowrap}",
				".dshbs_icon_btn:hover,.dshbs_btn:hover{background:var(--dsw-alias-interactive-bg-hover)}",
				".dshbs_btn:disabled{opacity:.45;cursor:default}",
				".dshbs_btn_primary{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}",
				".dshbs_btn_armed{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}",
				".dshbs_saved_line{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px;color:var(--dsw-alias-label-secondary);font-size:11px}",
				".dshbs_saved_line code{font-family:ui-monospace,SFMono-Regular,monospace;color:var(--dsw-alias-label-primary)}",
				".dshbs_hint{margin-top:6px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.5}",
				".dshbs_help{margin-top:6px}",
				".dshbs_help summary{cursor:pointer;user-select:none;color:var(--dsw-alias-label-secondary);font-size:11px;list-style:none}",
				".dshbs_help summary::-webkit-details-marker{display:none}",
				".dshbs_help summary::before{content:'▸ '}",
				".dshbs_help[open] summary::before{content:'⌄ '}",
				".dshbs_help_steps{margin:6px 0 0;padding-left:18px;color:var(--dsw-alias-label-secondary);font-size:11px}",
				".dshbs_help_steps li{margin-bottom:6px}",
				".dshbs_cmd{display:inline-block;font:11px ui-monospace,SFMono-Regular,monospace;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:2px 8px;margin:3px 0;cursor:pointer;color:var(--dsw-alias-label-primary)}",
				".dshbs_cmd:hover{border-color:var(--dsw-alias-state-business-primary)}",
				".dshbs_badge{font-size:10px;font-weight:400;padding:1px 7px;border-radius:99px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}",
				".dshbs_badge_auto{border-color:var(--dsw-alias-state-success-primary,#46a758);color:var(--dsw-alias-state-success-primary,#46a758)}",
				".dshbs_monospace{font-family:ui-monospace,SFMono-Regular,monospace}"
			].join("\n");
			document.head.appendChild(tag);
		}
		//#endregion

		//#region formatting
		const CURRENCY_SYMBOLS = { CNY: "¥", USD: "$", EUR: "€" };
		const currencySymbol = (currency) => CURRENCY_SYMBOLS[currency] ?? currency + " ";
		function formatMoney(amount, currency) {
			const sym = currencySymbol(currency);
			const fixed = amount >= 1 ? 2 : amount >= 0.01 ? 3 : 4;
			return sym + amount.toFixed(fixed);
		}
		function formatTokens(n) {
			const scaled = (v) => v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
			if (n < 1e3) return String(n);
			if (n < 1e6) return scaled(n / 1e3) + "K";
			return scaled(n / 1e6) + "M";
		}
		function formatClock(ms) {
			if (ms <= 0) return "—";
			return new Date(ms).toLocaleTimeString();
		}

		const INVOICE_STORAGE_KEY = "dsh-balance-stats/invoice-summary/v1";
		const INV_SECTION_OPEN_KEY = "dsh-balance-stats/invoice-section-open";
		const INV_ATTENTION_STATES = new Set(["empty", "session-expired", "error"]);
		function loadInvoiceSummary() {
			try {
				const value = JSON.parse(localStorage.getItem(INVOICE_STORAGE_KEY) ?? "null");
				return value !== null && Number.isFinite(value.totalRecharge) && Number.isFinite(value.totalBonus) ? value : null;
			} catch {
				return null;
			}
		}

		function parseInvoiceExport(payload) {
			const invoices = payload?.data?.biz_data?.invoices;
			if (invoices === null || typeof invoices !== "object" || !Array.isArray(invoices.payment_orders)) {
				throw new Error("invalid-structure");
			}
			const successful = invoices.payment_orders.filter((order) => order?.payment_order_status === "SUCCESS");
			const currencies = [...new Set(successful.map((order) => order?.currency).filter((value) => typeof value === "string" && value !== ""))];
			if (currencies.length > 1) throw new Error("mixed-currency");
			const sumAmounts = (orders) => orders.reduce((sum, order) => {
				const amount = Number(order?.amount ?? 0);
				if (!Number.isFinite(amount) || amount < 0) throw new Error("invalid-amount");
				return sum + amount;
			}, 0);
			const bonusOrders = Array.isArray(invoices.bonus_orders) ? invoices.bonus_orders : [];
			const eligibleBonus = bonusOrders.filter((order) => {
				if (order?.status !== undefined) return order.status === "SUCCESS";
				if (order?.bonus_order_status !== undefined) return order.bonus_order_status === "SUCCESS";
				return true;
			});
			return {
				totalRecharge: Math.round(sumAmounts(successful) * 1e6) / 1e6,
				totalBonus: Math.round(sumAmounts(eligibleBonus) * 1e6) / 1e6,
				currency: currencies[0] ?? "CNY",
				paymentOrderCount: successful.length,
				bonusOrderCount: eligibleBonus.length,
				importedAt: Date.now()
			};
		}

		function calculateAccountingUsage(summary, balanceTotal) {
			const total = summary.totalRecharge + summary.totalBonus;
			const spent = Number.isFinite(balanceTotal)
				? Math.round(Math.max(0, total - balanceTotal) * 1e6) / 1e6
				: null;
			const percent = total > 0 && spent !== null
				? Math.round((spent / total) * 1000) / 10
				: null;
			return { total, spent, percent };
		}
		//#endregion

		//#region stats store (单例轮询器: 拉 /balance-stats)
		const DEFAULT_POLL_MS = 30000;
		let snapshot = { status: "loading" };
		const listeners = new Set();
		let timer = null;
		let pollMs = DEFAULT_POLL_MS;
		let inflight = null;
		let inflightForce = false;
		let started = false;

		function notify() {
			for (const fn of [...listeners]) fn();
		}

		async function refresh(force) {
			if (inflight !== null) {
				// 轮询请求在途时, 手动刷新(force)等它结束后再强制拉取, 避免点击被吞掉。
				if (force === true && !inflightForce) return inflight.then(() => refresh(true));
				return inflight;
			}
			inflightForce = force === true;
			inflight = (async () => {
				try {
					const res = await fetch("/balance-stats" + (inflightForce ? "?force=1" : ""), {
						cache: "no-store",
						headers: { accept: "application/json" }
					});
					if (!res.ok) throw new Error("HTTP " + res.status);
					const data = await res.json();
					if (typeof data.clientPollIntervalMs === "number" && data.clientPollIntervalMs >= 5000) {
						pollMs = Math.min(data.clientPollIntervalMs, 3600000);
					}
					snapshot = { status: "ok", payload: data, at: Date.now() };
				} catch (error) {
					snapshot = {
						status: "error",
						message: error instanceof Error ? error.message : String(error),
						at: Date.now()
					};
				}
				inflight = null;
				inflightForce = false;
				notify();
			})();
			return inflight;
		}

		function schedule() {
			if (!started || timer !== null) return;
			timer = setTimeout(() => {
				timer = null;
				if (document.hidden) {
					schedule();
					return;
				}
				refresh().then(schedule, schedule);
			}, pollMs);
		}

		const statsStore = {
			subscribe(fn) {
				listeners.add(fn);
				if (!started) {
					started = true;
					refresh().then(schedule, schedule);
				}
				return () => {
					listeners.delete(fn);
					if (listeners.size === 0) {
						started = false;
						if (timer !== null) {
							clearTimeout(timer);
							timer = null;
						}
					}
				};
			},
			getSnapshot() {
				return snapshot;
			},
			refresh
		};

		/** 导入端点: 保存 token / 清除 / 手动 JSON。返回服务端 JSON 响应。 */
		async function postImport(payload) {
			const res = await fetch("/balance-stats", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload)
			});
			let data = null;
			try {
				data = await res.json();
			} catch {
				/* 非 JSON 响应按 HTTP 状态处理 */
			}
			if (!res.ok) throw new Error(data?.error ?? ("HTTP " + res.status));
			return data;
		}
		//#endregion

		//#region locale
		const NS = "balanceStats";
		const zh = {
			"balance": "余额",
			"totalCost": "总花费",
			"sessionCost": "本次会话",
			"day7": "7天",
			"day30": "30天",
			"percentUsed": "累计消耗",
			"refresh": "刷新",
			"loading": "加载中…",
			"unavailable": "获取失败",
			"missingKey": "未配置 API Key",
			"title.balance": "余额",
			"balance.total": "可用余额",
			"balance.toppedUp": "充值",
			"balance.granted": "赠送",
			"title.billing": "历史账单",
			"billing.recharge": "历史总充值",
			"billing.bonus": "历史总赠送",
			"billing.spent": "账务总消费",
			"billing.localEstimate": "Harness 本地估算",
			"billing.import": "导入",
			"billing.paste": "粘贴 get_all_invoice 返回的 JSON",
			"billing.imported": "已导入 {n} 笔充值",
			"billing.invalid": "JSON 格式不正确",
			"billing.currencyMismatch": "账单币种与余额不一致",
			"invoice.auto": "账单自动获取",
			"invoice.state.ok": "已开启",
			"invoice.state.empty": "未配置",
			"invoice.state.session-expired": "已过期",
			"invoice.state.error": "错误",
			"invoice.updated": "上次更新 {time}",
			"invoice.every": "每 {interval} 自动",
			"invoice.token": "凭证",
			"invoice.source.file": "已持久化",
			"invoice.source.memory": "内存",
			"invoice.source.env": "环境变量，只读",
			"invoice.source.config": "配置文件",
			"invoice.change": "更换",
			"invoice.clear": "清除",
			"invoice.clearConfirm": "确认清除?",
			"invoice.placeholder": "粘贴 userToken…",
			"invoice.show": "显示/隐藏",
			"invoice.save": "保存",
			"invoice.saving": "验证中",
			"invoice.invalidToken": "不像有效的 token：长度需 ≥ 20 且不含空白",
			"invoice.invalid": "token 无效或登录已过期，请重新获取并粘贴",
			"invoice.help.title": "如何获取 userToken？（3 步）",
			"invoice.help.open": "打开 DeepSeek 平台",
			"invoice.help.openSuffix": "并登录",
			"invoice.help.step2": "在平台页面按 F12 打开控制台，粘贴这条命令并回车：",
			"invoice.help.copied": "已复制 ✓",
			"invoice.help.copyFail": "复制失败，请手动输入",
			"invoice.help.step3": "回到这里粘贴，点「保存」——保存时会自动验证。",
			"invoice.help.alt": "也可在 F12 → Application → 本地存储 → userToken 手动复制。",
			"invoice.hint.persisted": "保存后写入本机凭证文件（权限 0600），重启自动恢复；可随时一键清除。",
			"invoice.hint.memory": "仅保存在服务内存，重启后需重填。",
			"invoice.hint.readonly": "由环境变量提供，插件无法修改；请在 shell 配置中更新该变量并重启。",
			"invoice.hint.config": "由插件配置提供；请在 cordis.patch.yml 中修改 platformToken。",
			"invoice.source.auto": "来源：自动获取",
			"invoice.source.manual": "来源：手动导入",
			"billing.advanced": "高级导入（JSON 粘贴，无需凭证）",
			"title.spend": "花费",
			"spend.total": "总花费(累计)",
			"spend.session": "当前会话",
			"spend.today": "今天",
			"spend.day7": "最近 7 天",
			"spend.day30": "最近 30 天",
			"spend.percent": "已用比例",
			"spend.remain": "剩余比例",
			"title.model": "按模型",
			"tokens": "Token 用量",
			"tokensHint": "输入 / 输出 / 缓存读取",
			"updated": "余额更新于 {time} · 每 {interval} 刷新",
			"notice": "总花费按配置价格估算(prices 及 v4PeakPrices/v4OffPeakPrices); 不含未记录用量的调用。",
			"model.unknown": "未知模型",
			"unit.minutes": "{n} 分钟",
			"unit.seconds": "{n} 秒"
		};
		const en = {
			"balance": "Balance",
			"totalCost": "Spent",
			"sessionCost": "Session",
			"day7": "7d",
			"day30": "30d",
			"percentUsed": "Used",
			"refresh": "Refresh",
			"loading": "Loading…",
			"unavailable": "Unavailable",
			"missingKey": "API key not configured",
			"title.balance": "Balance",
			"balance.total": "Available",
			"balance.toppedUp": "Topped up",
			"balance.granted": "Granted",
			"title.billing": "Billing history",
			"billing.recharge": "Total recharged",
			"billing.bonus": "Total bonus",
			"billing.spent": "Account spend",
			"billing.localEstimate": "Harness local estimate",
			"billing.import": "Import",
			"billing.paste": "Paste the get_all_invoice JSON response",
			"billing.imported": "Imported {n} payments",
			"billing.invalid": "Invalid invoice JSON",
			"billing.currencyMismatch": "Invoice currency does not match balance",
			"invoice.auto": "Auto invoice import",
			"invoice.state.ok": "On",
			"invoice.state.empty": "Not set up",
			"invoice.state.session-expired": "Expired",
			"invoice.state.error": "Error",
			"invoice.updated": "Updated {time}",
			"invoice.every": "auto every {interval}",
			"invoice.token": "Token",
			"invoice.source.file": "persisted",
			"invoice.source.memory": "in memory",
			"invoice.source.env": "env var, read-only",
			"invoice.source.config": "config file",
			"invoice.change": "Change",
			"invoice.clear": "Clear",
			"invoice.clearConfirm": "Confirm clear?",
			"invoice.placeholder": "Paste userToken…",
			"invoice.show": "Show/hide",
			"invoice.save": "Save",
			"invoice.saving": "Verifying",
			"invoice.invalidToken": "Does not look like a valid token: at least 20 chars, no whitespace",
			"invoice.invalid": "Token is invalid or the session has expired. Paste a fresh one.",
			"invoice.help.title": "How to get userToken? (3 steps)",
			"invoice.help.open": "Open DeepSeek Platform",
			"invoice.help.openSuffix": "and sign in",
			"invoice.help.step2": "Press F12 on that page to open the console, paste this command and press Enter:",
			"invoice.help.copied": "Copied ✓",
			"invoice.help.copyFail": "Copy failed, type it manually",
			"invoice.help.step3": "Come back here, paste it and press Save — saving verifies automatically.",
			"invoice.help.alt": "Alternatively copy userToken under F12 → Application → Local Storage.",
			"invoice.hint.persisted": "Saved to the local credentials file (mode 0600); survives restarts. Clear anytime with one click.",
			"invoice.hint.memory": "Kept in server memory only; re-paste after restarting dsh web.",
			"invoice.hint.readonly": "Provided by an environment variable the plugin cannot modify; update your shell config and restart.",
			"invoice.hint.config": "Provided by plugin config; change platformToken in cordis.patch.yml.",
			"invoice.source.auto": "Source: auto import",
			"invoice.source.manual": "Source: manual import",
			"billing.advanced": "Advanced (paste invoice JSON, no token needed)",
			"title.spend": "Spend",
			"spend.total": "Total (all-time)",
			"spend.session": "This session",
			"spend.today": "Today",
			"spend.day7": "Last 7 days",
			"spend.day30": "Last 30 days",
			"spend.percent": "Used",
			"spend.remain": "Remaining",
			"title.model": "By model",
			"tokens": "Tokens",
			"tokensHint": "Input / Output / Cache read",
			"updated": "Balance updated {time} · every {interval}",
			"notice": "Spend is estimated from configured prices (prices and v4PeakPrices/v4OffPeakPrices); excludes calls without logged usage.",
			"model.unknown": "unknown model",
			"unit.minutes": "{n} min",
			"unit.seconds": "{n} s"
		};
		//#endregion

		//#region component
		function formatInterval(ms, t) {
			const minutes = Math.round(ms / 60000);
			return minutes >= 1 ? t("unit.minutes", { n: minutes }) : t("unit.seconds", { n: Math.round(ms / 1000) });
		}

		const BalanceStatsWidget = react.memo(function BalanceStatsWidget({ useProjection, t }) {
			const stats = react.useSyncExternalStore(statsStore.subscribe, statsStore.getSnapshot, statsStore.getSnapshot);
			const sessionCostValue = useProjection ? useProjection("balanceStatsSessionCost") : undefined;
			const [open, setOpen] = react.useState(false);
			const [cardAt, setCardAt] = react.useState(null);
			const [invoiceSummary, setInvoiceSummary] = react.useState(loadInvoiceSummary);
			const [invoiceStatus, setInvoiceStatus] = react.useState(null);
			const [invoiceJson, setInvoiceJson] = react.useState("");
			const [refreshing, setRefreshing] = react.useState(false);
			const rootRef = react.useRef(null);

			// 自动获取区状态
			const invoiceInfo = stats.status === "ok" ? stats.payload?.invoice ?? null : null;
			const invState = invoiceInfo !== null ? invoiceInfo.state : "empty";
			const invAttention = INV_ATTENTION_STATES.has(invState) || invoiceInfo === null;
			const [invOpenOverride, setInvOpenOverride] = react.useState(null); // null=跟随默认/记忆
			const [invMode, setInvMode] = react.useState("view"); // view | edit
			const [invToken, setInvToken] = react.useState("");
			const [invShow, setInvShow] = react.useState(false);
			const [invBusy, setInvBusy] = react.useState(false);
			const [invError, setInvError] = react.useState(null);
			const [clearArmed, setClearArmed] = react.useState(false);
			const tokenInputRef = react.useRef(null);

			const info = stats.status === "ok" ? stats.payload : null;
			const loading = stats.status === "loading";
			const balances = info !== null && Array.isArray(info.balances)
				? info.balances
				: info !== null && info.balances !== null && typeof info.balances === "object"
					? Object.values(info.balances)
					: [];
			const primary = balances.length > 0 ? balances[0] : null;
			const currency = info !== null && typeof info.currency === "string" && info.currency !== "" ? info.currency : "CNY";
			const statsBlock = info !== null && info.stats !== null && typeof info.stats === "object" ? info.stats : {};

			const balanceTotal = primary !== null && Number.isFinite(primary.total) ? primary.total : null;
			const toppedUp = primary !== null && Number.isFinite(primary.toppedUp) ? primary.toppedUp : null;
			const granted = primary !== null && Number.isFinite(primary.granted) ? primary.granted : null;
			const totalCost = Number.isFinite(statsBlock.totalCost) ? statsBlock.totalCost : null;
			const localPercent = Number.isFinite(statsBlock.percent) ? statsBlock.percent : null;
			const today = Number.isFinite(statsBlock.today) ? statsBlock.today : null;
			const day7 = Number.isFinite(statsBlock.day7) ? statsBlock.day7 : null;
			const day30 = Number.isFinite(statsBlock.day30) ? statsBlock.day30 : null;
			const sessionC = sessionCostValue !== null && sessionCostValue !== undefined && Number.isFinite(sessionCostValue.cost) ? sessionCostValue.cost : null;
			// 服务端自动获取的汇总优先; localStorage 手动导入作为离线兜底
			const serverSummary = invoiceInfo !== null && invoiceInfo.summary !== null && typeof invoiceInfo.summary === "object" ? invoiceInfo.summary : null;
			const effectiveSummary = serverSummary ?? invoiceSummary;
			const accounting = effectiveSummary !== null ? calculateAccountingUsage(effectiveSummary, balanceTotal) : null;
			const billingSpent = accounting?.spent ?? null;
			const percent = accounting?.percent ?? localPercent;
			const spinning = loading || refreshing;

			const importInvoices = () => {
				try {
					const summary = parseInvoiceExport(JSON.parse(invoiceJson));
					if (summary.currency !== currency) throw new Error("currency-mismatch");
					localStorage.setItem(INVOICE_STORAGE_KEY, JSON.stringify(summary));
					setInvoiceSummary(summary);
					setInvoiceStatus({ ok: true, count: summary.paymentOrderCount });
					setInvoiceJson("");
					// 导入只更新本地历史汇总; 余额/账务总消费依赖服务端快照,
					// 这里强制刷新一次, 让它们立即基于最新余额计算(复用刷新按钮的旋转态)。
					setRefreshing(true);
					const refreshed = () => setRefreshing(false);
					statsStore.refresh(true).then(refreshed, refreshed);
				} catch (error) {
					setInvoiceStatus({ ok: false, reason: error instanceof Error ? error.message : "invalid-structure" });
				}
			};

			// 保存 token: 客户端预检 → POST → 服务端验证并持久化 → 强刷快照
			const saveToken = async () => {
				const value = invToken.trim();
				if (value.length < 20 || /\s/.test(value)) {
					setInvError(t("invoice.invalidToken"));
					return;
				}
				setInvBusy(true);
				setInvError(null);
				try {
					const result = await postImport({ userToken: value });
					if (result?.ok !== true) {
						setInvError(result?.error === "session-expired" ? t("invoice.invalid") : (result?.error ?? t("invoice.invalid")));
						return;
					}
					setInvToken("");
					setInvMode("view");
					setClearArmed(false);
					setRefreshing(true);
					await statsStore.refresh(true);
				} catch (error) {
					setInvError(error instanceof Error ? error.message : String(error));
				} finally {
					setInvBusy(false);
					setRefreshing(false);
				}
			};

			// 清除: 两段确认; 服务端丢弃内存 token + 汇总, 并尽量 unset 凭证文档
			const clearToken = async () => {
				if (!clearArmed) {
					setClearArmed(true);
					return;
				}
				setClearArmed(false);
				setInvBusy(true);
				try {
					await postImport({ clear: true });
					setInvMode("edit");
					setRefreshing(true);
					await statsStore.refresh(true);
				} catch (error) {
					setInvError(error instanceof Error ? error.message : String(error));
				} finally {
					setInvBusy(false);
					setRefreshing(false);
				}
			};

			const sectionOpen = invOpenOverride !== null
				? invOpenOverride
				: invAttention
					? true
					: (() => { try { return localStorage.getItem(INV_SECTION_OPEN_KEY) !== "0"; } catch { return true; } })();
			const toggleSection = () => {
				const willOpen = !sectionOpen;
				setInvOpenOverride(willOpen);
				if (!invAttention) {
					try { localStorage.setItem(INV_SECTION_OPEN_KEY, willOpen ? "1" : "0"); } catch { /* 忽略 */ }
				}
			};

			const copyHelpCommand = async (event) => {
				event.stopPropagation();
				const el = event.currentTarget;
				const command = "copy(localStorage.userToken)";
				try {
					await navigator.clipboard.writeText(command);
					el.textContent = t("invoice.help.copied");
				} catch {
					el.textContent = t("invoice.help.copyFail");
				}
				setTimeout(() => { el.textContent = command; }, 1500);
			};

			const toggleCard = () => {
				if (!open) {
					const rect = rootRef.current?.getBoundingClientRect();
					if (rect) {
						const left = Math.max(8, Math.min(rect.left, window.innerWidth - 360));
						const bottom = Math.max(8, window.innerHeight - rect.top + 6);
						setCardAt({ left, bottom });
					} else {
						setCardAt(null);
					}
				}
				setOpen((prev) => !prev);
			};

			react.useEffect(() => {
				if (!open) return;
				const onKey = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				const onPointer = (event) => {
					if (rootRef.current !== null && !rootRef.current.contains(event.target)) setOpen(false);
				};
				document.addEventListener("keydown", onKey);
				document.addEventListener("pointerdown", onPointer);
				return () => {
					document.removeEventListener("keydown", onKey);
					document.removeEventListener("pointerdown", onPointer);
				};
			}, [open]);

			// 需要处理(未配置/过期/错误)时自动展开并聚焦输入框
			react.useEffect(() => {
				if (!open || invoiceInfo === null || invState === "ok") return;
				if (invMode !== "view") return;
				setInvMode("edit");
			}, [open, invState, invoiceInfo]);
			react.useEffect(() => {
				if (open && invMode === "edit") tokenInputRef.current?.focus?.();
			}, [open, invMode]);

			const valueLine = (label, value, cls) => (0, react_jsx_runtime.jsxs)("span", {
				className: "dshbs_main",
				children: [(0, react_jsx_runtime.jsx)("span", { className: "dshbs_label", children: label }), (0, react_jsx_runtime.jsx)("span", { className: cls ?? "dshbs_value", children: value })]
			});

			const refreshBtn = (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "dshbs_refresh" + (spinning ? " dshbs_spin" : ""),
				"aria-label": t("refresh"),
				title: t("refresh"),
				onClick: (event) => {
					event.stopPropagation();
					setRefreshing(true);
					const done = () => setRefreshing(false);
					statsStore.refresh(true).then(done, done);
				},
				children: (0, react_jsx_runtime.jsx)(_ui_primitives.IconRefreshOutline16, { size: 14 })
			});

			// composer 底部栏主读数
			let mainLine = null;
			if (info !== null && info.ok === true) {
				mainLine = (0, react_jsx_runtime.jsxs)(react.Fragment, {
					children: [
						valueLine(t("balance"), balanceTotal === null ? "—" : formatMoney(balanceTotal, currency)),
						(0, react_jsx_runtime.jsx)("span", { className: "dshbs_sep", "aria-hidden": true, children: "|" }),
						valueLine(t("sessionCost"), sessionC === null ? "—" : formatMoney(sessionC, currency)),
						(0, react_jsx_runtime.jsx)("span", { className: "dshbs_sep", "aria-hidden": true, children: "|" }),
						valueLine(t("percentUsed"), percent === null ? "—" : percent + "%", "dshbs_pct")
					]
				});
			} else if (info !== null && info.ok !== true) {
				mainLine = valueLine(info.error === "api-key-missing" ? t("missingKey") : t("unavailable"), "—", "dshbs_err");
			} else {
				mainLine = valueLine(t("balance"), "…");
			}

			// 详情卡
			let card = null;
			if (open) {
				const rows = [];
				const row = (label, value, cls) => rows.push((0, react_jsx_runtime.jsxs)("div", {
					className: "dshbs_row",
					children: [(0, react_jsx_runtime.jsx)("span", { className: "dshbs_muted", children: label }), (0, react_jsx_runtime.jsx)("span", { className: cls ?? "dshbs_value", children: value })]
				}));

				rows.push((0, react_jsx_runtime.jsx)("h4", { children: t("title.balance") }, "b"));
				if (info !== null && info.ok === true && primary !== null) {
					row(t("balance.total"), formatMoney(balanceTotal === null ? 0 : balanceTotal, currency));
					row(t("balance.toppedUp") + " / " + t("balance.granted"),
						formatMoney(toppedUp === null ? 0 : toppedUp, currency) + " / " + formatMoney(granted === null ? 0 : granted, currency));
				} else {
					row(t("balance.total"), (0, react_jsx_runtime.jsx)("span", { className: "dshbs_err", children: info !== null && info.error === "api-key-missing" ? t("missingKey") : t("unavailable") }));
				}

				// —— 账单自动获取区(可折叠; 服务端无 invoice 块时整体隐藏) ——
				if (invoiceInfo !== null) {
					const dotCls = invState === "ok" ? " dshbs_dot_ok"
						: invState === "session-expired" ? " dshbs_dot_warn"
							: invState === "error" ? " dshbs_dot_err" : "";
					const invSourceLabel = invoiceInfo.source != null && invoiceInfo.source !== ""
						? t("invoice.source." + invoiceInfo.source)
						: null;
					const invReadonly = invoiceInfo.source === "env" || invoiceInfo.writable === false;
					const editingInv = invMode === "edit" || (invState !== "ok");
					const invExpired = invState === "session-expired";
					const invErrored = invState === "error";

					const hintText = editingInv
						? t("invoice.hint.persisted")
						: invoiceInfo.source === "memory" ? t("invoice.hint.memory")
							: invoiceInfo.source === "env" ? t("invoice.hint.readonly")
								: invoiceInfo.source === "config" ? t("invoice.hint.config")
									: t("invoice.hint.persisted");

					const invBody = [];
					if (!editingInv) {
						invBody.push((0, react_jsx_runtime.jsx)("div", {
							className: "dshbs_saved_line",
							children: [
								(0, react_jsx_runtime.jsxs)("span", {
									children: [
										t("invoice.token") + " ",
										(0, react_jsx_runtime.jsx)("code", { children: "••••••••••" + (invoiceInfo.tokenHint ?? "") }),
										invSourceLabel !== null ? "（" + invSourceLabel + "）" : ""
									]
								}),
								!invReadonly ? (0, react_jsx_runtime.jsxs)("span", {
									children: [
										(0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "dshbs_icon_btn",
											onClick: () => { setInvMode("edit"); setClearArmed(false); },
											children: t("invoice.change")
										}),
										(0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "dshbs_icon_btn" + (clearArmed ? " dshbs_btn_armed" : ""),
											onClick: clearToken,
											children: clearArmed ? t("invoice.clearConfirm") : t("invoice.clear")
										})
									]
								}) : null
							]
						}, "saved"));
						invBody.push((0, react_jsx_runtime.jsx)("div", {
							className: "dshbs_muted",
							style: { fontSize: 11, marginTop: 2 },
							children: invoiceInfo.fetchedAt > 0 ? t("invoice.updated", { time: formatClock(invoiceInfo.fetchedAt) }) : ""
						}, "upd"));
					} else {
						if (invExpired) {
							invBody.push((0, react_jsx_runtime.jsx)("div", { className: "dshbs_warn", style: { marginTop: 6 }, children: t("invoice.invalid") }, "exp"));
						} else if (invErrored && invoiceInfo.error) {
							invBody.push((0, react_jsx_runtime.jsx)("div", { className: "dshbs_err", style: { marginTop: 6 }, title: invoiceInfo.error, children: invoiceInfo.error }, "err"));
						}
						invBody.push((0, react_jsx_runtime.jsxs)("div", {
							className: "dshbs_token_line",
							children: [
								(0, react_jsx_runtime.jsx)("input", {
									ref: tokenInputRef,
									className: "dshbs_token_input" + (invError !== null ? " dshbs_invalid" : ""),
									type: invShow ? "text" : "password",
									spellCheck: false,
									autoComplete: "off",
									placeholder: t("invoice.placeholder"),
									value: invToken,
									disabled: invBusy,
									onChange: (event) => { setInvToken(event.target.value); if (invError !== null) setInvError(null); },
									onKeyDown: (event) => { if (event.key === "Enter") saveToken(); },
									onClick: (event) => event.stopPropagation()
								}),
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dshbs_icon_btn",
									title: t("invoice.show"),
									disabled: invBusy,
									onClick: () => setInvShow((prev) => !prev),
									children: invShow ? "🙈" : "👁"
								}),
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dshbs_btn dshbs_btn_primary",
									disabled: invBusy,
									onClick: saveToken,
									children: invBusy ? (0, react_jsx_runtime.jsx)("span", { className: "dshbs_spin", children: "◌" }) : t("invoice.save")
								})
							]
						}, "line"));
					}
					if (invError !== null) {
						invBody.push((0, react_jsx_runtime.jsx)("div", { className: "dshbs_err", style: { marginTop: 4 }, children: invError }, "invErr"));
					}

					invBody.push((0, react_jsx_runtime.jsxs)("details", {
						className: "dshbs_help",
						onClick: (event) => event.stopPropagation(),
						children: [
							(0, react_jsx_runtime.jsx)("summary", { children: t("invoice.help.title") }),
							(0, react_jsx_runtime.jsxs)("ol", {
								className: "dshbs_help_steps",
								children: [
									(0, react_jsx_runtime.jsxs)("li", {
										children: [
											(0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "dshbs_btn",
												onClick: () => window.open("https://platform.deepseek.com/", "_blank"),
												children: t("invoice.help.open")
											}),
											" " + t("invoice.help.openSuffix")
										]
									}),
									(0, react_jsx_runtime.jsxs)("li", {
										children: [
											t("invoice.help.step2"),
											(0, react_jsx_runtime.jsx)("br", {}),
											(0, react_jsx_runtime.jsx)("span", {
												className: "dshbs_cmd",
												title: t("invoice.help.step2"),
												onClick: copyHelpCommand,
												children: "copy(localStorage.userToken)"
											})
										]
									}),
									(0, react_jsx_runtime.jsx)("li", { children: t("invoice.help.step3") })
								]
							}),
							(0, react_jsx_runtime.jsx)("div", { className: "dshbs_hint", children: t("invoice.help.alt") })
						]
					}, "help"));

					invBody.push((0, react_jsx_runtime.jsx)("div", { className: "dshbs_hint", children: hintText }, "hint"));

					rows.push((0, react_jsx_runtime.jsxs)("div", {
						className: "dshbs_sec" + (sectionOpen ? " dshbs_open" : ""),
						children: [
							(0, react_jsx_runtime.jsxs)("div", {
								className: "dshbs_sec_head",
								role: "button",
								tabIndex: 0,
								onClick: toggleSection,
								onKeyDown: (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleSection(); } },
								children: [
									(0, react_jsx_runtime.jsx)("span", { children: t("invoice.auto") }),
									(0, react_jsx_runtime.jsxs)("span", {
										className: "dshbs_sec_head_right",
										children: [
											(0, react_jsx_runtime.jsxs)("span", {
												className: dotCls.includes("warn") ? "dshbs_warn" : dotCls.includes("err") ? "dshbs_err" : dotCls.includes("ok") ? "" : "dshbs_muted",
												children: [
													(0, react_jsx_runtime.jsx)("span", { className: "dshbs_dot" + dotCls }),
													t("invoice.state." + invState)
												]
											}),
											(0, react_jsx_runtime.jsx)("span", { className: "dshbs_chev", children: "▶" })
										]
									})
								]
							}),
							(0, react_jsx_runtime.jsx)("div", { className: "dshbs_sec_body", children: invBody })
						]
					}, "autoImport"));
				}

				// —— 高级导入(JSON 粘贴兜底, 默认收起) ——
				const statusText = invoiceStatus === null
					? invoiceSummary === null ? "" : t("billing.imported", { n: invoiceSummary.paymentOrderCount })
					: invoiceStatus.ok ? t("billing.imported", { n: invoiceStatus.count })
						: invoiceStatus.reason === "currency-mismatch" ? t("billing.currencyMismatch") : t("billing.invalid");
				rows.push((0, react_jsx_runtime.jsx)("details", {
					className: "dshbs_sec dshbs_help",
					onClick: (event) => event.stopPropagation(),
					children: (0, react_jsx_runtime.jsxs)("div", {
						children: [
							(0, react_jsx_runtime.jsx)("summary", { children: t("billing.advanced") }),
							(0, react_jsx_runtime.jsxs)("div", {
								className: "dshbs_import",
								children: [
									(0, react_jsx_runtime.jsx)("textarea", {
										className: "dshbs_import_text",
										value: invoiceJson,
										placeholder: t("billing.paste"),
										onChange: (event) => setInvoiceJson(event.target.value),
										onClick: (event) => event.stopPropagation()
									}),
									(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dshbs_import_btn",
										disabled: invoiceJson.trim() === "",
										onClick: importInvoices,
										children: t("billing.import")
									}),
									(0, react_jsx_runtime.jsx)("span", { className: invoiceStatus?.ok === false ? "dshbs_import_status dshbs_err" : "dshbs_import_status", children: statusText })
								]
							})
						]
					})
				}, "import"));

				const sourceBadge = serverSummary !== null
					? (0, react_jsx_runtime.jsx)("span", { className: "dshbs_badge dshbs_badge_auto", children: t("invoice.source.auto") })
					: invoiceSummary !== null
						? (0, react_jsx_runtime.jsx)("span", { className: "dshbs_badge", children: t("invoice.source.manual") })
						: null;

				if (effectiveSummary !== null) {
					rows.push((0, react_jsx_runtime.jsx)("h4", { children: sourceBadge !== null ? [t("title.billing"), " ", sourceBadge] : t("title.billing") }, "billing"));
					row(t("billing.recharge"), formatMoney(effectiveSummary.totalRecharge, currency));
					row(t("billing.bonus"), formatMoney(effectiveSummary.totalBonus, currency));
					row(t("billing.spent"), billingSpent === null ? "—" : formatMoney(billingSpent, currency));
				}

				rows.push((0, react_jsx_runtime.jsx)("h4", { children: t("title.spend") }, "s"));
				row(effectiveSummary !== null ? t("billing.localEstimate") : t("spend.total"), totalCost === null ? "—" : formatMoney(totalCost, currency));
				row(t("spend.session"), sessionC === null ? "—" : formatMoney(sessionC, currency));
				row(t("spend.today"), today === null ? "—" : formatMoney(today, currency));
				row(t("spend.day7"), day7 === null ? "—" : formatMoney(day7, currency));
				row(t("spend.day30"), day30 === null ? "—" : formatMoney(day30, currency));
				row(t("spend.percent"), percent === null ? "—" : percent + "%");
				row(t("spend.remain"), percent === null ? "—" : (Math.round((100 - percent) * 10) / 10) + "%");

				const costByModel = statsBlock.costByModel ?? {};
				const modelEntries = Object.entries(costByModel).filter(([, c]) => Number.isFinite(c) && c > 0);
				if (modelEntries.length > 0) {
					rows.push((0, react_jsx_runtime.jsx)("h4", { children: t("title.model") }, "m"));
					for (const [model, c] of modelEntries) {
						row(model === "unknown" ? t("model.unknown") : model, formatMoney(c, currency));
					}
				}
				const tokens = statsBlock.tokens ?? null;
				if (tokens !== null && tokens !== undefined) {
					rows.push((0, react_jsx_runtime.jsx)("h4", { children: t("tokens") }, "tk"));
					row(t("tokensHint"),
						formatTokens(tokens.uncachedInput + tokens.cacheRead + tokens.cacheWrite) + " / " + formatTokens(tokens.output) + " / " + formatTokens(tokens.cacheRead));
				}
				if (info !== null && typeof info.fetchedAt === "number") {
					rows.push((0, react_jsx_runtime.jsx)("div", { className: "dshbs_note", children: t("updated", { time: formatClock(info.fetchedAt), interval: formatInterval(info.refreshIntervalMs ?? DEFAULT_POLL_MS, t) }) }, "upd"));
				}
				rows.push((0, react_jsx_runtime.jsx)("div", { className: "dshbs_note", children: t("notice") }, "nt"));

				card = (0, react_jsx_runtime.jsx)("div", {
					className: "dshbs_card",
					style: cardAt ? { left: cardAt.left, bottom: cardAt.bottom } : void 0,
					onPointerDown: (event) => event.stopPropagation(),
					onClick: (event) => event.stopPropagation(),
					children: rows
				});
			}

			return (0, react_jsx_runtime.jsxs)("div", {
				className: "dshbs_root",
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						className: "dshbs_widget" + (loading ? " dshbs_loading" : ""),
						ref: rootRef,
						role: "button",
						tabIndex: 0,
						"aria-expanded": open,
						onClick: toggleCard,
						onKeyDown: (event) => {
							if (event.key === "Enter" || event.key === " ") {
								event.preventDefault();
								toggleCard();
							}
						},
						children: [mainLine, refreshBtn]
					}),
					card
				]
			});
		});
		//#endregion

		//#region plugin
		const inject = ["slots", "locale"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-balance-stats: dictionaries");
			// 输入框下方可见底部栏。
			ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
				name: "conversation.composer.dock",
				id: "dsh-balance-stats",
				order: 1,
				locale: NS
			}, BalanceStatsWidget));
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.__testing = { parseInvoiceExport, calculateAccountingUsage };
		return module.exports;
	}
});
