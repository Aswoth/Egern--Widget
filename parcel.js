/**
 * 包裹助手（Egern 版）v8
 *
 * 数据来源（按优先级）：
 *   1) 体捕获（主通道，探针 v10 已验证）：打开菜鸟 App 或小程序刷一次
 *      “我的包裹”，响应脚本直接读列表响应体存快照——不用登录凭证、
 *      不用手动填单号，到站就有取件码。抓取本身是静默的，只在有新包裹 /
 *      到站 / 签收 / 出码时才弹通知。
 *   2) MTOP 轮询（后台自动刷新）：需要淘宝登录凭证 _m_h5_tk。
 *      凭证抓取默认关闭（模块设置里的“抓取登录凭证”开关），打开后
 *      刷淘宝/菜鸟时存下凭证，定时脚本每 30 分钟调一次菜鸟接口；
 *      抓到一次后可以再把开关关掉——关掉就不再存任何凭证。
 *   3) 快递鸟 8001（可选补充）：填了密钥和运单号才能用，给没有菜鸟
 *      列表的单号查详细轨迹；运单号变了会强制查一次，和菜鸟快照合并，
 *      不会丢掉菜鸟的包裹。
 *
 * 快照统一形状：{ no, title, company, code, station, status, statusText,
 *   latest, arrivedAt, updatedAt }，status 是家族：arrived / delivered /
 *   transit / none。小组件与通知都只认这个形状。
 *
 * 入口（同一个文件）：
 *   http_response（parcel-capture）→ 读列表体 +（开关开时）存凭证
 *   schedule（parcel-refresh）→ MTOP 轮询，失败则快递鸟
 *   generic（parcel-widget）→ 小组件
 *   generic（parcel-status）→ 手动查一次现状
 */

const PARCEL_VERSION = 'v8';

const APP_KEY = '12574478';
const MTOP_HOST = 'https://h5api.m.taobao.com';
const MTOP_LIST_API = 'mtop.cainiao.lpc.packageservice.queryPdsPackageDataList';
const REFRESH_URL = 'https://h5.m.taobao.com/';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const REFERER = 'https://h5.m.taobao.com/';
const NEED_DYN = "{'needFindTemporality':true,'needAppointment':true}";

const QUERY_URL = 'https://api.kdniao.com/Ebusiness/EbusinessOrderHandle.aspx';
const AUTONUM_URL = 'https://www.kuaidi100.com/autonumber/autoComNum?resultv2=1&text=';
const KD100_UA = UA;

const SNAP_KEY = 'parcel.snapshot.v1';
const COOKIES_KEY = 'parcel.cookies.v1';
const CHECK_KEY = 'parcel.check.v1';
const SHIPPER_KEY = 'parcel.shippers.v1';
const FLAG_KEY = 'parcel.flags.v1';
const NOTED_KEY = 'parcel.noted.v1';
const TRACKINGS_KEY = 'parcel.trackings.v1';
const SNAP_TTL_MS = 30 * 60 * 1000;

const WANT_COOKIES = ['_m_h5_tk', 'cookie2', 't', '_tb_token_', 'cna', 'xlly_s'];

/* 状态判定（原 Scripting 版 model.ts / kdniao.ts 的正则）。
 * 注意：裸“自提/完成”不能算已签收——“待自提”是待取，“配送完成”才是签收。 */
const DELIVERED_RE = /已签收|签收成功|已妥投|妥投|已代收|代收成功|已自提|自提成功|取件成功|已取件|已完成|派送完成|配送完成|已送达|已领取|已投递/;
const PICKABLE = /待取件|已到站|已暂存|已存放|已放入|送达代收点|请及时取|请及时领取|凭取件码|待领取|已妥收|快递柜|驿站|代收点|待自提|待取货|已入柜|请凭码取件/;
const TRANSIT_ONLY = /转运中心|分拨中心|集散中心|运转中心|发往|已发出|正在派送|派件中|揽收|已到达[^，。]*中心/;

/* ---------------- MD5（纯 JS，RFC 1321） ---------------- */

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

/* Base64（只对 ASCII 字符串用，DataSign 就是对 MD5 十六进制串做的） */
function b64Ascii(str) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < str.length; i += 3) {
    const a = str.charCodeAt(i);
    const b = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
    const c = i + 2 < str.length ? str.charCodeAt(i + 2) : 0;
    const n = (a << 16) | (b << 8) | c;
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63];
    out += i + 1 < str.length ? chars[(n >> 6) & 63] : '=';
    out += i + 2 < str.length ? chars[n & 63] : '=';
  }
  return out;
}

/* 快递鸟签名：DataSign = urlencode(base64(md5(RequestData + AppKey) 的小写十六进制串)) */
function kdniaoSign(requestData, appKey) {
  return encodeURIComponent(b64Ascii(md5Hex(requestData + appKey)));
}

/* ---------------- 小工具 ---------------- */

function loadJSON(ctx, key) {
  try { return ctx.storage.getJSON(key); } catch (e) { return null; }
}
function saveJSON(ctx, key, val) {
  try { ctx.storage.setJSON(key, val); } catch (e) { /* 忽略 */ }
}
function notify(ctx, title, body) {
  try { ctx.notify({ title, body }); } catch (e) { /* 忽略 */ }
}
function flagSet(ctx, flag) {
  const f = loadJSON(ctx, FLAG_KEY) || {};
  if (f[flag]) return true;
  f[flag] = 1;
  saveJSON(ctx, FLAG_KEY, f);
  return false;
}
/* 冷却通知：同一件事 ms 内只报一次，过期再报（目前未用，留作以后） */
function notedCooldown(ctx, flag, ms) {
  const n = loadJSON(ctx, NOTED_KEY) || {};
  const t = n[flag];
  if (typeof t === 'number' && Date.now() - t < ms) return true;
  n[flag] = Date.now();
  saveJSON(ctx, NOTED_KEY, n);
  return false;
}
/* 抓取登录凭证的开关：env_schema 里 options ["true","false"] 生成 Toggle，
 * 没碰过开关时 env 里没有这个键，默认关。值是字符串 "true"/"false"。 */
function cookieCaptureOn(ctx) {
  const v = (ctx.env || {}).ENABLE_COOKIE_CAPTURE;
  return v === true || String(v).toLowerCase() === 'true';
}

/* 从 "a=1; b=2" 或 ["a=1; Path=/", ...] 里抠出想要的 cookie（只记值，不记无关项） */
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
function tokenOf(cookies) {
  const v = cookies['_m_h5_tk'] || '';
  return String(v).split('_')[0];
}
function cookieHeader(cookies) {
  return Object.keys(cookies).map(k => k + '=' + cookies[k]).join('; ');
}

/* ---------------- 菜鸟列表解析（探针 v6/v10 已验证） ---------------- */

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
/* 状态文案 → 家族。原 App 的状态码：SIGN/CANCEL/REJECT/RETURN/LOST 都是已完结，
 * PICKUP 是待取；轻应用接口的状态码可能是 DELIVERED/SIGNED 这类英文，也认。
 * 中文文案走正则。 */
