# Hướng dẫn chạy Search Video trên Windows

## Yêu cầu
- Python 3.8+
- Các thư viện đã cài đặt (xem requirements.txt)

## Cách chạy

### 1. Mở Command Prompt (CMD) hoặc PowerShell
```
Win + R → gõ "cmd" → Enter
```

### 2. Di chuyển đến thư mục process
```
cd D:\2workspace\1daga\process
```

### 3. Chạy tìm kiếm video

#### Tìm kiếm 1 video:
```
python search_video.py D:/3data/1daga/2video/video001_002_.mov
```

#### Tìm kiếm nhiều video trong thư mục:
```
python search_video.py D:/3data/1daga/5video-livestream"
```

#### Xuất kết quả dạng JSON:
```
python search_video.py "D:\video_test.mp4" --json
```

## Ví dụ thực tế

### Tìm kiếm video trong thư mục test:
```
python search_video.py "D:/3data/1daga/5video-livestream/record_1762669063577.webm"
```

### Tìm kiếm toàn bộ thư mục:
```
python search_video.py "D:/3data/1daga/5video-livestream"
```

## Kết quả
Chương trình sẽ hiển thị:
- Tên video tương đồng
- Độ tương đồng (%) 
- Đường dẫn video

## Lỗi thường gặp

### "No module named..."
```
pip install -r requirements.txt
```

### "Video not found"
Kiểm tra lại đường dẫn video có tồn tại không

### "Cannot find index file"
Chạy `extract_features.py` trước để tạo database video

## Lưu ý
- Đảm bảo đã chạy `extract_features.py` để có database video
- Video test phải có định dạng: .mp4, .mov, .avi, .webm
- Kết quả tìm kiếm phụ thuộc vào chất lượng database đã xây dựng