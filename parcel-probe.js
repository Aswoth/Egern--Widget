/**
 * 包裹抓包探针（Egern 版）
 *
 * 目的：验证“网上国网那套”能不能用在淘宝/菜鸟身上——
 *   Egern MITM 抓到淘宝登录 cookie（_m_h5_tk 等）后，
 *   定时脚本能不能拿它调通菜鸟 MTOP 接口（我的包裹列表，含取件码）。
 *
 * 两个入口，共用同一个文件（按 ctx 里有什么分支）：
 *   1) http_response（parcel-probe-capture）：
 *      只读请求头 Cookie 和响应头 Set-Cookie，不读响应体、不改任何请求。
 *      抓到 _m_h5_tk 就存进 ctx.storage，并发一次通知（通知里不带 cookie 值）。
 *      另外每个域名带了哪些 cookie 名（只记名不记值），实时上报，
 *      用于诊断小程序/原生 App 用的凭证跟淘宝是不是同一套。
 *      通知是实时的：事件类通知 60 秒冷却（1 分钟内同种只报一次，
 *      超过 1 分钟再有就再报）；内容变了立刻报，不等冷却。
 *      v2：MITM 与匹配新增 acs.m.taobao.com（淘宝原生 App 的 MTOP 网关）。
 *   3) http_response（parcel-probe-body，v3）：
 *      只对 h5api / *.cainiao.com 生效且 body_required，读到响应体是包裹列表
 *      （data.packages）就存一份精简快照，原样把响应体返回，不改内容。
 *      这样不用调接口也能拿到数据：打开菜鸟 App/小程序刷一次就有快照。
 *   2) schedule（parcel-probe-check，每 10 分钟）：
 *      读存下的 cookie，用原 App 同款签名（纯 MD5，appKey 12574478）
 *      调一次菜鸟“我的包裹”接口，把结果发通知：
 *        调通了 / token 过期刷不回来 / 接口不通 / 读不到 cookie（存储不互通）。
 *
 * 安全说明：cookie 只存在本机脚本存储里，不上传、不进通知；
 * 探针不改请求、不读响应体；测完删模块即可。
 * MTOP 协议要点（原 App utils/mtop.ts、utils/cainiao.ts）：
 *   网关 https://h5api.m.taobao.com/h5/<api 小写>/<version>/
 *   签名 md5("{_m_h5_tk 的 token 段}&{t}&{appKey}&{data}")，appKey 固定 12574478
 *   列表接口 mtop.cainiao.lpc.packageservice.queryPdsPackageDataList
 */

const PROBE_VERSION = 'v10';

const APP_KEY = '12574478';
const MTOP_HOST = 'https://h5api.m.taobao.com';
const MTOP_LIST_API = 'mtop.cainiao.lpc.packageservice.queryPdsPackageDataList';
const REFRESH_URL = 'https://h5.m.taobao.com/';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const REFERER = 'https://h5.m.taobao.com/';
const NEED_DYN = "{'needFindTemporality':true,'needAppointment':true}";

const COOKIES_KEY = 'probe.cookies.v1';
const HITS_KEY = 'probe.hits.v1';
const NOTED_KEY = 'probe.noted.v1';
const CHECK_KEY = 'probe.check.v1';
const NAMES_KEY = 'probe.cookienames.v1';
const SNAP_KEY = 'probe.parcels.v1';
const APIS_KEY = 'probe.apis.v1';
const BODYSHAPE_KEY = 'probe.bodyshape.v1';
const BODYREADS_KEY = 'probe.bodyreads.v1';
const BODYFAIL_KEY = 'probe.bodyfail.v1';

/* 只存这几个淘宝 cookie，其余一律不碰 */
const WANT_COOKIES = ['_m_h5_tk', 'cookie2', 't', '_tb_token_', 'cna', 'xlly_s'];

/* ---------------- MD5（纯 JS，RFC 1321，与 parcel.js 同一份） ---------------- */

