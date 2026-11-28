// 中国电信（联通布局）
// 数据：IBL3ND 中国电信小组件（CT_Widget.js）——RSA 登录 appgologin.189.cn + qryImportantData
// 布局：moyuzaime 中国联通小组件（ChinaUnicom_Widget.js）——classic / dash / ios 三种版式 + 透明玻璃
// 适配：电信登录/查询结果 → 联通布局的 ds 结构（见 buildTelecomDataSource）。
// 流量单位：电信接口返回的流量原始值是 KB、语音是分钟，直接使用，不换算。
// 环境变量：CT_PHONE / CT_PASSWORD / CT_DEVICE_ID / CT_SHOW_GENERAL_FLOW /
//   CT_SHOW_DIRECTIONAL_FLOW / CT_SHOW_USED_FLOW / CT_SHOW_USED_VOICE / CT_TITLE / CT_UI_STYLE

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

// 从接口对象里推出一组自洽的 (total, used, remain)。
// 电信接口的规律：总量恒等于 已用 + 剩余（用户真实套餐：通用
// 85.12+117.88=203、定向 24.18+35.82=60，分毫不差）；但 total
// 字段经常缺失（commonFlow 只给 used/balance），直接取 total 会得 0，
// 百分比 frac(remain, 0) 就恒为 0%，这就是 2026-11-28 那个 0% bug。
// 所以总量优先用 used+remain 算出，只有 used/remain 都缺时才退回
// 接口的 total；remain/used 任一缺失时用总量反推，
// 保证三者永远自洽，百分比不可能再因 total 缺失归零。
function _flowTriple(o) {
  let used = _safeN(o && o.used);
  let remain = _safeN(o && (o.balance !== undefined ? o.balance : o.remain));
  let total = _safeN(o && o.total);
  if (used > 0 || remain > 0) {
    total = used + remain;
  } else if (total > 0 && used > 0) {
    remain = Math.max(0, total - used);
  } else if (total > 0 && remain > 0) {
    used = Math.max(0, total - remain);
  }
  return { total, used, remain };
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
  // 通用 / 总口径一律用 _flowTriple 推导：总量 = 已用 + 剩余，
  // 不再直接信任接口的 total 字段（commonFlow 经常不给 total）。
  const g = _flowTriple(common);
  const gUsed = g.used, gBalance = g.remain, gTotal = g.total;
  const t = _flowTriple({ used: total.used !== undefined ? total.used : apiData.usedFlux, balance: total.balance, total: total.total });
  const tUsed = t.used, tBalance = t.remain, tTotal = t.total;
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
  // 语音同款：总量 = 已用 + 剩余，不再直接信任 total 字段。
  const v = _flowTriple({
    used: voiceInfo.used !== undefined ? voiceInfo.used : apiData.usedVoice,
    balance: voiceInfo.balance,
    total: voiceInfo.total !== undefined ? voiceInfo.total : apiData.totalVoice,
  });
  const vTotal = v.total, vUsed = v.used, vBalance = v.remain;
  const showUsedVoice = opts.showUsedVoice;
  const voice = {
    title: showUsedVoice ? '已用语音' : '剩余语音',
    number: `${showUsedVoice ? vUsed : vBalance}`,
    unit: '分钟',
    percent: +(vTotal > 0 ? (((showUsedVoice ? vUsed : vBalance) / vTotal) * 100).toFixed(2) : '0'),
    color: VOICE_COLOR,
  };

  // 总口径原始值（流量 KB / 语音分钟），供联通布局的 plan/gauge 使用，
  // 不受显示开关（通用/定向、已用/剩余）影响。
  const totals = {
    flowTotalKB: tTotal,
    flowUsedKB: tUsed,
    flowRemainKB: tBalance,
    voiceTotal: vTotal,
    voiceUsed: vUsed,
    voiceRemain: vBalance,
  };
  return { fee, flow, voice, updatedAt: Date.now(), totals };
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

// ================= 适配层：电信数据 → 联通布局 ds =================
// 把 IBL3ND 电信登录/查询（parseImportantData）的输出，映射成
// moyuzaime 联通布局消费的 ds 结构（buildDataSource 的约定）。
// 单位：电信接口返回的流量原始值已是 KB、语音是分钟，直接使用，
// 不做 MB×1024 换算——CT 的 ctFormatFlow 把原始值 /1024 得到 MB 即证明单位是 KB。
// 历史键：KEY='telecom'，即 telecom.history，与联通小组件的 unicom.history 互不干扰。
const KEY = 'telecom';
const HISTORY_LIMIT = 96;

function buildTelecomDataSource(ctx, ctDs, fromCache, authFailed) {
  const t = (ctDs && ctDs.totals) || {};
  const hasTotals = !!(ctDs && ctDs.totals);
  const totalKB = _safeN(t.flowTotalKB);
  const usedKB = _safeN(t.flowUsedKB);
  const remainKB = _safeN(t.flowRemainKB);
  const voiceTotal = _safeN(t.voiceTotal);
  const voiceUsed = _safeN(t.voiceUsed);
  const voiceRemain = _safeN(t.voiceRemain);
  // 总口径缺失时（旧版 ct_datasource 缓存）plan 留空，布局按缺失降级显示；
  // 此时不写 history，避免用错误数值污染趋势。
  const history = saveHistory(ctx, hasTotals ? remainKB : null);
  const ds = {
    stale: !!fromCache,
    fee: ctDs.fee,
    flow: ctDs.flow,
    voice: ctDs.voice,
    updatedAt: (ctDs && ctDs.updatedAt) || Date.now(),
    captureDuration: '',
    history,
    plan: {
      total: hasTotals ? totalKB : null,
      used: hasTotals ? usedKB : null,
      remain: hasTotals ? remainKB : null,
      percent: hasTotals ? calcPlanPercent(totalKB, usedKB, remainKB) : null,
      totalPath: hasTotals ? 'flowInfo.totalAmount' : null,
      usedPath: hasTotals ? 'flowInfo.totalAmount' : null,
      voiceTotal: hasTotals ? voiceTotal : null,
      voiceUsed: hasTotals ? voiceUsed : null,
      voiceRemain: hasTotals ? voiceRemain : null,
      voicePercent: hasTotals ? calcPlanPercent(voiceTotal, voiceUsed, voiceRemain) : null,
    },
  };
  if (authFailed) ds.authFailed = true;
  return ds;
}

// 登录失败且无新鲜数据时，从电信缓存兜底（与联通 loadData 的行为一致）。
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
      return buildTelecomDataSource(ctx, ctDs, true, authFailed);
    }
  } catch (_) {}
  try {
    const cached = ctx.storage.getJSON('ct_datasource');
    if (cached && cached.fee && cached.flow) {
      return buildTelecomDataSource(ctx, cached, true, authFailed);
    }
  } catch (_) {}
  return null;
}

// 联通布局的 loadData 入口：内部走电信登录/查询，返回联通布局的 ds。
async function loadData(ctx) {
  const res = await loadTelecomData(ctx);
  if (!res.configured) {
    return { configured: false, data: null, error: null, fromCache: false };
  }
  if (res.ds) {
    // 旧版 ct_datasource 缓存（原版电信小组件写入）没有 totals 时，
    // 用 ct_raw 重新解析一次，补齐总口径数值。
    let ctDs = res.ds;
    if (!ctDs.totals) {
      try {
        const raw = ctx.storage.getJSON('ct_raw');
        if (raw && raw.apiData) {
          const settings = {
            showUsedFlow: ctx.env.CT_SHOW_USED_FLOW === 'true',
            showUsedVoice: ctx.env.CT_SHOW_USED_VOICE === 'true',
            showGeneralFlow: ctx.env.CT_SHOW_GENERAL_FLOW !== 'false',
            showDirectionalFlow: ctx.env.CT_SHOW_DIRECTIONAL_FLOW !== 'false',
          };
          const reparsed = parseImportantData(raw.apiData, settings);
          reparsed.updatedAt = raw.at || reparsed.updatedAt;
          ctDs = reparsed;
        }
      } catch (_) {}
    }
    const data = buildTelecomDataSource(ctx, ctDs, res.fromCache, res.authFailed);
    return { configured: true, data, error: null, fromCache: res.fromCache };
  }
  const fallback = buildFromCtCache(ctx, res.authFailed);
  if (fallback) {
    return { configured: true, data: fallback, error: null, fromCache: true };
  }
  return {
    configured: true,
    data: null,
    error: res.authFailed
      ? { kind: 'auth', message: res.authError || '登录失败' }
      : { kind: 'fetch', message: res.authError || '数据获取失败' },
    fromCache: false,
  };
}

