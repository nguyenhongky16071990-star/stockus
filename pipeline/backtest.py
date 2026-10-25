"""Kiểm chứng ngược (backtest) phương pháp của từng huyền thoại và VSA.

Mỗi phương pháp gồm: tín hiệu (chỉ dùng giá và khối lượng, vì không có số liệu
lợi nhuận lịch sử), cách vào lệnh, stop ban đầu và quy tắc bán đúng như người đó
mô tả. Kết quả tính theo R (bội số rủi ro): 1R = giá mua − stop.

Quy tắc vào/ra lệnh và điều kiện thị trường giống hệt tab Mô phỏng (paper.py), trượt giá 0,1% mỗi lần khớp;
mỗi mã chỉ một lệnh mở cho mỗi phương pháp, không giới hạn vốn;
chỉ dùng các mã còn niêm yết hôm nay (có thiên lệch sống sót).
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def _r(x, d=2):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return None if not np.isfinite(x) else round(x, d)


# ---------------------------------------------------------------- VSA (Tom Williams / Wyckoff), chỉ phía mua
def vsa_signals(O, H, L, C, V, e21, e50, s150, v50, liquid):
    rng = H - L
    rng20 = rng.rolling(20, min_periods=10).mean()
    v20 = V.rolling(20, min_periods=10).mean()
    pos = (C - L) / rng.replace(0, np.nan)               # vị trí giá đóng cửa trong thanh: 1 = sát đỉnh
    up_ctx = (C > e50) & (e21 > e21.shift(5))            # bối cảnh xu hướng tăng
    lowest20 = L.shift(1).rolling(20, min_periods=10).min()
    sig = {
        # Không có cung: thanh giảm, biên độ hẹp, khối lượng thấp hơn 2 phiên trước, trong xu hướng tăng
        "Không có cung": up_ctx & (C < C.shift(1)) & (rng < 0.7 * rng20) & (V < V.shift(1)) & (V < V.shift(2)),
        # Kiểm định cung: thủng đáy 3 phiên nhưng đóng cửa ở nửa trên, khối lượng thấp
        "Kiểm định cung": up_ctx & (L < L.shift(1).rolling(3).min()) & (pos >= 0.5) & (V < 0.8 * v20),
        # Rũ bỏ (spring/shakeout): thủng đáy 20 phiên rồi đóng cửa nửa trên, khối lượng lớn
        "Rũ bỏ (spring)": (C > s150 * 0.9) & (L < lowest20) & (pos >= 0.5) & (V > 1.5 * v50),
        # Khối lượng chặn đà giảm: phiên giảm khối lượng rất lớn nhưng đóng cửa xa đáy, sau nhịp điều chỉnh
        "Khối lượng chặn": (C < e21) & (C > s150 * 0.9) & (V > 2 * v50) & (pos >= 0.5) & (C.shift(1) < C.shift(5)),
    }
    return {k: (v & liquid).fillna(False).astype(bool) for k, v in sig.items()}


# ---------------------------------------------------------------- mô phỏng
def simulate(name, sig, spec, P, dates, regime, start, max_stop=12.0):
    """sig: DataFrame bool; spec: cách vào/ra lệnh; P: dict các mảng numpy (ngày × mã)."""
    O, H, L, C = P["O"], P["H"], P["L"], P["C"]
    e9, e21, s150 = P["e9"], P["e21"], P["s150"]
    nd, nt = C.shape
    sv = sig.values
    lvl = spec["lvl"].values if spec.get("lvl") is not None else None
    stp = spec["stop"].values
    trades = []
    busy_until = np.full(nt, -1)
    rows, cols = np.nonzero(sv[start:nd - 1])
    order = np.lexsort((cols, rows))
    for k in order:
        d, j = rows[k] + start, cols[k]
        if d <= busy_until[j]:
            continue
        # vào lệnh
        if spec["entry"] == "stop":
            # lệnh chờ mua khi vượt mức giá; còn hiệu lực "pending" phiên, hủy nếu giá thủng stop trước khi khớp
            lv, e0 = lvl[d, j], None
            if not np.isfinite(lv):
                continue
            for q in range(d + 1, min(nd, d + 1 + spec.get("pending", 1))):
                if np.isfinite(H[q, j]) and H[q, j] >= lv:
                    e0 = q
                    break
                if np.isfinite(L[q, j]) and L[q, j] <= stp[d, j]:
                    break
            if e0 is None:
                continue
            entry = max(O[e0, j], lv) if np.isfinite(O[e0, j]) else lv
        else:
            e0 = d
            entry = C[d, j]
        stop = stp[d, j]
        if not (np.isfinite(entry) and np.isfinite(stop)) or stop >= entry:
            continue
        risk = entry - stop
        if risk / entry * 100 > spec.get("max_stop", max_stop):
            continue
        rem, realized, reason, exit_i = 1.0, 0.0, None, None
        done_parts = set()
        be = False
        # ngày vào lệnh: kiểm tra chạm stop (thận trọng)
        if spec["entry"] == "stop" and L[e0, j] <= stop:
            realized, rem, reason, exit_i = (stop - entry) / risk, 0.0, "Chạm stop", e0
        i = e0
        while rem > 1e-9:
            i += 1
            if i >= nd:
                break
            o, h, l, c = O[i, j], H[i, j], L[i, j], C[i, j]
            if not np.isfinite(c):
                continue
            cur_stop = entry if be else stop
            if l <= cur_stop:
                px = min(o, cur_stop) if np.isfinite(o) else cur_stop
                realized += rem * (px - entry) / risk
                rem, reason, exit_i = 0.0, ("Hòa vốn" if be else "Chạm stop"), i
                break
            for pi, (kind, val, frac) in enumerate(spec.get("partials", [])):
                if pi in done_parts or rem <= 1e-9:
                    continue
                hit, px = False, None
                if kind == "R" and h >= entry + val * risk:
                    hit, px = True, max(o, entry + val * risk) if np.isfinite(o) else entry + val * risk
                elif kind == "pct" and h >= entry * (1 + val / 100):
                    hit, px = True, max(o, entry * (1 + val / 100)) if np.isfinite(o) else entry * (1 + val / 100)
                elif kind == "day" and i - e0 >= val:
                    hit, px = True, c
                elif kind == "ext9" and np.isfinite(e9[i, j]) and c >= e9[i, j] * (1 + val / 100):
                    hit, px = True, c
                if hit:
                    f = min(frac, rem)
                    realized += f * (px - entry) / risk
                    rem -= f
                    done_parts.add(pi)
                    if spec.get("be_after_partial"):
                        be = True
                    if rem <= 1e-9:
                        reason, exit_i = "Chốt lời", i
            if rem <= 1e-9:
                break
            tr = spec.get("trail")
            tv = {"e9": e9, "e21": e21, "s150": s150}.get(tr)
            if tv is not None and np.isfinite(tv[i, j]) and c < tv[i, j] and i > e0 + spec.get("trail_after", 0):
                realized += rem * (c - entry) / risk
                rem, reason, exit_i = 0.0, f"Đóng cửa dưới {dict(e9='EMA 9', e21='EMA 21', s150='đường 30 tuần')[tr]}", i
                break
            if i - e0 >= spec["max_hold"]:
                realized += rem * (c - entry) / risk
                rem, reason, exit_i = 0.0, "Hết thời gian giữ", i
                break
        open_ = rem > 1e-9
        if open_:
            last = C[nd - 1, j]
            realized += rem * (last - entry) / risk
            exit_i = nd - 1
            reason = "Đang mở"
        busy_until[j] = exit_i
        trades.append({"j": j, "d": e0, "x": exit_i, "entry": entry, "stop": stop, "r": realized,
                       "pct": realized * risk / entry * 100, "days": exit_i - e0, "why": reason, "open": open_,
                       "reg": regime[e0] if regime is not None else None})
    return trades


# ---------------------------------------------------------------- mô phỏng theo đúng quy tắc của tab Mô phỏng (paper.py)
SLIP = 0.001
MA_NAME = {"e9": "EMA 9", "e10": "EMA 10", "e21": "EMA 21", "s10": "SMA 10", "s20": "SMA 20", "s50": "SMA 50", "s150": "đường 30 tuần"}


def simulate_rules(name, sig, spec, A, dates, regime, start, mexit=None):
    """Giống paper._step_position nhưng không giới hạn vốn: mỗi tín hiệu là một lệnh, tính theo R sau trượt giá."""
    O, H, L, C, V = A["O"], A["H"], A["L"], A["C"], A["V"]
    nd, nt = C.shape
    sv = sig.values
    lvlA = spec["lvl"].values if spec.get("lvl") is not None else None
    stpA = spec["stop"].values
    trades, busy = [], np.full(nt, -1)
    rows, cols = np.nonzero(sv[start:nd - 1])
    order = np.lexsort((rows, cols))
    for k in order:
        d, j = rows[k] + start, cols[k]
        if d <= busy[j]:
            continue
        sp0 = stpA[d, j]
        if spec["entry"] == "stop":
            lv, e0 = lvlA[d, j], None
            if not (np.isfinite(lv) and np.isfinite(sp0)) or sp0 >= lv:
                continue
            for q in range(d + 1, min(nd, d + 1 + spec.get("pending", 1))):
                if not np.isfinite(H[q, j]):
                    break
                if H[q, j] >= lv:
                    e0 = q
                    break
                if L[q, j] <= sp0:
                    break
            if e0 is None:
                busy[j] = d + spec.get("pending", 1)
                continue
            fill = max(O[e0, j], lv) if np.isfinite(O[e0, j]) else lv
            if spec.get("chase") and fill > lv * spec["chase"]:
                busy[j] = e0
                continue
            fill *= 1 + SLIP
        else:
            e0, fill = d, C[d, j] * (1 + SLIP)
        stop = fill * (1 - spec["stop_pct"] / 100) if spec.get("stop_pct") else sp0
        if not (np.isfinite(fill) and np.isfinite(stop)) or stop >= fill:
            continue
        risk = fill - stop
        if risk / fill * 100 > spec.get("max_stop", 12):
            continue
        trail_ma = spec.get("trail")
        if callable(trail_ma):
            trail_ma = trail_ma(d, j)
        st = {"stop": stop, "rem": 1.0, "r": 0.0, "done": set(), "be": False, "hold8": False, "nd": False}
        reason, x = None, None

        def sell(frac, px):
            f = min(frac, st["rem"])
            st["r"] += f * (px - fill) / risk
            st["rem"] -= f

        # phiên mua
        if spec["entry"] == "stop" and L[e0, j] <= stop:
            sell(1, stop * (1 - SLIP))
            reason, x = "Chạm stop ngay phiên mua", e0
        elif spec.get("vol") and np.isfinite(A["v50"][e0, j]) and V[e0, j] < spec["vol"] * A["v50"][e0, j] and C[e0, j] < fill:
            sell(1, C[e0, j] * (1 - SLIP))
            reason, x = "Bứt phá thiếu khối lượng", e0
        elif spec.get("lod") and L[e0, j] * 0.999 > st["stop"] and L[e0, j] < fill:
            st["stop"] = L[e0, j] * 0.999
        i = e0
        while x is None:
            i += 1
            if i >= nd:
                break
            o, h, l, c = O[i, j], H[i, j], L[i, j], C[i, j]
            if not np.isfinite(c):
                continue
            o = o if np.isfinite(o) else c
            held = i - e0 + 1
            if l <= st["stop"]:
                sell(1, min(o, st["stop"]) * (1 - SLIP))
                reason, x = ("Hòa vốn" if st["be"] and st["stop"] >= fill else ("Stop đã dời" if st["stop"] > stop else "Chạm stop")), i
                break
            if spec.get("be_r") and h >= fill + spec["be_r"] * risk and st["stop"] < fill:
                st["stop"], st["be"] = fill, True
            for pi, pt in enumerate(spec.get("partials", [])):
                if pi in st["done"] or st["rem"] <= 1e-9:
                    continue
                kind, px = pt[0], None
                if kind == "R" and h >= fill + pt[1] * risk:
                    px, frac, be = max(o, fill + pt[1] * risk), pt[2], pt[3]
                elif kind == "pct" and h >= fill * (1 + pt[1] / 100):
                    px, frac, be = max(o, fill * (1 + pt[1] / 100)), pt[2], pt[3]
                elif kind == "day_profit" and held >= pt[1] and c > fill:
                    px, frac, be = c * (1 - SLIP), pt[2], pt[3]
                elif kind == "ext" and np.isfinite(A[pt[1]][i, j]) and c >= A[pt[1]][i, j] * (1 + pt[2] / 100):
                    px, frac, be = c * (1 - SLIP), pt[3], pt[4]
                if px is not None:
                    sell(frac, px)
                    st["done"].add(pi)
                    if be and st["stop"] < fill:
                        st["stop"], st["be"] = fill, True
            if st["rem"] <= 1e-9:
                reason, x = "Chốt lời", i
                break
            if spec.get("oneil"):
                if not st["hold8"] and h >= fill * 1.2:
                    if held <= 15:
                        st["hold8"] = True
                        st["stop"], st["be"] = max(st["stop"], fill), True
                    else:
                        sell(1, max(o, fill * 1.2))
                        reason, x = "Chốt hết tại +20%", i
                        break
                s50v, v50v = A["s50"][i, j], A["v50"][i, j]
                if np.isfinite(s50v) and c < s50v and ((np.isfinite(v50v) and V[i, j] >= 1.5 * v50v and (not st["hold8"] or held > 40)) or (st["hold8"] and held > 40)):
                    sell(1, c * (1 - SLIP))
                    reason, x = "Thủng SMA 50", i
                    break
            if spec.get("weekly") and A["wk_end"][i]:
                if np.isfinite(A["s150"][i, j]) and c < A["s150"][i, j]:
                    sell(1, c * (1 - SLIP))
                    reason, x = "Tuần đóng cửa dưới đường 30 tuần", i
                    break
                lo = A["lo20"][i, j]
                if np.isfinite(lo) and st["stop"] < lo * 0.99 < c:
                    st["stop"] = lo * 0.99
            if spec.get("vsa") and np.isfinite(A["v20"][i, j]) and np.isfinite(A["rng20"][i, j]):
                rng = h - l
                pb = (c - l) / rng if rng > 0 else 0.5
                vv, v20 = V[i, j], A["v20"][i, j]
                if np.isfinite(A["hi20"][i, j]) and h > A["hi20"][i, j] and pb <= 0.33 and vv >= 1.5 * v20:
                    sell(1, c * (1 - SLIP)); reason, x = "VSA: Upthrust", i; break
                if vv >= 2 * v20 and rng >= 1.8 * A["rng20"][i, j] and pb < 0.5 and c > fill:
                    sell(1, c * (1 - SLIP)); reason, x = "VSA: Buying climax", i; break
                if (not st["nd"] and c > C[i - 1, j] and rng < 0.7 * A["rng20"][i, j] and vv < V[i - 1, j] and vv < V[i - 2, j]
                        and np.isfinite(A["hi20"][i, j]) and h >= A["hi20"][i, j] * 0.97 and c > fill):
                    st["nd"] = True
                    sell(0.5, c * (1 - SLIP))
            if spec.get("nofollow") and held >= spec["nofollow"] and c <= fill and not st["done"]:
                sell(1, c * (1 - SLIP)); reason, x = "Không bứt tiếp", i; break
            if held > spec.get("trail_after", 0):
                stage_ = "post" if st["done"] else "pre"
                hit = None
                for ma, when in ([[trail_ma, "post"]] if isinstance(trail_ma, str) else []) + spec.get("trail_list", []):
                    if when in (stage_, "all") and np.isfinite(A[ma][i, j]) and c < A[ma][i, j]:
                        hit = ma
                        break
                if hit:
                    sell(1, c * (1 - SLIP)); reason, x = f"Đóng cửa dưới {MA_NAME[hit]}", i; break
            if mexit is not None and mexit[i]:
                sell(1, c * (1 - SLIP)); reason, x = "Phòng thủ: thị trường xấu, bán hết", i; break
            if held >= spec["max_hold"]:
                sell(1, c * (1 - SLIP)); reason, x = "Hết thời gian giữ", i; break
        open_ = x is None
        if open_:
            st["r"] += st["rem"] * (C[nd - 1, j] - fill) / risk
            x, reason = nd - 1, "Đang mở"
        busy[j] = x
        trades.append({"j": j, "d": e0, "x": x, "entry": fill, "stop": stop, "r": st["r"], "pct": st["r"] * risk / fill * 100,
                       "days": x - e0, "why": reason, "open": open_, "reg": regime[e0] if regime is not None else None})
    return trades


def summarize(trades, dates, tickers, recent_from):
    closed = [t for t in trades if not t["open"]]
    def stats(ts):
        if not ts:
            return {"n": 0}
        r = np.array([t["r"] for t in ts])
        pct = np.array([t["pct"] for t in ts])
        wins, losses = r[r > 0], r[r <= 0]
        return {"n": len(ts), "win": _r((r > 0).mean() * 100, 0),
                "avg_win": _r(pct[r > 0].mean(), 1) if len(wins) else None,
                "avg_loss": _r(pct[r <= 0].mean(), 1) if len(losses) else None,
                "pf": _r(wins.sum() / -losses.sum(), 2) if len(losses) and losses.sum() < 0 else None,
                "exp": _r(r.mean(), 2), "total": _r(r.sum(), 1), "hold": _r(np.mean([t["days"] for t in ts]), 1),
                "best": _r(r.max(), 1), "worst": _r(r.min(), 1)}
    out = stats(closed)
    out["recent"] = stats([t for t in closed if t["x"] >= recent_from])
    out["by_reg"] = {g: stats([t for t in closed if t["reg"] == g]) for g in ("Tốt", "Giằng co", "Xấu")}
    out["open"] = sum(1 for t in trades if t["open"])
    # đường cộng dồn R theo ngày đóng lệnh
    s = pd.Series(0.0, index=range(len(dates)))
    for t in closed:
        s[t["x"]] += t["r"]
    cum = s.cumsum()
    step = max(1, len(dates) // 250)
    first = min([t["d"] for t in trades], default=len(dates) - 1)
    out["curve"] = [[dates[i].strftime("%Y-%m-%d"), _r(cum[i], 1)] for i in range(first, len(dates), step)]
    if out["curve"] and out["curve"][-1][0] != dates[-1].strftime("%Y-%m-%d"):
        out["curve"].append([dates[-1].strftime("%Y-%m-%d"), _r(cum.iloc[-1], 1)])
    last = sorted(trades, key=lambda t: -t["d"])[:25]
    out["trades"] = [{"t": tickers[t["j"]], "in": dates[t["d"]].strftime("%Y-%m-%d"), "out": dates[t["x"]].strftime("%Y-%m-%d"),
                      "entry": _r(t["entry"]), "stop": _r(t["stop"]), "r": _r(t["r"]), "pct": _r(t["pct"], 1),
                      "days": int(t["days"]), "why": t["why"], "open": t["open"]} for t in last]
    return out


def run(ctx: dict, cfg: dict) -> dict:
    """ctx chứa các bảng (ngày × mã) đã tính trong build.compute."""
    O, H, L, C, V = ctx["O"], ctx["H"], ctx["L"], ctx["C"], ctx["V"]
    e9, e21, e50, s150, v50 = ctx["e9"], ctx["e21"], ctx["e50"], ctx["s150"], ctx["v50"]
    adr, dv, liquid, rs, rs_pos = ctx["adr"], ctx["dv"], ctx["liquid"], ctx["rs"], ctx["rs_pos"]
    tt, ret, hi20, hiprev, dd_hi, udv, stage, indr = (ctx[k] for k in ("tt", "ret", "hi20", "hiprev", "dd_hi", "udv", "stage", "ind_rank"))
    n_ind = ctx["n_ind"]
    dates = C.index
    nd = len(dates)
    qreg = ctx["qqq_regime"].reindex(dates).values
    ddq = ctx["dd_qqq"].reindex(dates).fillna(0)
    mkt_ok = pd.Series((qreg != "Xấu") & (ddq.values <= 5), index=dates)
    mk = pd.DataFrame(np.broadcast_to(mkt_ok.values[:, None], C.shape), index=dates, columns=C.columns)
    mk_ml = pd.DataFrame(np.broadcast_to((qreg != "Xấu")[:, None], C.shape), index=dates, columns=C.columns)

    rng5 = ((H - L) / C * 100).rolling(5).mean()
    d9 = (C / e9 - 1) * 100
    e21up = (C > e21) & (e21 > e21.shift(5))
    inside = (H <= H.shift(1)) & (L >= L.shift(1))
    conv = (e9 - e21).abs() / C < 0.015
    reclaim9 = (L < e9) & (C > e9)
    tight = (rng5 < 0.6 * adr) & (C >= 0.92 * hi20)
    gap_ep = (O / C.shift(1) - 1 >= 0.08) & (V >= 3 * v50) & (C > e50)
    brk = (C > hiprev) & (V >= 1.5 * v50)
    low3 = L.rolling(3, min_periods=1).min()
    piv20 = H.rolling(20, min_periods=10).max()
    lo10 = L.rolling(10, min_periods=5).min()
    top = rs_pos <= cfg.get("basket_size", 100)

    # điều kiện thị trường riêng của từng người (giống tab Mô phỏng)
    qc = ctx["qqq_close"].reindex(dates)
    q_e21, q_s10, q_s20, q_s50 = qc.ewm(span=21, adjust=False).mean(), qc.rolling(10).mean(), qc.rolling(20).mean(), qc.rolling(50, min_periods=40).mean()
    q_s150 = qc.rolling(150, min_periods=100).mean()
    bc = lambda m: pd.DataFrame(np.broadcast_to(m.fillna(False).values[:, None], C.shape), index=dates, columns=C.columns)
    M = {"ml": bc((qc > q_e21) & pd.Series(qreg != "Xấu", index=dates)), "qm": bc((qc > q_s20) & (q_s10 > q_s20)), "mm": bc(qc > q_s50),
         "wo": mk, "sw": bc((qc > q_s150) & (q_s150 > q_s150.shift(20))), "pb": bc(qc > q_s20), "ok": bc(qc > q_e21), "vs": bc(qc > q_s50)}
    lo10 = L.rolling(10, min_periods=5).min()
    pv = piv20 * 1.001
    S = {}
    S["ml"] = (liquid & top & (adr >= 4) & e21up & (d9.abs() <= 5) & (reclaim9 | inside | conv) & M["ml"],
               dict(entry="stop", lvl=H * 1.001, stop=L * 0.999, pending=1, chase=1.03, max_stop=cfg.get("max_stop_pct", 6), lod=True,
                    partials=[["R", 2, 0.25, True], ["R", 4, 0.25, False]], trail_list=[["e21", "pre"], ["e9", "post"]], max_hold=60))
    adrv = adr.values
    S["qm"] = (liquid & ((ret[21] >= 0.3) | (ret[63] >= 0.3)) & (adr >= 4) & (dv >= 20e6) & (C > e21) & (tight | gap_ep) & M["qm"],
               dict(entry="stop", lvl=H * 1.001, stop=np.maximum(L * 0.999, H * 1.001 * (1 - adr / 100)), pending=1, chase=1.05, max_stop=12, lod=True,
                    partials=[["day_profit", 3, 0.5, True]], trail=lambda d, j: "s10" if adrv[d, j] >= 6 else "s20", trail_after=0, max_hold=150))
    vcp = (rng5 < 0.7 * adr) & (C >= 0.9 * piv20) & (V.rolling(5).mean() < v50)
    S["mm"] = (liquid & tt & (rs >= 80) & (dd_hi >= -25) & vcp & M["mm"],
               dict(entry="stop", lvl=pv, pending=5, chase=1.05, stop=np.maximum(pv * 0.92, lo10 * 0.999), max_stop=8.5, vol=1.4, be_r=2,
                    partials=[["R", 3, 1 / 3, True], ["R", 5, 1 / 3, True]], trail_list=[["s50", "pre"], ["s20", "post"]], trail_after=3, max_hold=150))
    grp20 = indr <= max(1, round(n_ind * 0.2))
    S["wo"] = (liquid & (rs >= 80) & (dd_hi >= -15) & (udv >= 1.1) & grp20 & M["wo"],
               dict(entry="stop", lvl=pv, pending=5, chase=1.05, stop=pv * 0.925, stop_pct=7.5, max_stop=8.5, vol=1.4, oneil=True, max_hold=150))
    s150b = (s150 * 0.99).where(s150 < pv, lo10 * 0.999)
    S["sw"] = (liquid & (stage == 2) & (rs >= 70) & (indr <= n_ind / 2) & (udv >= 1) & M["sw"],
               dict(entry="stop", lvl=pv, pending=5, chase=1.05, stop=np.maximum(s150b, pv * 0.85), max_stop=15.5, vol=1.5, weekly=True, max_hold=260))
    S["pb"] = (liquid & (ret[1] >= 0.04) & (V > V.shift(1)) & (V >= 1.5 * v50) & ((ret[21] - ret[1]) <= 0.25) & (dv >= 5e6) & M["pb"],
               dict(entry="close", stop=L * 0.999, max_stop=10, partials=[["pct", 8, 0.5, True]], nofollow=3, max_hold=5))
    cross = (low3 <= e21 * 1.01) & (C > e9) & (C > H.shift(1))
    S["ok"] = (liquid & (rs_pos <= 200) & e21up & cross & (d9 <= 8) & M["ok"],
               dict(entry="stop", lvl=H * 1.001, pending=2, chase=1.04, stop=np.minimum(L, e21) * 0.995, max_stop=10,
                    partials=[["ext", "e10", 15, 0.5, True]], trail_list=[["e21", "pre"], ["e10", "post"]], trail_after=1, max_hold=90))
    vsa = vsa_signals(O, H, L, C, V, e21, e50, ctx["s150"], v50, liquid)
    any_vsa = vsa["Không có cung"] | vsa["Kiểm định cung"] | vsa["Rũ bỏ (spring)"] | vsa["Khối lượng chặn"]
    vspec = dict(entry="stop", lvl=H * 1.001, pending=3, stop=L * 0.995, max_stop=10, be_r=2, vsa=True, max_hold=60)
    S["vs"] = (any_vsa & (rs >= 50) & M["vs"], vspec)
    wk = pd.Series(dates.to_period("W"), index=dates)
    A = {"O": O.values, "H": H.values, "L": L.values, "C": C.values, "V": V.values, "e9": e9.values, "e21": e21.values,
         "e10": C.ewm(span=10, adjust=False).mean().values, "s10": C.rolling(10).mean().values, "s20": C.rolling(20).mean().values,
         "s50": C.rolling(50, min_periods=40).mean().values, "s150": s150.values, "v50": V.rolling(50, min_periods=20).mean().shift(1).values,
         "v20": V.rolling(20, min_periods=10).mean().shift(1).values, "rng20": (H - L).rolling(20).mean().shift(1).values,
         "hi20": H.rolling(20).max().shift(1).values, "lo20": L.rolling(20).min().values, "wk_end": (wk != wk.shift(-1)).values}
    P = {k: v.values for k, v in (("O", O), ("H", H), ("L", L), ("C", C), ("e9", e9), ("e21", e21), ("s150", s150))}
    start = max(260, nd - int(cfg.get("bt_days", 500)))
    start = min(start, nd - 30)
    recent_from = nd - 60
    tickers = list(C.columns)
    # ---- quy tắc phòng thủ: chỉ số mất điều kiện của người đó 2 phiên liên tiếp thì bán hết; luật chung: thị trường xấu thì đứng ngoài
    q_e9 = qc.ewm(span=9, adjust=False).mean()
    BAD = {"ml": (qc < q_e21) & (q_e9 < q_e21), "qm": (qc < q_s20) & (q_s10 < q_s20), "mm": qc < q_s50, "wo": (qc < q_s50) & (qc < q_e21),
           "sw": qc < q_s150, "pb": qc < q_s20, "ok": qc < q_e21, "vs": qc < q_s50}
    gate = pd.Series((qreg != "Xấu") & (ddq.values < 6), index=dates)
    out, raw = {}, {}
    for k, (sig, spec) in S.items():
        bad = BAD[k].fillna(False)
        bad2 = (bad & bad.shift(1, fill_value=False)).values
        sig_d = sig & bc(gate & ~bad)
        tr = simulate_rules(k, sig_d.fillna(False).astype(bool), spec, A, dates, qreg, start, mexit=bad2)
        tr0 = simulate_rules(k, sig.fillna(False).astype(bool), spec, A, dates, qreg, start)
        out[k] = summarize(tr, dates, tickers, recent_from)
        s0 = summarize(tr0, dates, tickers, recent_from)
        out[k]["nodef"] = {kk: s0.get(kk) for kk in ("n", "win", "exp", "pf", "total", "avg_win", "avg_loss")}
        out[k]["nodef"]["recent"] = s0.get("recent")
        out[k]["nodef"]["curve"] = s0.get("curve")
        raw[k] = tr
    vtypes = []
    for name, sg in vsa.items():
        tr = simulate_rules(name, (sg & (rs >= 50)).fillna(False).astype(bool), vspec, A, dates, qreg, start)
        s_ = summarize(tr, dates, tickers, recent_from)
        vtypes.append({"type": name, **{k: s_.get(k) for k in ("n", "win", "exp", "pf", "hold")}, "recent": s_["recent"]})
    today_vsa = {t: [n for n, sg in vsa.items() if bool(sg[t].iloc[-1])] for t in C.columns}
    return {"from": dates[start].strftime("%Y-%m-%d"), "to": dates[-1].strftime("%Y-%m-%d"),
            "recent_from": dates[recent_from].strftime("%Y-%m-%d"), "regime_now": qreg[-1],
            "strategies": out, "vsa_types": vtypes, "_raw": raw, "_start": start,
            "_vsa": {n: (sg & (rs >= 50)) for n, sg in vsa.items()}}, today_vsa


def notes(bt: dict, names: dict) -> list[str]:
    fr = lambda x: f"{(x or 0):+.2f}".replace(".", ",")
    pc = lambda x: f"{(x or 0):.0f}"
    vd = lambda d: f"{d[8:10]}/{d[5:7]}/{d[:4]}"
    S = bt["strategies"]
    rows = [(k, v) for k, v in S.items() if v.get("n", 0) >= 10]
    if not rows:
        return ["Chưa đủ lệnh để đánh giá các phương pháp."]
    out = []
    b = max([r for r in rows if r[1]["n"] >= 20] or rows, key=lambda kv: kv[1]["exp"] if kv[1]["exp"] is not None else -9)
    pf = f"{b[1]['pf']:.2f}".replace(".", ",") if b[1].get("pf") else "—"
    out.append(f"Từ {vd(bt['from'])} đến nay, hiệu quả nhất là {names[b[0]]}: kỳ vọng {fr(b[1]['exp'])}R mỗi lệnh, "
               f"thắng {pc(b[1]['win'])}%, hệ số lợi nhuận {pf} ({b[1]['n']} lệnh).")
    tot = max(rows, key=lambda kv: kv[1]["total"] if kv[1]["total"] is not None else -1e9)
    if tot[0] != b[0] and (tot[1]["total"] or 0) > 0:
        out.append(f"Kiếm được nhiều R nhất là {names[tot[0]]} (tổng {tot[1]['total']:+.0f}R từ {tot[1]['n']} lệnh): "
                   f"lợi thế mỗi lệnh nhỏ hơn nhưng có nhiều cơ hội hơn.")
    rec = [(k, v["recent"]) for k, v in rows if v["recent"].get("n", 0) >= 5]
    if rec:
        rb = max(rec, key=lambda kv: kv[1]["exp"] if kv[1]["exp"] is not None else -9)
        rw = min(rec, key=lambda kv: kv[1]["exp"] if kv[1]["exp"] is not None else 9)
        out.append(f"60 phiên gần đây: tốt nhất là {names[rb[0]]} ({fr(rb[1]['exp'])}R/lệnh, thắng {pc(rb[1]['win'])}%, {rb[1]['n']} lệnh); "
                   f"kém nhất là {names[rw[0]]} ({fr(rw[1]['exp'])}R/lệnh).")
    reg = bt.get("regime_now")
    if reg:
        rr = [(k, v["by_reg"].get(reg, {})) for k, v in rows]
        rr = [(k, s_) for k, s_ in rr if s_.get("n", 0) >= 8]
        if rr:
            g = max(rr, key=lambda kv: kv[1]["exp"] if kv[1]["exp"] is not None else -9)
            out.append(f"Xu hướng QQQ hiện là \"{reg}\". Trong các giai đoạn \"{reg}\" trước đây, {names[g[0]]} cho kết quả tốt nhất "
                       f"({fr(g[1]['exp'])}R/lệnh, thắng {pc(g[1]['win'])}%).")
            neg = [names[k] for k, s_ in rr if (s_["exp"] or 0) < 0]
            if neg:
                out.append(f"Trong trạng thái \"{reg}\", các phương pháp lỗ trung bình: {', '.join(neg)}. Nên giảm quy mô hoặc đứng ngoài với các kiểu này.")
    neg_all = [names[k] for k, v in rows if (v["exp"] or 0) < 0]
    if neg_all:
        out.append(f"Lỗ trung bình trên toàn giai đoạn: {', '.join(neg_all)}.")
    return out
