/**
 * 交易分析网站（模拟数据版）
 * - 不依赖任何框架
 * - 主要功能拆分为：模拟价格生成、指标计算、趋势/建议判定、UI 渲染
 */

// ==========================
// 1) DOM 元素与基础配置
// ==========================
const el = {
  assetInput: document.getElementById('assetInput'),
  analyzeBtn: document.getElementById('analyzeBtn'),
  randomExampleBtn: document.getElementById('randomExampleBtn'),

  currentPrice: document.getElementById('currentPrice'),
  ma20: document.getElementById('ma20'),
  trendBadge: document.getElementById('trendBadge'),
  recommendation: document.getElementById('recommendation'),
  trendRule: document.getElementById('trendRule'),
  recommendRule: document.getElementById('recommendRule'),
  statCurrent: document.getElementById('statCurrent'),
  statMA20: document.getElementById('statMA20'),
  statTrend: document.getElementById('statTrend'),
  statRecommendation: document.getElementById('statRecommendation'),

  chartCanvas: document.getElementById('chartCanvas'),
  chartMeta: document.getElementById('chartMeta'),
  apiError: document.getElementById('apiError'),
  aiExplainText: document.getElementById('aiExplainText'),
  chartSection: document.getElementById('chartSection'),
  aiExplainSection: document.getElementById('aiExplainSection'),
  detailedRuleSection: document.getElementById('detailedRuleSection'),
  premiumLockNote: document.getElementById('premiumLockNote'),
  memberToggleBtn: document.getElementById('memberToggleBtn'),
  memberStatus: document.getElementById('memberStatus'),
};

// 指标参数
const MA_WINDOW = 20; // 20日均线
const POINTS = 60; // 模拟最近约 60 天
const MARKET_CHART_DAYS = 7; // 图表显示最近7天
const VS_CURRENCY = 'usd';

// CoinGecko 标的映射（可按需继续扩展）
const SYMBOL_TO_COINGECKO_ID = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  DOGE: 'dogecoin',
  XRP: 'ripple',
};

// Chart.js 实例（每次更新前销毁旧实例，避免重复叠加）
let priceChartInstance = null;
let isProMember = false; // 默认免费用户

/**
 * 上一次用于画「7天走势图」的数据（切换会员时重绘，避免在 display:none 下测量错尺寸）
 * @type {{ timestamps: number[], prices: number[] } | null}
 */
let lastChartRenderArgs = null;

/**
 * 销毁走势图：免费用户隐藏图表时应销毁实例，否则下次显示时 Chart.js 尺寸会错乱
 */
function destroyPriceChart() {
  if (priceChartInstance) {
    priceChartInstance.destroy();
    priceChartInstance = null;
  }
}

/**
 * 在容器完成布局后强制 Chart 按当前 CSS 高度重算（修复切换显示后「被拉长」）
 */
function scheduleChartResize() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (priceChartInstance && typeof priceChartInstance.resize === 'function') {
        priceChartInstance.resize();
      }
    });
  });
}

/**
 * 更新会员 UI 状态文案
 */
function updateMemberUiState() {
  if (!el.memberStatus || !el.memberToggleBtn) return;
  if (isProMember) {
    el.memberStatus.textContent = '高级用户';
    el.memberStatus.classList.remove('free');
    el.memberStatus.classList.add('pro');
    el.memberToggleBtn.textContent = '切换为免费用户（模拟）';
  } else {
    el.memberStatus.textContent = '免费用户';
    el.memberStatus.classList.remove('pro');
    el.memberStatus.classList.add('free');
    el.memberToggleBtn.textContent = '升级为高级用户（模拟）';
  }
}

/**
 * 按会员权限控制展示内容：
 * - 免费：仅显示趋势
 * - 高级：显示完整分析 + AI解释
 */
function applyMemberAccessControl() {
  const showProOnly = isProMember;

  if (el.statCurrent) el.statCurrent.style.display = showProOnly ? '' : 'none';
  if (el.statMA20) el.statMA20.style.display = showProOnly ? '' : 'none';
  if (el.statRecommendation) el.statRecommendation.style.display = showProOnly ? '' : 'none';

  if (el.chartSection) el.chartSection.style.display = showProOnly ? '' : 'none';
  if (el.aiExplainSection) el.aiExplainSection.style.display = showProOnly ? '' : 'none';
  if (el.detailedRuleSection) el.detailedRuleSection.style.display = showProOnly ? '' : 'none';

  if (el.premiumLockNote) {
    el.premiumLockNote.style.display = showProOnly ? 'none' : 'block';
  }
}

