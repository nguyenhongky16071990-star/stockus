"""Danh mục mô phỏng: mỗi huyền thoại là một tài khoản ảo 60.000 USD.

Mỗi ngày, mã nào đạt bộ lọc mặc định của huyền thoại thì tài khoản đó đặt lệnh mua theo đúng
cách vào lệnh của người đó, rồi chốt từng phần, dời stop, chốt toàn bộ theo đúng quy tắc của họ.
Trạng thái lưu ở pipeline/state/paper.json (được commit mỗi ngày) nên kết quả cộng dồn theo thời gian.
"""
from __future__ import annotations

import json
import math
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / "pipeline" / "state" / "paper.json"

MARTIN = ["Lấy lại EMA 9", "Lấy lại AVWAP", "EMA hội tụ", "Inside day", "2 inside day"]
TIGHT = ["Nền chặt", "VCP", "Inside day", "2 inside day", "EMA hội tụ"]
NAMES = {"ml": "Martin Luk", "qm": "Qullamaggie", "mm": "Mark Minervini", "wo": "William O'Neil", "sw": "Stan Weinstein",
         "pb": "Pradeep Bonde", "ok": "Oliver Kell", "vs": "VSA"}


def _n(x):
    try:
        x = float(x)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def _any(a, lst):
    return any(x in lst for x in (a or []))


def _ge(s, k, v):
    x = _n(s.get(k))
    return x is not None and x >= v


def _le(s, k, v):
    x = _n(s.get(k))
    return x is not None and x <= v


def _earn_ok(s, asof, days=7):
    e = s.get("earn")
    if not e:
        return True
    try:
        d = (date.fromisoformat(e) - date.fromisoformat(asof)).days
    except ValueError:
        return True
    return d < 0 or d > days


# ---------------------------------------------------------------- tiêu chí mặc định (giống tab Lọc huyền thoại)
def passes(lid: str, s: dict, L: dict) -> bool:
    n_ind = L.get("n_ind") or 1
    if lid == "ml":
        return (_le(s, "rs_pos", 100) and _ge(s, "adr", 4) and bool(s.get("e21up")) and _n(s.get("d9")) is not None
                and abs(s["d9"]) <= 5 and _any(s.get("setups"), MARTIN) and L.get("qqq_regime") != "Xấu")
    if lid == "qm":
        return ((_ge(s, "r21", 30) or _ge(s, "r63", 30)) and _ge(s, "adr", 4) and _ge(s, "dv", 20) and _ge(s, "d21", 0.0001)
                and (_any(s.get("setups"), ["Nền chặt", "Inside day", "2 inside day", "EMA hội tụ", "EP"]) or _any(s.get("sig"), ["Gap tăng mạnh (EP)"])))
    if lid == "mm":
        return (bool(s.get("tt")) and _ge(s, "rs", 80) and _ge(s, "dd", -25) and _any(s.get("setups"), TIGHT)
                and _ge(s, "eps_yoy", 25) and _earn_ok(s, L["asof"]))
    if lid == "wo":
        return (_ge(s, "eps_yoy", 25) and _ge(s, "eps_a_up", 2) and _ge(s, "rev_yoy", 20) and _ge(s, "dd", -15) and _ge(s, "udv", 1.1)
                and _ge(s, "rs", 80) and _le(s, "ind_rank", max(1, round(n_ind * 0.2)))
                and "đáy mới" not in (L.get("ftd_status") or "") and (L.get("dd_qqq") or 0) <= 5)
    if lid == "sw":
        return s.get("stage") == 2 and _ge(s, "rs", 70) and _le(s, "ind_rank", n_ind / 2) and _ge(s, "udv", 1)
    if lid == "pb":
        return (_any(s.get("sig"), ["Bứt phá 4%", "Gap tăng mạnh (EP)"]) and _n(s.get("r21")) is not None
                and s["r21"] - (s.get("chg") or 0) <= 25 and _ge(s, "vr", 1.5) and _ge(s, "dv", 5))
    if lid == "ok":
        return (_le(s, "rs_pos", 200) and bool(s.get("e21up")) and _le(s, "d9", 8)
                and (_any(s.get("setups"), ["EMA crossback", "Lấy lại EMA 9"]) or _any(s.get("sig"), ["Về EMA 21 bật lên", "Lấy lại EMA 9"])))
    if lid == "vs":
        return bool(s.get("vsa")) and _ge(s, "d50", 0.0001) and _ge(s, "rs", 50) and _ge(s, "dv", 5)
    return False


