/* Nhiệt kế thị trường — trang web đọc các file JSON do pipeline/build.py tạo ra. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const LW = window.LightweightCharts;
  const APP_VERSION = '2026.11.13-b'; // phải trùng với APP_VERSION trong pipeline/build.py
  const S = { exits: null, groups: null, flow: null, lab: null, cond: null, paper: null, cycle: null, backtest: null, latest: null, history: [], stocks: [], setups: [], extended: [], themes: [], basket: [], industries: [], patterns: null, charts: null };
  const ranges = {};          // khoảng thời gian của từng biểu đồ
  const built = new Set();    // tab đã vẽ
  const live = {};            // biểu đồ đang hiển thị
  let hlScope = 'top', patDone = false;
  let cyKey = 'qqq';
  const PHC = { 'Tăng': '--good', 'Điều chỉnh': '--warn', 'Giằng co': '--c1', 'Giảm': '--bad' };
  const GDC = { 'Vàng + đầu chu kỳ': '--good', 'Thời điểm vàng': '--good', 'Thuận lợi': '--c4', 'Trung tính': '--warn', 'Bất lợi': '--bad' };
  let grView = 'rsl'; const grOn = new Set();
  const STC = { 'Xu hướng giảm': '--bad', 'Hồi phục ban đầu': '--c2', 'Dòng tiền lan rộng': '--c4', 'Uptrend xác nhận': '--good', 'Phân phối / suy yếu': '--warn', 'Chưa rõ ràng': '--muted' };
  const ppOn = new Set(['ml', 'qm', 'mm', 'wo', 'sw', 'pb', 'ok', 'qqq']);
  const btOn = new Set(['ml', 'qm', 'mm', 'wo', 'sw', 'pb', 'ok']);        // biểu đồ vượt đỉnh/cách đỉnh: top 100 hay toàn thị trường

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
  // nút phóng to cho mọi bảng: mở cả thẻ chứa bảng ra toàn màn hình, Esc hoặc bấm lại để thu nhỏ
  function addZoom() {
    $$('.tbl').forEach((t) => {
      const card = t.closest('.card'); if (!card || card.querySelector('.zoom-btn')) return;
      const b = el('button', { type: 'button', class: 'btn sm ghost zoom-btn', title: 'Phóng to bảng (Esc để thu nhỏ)', text: '⤢ Phóng to' });
      b.addEventListener('click', () => { const on = !card.classList.contains('fs'); $$('.card.fs').forEach((c) => { c.classList.remove('fs'); const z = c.querySelector('.zoom-btn'); if (z) z.textContent = '⤢ Phóng to'; }); if (on) { card.classList.add('fs'); b.textContent = '✕ Thu nhỏ'; } document.body.classList.toggle('fs-open', on); });
      t.before(el('div', { class: 'zoom-bar' }, b));
    });
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $$('.card.fs').forEach((c) => { c.classList.remove('fs'); const z = c.querySelector('.zoom-btn'); if (z) z.textContent = '⤢ Phóng to'; }); document.body.classList.remove('fs-open'); } });
  function showTab(name) {
    let mv = null;
    if (name === 'search' || name === 'screener') { name = 'setups'; mv = 'scr'; }
    if (name === 'patterns') name = 'lab';
    if (name === 'basket') name = 'cycle';
    if (name === 'paper') name = 'backtest';
    if (!$('#tab-' + name)) name = 'overview';
    $$('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    const tb = $(`.tabs button[data-tab="${name}"]`), g = tb ? tb.dataset.g : 'mkt';
    $$('.groups button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.g === g)));
    $$('.tabs button').forEach((b) => { b.hidden = b.dataset.g !== g; });
    $$('.tab').forEach((t) => { t.hidden = t.id !== 'tab-' + name; });
    if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
    if (S.latest && !built.has(name)) { built.add(name); BUILD[name] && BUILD[name](); }
    // biểu đồ của tab được dựng sẵn khi tab còn ẩn (ví dụ tab Hiệu quả setup dựng từ tab Mã hôm nay): vẽ khi tab hiện ra
    if (S.latest) $$(`#tab-${name} .chart[id^="ch-"]`).forEach((b) => { const k = b.id.slice(3); if (!live[k] && CHARTS[k] && !b.children.length) drawHistChart(k); });
    if (mv) setMv(mv);
    addZoom();
    store.set('nk_tab', name);
  }
  // tab "Mã hôm nay": một chỗ duy nhất cho mọi mã của ngày, 4 cách xem
  function setMv(v) {
    $$('.mv-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mv === v)));
    $$('.mv').forEach((d) => { d.hidden = d.dataset.mv !== v; });
    store.set('nk_mv', v); addZoom();
  }
  $$('.mv-seg button').forEach((b) => b.addEventListener('click', () => setMv(b.dataset.mv)));
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $$('.groups button').forEach((b) => b.addEventListener('click', () => { const f = $(`.tabs button[data-g="${b.dataset.g}"]`); if (f) showTab(f.dataset.tab); }));

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
    bdd(c, rows) {
      c.addLineSeries({ color: css('--c1'), lineWidth: 2, priceLineVisible: false, title: 'Cách đỉnh < 20%' }).setData(ser(rows, 'b_w20'));
      c.addLineSeries({ color: css('--c4'), lineWidth: 2, priceLineVisible: false, title: 'Cách đỉnh < 10%' }).setData(ser(rows, 'b_w10'));
      c.addLineSeries({ color: css('--bad'), lineWidth: 1, lineStyle: 2, priceScaleId: 'left', priceLineVisible: false, title: 'Trung vị % cách đỉnh' }).setData(ser(rows, 'b_ddmed'));
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
    tspd(c, rows) {
      const all = S.history; let t = 100; const ti = all.map((r) => (t *= 1 + (isNum(r.b_ret1) ? r.b_ret1 : 0) / 100));
      const from = rows.length ? rows[0].d : '';
      const pts = all.map((r, i) => [r.d, isNum(r.qqq) ? ti[i] / r.qqq : null, i]).filter(([d, v]) => d >= from && isNum(v));
      if (!pts.length) return;
      const b0 = pts[0][1];
      const h = c.addHistogramSeries({ priceScaleId: 'left', priceLineVisible: false, lastValueVisible: false, title: 'Chênh lệch 21 phiên %' });
      h.setData(pts.map(([d, v, i]) => { const j = i - 21; const v0 = j >= 0 && isNum(all[j].qqq) ? ti[j] / all[j].qqq : null; const x = isNum(v0) ? (v / v0 - 1) * 100 : null;
        return isNum(x) ? { time: d, value: x, color: css(x >= 0 ? '--good' : '--bad') + '88' } : null; }).filter(Boolean));
      c.addLineSeries({ color: css('--ink'), lineWidth: 2, priceLineVisible: false, title: 'Top 100 / QQQ' }).setData(pts.map(([d, v]) => ({ time: d, value: v / b0 * 100 })));
      c.applyOptions({ leftPriceScale: { visible: true } });
    },
    turn(c, rows) {
      const pts = rows.filter((r) => isNum(r.b_in5));
      c.addHistogramSeries({ priceLineVisible: false, title: 'Mã mới vào (5 phiên)' }).setData(pts.map((r) => ({ time: r.d, value: r.b_in5, color: css('--c4') + 'aa' })));
      const all = S.history, ix = Object.fromEntries(all.map((r, i) => [r.d, i]));
      c.addLineSeries({ color: css('--ink'), lineWidth: 2, priceLineVisible: false, title: 'TB 20 phiên' }).setData(pts.map((r) => { const i = ix[r.d]; const w = all.slice(Math.max(0, i - 19), i + 1).map((x) => x.b_in5).filter(isNum); return w.length >= 10 ? { time: r.d, value: w.reduce((a, b) => a + b, 0) / w.length } : null; }).filter(Boolean));
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
  };

  // ---- kiểm chứng dài hạn theo từng năm (longbt.json)
  function yearTable(tbl, rows, sub) {
    const LB = S.longbt || {}, Y = Object.keys(LB.qqq_years || {}).filter((y) => rows.some((r) => ((sub ? r[sub] : r).years || {})[y]));
    const rr = (x) => (isNum(x) ? (x > 0 ? '+' : '') + n2(x) + 'R' : '—');
    const g = (r) => (sub ? r[sub] : r) || {};
    table(tbl, [
      { k: 'name', label: 'Phương pháp', l: true },
      ...Y.map((y) => ({ k: 'y' + y, label: `${y} (QQQ ${spct(LB.qqq_years[y])})`, f: (r) => { const c = (g(r).years || {})[y]; return c && c.n ? el('span', {}, el('b', { text: rr(c.exp) }), el('small', { class: 'muted', text: ' ' + n0(c.n) })) : '—'; },
        c: (r) => { const c = (g(r).years || {})[y]; return c && c.n >= 20 ? cls(c.exp) : 'muted'; }, sv: (r) => ((g(r).years || {})[y] || {}).exp ?? -9 })),
      { k: 'all', label: 'Cả giai đoạn', f: (r) => { const a = g(r).all || {}; return a.n ? `${rr(a.exp)} · ${n0(a.n)} lệnh · thắng ${pct(a.win, 0)}` : '—'; }, c: (r) => cls((g(r).all || {}).exp), sv: (r) => (g(r).all || {}).exp ?? -9 },
      { k: 'pos', label: 'Số năm dương', f: (r) => `${g(r).pos_years ?? 0}/${g(r).n_years ?? 0}`, sv: (r) => (g(r).pos_years || 0) / Math.max(1, g(r).n_years || 1) },
      { k: 'verdict', label: 'Kết luận', l: true, f: (r) => g(r).verdict || '—', c: (r) => (/^Giữ/.test(g(r).verdict) ? 'up' : /^Bỏ/.test(g(r).verdict) ? 'dn' : 'muted') },
    ], rows, { sort: 'all' });
  }
  function drawLongLeg() {
    const LB = S.longbt || {}; if (!(LB.legends || []).length) return;
    $('#lt-leg-card').hidden = false;
    yearTable($('#tb-lt-leg'), LB.legends);
    $('#lt-leg-note').textContent = `Cùng quy tắc vào lệnh, bán và phòng thủ như bảng tổng hợp bên dưới, nhưng chạy trên ${fdate(LB.from)} – ${fdate(LB.to)} (${LB.src}). Mỗi ô: kỳ vọng mỗi lệnh (R) và số lệnh; ô mờ là năm có dưới 20 lệnh. Quy tắc kết luận: dương cả giai đoạn và dương ở ít nhất một nửa số năm thì giữ. ${LB.note || ''}`;
  }
  function drawLongSet() {
    const LB = S.longbt || {}; if (!(LB.setups || []).length) return;
    $('#lt-set-card').hidden = false;
    yearTable($('#tb-lt-set'), LB.setups.map((r) => Object.assign({}, r, { name: r.name + ' (khi QQQ không Xấu)' })), 'ok');
    $('#lt-set-note').textContent = `Các setup trong bảng hiệu quả bên dưới, cùng cách mua và bán, chạy trên ${fdate(LB.from)} – ${fdate(LB.to)} (${LB.src}), chỉ tính lệnh mở khi xu hướng QQQ không Xấu (đúng quy tắc phòng thủ). Mỗi ô: kỳ vọng mỗi lệnh (R) và số lệnh. ${LB.note || ''}`;
  }
  function drawGates() {
    const B = (S.backtest || {}).gates || {}, AC = (S.smi || {}).alert_cmp || {};
    if (!(B.rows || []).length && !(AC.rows || []).length) return;
    $('#gate-card').hidden = false;
    const rr = (x) => (isNum(x) ? (x > 0 ? '+' : '') + x.toFixed(2) + 'R' : '—');
    const brows = (B.rows || []).filter((r) => !/^SMI/.test(r.name)).map((r) => ({ ...r, now: (B.now || {})[r.name] }));
    const bold = (r) => (/^Pha top 100/.test(r.name) ? el('b', { text: r.name }) : r.name);
    table($('#tb-gate-bt'), [
      { k: 'name', label: 'Bộ lọc', l: true, f: bold },
      { k: 'now', label: 'Hôm nay', l: true, f: (r) => (r.now == null ? '—' : r.now ? 'Được mua' : 'Không mua'), c: (r) => (r.now ? 'up' : 'dn') },
      { k: 'share', label: '% số ngày được mua', f: (r) => pct(r.share, 0) },
      { k: 'n', label: 'Số lệnh', f: (r) => n0(r.n) },
      { k: 'win', label: '% lệnh thắng', f: (r) => pct(r.win, 0) },
      { k: 'exp', label: 'Kỳ vọng / lệnh', f: (r) => rr(r.exp), c: (r) => cls(r.exp) },
      { k: 'total', label: 'Tổng R', f: (r) => (isNum(r.total) ? (r.total > 0 ? '+' : '') + n0(r.total) + 'R' : '—'), c: (r) => cls(r.total) },
      { k: 'pf', label: 'Lãi/lỗ (PF)', f: (r) => (isNum(r.pf) ? r.pf.toFixed(2) : '—') },
      { k: 'mdd', label: 'Sụt giảm lớn nhất', f: (r) => (isNum(r.mdd) ? r.mdd.toFixed(1) + 'R' : '—'), c: () => 'dn', title: 'Mức tụt sâu nhất của đường R cộng dồn (gộp mọi phương pháp)' },
    ], brows, { sort: null });
    table($('#tb-gate-al'), [
      { k: 'name', label: 'Điều kiện', l: true, f: bold },
      { k: 'share', label: '% số ngày', f: (r) => pct(r.share, 0) },
      { k: 'f21', label: 'QQQ 1 tháng sau', f: (r) => spct(r.f21), c: (r) => cls(r.f21) },
      { k: 'f63', label: 'QQQ 3 tháng sau', f: (r) => spct(r.f63), c: (r) => cls(r.f63) },
      { k: 'win', label: '% lần tăng (3 tháng)', f: (r) => pct(r.win, 0) },
      { k: 'bad', label: '% lần giảm sâu > 10%', f: (r) => pct(r.bad, 0), c: (r) => (r.bad >= 30 ? 'dn' : r.bad <= 12 ? 'up' : '') },
    ], (AC.rows || []).filter((r) => !/SMI/.test(r.name)), { sort: null });
    const by = Object.fromEntries(brows.map((r) => [r.name, r]));
    const best = brows.filter((r) => r.n >= 30 && isNum(r.exp)).sort((a, b) => b.exp - a.exp)[0];
    const parts = [];
    if (best) parts.push(`Bộ lọc tốt nhất hiện nay: "${best.name}" (kỳ vọng ${rr(best.exp)}/lệnh, thắng ${best.win}%, sụt giảm ${best.mdd}R).`);
    const tp = by['Pha top 100: Tăng (xanh lá) hoặc Điều chỉnh (vàng)'], cur = by['Đang dùng: xu hướng QQQ không Xấu'];
    if (tp && cur && isNum(tp.exp) && isNum(cur.exp)) { const d = tp.exp - cur.exp; parts.push(`Pha top 100 xanh lá/vàng ${Math.abs(d) < 0.03 ? 'NGANG' : d > 0 ? 'TỐT HƠN' : 'KÉM HƠN'} bộ lọc đang dùng (${rr(tp.exp)} so với ${rr(cur.exp)}).`); }
    $('#gate-verdict').replaceChildren(el('b', { text: 'Kết luận từ dữ liệu: ' }), parts.join(' ') || 'Chưa đủ dữ liệu.');
    $('#gate-src').textContent = `Lệnh mua đo từ ${fdate((S.backtest || {}).from)} đến ${fdate((S.backtest || {}).to)}; bảng QQQ từ ${fdate(AC.from)}. Số R là lãi/lỗ tính theo mức rủi ro mỗi lệnh. Giai đoạn ngắn, kết quả có thể thay đổi; không phải lời khuyên đầu tư.`;
  }

  function drawSmi() {
    const M = S.smi; if (!M || !M.series || !M.series.length) return;
    $('#smi-card').hidden = false;
    const G = { 'Tốt': '--good', 'Tránh': '--bad', 'Chờ xác nhận': '--muted' };
    ['smi', 'smi2'].forEach((k) => { if (live[k]) { live[k].remove(); delete live[k]; } });
    const rows = M.series.slice(-260), t0 = rows[0][0];
    const c1 = baseChart($('#ch-smi'));
    const cs = c1.addCandlestickSeries({ upColor: css('--good'), downColor: css('--bad'), borderVisible: false, wickUpColor: css('--good'), wickDownColor: css('--bad'), priceLineVisible: false });
    cs.setData(rows.filter((r) => isNum(r[4])).map((r) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4] })));
    cs.setMarkers((M.signals || []).filter((x) => x.d >= t0).map((x) => ({ time: x.d, position: 'belowBar', shape: 'arrowUp', color: css(G[x.grp] || '--muted'), text: x.grp === 'Tốt' ? 'Mua' : x.grp === 'Tránh' ? 'Tránh' : 'Chờ' })));
    c1.timeScale().fitContent(); live.smi = c1;
    const c2 = baseChart($('#ch-smi2'));
    const a = c2.addLineSeries({ color: css('--c1'), lineWidth: 2, priceLineVisible: false, title: 'SMI' }); a.setData(rows.filter((r) => isNum(r[5])).map((r) => ({ time: r[0], value: r[5] })));
    c2.addLineSeries({ color: css('--c2'), lineWidth: 1, priceLineVisible: false, title: 'Tín hiệu' }).setData(rows.filter((r) => isNum(r[6])).map((r) => ({ time: r[0], value: r[6] })));
    a.createPriceLine({ price: 40, color: css('--bad'), lineStyle: 2, lineWidth: 1, title: 'Quá mua' }); a.createPriceLine({ price: -40, color: css('--good'), lineStyle: 2, lineWidth: 1, title: 'Quá bán' });
    c2.timeScale().fitContent(); live.smi2 = c2;
    const sync = (x, y) => x.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r) y.timeScale().setVisibleLogicalRange(r); });
    sync(c1, c2); sync(c2, c1);
    const N = M.now || {};
    const st = N.oversold ? `SMI tuần đang ở vùng quá bán (${N.smi}). Nếu cắt lên đường tín hiệu, tín hiệu sẽ thuộc nhóm "${N.grp_if}" (QQQ cách đỉnh 52 tuần ${spct(N.dd52)}, lần thứ ${N.nth_next} trong năm).`
      : `SMI tuần hiện ${N.smi} (đường tín hiệu ${N.sig}), chưa quá bán: chưa có điểm mua trung hạn. QQQ cách đỉnh 52 tuần ${spct(N.dd52)}.`;
    const last = N.last ? ` Tín hiệu gần nhất: tuần ${fdate(N.last.d)} (${N.last.grp}), cách đây ${N.weeks_since} tuần.` : '';
    $('#smi-now').replaceChildren(el('b', { text: 'Hôm nay: ' }), st + last);
    const f = (o) => (o && o.n ? `${spct(o.avg)} · thắng ${o.win}%` : '—');
    table($('#tb-smi'), [
      { k: 'g', label: 'Nhóm tín hiệu', l: true, f: (r) => r.g, c: (r) => (r.g === 'Tốt' ? 'up' : r.g === 'Tránh' ? 'dn' : '') },
      { k: 'desc', label: 'Điều kiện', l: true },
      { k: 'n', label: 'Số lần', f: (r) => n0(r.n) },
      { k: 'w13', label: '3 tháng sau', f: (r) => f(r.w13), sv: (r) => r.w13.avg ?? -99 },
      { k: 'w26', label: '6 tháng sau', f: (r) => f(r.w26), sv: (r) => r.w26.avg ?? -99 },
      { k: 'w52', label: '1 năm sau', f: (r) => f(r.w52), sv: (r) => r.w52.avg ?? -99 },
      { k: 'mdd13', label: 'Giảm thêm TB (3 tháng)', f: (r) => spct(r.mdd13) },
    ], (M.groups || []).concat([{ g: 'Mua bất kỳ tuần nào', desc: 'Để so sánh', n: M.base.w13.n, w13: M.base.w13, w26: { n: 0 }, w52: M.base.w52, mdd13: null }]), { sort: null });
    table($('#tb-smi-sig'), [
      { k: 'd', label: 'Tuần', l: true, f: (r) => fdate(r.d) },
      { k: 'grp', label: 'Nhóm', l: true, c: (r) => (r.grp === 'Tốt' ? 'up' : r.grp === 'Tránh' ? 'dn' : '') },
      { k: 'c', label: 'Giá', f: (r) => n2(r.c) },
      { k: 'dd52', label: 'Cách đỉnh 52T', f: (r) => spct(r.dd52) },
      { k: 'nth', label: 'Lần thứ', f: (r) => r.nth },
      { k: 'w13', label: '3 tháng', f: (r) => spct(r.w13), c: (r) => (isNum(r.w13) ? (r.w13 > 0 ? 'up' : 'dn') : '') },
      { k: 'w52', label: '1 năm', f: (r) => spct(r.w52), c: (r) => (isNum(r.w52) ? (r.w52 > 0 ? 'up' : 'dn') : '') },
      { k: 'mdd13', label: 'Giảm thêm', f: (r) => spct(r.mdd13) },
    ], (M.signals || []).slice().reverse().slice(0, 15), { sort: null });
    $('#smi-src').textContent = `Nguồn: ${M.src}, giá tuần ${fdate(M.from)} – ${fdate(M.to)}. Mẫu nhỏ (vài chục tín hiệu) nên chỉ để tham khảo; các tín hiệu trong cùng một đợt giảm không độc lập với nhau.`;
  }

  // ---- độ rộng dài hạn (từ 2020): chỉ báo kiểu Stockbee + tự kiểm chứng
  const LBI = [
    { id: 'm50', name: 'Tăng ≥ 50% trong 1 tháng (đầu cơ)', one: 'up50m', lvl: (r) => r.up50m / r.n * 100,
      guide: 'Số mã tăng gấp rưỡi trong 1 tháng. Kiểm chứng thật 2020–2026: khi vượt 3% số mã (thường ngay sau một đáy lớn: 4/2020, 11/2020, 5/2025, 4/2026) QQQ 3 tháng sau tăng trung bình +7,5%, 9/10 lần tăng. Đây là tín hiệu BÙNG NỔ đầu nhịp tăng, không phải tín hiệu đỉnh.' },
    { id: 't2108', name: '% mã trên MA 40 ngày (T2108)', one: 't2108', lvl: (r) => r.t2108, bands: [20, 70],
      guide: '% cổ phiếu trên MA 40 ngày. Kiểm chứng thật 2020–2026: xuống dưới 20% hoặc cắt lên lại trên 20% thì QQQ 3 tháng sau trung bình +9,5% (so với +5,4% nếu mua bất kỳ lúc nào), nhưng chỉ 2/3 số lần thắng và có thể giảm thêm ~7% trước khi hồi: vùng bắt đáy, cần stop. Trên 70% không có ý nghĩa (như bình thường).' },
    { id: 'adp', name: 'Tăng − giảm mỗi phiên (% số mã, TB 10 phiên)', ser: (R) => { const v = R.map((r) => (r.adv - r.dec) / r.n * 100); return v.map((_, i) => (i < 9 ? null : v.slice(i - 9, i + 1).reduce((s, x) => s + x, 0) / 10)); }, bands: [-20, 20],
      guide: 'Đường A/D đổi sang % số mã (trung bình 10 phiên) để không còn đi song song với QQQ. Kiểm chứng thật 2020–2026: xuống dưới −20% (bán tháo diện rộng, 5% số ngày thấp nhất) thì QQQ 3 tháng sau trung bình +8,3% (so với +5,4%), nhưng chỉ 2/3 số lần thắng: vùng bắt đáy, cần stop. Lên trên +20% (lực mua áp đảo) KHÔNG cho kết quả tốt hơn bình thường.' },
    { id: 'hlp', name: 'Đỉnh mới − đáy mới 52 tuần (% số mã)', ser: (R) => R.map((r) => (r.nh - r.nl) / r.n * 100), bands: [-10, 10], warnLow: true,
      guide: 'Số mã lập đỉnh 52 tuần trừ số mã lập đáy, tính theo % số mã. Kiểm chứng thật 2020–2026: một phiên có đáy mới vượt đỉnh mới quá 10% số mã là TÍN HIỆU CẢNH BÁO: QQQ 3 tháng sau trung bình −1,6%, chỉ 1/3 số lần tăng, giảm thêm trung bình −11% (đa số rơi vào năm 2022). Khác T2108: đây không phải vùng bắt đáy mà là dấu hiệu thị trường giá xuống.' },
    { id: 'm25q', name: 'Tăng / giảm ≥ 25% trong 1 quý (để so sánh)', up: 'up25q', dn: 'dn25q', lvl: (r) => (r.up25q - r.dn25q) / r.n * 100,
      guide: 'Chỉ báo đang dùng ở tab Dòng tiền, đặt đây để so với các chỉ báo khác trên cùng giai đoạn dài.' },
  ];
  let lbRange = 0;
  function longRows() { const L = S.q25long || {}; const C = L.cols || []; return (L.rows || []).map((r) => Object.fromEntries(C.map((k, i) => [k, r[i]]))); }
  // Kiểm chứng theo SỰ KIỆN (lần đầu chạm ngưỡng, cách nhau ≥ 20 phiên) — các chỉ báo này chỉ có ý nghĩa ở vùng cực,
  // tương quan theo mức (dùng ở bản trước) gần như bằng 0 nên không đo được giá trị đó.
  const LBE = [
    { name: 'T2108 xuống dưới 20% (quá bán)', on: (R, i) => R[i].t2108 < 20 },
    { name: 'T2108 cắt lên lại trên 20%', on: (R, i) => R[i].t2108 >= 20 && i > 0 && R[i - 1].t2108 < 20 },
    { name: 'T2108 lên trên 70% (hưng phấn)', on: (R, i) => R[i].t2108 > 70 },
    { name: 'Tăng ≥ 50%/tháng vượt 3% số mã (bùng nổ)', on: (R, i) => R[i].up50m / R[i].n * 100 > 3 },
    { name: 'Mã giảm ≥ 25%/quý vượt 20% số mã', on: (R, i) => R[i].dn25q / R[i].n * 100 > 20 },
    { name: 'Tăng − giảm (TB 10 phiên) xuống dưới −20% số mã', on: (R, i) => i >= 9 && R.slice(i - 9, i + 1).reduce((s, r) => s + (r.adv - r.dec) / r.n * 100, 0) / 10 < -20 },
    { name: 'Đáy mới − đỉnh mới 52 tuần vượt 10% số mã (một phiên)', on: (R, i) => (R[i].nh - R[i].nl) / R[i].n * 100 < -10 },
  ];
  function lbValidate(R) {
    const n = R.length, q = R.map((r) => r.qqq);
    const f = (i, k) => (i + k < n && isNum(q[i]) && isNum(q[i + k]) ? (q[i + k] / q[i] - 1) * 100 : null);
    const dd = (i, k) => { if (i + k >= n || !isNum(q[i])) return null; let m = 0; for (let j = i + 1; j <= i + k; j++) if (isNum(q[j])) m = Math.min(m, q[j] / q[i] - 1); return m * 100; };
    const st = (name, I, base) => { const a = I.map((i) => f(i, 63)).filter(isNum), b = I.map((i) => f(i, 21)).filter(isNum), d = I.map((i) => dd(i, 63)).filter(isNum), av = (x) => (x.length ? x.reduce((s, v) => s + v, 0) / x.length : null);
      return { name, n: I.length, f21: av(b), f63: av(a), win: a.length ? a.filter((v) => v > 0).length / a.length * 100 : null, dd: av(d), dates: base ? '' : I.slice(-6).map((i) => fdate(R[i].d)).join(', ') }; };
    const rows = [st('Mua bất kỳ ngày nào (để so sánh)', R.map((_, i) => i).filter((i) => isNum(q[i])), true)];
    for (const E of LBE) { const I = []; let prev = false; for (let i = 0; i < n; i++) { let on = false; try { on = !!E.on(R, i); } catch (e) { on = false; } if (on && !prev && (!I.length || i - I[I.length - 1] > 20)) I.push(i); prev = on; } rows.push(st(E.name, I)); }
    const b = rows[0];
    rows.slice(1).forEach((r) => { r.use = r.n < 6 ? 'Quá ít lần' : (r.f63 - b.f63 >= 2.5 && r.win >= b.win - 5) ? 'Tốt hơn hẳn: tín hiệu mua' : (r.f63 - b.f63 >= 2.5) ? 'Lãi cao hơn nhưng rủi ro lớn hơn: vùng bắt đáy, cần stop' : (b.f63 - r.f63 >= 4) ? 'Tín hiệu CẢNH BÁO: sau đó thường giảm' : (b.f63 - r.f63 >= 2.5) ? 'Kém hơn: nên thận trọng' : 'Như mua bất kỳ lúc nào: không có giá trị'; });
    return rows;
  }
  function drawLong() {
    const R = longRows(); if (R.length < 200) return;
    $('#lb-card').hidden = false;
    const sel = $('#lb-sel');
    if (!sel.options.length) { sel.append(...LBI.map((I) => el('option', { value: I.id, text: I.name }))); sel.addEventListener('input', drawLong);
      $('#lb-range').replaceChildren(...[[252, '1N'], [756, '3N'], [0, 'Tất cả']].map(([d, t]) => el('button', { type: 'button', 'aria-pressed': String(lbRange === d), text: t, onclick: (ev) => { lbRange = d; $$('#lb-range button').forEach((b) => b.setAttribute('aria-pressed', String(b === ev.currentTarget))); drawLong(); } })));
      const V = lbValidate(R);
      table($('#tb-lbv'), [
        { k: 'name', label: 'Tín hiệu (lần đầu chạm ngưỡng)', l: true },
        { k: 'n', label: 'Số lần', f: (r) => n0(r.n) },
        { k: 'f21', label: 'QQQ 1 tháng sau', f: (r) => spct(r.f21), c: (r) => cls(r.f21) },
        { k: 'f63', label: 'QQQ 3 tháng sau', f: (r) => spct(r.f63), c: (r) => cls(r.f63) },
        { k: 'win', label: '% lần QQQ tăng sau 3 tháng', f: (r) => pct(r.win, 0) },
        { k: 'dd', label: 'Giảm sâu nhất TB (3 tháng)', f: (r) => spct(r.dd), c: (r) => (r.dd < -7 ? 'dn' : '') },
        { k: 'use', label: 'Kết luận', l: true, f: (r) => r.use || '', c: (r) => ((r.use || '').startsWith('Như') || (r.use || '').startsWith('Kém') || (r.use || '').startsWith('Tín hiệu CẢNH') ? 'dn' : (r.use || '').startsWith('Tốt') ? 'up' : '') },
        { k: 'dates', label: 'Các lần gần nhất', l: true },
      ], V, { sort: null });
    }
    const I = LBI.find((x) => x.id === sel.value) || LBI[0];
    $('#lb-guide').textContent = I.guide;
    if (live.lbr) { live.lbr.remove(); delete live.lbr; }
    const rows = lbRange ? R.slice(-lbRange) : R;
    const c = baseChart($('#ch-lbr'));
    c.addLineSeries({ color: css('--ink'), lineWidth: 1, priceScaleId: 'left', priceLineVisible: false, title: 'QQQ' }).setData(rows.filter((r) => isNum(r.qqq)).map((r) => ({ time: r.d, value: r.qqq })));
    if (I.up) {
      c.addLineSeries({ color: css('--good'), lineWidth: 2, priceLineVisible: false, title: 'Tăng' }).setData(rows.map((r) => ({ time: r.d, value: r[I.up] })));
      c.addLineSeries({ color: css('--bad'), lineWidth: 2, priceLineVisible: false, title: 'Giảm' }).setData(rows.map((r) => ({ time: r.d, value: r[I.dn] })));
    } else if (I.ser) {
      const all = I.ser(R), off = R.length - rows.length;
      const s = c.addLineSeries({ color: css('--c1'), lineWidth: 2, priceLineVisible: false, title: I.name.split(' (')[0] }); s.setData(rows.map((r, k) => ({ time: r.d, value: all[off + k] })).filter((p) => isNum(p.value)));
      (I.bands || []).forEach((b) => s.createPriceLine({ price: b, color: css(b < 0 ? (I.warnLow ? '--bad' : '--good') : (I.warnLow ? '--good' : '--bad')), lineStyle: 2, lineWidth: 1, title: b < 0 ? (I.warnLow ? 'Cảnh báo' : 'Vùng bắt đáy') : '' }));
      s.createPriceLine({ price: 0, color: css('--muted'), lineStyle: 1, lineWidth: 1 });
    } else if (I.one) {
      const s = c.addLineSeries({ color: css('--c1'), lineWidth: 2, priceLineVisible: false, title: I.name.split(' (')[0] }); s.setData(rows.filter((r) => isNum(r[I.one])).map((r) => ({ time: r.d, value: r[I.one] })));
      (I.bands || []).forEach((b, k) => s.createPriceLine({ price: b, color: css(k ? '--bad' : '--good'), lineStyle: 2, lineWidth: 1, title: k ? 'Hưng phấn' : 'Quá bán' }));
    } else {
      let cum = 0; c.addLineSeries({ color: css('--c1'), lineWidth: 2, priceLineVisible: false, title: 'Cộng dồn' }).setData(rows.map((r) => ({ time: r.d, value: (cum += I.cum(r)) })));
    }
    c.applyOptions({ leftPriceScale: { visible: true } }); c.timeScale().fitContent(); live.lbr = c;
    const L = S.q25long;
    $('#lb-src').textContent = (L.split ? `Trước ${fdate(L.split)}: tính từ ${L.src} (${n0(L.n_tickers)} mã). Từ ${fdate(L.split)}: dữ liệu của trang. ` : `Nguồn: ${L.src}. `) + (L.note || '') + ' Các phiên liền nhau chồng lên nhau nên số lần độc lập ít hơn nhiều so với số phiên; chỉ coi là tham khảo.';
  }

  // ---- tín hiệu thị trường đã kiểm chứng (từ dữ liệu độ rộng dài hạn)
  function marketSignals() {
    const R = longRows(); if (R.length < 300) return;
    const n = R.length, q = R.map((r) => r.qqq);
    const sma = (a, k) => a.map((_, i) => (i < k - 1 ? null : a.slice(i - k + 1, i + 1).reduce((s, x) => s + x, 0) / k));
    const ema = (a, k) => { const o = []; let e = null; const al = 2 / (k + 1); for (const x of a) { e = e == null ? x : e + al * (x - e); o.push(e); } return o; };
    const s50 = sma(q, 50), s200 = sma(q, 200), e21 = ema(q, 21);
    const t = R.map((r) => r.t2108), ad = sma(R.map((r) => (r.adv - r.dec) / r.n * 100), 10), hl = R.map((r) => (r.nh - r.nl) / r.n * 100), u50 = R.map((r) => r.up50m / r.n * 100);
    const any = (a, i, k, fn) => { for (let j = Math.max(0, i - k); j <= i; j++) if (isNum(a[j]) && fn(a[j])) return true; return false; };
    const wash = (i) => any(t, i, 15, (v) => v < 20) || any(ad, i, 15, (v) => v < -20);
    const SIG = [
      { g: 'Đáy', name: 'Đáy xác nhận: bán tháo diện rộng (T2108 < 20% hoặc tăng−giảm TB 10 phiên < −20%) trong 15 phiên, QQQ đóng cửa lại trên EMA 21, và KHÔNG có phiên đáy mới 52 tuần vượt 10% số mã trong 15 phiên', on: (i) => wash(i) && q[i] > e21[i] && !any(hl, i, 15, (v) => v < -10), ev: true, look: 15 },
      { g: 'Đáy', name: 'Đáy giả (để so sánh): bán tháo + lấy lại EMA 21 nhưng CÓ phiên đáy mới vượt 10% số mã', on: (i) => wash(i) && q[i] > e21[i] && any(hl, i, 15, (v) => v < -10), ev: true, look: 15 },
      { g: 'Uptrend', name: 'Bùng nổ: số mã tăng ≥ 50% trong 1 tháng vượt 3% số mã', on: (i) => u50[i] > 3, ev: true, look: 20 },
      { g: 'Uptrend', name: 'Uptrend ít rủi ro (trạng thái): QQQ > SMA50 > SMA200, SMA50 dốc lên, T2108 > 50%', on: (i) => q[i] > s50[i] && s50[i] > s200[i] && s50[i] > s50[i - 10] && t[i] > 50 },
      { g: 'Tránh', name: 'Tránh xa: một phiên có đáy mới 52 tuần vượt đỉnh mới quá 10% số mã', on: (i) => hl[i] < -10, ev: true, look: 20 },
      { g: 'Tránh', name: 'Rủi ro cao (trạng thái): QQQ dưới SMA200 đang dốc xuống', on: (i) => q[i] < s200[i] && s200[i] < s200[i - 20] },
      // ---- các phiên bản "chart cắt lên" (do người dùng đề xuất) để so trực tiếp với các tín hiệu trên
      { g: 'Cắt lên', name: 'T2108 cắt lên trên 20% (từ vùng quá bán)', on: (i) => t[i] >= 20 && t[i - 1] < 20, ev: true, look: 10 },
      { g: 'Cắt lên', name: 'T2108 cắt lên trên 20% + không có phiên đáy mới vượt 10% số mã trong 15 phiên', on: (i) => t[i] >= 20 && t[i - 1] < 20 && !any(hl, i, 15, (v) => v < -10), ev: true, look: 10 },
      { g: 'Cắt lên', name: 'Tăng − giảm (TB 10 phiên) cắt lên 0 sau bán tháo (< −20% trong 20 phiên)', on: (i) => ad[i] > 0 && ad[i - 1] <= 0 && any(ad, i, 20, (v) => v < -20), ev: true, look: 10 },
      { g: 'Cắt lên', name: 'Đường xanh cắt lên đường đỏ: mã tăng ≥ 25%/quý vượt mã giảm ≥ 25%/quý', on: (i) => R[i].up25q > R[i].dn25q && R[i - 1].up25q <= R[i - 1].dn25q, ev: true, look: 10 },
      { g: 'Cắt lên', name: 'Đỉnh mới − đáy mới 52 tuần (TB 10 phiên) cắt lên trên 0', on: (i) => { const h10 = (k) => hl.slice(Math.max(0, k - 9), k + 1).reduce((s, v) => s + v, 0) / 10; return h10(i) > 0 && h10(i - 1) <= 0; }, ev: true, look: 10 },
      { g: 'Cắt lên', name: 'T2108 cắt lên trên 50%', on: (i) => t[i] >= 50 && t[i - 1] < 50, ev: true, look: 10 },
      { g: 'Cắt lên', name: 'QQQ cắt lên trên SMA 50', on: (i) => q[i] > s50[i] && q[i - 1] <= s50[i - 1], ev: true, look: 10 },
      { g: 'Cắt lên', name: 'SMA 50 cắt lên trên SMA 200 (golden cross)', on: (i) => s50[i] > s200[i] && s50[i - 1] <= s200[i - 1], ev: true, look: 20 },
      { g: 'Không dùng', name: 'Mua điều chỉnh trong uptrend theo T2108 (vừa < 40% rồi quay lên > 45%) — kiểm chứng: không hơn bình thường', on: (i) => q[i] > s200[i] && s200[i] > s200[i - 20] && any(t, i, 10, (v) => v < 40) && t[i] > 45, ev: true, look: 10 },
    ];
    const f = (i, k) => (i + k < n ? (q[i + k] / q[i] - 1) * 100 : null);
    const dd = (i, k) => { if (i + k >= n) return null; let m = 0; for (let j = i + 1; j <= i + k; j++) m = Math.min(m, q[j] / q[i] - 1); return m * 100; };
    const st = (I) => { const av = (x) => (x.length ? x.reduce((s, v) => s + v, 0) / x.length : null); const a = I.map((i) => f(i, 63)).filter(isNum), c = I.map((i) => f(i, 126)).filter(isNum), d = I.map((i) => dd(i, 63)).filter(isNum);
      return { n: I.length, f63: av(a), f126: av(c), win: a.length ? a.filter((v) => v > 0).length / a.length * 100 : null, bad: d.length ? d.filter((v) => v < -10).length / d.length * 100 : null }; };
    const i0 = 210, idx = []; for (let i = i0; i < n; i++) idx.push(i);
    const rows = [{ g: '', name: 'Mua bất kỳ ngày nào (để so sánh)', ...st(idx), now: '' }];
    for (const S_ of SIG) {
      const hit = (i) => { try { return !!S_.on(i); } catch (e) { return false; } };
      let I = [];
      if (S_.ev) { for (const i of idx) if (hit(i) && !hit(i - 1) && (!I.length || i - I[I.length - 1] > 20)) I.push(i); } else I = idx.filter(hit);
      const lastHit = [...idx].reverse().find(hit); const ago = isNum(lastHit) ? n - 1 - lastHit : null;
      const now = S_.ev ? (isNum(ago) && ago <= S_.look ? `ĐANG CÓ (${ago === 0 ? 'hôm nay' : ago + ' phiên trước'})` : (isNum(lastHit) ? `Lần gần nhất ${fdate(R[lastHit].d)}` : '—')) : (hit(n - 1) ? 'ĐANG CÓ' : 'Không');
      rows.push({ g: S_.g, name: S_.name, ...st(I), cnt: S_.ev ? `${I.length} lần` : `${Math.round(I.length / idx.length * 100)}% số phiên`, now, on: now.startsWith('ĐANG') });
    }
    $('#mk-card').hidden = false;
    table($('#tb-mk'), [
      { k: 'g', label: 'Nhóm', l: true, c: (r) => (r.g === 'Tránh' ? 'dn' : r.g === 'Không dùng' ? 'muted' : r.g === 'Cắt lên' ? 'warn' : r.g ? 'up' : '') },
      { k: 'name', label: 'Tín hiệu', l: true },
      { k: 'now', label: 'Hôm nay', l: true, f: (r) => (r.on ? el('b', { text: r.now }) : r.now), c: (r) => (r.on && r.g !== 'Không dùng' ? (r.g === 'Tránh' ? 'dn' : 'up') : 'muted') },
      { k: 'cnt', label: 'Số lần', f: (r) => r.cnt || `${n0(r.n)} phiên` },
      { k: 'f63', label: 'QQQ 3 tháng sau', f: (r) => spct(r.f63), c: (r) => cls(r.f63) },
      { k: 'win', label: '% lần tăng (3 tháng)', f: (r) => pct(r.win, 0) },
      { k: 'bad', label: '% lần giảm sâu > 10%', f: (r) => pct(r.bad, 0), c: (r) => (r.bad >= 30 ? 'dn' : r.bad <= 12 ? 'up' : '') },
      { k: 'f126', label: '6 tháng sau', f: (r) => spct(r.f126), c: (r) => cls(r.f126) },
    ], rows, { sort: null });
    const L = S.q25long || {};
    $('#mk-src').textContent = `Đo trên ${fdate(R[i0].d)} – ${fdate(R[n - 1].d)} (${L.src || ''}). Mẫu nhỏ (mỗi tín hiệu 8–30 lần) và chủ yếu là thị trường tăng, chỉ có một thị trường giá xuống lớn (2022); các con số tự cập nhật mỗi ngày. Không phải lời khuyên đầu tư.`;
  }

  function drawHistChart(key) {
    const box = $('#ch-' + key);
    if (!box || box.closest('.tab').hidden) return;
    if (live[key]) { live[key].remove(); delete live[key]; }
    const days = ranges[key] ?? 126;
    const rows = days > 0 ? S.history.slice(-days) : S.history;
    const c = baseChart(box);
    CHARTS[key](c, rows);
    c.timeScale().fitContent();
    live[key] = c;
  }
  function rangeButtons() {
    $$('.range').forEach((r) => {
      const key = r.dataset.chart;
      ranges[key] = ranges[key] ?? 126;
      r.replaceChildren(...[[63, '3T'], [126, '6T'], [252, '1N'], [0, 'Tất cả']].concat(key === 'q25f' && ((S.q25long || {}).rows || []).length ? [[-1, 'Từ 2020']] : []).map(([d, t]) =>
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
  const WEAK_SETUPS = ['Inside day', '2 inside day', 'Lấy lại EMA 9', 'EMA crossback', 'EP'];
  // Luật đứng ngoài chung của các huyền thoại: QQQ ở xu hướng "Xấu" (dưới các EMA đang dốc xuống).
  // Kiểm chứng thật: gộp thêm cảnh báo đỏ / thời điểm Bất lợi / giai đoạn dòng tiền thì chặn tới 86% số phiên và bỏ lỡ 16% đầu nhịp tăng 4/2026,
  // trong khi chỉ dùng xu hướng QQQ chặn 26% số phiên — đúng những lúc lệnh breakout của Minervini, O'Neil, Stockbee lỗ.
  const mktBad = () => (S.latest || {}).qqq_regime === 'Xấu';
  const APLUS_SETUPS = ['Nền chặt', 'VCP', 'EMA hội tụ', 'Lấy lại AVWAP'];
  const aplusMiss = (s, cfg) => {
    const m = [];
    if (mktBad()) m.push('QQQ Xấu');
    if (!s.setups.some((t) => APLUS_SETUPS.includes(t))) m.push('setup');
    if (!(s.rs >= 90)) m.push('RS');
    if (!s.tt || s.stage !== 2) m.push('xu hướng');
    if (!(isNum(s.dd) && s.dd >= -15)) m.push('xa đỉnh');
    if (!(s.stop_pct <= cfg.max_stop_pct)) m.push('stop');
    const ed = earnDays(s); if (ed !== null && ed <= 7) m.push('BCTC');
    if (!(s.close > 0 && (s.entry / s.close - 1) * 100 <= 3)) m.push('xa giá mua');
    if ((isNum(s.eps_yoy) || isNum(s.rev_yoy)) && !((s.eps_yoy ?? -1e9) >= 20 || (s.rev_yoy ?? -1e9) >= 20)) m.push('tăng trưởng');
    return m;
  };
  const tags = (r) => {
    const f = document.createDocumentFragment();
    const ed = earnDays(r);
    if (ed !== null && ed <= 14) f.append(el('span', { class: 'tag ' + (ed <= 5 ? 'bad' : 'warn'), text: `BCTC sau ${ed} ngày`, title: `Báo cáo kết quả kinh doanh ngày ${fdate(r.earn)}. Minervini và O'Neil tránh mở vị thế mới ngay trước ngày này.` }));
    if (isNum(r.ipo)) f.append(el('span', { class: 'tag ipo', text: `IPO ${Math.max(1, Math.round(r.ipo / 21))} tháng`, title: 'Mới niêm yết dưới 1 năm. Nhiều siêu cổ chạy mạnh nhất trong năm đầu sau IPO.' }));
    if (S.stocks.length && !r._nob) f.append(badges(r.t));
    for (const v of r.vsa || []) f.append(el('span', { class: 'tag vsa', text: 'VSA: ' + v }));
    if (r.leader) f.append(el('span', { class: 'tag ld', text: 'Top 100' }));
    if (r.tt) f.append(el('span', { class: 'tag tt', text: 'Trend Template' }));
    for (const t of r.setups || []) f.append(WEAK_SETUPS.includes(t) ? el('span', { class: 'tag weak', text: t, title: 'Kiểm chứng thật trên dữ liệu của trang: setup này cho kết quả lỗ. Không coi là điểm mua.' }) : el('span', { class: 'tag', text: t }));
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
      verdict(); marketSignals();
      $('#score').textContent = L.score;
      $('#stance').textContent = L.stance;
      $('#score-delta').textContent = delta(L.score, L.score5, ' điểm');
      $('#scale-dot').style.left = Math.max(0, Math.min(100, L.score)) + '%';
      const gc = $('#gauge-card'); gc.style.borderColor = css(L.score >= 70 ? '--good' : L.score >= 50 ? '--line' : L.score >= 30 ? '--warn' : '--bad');
      $('#stance').className = 'stance ' + (L.score >= 70 ? 'up' : L.score >= 50 ? '' : L.score >= 30 ? 'wa' : 'dn');
      const adv = {
        'Tấn công': 'Thị trường thuận lợi. Giải ngân 75–100%, tìm điểm mua ở mã top 100 trong tab "Mã hôm nay".',
        'Bình thường': 'Giải ngân 50–75%. Chỉ vào các setup rõ ràng nhất, giữ rủi ro mỗi lệnh bình thường.',
        'Thận trọng': 'Tối đa khoảng 25% vốn, giảm rủi ro mỗi lệnh một nửa, không mua đuổi.',
        'Phòng thủ': 'Đứng ngoài, giữ tiền mặt. Chờ nhóm dẫn đầu và độ rộng phục hồi rồi mới mua lại.',
      };
      $('#advice').textContent = adv[L.stance] || '';
      const GG = (S.flow || {}).golden;
      if (GG && GG.level) $('#advice').textContent = `Điểm này đo độ khỏe chung của chỉ số và độ rộng. Quyết định tỷ trọng theo "Kết luận hôm nay" ở trên (mức ${GG.level}, ${GG.count}/6 bằng chứng), vì kết luận xét thêm breakout có giữ được không, ngành dẫn và ngày phân phối.`;
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
      drawHistChart('qqq'); drawSmi();
    },
    basket() {
      const B = S.latest.basket;
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
      const by = Object.fromEntries(S.stocks.map((x) => [x.t, x]));
      const chips = (box, list) => box.replaceChildren(...(list.length ? list.map((t) => el('button', { class: 'chip', type: 'button', onclick: () => openChart(t) }, t, el('small', { text: by[t] ? by[t].theme : '' }))) : [el('span', { class: 'empty', text: 'Không có.' })]));
      chips($('#new-leaders'), S.latest.new_leaders);
      chips($('#lost-leaders'), S.latest.lost_leaders);
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
        { k: 'setups', label: 'Ghi chú', l: true, f: (r) => { const f = tags(r); if (r.rslead) f.append(el('span', { class: 'tag ld', text: 'RS dẫn trước giá' })); else if (r.rsnh) f.append(el('span', { class: 'tag', text: 'RS đỉnh mới' })); return f; }, sv: (r) => (r.setups || []).length },
      ], S.basket, { sort: 'rs_pos', dir: 1, onRow: (r) => openChart(r.t) });
    },
    breadth() {
      const L = S.latest, T = $('#br-tiles'); T.replaceChildren();
      icTable();
      const h = S.history, last = h[h.length - 1] || {};
      if (isNum(L.up4)) $('#sbn-note').textContent = `Hôm nay: ${L.up4} mã tăng ≥ 4% và ${L.dn4} mã giảm ≥ 4% kèm khối lượng. Tỷ lệ 10 ngày: ${isNum(last.ratio10) ? n2(last.ratio10) : '—'} (trên 1 là bên mua mạnh hơn). Biểu đồ mô tả lực mua hiện tại, không dự báo được tháng sau.`;
      tile(T, 'Tăng / giảm ≥ 4% hôm nay', `${L.up4} / ${L.dn4}`, 'kèm khối lượng tăng');
      tile(T, 'Tỷ lệ Stockbee 5 ngày', n2(L.ratio5), '', L.ratio5 >= 1 ? 'up' : 'dn');
      tile(T, 'Tỷ lệ Stockbee 10 ngày', n2(L.ratio10), '', L.ratio10 >= 1 ? 'up' : 'dn');
      tile(T, 'Mã trên SMA 40', pct(L.pct_s40, 0), L.pct_s40 < 20 ? 'quá bán' : L.pct_s40 > 70 ? 'hưng phấn' : '', L.pct_s40 < 20 ? 'up' : L.pct_s40 > 70 ? 'wa' : '');
      tile(T, 'Mã trên SMA 200', pct(L.pct_s200, 0), 'xu hướng dài hạn');
      tile(T, 'Tăng / giảm ≥ 25% trong quý', `${L.q_up25} / ${L.q_dn25}`, '');
      ['sb', 'pct', 'nhnl'].forEach(drawHistChart); drawLong();
    },
    leaders() {
      { const F = S.flow || {};
      table($('#tb-fl-sec'), [
        { k: 'ind', label: 'Ngành', l: true, f: (r) => { const f = document.createDocumentFragment(); f.append(r.ind); if (r.label) f.append(' ', el('span', { class: 'tag ' + (r.label === 'Suy yếu' ? 'bad' : r.label === 'Mới nổi' ? 'warn' : 'ld'), text: r.label })); return f; } },
        { k: 'rank', label: 'Hạng', f: (r) => n0(r.rank), sv: (r) => -r.rank },
        { k: 'd21', label: 'Hạng 1 tháng trước', f: (r) => (isNum(r.rank21) ? `${n0(r.rank21)} (${r.rank21 - r.rank > 0 ? '+' : ''}${n0(r.rank21 - r.rank)})` : '—'), c: (r) => cls((r.rank21 || r.rank) - r.rank), sv: (r) => (r.rank21 || r.rank) - r.rank },
        { k: 'rel21', label: 'Hơn SPY 1 tháng', f: (r) => spct(r.rel21), c: (r) => cls(r.rel21) },
        { k: 'rs80', label: 'Mã RS ≥ 80', f: (r) => `${n0(r.rs80)} (${r.broad > 0 ? '+' : ''}${n0(r.broad)})`, c: (r) => cls(r.broad), title: 'Số mã RS ≥ 80 và thay đổi so với 10 phiên trước: tiền đang lan sang nhiều mã hơn?' },
        { k: 'nearhi', label: 'Gần đỉnh 52T', f: (r) => `${n0(r.nearhi)}/${n0(r.n)}` },
        { k: 'bo10', label: 'Breakout 10 phiên', f: (r) => n0(r.bo10) },
        { k: 'bo_hold', label: 'Giữ pivot', f: (r) => (isNum(r.bo_hold) ? `${pct(r.bo_hold, 0)} · ${r.bo_seen}` : '—'), sv: (r) => r.bo_hold },
        { k: 'score', label: 'Điểm luân chuyển', f: (r) => n1(r.score) },
      ], F.sectors || [], { sort: 'score' });
      }
      const G = S.groups || { rows: [] }, GR = G.rows || [];
      const GL = { 'Dẫn dắt': 'ld', 'Mới nổi': 'warn', 'Suy yếu': 'bad', 'Tụt hậu': 'bad' };
      const EVK = ['price', 'rsl', 'breadth', 'persist', 'accum', 'bases', 'fund'];
      const lead = GR.filter((r) => r.label === 'Dẫn dắt'), emer = GR.filter((r) => r.label === 'Mới nổi'), weak = GR.filter((r) => r.label === 'Suy yếu');
      const V1 = (G.validation || {})['1 tháng'] || {}, V3 = (G.validation || {})['3 tháng'] || {};
      const works = isNum(V3.spread) && V3.spread > 0 && isNum(V3.ic) && V3.ic > 0.05;
      $('#gr-notes').replaceChildren(...[
        GR.length ? el('li', { text: lead.length ? `Ngành dẫn dắt (điểm ≥ 70 và giữ top ≥ 50% thời gian 40 phiên): ${lead.slice(0, 6).map((r) => `${r.ind} (${r.score_all ?? r.score})`).join(', ')}.` : 'Chưa có ngành nào đủ tiêu chuẩn dẫn dắt (điểm cao và giữ được nhiều tuần).' }) : el('li', { text: 'Chưa có dữ liệu ngành. Sau lần chạy tới sẽ có.' }),
        emer.length ? el('li', { text: `Mới nổi (điểm tăng ≥ 15 trong 1 tháng): ${emer.slice(0, 6).map((r) => `${r.ind} (${r.score21} → ${r.score})`).join(', ')}. Đây thường là nơi xuất hiện cổ phiếu dẫn dắt của nhịp tăng tiếp theo.` }) : null,
        weak.length ? el('li', { class: 'dn', text: `Suy yếu (từng dẫn dắt, điểm giảm ≥ 15): ${weak.slice(0, 6).map((r) => `${r.ind} (${r.score21} → ${r.score})`).join(', ')}. Cân nhắc chốt lời, siết stop ở các mã thuộc nhóm này.` }) : null,
        isNum(V3.spread) ? el('li', { text: `Kiểm chứng: ngành nhóm điểm cao nhất trước đây tăng hơn nhóm thấp nhất ${spct(V3.spread)} sau 3 tháng (${spct(V1.spread)} sau 1 tháng), tương quan thứ hạng ${n2(V3.ic)}. ${works ? 'Điểm số có giá trị dự báo, có thể dùng để chọn ngành.' : 'Lợi thế chưa rõ ràng: chỉ nên dùng điểm này để tham khảo, kết hợp với các bằng chứng khác.'}` }) : null,
      ].filter(Boolean));
      const drawG = () => {
        const lab = $('#gr-lab').value, q = $('#gr-q').value.trim().toLowerCase();
        const mn = $('#gr-min').checked;
        const rows = GR.filter((r) => (!lab || r.label === lab) && (!q || r.ind.toLowerCase().includes(q)) && (!mn || (r.n || 0) >= 5));
        $('#gr-count').textContent = `${rows.length}/${GR.length} ngành`;
        table($('#tb-gr'), [
          { k: 'ind', label: 'Ngành', l: true, f: (r) => { const f = document.createDocumentFragment(); f.append(r.ind); if (r.label) f.append(' ', el('span', { class: 'tag ' + (GL[r.label] || ''), text: r.label })); return f; } },
          { k: 'n', label: 'Số mã', f: (r) => n0(r.n), c: (r) => ((r.n || 0) < 5 ? 'muted' : ''), title: 'Số cổ phiếu đủ thanh khoản trong ngành. Dưới 5 mã thì các tỷ lệ % kém tin cậy.' },
          { k: 'score_all', label: 'Điểm', title: 'Điểm 0–100 gộp 7 bằng chứng. Mô tả ngành đang mạnh; kiểm chứng thật chưa cho thấy dự báo được ngành tăng hơn SPY tháng sau.', f: (r) => el('b', { class: (r.score_all ?? r.score) >= 70 ? 'up' : (r.score_all ?? r.score) < 30 ? 'dn' : '', text: n0(r.score_all ?? r.score) }), sv: (r) => r.score_all ?? r.score },
          { k: 'd21', label: '1 tháng trước', f: (r) => (isNum(r.score21) ? `${n0(r.score21)} (${r.score - r.score21 > 0 ? '+' : ''}${n0(r.score - r.score21)})` : '—'), c: (r) => cls(r.score - (r.score21 ?? r.score)), sv: (r) => r.score - (r.score21 ?? r.score) },
          { k: 'ev', label: 'Bằng chứng', f: (r) => el('span', { class: 'gr-dots', title: EVK.map((k) => `${G.labels[k]}: ${r.ev[k] ?? '—'}`).join('\n') + (r.miss && r.miss.length ? '\nCòn thiếu: ' + r.miss.join(', ') : '') },
            ...EVK.map((k) => { const v = r.ev[k]; return el('i', { style: isNum(v) ? `background:color-mix(in srgb,var(--good) ${Math.round(v)}%,var(--line))` : '' }); })), sv: (r) => (r.have || []).length },
          { k: 'rsl21', label: 'RS ngành 1 tháng', f: (r) => spct(r.rsl21) + (r.rsl_hi ? ' ★' : ''), c: (r) => cls(r.rsl21), title: 'Thay đổi đường RS của ngành so với SPY trong 1 tháng. ★: đường RS đang ở đỉnh 1 năm' },
          { k: 'above50', label: 'Trên MA50', f: (r) => pct(r.above50, 0) },
          { k: 'nearhi', label: 'Gần đỉnh 52T', f: (r) => pct(r.nearhi, 0), title: '% mã cách đỉnh 52 tuần dưới 10%' },
          { k: 'persist', label: 'Độ bền', f: (r) => pct(r.persist, 0), title: '% thời gian 40 phiên qua ngành nằm trong 30% nhóm đầu' },
          { k: 'accum', label: 'KL lên/xuống', f: (r) => n2(r.accum), c: (r) => (r.accum >= 1.2 ? 'up' : r.accum < 0.9 ? 'dn' : '') },
          { k: 'bases', label: 'Mã có nền', f: (r) => pct(r.bases, 0), title: '% mã sát đỉnh 20 phiên với biên độ co hẹp' },
          { k: 'm63', label: '3 tháng (TV)', f: (r) => spct(r.m63), c: (r) => cls(r.m63), title: 'Trung vị lợi nhuận 3 tháng các mã' },
          { k: 'eps', label: 'EPS / DT quý', f: (r) => (isNum(r.eps) || isNum(r.rev) ? `${spct(r.eps)} / ${spct(r.rev)}` : '—'), sv: (r) => r.eps, title: 'Tăng trưởng EPS / doanh thu quý trung vị (mã có số liệu)' },
          { k: 'best', label: 'Mã mạnh nhất', l: true, f: (r) => { const f = document.createDocumentFragment(); r.best.forEach((t) => f.append(el('button', { class: 'chip sm', type: 'button', text: t, onclick: () => openChart(t) }))); return f; }, sv: (r) => r.best.length },
        ], rows, { sort: 'score_all', onRow: (r) => { grOn.add(r.ind); drawChips(); drawGr(); $('#ch-gr').scrollIntoView({ behavior: 'smooth', block: 'center' }); }, limit: 200, empty: 'Không có ngành nào.' });
      };
      $('#gr-lab').addEventListener('input', drawG); $('#gr-q').addEventListener('input', drawG); $('#gr-min').addEventListener('input', drawG);
      drawG();
      if (!grOn.size) GR.slice(0, 4).forEach((r) => grOn.add(r.ind));
      const COLS = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--good', '--bad', '--warn'];
      const colOf = (g) => COLS[[...grOn].indexOf(g) % COLS.length];
      const drawChips = () => $('#gr-chips').replaceChildren(...[...grOn].map((g) => el('button', { type: 'button', class: 'btchip', 'aria-pressed': 'true', style: `border-color:var(${colOf(g)})`, onclick: () => { grOn.delete(g); drawChips(); drawGr(); } }, el('i', { class: 'gr-sw', style: `background:var(${colOf(g)})` }), ' ' + g + ' ×')));
      const drawGr = () => {
        const box = $('#ch-gr'); if (live.gr) { live.gr.remove(); delete live.gr; }
        const Sx = G.series; if (!Sx || box.closest('.tab').hidden) return;
        const c = baseChart(box); live.gr = c;
        const src = grView === 'rsl' ? Sx.rsl : Sx.score;
        for (const g of grOn) { const v = (src || {})[g]; if (!v) continue;
          c.addLineSeries({ color: css(colOf(g)), lineWidth: 2, priceLineVisible: false, title: g.length > 18 ? g.slice(0, 17) + '…' : g }).setData(Sx.d.map((d, i) => ({ time: d, value: v[i] })).filter((x) => isNum(x.value))); }
        const z = c.addLineSeries({ color: 'transparent', priceLineVisible: false, lastValueVisible: false }); z.setData([{ time: Sx.d[0], value: grView === 'rsl' ? 100 : 50 }]);
        z.createPriceLine({ price: grView === 'rsl' ? 100 : 50, color: css('--muted'), lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
        c.timeScale().fitContent();
      };
      const vr = $('#gr-v-rsl'), vs = $('#gr-v-sc');
      vr.addEventListener('click', () => { grView = 'rsl'; vr.setAttribute('aria-pressed', 'true'); vs.setAttribute('aria-pressed', 'false'); drawGr(); });
      vs.addEventListener('click', () => { grView = 'score'; vs.setAttribute('aria-pressed', 'true'); vr.setAttribute('aria-pressed', 'false'); drawGr(); });
      drawChips(); drawGr();
      $('#gr-val-note').textContent = isNum(V1.n) && V1.n ? `Mỗi 5 phiên từ ${fdate(G.from)}, chia các ngành thành 5 nhóm theo điểm rồi đo lợi nhuận của ngành so với SPY sau 1 và 3 tháng (chỉ dùng 6 bằng chứng có lịch sử; số liệu cơ bản chỉ có hôm nay). Nhóm "Cao nhất" phải tốt hơn rõ rệt nhóm "Thấp nhất". Tương quan thứ hạng > 0,05 là có giá trị dự báo; "ngoài mẫu" là 1/3 thời gian sau cùng.` : 'Chưa đủ lịch sử để kiểm chứng.';
      const vt = (V, tb, lab) => table($(tb), [{ k: 'q', label: `Nhóm điểm (${lab})`, l: true }, { k: 'fwd', label: 'Hơn SPY sau đó (TB)', f: (r) => spct(r.fwd), c: (r) => cls(r.fwd) }],
        [...(V.quint || []).slice().reverse(), { q: `Tương quan thứ hạng: ${n2(V.ic)} (ngoài mẫu ${n2(V.ic_oos)})`, fwd: null }, { q: `Nhóm cao nhất thắng SPY: ${pct(V.hit, 0)} số lần (ngoài mẫu ${pct(V.hit_oos, 0)})`, fwd: null }], {});
      vt(V1, '#tb-gr-val', '1 tháng'); vt(V3, '#tb-gr-val2', '3 tháng');
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
      const AN = S.latest.anchors || {};
      if (isNum(S.latest.ind_cov) && S.latest.ind_cov < S.latest.ind_total) $('#gr-notes').append(el('li', { class: 'wa', text: `Mới phân loại được ngành cho ${n0(S.latest.ind_cov)}/${n0(S.latest.ind_total)} mã (ưu tiên mã thanh khoản lớn). Mỗi lần chạy Massive lấy thêm khoảng 400 mã, nên bảng ngành sẽ đầy đủ dần sau vài ngày. Mã chưa phân loại không được tính vào xếp hạng ngành.` }));
      $('#ind-anchor').textContent = (AN.pk || AN.tr) ? `Đỉnh và đáy gần nhất của QQQ (sóng từ 7%): ${AN.pk ? `đỉnh ${fdate(AN.pk.d)}, QQQ từ đó ${spct(AN.pk.qqq)}` : ''}${AN.pk && AN.tr ? '; ' : ''}${AN.tr ? `đáy ${fdate(AN.tr.d)}, QQQ từ đó ${spct(AN.tr.qqq)}` : ''}. Ngành giảm ít hơn QQQ từ đỉnh là ngành giữ giá khi thị trường điều chỉnh; ngành tăng nhiều hơn QQQ từ đáy là ngành dẫn dắt nhịp hồi — đây thường là nơi xuất hiện cổ phiếu dẫn dắt mới (O'Neil, Minervini).` : '';
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
          { k: 'r126', label: '6 tháng', f: (r) => spct(r.r126), c: (r) => cls(r.r126) },
          { k: 'up21', label: '% mã tăng', f: (r) => pct(r.up21, 0), title: '% mã trong ngành có lãi sau 1 tháng' },
          { k: 'r_pk', label: `Từ đỉnh QQQ${AN.pk ? ' ' + fdate(AN.pk.d).slice(0, 5) : ''}`, f: (r) => spct(r.r_pk), c: (r) => cls(r.r_pk), title: AN.pk ? `Lợi nhuận TB từ đỉnh gần nhất của QQQ (${fdate(AN.pk.d)}); QQQ cùng giai đoạn ${spct(AN.pk.qqq)}` : '' },
          { k: 'r_tr', label: `Từ đáy QQQ${AN.tr ? ' ' + fdate(AN.tr.d).slice(0, 5) : ''}`, f: (r) => spct(r.r_tr), c: (r) => cls(r.r_tr), title: AN.tr ? `Lợi nhuận TB từ đáy gần nhất của QQQ (${fdate(AN.tr.d)}); QQQ cùng giai đoạn ${spct(AN.tr.qqq)}` : '' },
          { k: 'top', label: 'Top 100' },
          { k: 'best', label: 'Mã mạnh nhất', l: true, f: (r) => { const f = document.createDocumentFragment(); r.best.forEach((t) => f.append(el('button', { class: 'chip sm', type: 'button', text: t, onclick: () => openChart(t) }))); return f; }, sv: (r) => r.best.length },
        ], rows, { sort: 'rank', dir: 1, limit: 250 });
      };
      $('#q-ind').addEventListener('input', drawInd);
      drawInd();
    },
    setups() {
      const cfg = Object.assign({}, S.latest.config, store.get('nk_cfg', {}));
      const inputs = { cap: ['#in-cap', 'capital'], risk: ['#in-risk', 'risk_pct'], ms: ['#in-maxstop', 'max_stop_pct'], mp: ['#in-maxpos', 'max_pos_pct'] };
      for (const [, [sel, k]] of Object.entries(inputs)) { $(sel).value = cfg[k]; $(sel).addEventListener('input', () => { cfg[k] = Number($(sel).value) || cfg[k]; store.set('nk_cfg', cfg); drawSetups(); }); }
      const all = [...new Set(S.setups.flatMap((s) => s.setups))].sort();
      $('#sel-setup').append(...all.map((t) => el('option', { value: t, text: t })));
      ['#sel-setup', '#only-ok', '#only-lead', '#only-proven', '#show-bad', '#only-aplus'].forEach((s) => $(s).addEventListener('input', drawSetups));
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
        }).filter((s) => (!f || s.setups.includes(f)) && (!ok || s.ok) && (!ld || s.leader) && (!$('#only-proven').checked || s.setups.some((t) => !WEAK_SETUPS.includes(t))));
        const bad = mktBad(), showBad = $('#show-bad').checked;
        $('#bad-wrap').hidden = !bad;
        const ap = $('#only-aplus').checked;
        const allA = S.setups.map((s) => ({ s, m: aplusMiss(s, cfg) }));
        const nA = allA.filter((x) => !x.m.filter((k) => k !== 'QQQ Xấu').length).length;
        const cnt = {}; allA.forEach((x) => x.m.forEach((k) => (cnt[k] = (cnt[k] || 0) + 1)));
        $('#aplus-why').textContent = `Hôm nay ${nA} mã đạt đủ tiêu chí cổ phiếu (2–9)${bad ? ', nhưng QQQ đang Xấu nên không mua' : ''}. Số mã bị loại theo từng tiêu chí: ` + Object.entries(cnt).filter(([k]) => k !== 'QQQ Xấu').sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(' · ') + '.';
        if (ap) { const keep = new Set(allA.filter((x) => !x.m.filter((k) => k !== 'QQQ Xấu').length).map((x) => x.s.t)); for (let i = rows.length - 1; i >= 0; i--) if (!keep.has(rows[i].t)) rows.splice(i, 1); rows.sort((x, y) => (y.rs - x.rs) || ((x.rs_pos || 1e9) - (y.rs_pos || 1e9))); rows.splice(5); }
        if (bad && !showBad) rows.length = 0;
        $('#setup-count').textContent = bad ? (showBad ? `${rows.length} mã · CHỈ ĐỂ THEO DÕI, thị trường xấu` : `Thị trường xấu: không mở lệnh mới (quy tắc phòng thủ). Bật ô bên cạnh để xem danh sách theo dõi.`) : `${rows.length} mã`;
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
      // các cách xem khác trong cùng tab: theo lợi thế setup (tab Hiệu quả setup), theo mẫu hình, lọc & tìm mã
      if (!built.has('lab')) { built.add('lab'); try { BUILD.lab(); } catch (e) { console.error(e); } }
      try { BUILD.patterns(); } catch (e) { console.error(e); }
      Screener.init();
      setMv(store.get('nk_mv', 'buy'));
      $('#extended').replaceChildren(...(S.extended.length ? S.extended.map((s) => el('button', { class: 'chip', type: 'button', onclick: () => openChart(s.t) }, s.t, el('small', { text: `+${n1(s.d9)}% so với EMA 9` }))) : [el('span', { class: 'empty', text: 'Không có mã top 100 nào quá xa EMA 9.' })]));
    },
    patterns() {
      if (patDone) return; patDone = true;
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
      try { BUILD.basket(); } catch (e) { console.error(e); }
      ['tspd', 'turn'].forEach(drawHistChart);
      const LT = (S.longbt || {}).top || {};
      const tcols = [
        { k: 'name', label: 'Điều kiện hôm đó', l: true },
        { k: 'days', label: 'Số phiên', f: (r) => n0(r.days) },
        { k: 'top21', label: 'Top 100 1 tháng sau', f: (r) => spct(r.top21), c: (r) => cls(r.top21) },
        { k: 'win', label: '% lần tăng', f: (r) => pct(r.win, 0) },
        { k: 'dd8', label: '% lần giảm sâu > 8%', f: (r) => pct(r.dd8, 0), c: (r) => (r.dd8 >= 45 ? 'dn' : '') },
        { k: 'q21', label: 'QQQ 1 tháng sau', f: (r) => spct(r.q21), c: (r) => cls(r.q21) },
      ];
      const emp = 'Chưa có: kết quả kiểm chứng dài hạn sẽ có sau lần chạy tới (tính lại mỗi tháng).';
      table($('#tb-cy-long'), tcols, LT.phase || [], { sort: null, empty: emp });
      table($('#tb-tspd'), tcols, LT.speed || [], { sort: null, empty: emp });
      table($('#tb-turn'), tcols, LT.turnover || [], { sort: null, empty: emp });
      const LB = S.longbt || {};
      $('#cy-long-note').textContent = LB.from ? `Đo trên ${fdate(LB.from)} – ${fdate(LB.to)} (${LB.src}). ${LB.note || ''}` : '';
    },
    flow() {
      const F = S.flow;
      if (!F || !F.stage) { $('#fl-stage').replaceChildren(el('p', { class: 'empty', text: 'Chưa có dữ liệu dòng tiền. Sau lần chạy tới sẽ có.' })); return; }
      const sc = F.scores || {}, s10 = F.scores10 || {};
      $('#fl-stage').replaceChildren(
        el('div', { class: 'fl-st', style: `--ph:var(${STC[F.stage] || '--muted'})` },
          el('span', { class: 'muted small', text: 'Giai đoạn dòng tiền hiện tại' }), el('b', { class: 'fl-stn', text: F.stage }),
          el('span', { class: 'small muted', text: `${F.stage_days} phiên liên tiếp` }), el('p', { text: F.stage_desc })),
        el('div', { class: 'fl-sc' }, ...[['breadth', 'Độ rộng', 'Sức mạnh có lan rộng không?'], ['accum', 'Tích lũy', 'Phiên tăng có khối lượng xác nhận không?'], ['lead', 'Dẫn dắt', 'Cổ phiếu mạnh mới có xuất hiện không?'], ['ft', 'Follow-through', 'Điểm mua gần đây có giữ được không?']].map(([k, lb, q]) => {
          const v = sc[k], d = isNum(v) && isNum(s10[k]) ? v - s10[k] : null;
          return el('div', { class: 'fl-sci' }, el('span', { class: 'lb', text: lb }), el('b', { class: v >= 60 ? 'up' : v < 40 ? 'dn' : 'wa', text: n0(v) }),
            el('span', { class: 'small ' + cls(d), text: isNum(d) ? `${d > 0 ? '+' : ''}${n0(d)} so với 10 phiên trước` : '' }), el('span', { class: 'small muted', text: q }));
        })));
      $('#fl-warn').replaceChildren(...(F.warnings || []).map((t) => el('div', { class: 'banner warn', text: t })));
      const groups = {};
      (F.evidence || []).forEach((e) => (groups[e.pillar] = groups[e.pillar] || []).push(e));
      const miss = (F.evidence || []).filter((e) => !e.ok);
      $('#fl-miss').textContent = miss.length ? `Còn thiếu ${miss.length}/${F.evidence.length} bằng chứng: ${miss.map((e) => e.label).join('; ')}.` : 'Đủ cả 16 bằng chứng.';
      $('#fl-ev').replaceChildren(...Object.entries(groups).map(([g, xs]) => el('div', { class: 'fl-evg' }, el('h4', { text: `${g} · ${xs.filter((x) => x.ok).length}/${xs.length}` }),
        el('ul', { class: 'fl-evl' }, ...xs.map((e) => el('li', { class: e.ok ? 'ok' : 'no' }, el('span', { class: 'fl-mk', text: e.ok ? '✓' : '✗' }),
          el('span', { class: 'fl-lb', text: e.label }), el('b', { text: (isNum(e.value) ? (e.unit === '%' ? n1(e.value) : n0(e.value)) : '—') + (e.unit || '') }), el('span', { class: 'muted small', text: 'cần ' + e.need })))))));
      drawGates();
      const R = F.radar || [];
      const selMin = $('#fl-min'), q = $('#fl-q');
      const drawRadar = () => {
        const mn = Number(selMin.value || 0), qs = q.value.trim().toUpperCase();
        const rows = R.filter((r) => r.score >= mn && (!qs || r.t.includes(qs) || (r.ind || '').toUpperCase().includes(qs)));
        $('#fl-count').textContent = `${rows.length} mã`;
        table($('#tb-fl-radar'), [
          { k: 't', label: 'Mã', tk: true },
          { k: 'ind', label: 'Ngành', l: true },
          { k: 'rs', label: 'RS', f: (r) => n0(r.rs) },
          { k: 'chg', label: 'Hôm nay', f: (r) => spct(r.chg), c: (r) => cls(r.chg) },
          { k: 'score', label: 'Bằng chứng', f: (r) => el('span', { class: 'fl-dots', title: r.ev.map((e) => `${e.ok ? '✓' : '✗'} ${e.label}: ${e.detail}`).join('\n') }, ...r.ev.map((e) => el('i', { class: e.ok ? 'on' : '' })), ` ${r.score}/${r.n}`) },
          { k: 'streak', label: 'RS ≥ 80 từ', f: (r) => (r.streak ? `${n0(r.streak)} phiên` : '—') },
          { k: 'missing', label: 'Còn thiếu', l: true, f: (r) => r.ev.filter((e) => !e.ok).map((e) => e.label).join(' · ') || '—', sv: (r) => r.n - r.score },
          { k: 'lab', label: 'Setup / cảnh báo', l: true, f: (r) => { const f = document.createDocumentFragment(); (r.lab || []).forEach((x) => f.append(el('span', { class: 'tag', text: x }))); if (r.news) f.append(el('span', { class: 'tag warn', text: 'Gap sự kiện', title: r.news })); return f; }, sv: (r) => (r.lab || []).length },
        ], rows, { sort: 'score', onRow: (r) => openChart(r.t), limit: 150, empty: 'Không có mã nào đạt.' });
      };
      selMin.addEventListener('input', drawRadar); q.addEventListener('input', drawRadar);
      drawRadar();
    },
    lab() {
      try { BUILD.patterns(); } catch (e) { console.error(e); }
      drawHistChart('pat'); drawLongSet();
      const B = S.lab;
      if (!B || !(B.setups || []).length) { $('#lb-notes').replaceChildren(el('li', { text: 'Chưa có dữ liệu. Sau lần chạy tới sẽ có.' })); return; }
      const MIN = B.min_n || 30, stNow = (S.flow || {}).stage;
      const rr = (x) => (isNum(x) ? (x > 0 ? '+' : '') + n2(x) + 'R' : '—');
      const good = B.setups.filter((s) => (s.by.stage[stNow] || {}).n >= MIN).sort((a, b) => b.by.stage[stNow].exp - a.by.stage[stNow].exp);
      const oosBad = B.setups.filter((s) => (s.ins.n || 0) >= MIN && (s.oos.n || 0) >= MIN && s.ins.exp > 0.1 && s.oos.exp <= 0);
      $('#lb-notes').replaceChildren(...[
        el('li', { text: `Kiểm chứng ${n0(B.n_closed)} lệnh từ ${fdate(B.from)} tới ${fdate(B.to)}. Trong mẫu: trước ${fdate(B.cut)}; ngoài mẫu: từ ${fdate(B.cut)}. Mỗi lệnh đã trừ trượt giá ${n1(B.slip)}% mỗi lần khớp.` }),
        stNow ? el('li', { text: good.length ? `Trong giai đoạn "${stNow}", setup có kỳ vọng tốt nhất: ${good.slice(0, 3).map((s) => `${s.name} ${rr(s.by.stage[stNow].exp)}, thắng ${pct(s.by.stage[stNow].win, 0)} (${s.by.stage[stNow].n} lệnh)`).join('; ')}.` : `Chưa có setup nào đủ ${MIN} lệnh trong giai đoạn "${stNow}" để kết luận.` }) : null,
        good.length ? el('li', { text: `Kém nhất trong giai đoạn này: ${good.slice(-2).reverse().map((s) => `${s.name} ${rr(s.by.stage[stNow].exp)}`).join('; ')}.` }) : null,
        oosBad.length ? el('li', { class: 'dn', text: `Cảnh báo: ${oosBad.map((s) => s.name).join(', ')} có lãi trong mẫu nhưng mất lợi thế ở dữ liệu ngoài mẫu.` }) : null,
        el('li', { text: 'Bảng chỉ dùng thông tin có tại thời điểm vào lệnh. Riêng cột khối lượng phiên mua chỉ biết khi phiên đó kết thúc.' })].filter(Boolean));
      const st = { dim: 'stage', m: 'exp' };
      const selDim = $('#lb-dim'), selM = $('#lb-m'), selSet = $('#lb-set');
      selDim.replaceChildren(...B.dims.map((d) => el('option', { value: d.key, text: d.label })));
      const nowB = (key) => (key === 'stage' ? stNow : null);
      const val = (c) => (c && c.n ? (st.m === 'exp' ? c.exp : st.m === 'win' ? c.win : st.m === 'p2r' ? c.p2r : c.fail3) : null);
      const colr = (c) => {
        const v = val(c); if (!isNum(v)) return null;
        const [lo, hi, inv] = st.m === 'exp' ? [-0.4, 0.4, false] : st.m === 'win' ? [30, 55, false] : st.m === 'p2r' ? [10, 35, false] : [30, 70, true];
        let t = Math.max(-1, Math.min(1, (v - (lo + hi) / 2) / ((hi - lo) / 2))); if (inv) t = -t;
        return `background:color-mix(in srgb,var(${t >= 0 ? '--good' : '--bad'}) ${Math.round(Math.abs(t) * 42)}%,transparent)`;
      };
      const ctext = (c) => {
        if (!c || !c.n) return el('span', { class: 'muted', text: '—' });
        const main = st.m === 'exp' ? rr(c.exp) : st.m === 'win' ? pct(c.win, 0) : st.m === 'p2r' ? pct(c.p2r, 0) : pct(c.fail3, 0);
        const sub = st.m === 'win' && isNum(c.lo) ? ` [${c.lo}–${c.hi}]` : '';
        return el('span', {}, el('b', { text: main }), el('small', { class: 'cd-n', text: sub + ' ' + n0(c.n) }));
      };
      const cell = (c, extra) => el('td', { class: [c && c.n && c.n < MIN ? 'cd-low' : '', extra || ''].join(' ').trim() || null, style: colr(c),
        title: c && c.n ? `${c.n} lệnh / ${c.days} phiên khác nhau · thắng ${c.win}% (95%: ${c.lo}–${c.hi}%) · E ${rr(c.exp)} · đạt +2R ${c.p2r}% · thất bại 3 phiên ${c.fail3}%` : null }, ctext(c));
      const drawM = () => {
        const D = B.dims.find((d) => d.key === st.dim) || B.dims[0], nb = nowB(D.key);
        const head = el('tr', {}, el('th', { class: 'l', text: 'Setup' }), el('th', { text: 'Tất cả' }), el('th', { text: 'Trong mẫu' }), el('th', { class: 'cd-like', text: 'Ngoài mẫu' }), el('th', { text: '80 phiên gần nhất' }),
          ...D.buckets.map((b) => el('th', { class: b === nb ? 'cd-today' : null, text: (b === nb ? '★ ' : '') + b })));
        const sg = st.m === 'fail3' ? -1 : 1; const rows = B.setups.slice().sort((a, b) => ((val(b.all) ?? -99 * sg) - (val(a.all) ?? -99 * sg)) * sg);
        $('#tb-lb').replaceChildren(el('thead', {}, head), el('tbody', {}, ...rows.map((s) => el('tr', { class: 'click', onclick: () => { selSet.value = s.name; drawDetail(); $('#lb-detail').scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
          el('td', { class: 'l' }, s.name, s.edge === true ? el('small', { class: 'up', text: ' ✓ có lợi thế' }) : s.edge === false ? el('small', { class: 'muted', text: ' · chưa có lợi thế, không đưa vào kế hoạch' }) : null), cell(s.all), cell(s.ins), cell(s.oos, 'cd-like'), cell(s.recent), ...D.buckets.map((b) => cell((s.by[D.key] || {})[b], b === nb ? 'cd-today' : ''))))));
      };
      selSet.replaceChildren(...B.setups.map((s) => el('option', { value: s.name, text: s.name })));
      const drawDetail = () => {
        const s = B.setups.find((x) => x.name === selSet.value) || B.setups[0];
        $('#lb-rule').textContent = s.rule;
        const rows = [['Số giao dịch hợp lệ', 'n', (v) => n0(v)], ['Số phiên khác nhau có tín hiệu', 'days', (v) => n0(v)], ['Tỷ lệ thắng sau chi phí', 'win', (v, c) => (isNum(v) ? `${pct(v, 0)} (95%: ${c.lo}–${c.hi}%)` : '—')],
          ['Lợi nhuận kỳ vọng mỗi lệnh', 'exp', rr], ['Lãi trung bình khi thắng', 'avg_w', rr], ['Lỗ trung bình khi thua', 'avg_l', rr], ['Hệ số lợi nhuận', 'pf', (v) => n2(v)],
          ['Đạt +1R trước khi chạm stop', 'p1r', (v) => pct(v, 0)], ['Đạt +2R trước khi chạm stop', 'p2r', (v) => pct(v, 0)], ['Đạt +3R trước khi chạm stop', 'p3r', (v) => pct(v, 0)],
          ['Thất bại trong 3 phiên đầu', 'fail3', (v) => pct(v, 0)], ['Lãi tối đa trong lệnh (MFE, trung vị)', 'mfe', rr], ['Lỗ tối đa trong lệnh (MAE, trung vị)', 'mae', rr],
          ['Sụt giảm lớn nhất (cộng dồn R)', 'mdd', (v) => (isNum(v) ? n1(v) + 'R' : '—')], ['Số phiên giữ TB', 'hold', (v) => n1(v)]];
        $('#tb-lb-det').replaceChildren(el('thead', {}, el('tr', {}, el('th', { class: 'l', text: 'Chỉ số' }), el('th', { text: 'Tất cả' }), el('th', { text: 'Trong mẫu' }), el('th', { text: 'Ngoài mẫu' }))),
          el('tbody', {}, ...rows.map(([lb, k, f]) => el('tr', {}, el('td', { class: 'l', text: lb }), ...[s.all, s.ins, s.oos].map((c) => el('td', { text: c && c.n ? f(c[k], c) : '—' }))))));
        $('#lb-det-title').textContent = `${s.name}: thống kê đầy đủ`;
        const box = $('#lb-dims');
        box.replaceChildren(...B.dims.map((d) => el('div', { class: 'cd-row' }, el('div', { class: 'cd-rl', text: d.label }),
          el('div', { class: 'cd-cells' }, ...d.buckets.map((b) => { const c = (s.by[d.key] || {})[b], nb = nowB(d.key);
            return el('div', { class: ['cd-cell', b === nb ? 'cd-today' : '', c && c.n && c.n < MIN ? 'cd-low' : ''].join(' ').trim(), style: colr(c) }, el('span', { class: 'small muted', text: (b === nb ? '★ ' : '') + b }), ctext(c)); })))));
        if (live.lbcurve) { live.lbcurve.remove(); delete live.lbcurve; }
        const cb = $('#ch-lb'); if (!cb.closest('.tab').hidden && (s.curve || []).length) {
          const c = baseChart(cb); live.lbcurve = c;
          const ln = c.addLineSeries({ color: css('--accent'), lineWidth: 2, priceLineVisible: false, title: 'Cộng dồn R' });
          ln.setData(s.curve.map(([d, v]) => ({ time: d, value: v })));
          ln.createPriceLine({ price: 0, color: css('--muted'), lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
          c.timeScale().fitContent();
        }
      };
      selDim.addEventListener('input', () => { st.dim = selDim.value; drawM(); });
      selM.addEventListener('input', () => { st.m = selM.value; drawM(); drawDetail(); });
      selSet.addEventListener('input', drawDetail);
      drawM(); drawDetail();
      // ---- chốt lãi thế nào
      const X = S.exits || {};
      $('#ex-notes').replaceChildren(...(X.notes || ['Chưa có dữ liệu. Sau lần chạy tới sẽ có.']).map((t) => el('li', { text: t })));
      table($('#tb-ex'), [
        { k: 'name', label: 'Cách bán', l: true, f: (r) => el('span', { title: r.desc, text: r.name }) },
        { k: 'exp', label: 'Kỳ vọng', f: (r) => rr(r.exp), c: (r) => cls(r.exp) },
        { k: 'win', label: '% thắng', f: (r) => pct(r.win, 0) },
        { k: 'avg_w', label: 'Lãi TB khi thắng', f: (r) => rr(r.avg_w), c: () => 'up' },
        { k: 'avg_l', label: 'Lỗ TB khi thua', f: (r) => rr(r.avg_l), c: () => 'dn' },
        { k: 'best', label: 'Lệnh tốt nhất', f: (r) => rr(r.best) },
        { k: 'kept', label: 'Giữ lại khi có siêu cổ', f: (r) => pct(r.kept, 0), title: 'Với lệnh từng lãi ≥ 3R: giữ lại được bao nhiêu % mức lãi cao nhất' },
        { k: 'top10', label: 'Top 10% tạo ra', f: (r) => pct(r.top10, 0) },
        { k: 'hold', label: 'Giữ TB', f: (r) => `${n0(r.hold)} phiên` },
        { k: 'total', label: 'Tổng R', f: (r) => n0(r.total), c: (r) => cls(r.total) },
        { k: 'st', label: 'Khi Uptrend xác nhận', f: (r) => { const c = (r.by_stage || {})['Uptrend xác nhận']; return c ? `${rr(c.exp)} · ${c.n}` : '—'; }, sv: (r) => ((r.by_stage || {})['Uptrend xác nhận'] || {}).exp ?? -9 },
        { k: 'st2', label: 'Khi Phân phối', f: (r) => { const c = (r.by_stage || {})['Phân phối / suy yếu']; return c ? `${rr(c.exp)} · ${c.n}` : '—'; }, sv: (r) => ((r.by_stage || {})['Phân phối / suy yếu'] || {}).exp ?? -9 },
      ], X.exits || [], { sort: 'exp', empty: 'Chưa có dữ liệu.' });
      const SY = X.system || {};
      $('#sys-desc').textContent = SY.desc ? `${SY.desc} Ngoài mẫu tính từ ${fdate(SY.cut)}.` : 'Chưa có dữ liệu. Sau lần chạy tới sẽ có.';
      table($('#tb-sys'), [
        { k: 'label', label: 'Tập điểm mua', l: true, f: (r) => (r.cmp ? '↳ ' : '') + r.label },
        { k: 'n', label: 'Số lệnh', f: (r) => n0(r.n), c: (r) => (r.n < 30 ? 'muted' : '') },
        { k: 'win', label: '% thắng', f: (r) => pct(r.win, 0) },
        { k: 'exp', label: 'Kỳ vọng', f: (r) => rr(r.exp), c: (r) => cls(r.exp) },
        { k: 'avg_w', label: 'Lãi TB', f: (r) => rr(r.avg_w), c: () => 'up' },
        { k: 'avg_l', label: 'Lỗ TB', f: (r) => rr(r.avg_l), c: () => 'dn' },
        { k: 'mdd', label: 'Sụt giảm lớn nhất', f: (r) => (isNum(r.mdd) ? n1(r.mdd) + 'R' : '—'), c: () => 'dn' },
        { k: 'acct', label: 'Tài khoản (0,5%/lệnh)', f: (r) => spct(r.acct), c: (r) => cls(r.acct) },
        { k: 'oos_exp', label: 'Ngoài mẫu', f: (r) => (isNum(r.oos_exp) ? `${rr(r.oos_exp)} · ${n0(r.oos_n)}` : '—'), c: (r) => cls(r.oos_exp) },
      ], [...(SY.rows || []), ...(SY.compare || []).map((r) => Object.assign({ cmp: true }, r))], { empty: 'Chưa có dữ liệu.' });
      const XT = X.trend || {};
      const bar = (v) => el('span', { class: 'ex-bar' }, el("i", { style: `width:${Math.round(Math.min(100, v || 0) * 1.2)}px` }), ` ${pct(v, 0)}`);
      table($('#tb-ex-dur'), [
        { k: 'label', label: `Giữ được trên MA 50 bao lâu (trung vị ${n0(XT.med50)} phiên)`, l: true },
        { k: 'pct', label: '% số mã', l: true, f: (r) => bar(r.pct) },
        { k: 'p21', label: 'Trên EMA 21', l: true, f: (r) => bar(r.p21) },
      ], (XT.d50 || []).map((r, i) => Object.assign({}, r, { p21: ((XT.d21 || [])[i] || {}).pct })), {});
      table($('#tb-ex-gain'), [
        { k: 'label', label: 'Lãi lớn nhất trước khi thủng MA 50', l: true },
        { k: 'pct', label: '% số mã', l: true, f: (r) => bar(r.pct) },
      ], [...(XT.gain || []), ...(XT.reach || [])], {});
      // ---- tín hiệu hôm nay: 3 câu hỏi
      const P = B.plans || [];
      const onlyOk = $('#lb-ok');
      const drawPlans = () => {
        const bad = mktBad();
        const rows = bad ? [] : P.filter((p) => !onlyOk.checked || p.ok_stop);
        table($('#tb-lb-plan'), [
          { k: 't', label: 'Mã', tk: true },
          { k: 'setup', label: 'Setup', l: true, f: (r) => r.setup + (r.sig !== S.latest.asof ? ` (tín hiệu ${fdate(r.sig)})` : '') },
          { k: 'q1', label: '1. Lợi thế lịch sử (giai đoạn hiện tại)', f: (r) => { const c = r.hist.stage || {}; return c.n ? el('span', { class: c.n < MIN ? 'cd-low' : cls(c.exp) }, `${rr(c.exp)} · thắng ${pct(c.win, 0)} · ${n0(c.n)}`) : 'Chưa có mẫu'; }, sv: (r) => ((r.hist.stage || {}).n >= MIN ? r.hist.stage.exp : -9) },
          { k: 'ev', label: '2. Bằng chứng dòng tiền', f: (r) => el('span', { title: 'Có: ' + r.have.join('; ') + '\nThiếu: ' + r.missing.join('; ') }, `${r.ev ?? '—'}/${r.ev_n ?? 9}`, r.news ? el('span', { class: 'tag warn', text: 'Gap sự kiện', title: r.news }) : '') },
          { k: 'pivot', label: '3. Điểm mua', f: (r) => (r.kind === 'close' ? `Đã bứt phá @ ${n2(r.close)}` : `Vượt ${n2(r.pivot)} (cách ${pct(r.dist)})`) },
          { k: 'stop', label: 'Sai khi thủng', f: (r) => `${n2(r.stop)} (−${n1(r.stop_pct)}%)`, c: (r) => (r.ok_stop ? '' : 'dn'), sv: (r) => r.stop_pct },
          { k: 'shares', label: 'Số cổ', f: (r) => n0(r.shares) },
          { k: 't2r', label: 'Mục tiêu +2R', f: (r) => n2(r.t2r) },
        ], rows, { onRow: (r) => openChart(r.t), empty: bad ? 'Thị trường xấu: theo quy tắc phòng thủ, không mở lệnh mới. Chờ giai đoạn dòng tiền chuyển sang Hồi phục / Uptrend.' : 'Không có setup nào có lợi thế đã kiểm chứng hôm nay.' });
      };
      onlyOk.addEventListener('input', drawPlans);
      drawPlans();
    },
    cond() {
      const C = S.cond, items = C.items || [], dims = C.dims || [], MIN = C.min_n || 20;
      $('#cd-notes').replaceChildren(...(C.notes || ['Chưa có dữ liệu. Sau lần chạy tới sẽ có.']).map((t) => el('li', { text: t })));
      $('#cd-range').textContent = C.from ? `Giai đoạn thống kê: ${fdate(C.from)} – ${fdate(C.to)}. Ô mờ: dưới ${MIN} tín hiệu, chưa đủ tin cậy.` : '';
      $('#cd-now').replaceChildren(...dims.filter((d) => d.now).map((d) => el('div', { class: 'cd-nowi' }, el('span', { class: 'muted small', text: d.label }), el('b', { text: d.now }))));
      if (!items.length) return;
      const st = { group: 'Mẫu hình', dim: (dims[0] || {}).key, h: '5', m: 'win' };
      const selDim = $('#cd-dim'), selH = $('#cd-h'), selM = $('#cd-m'), selItem = $('#cd-item');
      selDim.replaceChildren(...dims.map((d) => el('option', { value: d.key, text: d.label })));
      const groups = ['Mẫu hình', 'VSA', 'Phong cách'].filter((g) => items.some((i) => i.group === g));
      const segG = $('#cd-group');
      const color = (c, m, metric) => {
        if (!c || !c.n) return '';
        let v, lo, hi;
        if (metric === 'r') { v = m === 'win' ? c.win : c.exp; [lo, hi] = m === 'win' ? [20, 50] : [-0.5, 0.5]; }
        else { v = m === 'win' ? c.win : c.avg; [lo, hi] = m === 'win' ? [40, 65] : [-2, 3]; }
        if (!isNum(v)) return '';
        const mid = (lo + hi) / 2, t = Math.max(-1, Math.min(1, (v - mid) / ((hi - lo) / 2)));
        const col = t >= 0 ? 'var(--good)' : 'var(--bad)';
        return `background:color-mix(in srgb,${col} ${Math.round(Math.abs(t) * 42)}%,transparent)`;
      };
      const cellTxt = (c, metric) => {
        if (!c || !c.n) return el('span', { class: 'muted', text: '—' });
        const main = metric === 'r' ? `${c.exp > 0 ? '+' : ''}${n2(c.exp)}R · ${pct(c.win, 0)}` : `${pct(c.win, 0)} · ${spct(c.avg)}`;
        return el('span', {}, el('b', { text: main }), el('small', { class: 'cd-n', text: ` ${n0(c.n)}` }));
      };
      const getRes = (it) => (it.metric === 'r' ? it.h.trade : it.h[st.h]) || {};
      const sortKey = (it, c) => (c && c.n >= MIN ? (it.metric === 'r' ? (st.m === 'win' ? c.win : c.exp) : (st.m === 'win' ? c.win : c.avg)) : -1e9);
      const draw = () => {
        const isR = st.group === 'Phong cách';
        selH.disabled = isR;
        selM.replaceChildren(...(isR ? [['win', 'Sắp xếp: % thắng'], ['avg', 'Sắp xếp: kỳ vọng R']] : [['win', 'Sắp xếp: % có lãi'], ['avg', 'Sắp xếp: lãi trung bình']]).map(([v, t]) => el('option', { value: v, text: t })));
        selM.value = st.m;
        const D = dims.find((d) => d.key === st.dim) || dims[0];
        const rows = items.filter((i) => i.group === st.group);
        const tbl = $('#tb-cd');
        const head = el('tr', {}, el('th', { class: 'l', text: isR ? 'Phong cách' : 'Mẫu hình' }), el('th', { text: 'Mọi phiên' }), el('th', { class: 'cd-like', text: 'Giống hôm nay', title: (C.like.desc || []).join('; ') }),
          ...D.buckets.map((b) => el('th', { class: b === D.now ? 'cd-today' : null, text: (b === D.now ? '★ ' : '') + b, title: `${n0(D.days[b])} phiên` })));
        const nowB = D.now;
        rows.sort((a, b) => sortKey(b, (getRes(b)[st.dim] || {})[nowB] || getRes(b).like) - sortKey(a, (getRes(a)[st.dim] || {})[nowB] || getRes(a).like));
        const body = el('tbody', {}, ...rows.map((it) => {
          const R = getRes(it), m = it.metric;
          const td = (c, extra) => el('td', { class: [c && c.n && c.n < MIN ? 'cd-low' : '', extra || ''].join(' ').trim() || null, style: color(c, st.m, m) || null, title: c && c.n ? `${n0(c.n)} ${m === 'r' ? 'lệnh' : 'tín hiệu'}` + (isNum(c.stop) ? `, ${c.stop}% chạm đáy ngày tín hiệu trong 5 phiên` : '') : null }, cellTxt(c, m));
          const name = el('td', { class: 'l' });
          if (m === 'r' && LBY[it.id]) name.append(badge(it.id), ' ');
          name.append(it.name);
          return el('tr', { class: 'click', onclick: () => { selItem.value = it.id; drawItem(); $('#cd-item-card').scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
            name, td(R.all), td(R.like, 'cd-like'), ...D.buckets.map((b) => td((R[st.dim] || {})[b], b === nowB ? 'cd-today' : '')));
        }));
        tbl.replaceChildren(el('thead', {}, head), body);
        $('#cd-legend').textContent = isR
          ? 'Mỗi ô: kỳ vọng (R trung bình mỗi lệnh) · % lệnh thắng, số nhỏ là số lệnh. Lệnh theo quy tắc ở tab Kiểm chứng, gắn vào điều kiện thị trường của ngày vào lệnh.'
          : `Mỗi ô: % tín hiệu có lãi sau ${st.h} phiên · lãi trung bình, số nhỏ là số tín hiệu. Tính từ giá đóng cửa ngày tín hiệu, gom theo điều kiện thị trường của ngày đó.`;
        selItem.replaceChildren(...items.filter((i) => i.group === st.group).map((i) => el('option', { value: i.id, text: i.name })));
        drawItem();
      };
      const drawItem = () => {
        const it = items.find((i) => i.id === selItem.value) || items.find((i) => i.group === st.group);
        if (!it) return;
        const R = getRes(it), m = it.metric, box = $('#cd-item-box');
        box.replaceChildren(...dims.map((d) => el('div', { class: 'cd-row' }, el('div', { class: 'cd-rl', text: d.label }),
          el('div', { class: 'cd-cells' }, ...d.buckets.map((b) => { const c = (R[d.key] || {})[b];
            return el('div', { class: ['cd-cell', b === d.now ? 'cd-today' : '', c && c.n && c.n < MIN ? 'cd-low' : ''].join(' ').trim(), style: color(c, st.m, m) || null },
              el('span', { class: 'small muted', text: (b === d.now ? '★ ' : '') + b }), cellTxt(c, m)); })))));
        $('#cd-item-title').textContent = `${it.name}: hiệu quả theo từng tiêu chí` + (m === 'r' ? '' : ` (sau ${st.h} phiên)`);
      };
      segG.replaceChildren(...groups.map((g) => { const b = el('button', { type: 'button', 'aria-pressed': String(g === st.group), text: g === 'Phong cách' ? 'Phong cách huyền thoại' : g === 'VSA' ? 'Tín hiệu VSA' : 'Mẫu hình' });
        b.addEventListener('click', () => { st.group = g; st.m = 'win'; segG.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); draw(); }); return b; }));
      selDim.addEventListener('input', () => { st.dim = selDim.value; draw(); });
      selH.addEventListener('input', () => { st.h = selH.value; draw(); });
      selM.addEventListener('input', () => { st.m = selM.value; draw(); });
      selItem.addEventListener('input', drawItem);
      draw();
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
      const sel = $('#pp-sel');
      sel.replaceChildren(...LEGENDS.filter((L) => A[L.id]).map((L) => el('option', { value: L.id, text: L.name })));
      const fillTxt = (fs) => (fs || []).map((x) => (x.sh ? `${x.why}: ${n0(x.sh)} cổ @ ${n2(x.px)} (${fdate(x.d)})` : `${x.why} (${fdate(x.d)})`)).join(' · ');
      $('#pp-common').replaceChildren(...(P.common || []).map((t) => el('li', { text: t })));
      const bootMark = (r) => (r.boot ? '↺ ' : '');
      const drawAcc = () => {
        const a = A[sel.value] || { open: [], pending: [], closed: [] };
        $('#pp-rules').replaceChildren(...(a.rules || ['Bản dữ liệu cũ chưa có mô tả quy tắc.']).map((t) => el('li', { text: t })));
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
      drawLongLeg();
      try { BUILD.paper(); } catch (e) { console.error(e); }
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
        { k: 'nd', label: 'Nếu KHÔNG phòng thủ', f: (r) => (r.nodef && r.nodef.n ? `${rr(r.nodef.exp)} · tổng ${isNum(r.nodef.total) ? (r.nodef.total > 0 ? '+' : '') + n0(r.nodef.total) : '—'}R · ${r.nodef.n}` : '—'), c: (r) => rc(r.nodef && r.nodef.exp), sv: (r) => (r.nodef && r.nodef.exp) ?? -9, title: 'Cùng quy tắc mua bán nhưng bỏ quy tắc phòng thủ (không đứng ngoài khi thị trường xấu): kỳ vọng · tổng R · số lệnh' },
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
      { k: 'r_pk', label: 'Từ đỉnh QQQ', f: (r) => spct(r.r_pk), c: (r) => cls(r.r_pk), title: 'Thay đổi từ đỉnh gần nhất của QQQ' + ((S.latest.anchors || {}).pk ? ` (${fdate(S.latest.anchors.pk.d)}, QQQ ${spct(S.latest.anchors.pk.qqq)})` : '') },
      { k: 'r_tr', label: 'Từ đáy QQQ', f: (r) => spct(r.r_tr), c: (r) => cls(r.r_tr), title: 'Thay đổi từ đáy gần nhất của QQQ' + ((S.latest.anchors || {}).tr ? ` (${fdate(S.latest.anchors.tr.d)}, QQQ ${spct(S.latest.anchors.tr.qqq)})` : '') },
      { k: 'adr', label: 'Biên độ ngày', f: (r) => pct(r.adr), title: 'Biên độ dao động trung bình 20 phiên' },
      { k: 'dv', label: 'GTGD (tr $)', f: (r) => n0(r.dv), title: 'Giá trị giao dịch trung bình 20 phiên, triệu USD' },
      { k: 'd9', label: 'So EMA 9', f: (r) => spct(r.d9), c: (r) => (r.d9 > 15 ? 'wa' : cls(r.d9)) },
      { k: 'd21', label: 'So EMA 21', f: (r) => spct(r.d21), c: (r) => cls(r.d21) },
    ];
    if (full) c.push({ k: 'offhigh', label: 'Cách đỉnh 52T', f: (r) => spct(r.offhigh) }, { k: 'gap921', label: 'EMA 9–21', f: (r) => pct(r.gap921) });
    c.push({ k: 'setups', label: 'Ghi chú', l: true, f: (r) => { const f = tags(r); if (r.rslead) f.append(el('span', { class: 'tag ld', text: 'RS dẫn trước giá' })); else if (r.rsnh) f.append(el('span', { class: 'tag', text: 'RS đỉnh mới' })); return f; }, sv: (r) => (r.setups || []).length + (r.leader ? 10 : 0) });
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
        { id: 'base', label: 'Đang tích lũy 2–8 tuần sát đỉnh vùng tích lũy (sâu ≤ 25%), 5 phiên co hẹp, không quá 15% trên EMA 21; hoặc vừa có EP', test: (s) => (s.qb && s.tight5 && isNum(s.d21) && s.d21 <= 15) || anyOf(s.setups, ['EP']) || anyOf(s.sig, ['Gap tăng mạnh (EP)']) },
      ],
      plan: (s) => { const buy = s.h * 1.001; const stop = Math.max(s.l * 0.999, buy * (1 - (s.adr || 5) / 100));
        return { buy, stop, how: 'Mua khi giá vượt đỉnh phiên (opening range high). Stop ở đáy phiên, không rộng hơn 1 lần biên độ ngày.',
          sell: `Bán 1/3 đến 1/2 sau 3–5 phiên. Phần còn lại giữ tới khi đóng cửa dưới EMA 10 (≈ ${n2(s.e9v)}), vị thế lớn thì theo EMA 20 (${n2(s.e21v)}).` }; } },
    { id: 'mm', short: 'MM', name: 'Mark Minervini', color: '--c3', style: 'SEPA: xu hướng chuẩn (Trend Template), nền co hẹp VCP, lợi nhuận tăng tốc.',
      conds: [
        { id: 'tt', label: 'Đạt đủ 8 điều kiện Trend Template', test: (s) => s.tt },
        { id: 'rs', label: 'Điểm RS ít nhất', unit: '', v: 80, step: 5, test: t_rs },
        { id: 'near', label: 'Cách đỉnh 1 năm không quá', unit: '%', v: 25, step: 5, test: t_dd },
        { id: 'vcp', label: 'Có VCP thật: nền ≥ 3 tuần, sâu ≤ 35%, 10 phiên cuối biên độ ≤ 10% và hẹp hơn trước, khối lượng cạn', test: (s) => !!s.vcp },
        { id: 'pivot', label: 'Giá nằm trong 5% dưới pivot của nền (chưa chạy xa khỏi nền)', test: (s) => isNum(s.bpiv) && s.close >= 0.95 * s.bpiv && s.close <= s.bpiv * 1.001 },
        { id: 'eps', label: 'EPS quý tăng so với cùng kỳ ít nhất', unit: '%', v: 25, step: 5, test: t_eps },
        { id: 'accel', label: 'Doanh thu hoặc EPS đang tăng tốc', on: false, test: (s) => s.rev_accel || s.eps_accel },
        { id: 'noearn', label: 'Không có báo cáo kết quả trong', unit: 'ngày tới', v: 7, step: 1, test: t_noearn },
      ],
      plan: (s) => { const buy = (s.bpiv || s.piv) * 1.001; const stop = Math.max(buy * 0.92, s.lo10 * 0.999);
        return { buy, stop, how: 'Mua khi giá vượt pivot của nền VCP với khối lượng ≥ 1,4× trung bình. Không mua nếu đã cao hơn pivot 5%. Stop dưới đáy lần co hẹp cuối (10 phiên), tối đa 8%.',
          sell: 'Bán dần vào sức mạnh khi lãi 20–25%. Khi lãi gấp 2–3 lần rủi ro, dời stop về hòa vốn.' }; } },
    { id: 'wo', short: 'WO', name: "William O'Neil", color: '--c4', style: 'CAN SLIM: lợi nhuận tăng mạnh, sản phẩm mới, cung cầu, dẫn đầu ngành, thị trường thuận lợi.',
      conds: [
        { id: 'c', label: 'C · EPS quý tăng so với cùng kỳ ít nhất', unit: '%', v: 25, step: 5, test: t_eps },
        { id: 'a', label: 'A · EPS năm tăng liên tiếp ít nhất', unit: 'năm', v: 2, step: 1, test: (s, v) => isNum(s.eps_a_up) && s.eps_a_up >= v },
        { id: 'sales', label: 'Doanh thu quý tăng so với cùng kỳ ít nhất', unit: '%', v: 20, step: 5, test: t_rev },
        { id: 'n', label: 'N · Cách đỉnh mới không quá', unit: '%', v: 15, step: 5, test: t_dd },
        { id: 'base', label: 'Có nền đúng nghĩa (≥ 5 tuần, sâu ≤ 33%) và giá trong 5% dưới pivot', test: (s) => s.bw >= 25 && isNum(s.bdep) && s.bdep <= 33 && isNum(s.bpiv) && s.close >= 0.95 * s.bpiv },
        { id: 's', label: 'S · Khối lượng phiên tăng gấp phiên giảm ít nhất', unit: 'lần (50 phiên)', v: 1.1, step: 0.1, test: (s, v) => isNum(s.udv) && s.udv >= v },
        { id: 'l', label: 'L · Điểm RS ít nhất', unit: '', v: 80, step: 5, test: t_rs },
        { id: 'grp', label: 'Ngành nằm trong top', unit: '% ngành mạnh nhất', v: 20, step: 5, test: (s, v) => isNum(s.ind_rank) && s.ind_rank <= Math.max(1, Math.round((mkt().n_ind || 1) * v / 100)) },
        { id: 'm', label: 'M · Thị trường không tạo đáy mới, QQQ dưới 6 ngày phân phối', market: true, test: () => !(mkt().ftd_status || '').includes('đáy mới') && (mkt().dd_qqq || 0) <= 5 },
      ],
      plan: (s) => { const buy = (s.bpiv || s.piv) * 1.001; const stop = buy * 0.93;
        return { buy, stop, how: `Mua tại pivot (đỉnh nền), không mua cao hơn pivot 5% (${n2(buy * 1.05)}). Khối lượng phiên vượt nên gấp 1,5 lần trung bình.`,
          sell: 'Cắt lỗ cứng 7–8%. Chốt phần lớn khi lãi 20–25%; nếu tăng 20% trong 3 tuần đầu thì giữ ít nhất 8 tuần.' }; } },
    { id: 'sw', short: 'SW', name: 'Stan Weinstein', color: '--c5', style: 'Chỉ mua cổ phiếu ở giai đoạn 2: giá trên đường 30 tuần đang dốc lên.',
      conds: [
        { id: 'st', label: 'Đang ở giai đoạn 2', test: (s) => s.stage === 2 },
        { id: 'rs', label: 'Điểm RS ít nhất (mạnh hơn thị trường)', unit: '', v: 70, step: 5, test: t_rs },
        { id: 'grp', label: 'Ngành nằm ở nửa trên bảng xếp hạng', test: (s) => isNum(s.ind_rank) && s.ind_rank <= (mkt().n_ind || 0) / 2 },
        { id: 'vol', label: 'Khối lượng phiên tăng nhiều hơn phiên giảm', test: (s) => isNum(s.udv) && s.udv >= 1 },
        { id: 'near', label: 'Cách đỉnh 1 năm không quá', unit: '%', v: 15, step: 5, on: false, test: t_dd },
        { id: 'x150', label: 'Chưa quá xa đường 30 tuần: cao hơn không quá', unit: '%', v: 25, step: 5, test: (s, v) => isNum(s.x150) && s.x150 <= v },
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
    { id: 'me', short: 'TÔI', name: 'Bộ lọc của bạn', color: '--ink', style: 'Điều kiện riêng của bạn: mã mạnh nhất, ngành mạnh nhất, doanh thu và lợi nhuận tăng đều.',
      conds: [
        { id: 'top', label: 'Thuộc top', unit: 'mã mạnh nhất', v: 100, step: 10, test: t_rspos },
        { id: 'ind', label: 'Ngành nằm trong top', unit: 'ngành', v: 5, step: 1, test: t_indtop },
        { id: 'rev', label: 'Doanh thu quý tăng so với cùng kỳ ít nhất', unit: '%', v: 20, step: 5, test: t_rev },
        { id: 'eps', label: 'EPS quý tăng so với cùng kỳ ít nhất', unit: '% (lỗ sang lãi tính là đạt)', v: 25, step: 5, test: t_eps },
        { id: 'revup', label: 'Doanh thu tăng liên tiếp ít nhất', unit: 'quý', v: 3, step: 1, on: false, test: (s, v) => isNum(s.rev_up) && s.rev_up >= v },
        { id: 'st2', label: 'Đang ở giai đoạn 2', on: false, test: (s) => s.stage === 2 },
        { id: 'rsnh', label: 'Đường RS lập đỉnh mới', on: false, test: (s) => s.rsnh },
        { id: 'rslead', label: 'RS dẫn trước giá (đường RS lập đỉnh trong 5 phiên, giá chưa lập đỉnh)', on: false, test: (s) => !!s.rslead },
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
    function extraOk(s) {
      const q = $('#q').value.trim().toLowerCase(), th = $('#sel-theme').value, tt = $('#f-tt').checked, rn = $('#f-rsnh').value, rmin = Number($('#f-rsmin').value || 0);
      const rsOk = !rn || (rn === 'now' ? s.rsnh : rn === '5' ? (s.rsnh5 ?? s.rsnh) : !!s.rslead);
      return (!q || (s.t + ' ' + s.theme + ' ' + (s.ind || '') + ' ' + (s.name || '')).toLowerCase().includes(q)) && (!th || s.theme === th) && (!tt || s.tt) && rsOk && (s.rs || 0) >= rmin;
    }
    function run() {
      const sel = LEGENDS.filter((L) => LG.sel[L.id]);
      const all = $('#scr-all').checked;
      const rows = [];
      for (const s of S.stocks) {
        if (!extraOk(s)) continue;
        if (all) { rows.push(Object.assign({}, s, { _n: matchesOf(s.t).length, _near: false })); continue; }
        const ev = sel.map((L) => ({ L, e: evalLegend(s, L) }));
        const pass = ev.filter((x) => x.e.pass);
        const near = ev.filter((x) => !x.e.pass && x.e.n - x.e.ok === 1);
        const okRow = LG.mode === 'all' ? pass.length === sel.length && sel.length > 0 : pass.length > 0;
        const nearRow = LG.near && !okRow && (LG.mode === 'all' ? pass.length + near.length === sel.length && near.length === 1 : near.length > 0);
        if (okRow || nearRow) rows.push(Object.assign({}, s, { _n: pass.length, _near: !okRow, _nearTxt: near.map((x) => `${x.L.short} thiếu: ${x.e.miss[0]}`).join(' · ') }));
      }
      last = rows;
      const full = rows.filter((r) => !r._near).length;
      $('#scr-count').textContent = (all ? `${rows.length} / ${S.stocks.length} mã (tìm trong mọi mã)` : `${full} mã đạt` + (LG.near ? ` · ${rows.length - full} mã thiếu 1 điều kiện` : ''));
      $('#scr-note').textContent = `Số liệu doanh thu/EPS có cho ${n0(S.latest.fund_n)} mã (khoảng 400 mã mạnh nhất và các mã có setup), cập nhật hằng tuần; mã không có số liệu sẽ không đạt điều kiện tăng trưởng.` + (S.stocks.some((s) => isNum(s.mcap)) ? '' : ' Vốn hóa chỉ có khi dùng nguồn Massive.');
      table($('#tb-scr'), [
        { k: 't', label: 'Mã', tk: true },
        { k: '_n', label: 'Đạt tiêu chí', l: true, f: (r) => { const f = badges(r.t); if (r._near) f.append(el('span', { class: 'tag miss', text: r._nearTxt })); return f; }, sv: (r) => r._n * 10 - (r._near ? 5 : 0) },
        { k: 'rs', label: 'RS', f: (r) => n0(r.rs) },
        { k: 'rs_pos', label: 'Hạng RS', f: (r) => n0(r.rs_pos) },
        { k: 'ind_rank', label: 'Hạng ngành', f: (r) => (isNum(r.ind_rank) ? `${r.ind_rank}/${S.latest.n_ind}` : '—') },
        { k: 'stage', label: 'Giai đoạn', f: (r) => r.stage ?? '—' },
        { k: 'close', label: 'Giá', f: (r) => n2(r.close) },
        { k: 'chg', label: 'Phiên', f: (r) => spct(r.chg), c: (r) => cls(r.chg) },
        { k: 'r21', label: '1 tháng', f: (r) => spct(r.r21), c: (r) => cls(r.r21) },
        { k: 'r63', label: '3 tháng', f: (r) => spct(r.r63), c: (r) => cls(r.r63) },
        { k: 'dd', label: 'Cách đỉnh', f: (r) => spct(r.dd) },
        { k: 'rev_yoy', label: 'DT quý', f: (r) => spct(r.rev_yoy), c: (r) => cls(r.rev_yoy) },
        { k: 'eps_yoy', label: 'EPS quý', f: (r) => spct(r.eps_yoy), c: (r) => cls(r.eps_yoy) },
        { k: 'ind', label: 'Ngành', l: true, f: (r) => r.ind || r.theme },
        { k: 'setups', label: 'Setup, tín hiệu', l: true, f: (r) => { const f = document.createDocumentFragment(); if (r.tt) f.append(el('span', { class: 'tag tt', text: 'Trend Template' })); [...(r.setups || []), ...(r.sig || [])].forEach((t) => f.append(el('span', { class: 'tag' + (WEAK_SETUPS.includes(t) ? ' weak' : ''), text: t }))); if (r.rslead) f.append(el('span', { class: 'tag ld', text: 'RS dẫn trước giá' })); else if (r.rsnh) f.append(el('span', { class: 'tag', text: 'RS đỉnh mới' })); return f; }, sv: (r) => (r.setups || []).length + (r.sig || []).length },
      ], rows, { sort: '_n', limit: 300, rowClass: (r) => (r._near ? 'dim' : ''), onRow: (r) => openChart(r.t), empty: 'Không có mã nào đạt. Thử chọn thêm huyền thoại, tắt bớt điều kiện hoặc nới ngưỡng.' });
    }
    function init() {
      form(); counts();
      const seg = (m) => { LG.mode = m; $('#mode-any').setAttribute('aria-pressed', String(m === 'any')); $('#mode-all').setAttribute('aria-pressed', String(m === 'all')); save(); };
      $('#mode-any').addEventListener('click', () => seg('any')); $('#mode-all').addEventListener('click', () => seg('all'));
      $('#mode-any').setAttribute('aria-pressed', String(LG.mode === 'any')); $('#mode-all').setAttribute('aria-pressed', String(LG.mode === 'all'));
      const themes = [...new Set(S.stocks.map((s) => s.theme))].sort((a, b) => a.localeCompare(b, 'vi'));
      $('#sel-theme').append(...themes.map((t) => el('option', { value: t, text: t })));
      ['#q', '#sel-theme', '#f-tt', '#f-rsnh', '#f-rsmin', '#scr-all'].forEach((x) => $(x).addEventListener('input', run));
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
    if (!S.charts) { box.textContent = 'Đang tải biểu đồ…'; try { S.charts = await (await fetch(`data/charts.json?v=${encodeURIComponent(S.latest.generated || '')}`)).json(); } catch (e) { S.charts = {}; } }
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
      if (setup && setup.fills) cs.setMarkers(setup.fills.filter((f) => f.d && d.d.includes(f.d)).sort((x, y) => x.d.localeCompare(y.d)).map((f) => ({ time: f.d, position: f.k === 'S' ? 'aboveBar' : 'belowBar', shape: f.k === 'S' ? 'arrowDown' : 'arrowUp', color: css(f.k === 'S' ? '--bad' : '--good'), text: (f.k === 'S' ? 'Bán ' : 'Mua ') + n2(f.px) })));
      if (setup) {
        cs.createPriceLine({ price: setup.entry, color: css('--good'), lineWidth: 2, lineStyle: 0, title: 'Giá mua' });
        cs.createPriceLine({ price: setup.stop, color: css('--bad'), lineWidth: 2, lineStyle: 2, title: 'Stop' });
      }
      c.timeScale().fitContent();
    }
    const qa = threeQ(t);
    $('#m-plans').replaceChildren(...qa, el('h4', { text: 'Điểm mua và bán theo từng huyền thoại' }), planTable(Object.assign({}, s, setup && !s.t ? setup : {})),
      el('p', { class: 'note', text: `Số cổ tính theo vốn ${usd(acct().capital)}, rủi ro ${acct().risk_pct}% mỗi lệnh; stop màu đỏ là rộng hơn mức tối đa ${acct().max_stop_pct}%. Hàng mờ: mã chưa đạt đủ tiêu chí của huyền thoại đó.` }));
    $('#m-actions').replaceChildren(...[
      setup ? el('button', { class: 'btn', type: 'button', text: 'Ghi vào nhật ký', onclick: () => { closeModal(); prefillJournal(setup); } }) : null,
      el('a', { class: 'btn ghost', href: `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(t)}`, target: '_blank', rel: 'noopener', text: 'Mở trên TradingView' })].filter(Boolean));
    $('#m-close').focus();
  }
  function icTable() {
    const H = S.history, n = H.length; if (n < 260) { $('#ic-sum').textContent = 'Chưa đủ lịch sử để kiểm tra.'; return; }
    const q = H.map((r) => r.qqq), tb = H.map((r) => r.tb_hold5);
    const S0 = Math.max(215, H.findIndex((r) => isNum(r.pct_s200)) + 5);
    const rank = (a) => { const ix = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(a.length); ix.forEach(([, i], k) => (r[i] = k)); return r; };
    const ic = (x, y) => { const p = x.map((v, i) => [v, y[i]]).filter(([a, b]) => isNum(a) && isNum(b)); if (p.length < 40) return null; const rx = rank(p.map((z) => z[0])), ry = rank(p.map((z) => z[1])); const m = (rx.length - 1) / 2; let c = 0, vx = 0, vy = 0; rx.forEach((a, i) => { c += (a - m) * (ry[i] - m); vx += (a - m) ** 2; vy += (ry[i] - m) ** 2; }); return c / Math.sqrt(vx * vy); };
    const idx = []; for (let i = S0; i < n; i++) idx.push(i);
    const Y1 = idx.map((i) => (i + 21 < n && isNum(q[i]) && isNum(q[i + 21]) ? q[i + 21] / q[i] - 1 : null)), Y2 = idx.map((i) => { if (i + 21 >= n || !isNum(q[i])) return null; let m = 0; for (let j = i + 1; j <= i + 21; j++) if (isNum(q[j])) m = Math.min(m, q[j] / q[i] - 1); return m; }), Y3 = idx.map((i) => (i + 25 < n ? tb[i + 25] : null));
    const IND = [['Số mã đà mạnh', (r) => r.leaders], ['Mã tăng − giảm ≥ 25% (quý)', (r) => (isNum(r.q_up25) ? r.q_up25 - r.q_dn25 : null)], ['% mã trên EMA 21', (r) => r.pct_e21], ['% mã trên SMA 40', (r) => r.pct_s40], ['% mã trên SMA 200', (r) => r.pct_s200],
      ['Đỉnh mới − đáy mới 20 phiên', (r) => (isNum(r.nh20) ? r.nh20 - r.nl20 : null)], ['Đỉnh mới − đáy mới 52 tuần', (r) => (isNum(r.nh52) ? r.nh52 - r.nl52 : null)], ['Tỷ lệ Stockbee 10 ngày', (r) => r.ratio10], ['Chênh lệch bứt phá − sập 4% (10 ngày)', (r) => r.net4_10],
      ['Top 100 còn trên EMA 21', (r) => r.b_above21], ['Top 100 cách đỉnh < 10%', (r) => r.b_w10], ['Xu hướng lập đỉnh của top 100', (r) => r.b_nh20_ma], ['Breakout top 100 giữ giá 5 phiên', (r) => r.tb_hold5], ['Số phiên điều chỉnh của top 100 (đảo dấu)', (r) => (isNum(r.pb_days) ? -r.pb_days : null)],
      ['Ngày phân phối QQQ (đảo dấu)', (r) => (isNum(r.dd_qqq) ? -r.dd_qqq : null)], ['Điểm sức khỏe', (r) => r.score], ['Điểm Độ rộng', (r) => r.flow_breadth], ['Điểm Tích lũy', (r) => r.flow_accum], ['Điểm Dẫn dắt', (r) => r.flow_lead], ['Điểm Follow-through', (r) => r.flow_ft]];
    const rows = IND.map(([name, f]) => { const x = idx.map((i) => f(H[i])); const a = ic(x, Y1), b = ic(x, Y2), c = ic(x, Y3); const best = Math.max(...[a, b, c].filter(isNum).map(Math.abs));
      const tags = [];
      if ((c ?? 0) >= 0.2) tags.push('Báo trước breakout tốt');
      if ((b ?? 0) >= 0.2) tags.push('Báo trước ít rủi ro giảm sâu');
      if ((a ?? 0) <= -0.25 || (b ?? 0) <= -0.2 || (c ?? 0) <= -0.25) tags.push('Nhiệt kế độ nóng (cao = sau đó kém)');
      if ((a ?? 0) >= 0.25) tags.push('Báo trước QQQ tăng');
      const use = !isNum(best) ? '—' : tags.length ? tags.join(' · ') : 'Không có giá trị dự báo (chỉ mô tả hiện tại)';
      return { name, a, b, c, best, use }; });
    const f2 = (v) => (isNum(v) ? (v > 0 ? '+' : '') + n2(v) : '—'), cc = (v) => (!isNum(v) ? '' : Math.abs(v) < 0.2 ? 'muted' : v > 0 ? 'up' : 'dn');
    table($('#tb-ic'), [
      { k: 'name', label: 'Chỉ báo', l: true },
      { k: 'a', label: 'QQQ 1 tháng sau', f: (r) => f2(r.a), c: (r) => cc(r.a) },
      { k: 'b', label: 'Giảm sâu nhất 1 tháng sau', f: (r) => f2(r.b), c: (r) => cc(r.b) },
      { k: 'c', label: 'Breakout sắp tới giữ giá', f: (r) => f2(r.c), c: (r) => cc(r.c) },
      { k: 'use', label: 'Dùng để', l: true, c: (r) => (r.use.startsWith('Không') ? 'muted' : '') },
    ], rows, { sort: 'c' });
    const none = rows.filter((r) => r.use.startsWith('Không'));
    $('#ic-sum').textContent = `Kiểm tra trên ${idx.length} phiên (${fdate(H[S0].d)} – ${fdate(H[n - 1].d)}). ` + (none.length ? `Chưa thấy giá trị dự báo: ${none.map((r) => r.name).join(', ')}.` : 'Mọi chỉ báo đều có ít nhất một giá trị dự báo.');
  }
  function verdict() {
    const F = S.flow || {}, G = F.golden || {}, GR = ((S.groups || {}).rows) || [], B = S.lab || {};
    if (!G.level) return;
    $('#verdict').hidden = false;
    const lv = G.level, early = lv === 'Thời điểm vàng' && G.early;
    const vb = $('#vd-badge'); vb.textContent = lv + (early ? ' · đầu chu kỳ' : ''); vb.style.setProperty('--ph', `var(${GDC[lv] || '--muted'})`);
    const EXP = { 'Thời điểm vàng': ['Tấn công', '75–100% vốn, có thể giữ 6–10 vị thế. Ưu tiên mã dẫn dắt vượt nền đầu tiên.'], 'Thuận lợi': ['Mua có chọn lọc', '50–75% vốn, mua thử trước rồi tăng dần khi lệnh đầu có lãi.'],
      'Trung tính': ['Thận trọng', '25–50% vốn, chỉ setup tốt nhất, quy mô nhỏ, chốt lời nhanh hơn.'], 'Bất lợi': ['Phòng thủ', '0–25% vốn. Bảo toàn vốn, chủ yếu theo dõi danh sách mã mạnh để chuẩn bị cho nhịp tăng sau.'] };
    const [act, how] = EXP[lv] || ['—', ''];
    $('#vd-main').replaceChildren(el('b', { text: act + ': ' }), how);
    const miss = (G.checks || []).filter((c) => !c.ok).map((c) => c.label);
    $('#vd-mkt').replaceChildren(...[
      el('li', { text: `Giai đoạn dòng tiền: ${F.stage || '—'} (${F.stage_days || '—'} phiên).` }),
      el('li', { text: `${G.count}/6 bằng chứng thời điểm vàng đạt.` + (miss.length ? ` Còn thiếu: ${miss.slice(0, 3).join('; ')}${miss.length > 3 ? '…' : ''}.` : '') }),
      (F.warnings || []).length ? el('li', { class: 'dn', text: F.warnings[0] }) : null,
      el('li', { text: `Cảnh báo: ${S.latest.alert} · ${S.latest.dd_qqq} ngày phân phối QQQ.` }),
    ].filter(Boolean));
    const lead = GR.filter((r) => r.label === 'Dẫn dắt').slice(0, 3), emer = GR.filter((r) => r.label === 'Mới nổi').slice(0, 3), weak = GR.filter((r) => r.label === 'Suy yếu').slice(0, 3);
    $('#vd-grp').replaceChildren(...[
      el('li', { text: lead.length ? `Dẫn dắt: ${lead.map((r) => r.ind).join(', ')}.` : 'Chưa có ngành nào đủ tiêu chuẩn dẫn dắt.' }),
      emer.length ? el('li', { text: `Mới nổi: ${emer.map((r) => r.ind).join(', ')}.` }) : null,
      weak.length ? el('li', { class: 'dn', text: `Suy yếu, tránh mua mới: ${weak.map((r) => r.ind).join(', ')}.` }) : null,
    ].filter(Boolean));
    const MIN = B.min_n || 30;
    const good = (B.plans || []).filter((p) => p.ok_stop && (p.ev || 0) >= 4 && ((p.hist.stage || {}).n || 0) >= MIN && p.hist.stage.exp > 0)
      .sort((a, b) => b.hist.stage.exp - a.hist.stage.exp || (b.ev || 0) - (a.ev || 0));
    const seen = new Set(); const picks = good.filter((p) => (seen.has(p.t) ? false : seen.add(p.t))).slice(0, 5);
    $('#vd-pick').replaceChildren(el('li', { text: picks.length ? `${picks.length} mã vừa có kỳ vọng dương trong giai đoạn này, vừa đủ bằng chứng dòng tiền, stop trong mức cho phép.` : (lv === 'Bất lợi' ? 'Không có điểm mua đủ tiêu chuẩn — phù hợp với thị trường bất lợi.' : 'Chưa có mã nào đủ tiêu chuẩn.') }),
      el('li', {}, el('button', { class: 'btn sm', type: 'button', text: 'Xem danh sách ở tab Mã hôm nay →', onclick: () => showTab('setups') })));
  }
  function threeQ(t) {
    const P = ((S.lab || {}).plans || []).filter((p) => p.t === t);
    const R = ((S.flow || {}).radar || []).find((x) => x.t === t);
    if (!P.length && !R) return [];
    const MIN = (S.lab || {}).min_n || 30, stNow = (S.flow || {}).stage;
    const rr = (x) => (isNum(x) ? (x > 0 ? '+' : '') + n2(x) + 'R' : '—');
    const line = (lb, c) => (c && c.n ? `${lb}: kỳ vọng ${rr(c.exp)}, thắng ${c.win}% (95%: ${c.lo}–${c.hi}%), đạt +2R ${c.p2r}%, thất bại 3 phiên ${c.fail3}% · ${c.n} lệnh${c.n < MIN ? ' (chưa đủ mẫu)' : ''}` : `${lb}: chưa có lệnh nào`);
    const box = el('div', { class: 'q3' }, el('h4', { text: 'Ba câu hỏi trước khi mua' }));
    const q = (n, title, ...kids) => box.append(el('div', { class: 'q3-i' }, el('div', { class: 'q3-n', text: n }), el('div', {}, el('b', { text: title }), ...kids)));
    if (P.length) {
      q('1', 'Mẫu hình này có xác suất thành công cao trong điều kiện hiện tại không?', ...P.map((p) => el('ul', { class: 'small-list' }, el('li', {}, el('b', { text: p.setup })),
        el('li', { text: line(`Giai đoạn "${stNow}"`, p.hist.stage) }), el('li', { text: line(p.rs_b || 'RS', p.hist.rs) }), el('li', { text: line(`Ngành ${p.ind_b || ''}`, p.hist.ind) }),
        el('li', { text: line(`Thị trường "${((S.flow || {}).golden || {}).level || '—'}"`, p.hist.gold) }),
        el('li', { text: line('Cùng giai đoạn + RS ≥ 80 + ngành nửa trên', p.hist.now_best) }), el('li', { text: line('Ngoài mẫu (dữ liệu chưa dùng để xem xét)', p.hist.oos) }))));
    } else q('1', 'Mẫu hình này có xác suất thành công cao trong điều kiện hiện tại không?', el('p', { class: 'small muted', text: 'Hôm nay mã này không có setup nào trong bảng kiểm chứng.' }));
    if (R) q('2', `Dòng tiền có thật sự quay lại mã này? ${R.score}/${R.n} bằng chứng`, el('ul', { class: 'fl-evl' }, ...R.ev.map((e) => el('li', { class: e.ok ? 'ok' : 'no' }, el('span', { class: 'fl-mk', text: e.ok ? '✓' : '✗' }), el('span', { class: 'fl-lb', text: e.label }), el('span', { class: 'muted small', text: e.detail })))),
      R.news ? el('p', { class: 'banner warn small', text: R.news }) : null, el('p', { class: 'small muted', text: 'Khối lượng không cho biết chính xác tổ chức nào mua; đây là bằng chứng xác suất về cung cầu. Không có dữ liệu short interest nên chỉ cảnh báo được các cú gap từ nền yếu.' }));
    if (P.length) q('3', 'Điểm vào nào có lợi thế, khi nào phải thừa nhận mình sai?', ...P.map((p) => el('ul', { class: 'small-list' },
      el('li', { text: p.kind === 'close' ? `${p.setup}: đã bứt phá hôm nay tại ${n2(p.close)}. Không mua đuổi nếu phiên tới mở cửa cao hơn pivot ${n2(p.pivot)} quá 3%.` : `${p.setup}: đặt lệnh chờ mua khi giá vượt ${n2(p.pivot)} (cách giá hiện tại ${pct(p.dist)}), còn hiệu lực ${p.left} phiên. Không mua nếu mở cửa gap cao hơn pivot trên 3%.` }),
      el('li', { class: p.ok_stop ? '' : 'dn', text: `Sai khi: giá chạm ${n2(p.stop)} (stop −${n1(p.stop_pct)}%${p.ok_stop ? '' : `, rộng hơn mức tối đa ${acct().max_stop_pct}% của bạn`}), hoặc đóng cửa lại dưới pivot trong 3 phiên đầu (trước đây xảy ra ở ${(p.hist.all || {}).fail3 ?? '—'}% lệnh của setup này).` }),
      el('li', { text: `Cỡ lệnh: ${n0(p.shares)} cổ, rủi ro khoảng ${usd(p.risk_usd)}. Mục tiêu tham khảo +2R ${n2(p.t2r)}, +3R ${n2(p.t3r)}; quy tắc kiểm chứng: chốt 1/2 tại +2R, dời stop về hòa vốn, phần còn lại thoát khi đóng cửa dưới EMA 21.` }))));
    box.append(el('p', { class: 'small muted', text: 'Không câu trả lời nào tự quyết định lệnh mua. Hãy xem bằng chứng nào đang thiếu.' }));
    return [box];
  }
  function closeModal() { $('#modal').hidden = true; if (modalChart) { modalChart.remove(); modalChart = null; } }
  $('#m-close').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

  // ------------------------------------------------------------ nhật ký
  const Journal = (() => {
    const KEY = 'nk_journal_v2', OLD = 'nk_journal_v1', RKEY = 'nk_jrules', MKEY = 'nk_mlog';
    const RDEF = { t1: 20, f1: 0.333, t2: 40, f2: 0.333, be: 10, days: 15, ma: 'd21', earn: 5 };
    const MIST = { chase: 'Mua đuổi, xa pivot', mkt: 'Mua khi thị trường xấu', nostop: 'Không cắt lỗ đúng stop', early: 'Bán quá sớm', giveback: 'Để lãi thành lỗ', size: 'Vị thế quá lớn', earn: 'Giữ qua báo cáo tài chính', nosetup: 'Không có setup rõ' };
    const CHK = { pivot: 'Mua trong 5% trên pivot', vol: 'KL phiên mua ≥ 1,4× TB50', close: 'Đóng cửa nửa trên biên độ', base: 'Có nền giá rõ', eps: 'EPS / doanh thu tăng ≥ 20%', plan: 'Đúng kế hoạch đã viết trước' };
    let list = store.get(KEY, null), eqChart = null, inited = false;
    if (!list) { // chuyển dữ liệu nhật ký cũ (một lần mua, một lần bán) sang dạng mới
      list = (store.get(OLD, []) || []).map((x) => ({ id: x.id, t: x.t, setup: x.setup, d: x.d, entry: x.entry, stop0: x.stop, stop: x.stop, shares: x.shares, note: x.note || '',
        fills: x.exit ? [{ k: 'S', d: x.xd || x.d, px: x.exit, sh: x.shares }] : [], checks: {}, mistakes: {}, auto: {} }));
      store.set(KEY, list);
    }
    let R = Object.assign({}, RDEF, store.get(RKEY, {}));
    let mlog = store.get(MKEY, []);
    const save = () => store.set(KEY, list);
    const today = () => (S.latest && S.latest.asof) || new Date().toISOString().slice(0, 10);
    const days = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 864e5));
    const tdays = (a, b) => Math.round(days(a, b) * 5 / 7); // xấp xỉ số phiên

    // ---- tính toán một lệnh từ các lần mua / bán
    function calc(x) {
      const buys = [{ k: 'B', d: x.d, px: x.entry, sh: x.shares }, ...(x.fills || []).filter((f) => f.k === 'B')];
      const sells = (x.fills || []).filter((f) => f.k === 'S');
      const bSh = buys.reduce((s, f) => s + f.sh, 0), cost = buys.reduce((s, f) => s + f.px * f.sh, 0), avg = bSh ? cost / bSh : x.entry;
      const sSh = sells.reduce((s, f) => s + f.sh, 0), proceeds = sells.reduce((s, f) => s + f.px * f.sh, 0);
      const open = Math.max(0, bSh - sSh), closed = bSh > 0 && open === 0 && sells.length > 0;
      const st = S.stocks && S.stocks.find((s) => s.t === x.t);
      const last = open > 0 && st ? st.close : null;
      const realized = proceeds - avg * sSh, unreal = isNum(last) ? (last - avg) * open : 0;
      const risk0 = (x.entry - x.stop0) * x.shares;
      const pl = realized + (closed ? 0 : unreal);
      const lastD = sells.length ? sells.map((f) => f.d).sort().slice(-1)[0] : null;
      const held = tdays(x.d, closed ? lastD : today());
      const pct = cost ? pl / cost * 100 : null;
      return Object.assign({}, x, { avg, bSh, sSh, open, closed, last, st, realized, pl, pct, R: risk0 > 0 ? pl / risk0 : null, risk0, held, lastD,
        stopPct: x.entry ? (x.entry - x.stop0) / x.entry * 100 : null, soldFrac: bSh ? sSh / bSh : 0, gain: isNum(last) ? (last / avg - 1) * 100 : null });
    }

    // ---- nhắc nhở cho lệnh đang mở
    function alertsOf(r) {
      const out = []; if (r.closed) return out;
      const g = r.gain, st = r.st || {};
      if (!isNum(g)) { out.push({ lv: 'muted', t: 'Không có giá hiện tại (mã ngoài danh sách quét)' }); return out; }
      if (isNum(r.last) && r.last <= (r.stop ?? r.stop0)) out.push({ lv: 'dn', t: `Đã chạm stop ${n2(r.stop ?? r.stop0)}: bán theo kế hoạch` });
      const f1 = Number(R.f1), f2 = Number(R.f2);
      if (R.t1 && g >= R.t1 && r.soldFrac < f1 - 0.02) out.push({ lv: 'up', t: `Lãi ${spct(g)} ≥ +${R.t1}%: chốt ${Math.round(f1 * 100)}% (≈ ${n0(Math.round(r.bSh * f1))} cổ)` });
      if (R.t2 && g >= R.t2 && r.soldFrac < f1 + f2 - 0.02) out.push({ lv: 'up', t: `Lãi ${spct(g)} ≥ +${R.t2}%: chốt thêm ${Math.round(f2 * 100)}%` });
      if (R.be && g >= R.be && (r.stop ?? r.stop0) < r.avg) out.push({ lv: 'warn', t: `Lãi ≥ +${R.be}%: dời stop về hòa vốn (${n2(r.avg)})` });
      const ma = st[R.ma]; if (r.soldFrac >= f1 - 0.02 && isNum(ma) && ma < 0) out.push({ lv: 'dn', t: `Đã chốt lần 1 và giá đóng cửa dưới ${R.ma === 'd21' ? 'EMA 21' : 'EMA 50'}: bán phần còn lại` });
      if (R.days && r.held >= R.days && g < 5) out.push({ lv: 'warn', t: `${r.held} phiên mà lãi chưa tới 5%: cân nhắc bán (không bứt)` });
      if (st.earn && R.earn) { const d = days(today(), st.earn); if (d >= 0 && d <= R.earn) out.push({ lv: 'warn', t: `Báo cáo tài chính sau ${d} ngày (${fdate(st.earn)})` }); }
      if (isNum(r.maxg) && r.maxg >= 15 && g < r.maxg / 2) out.push({ lv: 'warn', t: `Đã từng lãi ${spct(r.maxg)} nay còn ${spct(g)}: đừng để lãi thành lỗ` });
      return out;
    }

    // ---- tiêu chuẩn tự động lúc mua (lấy từ dữ liệu trang nếu có)
    function autoCrit(t) {
      const s = (S.stocks || []).find((x) => x.t === t) || {}, L = S.latest || {}, F = S.flow || {};
      const a = { asof: L.asof };
      if (isNum(s.rs)) a.rs = s.rs >= 90 ? 'RS ≥ 90' : s.rs >= 80 ? 'RS 80–89' : 'RS < 80';
      if (s.stage) a.stage = s.stage === 2 ? 'Giai đoạn 2' : 'Giai đoạn khác';
      if ('tt' in s) a.tt = s.tt ? 'Đạt Trend Template' : 'Không đạt Trend Template';
      if (L.qqq_regime) a.reg = 'QQQ ' + L.qqq_regime;
      if (F.stage) a.flow = F.stage;
      if (F.golden && F.golden.level) a.gold = F.golden.level;
      if (isNum(s.ind_rank) && L.n_ind) a.ind = s.ind_rank <= L.n_ind * 0.2 ? 'Ngành top 20%' : s.ind_rank <= L.n_ind / 2 ? 'Ngành 20–50%' : 'Ngành nửa dưới';
      if (s.earn) { const d = days(L.asof, s.earn); a.earn = d >= 0 && d <= 7 ? 'BCTC trong 7 ngày' : 'Không có BCTC gần'; }
      return a;
    }

    // ---- biểu mẫu
    const fillRow = (f = { k: 'S', d: today(), px: '', sh: '' }) => {
      const row = el('div', { class: 'jr-fill', 'data-k': f.k },
        el('span', { class: 'tag ' + (f.k === 'S' ? 'bad' : 'ld'), text: f.k === 'S' ? 'Bán' : 'Mua thêm' }),
        el('input', { type: 'date', value: f.d || today(), 'aria-label': 'Ngày' }), el('input', { type: 'number', step: 'any', min: 0, placeholder: 'Giá', value: f.px ?? '', 'aria-label': 'Giá' }),
        el('input', { type: 'number', step: 1, min: 1, placeholder: 'Số cổ', value: f.sh ?? '', 'aria-label': 'Số cổ' }),
        el('button', { type: 'button', class: 'btn sm ghost', text: '✕', onclick: () => row.remove() }));
      $('#jr-fills').append(row);
    };
    function preview() {
      const e = Number($('#jr-entry').value), s = Number($('#jr-stop').value), n = Number($('#jr-shares').value), p = Number($('#jr-pivot').value);
      const ch = p > 0 && e > 0 ? ` · cách pivot ${spct((e / p - 1) * 100)}` : '';
      $('#jr-preview').textContent = e > s && s > 0 ? `Stop ${n1((e - s) / e * 100)}% · rủi ro ${usd((e - s) * (n || 0))}${ch}` : '';
    }
    function reset() { $('#jr-form').reset(); $('#jr-id').value = ''; $('#jr-fills').replaceChildren(); $('#jr-cancel').hidden = true; $('#jr-form-title').textContent = 'Ghi lệnh mới'; $('#jr-d').value = today(); preview(); }
    function fill(x) {
      reset();
      $('#jr-id').value = x.id || ''; $('#jr-t').value = x.t || ''; $('#jr-setup').value = x.setup || ''; $('#jr-d').value = x.d || today();
      $('#jr-entry').value = x.entry ?? ''; $('#jr-stop').value = x.stop0 ?? x.stop ?? ''; $('#jr-shares').value = x.shares ?? ''; $('#jr-pivot').value = x.pivot ?? ''; $('#jr-maxg').value = x.maxg ?? '';
      $('#jr-note').value = x.note || ''; $('#jr-lesson').value = x.lesson || ''; $('#jr-why').value = x.why || ''; $('#jr-emo').value = x.emo || '';
      $$('#jr-form [data-c]').forEach((c) => (c.checked = !!(x.checks || {})[c.dataset.c]));
      $$('#jr-form [data-m]').forEach((c) => (c.checked = !!(x.mistakes || {})[c.dataset.m]));
      (x.fills || []).forEach(fillRow);
      $('#jr-cancel').hidden = !x.id; $('#jr-form-title').textContent = x.id ? 'Sửa lệnh ' + x.t : 'Ghi lệnh mới'; preview();
    }

    // ---- thống kê
    function stats(rows) {
      const w = rows.filter((r) => r.R > 0), av = (a, k) => (a.length ? a.reduce((s, r) => s + (r[k] ?? 0), 0) / a.length : null);
      return { n: rows.length, win: rows.length ? w.length / rows.length * 100 : null, R: av(rows, 'R'), pct: av(rows, 'pct'), sumR: rows.reduce((s, r) => s + (r.R ?? 0), 0) };
    }
    function render() {
      const rows = list.map(calc);
      const closed = rows.filter((r) => r.closed), wins = closed.filter((r) => r.R > 0), losses = closed.filter((r) => r.R <= 0);
      const av = (a, k) => (a.length ? a.reduce((s, r) => s + (r[k] ?? 0), 0) / a.length : null);
      const T = $('#jr-tiles'); T.replaceChildren();
      const aw = av(wins, 'pct'), al = av(losses, 'pct');
      tile(T, 'Lệnh đã đóng', n0(closed.length), `${rows.length - closed.length} lệnh đang mở`);
      tile(T, 'Tỷ lệ thắng', closed.length ? pct(wins.length / closed.length * 100, 0) : '—', `${wins.length} thắng / ${losses.length} thua`);
      tile(T, 'Lãi TB / lỗ TB', isNum(aw) && isNum(al) && al < 0 ? n2(aw / -al) + ' : 1' : '—', `${spct(aw)} / ${spct(al)} · Minervini: ≥ 2:1`, isNum(aw) && isNum(al) && al < 0 ? (aw / -al >= 2 ? 'up' : 'dn') : '');
      tile(T, 'R trung bình mỗi lệnh', isNum(av(closed, 'R')) ? n2(av(closed, 'R')) + 'R' : '—', 'kỳ vọng của hệ thống', cls(av(closed, 'R')));
      tile(T, 'Lệnh thua TB', isNum(av(losses, 'R')) ? n2(av(losses, 'R')) + 'R' : '—', 'nên quanh −1R', av(losses, 'R') < -1.3 ? 'dn' : '');
      tile(T, 'Ngày giữ: thắng / thua', closed.length ? `${n0(av(wins, 'held'))} / ${n0(av(losses, 'held'))} phiên` : '—', 'lệnh thắng nên giữ lâu hơn', closed.length ? (av(wins, 'held') > av(losses, 'held') ? 'up' : 'dn') : '');
      tile(T, 'Tổng lãi / lỗ', rows.length ? usd(rows.reduce((s, r) => s + r.pl, 0)) : '—', 'gồm cả lãi chưa chốt', cls(rows.reduce((s, r) => s + r.pl, 0)));
      // nhắc nhở
      const openRows = rows.filter((r) => !r.closed);
      const allAlerts = openRows.flatMap((r) => alertsOf(r).filter((a) => a.lv !== 'muted').map((a) => `${r.t}: ${a.t}`));
      const ab = $('#jr-alerts'); ab.hidden = !allAlerts.length; ab.replaceChildren(el('b', { text: 'Nhắc nhở hôm nay: ' }), allAlerts.join(' · '));
      table($('#tb-jr-open'), [
        { k: 't', label: 'Lệnh đang mở', tk: true },
        { k: 'gain', label: 'Lãi hiện tại', f: (r) => spct(r.gain), c: (r) => cls(r.gain) },
        { k: 'open', label: 'Còn giữ', f: (r) => `${n0(r.open)} / ${n0(r.bSh)} cổ` },
        { k: 'held', label: 'Đã giữ', f: (r) => `${r.held} phiên` },
        { k: '_a', label: 'Việc cần làm', l: true, f: (r) => { const f = document.createDocumentFragment(); const A = alertsOf(r); if (!A.length) f.append(el('span', { class: 'muted', text: 'Giữ theo kế hoạch' })); A.forEach((a) => f.append(el('div', { class: a.lv, text: a.t }))); return f; } },
      ], openRows, { sort: null, empty: 'Không có lệnh đang mở.' });
      // danh sách lệnh
      table($('#tb-journal'), [
        { k: 'd', label: 'Ngày mua', f: (r) => fdate(r.d) },
        { k: 't', label: 'Mã', tk: true },
        { k: 'setup', label: 'Setup', l: true },
        { k: 'avg', label: 'Giá mua TB', f: (r) => n2(r.avg) },
        { k: 'stopPct', label: 'Stop %', f: (r) => pct(r.stopPct) },
        { k: 'bSh', label: 'Số cổ', f: (r) => n0(r.bSh) },
        { k: 'fills', label: 'Các lần bán', l: true, f: (r) => (r.fills || []).filter((f) => f.k === 'S').map((f) => `${fdate(f.d)} ${n2(f.px)}×${n0(f.sh)}`).join(' · ') || (r.closed ? '' : 'Đang mở') },
        { k: 'held', label: 'Giữ', f: (r) => `${r.held} phiên` },
        { k: 'pct', label: '%', f: (r) => spct(r.pct), c: (r) => cls(r.pct) },
        { k: 'R', label: 'R', f: (r) => (isNum(r.R) ? (r.R > 0 ? '+' : '') + n2(r.R) : '—'), c: (r) => cls(r.R) },
        { k: 'pl', label: 'Lãi/lỗ', f: (r) => usd(r.pl), c: (r) => cls(r.pl) },
        { k: 'why', label: 'Lý do bán', l: true, f: (r) => r.why || '' },
        { k: 'mis', label: 'Sai lầm', l: true, f: (r) => Object.keys(r.mistakes || {}).filter((k) => r.mistakes[k]).map((k) => MIST[k]).join(', '), sv: (r) => Object.values(r.mistakes || {}).filter(Boolean).length },
        { k: '_a', label: '', f: (r) => {
          const box = el('span');
          box.append(el('button', { class: 'btn sm ghost', type: 'button', text: 'Sửa', onclick: () => { fill(list.find((y) => y.id === r.id)); $('#jr-form').scrollIntoView({ behavior: 'smooth', block: 'center' }); } }), ' ');
          box.append(el('button', { class: 'btn sm ghost', type: 'button', text: 'Chart', onclick: () => openChart(r.t, { entry: r.avg, stop: r.stop ?? r.stop0, fills: [{ k: 'B', d: r.d, px: r.entry }, ...(r.fills || [])] }) }), ' ');
          const del = el('button', { class: 'btn sm ghost', type: 'button', text: 'Xóa' });
          del.addEventListener('click', () => { if (del.dataset.armed) { list = list.filter((x) => x.id !== r.id); save(); render(); } else { del.dataset.armed = '1'; del.textContent = 'Chắc chắn?'; setTimeout(() => { delete del.dataset.armed; del.textContent = 'Xóa'; }, 3000); } });
          box.append(del); return box;
        } },
      ], rows, { sort: 'd', empty: 'Chưa có lệnh nào. Ghi lệnh đầu tiên ở khung bên trên, hoặc bấm "+ Nhật ký" ở tab Mã hôm nay.' });
      // tiêu chuẩn nào có tỷ lệ đúng cao
      const crit = [];
      const bucket = (name, getter) => { const g = {}; closed.forEach((r) => { const v = getter(r); if (v == null) return; (g[v] = g[v] || []).push(r); }); Object.entries(g).forEach(([b, rs]) => crit.push({ name, b, ...stats(rs) })); };
      Object.entries(CHK).forEach(([k, lb]) => bucket(lb, (r) => (r.checks ? (r.checks[k] ? 'Đạt' : 'Không đạt') : null)));
      bucket('Stop ban đầu', (r) => (isNum(r.stopPct) ? (r.stopPct <= 4 ? '≤ 4%' : r.stopPct <= 7 ? '4–7%' : '> 7%') : null));
      bucket('Cách pivot lúc mua', (r) => (r.pivot > 0 ? ((r.entry / r.pivot - 1) * 100 <= 2 ? '≤ 2%' : (r.entry / r.pivot - 1) * 100 <= 5 ? '2–5%' : '> 5% (đuổi)') : null));
      ['rs', 'tt', 'stage', 'ind', 'reg', 'flow', 'gold', 'earn'].forEach((k) => bucket({ rs: 'RS lúc mua', tt: 'Trend Template', stage: 'Giai đoạn', ind: 'Hạng ngành', reg: 'Xu hướng QQQ', flow: 'Giai đoạn dòng tiền', gold: 'Thời điểm mua', earn: 'Báo cáo tài chính' }[k], (r) => (r.auto || {})[k] ?? null));
      bucket('Cảm xúc lúc vào lệnh', (r) => r.emo || null);
      table($('#tb-jr-crit'), [
        { k: 'name', label: 'Tiêu chuẩn', l: true },
        { k: 'b', label: 'Nhóm', l: true },
        { k: 'n', label: 'Số lệnh', f: (r) => n0(r.n) },
        { k: 'win', label: 'Tỷ lệ thắng', f: (r) => pct(r.win, 0), c: (r) => (r.n >= 3 ? (r.win >= 50 ? 'up' : r.win < 35 ? 'dn' : '') : 'muted') },
        { k: 'R', label: 'R trung bình', f: (r) => (isNum(r.R) ? (r.R > 0 ? '+' : '') + n2(r.R) : '—'), c: (r) => (r.n >= 3 ? cls(r.R) : 'muted') },
        { k: 'pct', label: '% trung bình', f: (r) => spct(r.pct), c: (r) => (r.n >= 3 ? cls(r.pct) : 'muted') },
      ], crit, { sort: null, empty: 'Cần có lệnh đã đóng để thống kê.' });
      // thất bại đến từ đâu
      const fail = [];
      Object.entries(MIST).forEach(([k, lb]) => { const rs = closed.filter((r) => (r.mistakes || {})[k]); if (rs.length) fail.push({ what: 'Sai lầm: ' + lb, ...stats(rs) }); });
      const byWhy = {}; closed.forEach((r) => { if (r.why) (byWhy[r.why] = byWhy[r.why] || []).push(r); });
      Object.entries(byWhy).forEach(([k, rs]) => fail.push({ what: 'Lý do bán: ' + k, ...stats(rs) }));
      const gb = closed.filter((r) => isNum(r.maxg) && r.maxg >= 10 && r.pct < 0); if (gb.length) fail.push({ what: 'Tự phát hiện: từng lãi ≥ 10% rồi đóng lệnh lỗ', ...stats(gb) });
      const big = losses.filter((r) => r.R < -1.3); if (big.length) fail.push({ what: 'Tự phát hiện: lỗ quá −1,3R (không giữ kỷ luật stop)', ...stats(big) });
      table($('#tb-jr-fail'), [
        { k: 'what', label: 'Nguyên nhân', l: true },
        { k: 'n', label: 'Số lệnh', f: (r) => n0(r.n) },
        { k: 'win', label: 'Tỷ lệ thắng', f: (r) => pct(r.win, 0) },
        { k: 'sumR', label: 'Tổng R', f: (r) => (r.sumR > 0 ? '+' : '') + n2(r.sumR), c: (r) => cls(r.sumR) },
      ], fail, { sort: 'sumR', dir: 1, empty: 'Chưa có dữ liệu. Đánh dấu sai lầm và lý do bán cho các lệnh đã đóng.' });
      // theo setup
      const bs = {}; closed.forEach((r) => (bs[r.setup || '(không ghi)'] = bs[r.setup || '(không ghi)'] || []).push(r));
      table($('#tb-jr-setup'), [
        { k: 'b', label: 'Setup', l: true },
        { k: 'n', label: 'Số lệnh', f: (r) => n0(r.n) },
        { k: 'win', label: 'Tỷ lệ thắng', f: (r) => pct(r.win, 0) },
        { k: 'R', label: 'R TB', f: (r) => (isNum(r.R) ? n2(r.R) : '—'), c: (r) => cls(r.R) },
        { k: 'held', label: 'Giữ TB', f: (r) => `${n0(r.held)} phiên` },
      ], Object.entries(bs).map(([b, rs]) => ({ b, ...stats(rs), held: av(rs, 'held') })), { sort: 'n', empty: 'Chưa có lệnh đã đóng.' });
      const hb = (lo, hi) => closed.filter((r) => r.held >= lo && r.held <= hi);
      $('#jr-hold').textContent = closed.length ? `Thời gian giữ trung bình ${n0(av(closed, 'held'))} phiên (lệnh thắng ${n0(av(wins, 'held'))}, lệnh thua ${n0(av(losses, 'held'))}). Giữ ≤ 5 phiên: ${hb(0, 5).length} lệnh, R TB ${n2(stats(hb(0, 5)).R ?? 0)}; 6–20 phiên: ${hb(6, 20).length} lệnh, R TB ${n2(stats(hb(6, 20)).R ?? 0)}; trên 20 phiên: ${hb(21, 9999).length} lệnh, R TB ${n2(stats(hb(21, 9999)).R ?? 0)}.` : '';
      // nhật ký thị trường
      table($('#tb-mlog'), [
        { k: 'd', label: 'Ngày', f: (r) => fdate(r.d) },
        { k: 'qqq', label: 'QQQ', f: (r) => n2(r.qqq) },
        { k: 'flow', label: 'Giai đoạn dòng tiền', l: true },
        { k: 'reg', label: 'Xu hướng QQQ', l: true },
        { k: 'alert', label: 'Cảnh báo', l: true },
        { k: 'gold', label: 'Thời điểm mua', l: true },
        { k: 't2108', label: 'T2108', f: (r) => pct(r.t2108, 0) },
        { k: 'note', label: 'Nhận định của bạn', l: true },
        { k: 'f21', label: 'QQQ 1 tháng sau', f: (r) => { const L = longRows(); const i = L.findIndex((x) => x.d >= r.d); return i >= 0 && i + 21 < L.length && isNum(r.qqq) ? spct((L[i + 21].qqq / r.qqq - 1) * 100) : '—'; } },
        { k: '_a', label: '', f: (r) => el('button', { class: 'btn sm ghost', type: 'button', text: 'Xóa', onclick: () => { mlog = mlog.filter((x) => x.d !== r.d); store.set(MKEY, mlog); render(); } }) },
      ], mlog, { sort: 'd', empty: 'Chưa ghi ngày nào.' });
      // đường vốn
      const box = $('#ch-equity');
      if (eqChart) { eqChart.remove(); eqChart = null; }
      const pts = closed.filter((r) => r.lastD && isNum(r.R)).sort((a, b) => a.lastD.localeCompare(b.lastD));
      if (!pts.length) { box.replaceChildren(el('p', { class: 'empty', text: 'Đường vốn sẽ hiện khi có lệnh đã đóng.' })); return; }
      if (box.closest('.tab').hidden) return;
      eqChart = baseChart(box);
      let cum = 0; const byDay = new Map();
      for (const r of pts) { cum += r.R; byDay.set(r.lastD, cum); }
      eqChart.addAreaSeries({ lineColor: css('--accent'), topColor: css('--accent') + '44', bottomColor: css('--accent') + '05', lineWidth: 2, priceLineVisible: false }).setData([...byDay].map(([time, value]) => ({ time, value })));
      eqChart.timeScale().fitContent();
    }
    function init() {
      if (inited) { render(); return; } inited = true;
      reset();
      ['#jr-entry', '#jr-stop', '#jr-shares', '#jr-pivot'].forEach((s) => $(s).addEventListener('input', preview));
      $('#jr-cancel').addEventListener('click', reset);
      $('#jr-addsell').addEventListener('click', () => fillRow({ k: 'S', d: today(), px: '', sh: '' }));
      $('#jr-addbuy').addEventListener('click', () => fillRow({ k: 'B', d: today(), px: '', sh: '' }));
      // quy tắc
      const RF = { t1: '#ru-t1', f1: '#ru-f1', t2: '#ru-t2', f2: '#ru-f2', be: '#ru-be', days: '#ru-days', ma: '#ru-ma', earn: '#ru-earn' };
      Object.entries(RF).forEach(([k, s]) => { $(s).value = R[k]; $(s).addEventListener('input', () => { R[k] = $(s).tagName === 'SELECT' && k === 'ma' ? $(s).value : Number($(s).value); store.set(RKEY, R); render(); }); });
      $('#jr-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const id = $('#jr-id').value, old = list.find((y) => y.id === id) || {};
        const fills = $$('#jr-fills .jr-fill').map((row) => { const [d, px, sh] = $$('input', row).map((i) => i.value); return { k: row.dataset.k, d, px: Number(px), sh: Number(sh) }; }).filter((f) => f.px > 0 && f.sh > 0);
        const t = $('#jr-t').value.trim().toUpperCase();
        const x = { id: id || String(Date.now()), t, setup: $('#jr-setup').value.trim(), d: $('#jr-d').value,
          entry: Number($('#jr-entry').value), stop0: Number($('#jr-stop').value), stop: old.stop && old.stop !== old.stop0 ? old.stop : Number($('#jr-stop').value), shares: Number($('#jr-shares').value),
          pivot: $('#jr-pivot').value ? Number($('#jr-pivot').value) : null, maxg: $('#jr-maxg').value ? Number($('#jr-maxg').value) : null,
          fills, why: $('#jr-why').value, emo: $('#jr-emo').value, note: $('#jr-note').value.trim(), lesson: $('#jr-lesson').value.trim(),
          checks: Object.fromEntries($$('#jr-form [data-c]').map((c) => [c.dataset.c, c.checked])), mistakes: Object.fromEntries($$('#jr-form [data-m]').map((c) => [c.dataset.m, c.checked])),
          auto: old.auto && Object.keys(old.auto).length ? old.auto : autoCrit(t) };
        if (!(x.entry > x.stop0)) { $('#jr-preview').textContent = 'Stop phải thấp hơn giá mua.'; return; }
        const sold = fills.filter((f) => f.k === 'S').reduce((s, f) => s + f.sh, 0), bought = x.shares + fills.filter((f) => f.k === 'B').reduce((s, f) => s + f.sh, 0);
        if (sold > bought) { $('#jr-preview').textContent = 'Số cổ đã bán nhiều hơn số cổ đã mua.'; return; }
        const i = list.findIndex((y) => y.id === x.id); if (i >= 0) list[i] = x; else list.push(x);
        save(); reset(); render();
      });
      $('#ml-add').addEventListener('click', () => {
        const L = S.latest || {}, F = S.flow || {}, LR = longRows(), last = LR[LR.length - 1] || {};
        const r = { d: L.asof || today(), qqq: last.d === L.asof ? last.qqq : ((S.history || []).slice(-1)[0] || {}).qqq, flow: F.stage || '', reg: L.qqq_regime || '', alert: L.alert || '', gold: (F.golden || {}).level || '', t2108: last.t2108, note: $('#ml-note').value.trim() };
        mlog = mlog.filter((x) => x.d !== r.d).concat([r]); store.set(MKEY, mlog); $('#ml-note').value = ''; render();
      });
      $('#jr-export').addEventListener('click', () => {
        const head = ['id', 't', 'setup', 'd', 'entry', 'stop0', 'shares', 'pivot', 'avg', 'sold', 'last_sell', 'pct', 'R', 'held', 'why', 'emo', 'mistakes', 'note', 'lesson'];
        const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
        const rows = list.map(calc).map((r) => ({ ...r, sold: r.sSh, last_sell: r.lastD, avg: r.avg && r.avg.toFixed(2), pct: isNum(r.pct) ? r.pct.toFixed(2) : '', R: isNum(r.R) ? r.R.toFixed(2) : '', mistakes: Object.keys(r.mistakes || {}).filter((k) => r.mistakes[k]).map((k) => MIST[k]).join('; ') }));
        const csv = '﻿' + [head.join(','), ...rows.map((x) => head.map((h) => q(x[h])).join(','))].join('\n');
        const a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `nhat-ky-${today()}.csv` });
        document.body.append(a); a.click(); a.remove();
      });
      $('#jr-backup').addEventListener('click', () => {
        const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify({ v: 2, trades: list, rules: R, mlog }, null, 1)], { type: 'application/json' })), download: `nhat-ky-day-du-${today()}.json` });
        document.body.append(a); a.click(); a.remove();
      });
      $('#jr-import').addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) return;
        const text = (await f.text()).replace(/^﻿/, '');
        if (f.name.endsWith('.json')) {
          try { const j = JSON.parse(text); (j.trades || []).forEach((x) => { const i = list.findIndex((y) => y.id === x.id); if (i >= 0) list[i] = x; else list.push(x); }); if (j.rules) { R = Object.assign({}, RDEF, j.rules); store.set(RKEY, R); } if (j.mlog) { mlog = j.mlog; store.set(MKEY, mlog); } save(); render(); } catch (err) { alertBox('File JSON không hợp lệ.'); }
          e.target.value = ''; return;
        }
        const lines = text.split(/\r?\n/).filter(Boolean);
        const parse = (line) => { const out = []; let cur = '', inq = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (inq) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') inq = false; else cur += ch; } else if (ch === '"') inq = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
        const head = parse(lines[0]);
        for (const l of lines.slice(1)) {
          const r = Object.fromEntries(parse(l).map((v, i) => [head[i], v]));
          const x = { id: r.id || String(Date.now() + Math.random()), t: (r.t || '').toUpperCase(), setup: r.setup || '', d: r.d || '', entry: Number(r.entry), stop0: Number(r.stop0 || r.stop), shares: Number(r.shares), note: r.note || '', checks: {}, mistakes: {}, auto: {},
            fills: (r.exit || r.xd) && Number(r.exit) > 0 ? [{ k: 'S', d: r.xd || r.d, px: Number(r.exit), sh: Number(r.shares) }] : [] };
          x.stop = x.stop0;
          if (!x.t || !(x.entry > x.stop0)) continue;
          const i = list.findIndex((y) => y.id === x.id); if (i >= 0) list[i] = Object.assign({}, list[i], x); else list.push(x);
        }
        save(); render(); e.target.value = '';
      });
      render();
    }
    const alertBox = (t) => { const ab = $('#jr-alerts'); ab.hidden = false; ab.textContent = t; };
    return { init, fill, render };
  })();
  function prefillJournal(s) {
    closeModal(); showTab('journal'); Journal.init();
    Journal.fill({ t: s.t, setup: (s.setups || [])[0] || '', entry: s.entry, stop: s.stop, shares: s.shares });
    $('#jr-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ------------------------------------------------------------ "Cách đọc" cho từng biểu đồ (dành cho người mới)
  const HELP = {
    qqq: ['Giá QQQ (đại diện Nasdaq 100) và các đường trung bình. Màu đường giá: xanh = xu hướng Tốt, vàng = Giằng co, đỏ = Xấu.', 'Giá trên EMA 21, EMA 9 nằm trên EMA 21, đường màu xanh.', 'Giá thủng EMA 21 rồi EMA 50, đường chuyển sang đỏ.', 'Martin Luk chỉ mua mạnh khi QQQ ở trạng thái Tốt. Khi đỏ, giảm quy mô hoặc đứng ngoài.'],
    sb: ['Phương pháp Stockbee (Pradeep Bonde). Cột xanh: số mã tăng ≥ 4% kèm khối lượng; cột đỏ: số mã giảm ≥ 4%. Đường: tỷ lệ 10 ngày.', 'Đường trên 1, cột xanh áp đảo.', 'Đường dưới 1 kéo dài, cột đỏ lớn.', 'Tỷ lệ bật mạnh từ dưới 0,5 lên trên 2 thường đánh dấu đáy ngắn hạn.'],
    pct: ['% cổ phiếu nằm trên các đường trung bình 21, 40, 200 phiên.', 'Trên 60% và đang tăng.', 'Dưới 30%.', 'Dưới 20% (đường SMA 40) thường là vùng quá bán gần đáy, trên 70% là hưng phấn.'],
    nhnl: ['Số mã lập đỉnh 52 tuần (xanh) và đáy 52 tuần (đỏ) mỗi ngày.', 'Xanh nhiều hơn đỏ rõ rệt.', 'Đỏ áp đảo, hoặc chỉ số tăng mà số đỉnh mới teo lại.', 'Chỉ số lập đỉnh nhưng rất ít cổ phiếu lập đỉnh là phân kỳ nguy hiểm.'],
    q25: ['Số mã tăng ≥ 25% (xanh) và giảm ≥ 25% (đỏ) trong một quý. Đây là xu hướng trung hạn của cả danh sách.', 'Pha đầu: đường đỏ đã đạt đỉnh và đi xuống, đường xanh bắt đầu đi lên, hai đường đang sát nhau hoặc xanh vừa vượt đỏ.', 'Xanh đã ở rất cao, xa đỏ (trên khoảng 650 mã): thị trường đã chạy xa, tháng sau thường kém. Đó là lúc giữ lệnh, không mua đuổi.', 'Kiểm chứng thật: vùng xanh áp đảo KHÔNG phải lúc mua tốt nhất. Lúc mua tốt nhất là khi chênh lệch còn thấp nhưng đang cải thiện.'],
    cyc: ['Đường giá tô màu theo pha: tăng, điều chỉnh, giằng co, giảm. Dải dưới cùng cho thấy mỗi pha kéo dài bao lâu.', 'Pha tăng dài, điều chỉnh ngắn.', 'Pha giảm hoặc giằng co kéo dài.', 'Bảng bên dưới cho biết mỗi pha thường kéo dài bao lâu, để ước tính pha hiện tại còn bao lâu.'],
    pat: ['% tín hiệu có lãi sau 5 phiên của từng kiểu mua (breakout và mua điều chỉnh), cửa sổ 20 phiên.', 'Đường trên 50%.', 'Đường dưới 50%.', 'Thị trường luân phiên thưởng cho breakout hoặc mua điều chỉnh. Hãy chơi kiểu đang được thưởng.'],
    tspd: ['Chỉ số nhóm top 100 chia cho QQQ. Cột: nhóm top 100 hơn hay kém QQQ bao nhiêu % trong 21 phiên.', 'Đường đi lên, cột xanh: nhóm dẫn đầu khỏe hơn thị trường.', 'Đường đi xuống, cột đỏ sâu: nhóm dẫn đầu bị bán mạnh hơn thị trường.', 'Xem bảng kiểm chứng dài hạn bên dưới để biết chỉ báo này dự báo được bao nhiêu trước khi dựa vào nó.'],
    turn: ['Số mã mới vào top 100 so với 5 phiên trước (cũng là số mã vừa rời).', 'Số mã thay đổi ít và ổn định: nhóm dẫn đầu bền.', 'Số mã thay đổi tăng vọt: dòng tiền xoay vòng nhanh, dẫn đầu cũ đang gãy.', 'Xem bảng kiểm chứng dài hạn bên dưới.'],
    bt: ['Tổng R cộng dồn của từng phong cách huyền thoại trong quá khứ (1R = số tiền chấp nhận mất mỗi lệnh).', 'Đường dốc lên đều.', 'Đường đi ngang hoặc dốc xuống gần đây.', 'So các đường trong cùng giai đoạn để biết phong cách nào hợp thị trường hiện tại.'],
    gr: ['Đường RS của từng ngành so với SPY (đặt bằng 100 ở đầu biểu đồ), hoặc điểm ngành dẫn theo thời gian.', 'Đường đi lên, đặc biệt khi lập đỉnh trước khi giá ngành lập đỉnh.', 'Đường đi xuống: ngành kém hơn thị trường.', 'Bấm vào một ngành trong bảng Điểm ngành dẫn để thêm vào biểu đồ.'],
    lb: ['Tổng R cộng dồn của setup đang chọn theo ngày đóng lệnh.', 'Dốc lên đều.', 'Lên xuống thất thường, hoặc dốc lên rồi đi xuống ở phần gần đây.', 'Đường dốc lên đều quan trọng hơn con số tổng: chứng tỏ lợi thế ổn định qua thời gian.'],
    equity: ['Tổng R cộng dồn các lệnh bạn ghi trong nhật ký.', 'Dốc lên.', 'Dốc xuống liên tục.', 'Đây là bằng chứng quan trọng nhất: hệ thống của chính bạn có hiệu quả không.'],
  };
  function attachHelp() {
    for (const [k, [see, good, bad, tip]] of Object.entries(HELP)) {
      const ch = $('#ch-' + k); if (!ch) continue;
      const card = ch.closest('article'); if (!card || card.querySelector('.help')) continue;
      const d = el('details', { class: 'help' }, el('summary', { text: 'Cách đọc biểu đồ này' }),
        el('p', {}, el('b', { text: 'Nhìn gì: ' }), see),
        el('p', {}, el('b', { class: 'up', text: 'Tốt khi: ' }), good, ' ', el('b', { class: 'dn', text: 'Xấu khi: ' }), bad),
        tip ? el('p', {}, el('b', { text: 'Mẹo: ' }), tip) : null);
      const anchor = card.querySelector('.note') || card.querySelector('h3, .card-top');
      anchor.after(d);
    }
  }

  // ------------------------------------------------------------ khởi động
  async function load() {
    // tải latest trước, rồi mọi file khác kèm mã lần chạy để không bao giờ trộn dữ liệu của hai lần chạy khác nhau
    let ver = '';
    const get = async (k) => (await fetch(`data/${k}.json?v=${encodeURIComponent(ver)}`, ver ? {} : { cache: 'no-store' })).json();
    try {
      S.latest = await (await fetch(`data/latest.json?t=${Date.now()}`, { cache: 'no-store' })).json();
      ver = S.latest.generated || String(Date.now());
      [S.history, S.stocks, S.setups, S.extended, S.themes, S.basket] = await Promise.all(['history', 'stocks', 'setups', 'extended', 'themes', 'basket'].map(get));
      [S.industries, S.patterns, S.backtest, S.cycle, S.paper, S.flow, S.lab, S.groups, S.exits, S.smi, S.q25long, S.longbt] = await Promise.all(['industries', 'patterns', 'backtest', 'cycle', 'paper', 'flow', 'lab', 'groups', 'exits', 'smi', 'q25long', 'longbt'].map((k) => get(k).catch(() => null)));
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
    if (L.massive_error) { const b = $('#stale-banner'); b.hidden = false; b.textContent = `Massive lỗi nên đang dùng Yahoo: ${L.massive_error}`; }
    $('#ver').textContent = `Phiên bản ${APP_VERSION}` + (L.version && L.version !== APP_VERSION ? ` · dữ liệu ${L.version}` : '');
    if (!L.demo && L.version !== APP_VERSION) { const b = $('#stale-banner'); b.hidden = false; b.textContent = `Giao diện (${APP_VERSION}) và bộ tính toán (${L.version || 'bản cũ'}) khác phiên bản. Hãy tải lại đủ các thư mục docs và pipeline lên GitHub rồi bấm Run workflow.`; }
    const age = (Date.now() - new Date(L.asof + 'T21:00:00Z').getTime()) / 864e5;
    if (age > 4 && !L.demo) { const b = $('#stale-banner'); b.hidden = false; b.textContent = `Dữ liệu đã cũ ${Math.floor(age)} ngày. Có thể lần chạy tự động gần đây bị lỗi — xem tab Actions trên GitHub.`; }
    if (S.flow && S.flow.stage) { const fb = $('#flow-banner'), F = S.flow, sc = F.scores || {}; fb.hidden = false; fb.style.setProperty('--ph', `var(${STC[F.stage] || '--muted'})`);
      fb.replaceChildren(el('b', { text: `Giai đoạn dòng tiền: ${F.stage}` }), ` · Độ rộng ${n0(sc.breadth)} · Tích lũy ${n0(sc.accum)} · Dẫn dắt ${n0(sc.lead)} · Follow-through ${n0(sc.ft)}` + ((F.warnings || []).length ? ` · ⚠ ${F.warnings.length} cảnh báo` : '') + ' → xem tab Dòng tiền');
      fb.addEventListener('click', () => showTab('flow')); }
    if (!store.get('nk_seen', false)) { const nb = el('div', { class: 'banner start-banner' }, el('b', { text: 'Mới xem lần đầu? ' }), 'Đọc "Bắt đầu ở đây" (10 phút) để hiểu cách dùng trang và cách đọc các biểu đồ. ',
        el('button', { type: 'button', class: 'btn sm', text: 'Xem hướng dẫn', onclick: () => { store.set('nk_seen', true); nb.remove(); showTab('guide'); } }), ' ',
        el('button', { type: 'button', class: 'btn sm ghost', text: 'Ẩn', onclick: () => { store.set('nk_seen', true); nb.remove(); } }));
      $('#stale-banner').after(nb); }
    rangeButtons();
    attachHelp();
    showTab(location.hash.slice(1) || store.get('nk_tab', 'overview'));
  }
  window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { built.clear(); const cur = $('.tabs button[aria-selected=true]').dataset.tab; Object.values(live).forEach((c) => c.remove()); for (const k in live) delete live[k]; showTab(cur); });
  if (!LW) { $('#asof').textContent = 'Không tải được thư viện biểu đồ.'; return; }
  load();
})();
