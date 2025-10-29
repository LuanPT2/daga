"""
Tìm kiếm video tương đồng trong database
"""
import os
# Avoid multiple OpenMP runtime initialization on macOS
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("OMP_NUM_THREADS", "1")
import pickle
import json
import numpy as np
import faiss
from transformers import CLIPProcessor, CLIPModel
import torch
import config


class VideoSearcher:
    def __init__(self):
        print("Đang load CLIP model...")
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = CLIPModel.from_pretrained(config.CLIP_MODEL_NAME).to(self.device)
        self.processor = CLIPProcessor.from_pretrained(config.CLIP_MODEL_NAME)
        self.model.eval()
        
        # Load FAISS index
        if os.path.exists(config.FEATURES_FILE):
            self.index = faiss.read_index(config.FEATURES_FILE)
            print(f"Đã load index từ {config.FEATURES_FILE}")
        else:
            raise FileNotFoundError(f"Không tìm thấy index file: {config.FEATURES_FILE}")
        
        # Load metadata
        if os.path.exists(config.METADATA_FILE):
            with open(config.METADATA_FILE, 'rb') as f:
                self.metadata = pickle.load(f)
            print(f"Đã load metadata: {len(self.metadata)} videos")
        else:
            raise FileNotFoundError(f"Không tìm thấy metadata file: {config.METADATA_FILE}")

    def extract_frames_from_video(self, video_path, start_time=5, end_time=35, sample_rate=0.5):
        """
        Trích xuất khung hình từ video (tương tự extract_features.py)
        """
        import cv2
        from PIL import Image
        
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

    def extract_features_from_query_video(self, video_path):
        """
        Trích xuất đặc trưng từ video query (livestream hoặc video thử nghiệm)
        """
        frames = self.extract_frames_from_video(
            video_path,
            start_time=config.START_TIME,
            end_time=config.END_TIME,
            sample_rate=config.SAMPLE_RATE
        )
        
        if not frames:
            return None
        
        # Xử lý với CLIP
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

    def search(self, query_video_path, top_k=5):
        """
        Tìm kiếm video tương đồng
        Args:
            query_video_path: Đường dẫn video cần tìm
            top_k: Số lượng video tương đồng trả về
        Returns:
            List các dict chứa video_name, video_path, similarity
        """
        print(f"\nĐang xử lý video query: {query_video_path}")
        
        # Extract features từ query video
        query_features = self.extract_features_from_query_video(query_video_path)
        
        if query_features is None:
            return []
        
        # Reshape để FAISS có thể xử lý
        query_features = query_features.reshape(1, -1).astype('float32')
        
        # Tìm kiếm
        similarities, indices = self.index.search(query_features, top_k)
        
        # Chuẩn hóa similarity về 0-100%
        similarities = similarities[0]
        indices = indices[0]
        
        # Lấy thông tin metadata
        results = []
        for i, idx in enumerate(indices):
            if idx < len(self.metadata):
                similarity_percent = float(similarities[i] * 100)
                video_info = self.metadata[idx].copy()
                video_info['similarity'] = similarity_percent
                video_info['rank'] = i + 1
                results.append(video_info)
        
        return results

    def display_results(self, results):
        """
        Hiển thị kết quả tìm kiếm
        """
        if not results:
            print("Không tìm thấy video tương đồng!")
            return
        
        print("\n" + "="*80)
        print("KẾT QUẢ TÌM KIẾM VIDEO TƯƠNG ĐỒNG")
        print("="*80)
        
        for result in results:
            print(f"\n{result['rank']}. {result['video_name']}")
            print(f"   Độ tương đồng: {result['similarity']:.2f}%")
            print(f"   Đường dẫn: {result['video_path']}")
        
        print("\n" + "="*80)


def main():
    import sys
    # optional flag to emit JSON for machine-readers
    emit_json = False
    argv = [arg for arg in sys.argv[1:]]
    if '--json' in argv:
        emit_json = True
        argv.remove('--json')

    if len(argv) < 1:
        print("Usage: python search_video.py <path_to_query_video> [--json]")
        print("Example: python search_video.py ../video1.mov --json")
        return

    query_video = argv[0]

    if not os.path.exists(query_video):
        print(f"Không tìm thấy file: {query_video}")
        return
    
    searcher = VideoSearcher()
    results = searcher.search(query_video, top_k=config.TOP_K)
    if emit_json:
        # keep keys stable and ASCII off for VN names
        print(json.dumps(results, ensure_ascii=False))
    else:
        searcher.display_results(results)


if __name__ == "__main__":
    main()