# ---------------------------------------------------------------- cách vào / ra lệnh của từng người
def plan(lid: str, s: dict, cfg: dict):
    h, l, c = _n(s.get("h")), _n(s.get("l")), _n(s.get("close"))
    piv, lo10, s150, e21, adr = _n(s.get("piv")), _n(s.get("lo10")), _n(s.get("s150v")), _n(s.get("e21v")), _n(s.get("adr")) or 5
    if None in (h, l, c):
        return None
    P = {
        "ml": dict(kind="stop", lvl=h * 1.001, stop=l * 0.999, pending=1, max_stop=cfg.get("max_stop_pct", 6),
                   partials=[["R", 3, 0.15]], trail="e9", max_hold=60),
        "qm": dict(kind="stop", lvl=h * 1.001, stop=max(l * 0.999, h * 1.001 * (1 - adr / 100)), pending=1, max_stop=12,
                   partials=[["day", 4, 0.5]], trail="e9", trail_after=4, max_hold=60),
        "mm": dict(kind="stop", lvl=(piv or h) * 1.001, stop=max((piv or h) * 1.001 * 0.92, (lo10 or l) * 0.999), pending=5,
                   max_stop=8.5, partials=[["pct", 20, 0.5]], be=True, trail="e21", trail_after=5, max_hold=60),
        "wo": dict(kind="stop", lvl=(piv or h) * 1.001, stop=(piv or h) * 1.001 * 0.93, pending=5, max_stop=7.5, chase=1.05,
                   partials=[["pct", 20, 1.0]], max_hold=40),
        "sw": dict(kind="stop", lvl=(piv or h) * 1.001, stop=max((s150 * 0.99 if s150 and s150 < (piv or h) else (lo10 or l) * 0.999), (piv or h) * 1.001 * 0.85),
                   pending=5, max_stop=15.5, trail="s150", max_hold=120),
        "pb": dict(kind="close", lvl=c, stop=l * 0.999, max_stop=12, partials=[["pct", 15, 1.0]], max_hold=4),
        "ok": dict(kind="stop", lvl=h * 1.001, stop=min(l, e21 or l) * 0.995, pending=2, max_stop=12,
                   partials=[["ext9", 15, 0.5]], trail="e21", trail_after=2, max_hold=60),
        "vs": dict(kind="stop", lvl=h * 1.001, stop=l * 0.995, pending=3, max_stop=12,
                   partials=[["R", 2, 0.5]], be=True, trail="e21", trail_after=3, max_hold=40),
    }[lid]
    if not (P["stop"] < P["lvl"]) or (P["lvl"] - P["stop"]) / P["lvl"] * 100 > P["max_stop"]:
        return None
    return P


# ---------------------------------------------------------------- trạng thái
def new_state(cfg, start):
    cap = float(cfg.get("capital", 60000))
    return {"version": 1, "start": start, "last": None, "capital": cap,
            "accounts": {k: {"cash": cap, "open": [], "pending": [], "closed": [], "equity": []} for k in NAMES}}


def load_state(cfg):
    if STATE.exists():
        try:
            st = json.loads(STATE.read_text(encoding="utf-8"))
            for k in NAMES:
                st["accounts"].setdefault(k, {"cash": st["capital"], "open": [], "pending": [], "closed": [], "equity": []})
            return st
        except Exception:
            pass
    return None


