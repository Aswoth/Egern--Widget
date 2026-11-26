// 中国联通（移动透明版）
// 数据：moyuzaime 中国联通小组件（ChinaUnicom_Widget.js）——App/小程序抓取 +
//       小程序请求原样重放（mina/mxx），首页大球 + 余量明细（通用/定向分项）
// 布局：中国移动透明版（china-mobile-hark-merged-glass.js，Hark v23 液态玻璃风格）
//       ——dash / ios 两种版式 × glass / classic 两种样式，布局段逐字节原样抽取，
//       classic 模式背景与原版一致（根 backgroundGradient: bg()，内层卡片 GLASS），
//       只在 glass 模式下去掉根背景做透明。移动的数据层（抓取/加解密/接口查询）已全部去掉。
//       联通自己的布局（classic/dash/ios 三套）也已全部去掉，只留数据层。
// 适配：联通抓取/重放结果 → 移动布局的 ds 结构（见 buildUnicomCMDataSource）。
// 流量单位：联通 plan 的 total/used/remain 原始值已是 KB、语音是分钟，直接使用，
//       余量明细里的 MB 先 ×1024 换成 KB 再算。
// 环境变量：cuCapture / cuCaptureNotice / cuPlanNotice / cuMiniCapture / cuDebug
//   （抓取开关，数据层直接读小写 cu*）；CU_SHOW_GENERAL_FLOW /
//   CU_SHOW_DIRECTIONAL_FLOW / CU_SHOW_USED_FLOW / CU_SHOW_USED_VOICE / CU_TITLE
//   （适配层读大写 CU_*）；CM_LAYOUT（dash/ios）/ CM_WIDGET_STYLE（glass/classic）
//   （与移动版同名，布局代码逐字节原样；YAML 里 cuLayout / cuWidgetStyle
//   同时映射到 CM_* 与 CU_* 两份 env，两种写法都认。）
// 抓取说明：打开中国联通 App 余量页或微信「余量查询」页查询一次，组件抓取凭据；
//   没有 App 凭据时，组件原样重放已保存的小程序请求自行取数（12 小时内有效）。

'use strict';

// ============ 联通数据层（moyuzaime，ChinaUnicom_Widget.js） ============
const API_HOST = 'm.client.10010.com';
const MINI_PROGRAM_HOST = 'mxx.client.10010.com';
const KEY = 'unicom';
// 每 25 分钟最多一个采样点，96 个点约覆盖 24 小时，"今日流量使用"才有完整曲线（原来只留 24 个点，不足 10 小时）。
const HISTORY_LIMIT = 96;

const API_URL =
  'https://m.client.10010.com/mobileserviceimportant/home/queryUserInfoSeven';

// 微信小程序「中国联通」首页大球接口。返回结构与 App 的 queryUserInfoSeven 同构，
// 因此响应体可以直接复用 parseUnicomData 解析（协议来源见 README）。
// 流量明细接口（通用/定向分项）。参考 IBL3ND/module 的做法：App 侧 POST + Cookie 即可，不依赖小程序。
const FLOW_DETAIL_URL =
  'https://m.client.10010.com/servicequerybusiness/operationservice/queryOcsPackageFlowLeftContentRevisedInJune';

// 明细里按这些容器取子项（容器名参与「免流流量」判定）
const FLOW_CONTAINERS = {
  resources: '通用流量',
  RzbResources: '日租宝',
  MlResources: '免流流量',
  XsbResources: '限时流量',
};

// 定向（免流）判定：命中任一即为定向，其余计入通用
function isDirectionalFlowItem(item, containerName) {
  const code = String((item && item.addupItemCode) || '');
  const name = String((item && item.addUpItemName) || '');
  const fee = String((item && item.feePolicyName) || '');
  return code === '40008' ||
    name === '套餐内专享免费流量' ||
    containerName === '免流流量' ||
    /（免流）|畅视/.test(fee);
}

// 把明细响应整理成组件用的结构（单位 MB）
function parseDetailFlow(body) {
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  let gR = 0, gT = 0, gU = 0, dR = 0, dT = 0, dU = 0;
  let percent = null;
  let voiceRemain = null;
  let smsRemain = null;

  for (const key of Object.keys(FLOW_CONTAINERS)) {
    const list = body[key];
    if (!Array.isArray(list)) continue;
    for (const res of list) {
      const details = res && res.details;
      if (!Array.isArray(details)) continue;
      for (const item of details) {
        const remain = Math.max(0, num(item && item.remain));
        const total = Math.max(0, num(item && item.total));
        const used = Math.max(0, num(item && item.use));
        if (isDirectionalFlowItem(item, FLOW_CONTAINERS[key])) {
          dR += remain; dT += total; dU += used;
        } else {
          gR += remain; gT += total; gU += used;
        }
        if (percent == null && item && item.usedPercent != null) {
          const p = num(item.usedPercent);
          if (p) percent = Math.min(1, Math.max(0, p / 100));
        }
      }
    }
  }

  for (const res of Array.isArray(body.resources) ? body.resources : []) {
    const type = String((res && res.type) || '').toLowerCase();
    if (type === 'voice' && voiceRemain == null) voiceRemain = num(res.remainResource);
    if (type === 'smslist' && smsRemain == null) smsRemain = num(res.remainResource);
  }

  let otherUsedMB = 0;
  for (const row of body.flowSumList || []) {
    if (String(row && row.flowtype) === '3') otherUsedMB += num(row.xusedvalue);
  }

  const directional = (dR + dT + dU) > 0 ? { usedMB: dU, remainMB: dR, totalMB: dT } : null;
  const percentFromTotals = (gU + dU) > 0 ? Math.min(1, (gU + dU) / Math.max(1, gU + dU + gR + dR)) : null;

  return {
    ts: Date.now(),
    packageName: body.packageName ? String(body.packageName) : '',
    time: body.time ? String(body.time) : '',
    remainMB: gR,
    usedMB: gU,
    totalMB: gT || null,
    percent: percent != null ? percent : percentFromTotals,
    otherUsedMB,
    general: { usedMB: gU, remainMB: gR, totalMB: gT },
    directional,
    voiceRemain,
    smsRemain,
  };
}

// 主动拉一次明细：App 侧 POST，带 Cookie 即可
async function fetchFlowDetail(ctx, cookie) {
  const resp = await ctx.http.post(FLOW_DETAIL_URL, {
    timeout: 5000,
    headers: {
      Cookie: cookie,
      'User-Agent': 'ChinaUnicom.x CFNetwork iOS/16.3',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: '',
    credentials: 'omit',
  });
  if (!resp || resp.status !== 200) throw new Error('HTTP ' + (resp ? resp.status : 'no-response'));
  const body = await resp.json();
  if (!body || String(body.code) !== '0000') throw new Error('code ' + String(body && body.code));
  return parseDetailFlow(body);
}

const MINI_API_PATH = '/wxapplet/weixinNew/';
const MINI_API_BASE = 'https://mina.10010.com' + MINI_API_PATH;
const MINI_SSP_BIGBALL = MINI_API_BASE + 'sspbigball';

// 小程序会话属于 mina / mxx 自己的域，按域隔离无法用于 App 的 m.client.10010.com，
// 因此单独保存一份「可原样重放」的请求凭据（完整 URL + 关键请求头 + 原始请求体）。
const MINI_HOSTS = ['mina.10010.com', MINI_PROGRAM_HOST];
const MINI_REQ_KEY = 'unicom_mini_req_';
// 超过这个时间认为小程序会话已失效：不再重放，改为纯缓存展示。
const MINI_REPLAY_TTL = 12 * 60 * 60 * 1000;
// 可重放的接口：bigball 产出组件数据，detail 产出通用 / 定向明细。
const MINI_REPLAY_KINDS = [
  { kind: 'bigball', re: /mina\.10010\.com\/wxapplet\/weixinNew\/sspbigball/ },
  { kind: 'detail', re: /mxx\.client\.10010\.com\/(?:servicequerybusiness|servicebusiness)\// },
];
// 重放时必须原样带回的请求头（值不落日志）。
const MINI_REPLAY_HEADERS = ['cookie', 'user-agent', 'content-type', 'referer', 'origin'];

function getRequestHeader(headers, name) {
  if (!headers) return '';

  try {
    if (typeof headers.get === 'function') {
      return headers.get(name) || '';
    }
  } catch (e) {}

  try {
    for (const key of Object.keys(headers)) {
      if (String(key).toLowerCase() === name.toLowerCase()) {
        return headers[key] || '';
      }
    }
  } catch (e) {}

  return '';
}


// App 不同接口用的手机号参数名不一样，这里都试一遍，最后统一按 11 位号码校验，
// 避免把 pageNum / userNum 这类参数误当成手机号。
const PHONE_PARAM_NAMES = ['desmobiel', 'desmobile', 'usermobile', 'mobile', 'phone', 'mobileno', 'userNumber'];

function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  // 允许 86 前缀、空格和短横线
  const digits = raw.replace(/[\s-]/g, '').replace(/^\+?86/, '');
  return /^1\d{10}$/.test(digits) ? digits : '';
}

function extractPhone(url) {
  if (!url) return '';

  try {
    const query = String(url).split('#')[0].split('?')[1] || '';
    if (!query) return '';
    for (const pair of query.split('&')) {
      const idx = pair.indexOf('=');
      if (idx <= 0) continue;
      const key = pair.slice(0, idx).toLowerCase();
      if (!PHONE_PARAM_NAMES.some(name => name.toLowerCase() === key)) continue;
      let value = pair.slice(idx + 1);
      try {
        value = decodeURIComponent(value);
      } catch (e) {}
      const phone = normalizePhone(value);
      if (phone) return phone;
    }
  } catch (e) {}

  return '';
}


async function fetchUnicomData(
  ctx,
  cookie,
  phone
) {

  const url =
    `${API_URL}?version=iphone_c@10.0100` +
    `&desmobiel=${encodeURIComponent(phone)}` +
    `&showType=0`;

  const resp = await ctx.http.get(
    url,
    {
      timeout: 10000,

      headers: {
        Host: API_HOST,

        'User-Agent':
          'ChinaUnicom.x CFNetwork iOS/16.3',

        Cookie: cookie,
      },

      credentials: 'omit',
    }
  );


  if (!resp || resp.status !== 200) {
    const status = resp ? resp.status : 0;
    const err = new Error(
      `HTTP ${resp ? resp.status : 'no-response'}`
    );
    // 401/403/302 基本意味着登录态失效，需要用户重新抓一次凭据。
    err.kind = status === 401 || status === 403 || status === 302 ? 'auth' : 'http';
    throw err;
  }


  return await resp.json();
}

function parseUnicomData(res) {

  if (
    !res ||
    res.code !== 'Y' ||
    !res.feeResource ||
    !res.voiceResource ||
    !res.flowResource
  ) {
    const err = new Error(
      `API 返回异常：${res?.code || 'unknown'}`
    );
    err.kind = 'auth';
    throw err;
  }


  const feeResource =
    res.feeResource;

  const voiceResource =
    res.voiceResource;

  const flowResource =
    res.flowResource;


  return {
    fee: {
      title:
        feeResource.dynamicFeeTitle ||
        '剩余话费',

      value:
        feeResource.feePersent ??
        0,

      unit:
        feeResource.newUnit ||
        '元',
    },

    voice: {
      title:
        voiceResource.dynamicVoiceTitle ||
        '剩余语音',

      value:
        voiceResource.voicePersent ??
        0,

      unit:
        voiceResource.newUnit ||
        '分钟',
    },

    flow: {
      title:
        flowResource.dynamicFlowTitle ||
        '剩余流量',

      value:
        flowResource.flowPersent ??
        0,

      unit:
        flowResource.newUnit ||
        'MB',
    },

    updateTime:
      new Date().toLocaleTimeString(
        'zh-CN',
        {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Shanghai',
        }
      ),

    timestamp: Date.now(),
  };
}

function captureDebug(message) {
  try {
    if (typeof console !== 'undefined' && typeof console.log === 'function') {
      console.log('[ChinaUnicom Capture] ' + message);
    }
  } catch (e) {}
}


/* =========================================================
 * 小程序凭据与重放
 *
 * 微信小程序的会话（Cookie / openid / 密文 body）只属于 mina、mxx 两个域，
 * 无法用于 App 的 m.client.10010.com。所以这里单独保存一份请求凭据：
 * 完整 URL + 关键请求头 + 原始请求体；组件没有 App 凭据时按原样重放，
 * 等价于用户又打开了一次小程序，也不需要自己实现 openid / RSA 签名。
 * ========================================================= */

function isMiniUrl(url) {
  const s = String(url || '');
  return MINI_HOSTS.some(host => s.indexOf(host) >= 0);
}

// 原始请求体：Egern 可能给字符串，也可能只给 Request-like 对象。
async function readRawBody(req) {
  const body = req && req.body;
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') {
    try { return JSON.stringify(body); } catch (e) { return ''; }
  }
  try {
    if (req && typeof req.text === 'function') {
      const text = await req.text();
      if (typeof text === 'string') return text;
    }
  } catch (e) {}
  try {
    if (req && typeof req.json === 'function') {
      const json = await req.json();
      if (json != null) return JSON.stringify(json);
    }
  } catch (e) {}
  return '';
}

