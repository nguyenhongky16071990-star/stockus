/* Nhiệt kế thị trường — trang web đọc các file JSON do pipeline/build.py tạo ra. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const LW = window.LightweightCharts;
  const S = { latest: null, history: [], stocks: [], setups: [], extended: [], themes: [], basket: [], industries: [], patterns: null, charts: null };
  const ranges = {};          // khoảng thời gian của từng biểu đồ
  const built = new Set();    // tab đã vẽ
  const live = {};            // biểu đồ đang hiển thị
  let hlScope = 'top';        // biểu đồ vượt đỉnh/cách đỉnh: top 100 hay toàn thị trường

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

  // ------------------------------------------------------------ bộ lọc siêu cổ
  const Screener = (() => {
    const KEY = 'nk_screener_v1';
    const has = (a) => Array.isArray(a) && a.length > 0;
    const CRIT = [
      { g: 'Sức mạnh giá' },
      { id: 'top', label: 'Thuộc top', unit: 'mã mạnh nhất (xếp theo sức mạnh giá)', v: 100, step: 10, on: true, test: (s, v) => isNum(s.rs_pos) && s.rs_pos <= v },
      { id: 'ind', label: 'Ngành nằm trong top', unit: 'ngành mạnh nhất', v: 5, step: 1, on: true, test: (s, v) => isNum(s.ind_rank) && s.ind_rank <= v },
      { id: 'tt', label: 'Đạt Trend Template của Minervini', test: (s) => s.tt },
      { id: 'rsnh', label: 'Đường RS lập đỉnh mới (thường báo trước giá)', test: (s) => s.rsnh },
      { id: 'near', label: 'Cách đỉnh 1 năm không quá', unit: '%', v: 15, step: 1, test: (s, v) => isNum(s.dd) && s.dd >= -v },
      { id: 'mom', label: 'Tăng trong 3 tháng ít nhất', unit: '%', v: 30, step: 5, test: (s, v) => isNum(s.r63) && s.r63 >= v },
      { id: 'ema', label: 'Trên EMA 21 và EMA 21 đang dốc lên (Martin Luk)', test: (s) => s.e21up },
      { id: 'st2', label: 'Đang ở giai đoạn 2: giá trên đường 30 tuần đang dốc lên (Weinstein)', on: false, test: (s) => s.stage === 2 },
      { id: 'dnb', label: 'Giữ giá tốt hơn QQQ trong các phiên thị trường giảm (Minervini, O\'Neil)', test: (s) => isNum(s.dnb) && s.dnb > 0 },
      { id: 'ipo', label: 'Mới niêm yết dưới 1 năm (siêu cổ hay xuất hiện sau IPO)', test: (s) => isNum(s.ipo) },
      { id: 'adr', label: 'Biên độ ngày trung bình ít nhất', unit: '% (Qullamaggie thích ≥ 4%)', v: 4, step: 0.5, test: (s, v) => isNum(s.adr) && s.adr >= v },
      { g: 'Dòng tiền' },
      { id: 'liq', label: 'Giá trị giao dịch ít nhất', unit: 'triệu USD/ngày', v: 20, step: 5, test: (s, v) => isNum(s.dv) && s.dv >= v },
      { id: 'udv', label: 'Khối lượng phiên tăng gấp phiên giảm ít nhất', unit: 'lần, 50 phiên (O\'Neil: tích lũy)', v: 1.2, step: 0.1, test: (s, v) => isNum(s.udv) && s.udv >= v },
      { id: 'ep', label: 'Có cú gap tăng mạnh kèm khối lượng (EP) trong 3 tháng', test: (s) => s.ep63 },
      { id: 'cap', label: 'Vốn hóa không quá', unit: 'tỷ USD (siêu cổ thường bắt đầu từ cỡ nhỏ và vừa)', v: 30, step: 5, test: (s, v) => isNum(s.mcap) && s.mcap <= v },
      { g: 'Tăng trưởng' },
      { id: 'rev', label: 'Doanh thu quý tăng so với cùng kỳ ít nhất', unit: '%', v: 20, step: 5, on: true, test: (s, v) => isNum(s.rev_yoy) && s.rev_yoy >= v },
      { id: 'eps', label: 'EPS quý tăng so với cùng kỳ ít nhất', unit: '% (từ lỗ sang lãi tính là đạt)', v: 25, step: 5, on: true, test: (s, v) => isNum(s.eps_yoy) && s.eps_yoy >= v },
      { id: 'revup', label: 'Doanh thu tăng liên tiếp ít nhất', unit: 'quý', v: 3, step: 1, test: (s, v) => isNum(s.rev_up) && s.rev_up >= v },
      { id: 'accel', label: 'Doanh thu hoặc EPS đang tăng tốc', test: (s) => s.rev_accel || s.eps_accel },
      { id: 'epsa', label: 'EPS năm tăng liên tiếp ít nhất', unit: 'năm', v: 2, step: 1, test: (s, v) => isNum(s.eps_a_up) && s.eps_a_up >= v },
      { id: 'pos', label: 'Đang có lãi (EPS quý gần nhất dương)', test: (s) => s.eps_pos },
      { g: 'Điểm mua' },
      { id: 'setup', label: 'Có setup mua hôm nay', test: (s) => has(s.setups) },
      { id: 'noearn', label: 'Không có báo cáo kết quả kinh doanh trong', unit: 'ngày tới (tránh rủi ro gap)', v: 7, step: 1, test: (s, v) => { const d = earnDays(s); return d === null || d > v; } },
      { id: 'sig', label: 'Vừa xuất hiện mẫu hình mua hôm nay', test: (s) => has(s.sig) },
    ];
    const items = CRIT.filter((c) => c.id);
    const defaults = () => Object.fromEntries(items.map((c) => [c.id, { on: !!c.on, v: c.v }]));
    let cfg = Object.assign(defaults(), store.get(KEY, {}));
    let last = [];

    function form() {
      const box = $('#crit'); box.replaceChildren();
      let fs = null;
      for (const c of CRIT) {
        if (c.g) { fs = el('fieldset', {}, el('legend', { text: c.g })); box.append(fs); continue; }
        const st = cfg[c.id] || { on: false, v: c.v };
        const cb = el('input', { type: 'checkbox', id: 'cr-' + c.id });
        cb.checked = !!st.on;
        cb.addEventListener('input', () => { cfg[c.id] = Object.assign({}, cfg[c.id], { on: cb.checked }); save(); });
        const row = el('div', { class: 'crit-row' }, cb, el('label', { for: 'cr-' + c.id, text: c.label }));
        if (c.v !== undefined) {
          const nb = el('input', { type: 'number', id: 'crv-' + c.id, step: String(c.step || 1), min: '0', 'aria-label': c.label });
          nb.value = st.v ?? c.v;
          nb.addEventListener('input', () => { const v = Number(nb.value); if (isFinite(v)) { cfg[c.id] = Object.assign({}, cfg[c.id], { v }); save(); } });
          row.append(nb, el('span', { class: 'muted small', text: c.unit || '' }));
        }
        fs.append(row);
      }
    }
    function save() { store.set(KEY, cfg); run(); }
    function run() {
      const act = items.filter((c) => cfg[c.id] && cfg[c.id].on);
      const near = $('#crit-near').checked;
      const rows = [];
      for (const s of S.stocks) {
        let ok = 0; const miss = [];
        for (const c of act) { if (c.test(s, cfg[c.id].v)) ok++; else miss.push(c.label); }
        const m = act.length - ok;
        if (m === 0 || (near && m === 1)) rows.push(Object.assign({}, s, { _ok: ok, _miss: miss.join('; ') }));
      }
      last = rows;
      const full = rows.filter((r) => r._ok === act.length).length;
      $('#scr-count').textContent = `${full} mã đạt đủ ${act.length} điều kiện` + (near ? ` · ${rows.length - full} mã thiếu 1` : '');
      const fn = S.latest.fund_n;
      $('#scr-note').textContent = `Số liệu doanh thu/EPS có cho ${n0(fn)} mã (khoảng 400 mã mạnh nhất và các mã có setup), cập nhật hằng tuần. Mã không có số liệu sẽ không đạt điều kiện tăng trưởng.` + (S.stocks.some((s) => isNum(s.mcap)) ? '' : ' Vốn hóa chỉ có khi dùng nguồn Massive.');
      table($('#tb-scr'), [
        { k: 't', label: 'Mã', tk: true },
        { k: '_ok', label: 'Đạt', f: (r) => `${r._ok}/${act.length}`, c: (r) => (r._ok === act.length ? 'up' : 'wa'), title: 'Số điều kiện đạt' },
        { k: 'rs_pos', label: 'Hạng RS', f: (r) => n0(r.rs_pos) },
        { k: 'ind_rank', label: 'Hạng ngành', f: (r) => (isNum(r.ind_rank) ? `${r.ind_rank}/${S.latest.n_ind}` : '—') },
        { k: 'rs', label: 'RS', f: (r) => n0(r.rs) },
        { k: 'close', label: 'Giá', f: (r) => n2(r.close) },
        { k: 'r21', label: '1 tháng', f: (r) => spct(r.r21), c: (r) => cls(r.r21) },
        { k: 'r63', label: '3 tháng', f: (r) => spct(r.r63), c: (r) => cls(r.r63) },
        { k: 'dd', label: 'Cách đỉnh', f: (r) => spct(r.dd) },
        { k: 'rev_yoy', label: 'DT quý', f: (r) => spct(r.rev_yoy), c: (r) => cls(r.rev_yoy) },
        { k: 'eps_yoy', label: 'EPS quý', f: (r) => spct(r.eps_yoy), c: (r) => cls(r.eps_yoy) },
        { k: 'mcap', label: 'Vốn hóa (tỷ $)', f: (r) => n1(r.mcap) },
        { k: 'ind', label: 'Ngành', l: true, f: (r) => r.ind || r.theme },
        { k: '_miss', label: 'Ghi chú', l: true, f: (r) => { const f = tags(r); (r.sig || []).forEach((t) => f.append(el('span', { class: 'tag', text: t }))); if (r._miss) f.append(el('span', { class: 'tag miss', text: 'Thiếu: ' + r._miss })); return f; }, sv: (r) => (r.setups || []).length },
      ], rows, { sort: '_ok', limit: 300, rowClass: (r) => (r._ok === act.length ? '' : 'dim'), onRow: (r) => openChart(r.t), empty: 'Không có mã nào đạt. Thử tắt bớt điều kiện hoặc nới ngưỡng.' });
    }
    function init() {
      form();
      $('#crit-near').addEventListener('input', run);
      $('#crit-reset').addEventListener('click', () => { cfg = defaults(); store.set(KEY, cfg); form(); run(); });
      $('#wl-scr').addEventListener('click', () => exportWatchlist(last.map((r) => r.t), 'sieu-co'));
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
      [S.industries, S.patterns] = await Promise.all(['industries', 'patterns'].map((k) => get(k).catch(() => null)));
      S.industries = S.industries || []; S.patterns = S.patterns || { stats: [], dates: [], series: {} };
    } catch (e) {
      $('#asof').textContent = 'Chưa có dữ liệu. Hãy chạy pipeline (xem README).';
      return;
    }
    const L = S.latest;
    $('#asof').textContent = `Phiên ${fdate(L.asof)} · ${L.universe} mã · ${L.source || ''} · cập nhật ${new Date(L.generated).toLocaleString('vi-VN')}`;
    $('#demo-banner').hidden = !L.demo;
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
