"""Kiểm chứng ngược (backtest) phương pháp của từng huyền thoại và VSA.

Mỗi phương pháp gồm: tín hiệu (chỉ dùng giá và khối lượng, vì không có số liệu
lợi nhuận lịch sử), cách vào lệnh, stop ban đầu và quy tắc bán đúng như người đó
mô tả. Kết quả tính theo R (bội số rủi ro): 1R = giá mua − stop.

Giả định: không phí, không trượt giá; mỗi mã chỉ một lệnh mở cho mỗi phương pháp;
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

    S = {}
    S["ml"] = (liquid & top & (adr >= 4) & e21up & (d9.abs() <= 5) & (reclaim9 | inside | conv) & mk_ml,
               dict(entry="stop", lvl=H * 1.001, stop=L * 0.999, partials=[("R", 3, 0.15)], trail="e9", max_hold=60,
                    max_stop=cfg.get("max_stop_pct", 6)))
    S["qm"] = (liquid & ((ret[21] >= 0.3) | (ret[63] >= 0.3)) & (adr >= 4) & (dv >= 20e6) & (C > e21) & (tight | gap_ep),
               dict(entry="stop", lvl=H * 1.001, stop=np.maximum(L * 0.999, H * 1.001 * (1 - adr / 100)),
                    partials=[("day", 4, 0.5)], trail="e9", trail_after=4, max_hold=60))
    vcp = (rng5 < 0.7 * adr) & (C >= 0.9 * piv20) & (V.rolling(5).mean() < v50)
    S["mm"] = (liquid & tt & (rs >= 80) & (dd_hi >= -25) & vcp,
               dict(entry="stop", lvl=piv20 * 1.001, pending=5, stop=np.maximum(piv20 * 1.001 * 0.92, lo10 * 0.999),
                    partials=[("pct", 20, 0.5)], be_after_partial=True, trail="e21", trail_after=5, max_hold=60, max_stop=8.5))
    grp20 = indr <= max(1, round(n_ind * 0.2))
    S["wo"] = (liquid & (rs >= 80) & (dd_hi >= -15) & (udv >= 1.1) & grp20 & brk & mk,
               dict(entry="close", stop=C * 0.93, partials=[("pct", 20, 1.0)], max_hold=40, max_stop=7.5))
    S["sw"] = (liquid & (stage == 2) & (rs >= 70) & (indr <= n_ind / 2) & (udv >= 1) & (C > hiprev) & (V >= 2 * v50),
               dict(entry="close", stop=np.maximum(s150 * 0.99, C * 0.85), trail="s150", max_hold=120, max_stop=15.5))
    S["pb"] = (liquid & (ret[1] >= 0.04) & (V > V.shift(1)) & (V >= 1.5 * v50) & ((ret[21] - ret[1]) <= 0.25) & (dv >= 5e6),
               dict(entry="close", stop=L * 0.999, partials=[("pct", 15, 1.0)], max_hold=4))
    cross = (low3 <= e21 * 1.01) & (C > e9) & (C > H.shift(1))
    S["ok"] = (liquid & (rs_pos <= 200) & e21up & cross & (d9 <= 8),
               dict(entry="stop", lvl=H * 1.001, pending=2, stop=np.minimum(L, e21) * 0.995, partials=[("ext9", 15, 0.5)], trail="e21",
                    trail_after=2, max_hold=60))
    vsa = vsa_signals(O, H, L, C, V, e21, e50, ctx["s150"], v50, liquid)
    any_vsa = vsa["Không có cung"] | vsa["Kiểm định cung"] | vsa["Rũ bỏ (spring)"] | vsa["Khối lượng chặn"]
    vspec = dict(entry="stop", lvl=H * 1.001, pending=3, stop=L * 0.995, partials=[("R", 2, 0.5)], be_after_partial=True, trail="e21",
                 trail_after=3, max_hold=40)
    S["vs"] = (any_vsa & (rs >= 50), vspec)

    P = {k: v.values for k, v in (("O", O), ("H", H), ("L", L), ("C", C), ("e9", e9), ("e21", e21), ("s150", s150))}
    start = max(260, nd - int(cfg.get("bt_days", 500)))
    start = min(start, nd - 30)
    recent_from = nd - 60
    tickers = list(C.columns)
    out, raw = {}, {}
    for k, (sig, spec) in S.items():
        tr = simulate(k, sig.fillna(False).astype(bool), spec, P, dates, qreg, start)
        out[k] = summarize(tr, dates, tickers, recent_from)
        raw[k] = tr
    vtypes = []
    for name, sg in vsa.items():
        tr = simulate(name, (sg & (rs >= 50)).fillna(False).astype(bool), vspec, P, dates, qreg, start)
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