function familyOf(raw, code) {
  const s = String(raw || '');
  if (DELIVERED_RE.test(s)) return 'delivered';
  const up = s.trim().toUpperCase();
  if (/^(SIGN|SIGNED|DELIVERED|DELIVERY_SUCCESS|SIGN_SUCCESS|DELIVERED_SUCCESS|SIGNED_SUCCESS|SUCCESS|COMPLETE|COMPLETED|FINISHED|DONE|CANCEL|REJECT|RETURN|LOST)$/.test(up) || /^(DELIVERED|SIGNED)_/.test(up)) return 'delivered';
  if (/^(PICKUP|PICK_UP|ARRIVED|ARRIVAL|AT_STATION|IN_STATION|WAITING_PICKUP|READY_PICKUP)$/i.test(s.trim())) return 'arrived';
  if (/^(TRANSIT|IN_TRANSIT|ON_THE_WAY|SHIPPING|TRANSPORT|INTRANSIT)$/i.test(s.trim())) return 'transit';
  if (/PICKUP/i.test(s)) return 'arrived';
  if (PICKABLE.test(s)) return 'arrived';
  if (code) return 'arrived';
  return s ? 'transit' : 'none';
}
/* 状态候选全收集：一个包裹可能有多个互相冲突的状态字段（顶层一个粗状态、
 * 嵌套里一个细状态），只取第一个会被粗状态挡住；时间/日期字段不是状态，
 * 比如 signDate 里的时间戳不能当成状态文案。 */
function scanStatusCandidates(obj, depth, out) {
  if (!obj || typeof obj !== 'object' || depth > 2) return;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (/status|state|sign|deliver/i.test(k) && !/company|express|carrier|name|time|date|no|number/i.test(k)
        && (typeof v === 'string' || typeof v === 'number') && String(v) !== '') out.push(String(v));
    if (v && typeof v === 'object') scanStatusCandidates(v, depth + 1, out);
  }
}
/* 多个候选按 已签收 > 待取 > 在途 取最“靠后”的一个；打平时取第一个（顶层优先）。 */
function bestStatus(cands) {
  let best = '', bestRank = -1;
  for (const c of cands) {
    const f = familyOf(c, '');
    const rank = f === 'delivered' ? 2 : f === 'arrived' ? 1 : 0;
    if (rank > bestRank) { bestRank = rank; best = c; }
  }
  return best;
}
/* 在包裹对象里按 key 的意思找字段：轻应用接口的字段名和 H5 版不完全一样，
 * 先扫本层、再往 feature/packageStation 等嵌套对象里找（最多两层）。 */
function scanField(obj, keyRe, skipRe, depth) {
  if (!obj || typeof obj !== 'object') return '';
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (keyRe.test(k) && !skipRe.test(k) && (typeof v === 'string' || typeof v === 'number') && String(v) !== '') return String(v);
  }
  if (depth >= 2) return '';
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === 'object') {
      const r = scanField(v, keyRe, skipRe, depth + 1);
      if (r) return r;
    }
  }
  return '';
}
const CARRIER_NAMES = { YUNDA: '韵达快递', SF: '顺丰速运', SHUNFENG: '顺丰速运', ZTO: '中通快递', ZHONGTONG: '中通快递', YTO: '圆通速递', YUANTONG: '圆通速递', STO: '申通快递', SHENTONG: '申通快递', JD: '京东快递', JT: '极兔速递', JTEXPRESS: '极兔速递', EMS: 'EMS', YZPY: '邮政快递', YOUZHENGGUONEI: '邮政快递', DBWL: '德邦快递', HTKY: '百世快递', BESTEX: '百世快递', ZJS: '宅急送', TTKDEX: '天天快递', GTO: '国通快递', YS: '优速快递' };
/* 公司名：代码翻中文；已经是中文名就原样用；接口里没有就按单号前缀认
 *（顺丰 SF、韵达 31/32/43、中通 75/76——这三组按用户实测数据核对过）。 */
function carrierName(raw, no) {
  const s = String(raw || '').trim();
  if (s && !/签收|在途|派送|取件|到达|运输|揽收|待取|已取|妥投|代收|物流/.test(s)) {
    const up = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (CARRIER_NAMES[up]) return CARRIER_NAMES[up];
    if (/[\u4e00-\u9fa5]/.test(s) && s.length <= 12) return s;
  }
  const n = String(no || '');
  if (/^SF\d/i.test(n)) return '顺丰速运';
  if (/^(31|32|43)\d/.test(n)) return '韵达快递';
  if (/^(75|76)\d/.test(n)) return '中通快递';
  return '';
}
/* 菜鸟一条包裹 → 统一快照形状（取件码取法与原 App cainiao.ts 的 pickupCodeOf 一致） */
function trimPackage(p) {
  if (!p || typeof p !== 'object') return null;
  const st = p.packageStation || {};
  const feat = p.feature || {};
  const items = Array.isArray(p.packageItem) ? p.packageItem : [];
  let code = pickStr(st, 'authCode', 'auth_code');
  if (!code || CODE_PLACEHOLDER.indexOf(code.toLowerCase()) !== -1) {
    const alt = pickStr(st, 'showPickupCode', 'show_pickup_code', 'pickUpCode', 'pickupCode');
    code = (alt && alt.toLowerCase() !== 'true' && alt.toLowerCase() !== 'false')
      ? alt : pickStr(feat, 'stationOrderPickUpCode', 'station_order_pick_up_code');
  }
  if (code && CODE_PLACEHOLDER.indexOf(code.toLowerCase()) !== -1) code = '';
  const first = items[0] || {};
  /* 状态不只认 status/statusDesc 几个固定 key：轻应用接口可能换字段名，
   * 按 key 的意思全对象扫一遍，多个候选取最“靠后”的；isSign/signTime/
   * signDate 这类签收标记也认。 */
  const cands = [];
  scanStatusCandidates(p, 0, cands);
  const topStatus = pickStr(p, 'status', 'statusDesc', 'packageStatus');
  if (topStatus) cands.unshift(topStatus);
  const rawStatus = bestStatus(cands);
  const signedFlag = p.isSign === true || p.signed === true || !!pickStr(p, 'signTime', 'signedTime', 'signDate', 'signedDate');
  /* 接口有时只给英文状态码，显示时翻成中文 */
  const statusText = { SIGN: '已签收', SIGNED: '已签收', DELIVERED: '已签收', SIGN_SUCCESS: '已签收', DELIVERED_SUCCESS: '已签收', SIGNED_SUCCESS: '已签收', PICKUP: '待取件', TRANSIT: '在途', IN_TRANSIT: '在途', CANCEL: '已取消', REJECT: '已拒收', RETURN: '已退回', LOST: '已丢失' }[String(rawStatus).toUpperCase()] || rawStatus;
  const resolved = signedFlag ? 'delivered' : familyOf(rawStatus, code);
  const station = pickStr(st, 'pointName', 'point_name', 'stationName', 'name');
  const no = pickStr(p, 'mailNo', 'mail_no');
  const rawCarrier = pickStr(p, 'cpName', 'cp_name', 'companyName')
    || pickStr(p, 'cpCode', 'cp_code')
    || scanField(p, /company|express|carrier|brand|^cp/i, /status|state|sign|desc|text|time|date|no|number|mobile|phone/i, 0);
  const rawTitle = pickStr(feat, 'recommendPackageTitle', 'recommend_package_title')
    || pickStr(p, 'userRemark')
    || pickStr(first, 'itemTitle', 'item_title');
  return {
    no: no,
    title: cleanTitle(rawTitle) || rawTitle,
    company: carrierName(rawCarrier, no),
    phoneTail: phoneTailOf(p),
    code: code,
    station: station,
    status: resolved,
    statusText: statusText,
    latest: (station ? station + ' · ' : '') + (statusText || (resolved === 'delivered' ? '已签收' : resolved === 'arrived' ? '待取件' : '在途')),
    arrivedAt: 0,
    updatedAt: Date.now(),
  };
}
function stateOfParcel(p) {
  if (!p) return 'none';
  if (p.status === 'delivered') return 'delivered';
  if (p.status === 'arrived') return 'arrived';
  if (p.arrivedAt) return 'arrived';
  if (p.code) return 'arrived';
  return p.status === 'none' ? 'none' : 'transit';
}
/* 菜鸟新列表并进快照：取件码和到站时间沿用旧的，不丢；keepNos 是手动填的
 * 运单号（快递鸟在查的），菜鸟列表里没有它们，刷新时要留着不能丢。 */
