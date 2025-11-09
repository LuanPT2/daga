"""
Cấu hình cho hệ thống phát hiện video tương đồng
"""
import os
import platform

# ======================================================
# 🌍 1. Định nghĩa sẵn hai môi trường cố định
# ======================================================
WINDOWS_DATA_DIR = "D:/3data/1daga"
DOCKER_DATA_DIR = "/data/daga/1daga"

# ======================================================
# ⚙️ 2. Tự động chọn DATA_DIR theo môi trường
# ======================================================
def detect_data_dir():
    # Ưu tiên nếu có environment variable được set sẵn
    env_path = os.environ.get("DATA_DIR")
    if env_path:
        return env_path

    # Phát hiện môi trường
    is_docker = os.path.exists("/.dockerenv") or os.path.isdir("/data")
    is_windows = platform.system() == "Windows"

    if is_docker:
        return DOCKER_DATA_DIR
    elif is_windows:
        return WINDOWS_DATA_DIR
    else:
        # Mặc định cho Linux hoặc Mac local
        return "/home/user/data/daga/1daga"


# ======================================================
# 📂 3. Các đường dẫn chính
# ======================================================
DATA_DIR = detect_data_dir()
VIDEO_FOLDER = os.path.join(DATA_DIR, "2video")
VECTOR_FOLDER = os.path.join(DATA_DIR, "3vertor")

FEATURES_FILE = os.path.join(VECTOR_FOLDER, "video_features.faiss")
METADATA_FILE = os.path.join(VECTOR_FOLDER, "video_metadata.pkl")

# ======================================================
# 🎞️ 4. Tham số trích xuất
# ======================================================
START_TIME = 5        # Bắt đầu từ giây thứ 5
END_TIME = 35         # Kết thúc ở giây thứ 35
SAMPLE_RATE = 0.5     # Lấy mẫu mỗi 0.5 giây
VERIFY_RATE = 0.1     # Lấy mẫu mỗi 0.1 giây
MAX_FRAMES = int((END_TIME - START_TIME) / SAMPLE_RATE)  # 60 khung hình

# ======================================================
# 🧠 5. Model & Tìm kiếm
# ======================================================
CLIP_MODEL_NAME = "openai/clip-vit-base-patch32"
IMAGE_WEIGHT = 1.0   # 100% hình ảnh (không dùng âm thanh)
TOP_K = 5            # Số video tương đồng nhất trả về

# ======================================================
# ⚡ 6. Song song hóa
# ======================================================
N_JOBS = 2  # (-1 = tất cả cores, 1 = tuần tự)

# ======================================================
# 🗂️ 7. Khởi tạo thư mục nếu chưa tồn tại
# ======================================================
os.makedirs(VECTOR_FOLDER, exist_ok=True)

# ======================================================
# 🧾 8. Log thông tin cấu hình
# ======================================================
print(f"[CONFIG] Detected environment: {'Docker' if os.path.exists('/.dockerenv') else platform.system()}")
print(f"[CONFIG] DATA_DIR = {DATA_DIR}")
print(f"[CONFIG] WINDOWS_DATA_DIR = {WINDOWS_DATA_DIR}")
print(f"[CONFIG] DOCKER_DATA_DIR = {DOCKER_DATA_DIR}")