function md5Hex(input) {
  function rl(n, c) { return (n << c) | (n >>> (32 - c)); }
  function add(x, y) {
    const l = (x & 0xffff) + (y & 0xffff);
    const m = (x >> 16) + (y >> 16) + (l >> 16);
    return (m << 16) | (l & 0xffff);
  }
  const K = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ];
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const bytes = [];
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c < 0xdc00) {
      const c2 = input.charCodeAt(++i);
      const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
      bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 0; i < 8; i++) bytes.push(Math.floor(bitLen / Math.pow(2, i * 8)) & 0xff);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < bytes.length; off += 64) {
    const M = [];
    for (let i = 0; i < 16; i++) {
      M.push(bytes[off + i * 4] | (bytes[off + i * 4 + 1] << 8) | (bytes[off + i * 4 + 2] << 16) | (bytes[off + i * 4 + 3] << 24));
    }
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const tmp = d;
      d = c;
      c = b;
      b = add(b, rl(add(add(a, f), add(K[i], M[g])), S[i]));
      a = tmp;
    }
    a0 = add(a0, a); b0 = add(b0, b); c0 = add(c0, c); d0 = add(d0, d);
  }
  function hex(n) {
    let s = '';
    for (let i = 0; i < 4; i++) s += ('0' + ((n >> (i * 8)) & 0xff).toString(16)).slice(-2);
    return s;
  }
  return hex(a0) + hex(b0) + hex(c0) + hex(d0);
}

/* ---------------- 小工具 ---------------- */

function loadJSON(ctx, key) {
  try { return ctx.storage.getJSON(key); } catch (e) { return null; }
}
function saveJSON(ctx, key, val) {
  try { ctx.storage.setJSON(key, val); } catch (e) { /* 忽略 */ }
}
/* 实时通知：同一件事不是只报一次，而是冷却多久就再报一次。
 * cooldownMs 省略（0）= 只报一次，留给状态类事实（tk-ok、storage-split）。
 * 事件类通知传 60000：1 分钟内同种只报一次，免得一次打开刷几十条；
 * 超过 1 分钟再有就再报。旧版存的是时间戳，直接沿用。 */
function noted(ctx, flag, cooldownMs) {
  const n = loadJSON(ctx, NOTED_KEY) || {};
  const t = n[flag];
  const cd = cooldownMs || 0;
  if (t === true) return true;
  if (typeof t === 'number') {
    if (cd === 0) return true;
    if (Date.now() - t < cd) return true;
  }
  n[flag] = Date.now();
  saveJSON(ctx, NOTED_KEY, n);
  return false;
}
function notify(ctx, title, body) {
  try { ctx.notify({ title, body }); } catch (e) { /* 忽略 */ }
}
function hostOf(url) {
  try { return new URL(url).hostname; } catch (e) { return ''; }
}

/* 从 URL 里抠接口名：优先 api 查询参数，否则取 /h5/ 后面那段 */
function apiNameOf(url) {
  try {
    const u = new URL(url);
    const q = u.searchParams.get('api');
    if (q) return q;
    const m = u.pathname.match(/\/h5\/([^\/]+)/);
    if (m) return m[1];
    const segs = u.pathname.split('/').filter(Boolean);
    return segs.length ? segs.slice(-2).join('/') : u.pathname;
  } catch (e) { return ''; }
}

/* 从 "a=1; b=2" 或 ["a=1; Path=/", ...] 里只取 cookie 名（不记值），用于诊断各域名用哪种凭证。
 * Set-Cookie 只有第一段是真 cookie，后面是 Path/Domain 之类的属性，firstOnly 时只取第一段。 */
function cookieNames(values, firstOnly) {
  const out = [];
  const list = Array.isArray(values) ? values : (values ? [values] : []);
  for (const raw of list) {
    if (!raw) continue;
    const segments = String(raw).split(';');
    const parts = firstOnly ? segments.slice(0, 1) : segments;
    for (const part of parts) {
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      const name = part.slice(0, eq).trim();
      if (name && out.indexOf(name) === -1) out.push(name);
    }
  }
  return out;
}

/* 从 "a=1; b=2" 或 ["a=1; Path=/", "b=2; ..."] 里抠出想要的 cookie */
function pickCookies(values) {
  const out = {};
  const list = Array.isArray(values) ? values : (values ? [values] : []);
  for (const raw of list) {
    if (!raw) continue;
    for (const part of String(raw).split(';')) {
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      const name = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (WANT_COOKIES.indexOf(name) !== -1 && value) out[name] = value;
    }
  }
  return out;
}

/* ---------------- 抓包分支（http_response） ---------------- */