async function saveMiniRequests(ctx, req, safePath) {
  const url = String(req.url || '');
  const matched = MINI_REPLAY_KINDS.filter(entry => entry.re.test(url));
  if (!matched.length) {
    captureDebug('mini skip(not-replayable): path=' + safePath);
    return;
  }

  const headers = {};
  for (const name of MINI_REPLAY_HEADERS) {
    const value = getRequestHeader(req.headers, name);
    if (value) headers[name] = String(value);
  }
  const body = await readRawBody(req);
  const method = String(req.method || 'GET').toUpperCase();

  for (const entry of matched) {
    ctx.storage.setJSON(MINI_REQ_KEY + entry.kind, {
      ts: Date.now(),
      method,
      url,
      headers,
      body,
    });
  }
  ctx.storage.set('unicom_miniTime', String(Date.now()));
  // 只记录元数据：路径、方法、头名、体长度；绝不输出 Cookie 与密文内容。
  captureDebug('mini saved: path=' + safePath +
    '; kinds=' + matched.map(entry => entry.kind).join(',') +
    '; method=' + method +
    '; headerNames=' + Object.keys(headers).join(',') +
    '; bodyLength=' + body.length);
}

function miniReplayReady(ctx) {
  return MINI_REPLAY_KINDS.some(entry => {
    const saved = ctx.storage.getJSON(MINI_REQ_KEY + entry.kind);
    if (!saved || !saved.url) return false;
    const age = Date.now() - Number(saved.ts || 0);
    return Number.isFinite(age) && age >= 0 && age <= MINI_REPLAY_TTL;
  });
}

// 重放一个已保存的小程序请求；解析成功返回 true。
async function replayMiniRequest(ctx, kind) {
  const saved = ctx.storage.getJSON(MINI_REQ_KEY + kind);
  if (!saved || !saved.url) return false;
  const age = Date.now() - Number(saved.ts || 0);
  if (!Number.isFinite(age) || age < 0 || age > MINI_REPLAY_TTL) return false;

  const options = {
    timeout: 8000,
    headers: Object.assign({}, saved.headers || {}),
    credentials: 'omit',
  };
  const resp = saved.method === 'GET'
    ? await ctx.http.get(saved.url, options)
    : await ctx.http.post(saved.url, Object.assign({ body: saved.body || '' }, options));

  if (!resp || resp.status !== 200) {
    throw new Error('HTTP ' + (resp ? resp.status : 'no-response'));
  }
  const body = await resp.json();
  return Boolean(applyMiniBody(ctx, saved.url, body));
}

// 依次重放：先取首页大球（产出 datasource），再补余量明细（字段最全）。
async function replayMini(ctx) {
  let parsedAny = false;
  for (const entry of MINI_REPLAY_KINDS) {
    try {
      if (await replayMiniRequest(ctx, entry.kind)) parsedAny = true;
    } catch (e) {
      captureDebug('mini replay failed(' + entry.kind + '): ' + String((e && e.message) || e));
    }
  }
  if (!parsedAny) return null;
  const ds = ctx.storage.getJSON('unicom_datasource');
  if (!ds) return null;
  ds.stale = false;
  return ds;
}

async function handleCapture(ctx) {
  const req = ctx.request || {};
  const url = String(req.url || '');
  // 日志只记录路径和布尔状态，绝不输出查询参数、手机号、Cookie 或 Token。
  const safePath = url.split('?')[0].split('#')[0];

  // 小程序请求：只保存可原样重放的请求凭据，不参与 App 取数（Cookie 按域隔离）。
  if (isMiniUrl(url)) {
    if (ctx.env && String(ctx.env.cuMiniCapture).toLowerCase() === 'false') {
      captureDebug('skip(disabled): cuMiniCapture=false; path=' + safePath);
      return;
    }
    await saveMiniRequests(ctx, req, safePath);
    return;
  }

  if (ctx.env && String(ctx.env.cuCapture).toLowerCase() === 'false') {
    captureDebug('skip(disabled): cuCapture=false; path=' + safePath);
    return;
  }
  if (!url.includes(API_HOST)) {
    captureDebug('skip(host): host mismatch; path=' + safePath);
    return;
  }

  const cookie = String(getRequestHeader(req.headers, 'cookie') || '').trim();
  const phone = extractPhone(url);

  // App 里大量接口（如 servicequerybusiness/yidingyewu）本来就不带 Cookie 和 desmobiel。
  // 这类请求只留一行日志就退出：既不误弹通知，也不会让日志看起来像报错。
  if (!cookie && !phone) {
    captureDebug('skip(no-creds): path=' + safePath);
    return;
  }

  // 只有套餐查询 / 登录类请求才值得提示「凭据不完整」。
  const planLike = Boolean(phone) ||
    /queryUserInfo|desmobiel|userinfo|login|home\/query/i.test(url);

  captureDebug('triggered: path=' + safePath +
    '; cookiePresent=' + Boolean(cookie) +
    '; phoneParamPresent=' + Boolean(phone) +
    '; planLike=' + planLike);

  let cookieChanged = false;
  let phoneChanged = false;
  if (cookie) {
    const previousCookie = ctx.storage.get('unicom_cookie') || '';
    if (cookie !== previousCookie) {
      ctx.storage.set('unicom_cookie', cookie);
      cookieChanged = true;
    }
  }
  if (phone) {
    const previousPhone = ctx.storage.get('unicom_phone') || '';
    if (phone !== previousPhone) {
      ctx.storage.set('unicom_phone', phone);
      phoneChanged = true;
    }
  }

  if (cookie && phone && (cookieChanged || phoneChanged)) {
    ctx.storage.set('unicom_captureTime', String(Date.now()));
    captureDebug('success: credentials updated; cookieChanged=' + cookieChanged + '; phoneChanged=' + phoneChanged);
    if ((!ctx.env || String(ctx.env.cuCaptureNotice).toLowerCase() !== 'false') && typeof ctx.notify === 'function') {
      const maskedPhone = phone ? '（尾号 ' + phone.slice(-4) + '）' : '';
      ctx.notify({
        title: '中国联通数据捕获成功',
        body: '已捕获登录信息' + maskedPhone + '，正在更新套餐数据',
        sound: false,
      });
    }
    return;
  }

  const captureNoticeEnabled = !ctx.env || String(ctx.env.cuCaptureNotice).toLowerCase() !== 'false';
  const notifyDiagnostic = (status) => {
    if (!captureNoticeEnabled || typeof ctx.notify !== 'function') return;
    // 限频，避免 App 连续请求时反复弹通知；通知内容只包含状态，不包含任何凭据。
    const now = Date.now();
    const last = Number(ctx.storage.get('unicom_captureDiagNotifyAt') || 0);
    if (now - last < 60000) return;
    ctx.storage.set('unicom_captureDiagNotifyAt', String(now));
    ctx.notify({
      title: '中国联通捕获诊断',
      body: '请求脚本已触发；Cookie：' + (cookie ? '已获取' : '缺失') +
        '；手机号参数：' + (phone ? '已获取' : '缺失') +
        '；状态：' + status,
      sound: false,
    });
  };

  if (!cookie || !phone) {
    captureDebug('incomplete: cookiePresent=' + Boolean(cookie) + '; phoneParamPresent=' + Boolean(phone));
    if (planLike) notifyDiagnostic('凭据不完整');
  } else {
    captureDebug('unchanged: credentials already match stored values');
    if (planLike) notifyDiagnostic('凭据未变化');
  }
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '刚刚';
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return '刚刚';
  if (totalMin < 60) return totalMin + '分';
  const hours = Math.floor(totalMin / 60);
  const remMin = totalMin % 60;
  if (hours < 24) return hours + '小时' + (remMin > 0 ? remMin + '分' : '');
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return days + '天' + (remHours > 0 ? remHours + '小时' : '');
}

