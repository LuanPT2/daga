"""
Python API Service - Xử lý video similarity search
"""
import os
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("OMP_NUM_THREADS", "1")

import json
import sys
from flask import Flask, request, jsonify
from flask_cors import CORS
import traceback

# Add flask-cors to requirements if not exists

# Import các modules
import config
from search_video import VideoSearcher
from extract_features import VideoFeatureExtractor
from verify_video import VideoVerifier

app = Flask(__name__)
CORS(app)

# Global instances (lazy load)
searcher = None
extractor = None
verifier = None

def get_searcher():
    global searcher
    if searcher is None:
        searcher = VideoSearcher()
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

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'ok': True,
        'service': 'python-processor',
        'data_dir': config.DATA_DIR,
        'vector_folder': config.VECTOR_FOLDER
    })

@app.route('/search', methods=['POST'])
def search():
    """Tìm kiếm video tương đồng"""
    try:
        data = request.get_json()
        video_path = data.get('video_path')
        
        if not video_path:
            return jsonify({'error': 'Missing video_path'}), 400
        
        if not os.path.exists(video_path):
            return jsonify({'error': f'Video not found: {video_path}'}), 404
        
        # Gọi search
        searcher = get_searcher()
        results = searcher.search(video_path, top_k=config.TOP_K)
        
        # Format kết quả (results đã là list of dicts với rank, similarity, video_name, video_path)
        formatted_results = []
        for r in results:
            formatted_results.append({
                'rank': r.get('rank', 0),
                'video_name': r.get('video_name', 'Unknown'),
                'similarity': float(r.get('similarity', 0)),
                'video_path': r.get('video_path', '')
            })
        
        return jsonify(formatted_results)
    
    except Exception as e:
        print(f'[SEARCH ERROR] {str(e)}')
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/extract', methods=['POST'])
def extract():
    """Trích xuất features từ video folder"""
    try:
        from extract_features import save_features
        
        extractor = get_extractor()
        features_list, metadata_list = extractor.process_video_folder(
            config.VIDEO_FOLDER,
            use_parallel=True,
            n_jobs=config.N_JOBS
        )
        save_features(features_list, metadata_list)
        
        return jsonify({
            'success': True,
            'message': 'Extraction completed',
            'features_file': config.FEATURES_FILE,
            'metadata_file': config.METADATA_FILE,
            'total_videos': len(features_list)
        })
    
    except Exception as e:
        print(f'[EXTRACT ERROR] {str(e)}')
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/verify', methods=['POST'])
def verify():
    """Verify video similarity"""
    try:
        data = request.get_json()
        video_path = data.get('video_path')
        
        if not video_path:
            return jsonify({'error': 'Missing video_path'}), 400
        
        if not os.path.exists(video_path):
            return jsonify({'error': f'Video not found: {video_path}'}), 404
        
        # Gọi verify
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

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5051))
    host = os.environ.get('HOST', '0.0.0.0')
    print(f'Starting Python API service on {host}:{port}')
    app.run(host=host, port=port, debug=False)

