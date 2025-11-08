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

