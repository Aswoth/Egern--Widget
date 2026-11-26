/**
 * ==========================================
 * 📌 全国油价 (Gas Price) 小组件
 * * ✨ 【主要功能】
 * • 三端尺寸完美适配：
 *   - 小号 (Small)  ：四宫格间距精调版，上下卡片行距增加至 8，极致留白且完美适配不溢出。
 *   - 中号 (Medium) ：1x4 横排卡片布局，标题栏精准上移 4，增大下方内容舒展空间且位置锁定。
 *   - 大号 (Large)  ：沉浸式 2x2 放大四宫格，独享油价历史走势折线图，字号间距完美扩容。
 * • 实时油价精准拉取：三数据源可选（中石化官方 / 汽油价格网 / 今日油价聚合网），
 *   支持 92#/95#/98#/柴油多型号及动态涨跌幅展示；中石化含涨跌幅与历史走势图，
 *   其余两源只有价格（涨跌幅与走势图不显示）。下轮调价日与预测始终取汽油价格网。
 * • 智能调价倒数引擎：下轮调价日从汽油价格网接口实时取（内置 2026 年发改委日历仅作回退），自动计算并渲染本轮调价倒计时。
 *   不足 1 天时自动切换为"Xh Ym后"精确到分钟显示，不再显示"0d"。
 * • 动态视觉预警机制：调价临近（≤3天）自动触发红字高亮预警，涨跌红绿视觉色彩分明。
 * • 临近提醒文案切换：调价前三天，左下角标签自动由"较上次调整"切换为"下轮预测"，
 *   预测涨跌幅从汽油价格网(qiyoujiage.com)按当前省份实时抓取，抓取失败时自动回退为历史涨跌幅显示。
 * * 🔧 【环境变量】
 * DATA_SOURCE  — 数据源 (默认: sinopec 中石化官方；可选 qiyoujiage 汽油价格网、youjia 今日油价聚合网)
 * PROVINCE     — 省份名称/编码 (默认: 湖南)
 * CITY         — 城市或地区名称 (默认: 长沙)
 * AREA_INDEX   — 多区域特殊索引 (数字，可选)
 * OFFSET_SCALE — 涨跌幅系数缩放 (默认: 1)
 * * 🔗 链接引用 https://raw.githubusercontent.com/jnlaoshu/MySelf/master/Egern/Widget/GasPrice.js
 * * ⏱️ 更新时间 2026.10.08 09:26
 * ==========================================
 */

const BASE = 'https://cx.sinopecsales.com/yjkqiantai';
const QYJ_BASE = 'http://m.qiyoujiage.com';
const YOUJIA_BASE = 'https://youjia.abapi.cn';

const PROVINCES = {
  '11':'北京','12':'天津','13':'河北','14':'山西','41':'河南','37':'山东','31':'上海','32':'江苏','33':'浙江','34':'安徽','35':'福建','36':'江西','42':'湖北','43':'湖南','44':'广东','45':'广西','53':'云南','52':'贵州','46':'海南','50':'重庆','51':'四川','65':'新疆','15':'内蒙古','21':'辽宁','22':'吉林','64':'宁夏','61':'陕西','23':'黑龙江','54':'西藏','63':'青海','62':'甘肃'
};

// 省份代码 -> 汽油价格网 (qiyoujiage.com) 的省份拼音 slug，用于抓取调价预测
const QYJ_SLUGS = {
  '11':'beijing','12':'tianjin','13':'hebei','14':'shanxi','41':'henan','37':'shandong',
  '31':'shanghai','32':'jiangsu','33':'zhejiang','34':'anhui','35':'fujian','36':'jiangxi',
  '42':'hubei','43':'hunan','44':'guangdong','45':'guangxi','53':'yunnan','52':'guizhou',
  '46':'hainan','50':'chongqing','51':'sichuan','65':'xinjiang','15':'neimenggu','21':'liaoning',
  '22':'jilin','64':'ningxia','61':'shanxi-3','23':'heilongjiang','54':'xizang','63':'qinghai','62':'gansu'
};

// 省份代码 -> 今日油价聚合网 (youjia.abapi.cn) 的省份拼音 slug；
// 与汽油价格网相同，唯独陕西：汽油价格网用 shanxi-3，今日油价用 shanxi1
const YOUJIA_SLUGS = { ...QYJ_SLUGS, '61': 'shanxi1' };

