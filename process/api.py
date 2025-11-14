"""
Python API Service - Xử lý video similarity search
"""
import os
import platform
import traceback
from flask import Flask, request, jsonify
from flask_cors import CORS

# Fix các cảnh báo thread từ OpenMP/NumPy
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("OMP_NUM_THREADS", "1")

# Import các modules
import config
from search_video import VideoSearcher
from extract_features import VideoFeatureExtractor
from verify_video import VideoVerifier
import time
import glob
import shutil
import threading


app = Flask(__name__)
CORS(app)

# ======================================================
# ⚙️ Global instances (lazy load)
# ======================================================
searcher = None
extractor = None
verifier = None
index_mtime = None
metadata_mtime = None
_ingest_thread_started = False


def _reload_searcher():
    """Reload VideoSearcher and capture index/metadata mtimes."""
    global searcher, index_mtime, metadata_mtime
    searcher = VideoSearcher()
    index_mtime = os.path.getmtime(config.FEATURES_FILE) if os.path.exists(config.FEATURES_FILE) else None
    metadata_mtime = os.path.getmtime(config.METADATA_FILE) if os.path.exists(config.METADATA_FILE) else None
    return searcher


def get_searcher():
    global searcher, index_mtime, metadata_mtime
    current_index_mtime = os.path.getmtime(config.FEATURES_FILE) if os.path.exists(config.FEATURES_FILE) else None
    current_metadata_mtime = os.path.getmtime(config.METADATA_FILE) if os.path.exists(config.METADATA_FILE) else None
    if searcher is None or index_mtime != current_index_mtime or metadata_mtime != current_metadata_mtime:
        return _reload_searcher()
    return searcher


def get_extractor():
    global extractor
    if extractor is None:
        extractor = VideoFeatureExtractor()
    return extractor


def get_verifier():
    global verifier
    if verifier is None:
        verifier = VideoVerifier()
    return verifier


# ======================================================
# 🧰 Hàm tiện ích
# ======================================================
def normalize_video_path(video_path: str) -> str:
    """
    Chuyển đổi đường dẫn video theo môi trường hiện tại.
    Giúp client có thể gửi path từ Windows hoặc Docker mà không lỗi.
    """
    if not video_path:
        return video_path

    is_docker = os.path.exists("/.dockerenv") or os.path.isdir("/data")
    is_windows = platform.system() == "Windows"

    # Nếu chạy trong Docker mà nhận path Windows -> chuyển sang Docker
    if is_docker and ":" in video_path:
        video_path = video_path.replace(config.WINDOWS_DATA_DIR, config.DOCKER_DATA_DIR).replace("\\", "/")

    # Nếu chạy trên Windows mà nhận path Docker -> chuyển sang Windows
    elif is_windows and video_path.startswith(config.DOCKER_DATA_DIR):
        video_path = video_path.replace(config.DOCKER_DATA_DIR, config.WINDOWS_DATA_DIR)

    return video_path


# ======================================================
# 💓 Health Check
# ======================================================
@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'ok': True,
        'service': 'python-processor',
        'data_dir': config.DATA_DIR,
        'vector_folder': config.VECTOR_FOLDER,
        'env': platform.system(),
        'index_mtime': os.path.getmtime(config.FEATURES_FILE) if os.path.exists(config.FEATURES_FILE) else None,
        'metadata_mtime': os.path.getmtime(config.METADATA_FILE) if os.path.exists(config.METADATA_FILE) else None
    })


# ======================================================
# 🔍 Search API
# ======================================================
@app.route('/search', methods=['POST'])
def search():
    """Tìm kiếm video tương đồng"""
    try:
        data = request.get_json()
        video_path = data.get('video_path')

        if not video_path:
            return jsonify({'error': 'Missing video_path'}), 400

        # 🔧 Chuẩn hóa đường dẫn theo môi trường
        video_path = normalize_video_path(video_path)

        if not os.path.exists(video_path):
            return jsonify({'error': f'Video not found: {video_path}'}), 404

        if not os.path.isfile(video_path):
            return jsonify({'error': f'Path is not a valid file: {video_path}'}), 404

        # Gọi search
        searcher = get_searcher()
        results = searcher.search(video_path, top_k=config.TOP_K)

        # Format kết quả trả về và chuẩn hóa đường dẫn theo môi trường hiện tại
        formatted_results = []
        for r in results:
            video_path = r.get('video_path', '')
            # Chuẩn hóa đường dẫn từ metadata theo môi trường hiện tại
            normalized_path = normalize_video_path(video_path)
            formatted_results.append({
                'rank': r.get('rank', 0),
                'video_name': r.get('video_name', 'Unknown'),
                'similarity': float(r.get('similarity', 0)),
                'video_path': normalized_path
            })

        return jsonify(formatted_results)

    except Exception as e:
        print(f'[SEARCH ERROR] {str(e)}')
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ======================================================
# 🧠 Extract API
# ======================================================
@app.route('/extract', methods=['POST'])
def extract():
    """Trích xuất features từ video folder"""
    try:
        from extract_features import save_features

        # Cho phép body chỉ định mode và folder
        data = request.get_json(silent=True) or {}
        mode = data.get('mode', 'create')
        video_folder = data.get('video_folder') or config.VIDEO_FOLDER

        extractor = get_extractor()
        features_list, metadata_list = extractor.process_video_folder(
            video_folder,
            use_parallel=True,
            n_jobs=config.N_JOBS
        )
        save_features(features_list, metadata_list, mode=mode)

        # Reload searcher sau update
        _reload_searcher()

        return jsonify({
            'success': True,
            'message': 'Extraction completed',
            'features_file': config.FEATURES_FILE,
            'metadata_file': config.METADATA_FILE,
            'mode': mode,
            'video_folder': video_folder,
            'total_videos': len(metadata_list)
        })

    except Exception as e:
        print(f'[EXTRACT ERROR] {str(e)}')
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ======================================================
# 🔄 Refresh Searcher
# ======================================================
@app.route('/refresh-searcher', methods=['POST'])
def refresh_searcher():
    """Force reload of VideoSearcher (after vector updates)."""
    try:
        s = _reload_searcher()
        return jsonify({
            'success': True,
            'message': 'Searcher reloaded',
            'index_file': config.FEATURES_FILE,
            'metadata_file': config.METADATA_FILE,
            'metadata_count': len(getattr(s, 'metadata', []))
        })
    except Exception as e:
        print(f'[REFRESH ERROR] {str(e)}')
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ======================================================
# 📦 Batch Ingest Worker (background loop)
# ======================================================
VIDEO_EXTS = ("*.mov", "*.mp4", "*.avi", "*.mkv", "*.webm")