function mergeSnapshot(prevSnap, freshParcels, keepNos) {
  const prevByNo = {};
  ((prevSnap && prevSnap.parcels) || []).forEach(p => { prevByNo[p.no] = p; });
  const parcels = freshParcels.map(p => {
    const prev = prevByNo[p.no] || {};
    const arrived = stateOfParcel(p) === 'arrived';
    return Object.assign({}, p, {
      code: p.code || prev.code || '',
      arrivedAt: arrived ? (prev.arrivedAt || Date.now()) : (prev.arrivedAt || 0),
    });
  });
  const seen = {};
  parcels.forEach(p => { seen[p.no] = true; });
  ((prevSnap && prevSnap.parcels) || []).forEach(p => {
    if ((keepNos || []).indexOf(p.no) !== -1 && !seen[p.no]) parcels.push(p);
  });
  const withCode = parcels.filter(p => p.code).length;
  return {
    at: Date.now(), updatedAt: Date.now(),
    count: parcels.length, withCode: withCode,
    /* 指纹必须含状态和取件码，不然状态翻了（在途→已签收）也认不出变化，
     * 变化通知就永远不触发。 */
    sig: parcels.map(p => p.no + '=' + p.status + '/' + (p.code || '')).join(','),
    parcels: parcels,
  };
}
/* 快递鸟查到的单号并进快照：只更新这些单号，菜鸟的包裹一个不动。 */
function mergeKdniaoInto(prevSnap, kdParcels) {
  const prevByNo = {};
  ((prevSnap && prevSnap.parcels) || []).forEach(p => { prevByNo[p.no] = p; });
  (kdParcels || []).forEach(p => {
    const prev = prevByNo[p.no] || {};
    const arrived = stateOfParcel(p) === 'arrived';
    prevByNo[p.no] = Object.assign({}, p, {
      code: p.code || prev.code || '',
      arrivedAt: arrived ? (prev.arrivedAt || p.arrivedAt || Date.now()) : (prev.arrivedAt || p.arrivedAt || 0),
    });
  });
  const parcels = Object.keys(prevByNo).map(k => prevByNo[k]);
  const withCode = parcels.filter(p => p.code).length;
  return {
    at: Date.now(), updatedAt: Date.now(),
    count: parcels.length, withCode: withCode,
    sig: parcels.map(p => p.no + '=' + p.status + '/' + (p.code || '')).join(','),
    parcels: parcels,
  };
}
/* 当前环境变量里的运单号（快递鸟在查的那些） */
function kdniaoNos(env) {
  try { return parseTrackings((env || {}).TRACKINGS).map(t => t.no); } catch (e) { return []; }
}
/* 运单号变了没：变了就记下新的，返回 true——调用方看到 true 就强制查一次。
 * 第一次填也算“变了”。 */
function trackingsChanged(ctx) {
  const cur = String((ctx.env || {}).TRACKINGS || '');
  const prev = loadJSON(ctx, TRACKINGS_KEY);
  if (prev && prev.raw === cur) return false;
  saveJSON(ctx, TRACKINGS_KEY, { raw: cur, nos: kdniaoNos(ctx.env) });
  return true;
}
/* 对照旧快照，只报到站/签收/新包裹/出码，返回报了几条。第一次快照是基线，
 * 不报（免得 5 个已签收的一起刷屏）。一次变好几个就合成一条汇总，不连刷。
 * 内容没变、只有文案变了这类不报——抓取本身是静默的。 */
function notifyTransitions(ctx, prevSnap, snap) {
  if (!prevSnap || !prevSnap.updatedAt) return 0;
  const prevByNo = {};
  (prevSnap.parcels || []).forEach(p => { prevByNo[p.no] = p; });
  const arrived = [];
  const delivered = [];
  const added = [];
  const coded = [];
  snap.parcels.forEach(p => {
    const prev = prevByNo[p.no];
    if (!prev) {
      if (stateOfParcel(p) !== 'none') added.push(p);
      return;
    }
    const prevState = stateOfParcel(prev);
    const nowState = stateOfParcel(p);
    if (prevState !== nowState) {
      if (nowState === 'arrived') arrived.push(p);
      else if (nowState === 'delivered') delivered.push(p);
    } else if (!prev.code && p.code && nowState === 'arrived') {
      coded.push(p);
    }
  });
  let n = 0;
  if (added.length === 1) {
    const p = added[0];
    notify(ctx, '有新包裹', displayTitle(p) + (p.latest ? '\n' + p.latest : ''));
    n += 1;
  } else if (added.length > 1) {
    notify(ctx, added.length + ' 个新包裹', added.map(p => displayTitle(p)).join('\n'));
    n += 1;
  }
  if (arrived.length === 1) {
    const p = arrived[0];
    notify(ctx, '包裹到站可取', displayTitle(p) + (p.code ? '，取件码 ' + p.code : '') + (p.latest ? '\n' + p.latest : ''));
    n += 1;
  } else if (arrived.length > 1) {
    notify(ctx, arrived.length + ' 个包裹到站可取', arrived.map(p => displayTitle(p) + (p.code ? '（取件码 ' + p.code + '）' : '')).join('\n'));
    n += 1;
  }
  if (delivered.length === 1) {
    const p = delivered[0];
    notify(ctx, '包裹已签收', displayTitle(p) + (p.latest ? '\n' + p.latest : ''));
    n += 1;
  } else if (delivered.length > 1) {
    notify(ctx, delivered.length + ' 个包裹已签收', delivered.map(p => displayTitle(p)).join('\n'));
    n += 1;
  }
  if (coded.length === 1) {
    const p = coded[0];
    notify(ctx, '取件码已出', displayTitle(p) + '，取件码 ' + p.code + (p.latest ? '\n' + p.latest : ''));
    n += 1;
  } else if (coded.length > 1) {
    notify(ctx, coded.length + ' 个包裹取件码已出', coded.map(p => displayTitle(p) + '：' + p.code).join('\n'));
    n += 1;
  }
  return n;
}
/* 商品名去冗长：去掉开头的【促销/渠道】前缀；标题里常有
 * “50ml/100ml/黑绷带 50ml”这种斜杠重复段，只取第一段，再去末尾规格
 *（【正品行货】赫莲娜黑绷带面霜 50ml/100ml → 赫莲娜黑绷带面霜）。 */
