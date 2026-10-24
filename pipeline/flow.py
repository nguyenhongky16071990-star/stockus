"""Money Flow Radar: phân biệt chỉ số hồi phục với dòng tiền thật sự quay lại.

Bốn trụ bằng chứng, mỗi trụ một điểm 0–100 (một nửa theo mức tuyệt đối, một nửa so với 1 năm qua):
- Độ rộng (Breadth): % mã trên EMA21/MA50/MA200, đường A/D, đỉnh mới − đáy mới.
- Tích lũy (Accumulation): tỷ trọng khối lượng ở mã tăng, phiên tăng mạnh có khối lượng, ngày tích lũy/phân phối của QQQ.
- Dẫn dắt (Leadership): mã có đường RS lập đỉnh, mã mạnh gần đỉnh, sức bền của top 100.
- Breakout follow-through: breakout gần đây giữ được pivot hay thất bại.
Từ đó xếp thị trường vào các giai đoạn dòng tiền. Mọi giá trị tại ngày d chỉ dùng dữ liệu tới ngày d.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

STAGES = ["Xu hướng giảm", "Hồi phục ban đầu", "Dòng tiền lan rộng", "Uptrend xác nhận", "Phân phối / suy yếu", "Chưa rõ ràng"]
STAGE_DESC = {
    "Xu hướng giảm": "Chỉ số dưới MA50, độ rộng yếu. Đứng ngoài, bảo toàn vốn.",
    "Hồi phục ban đầu": "Chỉ số bật lên nhưng độ rộng và dẫn dắt chưa theo. Chỉ theo dõi hoặc mua thử rất nhỏ nếu setup thật tốt.",
    "Dòng tiền lan rộng": "Độ rộng cải thiện, cổ phiếu dẫn dắt xuất hiện, breakout bắt đầu giữ được. Có thể tăng dần số lệnh.",
    "Uptrend xác nhận": "Nhiều ngành mạnh, breakout có follow-through, độ rộng tốt. Có thể dùng mức rủi ro cao hơn trong giới hạn đã định.",
    "Phân phối / suy yếu": "Chỉ số còn cao nhưng độ rộng giảm, breakout thất bại nhiều hơn. Giảm mức độ chủ động, siết stop.",
    "Chưa rõ ràng": "Các bằng chứng trái chiều. Giữ quy mô nhỏ, chỉ chọn setup tốt nhất.",
}


def _r(x, d=1):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return round(x, d) if math.isfinite(x) else None


def _lin(x, lo, hi):
    return ((x - lo) / (hi - lo) * 100).clip(0, 100)


def _pr(x):
    return x.rolling(252, min_periods=60).rank(pct=True) * 100


def _score(parts):
    """parts: list of (giá trị, thấp, cao). Điểm = 1/2 mức tuyệt đối + 1/2 thứ hạng so với 1 năm."""
    ab = pd.concat([_lin(v, lo, hi) for v, lo, hi in parts], axis=1).mean(axis=1)
    pr = pd.concat([_pr(v) for v, _, _ in parts], axis=1).mean(axis=1)
    return (0.5 * ab + 0.5 * pr.fillna(ab)).round(0)


def compute(ctx: dict) -> dict:
    C, H, L, V = ctx["C"], ctx["H"], ctx["L"], ctx["V"]
    valid, liquid, e21, s50, s200 = ctx["valid"], ctx["liquid"], ctx["e21"], ctx["s50"], ctx["s200"]
    rs, top, rs_nh, v50, dd_hi, udv = ctx["rs"], ctx["top"], ctx["rs_nh"], ctx["v50"], ctx["dd_hi"], ctx["udv"]
    hist, qqq, spy = ctx["hist"], ctx["qqq"], ctx["spy"]
    g_rank, ind_s = ctx["g_rank"], ctx["ind_s"]
    dates = C.index
    n = valid.sum(axis=1).replace(0, np.nan)
    cnt = lambda m: (m & valid).sum(axis=1)
    r1 = C / C.shift(1) - 1
    rng = (H - L).replace(0, np.nan)
    cpos = (C - L) / rng  # vị trí giá đóng cửa trong biên độ phiên

    # ---- A. độ rộng
    adv, dec = cnt(C > C.shift(1)), cnt(C < C.shift(1))
    ad = (adv - dec).cumsum()
    ad_slope = ad.diff(10) / n  # số mã tăng ròng trung bình mỗi mã trong 10 phiên
    nhnl = (hist["nh52"] - hist["nl52"]) / n * 100
    pct_e21, pct_s50, pct_s200 = hist["pct_e21"], hist["pct_s50"], hist["pct_s200"]
    q25net = (hist["q_up25"] - hist["q_dn25"]) / n * 100   # xu hướng trung hạn: mã tăng ≥25% trừ mã giảm ≥25% trong một quý
    breadth = _score([(pct_e21, 20, 80), (pct_s50, 20, 80), (pct_s200, 25, 80), (ad_slope, -0.3, 0.3), (nhnl, -8, 8), (q25net, -15, 25)])

    # ---- B. tích lũy (giá + khối lượng)
    lv = liquid & valid
    vol_up = V.where(lv & (C > C.shift(1)), 0).sum(axis=1).rolling(10, min_periods=5).sum()
    vol_all = V.where(lv & C.shift(1).notna(), 0).sum(axis=1).rolling(10, min_periods=5).sum()
    upvol = vol_up / vol_all.replace(0, np.nan) * 100
    strong_up = cnt(lv & (r1 >= 0.02) & (V >= 1.4 * v50) & (cpos >= 0.5))
    strong_dn = cnt(lv & (r1 <= -0.02) & (V >= 1.4 * v50) & (cpos <= 0.5))
    net_strong = (strong_up - strong_dn).rolling(10, min_periods=5).sum() / n * 100
    qc, qv = qqq["Close"], qqq["Volume"]
    acc_d = ((qc.pct_change() >= 0.002) & (qv > qv.shift(1))).rolling(25, min_periods=5).sum()
    dis_d = ((qc.pct_change() <= -0.002) & (qv > qv.shift(1))).rolling(25, min_periods=5).sum()
    acc_net = acc_d - dis_d
    pct_udv = cnt(lv & (udv >= 1.2)) / cnt(lv).replace(0, np.nan) * 100
    accum = _score([(upvol, 40, 60), (net_strong, -3, 3), (acc_net, -6, 6), (pct_udv, 20, 60)])

    # ---- C. dẫn dắt
    rsnh_pct = cnt(lv & rs_nh) / n * 100
    strong = cnt(lv & (rs >= 80) & (C > e21) & (e21 > e21.shift(5)) & (dd_hi >= -15)) / n * 100
    top_n = top.sum(axis=1).replace(0, np.nan)
    top_w10 = ((dd_hi >= -10) & top).sum(axis=1) / top_n * 100
    top_e21 = ((C > e21) & top).sum(axis=1) / top_n * 100
    lead = _score([(rsnh_pct, 0, 6), (strong, 3, 25), (top_w10, 20, 90), (top_e21, 30, 90)])

    # ---- D. breakout follow-through (chỉ đếm breakout đã đủ 5 phiên để biết kết quả)
    piv = H.shift(1).rolling(20, min_periods=15).max()
    ev = lv & (rs >= 70) & (C > piv) & ~(C.shift(1) > piv.shift(1)) & (V >= 1.2 * v50)
    min5 = C[::-1].rolling(5, min_periods=5).min()[::-1].shift(-1)   # thấp nhất 5 phiên SAU ngày breakout
    min3 = C[::-1].rolling(3, min_periods=3).min()[::-1].shift(-1)
    hold5 = (ev & (min5 >= piv)).shift(5, fill_value=False)
    seen5 = (ev & min5.notna()).shift(5, fill_value=False)
    fail3 = (ev & (min3 < piv)).shift(3, fill_value=False)
    seen3 = (ev & min3.notna()).shift(3, fill_value=False)
    W = 20
    bo_hold = hold5.sum(axis=1).rolling(W, min_periods=5).sum() / seen5.sum(axis=1).rolling(W, min_periods=5).sum().replace(0, np.nan) * 100
    bo_fail = fail3.sum(axis=1).rolling(W, min_periods=5).sum() / seen3.sum(axis=1).rolling(W, min_periods=5).sum().replace(0, np.nan) * 100
    bo_cnt = ev.sum(axis=1).rolling(10, min_periods=3).sum() / n * 100
    ft = _score([(bo_hold, 30, 70), (100 - bo_fail, 30, 80), (bo_cnt, 0, 6)])

    # ---- giai đoạn dòng tiền
    q_e21 = qc.ewm(span=21, adjust=False).mean()
    q_s50 = qc.rolling(50, min_periods=40).mean()
    q_hi = qc.rolling(252, min_periods=60).max()
    q_lo20 = qc.rolling(20, min_periods=10).min()
    up_idx = (qc > q_e21) & (q_e21 > q_e21.shift(5))
    near_hi = qc >= 0.95 * q_hi
    b_chg = breadth - breadth.shift(10)
    stage = pd.Series("Chưa rõ ràng", index=dates, dtype=object)
    down = (qc < q_s50) & (breadth < 40)
    bounce = (qc >= q_lo20 * 1.03) & (qc > q_e21)
    spread = (qc > q_e21) & (b_chg >= 8) & (breadth >= 45) & ((lead >= 45) | (ft >= 50))
    confirmed = up_idx & (breadth >= 58) & (lead >= 55) & (ft >= 52) & (accum >= 48)
    distrib = (near_hi | (qc > q_s50)) & (((b_chg <= -8) & (breadth < 55)) | ((ft < 40) & (breadth < 50)) | ((hist["nl52"] > hist["nh52"]) & near_hi))
    stage[bounce & (breadth < 45)] = "Hồi phục ban đầu"
    stage[spread] = "Dòng tiền lan rộng"
    stage[down] = "Xu hướng giảm"
    stage[distrib & ~down] = "Phân phối / suy yếu"
    stage[confirmed] = "Uptrend xác nhận"
    warm = int(ctx.get("warm", 0))   # trước mốc này dữ liệu chưa đủ dài: không xếp giai đoạn
    for ser_ in (breadth, accum, lead, ft):
        ser_.iloc[:warm] = np.nan
    stage[breadth.isna()] = None

    # ---- THỜI ĐIỂM VÀNG: nhiều bằng chứng độc lập cùng xác nhận, ưu tiên đầu chu kỳ tăng
    thrust_now = (pct_e21 >= 60) & (pct_e21.rolling(10, min_periods=5).min() <= 35)   # bùng nổ độ rộng (kiểu Zweig)
    sb_thrust = hist["ratio5"] >= 2.5                                                   # Stockbee: bứt phá 4% áp đảo
    thrust = (thrust_now | sb_thrust).rolling(20, min_periods=1).max().astype(bool)
    dd_q = hist["dd_qqq"].fillna(0)
    G = {
        "stage": stage.isin(["Dòng tiền lan rộng", "Uptrend xác nhận"]),
        "q25": (q25net > 0) & (q25net >= q25net.shift(10)),
        "thrust": thrust,
        "ft": ft >= 50,
        "index": (qc > q_e21) & (dd_q <= 4),
        "lead": (lead >= 50) & (top_w10 >= 55),
    }
    gcount = sum(v.astype(int) for v in G.values())
    # đầu chu kỳ: trong 40 phiên kể từ lần gần nhất thị trường ở Xu hướng giảm / điều chỉnh sâu (QQQ cách đỉnh ≥ 8%)
    corr = (stage == "Xu hướng giảm") | (qc <= 0.92 * q_hi)
    last_corr = pd.Series(np.where(corr, np.arange(len(dates)), np.nan), index=dates).ffill()
    since = np.arange(len(dates)) - last_corr
    early = since.between(1, 40)
    gold = pd.Series("Bất lợi", index=dates, dtype=object)
    gold[gcount >= 3] = "Trung tính"
    gold[(gcount >= 4) & G["index"]] = "Thuận lợi"
    gold[(gcount >= 5) & G["stage"] & G["index"]] = "Thời điểm vàng"
    gold[breadth.isna()] = None
    gold_early = (gold == "Thời điểm vàng") & early

    # ---- kiểm định: sau mỗi giai đoạn, QQQ và breakout diễn biến ra sao (dùng tương lai, chỉ để thống kê)
    q_f21 = qc.shift(-21) / qc - 1
    q_dd21 = qc[::-1].rolling(21, min_periods=21).min()[::-1].shift(-1) / qc - 1   # mức giảm sâu nhất trong 21 phiên sau
    ev_hold_day = (ev & (min5 >= piv)).sum(axis=1)
    ev_seen_day = (ev & min5.notna()).sum(axis=1)
    start = max(warm, 1)   # kiểm định trên toàn bộ lịch sử đã đủ dữ liệu (bỏ giai đoạn khởi động)

    def vrow(m):
        m = m.copy()
        m.iloc[:start] = False
        f, dd = q_f21[m].dropna(), q_dd21[m].dropna()
        hs, ss = ev_hold_day[m].sum(), ev_seen_day[m].sum()
        return {"days": int(m.sum()), "q21": _r(f.mean() * 100, 2) if len(f) else None, "q21_up": _r((f > 0).mean() * 100, 0) if len(f) else None,
                "dd21": _r(dd.mean() * 100, 1) if len(dd) else None, "dd5": _r((dd <= -0.05).mean() * 100, 0) if len(dd) else None,
                "bo_hold": _r(hs / ss * 100, 0) if ss else None, "bo_n": int(ss)}
    vals = [{"stage": st_, **vrow(stage == st_)} for st_ in STAGES]
    GL = ["Thời điểm vàng", "Thuận lợi", "Trung tính", "Bất lợi"]
    gval = [{"level": "Vàng + đầu chu kỳ", **vrow(gold_early)}] + [{"level": g, **vrow(gold == g)} for g in GL]
    # các cửa sổ vàng trong quá khứ (gộp khoảng ngắt ≤ 3 phiên, dài ≥ 3 phiên)
    windows, gv = [], (gold == "Thời điểm vàng").values
    k0 = None
    gap = 0
    for k in range(len(dates)):
        if gv[k]:
            if k0 is None:
                k0 = k
            gap, k1 = 0, k
        elif k0 is not None:
            gap += 1
            if gap > 3:
                if k1 - k0 + 1 >= 3:
                    windows.append((k0, k1))
                k0, gap = None, 0
    if k0 is not None and k1 - k0 + 1 >= 3:
        windows.append((k0, k1))
    win_out = []
    for k0, k1 in windows[-15:]:
        k2 = min(len(dates) - 1, k1 + 21)
        win_out.append({"from": dates[k0].strftime("%Y-%m-%d"), "to": dates[k1].strftime("%Y-%m-%d"), "days": int(k1 - k0 + 1),
                        "q_in": _r((qc.iloc[k1] / qc.iloc[k0] - 1) * 100, 1), "q_after": _r((qc.iloc[k2] / qc.iloc[k0] - 1) * 100, 1) if k2 > k1 else None,
                        "early": bool(early.iloc[k0]), "open": bool(k1 >= len(dates) - 1)})
    win_out.reverse()
    GLAB = {"stage": "Giai đoạn Dòng tiền lan rộng hoặc Uptrend xác nhận", "q25": "Mã tăng ≥25%/quý nhiều hơn mã giảm ≥25% và đang tăng lên",
            "thrust": "Có bùng nổ độ rộng trong 20 phiên (% mã trên EMA21 từ ≤35% lên ≥60% trong 10 phiên, hoặc tỷ lệ Stockbee 5 ngày ≥ 2,5)",
            "ft": "Breakout gần đây giữ được (điểm Follow-through ≥ 50)", "index": "QQQ trên EMA21 và tối đa 4 ngày phân phối",
            "lead": "Cổ phiếu dẫn dắt khỏe (điểm Dẫn dắt ≥ 50, ≥55% top 100 cách đỉnh dưới 10%)"}
    i0 = len(dates) - 1
    golden = {"level": gold.iloc[i0], "count": int(gcount.iloc[i0]), "early": bool(early.iloc[i0]), "since": _r(since.iloc[i0], 0),
              "checks": [{"k": k, "label": GLAB[k], "ok": bool(v.iloc[i0])} for k, v in G.items()],
              "validation": gval, "windows": win_out,
              "q25": {"up": _r(hist["q_up25"].iloc[i0], 0), "dn": _r(hist["q_dn25"].iloc[i0], 0), "net": _r(q25net.iloc[i0], 1), "net10": _r(q25net.iloc[i0 - 10], 1)}}

    # ---- bằng chứng hôm nay
    i = -1
    def ok(v, thr, higher=True):
        return bool(v is not None and np.isfinite(v) and (v >= thr if higher else v <= thr))
    f0 = lambda s: _r(s.iloc[i], 1)
    ev_list = [
        {"pillar": "Độ rộng", "label": "% cổ phiếu trên EMA 21", "value": f0(pct_e21), "unit": "%", "need": "≥ 55%", "ok": ok(f0(pct_e21), 55)},
        {"pillar": "Độ rộng", "label": "% cổ phiếu trên MA 50", "value": f0(pct_s50), "unit": "%", "need": "≥ 50%", "ok": ok(f0(pct_s50), 50)},
        {"pillar": "Độ rộng", "label": "% cổ phiếu trên MA 200", "value": f0(pct_s200), "unit": "%", "need": "≥ 50%", "ok": ok(f0(pct_s200), 50)},
        {"pillar": "Độ rộng", "label": "Đường A/D 10 phiên (mã tăng ròng)", "value": _r(ad.diff(10).iloc[i], 0), "unit": " mã", "need": "> 0", "ok": ok(ad.diff(10).iloc[i], 0.0001)},
        {"pillar": "Độ rộng", "label": "Mã tăng ≥25% − mã giảm ≥25% trong một quý", "value": _r((hist["q_up25"] - hist["q_dn25"]).iloc[i], 0), "unit": " mã", "need": "> 0", "ok": ok((hist["q_up25"] - hist["q_dn25"]).iloc[i], 0.5)},
        {"pillar": "Độ rộng", "label": "Đỉnh mới − đáy mới 52 tuần", "value": _r((hist["nh52"] - hist["nl52"]).iloc[i], 0), "unit": " mã", "need": "> 0", "ok": ok((hist["nh52"] - hist["nl52"]).iloc[i], 0.5)},
        {"pillar": "Tích lũy", "label": "Tỷ trọng khối lượng ở mã tăng (10 phiên)", "value": f0(upvol), "unit": "%", "need": "≥ 52%", "ok": ok(f0(upvol), 52)},
        {"pillar": "Tích lũy", "label": "Phiên tăng mạnh có khối lượng − phiên giảm mạnh có khối lượng (10 phiên)", "value": _r((strong_up - strong_dn).rolling(10).sum().iloc[i], 0), "unit": "", "need": "> 0", "ok": ok((strong_up - strong_dn).rolling(10).sum().iloc[i], 0.5)},
        {"pillar": "Tích lũy", "label": "Ngày tích lũy − ngày phân phối của QQQ (25 phiên)", "value": _r(acc_net.iloc[i], 0), "unit": "", "need": "≥ 0", "ok": ok(acc_net.iloc[i], 0)},
        {"pillar": "Tích lũy", "label": "% mã có khối lượng lên/xuống 50 phiên ≥ 1,2", "value": f0(pct_udv), "unit": "%", "need": "≥ 35%", "ok": ok(f0(pct_udv), 35)},
        {"pillar": "Dẫn dắt", "label": "% mã có đường RS lập đỉnh 52 tuần", "value": _r(rsnh_pct.iloc[i], 1), "unit": "%", "need": "≥ 2%", "ok": ok(rsnh_pct.iloc[i], 2)},
        {"pillar": "Dẫn dắt", "label": "% mã RS ≥ 80, trên EMA 21 dốc lên, cách đỉnh ≤ 15%", "value": f0(strong), "unit": "%", "need": "≥ 12%", "ok": ok(f0(strong), 12)},
        {"pillar": "Dẫn dắt", "label": "Top 100 cách đỉnh dưới 10%", "value": f0(top_w10), "unit": "%", "need": "≥ 60%", "ok": ok(f0(top_w10), 60)},
        {"pillar": "Dẫn dắt", "label": "Top 100 còn trên EMA 21", "value": f0(top_e21), "unit": "%", "need": "≥ 65%", "ok": ok(f0(top_e21), 65)},
        {"pillar": "Follow-through", "label": "Breakout giữ pivot sau 5 phiên (20 phiên gần đây)", "value": f0(bo_hold), "unit": "%", "need": "≥ 50%", "ok": ok(f0(bo_hold), 50)},
        {"pillar": "Follow-through", "label": "Breakout thủng pivot trong 3 phiên đầu", "value": f0(bo_fail), "unit": "%", "need": "≤ 45%", "ok": ok(f0(bo_fail), 45, higher=False)},
        {"pillar": "Follow-through", "label": "Số breakout có khối lượng trong 10 phiên", "value": _r(ev.sum(axis=1).rolling(10).sum().iloc[i], 0), "unit": " mã", "need": "≥ 2% số mã", "ok": ok(bo_cnt.iloc[i], 2)},
    ]
    q10 = qc.iloc[i] / qc.iloc[i - 10] - 1 if len(qc) > 10 else 0
    warn = []
    if q10 >= 0.02 and (ad.diff(10).iloc[i] < 0 or (hist["nh52"] - hist["nl52"]).iloc[i] < 0):
        warn.append(f"QQQ tăng {q10 * 100:.1f}% trong 10 phiên nhưng độ rộng không xác nhận (đường A/D hoặc đỉnh mới − đáy mới đang âm). "
                    "Chỉ số có thể đang được kéo bởi vài mã vốn hóa lớn.".replace(".", ",", 1))
    if breadth.iloc[i] < 45 and qc.iloc[i] > q_e21.iloc[i]:
        warn.append("Chỉ số trên EMA 21 nhưng điểm độ rộng dưới 45: hồi phục chưa lan rộng.")
    if ft.iloc[i] < 40:
        warn.append("Breakout gần đây thất bại nhiều: thị trường chưa thưởng cho điểm mua vượt nền.")

    # ---- dòng tiền luân chuyển giữa các ngành
    spy_r21 = spy.pct_change(21) if spy is not None else qc.pct_change(21)
    r21 = C / C.shift(21) - 1
    sectors = []
    t0 = len(dates) - 1
    for g in g_rank.columns:
        mem = [t for t in ind_s.index if ind_s[t] == g and t in C.columns]
        if len(mem) < 3 or pd.isna(g_rank[g].iloc[t0]):
            continue
        m_ = mem
        rel = (r21[m_].mean(axis=1) - spy_r21) * 100
        hi80 = lambda k: int(((rs[m_].iloc[k] >= 80) & liquid[m_].iloc[k]).sum())
        bo10 = int(ev[m_].iloc[-10:].values.sum())
        h_ = int((ev[m_] & (min5[m_] >= piv[m_])).iloc[-25:-5].values.sum()); s_ = int((ev[m_] & min5[m_].notna()).iloc[-25:-5].values.sum())
        rk, rk21 = g_rank[g].iloc[t0], g_rank[g].iloc[t0 - 21]
        sectors.append({"ind": g, "n": len(m_), "rank": int(rk), "rank5": _r(g_rank[g].iloc[t0 - 5], 0), "rank21": _r(rk21, 0),
                        "rel21": _r(rel.iloc[t0], 1), "rel21_10": _r(rel.iloc[t0 - 10], 1),
                        "rs80": hi80(t0), "rs80_10": hi80(t0 - 10), "nearhi": int(((dd_hi[m_].iloc[t0] >= -5) & valid[m_].iloc[t0]).sum()),
                        "bo10": bo10, "bo_hold": _r(h_ / s_ * 100, 0) if s_ else None, "bo_seen": s_})
    n_ind = max(1, len(sectors))
    for s in sectors:
        d21 = (s["rank21"] - s["rank"]) if s["rank21"] is not None else 0
        broad = s["rs80"] - s["rs80_10"]
        if s["rank"] <= max(1, round(n_ind * 0.2)) and d21 >= -2:
            s["label"] = "Dẫn dắt"
        elif d21 >= max(3, n_ind * 0.15) and s["rank"] <= n_ind / 2:
            s["label"] = "Mới nổi"
        elif s["rank21"] is not None and s["rank21"] <= n_ind * 0.3 and d21 <= -max(3, n_ind * 0.15):
            s["label"] = "Suy yếu"
        else:
            s["label"] = ""
        s["broad"] = broad
        s["score"] = round((n_ind - s["rank"]) / n_ind * 50 + max(-25, min(25, d21 * 50 / n_ind)) + max(-15, min(15, broad * 5)) + (s["rel21"] or 0) * 0.5, 1)
    sectors.sort(key=lambda s: -s["score"])

    keep = int(ctx.get("keep", 500))
    series = {k: [_r(x, 1) for x in v.iloc[-keep:]] for k, v in
              (("breadth", breadth), ("accum", accum), ("lead", lead), ("ft", ft), ("qqq", qc))}
    series["stage"] = [x if isinstance(x, str) else None for x in stage.iloc[-keep:]]
    series["gold"] = [x if isinstance(x, str) else None for x in gold.iloc[-keep:]]
    series["d"] = [d.strftime("%Y-%m-%d") for d in dates[-keep:]]
    now = {k: _r(v.iloc[i], 0) for k, v in (("breadth", breadth), ("accum", accum), ("lead", lead), ("ft", ft))}
    now10 = {k: _r(v.iloc[i - 10], 0) for k, v in (("breadth", breadth), ("accum", accum), ("lead", lead), ("ft", ft))}
    st_now = stage.iloc[i]
    # bao lâu đã ở giai đoạn hiện tại
    k = 0
    while k + 1 < len(stage) and stage.iloc[i - k - 1] == st_now:
        k += 1
    out = {"stage": st_now, "stage_days": k + 1, "stage_desc": STAGE_DESC.get(st_now, ""), "scores": now, "scores10": now10,
           "evidence": ev_list, "warnings": warn, "validation": vals, "sectors": sectors, "series": series,
           "stage_order": STAGES, "golden": golden}
    return out, {"gold": gold, "stage": stage, "breadth": breadth, "accum": accum, "lead": lead, "ft": ft, "ev": ev, "piv": piv}


def stock_radar(ctx: dict, sdict: dict, lab_today: dict) -> list[dict]:
    """Bằng chứng dòng tiền ở từng cổ phiếu hôm nay. Trả về danh sách đã xếp theo số bằng chứng."""
    C, H, L, V, O = ctx["C"], ctx["H"], ctx["L"], ctx["V"], ctx["O"]
    rs, liquid, e21, s200, v50, adr, udv, dnb = ctx["rs"], ctx["liquid"], ctx["e21"], ctx["s200"], ctx["v50"], ctx["adr"], ctx["udv"], ctx["dnb"]
    rsline, g_rank, ind_s, ev, piv = ctx["rsline"], ctx["g_rank"], ctx["ind_s"], ctx["ev"], ctx["piv"]
    t0 = len(C.index) - 1
    n_ind = max(1, int(g_rank.iloc[t0].notna().sum()))
    rl50 = rsline.rolling(50, min_periods=30).mean()
    rlhi = rsline.rolling(252, min_periods=120).max()
    rng5 = ((H - L) / C * 100).rolling(5).mean()
    v10 = V.rolling(10).mean()
    hi20 = H.rolling(20, min_periods=15).max()
    cpos = (C - L) / (H - L).replace(0, np.nan)
    # số mã cùng ngành có setup hoặc breakout trong 5 phiên
    bo5 = ev.iloc[-5:].any()
    ind_cnt = {}
    for t in C.columns:
        if (bo5.get(t, False) or lab_today.get(t)) and ind_s.get(t) is not None:
            ind_cnt[ind_s.get(t)] = ind_cnt.get(ind_s.get(t), 0) + 1
    out = []
    for t in C.columns:
        if not liquid[t].iloc[t0] or not (rs[t].iloc[t0] >= 60):
            continue
        rsv = rs[t].iloc[t0]
        g = ind_s.get(t)
        rk = g_rank[g].iloc[t0] if g in g_rank else np.nan
        rk21 = g_rank[g].iloc[t0 - 21] if g in g_rank else np.nan
        r80 = (rs[t].iloc[-20:] >= 80).sum()
        c = C[t].iloc[t0]
        ev_ = []
        def add(key, label, okv, detail):
            ev_.append({"k": key, "label": label, "ok": bool(okv), "detail": detail})
        add("rs", "Mạnh hơn thị trường nhiều tuần", r80 >= 15 and rsline[t].iloc[t0] > rl50[t].iloc[t0],
            f"RS {rsv:.0f}, {int(r80)}/20 phiên RS ≥ 80, đường RS {'trên' if rsline[t].iloc[t0] > rl50[t].iloc[t0] else 'dưới'} MA50 của nó")
        lead_rs = bool(rsline[t].iloc[-5:].max() >= rlhi[t].iloc[t0] * 0.995) and c < H[t].iloc[-60:].max() * 0.98
        add("rslead", "Đường RS dẫn trước giá", lead_rs, "Đường RS lập đỉnh trong 5 phiên khi giá chưa lập đỉnh" if lead_rs else "Chưa thấy đường RS lập đỉnh trước giá")
        ind_ok = bool(np.isfinite(rk) and rk <= n_ind * 0.4 and (not np.isfinite(rk21) or rk <= rk21))
        add("ind", "Ngành đang cải thiện", ind_ok, f"Ngành {g}: hạng {int(rk) if np.isfinite(rk) else '—'}/{n_ind}" + (f", 1 tháng trước {int(rk21)}" if np.isfinite(rk21) else ""))
        dist = (hi20[t].iloc[t0] / c - 1) * 100
        tight = bool(dist <= 5 and rng5[t].iloc[t0] < 0.75 * adr[t].iloc[t0] and v10[t].iloc[t0] < v50[t].iloc[t0])
        add("tight", "Gần pivot, biến động và khối lượng co hẹp", tight, f"Cách đỉnh 20 phiên {dist:.1f}%, biên độ 5 phiên {rng5[t].iloc[t0]:.1f}% so với ADR {adr[t].iloc[t0]:.1f}%")
        r1 = C[t] / C[t].shift(1) - 1
        acc_days = int(((r1 >= 0.02) & (V[t] >= 1.4 * v50[t]) & (cpos[t] >= 0.5)).iloc[-20:].sum())
        uv = udv[t].iloc[t0]
        add("acc", "Khối lượng tích lũy", bool(uv >= 1.2 and acc_days >= 2), f"KL lên/xuống 50 phiên {uv:.2f}, {acc_days} phiên tăng mạnh có KL trong 20 phiên")
        evt = np.where(ev[t].iloc[-10:].values)[0]
        bo_ok, hold_ok, bo_txt, hold_txt = False, False, "Chưa có breakout có khối lượng trong 10 phiên", "—"
        if len(evt):
            j = t0 - 9 + evt[-1]
            pv = piv[t].iloc[j]
            vr = V[t].iloc[j] / v50[t].iloc[j] if v50[t].iloc[j] else np.nan
            bo_ok = bool(vr >= 1.4 and cpos[t].iloc[j] >= 0.6)
            bo_txt = f"Vượt pivot {pv:.2f} ngày {C.index[j].strftime('%d/%m')}, KL {vr:.1f}× TB50, đóng cửa ở {cpos[t].iloc[j] * 100:.0f}% biên độ"
            hold_ok = bool(C[t].iloc[j:].min() >= pv)
            hold_txt = "Vẫn giữ trên pivot" if hold_ok else "Đã đóng cửa dưới pivot"
        add("bo", "Vượt pivot có khối lượng xác nhận", bo_ok, bo_txt)
        add("hold", "Giữ được pivot sau breakout", hold_ok, hold_txt)
        k_ind = ind_cnt.get(g, 0) if g is not None else 0
        add("group", "Nhiều mã cùng ngành có setup", k_ind >= 3, f"{k_ind} mã cùng ngành có setup hoặc breakout trong 5 phiên")
        d_ = dnb[t].iloc[t0]
        add("res", "Giữ giá khi thị trường giảm", bool(np.isfinite(d_) and d_ > 0), f"Chênh lệch TB khi QQQ giảm: {d_:+.2f}%" if np.isfinite(d_) else "Chưa đủ dữ liệu")
        # mạnh lên từ khi nào: chuỗi phiên liên tiếp RS ≥ 80
        streak = 0
        rv = rs[t].values
        while streak < t0 and rv[t0 - streak] >= 80:
            streak += 1
        # bật mạnh do sự kiện từ nền yếu: có thể là tin tức hoặc short covering
        gap = (O[t] / C[t].shift(1) - 1).iloc[-5:]
        news = None
        if (gap >= 0.08).any():
            jg = t0 - 4 + int(np.argmax(gap.values >= 0.08))
            prior = C[t].iloc[jg - 1] / C[t].iloc[max(0, jg - 64)] - 1 if jg > 64 else np.nan
            below200 = C[t].iloc[jg - 1] < s200[t].iloc[jg - 1] if np.isfinite(s200[t].iloc[jg - 1]) else False
            if (np.isfinite(prior) and prior < -0.15) or below200:
                news = f"Gap {gap.max() * 100:.0f}% ngày {C.index[jg].strftime('%d/%m')} từ nền yếu (trước đó {'dưới MA200' if below200 else f'giảm {prior * 100:.0f}% trong 3 tháng'}): có thể là phản ứng tin tức hoặc short covering, cần thêm phiên xác nhận."
            else:
                news = f"Gap {gap.max() * 100:.0f}% ngày {C.index[jg].strftime('%d/%m')} khi đang trong xu hướng tăng: sự kiện có ý nghĩa, theo dõi giá có giữ được đáy phiên gap không."
        okn = sum(1 for e in ev_ if e["ok"])
        s = sdict.get(t, {})
        out.append({"t": t, "ind": g, "rs": int(rsv), "close": round(float(c), 2), "chg": s.get("chg"), "score": okn, "n": len(ev_),
                    "ev": ev_, "streak": streak, "news": news, "lab": lab_today.get(t, [])})
    out.sort(key=lambda x: (-x["score"], -x["rs"]))
    return out
