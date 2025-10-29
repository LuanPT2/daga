ffmpeg -i "video1.mov" -ss 00:02:00 -to 00:05:43 -c copy video1-001-D.mov 
ffmpeg -i "video1.mov" -ss 00:06:15 -to 00:09:15 -c copy video1-002-X.mov 
ffmpeg -i "video1.mov" -ss 00:10:00 -to 00:13:00 -c copy video1-003-X.mov 
ffmpeg -i "video1.mov" -ss 00:14:00 -to 00:16:40 -c copy video1-004-X.mov 
ffmpeg -i "video1.mov" -ss 00:17:30 -to 00:20:40 -c copy video1-005-D.mov