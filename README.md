# Nhiệt kế thị trường

Trang web tự cập nhật mỗi sáng, đo sức khỏe thị trường Mỹ theo phương pháp của **Martin Luk, Qullamaggie, Mark Minervini, William O'Neil, Stan Weinstein, Pradeep Bonde (Stockbee) và Oliver Kell**.

Mỗi sáng thứ Ba đến thứ Bảy lúc 7:15 giờ Tokyo, máy chủ GitHub tự tải giá, tính toán, rồi cập nhật trang web. Bạn không cần bật máy.

- **Có khóa Massive** (khuyên dùng, gói Starter 29 USD/tháng): quét **toàn bộ cổ phiếu Mỹ** (khoảng 3.000–4.000 mã đủ thanh khoản). Xem Bước 7.
- **Không có khóa:** dùng Yahoo Finance miễn phí với khoảng 300 mã trong `pipeline/universe.csv`.

## Trang web có gì

| Tab | Nội dung |
|---|---|
| **Tổng quan** | Bảng kiểm 8 điều kiện của các huyền thoại (chấm xanh/vàng/đỏ), ứng viên đáng chú ý hôm nay, điểm sức khỏe 0–100, trạng thái (Tấn công / Bình thường / Thận trọng / Phòng thủ), đèn cảnh báo kèm lý do, xu hướng QQQ, giai đoạn Weinstein, ngày phân phối, ngày xác nhận tăng |
| **Nhóm mạnh nhất** | 100 mã mạnh nhất đang tăng hay giảm: lợi nhuận 1, 3, 5 phiên và 1 tháng, số mã lập đỉnh mới, số mã cách đỉnh dưới 10% và 20%, % còn trên EMA 21, % breakout giữ giá, kèm nhận xét tự động |
| **Độ rộng** | Chỉ báo Stockbee (mã tăng/giảm ≥ 4%), % cổ phiếu trên SMA 40/200 và EMA 21, đỉnh/đáy mới 52 tuần, mã tăng/giảm ≥ 25% trong quý, McClellan |
| **Ngành & dẫn đầu** | Xếp hạng ngành kiểu IBD (hạng hiện tại, thay đổi 1 tuần và 1 tháng), chủ đề, mã mới vào và vừa rời nhóm dẫn đầu |
| **Mẫu hình** | Thống kê 8 kiểu mua (breakout nền, vượt đỉnh, bứt phá 4%, EP, về EMA 21/50 bật lên…): % có lãi sau 1, 3, 5 phiên và 1 tháng, % chạm stop. Nhận xét thị trường đang thưởng cho breakout hay mua điều chỉnh |
| **Setup hôm nay** | Mã có setup mua (Nền chặt, EP, VCP, EMA crossback, EMA hội tụ, Inside day, Lấy lại EMA 9/AVWAP) kèm giá mua, stop, số cổ phiếu theo vốn của bạn |
| **Lọc siêu cổ** | Bộ lọc của riêng bạn: top RS, top ngành, doanh thu/EPS tăng, Trend Template, đường RS, vốn hóa… bật/tắt từng điều kiện, xem cả mã gần đạt |
| **Tìm mã** | Toàn bộ danh sách với điểm RS, Trend Template, đường RS, khoảng cách tới EMA |
| **Nhật ký** | Ghi lệnh của bạn; tự tính R, tỷ lệ thắng, kỳ vọng, đường vốn. Xuất và nhập CSV |
| **Hướng dẫn** | Định nghĩa từng chỉ số và cách đọc trang |

Bấm vào một mã bất kỳ để xem biểu đồ nến có EMA 9/21/50, AVWAP, giá mua và stop, kèm nút **Mở trên TradingView**. Tab Nhóm mạnh nhất và Setup hôm nay có nút **Xuất watchlist TradingView**: tải file .txt, rồi trong TradingView mở danh sách theo dõi → **Import list** để xem các mã đó bằng dữ liệu bạn đã mua.

---

## Cài đặt lần đầu (khoảng 10 phút, chỉ dùng trình duyệt)

### Bước 1: Tạo tài khoản GitHub

Vào <https://github.com/signup> và đăng ký miễn phí.

### Bước 2: Tạo kho chứa