function cleanTitle(t) {
  let s = String(t || '').trim();
  while (/^【[^】]*】\s*/.test(s)) s = s.replace(/^【[^】]*】\s*/, '');
  s = s.split('/')[0].trim();
  s = s.replace(/\s*\d+(\.\d+)?\s*(ml|g|kg|l|片|只|瓶|盒|条|包|罐|支|套|件|枚)\s*$/i, '');
  return s.trim();
}
/* 手机号后四位：接口里可能叫 mobile/phone/tel，也可能直接写在
 * “手机尾号4514”这种文案里；找不到就返回空（显示时回落到运单号后四位）。 */
function phoneTailOf(p) {
  let found = '';
  (function walk(o, depth) {
    if (found || !o || typeof o !== 'object' || depth > 2) return;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === 'string' && v) {
        const mTail = /尾号\D{0,3}(\d{4})/.exec(v);
        if (mTail) { found = mTail[1]; return; }
        if (/mobile|phone|tel/i.test(k)) {
          if (/^\d{4}$/.test(v.trim())) { found = v.trim(); return; }
          const mMask = /\d{3}\*+\d{4}/.exec(v);
          if (mMask) { found = mMask[0].slice(-4); return; }
        }
      }
      if (v && typeof v === 'object') walk(v, depth + 1);
    }
  })(p, 0);
  return found;
}
/* 显示用标题：有商品名显示商品名（已去冗长，最长 12 字，多了截断）；
 * 没商品名显示“快递公司 · 手机号后四位”，接口里没有手机号后四位时
 * 回落到“快递公司 · 运单号后四位”，不用“尾号”这个词，全号仍在快照里。
 * 没公司名也认不出前缀时才显示全号。 */
function displayTitle(p) {
  if (p.title) {
    const t = p.title;
    return t.length > 12 ? t.slice(0, 12) + '…' : t;
  }
  if (p.no) {
    if (p.company) return p.company + ' · ' + (p.phoneTail || String(p.no).slice(-4));
    return p.no;
  }
  return '';
}

/* ---------------- 体捕获入口（http_response） ---------------- */

async function onCapture(ctx) {
  /* 开关开时才存凭证；关着就不碰 Cookie 头 */
  if (cookieCaptureOn(ctx)) {
    let reqCookie = null;
    let setCookies = [];
    try { reqCookie = ctx.request.headers.get('cookie'); } catch (e) { /* 忽略 */ }
    try { setCookies = ctx.response.headers.getAll('set-cookie') || []; } catch (e) { /* 忽略 */ }
    const found = {};
    Object.assign(found, pickCookies(reqCookie));
    Object.assign(found, pickCookies(setCookies));
    const names = Object.keys(found);
    if (names.length) {
      const stored = loadJSON(ctx, COOKIES_KEY) || {};
      let changed = false;
      for (const k of names) {
        if (stored[k] !== found[k]) { stored[k] = found[k]; changed = true; }
      }
      if (changed) {
        saveJSON(ctx, COOKIES_KEY, stored);
        if (found['_m_h5_tk'] && !flagSet(ctx, 'tk-noted')) {
          notify(ctx, '已抓到登录凭证', '后台自动刷新已就绪；不想继续抓了，可以把“抓取登录凭证”开关关掉');
        }
      }
    }
  }

  /* 读响应体里的包裹列表（body_required 的入口才有 body，没 body 就透传）。
   * 读到 body 就原样返回，不改内容。 */
  let data = null;
  try {
    data = await ctx.response.json();
  } catch (e) {
    return undefined;
  }
  if (data && typeof data === 'object') {
    let d = mtopData(data);
    /* 有的接口（小程序的 lightapp 列表）把 data 包成 JSON 字符串 */
    if (typeof d === 'string') {
      try {
        const parsed = JSON.parse(d);
        if (parsed && typeof parsed === 'object') d = mtopData({ data: parsed }) || parsed;
      } catch (e) { /* 不是 JSON 字符串，保持原样 */ }
    }
    const list = findList(d);
    if (list) {
      const fresh = list.map(trimPackage).filter(Boolean);
      const prevSnap = loadJSON(ctx, SNAP_KEY);
      const snap = mergeSnapshot(prevSnap, fresh, kdniaoNos(ctx.env));
      saveJSON(ctx, SNAP_KEY, snap);
      /* 抓取本身静默：第一次同步报一次汇总（只这一次），之后只在有新包裹 /
       * 到站 / 签收 / 出码时报变化，内容没变什么都不报。 */
      const firstSnap = !prevSnap || !prevSnap.updatedAt;
      if (firstSnap) {
        notify(ctx, '已同步 ' + snap.count + ' 个包裹', '其中 ' + snap.withCode + ' 个有取件码');
      } else if (prevSnap.sig !== snap.sig) {
        notifyTransitions(ctx, prevSnap, snap);
      }
    }
    return { body: data };
  }
  return undefined;
}

/* ---------------- MTOP 轮询（后台自动刷新） ---------------- */

function retOf(j, txt) {
  if (j && Array.isArray(j.ret)) return j.ret.join(';');
  if (j && typeof j.ret === 'string') return j.ret;
  if (j && j.ret) return String(j.ret);
  return (txt || '').slice(0, 80) || '无响应';
}

async function mtopList(ctx, cookies) {
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
  const res = await ctx.http.get(url, {
    headers: { Cookie: cookieHeader(cookies), 'User-Agent': UA, Referer: REFERER, Accept: 'application/json' },
    timeout: 15000,
  });
  const txt = await res.text();
  let j = null;
  try { j = JSON.parse(txt); } catch (e) { /* 不是 JSON */ }
  return { res, txt, j };
}