def save_state(st):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(st, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


class Bars:
    """Giá và đường trung bình của một mã theo ngày, tính từ dữ liệu thô."""
    def __init__(self, raw):
        self.raw, self.cache = raw, {}

    def get(self, t):
        if t not in self.cache:
            df = self.raw.get(t)
            if df is None:
                self.cache[t] = None
            else:
                c = df["Close"]
                self.cache[t] = df.assign(e9=c.ewm(span=9, adjust=False).mean(), e21=c.ewm(span=21, adjust=False).mean(),
                                          s150=c.rolling(150, min_periods=100).mean())
        return self.cache[t]

    def bar(self, t, d):
        df = self.get(t)
        if df is None:
            return None
        ts = pd.Timestamp(d)
        if ts not in df.index:
            return None
        r = df.loc[ts]
        return {k: _n(r[k]) for k in ("Open", "High", "Low", "Close", "e9", "e21", "s150")}


def _sell(acct, pos, px, frac, d, why):
    sh = pos["shares"] if frac >= 0.999 else min(pos["shares"], max(1, int(round(pos["shares0"] * frac))))
    if sh <= 0:
        return
    pos["shares"] -= sh
    acct["cash"] += sh * px
    pos["fills"].append({"d": d, "px": round(px, 2), "sh": sh, "why": why})


def _close(acct, pos, d, why):
    sold = sum(f["sh"] for f in pos["fills"])
    proceeds = sum(f["sh"] * f["px"] for f in pos["fills"])
    cost = pos["shares0"] * pos["entry"]
    pnl = proceeds - cost
    risk = pos["shares0"] * (pos["entry"] - pos["stop0"])
    acct["closed"].append({"t": pos["t"], "sig": pos["sig"], "in": pos["in"], "out": d, "entry": pos["entry"], "stop0": pos["stop0"],
                           "shares": pos["shares0"], "exit": round(proceeds / sold, 2) if sold else None, "pnl": round(pnl, 2),
                           "pct": round(pnl / cost * 100, 2), "r": round(pnl / risk, 2) if risk > 0 else None,
                           "days": pos["held"], "fills": pos["fills"], "why": why, "boot": pos.get("boot", False)})


def _step_position(acct, pos, b, d, P):
    """Áp quy tắc ra lệnh lên một phiên. Trả về True nếu lệnh đã đóng hết."""
    pos["held"] += 1
    o, h, l, c = b["Open"], b["High"], b["Low"], b["Close"]
    if c is None:
        return False
    o = o if o is not None else c
    entry, risk = pos["entry"], pos["entry"] - pos["stop0"]
    st = pos["stop"]
    if l is not None and l <= st:
        _sell(acct, pos, min(o, st), 1, d, "Hòa vốn" if pos.get("be_on") else "Chạm stop")
        _close(acct, pos, d, "Hòa vốn" if pos.get("be_on") else "Chạm stop")
        return True
    for i, (kind, val, frac) in enumerate(P.get("partials", [])):
        if i in pos["done"] or pos["shares"] <= 0:
            continue
        px = None
        if kind == "R" and h is not None and h >= entry + val * risk:
            px = max(o, entry + val * risk)
        elif kind == "pct" and h is not None and h >= entry * (1 + val / 100):
            px = max(o, entry * (1 + val / 100))
        elif kind == "day" and pos["held"] >= val:
            px = c
        elif kind == "ext9" and b["e9"] and c >= b["e9"] * (1 + val / 100):
            px = c
        if px is not None:
            label = {"R": f"Chốt {int(frac * 100)}% tại +{val}R", "pct": f"Chốt {int(frac * 100)}% tại +{val}%",
                     "day": f"Chốt {int(frac * 100)}% sau {val} phiên", "ext9": f"Chốt {int(frac * 100)}% khi cách EMA 9 {val}%"}[kind]
            _sell(acct, pos, px, frac, d, label)
            pos["done"].append(i)
            if P.get("be"):
                pos["stop"], pos["be_on"] = max(pos["stop"], entry), True
            if pos["shares"] <= 0:
                _close(acct, pos, d, "Chốt lời")
                return True
    tr = P.get("trail")
    if tr and b.get(tr) and c < b[tr] and pos["held"] > P.get("trail_after", 0):
        why = {"e9": "Đóng cửa dưới EMA 9", "e21": "Đóng cửa dưới EMA 21", "s150": "Đóng cửa dưới đường 30 tuần"}[tr]
        _sell(acct, pos, c, 1, d, why)
        _close(acct, pos, d, why)
        return True
    if pos["held"] >= P["max_hold"]:
        _sell(acct, pos, c, 1, d, "Hết thời gian giữ")
        _close(acct, pos, d, "Hết thời gian giữ")
        return True
    return False


def _open(acct, cfg, t, sig_d, d, entry, stop, P, boot):
    cap = acct.get("cap0", cfg.get("capital", 60000))
    risk_usd = cap * cfg.get("risk_pct", 0.5) / 100
    sh = int(risk_usd / (entry - stop))
    sh = min(sh, int(cap * cfg.get("max_pos_pct", 35) / 100 / entry), int(acct["cash"] / entry))
    if sh < 1:
        return None
    acct["cash"] -= sh * entry
    pos = {"t": t, "sig": sig_d, "in": d, "entry": round(entry, 2), "stop0": round(stop, 2), "stop": round(stop, 2), "shares0": sh,
           "shares": sh, "held": 0, "done": [], "fills": [], "plan": P, "boot": boot}
    acct["open"].append(pos)
    return pos


def step_day(st, d, bars: Bars, cfg):
    """Xử lý một phiên d: lệnh đang giữ trước, rồi lệnh chờ khớp trong phiên d."""
    for lid, acct in st["accounts"].items():
        still = []
        for pos in acct["open"]:
            b = bars.bar(pos["t"], d)
            if b is None or not _step_position(acct, pos, b, d, pos["plan"]):
                still.append(pos)
        acct["open"] = still
        keep = []
        for od in acct["pending"]:
            b = bars.bar(od["t"], d)
            if b is None or b["High"] is None:
                keep.append(od)
                continue
            od["left"] -= 1
            P = od["plan"]
            if b["High"] >= od["lvl"]:
                o = b["Open"] if b["Open"] is not None else od["lvl"]
                fill = max(o, od["lvl"])
                if P.get("chase") and fill > od["lvl"] * P["chase"]:
                    continue  # O'Neil: không mua cao hơn pivot 5%
                pos = _open(acct, cfg, od["t"], od["sig"], d, fill, od["stop"], P, od.get("boot", False))
                if pos and b["Low"] is not None and b["Low"] <= pos["stop"]:
                    pos["held"] = 1
                    _sell(acct, pos, pos["stop"], 1, d, "Chạm stop")
                    _close(acct, pos, d, "Chạm stop")
                    acct["open"].remove(pos)
                continue
            if b["Low"] is not None and b["Low"] <= od["stop"]:
                continue  # giá thủng stop trước khi khớp: hủy
            if od["left"] > 0:
                keep.append(od)
        acct["pending"] = keep


def mark(st, d, bars: Bars):
    for acct in st["accounts"].values():
        mv = 0.0
        for pos in acct["open"]:
            b = bars.bar(pos["t"], d)
            px = b["Close"] if b and b["Close"] else pos["entry"]
            pos["last"] = round(px, 2)
            mv += pos["shares"] * px
        eq = round(acct["cash"] + mv, 2)
        if acct["equity"] and acct["equity"][-1][0] == d:
            acct["equity"][-1][1] = eq
        else:
            acct["equity"].append([d, eq])


def new_signals(st, d, stocks, latest, cfg, boot=False, max_new=5):
    L = dict(latest)
    L["asof"] = d
    for lid, acct in st["accounts"].items():
        held = {p["t"] for p in acct["open"]} | {o["t"] for o in acct["pending"]}
        cands = sorted([s for s in stocks if s["t"] not in held and passes(lid, s, L)], key=lambda s: s.get("rs_pos") or 1e9)
        n = 0
        for s in cands:
            if n >= max_new:
                break
            P = plan(lid, s, cfg)
            if not P:
                continue
            if P["kind"] == "close":
                if _open(acct, cfg, s["t"], d, d, P["lvl"], P["stop"], P, boot):
                    n += 1
            else:
                acct["pending"].append({"t": s["t"], "sig": d, "lvl": round(P["lvl"], 2), "stop": round(P["stop"], 2),
                                        "left": P["pending"], "plan": P, "boot": boot})
                n += 1


def run(st, raw, out, cfg, boot=False):
    """Đưa trạng thái từ ngày đã xử lý gần nhất tới hôm nay rồi tạo tín hiệu mới của hôm nay."""
    bars = Bars(raw)
    days = [x.strftime("%Y-%m-%d") for x in raw["QQQ"].index]
    today = out["latest"]["asof"]
    todo = [x for x in days if x <= today and (x > st["last"] if st["last"] else x >= st["start"])]
    for d in todo:
        step_day(st, d, bars, cfg)
        mark(st, d, bars)
    if st["last"] != today:
        new_signals(st, today, out["stocks"], out["latest"], cfg, boot=boot)
        mark(st, today, bars)
    st["last"] = today
    return st


# ---------------------------------------------------------------- tổng hợp cho trang web
def summary(st, raw):
    q = raw["QQQ"]["Close"]
    start = st["start"]
    q0 = q[q.index >= pd.Timestamp(start)]
    qcurve = [[i.strftime("%Y-%m-%d"), round((v / q0.iloc[0] - 1) * 100, 2)] for i, v in q0.items()] if len(q0) else []
    out = {"start": start, "last": st["last"], "capital": st["capital"], "qqq": qcurve, "accounts": {}}
    for lid, a in st["accounts"].items():
        cl = a["closed"]
        r = [c["r"] for c in cl if c["r"] is not None]
        wins = [c for c in cl if c["pnl"] > 0]
        losses = [c for c in cl if c["pnl"] <= 0]
        eq = a["equity"]
        peak, mdd = -1e18, 0.0
        for _, v in eq:
            peak = max(peak, v)
            mdd = min(mdd, (v / peak - 1) * 100 if peak > 0 else 0)
        last_eq = eq[-1][1] if eq else st["capital"]
        out["accounts"][lid] = {
            "name": NAMES[lid], "equity": round(last_eq, 2), "ret": round((last_eq / st["capital"] - 1) * 100, 2),
            "cash": round(a["cash"], 2), "n": len(cl), "win": round(len(wins) / len(cl) * 100, 1) if cl else None,
            "avg_win": round(np.mean([c["pct"] for c in wins]), 2) if wins else None,
            "avg_loss": round(np.mean([c["pct"] for c in losses]), 2) if losses else None,
            "exp": round(float(np.mean(r)), 2) if r else None,
            "pf": round(sum(c["pnl"] for c in wins) / -sum(c["pnl"] for c in losses), 2) if losses and sum(c["pnl"] for c in losses) < 0 else None,
            "realized": round(sum(c["pnl"] for c in cl), 2), "mdd": round(mdd, 2),
            "curve": [[dd, round((v / st["capital"] - 1) * 100, 2)] for dd, v in eq],
            "open": [{"t": p["t"], "in": p["in"], "entry": p["entry"], "stop": p["stop"], "stop0": p["stop0"], "shares": p["shares"],
                      "shares0": p["shares0"], "last": p.get("last"), "held": p["held"],
                      "pct": round((p.get("last", p["entry"]) / p["entry"] - 1) * 100, 2),
                      "r": round((p.get("last", p["entry"]) - p["entry"]) / (p["entry"] - p["stop0"]), 2) if p["entry"] > p["stop0"] else None,
                      "fills": p["fills"], "boot": p.get("boot", False)} for p in a["open"]],
            "pending": [{"t": o["t"], "sig": o["sig"], "lvl": o["lvl"], "stop": o["stop"], "left": o["left"]} for o in a["pending"]],
            "closed": sorted(cl, key=lambda c: c["out"], reverse=True)[:60],
        }
    return out
