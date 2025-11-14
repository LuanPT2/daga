# Hướng dẫn chạy Python API (api.py)

Tài liệu này hướng dẫn bạn chạy dịch vụ Flask API cho xử lý tìm kiếm video trên Windows và Docker.

## Tổng quan API
- `GET /health` — Kiểm tra tình trạng dịch vụ
- `POST /search` — Tìm kiếm tương đồng cho một video file
- `POST /extract` — Trích xuất đặc trưng và xây dựng index FAISS
- `POST /verify` — Kiểm tra tương đồng cho một video đơn lẻ

Lưu ý: `POST /search` nhận `video_path` là đường dẫn đến file video.

---

## Chạy trên Windows

### 1) Cài đặt môi trường
- Cài `Python 3.8+`
- Cài phụ thuộc: mở PowerShell trong thư mục `process`
  ```powershell
  cd D:\2workspace\1daga\process
  pip install -r requirements.txt
  ```

### 2) Cấu hình đường dẫn dữ liệu
- Mặc định Windows dùng `DATA_DIR = D:/3data/1daga` trong `config.py`
- Có thể override cho phiên làm việc hiện tại:
  ```powershell
  $env:DATA_DIR = "D:/3data/1daga"
  ```

Thư mục dữ liệu chuẩn:
```
D:/3data/1daga/
  ├── 2video/            # Thư mục chứa video nguồn
  └── 3vertor/           # Thư mục chứa index và metadata sau khi trích xuất
```

### 3) Chạy API
```powershell
# Tùy chọn: cấu hình cổng
$env:PORT = "5051"   # mặc định 5051
$env:HOST = "0.0.0.0" # để nghe tất cả interfaces

python .\api.py
```

Khi chạy thành công, bạn sẽ thấy log: `Starting Python API service on 0.0.0.0:5051`.

### 4) Kiểm tra API (PowerShell)
- Health:
  ```powershell
  Invoke-RestMethod -Method GET -Uri http://localhost:5051/health
  ```
- Search theo file:
  ```powershell
  $body = @{ video_path = "D:/3data/1daga/2video/video001_002_.mov" } | ConvertTo-Json
  Invoke-RestMethod -Method POST -Uri http://localhost:5051/search -Body $body -ContentType "application/json"
  ```

### 5) Trích xuất đặc trưng (bắt buộc trước khi search)
Nếu gặp lỗi `Không tìm thấy index file`, hãy trích xuất đặc trưng để tạo index:
```powershell
$env:DATA_DIR = "D:/3data/1daga"
python .\extract_features.py
```
Sau đó thử lại `POST /search`.

---

## Chạy bằng Docker

### 1) Chuẩn bị dữ liệu trên máy host
Đảm bảo dữ liệu nằm trong `D:/3data/1daga` với cấu trúc như phần Windows.

### 2) Dùng Docker Compose (khuyên dùng)
Trong thư mục `process`:
```powershell
cd D:\2workspace\1daga\process
docker-compose up -d --build
```

Mặc định Compose sẽ:
- Bind mount `D:/3data/1daga` vào `/data/daga/1daga` trong container
- Set `DATA_DIR=/data/daga/1daga`
- Expose cổng `5051`

Kiểm tra:
```powershell
Invoke-RestMethod -Method GET -Uri http://localhost:5051/health
```

Search theo file trong container (đường dẫn Linux):
```powershell
$body = @{ video_path = "/data/daga/1daga/2video/video001_002_.mov" } | ConvertTo-Json
Invoke-RestMethod -Method POST -Uri http://localhost:5051/search -Body $body -ContentType "application/json"
```

### 3) Chạy trực tiếp bằng Docker CLI (không dùng compose)
```powershell
cd D:\2workspace\1daga\process
docker build -t python-processor .
docker run --rm -p 5051:5051 \` 
  -e DATA_DIR=/data/daga/1daga \` 
  -v D:/3data/1daga:/data/daga/1daga \` 
  python-processor
```

Sau khi chạy, test `GET /health` và các lệnh `POST /search` như trên.


## Ghi chú
- `POST /search` chỉ hỗ trợ đường dẫn file video.
- Cấu hình `DATA_DIR` có thể override bằng biến môi trường:
  - Windows: `$env:DATA_DIR = "D:/3data/1daga"`
  - Docker: `DATA_DIR=/data/daga/1daga`
- Hiệu năng phụ thuộc vào GPU/CPU và số lượng video trong dataset.



python -m venv venv312
.\venv312\Scripts\Activate.ps1
python -m pip install --upgrade pip
cd process
pip install -r requirements.txt