// 数据新旧的自然描述（用于「缓存 X 前」），与凭据保持的紧凑格式分开
function ageText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '刚刚';
  const min = Math.floor(ms / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + '分钟';
  const hours = Math.floor(min / 60);
  const restMin = min % 60;
  if (hours < 24) return hours + '小时' + (restMin > 0 ? restMin + '分' : '');
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return days + '天' + (restHours > 0 ? restHours + '小时' : '');
}

// 凭据保持时间：App 抓取的 captureTime 优先，只抓过小程序时用 miniTime 兜底
function captureTsOf(ctx) {
  return Number(ctx.storage.get('unicom_captureTime') || ctx.storage.get('unicom_miniTime') || 0);
}

function saveHistory(ctx, flow, fallback) {
  try {
    const stored = ctx.storage.getJSON(KEY + '.history');
    const old = Array.isArray(stored) && stored.length ? stored : (Array.isArray(fallback) ? fallback : []);
    if (flow == null || flow === '') return old;
    const n = Number(flow);
    if (!Number.isFinite(n)) return old;

    const now = Date.now();
    const next = old.filter(x => now - Number(x.ts) < 7 * 86400000);
    const last = next[next.length - 1];
    if (!last || now - Number(last.ts) >= 25 * 60 * 1000 || Number(last.flowKB) !== n) {
      next.push({ ts: now, flowKB: n });
    }
    const trimmed = next.slice(-HISTORY_LIMIT);
    if (JSON.stringify(trimmed) !== JSON.stringify(old)) {
      ctx.storage.setJSON(KEY + '.history', trimmed);
    }
    return trimmed;
  } catch (e) {
    return [];
  }
}


function calcPlanPercent(total, used, remain) {
  const t = Number(total), u = Number(used), r = Number(remain);
  if (Number.isFinite(t) && t > 0 && Number.isFinite(u) && u >= 0) return Math.max(0, Math.min(1, u / t));
  if (Number.isFinite(t) && t > 0 && Number.isFinite(r) && r >= 0) return Math.max(0, Math.min(1, 1 - r / t));
  return null;
}
function formatFlow(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return { number: '--', unit: 'GB' };
  if (n >= 1024 * 1024) return { number: (n / (1024 * 1024)).toFixed(2), unit: 'GB' };
  if (n >= 1024) return { number: (n / 1024).toFixed(2), unit: 'MB' };
  if (n >= 1) return { number: n.toFixed(2), unit: 'KB' };
  return { number: (n * 1024).toFixed(2), unit: 'B' };
}
function formatVoice(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(0) : '--';
}

/* 联通数据加载：保留联通 API，并增加历史趋势与广电组件同款数据结构 */
function numericResourceValue(resource, keys) {
  if (!resource || typeof resource !== 'object') return null;
  for (const key of keys) {
    const v = resource[key];
    if (v !== undefined && v !== null && v !== '') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}
// App 接口与小程序接口返回同样的 feeResource/flowResource/voiceResource，
// 这里统一换算成小组件使用的数据结构。
function buildDataSource(ctx, parsed, raw, captureDuration) {
  const flowResource = raw.flowResource || {};
  const voiceResource = raw.voiceResource || {};
  const flowTotalRaw = numericResourceValue(flowResource, ['flowTotal', 'flowAll', 'totalFlow', 'total', 'totalValue', 'resourceTotal', 'sumValue']);
  const flowUsedRaw = numericResourceValue(flowResource, ['flowUsed', 'flowUserd', 'usedFlow', 'used', 'usedValue', 'consumeValue', 'usedResource']);
  const voiceTotal = numericResourceValue(voiceResource, ['voiceTotal', 'voiceAll', 'totalVoice', 'total', 'totalValue', 'resourceTotal', 'sumValue']);
  const voiceUsed = numericResourceValue(voiceResource, ['voiceUsed', 'usedVoice', 'voiceUserd', 'used', 'usedValue', 'consumeValue', 'usedResource']);

  const unit = String(parsed.flow.unit || 'MB').toUpperCase();
  const flowToKB = n => {
    const v = Number(n);
    if (!Number.isFinite(v)) return null;
    if (unit === 'GB') return v * 1024 * 1024;
    if (unit === 'KB') return v;
    if (unit === 'B') return v / 1024;
    return v * 1024;
  };
  const remainKB = flowToKB(parsed.flow.value);
  const totalKB = flowTotalRaw == null ? null : flowToKB(flowTotalRaw);
  const usedKB = flowUsedRaw == null ? null : flowToKB(flowUsedRaw);
  const history = saveHistory(ctx, remainKB);
  const flowDisplay = formatFlow(remainKB);
  const ds = {
    stale: false,
    fee: { title: '剩余话费', number: Number(parsed.fee.value).toFixed(2), unit: '元' },
    flow: { title: '剩余流量', number: flowDisplay.number, unit: flowDisplay.unit },
    voice: { title: '剩余语音', number: String(parsed.voice.value), unit: parsed.voice.unit || '分钟' },
    updatedAt: Date.now(),
    captureDuration: captureDuration || '',
    history,
    plan: {
      total: totalKB, used: usedKB, remain: remainKB,
      percent: calcPlanPercent(totalKB, usedKB, remainKB),
      totalPath: flowTotalRaw == null ? null : 'flowResource',
      usedPath: flowUsedRaw == null ? null : 'flowResource',
      voiceTotal, voiceUsed, voiceRemain: Number(parsed.voice.value),
      voicePercent: calcPlanPercent(voiceTotal, voiceUsed, Number(parsed.voice.value)),
    },
  };
  return { ds, flowDisplay };
}

async function loadUnicomData(ctx) {
  const captureDisabled = !!(ctx.env && String(ctx.env.cuCapture).toLowerCase() === 'false');
  // 诊断日志：模块参数 cuDebug=true 时输出接口结构与关键字段，方便排查字段变化
  const debug = String((ctx.env && ctx.env.cuDebug) || '').toLowerCase() === 'true';
  const debugLog = (...args) => { if (debug) console.log(...args); };
  const readCache = () => {
    const cached = ctx.storage.getJSON('unicom_datasource') || null;
    if (!cached) return null;
    cached.stale = true;
    // 连续两次鉴权失败才提示，避免接口偶发异常时误报。
    cached.authFailed = Number(ctx.storage.get('unicom_authFail') || 0) >= 2;
    const ts = captureTsOf(ctx);
    // 冻结在数据生成时刻：数据过期后「凭据保持」不再随时间增长
    cached.captureDuration = ts > 0 ? formatDuration(Math.max(0, Number(cached.updatedAt || Date.now()) - ts)) : '';
    return cached;
  };

  if (captureDisabled) {
    const cached = readCache();
    return { data: cached, configured: !!cached, error: null, fromCache: true };
  }

  // 手动刷新识别：60 秒内再次渲染（下拉/点按刷新）且上一次渲染没有真正请求时，绕过缓存查询一次
  const lastRenderAt = Number(ctx.storage.get('unicom_lastRenderAt') || 0);
  const lastFetchAt = Number(ctx.storage.get('unicom_lastFetchAt') || 0);
  const lastRenderFetched = ctx.storage.get('unicom_lastRenderFetched') === '1';
  const manualRefresh = lastRenderAt > 0 && Date.now() - lastRenderAt < 60000
    && !lastRenderFetched && Date.now() - lastFetchAt > 5000;
  ctx.storage.set('unicom_lastRenderAt', String(Date.now()));
  ctx.storage.set('unicom_lastRenderFetched', '0');

  // 主屏 / 锁屏 / 画廊可能在同一轮里各自渲染一次，45 秒内复用同一份数据，避免重复打接口被风控。
  const fresh = ctx.storage.getJSON('unicom_datasource') || null;
  if (!manualRefresh && fresh && Number(fresh.updatedAt || 0) > 0 && Date.now() - Number(fresh.updatedAt) < 45000) {
    const ts = captureTsOf(ctx);
    fresh.captureDuration = ts > 0 ? formatDuration(Math.max(0, Number(fresh.updatedAt || Date.now()) - ts)) : '';
    return { data: fresh, configured: true, error: null, fromCache: false };
  }

  const captureTs = captureTsOf(ctx);
  const captureDuration = captureTs > 0 ? formatDuration(Date.now() - captureTs) : '';
  const cookie = ctx.storage.get('unicom_cookie') || '';
  const phone = ctx.storage.get('unicom_phone') || '';
  if (!cookie || !phone) {
    // 只有小程序凭据时：原样重放小程序请求取数（15 分钟一次），失败回落到缓存。
    // 小程序会话与 App 会话互不通用，所以这条路径只在没有 App 凭据时启用。
    const miniEnabled = !(ctx.env && String(ctx.env.cuMiniCapture).toLowerCase() === 'false');
    if (miniEnabled && miniReplayReady(ctx) && Date.now() - lastFetchAt > 15 * 60 * 1000) {
      ctx.storage.set('unicom_lastFetchAt', String(Date.now()));
      ctx.storage.set('unicom_lastRenderFetched', '1');
      const replayed = await replayMini(ctx);
      if (replayed) {
        const ts = captureTsOf(ctx);
        replayed.captureDuration = ts > 0
          ? formatDuration(Math.max(0, Number(replayed.updatedAt || Date.now()) - ts))
          : '';
        return { data: replayed, configured: true, error: null, fromCache: false };
      }
    }
    // 只做过微信小程序抓取（没有 App 凭据）时，直接用已缓存的小程序数据。
    const cached = readCache();
    if (cached) return { data: cached, configured: true, error: null, fromCache: true };
    return { data: null, configured: false, error: null, fromCache: false };
  }

  try {
    ctx.storage.set('unicom_lastFetchAt', String(Date.now()));
    ctx.storage.set('unicom_lastRenderFetched', '1');
    const raw = await fetchUnicomData(ctx, cookie, phone);
    const keysOf = (o) => (o && typeof o === 'object' ? Object.keys(o).slice(0, 20).join(',') : String(o));
    debugLog(
      '[ChinaUnicom] API响应诊断: code=' + String(raw && raw.code) +
      ' | topKeys=' + keysOf(raw) +
      ' | feeKeys=' + keysOf(raw && raw.feeResource) +
      ' | flowKeys=' + keysOf(raw && raw.flowResource) +
      ' | voiceKeys=' + keysOf(raw && raw.voiceResource)
    );
    const parsed = parseUnicomData(raw);
    debugLog(
      '[ChinaUnicom] 套餐字段探测: fee=' + (parsed.fee && parsed.fee.number) + (parsed.fee && parsed.fee.unit) +
      ' | flow=' + (parsed.flow && parsed.flow.number) + (parsed.flow && parsed.flow.unit) +
      ' | voice=' + (parsed.voice && parsed.voice.number) + (parsed.voice && parsed.voice.unit) +
      ' | plan=' + JSON.stringify(parsed.plan || null)
    );
    const { ds, flowDisplay } = buildDataSource(ctx, parsed, raw, captureDuration);
    ctx.storage.setJSON('unicom_datasource', ds);
    ctx.storage.delete('unicom_authFail');
    // 流量明细（通用/定向分项）：15 分钟内不重复拉，失败静默降级
    try {
      const prevDetail = ctx.storage.getJSON('unicom_flowdetail');
      if (!prevDetail || !prevDetail.ts || Date.now() - Number(prevDetail.ts) > 15 * 60 * 1000) {
        ctx.storage.setJSON('unicom_flowdetail', await fetchFlowDetail(ctx, cookie));
      }
    } catch (e) {
      console.log('[ChinaUnicom] 流量明细获取失败: ' + String((e && e.message) || e));
    }
    const captureTime = String(ctx.storage.get('unicom_captureTime') || '');
    const notifiedCaptureTime = String(ctx.storage.get('unicom_notifiedCaptureTime') || '');
    if (captureTime && captureTime !== notifiedCaptureTime) {
      if ((!ctx.env || String(ctx.env.cuPlanNotice).toLowerCase() !== 'false') && typeof ctx.notify === 'function') {
        ctx.notify({
          title: '中国联通套餐查询成功',
          body: [
            '剩余话费：¥' + ds.fee.number,
            '剩余流量：' + flowDisplay.number + ' ' + flowDisplay.unit,
            '剩余语音：' + ds.voice.number + ' 分钟',
          ].join('\n'),
          sound: false,
        });
      }
      ctx.storage.set('unicom_notifiedCaptureTime', captureTime);
    }
    return { data: ds, configured: true, error: null, fromCache: false };
  } catch (e) {
    if (e && e.kind === 'auth') {
      ctx.storage.set('unicom_authFail', String(Number(ctx.storage.get('unicom_authFail') || 0) + 1));
    }
    return { data: readCache(), configured: true, error: e, fromCache: true };
  }
}

function applyMiniBody(ctx, reqUrl, body) {
  if (!body || String(body.code) !== '0000') return '';

  // 小程序有些接口把字段放在响应根层（没有 data 包装），两种都要兼容。
  const data = body.data && typeof body.data === 'object' ? body.data : body;

  // ① 账户余额接口：curntbalancecust / canusefeecust
  if (body.curntbalancecust != null || body.canusefeecust != null) {
    try {
      const num = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      ctx.storage.setJSON('unicom_account', {
        ts: Date.now(),
        balance: num(body.curntbalancecust),
        available: num(body.canusefeecust ?? body.canuseprecust),
        monthCost: num(body.realfeecust ?? body.totalrealfee ?? body.allbillfee),
        carryOver: num(body.carryForwardFromLastMonth ?? body.newCarryForwardFromLastMonth ?? body.carryOverArrears),
        owed: num(body.allbowefeecust),
        queryTime: body.queryTime ? String(body.queryTime) : '',
        path: reqUrl.split('?')[0],
      });
      captureDebug('account captured: balance=' + body.curntbalancecust);
    } catch (e) {
      captureDebug('account parse failed: ' + e);
    }
    return 'account';
  }

  // ② 余量查询接口：packageName + resources（flow/voice/sms）+ flowSumList
  if (body.packageName && Array.isArray(body.resources)) {
    try {
      const num = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      const parsed = parseDetailFlow(body);

      ctx.storage.setJSON('unicom_flowdetail', Object.assign(parsed, { path: reqUrl.split('?')[0] }));
      captureDebug('flow detail captured: pkg=' + body.packageName + '; remainMB=' + parsed.remainMB);
    } catch (e) {
      captureDebug('flow detail parse failed: ' + e);
    }
    return 'detail';
  }

  if (!data || typeof data !== 'object') return '';

  if (reqUrl.indexOf(MINI_SSP_BIGBALL) === 0 && data.feeResource && data.flowResource && data.voiceResource) {
    try {
      const parsed = parseUnicomData({
        code: 'Y',
        feeResource: data.feeResource,
        voiceResource: data.voiceResource,
        flowResource: data.flowResource,
      });
      // buildDataSource 用的是原始资源对象里的 total/used 字段，小程序同样有。
      if (String((ctx.env && ctx.env.cuDebug) || '').toLowerCase() === 'true') {
        console.log(
          '[ChinaUnicom] 小程序响应诊断: keys=' + Object.keys(data).slice(0, 20).join(',') +
          ' | fee=' + JSON.stringify(data.feeResource || null) +
          ' | flow=' + JSON.stringify(data.flowResource || null) +
          ' | voice=' + JSON.stringify(data.voiceResource || null)
        );
      }
      const { ds, flowDisplay } = buildDataSource(ctx, parsed, data, '');
      ds.source = 'mini';
      ctx.storage.setJSON('unicom_datasource', ds);
      ctx.storage.set('unicom_miniTime', String(Date.now()));
      ctx.storage.delete('unicom_authFail');
      if ((!ctx.env || String(ctx.env.cuCaptureNotice).toLowerCase() !== 'false') &&
          typeof ctx.notify === 'function') {
        ctx.notify({
          title: '中国联通小程序数据已捕获',
          body: [
            '剩余话费：¥' + ds.fee.number,
            '剩余流量：' + flowDisplay.number + ' ' + flowDisplay.unit,
            '剩余语音：' + ds.voice.number + ' 分钟',
          ].join('\n'),
          sound: false,
        });
      }
    } catch (e) {
      captureDebug('mini parse failed: ' + e);
    }
    return 'bigball';
  }

  // 顺手保存手机号，方便诊断时区分账号（不参与取数）
  if (reqUrl.includes('queryGoodsList')) {
    try {
      const rows = data.res || [];
      const main = rows[0] && rows[0].mainNumber;
      if (main) ctx.storage.set('unicom_phone', String(main));
    } catch (e) {}
    return 'phone';
  }

  // 账户总览：可用话费 / 本月消费 / 欠费 / 结转（暂只存档，供后续展示）
  if (reqUrl.includes('sspbalcbroadcast')) {
    try {
      const rows = data.res || data || [];
      const first = Array.isArray(rows) ? rows[0] : rows;
      if (first && typeof first === 'object') {
        ctx.storage.setJSON('unicom_account', {
          ts: Date.now(),
          available: Number(first.CANUSE_FEE_CUST),
          monthCost: Number(first.REAL_FEE_CUST),
          owed: Number(first.ALLBOWE_FEE),
          carryOver: Number(first.CARRY_INFO_ALL_FEE),
        });
      }
    } catch (e) {}
    return 'overview';
  }
  return '';
}

// 小程序响应钩子：只负责取响应体，解析交给 applyMiniBody（与重放共用）。
async function handleMiniResponse(ctx) {
  if (ctx.env && String(ctx.env.cuMiniCapture).toLowerCase() === 'false') return;

  const reqUrl = String((ctx.request && ctx.request.url) || '');
  if (!isMiniUrl(reqUrl)) return;

  const res = ctx.response || {};
  if (Number(res.status) !== 200) return;

  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    return;
  }
  applyMiniBody(ctx, reqUrl, body);
}

