"""Hiệu quả của từng mẫu hình / phong cách theo điều kiện thị trường.

Mỗi ngày trong quá khứ được gắn nhãn theo nhiều tiêu chí thị trường (xu hướng QQQ, điểm sức khỏe, cảnh báo,
ngày phân phối, độ rộng, breakout giữ giá, pha chu kỳ, tỷ lệ Stockbee). Với mỗi mẫu hình, gom các tín hiệu
xuất hiện trong những ngày có cùng nhãn rồi đo tỷ lệ có lãi và lãi trung bình sau 1/3/5/21 phiên.
Với mỗi phong cách huyền thoại, gom các lệnh kiểm chứng theo nhãn của ngày vào lệnh.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

MIN_N = 20  # dưới số tín hiệu này thì kết quả chưa đáng tin


def _r(x, d=1):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return round(x, d) if math.isfinite(x) else None


def _cut(s: pd.Series, edges, labels):
    out = pd.Series(None, index=s.index, dtype=object)
    for (lo, hi), lb in zip(edges, labels):
        out[(s >= lo) & (s < hi)] = lb
    return out


def build_dims(hist: pd.DataFrame, phase: pd.Series) -> list[dict]:
    sc = hist["score"].astype(float)
    dims = [
        {"key": "reg", "label": "Xu hướng QQQ (Martin Luk)", "buckets": ["Tốt", "Giằng co", "Xấu"],
         "s": hist["qqq_regime"].astype(object)},
        {"key": "score", "label": "Điểm sức khỏe thị trường", "buckets": ["Tấn công", "Bình thường", "Thận trọng", "Phòng thủ"],
         "s": _cut(sc, [(70, 999), (50, 70), (30, 50), (-999, 30)], ["Tấn công", "Bình thường", "Thận trọng", "Phòng thủ"])},
        {"key": "alert", "label": "Cảnh báo thị trường", "buckets": ["Xanh", "Vàng", "Đỏ"], "s": hist["alert"].astype(object)},
        {"key": "phase", "label": "Pha chu kỳ QQQ", "buckets": ["Tăng", "Điều chỉnh", "Giằng co", "Giảm"], "s": phase.reindex(hist.index).astype(object)},
        {"key": "dd", "label": "Ngày phân phối QQQ (O'Neil)", "buckets": ["0–3 ngày", "4–5 ngày", "Từ 6 ngày"],
         "s": _cut(hist["dd_qqq"].astype(float), [(-1, 3.5), (3.5, 5.5), (5.5, 99)], ["0–3 ngày", "4–5 ngày", "Từ 6 ngày"])},
        {"key": "breadth", "label": "% cổ phiếu trên EMA 21", "buckets": ["Trên 60%", "40–60%", "Dưới 40%"],
         "s": _cut(hist["pct_e21"].astype(float), [(60, 101), (40, 60), (-1, 40)], ["Trên 60%", "40–60%", "Dưới 40%"])},
        {"key": "bo", "label": "Breakout top 100 giữ giá sau 5 phiên", "buckets": ["Trên 60%", "40–60%", "Dưới 40%"],
         "s": _cut(hist["bo_ok"].astype(float), [(60, 101), (40, 60), (-1, 40)], ["Trên 60%", "40–60%", "Dưới 40%"])},
        {"key": "sb", "label": "Tỷ lệ bứt phá/sập 4% 10 ngày (Stockbee)", "buckets": ["Trên 2", "1–2", "Dưới 1"],
         "s": _cut(hist["ratio10"].astype(float), [(2, 1e9), (1, 2), (-1, 1)], ["Trên 2", "1–2", "Dưới 1"])},
    ]
    if "flow_gold" in hist:
        dims.insert(0, {"key": "gold", "label": "Thời điểm mua của thị trường", "buckets": ["Thời điểm vàng", "Thuận lợi", "Trung tính", "Bất lợi"],
                        "s": hist["flow_gold"].astype(object)})
    if "flow_stage" in hist:
        dims.insert(0, {"key": "flow", "label": "Giai đoạn dòng tiền", "buckets": ["Xu hướng giảm", "Hồi phục ban đầu", "Dòng tiền lan rộng", "Uptrend xác nhận", "Phân phối / suy yếu", "Chưa rõ ràng"],
                        "s": hist["flow_stage"].astype(object)})
    return dims


def _cell(n, w, tot, st=None):
    if not n:
        return {"n": 0}
    c = {"n": int(n), "win": _r(w / n * 100, 0), "avg": _r(tot / n * 100, 2)}
    if st is not None:
        c["stop"] = _r(st / n * 100, 0)
    return c


def analyze(hist: pd.DataFrame, phase: pd.Series, patterns: dict, C: pd.DataFrame, L: pd.DataFrame,
            legend_trades: dict, legend_names: dict, vsa: dict | None = None, start: int = 260) -> dict:
    dates = C.index
    dims = build_dims(hist, phase)
    now = {d["key"]: (d["s"].iloc[-1] if isinstance(d["s"].iloc[-1], str) else None) for d in dims}
    # ngày "giống hôm nay": cùng xu hướng QQQ, cùng cảnh báo, cùng nhóm độ rộng
    like = pd.Series(True, index=dates)
    like_keys = []
    for k in ("reg", "alert", "breadth"):
        d = next(x for x in dims if x["key"] == k)
        if now[k]:
            like &= d["s"] == now[k]
            like_keys.append(f"{d['label']}: {now[k]}")
    valid_day = pd.Series(np.arange(len(dates)) >= start, index=dates)

    fwd = {h: C.shift(-h) / C - 1 for h in (1, 3, 5, 21)}
    stop5 = L.rolling(5, min_periods=5).min().shift(-5) < L
    items = []
    sigsets = [("Mẫu hình", patterns)] + ([("VSA", vsa)] if vsa else [])
    for group, pats in sigsets:
        for name, sig in pats.items():
            sig = sig.fillna(False).astype(bool) & valid_day.values[:, None]
            it = {"id": name, "name": name, "group": group, "metric": "pct", "h": {}}
            for h, f in fwd.items():
                ok = sig & f.notna()
                n_d = ok.sum(axis=1)
                w_d = (ok & (f > 0)).sum(axis=1)
                t_d = f.where(ok).sum(axis=1)
                s_d = (ok & stop5.fillna(False)).sum(axis=1) if h == 5 else None
                res = {"all": _cell(n_d.sum(), w_d.sum(), t_d.sum(), s_d.sum() if s_d is not None else None),
                       "like": _cell(n_d[like].sum(), w_d[like].sum(), t_d[like].sum(), s_d[like].sum() if s_d is not None else None)}
                for d in dims:
                    lab = d["s"]
                    res[d["key"]] = {b: _cell(n_d[lab == b].sum(), w_d[lab == b].sum(), t_d[lab == b].sum(),
                                              s_d[lab == b].sum() if s_d is not None else None) for b in d["buckets"]}
                it["h"][str(h)] = res
            items.append(it)

    # phong cách huyền thoại: lệnh kiểm chứng, gắn nhãn theo ngày vào lệnh, đo bằng R
    for lid, trades in legend_trades.items():
        closed = [t for t in trades if not t["open"] and t["d"] >= start]
        def stats(ts):
            if not ts:
                return {"n": 0}
            r = np.array([t["r"] for t in ts])
            pct = np.array([t["pct"] for t in ts])
            return {"n": len(ts), "win": _r((r > 0).mean() * 100, 0), "avg": _r(pct.mean(), 2), "exp": _r(r.mean(), 2)}
        res = {"all": stats(closed), "like": stats([t for t in closed if bool(like.iloc[t["d"]])])}
        for d in dims:
            lab = d["s"].values
            res[d["key"]] = {b: stats([t for t in closed if lab[t["d"]] == b]) for b in d["buckets"]}
        items.append({"id": lid, "name": legend_names.get(lid, lid), "group": "Phong cách", "metric": "r", "h": {"trade": res}})

    out = {"from": dates[min(start, len(dates) - 1)].strftime("%Y-%m-%d"), "to": dates[-1].strftime("%Y-%m-%d"), "min_n": MIN_N,
           "dims": [{"key": d["key"], "label": d["label"], "buckets": d["buckets"], "now": now[d["key"]],
                     "days": {b: int((d["s"][valid_day] == b).sum()) for b in d["buckets"]}} for d in dims],
           "like": {"desc": like_keys, "days": int((like & valid_day).sum())},
           "items": items}
    out["notes"] = notes(out)
    return out


def _p(x):
    return "—" if x is None else (f"+{x:.1f}%" if x > 0 else f"{x:.1f}%").replace(".", ",")


def notes(o: dict) -> list[str]:
    res = []
    dims = {d["key"]: d for d in o["dims"]}
    nowtxt = ", ".join(f"{d['label'].split(' (')[0]}: {d['now']}" for d in o["dims"] if d["now"])
    res.append(f"Thị trường hôm nay: {nowtxt}.")
    pats = [i for i in o["items"] if i["metric"] == "pct"]
    like_days = o["like"]["days"]
    if like_days:
        res.append(f"Trong quá khứ có {like_days} phiên giống hôm nay ({'; '.join(o['like']['desc'])}).")
    rows = [(i["name"], i["h"]["5"]["like"]) for i in pats if (i["h"]["5"]["like"].get("n") or 0) >= MIN_N]
    rows.sort(key=lambda x: (-(x[1]["win"] or 0), -(x[1]["avg"] or 0)))
    if rows:
        res.append("Mẫu hình hiệu quả nhất trong những phiên giống hôm nay (sau 5 phiên): " + "; ".join(
            f"{n} {c['win']:.0f}% có lãi, TB {_p(c['avg'])} ({c['n']} tín hiệu)" for n, c in rows[:3]) + ".")
        weak = [r for r in rows if (r[1]["win"] or 0) < 50]
        if weak:
            res.append("Nên tránh: " + "; ".join(f"{n} ({c['win']:.0f}% có lãi)" for n, c in weak[-2:]) + ".")
    else:
        res.append("Chưa đủ tín hiệu trong các phiên giống hôm nay để kết luận; xem từng tiêu chí bên dưới.")
    leg = [(i["name"], i["h"]["trade"]["like"]) for i in o["items"] if i["metric"] == "r" and (i["h"]["trade"]["like"].get("n") or 0) >= 10]
    leg.sort(key=lambda x: -(x[1]["exp"] or -9))
    if leg:
        res.append("Phong cách có kỳ vọng tốt nhất trong các phiên giống hôm nay: " + "; ".join(
            f"{n} {c['exp']:+.2f}R, thắng {c['win']:.0f}% ({c['n']} lệnh)".replace(".", ",") for n, c in leg[:3]) + ".")
    # mẫu hình nhạy cảm nhất với xu hướng QQQ
    reg = dims.get("reg")
    if reg:
        gaps = []
        for i in pats:
            c = i["h"]["5"]["reg"]
            a, b = c.get("Tốt", {}), c.get("Xấu", {})
            if (a.get("n") or 0) >= MIN_N and (b.get("n") or 0) >= MIN_N:
                gaps.append((i["name"], a["win"] - b["win"], a["win"], b["win"]))
        gaps.sort(key=lambda x: -x[1])
        if gaps:
            g = gaps[0]
            res.append(f"Phụ thuộc thị trường nhiều nhất: {g[0]} ({g[2]:.0f}% có lãi khi QQQ Tốt, chỉ {g[3]:.0f}% khi QQQ Xấu).")
            g = gaps[-1]
            res.append(f"Ít phụ thuộc thị trường nhất: {g[0]} ({g[2]:.0f}% khi QQQ Tốt, {g[3]:.0f}% khi QQQ Xấu).")
    return res