1. Bấm dấu **+** ở góc trên bên phải, chọn **New repository**.
2. **Repository name:** `nhiet-ke-thi-truong`
3. Chọn **Public**. GitHub Pages miễn phí chỉ dùng được với kho công khai. Nhật ký giao dịch của bạn chỉ lưu trong trình duyệt, không lên GitHub.
4. Bấm **Create repository**.

### Bước 3: Tải code lên

1. Giải nén file zip trên máy.
2. Trong trang kho vừa tạo, bấm **uploading an existing file**.
3. Mở thư mục `nhiet-ke-thi-truong` đã giải nén, chọn **tất cả** file và thư mục bên trong (`docs`, `pipeline`, `README.md`, `.gitignore`), rồi kéo thả vào trang.
4. Bấm **Commit changes**.

> **Quan trọng: thư mục `.github` thường bị ẩn**, nhất là trên macOS, nên hay bị sót khi kéo thả. Kiểm tra: trong kho phải có thư mục `.github/workflows/daily.yml`. Nếu không có:
> 1. Bấm **Add file → Create new file**.
> 2. Ở ô tên file, gõ đúng: `.github/workflows/daily.yml`
> 3. Mở file `daily.yml` trong thư mục đã giải nén (đường dẫn `.github/workflows/`) bằng Notepad hoặc TextEdit, sao chép toàn bộ và dán vào.
> 4. Bấm **Commit changes**.

### Bước 4: Bật quyền cho tác vụ tự động

1. Vào **Settings → Actions → General**.
2. Kéo xuống **Workflow permissions**, chọn **Read and write permissions**, bấm **Save**.

### Bước 5: Bật trang web

1. Vào **Settings → Pages**.
2. Ở **Source**, chọn **GitHub Actions**.

### Bước 6: Chạy lần đầu

1. Vào tab **Actions**. Nếu GitHub hỏi, bấm nút xanh để bật workflow.
2. Chọn **Cập nhật hằng ngày** ở cột trái, bấm **Run workflow → Run workflow**.
3. Chờ khoảng 3–6 phút cho tới khi có dấu tích xanh.
4. Trang web của bạn ở địa chỉ: `https://TÊN-TÀI-KHOẢN.github.io/nhiet-ke-thi-truong/`

Từ giờ trang tự cập nhật mỗi sáng. Trên điện thoại, mở địa chỉ trên rồi chọn **Thêm vào màn hình chính** để dùng như một ứng dụng.

### Bước 7 (khuyên dùng): Quét toàn thị trường bằng Massive

Gói dữ liệu TradingView chỉ dùng được bên trong TradingView, không có API cho chương trình khác lấy dữ liệu. Vì vậy trang dùng **Massive** (tên mới của Polygon.io) làm nguồn giá.

1. Đăng ký tại <https://massive.com>, chọn gói **Stocks Starter** (29 USD/tháng: 5 năm lịch sử, gọi API không giới hạn).
2. Vào trang quản lý tài khoản (Dashboard) → **API Keys**, sao chép khóa.
3. Trên GitHub, vào kho → **Settings → Secrets and variables → Actions → New repository secret**.
   - **Name:** `MASSIVE_API_KEY`
   - **Secret:** dán khóa vừa sao chép → **Add secret**.
4. Vào **Actions → Cập nhật hằng ngày → Run workflow**. Lần đầu mất khoảng 10–15 phút vì phải tải 3 năm giá và thông tin ngành của mọi mã. Từ lần sau chỉ 2–4 phút.

Dòng trên cùng của trang sẽ ghi "Massive (toàn thị trường)". Nếu Massive lỗi, trang tự chuyển về Yahoo trong ngày đó.

**Muốn thử miễn phí trước?** Gói **Stocks Basic** miễn phí nhưng chỉ có 2 năm lịch sử và 5 lệnh gọi/phút. Khi đó sửa `pipeline/config.json`: `"years": 2` và `"massive_calls_per_min": 5`. Lần chạy đầu mất khoảng 2 giờ, các lần sau vài phút. Ngành của các mã được tải dần, khoảng 60 mã mỗi ngày, nên mấy tuần đầu nhiều mã nằm ở nhóm "Khác".

---

## Tùy chỉnh

Mọi chỉnh sửa đều làm được ngay trên GitHub: mở file, bấm biểu tượng bút chì, sửa, rồi bấm **Commit changes**.

**Vốn và rủi ro mặc định:** file `pipeline/config.json`

