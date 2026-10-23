"""Danh mục mô phỏng: mỗi huyền thoại là một tài khoản ảo 60.000 USD.

Mỗi ngày, mã nào đạt bộ lọc của huyền thoại thì tài khoản đó đặt lệnh theo đúng quy tắc công bố của người đó:
điều kiện thị trường, điểm mua, stop ban đầu, cỡ vị thế, chốt từng phần, dời stop, thoát lệnh toàn bộ.
Trạng thái lưu ở pipeline/state/paper.json (được commit mỗi ngày) nên kết quả cộng dồn theo thời gian.

Giả định khi khớp lệnh (dữ liệu ngày, không có dữ liệu trong phiên):
- Lệnh chờ mua khớp ở mức kích hoạt, hoặc giá mở cửa nếu mở cửa vượt qua mức đó; cộng trượt giá.
- Nếu trong cùng phiên giá vừa chạm điểm mua vừa chạm stop thì tính là bị stop (giả định xấu nhất).
- Stop khớp ở mức stop, hoặc giá mở cửa nếu mở cửa dưới stop; trừ trượt giá.
- Chốt lời theo mục tiêu là lệnh giới hạn (không trượt giá). Thoát theo giá đóng cửa có trượt giá.
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
VERSION = 2

MARTIN = ["Lấy lại EMA 9", "Lấy lại AVWAP", "EMA hội tụ", "Inside day", "2 inside day"]
TIGHT = ["Nền chặt", "VCP", "Inside day", "2 inside day", "EMA hội tụ"]
NAMES = {"ml": "Martin Luk", "qm": "Qullamaggie", "mm": "Mark Minervini", "wo": "William O'Neil", "sw": "Stan Weinstein",
         "pb": "Pradeep Bonde", "ok": "Oliver Kell", "vs": "VSA"}

# ---------------------------------------------------------------- quy tắc của từng người (hiển thị trên web)
RULES = {
    "ml": {
        "risk": 0.5, "pos": 25, "max_open": 8,
        "text": [
            "Thị trường: chỉ mua khi QQQ đóng cửa trên EMA 21 và xu hướng QQQ không Xấu.",
            "Chọn mã: top 100 sức mạnh giá, biên độ ngày ≥ 4%, trên EMA 21 đang dốc lên, cách EMA 9 tối đa 5%, có setup lấy lại EMA 9 / AVWAP, EMA hội tụ hoặc inside day.",
            "Mua: khi giá vượt đỉnh phiên tín hiệu (lệnh chờ 1 phiên), bỏ nếu mở cửa gap cao hơn 3%.",
            "Stop: dưới đáy phiên tín hiệu, tối đa 6%. Cuối phiên mua, dời stop lên đáy của chính phiên mua.",
            "Vị thế: rủi ro 0,5% tài khoản, tối đa 25% tài khoản, tối đa 8 mã.",
            "Chốt từng phần: bán 25% tại +2R và dời stop về hòa vốn, bán thêm 25% tại +4R.",
            "Chốt hết: trước lần chốt đầu, đóng cửa dưới EMA 21; sau lần chốt đầu, đóng cửa dưới EMA 9. Tối đa 60 phiên.",
        ]},
    "qm": {
        "risk": 0.5, "pos": 25, "max_open": 10,
        "text": [
            "Thị trường: chỉ mua khi QQQ trên SMA 20 và SMA 10 nằm trên SMA 20 (Nasdaq đang khỏe).",
            "Chọn mã: tăng ≥ 30% trong 1 hoặc 3 tháng, biên độ ngày ≥ 4%, thanh khoản ≥ 20 triệu USD/ngày, nền chặt / inside day / EMA hội tụ hoặc gap tăng mạnh (EP).",
            "Mua: khi giá vượt đỉnh phiên trước (thay cho vượt đỉnh khung mở cửa), lệnh chờ 1 phiên, bỏ nếu gap cao hơn 5%.",
            "Stop: đáy phiên trước nhưng không rộng hơn 1 biên độ ngày (ADR). Cuối phiên mua, dời stop lên đáy của phiên mua.",
            "Vị thế: rủi ro 0,5% tài khoản, tối đa 25% tài khoản, tối đa 10 mã.",
            "Chốt từng phần: sau 3 phiên, nếu đang lãi thì bán 1/2 và dời stop về hòa vốn.",
            "Chốt hết: phần còn lại giữ tới khi đóng cửa dưới SMA 10 (mã biên độ ≥ 6%) hoặc SMA 20 (mã chậm hơn).",
        ]},
    "mm": {
        "risk": 1.25, "pos": 25, "max_open": 8,
        "text": [
            "Thị trường: chỉ mua khi QQQ đóng cửa trên SMA 50.",
            "Chọn mã: đạt đủ Trend Template, RS ≥ 80, cách đỉnh 52 tuần ≤ 25%, có nền thắt chặt / VCP, EPS quý tăng ≥ 25%, không có báo cáo lợi nhuận trong 7 ngày tới.",
            "Mua: khi giá vượt pivot (lệnh chờ 5 phiên), không mua nếu đã cao hơn pivot 5%.",
            "Khối lượng: nếu phiên bứt phá có khối lượng < 1,4 lần trung bình 50 phiên mà đóng cửa dưới giá mua, bán ngay cuối phiên.",
            "Stop: dưới đáy 10 phiên, tối đa 8% (Minervini không bao giờ để quá 10%).",
            "Vị thế: rủi ro 1,25% tài khoản, tối đa 25% tài khoản, tối đa 8 mã.",
            "Dời stop về hòa vốn khi lãi đạt +2R. Chốt từng phần: bán 1/3 tại +3R, bán thêm 1/3 tại +5R.",
            "Chốt hết: trước lần chốt đầu, đóng cửa dưới SMA 50; sau đó, đóng cửa dưới SMA 20.",
        ]},
    "wo": {
        "risk": None, "pos": 20, "max_open": 6,
        "text": [
            "Thị trường: chỉ mua khi đã có ngày xác nhận xu hướng (FTD), QQQ không tạo đáy mới và có tối đa 5 ngày phân phối.",
            "Chọn mã (CAN SLIM): EPS quý ≥ 25%, EPS năm tăng ≥ 2 năm, doanh thu ≥ 20%, cách đỉnh ≤ 15%, khối lượng lên/xuống ≥ 1,1, RS ≥ 80, nhóm ngành top 20%.",
            "Mua: khi giá vượt pivot (lệnh chờ 5 phiên), không mua cao hơn pivot 5%.",
            "Khối lượng: phiên bứt phá phải có khối lượng ≥ 1,4 lần trung bình 50 phiên, nếu không và đóng cửa dưới giá mua thì bán cuối phiên.",
            "Stop: cắt lỗ cứng 7,5% dưới giá mua (quy tắc 7–8%).",
            "Vị thế: mỗi mã 20% tài khoản (danh mục tập trung 5–6 mã).",
            "Chốt hết: bán toàn bộ khi lãi +20%. Ngoại lệ: tăng +20% trong 3 tuần đầu thì giữ đủ 8 tuần (stop dời về hòa vốn), sau đó thoát khi đóng cửa dưới SMA 50.",
            "Bán khi đóng cửa dưới SMA 50 với khối lượng ≥ 1,5 lần trung bình.",
        ]},
    "sw": {
        "risk": 1.0, "pos": 15, "max_open": 10,
        "text": [
            "Thị trường: chỉ mua khi QQQ ở giai đoạn 2, tức trên đường 30 tuần (SMA 150) và đường này đang đi lên.",
            "Chọn mã: giai đoạn 2, RS ≥ 70, nhóm ngành nửa trên, khối lượng lên/xuống ≥ 1.",
            "Mua: khi giá vượt kháng cự / pivot (lệnh chờ 5 phiên), không mua cao hơn 5%.",
            "Khối lượng: phiên bứt phá cần ≥ 1,5 lần trung bình, nếu không và đóng cửa dưới giá mua thì bán.",
            "Stop: dưới đường 30 tuần hoặc đáy gần nhất, tối đa 15%.",
            "Vị thế: rủi ro 1% tài khoản, tối đa 15% tài khoản, tối đa 10 mã.",
            "Dời stop hằng tuần (phiên cuối tuần): lên dưới đáy thấp nhất 4 tuần gần nhất.",
            "Chốt hết: tuần đóng cửa dưới đường 30 tuần. Không chốt từng phần, để lãi chạy.",
        ]},
    "pb": {
        "risk": 0.5, "pos": 20, "max_open": 10,
        "text": [
            "Thị trường: chỉ mua khi QQQ trên SMA 20.",
            "Chọn mã (momentum burst): phiên tăng ≥ 4% hoặc gap tăng mạnh, khối lượng ≥ 1,5 lần trung bình, trước đó chưa tăng quá 25% trong 1 tháng, thanh khoản ≥ 5 triệu USD/ngày.",
            "Mua: ngay cuối phiên bứt phá.",
            "Stop: đáy phiên bứt phá, tối đa 10%.",
            "Vị thế: rủi ro 0,5% tài khoản, tối đa 20% tài khoản, tối đa 10 mã.",
            "Chốt từng phần: bán 1/2 tại +8% và dời stop về hòa vốn.",
            "Chốt hết: sau 3 phiên mà vẫn không lãi thì bán; tối đa giữ 5 phiên (nhịp bùng nổ chỉ kéo dài 3–5 ngày).",
        ]},
    "ok": {
        "risk": 0.75, "pos": 30, "max_open": 6,
        "text": [
            "Thị trường: chỉ mua khi QQQ đóng cửa trên EMA 21.",
            "Chọn mã: top 200 sức mạnh giá, trên EMA 21 dốc lên, setup EMA crossback / lấy lại EMA 9 / về EMA 21 bật lên (wedge pop).",
            "Mua: khi giá vượt đỉnh phiên tín hiệu (lệnh chờ 2 phiên), bỏ nếu gap cao hơn 4%.",
            "Stop: dưới đáy phiên tín hiệu hoặc dưới EMA 21 (lấy mức thấp hơn), tối đa 10%.",
            "Vị thế: rủi ro 0,75% tài khoản, tối đa 30% tài khoản, tối đa 6 mã.",
            "Chốt từng phần: khi giá kéo xa EMA 10 từ 15% trở lên (exhaustion extension), bán 1/2 và dời stop về hòa vốn.",
            "Chốt hết: trước lần chốt đầu, đóng cửa dưới EMA 21; sau đó, đóng cửa dưới EMA 10. Tối đa 90 phiên.",
        ]},
    "vs": {
        "risk": 0.5, "pos": 25, "max_open": 8,
        "text": [
            "Thị trường: chỉ mua khi QQQ trên SMA 50 (nền thị trường mạnh).",
            "Chọn mã: có tín hiệu sức mạnh VSA (no supply, test, stopping volume, shakeout) khi đang trên SMA 50, RS ≥ 50.",
            "Mua: khi giá vượt đỉnh nến tín hiệu (lệnh chờ 3 phiên).",
            "Stop: dưới đáy nến tín hiệu, tối đa 10%. Dời stop về hòa vốn khi lãi đạt +2R.",
            "Vị thế: rủi ro 0,5% tài khoản, tối đa 25% tài khoản, tối đa 8 mã.",
            "Chốt 1/2: khi xuất hiện No demand (nến tăng biên độ hẹp, khối lượng thấp hơn 2 phiên trước) gần đỉnh 20 phiên.",
            "Chốt hết: khi xuất hiện Upthrust (đỉnh mới 20 phiên nhưng đóng cửa ở 1/3 dưới, khối lượng cao) hoặc Buying climax (nến rất rộng, khối lượng ≥ 2 lần, đóng cửa nửa dưới). Tối đa 60 phiên.",
        ]},
}
COMMON = [
    "Mỗi tài khoản 60.000 USD ảo, cỡ vị thế tính theo giá trị tài khoản hiện tại. Tối đa 5 lệnh mới mỗi ngày, chỉ mua khi đủ tiền mặt.",
    "Trượt giá 0,1% cho lệnh mua, lệnh stop và lệnh thoát theo giá đóng cửa. Không tính phí hoa hồng.",
    "Dữ liệu ngày: nếu cùng một phiên vừa chạm điểm mua vừa chạm stop thì tính là bị stop.",
]


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


# ---------------------------------------------------------------- điều kiện thị trường của từng người
def market_ok(lid: str, Q: dict | None, L: dict) -> bool:
    if not Q or Q.get("Close") is None:
        return True
    c = Q["Close"]
    gt = lambda k: Q.get(k) is not None and c > Q[k]
    if lid == "ml":
        return gt("e21") and L.get("qqq_regime") != "Xấu"
    if lid == "qm":
        return gt("s20") and Q.get("s10") is not None and Q.get("s20") is not None and Q["s10"] > Q["s20"]
    if lid == "mm":
        return gt("s50")
    if lid == "wo":
        return "đáy mới" not in (L.get("ftd_status") or "") and (L.get("dd_qqq") or 0) <= 5
    if lid == "sw":
        return gt("s150") and Q.get("s150_p") is not None and Q["s150"] > Q["s150_p"]
    if lid == "pb":
        return gt("s20")
    if lid == "ok":
        return gt("e21")
    if lid == "vs":
        return gt("s50")
    return True


# ---------------------------------------------------------------- tiêu chí chọn mã (giống tab Lọc huyền thoại)
def passes(lid: str, s: dict, L: dict) -> bool:
    n_ind = L.get("n_ind") or 1
    if lid == "ml":
        return (_le(s, "rs_pos", 100) and _ge(s, "adr", 4) and bool(s.get("e21up")) and _n(s.get("d9")) is not None
                and abs(s["d9"]) <= 5 and _any(s.get("setups"), MARTIN))
    if lid == "qm":
        return ((_ge(s, "r21", 30) or _ge(s, "r63", 30)) and _ge(s, "adr", 4) and _ge(s, "dv", 20) and _ge(s, "d21", 0.0001)
                and (_any(s.get("setups"), ["Nền chặt", "Inside day", "2 inside day", "EMA hội tụ", "EP"]) or _any(s.get("sig"), ["Gap tăng mạnh (EP)"])))
    if lid == "mm":
        return (bool(s.get("tt")) and _ge(s, "rs", 80) and _ge(s, "dd", -25) and _any(s.get("setups"), TIGHT)
                and _ge(s, "eps_yoy", 25) and _earn_ok(s, L["asof"]))
    if lid == "wo":
        return (_ge(s, "eps_yoy", 25) and _ge(s, "eps_a_up", 2) and _ge(s, "rev_yoy", 20) and _ge(s, "dd", -15) and _ge(s, "udv", 1.1)
                and _ge(s, "rs", 80) and _le(s, "ind_rank", max(1, round(n_ind * 0.2))) and _earn_ok(s, L["asof"], 3))
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


# ---------------------------------------------------------------- kế hoạch lệnh của từng người
def plan(lid: str, s: dict, cfg: dict):
    h, l, c = _n(s.get("h")), _n(s.get("l")), _n(s.get("close"))
    piv, lo10, s150, e21, adr = _n(s.get("piv")), _n(s.get("lo10")), _n(s.get("s150v")), _n(s.get("e21v")), _n(s.get("adr")) or 5
    if None in (h, l, c):
        return None
    pv = (piv or h) * 1.001
    if lid == "ml":
        P = dict(kind="stop", lvl=h * 1.001, stop=l * 0.999, pending=1, chase=1.03, max_stop=float(cfg.get("max_stop_pct", 6)), lod=True,
                 partials=[["R", 2, 0.25, True], ["R", 4, 0.25, False]],
                 trail=[["e21", "pre"], ["e9", "post"]], max_hold=60)
    elif lid == "qm":
        lvl = h * 1.001
        P = dict(kind="stop", lvl=lvl, stop=max(l * 0.999, lvl * (1 - adr / 100)), pending=1, chase=1.05, max_stop=12, lod=True,
                 partials=[["day_profit", 3, 0.5, True]],
                 trail=[["s10" if adr >= 6 else "s20", "post"]], max_hold=150)
    elif lid == "mm":
        P = dict(kind="stop", lvl=pv, stop=max(pv * 0.92, (lo10 or l) * 0.999), pending=5, chase=1.05, max_stop=8.5, vol=1.4,
                 be_r=2, partials=[["R", 3, 1 / 3, True], ["R", 5, 1 / 3, True]],
                 trail=[["s50", "pre"], ["s20", "post"]], trail_after=3, max_hold=150)
    elif lid == "wo":
        P = dict(kind="stop", lvl=pv, stop=pv * 0.925, stop_pct=7.5, pending=5, chase=1.05, max_stop=8.5, vol=1.4,
                 oneil=True, max_hold=150)
    elif lid == "sw":
        base = s150 * 0.99 if s150 and s150 < pv else (lo10 or l) * 0.999
        P = dict(kind="stop", lvl=pv, stop=max(base, pv * 0.85), pending=5, chase=1.05, max_stop=15.5, vol=1.5,
                 weekly=True, max_hold=260)
    elif lid == "pb":
        P = dict(kind="close", lvl=c, stop=l * 0.999, max_stop=10, partials=[["pct", 8, 0.5, True]],
                 nofollow=3, max_hold=5)
    elif lid == "ok":
        P = dict(kind="stop", lvl=h * 1.001, stop=min(l, e21 or l) * 0.995, pending=2, chase=1.04, max_stop=10,
                 partials=[["ext", "e10", 15, 0.5, True]], trail=[["e21", "pre"], ["e10", "post"]], trail_after=1, max_hold=90)
    elif lid == "vs":
        P = dict(kind="stop", lvl=h * 1.001, stop=l * 0.995, pending=3, max_stop=10, be_r=2, vsa=True, max_hold=60)
    else:
        return None
    if not (P["stop"] < P["lvl"]) or (P["lvl"] - P["stop"]) / P["lvl"] * 100 > P["max_stop"]:
        return None
    return P


# ---------------------------------------------------------------- trạng thái
def _acct(cap):
    return {"cash": cap, "open": [], "pending": [], "closed": [], "equity": []}


def new_state(cfg, start):
    cap = float(cfg.get("capital", 60000))
    return {"version": VERSION, "start": start, "last": None, "capital": cap, "accounts": {k: _acct(cap) for k in NAMES}}


def load_state(cfg):
    """Trả về None nếu chưa có hoặc trạng thái thuộc bộ quy tắc cũ (khi đó chạy lại từ đầu)."""
    if STATE.exists():
        try:
            st = json.loads(STATE.read_text(encoding="utf-8"))
            if st.get("version") != VERSION:
                print("Danh mục mô phỏng: quy tắc đã đổi, khởi tạo lại")
                return None
            for k in NAMES:
                st["accounts"].setdefault(k, _acct(st["capital"]))
            return st
        except Exception:
            pass
    return None


def save_state(st):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(strip(st), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


class Bars:
    """Giá, đường trung bình và khối lượng của một mã theo ngày (chỉ dùng dữ liệu tới ngày đó)."""
    KEYS = ("Open", "High", "Low", "Close", "Volume", "pc", "e9", "e10", "e21", "s10", "s20", "s50", "s150", "s150_p",
            "v50", "v20", "pv1", "pv2", "rng20", "hi20", "lo20", "wk_end")

    def __init__(self, raw):
        self.raw, self.cache = raw, {}

    def get(self, t):
        if t not in self.cache:
            df = self.raw.get(t)
            if df is None or not len(df):
                self.cache[t] = None
            else:
                c, v, h, l = df["Close"], df["Volume"] if "Volume" in df else pd.Series(np.nan, index=df.index), df["High"], df["Low"]
                s150 = c.rolling(150, min_periods=100).mean()
                wk = pd.Series(df.index.to_period("W"), index=df.index)
                self.cache[t] = df.assign(
                    pc=c.shift(1), e9=c.ewm(span=9, adjust=False).mean(), e10=c.ewm(span=10, adjust=False).mean(),
                    e21=c.ewm(span=21, adjust=False).mean(), s10=c.rolling(10).mean(), s20=c.rolling(20).mean(),
                    s50=c.rolling(50, min_periods=40).mean(), s150=s150, s150_p=s150.shift(20),
                    v50=v.rolling(50, min_periods=20).mean().shift(1), v20=v.rolling(20, min_periods=10).mean().shift(1),
                    pv1=v.shift(1), pv2=v.shift(2), rng20=(h - l).rolling(20).mean().shift(1),
                    hi20=h.rolling(20).max().shift(1), lo20=l.rolling(20).min(),
                    wk_end=(wk != wk.shift(-1)).astype(float))
        return self.cache[t]

    def bar(self, t, d):
        df = self.get(t)
        if df is None:
            return None
        ts = pd.Timestamp(d)
        if ts not in df.index:
            return None
        r = df.loc[ts]
        return {k: _n(r[k]) for k in self.KEYS if k in r}


def _slip(cfg):
    return float(cfg.get("paper_slip_pct", 0.1)) / 100


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


def _exit_all(acct, pos, px, d, why):
    _sell(acct, pos, px, 1, d, why)
    _close(acct, pos, d, why)
    return True


def _to_be(pos):
    if pos["stop"] < pos["entry"]:
        pos["stop"], pos["be_on"] = pos["entry"], True


MA_NAME = {"e9": "EMA 9", "e10": "EMA 10", "e21": "EMA 21", "s10": "SMA 10", "s20": "SMA 20", "s50": "SMA 50", "s150": "đường 30 tuần"}


def _step_position(acct, pos, b, d, P, cfg):
    """Áp quy tắc ra lệnh của người đó lên một phiên. Trả về True nếu lệnh đã đóng hết."""
    pos["held"] += 1
    o, h, l, c = b["Open"], b["High"], b["Low"], b["Close"]
    if c is None:
        return False
    o = o if o is not None else c
    h = h if h is not None else c
    l = l if l is not None else c
    sl = _slip(cfg)
    entry, risk = pos["entry"], pos["entry"] - pos["stop0"]
    vol, v50, v20 = b.get("Volume"), b.get("v50"), b.get("v20")

    # 1) stop (gồm stop hòa vốn)
    if l <= pos["stop"]:
        why = "Hòa vốn" if pos.get("be_on") and pos["stop"] >= entry else ("Stop đã dời" if pos["stop"] > pos["stop0"] else "Chạm stop")
        return _exit_all(acct, pos, min(o, pos["stop"]) * (1 - sl), d, why)

    # 2) dời stop về hòa vốn theo R
    if P.get("be_r") and h >= entry + P["be_r"] * risk:
        _to_be(pos)

    # 3) chốt từng phần
    for i, pt in enumerate(P.get("partials", [])):
        if i in pos["done"] or pos["shares"] <= 0:
            continue
        kind = pt[0]
        px, label = None, ""
        if kind == "R":
            _, val, frac, be = pt
            tgt = entry + val * risk
            if h >= tgt:
                px, label = max(o, tgt), f"Chốt {round(frac * 100)}% tại +{val}R"
        elif kind == "pct":
            _, val, frac, be = pt
            tgt = entry * (1 + val / 100)
            if h >= tgt:
                px, label = max(o, tgt), f"Chốt {round(frac * 100)}% tại +{val}%"
        elif kind == "day_profit":
            _, val, frac, be = pt
            if pos["held"] >= val and c > entry:
                px, label = c * (1 - sl), f"Chốt {round(frac * 100)}% sau {val} phiên"
        elif kind == "ext":
            _, ma, val, frac, be = pt
            if b.get(ma) and c >= b[ma] * (1 + val / 100):
                px, label = c * (1 - sl), f"Chốt {round(frac * 100)}% khi cách {MA_NAME[ma]} {val}%"
        if px is not None:
            _sell(acct, pos, px, frac, d, label)
            pos["done"].append(i)
            if be:
                _to_be(pos)
            if pos["shares"] <= 0:
                _close(acct, pos, d, "Chốt lời")
                return True

    # 4) quy tắc riêng
    if P.get("oneil"):
        g = h / entry - 1
        if not pos.get("hold8") and g >= 0.20:
            if pos["held"] <= 15:
                pos["hold8"] = True
                _to_be(pos)
                pos["fills"].append({"d": d, "px": round(entry * 1.2, 2), "sh": 0, "why": "Tăng 20% trong 3 tuần: giữ 8 tuần"})
            else:
                return _exit_all(acct, pos, max(o, entry * 1.2), d, "Chốt hết tại +20%")
        if b.get("s50") and c < b["s50"] and v50 and vol and vol >= 1.5 * v50 and (not pos.get("hold8") or pos["held"] > 40):
            return _exit_all(acct, pos, c * (1 - sl), d, "Thủng SMA 50 với khối lượng lớn")
        if pos.get("hold8") and pos["held"] > 40 and b.get("s50") and c < b["s50"]:
            return _exit_all(acct, pos, c * (1 - sl), d, "Hết 8 tuần, đóng cửa dưới SMA 50")

    if P.get("weekly") and b.get("wk_end"):
        if b.get("s150") and c < b["s150"]:
            return _exit_all(acct, pos, c * (1 - sl), d, "Tuần đóng cửa dưới đường 30 tuần")
        lo = b.get("lo20")
        if lo and lo * 0.99 > pos["stop"] and lo * 0.99 < c:
            pos["stop"] = round(lo * 0.99, 2)

    if P.get("vsa") and v20 and b.get("rng20"):
        rng = h - l
        pos_in_bar = (c - l) / rng if rng > 0 else 0.5
        if b.get("hi20") and h > b["hi20"] and pos_in_bar <= 0.33 and vol and vol >= 1.5 * v20:
            return _exit_all(acct, pos, c * (1 - sl), d, "VSA: Upthrust")
        if vol and vol >= 2 * v20 and rng >= 1.8 * b["rng20"] and pos_in_bar < 0.5 and c > entry:
            return _exit_all(acct, pos, c * (1 - sl), d, "VSA: Buying climax")
        if (not pos.get("nd") and b.get("pc") and c > b["pc"] and rng < 0.7 * b["rng20"] and vol and b.get("pv1") and b.get("pv2")
                and vol < b["pv1"] and vol < b["pv2"] and b.get("hi20") and h >= b["hi20"] * 0.97 and c > entry):
            pos["nd"] = True
            _sell(acct, pos, c * (1 - sl), 0.5, d, "VSA: No demand, chốt 50%")
            if pos["shares"] <= 0:
                _close(acct, pos, d, "Chốt lời")
                return True

    if P.get("nofollow") and pos["held"] >= P["nofollow"] and c <= entry and not pos["done"]:
        return _exit_all(acct, pos, c * (1 - sl), d, f"Không bứt tiếp sau {P['nofollow']} phiên")

    # 5) thoát theo đường trung bình
    if pos["held"] > P.get("trail_after", 0):
        stage = "post" if pos["done"] else "pre"
        for ma, when in P.get("trail", []):
            if when in (stage, "all") and b.get(ma) and c < b[ma]:
                return _exit_all(acct, pos, c * (1 - sl), d, f"Đóng cửa dưới {MA_NAME[ma]}")

    # 6) thời gian giữ tối đa
    if pos["held"] >= P["max_hold"]:
        return _exit_all(acct, pos, c * (1 - sl), d, "Hết thời gian giữ")
    return False


def _equity_now(acct, cap):
    return acct["equity"][-1][1] if acct["equity"] else cap


def _open(acct, lid, cfg, t, sig_d, d, entry, stop, P, boot):
    R = RULES[lid]
    cap = _equity_now(acct, float(cfg.get("capital", 60000)))
    if R["risk"] is None:  # O'Neil: cỡ vị thế theo % tài khoản
        sh = int(cap * R["pos"] / 100 / entry)
    else:
        sh = int(cap * R["risk"] / 100 / (entry - stop))
        sh = min(sh, int(cap * R["pos"] / 100 / entry))
    sh = min(sh, int(acct["cash"] / entry))
    if sh < 1:
        return None
    acct["cash"] -= sh * entry
    pos = {"t": t, "sig": sig_d, "in": d, "entry": round(entry, 2), "stop0": round(stop, 2), "stop": round(stop, 2), "shares0": sh,
           "shares": sh, "held": 0, "done": [], "fills": [], "plan": P, "boot": boot}
    acct["open"].append(pos)
    return pos


def _entry_day(acct, pos, b, d, P, cfg):
    """Sau khi khớp trong phiên d: kiểm tra stop, khối lượng phiên bứt phá, dời stop lên đáy phiên mua."""
    sl = _slip(cfg)
    l, c, vol, v50 = b["Low"], b["Close"], b.get("Volume"), b.get("v50")
    pos["held"] = 1
    if l is not None and l <= pos["stop"]:
        return _exit_all(acct, pos, pos["stop"] * (1 - sl), d, "Chạm stop ngay phiên mua")
    if c is None:
        return False
    if P.get("vol") and v50 and vol is not None and vol < P["vol"] * v50 and c < pos["entry"]:
        return _exit_all(acct, pos, c * (1 - sl), d, "Bứt phá thiếu khối lượng")
    if P.get("lod") and l is not None and l * 0.999 > pos["stop"] and l < pos["entry"]:
        pos["stop"] = round(l * 0.999, 2)
    return False


def step_day(st, d, bars: Bars, cfg):
    """Xử lý một phiên d: lệnh đang giữ trước, rồi lệnh chờ khớp trong phiên d."""
    sl = _slip(cfg)
    for lid, acct in st["accounts"].items():
        still = []
        for pos in acct["open"]:
            b = bars.bar(pos["t"], d)
            if b is None or not _step_position(acct, pos, b, d, pos["plan"], cfg):
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
                    continue  # gap quá xa điểm mua: không đuổi
                fill *= 1 + sl
                stop = fill * (1 - P["stop_pct"] / 100) if P.get("stop_pct") else od["stop"]
                pos = _open(acct, lid, cfg, od["t"], od["sig"], d, fill, stop, P, od.get("boot", False))
                if pos and _entry_day(acct, pos, b, d, P, cfg):
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
            px = b["Close"] if b and b["Close"] else pos.get("last", pos["entry"])
            pos["last"] = round(px, 2)
            mv += pos["shares"] * px
        eq = round(acct["cash"] + mv, 2)
        if acct["equity"] and acct["equity"][-1][0] == d:
            acct["equity"][-1][1] = eq
        else:
            acct["equity"].append([d, eq])


def new_signals(st, d, stocks, latest, cfg, bars: Bars, boot=False, max_new=5):
    L = dict(latest)
    L["asof"] = d
    Q = bars.bar("QQQ", d)
    sl = _slip(cfg)
    for lid, acct in st["accounts"].items():
        if not market_ok(lid, Q, L):
            continue
        held = {p["t"] for p in acct["open"]} | {o["t"] for o in acct["pending"]}
        room = RULES[lid]["max_open"] - len(held)
        cands = sorted([s for s in stocks if s["t"] not in held and passes(lid, s, L)], key=lambda s: s.get("rs_pos") or 1e9)
        n = 0
        for s in cands:
            if n >= min(max_new, room):
                break
            P = plan(lid, s, cfg)
            if not P:
                continue
            if P["kind"] == "close":
                if _open(acct, lid, cfg, s["t"], d, d, P["lvl"] * (1 + sl), P["stop"], P, boot):
                    n += 1
            else:
                acct["pending"].append({"t": s["t"], "sig": d, "lvl": round(P["lvl"], 2), "stop": round(P["stop"], 2),
                                        "left": P["pending"], "plan": P, "boot": boot})
                n += 1


def run(st, raw, out, cfg, boot=False):
    """Đưa trạng thái từ ngày đã xử lý gần nhất tới hôm nay rồi tạo tín hiệu mới của hôm nay."""
    bars = st.setdefault("_bars", None) or Bars(raw)
    st["_bars"] = bars
    days = [x.strftime("%Y-%m-%d") for x in raw["QQQ"].index]
    today = out["latest"]["asof"]
    todo = [x for x in days if x <= today and (x > st["last"] if st["last"] else x >= st["start"])]
    for d in todo:
        step_day(st, d, bars, cfg)
        mark(st, d, bars)
    if st["last"] != today:
        new_signals(st, today, out["stocks"], out["latest"], cfg, bars, boot=boot)
        mark(st, today, bars)
    st["last"] = today
    return st


def strip(st):
    """Bỏ phần bộ đệm trước khi lưu."""
    return {k: v for k, v in st.items() if not k.startswith("_")}


# ---------------------------------------------------------------- tổng hợp cho trang web
def summary(st, raw):
    q = raw["QQQ"]["Close"]
    start = st["start"]
    q0 = q[q.index >= pd.Timestamp(start)]
    qcurve = [[i.strftime("%Y-%m-%d"), round((v / q0.iloc[0] - 1) * 100, 2)] for i, v in q0.items()] if len(q0) else []
    out = {"start": start, "last": st["last"], "capital": st["capital"], "qqq": qcurve, "common": COMMON, "accounts": {}}
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
            "name": NAMES[lid], "rules": RULES[lid]["text"], "equity": round(last_eq, 2), "ret": round((last_eq / st["capital"] - 1) * 100, 2),
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
            "closed": sorted(cl, key=lambda c: c["out"], reverse=True)[:80],
        }
    return out