async function onResponse(ctx) {
  const url = (ctx.request && ctx.request.url) || '';
  const host = hostOf(url);
  const now = Date.now();

  const hits = loadJSON(ctx, HITS_KEY) || { count: 0, hosts: {}, firstAt: 0, lastAt: 0 };
  hits.count += 1;
  hits.hosts[host] = (hits.hosts[host] || 0) + 1;
  if (!hits.firstAt) hits.firstAt = now;
  hits.lastAt = now;
  saveJSON(ctx, HITS_KEY, hits);

  /* 记接口名：看看到底调了哪些接口，列表接口叫什么 */
  const api = apiNameOf(url);
  if (api) {
    const apis = loadJSON(ctx, APIS_KEY) || {};
    if (apis[api] !== undefined || Object.keys(apis).length < 30) {
      apis[api] = (apis[api] || 0) + 1;
      saveJSON(ctx, APIS_KEY, apis);
    }
  }

  /* 第一次有请求穿过脚本 = MITM 对这个域名生效了（实时：60 秒冷却） */
  if (!noted(ctx, 'mitm-ok', 60000)) {
    notify(ctx, '探针：MITM 生效', '已看到 ' + host + ' 的请求，抓包链路通了');
  }

  /* 诊断：这个域名带了哪些 cookie 名（只记名，不记值）。小程序/原生 App
   * 可能用淘宝以外的凭证，先看名字再决定存什么。 */
  let reqCookie = null;
  let setCookies = [];
  try { reqCookie = ctx.request.headers.get('cookie'); } catch (e) { /* 忽略 */ }
  try { setCookies = ctx.response.headers.getAll('set-cookie') || []; } catch (e) { /* 忽略 */ }
  const reqNames = cookieNames(reqCookie);
  const seenNames = reqNames.concat(cookieNames(setCookies, true).filter(n => reqNames.indexOf(n) === -1));
  if (seenNames.length > 0) {
    const allNames = loadJSON(ctx, NAMES_KEY) || {};
    if (!allNames[host]) {
      allNames[host] = seenNames;
      saveJSON(ctx, NAMES_KEY, allNames);
    }
    if (!noted(ctx, 'names-' + host, 60000)) {
      notify(ctx, '探针：看到的 cookie 名', host + '：' + seenNames.join('、'));
    }
  } else if (!noted(ctx, 'nocookie-hdr-' + host, 60000)) {
    notify(ctx, '探针：没看到 Cookie 头', host + ' 的请求里没有 Cookie，可能是脚本读不到请求头');
  }

  const found = {};
  Object.assign(found, pickCookies(reqCookie));
  Object.assign(found, pickCookies(setCookies));

  const names = Object.keys(found);
  /* 注意：没有想要的 cookie 也不能直接 return，后面的体捕获还要跑 */
  const stored = loadJSON(ctx, COOKIES_KEY) || {};
  let changed = false;
  for (const k of names) {
    if (stored[k] !== found[k]) { stored[k] = found[k]; changed = true; }
  }
  if (changed) saveJSON(ctx, COOKIES_KEY, stored);

  if (found['_m_h5_tk'] && !noted(ctx, 'tk-ok')) {
    notify(ctx, '探针：抓到 _m_h5_tk', '淘宝登录 cookie 已存下，定时脚本会拿它试调菜鸟接口');
  }
  if (stored['_m_h5_tk'] && stored['cookie2'] && stored['t'] && !noted(ctx, 'all-ok')) {
    notify(ctx, '探针：cookie 齐了', '_m_h5_tk、cookie2、t 都已存下，等定时脚本的调通结果');
  }

  /* 抓响应体里的包裹列表（只在 body_required 的那条 entry 下才有 body，
   * 没 body 时 json() 会失败，直接透传。读到 body 就原样返回，不改内容。） */
  try {
    const data = await ctx.response.json();
    /* 体读到了：计数一次（用来判断体捕获入口到底有没有在跑），按接口分开记 */
    const reads = loadJSON(ctx, BODYREADS_KEY) || { count: 0, lastApi: '' };
    reads.count += 1;
    reads.lastApi = api || '';
    if (api) {
      reads.perApi = reads.perApi || {};
      reads.perApi[api] = (reads.perApi[api] || 0) + 1;
    }
    saveJSON(ctx, BODYREADS_KEY, reads);
    if (data && typeof data === 'object') {
      let d = mtopData(data);
      /* 有的接口（小程序的 lightapp 列表）把 data 包成 JSON 字符串 */
      if (typeof d === 'string') {
        try {
          const parsed = JSON.parse(d);
          if (parsed && typeof parsed === 'object') d = mtopData({ data: parsed }) || parsed;
        } catch (e) { /* 不是 JSON 字符串，保持原样 */ }
      }
      /* 记体结构：这个接口的 data 里都有哪些字段，列表到底叫什么。
       * 小程序 lightapp 列表的 data 是 { result: ... }，再记一层 result 的字段。 */
      if (api) {
        const shapes = loadJSON(ctx, BODYSHAPE_KEY) || {};
        if (!shapes[api]) {
          if (d && typeof d === 'object') {
            shapes[api] = { keys: Object.keys(d).slice(0, 12) };
            if (d.result && typeof d.result === 'object' && !Array.isArray(d.result)) {
              shapes[api].resultKeys = Object.keys(d.result).slice(0, 12);
            }
          } else if (d === null) {
            shapes[api] = { type: 'null' };
          } else if (d !== undefined) {
            shapes[api] = { type: typeof d };
          }
          if (shapes[api]) {
            shapes[api].ret = retOf(data, '').slice(0, 30);
            const ks = Object.keys(shapes);
            if (ks.length > 8) delete shapes[ks[0]];
            saveJSON(ctx, BODYSHAPE_KEY, shapes);
          }
        }
      }
      const list = findList(d);
      if (list) {
        const pkgs = list.map(trimPackage).filter(Boolean);
        const withCode = pkgs.filter(p => p.pickupCode).length;
        const sig = pkgs.length + '/' + withCode;
        const prev = loadJSON(ctx, SNAP_KEY);
        saveJSON(ctx, SNAP_KEY, { at: Date.now(), count: pkgs.length, withCode: withCode, sig: sig, packages: pkgs });
        /* 实时：内容变了立刻报；内容没变，超过 1 分钟也再报一次 */
        const listDue = !noted(ctx, 'list', 60000);
        if (!prev || prev.sig !== sig || listDue) {
          notify(ctx, '探针：抓到包裹列表', pkgs.length + ' 个包裹，其中 ' + withCode + ' 个有取件码');
        }
      }
      return { body: data };
    }
  } catch (e) {
    /* 体没读到：记下来是哪个接口、错在哪、状态码是多少。
     * 读不到和“入口没跑”是两回事，这个数能分清。 */
    try {
      const fails = loadJSON(ctx, BODYFAIL_KEY) || {};
      const key = api || '(unknown)';
      const f = fails[key] || { n: 0, err: '', status: 0 };
      f.n += 1;
      f.err = String((e && e.message) || e).slice(0, 50);
      try { f.status = ctx.response.status || 0; } catch (e2) { /* 忽略 */ }
      fails[key] = f;
      saveJSON(ctx, BODYFAIL_KEY, fails);
    } catch (e2) { /* 探针自己不出错 */ }
  }
  return undefined;
}

