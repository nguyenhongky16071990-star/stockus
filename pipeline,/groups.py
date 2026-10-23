"""Điểm ngành dẫn: ngành nào đang thật sự dẫn dắt, và điểm số này có dự báo được ngành tăng hơn thị trường không?

Bảy nhóm bằng chứng (6 nhóm có lịch sử để kiểm chứng, nhóm cơ bản chỉ có hôm nay):
1. Sức mạnh giá: trung vị sức mạnh giá các mã trong ngành (giống cách IBD xếp nhóm ngành).
2. Đường RS của ngành so với SPY: đang dốc lên, có lập đỉnh mới không.
3. Độ rộng trong ngành: % mã trên MA50, % mã cách đỉnh 52 tuần dưới 10%, % mã mạnh hơn SPY 3 tháng.
4. Độ bền: bao nhiêu % trong 40 phiên qua ngành nằm trong 30% nhóm đầu.
5. Tích lũy: khối lượng (theo giá trị) ở phiên tăng so với phiên giảm của cả ngành, 50 phiên.
6. Nền giá: % mã đang sát đỉnh 20 phiên với biên độ co hẹp (sắp có điểm mua).
7. Cơ bản: tăng trưởng EPS và doanh thu quý trung vị (chữ L và I trong CAN SLIM).
Mỗi bằng chứng được xếp hạng phần trăm giữa các ngành trong cùng ngày, nên điểm là tương đối: 100 là ngành tốt nhất hôm đó.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

KEYS = ["price", "rsl", "breadth", "persist", "accum", "bases"]
LABELS = {"price": "Sức mạnh giá (trung vị)", "rsl": "Đường RS so với SPY", "breadth": "Độ rộng trong ngành", "persist": "Độ bền (giữ top nhiều tuần)",
          "accum": "Tích lũy khối lượng", "bases": "Nhiều mã có nền giá", "fund": "Tăng trưởng EPS / doanh thu"}


def _r(x, d=1):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return round(x, d) if math.isfinite(x) else None


def compute(ctx: dict) -> tuple[dict, pd.DataFrame]:
    C, H, L, V, valid, liquid = ctx["C"], ctx["H"], ctx["L"], ctx["V"], ctx["valid"], ctx["liquid"]
    rs, s50, dd_hi, adr, perf, ind_s = ctx["rs"], ctx["s50"], ctx["dd_hi"], ctx["adr"], ctx["perf"], ctx["ind_s"]
    spy = ctx["spy"]
    start = int(ctx.get("start", 260))
    dates = C.index
    nd = len(dates)
    r1d = (C / C.shift(1) - 1).clip(-0.25, 0.25)
    r63 = C / C.shift(63) - 1
    spy63 = spy / spy.shift(63) - 1
    rng5 = ((H - L) / C * 100).rolling(5).mean()
    h20 = H.rolling(20, min_periods=15).max()
    near_base = (C >= 0.95 * h20) & (rng5 < 0.75 * adr)
    dvol = C * V
    upv = dvol.where(C > C.shift(1), 0)
    dnv = dvol.where(C < C.shift(1), 0)
    groups = {}
    for t in C.columns:
        g = ind_s.get(t)
        if g is not None:
            groups.setdefault(g, []).append(t)
    groups = {g: m for g, m in groups.items() if len(m) >= 3}
    F = {k: {} for k in KEYS}
    idx, med, extra = {}, {}, {}
    for g, m in groups.items():
        vm = valid[m]
        nv = vm.sum(axis=1).replace(0, np.nan)
        ok = nv >= 3
        F["price"][g] = perf[m].where(vm).median(axis=1).where(ok)
        gi = (1 + r1d[m].where(vm).mean(axis=1).fillna(0)).cumprod()
        idx[g] = gi
        above50 = ((C[m] > s50[m]) & vm).sum(axis=1) / nv * 100
        nearhi = ((dd_hi[m] >= -10) & vm).sum(axis=1) / nv * 100
        beat = ((r63[m].sub(spy63, axis=0) > 0) & vm).sum(axis=1) / nv * 100
        F["breadth"][g] = ((above50 + nearhi + beat) / 3).where(ok)
        u = upv[m].where(vm).sum(axis=1).rolling(50, min_periods=20).sum()
        d = dnv[m].where(vm).sum(axis=1).rolling(50, min_periods=20).sum()
        F["accum"][g] = (u / d.replace(0, np.nan)).where(ok)
        F["bases"][g] = ((near_base[m] & vm & liquid[m]).sum(axis=1) / nv * 100).where(ok)
        extra[g] = {"above50": above50, "nearhi": nearhi, "beat": beat}
        med[g] = {k: (C[m] / C[m].shift(k) - 1).where(vm).median(axis=1) * 100 for k in (5, 21, 63, 126)}
        med[g]["up21"] = (((C[m] / C[m].shift(21) - 1) > 0) & vm).sum(axis=1) / nv * 100
    gi_df = pd.DataFrame(idx)
    rsl = gi_df.div(spy / spy.iloc[0], axis=0)
    slope = rsl / rsl.shift(21) - 1
    rsl_hi = rsl >= rsl.rolling(252, min_periods=120).max() * 0.995
    rsl_ma = rsl.rolling(50, min_periods=30).mean()
    F["rsl"] = (slope.rank(axis=1, pct=True) * 0.7 + (rsl_hi | (rsl > rsl_ma)).astype(float) * 0.3)
    F["rsl"] = F["rsl"].where(gi_df.notna())
    for k in ("price", "breadth", "accum", "bases"):
        F[k] = pd.DataFrame(F[k])
    price_rank = F["price"].rank(axis=1, pct=True)
    topq = (price_rank >= 0.7).astype(float).where(price_rank.notna())
    F["persist"] = topq.rolling(40, min_periods=20).mean()
    P = {k: F[k].rank(axis=1, pct=True) * 100 for k in KEYS}
    score = sum(P[k].fillna(50) for k in KEYS) / len(KEYS)
    score = score.where(F["price"].notna())

    # ---- kiểm chứng: điểm hôm nay có dự báo ngành tăng hơn SPY 1 / 3 tháng sau không?
    def fwd(h):
        return (gi_df.shift(-h) / gi_df - 1).sub(spy.shift(-h) / spy - 1, axis=0) * 100
    val = {}
    for h, lab in ((21, "1 tháng"), (63, "3 tháng")):
        fr = fwd(h)
        rows, ics = {q: [] for q in range(5)}, []
        hits = []
        for i in range(start, nd - h, 5):
            s_, f_ = score.iloc[i], fr.iloc[i]
            okm = s_.notna() & f_.notna()
            if okm.sum() < 5:
                continue
            s_, f_ = s_[okm], f_[okm]
            q = pd.qcut(s_.rank(method="first"), 5, labels=False)
            for k in range(5):
                rows[k].append(f_[q == k].mean())
            ics.append(s_.rank().corr(f_.rank()))
            hits.append(float((f_[q == 4] > 0).mean()))
        val[lab] = {"quint": [{"q": ["Thấp nhất", "Thấp", "Giữa", "Cao", "Cao nhất"][k], "fwd": _r(np.mean(rows[k]), 2) if rows[k] else None} for k in range(5)],
                    "ic": _r(np.mean(ics), 2) if ics else None, "hit": _r(np.mean(hits) * 100, 0) if hits else None, "n": len(ics),
                    "spread": _r(np.mean(rows[4]) - np.mean(rows[0]), 2) if rows[4] and rows[0] else None}
        # ngoài mẫu: 1/3 dữ liệu sau cùng
        k0 = len(ics) * 2 // 3
        val[lab]["ic_oos"] = _r(np.mean(ics[k0:]), 2) if len(ics) - k0 >= 3 else None
        val[lab]["hit_oos"] = _r(np.mean(hits[k0:]) * 100, 0) if len(hits) - k0 >= 3 else None

    # ---- hôm nay
    t0 = nd - 1
    out_rows = []
    n_g = int(score.iloc[t0].notna().sum()) or 1
    for g in groups:
        sc = score[g].iloc[t0]
        if not np.isfinite(sc):
            continue
        sc21 = score[g].iloc[t0 - 21] if t0 >= 21 else np.nan
        ev = {k: _r(P[k][g].iloc[t0], 0) for k in KEYS}
        rk = int(score.iloc[t0].rank(ascending=False, method="min")[g])
        pers = F["persist"][g].iloc[t0]
        row = {"ind": g, "n": len(groups[g]), "score": _r(sc, 0), "score21": _r(sc21, 0), "rank": rk, "ev": ev,
               "rsl21": _r(slope[g].iloc[t0] * 100, 1), "rsl_hi": bool(rsl_hi[g].iloc[t0]),
               "above50": _r(extra[g]["above50"].iloc[t0], 0), "nearhi": _r(extra[g]["nearhi"].iloc[t0], 0), "beat": _r(extra[g]["beat"].iloc[t0], 0),
               "persist": _r(pers * 100, 0), "accum": _r(F["accum"][g].iloc[t0], 2), "bases": _r(F["bases"][g].iloc[t0], 0),
               "m5": _r(med[g][5].iloc[t0]), "m21": _r(med[g][21].iloc[t0]), "m63": _r(med[g][63].iloc[t0]), "m126": _r(med[g][126].iloc[t0]),
               "up21": _r(med[g]["up21"].iloc[t0], 0),
               "best": sorted([t for t in groups[g] if valid[t].iloc[t0]], key=lambda t: -(rs[t].iloc[t0] if np.isfinite(rs[t].iloc[t0]) else -1))[:5]}
        d21 = (sc - sc21) if np.isfinite(sc21) else 0
        if sc >= 70 and (pers or 0) >= 0.5:
            row["label"] = "Dẫn dắt"
        elif sc >= 60 and d21 >= 15:
            row["label"] = "Mới nổi"
        elif np.isfinite(sc21) and sc21 >= 70 and d21 <= -15:
            row["label"] = "Suy yếu"
        elif sc < 30:
            row["label"] = "Tụt hậu"
        else:
            row["label"] = ""
        out_rows.append(row)
    out_rows.sort(key=lambda r: -r["score"])
    keep = 250
    step = 2
    sel = [r["ind"] for r in out_rows[:150]]
    di = list(range(max(0, nd - keep), nd, step))
    if di[-1] != nd - 1:
        di.append(nd - 1)
    base_i = di[0]
    series = {"d": [dates[i].strftime("%Y-%m-%d") for i in di],
              "spy": [_r(spy.iloc[i] / spy.iloc[base_i] * 100, 1) for i in di],
              "rsl": {g: [_r(rsl[g].iloc[i] / rsl[g].iloc[base_i] * 100, 1) if np.isfinite(rsl[g].iloc[base_i]) else None for i in di] for g in sel},
              "score": {g: [_r(score[g].iloc[i], 0) for i in di] for g in sel}}
    return {"rows": out_rows, "validation": val, "series": series, "labels": LABELS, "n_groups": n_g,
            "from": dates[min(start, nd - 1)].strftime("%Y-%m-%d")}, score


def add_fund(out: dict) -> None:
    """Gắn tăng trưởng EPS/doanh thu trung vị theo ngành (chỉ có số liệu hôm nay) và cập nhật điểm tổng."""
    G = out.get("groups")
    if not G or not G.get("rows"):
        return
    by = {}
    for s in out["stocks"]:
        g = s.get("ind")
        if g is None:
            continue
        by.setdefault(g, {"eps": [], "rev": []})
        if s.get("eps_yoy") is not None:
            by[g]["eps"].append(s["eps_yoy"])
        if s.get("rev_yoy") is not None:
            by[g]["rev"].append(s["rev_yoy"])
    vals = []
    for r in G["rows"]:
        b = by.get(r["ind"], {"eps": [], "rev": []})
        r["eps"] = _r(np.median(b["eps"]), 0) if len(b["eps"]) >= 2 else None
        r["rev"] = _r(np.median(b["rev"]), 0) if len(b["rev"]) >= 2 else None
        r["fund_n"] = len(b["eps"])
        if r["eps"] is not None or r["rev"] is not None:
            vals.append((r, (r["eps"] or 0) * 0.6 + (r["rev"] or 0) * 0.4))
    if len(vals) >= 3:
        s = pd.Series([v for _, v in vals]).rank(pct=True) * 100
        for (r, _), p in zip(vals, s):
            r["ev"]["fund"] = _r(p, 0)
    for r in G["rows"]:
        ev = [v for v in r["ev"].values() if v is not None]
        r["score_all"] = _r(np.mean(ev), 0) if ev else r["score"]
        thr = {"price": 70, "rsl": 70, "breadth": 60, "persist": 60, "accum": 60, "bases": 60, "fund": 60}
        r["have"] = [LABELS[k] for k, v in r["ev"].items() if v is not None and v >= thr[k]]
        r["miss"] = [LABELS[k] for k, v in r["ev"].items() if v is None or v < thr[k]]
    G["rows"].sort(key=lambda r: -(r.get("score_all") or 0))
