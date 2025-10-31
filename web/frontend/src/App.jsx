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
  const [showReload, setShowReload] = useState(false); // ĐÃ SỬA: useState
  const pollInterval = useRef(null);
  const latestInterval = useRef(null);
  const videoSectionRef = useRef(null);

  const getVideoUrl = (p) => `${API_BASE}/video?path=${encodeURIComponent(p || '')}`;
  const [verifying, setVerifying] = useState({}); // { path: true/false }
  const [verifyProgress, setVerifyProgress] = useState({}); // { path: 0–100 }
  const [verifyResult, setVerifyResult] = useState({}); // { path: "kết quả" }
  
  // === CROSS-TAB RECORDING (Tab B -> Tab A) ===
  const recChannelRef = useRef(null);
  const [isListening, setIsListening] = useState(false);
  const [recStatus, setRecStatus] = useState('');
  const [recChunks, setRecChunks] = useState([]); // Array<Blob|ArrayBuffer>
  const [recMime, setRecMime] = useState('video/webm');
  const [receivedBlobUrl, setReceivedBlobUrl] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [tabBUrl, setTabBUrl] = useState('');
  const [cropRect, setCropRect] = useState({ x: 0, y: 0, width: 640, height: 360 });
  
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
    // Dừng poll cũ nếu có
    if (pollInterval.current) clearTimeout(pollInterval.current); // ĐÃ SỬA: clearTimeout

    const poll = async () => {
      try {
        const res = await axios.get(`${API_BASE}/search/result/${id}`);
        const data = res.data;

        if (data.status === 'pending') {
          setStatus('Đang xử lý... (vui lòng chờ)');
          pollInterval.current = setTimeout(poll, 2000); // ĐÃ SỬA: setTimeout
          return;
        }

        if (data.status === 'failed') {
          setStatus(`Lỗi: ${data.error}`);
          setShowReload(false);
          if (pollInterval.current) clearTimeout(pollInterval.current); // ĐÃ SỬA
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

    poll(); // Gọi ngay lần đầu
  };

  // === VERIFY VIDEO ===
  const verifyVideo = async (videoPath) => {
    setVerifying((prev) => ({ ...prev, [videoPath]: true }));
    setVerifyProgress((prev) => ({ ...prev, [videoPath]: 0 }));
    setVerifyResult((prev) => ({ ...prev, [videoPath]: null }));

    try {
      // Gọi API bắt đầu verify
      const res = await axios.post(`${API_BASE}/verify/start`, { path: videoPath });
      const { verify_id } = res.data;
      if (!verify_id) throw new Error("Không có verify_id");

      // Poll tiến trình mỗi 1s
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

  // === LISTEN/RECEIVE RECORDED CHUNKS FROM TAB B ===
  const handleIncomingMessage = (evt) => {
    const data = evt?.data;
    if (!data || typeof data !== 'object') return;
    if (!('type' in data)) return;
    try {
      if (data.type === 'record:init') {
        if (receivedBlobUrl) {
          URL.revokeObjectURL(receivedBlobUrl);
          setReceivedBlobUrl(null);
        }
        setRecChunks([]);
        if (typeof data.mimeType === 'string') setRecMime(data.mimeType);
        setRecStatus('Đang nhận dữ liệu ghi từ Tab B...');
      } else if (data.type === 'record:chunk') {
        const payload = data.payload;
        if (!payload) return;
        // payload có thể là ArrayBuffer hoặc Blob
        if (payload instanceof ArrayBuffer) {
          setRecChunks(prev => [...prev, payload]);
        } else if (payload && typeof payload === 'object') {
          setRecChunks(prev => [...prev, payload]);
        }
      } else if (data.type === 'record:done') {
        setRecStatus('Đã nhận xong. Đang hợp nhất...');
        assembleRecording();
      } else if (data.type === 'record:error') {
        setRecStatus('Lỗi từ Tab B: ' + (data.error || 'unknown'));
      }
    } catch (_) {}
  };

  const startListening = () => {
    if (isListening) return;
    setIsListening(true);
    setRecStatus('Sẵn sàng nhận dữ liệu...');
    // BroadcastChannel nếu cùng origin; nếu không, vẫn dùng window.postMessage
    try {
      if ('BroadcastChannel' in window) {
        recChannelRef.current = new BroadcastChannel('video-record');
        recChannelRef.current.onmessage = (e) => handleIncomingMessage(e);
      }
    } catch (_) {}
    window.addEventListener('message', handleIncomingMessage);
  };

  const stopListening = () => {
    if (!isListening) return;
    setIsListening(false);
    try {
      if (recChannelRef.current) {
        recChannelRef.current.close();
        recChannelRef.current = null;
      }
    } catch (_) {}
    window.removeEventListener('message', handleIncomingMessage);
    setRecStatus('Đã dừng lắng nghe.');
  };

  useEffect(() => {
    return () => {
      // cleanup
      stopListening();
      if (receivedBlobUrl) URL.revokeObjectURL(receivedBlobUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const assembleRecording = () => {
    try {
      if (!recChunks.length) {
        setRecStatus('Không có dữ liệu để hợp nhất');
        return;
      }
      const blob = new Blob(recChunks, { type: recMime || 'video/webm' });
      const url = URL.createObjectURL(blob);
      setReceivedBlobUrl(url);
      setRecStatus('Đã hợp nhất video. Bạn có thể crop và lưu/tải lên.');
    } catch (e) {
      setRecStatus('Lỗi hợp nhất: ' + e.message);
    }
  };

  // === CROP VIDEO BẰNG CANVAS (Client-side) ===
  const cropVideoBlob = async (srcBlob, crop) => {
    return await new Promise((resolve, reject) => {
      try {
        const video = document.createElement('video');
        video.src = URL.createObjectURL(srcBlob);
        video.muted = true;
        video.playsInline = true;

        const canvas = document.createElement('canvas');
        const outW = Math.max(1, Math.round(Number(crop.width) || 0));
        const outH = Math.max(1, Math.round(Number(crop.height) || 0));
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d');
        const fps = 30;

        const stream = canvas.captureStream(fps);
        const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm;codecs=vp8';
        const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3_000_000 });
        const out = [];
        rec.ondataavailable = e => { if (e.data && e.data.size) out.push(e.data); };
        rec.onstop = () => {
          try {
            const outBlob = new Blob(out, { type: 'video/webm' });
            resolve(outBlob);
          } catch (err) { reject(err); }
        };

        const draw = () => {
          try {
            ctx.drawImage(
              video,
              Number(crop.x) || 0,
              Number(crop.y) || 0,
              Number(crop.width) || outW,
              Number(crop.height) || outH,
              0,
              0,
              outW,
              outH
            );
          } catch (_) {}
          if (!video.paused && !video.ended) requestAnimationFrame(draw);
        };

        video.addEventListener('play', () => { draw(); }, { once: true });
        video.addEventListener('ended', () => {
          if (rec.state !== 'inactive') rec.stop();
          URL.revokeObjectURL(video.src);
        }, { once: true });
        video.onerror = () => reject(new Error('Không phát được video để crop'));

        rec.start(250);
        video.addEventListener('loadedmetadata', () => {
          video.currentTime = 0;
          video.play().catch(reject);
        }, { once: true });
      } catch (e) {
        reject(e);
      }
    });
  };

  const saveBlobToDisk = (blob, filename = 'recorded-cropped.webm') => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      document.body.removeChild(a);
    }, 1000);
  };

  const uploadBlobToSearch = async (blob) => {
    const fd = new FormData();
    fd.append('video', blob, 'recorded-cropped.webm');
    await axios.post(`${API_BASE}/search`, fd);
  };

  const handleCropAndSave = async () => {
    if (!receivedBlobUrl) return alert('Chưa có video đã nhận');
    setProcessing(true);
    setRecStatus('Đang crop video...');
    try {
      const res = await fetch(receivedBlobUrl);
      const srcBlob = await res.blob();
      const cropped = await cropVideoBlob(srcBlob, cropRect);
      saveBlobToDisk(cropped);
      setRecStatus('Đã crop và lưu file.');
    } catch (e) {
      setRecStatus('Lỗi crop/lưu: ' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleCropAndSearch = async () => {
    if (!receivedBlobUrl) return alert('Chưa có video đã nhận');
    setProcessing(true);
    setRecStatus('Đang crop và tải lên tìm kiếm...');
    try {
      const res = await fetch(receivedBlobUrl);
      const srcBlob = await res.blob();
      const cropped = await cropVideoBlob(srcBlob, cropRect);
      await uploadBlobToSearch(cropped);
      setRecStatus('Đã tải lên. Vào mục kết quả để xem.');
    } catch (e) {
      setRecStatus('Lỗi crop/tải lên: ' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  const openTabB = () => {
    if (!tabBUrl) return alert('Nhập URL Tab B');
    window.open(tabBUrl, 'record_tab_b');
  };

  // (Đã bỏ) Nút tải lại không còn cần thiết do auto-refresh

  // === NÚT XÓA TOÀN BỘ RECORD (RESET DB) ===
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
      if (pollInterval.current) clearTimeout(pollInterval.current); // ĐÃ SỬA
    };
  }, []);

  // === TẢI KẾT QUẢ GẦN NHẤT TỪ DB KHI VÀO TRANG ===
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

  // === TỰ ĐỘNG CẬP NHẬT KẾT QUẢ MỖI 2 GIÂY ===
  useEffect(() => {
    if (latestInterval.current) clearInterval(latestInterval.current);

    latestInterval.current = setInterval(async () => {
      // Nếu đang có luồng poll theo requestId (đang xử lý), bỏ qua để tránh xung đột
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

  return (
    <>
    <div className="container">
      <h1 className="heading">Tìm Video Tương Đồng</h1>

      <div className="panel">
        <div className="grid grid-2">
          <div className="form-group">
            <label className="label">Tải video lên</label>
            <input
              className="file"
              type="file"
              accept="video/*"
              onChange={(e) => setFile(e.target.files[0])}
              disabled={loading}
            />
          </div>
          <div className="form-group">
            <label className="label">Hoặc nhập đường dẫn</label>
            <input
              className="input"
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/Users/luanpt/Downloads/video_daga/visitdeo-livestream"
              disabled={loading}
            />
          </div>
        </div>

        <div className="actions">
          <button onClick={search} disabled={loading} className="btn btn-primary">
            {loading ? 'Đang gửi…' : 'Tìm kiếm'}
          </button>

          <button onClick={resetDb} disabled={loading} className="btn btn-danger">
            Xóa tất cả record
          </button>
        </div>

        <div className={`status ${status.startsWith('Lỗi') ? 'err' : status ? 'ok' : ''}`}>
          {status}
        </div>

        {/* === GHI TỪ TAB B (RECEIVER) === */}
        <div className="panel" style={{ marginTop: 16 }}>
          <h2 style={{ marginBottom: 8 }}>Ghi từ Tab B & gửi về Tab A</h2>
          <div className="grid grid-2">
            <div className="form-group">
              <label className="label">URL Tab B (trang chứa video)</label>
              <input
                className="input"
                type="text"
                value={tabBUrl}
                onChange={(e) => setTabBUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
            <div className="form-group">
              <label className="label">Hành động</label>
              <div className="actions">
                <button className="btn btn-secondary" onClick={openTabB}>Mở Tab B</button>
                {!isListening ? (
                  <button className="btn btn-primary" onClick={startListening}>Bắt đầu lắng nghe</button>
                ) : (
                  <button className="btn btn-danger" onClick={stopListening}>Dừng lắng nghe</button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-4" style={{ marginTop: 8 }}>
            <div className="form-group">
              <label className="label">Crop X</label>
              <input className="input" type="number" value={cropRect.x} onChange={(e) => setCropRect({ ...cropRect, x: Number(e.target.value) })} />
            </div>
            <div className="form-group">
              <label className="label">Crop Y</label>
              <input className="input" type="number" value={cropRect.y} onChange={(e) => setCropRect({ ...cropRect, y: Number(e.target.value) })} />
            </div>
            <div className="form-group">
              <label className="label">Crop Width</label>
              <input className="input" type="number" value={cropRect.width} onChange={(e) => setCropRect({ ...cropRect, width: Number(e.target.value) })} />
            </div>
            <div className="form-group">
              <label className="label">Crop Height</label>
              <input className="input" type="number" value={cropRect.height} onChange={(e) => setCropRect({ ...cropRect, height: Number(e.target.value) })} />
            </div>
          </div>

          <div className={`status ${recStatus.startsWith('Lỗi') ? 'err' : recStatus ? 'ok' : ''}`} style={{ marginTop: 8 }}>
            {recStatus}
          </div>

          {receivedBlobUrl ? (
            <div className="actions" style={{ marginTop: 8 }}>
              <video src={receivedBlobUrl} controls style={{ maxWidth: '100%', borderRadius: 6 }} />
              <button className="btn btn-success" disabled={processing} onClick={handleCropAndSave}>
                {processing ? 'Đang xử lý...' : 'Crop & Lưu file'}
              </button>
              <button className="btn btn-primary" disabled={processing} onClick={handleCropAndSearch}>
                {processing ? 'Đang xử lý...' : 'Crop & Tải lên tìm kiếm'}
              </button>
            </div>
          ) : null}

          <div className="form-group" style={{ marginTop: 12 }}>
            <label className="label">Đoạn script (dán vào Console của Tab B để bắt đầu ghi)</label>
            <textarea className="input" rows={8} readOnly value={`(() => {\n  const channel = 'video-record';\n  const bc = ('BroadcastChannel' in window) ? new BroadcastChannel(channel) : null;\n  const send = (msg) => {\n    try { if (bc) bc.postMessage(msg); } catch(_) {}\n    try { if (window.opener) window.opener.postMessage(msg, '*'); } catch(_) {}\n    try { if (window.parent && window.parent !== window) window.parent.postMessage(msg, '*'); } catch(_) {}\n  };\n  const video = document.querySelector('video');\n  if (!video) { alert('Không tìm thấy thẻ <video>'); return; }\n  const capture = video.captureStream ? video.captureStream() : (video.mozCaptureStream && video.mozCaptureStream());\n  if (!capture) { alert('Trình duyệt không hỗ trợ captureStream'); return; }\n  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm;codecs=vp8';\n  const rec = new MediaRecorder(capture, { mimeType: mime, videoBitsPerSecond: 3000000 });\n  send({ type: 'record:init', mimeType: mime });\n  rec.ondataavailable = e => { if (e.data && e.data.size) { e.data.arrayBuffer().then(buf => send({ type: 'record:chunk', payload: buf })); } };\n  rec.onstop = () => send({ type: 'record:done' });\n  rec.onerror = e => send({ type: 'record:error', error: String(e.error || e.name || 'unknown') });\n  rec.start(500);\n  video.play().catch(() => {});\n  window.__stopRecorder = () => { if (rec.state !== 'inactive') rec.stop(); };\n  alert('Đang ghi... Gọi window.__stopRecorder() trong Tab B để dừng.');\n})();`} />
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Tên video</th>
                <th>Tương đồng</th>
                <th>% Verify</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {results.length > 0 ? (
                results.map((r) => (
                  <tr key={r.rank}>
                    <td>{r.rank}</td>
                    <td>{r.name}</td>
                    <td className="percent">{r.similarity.toFixed(1)}%</td>
                    <td className="percent verify-col">
                      {verifyResult[r.path] 
                        ? verifyResult[r.path].replace('Checkmark ', '') 
                        : '0%'
                      }
                    </td>
                    <td>
                      {verifying[r.path] ? (
                        <span>
                          Loading... {verifyProgress[r.path] ?? 0}%
                        </span>
                      ) : (
                        <div className="row-actions">
                          <button onClick={() => verifyVideo(r.path)} className="btn btn-small btn-success">
                            Verify
                          </button>
                          <button onClick={() => deleteResult(r.path)} className="btn btn-small btn-danger" >
                            Xóa
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="5" className="empty">Chưa có dữ liệu</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>


    </div>

      {/* VIDEO SECTION - FULL WIDTH */}
      <section className="video-full" ref={videoSectionRef}>
        <div className="video-toolbar">
          <h2 className="video-heading">Video kết quả</h2>
          <div className="video-actions">
            <button
              className="btn btn-secondary"
              onClick={() => {
                const el = videoSectionRef.current;
                if (!el) return;
                if (el.requestFullscreen) el.requestFullscreen();
                // @ts-ignore - webkit fallback
                else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
              }}
            >
              Toàn màn hình
            </button>
          </div>
        </div>

        {results && results.length > 0 ? (
          <div className="video-grid-full">
            {results.slice(0, 6).map((r) => (
              <div className="video-card-full" key={`vf-${r.rank}`}>
                <div className="video-wrapper">
                  <video
                    src={getVideoUrl(r.path)}
                    controls
                    preload="metadata"
                  />
                </div>
                <div className="video-meta-full">
                  <div className="video-title" title={r.name}>{r.name}</div>
                  <div className="video-sub">{r.similarity.toFixed(1)}%</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="video-empty-full">Chưa có video để phát</div>
        )}
      </section>
    </>
  );
}

export default App;