"""Phòng thí nghiệm setup: mỗi mẫu hình được định nghĩa bằng quy tắc định lượng CỐ ĐỊNH (đặt trước khi chạy,
không tối ưu theo kết quả), rồi mô phỏng lệnh thật: chờ giá vượt pivot mới mua, stop ở mức vô hiệu hóa,
đo kết quả theo R sau chi phí. Kết quả được chia theo điều kiện tại thời điểm vào lệnh (không dùng thông tin tương lai),
tách trong mẫu / ngoài mẫu theo thời gian, và phân tích vì sao breakout thất bại.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

SLIP = 0.001       # trượt giá mỗi lần khớp (0,1%)
HOLD = 120         # số phiên tối đa giữ lệnh (quy tắc thoát: chốt 1/3 tại +20%, 1/3 tại +40%, phần còn lại theo MA 50)
T1, T2 = 0.20, 0.40   # hai mức chốt lãi từng phần — cách thoát cho kỳ vọng cao nhất trong bảng "Chốt lãi thế nào"
MIN_N = 30         # dưới số lệnh này: chưa đủ tin cậy

SETUP_INFO = {
    "VCP": {"kind": "base", "rule": "Đạt Trend Template; 3 đoạn 15 phiên có biên độ co dần, đoạn cuối < 10%; KL 10 phiên < 85% TB50; giá cách đỉnh 15 phiên ≤ 8%. Mua khi vượt đỉnh 15 phiên, stop đáy 10 phiên."},
    "Nền phẳng": {"kind": "base", "rule": "Nền 30 phiên biên độ ≤ 15% sau nhịp tăng ≥ 20%; giá trên MA50, RS ≥ 70, cách đỉnh nền ≤ 5%. Mua khi vượt đỉnh nền, stop đáy 10 phiên."},
    "Cốc tay cầm": {"kind": "base", "rule": "Gần đúng: cốc sâu 12–35% so với đỉnh 3–5 tháng trước, phục hồi về trong 10% đỉnh cũ; tay cầm 8–12 phiên sâu ≤ 12%, nằm ở nửa trên cốc, KL cạn. Mua khi vượt đỉnh tay cầm, stop đáy tay cầm."},
    "Breakout 20 phiên": {"kind": "close", "rule": "RS ≥ 70, đóng cửa vượt đỉnh 20 phiên lần đầu với KL ≥ 1,2× TB50. Mua cuối phiên bứt phá, stop đáy 10 phiên."},
    "Lấy lại EMA21": {"kind": "pull", "rule": "RS ≥ 60, sau ≥ 3 phiên đóng cửa dưới EMA21 thì đóng cửa trở lại trên EMA21, EMA50 dốc lên. Mua khi vượt đỉnh phiên tín hiệu, stop đáy 5 phiên."},
    "Lấy lại MA50": {"kind": "pull", "rule": "RS ≥ 50, sau ≥ 3 phiên dưới MA50 thì đóng cửa trên MA50, MA200 dốc lên và giá trên MA200. Mua khi vượt đỉnh phiên tín hiệu, stop đáy 5 phiên."},
}
BREAKOUT_SETUPS = ["VCP", "Nền phẳng", "Cốc tay cầm", "Breakout 20 phiên"]
# Đã bỏ vì kiểm chứng thật (11/2025–10/2026, 0,1% trượt giá) đều lỗ cả trong và ngoài mẫu:
# Inside day (−0,31R, 5.263 lệnh), Pullback EMA21 (−0,12R, 4.255 lệnh), Gap tăng mạnh EP (−0,18R), Cờ cán cao (−0,20R, mẫu quá ít).

DIMS = [
    {"key": "stage", "label": "Giai đoạn dòng tiền"},
    {"key": "gold", "label": "Thời điểm mua của thị trường", "buckets": ["Thời điểm vàng", "Thuận lợi", "Trung tính", "Bất lợi"]},
    {"key": "reg", "label": "Xu hướng QQQ", "buckets": ["Tốt", "Giằng co", "Xấu"]},
    {"key": "btr", "label": "Độ rộng 10 phiên", "buckets": ["Đang cải thiện", "Đi ngang", "Đang xấu đi"]},
    {"key": "rs", "label": "RS của mã", "buckets": ["RS ≥ 90", "RS 80–89", "RS 70–79", "RS < 70"]},
    {"key": "ind", "label": "Hạng ngành", "buckets": ["Top 20%", "20–50%", "Nửa dưới"]},
    {"key": "vol", "label": "KL phiên mua (biết cuối phiên)", "buckets": ["≥ 1,5× TB50", "1–1,5×", "< 1× TB50"]},
    {"key": "chase", "label": "Giá khớp so với pivot", "buckets": ["≤ 1%", "1–3%", "> 3% (gap/đuổi)"]},
    {"key": "gap", "label": "Gap ≥ 5% trong 5 phiên trước", "buckets": ["Có", "Không"]},
    {"key": "stop", "label": "Độ rộng stop", "buckets": ["≤ 4%", "4–7%", "> 7%"]},
]
CAUSES = [
    ("mkt", "Thị trường yếu", "Giai đoạn dòng tiền là Xu hướng giảm, Hồi phục ban đầu hoặc Phân phối, hoặc QQQ Xấu"),
    ("ind", "Ngành yếu", "Ngành ở nửa dưới bảng xếp hạng"),
    ("vol", "Thiếu khối lượng", "KL phiên mua < 1,2× TB50"),
    ("chase", "Mua xa pivot", "Giá khớp cao hơn pivot trên 3%"),
    ("gap", "Gap / tin tức trước đó", "Có gap ≥ 5% trong 5 phiên trước hoặc ngay phiên mua"),
    ("rs", "RS chưa đủ mạnh", "RS < 80"),
    ("wide", "Stop rộng", "Stop rộng hơn 8%"),
    ("weakclose", "Đóng cửa yếu", "Phiên mua đóng cửa ở nửa dưới biên độ"),
]


def _r(x, d=2):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return round(x, d) if math.isfinite(x) else None


def signals(c: dict) -> dict:
    """Trả về {tên: (mask, pivot, stop, số phiên chờ)} — tất cả là bảng ngày × mã."""
    O, H, L, C, V = c["O"], c["H"], c["L"], c["C"], c["V"]
    e21, e50, s50, s200, v50, rs, liquid, tt = c["e21"], c["e50"], c["s50"], c["s200"], c["v50"], c["rs"], c["liquid"], c["tt"]
    base = liquid
    H15, L10, L5, L3 = H.rolling(15).max(), L.rolling(10).min(), L.rolling(5).min(), L.rolling(3).min()
    rngC = lambda k, s: (C.rolling(k).max() / C.rolling(k).min() - 1).shift(s)
    d1, d2, d3 = rngC(15, 30), rngC(15, 15), rngC(15, 0)
    v10 = V.rolling(10).mean()
    S = {}
    S["VCP"] = (base & tt & (d1 > d2) & (d2 > d3) & (d3 < 0.10) & (v10 < 0.85 * v50) & (C >= 0.92 * H15) & (C < H15), H15, L10, 5)
    H30, L30 = H.rolling(30).max(), L.rolling(30).min()
    flat = (H30 / L30 - 1 <= 0.15) & (C.shift(30) >= 1.2 * C.rolling(60).min().shift(30))
    S["Nền phẳng"] = (base & flat & (rs >= 70) & (C > s50) & (C >= 0.95 * H30) & (C < H30), H30, L10, 5)
    P = H.rolling(90).max().shift(25)
    B = L.rolling(80).min().shift(8)
    Hh, Lh = H.rolling(10).max(), L.rolling(10).min()
    dep = 1 - B / P
    cup = ((dep >= 0.12) & (dep <= 0.35) & (Hh >= 0.9 * P) & (Hh <= 1.03 * P) & ((Hh - Lh) / Hh <= 0.12)
           & (Lh >= B + 0.5 * (P - B)) & (C.shift(45) <= 0.92 * P) & (v10 < v50))
    S["Cốc tay cầm"] = (base & cup & (rs >= 70) & (C > s50) & (C >= 0.95 * Hh) & (C < Hh), Hh, Lh, 5)
    hp = H.shift(1).rolling(20, min_periods=15).max()
    S["Breakout 20 phiên"] = (base & (rs >= 70) & (C > hp) & ~(C.shift(1) > hp.shift(1)) & (V >= 1.2 * v50), hp, L10, 0)
    below21 = (C.shift(1) < e21.shift(1)) & (C.shift(2) < e21.shift(2)) & (C.shift(3) < e21.shift(3))
    S["Lấy lại EMA21"] = (base & (rs >= 60) & (C > e21) & below21 & (e50 > e50.shift(10)), H, L5, 2)
    below50 = (C.shift(1) < s50.shift(1)) & (C.shift(2) < s50.shift(2)) & (C.shift(3) < s50.shift(3))
    S["Lấy lại MA50"] = (base & (rs >= 50) & (C > s50) & below50 & (s200 > s200.shift(20)) & (C > s200), H, L5, 2)
    return S


def _bucket(key, v):
    if v is None or (isinstance(v, float) and not math.isfinite(v)):
        return None
    if key == "rs":
        return "RS ≥ 90" if v >= 90 else "RS 80–89" if v >= 80 else "RS 70–79" if v >= 70 else "RS < 70"
    if key == "ind":
        return "Top 20%" if v <= 0.2 else "20–50%" if v <= 0.5 else "Nửa dưới"
    if key == "vol":
        return "≥ 1,5× TB50" if v >= 1.5 else "1–1,5×" if v >= 1 else "< 1× TB50"
    if key == "chase":
        return "≤ 1%" if v <= 1 else "1–3%" if v <= 3 else "> 3% (gap/đuổi)"
    if key == "stop":
        return "≤ 4%" if v <= 4 else "4–7%" if v <= 7 else "> 7%"
    if key == "btr":
        return "Đang cải thiện" if v >= 5 else "Đang xấu đi" if v <= -5 else "Đi ngang"
    return v


def follow(O, H, L, C, M50, j, e, fill, sp, R, nd, brk=True, pv=None, same_bar_risk=True):
    """Theo dõi một lệnh với quy tắc thoát chuẩn: stop ban đầu; chốt 1/3 khi lãi +20%, 1/3 khi +40% (sau lần chốt đầu dời stop
    về hòa vốn); phần còn lại bán khi đóng cửa dưới MA 50. Lệnh chưa kết thúc được tính theo giá đóng cửa mới nhất (đang mở)."""
    lv1, lv2 = fill * (1 + T1), fill * (1 + T2)
    rem, realized, cur = 1.0, 0.0, sp
    took1 = took2 = False
    mfe = mae = 0.0
    hit = {1: False, 2: False, 3: False}
    fail3 = False
    last = min(nd - 1, e + HOLD)
    for q in range(e, last + 1):
        o, h, l, cc = O[q, j], H[q, j], L[q, j], C[q, j]
        if not np.isfinite(cc):
            continue
        o = o if np.isfinite(o) else cc
        if q == e and same_bar_risk and l <= sp:
            return {"r": (sp * (1 - SLIP) - fill) / R, "x": q, "why": "Chạm stop ngay phiên mua", "mfe": 0.0, "mae": -1.0, "hit": hit, "fail3": True, "open": False}
        if q > e and l <= cur:
            px = min(o, cur)
            realized += rem * (px * (1 - SLIP) - fill) / R
            mae = min(mae, (min(l, cur) - fill) / R)
            return {"r": realized, "x": q, "why": "Hòa vốn" if took1 else "Chạm stop", "mfe": mfe, "mae": mae, "hit": hit,
                    "fail3": fail3 or (q - e <= 3 and not took1), "open": False}
        mfe = max(mfe, (h - fill) / R)
        mae = min(mae, (l - fill) / R)
        for k_ in (1, 2, 3):
            if not hit[k_] and h >= fill + k_ * R:
                hit[k_] = True
        if q - e <= 3 and (cc < pv if (brk and pv is not None) else cc <= fill - 0.5 * R):
            fail3 = True
        if not took1 and h >= lv1:
            took1, cur = True, max(cur, fill)
            realized += (1 / 3) * (max(o, lv1) * (1 - SLIP) - fill) / R
            rem -= 1 / 3
        if took1 and not took2 and h >= lv2:
            took2 = True
            realized += (1 / 3) * (max(o, lv2) * (1 - SLIP) - fill) / R
            rem -= 1 / 3
        if took1 and q > e and np.isfinite(M50[q, j]) and cc < M50[q, j]:
            realized += rem * (cc * (1 - SLIP) - fill) / R
            return {"r": realized, "x": q, "why": "Đóng cửa dưới MA 50", "mfe": mfe, "mae": mae, "hit": hit, "fail3": fail3, "open": False}
    realized += rem * (C[last, j] * (1 - SLIP) - fill) / R if np.isfinite(C[last, j]) else 0.0
    still = e + HOLD > nd - 1
    return {"r": realized, "x": last, "why": "Đang mở (tính theo giá hiện tại)" if still else f"Hết {HOLD} phiên", "mfe": mfe, "mae": mae,
            "hit": hit, "fail3": fail3, "open": still}


def simulate(c: dict, S: dict, ctxm: dict, start: int, max_stop: float = 12.0):
    O, H, L, C, V = (c[k].values for k in ("O", "H", "L", "C", "V"))
    e21, v50, rs = c["e21"].values, c["v50"].values, c["rs"].values
    M50 = c["s50"].values
    nd, nt = C.shape
    stage, reg, btr = ctxm["stage"], ctxm["reg"], ctxm["btr"]
    indr = ctxm["ind_rank"].values
    n_ind = ctxm["n_ind"]
    gap5 = (c["O"] / c["C"].shift(1) - 1 >= 0.05).values
    trades, pending = [], []
    for name, (mask, pivot, stop, wait) in S.items():
        brk = SETUP_INFO[name]["kind"] in ("base", "close")
        M = mask.fillna(False).values.astype(bool)
        PV, ST = pivot.values, stop.values
        M[:start] = False
        ii, jj = np.nonzero(M)
        order = np.lexsort((ii, jj))
        busy = np.full(nt, -1)
        for k in order:
            i, j = ii[k], jj[k]
            if i <= busy[j]:
                continue
            pv, sp = PV[i, j], ST[i, j]
            if not (np.isfinite(pv) and np.isfinite(sp)) or sp >= pv:
                continue
            # tìm phiên khớp
            e, cancel = None, False
            if wait == 0:
                e, fill = i, C[i, j] * (1 + SLIP)
            else:
                for q in range(i + 1, min(nd, i + 1 + wait)):
                    if not np.isfinite(H[q, j]):
                        break
                    if L[q, j] <= sp and H[q, j] < pv:
                        cancel = True
                        break
                    if H[q, j] >= pv:
                        o = O[q, j] if np.isfinite(O[q, j]) else pv
                        e, fill = q, max(o, pv) * (1 + SLIP)
                        break
                if e is None:
                    if i + wait >= nd and not cancel:   # còn hiệu lực tới hôm nay
                        pending.append((name, i, j, pv, sp))
                    busy[j] = i + wait
                    continue
            R = fill - sp
            stop_pct = R / fill * 100
            if R <= 0 or stop_pct > max_stop:
                busy[j] = e
                continue
            # theo dõi lệnh (quy tắc thoát chuẩn ở hàm follow)
            fr = follow(O, H, L, C, M50, j, e, fill, sp, R, nd, brk=brk, pv=pv, same_bar_risk=(wait != 0))
            realized, x, reason, mfe, mae, hit, fail3 = fr["r"], fr["x"], fr["why"], fr["mfe"], fr["mae"], fr["hit"], fr["fail3"]
            busy[j] = nd if fr["open"] else x
            vr = V[e, j] / v50[e, j] if np.isfinite(v50[e, j]) and v50[e, j] > 0 else np.nan
            rng = H[e, j] - L[e, j]
            cpos = (C[e, j] - L[e, j]) / rng if rng > 0 else 0.5
            ir = indr[i, j] / n_ind[i] if np.isfinite(indr[i, j]) and n_ind[i] else np.nan
            chase = (fill / (1 + SLIP) / pv - 1) * 100
            gp = bool(gap5[max(0, e - 5):e + 1, j].any())
            st_i = stage[i]
            trades.append({
                "s": name, "j": j, "i": i, "e": e, "x": x, "open": bool(fr["open"] and nd - 1 - e < 10), "live": fr["open"], "fill": fill, "pv": pv, "sp": sp, "R": R,
                "r": realized, "win": realized > 0, "h1": hit[1], "h2": hit[2], "h3": hit[3], "fail3": fail3, "mfe": mfe, "mae": mae,
                "why": reason, "days": x - e,
                "d": {"gold": ctxm["gold"][i] if isinstance(ctxm["gold"][i], str) else None, "stage": st_i if isinstance(st_i, str) else None, "reg": reg[i] if isinstance(reg[i], str) else None,
                      "btr": _bucket("btr", btr[i]), "rs": _bucket("rs", rs[i, j]), "ind": _bucket("ind", ir),
                      "vol": _bucket("vol", vr), "chase": _bucket("chase", chase), "gap": "Có" if gp else "Không",
                      "stop": _bucket("stop", stop_pct)},
                "c": {"mkt": (st_i in ("Xu hướng giảm", "Hồi phục ban đầu", "Phân phối / suy yếu")) or reg[i] == "Xấu",
                      "ind": bool(np.isfinite(ir) and ir > 0.5), "vol": bool(np.isfinite(vr) and vr < 1.2), "chase": chase > 3,
                      "gap": gp, "rs": bool(rs[i, j] < 80), "wide": stop_pct > 8, "weakclose": cpos < 0.5},
            })
    return trades, pending


def wilson(k, n, z=1.96):
    if n == 0:
        return None, None
    p = k / n
    den = 1 + z * z / n
    mid = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return round((mid - half) * 100), round((mid + half) * 100)


def stats(ts, full=False):
    if not ts:
        return {"n": 0}
    r = np.array([t["r"] for t in ts])
    w = r > 0
    lo, hi = wilson(int(w.sum()), len(r))
    out = {"n": len(ts), "days": len({t["i"] for t in ts}), "win": _r(w.mean() * 100, 0), "lo": lo, "hi": hi,
           "exp": _r(r.mean()), "p2r": _r(np.mean([t["h2"] for t in ts]) * 100, 0), "fail3": _r(np.mean([t["fail3"] for t in ts]) * 100, 0)}
    if full:
        out.update({"avg_w": _r(r[w].mean()) if w.any() else None, "avg_l": _r(r[~w].mean()) if (~w).any() else None,
                    "p1r": _r(np.mean([t["h1"] for t in ts]) * 100, 0), "p3r": _r(np.mean([t["h3"] for t in ts]) * 100, 0),
                    "mfe": _r(np.median([t["mfe"] for t in ts])), "mae": _r(np.median([t["mae"] for t in ts])),
                    "pf": _r(r[w].sum() / -r[~w].sum()) if (~w).any() and r[~w].sum() < 0 else None,
                    "hold": _r(np.mean([t["days"] for t in ts]), 1)})
        cum = np.cumsum([t["r"] for t in sorted(ts, key=lambda t: t["x"])])
        out["mdd"] = _r(float((cum - np.maximum.accumulate(np.r_[0, cum])[1:]).min()) if len(cum) else 0, 1)
    return out


def reentries(c, trades, start):
    """Sau một breakout thất bại (đóng cửa dưới pivot trong 5 phiên), nếu trong 15 phiên giá đóng cửa lại trên pivot với KL > TB50
    thì mua lại cuối phiên đó, stop = đáy thấp nhất từ lúc thất bại. Cùng quy tắc thoát."""
    O, H, L, C, V = (c[k].values for k in ("O", "H", "L", "C", "V"))
    v50 = c["v50"].values
    nd = C.shape[0]
    out = []
    for t in trades:
        if t["open"] or t["s"] not in BREAKOUT_SETUPS:
            continue
        j, e, pv = t["j"], t["e"], t["pv"]
        fq = None
        for q in range(e, min(nd, e + 6)):
            if C[q, j] < pv:
                fq = q
                break
        if fq is None:
            continue
        for q in range(fq + 1, min(nd - 1, fq + 16)):
            if C[q, j] > pv and np.isfinite(v50[q, j]) and V[q, j] > v50[q, j]:
                fill = C[q, j] * (1 + SLIP)
                sp = np.nanmin(L[fq:q + 1, j]) * 0.999
                R = fill - sp
                if R <= 0 or R / fill > 0.12 or nd - 1 - q < 10:
                    break
                M50 = c["s50"].values
                fr = follow(O, H, L, C, M50, j, q, fill, sp, R, nd, brk=False, same_bar_risk=False)
                out.append({"s": t["s"], "j": j, "i": q, "e": q, "x": fr["x"], "r": fr["r"], "h1": fr["hit"][1], "h2": fr["hit"][2], "h3": fr["hit"][3],
                            "fail3": False, "mfe": fr["mfe"], "mae": fr["mae"], "days": fr["x"] - q})
                break
    return out


def analyze(c: dict, ctxm: dict, start: int, today_stage: str | None) -> dict:
    S = signals(c)
    dates = c["C"].index
    tickers = list(c["C"].columns)
    nd = len(dates)
    trades, pending = simulate(c, S, ctxm, start)
    closed = [t for t in trades if not t["open"]]
    if closed:
        e_min, e_max = min(t["e"] for t in closed), max(t["e"] for t in closed)
        cut = int(e_min + 0.6 * (e_max - e_min))
    else:
        cut = nd
    recent = nd - 1 - 80   # 80 phiên gần nhất (lệnh chưa kết thúc tính theo giá hiện tại)
    stages = ["Xu hướng giảm", "Hồi phục ban đầu", "Dòng tiền lan rộng", "Uptrend xác nhận", "Phân phối / suy yếu", "Chưa rõ ràng"]
    dims = []
    for d in DIMS:
        b = d.get("buckets") or stages
        dims.append({"key": d["key"], "label": d["label"], "buckets": b})
    setups = []
    for name, info in SETUP_INFO.items():
        ts = [t for t in closed if t["s"] == name]
        row = {"name": name, "kind": info["kind"], "rule": info["rule"], "all": stats(ts, full=True),
               "ins": stats([t for t in ts if t["e"] < cut], full=True), "oos": stats([t for t in ts if t["e"] >= cut], full=True),
               "recent": stats([t for t in ts if t["e"] >= recent]), "by": {}}
        a_, o_ = row["all"], row["oos"]
        row["edge"] = bool(a_.get("n", 0) >= MIN_N and (a_.get("exp") or 0) > 0 and (o_.get("n", 0) < MIN_N or (o_.get("exp") or 0) > 0))
        for d in dims:
            row["by"][d["key"]] = {b: stats([t for t in ts if t["d"].get(d["key"]) == b]) for b in d["buckets"]}
        # tổ hợp quan trọng nhất: giai đoạn hiện tại × RS ≥ 80 × ngành nửa trên
        if today_stage:
            row["now_best"] = stats([t for t in ts if t["d"]["stage"] == today_stage and t["d"]["rs"] in ("RS ≥ 90", "RS 80–89")
                                     and t["d"]["ind"] in ("Top 20%", "20–50%")])
        # đường cộng dồn R theo thời gian (để xem độ ổn định)
        byd, s = {}, 0.0
        for t in sorted(ts, key=lambda t: t["x"]):
            s += t["r"]
            byd[dates[t["x"]].strftime("%Y-%m-%d")] = round(s, 1)
        cum = list(byd.items())
        step = max(1, len(cum) // 150)
        pts = cum[::step]
        if cum and pts[-1] != cum[-1]:
            pts.append(cum[-1])
        row["curve"] = [list(p) for p in pts]
        setups.append(row)

    # ---- vì sao breakout thất bại
    bts = [t for t in closed if t["s"] in BREAKOUT_SETUPS]
    is_fail = lambda t: t["r"] <= 0 and (t["fail3"] or t["why"] in ("Chạm stop", "Chạm stop ngay phiên mua"))
    nf = sum(1 for t in bts if is_fail(t))
    causes = []
    for key, label, desc in CAUSES:
        w = [t for t in bts if t["c"][key]]
        wo = [t for t in bts if not t["c"][key]]
        fr = lambda xs: _r(sum(1 for t in xs if is_fail(t)) / len(xs) * 100, 0) if xs else None
        ex = lambda xs: _r(np.mean([t["r"] for t in xs])) if xs else None
        causes.append({"key": key, "label": label, "desc": desc, "n_w": len(w), "fail_w": fr(w), "exp_w": ex(w),
                       "n_wo": len(wo), "fail_wo": fr(wo), "exp_wo": ex(wo),
                       "share": _r(sum(1 for t in w if is_fail(t)) / nf * 100, 0) if nf else None})
    causes.sort(key=lambda x: -((x["fail_w"] or 0) - (x["fail_wo"] or 0)))
    # số nguyên nhân cùng lúc
    by_k = {}
    for t in bts:
        k = min(3, sum(1 for v in t["c"].values() if v))
        by_k.setdefault(k, []).append(t)
    multi = [{"k": k, "label": ["Không có", "1 nguyên nhân", "2 nguyên nhân", "Từ 3 nguyên nhân"][k], **stats(v)} for k, v in sorted(by_k.items())]
    re = reentries(c, closed, start)
    fail_stats = {"n": len(bts), "fail": _r(nf / len(bts) * 100, 0) if bts else None, "causes": causes, "multi": multi,
                  "first": stats(bts, full=True), "reentry": stats(re, full=True)}
    # breakout thất bại gần đây (30 phiên) và trạng thái hiện tại
    C = c["C"].values
    rec = []
    for t in trades:
        if t["s"] not in BREAKOUT_SETUPS or t["e"] < nd - 30:
            continue
        j, e, pv = t["j"], t["e"], t["pv"]
        seg = C[e:, j]
        below = np.where(seg < pv)[0]
        if not len(below):
            continue
        fq = e + below[0]
        after = np.where(C[fq + 1:, j] > pv)[0]
        status = f"Đã lấy lại pivot ngày {dates[fq + 1 + after[0]].strftime('%d/%m')}" if len(after) else "Đang dưới pivot"
        rec.append({"t": tickers[j], "s": t["s"], "in": dates[e].strftime("%Y-%m-%d"), "fail": dates[fq].strftime("%Y-%m-%d"),
                    "pv": _r(pv), "close": _r(C[-1, j]), "vs_pv": _r((C[-1, j] / pv - 1) * 100, 1), "status": status,
                    "reclaim": bool(len(after)), "causes": [lb for k, lb, _ in CAUSES if t.get("c", {}).get(k)]})
    rec.sort(key=lambda x: x["fail"], reverse=True)
    fail_stats["recent"] = rec[:60]

    # ---- tín hiệu hôm nay và tín hiệu còn hiệu lực
    today = {}
    t0 = nd - 1
    for name, (mask, pivot, stop, wait) in S.items():
        for j in np.nonzero(mask.iloc[t0].fillna(False).values)[0]:
            today.setdefault(tickers[j], []).append({"s": name, "sig": dates[t0].strftime("%Y-%m-%d"), "pv": _r(pivot.iloc[t0, j]),
                                                    "sp": _r(stop.iloc[t0, j]), "left": wait, "kind": SETUP_INFO[name]["kind"]})
    for name, i, j, pv, sp in pending:
        if i == t0:
            continue
        today.setdefault(tickers[j], []).append({"s": name, "sig": dates[i].strftime("%Y-%m-%d"), "pv": _r(pv), "sp": _r(sp),
                                                "left": S[name][3] - (t0 - i), "kind": SETUP_INFO[name]["kind"]})
    return {"from": dates[start].strftime("%Y-%m-%d"), "to": dates[-1].strftime("%Y-%m-%d"), "cut": dates[min(cut, nd - 1)].strftime("%Y-%m-%d"),
            "min_n": MIN_N, "hold": HOLD, "slip": SLIP * 100, "dims": dims, "setups": setups, "fail": fail_stats,
            "n_closed": len(closed), "n_open": sum(1 for t in trades if t["open"])}, today


def lookup(lab: dict, setup: str, stage, rs_b, ind_b, gold=None) -> dict:
    """Thống kê lịch sử của một setup trong điều kiện giống hiện tại (dùng cho câu hỏi 1)."""
    row = next((s for s in lab["setups"] if s["name"] == setup), None)
    if not row:
        return {}
    by = row["by"]
    return {"all": row["all"], "stage": by["stage"].get(stage) if stage else None, "rs": by["rs"].get(rs_b) if rs_b else None,
            "ind": by["ind"].get(ind_b) if ind_b else None, "oos": row["oos"], "now_best": row.get("now_best"),
            "gold": by["gold"].get(gold) if gold else None}
