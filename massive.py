"""Nguồn dữ liệu Massive (trước đây là Polygon.io): quét toàn bộ cổ phiếu Mỹ.

Mỗi phiên chỉ cần 1 lệnh gọi "Daily Market Summary" để lấy giá của mọi mã.
Dữ liệu từng ngày được lưu đệm trong pipeline/cache (GitHub Actions giữ lại giữa
các lần chạy), nên mỗi sáng chỉ tải thêm vài ngày mới nhất.

Giá được lưu ở dạng chưa điều chỉnh, rồi tự điều chỉnh theo lịch chia/gộp cổ phiếu
mỗi lần chạy. Cổ tức không điều chỉnh (ảnh hưởng không đáng kể với cổ phiếu tăng trưởng).
"""
from __future__ import annotations

import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "pipeline" / "cache"
INFO_FILE = ROOT / "pipeline" / "tickers_info.json"


class Forbidden(Exception):
    pass


class Client:
    def __init__(self, key: str, base: str, per_min: int):
        self.key, self.base = key, base.rstrip("/")
        self.gap = 60.0 / per_min if per_min else 0.0
        self.lock = threading.Lock()
        self.next_t = 0.0
        self.s = requests.Session()
        self.calls = 0

    def _wait(self):
        if not self.gap:
            return
        with self.lock:
            now = time.monotonic()
            t = max(now, self.next_t)
            self.next_t = t + self.gap
        time.sleep(max(0.0, t - now))

    def get(self, url: str, params: dict | None = None) -> dict:
        if not url.startswith("http"):
            url = self.base + url
        params = dict(params or {})
        params["apiKey"] = self.key
        for attempt in range(6):
            self._wait()
            self.calls += 1
            try:
                r = self.s.get(url, params=params, timeout=40)
            except requests.RequestException:
                time.sleep(2 * (attempt + 1))
                continue
            if r.status_code == 429:
                time.sleep(15)
                continue
            if r.status_code == 401:
                raise RuntimeError("MASSIVE_API_KEY không hợp lệ (lỗi 401). Kiểm tra lại secret trên GitHub.")
            if r.status_code == 403:
                raise Forbidden(r.text[:200])
            if r.status_code >= 500:
                time.sleep(3 * (attempt + 1))
                continue
            r.raise_for_status()
            js = r.json()
            if js.get("status") == "NOT_AUTHORIZED":
                raise Forbidden(js.get("message", ""))
            return js
        raise RuntimeError(f"Không gọi được {url}")

    def paged(self, path: str, params: dict) -> list[dict]:
        out, js = [], self.get(path, params)
        while True:
            out += js.get("results") or []
            nxt = js.get("next_url")
            if not nxt:
                return out
            js = self.get(nxt)


# ---------------------------------------------------------------- giá theo ngày
COLS = ["T", "o", "h", "l", "c", "v"]


def _grouped_day(cl: Client, d: str, recent: bool) -> pd.DataFrame | None:
    f = CACHE / "grouped" / f"{d}.parquet"
    na = CACHE / "grouped" / f"{d}.na"
    if not recent:
        if f.exists():
            return pd.read_parquet(f)
        if na.exists():
            return None
    try:
        js = cl.get(f"/v2/aggs/grouped/locale/us/market/stocks/{d}", {"adjusted": "false"})
    except Forbidden:
        na.touch()  # ngoài phạm vi lịch sử của gói đang dùng
        return None
    res = js.get("results") or []
    df = pd.DataFrame(res).reindex(columns=COLS) if res else pd.DataFrame(columns=COLS)
    df = df.dropna(subset=["T", "c"])
    if res or not recent:  # ngày lễ thì lưu file rỗng; ngày gần đây chưa có số liệu thì không lưu
        df.to_parquet(f, index=False)
    return df