async function handleManualRefresh(ctx) {
  try {
    // 把缓存标记为过期，loadData 才会真正发起请求
    const cached = ctx.storage.getJSON('unicom_datasource');
    if (cached && typeof cached === 'object') {
      cached.updatedAt = 0;
      ctx.storage.setJSON('unicom_datasource', cached);
    }
    ctx.storage.set('unicom_lastRenderFetched', '1');
    const res = await loadUnicomData(ctx);
    const data = res && res.data;
    if (typeof ctx.notify === 'function') {
      if (data && data.flow && data.fee) {
        ctx.notify({
          title: '中国联通数据已刷新',
          body: '流量 ' + data.flow.number + ' ' + data.flow.unit + ' · 话费 ¥' + data.fee.number,
          sound: false,
        });
      } else {
        ctx.notify({
          title: '中国联通刷新失败',
          body: '请打开中国联通 App 或小程序查询一次后再试',
          sound: false,
        });
      }
    }
  } catch (e) {
    console.log('[ChinaUnicom] 手动刷新失败: ' + String((e && e.message) || e));
  }
}

/* ==================== 工具（移动布局用） ==================== */

function pad2(n) { return n < 10 ? `0${n}` : `${n}`; }

function fmtTime(ts) {
  const d = new Date(ts);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function getPhone(ctx) {
  const fromEnv = (ctx.env.CM_PHONENUMBER || '').trim();
  if (/^\d{11}$/.test(fromEnv)) {
    try { ctx.storage.set('cm_phone_backup', fromEnv); } catch (e) {}
    return fromEnv;
  }
  try {
    const bak = (ctx.storage.get('cm_phone_backup') || '').trim();
    if (/^\d{11}$/.test(bak)) return bak;
  } catch (e) {}
  return '';
}

/* ==================== 渲染层（Widget DSL）· v23 iOS 液态玻璃风格 ==================== */
// 设计：Apple「健身圆环」式三环（通用流量/其他流量/语音）+ 液态玻璃卡片
// 新功能：今日已用流量、月底前日均可用、本月剩余天数、话费不足提醒

const C_FEE = '#FF9F0A';
const C_FLOW = '#0A84FF';
const C_OTHER = '#64D2FF';
const C_VOICE = '#30D158';
const WARN = '#FF453A';
const TXT = { light: '#000000', dark: '#FFFFFF' };
const SUB = { light: '#3C3C4399', dark: '#EBEBF599' };
const GLASS = { light: '#FFFFFFA6', dark: '#FFFFFF1A' };

function bg() {
  return {
    type: 'linear',
    colors: [{ light: '#EAF3FF', dark: '#0B1A33' }, { light: '#F4F0FF', dark: '#120B24' }, { light: '#E9FBF3', dark: '#03140F' }],
    stops: [0, 0.55, 1],
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 1, y: 1 },
  };
}

// 透明版：CM_WIDGET_STYLE=glass（默认）去掉根渐变、透壁纸；classic 为原版渐变
// （原版注释里写了这个开关但没实现，这里补上；内层液态玻璃卡片本来就是半透明，不动）
const isGlass = (ctx) => String((ctx.env || {}).CM_WIDGET_STYLE || 'glass').trim().toLowerCase() !== 'classic';
const rootBg = (ctx) => isGlass(ctx) ? {} : { backgroundGradient: bg() };

/* ---------- 用量洞察 ---------- */

function toMB(d) {
  const n = parseFloat(d && d.number);
  if (!Number.isFinite(n)) return null;
  return d.unit === 'GB' ? n * 1024 : n;
}

