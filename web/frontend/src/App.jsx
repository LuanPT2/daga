import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

function App() {
  const defaultHost = (typeof window !== 'undefined' && window.location && window.location.hostname) ? window.location.hostname : '127.0.0.1';
  const API_BASE = `http://${defaultHost}:5050`;
  const [file, setFile] = useState(null);
  const [path, setPath] = useState('/Users/luanpt/Downloads/video_daga/visitdeo-livestream');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchStatus, setSearchStatus] = useState('');
  const [recordStatus, setRecordStatus] = useState('');
  const [requestId, setRequestId] = useState(null);
  const [showReload, setShowReload] = useState(false);
  const pollInterval = useRef(null);
  const latestInterval = useRef(null);
  const videoSectionRef = useRef(null);

  // === RECORD STATES ===
  const [recording, setRecording] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [stream, setStream] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordingRef = useRef(false);
  const recordedChunksRef = useRef([]);
  const [selection, setSelection] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [segmentDuration, setSegmentDuration] = useState(15);
  const segmentTimerRef = useRef(null);

  // === AUTO SPLIT (CLIENT-SIDE AD DETECTION) ===
  const [autoSplit, setAutoSplit] = useState(false);
  const detectStepSecRef = useRef(2); // Đồng bộ với Python
  const detectThresholdRef = useRef(20); // Đồng bộ với Python
  const detectMinGapSecRef = useRef(10); // Đồng bộ với Python
  const templateHashesRef = useRef({}); // { path: BigInt }
  const detectionTimerRef = useRef(null);
  const smallCanvasRef = useRef(null);
  const captureStreamRef = useRef(null);
  const matchRecorderRef = useRef(null);
  const matchChunksRef = useRef([]);
  const matchActiveRef = useRef(false);
  const lastAdDetectAtRef = useRef(0);
  const adActiveRef = useRef(false);
  const lastDetectLogAtRef = useRef(0);

  const getVideoUrl = (p) => `${API_BASE}/video?path=${encodeURIComponent(p || '')}`;
  const formatTime = (v) => {
    if (!v) return '';
    try {
      return new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (_) { return String(v); }
  };
  const [verifying, setVerifying] = useState({});
  const [verifyProgress, setVerifyProgress] = useState({});
  const [verifyResult, setVerifyResult] = useState({});
  const [uploadLogs, setUploadLogs] = useState([]);

  // === TÌM KIẾM ===
  const search = async () => {
    if (!file && !path) return alert('Vui lòng chọn video hoặc nhập đường dẫn!');
    setLoading(true);
    setSearchStatus('');
    setShowReload(false);
    setRequestId(null);

    const form = new FormData();
    if (file) form.append('video', file);
    else form.append('path', path);

    try {
      const res = await axios.post(`${API_BASE}/search`, form);
      const { request_id } = res.data;
      setRequestId(request_id);
      setSearchStatus('Đã gửi yêu cầu, đang xử lý...');
      setShowReload(true);
      startPolling(request_id);
    } catch (err) {
      setSearchStatus('Lỗi: ' + (err.response?.data?.error || err.message));
      setShowReload(false);
    } finally {
      setLoading(false);
    }
  };

  // === POLLING ===
  const startPolling = (id) => {
    if (pollInterval.current) clearTimeout(pollInterval.current);
    const poll = async () => {
      try {
        const res = await axios.get(`${API_BASE}/search/result/${id}`);
        const data = res.data;
        if (data.status === 'pending') {
          setSearchStatus('Đang xử lý...');
          pollInterval.current = setTimeout(poll, 2000);
          return;
        }
        if (data.status === 'failed') {
          setSearchStatus(`Lỗi: ${data.error}`);
          setShowReload(false);
          clearTimeout(pollInterval.current);
          return;
        }
        if (data.status === 'completed') {
          const resArr = Array.isArray(data.results) ? data.results : [];
          if (resArr.length > 0) {
            setResults(resArr);
            setSearchStatus('Hoàn tất!');
            setShowReload(false);
            clearTimeout(pollInterval.current);
          } else {
            setSearchStatus('Chưa có kết quả...');
            pollInterval.current = setTimeout(poll, 2000);
          }
        }
      } catch (err) {
        console.error('Poll error:', err);
        setSearchStatus('Lỗi kết nối');
        setShowReload(true);
      }
    };
    poll();
  };

  // === VERIFY ===
  const verifyVideo = async (videoPath) => {
    setVerifying(prev => ({ ...prev, [videoPath]: true }));
    setVerifyProgress(prev => ({ ...prev, [videoPath]: 0 }));
    setVerifyResult(prev => ({ ...prev, [videoPath]: null }));

    try {
      const res = await axios.post(`${API_BASE}/verify/start`, { path: videoPath });
      const { verify_id } = res.data;
      if (!verify_id) throw new Error("Không có verify_id");

      const poll = async () => {
        const result = await axios.get(`${API_BASE}/verify/status/${verify_id}`);
        if (result.data.status === "processing") {
          setVerifyProgress(prev => ({ ...prev, [videoPath]: result.data.progress || 0 }));
          setTimeout(poll, 3000);
        } else if (result.data.status === "completed") {
          setVerifying(prev => ({ ...prev, [videoPath]: false }));
          setVerifyProgress(prev => ({ ...prev, [videoPath]: 100 }));
          setVerifyResult(prev => ({ ...prev, [videoPath]: `${result.data.similarity.toFixed(2)}%` }));
        } else if (result.data.status === "failed") {
          setVerifying(prev => ({ ...prev, [videoPath]: false }));
          setVerifyResult(prev => ({ ...prev, [videoPath]: `Lỗi` }));
        }
      };
      poll();
    } catch (err) {
      setVerifying(prev => ({ ...prev, [videoPath]: false }));
      setVerifyResult(prev => ({ ...prev, [videoPath]: "Lỗi verify" }));
    }
  };

  // === XÓA ===
  const deleteResult = async (videoPath) => {
    try {
      await axios.delete(`${API_BASE}/result`, { data: { path: videoPath } });
      setResults(prev => prev.filter(r => r.path !== videoPath));
    } catch (err) {
      alert("Lỗi xóa: " + (err.response?.data?.error || err.message));
    }
  };

  // === RESET DB ===
  const resetDb = async () => {
    if (!window.confirm('Xóa toàn bộ dữ liệu?')) return;
    setLoading(true);
    setSearchStatus('Đang xóa...');
    try {
      await axios.delete(`${API_BASE}/reset`);
      setResults([]);
      setRequestId(null);
      setShowReload(false);
      setSearchStatus('Đã xóa toàn bộ.');
    } catch (err) {
      setSearchStatus('Lỗi reset: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  // === AUTO LOAD LATEST ===
  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${API_BASE}/search/latest`);
        if (res.data?.results?.length > 0) {
          setResults(res.data.results);
          setRequestId(res.data.request_id || null);
          setSearchStatus('Tải kết quả gần nhất');
        }
      } catch (_) {}
    })();
  }, [API_BASE]);

  useEffect(() => {
    if (latestInterval.current) clearInterval(latestInterval.current);
    latestInterval.current = setInterval(async () => {
      if (showReload) return;
      try {
        const res = await axios.get(`${API_BASE}/search/latest`);
        if (res.data?.results) {
          setResults(res.data.results);
          setRequestId(res.data.request_id || null);
        }
      } catch (_) {}
    }, 2000);
    return () => clearInterval(latestInterval.current);
  }, [API_BASE, showReload]);

  // === CROP LOGIC ===
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
      setRecordStatus("Vùng crop đã chọn! Nhấn Start Record để bắt đầu.");
    }
  };

  // === START PREVIEW (KHÔNG CHUYỂN TAB) ===
  const startPreview = async () => {
    if (previewing) return;
    try {
      setRecordStatus("Chọn Tab B để chia sẻ (sẽ KHÔNG chuyển tab)...");

      // Dùng CaptureController để tránh chuyển focus sang Tab B (Chromium hỗ trợ)
      let controller = null;
      if (typeof window !== 'undefined' && 'CaptureController' in window) {
        controller = new window.CaptureController();
        try { controller.setFocusBehavior('no-focus-change'); } catch (_) {}
      }

      const constraints = {
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
        audio: true
      };
      if (controller) constraints.controller = controller;

      const newStream = await navigator.mediaDevices.getDisplayMedia(constraints);

      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
        await videoRef.current.play();
      }

      setStream(newStream);
      setPreviewing(true);
      setRecordStatus("Đang preview Tab B → Kéo để chọn vùng crop");

      // Nếu trình duyệt vẫn chuyển tab, thử focus lại Tab A
      if (typeof window !== 'undefined' && document.visibilityState !== 'visible') {
        setTimeout(() => { try { window.focus(); } catch (_) {} }, 0);
      }

      const videoTrack = newStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.addEventListener('ended', () => {
          console.warn('[FE] videoTrack ended (screen share stopped)');
          stopPreview();
        });
        videoTrack.addEventListener('mute', () => { console.warn('[FE] videoTrack mute'); });
        videoTrack.addEventListener('unmute', () => { console.warn('[FE] videoTrack unmute'); });
      }
      const audioTrack = newStream.getAudioTracks && newStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.addEventListener('ended', () => { console.warn('[FE] audioTrack ended'); });
      }

    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        setRecordStatus("Lỗi: " + err.message);
      } else {
        setRecordStatus("Bạn đã hủy chia sẻ.");
      }
    }
  };

  const stopPreview = () => {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      setStream(null);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setPreviewing(false);
    setRecording(false);
    setSelection(null);
    setRecordStatus("Đã dừng preview Tab B");
  };

  // === RECORD (CANVAS ẨN, KHÔNG TRÀN) ===
  const toggleRecording = async () => {
    if (!previewing) return setRecordStatus("Start preview trước!");

    if (!recording) {
      // Mỗi lần bắt đầu ghi, xóa log cũ
      setUploadLogs([]);
      // Bắt buộc phải chọn vùng cắt trước khi bắt đầu ghi
      if (!selection || selection.width <= 0 || selection.height <= 0) {
        window.alert('Vui lòng kéo chọn vùng cắt trước khi Start Record!');
        setRecordStatus('Chưa chọn vùng cắt');
        return;
      }

      // Reset DB và thư mục livestream trước khi ghi
      try {
        setRecordStatus('Đang reset dữ liệu...');
        await axios.delete(`${API_BASE}/reset`);
        setRecordStatus('Đã reset dữ liệu, chuẩn bị ghi...');
      } catch (err) {
        setRecordStatus('Lỗi reset: ' + (err.response?.data?.error || err.message));
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      const vw = video.videoWidth;
      const vh = video.videoHeight;

      // Map selection từ kích thước hiển thị sang kích thước thực tế
      const scaleX = vw / video.offsetWidth;
      const scaleY = vh / video.offsetHeight;
      const crop = {
        x: Math.max(0, Math.min(selection.x * scaleX, vw)),
        y: Math.max(0, Math.min(selection.y * scaleY, vh)),
        width: Math.min(selection.width * scaleX, vw),
        height: Math.min(selection.height * scaleY, vh),
      };

      if (crop.width === 0 || crop.height === 0) {
        return setRecordStatus("Vùng crop không hợp lệ!");
      }

      // === ĐẶT KÍCH THƯỚC CANVAS CHÍNH XÁC ===
      canvas.width = crop.width;
      canvas.height = crop.height;
      canvas.style.width = `${crop.width}px`;
      canvas.style.height = `${crop.height}px`;
      canvas.style.position = 'absolute';
      canvas.style.visibility = 'hidden';
      canvas.style.left = '-9999px';

      // Đánh dấu bắt đầu ghi sớm để vòng vẽ không bị thoát ngay
      setRecording(true);
      recordingRef.current = true;

      // === VẼ KHUNG HÌNH ===
      const draw = () => {
        if (!recordingRef.current) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
        requestAnimationFrame(draw);
      };
      draw();

      // === CAPTURE STREAM ===
      const stream = canvas.captureStream(30);
      captureStreamRef.current = stream;
      let chosenMime = '';
      if (window.MediaRecorder && typeof MediaRecorder.isTypeSupported === 'function') {
        if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) chosenMime = 'video/webm;codecs=vp8,opus';
        else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')) chosenMime = 'video/webm;codecs=vp9,opus';
        else if (MediaRecorder.isTypeSupported('video/webm')) chosenMime = 'video/webm';
      }
      mediaRecorderRef.current = chosenMime ? new MediaRecorder(stream, { mimeType: chosenMime }) : new MediaRecorder(stream);
      recordedChunksRef.current = [];

      console.log('[FE] MediaRecorder start', { mime: chosenMime || '(default)' });

      mediaRecorderRef.current.onstart = () => {
        setUploadLogs(prev => [...prev.slice(-29), { id: `start_${Date.now()}`, time: new Date().toLocaleTimeString(), status: 'rec-start', info: `Bắt đầu ghi (${chosenMime || 'default'})` }]);
      };
      mediaRecorderRef.current.ondataavailable = e => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
        console.log('[FE] ondataavailable', e.data.size);
      };

      mediaRecorderRef.current.onerror = (e) => {
        console.error('[FE] MediaRecorder error', e.error || e);
      };

      mediaRecorderRef.current.onstop = () => {
        setUploadLogs(prev => [...prev.slice(-29), { id: `stop_${Date.now()}`, time: new Date().toLocaleTimeString(), status: 'rec-stop', info: `Kết thúc 1 segment` }]);
        processSegment().then(() => {
          if (recordingRef.current && segmentDuration > 0) {
            setTimeout(() => {
              mediaRecorderRef.current.start();
              startSegmentTimer();
            }, 100);
          }
        });
      };

      mediaRecorderRef.current.start();
      startSegmentTimer();
      setRecordStatus(`Đang ghi (${crop.width}×${crop.height}${autoSplit ? ', auto split + 15s' : `, ${segmentDuration}s/segment`})`);

      // Start auto-split detection if enabled
      if (autoSplit) {
        try {
          await loadTemplates();
          startAutoSplitDetection();
        } catch (e) {
          setRecordStatus('Không tải được templates để auto split');
          setAutoSplit(false);
        }
      }
    } else {
      // Mỗi lần dừng ghi, xóa log cũ
      setUploadLogs([]);
      mediaRecorderRef.current?.stop();
      setRecording(false);
      recordingRef.current = false;
      clearTimeout(segmentTimerRef.current);
      setRecordStatus("Đã dừng ghi");

      // Stop auto-split detection and flush match if active
      stopAutoSplitDetection();
      if (matchActiveRef.current) {
        matchRecorderRef.current?.stop();
        matchActiveRef.current = false;
      }
    }
  };

  const startSegmentTimer = () => {
    if (segmentDuration <= 0) return;
    segmentTimerRef.current = setTimeout(() => {
      if (mediaRecorderRef.current?.state === 'recording') {
        setUploadLogs(prev => [...prev.slice(-29), { id: `timer_${Date.now()}`, time: new Date().toLocaleTimeString(), status: 'timer', info: `Dừng segment sau ${segmentDuration}s` }]);
        mediaRecorderRef.current.stop();
      }
    }, segmentDuration * 1000);
  };

  // === AUTO SPLIT HELPERS ===
  const resetForNewMatch = async () => {
    try {
      setRecordStatus('Đang reset dữ liệu (ván mới)...');
      await axios.delete(`${API_BASE}/reset`);
      setResults([]);
      setRequestId(null);
      setShowReload(false);
      setRecordStatus('Đã reset cho ván mới');
    } catch (err) {
      setRecordStatus('Lỗi reset (ván mới): ' + (err.response?.data?.error || err.message));
    }
  };

  const ensureSmallCanvas = () => {
    if (!smallCanvasRef.current) {
      const c = document.createElement('canvas');
      c.width = 8; c.height = 8;
      smallCanvasRef.current = c;
    }
    return smallCanvasRef.current;
  };

  const aHashFromCanvas = (sourceCanvas) => {
    const small = ensureSmallCanvas();
    const sctx = small.getContext('2d', { willReadFrequently: true });
    sctx.clearRect(0,0,8,8);
    try { sctx.drawImage(sourceCanvas, 0, 0, 8, 8); } catch (_) { return null; }
    const { data } = sctx.getImageData(0,0,8,8);
    let sum = 0;
    const gray = new Array(64);
    for (let i = 0; i < 64; i++) {
      const idx = i * 4;
      const r = data[idx], g = data[idx+1], b = data[idx+2];
      const v = 0.299*r + 0.587*g + 0.114*b;
      gray[i] = v;
      sum += v;
    }
    const mean = sum / 64;
    let bits = 0n;
    for (let i = 0; i < 64; i++) {
      bits = (bits << 1n) | (gray[i] > mean ? 1n : 0n);
    }
    return bits; // BigInt
  };

  const popcount64 = (x) => {
    let c = 0;
    let v = x < 0n ? -x : x;
    while (v > 0n) { c += Number(v & 1n); v >>= 1n; }
    return c;
  };

  const hamming64 = (a, b) => {
    if (a == null || b == null) return 64;
    return popcount64(a ^ b);
  };

  // Load all templates from folder and compute hashes
  const loadTemplates = async () => {
    try {
      const res = await axios.get(`${API_BASE}/templates`);
      const templates = res.data.templates || [];
      if (!templates.length) throw new Error('No templates in folder');
      const hashes = {};
      for (const tmplPath of templates) {
        hashes[tmplPath] = await computeTemplateHash(tmplPath);
      }
      templateHashesRef.current = hashes;
      console.log('[FE][AutoSplit] Loaded templates:', Object.keys(hashes));
    } catch (e) {
      console.error('[FE][AutoSplit] Load templates failed:', e.message);
      setRecordStatus('Lỗi load templates folder');
    }
  };

  const computeTemplateHash = async (tmplPath) => {
    const v = document.createElement('video');
    v.muted = true; v.crossOrigin = 'anonymous'; v.src = getVideoUrl(tmplPath);
    return new Promise((resolve, reject) => {
      const small = ensureSmallCanvas();
      const sctx = small.getContext('2d', { willReadFrequently: true });
      const samples = [];
      const onMeta = () => {
        const dur = Math.max(0.1, v.duration || 1);
        const times = [dur*0.2, dur*0.4, dur*0.6, dur*0.8];
        let idx = 0;
        const step = () => {
          if (idx >= times.length) {
            if (!samples.length) return reject(new Error('no samples'));
            let ones = new Array(64).fill(0);
            for (const h of samples) {
              for (let i = 0; i < 64; i++) {
                const bit = (h >> BigInt(63 - i)) & 1n;
                if (bit === 1n) ones[i] += 1;
              }
            }
            let out = 0n;
            for (let i = 0; i < 64; i++) {
              out = (out << 1n) | (ones[i] >= Math.ceil(samples.length/2) ? 1n : 0n);
            }
            resolve(out);
            return;
          }
          const onSeek = () => {
            try {
              sctx.clearRect(0,0,8,8);
              sctx.drawImage(v, 0, 0, 8, 8);
              const img = sctx.getImageData(0,0,8,8).data;
              let sum = 0; const g = new Array(64);
              for (let i = 0; i < 64; i++) { const k = i*4; const v = 0.299*img[k]+0.587*img[k+1]+0.114*img[k+2]; g[i]=v; sum+=v; }
              const mean = sum/64; let bits = 0n;
              for (let i = 0; i < 64; i++) bits = (bits<<1n) | (g[i] > mean ? 1n : 0n);
              samples.push(bits);
              idx += 1;
              setTimeout(step, 50);
            } catch (e) {
              reject(e);
            } finally {
              v.removeEventListener('seeked', onSeek);
            }
          };
          v.addEventListener('seeked', onSeek);
          v.currentTime = times[idx];
        };
        step();
      };
      if (isNaN(v.duration) || !isFinite(v.duration) || (v.duration || 0) === 0) {
        v.addEventListener('loadedmetadata', onMeta, { once: true });
      } else {
        onMeta();
      }
      v.addEventListener('error', () => reject(new Error('template load error')), { once: true });
      try { v.load(); } catch (_) {}
    });
  };

  const saveAutoMatch = async (blob) => {
    const file = new File([blob], `record_match_${Date.now()}.webm`, { type: 'video/webm' });
    const fd = new FormData();
    fd.append('video', file);
    const logId = (window?.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`);
    const startedAt = new Date().toLocaleTimeString();
    setUploadLogs(prev => [...prev.slice(-29), {
      id: logId,
      time: startedAt,
      name: file.name,
      sizeKB: Math.round(file.size / 1024),
      status: 'auto-uploading'
    }]);
    try {
      const res = await axios.post(`${API_BASE}/save-video-auto`, fd);
      setRecordStatus(`Auto-saved: ${res.data.filename}`);
      setUploadLogs(prev => prev.map(l => l.id === logId ? { ...l, status: 'auto-saved', localFile: file.name, serverFile: res.data.filename, serverPath: res.data.path } : l));
    } catch (err) {
      setRecordStatus('Lỗi auto-save: ' + (err.response?.data?.error || err.message));
      setUploadLogs(prev => prev.map(l => l.id === logId ? { ...l, status: 'auto-error', error: (err.response?.data?.error || err.message) } : l));
    }
  };

  const startMatchRecorder = () => {
    if (!captureStreamRef.current || matchActiveRef.current) return;
    matchChunksRef.current = [];
    let mr;
    try {
      mr = new MediaRecorder(captureStreamRef.current, { mimeType: 'video/webm;codecs=vp8,opus' });
    } catch (_) {
      mr = new MediaRecorder(captureStreamRef.current);
    }
    matchRecorderRef.current = mr;
    mr.ondataavailable = e => { if (e.data.size > 0) matchChunksRef.current.push(e.data); };
    mr.onstop = async () => {
      const blob = new Blob(matchChunksRef.current, { type: 'video/webm' });
      matchChunksRef.current = [];
      console.log('[FE][AutoSplit] match recorder stopped, uploading...');
      try { await saveAutoMatch(blob); } catch (_) {}
    };
    mr.start();
    matchActiveRef.current = true;
    setRecordStatus('Đang ghi trận (auto)');
    setUploadLogs(prev => [...prev.slice(-29), { id: `auto_start_${Date.now()}`, time: new Date().toLocaleTimeString(), status: 'auto-start', info: 'Bắt đầu trận (auto)' }]);
    console.log('[FE][AutoSplit] match recorder started');
  };

  const stopMatchRecorder = () => {
    if (!matchActiveRef.current) return;
    matchRecorderRef.current?.stop();
    matchActiveRef.current = false;
    setRecordStatus('Kết thúc trận (auto)');
    setUploadLogs(prev => [...prev.slice(-29), { id: `auto_stop_${Date.now()}`, time: new Date().toLocaleTimeString(), status: 'auto-stop', info: 'Kết thúc trận (auto)' }]);
    console.log('[FE][AutoSplit] match recorder stop requested');
  };

  const startAutoSplitDetection = () => {
    stopAutoSplitDetection();
    lastAdDetectAtRef.current = 0;
    adActiveRef.current = false;
    console.log('[FE][AutoSplit] detection started', { step: detectStepSecRef.current, threshold: detectThresholdRef.current, min_gap: detectMinGapSecRef.current });
    detectionTimerRef.current = setInterval(() => {
      try {
        if (!canvasRef.current) return;
        const h = aHashFromCanvas(canvasRef.current);
        if (h == null) return;
        let best_dist = 64;
        let best_tmpl = null;
        for (const [tmpl, ref_h] of Object.entries(templateHashesRef.current)) {
          const dist = hamming64(ref_h, h);
          if (dist < best_dist) {
            best_dist = dist;
            best_tmpl = tmpl;
          }
        }
        const now = performance.now() / 1000;
        const debounce = detectMinGapSecRef.current;
        if ((now - (lastDetectLogAtRef.current || 0)) >= 1) {
          console.log('[FE][AutoSplit] tick', { best_dist, threshold: detectThresholdRef.current, adActive: adActiveRef.current, best_tmpl });
          lastDetectLogAtRef.current = now;
        }
        if (best_dist <= detectThresholdRef.current) {
          if (!adActiveRef.current) {
            adActiveRef.current = true;
            console.log('[FE][AutoSplit] AD START', { best_dist, best_tmpl });
            if (matchActiveRef.current) stopMatchRecorder();
          }
          lastAdDetectAtRef.current = now;
        } else {
          if (adActiveRef.current && (now - lastAdDetectAtRef.current) >= debounce) {
            adActiveRef.current = false;
            console.log('[FE][AutoSplit] AD END → start match');
            if (!matchActiveRef.current) {
              resetForNewMatch().finally(() => startMatchRecorder());
            }
          }
        }
      } catch (_) {}
    }, Math.max(200, detectStepSecRef.current * 1000));
  };

  const stopAutoSplitDetection = () => {
    if (detectionTimerRef.current) clearInterval(detectionTimerRef.current);
    detectionTimerRef.current = null;
    adActiveRef.current = false;
  };

  const saveVideoToDisk = async (blob) => {
    const file = new File([blob], `segment_${Date.now()}.webm`, { type: 'video/webm' });
    const fd = new FormData();
    fd.append('video', file);
  
    try {
      setRecordStatus('Đang lưu video vào ổ cứng...');
      console.log('[FE] POST /save-video start', { name: file.name, size: file.size, type: file.type, url: `${API_BASE}/save-video` });
      const logId = (window?.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`);
      const startedAt = new Date().toLocaleTimeString();
      setUploadLogs(prev => [...prev.slice(-29), {
        id: logId,
        time: startedAt,
        name: file.name,
        sizeKB: Math.round(file.size / 1024),
        status: 'uploading'
      }]);
      const res = await axios.post(`${API_BASE}/save-video`, fd);
      console.log('[FE] POST /save-video ok', res.data);
      setRecordStatus(`Đã lưu: ${res.data.filename}`);
      setUploadLogs(prev => prev.map(l => l.id === logId ? { ...l, status: 'saved', serverFile: res.data.filename, serverPath: res.data.path } : l));
      return res.data.path;
    } catch (err) {
      console.error('[FE] POST /save-video error', err);
      setRecordStatus('Lỗi lưu: ' + (err.response?.data?.error || err.message));
      setUploadLogs(prev => prev.map(l => l.status === 'uploading' ? { ...l, status: 'error', error: (err.response?.data?.error || err.message) } : l));
      throw err;
    }
  };
  
  const processSegment = async () => {
    if (recordedChunksRef.current.length === 0) return;
    const blob = new Blob(recordedChunksRef.current, { type: "video/webm" });
    setUploadLogs(prev => [...prev.slice(-29), { id: `proc_${Date.now()}`, time: new Date().toLocaleTimeString(), status: 'proc', info: `Chuẩn bị upload, chunks=${recordedChunksRef.current.length}, size≈${Math.round(blob.size/1024)}KB` }]);

    try {
      const savedPath = await saveVideoToDisk(blob);
      setRecordStatus(`Đã lưu segment: ${savedPath}`);
    } catch (err) {
      // lỗi đã xử lý trong saveVideoToDisk
    } finally {
      recordedChunksRef.current = [];
    }
  };

  useEffect(() => {
    return () => {
      stopPreview();
      clearTimeout(pollInterval.current);
      clearInterval(latestInterval.current);
      clearTimeout(segmentTimerRef.current);
    };
  }, []);

  return (
    <>
      {/* === 2 CỘT === */}
      <div className="main-layout">
        {/* === CỘT TRÁI: TÌM KIẾM + BẢNG === */}
        <div className="left-panel">
          <div className="panel">
            <h2 className="heading">Tìm kiếm video</h2>
            <div className="grid grid-2">
              <div className="form-group">
                <label className="label">Tải lên</label>
                <input type="file" accept="video/*" onChange={e => setFile(e.target.files[0])} className="file" disabled={loading} />
              </div>
              <div className="form-group">
                <label className="label">Hoặc đường dẫn</label>
                <input type="text" value={path} onChange={e => setPath(e.target.value)} className="input" disabled={loading} />
              </div>
            </div>
            <div className="actions">
              <button onClick={search} disabled={loading} className="btn btn-primary">
                {loading ? 'Đang gửi…' : 'Tìm kiếm'}
              </button>
              <button onClick={resetDb} disabled={loading} className="btn btn-danger">Reset DB</button>
            </div>
            <div className={`status ${searchStatus.startsWith('Lỗi') ? 'err' : searchStatus ? 'ok' : ''}`}>{searchStatus}</div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>#</th><th>Tên</th><th>%</th><th>Thời gian</th><th>Verify</th><th></th></tr>
              </thead>
              <tbody>
                {results.length > 0 ? results.map(r => (
                  <tr key={r.rank}>
                    <td>{r.rank}</td>
                    <td>{r.name}</td>
                    <td className="percent">{r.similarity.toFixed(1)}%</td>
                    <td>{formatTime(r.created_at)}</td>
                    <td className="percent verify-col">
                      {verifyResult[r.path] || '0%'}
                    </td>
                    <td>
                      {verifying[r.path] ? (
                        <span>Loading... {verifyProgress[r.path] || 0}%</span>
                      ) : (
                        <div className="row-actions">
                          <button onClick={() => verifyVideo(r.path)} className="btn btn-small btn-success">Verify</button>
                          <button onClick={() => deleteResult(r.path)} className="btn btn-small btn-danger">Xóa</button>
                        </div>
                      )}
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan="5" className="empty">Chưa có dữ liệu</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* === CỘT PHẢI: RECORD === */}
        <div className="right-panel">
          <div className="panel">
            <h2 className="heading">Record Tab B</h2>
            <div className="video-actions">
              <button className="btn btn-primary" onClick={startPreview} disabled={previewing}>
                {previewing ? 'Đang preview...' : 'Start Preview'}
              </button>
              <button className="btn btn-secondary" onClick={stopPreview} disabled={!previewing}>Stop</button>
              <button className="btn btn-success" onClick={toggleRecording} disabled={!previewing}>
                {recording ? 'Stop Record' : 'Start Record'}
              </button>
              <div className="form-group inline">
                <span className="label">Segment (s):</span>
                <input type="number" value={segmentDuration} onChange={e => setSegmentDuration(+e.target.value)} min="1" max="60" className="input" style={{width:60}} />
              </div>
            <div className="form-group inline" style={{marginLeft: 12}}>
              <label style={{display:'flex',alignItems:'center',gap:6}}>
                <input type="checkbox" checked={autoSplit} onChange={e => setAutoSplit(e.target.checked)} />
                <span>Auto Split</span>
              </label>
            </div>
            </div>

            {!previewing && (
              <p style={{fontSize: '13px', color: 'var(--muted)', marginTop: '8px'}}>
                Bấm nút → Chọn <strong>Tab B</strong> → Chia sẻ → <strong>Tab A vẫn ở đây</strong>
              </p>
            )}


            {/* Upload logs moved below preview */}

            <div
              className="video-preview-container"
              style={{ display: previewing ? 'block' : 'none' }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
            >
              <video ref={videoRef} autoPlay muted className="video-preview" />
              {selection && (
                <div className="selection-box" style={{
                  left: selection.x,
                  top: selection.y,
                  width: selection.width,
                  height: selection.height,
                }} />
              )}
            </div>
            <div className={`status ${recordStatus.startsWith('Lỗi') ? 'err' : recordStatus ? 'ok' : ''}`}>{recordStatus}</div>

            <canvas ref={canvasRef} style={{ position: 'absolute', left: '-9999px', visibility: 'hidden' }} />

            {/* Upload logs (saved & auto-saved entries, last 5 lines), below preview */}
            {uploadLogs.some(l => l.status === 'saved' || l.status === 'auto-saved') && (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
                <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Upload log</div>
                <div style={{ maxHeight: 70, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8, background: '#0b1324' }}>
                  {uploadLogs.filter(l => l.status === 'saved' || l.status === 'auto-saved').slice(-5).reverse().map((l, idx) => (
                    <div key={l.id || `saved_${idx}`} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 0' }}>
                      <span style={{ minWidth: 74, color: 'var(--muted)' }}>[{l.time}]</span>
                      {l.status === 'auto-saved' ? (
                        <span style={{ color: 'var(--success)' }}>
                          {`Đã lưu ${l.localFile || 'record_match.webm'}`}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--success)' }}>
                          {`Đã lưu ${l.serverFile}`}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* === VIDEO FULL WIDTH === */}
      <section className="video-full" ref={videoSectionRef}>
        <div className="video-toolbar">
          <h2 className="video-heading">Video kết quả</h2>
          <button className="btn btn-secondary" onClick={() => videoSectionRef.current?.requestFullscreen()}>
            Toàn màn hình
          </button>
        </div>
        {results.length > 0 ? (
          <div className="video-grid-full">
            {results.slice(0, 6).map(r => (
              <div className="video-card-full" key={r.rank}>
                <div className="video-wrapper">
                  <video src={getVideoUrl(r.path)} controls preload="metadata" />
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