def fetch_prices(cl: Client, days: list[str], workers: int) -> pd.DataFrame:
    (CACHE / "grouped").mkdir(parents=True, exist_ok=True)
    recent = set(days[-3:])  # luôn tải lại 3 phiên gần nhất phòng số liệu được sửa
    todo = [d for d in days if d in recent or not ((CACHE / "grouped" / f"{d}.parquet").exists() or (CACHE / "grouped" / f"{d}.na").exists())]
    print(f"Massive: {len(days)} phiên, cần tải {len(todo)} phiên")
    frames = {}

    def job(d):
        return d, _grouped_day(cl, d, d in recent)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        for i, (d, df) in enumerate(ex.map(job, days)):
            if df is not None and len(df):
                frames[d] = df
            if (i + 1) % 100 == 0:
                print(f"  … {i + 1}/{len(days)}")
    if not frames:
        raise RuntimeError("Massive không trả về dữ liệu giá nào.")
    long = pd.concat([df.assign(d=d) for d, df in frames.items()], ignore_index=True)
    long["d"] = pd.to_datetime(long["d"])
    return long


def adjust_splits(panels: dict[str, pd.DataFrame], splits: list[dict]) -> int:
    n = 0
    cols = set(panels["Close"].columns)
    for s in splits:
        t, ex = s.get("ticker"), s.get("execution_date")
        fr, to = s.get("split_from"), s.get("split_to")
        if t not in cols or not ex or not fr or not to:
            continue
        ratio = float(to) / float(fr)
        if ratio <= 0 or ratio == 1:
            continue
        before = panels["Close"].index < pd.Timestamp(ex)
        for f in ("Open", "High", "Low", "Close"):
            panels[f].loc[before, t] = panels[f].loc[before, t] / ratio
        panels["Volume"].loc[before, t] = panels["Volume"].loc[before, t] * ratio
        n += 1
    return n


# ---------------------------------------------------------------- danh sách mã và ngành
def list_tickers(cl: Client) -> dict[str, str]:
    """Cổ phiếu phổ thông (CS) và chứng chỉ lưu ký (ADRC) đang niêm yết. Lưu đệm 7 ngày."""
    f = CACHE / "tickers.json"
    if f.exists() and time.time() - f.stat().st_mtime < 7 * 86400:
        return json.loads(f.read_text())
    out = {}
    for typ in ("CS", "ADRC"):
        for r in cl.paged("/v3/reference/tickers", {"market": "stocks", "type": typ, "active": "true", "limit": 1000}):
            if r.get("ticker"):
                out[r["ticker"]] = r.get("name", "")
    if len(out) > 1000:
        CACHE.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(out))
    return out