// ============ 联通布局层（moyuzaime，ChinaUnicom_Widget.js，未改动） ============

const C = {
  // 低饱和环境渐变 + 统一中性色玻璃；主题色只用于图标、关键数字和进度。
  fee: '#E28A16',
  flow: '#079ACB',
  voice: '#8B5CF6',
  // 文本色随系统外观自动切换，避免深色模式下深色文字落在深色玻璃上。
  txt: { light: '#172B45', dark: '#F3F7FC' },
  sub: { light: '#586D84', dark: '#B8C7D8' },
  title: '#0F9F91',
  cyan: '#22B8CF',
  violet: '#9B7BFF',
  pink: '#EC6FA7',
  green: '#27A879',
  glass: { light: '#FFFFFFD9', dark: '#263D55D9' },
  glassBorder: { light: '#FFFFFF70', dark: '#FFFFFF25' },
  glassShadow: { light: '#64748B06', dark: '#00000000' },
};

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

function fmtTime(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes());
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

function fontSize(size) {
  if (typeof size === 'number') {
    if (size <= 8) return 9;
    if (size <= 10) return 10;
    if (size <= 13) return 12;
    if (size <= 19) return 16;
    return 24;
  }

  const named = {
    caption2: 9,
    caption1: 10,
    footnote: 12,
    body: 16,
    title3: 20,
    title2: 22,
    title: 24,
  };
  return named[size] || 12;
}

function t(text, size, weight, color, extra) {
  return Object.assign({
    type: 'text',
    text: String(text),
    font: { size: fontSize(size), weight: weight || 'regular' },
    textColor: color || C.txt,
    maxLines: 1,
    minScale: 0.6,
  }, extra || {});
}

const NO_COLOR = { light: '#00000000', dark: '#00000000' };

function glass(children, extra) {
  // 所有尺寸共用单一外层玻璃；此 helper 只负责透明布局，不再绘制内层卡片。
  // 透明值只作为默认值：调用方显式传入的样式仍然生效（原实现会写死覆盖）。
  return Object.assign({
    type: 'stack',
    direction: 'column',
    gap: 6,
    padding: [8, 10],
    borderRadius: 16,
    backgroundColor: NO_COLOR,
    borderWidth: 0,
    borderColor: NO_COLOR,
    shadowRadius: 0,
    children,
  }, extra || {});
}

function gaugeSvg(pct, color, w) {
  const stroke = 11;
  const r = (w - stroke) / 2;
  const cx = w / 2;
  const cy = w / 2;
  const h = w / 2 + stroke / 2;
  const p = Math.max(0, Math.min(1, Number(pct) || 0));

  const pt = a => [
    (cx - r * Math.cos(a)).toFixed(2),
    (cy - r * Math.sin(a)).toFixed(2),
  ];

  const [x0, y0] = pt(0);
  const [x1, y1] = pt(Math.PI);
  const [xp, yp] = pt(Math.PI * p);

  let body =
    `<path d='M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}' fill='none' stroke='${color}' stroke-opacity='0.18' stroke-width='${stroke}' stroke-linecap='round'/>`;

  if (p > 0.005) {
    body +=
      `<path d='M ${x0} ${y0} A ${r} ${r} 0 0 1 ${xp} ${yp}' fill='none' stroke='${color}' stroke-width='${stroke}' stroke-linecap='round'/>`;
  }

  return 'data:image/svg+xml,' +
    encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}'>${body}</svg>`
    );
}

function flowStatus(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) {
    return { color: C.flow, label: '套餐用量' };
  }
  const p = Number(pct);
  if (p >= 0.9) return { color: '#C4475B', label: '用量偏高' };
  if (p >= 0.7) return { color: C.fee, label: '注意余量' };
  // 用量正常与「无使用率数据」统一用蓝色，避免同一仪表盘出现两种主色
  return { color: C.flow, label: '用量正常' };
}

function trendStrip(ds) {
  const today = todayFlowUsage(ds.history);
  const used = today.value == null ? null : formatFlow(today.value);
  return glass([
    {
      type: 'stack',
      direction: 'row',
      alignItems: 'center',
      gap: 6,
      children: [
        ...(used
          ? [{
              type: 'image',
              src: historySvg(today.history, C.flow, 100, 30),
              width: 72,
              height: 22,
            }]
          : []),
        {
          type: 'stack',
          direction: 'column',
          alignItems: 'start',
          gap: 1,
          flex: 1,
          children: [
            t('今日流量使用', 9, 'semibold', C.txt),
            t(today.label, 8, 'medium', C.sub, { minScale: 0.65 }),
          ],
        },
        ...(used ? [t(used.number + ' ' + used.unit, 9, 'bold', C.flow, { minScale: 0.7 })] : []),
      ],
    },
  ], {
    height: 42,
    padding: [5, 8],
    borderRadius: 13,
    gap: 0,
  });
}

