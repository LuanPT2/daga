// === ĐẦU FILE server.js ===
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const fsPromises = require('fs').promises;
const cors = require('cors');
const mysql = require('mysql2/promise');
const verifyJobs = {}; // { verify_id: { status, progress, similarity } }

// ==================== CẤU HÌNH .venv ====================
const APP_ROOT = path.resolve(__dirname, '../../../');
const VENV_DIR = path.join(APP_ROOT, '.venv');
const VENV_PYTHON = path.join(VENV_DIR, 'bin', 'python');

if (!fs.existsSync(VENV_PYTHON)) {
  console.error(`[INIT] .venv/bin/python not found!`);
  console.error(`[INIT] Run: cd ${APP_ROOT} && python3 -m venv .venv`);
  process.exit(1);
}

const venvEnv = {
  ...process.env,
  PATH: `${VENV_DIR}/bin:${process.env.PATH}`,
  VIRTUAL_ENV: VENV_DIR
};

console.log(`[INIT] Using Python: ${VENV_PYTHON}`);

// ==================== CONFIG ====================
const app = express();
const PORT = process.env.PORT || 5050;
const HOST = process.env.HOST || '127.0.0.1';
const UPLOAD_DIR = path.join(APP_ROOT, 'uploads');
const SOURCE_DIR = path.join(APP_ROOT, 'source');
const SEARCH_SCRIPT = path.join(SOURCE_DIR, 'search_video.py');
const EXTRACT_SCRIPT = path.join(SOURCE_DIR, 'extract_features.py');

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/avi', 'video/mkv', 'video/webm', 'video/quicktime'];
    cb(null, allowed.includes(file.mimetype));
  },
});
fsPromises.mkdir(UPLOAD_DIR, { recursive: true }).catch(() => {});

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));

