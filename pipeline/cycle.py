"""Chu kỳ thị trường: đang tăng (bứt phá), điều chỉnh, giằng co hay giảm; mỗi pha thường kéo dài
bao lâu, thay đổi bao nhiêu %, và sau đó thường chuyển sang pha nào. Áp dụng cho QQQ và cho
"chỉ số top 100" (bình quân lợi nhuận hằng ngày của 100 mã mạnh nhất).

Thêm thống kê chu kỳ của từng mã top 100: breakout → chạy bao nhiêu phiên, tăng bao nhiêu →
điều chỉnh bao nhiêu phiên, sâu bao nhiêu → lên đỉnh mới hay gãy.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

PHASES = ["Tăng", "Điều chỉnh", "Giằng co", "Giảm"]


def _r(x, d=1):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return None if not np.isfinite(x) else round(x, d)


def phase_series(c: pd.Series) -> pd.Series:
    """Phân loại từng ngày theo giá đóng cửa."""
    e21 = c.ewm(span=21, adjust=False, min_periods=21).mean()
    e50 = c.ewm(span=50, adjust=False, min_periods=50).mean()
    sl21 = e21 / e21.shift(5) - 1
    sl50 = e50 / e50.shift(10) - 1
    hi20 = c.rolling(20, min_periods=10).max()
    dd20 = c / hi20 - 1
    down = ((c < e50) & (sl50 < 0)) | ((c < e21) & (sl21 < -0.005) & (c < e50))
    up = (c > e21) & (sl21 > 0) & (dd20 >= -0.02)
    pull = (sl50 > 0) & (dd20 < -0.02)
    ph = np.select([down, up, pull], ["Giảm", "Tăng", "Điều chỉnh"], default="Giằng co")
    ph = pd.Series(ph, index=c.index).where(e50.notna())
    # làm mượt: pha kéo dài dưới 3 phiên được gộp vào pha trước
    v = ph.values.copy()
    i, n = 0, len(v)
    while i < n:
        j = i
        while j + 1 < n and v[j + 1] == v[i]:
            j += 1
        if j - i + 1 < 3 and i > 0 and isinstance(v[i - 1], str):
            v[i:j + 1] = v[i - 1]
        i = j + 1
    return pd.Series(v, index=c.index)


def segments(ph: pd.Series, c: pd.Series) -> list[dict]:
    out, v, cv, idx = [], ph.values, c.values, ph.index
    i, n = 0, len(v)
    while i < n:
        if not isinstance(v[i], str):
            i += 1
            continue
        j = i
        while j + 1 < n and v[j + 1] == v[i]:
            j += 1
        base = cv[i - 1] if i > 0 and np.isfinite(cv[i - 1]) else cv[i]
        seg = cv[i:j + 1]
        out.append({"phase": v[i], "i": i, "j": j, "start": idx[i].strftime("%Y-%m-%d"), "end": idx[j].strftime("%Y-%m-%d"),
                    "days": j - i + 1, "chg": (cv[j] / base - 1) * 100,
                    "best": (np.nanmax(seg) / base - 1) * 100, "worst": (np.nanmin(seg) / base - 1) * 100})
        i = j + 1
    for k in range(len(out) - 1):
        out[k]["next"] = out[k + 1]["phase"]
    return out


def phase_stats(segs: list[dict]) -> dict:
    done = segs[:-1]
    st = {}
    for p in PHASES:
        g = [s for s in done if s["phase"] == p]
        nx = [s.get("next") for s in g if s.get("next")]
        st[p] = {"n": len(g), "days": _r(np.median([s["days"] for s in g]), 0) if g else None,
                 "days_q3": _r(np.percentile([s["days"] for s in g], 75), 0) if g else None,
                 "chg": _r(np.median([s["chg"] for s in g])) if g else None,
                 "best": _r(np.median([s["best"] for s in g])) if g else None,
                 "worst": _r(np.median([s["worst"] for s in g])) if g else None,
                 "longest": max([s["days"] for s in g]) if g else None,
                 "next": {q: _r(nx.count(q) / len(nx) * 100, 0) for q in PHASES if q != p} if nx else {}}
    return st


def zigzag(c: pd.Series, thr: float) -> list[dict]:
    """Các sóng tăng/giảm: đảo chiều khi giá đi ngược từ đỉnh/đáy gần nhất từ thr (vd 0.05 = 5%)."""
    v, idx = c.values, c.index
    piv = []
    first = next((k for k in range(len(v)) if np.isfinite(v[k])), None)
    if first is None:
        return []
    hi_i = lo_i = first
    trend = 0
    for k in range(first + 1, len(v)):
        x = v[k]
        if not np.isfinite(x):
            continue
        if trend >= 0:
            if x > v[hi_i]:
                hi_i = k
            if x <= v[hi_i] * (1 - thr):
                if trend == 1 or not piv:
                    piv.append(hi_i)
                trend, lo_i = -1, k
                continue
        if trend <= 0:
            if x < v[lo_i]:
                lo_i = k
            if x >= v[lo_i] * (1 + thr):
                if trend == -1 or not piv:
                    piv.append(lo_i)
                trend, hi_i = 1, k
    last = hi_i if trend == 1 else lo_i
    swings = []
    pts = piv + [last]
    for a, b in zip(pts[:-1], pts[1:]):
        if b <= a:
            continue
        swings.append({"from": idx[a].strftime("%Y-%m-%d"), "to": idx[b].strftime("%Y-%m-%d"), "days": int(b - a),
                       "chg": _r((v[b] / v[a] - 1) * 100), "dir": "up" if v[b] > v[a] else "down"})
    if swings:
        swings[-1]["open"] = True
    return swings


def swing_stats(sw: list[dict]) -> dict:
    done = [s for s in sw if not s.get("open")]
    def g(d):
        x = [s for s in done if s["dir"] == d]
        return {"n": len(x), "days": _r(np.median([s["days"] for s in x]), 0) if x else None,
                "chg": _r(np.median([s["chg"] for s in x])) if x else None,
                "max": _r(max([abs(s["chg"]) for s in x]), 1) if x else None}
    return {"up": g("up"), "down": g("down")}


def stock_cycles(C, e21, top, adr, start: int) -> list[dict]:
    """Mỗi breakout của mã top 100: chạy bao lâu, tăng bao nhiêu, điều chỉnh bao lâu, sâu bao nhiêu, kết cục."""
    hpd = C.shift(1).rolling(20, min_periods=15).max()
    evp = (top & (C > hpd) & ~(C.shift(1) > hpd.shift(1))).values
    Cv, Ev, Av = C.values, e21.values, adr.values
    nd, nt = Cv.shape
    out = []
    for j in range(nt):
        c, e = Cv[:, j], Ev[:, j]
        evs = np.where(evp[start:nd - 1, j])[0] + start
        nxt = -1
        for d in evs:
            if d <= nxt:
                continue
            thr = min(0.20, max(0.06, 2 * (Av[d, j] if np.isfinite(Av[d, j]) else 4) / 100))
            entry, peak, pk = c[d], c[d], d
            k, end = d, None
            while k + 1 < nd:
                k += 1
                x = c[k]
                if not np.isfinite(x):
                    continue
                if x > peak:
                    peak, pk = x, k
                if x <= peak * (1 - thr) or (np.isfinite(e[k]) and x < e[k] and k - d >= 2):
                    end = k
                    break
            rec = {"d": d, "run_days": pk - d, "gain": (peak / entry - 1) * 100}
            if end is None:
                rec["state"] = "Đang tăng"
                out.append(rec)
                nxt = nd
                continue
            trough, outc, rk = c[end], None, None
            k = end
            while k + 1 < nd:
                k += 1
                x = c[k]
                if not np.isfinite(x):
                    continue
                if x < trough:
                    trough = x
                if x > peak:
                    outc, rk = "Lên đỉnh mới", k
                    break
                if trough <= peak * 0.75 or k - pk > 60:
                    outc, rk = "Gãy", k
                    break
            rec.update({"pb_days": (rk if rk is not None else nd - 1) - pk, "depth": (trough / peak - 1) * 100,
                        "state": outc or "Đang điều chỉnh"})
            out.append(rec)
            nxt = rk if rk is not None else nd
    return out


def cycle_summary(recs: list[dict], lo: int, hi: int) -> dict:
    g = [r for r in recs if lo <= r["d"] < hi]
    runs = [r for r in g if r["state"] != "Đang tăng"]
    fin = [r for r in g if r["state"] in ("Lên đỉnh mới", "Gãy")]
    rec = [r for r in fin if r["state"] == "Lên đỉnh mới"]
    med = lambda xs, d=1: _r(np.median(xs), d) if xs else None
    return {"n": len(g), "run_days": med([r["run_days"] for r in runs], 0), "gain": med([r["gain"] for r in runs]),
            "gain10": _r(np.mean([r["gain"] >= 10 for r in runs]) * 100, 0) if runs else None,
            "gain20": _r(np.mean([r["gain"] >= 20 for r in runs]) * 100, 0) if runs else None,
            "pb_days": med([r["pb_days"] for r in rec], 0), "depth": med([r["depth"] for r in rec]),
            "rec_rate": _r(len(rec) / len(fin) * 100, 0) if fin else None,
            "fail_depth": med([r["depth"] for r in fin if r["state"] == "Gãy"])}


def analyze(qqq: pd.Series, top_idx: pd.Series, C, e21, top, adr, keep: int) -> dict:
    dates = qqq.index
    out = {}
    for key, ser, thr in (("qqq", qqq, 0.05), ("top", top_idx, 0.08)):
        ph = phase_series(ser)
        segs = segments(ph, ser)
        cur = segs[-1] if segs else None
        st = phase_stats(segs)
        sw = zigzag(ser, thr)
        info = {"phase": [p if isinstance(p, str) else None for p in ph.iloc[-keep:]],
                "close": [_r(x, 2) for x in ser.iloc[-keep:]], "stats": st,
                "segments": [{k: (_r(v) if isinstance(v, float) else v) for k, v in s.items() if k not in ("i", "j")} for s in segs[-14:]],
                "swings": sw[-12:], "swing_stats": swing_stats(sw), "thr": thr * 100}
        if cur:
            s0 = st.get(cur["phase"], {})
            info["current"] = {"phase": cur["phase"], "start": cur["start"], "days": cur["days"], "chg": _r(cur["chg"]),
                               "typical": s0.get("days"), "q3": s0.get("days_q3"), "next": s0.get("next", {})}
        out[key] = info
    out["dates"] = [d.strftime("%Y-%m-%d") for d in dates[-keep:]]
    nd = len(dates)
    start = max(60, nd - keep)
    recs = stock_cycles(C, e21, top, adr, start)
    out["stock_recent"] = cycle_summary(recs, nd - 90, nd)
    out["stock_before"] = cycle_summary(recs, start, nd - 90)
    out["stock_now"] = {s: sum(1 for r in recs if r["state"] == s and r["d"] >= nd - 90) for s in ("Đang tăng", "Đang điều chỉnh")}
    out["notes"] = notes(out)
    return out


def _p(x, d=1):
    return "—" if x is None else f"{x:+.{d}f}%".replace(".", ",")


def notes(o: dict) -> list[str]:
    out = []
    for key, nm in (("qqq", "QQQ"), ("top", "Nhóm top 100")):
        c = o[key].get("current")
        if not c:
            continue
        txt = f"{nm} đang ở pha {c['phase'].upper()} được {c['days']} phiên (từ {c['start'][8:10]}/{c['start'][5:7]}, {_p(c['chg'])})."
        if c.get("typical"):
            txt += f" Pha này thường kéo dài khoảng {c['typical']:.0f} phiên"
            txt += ", đã dài hơn mức thường gặp" if c["days"] > (c.get("q3") or 1e9) else ""
            txt += "."
        nx = c.get("next") or {}
        if nx:
            k = max(nx, key=lambda q: nx[q] or 0)
            txt += " Sau pha này thường chuyển sang: " + ", ".join(f"{q} {v:.0f}%" for q, v in sorted(nx.items(), key=lambda kv: -(kv[1] or 0)) if v) + "."
            if k == "Giảm" and (nx[k] or 0) >= 40:
                txt += " Rủi ro chuyển sang giảm khá cao, nên thận trọng."
        out.append(txt)
    sw = o["qqq"]["swing_stats"]
    if sw["up"]["n"] and sw["down"]["n"]:
        out.append(f"Sóng của QQQ (đảo chiều từ {o['qqq']['thr']:.0f}%): sóng tăng trung vị {sw['up']['days']:.0f} phiên, {_p(sw['up']['chg'])}; "
                   f"sóng giảm trung vị {sw['down']['days']:.0f} phiên, {_p(sw['down']['chg'])}.")
    r, b = o["stock_recent"], o["stock_before"]
    if r.get("run_days") is not None:
        txt = (f"Chu kỳ mã top 100 (90 phiên gần đây, {r['n']} breakout): sau breakout tăng trung vị {r['run_days']:.0f} phiên, {_p(r['gain'])}"
               f" ({r['gain10'] or 0:.0f}% số lần tăng từ 10%)")
        if r.get("pb_days") is not None:
            txt += f"; rồi điều chỉnh {r['pb_days']:.0f} phiên, sâu {abs(r['depth']):.1f}%".replace(".", ",")
        if r.get("rec_rate") is not None:
            txt += f"; {r['rec_rate']:.0f}% lên được đỉnh mới"
        out.append(txt + ".")
        if b.get("gain") is not None and r.get("gain") is not None:
            if r["gain"] < b["gain"] * 0.7:
                out.append(f"Breakout đang chạy ngắn hơn trước ({_p(r['gain'])} so với {_p(b['gain'])}): nên chốt lời sớm hơn, không kỳ vọng sóng dài.")
            elif r["gain"] > b["gain"] * 1.3:
                out.append(f"Breakout đang chạy xa hơn trước ({_p(r['gain'])} so với {_p(b['gain'])}): có thể giữ lệnh lâu hơn.")
        if b.get("rec_rate") is not None and r.get("rec_rate") is not None and r["rec_rate"] < b["rec_rate"] - 10:
            out.append("Tỷ lệ hồi phục sau điều chỉnh đang giảm: mua khi điều chỉnh rủi ro hơn trước.")
    return out