function fmtMB(mb) {
  if (mb == null || !Number.isFinite(mb)) return '--';
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(0)} MB`;
}

function insights(ctx, ds) {
  const now = new Date();
  const dayKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = dim - now.getDate() + 1;
  // 按 通用 + 其他流量 合计剩余统计
  const _g = toMB(ds.flow), _o = toMB(ds.otherFlow);
  const flowMB = ctx.env.CM_SHOW_USED_FLOW === 'true' ? null
    : (_g == null && _o == null ? null : (_g || 0) + (_o || 0));
  let todayMB = null;
  if (flowMB != null) {
    let snap = null;
    try { snap = ctx.storage.getJSON('cm_day_snap'); } catch (e) {}
    // 新的一天，或流量变多（加油包/月初重置）→ 重新记起点
    if (!snap || snap.date !== dayKey || flowMB > snap.start + 1) {
      snap = { date: dayKey, start: flowMB };
      try { ctx.storage.setJSON('cm_day_snap', snap); } catch (e) {}
    }
    todayMB = Math.max(0, snap.start - flowMB);
  }
  // 近 7 天每日用量历史（旧 → 今天）
  const hist = [];
  if (todayMB != null) {
    let h = {};
    try { h = ctx.storage.getJSON('cm_hist') || {}; } catch (e) {}
    h[dayKey] = todayMB;
    const keep = {};
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const k = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      if (h[k] != null) keep[k] = h[k];
      if (i <= 6) hist.push(h[k] == null ? null : h[k]);
    }
    try { ctx.storage.setJSON('cm_hist', keep); } catch (e) {}
  }
  // 按近 6 天（不含今天）平均用量预测
  let forecast = { text: '用量统计中…', color: SUB };
  if (flowMB != null) {
    const past = hist.slice(0, 6).filter(v => v != null && v > 0);
    const vals = past.length ? past : (todayMB > 0 ? [todayMB] : []);
    if (vals.length) {
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      const days = Math.floor(flowMB / avg);
      forecast = days >= daysLeft
        ? { text: days > 999 ? '按近期速度 充足' : `预计够用 ${days} 天 ✓`, color: C_VOICE }
        : { text: `约 ${days} 天用完 · 早于月底`, color: C_FEE };
    }
  }
  return {
    hist,
    forecast,
    daysLeft,
    monthPct: (now.getDate() - 1 + now.getHours() / 24) / dim,
    todayMB,
    dailyMB: flowMB != null ? flowMB / daysLeft : null,
    lowFee: (() => { const n = parseFloat(ds.fee.number); return Number.isFinite(n) && n < 10; })(),
  };
}

/* ---------- 图形 ---------- */

// 三层同心圆环（外→内：通用流量、其他流量、语音）
function ringsSvg(values, size, stroke, gap) {
  const h = size / 2;
  let body = '';
  values.forEach((v, i) => {
    const r = h - stroke / 2 - i * (stroke + gap);
    if (r <= stroke / 2) return;
    const c = 2 * Math.PI * r;
    const p = Math.max(0, Math.min(1, Number(v.pct) || 0));
    body += `<circle cx='${h}' cy='${h}' r='${r.toFixed(2)}' fill='none' stroke='${v.color}' stroke-opacity='0.22' stroke-width='${stroke}'/>`;
    if (p > 0) {
      // 用 path 圆弧绘制进度，不依赖 stroke-dasharray
      if (p >= 0.999) {
        body += `<circle cx='${h}' cy='${h}' r='${r.toFixed(2)}' fill='none' stroke='${v.color}' stroke-width='${stroke}'/>`;
      } else {
        const a = p * 2 * Math.PI;
        const x = (h + r * Math.sin(a)).toFixed(2), y = (h - r * Math.cos(a)).toFixed(2);
        body += `<path d='M ${h} ${(h - r).toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${p > 0.5 ? 1 : 0} 1 ${x} ${y}' fill='none' stroke='${v.color}' stroke-width='${stroke}' stroke-linecap='round'/>`;
      }
    }
  });
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${size} ${size}'>${body}</svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function ringSvg(pct, size, stroke) {
  return ringsSvg([{ pct, color: 'white' }], size, stroke, 0);
}

function barSvg(pct, color, w, h) {
  const p = Math.max(0, Math.min(1, Number(pct) || 0));
  const r = h / 2, fw = p > 0 ? Math.max(h, w * p) : 0;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}'>` +
    `<rect width='${w}' height='${h}' rx='${r}' fill='${color}' fill-opacity='0.2'/>` +
    (fw ? `<rect width='${fw.toFixed(1)}' height='${h}' rx='${r}' fill='${color}'/>` : '') + `</svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

// 半圆仪表
function gaugeSvg(pct, color, w) {
  const stroke = 12, r = (w - stroke) / 2, cx = w / 2, cy = w / 2, h = w / 2 + stroke / 2;
  const p = Math.max(0, Math.min(1, Number(pct) || 0));
  const pt = a => [(cx - r * Math.cos(a)).toFixed(2), (cy - r * Math.sin(a)).toFixed(2)];
  const [x0, y0] = pt(0), [x1, y1] = pt(Math.PI), [xp, yp] = pt(Math.PI * p);
  let body = `<path d='M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}' fill='none' stroke='${color}' stroke-opacity='0.22' stroke-width='${stroke}' stroke-linecap='round'/>`;
  if (p > 0.005) body += `<path d='M ${x0} ${y0} A ${r} ${r} 0 0 1 ${xp} ${yp}' fill='none' stroke='${color}' stroke-width='${stroke}' stroke-linecap='round'/>`;
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}'>${body}</svg>`);
}

// 近 7 天用量柱状图（最后一根是今天）
function sparkSvg(values, color, w, h) {
  const vals = values && values.length ? values : [null, null, null, null, null, null, null];
  const n = vals.length, gap = 3, bw = (w - gap * (n - 1)) / n;
  const max = Math.max(1, ...vals.map(v => v || 0));
  let body = '';
  vals.forEach((v, i) => {
    const bh = v ? Math.max(2, (v / max) * h) : 2;
    const op = v == null ? 0.15 : (i === n - 1 ? 1 : 0.55);
    body += `<rect x='${(i * (bw + gap)).toFixed(1)}' y='${(h - bh).toFixed(1)}' width='${bw.toFixed(1)}' height='${bh.toFixed(1)}' rx='${Math.min(2, bw / 2).toFixed(1)}' fill='${color}' fill-opacity='${op}'/>`;
  });
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}'>${body}</svg>`);
}

// 仪表卡：图标+名称 / 半圆仪表+百分比 / 数值
function gaugeCard(icon, color, d, fallbackTitle, opt) {
  const o = opt || {};
  const data = d || { title: fallbackTitle, number: '--', unit: '', percent: 0 };
  const pct = data.percent > 0 ? Math.round(data.percent * 100) : 0;
  const gw = o.gw || 46;
  return glass([
    {
      type: 'stack', direction: 'row', alignItems: 'center', gap: 3,
      children: [
        { type: 'image', src: `sf-symbol:${icon}`, width: 10, height: 10, color },
        t(o.title || data.title || fallbackTitle, 9, 'medium', SUB, { minScale: 1 }),
      ],
    },
    {
      type: 'stack', direction: 'column', alignItems: 'center', gap: -3,
      children: [
        { type: 'image', src: gaugeSvg(data.percent, color, 64), width: gw, height: Math.round(gw * 38 / 64) },
        t(`${pct}%`, 9, 'bold', color, { minScale: 1 }),
      ],
    },
    {
      type: 'stack', direction: 'row', alignItems: 'end', gap: 2,
      children: [
        t(data.number, o.numSize || 15, 'bold', TXT, { minScale: 0.7 }),
        t(data.unit || '', 9, 'semibold', SUB, { minScale: 1 }),
      ],
    },
  ], { flex: 1, alignItems: 'center', gap: 2, padding: [7, 4], borderRadius: 16, ...(o.height ? { height: o.height } : {}) });
}

function ringValues(ds) {
  const o = ds.otherFlow || {};
  return [
    { pct: ds.flow.percent, color: C_FLOW },
    { pct: o.percent, color: C_OTHER },
    { pct: ds.voice.percent, color: C_VOICE },
  ];
}

/* ---------- 组件 ---------- */

function t(text, size, weight, color, extra) {
  return Object.assign({ type: 'text', text: String(text), font: { size, weight: weight || 'regular' }, textColor: color || TXT, maxLines: 1, minScale: 0.6 }, extra || {});
}

function header(title, ds, fromCache) {
  return {
    type: 'stack', direction: 'row', alignItems: 'center', gap: 4,
    children: [
      { type: 'image', src: 'sf-symbol:antenna.radiowaves.left.and.right', width: 12, height: 12, color: C_FLOW },
      t(title, 'footnote', 'semibold'),
      { type: 'spacer' },
      t(`${fromCache ? ((ds && ds.stale) || '缓存') + ' · ' : ''}更新 ${ds && ds.updatedAt ? fmtTime(ds.updatedAt) : '--'}`, 10, 'regular', SUB, { minScale: 1 }),
    ],
  };
}

// iOS 原版标题行（13px 图标 + 13 号标题）：ios 版式 medium/large 用它，dash 版式继续用 header()
function iosHeader(title, ds, fromCache) {
  return {
    type: 'stack', direction: 'row', alignItems: 'center', gap: 4,
    children: [
      { type: 'image', src: 'sf-symbol:antenna.radiowaves.left.and.right', width: 13, height: 13, color: C_FLOW },
      t(title, 13, 'semibold', null, { minScale: 1 }),
      { type: 'spacer' },
      t(`${fromCache ? '缓存 · ' : ''}更新 ${ds && ds.updatedAt ? fmtTime(ds.updatedAt) : '--'}`, 10, 'regular', SUB, { minScale: 1 }),
    ],
  };
}

function feeBig(ds, ins, size) {
  const color = ins.lowFee ? WARN : TXT;
  return {
    type: 'stack', direction: 'column', alignItems: 'start', gap: 0,
    children: [
      t(ins.lowFee ? '话费不足' : '剩余话费', 'caption2', 'medium', ins.lowFee ? WARN : SUB),
      {
        type: 'stack', direction: 'row', alignItems: 'end', gap: 1,
        children: [
          t('¥', 'subheadline', 'semibold', ins.lowFee ? WARN : SUB),
          t(ds.fee.number, size || 28, 'bold', color),
        ],
      },
    ],
  };
}

