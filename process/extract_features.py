"""
Trích xuất đặc trưng từ video và lưu vào vector database
"""
import os
# Avoid multiple OpenMP runtime initialization on macOS
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("OMP_NUM_THREADS", "1")
import cv2
import torch
import numpy as np
import faiss
import pickle
import glob
from tqdm import tqdm
from PIL import Image
from transformers import CLIPProcessor, CLIPModel
from joblib import Parallel, delayed
import config
import platform


def normalize_video_path_for_metadata(video_path: str) -> str:
    if not video_path:
        return video_path
    
    if ":" in video_path and platform.system() != "Windows":
        if video_path.startswith("D:/"):
            relative_path = video_path[3:]
            return "/data/" + relative_path
        elif video_path.startswith("D:"):
            relative_path = video_path[2:]
            return "/data/" + relative_path
    
    return video_path


def _create_model():
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = CLIPModel.from_pretrained(config.CLIP_MODEL_NAME).to(device)
    processor = CLIPProcessor.from_pretrained(config.CLIP_MODEL_NAME, use_fast=True)
    model.eval()
    return model, processor, device


def _extract_from_video_single(video_path):
    try:
        model, processor, device = _create_model()
        video_name = os.path.basename(video_path)
        
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return None
        
        fps = cap.get(cv2.CAP_PROP_FPS)
        frames = []
        time_points = np.arange(config.START_TIME, config.END_TIME, config.SAMPLE_RATE)
        
        for time_point in time_points:
            frame_number = int(time_point * fps)
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
            ret, frame = cap.read()
            if ret:
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                pil_image = Image.fromarray(frame_rgb)
                frames.append(pil_image)
        cap.release()
        
        if not frames:
            return None
        
        inputs = processor(images=frames, return_tensors="pt", padding=True)
        inputs = {k: v.to(device) for k, v in inputs.items()}
        
        with torch.no_grad():
            image_features = model.get_image_features(**inputs)
            image_features = image_features / image_features.norm(p=2, dim=-1, keepdim=True)
            feature_vector = image_features.mean(dim=0).cpu().numpy()
            norm = np.linalg.norm(feature_vector)
            if norm > 0:
                feature_vector = feature_vector / norm
        
        metadata = {'video_name': video_name, 'video_path': normalize_video_path_for_metadata(video_path)}
        return (feature_vector, metadata)
    
    except Exception as e:
        print(f"Lỗi xử lý {video_path}: {e}")
        return None


class VideoFeatureExtractor:
    def __init__(self):
        print("Đang load CLIP model...")
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = CLIPModel.from_pretrained(config.CLIP_MODEL_NAME).to(self.device)
        self.processor = CLIPProcessor.from_pretrained(config.CLIP_MODEL_NAME, use_fast=True)
        self.model.eval()
        print(f"Model đã load trên {self.device}")

    def extract_frames(self, video_path, start_time=5, end_time=35, sample_rate=0.5):
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return []

        fps = cap.get(cv2.CAP_PROP_FPS)
        frames = []
        time_points = np.arange(start_time, end_time, sample_rate)
        
        for time_point in time_points:
            frame_number = int(time_point * fps)
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
            ret, frame = cap.read()
            
            if ret:
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                pil_image = Image.fromarray(frame_rgb)
                frames.append(pil_image)
        
        cap.release()
        return frames

    def extract_features_from_frames(self, frames):
        if not frames:
            return None
        
        inputs = self.processor(images=frames, return_tensors="pt", padding=True)
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        
        with torch.no_grad():
            image_features = self.model.get_image_features(**inputs)
            image_features = image_features / image_features.norm(p=2, dim=-1, keepdim=True)
            feature_vector = image_features.mean(dim=0).cpu().numpy()
            norm = np.linalg.norm(feature_vector)
            if norm > 0:
                feature_vector = feature_vector / norm
        
        return feature_vector

    def extract_from_video(self, video_path):
        video_name = os.path.basename(video_path)
        frames = self.extract_frames(video_path, 
                                     start_time=config.START_TIME,
                                     end_time=config.END_TIME,
                                     sample_rate=config.SAMPLE_RATE)
        if not frames:
            return None
        
        features = self.extract_features_from_frames(frames)
        if features is not None:
            metadata = {
                'video_name': video_name,
                'video_path': normalize_video_path_for_metadata(video_path)
            }
            return (features, metadata)
        
        return None

    def process_video_folder(self, folder_path, use_parallel=True, n_jobs=-1):
        video_files = []
        for ext in ['*.mov', '*.mp4', '*.avi', '*.mkv']:
            video_files.extend(glob.glob(os.path.join(folder_path, ext)))
        
        print(f"Tìm thấy {len(video_files)} video")
        
        if use_parallel and n_jobs != 1:
            print(f"Đang xử lý song song với {n_jobs} luồng...")
            results = Parallel(n_jobs=n_jobs)(
                delayed(_extract_from_video_single)(video_path) 
                for video_path in video_files
            )
            
            features_list = []
            metadata_list = []
            for result in results:
                if result is not None:
                    features, metadata = result
                    features_list.append(features)
                    metadata_list.append(metadata)
        else:
            print("Đang xử lý tuần tự...")
            features_list = []
            metadata_list = []
            
            for video_path in tqdm(video_files, desc="Processing videos"):
                result = self.extract_from_video(video_path)
                if result is not None:
                    features, metadata = result
                    features_list.append(features)
                    metadata_list.append(metadata)
        
        return features_list, metadata_list


