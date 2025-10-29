import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

function App() {
  const API_BASE = `http://${window.location.hostname}:5050`;
  const [file, setFile] = useState(null);
  const [path, setPath] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [requestId, setRequestId] = useState(null);
  const [showReload, setShowReload] = useState(false); // ĐÃ SỬA: useState
  const pollInterval = useRef(null);

  // === GỬI YÊU CẦU TÌM KIẾM ===
  const search = async () => {
    if (!file) return alert('Vui lòng chọn video để upload!');

    setLoading(true);
    setResults([]);
    setStatus('');
    setShowReload(false);
    setRequestId(null);

    const form = new FormData();
    form.append('video', file);

    try {
      const res = await axios.post(`${API_BASE}/search`, form);
      const { request_id } = res.data;

      setRequestId(request_id);
      setStatus('Đã gửi yêu cầu, đang xử lý...');
      setShowReload(true);

      // Bắt đầu poll kết quả
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

  // === NÚT TẢI LẠI KẾT QUẢ ===
  const reloadResults = () => {
    if (!requestId) return;
    setStatus('Đang tải kết quả...');
    startPolling(requestId);
  };

  // === DỪNG POLL KHI UNMOUNT ===
  useEffect(() => {
    return () => {
      if (pollInterval.current) clearTimeout(pollInterval.current); // ĐÃ SỬA
    };
  }, []);

  return (
    <div className="container">
      <h1 className="heading">Tìm Video Tương Đồng</h1>
      <div className="subheading">
        Upload video hoặc nhập đường dẫn → hệ thống xử lý nền → nhấn <strong>Tải kết quả</strong> khi sẵn sàng.
      </div>

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
              placeholder="/path/to/video.mov"
              disabled={loading}
            />
          </div>
        </div>

        <div className="actions">
          <button onClick={search} disabled={loading} className="btn btn-primary">
            {loading ? 'Đang gửi…' : 'Tìm kiếm'}
          </button>

          {showReload && (
            <button onClick={reloadResults} className="btn btn-secondary">
              Tải kết quả
            </button>
          )}
        </div>

        <div className={`status ${status.startsWith('Lỗi') ? 'err' : status ? 'ok' : ''}`}>
          {status}
        </div>

        {results.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Tên video</th>
                  <th>Tương đồng</th>
                  <th>Đường dẫn</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.rank}>
                    <td>{r.rank}</td>
                    <td>{r.name}</td>
                    <td className="percent">{r.similarity.toFixed(1)}%</td>
                    <td className="path">{r.path}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="footer">CLIP + FAISS • Xử lý nền • MySQL</div>
    </div>
  );
}

export default App;