def _ensure_dirs():
    for d in [config.SAVE_FOLDER, config.TEMP_FOLDER, config.VIDEO_FOLDER, config.VECTOR_FOLDER]:
        os.makedirs(d, exist_ok=True)


def _list_videos(folder: str):
    files = []
    for ext in VIDEO_EXTS:
        files.extend(glob.glob(os.path.join(folder, ext)))
    return files


def _move_all(src: str, dst: str):
    os.makedirs(dst, exist_ok=True)
    moved = []
    for path in _list_videos(src):
        try:
            base = os.path.basename(path)
            target = os.path.join(dst, base)
            if os.path.exists(target):
                name, ext = os.path.splitext(base)
                i = 1
                while True:
                    candidate = os.path.join(dst, f"{name}_{i}{ext}")
                    if not os.path.exists(candidate):
                        target = candidate
                        break
                    i += 1
            shutil.move(path, target)
            moved.append(target)
        except Exception as e:
            print(f"[MOVE ERROR] {path} → {dst} : {e}")
            continue
    return moved


def _run_ingest_cycle():
    print("\n=== [INGEST] Cycle Start ===")
    _ensure_dirs()

    # 1) SAVE → TEMP
    moved_to_temp = _move_all(config.SAVE_FOLDER, config.TEMP_FOLDER)
    print(f"[INGEST] Moved to temp: {len(moved_to_temp)} files")

    # 2) Update vectors from TEMP
    extractor = get_extractor()
    features_list, metadata_list = extractor.process_video_folder(
        config.TEMP_FOLDER,
        use_parallel=True,
        n_jobs=config.N_JOBS
    )
    if features_list:
        from extract_features import save_features
        save_features(features_list, metadata_list, mode="update")
        print(f"[INGEST] Updated vectors: +{len(features_list)}")
        _reload_searcher()
    else:
        print("[INGEST] No new features to update")

    # 3) TEMP → VIDEO
    moved_to_video = _move_all(config.TEMP_FOLDER, config.VIDEO_FOLDER)
    print(f"[INGEST] Moved to video: {len(moved_to_video)} files")
    print("=== [INGEST] Cycle End ===\n")


def _ingest_worker_loop():
    while True:
        try:
            _run_ingest_cycle()
        except Exception as e:
            print(f"[INGEST] Cycle error: {e}")
            traceback.print_exc()
        # Nghỉ 3 phút sau mỗi vòng xử lý
        time.sleep(180)


def _start_ingest_worker():
    global _ingest_thread_started
    if _ingest_thread_started:
        return
    _ingest_thread_started = True
    t = threading.Thread(target=_ingest_worker_loop, name="ingest-worker", daemon=True)
    t.start()


# ======================================================
# ✅ Verify API
# ======================================================
@app.route('/verify', methods=['POST'])
def verify():
    """Verify video similarity"""
    try:
        data = request.get_json()
        video_path = data.get('video_path')

        if not video_path:
            return jsonify({'error': 'Missing video_path'}), 400

        # 🔧 Chuẩn hóa đường dẫn theo môi trường
        video_path = normalize_video_path(video_path)

        if not os.path.exists(video_path):
            return jsonify({'error': f'Video not found: {video_path}'}), 404

        verifier = get_verifier()
        result = verifier.verify(video_path)

        return jsonify({
            'similarity': float(result.get('similarity', 0)),
            'video_path': video_path
        })

    except Exception as e:
        print(f'[VERIFY ERROR] {str(e)}')
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ======================================================
# 🚀 Main entry
# ======================================================
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5051))
    host = os.environ.get('HOST', '0.0.0.0')
    print(f"Starting Python API service on {host}:{port}")
    print(f"Using DATA_DIR: {config.DATA_DIR}")
    # Khởi động ingest worker nền: xử lý rồi nghỉ 5 phút, lặp lại
    _start_ingest_worker()
    app.run(host=host, port=port, debug=False)
