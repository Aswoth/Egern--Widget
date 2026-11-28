// 中国电信（移动透明版）
// 数据：IBL3ND 中国电信小组件（CT_Widget.js）——RSA 登录 appgologin.189.cn + qryImportantData
// 布局：中国移动透明版（china-mobile-hark-merged-glass.js，Hark v23 液态玻璃风格）
//       ——dash / ios 两种版式 × glass / classic 两种样式，布局段逐字节原样抽取，
//       classic 模式背景与原版一致（根 backgroundGradient: bg()，内层卡片 GLASS），
//       只在 glass 模式下去掉根背景做透明。移动的数据层（抓取/加解密/接口查询）已全部去掉。
// 适配：电信登录/查询结果 → 移动布局的 ds 结构（见 buildTelecomCMDataSource）。
// 流量单位：电信接口返回的流量原始值是 KB、语音是分钟，直接使用，不换算。
// 环境变量：CT_PHONE / CT_PASSWORD / CT_DEVICE_ID / CT_SHOW_GENERAL_FLOW /
//   CT_SHOW_DIRECTIONAL_FLOW / CT_SHOW_USED_FLOW / CT_SHOW_USED_VOICE / CT_TITLE /
//   CM_LAYOUT（dash/ios）/ CM_WIDGET_STYLE（glass/classic）
//   （CM_LAYOUT / CM_WIDGET_STYLE 与移动版同名，布局代码逐字节原样；
//    YAML 里 ctLayout / ctWidgetStyle 同时映射到 CM_* 与 CT_* 两份 env，
//    两种写法都认。）

'use strict';

// ============ 电信数据层（IBL3ND，CT_Widget.js） ============
const URLS = {
  login: 'https://appgologin.189.cn:9031/login/client/userLoginNormal',
  query: 'https://appfuwu.189.cn:9021/query/qryImportantData',
};

const FLOW_COLOR = '#FF6620';
const VOICE_COLOR = '#78C100';

function ctFormatFlow(flow) {
  const remain = flow / 1024;
  if (remain < 1024) {
    return { amount: remain.toFixed(2), unit: 'MB' };
  }
  return { amount: (remain / 1024).toFixed(2), unit: 'GB' };
}