/* 把菜鸟列表里一条包裹精简成快照字段（字段名与原 App cainiao.ts 一致） */
const CODE_PLACEHOLDER = ['needsms', 'need_sms', '-1', '0', '', 'null', 'none'];
function pickStr(o) {
  if (!o || typeof o !== 'object') return '';
  for (let i = 1; i < arguments.length; i++) {
    const v = o[arguments[i]];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}
/* 原 App mtop.ts 的 mtopData：响应可能是 data.data 双层包 */
function mtopData(j) {
  const d = j && j.data;
  if (d && typeof d === 'object' && d.data !== undefined) return d.data;
  return d || null;
}

/* 在响应里找包裹数组：原版是 data.packages，小程序 lightapp 是
 * data.result（对象里再套 packages/packageList/list，或直接就是数组）。 */
function findList(d) {
  if (!d || typeof d !== 'object') return null;
  if (Array.isArray(d.packages)) return d.packages;
  if (Array.isArray(d.packageList)) return d.packageList;
  const r = d.result;
  if (Array.isArray(r)) return r;
  if (r && typeof r === 'object') {
    if (Array.isArray(r.packages)) return r.packages;
    if (Array.isArray(r.packageList)) return r.packageList;
    if (Array.isArray(r.list)) return r.list;
    if (Array.isArray(r.items)) return r.items;
  }
  if (Array.isArray(d.list)) return d.list;
  if (Array.isArray(d.items)) return d.items;
  return null;
}

function trimPackage(p) {
  if (!p || typeof p !== 'object') return null;
  const st = p.packageStation || {};
  const feat = p.feature || {};
  const items = Array.isArray(p.packageItem) ? p.packageItem : [];
  /* 取件码取法与原 App cainiao.ts 的 pickupCodeOf 一致：
   * authCode 优先；是占位符（NEEDSMS 等）就试 showPickupCode（“true”/“false”
   * 只是开关不是码）；再试 feature 里的 stationOrderPickUpCode */
  let code = pickStr(st, 'authCode', 'auth_code');
  if (!code || CODE_PLACEHOLDER.indexOf(code.toLowerCase()) !== -1) {
    const alt = pickStr(st, 'showPickupCode', 'show_pickup_code', 'pickUpCode', 'pickupCode');
    code = (alt && alt.toLowerCase() !== 'true' && alt.toLowerCase() !== 'false')
      ? alt : pickStr(feat, 'stationOrderPickUpCode', 'station_order_pick_up_code');
  }
  if (code && CODE_PLACEHOLDER.indexOf(code.toLowerCase()) !== -1) code = '';
  const first = items[0] || {};
  return {
    mailNo: pickStr(p, 'mailNo', 'mail_no'),
    title: pickStr(feat, 'recommendPackageTitle', 'recommend_package_title')
      || pickStr(p, 'userRemark')
      || pickStr(first, 'itemTitle', 'item_title'),
    company: pickStr(p, 'cpName', 'cp_name', 'companyName') || pickStr(p, 'cpCode', 'cp_code'),
    pickupCode: code,
    station: pickStr(st, 'pointName', 'point_name', 'stationName', 'name'),
    status: pickStr(p, 'status', 'statusDesc', 'packageStatus'),
  };
}

/* ---------------- 定时验证分支（schedule） ---------------- */

function tokenOf(cookies) {
  const v = cookies['_m_h5_tk'] || '';
  return String(v).split('_')[0];
}
function cookieHeader(cookies) {
  return Object.keys(cookies).map(k => k + '=' + cookies[k]).join('; ');
}

async function mtopList(cookies) {
  const data = JSON.stringify({
    pageSize: 50, currentPage: 1,
    needTemporality: false, needDynInfo: NEED_DYN,
  });
  const t = Date.now();
  const sign = md5Hex(tokenOf(cookies) + '&' + t + '&' + APP_KEY + '&' + data);
  const url = MTOP_HOST + '/h5/' + MTOP_LIST_API.toLowerCase() + '/1.0/'
    + '?jsv=2.7.4&appKey=' + APP_KEY + '&t=' + t + '&sign=' + sign
    + '&api=' + encodeURIComponent(MTOP_LIST_API) + '&v=1.0&type=originaljson&dataType=json'
    + '&data=' + encodeURIComponent(data);
  const res = await ctxHttpGet(url, cookies);
  const txt = await res.text();
  let j = null;
  try { j = JSON.parse(txt); } catch (e) { /* 不是 JSON */ }
  return { res, txt, j };
}

/* 用 ctx.http 发请求（包一层，方便单测替换） */
let httpGetImpl = null;
async function ctxHttpGet(url, cookies) {
  if (httpGetImpl) return httpGetImpl(url, cookies);
  const headers = { Cookie: cookieHeader(cookies), 'User-Agent': UA, Referer: REFERER, Accept: 'application/json' };
  return ctxHttp().get(url, { headers: headers, timeout: 15000 });
}
let ctxRef = null;
function ctxHttp() { return ctxRef.http; }

async function refreshToken(cookies) {
  const res = await ctxRef.http.get(REFRESH_URL, {
    headers: { Cookie: cookieHeader(cookies), 'User-Agent': UA, Referer: REFERER },
    timeout: 15000,
  });
  await res.text().catch(() => '');
  let setCookies = [];
  try { setCookies = res.headers.getAll('set-cookie') || []; } catch (e) { /* 忽略 */ }
  const fresh = pickCookies(setCookies);
  if (fresh['_m_h5_tk']) {
    const merged = Object.assign({}, cookies, fresh);
    saveJSON(ctxRef, COOKIES_KEY, merged);
    return merged;
  }
  return null;
}

function retOf(j, txt) {
  if (j && Array.isArray(j.ret)) return j.ret.join(';');
  if (j && typeof j.ret === 'string') return j.ret;
  if (j && j.ret) return String(j.ret);
  return (txt || '').slice(0, 80) || '无响应';
}

function countPackages(j) {
  const d = mtopData(j);
  return (d && Array.isArray(d.packages)) ? d.packages.length : 0;
}

async function onSchedule(ctx) {
  ctxRef = ctx;
  const cookies = loadJSON(ctx, COOKIES_KEY) || {};
  const check = loadJSON(ctx, CHECK_KEY) || {};

  /* 抓包那边已经抓到了，但定时脚本读不到 = 存储不互通 */
  if (!cookies['_m_h5_tk']) {
    check.last = '无 _m_h5_tk，等待抓包';
    saveJSON(ctx, CHECK_KEY, check);
    if (loadJSON(ctx, NOTED_KEY) && loadJSON(ctx, NOTED_KEY)['tk-ok']) {
      if (!noted(ctx, 'storage-split')) {
        notify(ctx, '探针：存储不互通', '抓包脚本存的 cookie，定时脚本读不到；换种写法再试');
      }
      return;
    }
    if (!noted(ctx, 'nocookie', 3600000)) {
      notify(ctx, '探针：还没抓到 cookie', '打开淘宝或菜鸟 App 刷一刷，再等 10 分钟');
    }
    return;
  }

  let r;
  try {
    r = await mtopList(cookies);
  } catch (e) {
    const msg = '请求失败：' + String((e && e.message) || e).slice(0, 60);
    if (check.last !== msg) {
      check.last = msg;
      saveJSON(ctx, CHECK_KEY, check);
      notify(ctx, '探针：接口不通', msg);
    }
    return;
  }

  let ret = retOf(r.j, r.txt);
  const upper = ret.toUpperCase();
  if (upper.indexOf('SUCCESS') !== -1) {
    const n = countPackages(r.j);
    if (check.last !== 'ok') {
      check.last = 'ok';
      saveJSON(ctx, CHECK_KEY, check);
      notify(ctx, '探针：MTOP 调通了', '菜鸟“我的包裹”返回 ' + n + ' 个包裹，全自动版可以做了');
    }
    return;
  }

  /* token 过期：拿 session cookie 去 h5.m.taobao.com 刷一次再试 */
  if (upper.indexOf('TOKEN_EXPIRED') !== -1 || upper.indexOf('TOKEN_EXOIRED') !== -1
      || upper.indexOf('TOKEN_EMPTY') !== -1 || upper.indexOf('FAIL_SYS_TOKEN') !== -1) {
    try {
      const fresh = await refreshToken(cookies);
      if (fresh) {
        const r2 = await mtopList(fresh);
        const ret2 = retOf(r2.j, r2.txt);
        if (ret2.toUpperCase().indexOf('SUCCESS') !== -1) {
          const n = countPackages(r2.j);
          if (check.last !== 'ok') {
            check.last = 'ok';
            saveJSON(ctx, CHECK_KEY, check);
            notify(ctx, '探针：MTOP 调通了', 'token 刷过一次后调通，菜鸟列表 ' + n + ' 个包裹');
          }
          return;
        }
        ret = ret2;
      }
    } catch (e) { /* 刷新失败，走下面的失败通知 */ }
  }

  const msg = '菜鸟接口返回：' + ret.slice(0, 60);
  if (check.last !== msg) {
    check.last = msg;
    saveJSON(ctx, CHECK_KEY, check);
    notify(ctx, '探针：接口不通', msg);
  }
}

/* ---------------- 手动状态查询（generic，点运行就报一次现状） ----------------
 * 通知是去重的，报过就不再报，光看“有没有新通知”分不清是没抓到还是
 * 已经抓过了。这个入口就是用来查的：把存储里的现状一次性发出来。 */

/* 接口名太长，显示时去掉 mtop. 前缀和 /1.0 后缀，只留能认出来的部分 */
function shortApi(a) { return String(a).replace(/^mtop\./, '').replace(/\/1\.0$/, ''); }

async function onStatus(ctx) {
  /* 第一条：概况。短，横幅里能看全。 */
  const lines = ['版本 ' + PROBE_VERSION];
  const hits = loadJSON(ctx, HITS_KEY);
  if (hits && hits.count > 0) {
    const parts = [];
    for (const h of Object.keys(hits.hosts || {})) parts.push(h + '(' + hits.hosts[h] + ')');
    lines.push('见过请求：' + parts.join('、'));
  } else {
    lines.push('还没见过任何匹配请求');
  }
  const cookies = loadJSON(ctx, COOKIES_KEY) || {};
  const names = Object.keys(cookies);
  lines.push('_m_h5_tk：' + (cookies['_m_h5_tk'] ? '已抓到' : '未抓到')
    + (names.length ? '（已存 ' + names.join('、') + '）' : '（未存 cookie）'));
  const reads = loadJSON(ctx, BODYREADS_KEY) || { count: 0, lastApi: '' };
  lines.push('已读响应体：' + reads.count + ' 次'
    + (reads.lastApi ? '（最近 ' + shortApi(reads.lastApi) + '）' : ''));
  const snap = loadJSON(ctx, SNAP_KEY);
  if (snap && snap.count > 0) {
    lines.push('包裹快照：' + snap.count + ' 个，其中 ' + (snap.withCode || 0) + ' 个有取件码');
  } else {
    lines.push('包裹快照：无');
  }
  const check = loadJSON(ctx, CHECK_KEY) || {};
  if (check.last) lines.push('上次定时检查：' + String(check.last).slice(0, 40));
  notify(ctx, '探针状态', lines.join('\n'));

  /* 第二条：接口与体结构。单发一条，免得被系统截断。 */
  const lines2 = [];
  const apis = loadJSON(ctx, APIS_KEY) || {};
  const apiKeys = Object.keys(apis);
  const topApis = apiKeys.sort((a, b) => apis[b] - apis[a]).slice(0, 5);
  if (topApis.length) {
    lines2.push('接口：' + topApis.map(a => shortApi(a) + '(' + apis[a] + ')').join('、')
      + (apiKeys.length > 5 ? '，等共 ' + apiKeys.length + ' 个' : ''));
  } else {
    lines2.push('接口：还没记到');
  }
  const shapes = loadJSON(ctx, BODYSHAPE_KEY) || {};
  const shapeKeys = Object.keys(shapes);
  if (shapeKeys.length) {
    for (const k of shapeKeys.slice(0, 8)) {
      const s = shapes[k];
      const ret = s.ret ? '，ret=' + s.ret : '';
      if (s.keys) {
        const rk = s.resultKeys ? '（result 内有 ' + s.resultKeys.join('、') + '）' : '';
        lines2.push('体结构 ' + shortApi(k) + '：data 有 ' + (s.keys.length ? s.keys.join('、') : '（空对象）') + rk + ret);
      } else if (s.type) {
        lines2.push('体结构 ' + shortApi(k) + '：data 是 ' + s.type + '，不是对象' + ret);
      }
    }
  } else {
    lines2.push('体结构：还没记到');
  }
  const fails = loadJSON(ctx, BODYFAIL_KEY) || {};
  const failKeys = Object.keys(fails).sort((a, b) => fails[b].n - fails[a].n).slice(0, 3);
  if (failKeys.length) {
    for (const k of failKeys) {
      const f = fails[k];
      lines2.push('体读失败 ' + shortApi(k) + '：' + f.n + ' 次（' + (f.err || '无错误信息') + '，状态 ' + (f.status || '?') + '）');
    }
  } else {
    lines2.push('体读失败：无');
  }
  /* 列表接口单列一行：调了几次、体读到几次、失败几次，一眼看清 */
  const listKeys = Object.keys(apis).filter(a => a.indexOf('querypackagelist') !== -1 || a.indexOf('queryPdsPackageDataList') !== -1);
  for (const la of listKeys) {
    const r = (reads.perApi && reads.perApi[la]) || 0;
    const f = (fails[la] && fails[la].n) || 0;
    lines2.push('列表接口 ' + shortApi(la) + '：调了 ' + apis[la] + ' 次，体读到 ' + r + ' 次，失败 ' + f + ' 次');
  }
  notify(ctx, '探针状态·接口', lines2.join('\n'));
}

/* ---------------- 入口 ---------------- */

export default async function (ctx) {
  try {
    if (ctx.response) { return await onResponse(ctx); }
    if (ctx.cron !== undefined && ctx.cron !== null) { await onSchedule(ctx); return; }
    /* 手动点运行（generic 入口）：报一次现状 */
    await onStatus(ctx);
  } catch (e) { /* 探针自己不出错、不挡请求 */ }
}
