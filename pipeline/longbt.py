"""Kiểm chứng DÀI HẠN (từ 2019) theo từng năm: các phương pháp huyền thoại và các setup, cùng quy tắc như kiểm chứng
hằng ngày, nhưng chạy trên giá Yahoo nhiều năm để biết phương pháp nào dương qua nhiều kiểu thị trường (2020, 2021 tăng
mạnh; 2022 giảm; 2023–2024 tăng; 2025–2026), không chỉ một năm gần nhất.

Thêm: kiểm chứng dài hạn các chỉ báo của nhóm top 100 (pha, tốc độ tăng so với QQQ, độ ra/vào top 100).

Giới hạn: Yahoo chỉ có các mã CÒN niêm yết hôm nay, nên kết quả đẹp hơn thực tế một chút (mã đã hủy niêm yết,
thường là mã giảm mạnh, không có). Chỉ dùng ~1.200 mã thanh khoản nhất hiện nay để chạy đủ nhanh.
Kết quả được lưu đệm 30 ngày (pipeline/cache/longbt.json) vì tải và tính mất nhiều phút.
"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "pipeline" / "cache" / "longbt.json"
VER = 3
START = "2019-01-01"
N_TICK = 1200
NAMES = {"mm": "Mark Minervini", "wo": "William O'Neil", "sw": "Stan Weinstein",
         "pb": "Pradeep Bonde", "ok": "Oliver Kell"}


def _r(x, d=2):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return round(x, d) if np.isfinite(x) else None


def _download(tickers: list[str], minutes: float = 25) -> dict:
    import yfinance as yf
    out, t_end = {}, time.time() + minutes * 60
    for k in range(0, len(tickers), 100):
        if time.time() > t_end:
            print("Kiểm chứng dài hạn: hết thời gian tải, dùng phần đã có", file=sys.stderr)
            break
        chunk = tickers[k:k + 100]
        ymap = {t.replace(".", "-"): t for t in chunk}
        try:
            df = yf.download(list(ymap), start=START, interval="1d", auto_adjust=True, progress=False, threads=True, group_by="ticker")
        except Exception as e:
            print("Kiểm chứng dài hạn: lỗi tải", e, file=sys.stderr)
            continue
        if df is None or df.empty:
            continue
        for yt, t in ymap.items():
            try:
                d = df[yt] if isinstance(df.columns, pd.MultiIndex) else df
                d = d[["Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Close"])
                if len(d) >= 260:
                    out[t] = d.astype(float)
            except Exception:
                continue
    return out


def _stats(rs: list[float]) -> dict:
    if not rs:
        return {"n": 0}
    a = np.array(rs, dtype=float)
    return {"n": int(len(a)), "win": _r((a > 0).mean() * 100, 0), "exp": _r(a.mean()), "total": _r(a.sum(), 1)}


def _by_year(trades, dates, key_i, min_n=20):
    years = sorted({dates[t[key_i]].year for t in trades})
    yrs = {y: _stats([t["r"] for t in trades if dates[t[key_i]].year == y]) for y in years}
    allst = _stats([t["r"] for t in trades])
    ok_years = [y for y, s in yrs.items() if s["n"] >= min_n]
    pos = sum(1 for y in ok_years if (yrs[y]["exp"] or 0) > 0)
    keep = (allst.get("exp") or 0) > 0 and pos >= max(1, len(ok_years) / 2)
    return {"years": {str(y): s for y, s in yrs.items()}, "all": allst, "pos_years": pos, "n_years": len(ok_years),
            "verdict": "Quá ít lệnh để kết luận" if not ok_years else "Giữ: dương qua phần lớn các năm" if keep else ("Chỉ dương vài năm: chưa ổn định" if pos else "Bỏ: âm hầu hết các năm")}


def _fwd_table(rows, t_idx, q, n):
    """rows: [(tên, danh sách chỉ số ngày)] → lợi nhuận nhóm top 100 / QQQ 1 tháng sau."""
    out = []
    for name, I in rows:
        f = [(t_idx[i + 21] / t_idx[i] - 1) * 100 for i in I if i + 21 < n]
        g = [(q[i + 21] / q[i] - 1) * 100 for i in I if i + 21 < n and np.isfinite(q[i]) and np.isfinite(q[i + 21])]
        dd = [(np.nanmin(t_idx[i + 1:i + 22]) / t_idx[i] - 1) * 100 for i in I if i + 21 < n]
        out.append({"name": name, "days": len(I), "top21": _r(np.mean(f), 1) if f else None, "win": _r(np.mean([x > 0 for x in f]) * 100, 0) if f else None,
                    "q21": _r(np.mean(g), 1) if g else None, "dd8": _r(np.mean([x < -8 for x in dd]) * 100, 0) if dd else None})
    return out


def top_tests(hist: pd.DataFrame, start: int = 260) -> dict:
    """Kiểm chứng các chỉ báo của nhóm top 100 trên lịch sử dài."""
    import cycle
    b = hist["b_ret1"].fillna(0).values / 100
    t_idx = np.cumprod(1 + b) * 100
    q = hist["qqq"].astype(float).values
    n = len(t_idx)
    ph = cycle.phase_series(pd.Series(t_idx, index=hist.index)).values          # lên chậm, xuống nhanh (cách trang đang dùng)
    phr = cycle.phase_series(pd.Series(t_idx, index=hist.index), mode="raw").values  # đổi màu ngay trong ngày
    rs = t_idx / q
    m21 = np.full(n, np.nan)
    m21[21:] = (rs[21:] / rs[:-21] - 1) * 100
    I = [i for i in range(start, n) if isinstance(ph[i], str)]
    phase = _fwd_table([("Mọi ngày", I), ("Pha xanh lá + vàng (Tăng, Điều chỉnh)", [i for i in I if ph[i] in ("Tăng", "Điều chỉnh")]),
                        ("Pha xanh lá (Tăng)", [i for i in I if ph[i] == "Tăng"]), ("Pha đỏ + xanh dương (Giảm, Giằng co)", [i for i in I if ph[i] in ("Giảm", "Giằng co")])], t_idx, q, n)
    def chg_per_year(p):
        v = [x for x in p[start:] if isinstance(x, str)]
        return _r(sum(1 for a, b2 in zip(v, v[1:]) if a != b2) / max(1, len(v) / 252), 0)
    Ir = [i for i in range(start, n) if isinstance(phr[i], str)]
    phase_raw = _fwd_table([("Mọi ngày", Ir), ("Pha xanh lá + vàng (Tăng, Điều chỉnh)", [i for i in Ir if phr[i] in ("Tăng", "Điều chỉnh")]),
                            ("Pha xanh lá (Tăng)", [i for i in Ir if phr[i] == "Tăng"]), ("Pha đỏ + xanh dương (Giảm, Giằng co)", [i for i in Ir if phr[i] in ("Giảm", "Giằng co")])], t_idx, q, n)
    # chuỗi dài để vẽ biểu đồ pha từ 2020 (cả nhóm top 100 lẫn QQQ, cùng cách tô màu)
    phq = cycle.phase_series(pd.Series(q, index=hist.index)).values
    series = {"d": [x.strftime("%Y-%m-%d") for x in hist.index[start:]], "top": [_r(x, 2) for x in t_idx[start:]], "qqq": [_r(x, 2) for x in q[start:]],
              "ph_top": [x if isinstance(x, str) else None for x in ph[start:]], "ph_qqq": [x if isinstance(x, str) else None for x in phq[start:]]}
    stats = {}
    for key, ser_, p_ in (("top", t_idx, ph), ("qqq", q, phq)):
        s_ = pd.Series(ser_[start:], index=hist.index[start:])
        segs = cycle.segments(pd.Series(p_[start:], index=hist.index[start:]), s_)
        stats[key] = cycle.phase_stats(segs)
    speed = _fwd_table([("Mọi ngày", I), ("Top 100 mạnh hơn QQQ (21 phiên)", [i for i in I if m21[i] > 0]),
                        ("Top 100 yếu hơn QQQ (21 phiên)", [i for i in I if m21[i] < 0]),
                        ("Top 100 yếu hơn QQQ trên 5%", [i for i in I if m21[i] < -5]),
                        ("Top 100 mạnh hơn QQQ trên 5%", [i for i in I if m21[i] > 5])], t_idx, q, n)
    # Ants (David Ryan): số mã có Ants mỗi ngày, theo % số mã thanh khoản (vì số mã trong danh sách khác nhau giữa các nguồn)
    ap = hist["ants_pct"].astype(float).values if "ants_pct" in hist else np.full(n, np.nan)
    lo40 = pd.Series(ap).rolling(40, min_periods=20).min().shift(1).values
    ants = _fwd_table([("Mọi ngày", I)] + [(f"Mã có Ants ≥ {th}% số mã thanh khoản", [i for i in I if np.isfinite(ap[i]) and ap[i] >= th]) for th in (0.5, 1, 1.5, 3)]
                      + [("Mã có Ants < 0,5% (rất ít mã tăng đều)", [i for i in I if np.isfinite(ap[i]) and ap[i] < 0.5]),
                         ("Ants vượt lên 1,5% sau khi đã dưới 0,5% trong 40 phiên (bùng lên sau giai đoạn trầm lắng)",
                          [i for i in I if np.isfinite(ap[i]) and ap[i] >= 1.5 and np.isfinite(lo40[i]) and lo40[i] < 0.5 and not (np.isfinite(ap[i - 1]) and ap[i - 1] >= 1.5)])], t_idx, q, n)
    return {"phase": phase, "phase_raw": phase_raw, "chg_asym": chg_per_year(ph), "chg_raw": chg_per_year(phr),
            "speed": speed, "ants": ants, "series": series, "phase_stats": stats}



def market_filters(hist: pd.DataFrame) -> dict:
    """Các điều kiện 'được mở lệnh mới' cần so sánh. Mỗi cái là chuỗi True/False theo ngày, chỉ dùng dữ liệu tới ngày đó."""
    q = hist["qqq"].astype(float)
    s50, s200 = q.rolling(50, min_periods=40).mean(), q.rolling(200, min_periods=150).mean()
    reg = hist["qqq_regime"] if "qqq_regime" in hist else pd.Series("Giằng co", index=hist.index)
    hl = (hist["nh52"] - hist["nl52"]) / hist["n"].replace(0, np.nan) * 100
    no_wash = ~(hl < -10).rolling(20, min_periods=1).max().fillna(0).astype(bool)
    f1 = reg != "Xấu"
    f2 = ~((q < s200) & (s200 < s200.shift(20)))
    return {
        "Mọi ngày (không lọc)": pd.Series(True, index=hist.index),
        "Xu hướng QQQ không Xấu (đang dùng)": f1,
        "Không phải: QQQ dưới SMA 200 đang dốc xuống": f2,
        "Không có phiên đáy mới 52 tuần vượt đỉnh mới >10% số mã trong 20 phiên": no_wash,
        "QQQ trên SMA 50": q > s50,
        "Xu hướng QQQ không Xấu + không dưới SMA 200 dốc xuống": f1 & f2,
        "Xu hướng QQQ không Xấu + không có phiên đáy mới diện rộng 20 phiên": f1 & no_wash,
    }


def filter_test(trades, dates, hist, start_key="i") -> list:
    F = market_filters(hist)
    out = []
    for name, f in F.items():
        fv = f.reindex(dates).fillna(False).values
        kept = [t for t in trades if fv[t[start_key]]]
        a = np.array([t["r"] for t in kept]) if kept else np.array([])
        order = sorted(kept, key=lambda t: t["x"])
        cum = np.cumsum([t["r"] for t in order]) if order else np.array([0.0])
        mdd = float((cum - np.maximum.accumulate(cum)).min()) if len(cum) else 0.0
        y22 = [t["r"] for t in kept if dates[t[start_key]].year == 2022]
        yrs = _by_year(kept, dates, start_key)
        out.append({"name": name, "share": _r(float(f.iloc[260:].mean()) * 100, 0), "n": len(kept), "exp": _r(a.mean()) if len(a) else None,
                    "total": _r(a.sum(), 0) if len(a) else None, "mdd": _r(mdd, 0), "y2022": _r(np.mean(y22)) if y22 else None,
                    "pos_years": yrs["pos_years"], "n_years": yrs["n_years"]})
    return out


def holders_test(res, step: int = 5) -> list:
    """Khi QQQ đang điều chỉnh (cách đỉnh 60 phiên ≥ 8%): mã giữ sức mạnh có tăng hơn sau 1 và 3 tháng không?"""
    C, A, liq, rs, qc = res["C"], res["holders"], res["liquid"], res["rs"], res["qc"]
    n = len(C)
    dd60 = (qc / qc.rolling(60, min_periods=20).max() - 1).values
    days = [i for i in range(res["start"], n - 1, step) if dd60[i] <= -0.08]
    groups = {"Mã giữ sức mạnh (sát đỉnh 1 năm ≤ 10%, đường RS lập đỉnh, RS ≥ 80)": A & liq,
              "Mã RS ≥ 80 còn lại": liq & (rs >= 80) & ~A, "Mọi mã thanh khoản": liq}
    out = []
    for h in (21, 63):
        f = (C.shift(-h) / C - 1).values * 100
        qf = (qc.shift(-h) / qc - 1).values * 100
        for name, m in groups.items():
            mv = m.values
            vals, beat = [], []
            for i in days:
                if i + h >= n:
                    continue
                x = f[i][mv[i] & np.isfinite(f[i])]
                vals.extend(x.tolist())
                beat.extend((x > qf[i]).tolist())
            out.append({"h": h, "name": name, "n": len(vals), "days": len([i for i in days if i + h < n]),
                        "avg": _r(np.mean(vals), 1) if vals else None, "med": _r(np.median(vals), 1) if vals else None,
                        "win": _r(np.mean(np.array(vals) > 0) * 100, 0) if vals else None, "beat": _r(np.mean(beat) * 100, 0) if beat else None})
    return out


def compute(raw_recent: dict, universe: pd.DataFrame, demo: bool = False) -> dict:
    now = datetime.now(timezone.utc)
    if not demo and CACHE.exists():
        try:
            c = json.loads(CACHE.read_text())
            if c.get("ver") == VER and (now - datetime.fromisoformat(c["built"])).days < 30:
                return c
        except Exception:
            pass
    import build
    stocks = [t for t in universe.ticker if t in raw_recent]
    if demo:
        raw_long, src = raw_recent, "dữ liệu giả lập (demo)"
    else:
        dvs = {t: float((raw_recent[t]["Close"] * raw_recent[t]["Volume"]).tail(20).mean()) for t in stocks}
        pick = sorted((t for t in dvs if np.isfinite(dvs[t])), key=lambda t: -dvs[t])[:N_TICK]
        idx = [k for k in build.INDEXES]
        raw_long = _download(pick + idx)
        src = f"Yahoo, {len([t for t in raw_long if t not in idx])} mã thanh khoản nhất hiện nay"
        if "QQQ" not in raw_long or len(raw_long) < 300:
            print("Kiểm chứng dài hạn: không tải đủ dữ liệu Yahoo, bỏ qua", file=sys.stderr)
            return {}
    uni = universe[universe.ticker.isin(raw_long)]
    old = dict(build.CONFIG)
    build.CONFIG.update({"bt_days": 100000, "bt_gates": False})
    try:
        res = build.compute(raw_long, uni, bt_only=True)
    finally:
        build.CONFIG.clear()
        build.CONFIG.update(old)
    dates = res["dates"]
    legends = []
    for k, tr in (res["bt_raw"] or {}).items():
        closed = [t for t in tr if not t["open"]]
        legends.append({"id": k, "name": NAMES.get(k, k), **_by_year(closed, dates, "d")})
    lab_tr = [t for t in res["lab_trades"] if not t["open"]]
    setups = []
    for name in sorted({t["s"] for t in lab_tr}):
        ts = [t for t in lab_tr if t["s"] == name]
        ok = [t for t in ts if t["d"].get("reg") != "Xấu"]
        setups.append({"name": name, **_by_year(ts, dates, "e"), "ok": _by_year(ok, dates, "e")})
    q = res["hist"]["qqq"].astype(float)
    qy = {str(y): _r((g.iloc[-1] / g.iloc[0] - 1) * 100, 1) for y, g in q.groupby(q.index.year) if len(g) > 20}
    lab_all = [t for t in lab_tr]
    try:
        flt = filter_test(lab_all, dates, res["hist"], "i")
    except Exception as e:
        print("Kiểm chứng dài hạn: lỗi bộ lọc", e, file=sys.stderr)
        flt = []
    try:
        hold = holders_test(res)
    except Exception as e:
        print("Kiểm chứng dài hạn: lỗi mã giữ sức mạnh", e, file=sys.stderr)
        hold = []
    out = {"ver": VER, "built": now.isoformat(), "filters": flt, "holders": hold, "src": src, "from": dates[res["start"]].strftime("%Y-%m-%d"), "to": dates[-1].strftime("%Y-%m-%d"),
           "n_stocks": res["n_stocks"], "qqq_years": qy, "legends": legends, "setups": setups, "top": top_tests(res["hist"]),
           "note": "Chỉ gồm các mã còn niêm yết hôm nay nên kết quả đẹp hơn thực tế một chút. Có áp dụng quy tắc phòng thủ như kiểm chứng hằng ngày. Setup: cột 'Khi QQQ không Xấu' là chỉ tính lệnh mở khi xu hướng QQQ không Xấu."}
    if not demo:
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(out))
    return out