// ==========================
// 2) 模拟价格数据生成
// ==========================

/**
 * 用标的名称生成一个确定性的种子，保证同一个标的每次都“像同一条行情”
 * @param {string} str
 * @returns {number}
 */
function hashSeed(str) {
  // 简单 FNV-1a 变体
  let h = 2166136261;
  const s = String(str || '').toUpperCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // 转成正整数
  return h >>> 0;
}

/**
 * 一个简单可复现实用的伪随机数生成器
 * @param {number} seed
 * @returns {() => number} 返回 [0, 1) 的随机数
 */
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 从均值为 0、方差为 1 的正态分布生成随机数（Box-Muller）
 * @param {() => number} rand
 * @returns {number}
 */
function randNormal(rand) {
  // 避免 log(0)
  const u = Math.max(1e-12, rand());
  const v = Math.max(1e-12, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * 根据标的名称推断一个“合理的起始价格”
 * @param {string} symbol
 * @returns {number}
 */
function guessBasePrice(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (s.includes('BTC')) return 50000;
  if (s.includes('ETH')) return 3000;
  if (s.includes('SOL')) return 150;
  if (s.includes('DOGE')) return 0.12;
  if (s.includes('XRP')) return 0.6;

  // 股票大致在几十到几百区间
  if (/[A-Z]{1,6}/.test(s)) {
    // 从 hash 取一个区间
    const seed = hashSeed(s);
    const rand = mulberry32(seed);
    return 30 + rand() * 220;
  }

  // 兜底
  return 100;
}

/**
 * 生成模拟价格序列（使用“对数收益”的随机游走）
 * @param {string} symbol
 * @returns {number[]} 长度为 POINTS 的价格数组
 */
function generateMockPrices(symbol) {
  const seed = hashSeed(symbol);
  const rand = mulberry32(seed);

  const base = guessBasePrice(symbol);

  // drift：轻微趋势，保证不同 symbol 会有不同风格
  const drift = (rand() - 0.5) * 0.0015; // 约 -0.075% ~ +0.075% 日漂移
  const volatility = 0.012 + rand() * 0.03; // 波动率

  const prices = [];
  let price = base;

  for (let i = 0; i < POINTS; i++) {
    const noise = randNormal(rand) * volatility;
    const logReturn = drift + noise;
    price = price * Math.exp(logReturn);

    // 避免价格变成负数/极端值（模拟数据兜底）
    if (!Number.isFinite(price)) price = base;
    price = Math.max(price, base * 0.05);

    prices.push(price);
  }

  return prices;
}

/**
 * 将模拟序列按“指定当前价”进行等比例缩放，
 * 这样可以保留原有形态，同时让最后一个点等于实时价格。
 * @param {number[]} prices
 * @param {number} targetCurrent
 * @returns {number[]}
 */
function alignSeriesToCurrent(prices, targetCurrent) {
  if (!prices.length || !Number.isFinite(targetCurrent) || targetCurrent <= 0) {
    return prices.slice();
  }
  const last = prices[prices.length - 1];
  if (!Number.isFinite(last) || last <= 0) return prices.slice();
  const scale = targetCurrent / last;
  return prices.map((p) => p * scale);
}

/**
 * 根据 symbol 解析 CoinGecko id。
 * 这里重点保证 BTC -> bitcoin。
 * @param {string} symbol
 * @returns {string|null}
 */
function resolveCoinGeckoId(symbol) {
  const key = String(symbol || '').trim().toUpperCase();
  return SYMBOL_TO_COINGECKO_ID[key] || null;
}

/**
 * 使用 CoinGecko market_chart 拉取最近 7 天价格
 * 接口：/coins/{id}/market_chart?vs_currency=usd&days=7
 * @param {string} symbol
 * @returns {Promise<{coinId:string,timestamps:number[],prices:number[]}>}
 */
async function fetchMarketChartFromCoinGecko(symbol) {
  const coinId = resolveCoinGeckoId(symbol);
  if (!coinId) {
    throw new Error(`暂不支持标的 ${symbol} 的 CoinGecko 映射`);
  }

  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(
    coinId
  )}/market_chart?vs_currency=${VS_CURRENCY}&days=${MARKET_CHART_DAYS}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`CoinGecko 请求失败（HTTP ${res.status}）`);
  }

  const data = await res.json();
  const pairs = data && data.prices;
  if (!Array.isArray(pairs) || pairs.length === 0) {
    throw new Error('CoinGecko 返回数据格式异常');
  }

  const timestamps = [];
  const prices = [];
  for (let i = 0; i < pairs.length; i++) {
    const row = pairs[i];
    if (!Array.isArray(row) || row.length < 2) continue;
    const ts = Number(row[0]);
    const price = Number(row[1]);
    if (!Number.isFinite(ts) || !Number.isFinite(price)) continue;
    timestamps.push(ts);
    prices.push(price);
  }

  if (!prices.length) {
    throw new Error('CoinGecko 价格数据为空');
  }

  return { coinId, timestamps, prices };
}