function historySvg(history, color, w, h) {
  const vals = (history || []).map(x => Number(x.flowKB)).filter(Number.isFinite).slice(-12);
  const baseline = h - 2;
  const empty = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}'><path d='M 2 ${baseline} H ${w-2}' stroke='${color}' stroke-opacity='.22' stroke-width='1.5' stroke-linecap='round' stroke-dasharray='3 4'/></svg>`;
  if (!vals.length) return 'data:image/svg+xml,' + encodeURIComponent(empty);

  const max = Math.max(1, ...vals);
  const padX = Math.min(3, w * 0.025);
  const gap = Math.max(2, Math.min(5, w * 0.035));
  const count = vals.length;
  const barW = Math.max(2, (w - padX * 2 - gap * (count - 1)) / count);
  const usableH = h - 5;
  const bars = vals.map((v, i) => {
    const bh = Math.max(2, (Math.max(0, v) / max) * usableH);
    const x = padX + i * (barW + gap);
    const y = baseline - bh;
    const opacity = i === count - 1 ? 1 : 0.48 + 0.42 * ((i + 1) / count);
    return `<rect x='${x.toFixed(1)}' y='${y.toFixed(1)}' width='${barW.toFixed(1)}' height='${bh.toFixed(1)}' rx='${Math.min(2, barW / 2).toFixed(1)}' fill='${color}' fill-opacity='${opacity.toFixed(2)}'/>`;
  }).join('');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}'><path d='M 1 ${baseline} H ${w-1}' stroke='${color}' stroke-opacity='.12' stroke-width='1'/>${bars}</svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function heroFlowCard(ds, cardHeight, cardFlex, isMedium) {
  const remain = ds.flow.number + ' ' + ds.flow.unit;
  const total = ds.plan && ds.plan.total != null ? formatFlow(ds.plan.total) : null;
  const used = ds.plan && ds.plan.used != null ? formatFlow(ds.plan.used) : null;
  const compactFlowDetail = !cardHeight
    ? '总量 ' + (total ? total.number + ' ' + total.unit : '--') + ' · 已用 ' + (used ? used.number + ' ' + used.unit : '--') +
      (ds.directional && ds.directional.remain
        ? ' · 定向 ' + ds.directional.remain.number + ' ' + ds.directional.remain.unit
        : '')
    : '';
  const p = ds.plan && ds.plan.percent != null ? ds.plan.percent : null;
  const flowStyle = flowStatus(p);
  const flowContent = isMedium
    ? {
        // 中号：左侧显示剩余数值和套餐详情，右侧显示缩小的半圆仪表盘。
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 6,
        children: [
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'start',
            gap: 2,
            flex: 1,
            children: [
              t(remain, cardHeight ? 22 : 19, 'bold', C.txt, { minScale: 0.55 }),
              t(compactFlowDetail || '当前剩余', 8, 'medium', C.sub, { minScale: 0.45 }),
            ],
          },
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'center',
            gap: 0,
            children: [
              {
                type: 'image',
                src: gaugeSvg(p != null ? p : 0, flowStyle.color, 68),
                width: 44,
                height: 24,
              },
              t(p != null ? Math.round(p * 100) + '% 已用' : '—', 8, 'bold', flowStyle.color),
            ],
          },
        ],
      }
    : {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 12,
        children: [
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'center',
            gap: -2,
            children: [
              {
                type: 'image',
                src: gaugeSvg(p != null ? p : 0, flowStyle.color, 86),
                width: 64,
                height: 34,
              },
              t(p != null ? Math.round(p * 100) + '% 已用' : '—', 10, 'bold', flowStyle.color),
            ],
          },
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'start',
            gap: 1,
            flex: 1,
            children: [
              t(remain, cardHeight ? 23 : 20, 'bold', C.txt, { minScale: 0.55 }),
              t('当前剩余', 9, 'medium', C.sub),
              ...(!cardHeight ? [t(compactFlowDetail, 8, 'medium', C.sub, { minScale: 0.45 })] : []),
            ],
          },
        ],
      };
  return glass([
    {
      type: 'stack',
      direction: 'row',
      alignItems: 'center',
      gap: 6,
      children: [
        {
          type: 'image',
          src: 'sf-symbol:chart.pie.fill',
          width: 13,
          height: 13,
          color: C.flow,
        },
        t(ds.packageName || '流量主卡', 10, 'semibold', C.txt),
        { type: 'spacer' },
        t(p != null ? Math.round((1 - p) * 100) + '% 剩余' : '实时套餐', 9, 'semibold', flowStyle.color),
      ],
    },
    flowContent,
  ], {
    width: 0,
    flex: cardFlex || 1,
    ...(cardHeight ? { height: cardHeight, maxWidth: 360 } : {}),
    padding: [8, 10],
    borderRadius: 18,
    gap: 4,
    shadowColor: { light: '#52677A18', dark: '#00000028' },
    shadowRadius: 0,
    shadowOffset: { x: 0, y: 0 },
  });
}

function nextRefreshAfter(ds) {
  const delay = ds && ds.stale ? 2 * 60 * 1000 : 15 * 60 * 1000;
  return new Date(Date.now() + delay).toISOString();
}

function headerMeta(ds) {
  const staleView = Boolean(ds.stale);
  const ageMs = ds.updatedAt ? Date.now() - Number(ds.updatedAt) : null;
  const when = staleView
    ? '缓存 ' + (ageMs != null ? ageText(ageMs) + '前' : fmtTime(ds.updatedAt))
    : '更新 ' + fmtTime(ds.updatedAt);
  const dur = ds.captureDuration ? ' · 凭据保持 ' + ds.captureDuration : '';
  const auth = ds.authFailed ? ' · 凭据待更新' : '';
  return {
    text: when + dur + auth,
    expired: staleView && ageMs != null && ageMs > 24 * 60 * 60 * 1000,
  };
}

function buildHeader(title, ds, opts) {
  const o = opts || {};
  const meta = headerMeta(ds);
  const iconSize = o.iconSize || 13;
  const titleSize = o.titleSize || 'footnote';
  const metaEl = t(meta.text, o.metaSize || 9, 'medium', meta.expired ? C.fee : C.sub, { minScale: o.minScale || 0.55 });
  const titleRow = {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 5,
    children: [
      { type: 'image', src: 'sf-symbol:antenna.radiowaves.left.and.right', width: iconSize, height: iconSize, color: C.flow },
      t(title, titleSize, 'semibold', C.txt),
    ],
  };
  if (o.twoLine) {
    return { type: 'stack', direction: 'column', alignItems: 'start', gap: 2, children: [titleRow, metaEl] };
  }
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 5,
    children: [
      { type: 'image', src: 'sf-symbol:antenna.radiowaves.left.and.right', width: iconSize, height: iconSize, color: C.flow },
      t(title, titleSize, 'semibold', C.txt),
      { type: 'spacer' },
      metaEl,
    ],
  };
}

function header(title, ds, fromCache, mediumInset) {
  const built = buildHeader(title, ds, { iconSize: 13, titleSize: 'footnote', metaSize: 9, minScale: 0.6 });
  return mediumInset ? Object.assign(built, { padding: [4, 6] }) : built;
}

function buildSmall(title, ds, fromCache) {
  const p = ds.plan && ds.plan.percent != null ? ds.plan.percent : null;
  const flowStyle = flowStatus(p);
  const remain = ds.flow.number + ' ' + ds.flow.unit;
  const usedFlow = ds.plan && ds.plan.used != null ? formatFlow(ds.plan.used) : null;
  const totalFlow = ds.plan && ds.plan.total != null ? formatFlow(ds.plan.total) : null;
  const used = usedFlow ? usedFlow.number + ' ' + usedFlow.unit : '--';
  const total = totalFlow ? totalFlow.number + ' ' + totalFlow.unit : '--';

  return {
    type: 'widget',
    padding: [13, 13],
    gap: 6,
    backgroundColor: '#00000000',
    refreshAfter: nextRefreshAfter(ds),
    children: [
      buildHeader(title, ds, { iconSize: 12, titleSize: 12, metaSize: 7.5, twoLine: true }),

      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 4,
        flex: 1,
        children: [
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'start',
            gap: 2,
            flex: 1,
            children: [
              t(ds.packageName || (ds.flow && ds.flow.title) || '剩余流量', 9, 'medium', C.sub),
              {
                type: 'stack',
                direction: 'row',
                alignItems: 'end',
                gap: 2,
                children: [
                  t(ds.flow.number, 23, 'bold', C.txt, { minScale: 0.35 }),
                  t(ds.flow.unit, 9, 'semibold', C.sub, { minScale: 0.7 }),
                ],
              },
              {
                type: 'stack',
                direction: 'column',
                alignItems: 'start',
                gap: 2,
                children: [
                  t(
                    ds.plan && ds.plan.used != null
                      ? '已用 ' + used
                      : '已用量待确认',
                    8,
                    'semibold',
                    flowStyle.color,
                    { minScale: 0.65 }
                  ),
                  t(
                    ds.plan && ds.plan.total != null
                      ? '总量 ' + total
                      : (ds.plan && ds.plan.remain != null
                        ? '余量 ' + formatFlow(ds.plan.remain).number + ' ' + formatFlow(ds.plan.remain).unit
                        : '总量待确认'),
                    8,
                    'medium',
                    C.sub,
                    { minScale: 0.45 }
                  ),
                ],
              },
            ],
          },
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'center',
            gap: -2,
            children: [
              {
                type: 'image',
                src: gaugeSvg(p, flowStyle.color, 78),
                width: 44,
                height: 27,
              },
              t(
                p != null ? Math.round(p * 100) + '% 已用' : '套餐',
                8,
                'bold',
                flowStyle.color
              ),
              t(
                (() => {
                  const today = todayFlowUsage(ds.history);
                  return today.value != null
                    ? '今日 ' + formatFlow(today.value).number + formatFlow(today.value).unit
                    : '今日采集中';
                })(),
                8,
                'medium',
                C.sub,
                { minScale: 0.6 }
              ),
            ],
          },
        ],
      },

      {
        type: 'stack',
        direction: 'row',
        gap: 5,
        children: [
          glass([
            { type: 'stack', direction: 'row', alignItems: 'center', gap: 3, children: [
              { type: 'image', src: 'sf-symbol:phone.fill', width: 10, height: 10, color: C.voice },
              t('剩余语音', 8, 'medium', C.sub),
            ]},
            { type: 'stack', direction: 'row', alignItems: 'end', gap: 2, children: [
              t(ds.voice.number === '--' ? '暂无' : ds.voice.number, 18, 'bold', C.txt, { minScale: 0.4 }),
              t(ds.voice.number === '--' ? '' : '分钟', 8, 'semibold', C.sub),
            ]},
          ], { width: 0, flex: 1, height: 48, padding: [7, 7], gap: 4, borderRadius: 15 }),
          glass([
            { type: 'stack', direction: 'row', alignItems: 'center', gap: 3, children: [
              { type: 'image', src: 'sf-symbol:yensign.circle.fill', width: 10, height: 10, color: C.fee },
              t(ds.account && ds.account.balance != null ? '账户余额' : '剩余话费', 8, 'medium', C.sub),
            ]},
            { type: 'stack', direction: 'row', alignItems: 'end', gap: 2, children: [
              t('¥', 10, 'semibold', C.fee),
              t(ds.fee.number, 18, 'bold', C.txt, { minScale: 0.4 }),
              ...(ds.account && ds.account.monthCost != null
                ? [t('本月 ' + Number(ds.account.monthCost).toFixed(2), 7, 'medium', C.sub, { minScale: 0.5 })]
                : []),
            ]},
          ], { width: 0, flex: 1, height: 48, padding: [7, 7], gap: 4, borderRadius: 15 }),
        ],
      }
    ],
  };
}