async function refreshToken(ctx, cookies) {
  const res = await ctx.http.get(REFRESH_URL, {
    headers: { Cookie: cookieHeader(cookies), 'User-Agent': UA, Referer: REFERER },
    timeout: 15000,
  });
  await res.text().catch(() => '');
  let setCookies = [];
  try { setCookies = res.headers.getAll('set-cookie') || []; } catch (e) { /* 忽略 */ }
  const fresh = pickCookies(setCookies);
  if (fresh['_m_h5_tk']) {
    const merged = Object.assign({}, cookies, fresh);
    saveJSON(ctx, COOKIES_KEY, merged);
    return merged;
  }
  return null;
}

/* 调一次 MTOP 列表，成功返回快照，失败返回 { error }。ret 变化才报通知。 */
async function pollMtop(ctx) {
  const cookies = loadJSON(ctx, COOKIES_KEY) || {};
  if (!cookies['_m_h5_tk']) return { error: 'nocookie' };
  let r;
  try {
    r = await mtopList(ctx, cookies);
  } catch (e) {
    return { error: '请求失败：' + String((e && e.message) || e).slice(0, 60) };
  }
  let ret = retOf(r.j, r.txt);
  const upper = ret.toUpperCase();
  if (upper.indexOf('SUCCESS') === -1
      && (upper.indexOf('TOKEN_EXPIRED') !== -1 || upper.indexOf('TOKEN_EXOIRED') !== -1
      || upper.indexOf('TOKEN_EMPTY') !== -1 || upper.indexOf('FAIL_SYS_TOKEN') !== -1)) {
    try {
      const fresh = await refreshToken(ctx, cookies);
      if (fresh) {
        const r2 = await mtopList(ctx, fresh);
        const ret2 = retOf(r2.j, r2.txt);
        if (ret2.toUpperCase().indexOf('SUCCESS') !== -1) {
          r = r2;
          ret = ret2;
        } else {
          ret = ret2;
        }
      }
    } catch (e) { /* 刷新失败，走下面的失败分支 */ }
  }
  if (ret.toUpperCase().indexOf('SUCCESS') !== -1) {
    const list = findList(mtopData(r.j));
    const fresh = (list || []).map(trimPackage).filter(Boolean);
    const prevSnap = loadJSON(ctx, SNAP_KEY);
    const snap = mergeSnapshot(prevSnap, fresh, kdniaoNos(ctx.env));
    saveJSON(ctx, SNAP_KEY, snap);
    notifyTransitions(ctx, prevSnap, snap);
    return { ok: true, count: snap.count };
  }
  return { error: '菜鸟接口返回：' + ret.slice(0, 60) };
}

/* ---------------- 定时脚本 ---------------- */

async function onSchedule(ctx) {
  const env = ctx.env || {};
  const check = loadJSON(ctx, CHECK_KEY) || {};

  /* 开关开 + 有凭证 → MTOP 后台轮询（只刷菜鸟列表） */
  if (cookieCaptureOn(ctx)) {
    const cookies = loadJSON(ctx, COOKIES_KEY) || {};
    if (!cookies['_m_h5_tk']) {
      if (!flagSet(ctx, 'nocookie-noted')) {
        notify(ctx, '后台刷新还没凭证', '去淘宝 App 点一次订单 → 查看物流（H5），抓到登录凭证后即可后台自动刷新；不想用了就把开关关掉');
      }
      /* 没凭证也不拦快递鸟：继续往下查运单号 */
    } else {
      const r = await pollMtop(ctx);
      if (r.ok) {
        if (check.last !== 'ok') {
          check.last = 'ok';
          saveJSON(ctx, CHECK_KEY, check);
          notify(ctx, '后台刷新已调通', '菜鸟“我的包裹”返回 ' + r.count + ' 个包裹');
        }
      } else if (r.error !== 'nocookie') {
        const msg = r.error;
        if (check.last !== msg) {
          check.last = msg;
          saveJSON(ctx, CHECK_KEY, check);
          notify(ctx, '后台刷新失败', msg);
        }
      }
    }
  }

  /* 快递鸟：填了密钥和运单号就查（不论开关开不开），结果并进快照，
   * 菜鸟的包裹一个不动；运单号变了也会在这里查到。 */
  if (env.KDNIAO_EBUSINESS_ID && env.KDNIAO_APP_KEY && env.TRACKINGS) {
    trackingsChanged(ctx);
    const prevSnap = loadJSON(ctx, SNAP_KEY) || { parcels: [] };
    const prevByNo = {};
    prevSnap.parcels.forEach((p) => { prevByNo[p.no] = p; });
    const snap = await refreshKdniao(ctx, env, prevByNo);
    const merged = mergeKdniaoInto(prevSnap, snap.parcels);
    saveJSON(ctx, SNAP_KEY, merged);
    notifyTransitions(ctx, prevSnap, merged);
  }
}

/* ---------------- 快递鸟 8001（可选补充） ---------------- */

const COM2SHIPPER = {
  zhongtong: 'ZTO', zto: 'ZTO', yunda: 'YUNDA', yto: 'YTO', yuantong: 'YTO',
  sto: 'STO', shentong: 'STO', shunfeng: 'SF', sf: 'SF', jd: 'JD',
  jtexpress: 'JT', jt: 'JT', youzhengguonei: 'YZPY', ems: 'EMS',
  youshu: 'YS', debang: 'DBWL', bestex: 'HTKY', bestexpress: 'HTKY',
  zhaijisong: 'ZJS', tiantian: 'TTKDEX', guotong: 'GTO',
};
const KNOWN_SHIPPERS = new Set(Object.values(COM2SHIPPER));
const CODE_KEYWORDS = ['取件码', '取货码', '取件号', '取件密码', '提货码', '取货密码', '取件凭证', '领件码', '包裹码', '柜机码', '取件口令'];