function showApiError(message) {
  if (!el.apiError) return;
  el.apiError.textContent = message;
  el.apiError.style.display = 'block';
}

function clearApiError() {
  if (!el.apiError) return;
  el.apiError.textContent = '';
  el.apiError.style.display = 'none';
}

// ==========================
// 3) 指标计算：20日均线
// ==========================

/**
 * 计算移动平均（MA）
 * @param {number[]} series
 * @param {number} window
 * @returns {number[]} 与 series 等长的 MA 数组；前 window-1 位为 null
 */
function calcMovingAverage(series, window) {
  const ma = new Array(series.length).fill(null);
  let sum = 0;

  for (let i = 0; i < series.length; i++) {
    sum += series[i];

    // 当 i >= window，开始滑动窗口
    if (i >= window) {
      sum -= series[i - window];
    }

    if (i >= window - 1) {
      ma[i] = sum / window;
    }
  }

  return ma;
}

// ==========================
// 4) 趋势判定与建议
// ==========================

/**
 * 根据价格与 MA20 判定趋势：
 * - 上涨：当前价显著高于 MA20，并且 MA20 呈上升趋势
 * - 下跌：当前价显著低于 MA20，并且 MA20 呈下降趋势
 * - 震荡：其余情况
 *
 * 注意：这是示例规则，真正交易策略需要更多指标与风控。
 * @param {number} currentPrice
 * @param {number} ma20Latest
 * @param {number[]} maSeries
 * @returns {{trend: '上涨'|'下跌'|'震荡', details: string}}
 */
function judgeTrend(currentPrice, ma20Latest, maSeries) {
  const threshold = 0.01; // 1% 的显著差距阈值

  // MA 的“斜率”用最近 5 个点比较（简化）
  const lookback = 5;
  const lastIndex = maSeries.length - 1;
  const prevIndex = Math.max(0, lastIndex - lookback);
  const maPrev = maSeries[prevIndex];

  // 如果 prevIndex 仍是 null（理论上不会，因为有足够 POINTS），兜底按中性处理
  if (ma20Latest == null || maPrev == null) {
    return { trend: '震荡', details: 'MA20 数据不足，无法稳定判断。' };
  }

  const maDiffRatio = (currentPrice - ma20Latest) / ma20Latest; // 当前价相对 MA20 的比例差
  const maSlope = ma20Latest - maPrev; // MA 上升/下降

  // 判定
  if (maDiffRatio > threshold && maSlope > 0) {
    return {
      trend: '上涨',
      details: `当前价高于 MA20（约 ${(maDiffRatio * 100).toFixed(2)}%），且 MA20 呈上升。`,
    };
  }

  if (maDiffRatio < -threshold && maSlope < 0) {
    return {
      trend: '下跌',
      details: `当前价低于 MA20（约 ${(maDiffRatio * 100).toFixed(2)}%），且 MA20 呈下降。`,
    };
  }

  return {
    trend: '震荡',
    details: `当前价与 MA20 的偏离不够显著，或 MA20 走势不明确。`,
  };
}

/**
 * 根据趋势给出建议（示例）
 * - 上涨：买入
 * - 下跌：卖出
 * - 震荡：观望
 * @param {'上涨'|'下跌'|'震荡'} trend
 * @returns {{text: string, cssClass: string}}
 */