function legendRow(icon, color, d, extra) {
  const data = d || { title: '', number: '--', unit: '' };
  return {
    type: 'stack', direction: 'row', alignItems: 'center', gap: 5,
    children: [
      { type: 'image', src: `sf-symbol:${icon}`, width: 12, height: 12, color },
      t(data.title, 'caption1', 'regular', SUB),
      { type: 'spacer' },
      t(data.number, 'subheadline', 'bold', TXT),
      t(data.unit ? ` ${data.unit}` : '', 'caption2', 'regular', SUB),
      ...(extra ? [t(`  ${extra}`, 'caption2', 'semibold', color)] : []),
    ],
  };
}

function pctText(d) { return d && d.percent > 0 ? `${Math.round(d.percent * 100)}%` : ''; }

function chip(icon, color, text) {
  return {
    type: 'stack', direction: 'row', alignItems: 'center', gap: 4, padding: [5, 8], borderRadius: 99,
    backgroundColor: GLASS,
    children: [
      { type: 'image', src: `sf-symbol:${icon}`, width: 11, height: 11, color },
      t(text, 'caption2', 'semibold', TXT),
    ],
  };
}

function glass(children, extra) {
  return Object.assign({ type: 'stack', direction: 'column', alignItems: 'start', gap: 6, padding: 12, borderRadius: 22, backgroundColor: GLASS, children }, extra || {});
}

/* ---------- 尺寸 ---------- */

function feeCard(ds, ins, size, extra) {
  const low = ins.lowFee;
  return glass([
    {
      type: 'stack', direction: 'row', alignItems: 'center', gap: 3,
      children: [
        { type: 'image', src: 'sf-symbol:yensign.circle.fill', width: 10, height: 10, color: low ? WARN : C_FEE },
        t(low ? '话费不足' : '剩余话费', 9, 'medium', low ? WARN : SUB, { minScale: 1 }),
      ],
    },
    { type: 'spacer' },
    {
      type: 'stack', direction: 'row', alignItems: 'end', gap: 1,
      children: [t('¥', 11, 'semibold', low ? WARN : SUB, { minScale: 1 }), t(ds.fee.number, size || 22, 'bold', low ? WARN : TXT, { minScale: 0.6 })],
    },
    t(`本月剩 ${ins.daysLeft} 天`, 9, 'medium', SUB, { minScale: 1 }),
    ...(extra && extra.alignItems === 'center' ? [{ type: 'spacer' }] : []),
  ], Object.assign({ gap: 2, padding: [7, 9], borderRadius: 16 }, extra || {}));
}

function statsStrip(ins, sparkW) {
  return glass([
    {
      type: 'stack', direction: 'row', alignItems: 'center', gap: 6,
      children: [
        { type: 'image', src: sparkSvg(ins.hist, C_FLOW, 70, 14), width: sparkW || 46, height: 11 },
        t(`今日 ${fmtMB(ins.todayMB)}`, 9, 'semibold', TXT, { minScale: 1 }),
        t(`日均可用 ${fmtMB(ins.dailyMB)}`, 9, 'medium', SUB, { minScale: 1 }),
        { type: 'spacer' },
        t(ins.forecast.text, 9, 'semibold', ins.forecast.color, { minScale: 0.8 }),
      ],
    },
  ], { padding: [6, 9], borderRadius: 12, gap: 0 });
}

function refresh30() { return new Date(Date.now() + 30 * 60 * 1000).toISOString(); }

function buildSmall(title, ds, fromCache, ctx) {
  const ins = insights(ctx, ds);
  return {
    type: 'widget', padding: 12, gap: 5, ...rootBg(ctx), refreshAfter: refresh30(),
    children: [
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 4,
        children: [
          { type: 'image', src: 'sf-symbol:antenna.radiowaves.left.and.right', width: 11, height: 11, color: C_FLOW },
          t(title, 'caption1', 'semibold'),
          { type: 'spacer' },
          t(`¥${ds.fee.number}`, 11, 'bold', ins.lowFee ? WARN : C_FEE, { minScale: 1 }),
        ],
      },
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 4, flex: 1,
        children: [
          {
            type: 'stack', direction: 'column', alignItems: 'start', gap: 0,
            children: [
              t('剩余流量', 9, 'medium', SUB, { minScale: 1 }),
              { type: 'stack', direction: 'row', alignItems: 'end', gap: 2, children: [t(ds.flow.number, 22, 'bold', TXT), t(ds.flow.unit || '', 9, 'semibold', SUB, { minScale: 1 })] },
            ],
          },
          { type: 'spacer' },
          {
            type: 'stack', direction: 'column', alignItems: 'center', gap: -3,
            children: [
              { type: 'image', src: gaugeSvg(ds.flow.percent, C_FLOW, 64), width: 42, height: 25 },
              t(pctText(ds.flow) || '0%', 9, 'bold', C_FLOW, { minScale: 1 }),
            ],
          },
        ],
      },
      {
        type: 'stack', direction: 'row', alignItems: 'end', gap: 5,
        children: [
          { type: 'image', src: sparkSvg(ins.hist, C_FLOW, 70, 14), width: 44, height: 11 },
          t(`今日 ${fmtMB(ins.todayMB)}`, 9, 'semibold', TXT, { minScale: 1 }),
        ],
      },
      t(`其他 ${ds.otherFlow ? ds.otherFlow.number + (ds.otherFlow.unit || '') : '--'} · 语音 ${ds.voice.number}${ds.voice.unit || ''}`, 9, 'medium', SUB, { minScale: 0.75 }),
      t(`日均可用 ${fmtMB(ins.dailyMB)} · ${ins.forecast.text}`, 9, 'semibold', ins.forecast.color, { minScale: 0.7 }),
    ],
  };
}

function buildMedium(title, ds, fromCache, ctx) {
  const ins = insights(ctx, ds);
  return {
    type: 'widget', padding: [10, 11], gap: 6, ...rootBg(ctx), refreshAfter: refresh30(),
    children: [
      header(title, ds, fromCache),
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 6, flex: 1,
        children: [
          feeCard(ds, ins, 21, { width: 84, height: 82, alignItems: 'center' }),
          gaugeCard('wifi', C_FLOW, ds.flow, '剩余流量', { height: 82 }),
          gaugeCard('globe.asia.australia.fill', C_OTHER, ds.otherFlow, '其他流量', { height: 82 }),
          gaugeCard('phone.fill', C_VOICE, ds.voice, '剩余语音', { height: 82 }),
        ],
      },
      statsStrip(ins, 40),
      ...(ds.planDebug ? [t(ds.planDebug, 'caption2', 'regular', SUB, { maxLines: 3 })] : []),
    ],
  };
}

function buildLarge(title, ds, fromCache, ctx) {
  const ins = insights(ctx, ds);
  const phone = getPhone(ctx);
  const masked = /^\d{11}$/.test(phone) ? `${phone.slice(0, 3)} **** ${phone.slice(7)}` : '';
  const labels = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000); labels.push(i === 0 ? '今' : `${d.getDate()}`); }
  return {
    type: 'widget', padding: 14, gap: 9, ...rootBg(ctx), refreshAfter: refresh30(),
    children: [
      header(title, ds, fromCache),
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 8,
        children: [
          feeCard(ds, ins, 30, { flex: 1, height: 74, padding: [9, 12] }),
          glass([
            t('当前号码', 9, 'medium', SUB, { minScale: 1 }),
            t(masked || '--', 13, 'semibold', TXT, { family: 'Menlo', minScale: 0.7 }),
            { type: 'spacer' },
            t(ins.forecast.text, 10, 'semibold', ins.forecast.color, { minScale: 0.7 }),
          ], { flex: 1, height: 74, gap: 2, padding: [9, 12], borderRadius: 16 }),
        ],
      },
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 8,
        children: [
          gaugeCard('wifi', C_FLOW, ds.flow, '剩余流量', { gw: 62, numSize: 18 }),
          gaugeCard('globe.asia.australia.fill', C_OTHER, ds.otherFlow, '其他流量', { gw: 62, numSize: 18 }),
          gaugeCard('phone.fill', C_VOICE, ds.voice, '剩余语音', { gw: 62, numSize: 18 }),
        ],
      },
      glass([
        {
          type: 'stack', direction: 'row', alignItems: 'center', gap: 4,
          children: [
            { type: 'image', src: 'sf-symbol:chart.bar.fill', width: 10, height: 10, color: C_FLOW },
            t('近 7 天流量', 10, 'semibold', TXT, { minScale: 1 }),
            { type: 'spacer' },
            t(`今日 ${fmtMB(ins.todayMB)} · 日均可用 ${fmtMB(ins.dailyMB)}`, 9, 'medium', SUB, { minScale: 0.8 }),
          ],
        },
        { type: 'image', src: sparkSvg(ins.hist, C_FLOW, 290, 40), width: 290, height: 40 },
        {
          type: 'stack', direction: 'row', alignItems: 'center', gap: 0,
          children: labels.map(l => ({ type: 'stack', direction: 'row', flex: 1, children: [{ type: 'spacer' }, t(l, 8, 'medium', SUB, { minScale: 1 }), { type: 'spacer' }] })),
        },
      ], { gap: 5, padding: [9, 12], borderRadius: 16 }),
      { type: 'spacer' },
      ...(ds.planDebug ? [t(ds.planDebug, 'caption2', 'regular', SUB, { maxLines: 3 })] : []),
    ],
  };
}

function buildLockScreen(title, ds, family, ctx) {
  const ins = insights(ctx, ds);
  if (family === 'accessoryInline') {
    return { type: 'widget', children: [{ type: 'text', text: `¥${ds.fee.number} · ${ds.flow.number}${ds.flow.unit} · ${ds.voice.number}分`, maxLines: 1, minScale: 0.6 }] };
  }
  if (family === 'accessoryCircular') {
    const hasPct = ds.flow && ds.flow.percent > 0;
    return {
      type: 'widget', padding: 8, backgroundImage: ringSvg(hasPct ? ds.flow.percent : 0, 60, 6),
      children: [
        { type: 'spacer' },
        {
          type: 'stack', direction: 'column', alignItems: 'center', gap: 0,
          children: hasPct
            ? [
              { type: 'image', src: 'sf-symbol:wifi', width: 10, height: 10 },
              { type: 'text', text: String(ds.flow.number), font: { size: 14, weight: 'bold' }, textAlign: 'center', maxLines: 1, minScale: 0.5 },
              { type: 'text', text: ds.flow.unit, font: { size: 9 }, textAlign: 'center', opacity: 0.7 },
            ]
            : [
              { type: 'text', text: '¥', font: { size: 9 }, textAlign: 'center', opacity: 0.7 },
              { type: 'text', text: ds.fee.number, font: { size: 14, weight: 'bold' }, textAlign: 'center', maxLines: 1, minScale: 0.5 },
            ],
        },
        { type: 'spacer' },
      ],
    };
  }
  return {
    type: 'widget', padding: [2, 4], gap: 2,
    children: [
      { type: 'text', text: `¥${ds.fee.number}${ins.lowFee ? ' · 话费不足' : ''}`, font: { size: 'footnote', weight: 'bold' }, maxLines: 1, minScale: 0.6 },
      { type: 'text', text: `流量 ${ds.flow.number} ${ds.flow.unit} · 语音 ${ds.voice.number}分`, font: { size: 'caption2', weight: 'semibold' }, maxLines: 1, minScale: 0.6 },
      { type: 'text', text: ins.todayMB != null ? `今日 ${fmtMB(ins.todayMB)} · 日均 ${fmtMB(ins.dailyMB)}` : `还剩 ${ins.daysLeft} 天`, font: { size: 'caption2' }, opacity: 0.7, maxLines: 1, minScale: 0.6 },
    ],
  };
}

