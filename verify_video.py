# verify_video.py
import os
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("OMP_NUM_THREADS", "1")

import json
import numpy as np
import faiss
from transformers import CLIPProcessor, CLIPModel
import torch
import cv2
from PIL import Image
import pickle
import argparse
import config  # <-- Dùng config.VERIFY_RATE

class VideoVerifier:
    def __init__(self):
        print("Đang load CLIP model cho verify...")
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = CLIPModel.from_pretrained(config.CLIP_MODEL_NAME).to(self.device)
        self.processor = CLIPProcessor.from_pretrained(config.CLIP_MODEL_NAME)
        self.model.eval()

        # Load FAISS index
        if not os.path.exists(config.FEATURES_FILE):
            raise FileNotFoundError(f"Không tìm thấy: {config.FEATURES_FILE}")
        self.index = faiss.read_index(config.FEATURES_FILE)

        # Load metadata
        if not os.path.exists(config.METADATA_FILE):
            raise FileNotFoundError(f"Không tìm thấy: {config.METADATA_FILE}")
        with open(config.METADATA_FILE, 'rb') as f:
            self.metadata = pickle.load(f)

        print(f"Đã load {len(self.metadata)} video từ DB")

    def extract_frames(self, video_path):
        """
        Dùng config.VERIFY_RATE để lấy mẫu
        """
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return []

        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        frames = []
        start_time = config.START_TIME
        end_time = config.END_TIME
        sample_rate = config.VERIFY_RATE  # Dùng config
        time_points = np.arange(start_time, end_time, sample_rate)
        total = len(time_points)

        print(f"[VERIFY] Lấy mẫu mỗi {sample_rate}s → {total} khung hình")

        for i, t in enumerate(time_points):
            frame_no = int(t * fps)
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_no)
            ret, frame = cap.read()
            if ret:
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                frames.append(Image.fromarray(frame_rgb))

            # IN TIẾN TRÌNH
            progress = int((i + 1) / total * 100)
            print(f"PROGRESS: {progress}")

        cap.release()
        return frames

    def get_feature(self, video_path):
        frames = self.extract_frames(video_path)
        if not frames:
            return None

        inputs = self.processor(images=frames, return_tensors="pt", padding=True)
        inputs = {k: v.to(self.device) for k, v in inputs.items()}

        with torch.no_grad():
            feats = self.model.get_image_features(**inputs)
            feats = feats / feats.norm(p=2, dim=-1, keepdim=True)
            vec = feats.mean(dim=0).cpu().numpy()
            norm = np.linalg.norm(vec)
            if norm > 0:
                vec = vec / norm
        return vec

    def verify(self, query_path):
        print(f"\n[VERIFY] Đang xử lý: {query_path}")
        query_vec = self.get_feature(query_path)
        if query_vec is None:
            return None

        query_vec = query_vec.reshape(1, -1).astype('float32')
        D, I = self.index.search(query_vec, 1)
        idx = I[0][0]
        sim = float(D[0][0] * 100)

        if idx < len(self.metadata):
            video_info = self.metadata[idx]
            print(f"[VERIFY] Video gốc: {video_info['video_name']}")
            print(f"[VERIFY] Độ tương đồng: {sim:.2f}%")
        else:
            print(f"[VERIFY] Không tìm thấy trong DB (idx={idx})")

        return {"similarity": round(sim, 2)}

def main():
    parser = argparse.ArgumentParser(description="Verify video với độ chính xác cao")
    parser.add_argument('video_path', help='Đường dẫn video cần verify')
    parser.add_argument('--json', action='store_true', help='Xuất JSON')
    args = parser.parse_args()

    if not os.path.exists(args.video_path):
        print(f"Không tìm thấy: {args.video_path}")
        return

    verifier = VideoVerifier()
    result = verifier.verify(args.video_path)

    if result and args.json:
        print(json.dumps(result, ensure_ascii=False))
    elif result:
        print(f"Similarity: {result['similarity']:.2f}%")

if __name__ == "__main__":
    main()