function recommendationByTrend(trend) {
  if (trend === '上涨') {
    return { text: '买入（示例）', cssClass: 'badge-up' };
  }
  if (trend === '下跌') {
    return { text: '卖出（示例）', cssClass: 'badge-down' };
  }
  return { text: '观望（示例）', cssClass: 'badge-side' };
}

/**
 * 规则生成“AI 解释文案”（不调用外部 AI）
 * 输入：symbol、当前价、MA20、趋势
 * 输出：自然语言描述
 * @param {string} symbol
 * @param {number} currentPrice
 * @param {number} ma20Latest
 * @param {'上涨'|'下跌'|'震荡'} trend
 * @returns {string}
 */
function buildRuleBasedAiExplanation(symbol, currentPrice, ma20Latest, trend) {
  if (!Number.isFinite(currentPrice) || !Number.isFinite(ma20Latest) || ma20Latest === 0) {
    return `当前 ${symbol} 的指标数据不足，暂时无法给出稳定解释，建议等待更多有效数据后再判断。`;
  }

  const diffRatio = (currentPrice - ma20Latest) / ma20Latest;
  const diffPct = (diffRatio * 100).toFixed(2);
  const relationText = diffRatio >= 0 ? '高于' : '低于';

  // 按偏离绝对值给“动能强弱”
  const abs = Math.abs(diffRatio);
  let momentumText = '动能偏中性';
  if (abs >= 0.05) momentumText = '短期动能较强';
  else if (abs >= 0.02) momentumText = '短期动能中等偏强';
  else if (abs >= 0.01) momentumText = '短期动能温和';

  // 风险提示分层
  let riskText = '需注意波动风险并控制仓位';
  if (abs >= 0.05) {
    riskText = '偏离均线较大，需警惕短线回撤风险';
  } else if (trend === '震荡') {
    riskText = '方向尚不明朗，建议耐心等待更清晰信号';
  }

  if (trend === '上涨') {
    return `当前 ${symbol} 处于上涨趋势，价格${relationText}20日均线约 ${Math.abs(
      Number(diffPct)
    ).toFixed(2)}%，${momentumText}，但${riskText}。`;
  }

  if (trend === '下跌') {
    return `当前 ${symbol} 处于下跌趋势，价格${relationText}20日均线约 ${Math.abs(
      Number(diffPct)
    ).toFixed(2)}%，下行动能仍在释放，建议以风险控制为先，并${riskText}。`;
  }

  return `当前 ${symbol} 处于震荡阶段，价格${relationText}20日均线约 ${Math.abs(
    Number(diffPct)
  ).toFixed(2)}%，市场方向暂不一致，${momentumText}，${riskText}。`;
}

// ==========================
// 5) UI 渲染：结果与图表
// ==========================

/**
 * 统一格式化数字（尽量对不同价格显示合理小数位）
 * @param {number} n
 * @returns {string}
 */
function formatPrice(n) {
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toFixed(2);
  if (abs >= 10) return n.toFixed(2);
  if (abs >= 1) return n.toFixed(3);
  return n.toFixed(5);
}

/**
 * 根据趋势设置 badge 样式
 * @param {'上涨'|'下跌'|'震荡'} trend
 */
function applyTrendBadgeStyle(trend) {
  el.trendBadge.classList.remove('badge-up', 'badge-down', 'badge-side', 'badge-neutral');
  if (trend === '上涨') el.trendBadge.classList.add('badge-up');
  else if (trend === '下跌') el.trendBadge.classList.add('badge-down');
  else el.trendBadge.classList.add('badge-side');
}

/**
 * 把时间戳格式化为“月-日 时:分”
 * @param {number} ts
 * @returns {string}
 */
function formatTsLabel(ts) {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}

/**
 * 使用 Chart.js 绘制最近7天价格折线图
 * @param {number[]} timestamps
 * @param {number[]} prices
 */
