/* Nhiệt kế thị trường — trang web đọc các file JSON do pipeline/build.py tạo ra. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const LW = window.LightweightCharts;
  const APP_VERSION = '2026.10.19-a'; // phải trùng với APP_VERSION trong pipeline/build.py
  const S = { paper: null, cycle: null, backtest: null, latest: null, history: [], stocks: [], setups: [], extended: [], themes: [], basket: [], industries: [], patterns: null, charts: null };
  const ranges = {};          // khoảng thời gian của từng biểu đồ
  const built = new Set();    // tab đã vẽ
  const live = {};            // biểu đồ đang hiển thị
  let hlScope = 'top';
  let cyKey = 'qqq';
  const PHC = { 'Tăng': '--good', 'Điều chỉnh': '--warn', 'Giằng co': '--c1', 'Giảm': '--bad' };
  const ppOn = new Set(['ml', 'qm', 'mm', 'wo', 'sw', 'pb', 'ok', 'vs', 'qqq']);
  const btOn = new Set(['ml', 'qm', 'mm', 'wo', 'sw', 'pb', 'ok', 'vs']);        // biểu đồ vượt đỉnh/cách đỉnh: top 100 hay toàn thị trường

  // ------------------------------------------------------------ định dạng
  const nf0 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const n0 = (v) => (isNum(v) ? nf0.format(v) : '—');
  const n1 = (v) => (isNum(v) ? nf1.format(v) : '—');
  const n2 = (v) => (isNum(v) ? nf2.format(v) : '—');
  const pct = (v, d = 1) => (isNum(v) ? (d ? nf1 : nf0).format(v) + '%' : '—');
  const spct = (v) => (isNum(v) ? (v > 0 ? '+' : '') + nf1.format(v) + '%' : '—');
  const usd = (v) => (isNum(v) ? nf0.format(v) + ' $' : '—');
  const cls = (v) => (isNum(v) ? (v > 0 ? 'up' : v < 0 ? 'dn' : '') : '');
  const fdate = (s) => (s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '—');
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null) e.setAttribute(k, v);
    }
    for (const k of kids) if (k != null) e.append(k);
    return e;
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* bỏ qua */ } },
  };

  // ------------------------------------------------------------ tab
  function showTab(name) {
    if (!$('#tab-' + name)) name = 'overview';
    $$('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    $$('.tab').forEach((t) => { t.hidden = t.id !== 'tab-' + name; });
    if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
    if (S.latest && !built.has(name)) { built.add(name); BUILD[name] && BUILD[name](); }
    store.set('nk_tab', name);
  }
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  // ------------------------------------------------------------ biểu đồ
  function baseChart(container) {
    container.replaceChildren();
    return LW.createChart(container, {
      autoSize: true,
      layout: { background: { type: 'solid', color: css('--panel') }, textColor: css('--muted'), fontFamily: css('--font'), fontSize: 11 },
      grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } },
      rightPriceScale: { borderColor: css('--line') },
      leftPriceScale: { borderColor: css('--line') },
      timeScale: { borderColor: css('--line'), rightOffset: 2 },
      crosshair: { mode: 0 },
      localization: { locale: 'vi-VN', dateFormat: 'dd/MM/yyyy' },
      handleScroll: { vertTouchDrag: false },
    });
  }
  const ser = (rows, k, f) => rows.filter((r) => isNum(r[k])).map((r) => ({ time: r.d, value: f ? f(r[k], r) : r[k] }));
  const colorOf = { 'Tốt': '--good', 'Giằng co': '--warn', 'Xấu': '--bad', 'Xanh': '--good', 'Vàng': '--warn', 'Đỏ': '--bad' };

  const CHARTS = {
    score(c, rows) {
      const s = c.addLineSeries({ lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
      s.setData(rows.map((r) => ({ time: r.d, value: r.score, color: css(colorOf[r.alert] || '--accent') })));
      [30, 50, 70].forEach((p) => s.createPriceLine({ price: p, color: css('--muted'), lineStyle: 2, lineWidth: 1, axisLabelVisible: false }));
      s.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
    },
    qqq(c, rows) {
      const s = c.addLineSeries({ lineWidth: 2, priceLineVisible: false, title: 'QQQ' });
      s.setData(rows.filter((r) => isNum(r.qqq)).map((r) => ({ time: r.d, value: r.qqq, color: css(colorOf[r.qqq_regime] || '--ink') })));
      [['qqq_e9', '--c1', 'EMA 9'], ['qqq_e21', '--c2', 'EMA 21'], ['qqq_e50', '--c3', 'EMA 50'], ['qqq_w9', '--muted', 'EMA 9 tuần']].forEach(([k, col, t]) => {
        const e = c.addLineSeries({ color: css(col), lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: t, lineStyle: k === 'qqq_w9' ? 2 : 0 });
        e.setData(ser(rows, k));
      });
    },
    b5(c, rows) {
      const s = c.addHistogramSeries({ priceLineVisible: false });
      s.setData(rows.filter((r) => isNum(r.b_ret5)).map((r) => ({ time: r.d, value: r.b_ret5, color: css(r.b_ret5 <= -5 ? '--bad' : r.b_ret5 < 0 ? '--warn' : '--good') })));
      s.createPriceLine({ price: -5, color: css('--bad'), lineStyle: 2, lineWidth: 1, title: '−5%' });
    },
    bhold(c, rows) {
      const a = c.addLineSeries({ color: css('--c1'), lineWidth: 2, priceLineVisible: false, title: 'Trên EMA 21' });
      a.setData(ser(rows, 'b_above21'));
      const b = c.addLineSeries({ color: css('--c2'), lineWidth: 2, priceLineVisible: false, title: 'Breakout giữ giá' });
      b.setData(ser(rows, 'bo_ok'));
      a.createPriceLine({ price: 40, color: css('--bad'), lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
      a.createPriceLine({ price: 60, color: css('--warn'), lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
    },
    b1(c, rows) {
      const s = c.addHistogramSeries({ priceLineVisible: false });
      s.setData(rows.filter((r) => isNum(r.b_ret1)).map((r) => ({ time: r.d, value: r.b_ret1, color: css(r.b_ret1 <= -2 ? '--bad' : r.b_ret1 < 0 ? '--warn' : '--good') })));
    },
    bgl(c, rows) {
      const roll = (k) => rows.map((r, i) => {
        const w = rows.slice(Math.max(0, i - 9), i + 1).map((x) => x[k]).filter(isNum);
        return w.length ? { time: r.d, value: w.reduce((a, b) => a + b, 0) / w.length } : null;
      }).filter(Boolean);
      c.addLineSeries({ color: css('--good'), lineWidth: 2, priceLineVisible: false, title: 'Mã tăng TB' }).setData(roll('b_gain'));
      c.addLineSeries({ color: css('--bad'), lineWidth: 2, priceLineVisible: false, title: 'Mã giảm TB' }).setData(roll('b_loss'));
    },
    sb(c, rows) {
      c.addHistogramSeries({ color: css('--good'), priceLineVisible: false, title: 'Tăng ≥4%' }).setData(ser(rows, 'up4'));
      c.addHistogramSeries({ color: css('--bad'), priceLineVisible: false, title: 'Giảm ≥4%' }).setData(ser(rows, 'dn4', (v) => -v));
      const r = c.addLineSeries({ color: css('--c1'), lineWidth: 2, priceScaleId: 'left', priceLineVisible: false, title: 'Tỷ lệ 10 ngày' });
      r.setData(ser(rows, 'ratio10'));
      r.createPriceLine({ price: 1, color: css('--c1'), lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
      c.applyOptions({ leftPriceScale: { visible: true } });
    },
    pct(c, rows) {
      [['pct_e21', '--c1', 'EMA 21'], ['pct_s40', '--c2', 'SMA 40'], ['pct_s200', '--c3', 'SMA 200']].forEach(([k, col, t]) => {
        const s = c.addLineSeries({ color: css(col), lineWidth: 2, priceLineVisible: false, title: t });
        s.setData(ser(rows, k));
        if (k === 'pct_s40') { s.createPriceLine({ price: 20, color: css('--good'), lineStyle: 2, lineWidth: 1 }); s.createPriceLine({ price: 70, color: css('--warn'), lineStyle: 2, lineWidth: 1 }); }
      });
    },
    nhnl(c, rows) {
      c.addHistogramSeries({ color: css('--good'), priceLineVisible: false, title: 'Đỉnh 52 tuần' }).setData(ser(rows, 'nh52'));
      c.addHistogramSeries({ color: css('--bad'), priceLineVisible: false, title: 'Đáy 52 tuần' }).setData(ser(rows, 'nl52', (v) => -v));
    },
    q25(c, rows) {
      c.addLineSeries({ color: css('--good'), lineWidth: 2, priceLineVisible: false, title: 'Tăng ≥25%' }).setData(ser(rows, 'q_up25'));
      c.addLineSeries({ color: css('--bad'), lineWidth: 2, priceLineVisible: false, title: 'Giảm ≥25%' }).setData(ser(rows, 'q_dn25'));
    },
    lead(c, rows) {
      const s = c.addHistogramSeries({ priceLineVisible: false, title: 'Mã đà tăng mạnh' });
      s.setData(rows.filter((r) => isNum(r.leaders)).map((r) => ({ time: r.d, value: r.leaders, color: css(colorOf[r.qqq_regime] || '--accent') })));
      const h = c.addLineSeries({ color: css('--c1'), lineWidth: 1, priceScaleId: 'left', priceLineVisible: false, title: '% top 100 trên EMA 9' });
      h.setData(ser(rows, 'leader_health'));
      c.applyOptions({ leftPriceScale: { visible: true } });
    },
    bnh(c, rows) {
      c.addHistogramSeries({ color: css('--good'), priceLineVisible: false, title: 'Đỉnh 1 năm' }).setData(ser(rows, 'b_nh52'));
      c.addLineSeries({ color: css('--c1'), lineWidth: 1, priceLineVisible: false, title: 'Đỉnh 20 phiên' }).setData(ser(rows, 'b_nh20'));
      c.addLineSeries({ color: css('--c2'), lineWidth: 3, priceLineVisible: false, title: 'TB 10 phiên' }).setData(ser(rows, 'b_nh20_ma'));
    },
    bdd(c, rows) {
      c.addLineSeries({ color: css('--c1'), lineWidth: 2, priceLineVisible: false, title: 'Cách đỉnh < 20%' }).setData(ser(rows, 'b_w20'));
      c.addLineSeries({ color: css('--c4'), lineWidth: 2, priceLineVisible: false, title: 'Cách đỉnh < 10%' }).setData(ser(rows, 'b_w10'));
      c.addLineSeries({ color: css('--bad'), lineWidth: 1, lineStyle: 2, priceScaleId: 'left', priceLineVisible: false, title: 'Trung vị % cách đỉnh' }).setData(ser(rows, 'b_ddmed'));
      c.applyOptions({ leftPriceScale: { visible: true } });
    },
    bret(c, rows) {
      [['b_ret3', '--c2', '3 phiên'], ['b_ret5', '--c1', '5 phiên'], ['b_ret21', '--c3', '1 tháng']].forEach(([k, col, t]) => {
        const l = c.addLineSeries({ color: css(col), lineWidth: 2, priceLineVisible: false, title: t });
        l.setData(ser(rows, k));
        if (k === 'b_ret5') l.createPriceLine({ price: 0, color: css('--muted'), lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
      });
    },
    pat(c, rows) {
      const P = S.patterns, from = rows.length ? rows[0].d : '';
      const idx = P.dates.map((d, i) => [d, i]).filter(([d]) => d >= from);
      const group = (kind) => idx.map(([d, i]) => {
        let n = 0, w = 0;
        for (const st of P.stats) if (st.kind === kind) { const sr = P.series[st.p]; const nn = sr.n5[i], ww = sr.win5[i]; if (isNum(nn) && isNum(ww) && nn > 0) { n += nn; w += ww * nn; } }
        return n >= 5 ? { time: d, value: w / n } : null;
      }).filter(Boolean);
      const a = c.addLineSeries({ color: css('--c1'), lineWidth: 2, priceLineVisible: false, title: 'Breakout' }); a.setData(group('break'));
      c.addLineSeries({ color: css('--c2'), lineWidth: 2, priceLineVisible: false, title: 'Mua điều chỉnh' }).setData(group('pull'));
      const one = $('#sel-pat').value;
      if (one && P.series[one]) c.addLineSeries({ color: css('--c3'), lineWidth: 1, lineStyle: 2, priceLineVisible: false, title: one })
        .setData(idx.map(([d, i]) => (isNum(P.series[one].win5[i]) && P.series[one].n5[i] >= 3 ? { time: d, value: P.series[one].win5[i] } : null)).filter(Boolean));
      a.createPriceLine({ price: 50, color: css('--muted'), lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
    },
    hl(c, rows) {
      const all = hlScope === 'all';
      const [kn, k10, k20] = all ? ['m_nh', 'm_w10', 'm_w20'] : ['b_nh52', 'b_w10', 'b_w20'];
      const tot = all ? null : (S.latest.basket_size || 100);
      // vẽ chồng: cột ≤20% ở dưới cùng, rồi ≤10%, rồi vượt đỉnh, để mỗi phần màu là một nhóm
      c.addHistogramSeries({ color: css('--warn'), priceLineVisible: false, lastValueVisible: false, title: '' }).setData(ser(rows, k20));
      c.addHistogramSeries({ color: css('--c4'), priceLineVisible: false, lastValueVisible: false, title: '' }).setData(ser(rows, k10));
      const nh = c.addHistogramSeries({ color: css('--good'), priceLineVisible: false, lastValueVisible: false, title: '' });
      nh.setData(ser(rows, kn));
      if (tot) nh.createPriceLine({ price: tot, color: css('--muted'), lineStyle: 2, lineWidth: 1, title: `${tot} mã` });
      const lbl = $('#hl-tiles'); lbl.replaceChildren();
      const last = rows[rows.length - 1] || {}, prev = rows[rows.length - 6] || {};
      const d = (k) => (isNum(last[k]) && isNum(prev[k]) ? `5 phiên trước: ${n0(prev[k])}` : '');
      const up = (k) => (last[k] > prev[k] ? 'up' : last[k] < prev[k] ? 'dn' : '');
      tile(lbl, 'Vượt đỉnh 1 năm', n0(last[kn]), d(kn), up(kn));
      tile(lbl, 'Cách đỉnh dưới 10%', n0(last[k10]), d(k10), up(k10));
      tile(lbl, 'Cách đỉnh dưới 20%', n0(last[k20]), d(k20), up(k20));
      if (!tot && isNum(last.n)) tile(lbl, 'Tổng số mã quét', n0(last.n), isNum(last[k20]) ? `${n0(last[k20] / last.n * 100)}% cách đỉnh dưới 20%` : '');
      if (tot && isNum(last[k20])) tile(lbl, 'Giảm sâu hơn 20%', n0(tot - last[k20]), isNum(prev[k20]) ? `5 phiên trước: ${n0(tot - prev[k20])}` : '', tot - last[k20] > tot - prev[k20] ? 'dn' : 'up');
    },
    tbh(c, rows) {
      const a = c.addLineSeries({ color: css('--c1'), lineWidth: 2, priceLineVisible: false, title: 'Giữ giá sau 5 phiên' });
      a.setData(ser(rows, 'tb_hold5'));
      a.createPriceLine({ price: 50, color: css('--muted'), lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
      c.addHistogramSeries({ color: css('--grid'), priceScaleId: 'left', priceLineVisible: false, title: 'Số breakout 20 phiên' }).setData(ser(rows, 'tb_n'));
      c.applyOptions({ leftPriceScale: { visible: true } });
    },
    pb(c, rows) {
      c.addLineSeries({ color: css('--c1'), lineWidth: 2, priceLineVisible: false, title: 'Số phiên điều chỉnh (trung vị)' }).setData(ser(rows, 'pb_days'));
      c.addLineSeries({ color: css('--bad'), lineWidth: 2, priceScaleId: 'left', priceLineVisible: false, title: 'Độ sâu % (trung vị)' }).setData(ser(rows, 'pb_depth'));
      c.applyOptions({ leftPriceScale: { visible: true } });
    },
    cyc(c, rows) {
      const Y = S.cycle, X = Y[cyKey]; if (!X) return;
      const from = rows.length ? rows[0].d : '';
      const pts = Y.dates.map((d, i) => [d, X.close[i], X.phase[i]]).filter(([d, v]) => d >= from && isNum(v));
      c.addLineSeries({ lineWidth: 2, priceLineVisible: false, title: cyKey === 'qqq' ? 'QQQ' : 'Top 100' })
        .setData(pts.map(([d, v, p]) => ({ time: d, value: v, color: css(PHC[p] || '--muted') })));
      const band = c.addHistogramSeries({ priceScaleId: 'band', priceLineVisible: false, lastValueVisible: false });
      band.setData(pts.map(([d, , p]) => ({ time: d, value: 1, color: css(PHC[p] || '--muted') })));
      c.priceScale('band').applyOptions({ scaleMargins: { top: 0.93, bottom: 0 }, visible: false });
    },
    pp(c) {
      const P = S.paper, A = P.accounts || {};
      for (const L of LEGENDS) { const a = A[L.id]; if (!a || !ppOn.has(L.id) || !a.curve || !a.curve.length) continue;
        c.addLineSeries({ color: css(L.color), lineWidth: 2, priceLineVisible: false, title: L.short }).setData(a.curve.map(([d, v]) => ({ time: d, value: v }))); }
      if (ppOn.has('qqq') && P.qqq && P.qqq.length) c.addLineSeries({ color: css('--muted'), lineWidth: 2, lineStyle: 2, priceLineVisible: false, title: 'QQQ' }).setData(P.qqq.map(([d, v]) => ({ time: d, value: v })));
      const z = c.addLineSeries({ color: 'transparent', priceLineVisible: false, lastValueVisible: false }); if (P.qqq && P.qqq.length) z.setData([{ time: P.qqq[0][0], value: 0 }]);
      z.createPriceLine({ price: 0, color: css('--muted'), lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
    },
    bt(c, rows) {
      const from = rows.length ? rows[0].d : '';
      const B = S.backtest.strategies || {};
      for (const L of LEGENDS) {
        const b = B[L.id]; if (!b || !b.curve || !btOn.has(L.id)) continue;
        const pts = b.curve.filter(([d]) => d >= from); if (!pts.length) continue;
        const base = pts[0][1] || 0;
        c.addLineSeries({ color: css(L.color), lineWidth: 2, priceLineVisible: false, title: L.short }).setData(pts.map(([d, v]) => ({ time: d, value: (v || 0) - base })));
      }
      const z = c.addLineSeries({ color: 'transparent', priceLineVisible: false, lastValueVisible: false }); z.setData(rows.length ? [{ time: rows[0].d, value: 0 }] : []);
      z.createPriceLine({ price: 0, color: css('--muted'), lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
    },
    mcc(c, rows) {
      const s = c.addHistogramSeries({ priceLineVisible: false });
      s.setData(rows.filter((r) => isNum(r.mcclellan)).map((r) => ({ time: r.d, value: r.mcclellan, color: css(r.mcclellan >= 0 ? '--good' : '--bad') })));
    },
  };

  function drawSurv() {
    const box = $('#ch-surv');
    if (!box || box.closest('.tab').hidden) return;
    if (live.surv) { live.surv.remove(); delete live.surv; }
    const TS = S.latest.top_stats || {};
    const c = baseChart(box);
    c.applyOptions({ timeScale: { tickMarkFormatter: (t) => String(t), fixLeftEdge: true, fixRightEdge: true }, localization: { timeFormatter: (t) => `Sau ${t} phiên`, priceFormatter: (v) => n0(v) + '%' } });
    const mk = (arr) => (arr || []).map((v, i) => (isNum(v) ? { time: i + 1, value: v } : null)).filter(Boolean);
    c.addLineSeries({ color: css('--muted'), lineWidth: 2, lineStyle: 2, priceLineVisible: false, title: '120 phiên trước' }).setData(mk(TS.bo_before));
    const a = c.addLineSeries({ color: css('--good'), lineWidth: 3, priceLineVisible: false, title: '40 phiên gần đây' });
    a.setData(mk(TS.bo_recent));
    a.createPriceLine({ price: 50, color: css('--muted'), lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
    c.timeScale().fitContent();
    live.surv = c;
  }
  function drawHistChart(key) {
    const box = $('#ch-' + key);
    if (!box || box.closest('.tab').hidden) return;
    if (live[key]) { live[key].remove(); delete live[key]; }
    const days = ranges[key] ?? 126;
    const rows = days ? S.history.slice(-days) : S.history;
    const c = baseChart(box);
    CHARTS[key](c, rows);
    c.timeScale().fitContent();
    live[key] = c;
  }
  function rangeButtons() {
    $$('.range').forEach((r) => {
      const key = r.dataset.chart;
      ranges[key] = ranges[key] ?? 126;
      r.replaceChildren(...[[63, '3T'], [126, '6T'], [252, '1N'], [0, 'Tất cả']].map(([d, t]) =>
        el('button', { type: 'button', 'aria-pressed': String(ranges[key] === d), text: t, onclick: (ev) => {
          ranges[key] = d; $$('button', r).forEach((b) => b.setAttribute('aria-pressed', String(b === ev.currentTarget))); drawHistChart(key);
        } })));
    });
  }

  // ------------------------------------------------------------ bảng
  function table(tbl, cols, rows, opt = {}) {
    let key = opt.sort ?? null, dir = opt.dir ?? -1;
    const thead = el('thead'), tbody = el('tbody');
    tbl.replaceChildren(thead, tbody);
    const draw = () => {
      thead.replaceChildren(el('tr', {}, ...cols.map((c) => {
        const th = el('th', { class: c.l ? 'l' : null, text: c.label, title: c.title || null });
        if (c.k === key) th.setAttribute('aria-sort', dir > 0 ? 'ascending' : 'descending');
        th.addEventListener('click', () => { if (key === c.k) dir = -dir; else { key = c.k; dir = c.l ? 1 : -1; } draw(); });
        return th;
      })));
      const sorted = key ? rows.slice().sort((a, b) => {
        const c = cols.find((x) => x.k === key); const va = c.sv ? c.sv(a) : a[key], vb = c.sv ? c.sv(b) : b[key];
        if (va == null) return 1; if (vb == null) return -1;
        return (typeof va === 'string' ? va.localeCompare(vb, 'vi') : va - vb) * dir;
      }) : rows;
      if (!sorted.length) { tbody.replaceChildren(el('tr', {}, el('td', { colspan: cols.length, class: 'empty l', text: opt.empty || 'Không có dữ liệu.' }))); return; }
      const shown = opt.limit && sorted.length > opt.limit ? sorted.slice(0, opt.limit) : sorted;
      tbody.replaceChildren(...shown.map((r) => {
        const tr = el('tr', { class: [opt.onRow ? 'click' : '', opt.rowClass ? opt.rowClass(r) : ''].join(' ').trim() || null });
        if (opt.onRow) tr.addEventListener('click', (e) => { if (!e.target.closest('button')) opt.onRow(r); });
        for (const c of cols) {
          const td = el('td', { class: [c.l ? 'l' : '', c.tk ? 'tk' : '', c.c ? c.c(r) : ''].join(' ').trim() || null, title: c.tk && r.name ? r.name : null });
          const v = c.f ? c.f(r) : r[c.k];
          if (v instanceof Node) td.append(v); else td.textContent = v == null ? '—' : v;
          tr.append(td);
        }
        return tr;
      }));
      if (shown.length < sorted.length) tbody.append(el('tr', {}, el('td', { colspan: cols.length, class: 'empty l', text: `Đang hiện ${shown.length} / ${sorted.length} mã theo cột đang sắp xếp. Gõ mã hoặc lọc để xem mã khác.` })));
    };
    draw();
  }
  const earnDays = (r) => { if (!r.earn || !S.latest) return null; const d = Math.round((new Date(r.earn) - new Date(S.latest.asof)) / 864e5); return d >= 0 ? d : null; };
  const tags = (r) => {
    const f = document.createDocumentFragment();
    const ed = earnDays(r);
    if (ed !== null && ed <= 14) f.append(el('span', { class: 'tag ' + (ed <= 5 ? 'bad' : 'warn'), text: `BCTC sau ${ed} ngày`, title: `Báo cáo kết quả kinh doanh ngày ${fdate(r.earn)}. Minervini và O'Neil tránh mở vị thế mới ngay trước ngày này.` }));
    if (isNum(r.ipo)) f.append(el('span', { class: 'tag ipo', text: `IPO ${Math.max(1, Math.round(r.ipo / 21))} tháng`, title: 'Mới niêm yết dưới 1 năm. Nhiều siêu cổ chạy mạnh nhất trong năm đầu sau IPO.' }));
    if (S.stocks.length && !r._nob) f.append(badges(r.t));
    for (const v of r.vsa || []) f.append(el('span', { class: 'tag vsa', text: 'VSA: ' + v }));
    if (r.leader) f.append(el('span', { class: 'tag ld', text: 'Top 100' }));
    if (r.tt) f.append(el('span', { class: 'tag tt', text: 'Trend Template' }));
    for (const t of r.setups || []) f.append(el('span', { class: 'tag', text: t }));
    return f;
  };
  const tile = (box, label, value, sub, vcls) => box.append(el('div', { class: 'tile' }, el('span', { class: 'lb', text: label }),
    value instanceof Node ? el('span', { class: 'v' }, value) : el('span', { class: 'v ' + (vcls || ''), text: value }), sub ? el('span', { class: 'd', text: sub }) : null));
  const pill = (reg) => el('span', { class: 'pill r-' + (reg || '').split(' ')[0], text: reg || '—' });
  const delta = (a, b, unit = '') => (isNum(a) && isNum(b) ? `${a - b > 0 ? '+' : ''}${n0(a - b)}${unit} so với 5 phiên trước` : '');

  // ------------------------------------------------------------ từng tab
  const BUILD = {
    overview() {
      const L = S.latest;
      $('#score').textContent = L.score;
      $('#stance').textContent = L.stance;
      $('#score-delta').textContent = delta(L.score, L.score5, ' điểm');
      $('#scale-dot').style.left = Math.max(0, Math.min(100, L.score)) + '%';
      const gc = $('#gauge-card'); gc.style.borderColor = css(L.score >= 70 ? '--good' : L.score >= 50 ? '--line' : L.score >= 30 ? '--warn' : '--bad');
      $('#stance').className = 'stance ' + (L.score >= 70 ? 'up' : L.score >= 50 ? '' : L.score >= 30 ? 'wa' : 'dn');
      const adv = {
        'Tấn công': 'Thị trường thuận lợi. Giải ngân 75–100%, tìm điểm mua ở mã top 100 trong tab "Setup hôm nay".',
        'Bình thường': 'Giải ngân 50–75%. Chỉ vào các setup rõ ràng nhất, giữ rủi ro mỗi lệnh bình thường.',
        'Thận trọng': 'Tối đa khoảng 25% vốn, giảm rủi ro mỗi lệnh một nửa, không mua đuổi.',
        'Phòng thủ': 'Đứng ngoài, giữ tiền mặt. Chờ nhóm dẫn đầu và độ rộng phục hồi rồi mới mua lại.',
      };
      $('#advice').textContent = adv[L.stance] || '';
      const ac = $('#alert-card'); ac.className = 'alert-card lv-' + L.alert;
      $('#alert-level').textContent = L.alert;
      $('#alert-reasons').replaceChildren(...(L.alert_reasons.length ? L.alert_reasons : ['Không có tín hiệu bất thường.']).map((t) => el('li', { text: t })));
      const T = $('#ov-tiles'); T.replaceChildren();
      tile(T, 'Xu hướng QQQ', el('span', {}, pill(L.qqq_regime)), `IWM: ${L.iwm_regime} · ${L.qqq_vs_w9} EMA 9 tuần`);
      tile(T, 'Giai đoạn (Weinstein)', L.stage.split(' (')[0], L.stage.includes('(') ? L.stage.split('(')[1].replace(')', '') : '');
      tile(T, 'Ngày phân phối QQQ', `${L.dd_qqq}/25`, `SPY: ${L.dd_spy}/25`, L.dd_qqq >= 6 ? 'dn' : L.dd_qqq >= 4 ? 'wa' : '');
      tile(T, 'Ngày xác nhận tăng', L.ftd_date ? fdate(L.ftd_date) : '—', L.ftd_status);
      tile(T, 'Số mã đà tăng mạnh', n0(L.leaders), delta(L.leaders, L.leaders5, ' mã'));
      tile(T, 'Mã trên EMA 21', pct(L.pct_e21, 0), delta(L.pct_e21, L.pct_e21_5, ' điểm %'));
      tile(T, 'Đỉnh / đáy 20 phiên', `${L.nh20} / ${L.nl20}`, `52 tuần: ${L.nh52} / ${L.nl52}`);
      tile(T, 'Stockbee 10 ngày', n2(L.ratio10), L.ratio10 >= 1 ? 'bên mua mạnh hơn' : 'bên bán mạnh hơn', L.ratio10 >= 1 ? 'up' : 'dn');
      tile(T, 'Đạt Trend Template', pct(L.pct_tt, 0), `${L.universe} mã theo dõi`);
      tile(T, 'Setup đạt chuẩn', n0(L.n_setups), 'stop trong mức cho phép');
      const btr = Object.entries((S.backtest || {}).strategies || {}).filter(([, v]) => v.recent && v.recent.n >= 5).sort((a, b) => (b[1].recent.exp ?? -9) - (a[1].recent.exp ?? -9))[0];
      if (btr) { const Lg = LEGENDS.find((x) => x.id === btr[0]); tile(T, 'Hiệu quả nhất 60 phiên', Lg ? Lg.name : btr[0], `${btr[1].recent.exp > 0 ? '+' : ''}${n2(btr[1].recent.exp)}R/lệnh · thắng ${n0(btr[1].recent.win)}% · ${btr[1].recent.n} lệnh`, btr[1].recent.exp > 0 ? 'up' : 'dn'); }
      const ck = L.checklist || [];
      const dot = { good: 'Thuận lợi', warn: 'Trung tính', bad: 'Bất lợi' };
      $('#ck').replaceChildren(...ck.map((c) => el('li', { class: 'ck-' + c.state },
        el('span', { class: 'dot', title: dot[c.state] }), el('div', {}, el('b', { text: c.rule }), el('small', { text: `${c.who} · ${c.value}` })))));
      const ng = ck.filter((c) => c.state === 'good').length;
      $('#ck-sum').textContent = `${ng}/${ck.length} thuận lợi`;
      $('#ck-sum').className = 'ck-sum ' + (ng >= 6 ? 'up' : ng >= 4 ? 'wa' : 'dn');
      const by = Object.fromEntries(S.stocks.map((s) => [s.t, s]));
      const crit = (s) => [
        ['Top 100', isNum(s.rs_pos) && s.rs_pos <= 100], ['Ngành top 10', isNum(s.ind_rank) && s.ind_rank <= 10], ['Giai đoạn 2', s.stage === 2],
        ['DT +20%', isNum(s.rev_yoy) && s.rev_yoy >= 20], ['EPS +25%', isNum(s.eps_yoy) && s.eps_yoy >= 25], ['RS đỉnh mới', !!s.rsnh]];
      const picks = S.setups.filter((x) => x.ok).map((x) => { const s = Object.assign({}, by[x.t] || {}, x); const c = crit(s); return Object.assign(s, { _c: c, _n: c.filter((z) => z[1]).length }); })
        .sort((a, b) => b._n - a._n || (a.rs_pos ?? 1e9) - (b.rs_pos ?? 1e9)).slice(0, 8);
      $('#picks').replaceChildren(...(picks.length ? picks.map((p) => {
        const ed = earnDays(p);
        return el('button', { class: 'pick', type: 'button', onclick: () => openChart(p.t, p) },
          el('div', { class: 'pick-h' }, el('span', { class: 'tk', text: p.t }), el('span', { class: 'pick-n', text: `${p._n}/6` })),
          el('div', { class: 'pick-s', text: p.setups.join(' · ') }),
          el('div', { class: 'pick-b' }, badges(p.t)),
          el('div', { class: 'pick-m', text: `Mua ${n2(p.entry)} · stop ${n2(p.stop)} (${pct(p.stop_pct)})` }),
          el('div', { class: 'pick-c' }, ...p._c.map(([t, ok]) => el('span', { class: ok ? 'on' : 'off', text: t })),
            ed !== null && ed <= 14 ? el('span', { class: 'warnc', text: `BCTC sau ${ed} ngày` }) : null));
      }) : [el('p', { class: 'empty', text: 'Hôm nay không có setup nào có stop trong mức cho phép.' })]));
      drawHistChart('score'); drawHistChart('qqq');
    },
    basket() {
      const B = S.latest.basket, T = $('#bk-tiles'); T.replaceChildren();
      const B2 = S.latest.basket2 || {}, N = S.latest.basket_size || 50;
      $$('.bk-n').forEach((e) => { e.textContent = N; });
      const P = $('#bk-period'); P.replaceChildren();
      tile(P, '1 phiên', spct(B2.b_ret1), `${pct(B.b_up, 0)} số mã tăng`, cls(B2.b_ret1));
      tile(P, '3 phiên', spct(B2.b_ret3), 'nhóm chốt từ 3 phiên trước', cls(B2.b_ret3));
      tile(P, '5 phiên', spct(B2.b_ret5), isNum(B2.b_ret5_5) ? `5 phiên trước: ${spct(B2.b_ret5_5)}` : '', cls(B2.b_ret5));
      tile(P, '1 tháng', spct(B2.b_ret21), 'nhóm chốt từ 21 phiên trước', cls(B2.b_ret21));
      tile(P, 'Lập đỉnh mới 1 năm', `${n0(B2.b_nh52)} mã`, isNum(B2.b_nh52_5) ? `5 phiên trước: ${n0(B2.b_nh52_5)} · 1 tháng: ${n0(B2.b_nh52_21)}` : '', B2.b_nh52 > B2.b_nh52_5 ? 'up' : B2.b_nh52 < B2.b_nh52_5 ? 'dn' : '');
      tile(P, 'Cách đỉnh dưới 20%', `${n0(B2.b_w20)}/${N}`, isNum(B2.b_w20_5) ? `5 phiên trước: ${n0(B2.b_w20_5)} · 1 tháng: ${n0(B2.b_w20_21)}` : '', B2.b_w20 < 0.6 * N ? 'dn' : B2.b_w20 < 0.8 * N ? 'wa' : 'up');
      $('#bk-notes').replaceChildren(...(S.latest.notes_basket || []).map((t) => el('li', { text: t })));
      const TS = S.latest.top_stats || {};
      const st = TS.state || {}, tot = (st.at_high || 0) + (st.pb_short || 0) + (st.pb_mid || 0) + (st.pb_long || 0);
      const seg = (k, lbl, col) => { const n = st[k] || 0; return n ? el('div', { class: 'sb-seg', style: `flex:${n};background:${css(col)}`, title: `${lbl}: ${n} mã` }, el('b', { text: n }), el('span', { text: lbl })) : null; };
      $('#statebar').replaceChildren(tot ? el('div', { class: 'sb' }, seg('at_high', 'Sát đỉnh', '--good'), seg('pb_short', 'Điều chỉnh 1–5 phiên', '--c4'), seg('pb_mid', '6–15 phiên', '--warn'), seg('pb_long', 'Trên 15 phiên', '--bad')) : el('p', { class: 'empty', text: 'Chưa có dữ liệu.' }),
        el('p', { class: 'note', text: `${TS.holding ?? 0} mã đang giữ được breakout gần nhất. Mã sát đỉnh và điều chỉnh ngắn là nơi tìm điểm mua; nhóm đỏ dài ra là dòng tiền đang rời top 100.` }));
      const bt = $('#bo-tiles'); bt.replaceChildren();
      const R = TS.bo_recent || [], Bf = TS.bo_before || [];
      const dv = (a, b) => (isNum(a) && isNum(b) ? `trước: ${n0(b)}%` : '');
      tile(bt, 'Giữ sau 3 phiên', pct(R[2], 0), dv(R[2], Bf[2]), R[2] >= Bf[2] ? 'up' : 'dn');
      tile(bt, 'Giữ sau 5 phiên', pct(R[4], 0), dv(R[4], Bf[4]), R[4] >= Bf[4] ? 'up' : 'dn');
      tile(bt, 'Giữ sau 10 phiên', pct(R[9], 0), dv(R[9], Bf[9]), R[9] >= Bf[9] ? 'up' : 'dn');
      tile(bt, 'Một nửa giữ được', isNum(TS.bo_med) ? (TS.bo_med > 20 ? '> 20 phiên' : `${TS.bo_med - 1} phiên`) : '—', isNum(TS.bo_med_before) ? `trước: ${TS.bo_med_before > 20 ? '> 20' : TS.bo_med_before - 1} phiên` : '');
      drawSurv();
      const pt = $('#pb-tiles'); pt.replaceChildren();
      const P0 = TS.pb_recent || {}, P1 = TS.pb_before || {};
      tile(pt, 'Thời gian điều chỉnh', isNum(P0.days) ? `${P0.days} phiên` : '—', isNum(P1.days) ? `trước: ${P1.days} phiên` : '', P0.days <= P1.days ? 'up' : 'wa');
      tile(pt, 'Độ sâu', pct(isNum(P0.depth) ? Math.abs(P0.depth) : null), isNum(P1.depth) ? `trước: ${pct(Math.abs(P1.depth))}` : '', Math.abs(P0.depth) <= Math.abs(P1.depth) ? 'up' : 'wa');
      tile(pt, 'Hồi phục lên đỉnh', pct(P0.rec_rate, 0), isNum(P1.rec_rate) ? `trước: ${n0(P1.rec_rate)}%` : '', P0.rec_rate >= P1.rec_rate ? 'up' : 'dn');
      tile(pt, '3/4 nhịp kết thúc trong', isNum(P0.days_q3) ? `${P0.days_q3} phiên` : '—', `${n0(P0.n)} nhịp trong 40 phiên`);
      tile(T, 'Mã tăng tăng TB', spct(B.b_gain), 'trong các mã tăng', 'up');
      tile(T, 'Mã giảm giảm TB', spct(B.b_loss), `${n0(B.b_bigdown)} mã giảm ≥ 4%`, 'dn');
      tile(T, 'Còn trên EMA 21', pct(B.b_above21, 0), `trong ${N} mã`, B.b_above21 < 40 ? 'dn' : B.b_above21 < 60 ? 'wa' : 'up');
      tile(T, 'Cách đỉnh 20 phiên', spct(B.b_offhigh), 'trung bình của nhóm');
      tile(T, 'Breakout giữ giá', pct(B.bo_ok, 0), `${n0(B.bo_n)} breakout 5 phiên trước, TB ${spct(B.bo_ret)}`, B.bo_ok < 35 ? 'dn' : B.bo_ok < 50 ? 'wa' : 'up');
      ['hl', 'pb', 'tbh', 'bnh', 'bret', 'bhold', 'b1', 'bgl'].forEach(drawHistChart);
      ['top', 'all'].forEach((k) => $('#hl-' + k).addEventListener('click', () => { hlScope = k; $('#hl-top').setAttribute('aria-pressed', String(k === 'top')); $('#hl-all').setAttribute('aria-pressed', String(k === 'all')); drawHistChart('hl'); }));
      $('#wl-basket').onclick = () => exportWatchlist(S.basket.map((r) => r.t), 'nhom-manh-nhat');
      table($('#tb-basket'), [
        { k: 't', label: 'Mã', tk: true },
        { k: 'rs_pos', label: 'Hạng', f: (r) => n0(r.rs_pos) },
        { k: 'ind', label: 'Ngành', l: true, f: (r) => r.ind || r.theme },
        { k: 'ind_rank', label: 'Hạng ngành', f: (r) => (isNum(r.ind_rank) ? `${r.ind_rank}/${S.latest.n_ind}` : '—') },
        { k: 'close', label: 'Giá', f: (r) => n2(r.close) },
        { k: 'chg', label: 'Phiên', f: (r) => spct(r.chg), c: (r) => cls(r.chg) },
        { k: 'r5', label: '5 phiên', f: (r) => spct(r.r5), c: (r) => cls(r.r5) },
        { k: 'r21', label: '1 tháng', f: (r) => spct(r.r21), c: (r) => cls(r.r21) },
        { k: 'pk_days', label: 'Từ đỉnh', f: (r) => (isNum(r.pk_days) ? (r.pk_days === 0 ? 'Đỉnh mới' : `${r.pk_days} phiên`) : '—'), c: (r) => (r.pk_days === 0 ? 'up' : r.pk_days > 15 ? 'dn' : ''), title: 'Số phiên kể từ đỉnh 60 phiên' },
        { k: 'pk_dd', label: 'Cách đỉnh', f: (r) => spct(r.pk_dd), c: (r) => (r.pk_dd < -15 ? 'dn' : '') },
        { k: 'bo_hold', label: 'Giữ breakout', f: (r) => (isNum(r.bo_hold) ? `${r.bo_hold} phiên` : '—'), title: 'Breakout gần nhất vẫn giữ trên điểm breakout được bao nhiêu phiên' },
        { k: 'd21', label: 'So EMA 21', f: (r) => spct(r.d21), c: (r) => cls(r.d21) },
        { k: 'stage', label: 'Giai đoạn', f: (r) => (r.stage ? String(r.stage) : '—'), c: (r) => (r.stage === 2 ? 'up' : r.stage === 4 ? 'dn' : '') },
        { k: 'setups', label: 'Ghi chú', l: true, f: (r) => { const f = tags(r); if (r.rsnh) f.append(el('span', { class: 'tag', text: 'RS đỉnh mới' })); return f; }, sv: (r) => (r.setups || []).length },
      ], S.basket, { sort: 'rs_pos', dir: 1, onRow: (r) => openChart(r.t) });
    },
    breadth() {
      const L = S.latest, T = $('#br-tiles'); T.replaceChildren();
      tile(T, 'Tăng / giảm ≥ 4% hôm nay', `${L.up4} / ${L.dn4}`, 'kèm khối lượng tăng');
      tile(T, 'Tỷ lệ Stockbee 5 ngày', n2(L.ratio5), '', L.ratio5 >= 1 ? 'up' : 'dn');
      tile(T, 'Tỷ lệ Stockbee 10 ngày', n2(L.ratio10), '', L.ratio10 >= 1 ? 'up' : 'dn');
      tile(T, 'Mã trên SMA 40', pct(L.pct_s40, 0), L.pct_s40 < 20 ? 'quá bán' : L.pct_s40 > 70 ? 'hưng phấn' : '', L.pct_s40 < 20 ? 'up' : L.pct_s40 > 70 ? 'wa' : '');
      tile(T, 'Mã trên SMA 200', pct(L.pct_s200, 0), 'xu hướng dài hạn');
      tile(T, 'Tăng / giảm ≥ 25% trong quý', `${L.q_up25} / ${L.q_dn25}`, '');
      tile(T, 'McClellan', n1(L.mcclellan), '', cls(L.mcclellan));
      ['sb', 'pct', 'nhnl', 'q25', 'lead', 'mcc'].forEach(drawHistChart);
    },
    leaders() {
      table($('#tb-themes'), [
        { k: 'theme', label: 'Ngành', l: true },
        { k: 'n', label: 'Số mã' },
        { k: 'leaders', label: 'Top 100', f: (r) => `${r.leaders}${r.leaders !== r.leaders5 ? ` (${r.leaders - r.leaders5 > 0 ? '+' : ''}${r.leaders - r.leaders5})` : ''}`, c: (r) => cls(r.leaders - r.leaders5) },
        { k: 'tt', label: 'Trend Template' },
        { k: 'rs', label: 'RS TB', f: (r) => n0(r.rs) },
        { k: 'above21', label: 'Trên EMA 21', f: (r) => pct(r.above21, 0) },
        { k: 'r5', label: '5 phiên', f: (r) => spct(r.r5), c: (r) => cls(r.r5) },
        { k: 'r21', label: '1 tháng', f: (r) => spct(r.r21), c: (r) => cls(r.r21) },
      ], S.themes, { sort: 'leaders' });
      const rk = (a, b) => (isNum(a) && isNum(b) ? a - b : null);
      const drawInd = () => {
        const q = $('#q-ind').value.trim().toLowerCase();
        const rows = S.industries.filter((r) => !q || r.ind.toLowerCase().includes(q)).map((r) => Object.assign({}, r, { d5: rk(r.rank5, r.rank), d21: rk(r.rank21, r.rank) }));
        $('#ind-count').textContent = `${rows.length} ngành`;
        table($('#tb-ind'), [
          { k: 'rank', label: 'Hạng' },
          { k: 'ind', label: 'Ngành', l: true },
          { k: 'd5', label: '1 tuần', f: (r) => (isNum(r.d5) ? (r.d5 > 0 ? '▲ ' : r.d5 < 0 ? '▼ ' : '') + Math.abs(r.d5) : '—'), c: (r) => cls(r.d5), title: 'Số bậc thay đổi so với 5 phiên trước' },
          { k: 'd21', label: '1 tháng', f: (r) => (isNum(r.d21) ? (r.d21 > 0 ? '▲ ' : r.d21 < 0 ? '▼ ' : '') + Math.abs(r.d21) : '—'), c: (r) => cls(r.d21) },
          { k: 'n', label: 'Số mã' },
          { k: 'rs', label: 'RS TB', f: (r) => n0(r.rs) },
          { k: 'r5', label: '5 phiên', f: (r) => spct(r.r5), c: (r) => cls(r.r5) },
          { k: 'r21', label: '1 tháng', f: (r) => spct(r.r21), c: (r) => cls(r.r21) },
          { k: 'r63', label: '3 tháng', f: (r) => spct(r.r63), c: (r) => cls(r.r63) },
          { k: 'top', label: 'Top 100' },
          { k: 'best', label: 'Mã mạnh nhất', l: true, f: (r) => { const f = document.createDocumentFragment(); r.best.forEach((t) => f.append(el('button', { class: 'chip sm', type: 'button', text: t, onclick: () => openChart(t) }))); return f; }, sv: (r) => r.best.length },
        ], rows, { sort: 'rank', dir: 1, limit: 250 });
      };
      $('#q-ind').addEventListener('input', drawInd);
      drawInd();
      const by = Object.fromEntries(S.stocks.map((s) => [s.t, s]));
      const chips = (box, list) => box.replaceChildren(...(list.length ? list.map((t) => el('button', { class: 'chip', type: 'button', onclick: () => openChart(t) }, t, el('small', { text: by[t] ? by[t].theme : '' }))) : [el('span', { class: 'empty', text: 'Không có.' })]));
      chips($('#new-leaders'), S.latest.new_leaders);
      chips($('#lost-leaders'), S.latest.lost_leaders);
    },
    setups() {
      const cfg = Object.assign({}, S.latest.config, store.get('nk_cfg', {}));
      const inputs = { cap: ['#in-cap', 'capital'], risk: ['#in-risk', 'risk_pct'], ms: ['#in-maxstop', 'max_stop_pct'], mp: ['#in-maxpos', 'max_pos_pct'] };
      for (const [, [sel, k]] of Object.entries(inputs)) { $(sel).value = cfg[k]; $(sel).addEventListener('input', () => { cfg[k] = Number($(sel).value) || cfg[k]; store.set('nk_cfg', cfg); drawSetups(); }); }
      const all = [...new Set(S.setups.flatMap((s) => s.setups))].sort();
      $('#sel-setup').append(...all.map((t) => el('option', { value: t, text: t })));
      ['#sel-setup', '#only-ok', '#only-lead'].forEach((s) => $(s).addEventListener('input', drawSetups));
      const L = S.latest;
      const w = $('#setup-warning');
      if (L.stance === 'Phòng thủ' || L.alert === 'Đỏ') { w.hidden = false; w.textContent = `Thị trường đang ở trạng thái ${L.stance.toLowerCase()}, cảnh báo ${L.alert.toLowerCase()}. Theo Martin, lúc này nên đứng ngoài: setup dưới đây chỉ để theo dõi, tỷ lệ thất bại sẽ rất cao.`; }
      else if (L.stance === 'Thận trọng' || L.alert === 'Vàng') { w.hidden = false; w.textContent = 'Thị trường chưa thuận lợi hoàn toàn: chỉ chọn setup đẹp nhất và giảm rủi ro mỗi lệnh một nửa.'; }
      let setupRows = [];
      $('#wl-setups').addEventListener('click', () => exportWatchlist(setupRows.map((r) => r.t), 'setup'));
      function drawSetups() {
        const risk$ = cfg.capital * cfg.risk_pct / 100;
        $('#calc-note').textContent = `Mỗi lệnh chấp nhận mất tối đa ${usd(risk$)}. Một vị thế không quá ${usd(cfg.capital * cfg.max_pos_pct / 100)}.`;
        const f = $('#sel-setup').value, ok = $('#only-ok').checked, ld = $('#only-lead').checked;
        const rows = S.setups.map((s) => {
          const per = s.entry - s.stop;
          let sh = per > 0 ? Math.floor(risk$ / per) : 0;
          sh = Math.min(sh, Math.floor(cfg.capital * cfg.max_pos_pct / 100 / s.entry));
          return Object.assign({}, s, { ok: s.stop_pct <= cfg.max_stop_pct, shares: sh, value: sh * s.entry, risk_usd: sh * per });
        }).filter((s) => (!f || s.setups.includes(f)) && (!ok || s.ok) && (!ld || s.leader));
        $('#setup-count').textContent = `${rows.length} mã`;
        setupRows = rows;
        table($('#tb-setups'), [
          { k: 't', label: 'Mã', tk: true },
          { k: '_a', label: '', f: (r) => el('button', { class: 'btn sm ghost', type: 'button', text: '+ Nhật ký', title: 'Ghi vào nhật ký', onclick: () => prefillJournal(r) }) },
          { k: 'setups', label: 'Setup', l: true, f: tags, sv: (r) => r.setups.join() },
          { k: 'rs', label: 'RS', f: (r) => n0(r.rs) },
          { k: 'rs_pos', label: 'Hạng RS', f: (r) => n0(r.rs_pos), title: 'Thứ hạng sức mạnh giá trong các mã đủ thanh khoản (1 là mạnh nhất)' },
          { k: 'ind_rank', label: 'Hạng ngành', f: (r) => (isNum(r.ind_rank) ? `${r.ind_rank}/${S.latest.n_ind}` : '—'), title: 'Hạng của ngành trong bảng xếp hạng ngành' },
          { k: 'close', label: 'Giá đóng cửa', f: (r) => n2(r.close) },
          { k: 'entry', label: 'Giá mua', f: (r) => n2(r.entry) },
          { k: 'stop', label: 'Stop', f: (r) => n2(r.stop) },
          { k: 'stop_pct', label: 'Stop %', f: (r) => pct(r.stop_pct), c: (r) => (r.ok ? '' : 'dn') },
          { k: 'shares', label: 'Số cổ', f: (r) => n0(r.shares) },
          { k: 'value', label: 'Giá trị', f: (r) => usd(r.value) },
          { k: 'risk_usd', label: 'Rủi ro', f: (r) => usd(r.risk_usd) },
          { k: 'r21', label: '1 tháng', f: (r) => spct(r.r21), c: (r) => cls(r.r21) },
          { k: 'rev_yoy', label: 'DT quý', f: (r) => spct(r.rev_yoy), c: (r) => cls(r.rev_yoy), title: 'Doanh thu quý gần nhất so với cùng kỳ' },
          { k: 'eps_yoy', label: 'EPS quý', f: (r) => spct(r.eps_yoy), c: (r) => cls(r.eps_yoy), title: 'EPS quý gần nhất so với cùng kỳ' },
          { k: 'ind', label: 'Ngành', l: true, f: (r) => r.ind || r.theme },
        ], rows, { sort: 'rs', rowClass: (r) => (r.ok ? '' : 'dim'), onRow: (r) => openChart(r.t, r), empty: 'Không có setup nào khớp bộ lọc.' });
      }
      drawSetups();
      $('#extended').replaceChildren(...(S.extended.length ? S.extended.map((s) => el('button', { class: 'chip', type: 'button', onclick: () => openChart(s.t) }, s.t, el('small', { text: `+${n1(s.d9)}% so với EMA 9` }))) : [el('span', { class: 'empty', text: 'Không có mã top 100 nào quá xa EMA 9.' })]));
    },
    search() {
      const themes = [...new Set(S.stocks.map((s) => s.theme))].sort((a, b) => a.localeCompare(b, 'vi'));
      $('#sel-theme').append(...themes.map((t) => el('option', { value: t, text: t })));
      const draw = () => {
        const q = $('#q').value.trim().toLowerCase(), th = $('#sel-theme').value, tt = $('#f-tt').checked, rn = $('#f-rsnh').checked;
        const rows = S.stocks.filter((s) => (!q || (s.t + ' ' + s.theme + ' ' + (s.name || '')).toLowerCase().includes(q)) && (!th || s.theme === th) && (!tt || s.tt) && (!rn || s.rsnh));
        $('#search-count').textContent = `${rows.length} / ${S.stocks.length} mã`;
        table($('#tb-search'), stockCols(false, true), rows, { sort: 'rs', limit: 300, onRow: (r) => openChart(r.t) });
      };
      ['#q', '#sel-theme', '#f-tt', '#f-rsnh'].forEach((s) => $(s).addEventListener('input', draw));
      draw();
    },
    patterns() {
      const P = S.patterns;
      $('#pt-notes').replaceChildren(...(S.latest.notes_patterns || []).map((t) => el('li', { text: t })));
      const cell = (w, a) => (isNum(w) ? `${n0(w)}% · ${spct(a)}` : '—');
      const wc = (w) => (isNum(w) ? (w >= 55 ? 'up' : w < 45 ? 'dn' : '') : '');
      table($('#tb-pat'), [
        { k: 'p', label: 'Mẫu hình', l: true },
        { k: 'kind', label: 'Kiểu', l: true, f: (r) => (r.kind === 'break' ? 'Breakout' : 'Điều chỉnh') },
        { k: 'today', label: 'Hôm nay', title: 'Số mã xuất hiện mẫu hình hôm nay' },
        { k: 'win1', label: '1 phiên', f: (r) => cell(r.win1, r.avg1), c: (r) => wc(r.win1) },
        { k: 'win3', label: '3 phiên', f: (r) => cell(r.win3, r.avg3), c: (r) => wc(r.win3) },
        { k: 'win5', label: '5 phiên', f: (r) => cell(r.win5, r.avg5), c: (r) => wc(r.win5) },
        { k: 'stop5', label: 'Chạm stop', f: (r) => pct(r.stop5, 0), c: (r) => (r.stop5 >= 60 ? 'dn' : ''), title: '% tín hiệu thủng đáy ngày tín hiệu trong 5 phiên sau' },
        { k: 'win21', label: '1 tháng', f: (r) => cell(r.win21, r.avg21), c: (r) => wc(r.win21) },
        { k: 'win5_base', label: 'Thường', f: (r) => pct(r.win5_base, 0), title: '% có lãi sau 5 phiên, tính trên 120 phiên' },
        { k: 'n5', label: 'Số tín hiệu', title: 'Số tín hiệu trong 20 phiên đã có kết quả 5 phiên' },
      ], P.stats, { sort: 'win5', empty: 'Chưa có dữ liệu mẫu hình.' });
      $('#sel-pat').append(...P.stats.map((x) => el('option', { value: x.p, text: x.p })));
      $('#sel-pat').addEventListener('input', () => drawHistChart('pat'));
      drawHistChart('pat');
      $('#sel-sig').append(...P.stats.map((x) => el('option', { value: x.p, text: x.p })));
      const drawSig = () => {
        const f = $('#sel-sig').value;
        const rows = S.stocks.filter((s) => (s.sig || []).length && (!f || s.sig.includes(f)));
        $('#sig-count').textContent = `${rows.length} mã`;
        table($('#tb-sig'), [
          { k: 't', label: 'Mã', tk: true },
          { k: 'sig', label: 'Tín hiệu', l: true, f: (r) => { const fr = document.createDocumentFragment(); r.sig.forEach((t) => fr.append(el('span', { class: 'tag', text: t }))); return fr; }, sv: (r) => r.sig.length },
          { k: 'rs', label: 'RS', f: (r) => n0(r.rs) },
          { k: 'rs_pos', label: 'Hạng RS', f: (r) => n0(r.rs_pos) },
          { k: 'ind_rank', label: 'Hạng ngành', f: (r) => (isNum(r.ind_rank) ? `${r.ind_rank}/${S.latest.n_ind}` : '—') },
          { k: 'chg', label: 'Phiên', f: (r) => spct(r.chg), c: (r) => cls(r.chg) },
          { k: 'r21', label: '1 tháng', f: (r) => spct(r.r21), c: (r) => cls(r.r21) },
          { k: 'dd', label: 'Cách đỉnh', f: (r) => spct(r.dd) },
          { k: 'ind', label: 'Ngành', l: true, f: (r) => r.ind || r.theme },
        ], rows, { sort: 'rs', limit: 300, onRow: (r) => openChart(r.t), empty: 'Hôm nay không có tín hiệu nào.' });
      };
      $('#sel-sig').addEventListener('input', drawSig);
      drawSig();
    },
    screener() { Screener.init(); },
    cycle() {
      const Y = S.cycle;
      $('#cy-notes').replaceChildren(...(Y.notes || []).map((t) => el('li', { text: t })));
      const box = $('#cy-now'); box.replaceChildren();
      for (const [k, nm] of [['qqq', 'QQQ'], ['top', 'Nhóm top 100']]) {
        const c = (Y[k] || {}).current; if (!c) continue;
        const typ = c.typical || 0, q3 = c.q3 || typ || 1;
        const prog = Math.min(100, c.days / Math.max(q3, 1) * 100);
        const nx = Object.entries(c.next || {}).filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
        box.append(el('article', { class: 'card phase-card', style: `--ph:var(${PHC[c.phase] || '--muted'})` },
          el('div', { class: 'ph-top' }, el('span', { class: 'muted', text: nm }), el('span', { class: 'ph-badge', text: c.phase })),
          el('div', { class: 'ph-big' }, el('b', { text: `${c.days} phiên` }), el('span', { class: cls(c.chg), text: ` ${spct(c.chg)} từ ${fdate(c.start)}` })),
          el('div', { class: 'ph-prog' }, el('i', { style: `width:${prog}%` })),
          el('p', { class: 'note', text: typ ? `Pha ${c.phase.toLowerCase()} thường kéo dài ${typ} phiên; 3/4 số lần kết thúc trong ${q3} phiên.${c.days > q3 ? ' Pha hiện tại đã dài hơn bình thường.' : ''}` : 'Chưa đủ lịch sử để so sánh.' }),
          nx.length ? el('div', { class: 'ph-next' }, el('span', { class: 'muted small', text: 'Sau pha này thường chuyển sang:' }),
            ...nx.map(([q, v]) => el('div', { class: 'ph-row' }, el('span', { text: q }), el('span', { class: 'ph-bar' }, el('i', { style: `width:${v}%;background:var(${PHC[q]})` })), el('b', { text: `${v}%` })))) : null));
      }
      const drawPh = () => {
        const st = (Y[cyKey] || {}).stats || {};
        table($('#tb-phase'), [
          { k: 'p', label: 'Pha', l: true, f: (r) => el('span', { class: 'ph-badge sm', style: `--ph:var(${PHC[r.p]})`, text: r.p }) },
          { k: 'n', label: 'Số lần', f: (r) => n0(r.n) },
          { k: 'days', label: 'Thời gian (trung vị)', f: (r) => (isNum(r.days) ? `${r.days} phiên` : '—') },
          { k: 'days_q3', label: '3/4 kết thúc trong', f: (r) => (isNum(r.days_q3) ? `${r.days_q3} phiên` : '—') },
          { k: 'chg', label: 'Thay đổi (trung vị)', f: (r) => spct(r.chg), c: (r) => cls(r.chg) },
          { k: 'best', label: 'Cao nhất trong pha', f: (r) => spct(r.best) },
          { k: 'worst', label: 'Thấp nhất trong pha', f: (r) => spct(r.worst) },
          { k: 'longest', label: 'Dài nhất', f: (r) => (isNum(r.longest) ? `${r.longest} phiên` : '—') },
          { k: 'next', label: 'Sau đó chuyển sang', l: true, f: (r) => Object.entries(r.next || {}).filter(([, v]) => v).sort((a, b) => b[1] - a[1]).map(([q, v]) => `${q} ${v}%`).join(' · ') || '—', sv: (r) => r.n },
        ], ['Tăng', 'Điều chỉnh', 'Giằng co', 'Giảm'].map((p) => Object.assign({ p }, st[p] || {})), {});
      };
      const setKey = (k) => { cyKey = k; $('#cy-qqq').setAttribute('aria-pressed', String(k === 'qqq')); $('#cy-top').setAttribute('aria-pressed', String(k === 'top')); drawHistChart('cyc'); drawPh(); };
      $('#cy-qqq').addEventListener('click', () => setKey('qqq')); $('#cy-top').addEventListener('click', () => setKey('top'));
      drawHistChart('cyc'); drawPh();
      const R = Y.stock_recent || {}, B = Y.stock_before || {}, N = Y.stock_now || {};
      const step = (title, main, sub, col) => el('div', { class: 'fl-step', style: `--ph:var(${col})` }, el('span', { class: 'muted small', text: title }), el('b', { text: main }), el('span', { class: 'small', text: sub }));
      const arrow = () => el('div', { class: 'fl-arr', 'aria-hidden': 'true', text: '→' });
      const flow = (lbl, X) => el('div', { class: 'fl' }, el('div', { class: 'fl-lbl', text: lbl }),
        step('Breakout', `${n0(X.n)} lần`, 'vượt đỉnh 20 phiên', '--c1'), arrow(),
        step('Tăng tiếp', isNum(X.run_days) ? `${X.run_days} phiên · ${spct(X.gain)}` : '—', isNum(X.gain10) ? `${X.gain10}% lần tăng ≥ 10%, ${X.gain20}% lần ≥ 20%` : '', '--good'), arrow(),
        step('Điều chỉnh', isNum(X.pb_days) ? `${X.pb_days} phiên · ${spct(X.depth)}` : '—', 'trước khi lên đỉnh mới', '--warn'), arrow(),
        step('Kết cục', isNum(X.rec_rate) ? `${X.rec_rate}% lên đỉnh mới` : '—', isNum(X.rec_rate) ? `${100 - X.rec_rate}% gãy (giảm TB ${spct(X.fail_depth)})` : '', X.rec_rate >= 70 ? '--good' : '--bad'));
      $('#cy-flow').replaceChildren(flow('90 phiên gần đây', R), flow('Trước đó', B),
        el('p', { class: 'note', text: `Hiện có ${n0(N['Đang tăng'])} mã top 100 đang trong nhịp tăng sau breakout và ${n0(N['Đang điều chỉnh'])} mã đang điều chỉnh.` }));
      const Q = Y.qqq || {}, ss = Q.swing_stats || { up: {}, down: {} };
      $('#cy-swnote').textContent = `Một sóng kết thúc khi QQQ đi ngược từ ${n0(Q.thr)}% so với đỉnh hoặc đáy gần nhất. Sóng cuối cùng đang diễn ra.`;
      const T = $('#cy-swtiles'); T.replaceChildren();
      tile(T, 'Sóng tăng (trung vị)', isNum(ss.up.days) ? `${ss.up.days} phiên` : '—', `${spct(ss.up.chg)} · ${n0(ss.up.n)} sóng`, 'up');
      tile(T, 'Sóng giảm (trung vị)', isNum(ss.down.days) ? `${ss.down.days} phiên` : '—', `${spct(ss.down.chg)} · ${n0(ss.down.n)} sóng`, 'dn');
      tile(T, 'Sóng tăng lớn nhất', isNum(ss.up.max) ? `+${n1(ss.up.max)}%` : '—', '');
      tile(T, 'Sóng giảm lớn nhất', isNum(ss.down.max) ? `−${n1(ss.down.max)}%` : '—', '');
      table($('#tb-swing'), [
        { k: 'dir', label: 'Sóng', l: true, f: (r) => (r.dir === 'up' ? 'Tăng' : 'Giảm') + (r.open ? ' (đang diễn ra)' : ''), c: (r) => (r.dir === 'up' ? 'up' : 'dn') },
        { k: 'from', label: 'Từ', f: (r) => fdate(r.from) },
        { k: 'to', label: 'Đến', f: (r) => fdate(r.to) },
        { k: 'days', label: 'Số phiên', f: (r) => n0(r.days) },
        { k: 'chg', label: 'Thay đổi', f: (r) => spct(r.chg), c: (r) => cls(r.chg) },
      ], (Q.swings || []).slice().reverse(), {});
    },
    paper() {
      const P = S.paper, A = P.accounts || {};
      if (!Object.keys(A).length) { $('#pp-notes').replaceChildren(el('li', { text: P.error ? 'Chưa chạy được danh mục mô phỏng: ' + P.error : 'Chưa có dữ liệu danh mục mô phỏng. Sau lần chạy tới sẽ có.' })); return; }
      const rows = LEGENDS.filter((L) => A[L.id]).map((L) => Object.assign({ id: L.id }, A[L.id], { nopen: A[L.id].open.length, npend: A[L.id].pending.length }));
      const qret = P.qqq && P.qqq.length ? P.qqq[P.qqq.length - 1][1] : null;
      const best = rows.slice().sort((a, b) => b.ret - a.ret)[0], worst = rows.slice().sort((a, b) => a.ret - b.ret)[0];
      const rr = (x) => (isNum(x) ? (x > 0 ? '+' : '') + n2(x) + 'R' : '—');
      $('#pp-notes').replaceChildren(
        el('li', { text: `Bắt đầu từ ${fdate(P.start)}, cập nhật tới ${fdate(P.last)}. QQQ cùng giai đoạn: ${spct(qret)}.` }),
        best ? el('li', { text: `Dẫn đầu: ${best.name} ${spct(best.ret)} (${usd(best.equity)}), ${best.n} lệnh đã đóng, thắng ${pct(best.win, 0)}, kỳ vọng ${rr(best.exp)}.` }) : null,
        worst && worst !== best ? el('li', { text: `Kém nhất: ${worst.name} ${spct(worst.ret)}, sụt giảm tối đa ${spct(worst.mdd)}.` }) : null,
        el('li', { text: `Vượt QQQ: ${rows.filter((r) => isNum(qret) && r.ret > qret).map((r) => r.name).join(', ') || 'chưa có phong cách nào'}.` }));
      table($('#tb-pp'), [
        { k: 'name', label: 'Tài khoản', l: true, f: (r) => { const f = document.createDocumentFragment(); f.append(badge(r.id), ' ' + r.name); return f; } },
        { k: 'equity', label: 'Giá trị', f: (r) => usd(r.equity) },
        { k: 'ret', label: 'Lợi nhuận', f: (r) => spct(r.ret), c: (r) => cls(r.ret) },
        { k: 'vsq', label: 'So với QQQ', f: (r) => (isNum(qret) ? spct(r.ret - qret) : '—'), c: (r) => cls(r.ret - (qret || 0)), sv: (r) => r.ret - (qret || 0) },
        { k: 'realized', label: 'Đã chốt', f: (r) => usd(r.realized), c: (r) => cls(r.realized) },
        { k: 'n', label: 'Lệnh đóng', f: (r) => n0(r.n) },
        { k: 'win', label: '% thắng', f: (r) => pct(r.win, 0) },
        { k: 'avg_win', label: 'Lãi TB', f: (r) => spct(r.avg_win), c: () => 'up' },
        { k: 'avg_loss', label: 'Lỗ TB', f: (r) => spct(r.avg_loss), c: () => 'dn' },
        { k: 'exp', label: 'Kỳ vọng', f: (r) => rr(r.exp), c: (r) => cls(r.exp) },
        { k: 'pf', label: 'Hệ số LN', f: (r) => n2(r.pf) },
        { k: 'mdd', label: 'Sụt giảm tối đa', f: (r) => spct(r.mdd), c: () => 'dn' },
        { k: 'nopen', label: 'Đang giữ', f: (r) => n0(r.nopen) },
        { k: 'npend', label: 'Lệnh chờ', f: (r) => n0(r.npend) },
      ], rows, { sort: 'ret' });
      const chips = $('#pp-chips');
      chips.replaceChildren(...LEGENDS.filter((L) => A[L.id]).map((L) => { const b = el('button', { type: 'button', class: 'btchip', 'aria-pressed': String(ppOn.has(L.id)) }, badge(L.id), ' ' + L.name);
        b.addEventListener('click', () => { if (ppOn.has(L.id)) ppOn.delete(L.id); else ppOn.add(L.id); b.setAttribute('aria-pressed', String(ppOn.has(L.id))); drawHistChart('pp'); }); return b; }),
        (() => { const b = el('button', { type: 'button', class: 'btchip', 'aria-pressed': String(ppOn.has('qqq')) }, 'QQQ'); b.addEventListener('click', () => { if (ppOn.has('qqq')) ppOn.delete('qqq'); else ppOn.add('qqq'); b.setAttribute('aria-pressed', String(ppOn.has('qqq'))); drawHistChart('pp'); }); return b; })());
      drawHistChart('pp');
      const sel = $('#pp-sel');
      sel.replaceChildren(...LEGENDS.filter((L) => A[L.id]).map((L) => el('option', { value: L.id, text: L.name })));
      const fillTxt = (fs) => (fs || []).map((x) => `${x.why}: ${n0(x.sh)} cổ @ ${n2(x.px)} (${fdate(x.d)})`).join(' · ');
      const bootMark = (r) => (r.boot ? '↺ ' : '');
      const drawAcc = () => {
        const a = A[sel.value] || { open: [], pending: [], closed: [] };
        table($('#tb-pp-open'), [
          { k: 't', label: 'Mã', tk: true },
          { k: 'in', label: 'Ngày mua', f: (r) => bootMark(r) + fdate(r.in) },
          { k: 'entry', label: 'Giá mua', f: (r) => n2(r.entry) },
          { k: 'stop', label: 'Stop hiện tại', f: (r) => n2(r.stop) + (r.stop > r.stop0 ? ' (đã dời)' : '') },
          { k: 'shares', label: 'Số cổ còn', f: (r) => `${n0(r.shares)}/${n0(r.shares0)}` },
          { k: 'last', label: 'Giá hiện tại', f: (r) => n2(r.last) },
          { k: 'pct', label: 'Lãi/lỗ', f: (r) => spct(r.pct), c: (r) => cls(r.pct) },
          { k: 'r', label: 'R', f: (r) => rr(r.r), c: (r) => cls(r.r) },
          { k: 'held', label: 'Số phiên', f: (r) => n0(r.held) },
          { k: 'fills', label: 'Đã chốt', l: true, f: (r) => fillTxt(r.fills) || '—', sv: (r) => (r.fills || []).length },
        ], a.open, { sort: 'in', onRow: (r) => openChart(r.t), empty: 'Không có lệnh đang giữ.' });
        table($('#tb-pp-pend'), [
          { k: 't', label: 'Mã', tk: true },
          { k: 'sig', label: 'Ngày tín hiệu', f: (r) => fdate(r.sig) },
          { k: 'lvl', label: 'Mua khi vượt', f: (r) => n2(r.lvl) },
          { k: 'stop', label: 'Stop', f: (r) => n2(r.stop) },
          { k: 'sp', label: 'Stop %', f: (r) => pct((r.lvl - r.stop) / r.lvl * 100), sv: (r) => (r.lvl - r.stop) / r.lvl },
          { k: 'left', label: 'Còn hiệu lực', f: (r) => `${n0(r.left)} phiên` },
        ], a.pending, { sort: 'sig', onRow: (r) => openChart(r.t), empty: 'Không có lệnh chờ.' });
        table($('#tb-pp-closed'), [
          { k: 't', label: 'Mã', tk: true },
          { k: 'in', label: 'Mua', f: (r) => `${bootMark(r)}${fdate(r.in)} @ ${n2(r.entry)}` },
          { k: 'stop0', label: 'Stop ban đầu', f: (r) => n2(r.stop0) },
          { k: 'out', label: 'Bán hết', f: (r) => fdate(r.out) },
          { k: 'exit', label: 'Giá bán TB', f: (r) => n2(r.exit) },
          { k: 'pnl', label: 'Lãi/lỗ', f: (r) => usd(r.pnl), c: (r) => cls(r.pnl) },
          { k: 'pct', label: '%', f: (r) => spct(r.pct), c: (r) => cls(r.pct) },
          { k: 'r', label: 'R', f: (r) => rr(r.r), c: (r) => cls(r.r) },
          { k: 'days', label: 'Số phiên', f: (r) => n0(r.days) },
          { k: 'fills', label: 'Các lần bán', l: true, f: (r) => fillTxt(r.fills), sv: (r) => (r.fills || []).length },
        ], a.closed, { sort: 'out', onRow: (r) => openChart(r.t), empty: 'Chưa có lệnh đóng.' });
      };
      sel.addEventListener('input', drawAcc);
      drawAcc();
    },
    backtest() {
      const B = S.backtest, ST = B.strategies || {};
      $('#bt-notes').replaceChildren(...(B.notes || []).map((t) => el('li', { text: t })));
      $('#bt-range').textContent = B.from ? `Giai đoạn kiểm chứng: ${fdate(B.from)} – ${fdate(B.to)}. "60 phiên" tính các lệnh đóng từ ${fdate(B.recent_from)}. Xu hướng QQQ hiện tại: ${B.regime_now || '—'}.` : '';
      const rows = LEGENDS.filter((L) => ST[L.id]).map((L) => Object.assign({ id: L.id, name: L.name }, ST[L.id]));
      const rc = (x) => (isNum(x) ? (x > 0.1 ? 'up' : x < 0 ? 'dn' : '') : '');
      const rr = (x) => (isNum(x) ? (x > 0 ? '+' : '') + n2(x) + 'R' : '—');
      const reg = (r, g) => { const s = (r.by_reg || {})[g] || {}; return s.n ? `${rr(s.exp)} · ${s.n}` : '—'; };
      table($('#tb-bt'), [
        { k: 'name', label: 'Phương pháp', l: true, f: (r) => { const f = document.createDocumentFragment(); f.append(badge(r.id), ' ' + r.name); return f; } },
        { k: 'n', label: 'Số lệnh', f: (r) => n0(r.n) },
        { k: 'win', label: '% thắng', f: (r) => pct(r.win, 0) },
        { k: 'avg_win', label: 'Lãi TB', f: (r) => spct(r.avg_win), c: () => 'up' },
        { k: 'avg_loss', label: 'Lỗ TB', f: (r) => spct(r.avg_loss), c: () => 'dn' },
        { k: 'pf', label: 'Hệ số LN', f: (r) => n2(r.pf), c: (r) => (r.pf >= 1.5 ? 'up' : r.pf < 1 ? 'dn' : ''), title: 'Tổng lãi ÷ tổng lỗ. Trên 1,5 là tốt.' },
        { k: 'exp', label: 'Kỳ vọng', f: (r) => rr(r.exp), c: (r) => rc(r.exp), title: 'Lãi/lỗ trung bình mỗi lệnh, tính theo R (1R = số tiền rủi ro)' },
        { k: 'total', label: 'Tổng R', f: (r) => (isNum(r.total) ? n1(r.total) : '—'), c: (r) => rc(r.total) },
        { k: 'rexp', label: '60 phiên', f: (r) => (r.recent && r.recent.n ? `${rr(r.recent.exp)} · ${pct(r.recent.win, 0)} · ${r.recent.n}` : '—'), c: (r) => rc(r.recent && r.recent.exp), sv: (r) => (r.recent && r.recent.exp) ?? -9, title: 'Kỳ vọng · % thắng · số lệnh, các lệnh đóng trong 60 phiên gần nhất' },
        { k: 'g1', label: 'QQQ Tốt', f: (r) => reg(r, 'Tốt'), c: (r) => rc(((r.by_reg || {})['Tốt'] || {}).exp), sv: (r) => ((r.by_reg || {})['Tốt'] || {}).exp ?? -9 },
        { k: 'g2', label: 'Giằng co', f: (r) => reg(r, 'Giằng co'), c: (r) => rc(((r.by_reg || {})['Giằng co'] || {}).exp), sv: (r) => ((r.by_reg || {})['Giằng co'] || {}).exp ?? -9 },
        { k: 'g3', label: 'QQQ Xấu', f: (r) => reg(r, 'Xấu'), c: (r) => rc(((r.by_reg || {})['Xấu'] || {}).exp), sv: (r) => ((r.by_reg || {})['Xấu'] || {}).exp ?? -9 },
        { k: 'hold', label: 'Giữ TB', f: (r) => (isNum(r.hold) ? `${n1(r.hold)} phiên` : '—') },
        { k: 'open', label: 'Đang mở', f: (r) => n0(r.open) },
      ], rows, { sort: 'exp', empty: 'Chưa có dữ liệu kiểm chứng.' });
      const chips = $('#bt-chips');
      chips.replaceChildren(...LEGENDS.filter((L) => ST[L.id]).map((L) => { const b = el('button', { type: 'button', class: 'btchip', 'aria-pressed': String(btOn.has(L.id)) }, badge(L.id), ' ' + L.name);
        b.addEventListener('click', () => { if (btOn.has(L.id)) btOn.delete(L.id); else btOn.add(L.id); b.setAttribute('aria-pressed', String(btOn.has(L.id))); drawHistChart('bt'); }); return b; }));
      drawHistChart('bt');
      table($('#tb-vsa'), [
        { k: 'type', label: 'Tín hiệu VSA', l: true },
        { k: 'n', label: 'Số lệnh', f: (r) => n0(r.n) },
        { k: 'win', label: '% thắng', f: (r) => pct(r.win, 0) },
        { k: 'pf', label: 'Hệ số LN', f: (r) => n2(r.pf) },
        { k: 'exp', label: 'Kỳ vọng', f: (r) => rr(r.exp), c: (r) => rc(r.exp) },
        { k: 'rexp', label: '60 phiên', f: (r) => (r.recent && r.recent.n ? `${rr(r.recent.exp)} · ${r.recent.n} lệnh` : '—'), c: (r) => rc(r.recent && r.recent.exp), sv: (r) => (r.recent && r.recent.exp) ?? -9 },
        { k: 'hold', label: 'Giữ TB', f: (r) => (isNum(r.hold) ? `${n1(r.hold)} phiên` : '—') },
      ], B.vsa_types || [], { sort: 'exp' });
      const sel = $('#bt-sel');
      sel.replaceChildren(...LEGENDS.filter((L) => ST[L.id]).map((L) => el('option', { value: L.id, text: L.name })));
      const drawTr = () => {
        const tr = (ST[sel.value] || {}).trades || [];
        table($('#tb-bttr'), [
          { k: 't', label: 'Mã', tk: true },
          { k: 'in', label: 'Ngày mua', f: (r) => fdate(r.in) },
          { k: 'entry', label: 'Giá mua', f: (r) => n2(r.entry) },
          { k: 'stop', label: 'Stop', f: (r) => n2(r.stop) },
          { k: 'out', label: 'Ngày bán', f: (r) => (r.open ? '—' : fdate(r.out)) },
          { k: 'days', label: 'Số phiên', f: (r) => n0(r.days) },
          { k: 'pct', label: 'Lãi/lỗ', f: (r) => spct(r.pct), c: (r) => cls(r.pct) },
          { k: 'r', label: 'R', f: (r) => rr(r.r), c: (r) => cls(r.r) },
          { k: 'why', label: 'Lý do bán', l: true, f: (r) => r.why },
        ], tr, { sort: 'in', onRow: (r) => openChart(r.t), empty: 'Chưa có lệnh.' });
      };
      sel.addEventListener('input', drawTr);
      drawTr();
    },
    journal() { Journal.init(); },
    guide() {},
  };

  function stockCols(basket, full) {
    const c = [
      { k: 't', label: 'Mã', tk: true },
      { k: 'ind', label: 'Ngành', l: true, f: (r) => r.ind || r.theme },
      { k: 'ind_rank', label: 'Hạng ngành', f: (r) => (isNum(r.ind_rank) ? `${r.ind_rank}/${S.latest.n_ind}` : '—') },
      { k: 'rs', label: 'RS', f: (r) => n0(r.rs) },
      { k: 'stage', label: 'Giai đoạn', f: (r) => (r.stage ? String(r.stage) : '—'), c: (r) => (r.stage === 2 ? 'up' : r.stage === 4 ? 'dn' : ''), title: 'Giai đoạn Weinstein: 1 tạo nền, 2 tăng, 3 tạo đỉnh, 4 giảm' },
      { k: 'close', label: 'Giá', f: (r) => n2(r.close) },
      { k: 'chg', label: 'Phiên', f: (r) => spct(r.chg), c: (r) => cls(r.chg) },
      { k: 'r3', label: '3 phiên', f: (r) => spct(r.r3), c: (r) => cls(r.r3) },
      { k: 'r5', label: '5 phiên', f: (r) => spct(r.r5), c: (r) => cls(r.r5) },
      { k: 'r21', label: '1 tháng', f: (r) => spct(r.r21), c: (r) => cls(r.r21) },
      { k: 'r63', label: '3 tháng', f: (r) => spct(r.r63), c: (r) => cls(r.r63) },
      { k: 'r126', label: '6 tháng', f: (r) => spct(r.r126), c: (r) => cls(r.r126) },
      { k: 'adr', label: 'Biên độ ngày', f: (r) => pct(r.adr), title: 'Biên độ dao động trung bình 20 phiên' },
      { k: 'dv', label: 'GTGD (tr $)', f: (r) => n0(r.dv), title: 'Giá trị giao dịch trung bình 20 phiên, triệu USD' },
      { k: 'd9', label: 'So EMA 9', f: (r) => spct(r.d9), c: (r) => (r.d9 > 15 ? 'wa' : cls(r.d9)) },
      { k: 'd21', label: 'So EMA 21', f: (r) => spct(r.d21), c: (r) => cls(r.d21) },
    ];
    if (full) c.push({ k: 'offhigh', label: 'Cách đỉnh 52T', f: (r) => spct(r.offhigh) }, { k: 'gap921', label: 'EMA 9–21', f: (r) => pct(r.gap921) });
    c.push({ k: 'setups', label: 'Ghi chú', l: true, f: (r) => { const f = tags(r); if (r.rsnh) f.append(el('span', { class: 'tag', text: 'RS đỉnh mới' })); return f; }, sv: (r) => (r.setups || []).length + (r.leader ? 10 : 0) });
    return c;
  }

  // ------------------------------------------------------------ bộ lọc theo huyền thoại: tiêu chí + điểm mua bán
  const has = (a) => Array.isArray(a) && a.length > 0;
  const anyOf = (arr, list) => (arr || []).some((x) => list.includes(x));
  const num = (x) => isNum(x) && x > 0;
  const mkt = () => S.latest || {};
  const MARTIN_SETUPS = ['Lấy lại EMA 9', 'Lấy lại AVWAP', 'EMA hội tụ', 'Inside day', '2 inside day'];
  const TIGHT = ['Nền chặt', 'VCP', 'Inside day', '2 inside day', 'EMA hội tụ'];
  const t_rspos = (s, v) => isNum(s.rs_pos) && s.rs_pos <= v;
  const t_adr = (s, v) => isNum(s.adr) && s.adr >= v;
  const t_rs = (s, v) => isNum(s.rs) && s.rs >= v;
  const t_dd = (s, v) => isNum(s.dd) && s.dd >= -v;
  const t_dv = (s, v) => isNum(s.dv) && s.dv >= v;
  const t_eps = (s, v) => isNum(s.eps_yoy) && s.eps_yoy >= v;
  const t_rev = (s, v) => isNum(s.rev_yoy) && s.rev_yoy >= v;
  const t_noearn = (s, v) => { const d = earnDays(s); return d === null || d > v; };
  const t_indtop = (s, v) => isNum(s.ind_rank) && s.ind_rank <= v;

  const LEGENDS = [
    { id: 'ml', short: 'ML', name: 'Martin Luk', color: '--c1', style: 'Lướt sóng mã dẫn đầu quanh EMA 9/21 với rủi ro rất nhỏ (vô địch USIC 2025).',
      conds: [
        { id: 'top', label: 'Thuộc top', unit: 'mã mạnh nhất', v: 100, step: 10, test: t_rspos },
        { id: 'adr', label: 'Biên độ ngày trung bình ít nhất', unit: '%', v: 4, step: 0.5, test: t_adr },
        { id: 'ema', label: 'Giá trên EMA 21 và EMA 21 đang dốc lên', test: (s) => s.e21up },
        { id: 'near9', label: 'Cách EMA 9 không quá', unit: '% (không mua đuổi)', v: 5, step: 1, test: (s, v) => isNum(s.d9) && Math.abs(s.d9) <= v },
        { id: 'setup', label: 'Có setup kiểu Martin: lấy lại EMA 9 hoặc AVWAP, EMA hội tụ, inside day', test: (s) => anyOf(s.setups, MARTIN_SETUPS) },
        { id: 'mkt', label: 'QQQ không ở xu hướng Xấu', market: true, test: () => mkt().qqq_regime !== 'Xấu' },
      ],
      plan: (s) => ({ buy: s.h * 1.001, stop: s.l * 0.999, how: 'Mua khi giá vượt đỉnh phiên gần nhất. Stop ngay dưới đáy phiên đó.',
        sell: `Chốt 15% vị thế khi lãi bằng 3 lần rủi ro. Bán hết khi đóng cửa dưới EMA 9 (hiện ${n2(s.e9v)}).` }) },
    { id: 'qm', short: 'QM', name: 'Qullamaggie', color: '--c2', style: 'Mua breakout từ nền chặt sau một nhịp tăng mạnh, hoặc mua EP (gap kèm tin tốt).',
      conds: [
        { id: 'mom', label: 'Tăng trong 1 hoặc 3 tháng ít nhất', unit: '%', v: 30, step: 5, test: (s, v) => s.r21 >= v || s.r63 >= v },
        { id: 'adr', label: 'Biên độ ngày trung bình ít nhất', unit: '%', v: 4, step: 0.5, test: t_adr },
        { id: 'liq', label: 'Giá trị giao dịch ít nhất', unit: 'triệu USD/ngày', v: 20, step: 5, test: t_dv },
        { id: 'trend', label: 'Giá trên EMA 21', test: (s) => s.d21 > 0 },
        { id: 'base', label: 'Đang nén chặt (nền chặt, inside day, EMA hội tụ) hoặc vừa có EP', test: (s) => anyOf(s.setups, ['Nền chặt', 'Inside day', '2 inside day', 'EMA hội tụ', 'EP']) || anyOf(s.sig, ['Gap tăng mạnh (EP)']) },
      ],
      plan: (s) => { const buy = s.h * 1.001; const stop = Math.max(s.l * 0.999, buy * (1 - (s.adr || 5) / 100));
        return { buy, stop, how: 'Mua khi giá vượt đỉnh phiên (opening range high). Stop ở đáy phiên, không rộng hơn 1 lần biên độ ngày.',
          sell: `Bán 1/3 đến 1/2 sau 3–5 phiên. Phần còn lại giữ tới khi đóng cửa dưới EMA 10 (≈ ${n2(s.e9v)}), vị thế lớn thì theo EMA 20 (${n2(s.e21v)}).` }; } },
    { id: 'mm', short: 'MM', name: 'Mark Minervini', color: '--c3', style: 'SEPA: xu hướng chuẩn (Trend Template), nền co hẹp VCP, lợi nhuận tăng tốc.',
      conds: [
        { id: 'tt', label: 'Đạt đủ 8 điều kiện Trend Template', test: (s) => s.tt },
        { id: 'rs', label: 'Điểm RS ít nhất', unit: '', v: 80, step: 5, test: t_rs },
        { id: 'near', label: 'Cách đỉnh 1 năm không quá', unit: '%', v: 25, step: 5, test: t_dd },
        { id: 'vcp', label: 'Đang trong nền co hẹp (VCP, nền chặt, inside day)', test: (s) => anyOf(s.setups, TIGHT) },
        { id: 'eps', label: 'EPS quý tăng so với cùng kỳ ít nhất', unit: '%', v: 25, step: 5, test: t_eps },
        { id: 'accel', label: 'Doanh thu hoặc EPS đang tăng tốc', on: false, test: (s) => s.rev_accel || s.eps_accel },
        { id: 'noearn', label: 'Không có báo cáo kết quả trong', unit: 'ngày tới', v: 7, step: 1, test: t_noearn },
      ],
      plan: (s) => { const buy = s.piv * 1.001; const stop = Math.max(buy * 0.92, s.lo10 * 0.999);
        return { buy, stop, how: 'Mua khi giá vượt pivot (đỉnh 20 phiên) với khối lượng lớn. Stop dưới đáy nền 10 phiên, tối đa 8%.',
          sell: 'Bán dần vào sức mạnh khi lãi 20–25%. Khi lãi gấp 2–3 lần rủi ro, dời stop về hòa vốn.' }; } },
    { id: 'wo', short: 'WO', name: "William O'Neil", color: '--c4', style: 'CAN SLIM: lợi nhuận tăng mạnh, sản phẩm mới, cung cầu, dẫn đầu ngành, thị trường thuận lợi.',
      conds: [
        { id: 'c', label: 'C · EPS quý tăng so với cùng kỳ ít nhất', unit: '%', v: 25, step: 5, test: t_eps },
        { id: 'a', label: 'A · EPS năm tăng liên tiếp ít nhất', unit: 'năm', v: 2, step: 1, test: (s, v) => isNum(s.eps_a_up) && s.eps_a_up >= v },
        { id: 'sales', label: 'Doanh thu quý tăng so với cùng kỳ ít nhất', unit: '%', v: 20, step: 5, test: t_rev },
        { id: 'n', label: 'N · Cách đỉnh mới không quá', unit: '%', v: 15, step: 5, test: t_dd },
        { id: 's', label: 'S · Khối lượng phiên tăng gấp phiên giảm ít nhất', unit: 'lần (50 phiên)', v: 1.1, step: 0.1, test: (s, v) => isNum(s.udv) && s.udv >= v },
        { id: 'l', label: 'L · Điểm RS ít nhất', unit: '', v: 80, step: 5, test: t_rs },
        { id: 'grp', label: 'Ngành nằm trong top', unit: '% ngành mạnh nhất', v: 20, step: 5, test: (s, v) => isNum(s.ind_rank) && s.ind_rank <= Math.max(1, Math.round((mkt().n_ind || 1) * v / 100)) },
        { id: 'm', label: 'M · Thị trường không tạo đáy mới, QQQ dưới 6 ngày phân phối', market: true, test: () => !(mkt().ftd_status || '').includes('đáy mới') && (mkt().dd_qqq || 0) <= 5 },
      ],
      plan: (s) => { const buy = s.piv * 1.001; const stop = buy * 0.93;
        return { buy, stop, how: `Mua tại pivot (đỉnh nền), không mua cao hơn pivot 5% (${n2(buy * 1.05)}). Khối lượng phiên vượt nên gấp 1,5 lần trung bình.`,
          sell: 'Cắt lỗ cứng 7–8%. Chốt phần lớn khi lãi 20–25%; nếu tăng 20% trong 3 tuần đầu thì giữ ít nhất 8 tuần.' }; } },
    { id: 'sw', short: 'SW', name: 'Stan Weinstein', color: '--c5', style: 'Chỉ mua cổ phiếu ở giai đoạn 2: giá trên đường 30 tuần đang dốc lên.',
      conds: [
        { id: 'st', label: 'Đang ở giai đoạn 2', test: (s) => s.stage === 2 },
        { id: 'rs', label: 'Điểm RS ít nhất (mạnh hơn thị trường)', unit: '', v: 70, step: 5, test: t_rs },
        { id: 'grp', label: 'Ngành nằm ở nửa trên bảng xếp hạng', test: (s) => isNum(s.ind_rank) && s.ind_rank <= (mkt().n_ind || 0) / 2 },
        { id: 'vol', label: 'Khối lượng phiên tăng nhiều hơn phiên giảm', test: (s) => isNum(s.udv) && s.udv >= 1 },
        { id: 'near', label: 'Cách đỉnh 1 năm không quá', unit: '%', v: 15, step: 5, on: false, test: t_dd },
      ],
      plan: (s) => { const buy = s.piv * 1.001; const stop = num(s.s150v) && s.s150v < buy ? s.s150v * 0.99 : s.lo10 * 0.999;
        return { buy, stop, how: 'Mua khi vượt kháng cự (đỉnh 20 phiên) với khối lượng gấp đôi, hoặc khi giá điều chỉnh về gần đường 30 tuần.',
          sell: `Bán khi đóng cửa tuần dưới đường 30 tuần (hiện ${n2(s.s150v)}), dấu hiệu sang giai đoạn 3 hoặc 4.` }; } },
    { id: 'pb', short: 'PB', name: 'Pradeep Bonde', color: '--accent', style: 'Stockbee: mua cú bứt phá 4% (momentum burst) hoặc EP, lướt 3–5 ngày.',
      conds: [
        { id: 'burst', label: 'Hôm nay bứt phá từ 4% kèm khối lượng, hoặc gap EP', test: (s) => anyOf(s.sig, ['Bứt phá 4%', 'Gap tăng mạnh (EP)']) },
        { id: 'fresh', label: 'Chưa tăng nóng: tăng trong tháng (trước hôm nay) không quá', unit: '%', v: 25, step: 5, test: (s, v) => isNum(s.r21) && s.r21 - (s.chg || 0) <= v },
        { id: 'vol', label: 'Khối lượng hôm nay gấp trung bình 50 phiên ít nhất', unit: 'lần', v: 1.5, step: 0.5, test: (s, v) => isNum(s.vr) && s.vr >= v },
        { id: 'liq', label: 'Giá trị giao dịch ít nhất', unit: 'triệu USD/ngày', v: 5, step: 5, test: t_dv },
      ],
      plan: (s) => ({ buy: s.close, stop: s.l * 0.999, how: 'Mua ngay trong ngày bứt phá hoặc đầu phiên sau. Stop dưới đáy ngày bứt phá.',
        sell: 'Chốt sau 3–5 phiên hoặc khi lãi 8–20%. Cú bứt phá thường chỉ kéo dài vài ngày.' }) },
    { id: 'ok', short: 'OK', name: 'Oliver Kell', color: '--warn', style: 'Chu kỳ giá: mua khi giá lấy lại EMA (crossback, wedge pop), bán khi quá đà.',
      conds: [
        { id: 'top', label: 'Thuộc top', unit: 'mã mạnh nhất', v: 200, step: 50, test: t_rspos },
        { id: 'stack', label: 'Giá trên EMA 21 đang dốc lên', test: (s) => s.e21up },
        { id: 'cross', label: 'Có tín hiệu crossback: EMA crossback, lấy lại EMA 9, về EMA 21 bật lên', test: (s) => anyOf(s.setups, ['EMA crossback', 'Lấy lại EMA 9']) || anyOf(s.sig, ['Về EMA 21 bật lên', 'Lấy lại EMA 9']) },
        { id: 'notext', label: 'Chưa quá đà: cách EMA 9 không quá', unit: '%', v: 8, step: 1, test: (s, v) => isNum(s.d9) && s.d9 <= v },
      ],
      plan: (s) => { const buy = s.h * 1.001; const stop = Math.min(s.l, num(s.e21v) ? s.e21v : s.l) * 0.995;
        return { buy, stop, how: 'Mua khi giá lấy lại EMA 10/20 và vượt đỉnh phiên. Stop dưới EMA 21 hoặc đáy phiên, chọn mức thấp hơn.',
          sell: `Bán dần khi quá đà: cách EMA 9 trên 15–20% (khoảng ${n2(s.e9v * 1.15)}–${n2(s.e9v * 1.2)}). Thoát hết khi đóng cửa dưới EMA 21.` }; } },
    { id: 'vs', short: 'VSA', name: 'VSA (Wyckoff, Tom Williams)', color: '--c6', style: 'Đọc dấu vết dòng tiền lớn qua giá và khối lượng: không có cung, kiểm định cung, rũ bỏ, khối lượng chặn.',
      conds: [
        { id: 'sig', label: 'Hôm nay có tín hiệu mua VSA', test: (s) => has(s.vsa) },
        { id: 'ctx', label: 'Bối cảnh xu hướng tăng: giá trên EMA 50', test: (s) => isNum(s.d50) && s.d50 > 0 },
        { id: 'rs', label: 'Điểm RS ít nhất', unit: '', v: 50, step: 5, test: t_rs },
        { id: 'liq', label: 'Giá trị giao dịch ít nhất', unit: 'triệu USD/ngày', v: 5, step: 5, test: t_dv },
      ],
      plan: (s) => ({ buy: s.h * 1.001, stop: s.l * 0.995, how: `Tín hiệu: ${(s.vsa || []).join(', ') || 'chưa có'}. Mua khi phiên sau vượt đỉnh thanh tín hiệu (xác nhận cầu vào). Stop dưới đáy thanh tín hiệu.`,
        sell: 'Bán 1/2 khi lãi 2R rồi dời stop về hòa vốn. Bán phần còn lại khi đóng cửa dưới EMA 21, hoặc khi xuất hiện thanh tăng biên độ rộng, khối lượng cực lớn nhưng đóng cửa thấp (cao trào mua, upthrust).' }) },
    { id: 'me', short: 'TÔI', name: 'Bộ lọc của bạn', color: '--ink', style: 'Điều kiện riêng của bạn: mã mạnh nhất, ngành mạnh nhất, doanh thu và lợi nhuận tăng đều.',
      conds: [
        { id: 'top', label: 'Thuộc top', unit: 'mã mạnh nhất', v: 100, step: 10, test: t_rspos },
        { id: 'ind', label: 'Ngành nằm trong top', unit: 'ngành', v: 5, step: 1, test: t_indtop },
        { id: 'rev', label: 'Doanh thu quý tăng so với cùng kỳ ít nhất', unit: '%', v: 20, step: 5, test: t_rev },
        { id: 'eps', label: 'EPS quý tăng so với cùng kỳ ít nhất', unit: '% (lỗ sang lãi tính là đạt)', v: 25, step: 5, test: t_eps },
        { id: 'revup', label: 'Doanh thu tăng liên tiếp ít nhất', unit: 'quý', v: 3, step: 1, on: false, test: (s, v) => isNum(s.rev_up) && s.rev_up >= v },
        { id: 'st2', label: 'Đang ở giai đoạn 2', on: false, test: (s) => s.stage === 2 },
        { id: 'rsnh', label: 'Đường RS lập đỉnh mới', on: false, test: (s) => s.rsnh },
        { id: 'dnb', label: 'Giữ giá tốt hơn QQQ khi thị trường giảm', on: false, test: (s) => isNum(s.dnb) && s.dnb > 0 },
        { id: 'cap', label: 'Vốn hóa không quá', unit: 'tỷ USD', v: 30, step: 5, on: false, test: (s, v) => isNum(s.mcap) && s.mcap <= v },
        { id: 'ipo', label: 'Mới niêm yết dưới 1 năm', on: false, test: (s) => isNum(s.ipo) },
        { id: 'noearn', label: 'Không có báo cáo kết quả trong', unit: 'ngày tới', v: 7, step: 1, on: false, test: t_noearn },
        { id: 'setup', label: 'Có setup mua hôm nay', on: false, test: (s) => has(s.setups) },
      ],
      plan: (s) => (has(s.setups) ? { buy: s.h * 1.001, stop: s.l * 0.999, how: 'Theo setup hôm nay: mua khi vượt đỉnh phiên, stop dưới đáy phiên.', sell: 'Áp dụng quy tắc bán của huyền thoại có ký hiệu cùng mã này.' }
        : { buy: s.piv * 1.001, stop: Math.max(s.piv * 0.94, s.lo10 * 0.999), how: 'Chưa có setup: chờ giá vượt đỉnh 20 phiên. Stop dưới đáy 10 phiên, tối đa 6%.', sell: 'Áp dụng quy tắc bán của huyền thoại có ký hiệu cùng mã này.' }) },
  ];
  const LKEY = 'nk_legends_v1';
  const lgDefaults = () => ({ sel: Object.fromEntries(LEGENDS.map((L) => [L.id, true])), mode: 'any', near: false,
    c: Object.fromEntries(LEGENDS.map((L) => [L.id, Object.fromEntries(L.conds.map((c) => [c.id, { on: c.on !== false, v: c.v }]))])) });
  let LG = (() => { const d = lgDefaults(), s = store.get(LKEY, null); if (!s) return d;
    for (const L of LEGENDS) { d.sel[L.id] = s.sel?.[L.id] ?? d.sel[L.id]; for (const c of L.conds) d.c[L.id][c.id] = Object.assign(d.c[L.id][c.id], s.c?.[L.id]?.[c.id] || {}); }
    d.mode = s.mode || 'any'; d.near = !!s.near; return d; })();
  const acct = () => Object.assign({}, S.latest.config, store.get('nk_cfg', {}));

  function evalLegend(s, L) {
    let ok = 0, n = 0; const miss = [];
    for (const c of L.conds) { const st = LG.c[L.id][c.id]; if (!st.on) continue; n++; if (c.test(s, st.v)) ok++; else miss.push(c.label + (c.v !== undefined ? ` ${st.v}${c.unit && c.unit.startsWith('%') ? '%' : ''}` : '')); }
    return { ok, n, miss, pass: n > 0 && ok === n };
  }
  let MATCH = null;
  function computeMatch() { MATCH = new Map(); for (const s of S.stocks) MATCH.set(s.t, LEGENDS.filter((L) => evalLegend(s, L).pass).map((L) => L.id)); }
  const matchesOf = (t) => { if (!MATCH) computeMatch(); return MATCH.get(t) || []; };
  const LBY = Object.fromEntries(LEGENDS.map((L) => [L.id, L]));
  const badge = (id) => { const L = LBY[id]; return el('span', { class: 'lg', style: `--lg:var(${L.color})`, title: `Đạt tiêu chí ${L.name}`, text: L.short }); };
  const badges = (t) => { const f = document.createDocumentFragment(); matchesOf(t).forEach((id) => f.append(badge(id))); return f; };

  function planOf(s, L) {
    let p; try { p = L.plan(s); } catch (e) { p = null; }
    if (!p) return null;
    const ok = num(p.buy) && num(p.stop) && p.stop < p.buy;
    const a = acct();
    const per = ok ? p.buy - p.stop : null;
    let sh = ok ? Math.floor(a.capital * a.risk_pct / 100 / per) : 0;
    if (ok) sh = Math.min(sh, Math.floor(a.capital * a.max_pos_pct / 100 / p.buy));
    return Object.assign(p, { ok, sp: ok ? per / p.buy * 100 : null, shares: sh, value: sh * (p.buy || 0), withinStop: ok && per / p.buy * 100 <= a.max_stop_pct });
  }
  function planTable(s) {
    const rows = LEGENDS.map((L) => ({ L, e: evalLegend(s, L), p: planOf(s, L) })).sort((a, b) => (b.e.pass - a.e.pass) || (b.e.ok / (b.e.n || 1) - a.e.ok / (a.e.n || 1)));
    const tb = el('tbody');
    for (const { L, e, p } of rows) {
      tb.append(el('tr', { class: e.pass ? '' : 'dim' },
        el('td', { class: 'l' }, badge(L.id), ' ', el('b', { text: L.name })),
        el('td', { class: 'l ' + (e.pass ? 'up' : ''), text: e.pass ? `Đạt đủ ${e.n} điều kiện` : `Đạt ${e.ok}/${e.n}`, title: e.miss.length ? 'Thiếu: ' + e.miss.join('; ') : '' }),
        el('td', { text: p && p.ok ? n2(p.buy) : '—' }),
        el('td', { text: p && p.ok ? `${n2(p.stop)} (${pct(p.sp)})` : '—', class: p && p.ok && !p.withinStop ? 'dn' : '' }),
        el('td', { text: p && p.ok ? n0(p.shares) : '—' }),
        el('td', { class: 'l plan-txt' }, el('div', { text: p ? p.how : '' }), el('div', { class: 'muted', text: p ? 'Bán: ' + p.sell : '' })),
        el('td', {}, p && p.ok ? el('button', { class: 'btn sm ghost', type: 'button', text: '+ Nhật ký', onclick: () => prefillJournal({ t: s.t, setups: [L.name], entry: +p.buy.toFixed(2), stop: +p.stop.toFixed(2), shares: p.shares }) }) : null)));
    }
    return el('div', { class: 'tbl' }, el('table', { class: 'plan' },
      el('thead', {}, el('tr', {}, ...['Huyền thoại', 'Tiêu chí', 'Mua trên', 'Stop', 'Số cổ', 'Cách vào lệnh và bán', ''].map((h, i) => el('th', { class: i === 0 || i === 1 || i === 5 ? 'l' : null, text: h })))), tb));
  }

  const Screener = (() => {
    let last = [];
    const save = () => { store.set(LKEY, LG); computeMatch(); run(); counts(); };
    function counts() { for (const L of LEGENDS) { const n = S.stocks.filter((s) => matchesOf(s.t).includes(L.id)).length; const e = $(`#lgc-${L.id}`); if (e) e.textContent = `${n} mã`; } }
    function form() {
      const box = $('#strats'); box.replaceChildren();
      for (const L of LEGENDS) {
        const cb = el('input', { type: 'checkbox', id: 'lg-' + L.id, 'aria-label': 'Chọn ' + L.name }); cb.checked = !!LG.sel[L.id];
        cb.addEventListener('input', () => { LG.sel[L.id] = cb.checked; card.classList.toggle('off', !cb.checked); save(); });
        const list = el('div', { class: 'conds' });
        for (const c of L.conds) {
          const st = LG.c[L.id][c.id];
          const cc = el('input', { type: 'checkbox', id: `lc-${L.id}-${c.id}` }); cc.checked = !!st.on;
          cc.addEventListener('input', () => { st.on = cc.checked; save(); });
          const row = el('div', { class: 'crit-row' }, cc, el('label', { for: `lc-${L.id}-${c.id}`, text: c.label }));
          if (c.v !== undefined) {
            const nb = el('input', { type: 'number', id: `lv-${L.id}-${c.id}`, step: String(c.step || 1), min: '0', 'aria-label': c.label }); nb.value = st.v;
            nb.addEventListener('input', () => { const v = Number(nb.value); if (isFinite(v)) { st.v = v; save(); } });
            row.append(nb, el('span', { class: 'muted small', text: c.unit || '' }));
          }
          if (c.market) { const okm = c.test(); row.append(el('span', { class: 'mk ' + (okm ? 'up' : 'dn'), text: okm ? 'Thị trường: đạt' : 'Thị trường: chưa đạt' })); }
          list.append(row);
        }
        const card = el('article', { class: 'strat' + (LG.sel[L.id] ? '' : ' off'), style: `--lg:var(${L.color})` },
          el('div', { class: 'strat-h' }, cb, el('label', { for: 'lg-' + L.id }, badge(L.id), el('b', { text: L.name })), el('span', { class: 'strat-n', id: `lgc-${L.id}` })),
          el('p', { class: 'strat-d', text: L.style }),
          el('details', {}, el('summary', { text: `Điều kiện (${L.conds.length})` }), list));
        box.append(card);
      }
    }
    function run() {
      const sel = LEGENDS.filter((L) => LG.sel[L.id]);
      const rows = [];
      for (const s of S.stocks) {
        const ev = sel.map((L) => ({ L, e: evalLegend(s, L) }));
        const pass = ev.filter((x) => x.e.pass);
        const near = ev.filter((x) => !x.e.pass && x.e.n - x.e.ok === 1);
        const okRow = LG.mode === 'all' ? pass.length === sel.length && sel.length > 0 : pass.length > 0;
        const nearRow = LG.near && !okRow && (LG.mode === 'all' ? pass.length + near.length === sel.length && near.length === 1 : near.length > 0);
        if (okRow || nearRow) rows.push(Object.assign({}, s, { _n: pass.length, _near: !okRow, _nearTxt: near.map((x) => `${x.L.short} thiếu: ${x.e.miss[0]}`).join(' · ') }));
      }
      last = rows;
      const full = rows.filter((r) => !r._near).length;
      $('#scr-count').textContent = `${full} mã đạt` + (LG.near ? ` · ${rows.length - full} mã thiếu 1 điều kiện` : '');
      $('#scr-note').textContent = `Số liệu doanh thu/EPS có cho ${n0(S.latest.fund_n)} mã (khoảng 400 mã mạnh nhất và các mã có setup), cập nhật hằng tuần; mã không có số liệu sẽ không đạt điều kiện tăng trưởng.` + (S.stocks.some((s) => isNum(s.mcap)) ? '' : ' Vốn hóa chỉ có khi dùng nguồn Massive.');
      table($('#tb-scr'), [
        { k: 't', label: 'Mã', tk: true },
        { k: '_n', label: 'Đạt tiêu chí', l: true, f: (r) => { const f = badges(r.t); if (r._near) f.append(el('span', { class: 'tag miss', text: r._nearTxt })); return f; }, sv: (r) => r._n * 10 - (r._near ? 5 : 0) },
        { k: 'rs_pos', label: 'Hạng RS', f: (r) => n0(r.rs_pos) },
        { k: 'ind_rank', label: 'Hạng ngành', f: (r) => (isNum(r.ind_rank) ? `${r.ind_rank}/${S.latest.n_ind}` : '—') },
        { k: 'close', label: 'Giá', f: (r) => n2(r.close) },
        { k: 'chg', label: 'Phiên', f: (r) => spct(r.chg), c: (r) => cls(r.chg) },
        { k: 'r21', label: '1 tháng', f: (r) => spct(r.r21), c: (r) => cls(r.r21) },
        { k: 'r63', label: '3 tháng', f: (r) => spct(r.r63), c: (r) => cls(r.r63) },
        { k: 'dd', label: 'Cách đỉnh', f: (r) => spct(r.dd) },
        { k: 'rev_yoy', label: 'DT quý', f: (r) => spct(r.rev_yoy), c: (r) => cls(r.rev_yoy) },
        { k: 'eps_yoy', label: 'EPS quý', f: (r) => spct(r.eps_yoy), c: (r) => cls(r.eps_yoy) },
        { k: 'ind', label: 'Ngành', l: true, f: (r) => r.ind || r.theme },
        { k: 'setups', label: 'Setup, tín hiệu', l: true, f: (r) => { const f = document.createDocumentFragment(); [...(r.setups || []), ...(r.sig || [])].forEach((t) => f.append(el('span', { class: 'tag', text: t }))); return f; }, sv: (r) => (r.setups || []).length + (r.sig || []).length },
      ], rows, { sort: '_n', limit: 300, rowClass: (r) => (r._near ? 'dim' : ''), onRow: (r) => openChart(r.t), empty: 'Không có mã nào đạt. Thử chọn thêm huyền thoại, tắt bớt điều kiện hoặc nới ngưỡng.' });
    }
    function init() {
      form(); counts();
      const seg = (m) => { LG.mode = m; $('#mode-any').setAttribute('aria-pressed', String(m === 'any')); $('#mode-all').setAttribute('aria-pressed', String(m === 'all')); save(); };
      $('#mode-any').addEventListener('click', () => seg('any')); $('#mode-all').addEventListener('click', () => seg('all'));
      $('#mode-any').setAttribute('aria-pressed', String(LG.mode === 'any')); $('#mode-all').setAttribute('aria-pressed', String(LG.mode === 'all'));
      $('#crit-near').checked = LG.near; $('#crit-near').addEventListener('input', () => { LG.near = $('#crit-near').checked; save(); });
      $('#lg-all').addEventListener('click', () => { LEGENDS.forEach((L) => { LG.sel[L.id] = true; }); form(); save(); });
      $('#lg-none').addEventListener('click', () => { LEGENDS.forEach((L) => { LG.sel[L.id] = false; }); form(); save(); });
      $('#crit-reset').addEventListener('click', () => { LG = lgDefaults(); store.set(LKEY, LG); form(); seg('any'); $('#crit-near').checked = false; });
      $('#wl-scr').addEventListener('click', () => exportWatchlist(last.filter((r) => !r._near).map((r) => r.t), 'huyen-thoai'));
      $('#lg-key').replaceChildren(...LEGENDS.map((L) => el('span', {}, badge(L.id), ' ' + L.name)));
      run();
    }
    return { init };
  })();

  // ------------------------------------------------------------ xuất danh sách cho TradingView
  function exportWatchlist(list, name) {
    if (!list.length) return;
    const a = el('a', { href: URL.createObjectURL(new Blob([list.join(',')], { type: 'text/plain' })), download: `watchlist-${name}-${S.latest.asof}.txt` });
    document.body.append(a); a.click(); a.remove();
  }

  // ------------------------------------------------------------ biểu đồ từng mã
  let modalChart = null;
  async function openChart(t, setup) {
    const m = $('#modal'); m.hidden = false;
    const s = S.stocks.find((x) => x.t === t) || {};
    $('#m-title').textContent = s.name ? `${t} · ${s.name}` : t;
    const meta = $('#m-meta'); meta.replaceChildren();
    const add = (k, v) => meta.append(el('span', {}, k + ': ', el('b', { text: v })));
    add('Ngành', s.ind || s.theme || '—'); if (isNum(s.ind_rank)) add('Hạng ngành', `${s.ind_rank}/${S.latest.n_ind}`); add('RS', n0(s.rs)); if (isNum(s.rs_pos)) add('Hạng RS', n0(s.rs_pos));
    if (s.stage) add('Giai đoạn', String(s.stage)); if (isNum(s.rev_yoy)) add('DT quý', spct(s.rev_yoy)); if (isNum(s.eps_yoy)) add('EPS quý', spct(s.eps_yoy)); if (s.earn) add('Báo cáo', fdate(s.earn)); add('Giá', n2(s.close)); add('1 tháng', spct(s.r21)); add('3 tháng', spct(s.r63)); add('Biên độ ngày', pct(s.adr)); add('So EMA 21', spct(s.d21));
    const box = $('#ch-modal');
    if (!S.charts) { box.textContent = 'Đang tải biểu đồ…'; try { S.charts = await (await fetch('data/charts.json', { cache: 'no-cache' })).json(); } catch (e) { S.charts = {}; } }
    const d = S.charts[t];
    if (modalChart) { modalChart.remove(); modalChart = null; }
    if (!d) { box.replaceChildren(el('p', { class: 'empty', text: 'Chỉ lưu biểu đồ cho top 100 và mã có setup để trang nhẹ. Mã này hiện không thuộc nhóm đó.' })); }
    else {
      const c = baseChart(box); modalChart = c;
      const cs = c.addCandlestickSeries({ upColor: css('--good'), downColor: css('--bad'), wickUpColor: css('--good'), wickDownColor: css('--bad'), borderVisible: false, priceLineVisible: false });
      cs.setData(d.d.map((x, i) => ({ time: x, open: d.o[i], high: d.h[i], low: d.l[i], close: d.c[i] })).filter((x) => isNum(x.close)));
      const line = (k, col, style = 0) => { const sr = c.addLineSeries({ color: css(col), lineWidth: k === 'avl' || k === 'avg' ? 1 : 2, lineStyle: style, priceLineVisible: false, lastValueVisible: false }); sr.setData(d.d.map((x, i) => ({ time: x, value: d[k][i] })).filter((x) => isNum(x.value))); };
      line('e9', '--c1'); line('e21', '--c2'); line('e50', '--c3'); line('avl', '--c4', 2); line('avg', '--c5', 2);
      const vol = c.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false });
      vol.setData(d.d.map((x, i) => ({ time: x, value: d.v[i], color: css(d.c[i] >= d.o[i] ? '--good' : '--bad') + '55' })).filter((x) => isNum(x.value)));
      c.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      if (setup) {
        cs.createPriceLine({ price: setup.entry, color: css('--good'), lineWidth: 2, lineStyle: 0, title: 'Giá mua' });
        cs.createPriceLine({ price: setup.stop, color: css('--bad'), lineWidth: 2, lineStyle: 2, title: 'Stop' });
      }
      c.timeScale().fitContent();
    }
    $('#m-plans').replaceChildren(el('h4', { text: 'Điểm mua và bán theo từng huyền thoại' }), planTable(Object.assign({}, s, setup && !s.t ? setup : {})),
      el('p', { class: 'note', text: `Số cổ tính theo vốn ${usd(acct().capital)}, rủi ro ${acct().risk_pct}% mỗi lệnh; stop màu đỏ là rộng hơn mức tối đa ${acct().max_stop_pct}%. Hàng mờ: mã chưa đạt đủ tiêu chí của huyền thoại đó.` }));
    $('#m-actions').replaceChildren(
      setup ? el('button', { class: 'btn', type: 'button', text: 'Ghi vào nhật ký', onclick: () => { closeModal(); prefillJournal(setup); } }) : null,
      el('a', { class: 'btn ghost', href: `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(t)}`, target: '_blank', rel: 'noopener', text: 'Mở trên TradingView' }));
    $('#m-close').focus();
  }
  function closeModal() { $('#modal').hidden = true; if (modalChart) { modalChart.remove(); modalChart = null; } }
  $('#m-close').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

  // ------------------------------------------------------------ nhật ký
  const Journal = (() => {
    const KEY = 'nk_journal_v1';
    let list = store.get(KEY, []), eqChart = null, inited = false;
    const save = () => store.set(KEY, list);
    const calc = (x) => {
      const per = x.entry - x.stop;
      const closed = isNum(x.exit) && x.exit > 0;
      return Object.assign({}, x, { per, closed, R: closed && per > 0 ? (x.exit - x.entry) / per : null, pl: closed ? (x.exit - x.entry) * x.shares : null, riskUsd: per * x.shares, stopPct: x.entry ? per / x.entry * 100 : null });
    };
    function preview() {
      const e = Number($('#jr-entry').value), s = Number($('#jr-stop').value), n = Number($('#jr-shares').value);
      $('#jr-preview').textContent = e > s && s > 0 ? `Stop ${n1((e - s) / e * 100)}% · rủi ro ${usd((e - s) * (n || 0))}` : '';
    }
    function reset() { $('#jr-form').reset(); $('#jr-id').value = ''; $('#jr-cancel').hidden = true; $('#jr-form-title').textContent = 'Ghi lệnh mới'; $('#jr-d').value = new Date().toISOString().slice(0, 10); preview(); }
    function fill(x) {
      $('#jr-id').value = x.id || ''; $('#jr-t').value = x.t || ''; $('#jr-setup').value = x.setup || ''; $('#jr-d').value = x.d || new Date().toISOString().slice(0, 10);
      $('#jr-entry').value = x.entry ?? ''; $('#jr-stop').value = x.stop ?? ''; $('#jr-shares').value = x.shares ?? ''; $('#jr-xd').value = x.xd || ''; $('#jr-exit').value = x.exit ?? ''; $('#jr-note').value = x.note || '';
      $('#jr-cancel').hidden = !x.id; $('#jr-form-title').textContent = x.id ? 'Sửa lệnh ' + x.t : 'Ghi lệnh mới'; preview();
    }
    function render() {
      const rows = list.map(calc);
      const closed = rows.filter((r) => r.closed), wins = closed.filter((r) => r.R > 0), losses = closed.filter((r) => r.R <= 0);
      const avg = (a, k) => (a.length ? a.reduce((s, r) => s + r[k], 0) / a.length : null);
      const T = $('#jr-tiles'); T.replaceChildren();
      tile(T, 'Lệnh đã đóng', n0(closed.length), `${rows.length - closed.length} lệnh đang mở`);
      tile(T, 'Tỷ lệ thắng', closed.length ? pct(wins.length / closed.length * 100, 0) : '—', `${wins.length} thắng / ${losses.length} thua`);
      tile(T, 'R trung bình mỗi lệnh', isNum(avg(closed, 'R')) ? n2(avg(closed, 'R')) + 'R' : '—', 'kỳ vọng của hệ thống', cls(avg(closed, 'R')));
      tile(T, 'Lệnh thắng TB', isNum(avg(wins, 'R')) ? '+' + n2(avg(wins, 'R')) + 'R' : '—', '', 'up');
      tile(T, 'Lệnh thua TB', isNum(avg(losses, 'R')) ? n2(avg(losses, 'R')) + 'R' : '—', 'Martin: giữ quanh −1R', 'dn');
      tile(T, 'Tổng lãi / lỗ', closed.length ? usd(closed.reduce((s, r) => s + r.pl, 0)) : '—', '', cls(closed.reduce((s, r) => s + r.pl, 0)));
      table($('#tb-journal'), [
        { k: 'd', label: 'Ngày mua', f: (r) => fdate(r.d) },
        { k: 't', label: 'Mã', tk: true },
        { k: 'setup', label: 'Setup', l: true },
        { k: 'entry', label: 'Giá mua', f: (r) => n2(r.entry) },
        { k: 'stop', label: 'Stop', f: (r) => n2(r.stop) },
        { k: 'stopPct', label: 'Stop %', f: (r) => pct(r.stopPct) },
        { k: 'shares', label: 'Số cổ', f: (r) => n0(r.shares) },
        { k: 'riskUsd', label: 'Rủi ro', f: (r) => usd(r.riskUsd) },
        { k: 'xd', label: 'Ngày bán', f: (r) => (r.xd ? fdate(r.xd) : 'Đang mở') },
        { k: 'exit', label: 'Giá bán', f: (r) => (r.closed ? n2(r.exit) : '—') },
        { k: 'R', label: 'R', f: (r) => (isNum(r.R) ? (r.R > 0 ? '+' : '') + n2(r.R) : '—'), c: (r) => cls(r.R) },
        { k: 'pl', label: 'Lãi/lỗ', f: (r) => usd(r.pl), c: (r) => cls(r.pl) },
        { k: 'note', label: 'Ghi chú', l: true, f: (r) => (r.note || '').slice(0, 60) },
        { k: '_a', label: '', f: (r) => {
          const box = el('span');
          box.append(el('button', { class: 'btn sm ghost', type: 'button', text: 'Sửa', onclick: () => { fill(r); $('#jr-form').scrollIntoView({ behavior: 'smooth', block: 'center' }); } }), ' ');
          const del = el('button', { class: 'btn sm ghost', type: 'button', text: 'Xóa' });
          del.addEventListener('click', () => { if (del.dataset.armed) { list = list.filter((x) => x.id !== r.id); save(); render(); } else { del.dataset.armed = '1'; del.textContent = 'Chắc chắn?'; setTimeout(() => { delete del.dataset.armed; del.textContent = 'Xóa'; }, 3000); } });
          box.append(del); return box;
        } },
      ], rows, { sort: 'd', empty: 'Chưa có lệnh nào. Ghi lệnh đầu tiên ở khung bên trên, hoặc bấm "Ghi nhật ký" trong tab Setup.' });
      const box = $('#ch-equity');
      if (eqChart) { eqChart.remove(); eqChart = null; }
      const pts = closed.filter((r) => r.xd).sort((a, b) => a.xd.localeCompare(b.xd));
      if (!pts.length) { box.replaceChildren(el('p', { class: 'empty', text: 'Đường vốn sẽ hiện khi có lệnh đã đóng.' })); return; }
      if (box.closest('.tab').hidden) return;
      eqChart = baseChart(box);
      let cum = 0; const byDay = new Map();
      for (const r of pts) { cum += r.R; byDay.set(r.xd, cum); }
      const s = eqChart.addAreaSeries({ lineColor: css('--accent'), topColor: css('--accent') + '44', bottomColor: css('--accent') + '05', lineWidth: 2, priceLineVisible: false });
      s.setData([...byDay].map(([time, value]) => ({ time, value })));
      eqChart.timeScale().fitContent();
    }
    function init() {
      if (inited) { render(); return; } inited = true;
      reset();
      ['#jr-entry', '#jr-stop', '#jr-shares'].forEach((s) => $(s).addEventListener('input', preview));
      $('#jr-cancel').addEventListener('click', reset);
      $('#jr-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const x = { id: $('#jr-id').value || String(Date.now()), t: $('#jr-t').value.trim().toUpperCase(), setup: $('#jr-setup').value.trim(), d: $('#jr-d').value,
          entry: Number($('#jr-entry').value), stop: Number($('#jr-stop').value), shares: Number($('#jr-shares').value), xd: $('#jr-xd').value || '', exit: $('#jr-exit').value ? Number($('#jr-exit').value) : null, note: $('#jr-note').value.trim() };
        if (!(x.entry > x.stop)) { $('#jr-preview').textContent = 'Stop phải thấp hơn giá mua.'; return; }
        const i = list.findIndex((y) => y.id === x.id); if (i >= 0) list[i] = x; else list.push(x);
        save(); reset(); render();
      });
      $('#jr-export').addEventListener('click', () => {
        const head = ['id', 't', 'setup', 'd', 'entry', 'stop', 'shares', 'xd', 'exit', 'note'];
        const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
        const csv = '﻿' + [head.join(','), ...list.map((x) => head.map((h) => q(x[h])).join(','))].join('\n');
        const a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `nhat-ky-${new Date().toISOString().slice(0, 10)}.csv` });
        document.body.append(a); a.click(); a.remove();
      });
      $('#jr-import').addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) return;
        const text = (await f.text()).replace(/^﻿/, '');
        const lines = text.split(/\r?\n/).filter(Boolean);
        const parse = (line) => { const out = []; let cur = '', inq = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (inq) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') inq = false; else cur += ch; } else if (ch === '"') inq = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
        const head = parse(lines[0]);
        const rows = lines.slice(1).map((l) => Object.fromEntries(parse(l).map((v, i) => [head[i], v])));
        let added = 0;
        for (const r of rows) {
          const x = { id: r.id || String(Date.now() + added), t: (r.t || '').toUpperCase(), setup: r.setup || '', d: r.d || '', entry: Number(r.entry), stop: Number(r.stop), shares: Number(r.shares), xd: r.xd || '', exit: r.exit ? Number(r.exit) : null, note: r.note || '' };
          if (!x.t || !(x.entry > x.stop)) continue;
          const i = list.findIndex((y) => y.id === x.id); if (i >= 0) list[i] = x; else list.push(x); added++;
        }
        save(); render(); e.target.value = '';
      });
      render();
    }
    return { init, fill, render };
  })();
  function prefillJournal(s) {
    closeModal(); showTab('journal'); Journal.init();
    Journal.fill({ t: s.t, setup: (s.setups || [])[0] || '', entry: s.entry, stop: s.stop, shares: s.shares });
    $('#jr-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ------------------------------------------------------------ khởi động
  async function load() {
    const get = async (k) => (await fetch(`data/${k}.json`, { cache: 'no-cache' })).json();
    try {
      [S.latest, S.history, S.stocks, S.setups, S.extended, S.themes, S.basket] = await Promise.all(['latest', 'history', 'stocks', 'setups', 'extended', 'themes', 'basket'].map(get));
      [S.industries, S.patterns, S.backtest, S.cycle, S.paper] = await Promise.all(['industries', 'patterns', 'backtest', 'cycle', 'paper'].map((k) => get(k).catch(() => null)));
      S.paper = S.paper || { accounts: {} };
      S.cycle = S.cycle || { notes: [] };
      S.backtest = S.backtest || { strategies: {}, vsa_types: [], notes: [] };
      S.industries = S.industries || []; S.patterns = S.patterns || { stats: [], dates: [], series: {} };
    } catch (e) {
      $('#asof').textContent = 'Chưa có dữ liệu. Hãy chạy pipeline (xem README).';
      return;
    }
    const L = S.latest;
    $('#asof').textContent = `Phiên ${fdate(L.asof)} · ${L.universe} mã · ${L.source || ''} · cập nhật ${new Date(L.generated).toLocaleString('vi-VN')}`;
    $('#demo-banner').hidden = !L.demo;
    $('#ver').textContent = `Phiên bản ${APP_VERSION}` + (L.version && L.version !== APP_VERSION ? ` · dữ liệu ${L.version}` : '');
    if (!L.demo && L.version !== APP_VERSION) { const b = $('#stale-banner'); b.hidden = false; b.textContent = `Giao diện (${APP_VERSION}) và bộ tính toán (${L.version || 'bản cũ'}) khác phiên bản. Hãy tải lại đủ các thư mục docs và pipeline lên GitHub rồi bấm Run workflow.`; }
    const age = (Date.now() - new Date(L.asof + 'T21:00:00Z').getTime()) / 864e5;
    if (age > 4 && !L.demo) { const b = $('#stale-banner'); b.hidden = false; b.textContent = `Dữ liệu đã cũ ${Math.floor(age)} ngày. Có thể lần chạy tự động gần đây bị lỗi — xem tab Actions trên GitHub.`; }
    rangeButtons();
    showTab(location.hash.slice(1) || store.get('nk_tab', 'overview'));
  }
  window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { built.clear(); const cur = $('.tabs button[aria-selected=true]').dataset.tab; Object.values(live).forEach((c) => c.remove()); for (const k in live) delete live[k]; showTab(cur); });
  if (!LW) { $('#asof').textContent = 'Không tải được thư viện biểu đồ.'; return; }
  load();
})();
