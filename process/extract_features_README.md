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

### Chạy Extract Features

Có 2 cách để chạy extract features:

#### Cách 1: Chạy qua API endpoint
```bash
# Gọi API để trích xuất features từ thư mục video
curl -X POST http://localhost:5051/extract \
  -H "Content-Type: application/json" \
  -d '{}'
```

#### Cách 2: Chạy trực tiếp trong container
```bash
# Vào container
docker exec -it python-processor bash

# Chạy extract_features.py trực tiếp
cd /app
python extract_features.py

# Hoặc chạy với các tham số tùy chỉnh
python extract_features.py --video_folder /data/daga/1daga/2video --output /data/daga/1daga/3vertor
```

### Kiểm tra kết quả
```bash
# Kiểm tra xem features đã được tạo chưa
ls -la /data/daga/1daga/3vertor/

# Kiểm tra logs của service
docker-compose logs python-processor
```

### Lưu ý quan trọng
- Đảm bảo thư mục `/data/daga/1daga/2video` chứa các file video cần xử lý
- Features sẽ được lưu vào `/data/daga/1daga/3vertor/video_features.faiss` và `/data/daga/1daga/3vertor/video_metadata.pkl`
- Quá trình extract có thể mất vài phút tùy thuộc vào số lượng video

## 🔄 Quản lý Features

### Tạo Features mới
```bash
# Xóa features cũ (nếu cần)
rm -f /data/daga/1daga/3vertor/video_features.faiss
rm -f /data/daga/1daga/3vertor/video_metadata.pkl

# Chạy extract features mới
curl -X POST http://localhost:5051/extract \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Cập nhật Features (Thêm video mới)
```bash
# Copy video mới vào thư mục
cp /path/to/new_videos/* /data/daga/1daga/2video/

# Chạy extract lại để cập nhật features
curl -X POST http://localhost:5051/extract \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Xóa Features
```bash
# Vào container
docker exec -it python-processor bash

# Xóa file features
cd /data/daga/1daga/3vertor
rm -f video_features.faiss video_metadata.pkl

# Hoặc xóa toàn bộ thư mục vector
rm -rf /data/daga/1daga/3vertor/*
```

### Kiểm tra trạng thái Features
```bash
# Kiểm tra kích thước file features
ls -lh /data/daga/1daga/3vertor/

# Kiểm tra số lượng video đã xử lý
python -c "
import pickle
import config
try:
    with open(config.METADATA_FILE, 'rb') as f:
        metadata = pickle.load(f)
    print(f'Tổng số video: {len(metadata)}')
except FileNotFoundError:
    print('Chưa có features nào được tạo')
"
```



# 📋 Hướng dẫn chạy Application

## 🔧 Cấu hình biến môi trường trong config.py

### 1. Mở file config.py
```bash
# Trên Windows
notepad D:\2workspace\1daga\process\config.py

# Trên Linux/Mac
nano /path/to/1daga/process/config.py
```

### 2. Sửa biến DATA_DIR
Trong file `config.py`, tìm dòng:
```python
DATA_DIR = os.environ.get('DATA_DIR', '/data/daga/1daga')
```

#### Tùy chọn A: Chạy trên Docker (giữ nguyên)
```python
DATA_DIR = os.environ.get('DATA_DIR', '/data/daga/1daga')
```

#### Tùy chọn B: Chạy trực tiếp trên Windows
```python
# Sửa thành đường dẫn Windows
DATA_DIR = os.environ.get('DATA_DIR', 'D:/3data/1daga')
# Hoặc đường dẫn tương đối
DATA_DIR = os.environ.get('DATA_DIR', './data')
```

#### Tùy chọn C: Chạy trực tiếp trên Linux/Mac
```python
DATA_DIR = os.environ.get('DATA_DIR', '/home/user/1daga_data')
```

### 3. Tạo thư mục data
```bash
# Trên Windows
mkdir D:\3data\1daga\2video
mkdir D:\3data\1daga\3vertor

# Trên Linux/Mac
mkdir -p /home/user/1daga_data/2video
mkdir -p /home/user/1daga_data/3vertor
```

## 🐳 Chạy trên Docker

### 1. Chuẩn bị
```bash
cd D:\2workspace\1daga\process
```

### 2. Build và chạy
```bash
# Build Docker image
docker-compose build

# Chạy service
docker-compose up -d

# Xem logs
docker-compose logs -f
```

### 3. Test API
```bash
# Health check
curl http://localhost:5051/health

# Extract features
curl -X POST http://localhost:5051/extract \
  -H "Content-Type: application/json" \
  -d '{}'

# Search video
curl -X POST http://localhost:5051/search \
  -H "Content-Type: application/json" \
  -d '{"video_path": "/data/daga/1daga/2video/sample.mp4"}'
```

### 4. Vào container để chạy trực tiếp
```bash
docker exec -it python-processor bash
cd /app
python extract_features.py
```

## 🪟 Chạy trực tiếp trên Windows

### 1. Cài đặt dependencies
```bash
cd D:\2workspace\1daga\process

# Tạo virtual environment (khuyến nghị)
python -m venv venv
venv\Scripts\activate

# Cài đặt requirements
pip install -r requirements.txt
```

### 2. Cấu hình biến môi trường
```bash
# Set biến môi trường tạm thời
set DATA_DIR=D:/3data/1daga
set PORT=5051
set HOST=0.0.0.0
```

### 3. Chạy application
```bash
# Chạy API server
python api.py

# Hoặc chạy extract features trực tiếp
python extract_features.py
```

### 4. Test trên Windows
```bash
# Mở trình duyệt
curl http://localhost:5051/health

# Trong PowerShell
Invoke-RestMethod -Uri "http://localhost:5051/health" -Method Get
```

## 🐧 Chạy trực tiếp trên Linux/Mac

### 1. Cài đặt dependencies
```bash
cd /path/to/1daga/process

# Tạo virtual environment
python3 -m venv venv
source venv/bin/activate

# Cài đặt requirements
pip install -r requirements.txt
```

### 2. Cấu hình biến môi trường
```bash
export DATA_DIR=/home/user/1daga_data
export PORT=5051
export HOST=0.0.0.0
```

### 3. Chạy application
```bash
# Chạy API server
python3 api.py

# Hoặc chạy extract features trực tiếp
python3 extract_features.py
```

## 📁 Cấu trúc thư mục chuẩn

```
1daga_data/
├── 2video/          # Chứa video đầu vào
├── 3vertor/         # Chứa features đã extract
│   ├── video_features.faiss
│   └── video_metadata.pkl
├── 4uploads/        # Upload files
└── 5video-livestream/ # Livestream data
```

## 🔍 Troubleshooting

### Lỗi thường gặp

1. **File not found error**
   - Kiểm tra đường dẫn trong `config.py`
   - Đảm bảo thư mục đã tồn tại

2. **Permission denied**
   - Trên Linux/Mac: `chmod 755 /path/to/data`
   - Trên Windows: Kiểm tra quyền thư mục

3. **Port already in use**
   - Đổi port trong `config.py` hoặc `docker-compose.yml`
   - Kill process đang dùng port: `netstat -ano | findstr :5051`

4. **Out of memory**
   - Giảm `N_JOBS` trong `config.py`
   - Giảm số lượng video xử lý cùng lúc

### Kiểm tra logs
```bash
# Docker
docker-compose logs -f

# Trực tiếp (Windows)
type *.log

# Trực tiếp (Linux/Mac)
tail -f *.log
```