function drawPriceChartWithChartJs(timestamps, prices) {
  if (!el.chartCanvas) return;
  // 父级为 display:none 时宽高为 0，Chart.js 会算出错误尺寸，切换显示后会「拉长」
  if (el.chartSection && getComputedStyle(el.chartSection).display === 'none') {
    return;
  }
  if (typeof Chart === 'undefined') {
    showApiError('图表库 Chart.js 未加载成功。');
    return;
  }

  if (priceChartInstance) {
    priceChartInstance.destroy();
    priceChartInstance = null;
  }

  const labels = timestamps.map(formatTsLabel);
  const ctx = el.chartCanvas.getContext('2d');

  priceChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: `价格（${VS_CURRENCY.toUpperCase()}）`,
          data: prices,
          borderColor: 'rgba(56, 189, 248, 0.95)',
          backgroundColor: 'rgba(56, 189, 248, 0.12)',
          fill: true,
          tension: 0.25,
          pointRadius: 0,
          pointHoverRadius: 3,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // 图表区域很矮时：收紧内边距、小字号、少刻度，尽量一页内可读
      layout: {
        padding: { top: 2, right: 4, bottom: 0, left: 2 },
      },
      plugins: {
        legend: {
          display: false, // 标题已说明「7天走势」，省出垂直空间
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` 价格: ${formatPrice(ctx.parsed.y)} ${VS_CURRENCY.toUpperCase()}`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(148, 163, 184, 0.1)', display: false },
          ticks: {
            color: 'rgba(156, 163, 175, 0.85)',
            maxTicksLimit: 5,
            maxRotation: 0,
            font: { size: 9 },
          },
        },
        y: {
          grid: { color: 'rgba(148, 163, 184, 0.12)' },
          ticks: {
            color: 'rgba(156, 163, 175, 0.85)',
            maxTicksLimit: 4,
            font: { size: 9 },
            callback: (value) => formatPrice(Number(value)),
          },
        },
      },
    },
  });

  scheduleChartResize();
}

/**
 * 根据输入结果更新页面内容
 * @param {string} symbol
 * @param {number[]} prices
 */
function renderAnalysis(symbol, prices, options = {}) {
  // 计算 MA20
  const ma20Series = calcMovingAverage(prices, MA_WINDOW);
  const ma20Latest = ma20Series[ma20Series.length - 1];
  const current = prices[prices.length - 1];

  // 判定趋势与建议
  const trendResult = judgeTrend(current, ma20Latest, ma20Series);
  const recommendation = recommendationByTrend(trendResult.trend);

  // 更新数值
  el.currentPrice.textContent = `${formatPrice(current)}`;
  el.ma20.textContent = ma20Latest == null ? '—' : `${formatPrice(ma20Latest)}`;

  // 更新趋势 badge
  el.trendBadge.textContent = trendResult.trend;
  applyTrendBadgeStyle(trendResult.trend);

  // 更新建议
  el.recommendation.textContent = recommendation.text;
  el.recommendation.classList.remove('badge-up', 'badge-down', 'badge-side', 'badge-neutral');
  el.recommendation.classList.add(recommendation.cssClass);

  // 生成 AI 解释文案（规则生成）
  if (el.aiExplainText) {
    el.aiExplainText.textContent = buildRuleBasedAiExplanation(
      symbol,
      current,
      ma20Latest,
      trendResult.trend
    );
  }

  // 规则说明（让用户知道“为什么这样判断”）
  el.trendRule.textContent = `趋势 = ${
    trendResult.trend
  }\n- 当前价相对 MA20 偏离：${((current - ma20Latest) / ma20Latest * 100).toFixed(2)}%\n- MA20 用最近 ${5} 个点对比斜率（简化）\n- 阈值：偏离超过 ±1% 且 MA20 方向一致才算单边趋势`;
  el.recommendRule.textContent =
    `建议 = ${recommendation.text}\n示例逻辑：\n- 上涨 → 买入\n- 下跌 → 卖出\n- 震荡 → 观望\n（实际交易建议需加入更多指标与风控）`;

  // 准备走势图数据（供高级用户绘制，及切换会员时复用）
  let chartTimestamps;
  let chartPrices;
  if (options.chartTimestamps && options.chartPrices) {
    chartTimestamps = options.chartTimestamps;
    chartPrices = options.chartPrices;
  } else {
    const now = Date.now();
    const step = 6 * 60 * 60 * 1000; // 6小时一个点（仅回退展示）
    chartTimestamps = prices.map((_, i) => now - (prices.length - 1 - i) * step);
    chartPrices = prices;
  }
  lastChartRenderArgs = { timestamps: chartTimestamps, prices: chartPrices };

  if (options.useRealPrice) {
    el.chartMeta.textContent = `标的：${symbol} · 最近 ${MARKET_CHART_DAYS} 天真实价格（CoinGecko）`;
  } else {
    el.chartMeta.textContent = `标的：${symbol} · 图表回退为模拟数据`;
  }

  // 必须先应用会员显示状态，再创建 Chart（否则在 display:none 下测量会错位）
  applyMemberAccessControl();

  if (isProMember) {
    drawPriceChartWithChartJs(chartTimestamps, chartPrices);
  } else {
    destroyPriceChart();
  }
}