function buildMedium(title, ds, fromCache) {
  // 中号内容增加内缩留白，避免标题与信息区贴近玻璃卡片边缘。
  const compactFee = glass([
    {
      type: 'stack',
      direction: 'row',
      alignItems: 'center',
      gap: 4,
      children: [
        {
          type: 'image',
          src: 'sf-symbol:yensign.circle.fill',
          width: 10,
          height: 10,
          color: C.fee,
        },
        t(ds.account && ds.account.balance != null ? '余额' : '话费', 9, 'medium', C.sub),
        { type: 'spacer' },
        {
          type: 'stack',
          direction: 'column',
          alignItems: 'end',
          gap: 0,
          children: [
            t('¥' + ds.fee.number, 15, 'bold', C.txt, { minScale: 0.6 }),
            ...(ds.account && ds.account.monthCost != null
              ? [t('本月 ' + Number(ds.account.monthCost).toFixed(2), 7, 'medium', C.sub, { minScale: 0.5 })]
              : []),
          ],
        },
      ],
    },
  ], {
    flex: 1,
    padding: [6, 8],
    gap: 1,
    borderRadius: 14,
    justifyContent: 'center',
  });

  const compactVoice = glass([
    {
      type: 'stack',
      direction: 'row',
      alignItems: 'center',
      gap: 4,
      children: [
        {
          type: 'image',
          src: 'sf-symbol:phone.fill',
          width: 10,
          height: 10,
          color: C.voice,
        },
        t('语音', 9, 'medium', C.sub),
        { type: 'spacer' },
        t(ds.voice.number, 15, 'bold', C.txt, { minScale: 0.6 }),
        t('分', 8, 'semibold', C.sub),
      ],
    },

  ], {
    flex: 1,
    padding: [6, 8],
    gap: 1,
    borderRadius: 14,
  });

  const row = {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 5,
    children: [
      heroFlowCard(ds, null, null, true),
      {
        type: 'stack',
        direction: 'column',
        alignItems: 'center',
        gap: 5,
        width: 100,
        children: [
          compactFee,
          compactVoice,
        ],
      },
    ],
  };

  return {
    type: 'widget',
    padding: [12, 14],
    gap: 6,
    backgroundColor: { light: '#F4F7FB', dark: '#161B22' },
    refreshAfter: nextRefreshAfter(ds),
    children: [
      header(title, ds, fromCache, true),
      row,
      trendStrip(ds),
    ],
  };
}

function todayFlowUsage(history) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const all = (history || [])
    .filter(x => Number.isFinite(Number(x.ts)) && Number.isFinite(Number(x.flowKB)))
    .sort((a, b) => Number(a.ts) - Number(b.ts));
  const before = all.filter(x => Number(x.ts) < startOfDay);
  const today = all.filter(x => Number(x.ts) >= startOfDay);
  // 昨天最后一个采样点作为今天 00:00 的基线：跨天后第一次渲染就能算出今日用量
  const baseline = before.length ? Number(before[before.length - 1].flowKB) : null;

  if (!today.length) {
    return {
      value: null,
      history: baseline != null ? [{ ts: startOfDay, flowKB: 0 }] : [],
      label: '今日数据采集中',
    };
  }

  const first = baseline != null ? baseline : Number(today[0].flowKB);
  const last = Number(today[today.length - 1].flowKB);
  if (!Number.isFinite(first) || !Number.isFinite(last) || (baseline == null && today.length < 2)) {
    return { value: null, history: today, label: '今日数据采集中' };
  }

  const value = Math.max(0, first - last);
  const points = (baseline != null ? [{ ts: startOfDay, flowKB: first }] : []).concat(today).map(x => ({
    ts: x.ts,
    flowKB: Math.max(0, first - Number(x.flowKB)),
  }));
  return {
    value,
    history: points,
    label: value < 1 ? '今日暂无明显消耗' : '按今日已记录余量变化估算',
  };
}