THEME_RULES = [
    ("SEMICONDUCTOR", "Bán dẫn"),
    ("COMPUTER STORAGE", "Bộ nhớ & lưu trữ"),
    ("PREPACKAGED SOFTWARE", "Phần mềm & AI"), ("COMPUTER PROGRAMMING", "Phần mềm & AI"),
    ("COMPUTER INTEGRATED", "Phần mềm & AI"), ("COMPUTER PROCESSING", "Phần mềm & AI"),
    ("COMPUTER COMMUNICATIONS", "Phần cứng & mạng"), ("TELEPHONE & TELEGRAPH APPARATUS", "Phần cứng & mạng"),
    ("ELECTRONIC COMPUTERS", "Phần cứng & mạng"), ("COMPUTER PERIPHERAL", "Phần cứng & mạng"),
    ("ELECTRONIC", "Phần cứng & mạng"), ("OPTICAL", "Phần cứng & mạng"),
    ("PHARMACEUTICAL", "Y sinh & sức khỏe"), ("BIOLOGICAL", "Y sinh & sức khỏe"), ("MEDICAL", "Y sinh & sức khỏe"),
    ("SURGICAL", "Y sinh & sức khỏe"), ("IN VITRO", "Y sinh & sức khỏe"), ("HEALTH", "Y sinh & sức khỏe"),
    ("HOSPITAL", "Y sinh & sức khỏe"), ("DENTAL", "Y sinh & sức khỏe"), ("ORTHOPEDIC", "Y sinh & sức khỏe"),
    ("LABORATORY", "Y sinh & sức khỏe"),
    ("REAL ESTATE INVESTMENT", "Bất động sản"), ("REAL ESTATE", "Bất động sản"), ("OPERATORS OF", "Bất động sản"),
    ("BANK", "Tài chính"), ("SAVINGS INSTITUTION", "Tài chính"), ("INSURANCE", "Tài chính"),
    ("SECURITY BROKERS", "Tài chính"), ("FINANCE", "Tài chính"), ("INVESTMENT ADVICE", "Tài chính"),
    ("CREDIT", "Tài chính"), ("FINANCIAL", "Tài chính"), ("BLANK CHECK", "Tài chính"),
    ("CRUDE PETROLEUM", "Dầu khí"), ("PETROLEUM", "Dầu khí"), ("NATURAL GAS", "Dầu khí"),
    ("OIL", "Dầu khí"), ("DRILLING", "Dầu khí"), ("PIPE LINES", "Dầu khí"),
    ("ELECTRIC SERVICES", "Điện & hạt nhân"), ("COGENERATION", "Điện & hạt nhân"), ("ELECTRIC & OTHER", "Điện & hạt nhân"),
    ("WATER SUPPLY", "Điện & hạt nhân"),
    ("GOLD", "Kim loại & hàng hóa"), ("SILVER", "Kim loại & hàng hóa"), ("METAL MINING", "Kim loại & hàng hóa"),
    ("MINING", "Kim loại & hàng hóa"), ("STEEL", "Kim loại & hàng hóa"), ("SMELTING", "Kim loại & hàng hóa"),
    ("CHEMICAL", "Kim loại & hàng hóa"), ("AGRICULTUR", "Kim loại & hàng hóa"),
    ("AIRCRAFT", "Vũ trụ & quốc phòng"), ("GUIDED MISSILES", "Vũ trụ & quốc phòng"),
    ("SEARCH, DETECTION", "Vũ trụ & quốc phòng"), ("ORDNANCE", "Vũ trụ & quốc phòng"),
    ("MOTOR VEHICLE", "Ô tô & EV"),
    ("TELEPHONE COMMUNICATIONS", "Viễn thông"), ("RADIOTELEPHONE", "Viễn thông"), ("CABLE", "Viễn thông"),
    ("COMMUNICATIONS SERVICES", "Viễn thông"),
    ("TRUCKING", "Vận tải"), ("AIR TRANSPORTATION", "Vận tải"), ("RAILROAD", "Vận tải"),
    ("WATER TRANSPORTATION", "Vận tải"), ("TRANSPORTATION", "Vận tải"), ("AIR COURIER", "Vận tải"),
    ("RETAIL", "Tiêu dùng & bán lẻ"), ("EATING", "Tiêu dùng & bán lẻ"), ("APPAREL", "Tiêu dùng & bán lẻ"),
    ("FOOD", "Tiêu dùng & bán lẻ"), ("BEVERAGES", "Tiêu dùng & bán lẻ"), ("HOTELS", "Tiêu dùng & bán lẻ"),
    ("AMUSEMENT", "Tiêu dùng & bán lẻ"), ("FOOTWEAR", "Tiêu dùng & bán lẻ"), ("PERFUMES", "Tiêu dùng & bán lẻ"),
    ("CATALOG & MAIL-ORDER", "Internet & tiêu dùng số"), ("ADVERTISING", "Internet & tiêu dùng số"),
    ("BUSINESS SERVICES", "Dịch vụ doanh nghiệp"), ("SERVICES-", "Dịch vụ doanh nghiệp"),
    ("MACHINERY", "Công nghiệp"), ("CONSTRUCTION", "Công nghiệp"), ("ELECTRICAL", "Công nghiệp"),
    ("INDUSTRIAL", "Công nghiệp"), ("ENGINES", "Công nghiệp"), ("EQUIPMENT", "Công nghiệp"),
    ("FABRICATED", "Công nghiệp"), ("WHOLESALE", "Công nghiệp"),
]


def theme_of(sic: str | None) -> str:
    s = (sic or "").upper()
    if not s:
        return "Khác"
    for k, v in THEME_RULES:
        if k in s:
            return v
    return "Khác"