function _safeN(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function transNumber(str, encode = true) {
  return [...String(str || '')].map((c) => String.fromCharCode((c.charCodeAt(0) + (encode ? 2 : -2)) & 0xffff)).join('');
}

function getBeijingTimestamp() {
  const bjDate = new Date(Date.now() + 8 * 3600 * 1000);
  const yyyy = String(bjDate.getFullYear());
  const MM = String(bjDate.getMonth() + 1).padStart(2, '0');
  const dd = String(bjDate.getDate()).padStart(2, '0');
  const HH = String(bjDate.getHours()).padStart(2, '0');
  const mm = String(bjDate.getMinutes()).padStart(2, '0');
  const ss = String(bjDate.getSeconds()).padStart(2, '0');
  return `${yyyy}${MM}${dd}${HH}${mm}${ss}`;
}

const RSA_MOD_HEX = 'c190b4f5e53855833ebf34e97ab3c18d3e87dd5b359b0a45a791a026eced8b8e43351fb74cbf3922a9dc54d368da9864472d7fd934c0971e73dc5bfb0386214204dd7ca85bf2f20e9561bf50b6ba08d3d7b5efab3e642b62bfb85b8a7d9c0938fdf625299c4968666d7d9701f2a3af6ee543223cca6ad3f5ca04ef2562137f83';

function _modPow(base, exp, mod) {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function _base64Encode(bytes) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += chars[b0 >> 2];
    out += chars[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? chars[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? chars[b2 & 63] : '=';
  }
  return out;
}

function rsaEncrypt(text) {
  const data = [...String(text)].map((c) => c.charCodeAt(0) & 0xff);
  const k = 128;
  if (data.length > k - 11) throw new Error('RSA 明文过长');
  const psLen = k - data.length - 3;
  const ps = [];
  while (ps.length < psLen) {
    const r = Math.floor(Math.random() * 255) + 1;
    if (r !== 0) ps.push(r);
  }
  const em = [0x00, 0x02, ...ps, 0x00, ...data];
  let hex = '';
  for (const b of em) hex += b.toString(16).padStart(2, '0');
  const m = BigInt('0x' + RSA_MOD_HEX);
  const c = _modPow(BigInt('0x' + hex), 65537n, m);
  let cHex = c.toString(16).padStart(256, '0');
  const out = [];
  for (let i = 0; i < cHex.length; i += 2) out.push(parseInt(cHex.slice(i, i + 2), 16));
  return _base64Encode(out);
}

async function _postJson(ctx, url, bodyObj) {
  let resp;
  try {
    resp = await ctx.http.post(url, {
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(bodyObj),
      timeout: 15000,
    });
  } catch (e) {
    const err = new Error(`network: ${url}`);
    err.transient = true;
    throw err;
  }
  if (!resp || resp.status !== 200) {
    const err = new Error(`HTTP ${resp ? resp.status : 'no-response'}: ${url}`);
    err.transient = true;
    throw err;
  }
  try {
    return await resp.json();
  } catch (e) {
    const err = new Error(`not-json: ${url}`);
    err.transient = true;
    throw err;
  }
}

function _getAccount(ctx) {
  const env = ctx.env || {};
  const phone = String(env.CT_PHONE || '').trim();
  const password = String(env.CT_PASSWORD || env.CT_SERVICE_PASSWORD || '').trim();
  const deviceId = String(env.CT_DEVICE_ID || '').trim();
  return { phone, password, deviceId };
}

async function telecomLogin(ctx, account) {
  const { phone, password, deviceId } = account;
  const uuid = String(Math.floor(Math.random() * 9e15 + 1e15));
  const ts = getBeijingTimestamp();
  const encryptText = `iPhone 14 15.4.0${deviceId || uuid.slice(0, 12)}${phone}${ts}${password}0$$$0.`;
  const encrypted = rsaEncrypt(encryptText);
  const loginBody = {
    content: {
      fieldData: {
        loginType: '4',
        accountType: '',
        isChinatelecom: '',
        systemVersion: '15.4.0',
        deviceUid: uuid.slice(0, 16),
        phoneNum: transNumber(phone),
        authentication: transNumber(password),
        androidId: deviceId ? transNumber(deviceId) : '',
        loginAuthCipherAsymmertric: encrypted,
      },
      attach: 'iPhone',
    },
    headerInfos: {
      code: 'userLoginNormal',
      clientType: '#12.2.0#channel50#iPhone 14 Pro#',
      timestamp: ts,
      shopId: '20002',
      source: '110003',
      sourcePassword: 'Sid98s',
      userLoginName: transNumber(phone),
    },
  };
  const loginData = await _postJson(ctx, URLS.login, loginBody);
  const rd = loginData && loginData.responseData;
  if (!rd || rd.resultCode !== '0000') {
    const err = new Error(`登录失败 ${rd ? rd.resultCode : 'no-response'}：${(rd && rd.resultDesc) || '未知错误'}`);
    err.resultCode = rd ? rd.resultCode : '';
    err.resultDesc = rd ? rd.resultDesc : '';
    throw err;
  }
  const { token, cityCode, provinceCode } = rd.data.loginSuccessResult || {};
  if (!token) throw new Error('登录成功但未返回 token');
  try {
    ctx.storage.set('ct_app_token', token);
    ctx.storage.set('ct_app_city', String(cityCode || ''));
    ctx.storage.set('ct_app_province', String(provinceCode || ''));
    ctx.storage.set('ct_app_token_ts', String(Date.now()));
  } catch (_) {}
  return { token, cityCode, provinceCode };
}

async function fetchImportantData(ctx, account, token, cityCode, provinceCode) {
  const ts = getBeijingTimestamp();
  const dataBody = {
    content: {
      fieldData: {
        provinceCode,
        cityCode,
        shopId: '20002',
        isChinatelecom: '0',
        account: transNumber(account.phone),
      },
      attach: 'test',
    },
    headerInfos: {
      code: 'qryImportantData',
      clientType: '#12.2.0#channel50#iPhone 14 Pro#',
      timestamp: ts,
      shopId: '20002',
      source: '110003',
      sourcePassword: 'Sid98s',
      userLoginName: transNumber(account.phone),
      token,
    },
  };
  const dataResp = await _postJson(ctx, URLS.query, dataBody);
  if (!dataResp || !dataResp.responseData) {
    const err = new Error(`查数失败：${(dataResp && dataResp.headerInfos && dataResp.headerInfos.reason) || 'Token 失效'}`);
    err.authFailed = true;
    throw err;
  }
  return dataResp.responseData.data;
}

function parseImportantData(apiData, opts) {
  const { showUsedFlow, showGeneralFlow, showDirectionalFlow } = opts;
  const balance = _safeN(apiData && apiData.balanceInfo && apiData.balanceInfo.indexBalanceDataInfo && apiData.balanceInfo.indexBalanceDataInfo.balance);
  const feeBalance = balance !== 0 ? balance : _safeN(apiData && apiData.balance);
  const fee = { title: '剩余话费', number: feeBalance.toFixed(2), unit: '元' };

  const common = (apiData && apiData.flowInfo && apiData.flowInfo.commonFlow) || {};
  const total = (apiData && apiData.flowInfo && apiData.flowInfo.totalAmount) || {};
  const gUsed = _safeN(common.used), gBalance = _safeN(common.balance);
  // 接口 commonFlow 常不给 total（只给 used/balance），缺了就用 used+balance 补，
  // 否则通用总量为 0、百分比恒为 0%（与总口径 tTotal 的兜底同款写法）。
  const gTotal = _safeN(common.total !== undefined ? common.total : (gUsed + gBalance));
  const tUsed = _safeN(total.used !== undefined ? total.used : apiData.usedFlux), tBalance = _safeN(total.balance), tTotal = _safeN(total.total !== undefined ? total.total : (tUsed + tBalance));
  const hasCommon = common.used !== undefined || common.balance !== undefined || common.total !== undefined;
  let used, balanceFlow, totalFlow;
  let flowScope = '流量';
  if (!hasCommon) {
    used = tUsed; balanceFlow = tBalance; totalFlow = tTotal;
  } else if (showGeneralFlow && showDirectionalFlow) {
    used = tUsed; balanceFlow = tBalance; totalFlow = tTotal;
  } else if (showGeneralFlow && !showDirectionalFlow) {
    used = gUsed; balanceFlow = gBalance; totalFlow = gTotal;
    flowScope = '通用流量';
  } else if (!showGeneralFlow && showDirectionalFlow) {
    used = Math.max(0, tUsed - gUsed); balanceFlow = Math.max(0, tBalance - gBalance); totalFlow = Math.max(0, tTotal - gTotal);
    flowScope = '定向流量';
  } else {
    used = tUsed; balanceFlow = tBalance; totalFlow = tTotal;
  }
  const balanceFmt = ctFormatFlow(balanceFlow);
  const usedFmt = ctFormatFlow(used);
  const flow = {
    title: '剩余' + flowScope,
    number: balanceFmt.amount,
    unit: balanceFmt.unit,
    percent: +(totalFlow > 0 ? ((balanceFlow / totalFlow) * 100).toFixed(2) : '0'),
    color: FLOW_COLOR,
  };
  if (showUsedFlow) {
    flow.title = '已用' + flowScope;
    flow.number = usedFmt.amount;
    flow.unit = usedFmt.unit;
  }

  const voiceInfo = (apiData && apiData.voiceInfo && apiData.voiceInfo.voiceDataInfo) || {};
  const vTotal = _safeN(voiceInfo.total !== undefined ? voiceInfo.total : apiData.totalVoice);
  const vUsed = _safeN(voiceInfo.used !== undefined ? voiceInfo.used : apiData.usedVoice);
  const vBalance = _safeN(voiceInfo.balance !== undefined ? voiceInfo.balance : (vTotal - vUsed));
  const showUsedVoice = opts.showUsedVoice;
  const voice = {
    title: showUsedVoice ? '已用语音' : '剩余语音',
    number: `${showUsedVoice ? vUsed : vBalance}`,
    unit: '分钟',
    percent: +(vTotal > 0 ? (((showUsedVoice ? vUsed : vBalance) / vTotal) * 100).toFixed(2) : '0'),
    color: VOICE_COLOR,
  };

  // 总口径原始值（流量 KB / 语音分钟），供布局的 gauge 使用，
  // 不受显示开关（通用/定向、已用/剩余）影响。
  const totals = {
    flowTotalKB: tTotal,
    flowUsedKB: tUsed,
    flowRemainKB: tBalance,
    voiceTotal: vTotal,
    voiceUsed: vUsed,
    voiceRemain: vBalance,
  };
  // 通用流量原始值（KB），供移动布局的「通用流量」主卡与「其他流量」
  // （定向 = 总口径 - 通用）使用；接口无通用明细时全为 0，适配层回退到总口径。
  const general = {
    flowTotalKB: gTotal,
    flowUsedKB: gUsed,
    flowRemainKB: gBalance,
  };
  return { fee, flow, voice, updatedAt: Date.now(), totals, general };
}

function _notifyAuthFailedOnce(ctx, account, err) {
  try {
    const marker = `${account.phone.slice(-4)}:${err && err.resultCode ? err.resultCode : (err && err.message) || ''}`;
    if (ctx.storage.get('ct_auth_notified') === marker) return;
    ctx.storage.set('ct_auth_notified', marker);
    ctx.notify({ title: '中国电信', body: `登录失败：${(err && err.message) || '请检查手机号/服务密码/设备ID'}` });
  } catch (_) {}
}

function _clearAuthFlag(ctx) {
  try { ctx.storage.delete('ct_auth_notified'); } catch (_) {}
}

async function loadTelecomData(ctx) {
  const settings = {
    showUsedFlow: ctx.env.CT_SHOW_USED_FLOW === 'true',
    showUsedVoice: ctx.env.CT_SHOW_USED_VOICE === 'true',
    showGeneralFlow: ctx.env.CT_SHOW_GENERAL_FLOW !== 'false',
    showDirectionalFlow: ctx.env.CT_SHOW_DIRECTIONAL_FLOW !== 'false',
  };
  const account = _getAccount(ctx);
  const configured = !!(account.phone && account.password);
  if (!configured) {
    return { configured: false, ds: null, fromCache: false, authFailed: false, authError: '' };
  }

  try {
    const rawCache = ctx.storage.getJSON('ct_raw');
    const dsCache = ctx.storage.getJSON('ct_datasource');
    const at = (rawCache && rawCache.at) || (dsCache && dsCache.updatedAt) || 0;
    if (at && Date.now() - at < 30 * 60 * 1000) {
      if (rawCache && rawCache.apiData) {
        const ds = parseImportantData(rawCache.apiData, settings);
        ds.updatedAt = at;
        return { configured, ds, fromCache: false, authFailed: false, authError: '' };
      }
      if (dsCache) {
        return { configured, ds: dsCache, fromCache: false, authFailed: false, authError: '' };
      }
    }
  } catch (_) {}

  let token = '';
  let cityCode = '';
  let provinceCode = '';
  try {
    token = ctx.storage.get('ct_app_token') || '';
    cityCode = ctx.storage.get('ct_app_city') || '';
    provinceCode = ctx.storage.get('ct_app_province') || '';
  } catch (_) {}

  const _tryFetch = async (tok, city, prov) => {
    const apiData = await fetchImportantData(ctx, account, tok, city, prov);
    const ds = parseImportantData(apiData, settings);
    try {
      ctx.storage.setJSON('ct_datasource', ds);
      ctx.storage.setJSON('ct_raw', { apiData, at: ds.updatedAt || Date.now() });
    } catch (_) {}
    _clearAuthFlag(ctx);
    return ds;
  };

  if (token) {
    try {
      const ds = await _tryFetch(token, cityCode, provinceCode);
      return { configured, ds, fromCache: false, authFailed: false, authError: '' };
    } catch (e) {
      if (e && e.transient) {
        return _fromCache(ctx, configured, settings, false, '');
      }
    }
  }

  try {
    const login = await telecomLogin(ctx, account);
    const ds = await _tryFetch(login.token, login.cityCode, login.provinceCode);
    return { configured, ds, fromCache: false, authFailed: false, authError: '' };
  } catch (e) {
    if (e && e.transient) {
      return _fromCache(ctx, configured, settings, false, '');
    }

    _notifyAuthFailedOnce(ctx, account, e);
    return { configured, ds: null, fromCache: false, authFailed: true, authError: (e && e.message) || '登录失败' };
  }
}

function _fromCache(ctx, configured, settings, authFailed, authError) {
  try {
    const raw = ctx.storage.getJSON('ct_raw');
    if (raw && raw.apiData) {
      const ds = parseImportantData(raw.apiData, settings);
      ds.updatedAt = raw.at || ds.updatedAt;
      return { configured, ds, fromCache: true, authFailed, authError };
    }
  } catch (_) {}
  try {
    const cached = ctx.storage.getJSON('ct_datasource');
    if (cached) return { configured, ds: cached, fromCache: true, authFailed, authError };
  } catch (_) {}
  return { configured, ds: null, fromCache: false, authFailed, authError };
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
// ================= 适配层：电信数据 → 移动透明版布局 ds =================
// 把 IBL3ND 电信登录/查询（parseImportantData）的输出，映射成
// 中国移动透明版布局消费的 ds 结构（parseMobile 的约定）。
// 映射（移动布局的原生语义）：
//   ds.flow      = 通用流量（general，移动布局的主流量卡）
//   ds.otherFlow = 定向流量（total - general，移动布局的「其他流量」卡）
//   ds.voice     = 语音（分钟）
//   ds.fee       = 话费
// 这样 flow + otherFlow = 总流量，insights() 的今日用量 / 日均可用 /
// 用完预测才算得对（与移动原版一致）。
// 显示开关（只改卡片上显示的数字，不改仪表百分比）：
//   通用关 + 定向开 → 主卡显示定向，otherFlow 留空
//   通用开 + 定向关 → 主卡显示通用，otherFlow 留空
//   两者都关 → 主卡显示总流量（与电信原版 else 分支一致）
//   CT_SHOW_USED_FLOW=true → 主卡/其他卡显示已用，insights 自动隐藏今日/预测
//   （移动原版 parseMobile 同款行为：percent 始终是剩余占比）
// 仪表百分比一律是剩余占比（0..1），不受已用/剩余开关影响。
// 单位：电信接口返回的流量原始值已是 KB、语音是分钟，直接使用，
// 不做 MB×1024 换算——CT 的 ctFormatFlow 把原始值 /1024 得到 MB 即证明单位是 KB。
function buildTelecomCMDataSource(ctx, ctDs, fromCache, authFailed) {
  const t = ctDs.totals || {};
  const g = ctDs.general || {};
  const showGeneral = ctx.env.CT_SHOW_GENERAL_FLOW !== 'false';
  const showDirectional = ctx.env.CT_SHOW_DIRECTIONAL_FLOW !== 'false';
  const showUsedFlow = ctx.env.CT_SHOW_USED_FLOW === 'true';
  const showUsedVoice = ctx.env.CT_SHOW_USED_VOICE === 'true';

  const tTotal = _safeN(t.flowTotalKB), tUsed = _safeN(t.flowUsedKB), tRemain = _safeN(t.flowRemainKB);
  const gTotal = _safeN(g.flowTotalKB), gUsed = _safeN(g.flowUsedKB), gRemain = _safeN(g.flowRemainKB);
  // 接口有通用明细时才有独立的定向值；无明细时 general 全 0，定向即总口径。
  const hasGeneral = gTotal > 0 || gRemain > 0 || gUsed > 0;
  const dTotal = hasGeneral ? Math.max(0, tTotal - gTotal) : 0;
  const dUsed = hasGeneral ? Math.max(0, tUsed - gUsed) : 0;
  const dRemain = hasGeneral ? Math.max(0, tRemain - gRemain) : 0;

  const frac = (remain, total) => (total > 0 ? Math.max(0, Math.min(1, remain / total)) : 0);

  // 主卡口径（数字 + 总量 + 剩余占比）
  let main;
  if (!showGeneral && showDirectional) {
    main = hasGeneral ? { remain: dRemain, used: dUsed, total: dTotal } : { remain: tRemain, used: tUsed, total: tTotal };
  } else if (showGeneral || !showDirectional) {
    main = hasGeneral ? { remain: gRemain, used: gUsed, total: gTotal } : { remain: tRemain, used: tUsed, total: tTotal };
  } else {
    main = { remain: tRemain, used: tUsed, total: tTotal };
  }
  const mainShown = showUsedFlow ? main.used : main.remain;
  const mainFmt = ctFormatFlow(mainShown);
  const flow = {
    title: showUsedFlow ? '已用流量' : '剩余流量',
    number: mainFmt.amount,
    unit: mainFmt.unit,
    percent: frac(main.remain, main.total),
    color: '#0A84FF',
    total: main.total > 0 ? ctFormatFlow(main.total) : null,
  };

  // 其他卡：定向（仅当通用与定向同时显示、且接口有通用明细时才有独立值）
  let otherFlow = { title: '其他流量', number: '--', unit: '', percent: 0, color: '#5AC8FA' };
  if (showGeneral && showDirectional && hasGeneral && dTotal > 0) {
    const oShown = showUsedFlow ? dUsed : dRemain;
    const oFmt = ctFormatFlow(oShown);
    otherFlow = { title: '其他流量', number: oFmt.amount, unit: oFmt.unit, percent: frac(dRemain, dTotal), color: '#5AC8FA' };
  }

  // 语音（分钟，总口径；percent 始终是剩余占比）
  const vTotal = _safeN(t.voiceTotal), vUsed = _safeN(t.voiceUsed), vRemain = _safeN(t.voiceRemain);
  const voice = {
    title: showUsedVoice ? '已用语音' : '剩余语音',
    number: String(showUsedVoice ? vUsed : vRemain),
    unit: '分钟',
    percent: frac(vRemain, vTotal),
    color: '#30D158',
  };

  const fee = { title: '剩余话费', number: ctDs.fee.number, unit: '元' };
  const ds = {
    fee, flow, otherFlow, voice,
    updatedAt: ctDs.updatedAt || Date.now(),
  };
  if (fromCache) ds.stale = authFailed ? '登录过期' : '缓存';
  return ds;
}

// 电信缓存重建：登录失败且 loadTelecomData 无数据时，用 ct_raw / ct_datasource
// 里的旧数据重建一份移动版 ds（与联通合并版的 buildFromCtCache 同款行为）。
function buildFromCtCache(ctx, authFailed) {
  const settings = {
    showUsedFlow: ctx.env.CT_SHOW_USED_FLOW === 'true',
    showUsedVoice: ctx.env.CT_SHOW_USED_VOICE === 'true',
    showGeneralFlow: ctx.env.CT_SHOW_GENERAL_FLOW !== 'false',
    showDirectionalFlow: ctx.env.CT_SHOW_DIRECTIONAL_FLOW !== 'false',
  };
  try {
    const raw = ctx.storage.getJSON('ct_raw');
    if (raw && raw.apiData) {
      const ctDs = parseImportantData(raw.apiData, settings);
      ctDs.updatedAt = raw.at || ctDs.updatedAt;
      return buildTelecomCMDataSource(ctx, ctDs, true, authFailed);
    }
  } catch (_) {}
  try {
    const cached = ctx.storage.getJSON('ct_datasource');
    if (cached) return buildTelecomCMDataSource(ctx, cached, true, authFailed);
  } catch (_) {}
  try {
    const cmCached = ctx.storage.getJSON('ct_cm_datasource');
    if (cmCached && cmCached.flow && cmCached.flow.number !== '--') {
      cmCached.stale = authFailed ? '登录过期' : '缓存';
      return cmCached;
    }
  } catch (_) {}
  return null;
}

async function loadData(ctx) {
  const r = await loadTelecomData(ctx);
  if (!r.configured) {
    return { configured: false, reason: 'phone', debug: false };
  }
  if (r.ds) {
    const ds = buildTelecomCMDataSource(ctx, r.ds, r.fromCache, r.authFailed);
    if (!r.fromCache) {
      try { ctx.storage.setJSON('ct_cm_datasource', ds); } catch (_) {}
    }
    return { configured: true, ds, fromCache: r.fromCache, debug: false };
  }
  const rebuilt = buildFromCtCache(ctx, r.authFailed);
  if (rebuilt) {
    return { configured: true, ds: rebuilt, fromCache: true, debug: false,
             error: r.authError || '', stage: 'session', authFailed: r.authFailed };
  }
  return { configured: true, ds: null, fromCache: false, debug: false,
           error: r.authError || '查询失败', stage: r.authFailed ? 'session' : '',
           authFailed: r.authFailed };
}

/* ==================== 小组件（generic） ==================== */

async function handleWidget(ctx) {
  const title = (ctx.env.CT_TITLE || '中国电信').trim() || '中国电信';
  const r = await loadData(ctx);

  if (!r.configured) {
    return buildError(title, '请在模块设置里填写手机号、服务密码与设备 ID', '', ctx);
  }
  if (!r.ds) {
    const hint = r.authFailed
      ? '登录失败：请检查手机号、服务密码、设备 ID 是否正确'
      : '查询失败，请稍后重试';
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

/* ==================== 入口：仅小组件 ==================== */
// 电信是直连登录取数，不抓包、不保活，所以没有 request/response 路由。

export default async function (ctx) {
  return handleWidget(ctx);
}