/* 一行一个：运单号|备注 或 运单号|公司代码|备注；多条用换行或分号隔开 */
function parseTrackings(raw) {
  const out = [];
  if (!raw) return out;
  String(raw).split(/[\r\n;；]+/).forEach((line) => {
    const t = line.trim();
    if (!t) return;
    const parts = t.split(/[|,，]/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const no = parts[0].replace(/\s+/g, '');
    let shipper = '';
    let title = '';
    if (parts.length >= 3) {
      shipper = parts[1].toUpperCase();
      title = parts.slice(2).join(' ');
    } else if (parts.length === 2) {
      if (KNOWN_SHIPPERS.has(parts[1].toUpperCase())) shipper = parts[1].toUpperCase();
      else title = parts[1];
    }
    out.push({ no, shipper, title });
  });
  return out;
}

function parseTrackTime(s) {
  if (!s) return 0;
  const m = /(\d{4})-(\d{1,2})-(\d{1,2})[\sT](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(s));
  if (!m) return 0;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
}

/* 轨迹里最新一条「可取件」节点的时间（中转节点跳过） */
function arrivedAtOf(nodes) {
  let best = 0;
  (nodes || []).forEach((n) => {
    const t = String(n.text || '');
    if (!PICKABLE.test(t)) return;
    if (TRANSIT_ONLY.test(t)) return;
    const at = parseTrackTime(n.time);
    if (at > best) best = at;
  });
  return best > 0 ? best : 0;
}

function looksLikeMobile(s) {
  return /^1[3-9]\d{9}$/.test(s.replace(/[\s-]/g, ''));
}

/* 从一段轨迹文案里取取件码（原 App pickupCode.ts 的打分逻辑简化版） */
function pickupCodeInText(text) {
  const src = String(text || '');
  if (!src) return '';
  const hits = [];
  CODE_KEYWORDS.forEach((kw) => {
    let idx = src.indexOf(kw);
    while (idx >= 0) {
      const after = src.slice(idx + kw.length, idx + kw.length + 20);
      const m = /^[^0-9A-Za-z]{0,6}/.exec(after);
      const rest = after.slice(m ? m[0].length : 0);
      const cm = /([0-9A-Za-z][0-9A-Za-z-]*)/.exec(rest);
      if (cm && cm[1]) {
        const raw = cm[1].replace(/[-\s]+$/, '').trim();
        let ok = true;
        let score = 1;
        if (raw.length < 3 || raw.length > 20) ok = false;
        if (looksLikeMobile(raw)) ok = false;
        if (/^(19|20)\d{2}(-\d{1,2})?$/.test(raw)) ok = false;
        if (/验证码|校验码|短信验证|支付密码|付款码|动态密码/.test(src)) ok = false;
        if (ok) {
          if (/^\d{1,3}-\d{1,3}-\d{1,4}$/.test(raw)) score += 3;
          if (/^[A-Z]{1,3}\d{4,10}$/.test(raw)) score += 2;
          if (/^[A-Z]-\d{1,2}-\d{3,4}$/.test(raw)) score += 3;
          if ((raw.match(/-/g) || []).length >= 1 && raw.length <= 12) score += 1;
          if (/^\d{6}$/.test(raw)) score -= 1;
          hits.push({ raw, score });
        }
      }
      idx = src.indexOf(kw, idx + kw.length);
    }
  });
  if (!hits.length) return '';
  hits.sort((a, b) => b.score - a.score);
  return hits[0].raw;
}

function extractPickupCode(nodes) {
  for (let i = (nodes || []).length - 1; i >= 0; i--) {
    const c = pickupCodeInText(nodes[i].text || '');
    if (c) return c;
  }
  return '';
}

function flattenStation(v, depth) {
  if (v == null || depth > 4) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map((x) => flattenStation(x, depth + 1)).filter(Boolean).join(' ');
  if (typeof v === 'object') {
    const keys = ['Desc', 'AcceptStation', 'Station', 'Content', 'Text', 'Description', 'Remark'];
    const parts = [];
    keys.forEach((k) => { const s = flattenStation(v[k], depth + 1); if (s) parts.push(s); });
    if (parts.length) return parts.join(' ');
    Object.keys(v).forEach((k) => { const s = flattenStation(v[k], depth + 1); if (s) parts.push(s); });
    return parts.join(' ');
  }
  return '';
}

/* 快递公司识别：快递100 公开接口（免 key） */
async function detectShipper(ctx, no) {
  const res = await ctx.http.get(AUTONUM_URL + encodeURIComponent(no), {
    headers: { 'User-Agent': KD100_UA, Referer: 'https://www.kuaidi100.com/', Accept: 'application/json, text/plain, */*' },
    timeout: 8000,
  });
  if (res.status !== 200) throw new Error('快递公司识别失败（HTTP ' + res.status + '）');
  const json = await res.json();
  const first = json && Array.isArray(json.auto) ? json.auto[0] : null;
  const comCode = first && first.comCode ? String(first.comCode) : '';
  if (!comCode) throw new Error('无法自动识别快递公司，请在运单号后加公司代码，如 ' + no + '|SF');
  return { shipperCode: COM2SHIPPER[comCode.toLowerCase()] || comCode.toUpperCase(), company: first.name || '' };
}

/* 快递鸟 8001 即时查询 */
async function queryKdniao(ctx, env, no, shipperCode, company, phone) {
  const rd = { LogisticCode: no, ShipperCode: shipperCode };
  if (phone) rd.CustomerName = phone;
  const requestData = JSON.stringify(rd);
  const body =
    'RequestData=' + encodeURIComponent(requestData) +
    '&EBusinessID=' + encodeURIComponent(env.KDNIAO_EBUSINESS_ID) +
    '&RequestType=8001' +
    '&DataSign=' + kdniaoSign(requestData, env.KDNIAO_APP_KEY) +
    '&DataType=2';
  const res = await ctx.http.post(QUERY_URL, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': KD100_UA,
      Referer: QUERY_URL,
      Accept: 'application/json, text/plain, */*',
    },
    body,
    timeout: 10000,
  });
  if (res.status !== 200) throw new Error('快递鸟 HTTP ' + res.status);
  const json = await res.json();
  if (!json.Success) {
    const reason = String(json.Reason || '');
    if (reason.indexOf('手机尾号不能为空') >= 0) throw new Error('这个单号需要收件人手机号后四位');
    if (reason.indexOf('手机尾号不正确') >= 0) throw new Error('手机号后四位不正确');
    if (reason.indexOf('套餐') >= 0) throw new Error('快递鸟账号没有可用套餐');
    if (reason.indexOf('非法参数') >= 0) throw new Error('快递鸟拒绝了请求，请检查密钥');
    throw new Error('快递鸟：' + (reason || '查询失败'));
  }
  const traces = (json.Traces || []).filter((t) => t && t.AcceptStation);
  traces.sort((a, b) => String(a.AcceptTime || '').localeCompare(String(b.AcceptTime || '')));
  const nodes = traces.map((t) => ({
    time: String(t.AcceptTime || ''),
    text: flattenStation(t.AcceptStation, 0).replace(/\s+/g, ' ').trim(),
  })).filter((n) => n.text);
  const latest = nodes.length ? nodes[nodes.length - 1].text : '';
  const state = String(json.State || '');
  const status = state === '3' || DELIVERED_RE.test(latest) ? 'delivered' : (latest ? 'transit' : 'none');
  return { shipperCode, company: company || shipperCode, state, status, latest, nodes };
}