function buildLarge(title, ds, fromCache) {
  const staleView = Boolean(ds.stale);
  const ageMs = ds.updatedAt ? Date.now() - Number(ds.updatedAt) : null;
  const expired = staleView && ageMs != null && ageMs > 24 * 60 * 60 * 1000;
  const plan = ds.plan || {};
  const total = plan.total != null ? formatFlow(plan.total) : null;
  const usedFlow = plan.used != null ? formatFlow(plan.used) : null;
  const remain = plan.remain != null ? formatFlow(plan.remain) : null;
  const voicePct = plan.voicePercent != null
    ? Math.max(0, Math.min(1, Number(plan.voicePercent)))
    : null;
  const voiceUsed = plan.voiceUsed != null ? formatVoice(plan.voiceUsed) : null;
  const voiceTotal = plan.voiceTotal != null ? formatVoice(plan.voiceTotal) : null;
  const p = plan.percent != null ? Math.max(0, Math.min(1, Number(plan.percent))) : null;
  const flowStyle = flowStatus(p);
  const today = todayFlowUsage(ds.history);
  const todayUsed = today.value == null ? null : formatFlow(today.value);

  // 大号组件内部只排版内容，不创建子卡片；玻璃背景由 liquidGlassWidget 统一提供。
  return {
    type: 'widget',
    padding: [16, 17],
    gap: 9,
    backgroundColor: '#00000000',
    refreshAfter: nextRefreshAfter(ds),
    children: [
      header(title, ds, fromCache),
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 12,
        height: 112,
        children: [
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'start',
            justifyContent: 'center',
            gap: 7,
            flex: 1.25,
            children: [
              {
                type: 'stack',
                direction: 'row',
                alignItems: 'center',
                gap: 5,
                children: [
                  { type: 'image', src: 'sf-symbol:chart.pie.fill', width: 13, height: 13, color: C.flow },
                  t(ds.packageName || (ds.flow && ds.flow.title) || '剩余流量', 10, 'semibold', C.sub),
                  { type: 'spacer' },
                  t(p != null ? Math.round((1 - p) * 100) + '% 剩余' : '套餐流量', 9, 'semibold', flowStyle.color),
                ],
              },
              {
                type: 'stack',
                direction: 'row',
                alignItems: 'end',
                gap: 3,
                children: [
                  t(ds.flow.number, 29, 'bold', C.txt, { minScale: 0.45 }),
                  t(ds.flow.unit, 11, 'semibold', C.sub),
                ],
              },
              {
                type: 'stack',
                direction: 'row',
                gap: 4,
                height: 5,
                children: [
                  {
                    type: 'stack',
                    flex: p == null ? 1 : Math.max(0.03, p),
                    backgroundColor: flowStyle.color,
                    borderRadius: 4,
                    children: [],
                  },
                  {
                    type: 'stack',
                    flex: p == null ? 0.001 : Math.max(0.03, 1 - p),
                    backgroundColor: { light: '#7890A52B', dark: '#FFFFFF2B' },
                    borderRadius: 4,
                    children: [],
                  },
                ],
              },
              t('总量 ' + (total ? total.number + ' ' + total.unit : '--') +
                '  ·  已用 ' + (usedFlow ? usedFlow.number + ' ' + usedFlow.unit : '--') +
                (ds.otherUsedMB != null
                  ? '  ·  其他 ' + formatFlow(ds.otherUsedMB * 1024).number + ' ' + formatFlow(ds.otherUsedMB * 1024).unit
                  : ''), 9, 'medium', C.sub, { minScale: 0.55 }),
              ...(ds.directional && (ds.directional.remain || ds.directional.used)
                ? [t('定向流量 ' + (ds.directional.remain ? '剩余 ' + ds.directional.remain.number + ' ' + ds.directional.remain.unit : '') +
                    (ds.directional.used ? (ds.directional.remain ? ' · ' : '') + '已用 ' + ds.directional.used.number + ' ' + ds.directional.used.unit : ''), 8, 'medium', C.sub, { minScale: 0.6 })]
                : []),
            ],
          },
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0,
            width: 90,
            children: [
              { type: 'image', src: gaugeSvg(p, flowStyle.color, 110), width: 76, height: 40 },
              t(p != null ? Math.round(p * 100) + '% 已用' : '用量统计', 9, 'bold', flowStyle.color),
            ],
          },
        ],
      },
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 10,
        padding: [8, 0],
        children: [
          {
            type: 'stack',
            direction: 'column',
            gap: 4,
            flex: 1,
            children: [
              { type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [
                { type: 'image', src: 'sf-symbol:yensign.circle.fill', width: 12, height: 12, color: C.fee },
                t(ds.account && ds.account.balance != null ? '账户余额' : '剩余话费', 10, 'medium', C.sub),
              ]},
              { type: 'stack', direction: 'row', alignItems: 'end', gap: 2, children: [
                t('¥' + ds.fee.number, 21, 'bold', C.txt, { minScale: 0.5 }),
                t('元', 9, 'medium', C.sub),
              ]},
              ...(ds.account && ds.account.monthCost != null
                ? [t('本月 ¥' + Number(ds.account.monthCost).toFixed(2), 8, 'medium', C.sub, { minScale: 0.6 })]
                : []),
            ],
          },
          {
            type: 'stack',
            direction: 'column',
            gap: 4,
            flex: 1,
            children: [
              { type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [
                { type: 'image', src: 'sf-symbol:phone.fill', width: 12, height: 12, color: C.voice },
                t('剩余语音', 10, 'medium', C.sub),
              ]},
              { type: 'stack', direction: 'row', alignItems: 'end', gap: 2, children: [
                t(ds.voice.number === '--' ? '暂无' : ds.voice.number, 21, 'bold', C.txt, { minScale: 0.5 }),
                t(ds.voice.number === '--' ? '' : '分钟', 9, 'medium', C.sub),
              ]},
              ...(voiceUsed != null && voiceTotal != null
                ? [t('已用 ' + voiceUsed + ' / ' + voiceTotal + ' 分钟', 8, 'medium', C.sub, { minScale: 0.55 })]
                : (ds.smsRemain != null
                    ? [t('短信 ' + ds.smsRemain + ' 条', 8, 'medium', C.sub, { minScale: 0.55 })]
                    : [])),
            ],
          },
        ],
      },
      {
        type: 'stack',
        direction: 'column',
        gap: 5,
        padding: [7, 0, 0, 0],
        children: [
          {
            type: 'stack',
            direction: 'row',
            alignItems: 'center',
            gap: 4,
            children: [
              { type: 'image', src: 'sf-symbol:chart.bar.fill', width: 10, height: 10, color: C.flow },
              t('今日流量使用', 10, 'semibold', C.txt),
              { type: 'spacer' },
              ...(todayUsed ? [t(todayUsed.number + ' ' + todayUsed.unit, 10, 'bold', C.flow)] : []),
            ],
          },
          ...(todayUsed
            ? [{
                type: 'image',
                src: historySvg(today.history.map(x => ({ flowKB: x.flowKB })), C.flow, 270, 38),
                width: 270,
                height: 38,
              }]
            : []),
          t(today.label, 8, 'medium', C.sub),
          {
            type: 'stack',
            direction: 'row',
            alignItems: 'center',
            gap: 4,
            children: [
              { type: 'image', src: 'sf-symbol:clock', width: 9, height: 9, color: C.sub },
              t(staleView ? '缓存 ' + (ageMs != null ? ageText(ageMs) + '前' : '') : '实时数据', 8, 'medium', expired ? C.fee : C.sub),
              { type: 'spacer' },
              t(expired ? '数据已过期' : (ds.captureDuration ? '凭据已保持 ' + ds.captureDuration : ''), 8, 'medium', expired ? C.fee : C.sub),
            ],
          },
          ...(ds.account && ds.account.owed != null && Number(ds.account.owed) > 0
            ? [t('欠费 ¥' + Number(ds.account.owed).toFixed(2), 8, 'semibold', C.fee)]
            : []),
        ],
      },
    ],
  };
}

function buildLock(title, ds, family) {
  const dur = ds.captureDuration ? ' · 保持' + ds.captureDuration : '';
  if (family === 'accessoryInline') {
    return {
      type: 'widget',

      refreshAfter: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      children: [
        {
          type: 'text',
          text: `¥${ds.fee.number} · ${ds.flow.number}${ds.flow.unit} · ${ds.voice.number}分${dur}`,
          maxLines: 1,
          minScale: 0.6,
        },
      ],
    };
  }

  if (family === 'accessoryCircular') {
    return {
      type: 'widget',

      refreshAfter: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      padding: 7,
      children: [
        { type: 'spacer' },
        {
          type: 'stack',
          direction: 'column',
          alignItems: 'center',
          gap: 0,
          children: [
            {
              type: 'image',
              src: 'sf-symbol:wifi',
              width: 11,
              height: 11,
              color: C.flow,
            },
            t(ds.flow.number, 14, 'bold', C.txt, { minScale: 0.5 }),
            t(ds.flow.unit, 8, 'regular', C.sub),
          ],
        },
        { type: 'spacer' },
      ],
    };
  }

  return {
    type: 'widget',

    refreshAfter: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    padding: [3, 5],
    gap: 2,
    children: [
      t(`话费 ¥${ds.fee.number}`, 'footnote', 'bold', C.fee),
      t(`流量 ${ds.flow.number}${ds.flow.unit} · 语音 ${ds.voice.number}分${dur}`, 'caption2', 'semibold', C.txt, {
        minScale: 0.6,
      }),
    ],
  };
}

function liquidGlassWidget(widget) {
  if (!widget || widget.type !== 'widget') return widget;
  // 透明模式下根节点完全透明，避免系统底色覆盖壁纸；内容仍按各自颜色绘制。
  widget.backgroundColor = '#00000000';
  delete widget.glassContentPadding;
  return widget;
}

