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
 *      另外每个域名第一次出现时上报一次它带了哪些 cookie 名（只记名不记值），
 *      用于诊断小程序/原生 App 用的凭证跟淘宝是不是同一套。
 *      v2：MITM 与匹配新增 acs.m.taobao.com（淘宝原生 App 的 MTOP 网关）。
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
function noted(ctx, flag) {
  const n = loadJSON(ctx, NOTED_KEY) || {};
  if (n[flag]) return true;
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

  /* 第一次有请求穿过脚本 = MITM 对这个域名生效了 */
  if (!noted(ctx, 'mitm-ok')) {
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
      if (!noted(ctx, 'names-' + host)) {
        notify(ctx, '探针：看到的 cookie 名', host + '：' + seenNames.join('、'));
      }
    }
  } else if (!noted(ctx, 'nocookie-hdr-' + host)) {
    notify(ctx, '探针：没看到 Cookie 头', host + ' 的请求里没有 Cookie，可能是脚本读不到请求头');
  }

  const found = {};
  Object.assign(found, pickCookies(reqCookie));
  Object.assign(found, pickCookies(setCookies));

  const names = Object.keys(found);
  if (names.length === 0) return;

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

async function onSchedule(ctx) {
  ctxRef = ctx;
  const cookies = loadJSON(ctx, COOKIES_KEY) || {};
  const check = loadJSON(ctx, CHECK_KEY) || {};

  /* 抓包那边已经抓到了，但定时脚本读不到 = 存储不互通 */
  if (!cookies['_m_h5_tk']) {
    if (loadJSON(ctx, NOTED_KEY) && loadJSON(ctx, NOTED_KEY)['tk-ok']) {
      if (!noted(ctx, 'storage-split')) {
        notify(ctx, '探针：存储不互通', '抓包脚本存的 cookie，定时脚本读不到；换种写法再试');
      }
      return;
    }
    if (!noted(ctx, 'nocookie')) {
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
    const n = (r.j && r.j.data && Array.isArray(r.j.data.packages)) ? r.j.data.packages.length : 0;
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
          const n = (r2.j && r2.j.data && Array.isArray(r2.j.data.packages)) ? r2.j.data.packages.length : 0;
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

/* ---------------- 入口 ---------------- */

export default async function (ctx) {
  try {
    if (ctx.response) { await onResponse(ctx); return; }
    if (ctx.cron !== undefined && ctx.cron !== null) { await onSchedule(ctx); return; }
    /* 手动点运行：当作一次定时检查 */
    await onSchedule(ctx);
  } catch (e) { /* 探针自己不出错、不挡请求 */ }
}