function buildError(title, message, extra, ctx) {
  const children = [
    t(title, 'footnote', 'semibold'),
    { type: 'spacer' },
    { type: 'image', src: 'sf-symbol:exclamationmark.triangle.fill', width: 22, height: 22, color: C_FEE },
    t(message, 'caption1', 'medium', TXT, { maxLines: 4, minScale: 0.7 }),
  ];
  if (extra) children.push(t(extra, 'caption2', 'regular', SUB, { maxLines: 3 }));
  children.push({ type: 'spacer' });
  return { type: 'widget', padding: 14, gap: 6, ...rootBg(ctx), children };
}

/* ==================== iOS 版渲染器（从 china-mobile-hark-ios.js 并入） ==================== */
// 与仪表盘版共用同一份数据层（loadData/parseMobile/抓取/保活）；CM_LAYOUT=ios 时走这组渲染器

function iosAlignedRow(icon, color, d, extra) {
  const data = d || { title: '', number: '--', unit: '' };
  const box = (w, child, right) => ({ type: 'stack', direction: 'row', alignItems: 'center', width: w, children: right ? [{ type: 'spacer' }, child] : [child, { type: 'spacer' }] });
  return {
    type: 'stack', direction: 'row', alignItems: 'center', gap: 4,
    children: [
      { type: 'image', src: `sf-symbol:${icon}`, width: 12, height: 12, color },
      t(data.title, 'caption1', 'regular', SUB, { minScale: 0.8 }),
      { type: 'spacer' },
      box(48, t(data.number, 'subheadline', 'bold', TXT, { minScale: 0.7 }), true),
      box(22, t(data.unit || '', 'caption2', 'regular', SUB, { minScale: 0.8 }), false),
      box(30, t(extra || '', 'caption2', 'semibold', color, { minScale: 0.8 }), true),
    ],
  };
}


function iosMiniRow(icon, color, d, barW, label) {
  const data = d || { title: '', number: '--', unit: '', percent: 0 };
  return {
    type: 'stack', direction: 'column', alignItems: 'start', gap: 2,
    children: [
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 4,
        children: [
          { type: 'image', src: `sf-symbol:${icon}`, width: 10, height: 10, color },
          ...(label ? [t(label, 9, 'medium', SUB, { minScale: 1 })] : []),
          { type: 'spacer' },
          t(data.number, 11, 'bold', TXT, { minScale: 0.8 }),
          t(data.unit ? ` ${data.unit}` : '', 9, 'regular', SUB, { minScale: 1 }),
          ...(pctText(data) ? [t(` ${pctText(data)}`, 9, 'semibold', color, { minScale: 1 })] : []),
        ],
      },
      { type: 'image', src: barSvg(data.percent, color, barW + 2, 3), width: barW, height: 3 },
    ],
  };
}


function iosBuildSmall(title, ds, fromCache, ctx) {
  const ins = insights(ctx, ds);
  const other = ds.otherFlow || { title: '其他流量', number: '--', unit: '', percent: 0 };
  return {
    type: 'widget', padding: [12, 13], gap: 4, ...rootBg(ctx),
    refreshAfter: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    children: [
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 4,
        children: [
          { type: 'image', src: 'sf-symbol:antenna.radiowaves.left.and.right', width: 12, height: 12, color: C_FLOW },
          t(title, 'caption1', 'semibold'),
          { type: 'spacer' },
          t(ds.updatedAt ? fmtTime(ds.updatedAt).slice(-5) : '--', 9, 'regular', SUB, { minScale: 1 }),
        ],
      },
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 9,
        children: [
          { type: 'image', src: ringsSvg(ringValues(ds), 120, 15, 3), width: 56, height: 56 },
          {
            type: 'stack', direction: 'column', alignItems: 'start', gap: 1,
            children: [
              feeBig(ds, ins, 24),
              t(ins.todayMB != null ? `今日 ${fmtMB(ins.todayMB)}` : `本月剩 ${ins.daysLeft} 天`, 10, 'semibold', C_FLOW, { minScale: 0.8 }),
            ],
          },
          { type: 'spacer' },
        ],
      },
      { type: 'spacer' },
      iosMiniRow('wifi', C_FLOW, ds.flow, 144, '通用'),
      iosMiniRow('globe.asia.australia.fill', C_OTHER, other, 144, '其他'),
      iosMiniRow('phone.fill', C_VOICE, ds.voice, 144, '语音'),
    ],
  };
}


function iosBuildMedium(title, ds, fromCache, ctx) {
  const ins = insights(ctx, ds);
  const other = ds.otherFlow || { title: '其他流量', number: '--', unit: '' };
  return {
    type: 'widget', padding: [12, 14], gap: 8, ...rootBg(ctx),
    refreshAfter: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    children: [
      iosHeader(title, ds, fromCache),
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 12, flex: 1,
        children: [
          {
            type: 'stack', direction: 'column', alignItems: 'center', gap: 4, width: 96,
            children: [
              { type: 'image', src: ringsSvg(ringValues(ds), 120, 13, 3), width: 70, height: 70 },
              feeBig(ds, ins, 20),
            ],
          },
          glass([
            iosAlignedRow('wifi', C_FLOW, ds.flow, pctText(ds.flow)),
            iosAlignedRow('globe.asia.australia.fill', C_OTHER, other, pctText(other)),
            iosAlignedRow('phone.fill', C_VOICE, ds.voice, pctText(ds.voice)),
            {
              type: 'stack', direction: 'row', alignItems: 'center', gap: 5,
              children: [
                { type: 'image', src: sparkSvg(ins.hist, C_FLOW, 70, 14), width: 34, height: 10 },
                t(ins.todayMB != null ? `今日 ${fmtMB(ins.todayMB)}` : `本月剩 ${ins.daysLeft} 天`, 9, 'semibold', TXT, { minScale: 0.8 }),
                { type: 'spacer' },
                t(ins.forecast.text, 9, 'semibold', ins.forecast.color, { minScale: 0.8 }),
              ],
            },
          ], { flex: 1, gap: 7, padding: [10, 12] }),
        ],
      },
      ...(ds.planDebug ? [t(ds.planDebug, 'caption2', 'regular', SUB, { maxLines: 3 })] : []),
    ],
  };
}


