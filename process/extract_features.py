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
    """
    Chuẩn hóa đường dẫn video trước khi lưu vào metadata.
    Chuyển đổi đường dẫn tuyệt đối thành đường dẫn tương đối để có thể
    hoạt động được trong cả Windows và Docker.
    """
    if not video_path:
        return video_path
    
    # Nếu là đường dẫn tuyệt đối Windows (có dấu :), chuyển thành đường dẫn tương đối
    if ":" in video_path and platform.system() != "Windows":
        # Trong Docker, chuyển D:/3data/... thành /data/...
        if video_path.startswith("D:/"):
            relative_path = video_path[3:]  # Bỏ "D:/"
            return "/data/" + relative_path
        elif video_path.startswith("D:"):
            relative_path = video_path[2:]  # Bỏ "D:"
            return "/data/" + relative_path
    
    return video_path


def _create_model():
    """Tạo model cho mỗi worker"""
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = CLIPModel.from_pretrained(config.CLIP_MODEL_NAME).to(device)
    processor = CLIPProcessor.from_pretrained(config.CLIP_MODEL_NAME)
    model.eval()
    return model, processor, device


def _extract_from_video_single(video_path):
    """
    Hàm helper để xử lý 1 video (dùng cho song song hóa)
    Không dùng self để tránh serialize model
    """
    try:
        model, processor, device = _create_model()
        video_name = os.path.basename(video_path)
        
        # Trích xuất khung hình
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
        
        # Trích xuất features
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
        self.processor = CLIPProcessor.from_pretrained(config.CLIP_MODEL_NAME)
        self.model.eval()
        print(f"Model đã load trên {self.device}")

    def extract_frames(self, video_path, start_time=5, end_time=35, sample_rate=0.5):
        """
        Trích xuất khung hình từ video
        Args:
            video_path: Đường dẫn video
            start_time: Thời điểm bắt đầu (giây)
            end_time: Thời điểm kết thúc (giây)
            sample_rate: Lấy mẫu mỗi bao nhiêu giây
        Returns:
            List các khung hình (PIL Image)
        """
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return []

        fps = cap.get(cv2.CAP_PROP_FPS)
        frames = []
        
        # Tính toán các thời điểm cần lấy
        time_points = np.arange(start_time, end_time, sample_rate)
        
        for time_point in time_points:
            frame_number = int(time_point * fps)
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
            ret, frame = cap.read()
            
            if ret:
                # Convert BGR to RGB
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                pil_image = Image.fromarray(frame_rgb)
                frames.append(pil_image)
        
        cap.release()
        return frames

    def extract_features_from_frames(self, frames):
        """
        Trích xuất vector đặc trưng từ các khung hình bằng CLIP
        Args:
            frames: List các PIL Image
        Returns:
            Vector đặc trưng (numpy array)
        """
        if not frames:
            return None
        
        # Xử lý các khung hình
        inputs = self.processor(images=frames, return_tensors="pt", padding=True)
        inputs = {k: v.to(self.device) for k, v in inputs.items()}
        
        with torch.no_grad():
            # Extract image features
            image_features = self.model.get_image_features(**inputs)
            # Normalize
            image_features = image_features / image_features.norm(p=2, dim=-1, keepdim=True)
            # Lấy trung bình
            feature_vector = image_features.mean(dim=0).cpu().numpy()
            norm = np.linalg.norm(feature_vector)
            if norm > 0:
                feature_vector = feature_vector / norm
        
        return feature_vector

    def extract_from_video(self, video_path):
        """
        Trích xuất đặc trưng từ một video
        Returns: (features, metadata) hoặc None nếu lỗi
        """
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
        """
        Xử lý tất cả video trong folder
        Args:
            folder_path: Đường dẫn folder chứa video
            use_parallel: Có dùng song song hóa không
            n_jobs: Số luồng xử lý (-1 = tất cả cores)
        """
        video_files = []
        for ext in ['*.mov', '*.mp4', '*.avi', '*.mkv']:
            video_files.extend(glob.glob(os.path.join(folder_path, ext)))
        
        print(f"Tìm thấy {len(video_files)} video")
        
        if use_parallel and n_jobs != 1:
            # Song song hóa với joblib
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
            # Xử lý tuần tự (backup)
            print("Đang xử lý tuần tự...")
            features_list = []
            metadata_list = []
            
            for video_path in tqdm(video_files, desc="Processing videos"):
                video_name = os.path.basename(video_path)
                print(f"Đang xử lý: {video_name}")
                
                result = self.extract_from_video(video_path)
                
                if result is not None:
                    features, metadata = result
                    features_list.append(features)
                    metadata_list.append(metadata)
        
        return features_list, metadata_list


def save_features(features_list, metadata_list):
    """
    Lưu features vào FAISS và metadata vào pickle
    """
    if not features_list:
        print("Không có features để lưu!")
        return
    
    # Convert to numpy array
    features_array = np.array(features_list).astype('float32')
    # Ensure features are L2-normalized for cosine similarity with Inner Product
    norms = np.linalg.norm(features_array, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    features_array = features_array / norms
    dimension = features_array.shape[1]
    
    # Tạo FAISS index
    index = faiss.IndexFlatIP(dimension)  # Inner Product (cosine similarity)
    index.add(features_array)
    
    # Lưu index
    faiss.write_index(index, config.FEATURES_FILE)
    print(f"Đã lưu index vào {config.FEATURES_FILE}")
    
    # Lưu metadata
    with open(config.METADATA_FILE, 'wb') as f:
        pickle.dump(metadata_list, f)
    print(f"Đã lưu metadata vào {config.METADATA_FILE}")
    
    print(f"Tổng số video: {len(features_list)}")
    print(f"Vector dimension: {dimension}")


def main():
    extractor = VideoFeatureExtractor()
    features_list, metadata_list = extractor.process_video_folder(
        config.VIDEO_FOLDER, 
        use_parallel=True, 
        n_jobs=config.N_JOBS
    )
    save_features(features_list, metadata_list)
    print("\nHoàn thành trích xuất features!")


if __name__ == "__main__":
    main()