| Tham số | Ý nghĩa | Mặc định |
|---|---|---|
| `capital` | Vốn (USD) | 60000 |
| `risk_pct` | Rủi ro mỗi lệnh (% vốn) | 0.5 → 300 USD/lệnh |
| `max_stop_pct` | Stop tối đa (%) | 6 |
| `max_pos_pct` | Vị thế tối đa (% vốn) | 35 |
| `basket_size` | Số mã trong "nhóm mạnh nhất" | 100 |
| `fund_top` | Số mã mạnh nhất được tải doanh thu/EPS từ Yahoo | 400 |
| `min_dollar_vol` | Thanh khoản tối thiểu (USD/ngày) | 20 000 000 |
| `leader_min_adr` | Biên độ ngày tối thiểu cho mã dẫn đầu (%) | 4 |
| `scan_min_price` | Giá tối thiểu để đưa vào quét toàn thị trường (USD) | 3 |
| `scan_min_dollar_vol` | Giao dịch tối thiểu để đưa vào quét (USD/ngày) | 2 000 000 |
| `massive_calls_per_min` | Giới hạn gọi Massive mỗi phút (0 = không giới hạn; gói miễn phí đặt 5) | 0 |

Bạn cũng có thể đổi vốn và rủi ro ngay trên trang web, trong tab **Setup hôm nay**. Thiết lập đó được nhớ trong trình duyệt.

**Danh sách cổ phiếu:** khi dùng Massive, trang tự quét mọi mã đủ điều kiện; `pipeline/universe.csv` chỉ dùng để đặt tên ngành theo chủ đề (Lượng tử, Hạ tầng AI…) cho các mã bạn quan tâm, các mã khác được xếp ngành theo mã SIC. Khi dùng Yahoo, `universe.csv` là toàn bộ danh sách theo dõi. Mỗi dòng có dạng `MÃ,Ngành`.

**Giờ chạy:** dòng `cron` trong `.github/workflows/daily.yml` (tính theo giờ UTC).

## Xem thử trên máy (không bắt buộc)

```bash
pip install -r pipeline/requirements.txt
python pipeline/build.py --demo    # dữ liệu giả lập
python pipeline/build.py           # dữ liệu thật (Yahoo)
MASSIVE_API_KEY=khóa_của_bạn python pipeline/build.py   # dữ liệu thật (Massive)
cd docs && python -m http.server 8000   # rồi mở http://localhost:8000
```

## Khi có sự cố

- **Trang báo "dữ liệu đã cũ":** vào tab **Actions**, mở lần chạy có dấu × đỏ để xem lỗi. Phần lớn là Yahoo Finance tạm thời chặn hoặc lỗi; lần chạy sau thường tự hết. Có thể bấm **Run workflow** để chạy lại.
- **GitHub tắt lịch chạy:** GitHub tự tắt lịch chạy nếu kho không có hoạt động trong 60 ngày. Tác vụ này tự lưu dữ liệu mỗi ngày nên thường không bị tắt. Nếu có bị tắt, vào **Actions** và bật lại.
- **Nhật ký mất:** nhật ký chỉ lưu trong trình duyệt bạn đang dùng. Xóa dữ liệu trình duyệt hay đổi máy là mất. Hãy bấm **Xuất CSV** định kỳ để sao lưu, rồi **Nhập CSV** khi cần khôi phục.

## Kho dữ liệu lịch sử

Mỗi ngày, ảnh chụp tổng quan và danh sách setup được lưu vào `docs/data/archive/NGÀY.json`. Sau vài tháng, kho này đủ dày để kiểm chứng lại xem setup nào, trong trạng thái thị trường nào, hiệu quả nhất.

## Giới hạn

- Dữ liệu giá ngày. Không có dữ liệu trong phiên, nên stop thực tế của Martin (theo nến 5 phút) chặt hơn stop trên trang.
- Với Massive: giá được điều chỉnh theo chia/gộp cổ phiếu nhưng không theo cổ tức; mã đổi tên sẽ mất phần lịch sử dưới tên cũ; chỉ tính các mã còn niêm yết.
- Với Yahoo: nguồn miễn phí, không chính thức, chỉ khoảng 300 mã.
- **Đây là công cụ học tập và theo dõi, không phải khuyến nghị đầu tư.**

Biểu đồ dùng [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) (giấy phép Apache 2.0).