const NAMES = [
  ['GAS_92', '92#'], ['GAS_95', '95#'], ['GAS_98', '98#'],
  ['E92', 'E92#'], ['E95', 'E95#'],
  ['AIPAO95', '爱跑95#'], ['AIPAO98', '爱跑98#'],
  ['AIPAOE92', '爱跑E92#'], ['AIPAOE95', '爱跑E95#'], ['AIPAOE98', '爱跑E98#'],
  ['CHAI_0', '0#'], ['CHAI_10', '-10#'], ['CHAI_20', '-20#'], ['CHAI_35', '-35#']
];

const KEY_MAP = {
  CHAI_0: 'CHECHAI_0', CHAI_10: 'CHECHAI_10',
  AIPAO95: 'AIPAO_GAS_95', AIPAO98: 'AIPAO_GAS_98',
  AIPAOE92: 'AIPAO_GAS_E92', AIPAOE95: 'AIPAO_GAS_E95', AIPAOE98: 'AIPAO_GAS_E98'
};

const TARGET_FUELS = ['GAS_92', 'GAS_95', 'GAS_98', 'AIPAO98', 'CHAI_0'];

const getEnv = (env, names, fallback = '') => {
  for (const name of names) {
    const value = env?.[name];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return fallback;
};

const toNumber = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeProvince = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '51';
  if (PROVINCES[raw]) return raw;
  const cleaned = raw.replace(/省|市|自治区|壮族|回族|维吾尔/g, '');
  const found = Object.entries(PROVINCES).find(([, name]) => name === cleaned || name.includes(cleaned) || cleaned.includes(name));
  return found ? found[0] : raw;
};

const parseSetCookie = (headers) => {
  let values = [];
  if (headers?.getAll) { try { const v = headers.getAll('set-cookie'); if (v) values = values.concat(v); } catch (_) {} }
  if (!values.length && headers?.get) { try { const v = headers.get('set-cookie'); if (v) values = values.concat(Array.isArray(v) ? v : [v]); } catch (_) {} }
  return values
    .flatMap((v) => Array.isArray(v) ? v : String(v).split(/,\s*(?=[A-Za-z0-9_]+=)/))
    .map((v) => String(v).split(';')[0].trim())
    .filter(Boolean)
    .join(';');
};

const stringToBase64 = (str) => {
  if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf8').toString('base64');
  const encoded = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return btoa(encoded);
};