/* 查一遍全部运单，返回统一形状的包裹 */
async function refreshKdniao(ctx, env, prevByNo) {
  const trackings = parseTrackings(env.TRACKINGS);
  const phone = String(env.PHONE_LAST4 || '').trim();
  const shipperCache = loadJSON(ctx, SHIPPER_KEY) || {};
  const parcels = [];
  for (const t of trackings) {
    let shipper = t.shipper;
    let company = '';
    try {
      if (!shipper) {
        if (shipperCache[t.no]) {
          shipper = shipperCache[t.no].shipperCode;
          company = shipperCache[t.no].company || '';
        } else {
          const det = await detectShipper(ctx, t.no);
          shipper = det.shipperCode;
          company = det.company;
          shipperCache[t.no] = det;
        }
      }
      const r = await queryKdniao(ctx, env, t.no, shipper, company, phone);
      const code = extractPickupCode(r.nodes);
      const arrivedAt = arrivedAtOf(r.nodes);
      const prev = prevByNo[t.no] || {};
      const rawStatus = r.latest || '';
      parcels.push({
        no: t.no,
        title: t.title || r.company,
        company: r.company,
        code: code || prev.code || '',
        station: '',
        status: r.status === 'delivered' ? 'delivered' : ((arrivedAt || code) ? 'arrived' : 'transit'),
        statusText: rawStatus,
        latest: rawStatus || '在途',
        arrivedAt: arrivedAt || prev.arrivedAt || 0,
        updatedAt: Date.now(),
      });
    } catch (e) {
      const prev = prevByNo[t.no];
      parcels.push(prev || {
        no: t.no, title: t.title || t.no, company: '', code: '', station: '',
        status: 'none', statusText: '', latest: '查询失败：' + String((e && e.message) || e),
        arrivedAt: 0, updatedAt: Date.now(),
      });
    }
  }
  saveJSON(ctx, SHIPPER_KEY, shipperCache);
  return { updatedAt: Date.now(), parcels };
}

/* ---------------- 小组件脚本 ---------------- */

function syncLabel(ts) {
  if (!ts) return '尚未同步';
  const d = new Date(ts);
  const t = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? t + ' 同步' : (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + t + ' 同步';
}

/* 快递公司小方块：公司名首字（韵/顺/中/圆…），没公司名就用单号首字 */
function logoTile(p, textMain) {
  const ch = (p.company ? p.company[0] : (p.no ? String(p.no)[0] : '•'));
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    backgroundColor: { light: '#E9E9EE', dark: '#48484A' },
    borderRadius: 6,
    padding: [4, 6, 4, 6],
    children: [
      { type: 'text', text: ch, font: { size: 13, weight: 'bold' }, textColor: textMain },
    ],
  };
}
/* 状态只用小字标在右边，不用彩色大药丸：待取绿、在途橙、已取灰 */
function statusMark(p) {
  const st = stateOfParcel(p);
  if (st === 'arrived') return { text: '待取', color: { light: '#2E9E5B', dark: '#30D158' } };
  if (st === 'delivered') return { text: '已取', color: { light: '#8A8A8E', dark: '#98989F' } };
  return { text: '在途', color: { light: '#E8894F', dark: '#FF9F0A' } };
}

function parcelRow(p, textMain, textSub) {
  const st = stateOfParcel(p);
  const main = st === 'arrived' && p.code ? p.code : displayTitle(p);
  /* 主行已经是“公司 · 后四位”时副行不再重复公司名；其他情况副行补上公司名 */
  const mainHasCompany = !p.title && p.company && !(st === 'arrived' && p.code);
  const sub = (mainHasCompany ? '' : (p.company ? p.company + ' · ' : '')) + (p.latest || '暂无轨迹');
  const mark = statusMark(p);
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 8,
    children: [
      logoTile(p, textMain),
      {
        type: 'stack',
        direction: 'column',
        flex: 1,
        gap: 2,
        alignItems: 'start',
        children: [
          { type: 'text', text: main, font: { size: 13, weight: 'bold' }, textColor: textMain, maxLines: 1 },
          { type: 'text', text: sub, font: { size: 10 }, textColor: textSub, maxLines: 1 },
        ],
      },
      { type: 'text', text: mark.text, font: { size: 11, weight: 'bold' }, textColor: mark.color },
    ],
  };
}