// ==========================
// 6) 交互：分析与示例
// ==========================

/**
 * 触发一次分析：生成价格 → 计算 → 渲染
 */


async function runAnalysis() {
  let symbol = (el.assetInput.value || '').trim().toUpperCase();

  if (!symbol) {
    alert('请输入标的，例如 518880');
    el.assetInput.focus();
    return;
  }

  clearApiError();

  // 🎯 👉 核心改造：识别黄金ETF
  const isGoldETF = symbol === "518880";

  // 👉 强制黄金ETF走“本地模拟逻辑”
  if (symbol === "518880") {
    try {
      const stock = await fetchCNStockPrice("sh518880");

      const prices = stock.history;

      const ma20 = calculateMA(prices, 20);
  
      // 用真实价格替换最后一个点
      prices[prices.length - 1] = stock.price;
  
      renderAnalysis(stock.name, prices, {
        useRealPrice: true
      });
  
    } catch (e) {
      const prices = generateMockPrices("GOLD_ETF");
  
      renderAnalysis("华安黄金ETF（518880）", prices, {
        useRealPrice: false
      });
    }
  
    return;
  }

  // ===== 原来的逻辑（保留给 BTC 等） =====

  let analysisPrices = generateMockPrices(symbol);

  try {
    const market = await fetchMarketChartFromCoinGecko(symbol);
    const realCurrent = market.prices[market.prices.length - 1];

    analysisPrices = alignSeriesToCurrent(analysisPrices, realCurrent);

    renderAnalysis(symbol, analysisPrices, {
      useRealPrice: true,
      chartTimestamps: market.timestamps,
      chartPrices: market.prices,
    });
  } catch (error) {
    showApiError(`数据获取失败：${error.message}，已使用模拟数据`);
    renderAnalysis(symbol, analysisPrices, { useRealPrice: false });
  }
}

/**
 * 从常见样例里选一个
 */
async function runRandomExample() {
  const examples = ['BTC', 'ETH', 'SOL', 'TSLA', 'AAPL', 'NVDA', 'DOGE', 'XRP'];
  const pick = examples[Math.floor(Math.random() * examples.length)];
  el.assetInput.value = pick;
  await runAnalysis();
}

// ==========================
// 7) 绑定事件并初始化
// ==========================
if (el.analyzeBtn) {
  el.analyzeBtn.addEventListener('click', () => {
    runAnalysis();
  });
}

if (el.randomExampleBtn) {
  el.randomExampleBtn.addEventListener('click', () => {
    runRandomExample();
  });
}

if (el.memberToggleBtn) {
  el.memberToggleBtn.addEventListener('click', () => {
    isProMember = !isProMember;
    updateMemberUiState();
    applyMemberAccessControl();
    // 切换到高级：用缓存数据在「已可见」的容器里重绘；切到免费：销毁图表
    if (isProMember && lastChartRenderArgs) {
      drawPriceChartWithChartJs(lastChartRenderArgs.timestamps, lastChartRenderArgs.prices);
    } else if (!isProMember) {
      destroyPriceChart();
    }
  });
}

// 允许回车触发分析
if (el.assetInput) {
  el.assetInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') runAnalysis();
  });
}

// 初次加载给一个默认示例（避免页面空白）
window.addEventListener('load', () => {
  updateMemberUiState();
  applyMemberAccessControl();
  const defaultSymbol = '518880';
  if (el.assetInput) el.assetInput.value = defaultSymbol;
  runAnalysis();
});


async function fetchCNStockPrice(code) {
  const res = await fetch(`/api/price?code=${code}`);
  const data = await res.json();

  return {
    price: data.price,
    history: data.history,
    name: "华安黄金ETF（518880）"
  };
}