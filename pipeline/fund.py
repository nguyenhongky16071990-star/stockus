"""Số liệu cơ bản: doanh thu và EPS theo quý / năm.

Nguồn:
  1. Massive "Income Statements" nếu khóa có gói Financials (một lần gọi lấy cả thị trường).
  2. Nếu không, Yahoo Finance qua yfinance cho các mã ứng viên (top RS, nhóm mạnh, mã có setup).
Kết quả lưu đệm 7 ngày trong pipeline/cache/fund.json vì báo cáo chỉ ra mỗi quý một lần.
"""
from __future__ import annotations

import json
import math
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE_FILE = ROOT / "pipeline" / "cache" / "fund.json"
TTL = 7 * 86400


def _num(x):
    try:
        x = float(x)
        return None if math.isnan(x) else x
    except (TypeError, ValueError):
        return None


def _growth(cur, base):
    """Tăng trưởng so với cùng kỳ. Từ lỗ sang lãi tính là +100% để không bị loại oan."""
    if cur is None or base is None:
        return None
    if base > 0:
        return cur / base - 1
    if cur > 0:
        return 1.0
    return None


def metrics(q: list, a: list) -> dict:
    """q: [[ngày kết thúc quý, doanh thu, EPS], ...]; a: tương tự theo năm."""
    q = sorted([r for r in q if r[0]], key=lambda r: r[0])
    a = sorted([r for r in a if r[0]], key=lambda r: r[0])
    rev = [_num(r[1]) for r in q]
    eps = [_num(r[2]) for r in q]
    m = {"q_end": q[-1][0] if q else None}
    n = len(q)
    m["rev_yoy"] = _growth(rev[-1], rev[-5]) if n >= 5 else None
    m["eps_yoy"] = _growth(eps[-1], eps[-5]) if n >= 5 else None
    prev_rev = _growth(rev[-2], rev[-6]) if n >= 6 else None
    prev_eps = _growth(eps[-2], eps[-6]) if n >= 6 else None
    # nếu không đủ 6 quý thì xét tăng tốc theo quý liền trước
    if prev_rev is None and n >= 3 and rev[-2] and rev[-3] and rev[-3] > 0 and rev[-2] > 0 and rev[-1]:
        m["rev_accel"] = rev[-1] / rev[-2] > rev[-2] / rev[-3] and rev[-1] > rev[-2]
    else:
        m["rev_accel"] = (m["rev_yoy"] is not None and prev_rev is not None and m["rev_yoy"] > prev_rev)
    m["eps_accel"] = (m["eps_yoy"] is not None and prev_eps is not None and m["eps_yoy"] > prev_eps)
    up = 0
    for i in range(n - 1, 0, -1):
        if rev[i] is not None and rev[i - 1] is not None and rev[i] > rev[i - 1]:
            up += 1
        else:
            break
    m["rev_up"] = up
    m["eps_pos"] = eps[-1] is not None and eps[-1] > 0 if eps else None
    ae = [_num(r[2]) for r in a]
    ups = 0
    for i in range(len(ae) - 1, 0, -1):
        if ae[i] is not None and ae[i - 1] is not None and ae[i] > ae[i - 1]:
            ups += 1
        else:
            break
    m["eps_a_up"] = ups
    for k in ("rev_yoy", "eps_yoy"):
        if m[k] is not None:
            m[k] = round(m[k] * 100, 1)
    return m


# ---------------------------------------------------------------- nguồn Massive
def _massive_all(key: str, cfg: dict) -> dict | None:
    import massive

    cl = massive.Client(key, cfg.get("massive_base", "https://api.massive.com"), int(cfg.get("massive_calls_per_min", 0)))
    since = (datetime.now(timezone.utc) - timedelta(days=4 * 365)).strftime("%Y-%m-%d")
    out: dict[str, dict] = {}
    try:
        for tf in ("quarterly", "annual"):
            rows = cl.paged("/stocks/financials/v1/income-statements",
                            {"timeframe": tf, "period_end.gte": since, "limit": 50000})
            for r in rows:
                for t in r.get("tickers") or []:
                    d = out.setdefault(t, {"q": [], "a": []})
                    d["q" if tf == "quarterly" else "a"].append(
                        [r.get("period_end"), r.get("revenue"), r.get("diluted_earnings_per_share") or r.get("basic_earnings_per_share")])
    except massive.Forbidden:
        print("Gói Massive chưa có số liệu tài chính, dùng Yahoo cho phần cơ bản.")
        return None
    print(f"Massive: số liệu tài chính của {len(out)} mã")
    return out


