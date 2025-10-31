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