const lineChartSVG = (arr, { color = '#34C759', width = 120, height = 34, lineWidth = 2 } = {}) => {
  const nums = (arr || []).map(Number).filter(Number.isFinite).slice(-12);
  if (nums.length < 2) return null;

  const pad = Math.max(3, Math.ceil(lineWidth));
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const points = nums.map((n, i) => {
    const x = pad + (width - pad * 2) * (i / (nums.length - 1));
    const y = pad + (height - pad * 2) * (1 - ((n - min) / range));
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const bottom = height - pad;
  const area = `${points[0]} ${points.slice(1).join(' ')} ${width - pad},${bottom} ${pad},${bottom}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><polygon points="${area}" fill="url(#fill)"/><polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="${lineWidth}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
  return `data:image/svg+xml;base64,${stringToBase64(svg)}`;
};

const COMMON_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  'Referer': `${BASE}/index.html`,
  'Origin': 'https://cx.sinopecsales.com'
};

async function readJSONResponse(resp) {
  const textBody = await resp.text();
  try { return JSON.parse(textBody); } catch (e) { throw new Error(`接口异常 HTTP ${resp.status || ''}`); }
}

async function loadData(ctx, province) {
  const initResp = await ctx.http.get(`${BASE}/data/initMainData`, { headers: COMMON_HEADERS, credentials: 'include', timeout: 15000 });
  const initJSON = await readJSONResponse(initResp);
  const cookie = parseSetCookie(initResp.headers);

  let current = initJSON;
  const headers = { ...COMMON_HEADERS, 'Content-Type': 'application/json;charset=UTF-8' };
  if (cookie) headers.Cookie = cookie;
  const resp = await ctx.http.post(`${BASE}/data/switchProvince`, {
    headers, body: { provinceId: String(province) }, credentials: 'include', timeout: 15000
  });
  const switched = await readJSONResponse(resp);
  if (switched?.data?.provinceCheck || switched?.data?.area?.length) current = switched;

  const histResp = await ctx.http.get(`${BASE}/data/initOilPrice`, {
    headers: cookie ? { ...COMMON_HEADERS, Cookie: cookie } : COMMON_HEADERS, credentials: 'include', timeout: 15000
  });
  const history = await readJSONResponse(histResp);
  return { current, history };
}

// 从汽油价格网 (qiyoujiage.com) 按省份抓取"下轮调价预测"涨跌幅 + 下轮调价日期
// 日期取自页面里的 "油价11月26日24时调整"（全站统一的下一轮窗口，各省页面一致，页面里唯一一处 M月D日24时）
async function loadPrediction(ctx, provinceCode) {
  const slug = QYJ_SLUGS[provinceCode];
  if (!slug) return null;

  const resp = await ctx.http.get(`${QYJ_BASE}/${slug}.shtml`, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,*/*',
      'User-Agent': COMMON_HEADERS['User-Agent']
    },
    timeout: 10000
  });
  const html = await resp.text();

  // 下轮调价日期（和预测涨跌幅同一页，一次请求拿两个数）
  const dm = html.match(/油价(\d{1,2})月(\d{1,2})日24时调整/);
  const nextDate = dm ? { month: parseInt(dm[1], 10), day: parseInt(dm[2], 10) } : null;

  // 同页的四油价格（DATA_SOURCE=qiyoujiage 时直接用，不另发请求）
  const parsePrice = (label) => {
    const pm = html.match(new RegExp(label + '[^0-9]{0,30}?([\\d]+\\.[\\d]+)'));
    return pm ? parseFloat(pm[1]) : null;
  };
  const prices = {
    p92: parsePrice('92号汽油'),
    p95: parsePrice('95号汽油'),
    p98: parsePrice('98号汽油'),
    diesel: parsePrice('0号柴油')
  };
  const hasPrices = prices.p92 != null && prices.p95 != null && prices.diesel != null;

  // 1. 搁浅或不作调整
  if (/预计(?:油价)?(?:搁浅|不作?调整|停滞)/.test(html)) {
    return { flat: true, nextDate, ...(hasPrices ? { prices } : {}) };
  }

  // 2. 主格式："目前预计上调油价780元/吨(0.59元/升-0.70元/升)" 或 单值 "(0.59元/升)"
  let m = html.match(/预计(上调|下调|上涨|下跌)(?:油价)?[\d.]+元\/吨\((\d+(?:\.\d+)?)元\/升(?:[-~至](\d+(?:\.\d+)?)元\/升)?\)/);
  // 3. 兜底格式："油价上涨0.32元/升-0.38元/升" 或 单值 "0.32元/升"
  if (!m) m = html.match(/(上涨|上调|下调|下跌)(?:油价)?(\d+(?:\.\d+)?)元\/升(?:[-~至](\d+(?:\.\d+)?)元\/升)?/);
  if (!m) return (nextDate || hasPrices) ? { nextDate, ...(hasPrices ? { prices } : {}) } : null;

  const up = m[1] === '上调' || m[1] === '上涨';
  const minV = parseFloat(m[2]);
  const maxV = m[3] ? parseFloat(m[3]) : minV;
  if (!Number.isFinite(minV)) return (nextDate || hasPrices) ? { nextDate, ...(hasPrices ? { prices } : {}) } : null;

  return { up, minV, maxV, nextDate, ...(hasPrices ? { prices } : {}) };
}

// 今日油价聚合网 (youjia.abapi.cn) 价格：价格卡片结构固定，
// <div class="price-card-label">92号汽油</div><div class="price-card-value">8.31</div>
async function loadYoujiaPrices(ctx, provinceCode) {
  const slug = YOUJIA_SLUGS[provinceCode];
  if (!slug) return null;

  const resp = await ctx.http.get(`${YOUJIA_BASE}/p/${slug}`, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,*/*',
      'User-Agent': COMMON_HEADERS['User-Agent']
    },
    timeout: 10000
  });
  const html = await resp.text();
  const parseCard = (label) => {
    const m = html.match(new RegExp('price-card-label">' + label + '</div>\\s*<div class="price-card-value">([\\d]+\\.[\\d]+)</div>'));
    return m ? parseFloat(m[1]) : null;
  };
  return {
    p92: parseCard('92号汽油'),
    p95: parseCard('95号汽油'),
    p98: parseCard('98号汽油'),
    diesel: parseCard('0号柴油')
  };
}

// 纯价格源（汽油价格网 / 今日油价）没有涨跌幅与历史走势：
// offset 置 null（单卡涨跌自动隐藏）、series 置空（走势图自动隐藏），
// 趋势行无数据时自动隐藏；调价临近时仍用汽油价格网的预测覆盖。
function buildPriceOnlyItems(p) {
  const mk = (rawKey, key, name, price) => price == null ? null
    : { rawKey, key, name, price, offset: null, series: [], up: false };
  return {
    p92:    mk('GAS_92', 'GAS_92', '92#', p.p92),
    p95:    mk('GAS_95', 'GAS_95', '95#', p.p95),
    p98:    mk('GAS_98', 'GAS_98', '98#', p.p98),
    diesel: mk('CHAI_0', 'CHAI_0', '0#',  p.diesel)
  };
}

function resolveAreaIndex(current, cityName, explicitIndex) {
  if (explicitIndex != null && explicitIndex >= 0) return explicitIndex;
  const area = (current.data || current).area || [];
  if (!area.length || !cityName) return 0;
  const target = String(cityName).trim();
  const idx = area.findIndex((a) => {
    const name = a?.areaCheck?.AREA_NAME || a?.areaCheck?.CITY_NAME || a?.areaCheck?.PROVINCE_NAME || a?.areaName || '';
    return name && (name.includes(target) || target.includes(name));
  });
  return idx >= 0 ? idx : 0;
}

function extractItems(current, history, province, areaIndex, targetKeys, offsetScale) {
  let { provinceCheck, provinceData, area } = current.data || current;
  area = area || [];
  let areaName = '';
  if (area.length) {
    const idx = Math.max(0, Math.min(area.length - 1, areaIndex));
    provinceCheck = area[idx].areaCheck;
    provinceData = area[idx].areaData;
    areaName = area[idx]?.areaCheck?.AREA_NAME || area[idx]?.areaCheck?.CITY_NAME || area[idx]?.areaName || '';
  }

  const historyData = (((history.data || {}).area || []).length
    ? history.data.area[Math.max(0, Math.min(history.data.area.length - 1, areaIndex))].areaData
    : (history.data || {}).provinceData || []
  ).slice().reverse();

  const items = [];
  for (const [rawKey, name] of NAMES) {
    if (!targetKeys.includes(rawKey)) continue;
    if (provinceCheck?.[rawKey] === 'Y') {
      const key = KEY_MAP[rawKey] || rawKey;
      const offset = Number(provinceData?.[`${key}_STATUS`] ?? 0) * offsetScale;
      const series = historyData.map((it) => it?.[key]).map(Number).filter(Number.isFinite);
      items.push({ rawKey, key, name, price: provinceData?.[key], offset, series, up: offset > 0 });
    }
  }
  return { provinceName: provinceCheck?.PROVINCE_NAME || PROVINCES[province] || String(province), areaName, items };
}

export default async function (ctx) {
  const env = ctx.env || {};
  // 透明版：WIDGET_STYLE=glass（默认）去掉根背景、卡片半透明；classic 为原版
  const glass = String(env.WIDGET_STYLE || "glass").trim().toLowerCase() !== "classic";
  const rootBackground = () => glass ? {} : { backgroundColor };
  const provinceCode = normalizeProvince(getEnv(env, ['PROVINCE', 'PROVINCE_ID', 'province'], '43'));
  const cityName = getEnv(env, ['CITY', 'city'], '长沙');
  const explicitArea = (() => {
    const raw = getEnv(env, ['AREA', 'AREA_INDEX', 'area'], '');
    return raw === '' ? null : toNumber(raw, null);
  })();
  const offsetScale = toNumber(getEnv(env, ['OFFSET_SCALE', 'offset_scale'], '1'), 1);
  // 数据源：sinopec 中石化官方（默认，含涨跌幅与走势图）/
  // qiyoujiage 汽油价格网（仅价格）/ youjia 今日油价聚合网（仅价格）
  const dataSource = String(getEnv(env, ['DATA_SOURCE', 'data_source'], 'sinopec') || 'sinopec').trim().toLowerCase();

  const family  = (ctx.widgetFamily || 'systemMedium').toLowerCase();
  const isSmall = family.includes('small');
  const isLarge = family.includes('large');

  const now = new Date();
  const Y   = now.getFullYear();
  const P   = n => String(n).padStart(2, "0");
  const updateTimeStr = `${P(now.getMonth()+1)}.${P(now.getDate())} ${P(now.getHours())}:${P(now.getMinutes())}`;
  const shortTimeStr = updateTimeStr;

  const backgroundColor = { light: '#FFFFFF', dark: '#000000' };  // 照搬 IBL3ND 写法：widget 根背景（浅色纯白/深色纯黑）
  const C = {
    card:      glass ? { light: 'rgba(255,255,255,0.55)', dark: 'rgba(255,255,255,0.08)' } : { light: '#F5F5F7', dark: '#2C2C2E' },  // 浅色下微灰卡片与纯白背景区分，增强层次
    cardBorder: glass ? { light: 'rgba(255,255,255,0.5)', dark: 'rgba(255,255,255,0.16)' } : { light: '#E0E0E0', dark: '#3A3A3C' },  // 卡片描边（IBL3ND 同款），增加立体感
    main:    { light: '#1C1C1E', dark: '#F2F2F7' },
    muted:   { light: '#8E8E93', dark: '#636366' },
    gold:    { light: '#B07C1A', dark: '#D4A02A' },
    p92:     { light: '#FF9F0A', dark: '#FFB347' },  // IBL3ND 同款 92号橙，加油站图标用
    red:     { light: '#C0392B', dark: '#FF453A' },
    teal:    { light: '#1E7E44', dark: '#30D158' },
    blue:    { light: '#2C5F8A', dark: '#5E9ED6' },
    divider: glass ? { light: 'rgba(0,0,0,0.08)', dark: 'rgba(255,255,255,0.16)' } : { light: '#E5E5EA', dark: '#38383A' }
  };

  // 2026年发改委调价窗口（已按实际公告核对；仅作接口取不到日期时的回退，
  // 下轮日期优先从汽油价格网接口实时取，见 loadPrediction）
  const CALENDAR_2026 = [
    [1,6],[1,20],[2,3],[2,24],[3,9],[3,23],[4,7],[4,21],[5,8],[5,21],
    [6,4],[6,18],[7,3],[7,17],[7,31],[8,14],[8,28],[9,11],[9,24],
    [10,15],[10,29],[11,12],[11,26],[12,10],[12,24]
  ];

  // 由目标时间算出 dateStr / countdown / isUrgent
  const buildNextAdjust = (targetDate) => {
    const totalMinutes = Math.max(0, Math.floor((targetDate.getTime() - now.getTime()) / 60000));
    const days    = Math.floor(totalMinutes / 1440);
    const hours   = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    // 不足 1 天时切换为精确到分钟的 "Xh Ym后"
    const countdownBody = days > 0 ? `${days}d${hours}h后` : `${hours}h${minutes}m后`;
    return {
      dateStr:   `${P(targetDate.getMonth() + 1)}.${P(targetDate.getDate())} 24:00`,
      countdown: `(${countdownBody})`,
      isUrgent:  totalMinutes < 72 * 60
    };
  };

  // 下轮调价日优先用接口返回的日期（今年/明年、30 天内有效才认；
  // 接口页面没来得及更新、日期已过时回退到内置日历，避免跳到明年）
  const getNextAdjust = (apiDate) => {
    if (apiDate && apiDate.month && apiDate.day) {
      for (const y of [Y, Y + 1]) {
        const t = new Date(y, apiDate.month - 1, apiDate.day, 23, 59, 59);
        if (t.getTime() > now.getTime() && t.getTime() - now.getTime() < 30 * 86400000) {
          return buildNextAdjust(t);
        }
      }
    }
    const next = CALENDAR_2026.find(([m, d]) => new Date(Y, m - 1, d, 23, 59, 59).getTime() > now.getTime());
    if (!next) return { dateStr: "待更新", countdown: "", isUrgent: false };
    return buildNextAdjust(new Date(Y, next[0] - 1, next[1], 23, 59, 59));
  };

  // 下轮调价日期优先从接口实时取（和预测涨跌幅同一页，一次请求拿两个数）；
  // 取不到时 getNextAdjust 会回退到内置日历
  let apiPrediction = null;
  try { apiPrediction = await loadPrediction(ctx, provinceCode); } catch (_) {}
  const nextAdjust = getNextAdjust(apiPrediction && apiPrediction.nextDate);

  const prices = { p92: null, p95: null, p98: null, diesel: null };
  const items  = { p92: null, p95: null, p98: null, diesel: null };
  let regionName = cityName || "全国";
  let trendLabel = nextAdjust.isUrgent ? "下轮预测: " : "较上次调整: ";
  let trendInfo  = "";
  let trendColor = C.muted;
  let hasTrendData = false; 
  let fetchError = null;

  // 缓存（借鉴 IBL3ND）：fetch 前先读缓存，失败时降级用缓存数据；缓存键带数据源，换源不串数据
  const CACHE_KEY = `oil_${dataSource}_${provinceCode}_${cityName || 'default'}`;
  let hasCache = false;
  try {
    const cached = ctx.storage.getJSON(CACHE_KEY);
    if (cached && cached.prices) {
      prices.p92 = cached.prices.p92 ?? null;
      prices.p95 = cached.prices.p95 ?? null;
      prices.p98 = cached.prices.p98 ?? null;
      prices.diesel = cached.prices.diesel ?? null;
      if (cached.items) { items.p92 = cached.items.p92 || null; items.p95 = cached.items.p95 || null; items.p98 = cached.items.p98 || null; items.diesel = cached.items.diesel || null; }
      regionName = cached.regionName || regionName;
      trendInfo = cached.trendInfo || "";
      trendColor = cached.trendColor || trendColor;
      hasTrendData = cached.hasTrendData || false;
      hasCache = true;
    }
  } catch (_) {}

  try {
    if (dataSource === 'qiyoujiage') {
      // 汽油价格网：价格取自前面已抓的同一页（不另发请求），无涨跌幅与历史走势
      const p = apiPrediction && apiPrediction.prices;
      if (!p || p.p92 == null) throw new Error('汽油价格网价格未取到');
      const built = buildPriceOnlyItems(p);
      items.p92 = built.p92; items.p95 = built.p95; items.p98 = built.p98; items.diesel = built.diesel;
      prices.p92 = p.p92; prices.p95 = p.p95; prices.p98 = p.p98; prices.diesel = p.diesel;
      regionName = cityName || PROVINCES[provinceCode] || regionName;
    } else if (dataSource === 'youjia') {
      // 今日油价聚合网：单独抓价格页，无涨跌幅与历史走势
      const p = await loadYoujiaPrices(ctx, provinceCode);
      if (!p || p.p92 == null) throw new Error('今日油价价格未取到');
      const built = buildPriceOnlyItems(p);
      items.p92 = built.p92; items.p95 = built.p95; items.p98 = built.p98; items.diesel = built.diesel;
      prices.p92 = p.p92; prices.p95 = p.p95; prices.p98 = p.p98; prices.diesel = p.diesel;
      regionName = cityName || PROVINCES[provinceCode] || regionName;
    } else {
      // 中石化官方（默认）：价格 + 涨跌幅 + 历史走势
      const { current, history } = await loadData(ctx, provinceCode);
      const areaIndex = resolveAreaIndex(current, cityName, explicitArea);
      const payload = extractItems(current, history, provinceCode, areaIndex, TARGET_FUELS, offsetScale);

      regionName = cityName || payload.provinceName || regionName;

      const found = {};
      for (const it of payload.items) found[it.rawKey] = it;
      items.p92    = found.GAS_92 || null;
      items.p95    = found.GAS_95 || null;
      items.p98    = found.GAS_98 || found.AIPAO98 || null;
      items.diesel = found.CHAI_0 || null;

      prices.p92    = items.p92    && items.p92.price    != null ? Number(items.p92.price)    : null;
      prices.p95    = items.p95    && items.p95.price    != null ? Number(items.p95.price)    : null;
      prices.p98    = items.p98    && items.p98.price    != null ? Number(items.p98.price)    : null;
      prices.diesel = items.diesel && items.diesel.price  != null ? Number(items.diesel.price) : null;

      const offsets = [items.p92, items.p95, items.p98, items.diesel]
        .filter(Boolean)
        .map((it) => it.offset)
        .filter((v) => v !== null && v !== undefined && !isNaN(v) && v !== 0);

      if (offsets.length) {
        hasTrendData = true; 
        const sumSign = offsets.reduce((a, b) => a + b, 0);
        const overallUp = sumSign >= 0;
        const absVals = offsets.map((v) => Math.abs(v));
        const minAbs = Math.min(...absVals).toFixed(2);
        const maxAbs = Math.max(...absVals).toFixed(2);
        const rangeStr = minAbs === maxAbs ? `${minAbs}¥/L` : `${minAbs}-${maxAbs}¥/L`;
        trendColor = overallUp ? C.red : C.teal;
        trendInfo  = `${overallUp ? "↑" : "↓"} ${rangeStr}`;
      }
    }

    // 调价临近（≤3天）：用前面已取到的真实预测覆盖显示，失败或平时均显示“较上次调整”
    if (nextAdjust.isUrgent) {
      try {
        const prediction = apiPrediction;
        if (prediction) {
          if (prediction.flat) {
            trendLabel = "下轮预测: ";
            trendColor = C.muted;
            trendInfo  = "搁浅/暂不调整";
            hasTrendData = true;
          } else {
            const rangeStr = prediction.minV === prediction.maxV
              ? `${prediction.minV.toFixed(2)}¥/L`
              : `${prediction.minV.toFixed(2)}-${prediction.maxV.toFixed(2)}¥/L`;
            trendLabel = "下轮预测: ";
            trendColor = prediction.up ? C.red : C.teal;
            trendInfo  = `${prediction.up ? "↑" : "↓"} ${rangeStr}`;
            hasTrendData = true;
          }
        } else {
          trendLabel = "较上次调整: ";
        }
      } catch (_) {
        trendLabel = "较上次调整: ";
      }
    }

    // 缓存写入（借鉴 IBL3ND）
    try { ctx.storage.setJSON(CACHE_KEY, { prices, items, regionName, trendInfo, trendColor, hasTrendData }); } catch (_) {}
  } catch (e) {
    if (hasCache) { fetchError = null; } else { fetchError = e && e.message ? e.message : String(e); }
  }

  const PRICE_ITEMS = [
    { label: "92号", key: "p92",    color: C.gold,   hex: '#D4A02A', item: items.p92 },
    { label: "95号", key: "p95",    color: C.red,    hex: '#FF453A', item: items.p95 },
    { label: "98号", key: "p98",    color: C.blue,   hex: '#2F80ED', item: items.p98 },
    { label: "柴油", key: "diesel", color: C.teal,   hex: '#27AE60', item: items.diesel }
  ].map(i => ({ ...i, val: prices[i.key] !== null ? prices[i.key].toFixed(2) : "--" }));

  const mkText = (text, size, weight, color, opts = {}) => ({
    type: "text", text: String(text ?? ""), font: { size, weight, ...(opts.family ? { family: opts.family } : {}) }, textColor: color, ...opts
  });

  const mkRow = (children, gap = 4, opts = {}) => ({
    type: "stack", direction: "row", alignItems: "center", gap, children, ...opts
  });

  const mkIcon = (src, color, size = 13) => ({
    type: "image", src: `sf-symbol:${src}`, color, width: size, height: size
  });

  const mkSpacer = (length) => length != null ? { type: "spacer", length } : { type: "spacer" };

  const fmtDelta = (item) => {
    if (!item.item || item.item.offset === null || item.item.offset === undefined || isNaN(item.item.offset)) return null;
    const off = item.item.offset;
    if (off === 0) return null;
    return { text: `${off > 0 ? "+" : ""}${off.toFixed(2)}`, color: off > 0 ? C.red : C.teal };
  };

  const buildPriceCard = (item, config) => {
    const delta = fmtDelta(item);
    const showCurve = config.showCurve && item.item && item.item.series && item.item.series.length > 1;
    let svgUrl = null;

    if (showCurve) {
      svgUrl = lineChartSVG(item.item.series, { color: item.hex, width: config.curveWidth, height: config.curveHeight, lineWidth: 1.8 });
    }

    return {
      type: "stack", direction: "column", alignItems: "center", flex: 1,
      backgroundColor: C.card, borderRadius: config.radius, padding: config.padding,
      borderWidth: 0.5, borderColor: C.cardBorder,   // IBL3ND 同款描边，立体感
      children: [
        mkSpacer(),
        mkText(item.label, config.labelFz, config.labelWeight, item.color),
        mkSpacer(config.innerGap),
        mkText(item.val, config.valFz, "heavy", C.main),
        mkSpacer(config.deltaGap ?? 2),
        delta ? mkText(delta.text, config.deltaFz, "bold", delta.color) : mkText(" ", config.deltaFz, "bold", C.muted),
        ...(svgUrl ? [
          mkSpacer(config.curveGap ?? 6),
          { type: "image", src: svgUrl, width: config.curveWidth, height: config.curveHeight, resizable: true, resizeMode: "contain" }
        ] : []),
        mkSpacer()
      ]
    };
  };

  // 背景改用 backgroundColor 字段（IBL3ND 同款实现），避免渐变技巧残留阴影

  if (fetchError) {
    return {
      type: "widget", padding: 16, ...rootBackground(),
      children: [
        mkRow([mkIcon("fuelpump.circle.fill", C.red, 16), mkSpacer(4), mkText("油价加载失败", 15, "heavy", C.main)], 0),
        mkSpacer(8), mkText(fetchError, 11, "medium", C.muted, { maxLines: 3 })
      ]
    };
  }

  if (isSmall) {
    const cardCfg = { radius: 10, padding: [4, 2, 4, 2], labelFz: 10, labelWeight: "bold", valFz: 14, innerGap: 1, deltaFz: 9, deltaGap: 1 };
    return {
      type: "widget", padding: [12, 12, 8, 12], ...rootBackground(),
      children: [
        mkRow([
          mkIcon("fuelpump.circle.fill", C.p92, 13), mkSpacer(4), 
          mkText(`${regionName}油价`, 13, "heavy", C.main),
          mkSpacer(), 
          mkIcon("arrow.triangle.2.circlepath", C.muted, 9), mkSpacer(2),
          mkText(shortTimeStr, 9, "bold", C.muted, { family: "Menlo" })
        ], 0),
        mkSpacer(7),
        { type: "stack", direction: "column", gap: 8, flex: 1, children: [
          mkRow(PRICE_ITEMS.slice(0, 2).map(item => buildPriceCard(item, cardCfg)), 6, { flex: 1 }),
          mkRow(PRICE_ITEMS.slice(2, 4).map(item => buildPriceCard(item, cardCfg)), 6, { flex: 1 })
        ]},
        mkSpacer(7),
        mkRow([ mkSpacer(), mkIcon("clock.fill", nextAdjust.isUrgent ? C.red : C.muted, 9), mkSpacer(3), mkText(`下轮调价: ${nextAdjust.dateStr}`, 9, "bold", nextAdjust.isUrgent ? C.red : C.muted) ], 0)
      ]
    };
  }

  if (isLarge) {
    const cardCfg = { 
      radius: 14, padding: [10, 4, 10, 4], labelFz: 14, labelWeight: "heavy", 
      valFz: 24, innerGap: 4, deltaFz: 12, deltaGap: 2,
      showCurve: true, curveWidth: 84, curveHeight: 26, curveGap: 5
    };
    const infoColor = nextAdjust.isUrgent ? C.red : C.gold;

    return {
      type: "widget", padding: [16, 16, 14, 16], ...rootBackground(),
      children: [
        mkRow([
          mkIcon("fuelpump.circle.fill", C.p92, 17), mkSpacer(4),
          mkText(`${regionName}油价`, 16, "heavy", C.main), mkSpacer(),
          mkText("下轮调价: ", 12, "medium", infoColor),
          mkText(nextAdjust.dateStr, 12, "bold", infoColor),
          mkText(` ${nextAdjust.countdown}`, 12, "bold", infoColor)
        ], 0),
        mkSpacer(14), 
        { type: "stack", direction: "column", gap: 12, flex: 1, children: [
          mkRow(PRICE_ITEMS.slice(0, 2).map(item => buildPriceCard(item, cardCfg)), 12, { flex: 1 }),
          mkRow(PRICE_ITEMS.slice(2, 4).map(item => buildPriceCard(item, cardCfg)), 12, { flex: 1 })
        ]},
        mkSpacer(12),
        { type: "stack", height: 0.5, backgroundColor: C.divider, borderRadius: 1, children: [] },
        mkSpacer(8),
        mkRow([
          ...(hasTrendData ? [
            mkRow([mkText(trendLabel, 11, "medium", C.muted), mkText(trendInfo, 11, "bold", trendColor, { maxLines: 1 })], 2)
          ] : []),
          mkSpacer(),
          mkRow([mkIcon("arrow.triangle.2.circlepath", C.muted, 12), mkSpacer(4), mkText(updateTimeStr, 11, "bold", C.muted, { family: "Menlo" })], 0)
        ], 0)
      ]
    };
  }

  const cardCfgMed = { radius: 13, padding: [12, 6, 12, 6], labelFz: 11, labelWeight: "bold", valFz: 18, innerGap: 4, deltaFz: 11, deltaGap: 2 };
  const infoColorMed = nextAdjust.isUrgent ? C.red : C.gold;

  return {
    type: "widget", padding: [10, 12, 6, 12], ...rootBackground(),
    children: [
      mkRow([
        mkIcon("fuelpump.circle.fill", C.p92, 16), mkSpacer(2),
        mkText(`${regionName}油价`, 15, "heavy", C.main), mkSpacer(),
        mkText("下轮调价: ", 11, "medium", infoColorMed),
        mkText(nextAdjust.dateStr, 11, "bold", infoColorMed),
        mkText(` ${nextAdjust.countdown}`, 11, "bold", infoColorMed)
      ], 0),
      mkSpacer(24), 
      mkRow(PRICE_ITEMS.map(item => buildPriceCard(item, cardCfgMed)), 6),
      mkSpacer(15), 
      { type: "stack", height: 0.5, backgroundColor: C.divider, borderRadius: 1, children: [] },
      mkSpacer(8), 
      mkRow([
        ...(hasTrendData ? [
          mkRow([mkText(trendLabel, 11, "medium", C.muted), mkText(trendInfo, 11, "bold", trendColor, { maxLines: 1 })], 2)
        ] : []),
        mkSpacer(),
        mkRow([mkIcon("arrow.triangle.2.circlepath", C.muted, 11), mkSpacer(4), mkText(updateTimeStr, 10, "bold", C.muted, { family: "Menlo" })], 0)
      ], 0)
    ]
  };
}