# ---------------------------------------------------------------- nguồn Yahoo
def _yahoo_one(t: str) -> dict | None:
    import yfinance as yf

    tk = yf.Ticker(t)

    def rows(df):
        if df is None or df.empty:
            return []
        rev = next((r for r in ("Total Revenue", "Operating Revenue") if r in df.index), None)
        eps = next((r for r in ("Diluted EPS", "Basic EPS") if r in df.index), None)
        out = []
        for col in df.columns:
            out.append([str(col)[:10], _num(df.at[rev, col]) if rev else None, _num(df.at[eps, col]) if eps else None])
        return out

    q = rows(tk.quarterly_income_stmt)
    if not q:
        return None
    return {"q": q, "a": rows(tk.income_stmt), "earn": _earn_of(tk)}


def _earn_of(tk) -> str | None:
    """Ngày báo cáo kết quả kinh doanh sắp tới (Minervini, O'Neil tránh mua ngay trước ngày này)."""
    try:
        cal = tk.calendar
        d = cal.get("Earnings Date") if isinstance(cal, dict) else (cal.loc["Earnings Date"].iloc[0] if cal is not None and "Earnings Date" in cal.index else None)
        if isinstance(d, (list, tuple)):
            d = d[0] if d else None
        return str(d)[:10] if d is not None else None
    except Exception:
        return None


def load(tickers: list[str], cfg: dict, key: str | None = None) -> dict[str, dict]:
    cache = {}
    if CACHE_FILE.exists():
        try:
            cache = json.loads(CACHE_FILE.read_text())
        except Exception:
            cache = {}
    now = time.time()
    fresh = lambda t: t in cache and now - cache[t].get("ts", 0) < TTL

    if key and now - cache.get("_massive_checked_ts", 0) > TTL:
        allm = _massive_all(key, cfg)
        cache["_massive_checked_ts"] = now
        if allm:
            for t, d in allm.items():
                cache[t] = {"ts": now, **d}

    need = [t for t in tickers if not fresh(t)][: int(cfg.get("fund_per_run", 400))]
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    need_earn = [t for t in tickers if t not in need and (now - (cache.get(t) or {}).get("earn_ts", 0) > TTL
                                                         or ((cache.get(t) or {}).get("earn") or "9999") < today)][:200]
    if need:
        print(f"Yahoo: tải số liệu cơ bản cho {len(need)} mã")
        fails = 0
        for i, t in enumerate(need):
            try:
                d = _yahoo_one(t)
                cache[t] = {"ts": now, "earn_ts": now, **(d or {"q": [], "a": []})}
            except Exception as e:
                fails += 1
                if fails >= 25 and fails > i * 0.8:
                    print("Yahoo liên tục lỗi, dừng tải số liệu cơ bản:", e, file=sys.stderr)
                    break
            time.sleep(0.25)
    if need_earn:
        import yfinance as yf

        print(f"Yahoo: cập nhật ngày báo cáo cho {len(need_earn)} mã")
        for t in need_earn:
            c = cache.setdefault(t, {"ts": 0, "q": [], "a": []})
            c["earn"], c["earn_ts"] = _earn_of(yf.Ticker(t)), now
            time.sleep(0.2)
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps(cache))
    out = {}
    for t in tickers:
        d = cache.get(t) or {}
        m = {}
        if d.get("q"):
            try:
                m = metrics(d["q"], d.get("a", []))
            except Exception:
                m = {}
        if d.get("earn") and d["earn"] >= today:
            m["earn"] = d["earn"]
        if m:
            out[t] = m
    return out


def demo(tickers: list[str], seed: int = 3) -> dict[str, dict]:
    import random

    rnd = random.Random(seed)
    out = {}
    for t in tickers:
        ry, ey = rnd.gauss(18, 30), rnd.gauss(20, 60)
        out[t] = {"q_end": "2026-09-30", "rev_yoy": round(ry, 1), "eps_yoy": round(ey, 1),
                  "rev_accel": rnd.random() < 0.4, "eps_accel": rnd.random() < 0.4,
                  "rev_up": rnd.choice([0, 1, 2, 3, 4]), "eps_pos": rnd.random() < 0.7, "eps_a_up": rnd.choice([0, 1, 2, 3]),
                  "earn": f"2026-{rnd.choice([10, 11, 12])}:{rnd.randint(1, 28):02d}".replace(":", "-")}
    return out
