ffmpeg -i "video1.mov" -ss 00:02:00 -to 00:05:43 -c copy video1-001-D.mov 
ffmpeg -i "video1.mov" -ss 00:06:15 -to 00:09:15 -c copy video1-002-X.mov 
ffmpeg -i "video1.mov" -ss 00:10:00 -to 00:13:00 -c copy video1-003-X.mov 
ffmpeg -i "video1.mov" -ss 00:14:00 -to 00:16:40 -c copy video1-004-X.mov 
ffmpeg -i "video1.mov" -ss 00:17:30 -to 00:20:40 -c copy video1-005-D.mov


ffmpeg -i "video1.mov" -ss 00:1:30 -to 00:01:44 -c copy cut3.mov


python3 /Users/luanpt/Downloads/video_daga/source/segment_videos.py \
  --input "/Users/luanpt/Downloads/video_daga/goc/video011.mov" \
  --output "/Users/luanpt/Downloads/video_daga/video" \
  --template "/Users/luanpt/Downloads/video_daga/video_cut/cut.mov" \
  --detect-step 0.5 \
  --detect-threshold 50 \
  --detect-min-gap 10 \
  --min-duration 120

  python3 /Users/luanpt/Downloads/video_daga/source/tools/segment_videos.py \
  --input "/Users/luanpt/Downloads/video_daga/goc/video011.mov" \
  --output "/Users/luanpt/Downloads/video_daga/video_cut" \
  --template "/Users/luanpt/Downloads/video_daga/video_cut/cut.mov"


cd /Users/luanpt/Downloads/video_daga
python3 -m venv .venv
source .venv/bin/activate

python -m pip install --upgrade pip
python -m pip install -r source/requirements.txt
# macOS không cần GUI → dùng bản headless
python -m pip install opencv-python-headless

# kiểm tra
python -c "import cv2; print(cv2.__version__)"


python -m venv venv312
.\venv312\Scripts\Activate.ps1
python -m pip install --upgrade pip
cd process
pip install -r requirements.txt

# chạy lại tool (1 file template)
python /Users/luanpt/Downloads/video_daga/source/tools/segment_videos.py \
  --input "/Users/luanpt/Downloads/video_daga/goc/video008.mov" \
  --output "/Users/luanpt/Downloads/video_daga/video" \
  --template "/Users/luanpt/Downloads/video_daga/video_cut/cut.mov" \
  --detect-step 2 --detect-threshold 20 --detect-min-gap 10 --min-duration 120



# nếu dùng thư mục nhiều template:
python /Users/luanpt/Downloads/video_daga/source/tools/segment_videos.py \
  --input "/Users/luanpt/Downloads/video_daga/goc/video001.mov" \
  --output "/Users/luanpt/Downloads/video_daga/video" \
  --template-dir "/Users/luanpt/Downloads/video_daga/video_cut" \
  --detect-step 2 --detect-threshold 20 --detect-min-gap 10 --min-duration 120