def save_features(features_list, metadata_list, mode="create"):
    # Không có features để lưu
    if not features_list:
        print("Không có features để lưu!")
        return

    # Chuẩn hóa folder output nếu cần
    vector_dir = os.path.dirname(config.FEATURES_FILE)
    if vector_dir and not os.path.exists(vector_dir):
        os.makedirs(vector_dir, exist_ok=True)

    # Chống trùng lặp theo video_path
    def _dedup(features, metadata):
        seen = set()
        f_out, m_out = [], []
        for f, m in zip(features, metadata):
            vp = (m or {}).get('video_path')
            if vp and vp not in seen:
                seen.add(vp)
                f_out.append(f)
                m_out.append(m)
        return f_out, m_out

    # Nếu update và đã có metadata, lọc bỏ các video đã tồn tại
    effective_mode = mode
    if mode == "update" and os.path.exists(config.METADATA_FILE):
        try:
            with open(config.METADATA_FILE, 'rb') as f:
                existing_metadata = pickle.load(f)
            existing_paths = set((m or {}).get('video_path') for m in existing_metadata if m)
            filtered_features, filtered_metadata = [], []
            for f, m in zip(features_list, metadata_list):
                vp = (m or {}).get('video_path')
                if vp not in existing_paths:
                    filtered_features.append(f)
                    filtered_metadata.append(m)
            if len(filtered_features) != len(features_list):
                print(f"Bỏ qua {len(features_list) - len(filtered_features)} video trùng lặp khi update")
            features_list, metadata_list = filtered_features, filtered_metadata
        except Exception as e:
            print(f"Không thể đọc metadata hiện có, tiếp tục không lọc trùng: {e}")

    # Sau lọc, nếu rỗng thì dừng
    if not features_list:
        print("Không có vector mới sau khi lọc trùng. Dừng.")
        return

    # Chuẩn hóa và đảm bảo dimension
    features_array = np.array(features_list).astype('float32')
    norms = np.linalg.norm(features_array, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    features_array = features_array / norms
    dimension = features_array.shape[1]

    # Tạo mới hoặc cập nhật index hiện có, có kiểm tra dimension
    index = None
    if effective_mode == "create" or not os.path.exists(config.FEATURES_FILE):
        index = faiss.IndexFlatIP(dimension)
        print("Tạo mới FAISS index...")
    else:
        print("Cập nhật FAISS index hiện có...")
        index = faiss.read_index(config.FEATURES_FILE)
        if hasattr(index, 'd') and index.d != dimension:
            print(f"Cảnh báo: dimension index ({index.d}) != dimension vector mới ({dimension}). Chuyển sang create.")
            index = faiss.IndexFlatIP(dimension)
            effective_mode = "create"

    index.add(features_array)
    faiss.write_index(index, config.FEATURES_FILE)
    print(f"Đã lưu index vào {config.FEATURES_FILE}")

    # Ghi metadata: tạo mới hoặc nối thêm, đồng thời dedup nếu create
    if effective_mode == "create" or not os.path.exists(config.METADATA_FILE):
        # Dedup trong batch create
        metadata_list = _dedup(features_list, metadata_list)[1]
        all_metadata = metadata_list
    else:
        with open(config.METADATA_FILE, 'rb') as f:
            existing_metadata = pickle.load(f)
        all_metadata = existing_metadata + metadata_list

    with open(config.METADATA_FILE, 'wb') as f:
        pickle.dump(all_metadata, f)
    print(f"Đã lưu metadata vào {config.METADATA_FILE}")

    print(f"Tổng số video trong index: {len(all_metadata)}")
    print(f"Vector dimension: {dimension}")


def main(mode="create", video_folder=None):
    extractor = VideoFeatureExtractor()
    folder = video_folder or config.VIDEO_FOLDER
    features_list, metadata_list = extractor.process_video_folder(
        folder,
        use_parallel=True,
        n_jobs=config.N_JOBS
    )
    save_features(features_list, metadata_list, mode=mode)
    print("\nHoàn thành trích xuất features!")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", type=str, default="create", choices=["create", "update"],
                        help="Chế độ: create (tạo mới), update (thêm vào index hiện có)")
    parser.add_argument("--video_folder", type=str, default=None,
                        help="Thư mục video đầu vào (override config.VIDEO_FOLDER)")
    parser.add_argument("--output", type=str, default=None,
                        help="Thư mục lưu vector (override config.VECTOR_FOLDER)")
    args = parser.parse_args()

    # Cho phép override đường dẫn output
    if args.output:
        out_dir = args.output
        try:
            os.makedirs(out_dir, exist_ok=True)
        except Exception:
            pass
        config.VECTOR_FOLDER = out_dir
        config.FEATURES_FILE = os.path.join(config.VECTOR_FOLDER, "video_features.faiss")
        config.METADATA_FILE = os.path.join(config.VECTOR_FOLDER, "video_metadata.pkl")

    # Chạy chính
    main(mode=args.mode, video_folder=args.video_folder)
