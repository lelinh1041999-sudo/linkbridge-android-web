# LinhBridge — Điều khiển Samsung Galaxy S26 siêu mượt qua Web (PWA · WebUSB · Wi-Fi)

Mở trực tiếp trên Chrome (không cần cài gì):
**👉 https://lelinh1041999-sudo.github.io/linkbridge-android-web/**

Ứng dụng web PWA điều khiển màn hình **Samsung Galaxy S26 & Android** với độ trễ siêu thấp (~20–40ms, lên tới 120 FPS), dùng **scrcpy-server v5.0.1** + giải mã GPU **WebCodecs**, hỗ trợ **2 chế độ linh hoạt**:

---

## Cách 1: Dùng ngay trên Web (100% không cần cài gì — qua cáp USB)
1. Mở trang web **https://lelinh1041999-sudo.github.io/linkbridge-android-web/** bằng Chrome trên Chromebook (hoặc Windows/macOS).
2. Bấm nút **Cài App** trên góc phải (nếu muốn ghim thành cửa sổ app riêng giống Phone Link).
3. Trên **Samsung S26**: bật **Tùy chọn nhà phát triển → Gỡ lỗi USB (USB debugging)**.
4. Cắm cáp USB vào Chromebook *(lưu ý: nếu ChromeOS hiện thông báo "Kết nối với Linux", hãy **bỏ qua / không bấm** để Chrome lấy quyền WebUSB trực tiếp)*.
5. Bấm **USB trực tiếp** trên web → chọn Samsung S26 → bấm **Cho phép (Allow)** trên điện thoại là điều khiển ngay!

---

## Cách 2: Cài thành App Chromebook + Điều khiển KHÔNG DÂY qua Wi-Fi
Trình duyệt Chrome chặn trang web ngoài internet tự quét Wi-Fi LAN vì bảo mật, nên để dùng **Wi-Fi không dây** mà không phải gõ lệnh mỗi lần mở máy, hãy cài dịch vụ nền + icon App **1 lần duy nhất** trên Linux Crostini:

```bash
git clone https://github.com/lelinh1041999-sudo/linkbridge-android-web.git
cd linkbridge-android-web
./install-app.sh
```

Sau khi chạy xong:
- Bridge Wi-Fi sẽ **tự chạy ngầm** mỗi khi Linux Crostini bật (không cần mở Terminal nữa).
- Biểu tượng **LinhBridge** xuất hiện ngay trong **App Launcher (Linux apps)** của Chromebook.
- Bạn có thể mở bằng icon App (`http://localhost:3000`) **HOẶC** mở ngay trang web **https://lelinh1041999-sudo.github.io/linkbridge-android-web/** — cả hai đều tự nhận Bridge Wi-Fi để điều khiển Samsung S26 không dây!

### Ghép nối Samsung S26 không dây (chỉ cần làm lần đầu)
1. Đảm bảo Chromebook và Samsung S26 chung mạng Wi-Fi.
2. Trên **Samsung S26**: vào **Cài đặt → Tùy chọn nhà phát triển → Gỡ lỗi không dây (Wireless debugging)** và bật lên.
3. Trên web, bấm nút **Wi-Fi** → trên S26 bấm **Ghép nối thiết bị bằng mã ghép nối** → nhập **IP:Port ghép nối** + **Mã 6 số** vào bước 1, rồi nhập **IP:Port chính** ở bước 2.

---

## Tính năng nổi bật
- **Siêu mượt 60–120 FPS**: Nén H.264 phần cứng trên S26 + giải mã GPU WebCodecs trên Chromebook, truyền âm thanh Opus độ trễ thấp.
- **Thao tác như Phone Link**: Chạm, vuốt, cuộn touchpad, `Ctrl + kéo` để zoom 2 ngón, chuột phải = Back, gõ **Tiếng Việt Telex/VNI**, đồng bộ Clipboard 2 chiều, **tắt màn hình OLED vật lý trên S26** khi đang điều khiển.
- **Lệnh Console + Ghi Macro + CLI**:
  - Chạy lệnh nhanh (`tap`, `swipe`, `text`, `key`, `app`, `screen off`) hoặc mọi lệnh `adb shell` ngay trên web (hoạt động trên cả **WebUSB** lẫn **Wi-Fi**!).
  - **Ghi Macro**: Chạm/vuốt trên màn hình để tự sinh kịch bản và chạy lại tự động.
  - **CLI Crostini (`phone-ctl`)**:
    ```bash
    phone-ctl tap 540 1200
    phone-ctl swipe 540 1800 540 500 250
    phone-ctl text "Xin chào từ Chromebook!"
    phone-ctl key HOME
    phone-ctl screen off
    phone-ctl screenshot s26.png
    phone-ctl shell "dumpsys battery"
    ```

Gỡ bỏ dịch vụ nền & icon bất cứ lúc nào: `./uninstall-app.sh`.