function buildError(title, message) {
  return {
    type: 'widget',

    refreshAfter: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    padding: 14,
    gap: 6,
    backgroundColor: '#00000000',
    children: [
      t(title, 'footnote', 'semibold'),
      { type: 'spacer' },
      {
        type: 'image',
        src: 'sf-symbol:exclamationmark.triangle.fill',
        width: 22,
        height: 22,
        color: C.fee,
      },
      t(message, 'caption1', 'medium', C.txt, {
        maxLines: 4,
        minScale: 0.7,
      }),
      { type: 'spacer' },
    ],
  };
}

function daysInMonthLeft() {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.max(1, last - now.getDate() + 1);
}

function altHeader(title, ds, size, small) {
  return buildHeader(title, ds, {
    iconSize: size,
    titleSize: size,
    metaSize: small ? 7.5 : 8,
    twoLine: Boolean(small),
    minScale: 0.5,
  });
}

function ringsSvg(items, size) {
  const cx = size / 2;
  const cy = size / 2;
  let svg = '<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 ' + size + ' ' + size + '\'>';
  // 以最大描边为准留边，避免最外圈被 viewBox 裁掉
  let maxStroke = 8;
  for (const it of items) maxStroke = Math.max(maxStroke, it.stroke || 8);
  let r = size / 2 - maxStroke / 2 - 1;
  for (const it of items) {
    const stroke = it.stroke || 8;
    const c = 2 * Math.PI * r;
    const p = Math.max(0, Math.min(1, Number(it.pct) || 0));
    svg += '<circle cx=\'' + cx + '\' cy=\'' + cy + '\' r=\'' + r.toFixed(1) + '\' fill=\'none\' stroke=\'' + it.color +
      '\' stroke-opacity=\'0.16\' stroke-width=\'' + stroke + '\'/>';
    if (p > 0.001) {
      svg += '<circle cx=\'' + cx + '\' cy=\'' + cy + '\' r=\'' + r.toFixed(1) + '\' fill=\'none\' stroke=\'' + it.color +
        '\' stroke-width=\'' + stroke + '\' stroke-linecap=\'round\' stroke-dasharray=\'' + (c * p).toFixed(1) + ' ' + c.toFixed(1) +
        '\' transform=\'rotate(-90 ' + cx + ' ' + cy + ')\'/>';
    }
    r -= stroke + 3;
  }
  svg += '</svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function altGauge(pct, color, w) {
  return {
    type: 'image',
    src: gaugeSvg(pct == null ? 0 : Math.max(0, Math.min(1, pct)), color, w),
    width: w,
    height: Math.round(w / 2) + 6,
  };
}

function altStrip(ds, compact) {
  const today = todayFlowUsage(ds.history);
  const used = today.value == null ? null : formatFlow(today.value);
  const daysLeft = daysInMonthLeft();
  const remain = ds.plan && ds.plan.remain != null ? ds.plan.remain : null;
  const avg = remain != null ? formatFlow(Math.round(remain / daysLeft)) : null;
  const enough = remain != null && today.value ? Math.max(0, Math.floor(remain / today.value)) : null;
  const children = [
    { type: 'image', src: historySvg(today.history, C.flow, 90, 20), width: compact ? 38 : 54, height: 16 },
    t('今日 ' + (used ? used.number + ' ' + used.unit : '—'), compact ? 7.5 : 8, 'medium', C.txt, { minScale: 0.55 }),
  ];
  children.push({ type: 'spacer' });
  if (avg && !compact) children.push(t('日均 ' + avg.number + ' ' + avg.unit, 7.5, 'medium', C.sub, { minScale: 0.55 }));
  if (enough != null) children.push(t('够用 ' + enough + ' 天 ✓', 7.5, 'semibold', C.green, { minScale: 0.55 }));
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 6,
    padding: [3, 8],
    borderRadius: 11,
    backgroundColor: { light: '#FFFFFF80', dark: '#1E2C3C55' },
    children,
  };
}

function altCard(opts) {
  const gaugeW = opts.gaugeW || 40;
  const valueSize = opts.valueSize || 13;
  const labelSize = opts.labelSize || 7.5;
  const pad = opts.pad || [6, 3];
  const children = [
    {
      type: 'stack', direction: 'row', alignItems: 'center', gap: 2,
      children: [
        { type: 'image', src: opts.icon, width: 9, height: 9, color: opts.color },
        t(opts.label, labelSize, 'medium', C.sub, { minScale: 0.55 }),
      ],
    },
  ];
  if (opts.pct != null) children.push(altGauge(opts.pct, opts.color, gaugeW));
  children.push({
    type: 'stack', direction: 'row', alignItems: 'end', gap: 1,
    children: [t(opts.value, valueSize, 'bold', C.txt, { minScale: 0.45 })]
      .concat(opts.unit ? [t(opts.unit, opts.unitSize || 7, 'medium', C.sub)] : []),
  });
  if (opts.sub) children.push(t(opts.sub, 6.5, 'medium', C.sub, { minScale: 0.55 }));
  return {
    type: 'stack', direction: 'column', alignItems: 'center', gap: 2,
    flex: 1, padding: pad, borderRadius: 12,
    backgroundColor: { light: '#FFFFFFB8', dark: '#1E2C3C7A' },
    children,
  };
}

function dashboardLower(ds) {
  const today = todayFlowUsage(ds.history);
  const used = today.value == null ? null : formatFlow(today.value);
  const daysLeft = daysInMonthLeft();
  const remain = ds.plan && ds.plan.remain != null ? ds.plan.remain : null;
  const avg = remain != null ? formatFlow(Math.round(remain / daysLeft)) : null;
  const enough = remain != null && today.value ? Math.max(0, Math.floor(remain / today.value)) : null;
  return {
    type: 'stack', direction: 'column', gap: 4, padding: [7, 10], borderRadius: 12,
    backgroundColor: { light: '#FFFFFF80', dark: '#1E2C3C55' },
    children: [
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 6,
        children: [
          { type: 'image', src: 'sf-symbol:chart.bar.fill', width: 10, height: 10, color: C.flow },
          t('今日流量使用', 10, 'semibold', C.txt),
          { type: 'spacer' },
          t(used ? used.number + ' ' + used.unit : '采集中', 10, 'bold', C.flow),
        ],
      },
      ...(used ? [{ type: 'image', src: historySvg(today.history, C.flow, 280, 46), width: 280, height: 46 }] : []),
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 4,
        children: [
          t(avg ? '日均可用 ' + avg.number + ' ' + avg.unit : '今日数据采集中', 8, 'medium', C.sub, { minScale: 0.6 }),
          { type: 'spacer' },
          t(enough != null ? '预计够用 ' + enough + ' 天 ✓' : '', 8, 'semibold', C.green, { minScale: 0.6 }),
        ],
      },
    ],
  };
}

function dashAccount(ds) {
  if (!ds.account || ds.account.balance == null) return null;
  const children = [
    { type: 'image', src: 'sf-symbol:yensign.circle.fill', width: 9, height: 9, color: C.fee },
    t('账户余额 ¥' + Number(ds.account.balance).toFixed(2), 8, 'semibold', C.sub, { minScale: 0.6 }),
    { type: 'spacer' },
  ];
  if (ds.account.monthCost != null) children.push(t('本月 ¥' + Number(ds.account.monthCost).toFixed(2), 8, 'medium', C.sub, { minScale: 0.6 }));
  children.push(ds.account.owed != null && Number(ds.account.owed) > 0
    ? t('欠费 ¥' + Number(ds.account.owed).toFixed(2), 8, 'semibold', C.fee)
    : t('无欠费', 8, 'medium', C.sub));
  return { type: 'stack', direction: 'row', alignItems: 'center', gap: 5, children };
}

