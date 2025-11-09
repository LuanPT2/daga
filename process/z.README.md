## Hướng dẫn chạy hệ thống phát hiện video tương đồng

### Cấu trúc thư mục
```text
video_daga/
├── source/          # Code chương trình
├── video/           # Chứa video đầu vào
├── vector/          # Database vector (tự động tạo)
└── file/            # File phân tích
```

### Yêu cầu môi trường
- Python 3.8+
- GPU khuyến nghị (CPU vẫn chạy được)

## Bước 1: Cài đặt (chạy 1 lần)
Khuyến nghị dùng virtualenv để tránh xung đột thư viện.
```bash
python3 -m venv /Users/luanpt/Downloads/video_daga/.venv
source /Users/luanpt/Downloads/video_daga/.venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
python -m pip install -r /Users/luanpt/Downloads/video_daga/source/requirements.txt
```

## Bước 2: Trích xuất đặc trưng (chạy 1 lần)
Sinh database vector từ thư mục `video/`.
```bash
cd /Users/luanpt/Downloads/video_daga/source
python extract_features.py
```
- Đọc tất cả video trong `../video/`
- Lấy 60 khung hình/video (giây 5–35, mỗi 0.5s)
- Tạo vector đặc trưng bằng CLIP (512 chiều)
- Lưu: `../vector/video_features.faiss`, `../vector/video_metadata.pkl`
- Thời gian tham khảo: 50–60 phút cho 1000 video (CPU)

## Bước 3: Tìm kiếm video tương đồng (chạy nhiều lần)
### Cách 1: Menu
```bash
cd /Users/luanpt/Downloads/video_daga/source
python main.py
# Chọn 2) Tìm kiếm video tương đồng và nhập đường dẫn video
```

### Cách 2: Gọi trực tiếp
```bash
cd /Users/luanpt/Downloads/video_daga/source
python search_video.py ../visitdeo-livestream/video1-001-D.mov
```

Ví dụ với file có khoảng trắng trong tên:
```bash
python search_video.py "/Users/luanpt/Downloads/video_daga/visitdeo-livestream/Screen Recording 2025-10-28 at 10.23.19 PM.mov"
```

### Kết quả hiển thị (ví dụ)
```text
================================================================================
KẾT QUẢ TÌM KIẾM VIDEO TƯƠNG ĐỒNG
================================================================================

1. video1-001-D.mov
   Độ tương đồng: 95.23%
   Đường dẫn: ../video/video1-001-D.mov

2. video1-005-D.mov
   Độ tương đồng: 87.45%
   Đường dẫn: ../video/video1-005-D.mov
```

## Tùy chỉnh tham số (trong `source/config.py`)
```python
START_TIME = 5     # Giây bắt đầu lấy mẫu
END_TIME = 35      # Giây kết thúc
SAMPLE_RATE = 0.5  # Lấy mẫu mỗi 0.5 giây
TOP_K = 5          # Số video tương đồng trả về
```

## Gợi ý và lưu ý
- **Chạy Bước 2 trước**: phải có database vector mới tìm kiếm được.
- **Chạy Bước 2 một lần**: thêm video mới vào `video/` thì chạy lại `extract_features.py`.
- **Lần đầu** sẽ tải CLIP model (~600MB).
- **GPU** nhanh hơn CPU 5–10x.

## Xử lý lỗi thường gặp
- Kiểm tra đã cài thư viện: `pip install -r source/requirements.txt`.
- Kiểm tra định dạng video hỗ trợ: `.mov, .mp4, .avi, .mkv`.
- Kiểm tra dung lượng ổ đĩa cho thư mục `vector/`.

## Quick start (ngắn gọn)
```bash
cd /Users/luanpt/Downloads/video_daga/source
python extract_features.py             # chạy 1 lần để tạo database
python search_video.py ../video1.mov  
python search_video.py ../visitdeo-livestream/video1-001-D.mov  # chạy nhiều lần để tìm kiếm
```



```bash
cd /Users/luanpt/Downloads/video_daga
source .venv/bin/activate
cd source
python search_video.py ../video/video1-001-D.mov
```


Bạn xem lại với
khi bấm nút start record thì có 2 xử lý
1 là mỗi 15s lưu vào /Users/luanpt/Downloads/video_daga/visitdeo-livestream
2 là mỗi trận thì lưu vào đây /Users/luanpt/Downloads/video_daga/video
làm sao xác định được mỗi trận . vì mỗi trận có quảng cáo, tôi đã đưa các đoạn quảng cáo vào /Users/luanpt/Downloads/video_daga/video_cut 
chỉ cần kiểm tra giữ 2 lần quảng cáo alf biết hết 1 trận



python -m venv venv312
.\venv312\Scripts\Activate.ps1
python -m pip install --upgrade pip
cd process
pip install -r requirements.txt


# Python Processing Service

Service xử lý video similarity search sử dụng ML models (CLIP, FAISS).

## 📋 Yêu cầu

- Docker >= 20.10
- Docker Compose >= 2.0
- RAM: Tối thiểu 4GB (khuyến nghị 8GB+)
- GPU: Khuyến nghị (nhanh hơn 5-10x)

## 🚀 Cách chạy

### Development Mode

```bash
cd process

# Build lần đầu
docker-compose build

# Chạy service
docker-compose up -d

# Xem logs
docker-compose logs -f

# Sửa code → chỉ cần restart
docker-compose restart
```

### Production Mode

```bash
docker-compose up -d --build
```

## ⚙️ Cấu hình

### Environment Variables

- `PORT`: Port cho API (mặc định: 5051)
- `HOST`: Host để bind (mặc định: 0.0.0.0)
- `DATA_DIR`: Thư mục dữ liệu (mặc định: /data/daga/1daga)

### Data Directory

Service sử dụng `/data/daga/1daga`:
- `2video/` - Video đầu vào
- `3vertor/` - Vector database (FAISS)

## 📡 API Endpoints

- `GET /health` - Health check
- `POST /search` - Tìm kiếm video tương đồng
  ```json
  {
    "video_path": "/data/daga/1daga/5video-livestream/video.mp4"
  }
  ```
- `POST /extract` - Trích xuất features từ video folder
- `POST /verify` - Verify video similarity
  ```json
  {
    "video_path": "/data/daga/1daga/5video-livestream/video.mp4"
  }
  ```

## 🔍 Kiểm tra

```bash
# Health check
curl http://localhost:5051/health

# Test search
curl -X POST http://localhost:5051/search \
  -H "Content-Type: application/json" \
  -d '{"video_path": "/data/daga/1daga/5video-livestream/video.mp4"}'
```

## 📝 Notes

- Model CLIP được load khi service start (mất vài giây)
- Vector database phải có sẵn trong `3vertor/` trước khi search
- Build lần đầu mất ~10 phút (download packages)
- Build lại chỉ mất vài giây (BuildKit cache)

