import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

function App() {
  const API_BASE = `http://${window.location.hostname}:5050`;
  const [file, setFile] = useState(null);
  const [path, setPath] = useState('/Users/luanpt/Downloads/video_daga/visitdeo-livestream');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [requestId, setRequestId] = useState(null);
  const [showReload, setShowReload] = useState(false);
  const pollInterval = useRef(null);
  const latestInterval = useRef(null);
  const videoSectionRef = useRef(null);

  // ==== RECORD SCREEN (Preview ở tab A + Crop cho tab B + Auto-Save Segment) ====
  const [recording, setRecording] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [stream, setStream] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const [selection, setSelection] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [segmentDuration, setSegmentDuration] = useState(10); // Lưu mỗi X giây
  const segmentTimerRef = useRef(null);

  const getVideoUrl = (p) => `${API_BASE}/video?path=${encodeURIComponent(p || '')}`;
  const [verifying, setVerifying] = useState({}); // { path: true/false }
  const [verifyProgress, setVerifyProgress] = useState({}); // { path: 0–100 }
  const [verifyResult, setVerifyResult] = useState({}); // { path: "kết quả" }
  
  // === GỬI YÊU CẦU TÌM KIẾM ===
  const search = async () => {
    if (!file && !path) return alert('Vui lòng chọn video hoặc nhập đường dẫn!');
  
    setLoading(true);
    setStatus('');
    setShowReload(false);
    setRequestId(null);
  
    const form = new FormData();
    if (file) form.append('video', file);
    else form.append('path', path);
  
    try {
      const res = await axios.post(`${API_BASE}/search`, form);
      const { request_id } = res.data;
  
      setRequestId(request_id);
      setStatus('Đã gửi yêu cầu, đang xử lý...');
      setShowReload(true);
      startPolling(request_id);
    } catch (err) {
      setStatus('Lỗi: ' + (err.response?.data?.error || err.message));
      setShowReload(false);
    } finally {
      setLoading(false);
    }
  };

  // === POLL KẾT QUẢ ===
  const startPolling = (id) => {
    if (pollInterval.current) clearTimeout(pollInterval.current);

    const poll = async () => {
      try {
        const res = await axios.get(`${API_BASE}/search/result/${id}`);
        const data = res.data;

        if (data.status === 'pending') {
          setStatus('Đang xử lý... (vui lòng chờ)');
          pollInterval.current = setTimeout(poll, 2000);
          return;
        }

        if (data.status === 'failed') {
          setStatus(`Lỗi: ${data.error}`);
          setShowReload(false);
          if (pollInterval.current) clearTimeout(pollInterval.current);
          return;
        }

        if (data.status === 'completed') {
          const resArr = Array.isArray(data.results) ? data.results : [];
          if (resArr.length > 0) {
            setResults(resArr);
            setStatus('Hoàn tất!');
            setShowReload(false);
            if (pollInterval.current) clearTimeout(pollInterval.current);
          } else {
            setStatus('Đang xử lý... (chưa có kết quả)');
            pollInterval.current = setTimeout(poll, 2000);
          }
        }
      } catch (err) {
        console.error('Poll error:', err);
        setStatus('Lỗi kết nối khi lấy kết quả');
        setShowReload(true);
      }
    };

    poll();
  };

  // === VERIFY VIDEO ===
  const verifyVideo = async (videoPath) => {
    setVerifying((prev) => ({ ...prev, [videoPath]: true }));
    setVerifyProgress((prev) => ({ ...prev, [videoPath]: 0 }));
    setVerifyResult((prev) => ({ ...prev, [videoPath]: null }));

    try {
      const res = await axios.post(`${API_BASE}/verify/start`, { path: videoPath });
      const { verify_id } = res.data;
      if (!verify_id) throw new Error("Không có verify_id");

      const poll = async () => {
        const result = await axios.get(`${API_BASE}/verify/status/${verify_id}`);
        if (result.data.status === "processing") {
          setVerifyProgress((prev) => ({
            ...prev,
            [videoPath]: result.data.progress || 0,
          }));
          setTimeout(poll, 1000);
        } else if (result.data.status === "completed") {
          setVerifying((prev) => ({ ...prev, [videoPath]: false }));
          setVerifyProgress((prev) => ({ ...prev, [videoPath]: 100 }));
          setVerifyResult((prev) => ({
            ...prev,
            [videoPath]: `✅ ${result.data.similarity.toFixed(2)}%`,
          }));
        } else if (result.data.status === "failed") {
          setVerifying((prev) => ({ ...prev, [videoPath]: false }));
          setVerifyResult((prev) => ({
            ...prev,
            [videoPath]: `❌ ${result.data.error || "Lỗi"}`,
          }));
        }
      };

      poll();
    } catch (err) {
      setVerifying((prev) => ({ ...prev, [videoPath]: false }));
      setVerifyResult((prev) => ({
        ...prev,
        [videoPath]: "❌ Lỗi verify",
      }));
    }
  };

  // === DELETE RESULT ===
  const deleteResult = async (videoPath) => {
    try {
      await axios.delete(`${API_BASE}/result`, { data: { path: videoPath } });
      setResults((prev) => prev.filter((r) => r.path !== videoPath));
    } catch (err) {
      alert("Lỗi xóa: " + (err.response?.data?.error || err.message));
    }
  };

  // === RESET DB ===
  const resetDb = async () => {
    const confirm = window.confirm('Bạn có chắc muốn xóa tất cả record trong database?');
    if (!confirm) return;
    try {
      setLoading(true);
      setStatus('Đang xóa dữ liệu...');
      await axios.delete(`${API_BASE}/reset`);
      setResults([]);
      setRequestId(null);
      setShowReload(false);
      setStatus('Đã xóa toàn bộ dữ liệu.');
    } catch (err) {
      setStatus('Lỗi reset: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  // === DỪNG POLL KHI UNMOUNT ===
  useEffect(() => {
    return () => {
      if (pollInterval.current) clearTimeout(pollInterval.current);
    };
  }, []);

  // === TẢI KẾT QUẢ GẦN NHẤT ===
  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${API_BASE}/search/latest`);
        if (res.data && Array.isArray(res.data.results) && res.data.results.length > 0) {
          setResults(res.data.results);
          setRequestId(res.data.request_id || null);
          setStatus('Đã tải kết quả gần nhất từ DB');
        } else {
          setStatus('');
        }
      } catch (e) {
        // Giữ im lặng nếu backend chưa sẵn
      }
    })();
  }, [API_BASE]);

  // === TỰ ĐỘNG CẬP NHẬT KẾT QUẢ ===
  useEffect(() => {
    if (latestInterval.current) clearInterval(latestInterval.current);

    latestInterval.current = setInterval(async () => {
      if (showReload) return;
      try {
        const res = await axios.get(`${API_BASE}/search/latest`);
        if (res.data && Array.isArray(res.data.results)) {
          setResults(res.data.results);
          setRequestId(res.data.request_id || null);
        }
      } catch (_) {
        // bỏ qua lỗi tạm thời
      }
    }, 2000);

    return () => {
      if (latestInterval.current) clearInterval(latestInterval.current);
    };
  }, [API_BASE, showReload]);

  // ==== RECORDING LOGIC (Preview tab A + Crop tab B) ====
  const handleMouseDown = (e) => {
    if (!previewing) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setSelection({
      startX: e.clientX - rect.left,
      startY: e.clientY - rect.top,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      width: 0,
      height: 0,
    });
    setDragging(true);
  };

  const handleMouseMove = (e) => {
    if (!dragging || !selection || !previewing) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const newWidth = e.clientX - rect.left - selection.startX;
    const newHeight = e.clientY - rect.top - selection.startY;

    const normX = newWidth < 0 ? selection.startX + newWidth : selection.startX;
    const normY = newHeight < 0 ? selection.startY + newHeight : selection.startY;

    setSelection({
      ...selection,
      x: normX,
      y: normY,
      width: Math.abs(newWidth),
      height: Math.abs(newHeight),
    });
  };

  const handleMouseUp = () => {
    setDragging(false);
    if (selection && previewing) {
      setStatus("Vùng crop OK cho tab B! Nhấn toggle để start/stop record.");
    }
  };

  const startPreview = async () => {
    try {
      // Hướng dẫn user chọn tab B để chia sẻ (nơi có nội dung cần crop/record)
      const newStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: true
      });
      videoRef.current.srcObject = newStream;
      await new Promise((resolve) => {
        videoRef.current.onloadedmetadata = () => resolve(true);
      });
      await videoRef.current.play();
      setStream(newStream);
      setPreviewing(true);
      setStatus("Preview tab B đang chạy ở tab A. Drag để crop vùng video.");
    } catch (err) {
      console.error(err);
      setStatus("Lỗi preview: " + err.message + " (Kiểm tra quyền chia sẻ tab B)");
    }
  };

  const stopPreview = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setPreviewing(false);
    setRecording(false);
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (segmentTimerRef.current) {
      clearTimeout(segmentTimerRef.current);
      segmentTimerRef.current = null;
    }
    recordedChunksRef.current = [];
    if (canvasRef.current) {
      canvasRef.current.style.visibility = "hidden";
    }
    setSelection(null);
    setStatus("Đã dừng preview tab B.");
  };

  const toggleRecording = async () => {
    if (!previewing) {
      setStatus("Vui lòng start preview tab B trước!");
      return;
    }

    if (!recording) {
      console.log('Starting recording tab B...');
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      const videoWidth = videoRef.current.videoWidth;
      const videoHeight = videoRef.current.videoHeight;

      let crop = { x: 0, y: 0, width: videoWidth, height: videoHeight };
      if (selection) {
        const scaleX = videoWidth / videoRef.current.offsetWidth;
        const scaleY = videoHeight / videoRef.current.offsetHeight;
        crop = {
          x: Math.max(0, Math.min(selection.x * scaleX, videoWidth)),
          y: Math.max(0, Math.min(selection.y * scaleY, videoHeight)),
          width: Math.min(selection.width * scaleX, videoWidth),
          height: Math.min(selection.height * scaleY, videoHeight),
        };
      }

      if (crop.width === 0 || crop.height === 0) {
        setStatus("Vùng crop không hợp lệ cho tab B!");
        return;
      }

      canvas.width = crop.width;
      canvas.height = crop.height;
      canvas.style.width = `${crop.width}px`;
      canvas.style.height = `${crop.height}px`;
      canvas.style.visibility = "hidden";

      setRecording(true);
      recordedChunksRef.current = [];

      const drawFrame = () => {
        if (!recording) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(
          videoRef.current,
          crop.x, crop.y, crop.width, crop.height,
          0, 0, canvas.width, canvas.height
        );
        requestAnimationFrame(drawFrame);
      };
      drawFrame();

      const croppedStream = canvas.captureStream(30);

      mediaRecorderRef.current = new MediaRecorder(croppedStream, {
        mimeType: "video/webm;codecs=vp8,opus"
      });

      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
          console.log(`Chunk added from tab B, size: ${e.data.size} bytes`);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        console.log('Recorder stopped, processing segment from tab B...');
        processSegment().then(() => {
          if (recording && segmentDuration > 0) {
            console.log('Restarting recorder for next segment...');
            setTimeout(() => {
              mediaRecorderRef.current.start();
              startSegmentTimer();
            }, 100);
          }
        });
      };

      mediaRecorderRef.current.start();
      startSegmentTimer();

      setStatus(`Đang record tab B (crop: ${crop.width}x${crop.height}, segment: ${segmentDuration}s)...`);
    } else {
      console.log('Stopping recording tab B...');
      stopRecording();
    }
  };

  const startSegmentTimer = () => {
    if (segmentDuration <= 0) return;
    console.log(`Segment timer started for ${segmentDuration}s from tab B`);
    segmentTimerRef.current = setTimeout(() => {
      if (recording && mediaRecorderRef.current?.state === 'recording') {
        console.log('Segment timeout, stopping recorder...');
        mediaRecorderRef.current.stop();
      }
    }, segmentDuration * 1000);
  };

  const stopRecording = () => {
    console.log('Manual stop recording tab B...');
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
    if (segmentTimerRef.current) {
      clearTimeout(segmentTimerRef.current);
      segmentTimerRef.current = null;
    }
    setStatus("Đã dừng record tab B.");
  };

  const processSegment = async () => {
    if (recordedChunksRef.current.length === 0) {
      console.log('No chunks to process from tab B');
      setStatus("Không có data để lưu (kiểm tra crop tab B/stream).");
      return;
    }

    console.log(`Processing ${recordedChunksRef.current.length} chunks from tab B...`);
    const webmBlob = new Blob(recordedChunksRef.current, { type: "video/webm" });
    console.log(`Blob created from tab B, size: ${webmBlob.size} bytes`);

    // Tạo file từ blob và upload lên backend để xử lý (tích hợp /search)
    const timestamp = Date.now();
    const fileName = `recorded_segment_tabB_${timestamp}.webm`;
    const segmentFile = new File([webmBlob], fileName, { type: 'video/webm' });
    const formData = new FormData();
    formData.append('video', segmentFile);

    try {
      setStatus(`Đang upload segment tab B ${fileName}...`);
      const res = await axios.post(`${API_BASE}/search`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const { request_id } = res.data;
      console.log(`Segment tab B uploaded successfully, request_id: ${request_id}`);
      setStatus(`Đã upload segment tab B ${fileName}, đang xử lý search (ID: ${request_id})...`);
      
      // Clear chunks cho segment tiếp theo
      recordedChunksRef.current = [];
    } catch (error) {
      console.error('Failed to upload segment tab B:', error);
      setStatus(`Lỗi upload segment tab B ${fileName}: ${error.response?.data?.error || error.message}`);
      recordedChunksRef.current = [];
    }

    // Nếu không còn recording, cleanup
    if (!recording) {
      stopPreview();
    }
  };

  // Cleanup tổng
  useEffect(() => {
    return () => {
      stopPreview();
      if (pollInterval.current) clearTimeout(pollInterval.current);
      if (latestInterval.current) clearInterval(latestInterval.current);
      if (segmentTimerRef.current) clearTimeout(segmentTimerRef.current);
    };
  }, []);

  // JSX UI (tích hợp CSS theme)
  return (
    <div className="container">
      <h1 className="heading">Video Search & Record App (Tab A Preview)</h1>
      <p className="subheading">Preview & Crop tab B ngay tại đây!</p>
      
      {/* Phần Search */}
      <section className="panel">
        <h2 className="heading">Tìm kiếm Video</h2>
        <div className="form-group">
          <input
            type="file"
            onChange={(e) => setFile(e.target.files[0])}
            accept="video/*"
            className="file"
          />
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="Hoặc nhập đường dẫn video"
            className="input"
          />
        </div>
        <div className="actions">
          <button className="btn btn-primary" onClick={search} disabled={loading}>
            {loading ? 'Đang xử lý...' : 'Tìm kiếm'}
          </button>
          <button className="btn btn-danger" onClick={resetDb}>Reset DB</button>
        </div>
        <p className={`status ${status.includes('Lỗi') ? 'err' : status.includes('Hoàn tất') ? 'ok' : ''}`}>
          {status}
        </p>
        {showReload && <button className="btn btn-secondary" onClick={() => window.location.reload()}>Reload</button>}
      </section>

      {/* Phần Results */}
      <section className="panel">
        <h2 className="heading">Kết quả</h2>
        {results.length > 0 ? (
          <div className="video-grid-full">
            {results.map((result, idx) => (
              <div key={idx} className="video-card-full">
                <div className="video-wrapper">
                  <video src={getVideoUrl(result.path)} controls />
                </div>
                <div className="video-meta-full">
                  <div className="video-title">{result.name} (Rank {result.rank})</div>
                  <div className="video-sub">Similarity: <span className="percent">{result.similarity}%</span></div>
                </div>
                <div className="row-actions">
                  <button className="btn btn-success btn-small" onClick={() => verifyVideo(result.path)}>Verify</button>
                  <button className="btn btn-danger btn-small" onClick={() => deleteResult(result.path)}>Xóa</button>
                </div>
                {verifying[result.path] && (
                  <div className="status">Progress: {verifyProgress[result.path]}% - {verifyResult[result.path]}</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="video-empty-full">Chưa có kết quả. Hãy tìm kiếm hoặc record tab B!</div>
        )}
      </section>

      {/* Phần Record Preview & Crop (Tab A hiển thị, crop tab B) */}
      <section className="panel" ref={videoSectionRef}>
        <div className="video-toolbar">
          <h2 className="video-heading">Record Tab B (Preview & Crop ở Tab A)</h2>
          <div className="video-actions">
            <button className="btn btn-primary" onClick={startPreview} disabled={previewing}>
              Start Preview Tab B
            </button>
            <button className="btn btn-secondary" onClick={stopPreview} disabled={!previewing}>
              Stop Preview
            </button>
            <button className="btn btn-success" onClick={toggleRecording} disabled={!previewing}>
              {recording ? 'Stop Record' : 'Start Record Tab B'}
            </button>
            <label className="form-group">
              <span className="label">Segment (s):</span>
              <input
                type="number"
                value={segmentDuration}
                onChange={(e) => setSegmentDuration(Number(e.target.value))}
                min="1"
                max="60"
                className="input"
                style={{ width: '60px' }}
              />
            </label>
          </div>
        </div>
        <p className={`status ${status.includes('Lỗi') ? 'err' : status.includes('OK') ? 'ok' : ''}`}>
          {status}
        </p>

        {/* Video Preview với Crop Selection */}
        <div
          style={{
            position: 'relative',
            display: previewing ? 'block' : 'none',
            border: '2px dashed #3b82f6',
            cursor: dragging ? 'grabbing' : 'crosshair',
            background: '#000',
            borderRadius: '8px',
            overflow: 'hidden',
            marginBottom: '16px'
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          <video
            ref={videoRef}
            autoPlay
            muted
            style={{ width: '100%', height: 'auto', objectFit: 'contain' }}
          />
          {selection && (
            <div
              style={{
                position: 'absolute',
                border: '2px solid #3b82f6',
                background: 'rgba(59, 130, 246, 0.2)',
                left: `${selection.x}px`,
                top: `${selection.y}px`,
                width: `${selection.width}px`,
                height: `${selection.height}px`,
                pointerEvents: 'none',
                zIndex: 10
              }}
            />
          )}
        </div>

        {/* Canvas ẩn cho crop stream */}
        <canvas ref={canvasRef} style={{ visibility: 'hidden' }} />
      </section>

      <div className="footer">Powered by Grok & xAI – Record tab B, preview ở tab A!</div>
    </div>
  );
}

export default App;