function dashCards(ds, layout) {
  const p = ds.plan && ds.plan.percent != null ? ds.plan.percent : null;
  const remain = ds.plan && ds.plan.remain != null ? formatFlow(ds.plan.remain) : null;
  const today = todayFlowUsage(ds.history);
  const todayUsed = today.value == null ? null : formatFlow(today.value);
  const daysLeft = daysInMonthLeft();
  const remainRaw = ds.plan && ds.plan.remain != null ? ds.plan.remain : null;
  const dailyAllow = remainRaw != null ? remainRaw / daysLeft : null;
  const dailyPct = today.value && dailyAllow ? Math.max(0, Math.min(1, today.value / dailyAllow)) : null;
  const voiceRemainPct = ds.plan && ds.plan.voiceTotal
    ? Math.max(0, Math.min(1, (Number(ds.plan.voiceTotal) - Number(ds.plan.voiceUsed || 0)) / Number(ds.plan.voiceTotal)))
    : null;

  const size = {
    gaugeW: layout === 'large' ? 56 : (layout === 'small' ? 24 : 40),
    valueSize: layout === 'large' ? 18 : (layout === 'small' ? 11 : 13),
    unitSize: layout === 'large' ? 8 : (layout === 'small' ? 6.5 : 7),
    labelSize: layout === 'large' ? 9.5 : (layout === 'small' ? 6.8 : 7.5),
    pad: layout === 'large' ? [10, 4] : (layout === 'small' ? [4, 2] : [6, 3]),
  };

  const feeCard = altCard(Object.assign({}, size, {
    label: ds.fee.title || '剩余话费',
    icon: 'sf-symbol:yensign.circle.fill',
    color: C.fee,
    value: '¥' + ds.fee.number,
    pct: null,
    sub: '本月剩 ' + daysLeft + ' 天',
  }));
  const flowCard = altCard(Object.assign({}, size, {
    label: '剩余流量',
    icon: 'sf-symbol:wifi',
    color: C.flow,
    value: remain ? remain.number : (ds.flow && ds.flow.number ? ds.flow.number : '--'),
    unit: remain ? remain.unit : (ds.flow && ds.flow.number ? ds.flow.unit : ''),
    pct: p != null ? 1 - Math.max(0, Math.min(1, p)) : 0,
    sub: p != null ? Math.round((1 - Math.max(0, Math.min(1, p))) * 100) + '% 剩余' : '套餐用量',
  }));
  const dirCard = ds.directional && ds.directional.remain
    ? altCard(Object.assign({}, size, {
        label: '定向流量',
        icon: 'sf-symbol:arrow.triangle.branch',
        color: C.cyan,
        value: ds.directional.remain.number,
        unit: ds.directional.remain.unit,
        pct: ds.directionalPct != null ? ds.directionalPct : 0,
        sub: ds.directionalPct != null ? Math.round(ds.directionalPct * 100) + '% 剩余' : '剩余',
      }))
    : altCard(Object.assign({}, size, {
        label: '今日流量',
        icon: 'sf-symbol:chart.bar.fill',
        color: C.cyan,
        value: todayUsed ? todayUsed.number : '--',
        unit: todayUsed ? todayUsed.unit : '',
        pct: dailyPct != null ? dailyPct : 0,
        sub: dailyAllow != null
          ? '日均 ' + formatFlow(Math.round(dailyAllow)).number + ' ' + formatFlow(Math.round(dailyAllow)).unit
          : '今日已用',
      }));
  const voiceCard = altCard(Object.assign({}, size, {
    label: '剩余语音',
    icon: 'sf-symbol:phone.fill',
    color: C.green,
    value: ds.voice.number,
    unit: ds.voice.unit,
    pct: voiceRemainPct != null ? voiceRemainPct : 0,
    sub: ds.voice.number === '--' ? '暂无'
      : (Number(ds.voice.number) === 0 ? '未包含'
        : (voiceRemainPct != null ? Math.round(voiceRemainPct * 100) + '% 剩余' : '剩余')),
  }));
  return [feeCard, flowCard, dirCard, voiceCard];
}

function buildDash(family, title, ds) {
  const small = family === 'systemSmall';
  const large = family === 'systemLarge' || family === 'systemExtraLarge';
  const layout = small ? 'small' : (large ? 'large' : 'medium');
  const cards = dashCards(ds, layout);
  let body;
  if (small) {
    body = [
      { type: 'stack', direction: 'row', gap: 5, flex: 1, children: [cards[0], cards[1], cards[3]] },
      altStrip(ds, true),
    ];
  } else if (large) {
    body = [
      { type: 'stack', direction: 'row', gap: 7, flex: 1, children: cards },
      dashboardLower(ds),
    ];
  } else {
    body = [
      { type: 'stack', direction: 'row', gap: 6, children: cards },
      altStrip(ds, false),
    ];
  }
  return {
    type: 'widget',

    refreshAfter: nextRefreshAfter(ds),
    padding: small ? [11, 12] : (large ? [14, 16] : [13, 14]),
    gap: 7,
    backgroundColor: '#00000000',
    children: [altHeader(title, ds, 12, small), ...body],
  };
}

function iosRow(label, icon, color, value, unit, pctText, opt) {
  const o = opt || {};
  const col = (w, align, child) => ({
    type: 'stack', direction: 'column', alignItems: align, width: w,
    children: [child],
  });
  const children = [
    { type: 'image', src: icon, width: o.iconSize || 9, height: o.iconSize || 9, color },
    col(o.labelW || 46, 'start', t(label, o.labelSize || 8, 'medium', C.sub, { minScale: 0.6 })),
    { type: 'spacer' },
    col(o.valueW || 56, 'end', t(value, o.valueSize || 11, 'bold', C.txt, { minScale: 0.45, textAlign: 'right' })),
  ];
  if (unit) children.push(col(o.unitW || 18, 'start', t(unit, o.unitSize || 7, 'medium', C.sub)));
  if (pctText) children.push(col(o.pctW || 30, 'end', t(pctText, o.pctSize || 8, 'semibold', color, { minScale: 0.6, textAlign: 'right' })));
  return { type: 'stack', direction: 'row', alignItems: 'center', gap: 3, children };
}