def ticker_info(cl: Client, tickers: list[str], budget: int, workers: int) -> dict[str, list]:
    """Tên công ty, ngành (mã SIC) và số cổ phiếu lưu hành. Lưu trong tickers_info.json.

    Mỗi mục: [tên, ngành SIC, số cổ phiếu, ngày tải]. Số cổ phiếu được làm mới sau 90 ngày.
    """
    info = json.loads(INFO_FILE.read_text(encoding="utf-8")) if INFO_FILE.exists() else {}
    today = datetime.now(timezone.utc).date()

    def stale(v):
        try:
            return len(v) < 4 or (today - datetime.strptime(v[3], "%Y-%m-%d").date()).days > 90
        except Exception:
            return True

    need = ([t for t in tickers if t not in info] + [t for t in tickers if t in info and stale(info[t])])[:budget]
    if need:
        print(f"Massive: tải thông tin công ty cho {len(need)} mã")

        def job(t):
            try:
                r = cl.get(f"/v3/reference/tickers/{t}").get("results") or {}
                sh = r.get("weighted_shares_outstanding") or r.get("share_class_shares_outstanding")
                return t, [r.get("name", ""), r.get("sic_description", ""), sh, today.isoformat()]
            except Exception:
                return t, None

        with ThreadPoolExecutor(max_workers=workers) as ex:
            for t, v in ex.map(job, need):
                if v is not None:
                    info[t] = v
        INFO_FILE.write_text(json.dumps(info, ensure_ascii=False, sort_keys=True, indent=0), encoding="utf-8")
    return info


# ---------------------------------------------------------------- ghép lại
def load(key: str, cfg: dict, curated: pd.DataFrame, indexes: list[str]):
    """Trả về (raw, universe) đúng định dạng build.compute cần."""
    per_min = int(cfg.get("massive_calls_per_min", 0))
    workers = 1 if per_min else 8
    cl = Client(key, cfg.get("massive_base", "https://api.massive.com"), per_min)

    now_ny = datetime.now(timezone.utc) - timedelta(hours=4)
    end = pd.Timestamp(now_ny.date())
    start = end - pd.DateOffset(years=int(cfg["years"]))
    days = [d.strftime("%Y-%m-%d") for d in pd.bdate_range(start, end)]
    long = fetch_prices(cl, days, workers)

    names = list_tickers(cl)
    cur = set(curated.ticker)
    allowed = set(names) | cur

    # chọn mã đủ giá và thanh khoản trong 20 phiên gần nhất
    last_days = sorted(long["d"].unique())[-20:]
    rec = long[long["d"].isin(last_days)]
    stat = rec.assign(dv=rec.c * rec.v).groupby("T").agg(dv=("dv", "mean"), c=("c", "last"))
    keep = stat[(stat.dv >= cfg.get("scan_min_dollar_vol", 2e6)) & (stat.c >= cfg.get("scan_min_price", 3))].index
    universe_t = sorted((set(keep) & allowed) | (cur & set(stat.index)))
    want = set(universe_t) | set(indexes)
    long = long[long["T"].isin(want)]
    print(f"Massive: {len(universe_t)} cổ phiếu đạt điều kiện quét")

    panels = {}
    for f, k in (("Open", "o"), ("High", "h"), ("Low", "l"), ("Close", "c"), ("Volume", "v")):
        panels[f] = long.pivot_table(index="d", columns="T", values=k, aggfunc="last").sort_index().astype(float)

    try:
        splits = cl.paged("/v3/reference/splits", {"execution_date.gte": days[0], "limit": 1000})
        print(f"Massive: điều chỉnh {adjust_splits(panels, splits)} lần chia/gộp cổ phiếu")
    except Exception as e:
        print("Không tải được lịch chia tách cổ phiếu:", e, file=sys.stderr)

    budget = int(cfg.get("info_per_run", 100000 if not per_min else 60))
    info = ticker_info(cl, universe_t, budget, workers)

    raw = {}
    for t in want:
        if t not in panels["Close"]:
            continue
        df = pd.DataFrame({f: panels[f][t] for f in panels}).dropna(subset=["Close"])
        if len(df) > 20:
            raw[t] = df
    th_cur = dict(zip(curated.ticker, curated.theme))
    rows = []
    for t in universe_t:
        v = (info.get(t) or []) + ["", "", None]
        nm, sic, sh = v[0], v[1], v[2]
        rows.append({"ticker": t, "theme": th_cur.get(t) or theme_of(sic), "name": nm or names.get(t, ""),
                     "industry": sic.title() if sic else (th_cur.get(t) or "Khác"), "shares": sh})
    print(f"Massive: {cl.calls} lệnh gọi API")
    return raw, pd.DataFrame(rows)
