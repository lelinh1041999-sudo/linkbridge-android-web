# LinkBridge — Điều khiển Samsung Galaxy S26 siêu mượt qua Web (Chromebook Crostini)

Ứng dụng web điều khiển màn hình điện thoại Android với **độ trễ siêu thấp (~20–40ms)**, hoạt động không dây qua **Wi-Fi (Wireless Debugging)**, tương thích tối ưu cho **Chromebook (Linux Crostini)** + **Samsung Galaxy S26**.

## Điểm nổi bật
- **Không cần dây USB**: Hỗ trợ ghép nối **Gỡ lỗi không dây (Wireless Debugging)** ngay trên giao diện web (hoặc chuyển từ USB sang Wi-Fi bằng 1 nút).
- **Độ trễ cực thấp (60–120 FPS)**: Dùng `scrcpy-server v5.0.1` nén H.264 phần cứng trực tiếp trên chip Samsung S26 + giải mã GPU trên ChromeOS bằng **WebCodecs (`VideoDecoder`)**, tắt Nagle TCP & tắt nén WebSocket.
- **Âm thanh trực tiếp (Opus + AudioWorklet)**: Truyền âm thanh từ điện thoại lên loa Chromebook đồng bộ độ trễ thấp.
- **Thao tác đầy đủ như Phone Link**:
  - Chạm, vuốt, cuộn mượt bằng touchpad/chuột Chromebook.
  - Giữ `Ctrl + kéo` để phóng to / thu nhỏ đa điểm (pinch-to-zoom).
  - Chuột phải = Back, Chuột giữa = Home.
  - Gõ bàn phím Chromebook thẳng vào điện thoại (**hỗ trợ gõ Tiếng Việt có dấu Telex/VNI**).
  - Đồng bộ Clipboard 2 chiều.
  - **Tắt màn hình OLED trên điện thoại** để tiết kiệm pin trong khi vẫn xem và điều khiển bình thường trên web.
- **Điều khiển bằng Lệnh + Macro + CLI**:
  - Khung **Console** ngay trên web hỗ trợ lệnh nhanh (`tap`, `swipe`, `text`, `key`, `app`, `screen off`) và mọi lệnh `adb shell`.
  - **Ghi Macro (Macro Recorder)**: Chạm/vuốt lên màn hình để tự sinh kịch bản, chạy lại 1 chạm hoặc copy ra bash script.
  - **CLI `./bin/phone-ctl` & REST API**: Khi web đang mở luồng, lệnh CLI bơm thẳng qua socket scrcpy với độ trễ **< 5ms** (nhanh hơn `adb shell input` gấp trăm lần).

---

## Cài đặt & Chạy trên Chromebook (Linux Crostini)

### Bước 1: Tải về & Cài đặt (chỉ cần chạy 1 lần)
Mở ứng dụng **Terminal (Linux)** trên Chromebook và chạy:

```bash
git clone https://github.com/lelinh1041999-sudo/linkbridge-android-web.git
cd linkbridge-android-web
chmod +x setup.sh start.sh bin/phone-ctl
./setup.sh
```

### Bước 2: Khởi động
```bash
./start.sh
```

Sau đó mở trình duyệt **Chrome** của Chromebook và truy cập:
**`http://localhost:3000`** *(ChromeOS tự động chuyển tiếp `localhost:3000` từ Linux Crostini ra Chrome).*

---

## Cách kết nối Samsung Galaxy S26 không cần dây USB

> Đảm bảo Chromebook và Samsung S26 đang nối chung một mạng Wi-Fi.

1. Trên **Samsung S26**, vào **Cài đặt → Thông tin điện thoại → Thông tin phần mềm**, chạm **7 lần** vào **Số hiệu bản tạo (Build number)** để bật *Tùy chọn nhà phát triển*.
2. Quay ra **Cài đặt → Tùy chọn nhà phát triển → Gỡ lỗi không dây (Wireless debugging)** và bật lên.
3. Trên giao diện web `http://localhost:3000`, bấm nút **Kết nối Wi-Fi**.
4. Trên Samsung S26, bấm **Ghép nối thiết bị bằng mã ghép nối** → nhập **IP:Port ghép nối** và **Mã 6 chữ số** vào mục **1. Ghép nối** trên web.
5. Nhập **IP:Port chính** (hiện ở ngoài màn hình *Gỡ lỗi không dây*) vào mục **2. Kết nối ngay** → Màn hình S26 sẽ hiện lên ngay lập tức!

---

## Điều khiển từ Terminal Crostini (`./bin/phone-ctl`)

```bash
# Chạm tọa độ (x, y) — độ trễ < 5ms khi đang mở web
./bin/phone-ctl tap 540 1200

# Vuốt từ dưới lên trên
./bin/phone-ctl swipe 540 1800 540 500 250

# Nhập chữ Tiếng Việt có dấu
./bin/phone-ctl text "Xin chào từ Chromebook!"

# Bấm phím cứng / điều hướng
./bin/phone-ctl key HOME
./bin/phone-ctl key BACK
./bin/phone-ctl key POWER

# Tắt / Bật màn hình OLED vật lý trên điện thoại
./bin/phone-ctl screen off
./bin/phone-ctl screen on

# Mở ứng dụng
./bin/phone-ctl app com.android.chrome

# Chụp ảnh màn hình chất lượng gốc
./bin/phone-ctl screenshot s26.png

# Chạy lệnh adb shell bất kỳ
./bin/phone-ctl shell "dumpsys battery"
```
