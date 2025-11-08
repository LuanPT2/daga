"""
Cấu hình cho hệ thống phát hiện video tương đồng
"""
import os

# Đường dẫn - chỉ dùng environment variable cho Docker
DATA_DIR = os.environ.get('DATA_DIR', '/data/daga/1daga')
VIDEO_FOLDER = os.path.join(DATA_DIR, '2video')
VECTOR_FOLDER = os.path.join(DATA_DIR, '3vertor')
FEATURES_FILE = os.path.join(VECTOR_FOLDER, "video_features.faiss")
METADATA_FILE = os.path.join(VECTOR_FOLDER, "video_metadata.pkl")

# Tham số trích xuất
START_TIME = 5  # Bắt đầu từ giây thứ 5
END_TIME = 35  # Kết thúc ở giây thứ 35
SAMPLE_RATE = 0.5  # Lấy mẫu mỗi 0.5 giây
VERIFY_RATE = 0.1  # Lấy mẫu mỗi 0.1 giây
MAX_FRAMES = int((END_TIME - START_TIME) / SAMPLE_RATE)  # 60 khung hình

# Model
CLIP_MODEL_NAME = "openai/clip-vit-base-patch32"

# Trọng số cho tìm kiếm
IMAGE_WEIGHT = 1.0  # 100% hình ảnh (không dùng âm thanh)

# Kết quả
TOP_K = 5  # Số video tương đồng nhất trả về

# Song song hóa
N_JOBS = 2  # Số luồng xử lý (-1 = tất cả cores, 1 = tuần tự)

# Tự động tạo folder vector nếu chưa có
os.makedirs(VECTOR_FOLDER, exist_ok=True)

