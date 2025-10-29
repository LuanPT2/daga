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


```
CREATE DATABASE `daga` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci */ /*!80016 DEFAULT ENCRYPTION='N'*/;
-- daga.search_requests definition

CREATE TABLE `search_requests` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `query_path` text NOT NULL,
  `status` enum('pending','processing','completed','failed') DEFAULT 'pending',
  `request_id` varchar(36) NOT NULL,
  `error` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `request_id` (`request_id`),
  KEY `idx_status` (`status`),
  KEY `idx_request_id` (`request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- daga.search_results definition

CREATE TABLE `search_results` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `request_id` bigint NOT NULL,
  `rank_no` int NOT NULL,
  `video_name` varchar(255) DEFAULT NULL,
  `similarity` decimal(6,2) DEFAULT NULL,
  `video_path` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_request_id` (`request_id`),
  CONSTRAINT `search_results_ibfk_1` FOREIGN KEY (`request_id`) REFERENCES `search_requests` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```