function iosBuildLarge(title, ds, fromCache, ctx) {
  const ins = insights(ctx, ds);
  const other = ds.otherFlow || { title: '其他流量', number: '--', unit: '', percent: 0 };
  const phone = getPhone(ctx);
  const masked = /^\d{11}$/.test(phone) ? `${phone.slice(0, 3)} **** ${phone.slice(7)}` : '';
  const meter = (icon, color, d) => glass([
    {
      type: 'stack', direction: 'row', alignItems: 'center', gap: 5,
      children: [
        { type: 'image', src: `sf-symbol:${icon}`, width: 13, height: 13, color },
        t(d.title, 'caption1', 'regular', SUB),
        { type: 'spacer' },
        t(d.number, 17, 'bold', TXT),
        t(d.unit ? ` ${d.unit}` : '', 'caption2', 'regular', SUB),
        ...(pctText(d) ? [t(`  ${pctText(d)}`, 'caption1', 'semibold', color)] : []),
      ],
    },
    { type: 'image', src: barSvg(d.percent, color, 300, 6), width: 296, height: 6 },
  ], { gap: 6, padding: [8, 12], borderRadius: 16, height: 48 });
  return {
    type: 'widget', padding: [13, 15], gap: 7, ...rootBg(ctx),
    refreshAfter: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    children: [
      iosHeader(title, ds, fromCache),
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 14, height: 80,
        children: [
          { type: 'image', src: ringsSvg(ringValues(ds), 140, 15, 3), width: 78, height: 78 },
          {
            type: 'stack', direction: 'column', alignItems: 'start', gap: 3,
            children: [
              feeBig(ds, ins, 30),
              ...(masked ? [t(masked, 'caption2', 'medium', SUB, { family: 'Menlo' })] : []),
              t(`本月还剩 ${ins.daysLeft} 天${ins.dailyMB != null ? ` · 日均可用 ${fmtMB(ins.dailyMB)}` : ''}`, 'caption2', 'semibold', C_FLOW),
            ],
          },
          { type: 'spacer' },
        ],
      },
      meter('wifi', C_FLOW, ds.flow),
      meter('globe.asia.australia.fill', C_OTHER, other),
      meter('phone.fill', C_VOICE, ds.voice),
      glass([
        {
          type: 'stack', direction: 'row', alignItems: 'center', gap: 8,
          children: [
            { type: 'image', src: sparkSvg(ins.hist, C_FLOW, 140, 20), width: 120, height: 16 },
            t(`今日 ${ins.todayMB != null ? fmtMB(ins.todayMB) : '--'}`, 'caption1', 'bold', TXT),
            { type: 'spacer' },
            t(ins.forecast.text, 'caption2', 'semibold', ins.forecast.color),
          ],
        },
      ], { padding: [9, 12], borderRadius: 16, gap: 0, height: 36 }),
      { type: 'spacer' },
      ...(ds.planDebug ? [t(ds.planDebug, 'caption2', 'regular', SUB, { maxLines: 3 })] : []),
    ],
  };
}
// ================= 适配层：联通数据 → 移动透明版布局 ds =================
// 把 moyuzaime 联通抓取/重放（loadUnicomData）的输出，映射成
// 中国移动透明版布局消费的 ds 结构（parseMobile 的约定）。
// 映射（移动布局的原生语义）：
//   ds.flow      = 通用流量（general，移动布局的主流量卡）
//   ds.otherFlow = 定向流量（total - general，移动布局的「其他流量」卡）
//   ds.voice     = 语音（分钟）
//   ds.fee       = 话费
// 这样 flow + otherFlow = 总流量，insights() 的今日用量 / 日均可用 /
// 用完预测才算得对（与移动原版一致）。
// 通用/定向分项来自 unicom_flowdetail（余量明细快照，6 小时内有效）；
// 没有明细时回退到首页大球的总口径（与联通原版 handleWidget 同款回退）。
// 显示开关（只改卡片上显示的数字，不改仪表百分比）：
//   通用关 + 定向开 → 主卡显示定向，otherFlow 留空
//   通用开 + 定向关 → 主卡显示通用，otherFlow 留空
//   两者都关 → 主卡显示总流量（与电信版同款分支）
//   CU_SHOW_USED_FLOW=true → 主卡/其他卡显示已用，insights 自动隐藏今日/预测
//   （移动原版 parseMobile 同款行为：percent 始终是剩余占比）
// 仪表百分比一律是剩余占比（0..1），不受已用/剩余开关影响。
// 单位：联通 plan 的 total/used/remain 原始值已是 KB、语音是分钟，直接使用，
// 余量明细里的 MB 先 ×1024 换成 KB 再算。
function _safeN(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function buildUnicomCMDataSource(ctx, uDs, fromCache, authFailed) {
  const showGeneral = ctx.env.CU_SHOW_GENERAL_FLOW !== 'false';
  const showDirectional = ctx.env.CU_SHOW_DIRECTIONAL_FLOW !== 'false';
  const showUsedFlow = ctx.env.CU_SHOW_USED_FLOW === 'true';
  const showUsedVoice = ctx.env.CU_SHOW_USED_VOICE === 'true';

  const plan = (uDs && uDs.plan) || {};
  const tTotal = _safeN(plan.total), tUsed = _safeN(plan.used), tRemain = _safeN(plan.remain);

  // 余量明细（通用/定向分项）：6 小时内有效，过期回落到大球总口径。
  let fd = null;
  try { fd = ctx.storage.getJSON('unicom_flowdetail') || null; } catch (_) {}
  const fdFresh = Boolean(fd) && Boolean(fd.ts) && Date.now() - Number(fd.ts) < 6 * 60 * 60 * 1000;
  const toKB = (mb) => (mb == null ? null : Math.round(Number(mb) * 1024));
  let gTotal = 0, gUsed = 0, gRemain = 0, dTotal = 0, dUsed = 0, dRemain = 0;
  let hasGeneral = false, hasDirectional = false;
  if (fdFresh && fd.general) {
    const g = fd.general;
    gTotal = _safeN(toKB(g.totalMB)); gUsed = _safeN(toKB(g.usedMB)); gRemain = _safeN(toKB(g.remainMB));
    hasGeneral = gTotal > 0 || gRemain > 0 || gUsed > 0;
  }
  if (fdFresh && fd.directional) {
    const d = fd.directional;
    dTotal = _safeN(toKB(d.totalMB)); dUsed = _safeN(toKB(d.usedMB)); dRemain = _safeN(toKB(d.remainMB));
    hasDirectional = dTotal > 0 || dRemain > 0 || dUsed > 0;
  }
  // 有通用明细但无独立定向明细时，定向 = 总口径 − 通用。
  if (hasGeneral && !hasDirectional) {
    dTotal = Math.max(0, tTotal - gTotal);
    dUsed = Math.max(0, tUsed - gUsed);
    dRemain = Math.max(0, tRemain - gRemain);
    hasDirectional = dTotal > 0 || dRemain > 0 || dUsed > 0;
  }

  const frac = (remain, total) => (total > 0 ? Math.max(0, Math.min(1, remain / total)) : 0);

  // 主卡口径（数字 + 总量 + 剩余占比），分支与电信版完全一致。
  let main;
  if (!showGeneral && showDirectional) {
    main = hasDirectional ? { remain: dRemain, used: dUsed, total: dTotal } : { remain: tRemain, used: tUsed, total: tTotal };
  } else if (showGeneral || !showDirectional) {
    main = hasGeneral ? { remain: gRemain, used: gUsed, total: gTotal } : { remain: tRemain, used: tUsed, total: tTotal };
  } else {
    main = { remain: tRemain, used: tUsed, total: tTotal };
  }
  const mainShown = showUsedFlow ? main.used : main.remain;
  const mainFmt = formatFlow(mainShown);
  const flow = {
    title: showUsedFlow ? '已用流量' : '剩余流量',
    number: mainFmt.number,
    unit: mainFmt.unit,
    percent: frac(main.remain, main.total),
    color: '#0A84FF',
    total: main.total > 0 ? formatFlow(main.total) : null,
  };

  // 其他卡：定向（仅当通用与定向同时显示、且有独立定向值时才有）
  let otherFlow = { title: '其他流量', number: '--', unit: '', percent: 0, color: '#5AC8FA' };
  if (showGeneral && showDirectional && hasDirectional && dTotal > 0) {
    const oShown = showUsedFlow ? dUsed : dRemain;
    const oFmt = formatFlow(oShown);
    otherFlow = { title: '其他流量', number: oFmt.number, unit: oFmt.unit, percent: frac(dRemain, dTotal), color: '#5AC8FA' };
  }

  // 语音（分钟，总口径；percent 始终是剩余占比；明细里的 voiceRemain 更准时优先用）
  let vTotal = _safeN(plan.voiceTotal), vUsed = _safeN(plan.voiceUsed), vRemain = _safeN(plan.voiceRemain);
  if (fdFresh && fd.voiceRemain != null) vRemain = _safeN(fd.voiceRemain);
  const voice = {
    title: showUsedVoice ? '已用语音' : '剩余语音',
    number: String(showUsedVoice ? vUsed : vRemain),
    unit: '分钟',
    percent: frac(vRemain, vTotal),
    color: '#30D158',
  };

  // 话费：账户余额（unicom_account）比大球口径更准，有就用它（联通原版同款）。
  let fee = { title: '剩余话费', number: ((uDs && uDs.fee && uDs.fee.number) || '0.00'), unit: '元' };
  try {
    const acct = ctx.storage.getJSON('unicom_account') || null;
    if (acct && acct.balance != null) {
      fee = { title: '账户余额', number: Number(acct.balance).toFixed(2), unit: '元' };
    }
  } catch (_) {}

  const ds = {
    fee, flow, otherFlow, voice,
    updatedAt: (uDs && uDs.updatedAt) || Date.now(),
  };
  if (fromCache) ds.stale = authFailed ? '登录过期' : '缓存';
  return ds;
}

// 联通缓存重建：loadUnicomData 无新数据时，用上次存下的 CM 版 ds 兜底。
function buildFromCuCache(ctx, authFailed) {
  try {
    const cmCached = ctx.storage.getJSON('cu_cm_datasource');
    if (cmCached && cmCached.flow && cmCached.flow.number !== '--') {
      cmCached.stale = authFailed ? '登录过期' : '缓存';
      return cmCached;
    }
  } catch (_) {}
  return null;
}

async function loadData(ctx) {
  const r = await loadUnicomData(ctx);
  if (!r.configured) {
    return { configured: false, reason: 'capture', debug: false };
  }
  if (r.data) {
    // 把抓取到的手机号桥接到 CM 的 getPhone 回退键（cm_phone_backup），
    // 大号布局才能显示掩码号码；env 里没有手机号变量，联通手机号只来自抓取。
    try {
      const ph = String(ctx.storage.get('unicom_phone') || '').trim();
      if (/^1\d{10}$/.test(ph)) ctx.storage.set('cm_phone_backup', ph);
    } catch (_) {}
    const authFailed = !!(r.error && r.error.kind === 'auth');
    const ds = buildUnicomCMDataSource(ctx, r.data, r.fromCache, authFailed);
    if (!r.fromCache) {
      try { ctx.storage.setJSON('cu_cm_datasource', ds); } catch (_) {}
    }
    return { configured: true, ds, fromCache: r.fromCache, debug: false };
  }
  const authFailed = !!(r.error && r.error.kind === 'auth');
  const rebuilt = buildFromCuCache(ctx, authFailed);
  if (rebuilt) {
    return { configured: true, ds: rebuilt, fromCache: true, debug: false,
             error: r.error ? String(r.error.message || r.error) : '', stage: authFailed ? 'session' : '', authFailed };
  }
  return { configured: true, ds: null, fromCache: false, debug: false,
           error: r.error ? String(r.error.message || r.error) : '查询失败',
           stage: authFailed ? 'session' : '', authFailed };
}

/* ==================== 小组件（generic） ==================== */

async function handleWidget(ctx) {
  const title = (ctx.env.CU_TITLE || '中国联通').trim() || '中国联通';
  const r = await loadData(ctx);

  if (!r.configured) {
    return buildError(title, '请打开中国联通 App 或微信小程序查询一次，让组件抓取凭据', '', ctx);
  }
  if (!r.ds) {
    const hint = r.authFailed
      ? '登录状态已失效，请重新打开中国联通 App 或微信小程序查询一次，让组件重新抓取凭据'
      : '数据获取失败，请刷新微信联通小程序流量查询或打开联通 App 重试';
    return buildError(title, hint, r.error ? `错误: ${r.error}` : '', ctx);
  }

  const family = ctx.widgetFamily || 'systemSmall';
  const layout = String((ctx.env || {}).CM_LAYOUT || 'dash').trim().toLowerCase();
  const ios = layout === 'ios';
  if (family === 'systemLarge' || family === 'systemExtraLarge') return ios ? iosBuildLarge(title, r.ds, r.fromCache, ctx) : buildLarge(title, r.ds, r.fromCache, ctx);
  if (family === 'systemMedium') return ios ? iosBuildMedium(title, r.ds, r.fromCache, ctx) : buildMedium(title, r.ds, r.fromCache, ctx);
  if (family.startsWith('accessory')) return buildLockScreen(title, r.ds, family, ctx);
  return ios ? iosBuildSmall(title, r.ds, r.fromCache, ctx) : buildSmall(title, r.ds, r.fromCache, ctx);
}

/* ==================== 入口：抓取 + 小组件 ==================== */
// http_response → 小程序响应解析；http_request → App/小程序凭据抓取；
// 没有 widgetFamily（手动运行）→ 强制刷新一次；否则渲染小组件。

export default async function (ctx) {
  if (ctx && ctx.response) { await handleMiniResponse(ctx); return; }
  if (ctx && ctx.request && ctx.request.url) { await handleCapture(ctx); return; }
  if (ctx && !ctx.widgetFamily) { await handleManualRefresh(ctx); return; }
  return handleWidget(ctx);
}