app.use((req, res, next) => {
  req.id = crypto.randomUUID().slice(0, 8);
  const start = Date.now();
  console.log(`[${req.id}] [REQ] ${req.method} ${req.originalUrl}`);
  res.on('finish', () => {
    console.log(`[${req.id}] [RES] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// ==================== MYSQL ====================
const MYSQL_HOST = process.env.MYSQL_HOST || 'mysql.local';
const MYSQL_PORT = Number(process.env.MYSQL_PORT || 30306);
const MYSQL_USER = process.env.MYSQL_USER || 'root';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || 'rootpassword';
const MYSQL_DB = process.env.MYSQL_DB || 'video_search';

let pool;

async function initDb() {
  try {
    const conn = await mysql.createConnection({
      host: MYSQL_HOST,
      port: MYSQL_PORT,
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
    });
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${MYSQL_DB}\``);
    await conn.end();

    pool = mysql.createPool({
      host: MYSQL_HOST,
      port: MYSQL_PORT,
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      database: MYSQL_DB,
      connectionLimit: 5,
    });

    console.log(`[DB] Connected to mysql://${MYSQL_USER}@${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DB}`);

    // === TỰ ĐỘNG TẠO BẢNG ĐÚNG CẤU TRÚC ===
    await createTables();

  } catch (e) {
    console.error('[DB] Connection failed:', e.message);
    process.exit(1);
  }
}

async function createTables() {
  const queries = [
    `
    CREATE TABLE IF NOT EXISTS search_requests (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      query_path TEXT NOT NULL,
      status ENUM('pending','processing','completed','failed') DEFAULT 'pending',
      request_id VARCHAR(36) NOT NULL UNIQUE,
      error TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status (status),
      INDEX idx_request_id (request_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `,

    `
    CREATE TABLE IF NOT EXISTS search_results (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      request_id VARCHAR(36) NOT NULL,
      rank_no INT NOT NULL,
      video_name VARCHAR(255),
      similarity DECIMAL(6,2),
      video_path TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_request_id (request_id),
      CONSTRAINT fk_search_results_request
        FOREIGN KEY (request_id) REFERENCES search_requests(request_id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `
  ];

  for (const query of queries) {
    await pool.query(query);
  }

  console.log('[DB] Tables created/verified successfully');
}

// ==================== UTILS ====================
async function deleteVideosInDirectory(rootDir) {
  const allowedExts = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);
  let deleted = 0;
  async function walk(current) {
    let dirents;
    try {
      dirents = await fsPromises.readdir(current, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const dirent of dirents) {
      const full = path.join(current, dirent.name);
      if (dirent.isDirectory()) {
        await walk(full);
      } else if (dirent.isFile()) {
        const ext = path.extname(dirent.name).toLowerCase();
        if (allowedExts.has(ext)) {
          try {
            await fsPromises.unlink(full);
            deleted += 1;
          } catch (_) {}
        }
      }
    }
  }
  await walk(rootDir);
  return deleted;
}

function listVideoFiles(dirPath) {
  const allowedExts = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);
  try {
    return fs.readdirSync(dirPath)
      .map(name => ({ name, full: path.join(dirPath, name) }))
      .filter(f => {
        try {
          const s = fs.statSync(f.full);
          if (!s.isFile()) return false;
          const ext = path.extname(f.name).toLowerCase();
          return allowedExts.has(ext);
        } catch(_) { return false; }
      })
      .map(f => ({ ...f, mtime: fs.statSync(f.full).mtimeMs }))
      .sort((a, b) => a.mtime - b.mtime) // oldest first
      .map(f => f.full);
  } catch(_) {
    return [];
  }
}

// ==================== JOB XỬ LÝ NỀN ====================
async function runSearchJob(videoPath, requestId, shouldCleanup = true) {
  const logId = crypto.randomUUID().slice(0, 8);
  console.log(`[${logId}] [JOB] STARTED: request_id=${requestId}`);
  console.log(`[${logId}] [JOB] Video: ${videoPath}`);

  let pythonProcess = null;

  try {
    await pool.query('UPDATE search_requests SET status = ? WHERE request_id = ?', ['processing', requestId]);
    console.log(`[${logId}] [DB] Set status = processing`);

    console.log(`[${logId}] [PYTHON] EXEC: ${VENV_PYTHON} ${SEARCH_SCRIPT} "${videoPath}" --json`);
    pythonProcess = spawn(VENV_PYTHON, [SEARCH_SCRIPT, videoPath, '--json'], {
      cwd: SOURCE_DIR,
      env: venvEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '', error = '';

    pythonProcess.stdout.on('data', d => {
      const lines = d.toString().trim().split('\n');
      lines.forEach(line => {
        const trimmed = line.trim();
        // Chấp nhận JSON array [] hoặc object {}
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
          output += line + '\n';
        } else if (trimmed) {
          console.log(`[${logId}] [PY-OUT] ${line}`);
        }
      });
    });

    pythonProcess.stderr.on('data', d => {
      const lines = d.toString().trim().split('\n');
      lines.forEach(line => line && console.error(`[${logId}] [PY-ERR] ${line}`));
      error += d.toString();
    });

    console.log(`[${logId}] [PYTHON] Process started (PID: ${pythonProcess.pid})`);

    const exitCode = await new Promise(resolve => {
      pythonProcess.on('close', resolve);
      pythonProcess.on('error', () => resolve(1));
    });

    console.log(`[${logId}] [PYTHON] Exited with code: ${exitCode}`);

    if (exitCode !== 0) throw new Error(error || `Exit code: ${exitCode}`);
    if (!output.trim()) throw new Error('No JSON output from Python');

    let results;
    try {
      results = JSON.parse(output.trim());
      console.log(`[${logId}] [PYTHON] Parsed ${results.length} results`);
    } catch (e) {
      console.error(`[${logId}] [PYTHON] JSON parse failed: ${e.message}`);
      throw new Error('Invalid JSON from Python');
    }

    const values = results.slice(0, 5).map(r => {
      const rawPath = String(r.video_path || '');
      const absPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(SOURCE_DIR, rawPath);
      return [
        requestId,
        Number(r.rank) || 0,
        String(r.video_name || 'Unknown'),
        parseFloat(r.similarity || 0).toFixed(2),
        absPath
      ];
    });

    await pool.query(
      'INSERT INTO search_results (request_id, rank_no, video_name, similarity, video_path) VALUES ?',
      [values]
    );
    console.log(`[${logId}] [DB] Saved ${values.length} results`);

    await pool.query('UPDATE search_requests SET status = ? WHERE request_id = ?', ['completed', requestId]);
    console.log(`[${logId}] [JOB] SUCCESS`);

  } catch (e) {
    console.error(`[${logId}] [JOB] FAILED: ${e.message}`);
    try {
      await pool.query(
        'UPDATE search_requests SET status = ?, error = ? WHERE request_id = ?',
        ['failed', e.message.slice(0, 1000), requestId]
      );
    } catch (_) {}
  } finally {
    if (pythonProcess) pythonProcess.kill();
    if (shouldCleanup) {
      await fsPromises.unlink(videoPath).catch(() => {});
      console.log(`[${logId}] [CLEANUP] Deleted uploaded file`);
    } else {
      console.log(`[${logId}] [CLEANUP] Skip delete for existing path`);
    }
  }
}

// ==================== ROUTES ====================
app.get('/', (_, res) => res.send('Video Similarity Backend Running'));
app.get('/health', (_, res) => res.json({ ok: true, python: VENV_PYTHON }));

app.post('/search', upload.single('video'), async (req, res) => {
  const requestId = crypto.randomUUID();
  let videoPath;

  let shouldCleanup = false;

  if (req.file) {
    // Trường hợp upload video
    videoPath = path.resolve(req.file.path);
    shouldCleanup = true;
  } else if (req.body.path) {
    // Trường hợp nhập đường dẫn
    videoPath = path.resolve(req.body.path);
    if (!fs.existsSync(videoPath)) {
      return res.status(400).json({ error: 'Đường dẫn không tồn tại' });
    }

    // Nếu là thư mục → kiểm tra xem có video không
    const stat = fs.statSync(videoPath);
    if (stat.isDirectory()) {
      const files = listVideoFiles(videoPath);
      if (!files.length) return res.status(400).json({ error: 'Thư mục không chứa video hợp lệ' });

      // Batch: tạo nhiều job, mỗi file 1 request_id
      const requestIds = [];
      for (const filePath of files) {
        const rid = crypto.randomUUID();
        await pool.query(
          'INSERT INTO search_requests (query_path, request_id, status) VALUES (?, ?, ?)',
          [filePath, rid, 'pending']
        );
        setImmediate(() => runSearchJob(filePath, rid, false));
        requestIds.push(rid);
      }
      return res.json({ batch: true, count: requestIds.length, request_ids: requestIds, request_id: requestIds[0] });
    } else {
      // Nếu là file nhưng không phải video
      const ext = path.extname(videoPath).toLowerCase();
      if (!['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)) {
        return res.status(400).json({ error: 'File không phải là video hợp lệ' });
      }
    }
  } else {
    return res.status(400).json({ error: 'Cần upload video hoặc nhập đường dẫn thư mục' });
  }

  try {
    await pool.query(
      'INSERT INTO search_requests (query_path, request_id, status) VALUES (?, ?, ?)',
      [videoPath, requestId, 'pending']
    );

    setImmediate(() => runSearchJob(videoPath, requestId, shouldCleanup));
    res.json({ request_id: requestId, status: 'pending', check_url: `/search/result/${requestId}` });
  } catch (e) {
    if (req.file) await fsPromises.unlink(videoPath).catch(() => {});
    res.status(500).json({ error: 'DB error' });
  }
});



app.get('/search/result/:requestId', async (req, res) => {
  const { requestId } = req.params;

  try {
    const [rows] = await pool.query('SELECT * FROM search_requests WHERE request_id = ?', [requestId]);
    if (!rows.length) return res.status(404).json({ error: 'Không tìm thấy' });

    const job = rows[0];
    if (job.status === 'pending') return res.json({ status: 'pending' });
    if (job.status === 'failed') return res.json({ status: 'failed', error: job.error });

    const [results] = await pool.query(
      'SELECT `rank_no` AS `result_rank`, video_name AS name, similarity, video_path AS path FROM search_results WHERE request_id = ? ORDER BY `rank_no`',
      [requestId]
    );

    res.json({
      status: 'completed',
      results: results.map(r => ({
        rank: Number(r.result_rank),
        name: String(r.name),
        similarity: Number(r.similarity),
        path: String(r.path)
      }))
    });

  } catch (e) {
    console.error(`[${req.id || '??'}] [GET RESULT] error:`, e.message);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// === THAY ĐỔI: Dùng verify_video.py ===
const VERIFY_SCRIPT = path.join(SOURCE_DIR, 'verify_video.py');

app.post('/verify/start', async (req, res) => {
  const { path: videoPath } = req.body || {};
  if (!videoPath) return res.status(400).json({ error: 'Thiếu đường dẫn video' });
  if (!fs.existsSync(videoPath)) return res.status(404).json({ error: 'Không tồn tại video' });

  const verifyId = crypto.randomUUID();
  verifyJobs[verifyId] = { status: 'processing', progress: 0, similarity: 0 };

  setImmediate(async () => {
    try {
      const python = spawn(VENV_PYTHON, [
        VERIFY_SCRIPT,
        videoPath,
        '--json'
      ], {
        cwd: SOURCE_DIR,
        env: venvEnv,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let output = '', error = '';
      python.stdout.on('data', d => {
        const lines = d.toString().trim().split('\n');
        lines.forEach(line => {
          if (line.startsWith('PROGRESS:')) {
            const match = line.match(/PROGRESS:\s*(\d+)/);
            if (match) verifyJobs[verifyId].progress = Number(match[1]);
          } else if (line.trim() && line.startsWith('{')) {
            output += line + '\n';
          } else {
            console.log(`[VERIFY] ${line}`);
          }
        });
      });
      python.stderr.on('data', d => error += d.toString());

      const code = await new Promise(r => {
        python.on('close', r);
        python.on('error', () => r(1));
      });

      if (code !== 0) throw new Error(error || `Exit ${code}`);
      if (!output.trim()) throw new Error('Không có JSON');

      let data;
      try {
        const jsonLine = output.trim().split('\n').find(l => l.trim().startsWith('{'));
        data = JSON.parse(jsonLine || '{}');
      } catch (e) {
        throw new Error("Parse JSON failed");
      }

      verifyJobs[verifyId] = {
        status: 'completed',
        progress: 100,
        similarity: data.similarity || 0,
      };
    } catch (e) {
      verifyJobs[verifyId] = { status: 'failed', error: e.message };
    }
  });

  res.json({ verify_id: verifyId });
});

app.get('/verify/status/:id', (req, res) => {
  const job = verifyJobs[req.params.id];
  if (!job) return res.status(404).json({ error: 'Không tìm thấy verify job' });
  res.json(job);
});

// Lấy kết quả gần nhất đã hoàn thành
app.get('/search/latest', async (req, res) => {
  try {
    const [reqRows] = await pool.query(
      "SELECT request_id FROM search_requests WHERE status = 'completed' ORDER BY updated_at DESC LIMIT 1"
    );
    if (!reqRows.length) return res.json({ status: 'none', results: [] });

    const latestId = reqRows[0].request_id;
    const [results] = await pool.query(
      'SELECT `rank_no` AS `result_rank`, video_name AS name, similarity, video_path AS path FROM search_results WHERE request_id = ? ORDER BY `rank_no`',
      [latestId]
    );

    return res.json({
      status: 'completed',
      request_id: latestId,
      results: results.map(r => ({
        rank: Number(r.result_rank),
        name: String(r.name),
        similarity: Number(r.similarity),
        path: String(r.path)
      }))
    });
  } catch (e) {
    console.error('[GET LATEST] error:', e.message);
    return res.status(500).json({ error: 'Lỗi server' });
  }
});

app.post('/update-db', (req, res) => {
  const python = spawn(VENV_PYTHON, [EXTRACT_SCRIPT], { cwd: SOURCE_DIR, env: venvEnv });
  let output = '', error = '';
  const timeout = setTimeout(() => python.kill('SIGKILL'), 120000);

  python.stdout.on('data', d => { output += d; console.log(`[PY-OUT] ${d}`); });
  python.stderr.on('data', d => { error += d; console.error(`[PY-ERR] ${d}`); });

  python.on('close', code => {
    clearTimeout(timeout);
    code === 0 ? res.json({ success: true }) : res.status(500).json({ error: error || 'Python failed' });
  });
});

// STREAM VIDEO VỚI RANGE SUPPORT
app.get('/video', async (req, res) => {
  try {
    const qPath = req.query.path;
    if (!qPath) return res.status(400).json({ error: 'Missing path' });

    const rawPath = String(qPath);
    const candidate = rawPath.startsWith('/') ? rawPath : path.join(APP_ROOT, rawPath);
    const filePath = path.resolve(candidate);

    // Chỉ cho phép truy cập trong thư mục dự án để tránh lộ file hệ thống
    if (!filePath.startsWith(APP_ROOT)) return res.status(403).json({ error: 'Forbidden' });

    // Chỉ cho phép các thư mục video hợp lệ
    const allowedDirs = [
      path.join(APP_ROOT, 'video'),
      path.join(APP_ROOT, 'visitdeo-livestream'),
      path.join(APP_ROOT, 'uploads')
    ];
    const isAllowed = allowedDirs.some(dir => filePath.startsWith(dir + path.sep) || filePath === dir);
    if (!isAllowed) return res.status(403).json({ error: 'Path not allowed' });

    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    const stat = await fsPromises.stat(filePath);
    const fileSize = stat.size;
    const ext = path.extname(filePath).toLowerCase();
    const type = ext === '.mp4' ? 'video/mp4' : ext === '.mov' ? 'video/quicktime' : 'video/*';

    const range = req.headers.range;
    if (range) {
      const match = /bytes=(\d+)-(\d+)?/.exec(range);
      if (!match) return res.status(416).end();
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
      if (start >= fileSize || end >= fileSize) return res.status(416).end();
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': type
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': type,
        'Accept-Ranges': 'bytes'
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (e) {
    console.error('[VIDEO] stream error:', e.message);
    return res.status(500).json({ error: 'Stream error' });
  }
});

// XÓA 1 RECORD KẾT QUẢ THEO ĐƯỜNG DẪN VIDEO
app.delete('/result', async (req, res) => {
  const { path: videoPath } = req.body || {};
  if (!videoPath) return res.status(400).json({ error: 'Thiếu đường dẫn video' });

  try {
    // Xóa record trong bảng search_results
    const [delRes] = await pool.query('DELETE FROM search_results WHERE video_path = ?', [videoPath]);
    if (delRes.affectedRows === 0) {
      return res.status(404).json({ error: 'Không tìm thấy video trong database' });
    }

    // Sau khi xóa kết quả, kiểm tra xem request_id đó còn record nào không
    const [reqCheck] = await pool.query(`
      SELECT sr.request_id
      FROM search_requests sr
      LEFT JOIN search_results r ON sr.request_id = r.request_id
      WHERE r.request_id IS NULL
    `);
    // Nếu có request không còn kết quả nào -> xóa luôn request đó
    if (reqCheck.length > 0) {
      for (const row of reqCheck) {
        await pool.query('DELETE FROM search_requests WHERE request_id = ?', [row.request_id]);
      }
    }

    return res.json({ success: true });
  } catch (e) {
    console.error('[DELETE RESULT] error:', e.message);
    return res.status(500).json({ error: 'DB error' });
  }
});

// XÓA TOÀN BỘ RECORD TRONG DATABASE (RESET)
app.delete('/reset', async (req, res) => {
  try {
    // Xóa bảng con trước để tránh ràng buộc khóa ngoại
    await pool.query('DELETE FROM search_results');
    await pool.query('DELETE FROM search_requests');
    // Xóa tất cả video trong thư mục visitdeo-livestream
    const livestreamDir = path.join(APP_ROOT, 'visitdeo-livestream');
    const deleted = await deleteVideosInDirectory(livestreamDir).catch(() => 0);
    return res.json({ success: true, deleted_videos: deleted });
  } catch (e) {
    console.error('[DB] Reset failed:', e.message);
    return res.status(500).json({ error: 'DB error' });
  }
});

// ==================== START ====================
initDb().then(() => {
  app.listen(PORT, HOST, () => {
    console.log(`Backend running at http://${HOST}:${PORT}`);
  });
}).catch(err => {
  console.error('Server failed:', err);
  process.exit(1);
});
