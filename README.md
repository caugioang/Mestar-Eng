# Mestar Eng — App Học Từ Vựng Cá Nhân (SRS 10 ngày – 30 ngày)

Ứng dụng web tối giản nền đen tuyền `#000000` (OLED), chạy trực tiếp trên trình duyệt desktop và mobile không cần cài đặt hay backend.

## Cách mở ứng dụng
- Mở trực tiếp file `index.html` bằng trình duyệt (Chrome, Edge, Safari, Firefox).
- Tiến độ được tự động lưu vào `localStorage` ngay sau từng thao tác.

## Chu kỳ SRS
- **Từ mới (`new`)**:
  - Bấm **Thuộc** → chuyển sang `wait_10d` (hẹn ôn sau 10 ngày).
  - Bấm **Quên** → giữ trong phiên học mới để học lại ngay.
- **Ôn mốc 10 ngày (`wait_10d`)**:
  - Bấm **Thuộc** → chuyển sang `wait_30d` (hẹn ôn sau 30 ngày).
  - Bấm **Quên** → đưa về kho **Từ mới**.
- **Ôn mốc 30 ngày (`wait_30d`)**:
  - Bấm **Thuộc** → chuyển sang kho **Đã thuộc** (`mastered`).
  - Bấm **Quên** → đưa về kho **Từ mới** (có thể đổi sang quay lại 10 ngày trong tab *Kho từ*).
- **Chuyển thẳng Đã thuộc**: đưa từ vào kho `mastered` bất kỳ lúc nào.

## Phím tắt (Desktop)
- `Space` / `Enter`: Lật thẻ xem nghĩa
- `1` / `Q` / `←`: Quên
- `2` / `T` / `→`: Thuộc
- `3` / `M`: Chuyển thẳng sang Đã thuộc
- `Z`: Hoàn tác thao tác vừa bấm

## Định dạng file `.txt` (UTF-8, phân tách `|`)
```text
word | pos | meaning | example | ipa | note | group
```
- Tối thiểu cần `word | pos | meaning | example` (có thể để trống `pos` hoặc `example`).
- Các trường mở rộng `ipa | note | group` là tùy chọn.
- Khi nạp file mới, từ đã tồn tại được **giữ nguyên trạng thái và lịch hẹn**, chỉ thêm từ mới.
- Xem ví dụ tại `sample_vocab.txt`.
