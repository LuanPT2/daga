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

// ==================== JOB XỬ LÝ NỀN ====================
async function runSearchJob(videoPath, requestId) {
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
        if (trimmed.startsWith('[{') || trimmed.startsWith('{"')) {
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

    const values = results.slice(0, 5).map(r => [
      requestId,
      Number(r.rank) || 0,
      String(r.video_name || 'Unknown'),
      parseFloat(r.similarity || 0).toFixed(2),
      String(r.video_path || '')
    ]);

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
    await fsPromises.unlink(videoPath).catch(() => {});
    console.log(`[${logId}] [CLEANUP] Deleted uploaded file`);
  }
}

// ==================== ROUTES ====================
app.get('/', (_, res) => res.send('Video Similarity Backend Running'));
app.get('/health', (_, res) => res.json({ ok: true, python: VENV_PYTHON }));

app.post('/search', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video uploaded' });

  const videoPath = path.resolve(req.file.path);
  const requestId = crypto.randomUUID();

  try {
    await pool.query('INSERT INTO search_requests (query_path, request_id, status) VALUES (?, ?, ?)', [videoPath, requestId, 'pending']);
    setImmediate(() => runSearchJob(videoPath, requestId));
    res.json({ request_id: requestId, status: 'pending', check_url: `/search/result/${requestId}` });
  } catch (e) {
    await fsPromises.unlink(videoPath).catch(() => {});
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

// ==================== START ====================
initDb().then(() => {
  app.listen(PORT, HOST, () => {
    console.log(`Backend running at http://${HOST}:${PORT}`);
  });
}).catch(err => {
  console.error('Server failed:', err);
  process.exit(1);
});
