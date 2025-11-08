# Backend - Video Similarity Search API

Backend service cho hệ thống tìm kiếm video tương tự. **Web server (Node.js) và Python processing đã được tách riêng thành 2 services độc lập.**

## 📋 Yêu cầu

- Docker >= 20.10
- Docker Compose >= 2.0
- RAM: Tối thiểu 4GB (khuyến nghị 8GB+)
- MySQL đang chạy trên host


## 🚀 Cách chạy

**Bước 1: Build cả 2 services**
```bash
cd web/backend
docker-compose build
```
*Chỉ cần build 1 lần, hoặc khi thay đổi `package.json` (backend)*

**Lưu ý:** Python service (`process/`) build riêng, xem `process/README.md` để rebuild Python service.

**Bước 2: Chạy cả 2 services**
```bash
docker-compose up -d
```

**Bước 3: Xem logs**
```bash
# Xem tất cả
docker-compose logs -f

# Chỉ backend
docker-compose logs -f backend

```

**Khi sửa code:**
```bash
# Chỉ cần restart, KHÔNG cần rebuild
docker-compose restart
```

**Lưu ý:**
- ✅ Code được mount trực tiếp → sửa code không cần rebuild
- ✅ Backend chỉ rebuild khi đổi `package.json`
- ✅ Python service build riêng → xem `process/README.md` để rebuild Python service

### Data Directory

Thư mục dữ liệu: `/data/daga/1daga`

```
/data/daga/1daga/
├── 1temp/              # Temporary files
├── 2video/             # Video đầu vào
├── 3vertor/            # Vector database (FAISS)
├── 4uploads/           # Uploaded videos
├── 5video-livestream/  # Livestream videos
└── 6video_cut/         # Template videos
```

**Tạo thư mục:**
```bash
sudo mkdir -p /data/daga/1daga/{1temp,2video,3vertor,4uploads,5video-livestream,6video_cut}
sudo chmod -R 755 /data/daga/1daga
```

## 🗄️ Vector Database

Trước khi sử dụng search, cần tạo vector database:

```bash
# Gọi API từ backend
curl -X POST http://localhost:5050/update-db

# Hoặc gọi trực tiếp Python service
curl -X POST http://localhost:5051/extract
```

**Lưu ý:**
- Đọc video từ `/data/daga/1daga/2video/`
- Lưu vào `/data/daga/1daga/3vertor/video_features.faiss`
- Mất 50-60 phút cho 1000 video (CPU) hoặc 5-10 phút (GPU)

## 📡 API Endpoints

### Swagger UI Documentation

**URL Swagger UI:**
- **Local:** http://localhost:5050/api-docs
- **Docker:** http://localhost:5050/api-docs
- **Network:** http://192.168.132.134:5050/api-docs (nếu truy cập từ máy khác)

**Tính năng:**
- 📖 Tài liệu API đầy đủ
- 🧪 Test API trực tiếp từ browser
- 📋 Schema definitions
- 💡 Request/Response examples
- 🔍 Tìm kiếm endpoints

### Backend (Port 5050)
- `GET /` - Root endpoint
- `GET /health` - Health check (kiểm tra cả Python service)
- `POST /search` - Tìm kiếm video (upload file hoặc `{"path": "..."}`)
- `GET /search/result/:requestId` - Lấy kết quả
- `POST /save-video` - Lưu livestream video
- `POST /save-video-auto` - Lưu auto-match video
- `GET /video?path=...` - Stream video
- `POST /verify/start` - Verify video
- `GET /verify/status/:id` - Status verify
- `GET /search/latest` - Kết quả gần nhất
- `POST /update-db` - Update vector database (gọi Python service)
- `DELETE /reset` - Reset database

**Lưu ý:** Python service chạy riêng trên host (port 5051), xem `process/README.md` để chạy Python service.

Xem chi tiết trong `server.js` hoặc Swagger UI tại `/api-docs`
