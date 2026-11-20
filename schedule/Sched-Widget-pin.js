/**
 * 🗓️ 牛马表小组件（改版：坐班 / 拍摄 / 休息）
 *
 * 三种状态：坐班 / 拍摄 / 休息。
 *   休息：自动按大小休排，不用填——
 *     周一固定休息；双休周再休周二；单休周只休周一。
 *     以 2026-11-09（周一）那周为双休基准，每周轮换：
 *     11/09-10 双休 → 11/16 单休 → 11/23-24 双休 → 11/30 单休 → 12/07-08 双休……
 *   坐班 / 拍摄：在模块设置里按班次填写本月日期号（逗号分隔）。
 *     没填的工作日默认坐班；填了的日期优先于自动休息（比如周一改成拍摄）。
 *   SHIFT_ZUOBAN  坐班   例：3,4,5
 *   SHIFT_PAISHE  拍摄   例：6,13,20
 *   SHIFT_XIU     休息   只填需要额外休息的日期（如调休、节假日），平时留空
 */

export default async function (ctx) {
  return handleWidget(ctx);
}

async function handleWidget(ctx) {
  const safeCtx = ctx || {};
  const env = safeCtx.env || {};
  const family = safeCtx.widgetFamily || 'systemLarge';

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const weekRows = Math.ceil((startOffset + daysInMonth) / 7);
  const WEEK_CHARS = ['一', '二', '三', '四', '五', '六', '日'];
  const weekCharOf = (dateObj) => WEEK_CHARS[(dateObj.getDay() + 6) % 7];

  const ZUOBAN = { key: 'SHIFT_ZUOBAN', name: '坐班', color: '#5B8DEF' };
  const PAISHE = { key: 'SHIFT_PAISHE', name: '拍摄', color: '#E8894F' };
  const REST = { key: 'SHIFT_XIU', name: '休息', color: '#3E9B5F' };
  // 统计顺序：坐班、拍摄、休息
  const SHIFT_DEFS = [ZUOBAN, PAISHE, REST];

  function parseDays(str) {
    const out = new Set();
    if (str == null) return out;
    String(str).split(/[^0-9]+/).forEach((t) => {
      if (!t) return;
      const n = parseInt(t, 10);
      if (n >= 1 && n <= 31) out.add(n);
    });
    return out;
  }

  // 显式填写的优先级：拍摄 > 坐班 > 休息（手动填的休息）
  const dayMap = {};
  [PAISHE, ZUOBAN, REST].forEach((def) => {
    const raw = env[def.key];
    parseDays(raw).forEach((d) => {
      if (!dayMap[d]) dayMap[d] = def;
    });
  });

  // ---- 大小休：以 2026-11-09（周一）那周为双休基准，每周轮换 ----
  // 双休周：周一、周二休息；单休周：只周一休息
  const ANCHOR_MONDAY = new Date(2026, 10, 9); // 2026-11-09，周一，双休
  function mondayOf(dateObj) {
    const d = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // 回到本周一
    return d;
  }
  function isDoubleRestWeek(dateObj) {
    const weeks = Math.round((mondayOf(dateObj) - ANCHOR_MONDAY) / (7 * 86400000));
    return ((weeks % 2) + 2) % 2 === 0; // 与基准周相隔偶数周为双休
  }
  function isRestDay(dateObj) {
    const dow = dateObj.getDay(); // 0=周日，1=周一，2=周二
    if (dow === 1) return true; // 周一固定休息
    if (dow === 2 && isDoubleRestWeek(dateObj)) return true; // 双休周的周二休息
    return false;
  }

  function shiftOfDate(dateObj) {
    // 显式填写只对当月有效（设置里填的是本月日期号）
    if (dateObj.getFullYear() === year && dateObj.getMonth() === month) {
      const explicit = dayMap[dateObj.getDate()];
      if (explicit) return explicit;
    }
    if (isRestDay(dateObj)) return REST;
    return ZUOBAN; // 没填的工作日默认坐班
  }
  function shiftOf(dayNum) {
    return shiftOfDate(new Date(year, month, dayNum));
  }

  const next = new Date(now.getTime() + 36 * 3600 * 1000);
  const refreshAfter = new Date(next.getFullYear(), next.getMonth(), next.getDate(), 0, 5).toISOString();

  const textMain = { light: '#1C1C1E', dark: '#F2F2F7' };
  const textSub = { light: '#8A8A8E', dark: '#98989F' };
  const textWeekend = { light: '#B9B9A8', dark: '#6E6E66' };
  const todayBg = { light: '#0000000D', dark: '#FFFFFF14' };
  const todayBorder = { light: '#A3B899', dark: '#7A9A72' };
  const capsuleColor = (hex) => ({ light: hex + 'E6', dark: hex + 'E6' });

  const counts = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const s = shiftOf(d);
    counts[s.name] = (counts[s.name] || 0) + 1;
  }
  const statsText = SHIFT_DEFS
    .filter((s) => counts[s.name])
    .map((s) => `${s.name} ${counts[s.name]}`)
    .join(' · ');

  function capsule(shift, big) {
    return {
      type: 'stack',
      direction: 'row',
      backgroundColor: capsuleColor(shift.color),
      borderRadius: big ? 8 : 5,
      padding: big ? [3, 8, 3, 8] : [2, 7, 2, 7],
      children: [
        { type: 'text', text: shift.name, font: { size: big ? 12 : 10, weight: 'bold' }, textColor: '#FFFFFF' },
      ],
    };
  }

  function dayCell(dayNum, isToday, isWeekend, dateSize) {
    const shift = shiftOf(dayNum);
    const cell = {
      type: 'stack',
      direction: 'column',
      alignItems: 'center',
      flex: 1,
      padding: [3, 0, 3, 0],
      children: [
        {
          type: 'text',
          text: String(dayNum),
          font: { size: dateSize, weight: isToday ? 'bold' : 'medium' },
          textColor: isWeekend ? textWeekend : textMain,
        },
        { type: 'spacer', length: 2 },
        capsule(shift, false),
      ],
    };
    if (isToday) {
      cell.backgroundColor = todayBg;
      cell.borderRadius = 8;
      cell.borderWidth = 1;
      cell.borderColor = todayBorder;
    }
    return cell;
  }

  function emptyCell() {
    return { type: 'stack', direction: 'column', flex: 1, children: [{ type: 'spacer' }] };
  }

  function weekRow(rowIdx, dateSize) {
    const cells = [];
    for (let c = 0; c < 7; c++) {
      const dayNum = rowIdx * 7 + c - startOffset + 1;
      if (dayNum < 1 || dayNum > daysInMonth) cells.push(emptyCell());
      else cells.push(dayCell(dayNum, dayNum === today, c >= 5, dateSize));
    }
    return { type: 'stack', direction: 'row', children: cells };
  }

  function weekdayHeader(size) {
    return {
      type: 'stack',
      direction: 'row',
      children: WEEK_CHARS.map((w, i) => ({
        type: 'stack',
        direction: 'column',
        alignItems: 'center',
        flex: 1,
        children: [
          { type: 'text', text: w, font: { size: size, weight: 'medium' }, textColor: i >= 5 ? textWeekend : textSub },
        ],
      })),
    };
  }

  function headerRow(titleSize) {
    const c1 = shiftOf(today).name;
    const c2 = shiftOfDate(new Date(year, month, today + 1)).name;
    return {
      type: 'stack',
      direction: 'row',
      alignItems: 'center',
      children: [
        { type: 'text', text: '牛马表', font: { size: titleSize, weight: 'bold' }, textColor: textMain },
        { type: 'spacer' },
        { type: 'text', text: `今日 ${c1} · 明日 ${c2}`, font: { size: titleSize - 3, weight: 'bold' }, textColor: textMain },
        { type: 'spacer' },
        { type: 'text', text: `${year}年${month + 1}月`, font: { size: titleSize - 3, weight: 'medium' }, textColor: textSub },
      ],
    };
  }

  if (family === 'accessoryCircular') {
    return {
      type: 'widget',
      padding: 0,
      children: [
        {
          type: 'stack', direction: 'column', alignItems: 'center',
          children: [
            { type: 'text', text: shiftOf(today).name, font: { size: 13, weight: 'bold' } },
            { type: 'text', text: `${month + 1}/${today}`, font: { size: 9 } },
          ],
        },
      ],
      refreshAfter,
    };
  }
  if (family === 'accessoryInline') {
    return {
      type: 'widget',
      padding: 0,
      children: [
        { type: 'text', text: `今日${shiftOf(today).name} · 明日${shiftOfDate(new Date(year, month, today + 1)).name}`, font: { size: 12 } },
      ],
      refreshAfter,
    };
  }
  if (family && family.indexOf('accessory') === 0) {
    const t1 = shiftOf(today).name;
    const t2 = shiftOfDate(new Date(year, month, today + 1)).name;
    return {
      type: 'widget',
      padding: [4, 8, 4, 8],
      children: [
        {
          type: 'stack', direction: 'column',
          children: [
            { type: 'text', text: `今日 ${t1}`, font: { size: 13, weight: 'bold' } },
            { type: 'text', text: `明日 ${t2} · ${month + 1}月${today}日 周${weekCharOf(now)}`, font: { size: 11 } },
          ],
        },
      ],
      refreshAfter,
    };
  }

  if (family === 'systemSmall') {
    const rows = [1, 2, 3, 4].map((off) => {
      const d = new Date(year, month, today + off);
      const label = off === 1 ? '明日' : off === 2 ? '后日' : `周${weekCharOf(d)}`;
      const s = shiftOfDate(d);
      return {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        children: [
          { type: 'text', text: `${label} ${d.getMonth() + 1}/${d.getDate()}`, font: { size: 12, weight: 'medium' }, textColor: textSub },
          { type: 'spacer' },
          capsule(s, true),
        ],
      };
    });
    return {
      type: 'widget',
      padding: [12, 14, 12, 14],
      children: [
        {
          type: 'stack', direction: 'column',
          children: [
            {
              type: 'stack', direction: 'row', alignItems: 'center',
              children: [
                { type: 'text', text: `${month + 1}月${today}日`, font: { size: 14, weight: 'bold' }, textColor: textMain },
                { type: 'spacer' },
                { type: 'text', text: `今日${shiftOf(today).name}`, font: { size: 11, weight: 'bold' }, textColor: textMain },
                { type: 'spacer' },
                { type: 'text', text: `周${weekCharOf(now)}`, font: { size: 11, weight: 'medium' }, textColor: textSub },
              ],
            },
            { type: 'spacer', length: 8 },
            rows[0],
            { type: 'spacer', length: 6 },
            rows[1],
            { type: 'spacer', length: 6 },
            rows[2],
            { type: 'spacer', length: 6 },
            rows[3],
            { type: 'spacer' },
            { type: 'text', text: statsText, font: { size: 9 }, textColor: textSub, maxLines: 1 },
          ],
        },
      ],
      refreshAfter,
    };
  }

  if (family === 'systemMedium') {
    const todayRow = Math.floor((startOffset + today - 1) / 7);
    const rowA = todayRow;
    const rowB = todayRow + 1 < weekRows ? todayRow + 1 : todayRow - 1;
    const firstRow = Math.min(rowA, rowB);
    const secondRow = Math.max(rowA, rowB);
    return {
      type: 'widget',
      padding: [10, 14, 8, 14],
      children: [
        {
          type: 'stack', direction: 'column',
          children: [
            headerRow(14),
            { type: 'spacer', length: 6 },
            weekdayHeader(10),
            { type: 'spacer', length: 4 },
            weekRow(firstRow, 13),
            weekRow(secondRow, 13),
            { type: 'spacer' },
          ],
        },
      ],
      refreshAfter,
    };
  }

  const gridRows = [];
  for (let r = 0; r < weekRows; r++) {
    gridRows.push(Object.assign(weekRow(r, 15), { flex: 1 }));
  }
  return {
    type: 'widget',
    padding: [12, 14, 10, 14],
    children: [
      {
        type: 'stack', direction: 'column',
        children: [
          headerRow(16),
          { type: 'spacer', length: 8 },
          weekdayHeader(11),
          { type: 'spacer', length: 6 },
          { type: 'stack', direction: 'column', flex: 1, children: gridRows },
          { type: 'spacer', length: 4 },
          { type: 'text', text: statsText, font: { size: 10, weight: 'medium' }, textColor: textSub, maxLines: 1 },
        ],
      },
    ],
    refreshAfter,
  };
}
