"""Chốt lãi thế nào? So sánh nhiều cách bán trên CÙNG một tập điểm mua thật, và thống kê xu hướng của cổ phiếu dài/ngắn ra sao.

Điểm mua: cổ phiếu RS ≥ 80, đủ thanh khoản, đóng cửa vượt đỉnh 20 phiên lần đầu với khối lượng ≥ 1,2 lần trung bình
(mỗi mã tối đa một lần trong 20 phiên). Mua giá đóng cửa phiên bứt phá, stop dưới đáy 10 phiên (tối đa 10%).
Mỗi cách bán được mô phỏng trên đúng các điểm mua đó, tối đa 150 phiên, trượt giá 0,1% mỗi lần khớp.
Chỉ dùng các lệnh đã đủ 150 phiên dữ liệu phía sau để không thiên vị lệnh ngắn.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

T = 150
SLIP = 0.001


def _r(x, d=2):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return round(x, d) if math.isfinite(x) else None


def _first(mask):
    """Chỉ số phiên đầu tiên True trên mỗi dòng; T nếu không có."""
    any_ = mask.any(axis=1)
    idx = mask.argmax(axis=1)
    return np.where(any_, idx, T)


def analyze(c: dict, stage: pd.Series | None, start: int) -> dict:
    C, H, L, O, V = c["C"], c["H"], c["L"], c["O"], c["V"]
    rs, liquid, v50 = c["rs"], c["liquid"], c["v50"]
    dates = C.index
    nd = len(dates)
    hp = H.shift(1).rolling(20, min_periods=15).max()
    ev = liquid & (rs >= 80) & (C > hp) & ~(C.shift(1) > hp.shift(1)) & (V >= 1.2 * v50)
    lo10 = L.rolling(10, min_periods=5).min()
    MA = {"e10": C.ewm(span=10, adjust=False).mean(), "e21": C.ewm(span=21, adjust=False).mean(),
          "s20": C.rolling(20).mean(), "s50": C.rolling(50, min_periods=40).mean()}
    Cv, Hv, Lv, Ov = C.values, H.values, L.values, O.values
    MAv = {k: v.values for k, v in MA.items()}
    E = ev.fillna(False).values.astype(bool).copy()
    E[:start] = False
    E[nd - T - 1:] = False   # cần đủ 150 phiên phía sau
    ii, jj = np.nonzero(E)
    order = np.lexsort((ii, jj))
    sel, last = [], {}
    for k in order:
        i, j = ii[k], jj[k]
        if i - last.get(j, -999) < 20:
            continue
        fill = Cv[i, j] * (1 + SLIP)
        sp = lo10.values[i, j] * 0.999
        if not (np.isfinite(fill) and np.isfinite(sp)) or sp >= fill or (fill - sp) / fill > 0.10:
            continue
        sel.append((i, j, fill, sp))
        last[j] = i
    n = len(sel)
    out = {"n": n, "T": T, "from": dates[start].strftime("%Y-%m-%d") if start < nd else None,
           "to": dates[max(0, nd - T - 2)].strftime("%Y-%m-%d"), "exits": [], "trend": {}, "notes": []}
    if n < 30:
        out["notes"].append("Chưa đủ điểm mua có đủ 150 phiên phía sau để thống kê.")
        return out
    I = np.array([s[0] for s in sel]); J = np.array([s[1] for s in sel])
    fill = np.array([s[2] for s in sel]); sp = np.array([s[3] for s in sel])
    R = fill - sp
    off = np.arange(1, T + 1)
    rows = I[:, None] + off[None, :]
    Hh, Ll, Cc, Oo = Hv[rows, J[:, None]], Lv[rows, J[:, None]], Cv[rows, J[:, None]], Ov[rows, J[:, None]]
    Oo = np.where(np.isfinite(Oo), Oo, Cc)
    M = {k: v[rows, J[:, None]] for k, v in MAv.items()}
    nanfill = lambda a: np.where(np.isfinite(a), a, -np.inf)
    Hh, Cc = np.where(np.isfinite(Hh), Hh, Cc), np.where(np.isfinite(Cc), Cc, fill[:, None])
    Ll = np.where(np.isfinite(Ll), Ll, Cc)
    idx = np.broadcast_to(off[None, :] - 1, Hh.shape)
    rr = np.arange(n)
    g = lambda arr, t: arr[rr, np.minimum(t, T - 1)]
    run_hi = np.maximum.accumulate(Hh, axis=1)
    mfe_R = (run_hi[:, -1] - fill) / R

    def stop_px(t, level):
        return np.minimum(g(Oo, t), level) * (1 - SLIP)

    def close_px(t):
        return g(Cc, t) * (1 - SLIP)

    t_stop = _first(Ll <= sp[:, None])

    def trail_only(ma, be_at=None):
        tm = _first(Cc < M[ma]) if ma else np.full(n, T)
        if be_at is None:
            ts = t_stop
            lvl = sp
        else:
            t1 = _first(Hh >= (fill + be_at * R)[:, None])
            ts_a = _first((Ll <= sp[:, None]) & (idx <= t1[:, None]))
            ts_b = _first((Ll <= fill[:, None]) & (idx > t1[:, None]))
            ts = np.minimum(ts_a, ts_b)
            lvl = np.where(ts_a <= ts_b, sp, fill)
        t = np.minimum(ts, tm)
        px = np.where(ts <= tm, stop_px(ts, lvl), close_px(t))
        px = np.where(t >= T, close_px(np.full(n, T - 1)), px)
        return (px - fill) / R, np.minimum(t, T - 1) + 1

    def target(k):
        tt = _first(Hh >= (fill + k * R)[:, None])
        px = np.where(tt < t_stop, np.maximum(g(Oo, tt), fill + k * R) * (1 - SLIP), stop_px(t_stop, sp))
        t = np.minimum(tt, t_stop)
        px = np.where(t >= T, close_px(np.full(n, T - 1)), px)
        return (px - fill) / R, np.minimum(t, T - 1) + 1

    def partials(parts, ma, ma_after_first=True):
        """parts: [(mức lãi tính theo R hoặc %, phần bán, 'R'|'pct')]. Sau lần chốt đầu dời stop về hòa vốn, phần còn lại thoát theo MA."""
        res = np.zeros(n)
        rem = np.ones(n)
        lvls = [(fill + v * R) if kind == "R" else fill * (1 + v / 100) for v, _, kind in parts]
        t_first = _first(Hh >= lvls[0][:, None])
        before = t_stop < t_first   # bị stop trước khi chốt được phần nào
        res = np.where(before, (stop_px(t_stop, sp) - fill) / R, 0.0)
        hold_days = np.where(before, np.minimum(t_stop, T - 1) + 1, 0)
        # sau lần chốt đầu: stop hòa vốn, thoát theo MA, các mục tiêu tiếp theo
        t_be = _first((Ll <= fill[:, None]) & (idx > t_first[:, None]))
        tm = _first((Cc < M[ma]) & (idx > (t_first if ma_after_first else -1)[:, None])) if ma else np.full(n, T)
        t_end = np.minimum(t_be, tm)
        for (v, frac, kind), lv in zip(parts, lvls):
            tk = _first(Hh >= lv[:, None])
            hit = (~before) & (tk < T) & (tk <= t_end) & (tk >= t_first)
            res += np.where(hit, frac * (np.maximum(g(Oo, tk), lv) * (1 - SLIP) - fill) / R, 0)
            rem -= np.where(hit, frac, 0)
        end_px = np.where(t_be <= tm, stop_px(t_be, fill), close_px(t_end))
        end_px = np.where(t_end >= T, close_px(np.full(n, T - 1)), end_px)
        res += np.where(before, 0, rem * (end_px - fill) / R)
        hold_days = np.where(before, hold_days, np.minimum(t_end, T - 1) + 1)
        return res, hold_days

    def giveback(thr_pct=20, keep=0.5, ma="s50"):
        """Để lãi chạy theo MA50, nhưng khi đã lãi từ thr_pct% thì không trả lại quá (1-keep) phần lãi lớn nhất, hoặc thủng MA20."""
        armed = run_hi >= (fill * (1 + thr_pct / 100))[:, None]
        floor = fill[:, None] + keep * (run_hi - fill[:, None])
        tg = _first(armed & ((Cc < floor) | (Cc < M["s20"])))
        tm = _first(Cc < M[ma])
        t = np.minimum.reduce([t_stop, tg, tm])
        px = np.where(t_stop <= np.minimum(tg, tm), stop_px(t_stop, sp), close_px(t))
        px = np.where(t >= T, close_px(np.full(n, T - 1)), px)
        return (px - fill) / R, np.minimum(t, T - 1) + 1

    strategies = [
        ("t2", "Bán hết tại +2R", "Mục tiêu cố định: chốt toàn bộ khi lãi gấp 2 lần rủi ro.", lambda: target(2)),
        ("t3", "Bán hết tại +3R", "Mục tiêu cố định gấp 3 lần rủi ro.", lambda: target(3)),
        ("e10", "Giữ tới khi đóng cửa dưới EMA 10", "Không chốt từng phần, thoát nhanh theo EMA 10.", lambda: trail_only("e10")),
        ("s20", "Giữ tới khi đóng cửa dưới MA 20", "Không chốt từng phần, thoát khi thủng MA 20.", lambda: trail_only("s20")),
        ("s50", "Giữ tới khi đóng cửa dưới MA 50", "Không chốt từng phần, giữ tới khi thủng MA 50.", lambda: trail_only("s50")),
        ("be20", "Hòa vốn ở +1R, rồi theo MA 20", "Lãi +1R thì dời stop về giá mua, sau đó thoát khi thủng MA 20.", lambda: trail_only("s20", be_at=1)),
        ("p2e21", "Chốt 1/2 tại +2R, phần còn lại theo EMA 21", "Cách hiện dùng trong tab Hiệu quả setup.", lambda: partials([(2, 0.5, "R")], "e21")),
        ("p3s50", "Chốt 1/3 tại +2R, 1/3 tại +5R, còn lại theo MA 50", "Chốt dần vào sức mạnh, giữ phần cuối cho xu hướng dài.", lambda: partials([(2, 1 / 3, "R"), (5, 1 / 3, "R")], "s50")),
        ("pp", "Chốt 1/3 tại +20%, 1/3 tại +40%, còn lại theo MA 50", "Chốt theo % lãi (kiểu O'Neil/Minervini), phần cuối theo MA 50.", lambda: partials([(20, 1 / 3, "pct"), (40, 1 / 3, "pct")], "s50")),
        ("gb", "Theo MA 50 + không trả lại quá 1/2 lãi khi đã lãi ≥ 20%", "Để lãi chạy, nhưng khi đã lãi lớn thì bảo vệ một nửa phần lãi cao nhất (hoặc thoát khi thủng MA 20).", lambda: giveback()),
    ]
    st_arr = stage.values if stage is not None else None
    for key, name, desc, fn in strategies:
        r_, h_ = fn()
        r_ = np.where(np.isfinite(r_), r_, 0)
        w = r_ > 0
        srt = np.sort(r_)[::-1]
        top = max(1, int(round(n * 0.1)))
        pos = r_[w].sum()
        row = {"key": key, "name": name, "desc": desc, "n": n, "win": _r(w.mean() * 100, 0), "exp": _r(r_.mean()), "avg_w": _r(r_[w].mean()) if w.any() else None,
               "avg_l": _r(r_[~w].mean()) if (~w).any() else None, "best": _r(srt[0], 1), "hold": _r(h_.mean(), 0),
               "top10": _r(srt[:top].sum() / pos * 100, 0) if pos > 0 else None, "kept": _r(np.mean(np.clip(r_, 0, None)[mfe_R >= 3] / mfe_R[mfe_R >= 3]) * 100, 0) if (mfe_R >= 3).any() else None,
               "total": _r(r_.sum(), 0)}
        if st_arr is not None:
            by = {}
            for s_ in ("Uptrend xác nhận", "Dòng tiền lan rộng", "Chưa rõ ràng", "Phân phối / suy yếu", "Xu hướng giảm", "Hồi phục ban đầu"):
                m = np.array([st_arr[i] == s_ for i in I])
                if m.sum() >= 10:
                    by[s_] = {"n": int(m.sum()), "exp": _r(r_[m].mean())}
            row["by_stage"] = by
        out["exits"].append(row)
    out["exits"].sort(key=lambda x: -(x["exp"] or -9))

    # ---- xu hướng của cổ phiếu sau điểm mua dài hay ngắn
    def dur(ma):
        t = _first(Cc < M[ma])
        return np.minimum(t, T) + 0
    d50, d21 = dur("s50"), dur("e21")
    t50 = np.minimum(d50, T - 1)
    peak_in_trend = np.array([Hh[k, :t50[k] + 1].max() for k in range(n)])
    gain_trend = (peak_in_trend / fill - 1) * 100
    mfe_pct = (run_hi[:, -1] / fill - 1) * 100
    bins = [(0, 5, "Dưới 1 tuần"), (5, 10, "1–2 tuần"), (10, 20, "2–4 tuần"), (20, 40, "1–2 tháng"), (40, 60, "2–3 tháng"), (60, 120, "3–6 tháng"), (120, T + 1, "Trên 6 tháng")]
    dist = lambda d: [{"label": lb, "pct": _r(((d >= a) & (d < b)).mean() * 100, 0)} for a, b, lb in bins]
    gb = [(-1e9, 0, "Không lãi"), (0, 10, "0–10%"), (10, 20, "10–20%"), (20, 50, "20–50%"), (50, 100, "50–100%"), (100, 1e9, "Trên 100%")]
    out["trend"] = {
        "d50": dist(d50), "d21": dist(d21), "med50": _r(np.median(d50), 0), "med21": _r(np.median(d21), 0),
        "gain": [{"label": lb, "pct": _r(((gain_trend >= a) & (gain_trend < b)).mean() * 100, 0)} for a, b, lb in gb],
        "reach": [{"label": f"Từng lãi ≥ {x}% trong 150 phiên", "pct": _r((mfe_pct >= x).mean() * 100, 0)} for x in (10, 20, 30, 50, 100)],
        "giveback": _r(np.median(((peak_in_trend - Cc[rr, t50]) / (peak_in_trend - fill))[gain_trend >= 20] * 100), 0) if (gain_trend >= 20).any() else None,
        "big_then_loss": _r(((mfe_pct >= 20) & ((Cc[rr, t50] / fill - 1) * 100 < 5)).mean() * 100, 1),
    }
    best = out["exits"][0]
    s50 = next(x for x in out["exits"] if x["key"] == "s50")
    out["notes"] = [
        f"{n} điểm mua thật (RS ≥ 80, bứt phá đỉnh 20 phiên có khối lượng) từ {out['from']} đến {out['to']}, mỗi điểm theo dõi đủ 150 phiên.",
        f"Cách bán có kỳ vọng tốt nhất: {best['name']} ({best['exp']:+.2f}R mỗi lệnh, thắng {best['win']:.0f}%).".replace(".", ",", 1),
        f"Một nửa số mã giữ được trên MA 50 không quá {out['trend']['med50']:.0f} phiên sau điểm mua; chỉ {sum(x['pct'] or 0 for x in out['trend']['d50'][5:]):.0f}% giữ được trên 3 tháng.",
        f"{out['trend']['big_then_loss']:.0f}% số lệnh từng lãi ≥ 20% nhưng nếu chờ thủng MA 50 mới bán thì chỉ còn lãi dưới 5% hoặc lỗ: đây là cái giá của việc không chốt khi đang lãi lớn.",
        f"Với cách 'giữ tới thủng MA 50', 10% lệnh tốt nhất tạo ra {(s50['top10'] or 0):.0f}% tổng lãi: lợi nhuận đến từ số ít siêu cổ phiếu, nên cần giữ một phần cho chúng.",
    ]
    return out