async function renderWidget(ctx) {
  const env = ctx.env || {};
  const family = ctx.widgetFamily || 'systemLarge';
  const textMain = { light: '#1C1C1E', dark: '#F2F2F7' };
  const textSub = { light: '#8A8A8E', dark: '#98989F' };
  const refreshAfter = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const hint = (body) => ({
    type: 'widget',
    padding: [14, 14, 14, 14],
    children: [{
      type: 'stack', direction: 'column',
      children: [
        { type: 'text', text: '包裹助手', font: { size: 16, weight: 'bold' }, textColor: textMain },
        { type: 'spacer', length: 6 },
        { type: 'text', text: body, font: { size: 12 }, textColor: textSub, maxLines: 4 },
      ],
    }],
    refreshAfter,
  });

  let snap = loadJSON(ctx, SNAP_KEY);
  /* 运单号变了（刚填了新单号）→ 不管快照新不新鲜，立刻查一次快递鸟，
   * 查到就并进快照（小组件 10 分钟一刷，保存后 10 分钟内就会查）。 */
  if (env.KDNIAO_EBUSINESS_ID && env.KDNIAO_APP_KEY && env.TRACKINGS && trackingsChanged(ctx)) {
    try {
      const prevSnap0 = snap;
      const prevByNo = {};
      ((snap && snap.parcels) || []).forEach((p) => { prevByNo[p.no] = p; });
      const fresh = await refreshKdniao(ctx, env, prevByNo);
      const merged = mergeKdniaoInto(snap, fresh.parcels);
      saveJSON(ctx, SNAP_KEY, merged);
      snap = merged;
      if (prevSnap0) notifyTransitions(ctx, prevSnap0, merged);
    } catch (e) { /* 失败就等下次定时再查 */ }
  }
  const stale = !snap || !Array.isArray(snap.parcels) || Date.now() - (snap.updatedAt || 0) > SNAP_TTL_MS;
  if (stale) {
    try {
      if (cookieCaptureOn(ctx) && (loadJSON(ctx, COOKIES_KEY) || {})['_m_h5_tk']) {
        const r = await pollMtop(ctx);
        if (r.ok) snap = loadJSON(ctx, SNAP_KEY);
      } else if (env.KDNIAO_EBUSINESS_ID && env.KDNIAO_APP_KEY && env.TRACKINGS) {
        const prevByNo = {};
        ((snap && snap.parcels) || []).forEach((p) => { prevByNo[p.no] = p; });
        const fresh = await refreshKdniao(ctx, env, prevByNo);
        const merged = mergeKdniaoInto(snap, fresh.parcels);
        saveJSON(ctx, SNAP_KEY, merged);
        snap = merged;
      }
    } catch (e) { /* 刷新失败就显示旧快照 */ }
  }
  if (!snap || !Array.isArray(snap.parcels) || !snap.parcels.length) {
    return hint('打开菜鸟 App 或小程序，刷一次“我的包裹”，快照就会出现在这里。');
  }

  const all = snap.parcels || [];
  const pending = all.filter((p) => stateOfParcel(p) === 'arrived');
  const transit = all.filter((p) => stateOfParcel(p) === 'transit' || stateOfParcel(p) === 'none');
  const delivered = all.filter((p) => stateOfParcel(p) === 'delivered');
  const statsText = '待取 ' + pending.length + ' · 在途 ' + transit.length + ' · ' + syncLabel(snap.updatedAt);

  if (family === 'accessoryCircular') {
    return {
      type: 'widget', padding: 0,
      children: [{
        type: 'stack', direction: 'column', alignItems: 'center',
        children: [
          { type: 'text', text: pending.length ? '待取 ' + pending.length : '在途 ' + transit.length, font: { size: 13, weight: 'bold' } },
          { type: 'text', text: '包裹', font: { size: 9 } },
        ],
      }],
      refreshAfter,
    };
  }
  if (family === 'accessoryInline') {
    return {
      type: 'widget', padding: 0,
      children: [{ type: 'text', text: '待取 ' + pending.length + ' · 在途 ' + transit.length, font: { size: 12 } }],
      refreshAfter,
    };
  }
  if (family && family.indexOf('accessory') === 0) {
    return {
      type: 'widget', padding: [4, 8, 4, 8],
      children: [{
        type: 'stack', direction: 'column',
        children: [
          { type: 'text', text: pending.length ? '待取 ' + pending.length + ' 个包裹' : '暂无待取包裹', font: { size: 13, weight: 'bold' } },
          { type: 'text', text: pending.length && pending[0].code ? '取件码 ' + pending[0].code : statsText, font: { size: 11 } },
        ],
      }],
      refreshAfter,
    };
  }

  /* 小组件高度是固定的，行数必须按尺寸卡死，超了会挤在一起重叠：
   * small 2 行、medium 4 行、large 8 行、extraLarge 10 行，多余的折进左列。 */
  const slots = family === 'systemSmall' ? 2
    : family === 'systemMedium' ? 4
    : family === 'systemLarge' ? 8
    : family === 'systemExtraLarge' ? 10 : 4;
  /* 行按待取 → 在途 → 已取排，已取也显示（不然状态修对了反而看不见包裹）。 */
  const rows = [];
  pending.slice(0, slots).forEach((p) => rows.push(parcelRow(p, textMain, textSub)));
  transit.slice(0, Math.max(0, slots - rows.length)).forEach((p) => rows.push(parcelRow(p, textMain, textSub)));
  delivered.slice(0, Math.max(0, slots - rows.length)).forEach((p) => rows.push(parcelRow(p, textMain, textSub)));
  const hidden = all.length - rows.length;

  /* 小尺寸：上下结构，文字全部左对齐 */
  if (family === 'systemSmall') {
    const footerParts = [];
    if (pending.length) footerParts.push('待取 ' + pending.length);
    if (transit.length) footerParts.push('在途 ' + transit.length);
    if (delivered.length) footerParts.push('已取 ' + delivered.length);
    if (hidden > 0) footerParts.push('还有 ' + hidden + ' 个');
    footerParts.push(syncLabel(snap.updatedAt));
    const children = [];
    children.push({
      type: 'stack', direction: 'row', alignItems: 'center',
      children: [
        { type: 'text', text: '包裹助手', font: { size: 14, weight: 'bold' }, textColor: textMain },
        { type: 'spacer' },
        { type: 'text', text: syncLabel(snap.updatedAt), font: { size: 11 }, textColor: textSub },
      ],
    });
    if (!rows.length) {
      children.push({ type: 'text', text: '暂无在途或待取包裹', font: { size: 12 }, textColor: textSub });
    } else {
      rows.forEach((r) => children.push(r));
    }
    children.push({ type: 'spacer' });
    children.push({ type: 'text', text: footerParts.join(' · '), font: { size: 10, weight: 'medium' }, textColor: textSub, maxLines: 1 });
    return {
      type: 'widget',
      padding: [10, 14, 8, 14],
      children: [{ type: 'stack', direction: 'column', gap: 6, alignItems: 'start', children }],
      refreshAfter,
    };
  }

  /* 中/大/超大：参考原版 App 的版式——左列汇总（待取件大数字、在途、
   * 已取、同步时间），右列包裹列表（公司小方块 + 名称/站点 + 右边小字状态）。
   * 中尺寸左列比右列矮一截，整列在行里上下居中，不然待取件那块看着靠上。 */
  const railChildren = [
    { type: 'text', text: '待取件', font: { size: 12, weight: 'medium' }, textColor: textMain },
    { type: 'text', text: String(pending.length), font: { size: 30, weight: 'bold' }, textColor: textMain },
    { type: 'text', text: '在途 ' + transit.length, font: { size: 12, weight: 'medium' }, textColor: { light: '#007AFF', dark: '#0A84FF' } },
  ];
  if (delivered.length) railChildren.push({ type: 'text', text: '已取 ' + delivered.length, font: { size: 12 }, textColor: textSub });
  if (hidden > 0) railChildren.push({ type: 'text', text: '还有 ' + hidden + ' 个', font: { size: 11 }, textColor: textSub });
  railChildren.push({ type: 'text', text: '↻ ' + syncLabel(snap.updatedAt), font: { size: 10 }, textColor: textSub });
  const rail = {
    type: 'stack', direction: 'column', flex: 1, gap: 2, alignItems: 'start',
    children: railChildren,
  };
  const list = {
    type: 'stack', direction: 'column', flex: 3, gap: 6,
    children: rows.length ? rows : [{ type: 'text', text: '暂无在途或待取包裹', font: { size: 12 }, textColor: textSub }],
  };
  return {
    type: 'widget',
    padding: [12, 14, 10, 14],
    children: [{ type: 'stack', direction: 'row', gap: 12, alignItems: family === 'systemMedium' ? 'center' : 'start', children: [rail, list] }],
    refreshAfter,
  };
}

/* ---------------- 手动状态查询（generic，点运行就报一次现状） ---------------- */

async function onStatus(ctx) {
  const lines = ['包裹助手 ' + PARCEL_VERSION];
  lines.push('凭证抓取开关：' + (cookieCaptureOn(ctx) ? '开' : '关'));
  const cookies = loadJSON(ctx, COOKIES_KEY) || {};
  lines.push('登录凭证：' + (cookies['_m_h5_tk'] ? '已抓到' : '未抓到')
    + (Object.keys(cookies).length ? '（已存 ' + Object.keys(cookies).join('、') + '）' : ''));
  const snap = loadJSON(ctx, SNAP_KEY);
  if (snap && snap.count > 0) {
    lines.push('包裹快照：' + snap.count + ' 个，其中 ' + (snap.withCode || 0) + ' 个有取件码（' + syncLabel(snap.updatedAt) + '）');
  } else {
    lines.push('包裹快照：无（打开菜鸟刷一次“我的包裹”）');
  }
  const check = loadJSON(ctx, CHECK_KEY) || {};
  if (check.last) lines.push('上次后台刷新：' + String(check.last).slice(0, 40));
  notify(ctx, '包裹助手状态', lines.join('\n'));
}

/* ---------------- 入口 ---------------- */

export default async function (ctx) {
  try {
    if (ctx && ctx.widgetFamily) return renderWidget(ctx);
    if (ctx && ctx.response) return onCapture(ctx);
    if (ctx && ctx.cron !== undefined && ctx.cron !== null) { await onSchedule(ctx); return; }
    await onStatus(ctx);
  } catch (e) { /* 模块自己不出错、不挡请求 */ }
}
