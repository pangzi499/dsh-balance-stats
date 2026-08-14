/**
 * dsh-balance-stats — browser half (lazy-CJS 客户端 bundle)。
 *
 * 布局: 输入框下方 `conversation.composer.dock` 底部栏。
 *   - 一行三读数 —— 余额 ¥X / 当前会话花费 ¥Y / 总花销百分比 Z%,
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
				".dshbs_import{display:grid;grid-template-columns:1fr auto;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}",
				".dshbs_import_text{grid-column:1/-1;box-sizing:border-box;width:100%;min-height:64px;resize:vertical;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:11px/1.4 ui-monospace,SFMono-Regular,monospace;padding:6px 8px}",
				".dshbs_import_btn{border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;padding:4px 8px;cursor:pointer}",
				".dshbs_import_btn:hover{background:var(--dsw-alias-interactive-bg-hover)}",
				".dshbs_import_status{color:var(--dsw-alias-label-secondary);font-size:11px;text-align:right}",
				".dshbs_err{color:var(--dsw-alias-state-error-primary)}",
				".dshbs_loading{opacity:.55}"
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
		//#endregion

		//#region stats store (单例轮询器: 拉 /balance-stats)
		const DEFAULT_POLL_MS = 30000;
		let snapshot = { status: "loading" };
		const listeners = new Set();
		let timer = null;
		let pollMs = DEFAULT_POLL_MS;
		let inflight = null;
		let started = false;

		function notify() {
			for (const fn of [...listeners]) fn();
		}

		async function refresh() {
			if (inflight !== null) return inflight;
			inflight = (async () => {
				try {
					const res = await fetch("/balance-stats", {
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
				notify();
			})();
			return inflight;
		}

		function schedule() {
			if (timer !== null) return;
			timer = setTimeout(() => {
				timer = null;
				if (document.hidden) return;
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
			"notice": "总花费按 DeepSeek 官方定价估算(可在 cordis.patch.yml 的 prices 调整); 不含未记录用量的调用。",
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
			"notice": "Spend estimated at official DeepSeek rates (adjustable under prices in cordis.patch.yml); excludes calls without logged usage.",
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
			const rootRef = react.useRef(null);

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
			const billingTotal = invoiceSummary !== null ? invoiceSummary.totalRecharge + invoiceSummary.totalBonus : null;
			const billingSpent = billingTotal !== null && balanceTotal !== null ? Math.max(0, billingTotal - balanceTotal) : null;
			const percent = billingTotal !== null && billingTotal > 0 && billingSpent !== null
				? Math.round((billingSpent / billingTotal) * 1000) / 10
				: localPercent;
			const spinning = loading;

			const importInvoices = () => {
				try {
					const summary = parseInvoiceExport(JSON.parse(invoiceJson));
					if (summary.currency !== currency) throw new Error("currency-mismatch");
					localStorage.setItem(INVOICE_STORAGE_KEY, JSON.stringify(summary));
					setInvoiceSummary(summary);
					setInvoiceStatus({ ok: true, count: summary.paymentOrderCount });
					setInvoiceJson("");
				} catch (error) {
					setInvoiceStatus({ ok: false, reason: error instanceof Error ? error.message : "invalid-structure" });
				}
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
					statsStore.refresh();
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

				const statusText = invoiceStatus === null
					? invoiceSummary === null ? "" : t("billing.imported", { n: invoiceSummary.paymentOrderCount })
					: invoiceStatus.ok ? t("billing.imported", { n: invoiceStatus.count })
						: invoiceStatus.reason === "currency-mismatch" ? t("billing.currencyMismatch") : t("billing.invalid");
				rows.push((0, react_jsx_runtime.jsxs)("div", {
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
				}, "import"));

				if (invoiceSummary !== null) {
					rows.push((0, react_jsx_runtime.jsx)("h4", { children: t("title.billing") }, "billing"));
					row(t("billing.recharge"), formatMoney(invoiceSummary.totalRecharge, currency));
					row(t("billing.bonus"), formatMoney(invoiceSummary.totalBonus, currency));
					row(t("billing.spent"), billingSpent === null ? "—" : formatMoney(billingSpent, currency));
				}

				rows.push((0, react_jsx_runtime.jsx)("h4", { children: t("title.spend") }, "s"));
				row(invoiceSummary !== null ? t("billing.localEstimate") : t("spend.total"), totalCost === null ? "—" : formatMoney(totalCost, currency));
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
		exports.__testing = { parseInvoiceExport };
		return module.exports;
	}
});