function buildIos(family, title, ds) {
  const small = family === 'systemSmall';
  const large = family === 'systemLarge' || family === 'systemExtraLarge';
  const p = ds.plan && ds.plan.percent != null ? ds.plan.percent : null;
  const remainPct = p != null ? Math.max(0, Math.min(1, 1 - p)) : null;
  const voiceRemain = ds.plan && ds.plan.voiceRemain != null ? Number(ds.plan.voiceRemain) : null;
  const voiceTotal = ds.plan && ds.plan.voiceTotal != null ? Number(ds.plan.voiceTotal) : null;
  const voicePct = voiceRemain != null && voiceTotal ? Math.max(0, Math.min(1, voiceRemain / voiceTotal)) : null;

  const ringItems = [];
  const strokeMain = large ? 8 : (small ? 6 : 7);
  const strokeSub = large ? 6 : (small ? 5 : 6);
  if (remainPct != null) ringItems.push({ pct: remainPct, color: C.flow, stroke: strokeMain });
  if (ds.directional && ds.directional.remain) {
    ringItems.push({ pct: ds.directionalPct != null ? ds.directionalPct : 0, color: C.cyan, stroke: strokeSub });
  }
  if (voicePct != null) ringItems.push({ pct: voicePct, color: C.green, stroke: strokeSub });
  if (!ringItems.length) ringItems.push({ pct: 0, color: C.flow, stroke: strokeMain });

  const ringSize = small ? 56 : (large ? 72 : 68);

  const feeBlock = {
    type: 'stack', direction: 'column', alignItems: 'center', gap: 0,
    children: [
      t('剩余话费', 7, 'medium', C.sub, { minScale: 0.6 }),
      {
        type: 'stack', direction: 'row', alignItems: 'end', gap: 1,
        children: [
          t('¥' + ds.fee.number, 12, 'bold', C.txt, { minScale: 0.45 }),
          t('元', 6.5, 'medium', C.sub),
        ],
      },
    ],
  };

  const rowOpt = small
    ? { labelSize: 7, valueSize: 10, unitSize: 6.5, iconSize: 8, labelW: 32, valueW: 40, unitW: 14 }
    : (large
      ? { labelSize: 10, valueSize: 17, unitSize: 8.5, pctSize: 10, iconSize: 11, labelW: 50, valueW: 72, unitW: 20, pctW: 32 }
      : { labelSize: 9, valueSize: 13, unitSize: 7.5, pctSize: 9, iconSize: 10, labelW: 46, valueW: 64, unitW: 20, pctW: 34 });

  const rows = [
    iosRow('剩余话费', 'sf-symbol:yensign.circle.fill', C.fee, '¥' + ds.fee.number, '元', '', rowOpt),
  ];
  rows.push(iosRow('剩余流量', 'sf-symbol:wifi', C.flow, ds.flow.number, ds.flow.unit,
    (!small && remainPct != null) ? Math.round(remainPct * 100) + '%' : '', rowOpt));
  if (!small) {
    if (ds.directional && ds.directional.remain) {
      rows.push(iosRow('定向流量', 'sf-symbol:arrow.triangle.branch', C.cyan,
        ds.directional.remain.number, ds.directional.remain.unit,
        ds.directionalPct != null ? Math.round(ds.directionalPct * 100) + '%' : '', rowOpt));
    } else if (ds.otherUsedMB != null) {
      const other = formatFlow(Math.round(ds.otherUsedMB * 1024));
      rows.push(iosRow('其他流量', 'sf-symbol:chart.pie.fill', C.cyan, other.number, other.unit, '已用', rowOpt));
    }
  }
  rows.push(iosRow('剩余语音', 'sf-symbol:phone.fill', C.green, ds.voice.number, ds.voice.unit,
    (!small && voicePct != null) ? Math.round(voicePct * 100) + '%' : '', rowOpt));

  const ringCol = {
    type: 'stack', direction: 'column', alignItems: 'center', gap: 1,
    children: [
      { type: 'image', src: ringsSvg(ringItems, ringSize), width: ringSize, height: ringSize },
      ...(small ? [] : []),
    ],
  };

  const account = null;
  const today = todayFlowUsage(ds.history);
  const todayUsed = today.value == null ? null : formatFlow(today.value);
  const remainRaw = ds.plan && ds.plan.remain != null ? ds.plan.remain : null;
  const enough = remainRaw != null && today.value ? Math.max(0, Math.floor(remainRaw / today.value)) : null;

  const smallRight = {
    type: 'stack', direction: 'column', gap: 3, flex: 1,
    children: [
      { type: 'image', src: historySvg(today.history, C.flow, 80, 18), width: 50, height: 14 },
      t('今日 ' + (todayUsed ? todayUsed.number + ' ' + todayUsed.unit : '—'), 7.5, 'medium', C.txt, { minScale: 0.5 }),
      t(enough != null ? '预计 ' + enough + ' 天 ✓' : '预计 —', 7.5, 'semibold', C.green, { minScale: 0.5 }),
    ],
  };

  const body = small
    ? [
        {
          type: 'stack', direction: 'row', alignItems: 'center', gap: 8,
          children: [ringCol, smallRight],
        },
        { type: 'stack', direction: 'column', gap: 3, children: rows },
      ]
    : [
        {
          type: 'stack',
          direction: 'row',
          alignItems: 'center',
          gap: large ? 14 : 10,
          ...(large ? { flex: 1 } : {}),
          children: [
            ringCol,
            { type: 'stack', direction: 'column', gap: large ? 10 : 7, flex: 1, children: rows },
          ],
        },
        ...(large ? [dashboardLower(ds)] : [altStrip(ds, false)]),
        ...(account ? [account] : []),
      ];

  return {
    type: 'widget',

    refreshAfter: nextRefreshAfter(ds),
    padding: small ? [9, 11] : (large ? [14, 16] : [12, 14]),
    gap: small ? 4 : 7,
    backgroundColor: '#00000000',
    children: [altHeader(title, ds, 12, small), ...body],
  };
}

async function handleManualRefresh(ctx) {
  try {
    // 把缓存标记为过期，loadData 才会真正发起请求
    const cached = ctx.storage.getJSON('ct_datasource');
    if (cached && typeof cached === 'object') {
      cached.updatedAt = 0;
      ctx.storage.setJSON('ct_datasource', cached);
    }
    const raw = ctx.storage.getJSON('ct_raw');
    if (raw && typeof raw === 'object') {
      raw.at = 0;
      ctx.storage.setJSON('ct_raw', raw);
    }
    const res = await loadData(ctx);
    const data = res && res.data;
    if (typeof ctx.notify === 'function') {
      if (data && data.flow && data.fee) {
        ctx.notify({
          title: '中国电信数据已刷新',
          body: '流量 ' + data.flow.number + ' ' + data.flow.unit + ' · 话费 ¥' + data.fee.number,
          sound: false,
        });
      } else {
        ctx.notify({
          title: '中国电信刷新失败',
          body: '请检查手机号/服务密码/设备ID 是否正确',
          sound: false,
        });
      }
    }
  } catch (e) {
    console.log('[ChinaTelecom] 手动刷新失败: ' + String((e && e.message) || e));
  }
}

async function handleWidget(ctx) {
  const title = String((ctx.env && ctx.env.CT_TITLE) || '中国电信').trim() || '中国电信';
  const result = await loadData(ctx);
  if (!result.configured) return buildError(title, '请在模块设置里填写手机号、服务密码和设备ID（设备ID 获取方式见模块说明）');
  if (!result.data) {
    return buildError(
      title,
      result.error && result.error.kind === 'auth'
        ? '登录状态已失效，请检查手机号/服务密码/设备ID 是否正确'
        : '数据获取失败，请稍后刷新重试'
    );
  }
  const ds = result.data;
  // 渲染时补一个采样点（saveHistory 内部 25 分钟去重）
  try {
    const remainForHistory = ds.plan && ds.plan.remain != null ? ds.plan.remain : null;
    if (remainForHistory != null) {
      const hist = saveHistory(ctx, remainForHistory, Array.isArray(ds.history) ? ds.history : []);
      if (Array.isArray(hist)) ds.history = hist;
    }
  } catch (e) {
    // 采样失败不影响渲染
  }

  const family = ctx.widgetFamily || 'systemSmall';
  if (family.startsWith('accessory')) return buildLock(title, ds, family);
  // 显示样式：classic = 当前样式，dash = 仪表盘版，ios = 圆环列表版
  const uiStyle = String((ctx.env && ctx.env.CT_UI_STYLE) || 'classic').toLowerCase();
  if (uiStyle === 'dash' || uiStyle === 'ios') {
    return uiStyle === 'dash' ? buildDash(family, title, ds) : buildIos(family, title, ds);
  }
  if (family === 'systemMedium') return liquidGlassWidget(buildMedium(title, ds, result.fromCache));
  if (family === 'systemLarge' || family === 'systemExtraLarge') return liquidGlassWidget(buildLarge(title, ds, result.fromCache));
  return liquidGlassWidget(buildSmall(title, ds, result.fromCache));
}

export default async function(ctx) {
  // 手动运行（脚本列表里没有 widgetFamily）时执行一次强制刷新，而不是渲染组件
  if (ctx && !ctx.widgetFamily) {
    await handleManualRefresh(ctx);
    return;
  }
  try {
    const widget = await handleWidget(ctx || {});
    if (widget && widget.type === 'widget') return widget;
    return buildError('中国电信', '组件返回内容异常，请刷新模块');
  } catch (e) {
    return buildError('中国电信', '组件渲染异常：' + String(e && e.message ? e.message : e).slice(0, 80));
  }
}
