// === ĐẦU FILE server.js ===
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const fsPromises = require('fs').promises;
const cors = require('cors');
const mysql = require('mysql2/promise');
const axios = require('axios');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const verifyJobs = {}; // { verify_id: { status, progress, similarity } }

// ==================== CẤU HÌNH ====================
// Chỉ dùng environment variable cho Docker
const DATA_DIR = process.env.DATA_DIR || '/data/daga/1daga';

// Python Processing Service URL
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://192.168.132.134:5051';

console.log(`[INIT] Python Service URL: ${PYTHON_SERVICE_URL}`);

// ==================== CONFIG ====================
const app = express();
const PORT = process.env.PORT || 5050;
const HOST = process.env.HOST || '127.0.0.1';
const UPLOAD_DIR = path.join(DATA_DIR, '4uploads');
const LIVESTREAM_DIR = path.join(DATA_DIR, '5video-livestream');
const VIDEO_OUT_DIR = path.join(DATA_DIR, '2video');
const TEMPLATE_DIR = path.join(DATA_DIR, '6video_cut');

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/avi', 'video/mkv', 'video/webm', 'video/quicktime'];
    cb(null, allowed.includes(file.mimetype));
  },
});
fsPromises.mkdir(UPLOAD_DIR, { recursive: true }).catch(() => {});
fsPromises.mkdir(LIVESTREAM_DIR, { recursive: true }).catch(() => {});
fsPromises.mkdir(VIDEO_OUT_DIR, { recursive: true }).catch(() => {});
fsPromises.mkdir(TEMPLATE_DIR, { recursive: true }).catch(() => {});

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/video', express.static(LIVESTREAM_DIR));
app.use('/video-out', express.static(VIDEO_OUT_DIR));

// ==================== SWAGGER ====================
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Video Similarity Search API',
      version: '1.0.0',
      description: 'API documentation for Video Similarity Search Backend',
      contact: {
        name: 'API Support',
      },
    },
    servers: [
      {
        url: `http://localhost:${PORT}`,
        description: 'Development server',
      },
    ],
  },
  apis: ['./server.js'], // Path to the API files
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

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
const MYSQL_HOST = process.env.MYSQL_HOST || 'localhost';
const MYSQL_PORT = Number(process.env.MYSQL_PORT || 3306);
const MYSQL_USER = process.env.MYSQL_USER || 'root';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || 'abcd1234';
const MYSQL_DB = process.env.MYSQL_DB || 'video_search';

console.log(`[INIT] MySQL Config: ${MYSQL_USER}@${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DB}`);

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
      result_match TINYINT(1) NULL COMMENT '0=xanh thắng, 1=đỏ thắng, NULL=chưa xác định',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_request_id (request_id),
      CONSTRAINT fk_search_results_request
        FOREIGN KEY (request_id) REFERENCES search_requests(request_id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `
  ];

  // Execute CREATE TABLE queries
  for (const query of queries) {
    await pool.query(query);
  }

  // Migration: Add result_match column if table exists but column doesn't
  try {
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'search_results' 
      AND COLUMN_NAME = 'result_match'
    `);
    
    if (columns.length === 0) {
      await pool.query(`
        ALTER TABLE search_results 
        ADD COLUMN result_match TINYINT(1) NULL 
        COMMENT '0=xanh thắng, 1=đỏ thắng, NULL=chưa xác định'
      `);
      console.log('[DB] Added result_match column to search_results table');
    }
  } catch (e) {
    // Ignore if column already exists or table doesn't exist yet
    if (e.code !== 'ER_DUP_FIELDNAME') {
      console.warn('[DB] Migration warning:', e.message);
    }
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

// Giữ lại tối đa maxCount video trong thư mục livestream, xóa cũ nhất trước
async function enforceLivestreamRetention(maxCount = 5) {
  try {
    const files = listVideoFiles(LIVESTREAM_DIR); // oldest first
    if (files.length <= maxCount) return 0;
    const surplus = files.length - maxCount;
    let deleted = 0;
    for (const filePath of files.slice(0, surplus)) {
      try {
        await fsPromises.unlink(filePath);
        deleted += 1;
        console.log(`[RETENTION] Deleted old video: ${path.basename(filePath)}`);
      } catch (_) {}
    }
    return deleted;
  } catch (_) {
    return 0;
  }
}

// ==================== JOB XỬ LÝ NỀN ====================
async function runSearchJob(videoPath, requestId, shouldCleanup = true) {
  const logId = crypto.randomUUID().slice(0, 8);
  console.log(`[${logId}] [JOB] STARTED: request_id=${requestId}`);
  console.log(`[${logId}] [JOB] Video: ${videoPath}`);

  try {
    await pool.query('UPDATE search_requests SET status = ? WHERE request_id = ?', ['processing', requestId]);
    console.log(`[${logId}] [DB] Set status = processing`);

    // Chuẩn hóa đường dẫn trước khi gửi cho Python API
    let normalizedVideoPath = videoPath;
    
    // Nếu đường dẫn là Windows path (có dấu :) và đang chạy trong Docker
    if (videoPath.includes(':/') && process.platform === 'linux') {
      // Chuyển đổi Windows path sang Docker path
      const windowsDataDir = 'D:/3data/1daga';
      const dockerDataDir = '/data/daga/1daga';
      if (videoPath.startsWith(windowsDataDir)) {
        normalizedVideoPath = videoPath.replace(windowsDataDir, dockerDataDir).replace(/\\/g, '/');
      }
    }
    
    // Gọi Python service qua HTTP
    console.log(`[${logId}] [PYTHON] Calling service: ${PYTHON_SERVICE_URL}/search`);
    console.log(`[${logId}] [PYTHON] Video path: ${normalizedVideoPath}`);
    const response = await axios.post(`${PYTHON_SERVICE_URL}/search`, {
      video_path: normalizedVideoPath
    }, {
      timeout: 300000 // 5 minutes timeout
    });

    const results = response.data;
    if (!Array.isArray(results)) {
      throw new Error('Invalid response from Python service');
    }

    console.log(`[${logId}] [PYTHON] Received ${results.length} results`);

    const values = results.slice(0, 20).map((r, idx) => {
      let rawPath = String(r.video_path || '');
      let finalPath = rawPath;
      
      // Xử lý đường dẫn Windows trong môi trường Docker
      if (rawPath.includes(':/') || rawPath.includes('\\')) {
        // Đây là đường dẫn Windows, giữ nguyên không cần resolve
        finalPath = rawPath;
      } else if (path.isAbsolute(rawPath)) {
        // Đường dẫn tuyệt đối Unix
        finalPath = rawPath;
      } else {
        // Đường dẫn tương đối
        finalPath = path.resolve(rawPath);
      }
      
      return [
        requestId,
        Number(r.rank) || (idx + 1),
        String(r.video_name || 'Unknown'),
        parseFloat(r.similarity || 0).toFixed(2),
        finalPath
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
    if (e.response) {
      console.error(`[${logId}] [PYTHON] Service error: ${e.response.data}`);
    }
    try {
      await pool.query(
        'UPDATE search_requests SET status = ?, error = ? WHERE request_id = ?',
        ['failed', e.message.slice(0, 1000), requestId]
      );
    } catch (_) {}
  } finally {
    if (shouldCleanup) {
      await fsPromises.unlink(videoPath).catch(() => {});
      console.log(`[${logId}] [CLEANUP] Deleted uploaded file`);
    } else {
      console.log(`[${logId}] [CLEANUP] Skip delete for existing path`);
    }
  }
}

// ==================== ROUTES ====================
/**
 * @swagger
 * /:
 *   get:
 *     summary: Root endpoint
 *     tags: [General]
 *     responses:
 *       200:
 *         description: Backend is running
 */
app.get('/', (_, res) => res.send('Video Similarity Backend Running'));

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     tags: [General]
 *     description: Check if backend and Python service are running
 *     responses:
 *       200:
 *         description: All services are healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 backend:
 *                   type: string
 *                 python:
 *                   type: string
 *       500:
 *         description: Service unavailable
 */
app.get('/health', async (_, res) => {
  try {
    // Check Python service health
    const pyHealth = await axios.get(`${PYTHON_SERVICE_URL}/health`).catch(() => null);
    res.json({ 
      ok: true, 
      python_service: pyHealth ? 'connected' : 'disconnected',
      python_service_url: PYTHON_SERVICE_URL
    });
  } catch (e) {
    res.json({ ok: true, python_service: 'disconnected', error: e.message });
  }
});

// Save uploaded video directly to livestream folder (no search job)
const uploadLivestream = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, LIVESTREAM_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.webm';
      const name = `record_${Date.now()}${ext}`;
      cb(null, name);
    }
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['video/mp4', 'video/avi', 'video/mkv', 'video/webm', 'video/quicktime'];
    cb(null, allowed.includes(file.mimetype));
  }
});

app.post('/save-video', uploadLivestream.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      console.warn(`[${req.id}] [SAVE-VIDEO] No file in request`);
      return res.status(400).json({ error: 'No video uploaded' });
    }
    const savedPath = path.join(LIVESTREAM_DIR, req.file.filename);
    console.log(
      `[${req.id}] [SAVE-VIDEO] ${req.file.originalname || req.file.filename} ` +
      `(${req.file.mimetype || 'unknown'}, ${req.file.size || 0}B) -> ${savedPath}`
    );
    // Enforce retention: keep only latest 5 videos
    await enforceLivestreamRetention(5);
    return res.json({ success: true, path: savedPath, filename: req.file.filename });
  } catch (e) {
    console.error(`[${req.id}] [SAVE-VIDEO] ERROR: ${e.message}`);
    return res.status(500).json({ error: e.message || 'Save failed' });
  }
});

// Đầu file, thay đổi uploadAutoMatch
const uploadAutoMatch = multer({
  dest: VIDEO_OUT_DIR, // lưu tạm vào VIDEO_OUT_DIR
});

// Save auto-split match video with timestamp naming
app.post('/save-video-auto', uploadAutoMatch.single('video'), async (req, res) => {
  console.log(`[${req.id}] [SAVE-AUTO] REQUEST RECEIVED`);
  try {
    if (!req.file) {
      console.error(`[${req.id}] [SAVE-AUTO] No file in request`);
      return res.status(400).json({ error: 'No video uploaded' });
    }

    // === TẠO TÊN FILE THEO NGÀY GIỜ ===
    const now = new Date();
    const timestamp = now.toISOString()
      .replace(/[-:T]/g, '')
      .replace(/\.\d+Z$/, ''); // → 20251103154512
    const newFilename = `videoauto_${timestamp}.webm`;

    // Đường dẫn cũ (tạm) và mới
    const oldPath = req.file.path;
    const newPath = path.join(VIDEO_OUT_DIR, newFilename);

    // Đổi tên file
    await fsPromises.rename(oldPath, newPath);

    console.log(`[${req.id}] [SAVE-AUTO] Renamed: ${path.basename(oldPath)} → ${newFilename}`);
    console.log(`[${req.id}] [SAVE-AUTO] Saved to: ${newPath}`);

    return res.json({
      success: true,
      path: newPath,
      filename: newFilename
    });
  } catch (e) {
    console.error(`[${req.id}] [SAVE-AUTO] ERROR: ${e.message}`);
    return res.status(500).json({ error: e.message || 'Save failed' });
  }
});

/**
 * @swagger
 * /template:
 *   get:
 *     summary: Get template video for client-side detection
 *     tags: [Templates]
 *     description: Stream the default template video (cut.mov) for client-side ad/logo detection
 *     responses:
 *       200:
 *         description: Template video stream
 *         content:
 *           video/quicktime:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Template not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Template not found
 *       500:
 *         description: Server error
 */
// Serve template ad/logo clip for client-side detection (default path video_cut/cut.mov)
app.get('/template', async (_req, res) => {
  try {
    const templatePath = path.join(TEMPLATE_DIR, 'cut.mov');
    if (!fs.existsSync(templatePath)) return res.status(404).json({ error: 'Template not found' });
    const stat = await fsPromises.stat(templatePath);
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': 'video/quicktime',
      'Accept-Ranges': 'bytes'
    });
    fs.createReadStream(templatePath).pipe(res);
  } catch (e) {
    console.error('[TEMPLATE] error:', e.message);
    return res.status(500).json({ error: 'Template stream error' });
  }
});

/**
 * @swagger
 * /templates:
 *   get:
 *     summary: List all template videos
 *     tags: [Templates]
 *     description: Get list of all template video files in the template directory (/data/daga/1daga/6video_cut)
 *     responses:
 *       200:
 *         description: List of template paths (may be empty if no templates found)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 templates:
 *                   type: array
 *                   items:
 *                     type: string
 *                   description: Array of absolute paths to template video files
 *                   example: ["/data/daga/1daga/6video_cut/cut.mov", "/data/daga/1daga/6video_cut/ad1.mp4"]
 *                 message:
 *                   type: string
 *                   description: Optional message (e.g., if directory doesn't exist)
 *                   example: "Template directory does not exist"
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 details:
 *                   type: string
 */
// List all template clips under TEMPLATE_DIR (absolute paths)
app.get('/templates', async (_req, res) => {
  try {
    const allowedExts = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);
    let files = [];
    
    // Check if template directory exists
    if (!fs.existsSync(TEMPLATE_DIR)) {
      console.warn(`[TEMPLATES] Directory does not exist: ${TEMPLATE_DIR}`);
      return res.json({ templates: [], message: 'Template directory does not exist' });
    }
    
    try {
      const names = await fsPromises.readdir(TEMPLATE_DIR);
      files = names
        .filter(name => allowedExts.has(path.extname(name).toLowerCase()))
        .map(name => path.join(TEMPLATE_DIR, name));
      
      console.log(`[TEMPLATES] Found ${files.length} template(s) in ${TEMPLATE_DIR}`);
      if (files.length === 0) {
        console.warn(`[TEMPLATES] No video files found in ${TEMPLATE_DIR}. Allowed extensions: ${Array.from(allowedExts).join(', ')}`);
      }
    } catch (readError) {
      console.error(`[TEMPLATES] Failed to read directory ${TEMPLATE_DIR}:`, readError.message);
      return res.status(500).json({ error: `Cannot read template directory: ${readError.message}` });
    }
    
    return res.json({ templates: files });
  } catch (e) {
    console.error('[TEMPLATES] error:', e.message);
    return res.status(500).json({ error: 'List templates error', details: e.message });
  }
});

/**
 * @swagger
 * /search:
 *   post:
 *     summary: Search for similar videos
 *     tags: [Search]
 *     description: Upload a video file or provide a path to search for similar videos. Can handle single file or directory (batch search).
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               video:
 *                 type: string
 *                 format: binary
 *                 description: Video file to search
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               path:
 *                 type: string
 *                 description: Path to video file or directory on server
 *                 example: "/data/daga/1daga/2video/sample.mp4"
 *     responses:
 *       200:
 *         description: Search request created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 requestId:
 *                   type: string
 *                   description: Unique request ID for tracking search progress
 *                   example: "550e8400-e29b-41d4-a716-446655440000"
 *                 message:
 *                   type: string
 *                   example: "Search job started"
 *       400:
 *         description: Bad request (invalid path, no video files, etc.)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       500:
 *         description: Server error
 */
app.post('/search', upload.single('video'), async (req, res) => {
  const requestId = crypto.randomUUID();
  let videoPath;

  let shouldCleanup = false;
  console.log(`[${req.id}] [SEARCH] start request_id=${requestId}`);

  if (req.file) {
    // Trường hợp upload video
    videoPath = path.resolve(req.file.path);
    shouldCleanup = true;
    console.log(`[${req.id}] [SEARCH] source=upload file=${req.file.originalname || req.file.filename} saved=${videoPath}`);
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
        console.log(`[${req.id}] [SEARCH] queued request_id=${rid} path=${filePath}`);
      }
      return res.json({ batch: true, count: requestIds.length, request_ids: requestIds, request_id: requestIds[0] });
    } else {
      // Nếu là file nhưng không phải video
      const ext = path.extname(videoPath).toLowerCase();
      if (!['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)) {
        return res.status(400).json({ error: 'File không phải là video hợp lệ' });
      }
      console.log(`[${req.id}] [SEARCH] source=path file=${videoPath}`);
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
    console.log(`[${req.id}] [SEARCH] queued request_id=${requestId} path=${videoPath}`);
    res.json({ request_id: requestId, status: 'pending', check_url: `/search/result/${requestId}` });
  } catch (e) {
    if (req.file) await fsPromises.unlink(videoPath).catch(() => {});
    console.error(`[${req.id}] [SEARCH] DB error: ${e.message}`);
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
      'SELECT `rank_no` AS `result_rank`, video_name AS name, similarity, video_path AS path, result_match, created_at FROM search_results WHERE request_id = ? ORDER BY `rank_no`',
      [requestId]
    );

    res.json({
      status: 'completed',
      results: results.map(r => ({
        rank: Number(r.result_rank),
        name: String(r.name),
        similarity: Number(r.similarity),
        path: String(r.path),
        result_match: r.result_match !== null ? Number(r.result_match) : null,
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
      }))
    });

  } catch (e) {
    console.error(`[${req.id || '??'}] [GET RESULT] error:`, e.message);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

/**
 * @swagger
 * /search/result/{requestId}/match:
 *   put:
 *     summary: Update match result for a search result
 *     tags: [Search]
 *     description: Update result_match field (0=xanh thắng, 1=đỏ thắng, null=chưa xác định)
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *         description: Request ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - video_path
 *               - result_match
 *             properties:
 *               video_path:
 *                 type: string
 *                 description: Video path to identify the result
 *               result_match:
 *                 type: integer
 *                 nullable: true
 *                 enum: [0, 1, null]
 *                 description: 0=xanh thắng, 1=đỏ thắng, null=chưa xác định
 *                 example: 0
 *     responses:
 *       200:
 *         description: Updated successfully
 *       400:
 *         description: Bad request
 *       404:
 *         description: Result not found
 *       500:
 *         description: Server error
 */
app.put('/search/result/:requestId/match', async (req, res) => {
  const { requestId } = req.params;
  const { video_path, result_match } = req.body;

  if (!video_path) {
    return res.status(400).json({ error: 'Thiếu video_path' });
  }

  // Validate result_match: must be 0, 1, or null
  if (result_match !== null && result_match !== 0 && result_match !== 1) {
    return res.status(400).json({ error: 'result_match phải là 0, 1 hoặc null' });
  }

  try {
    const [updateResult] = await pool.query(
      'UPDATE search_results SET result_match = ? WHERE request_id = ? AND video_path = ?',
      [result_match, requestId, video_path]
    );

    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ error: 'Không tìm thấy kết quả' });
    }

    res.json({ success: true, result_match });
  } catch (e) {
    console.error(`[${req.id || '??'}] [UPDATE MATCH] error:`, e.message);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.post('/verify/start', async (req, res) => {
  const { path: videoPath } = req.body || {};
  if (!videoPath) return res.status(400).json({ error: 'Thiếu đường dẫn video' });
  if (!fs.existsSync(videoPath)) return res.status(404).json({ error: 'Không tồn tại video' });

  const verifyId = crypto.randomUUID();
  verifyJobs[verifyId] = { status: 'processing', progress: 0, similarity: 0 };

  setImmediate(async () => {
    try {
      // Gọi Python service qua HTTP
      const response = await axios.post(`${PYTHON_SERVICE_URL}/verify`, {
        video_path: videoPath
      }, {
        timeout: 300000 // 5 minutes
      });

      verifyJobs[verifyId] = {
        status: 'completed',
        progress: 100,
        similarity: response.data.similarity || 0,
      };
    } catch (e) {
      console.error(`[VERIFY] Error: ${e.message}`);
      verifyJobs[verifyId] = { status: 'failed', error: e.message };
      if (e.response) {
        console.error(`[VERIFY] Service error: ${JSON.stringify(e.response.data)}`);
      }
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
app.get('/search/latest', async (_req, res) => {
  try {
    // Lấy top 6 video có điểm trung bình similarity cao nhất trên các request completed
    const [rows] = await pool.query(
      `SELECT r.video_path AS path,
              MAX(r.video_name) AS name,
              AVG(r.similarity) AS avg_similarity,
              MAX(r.created_at) AS created_at
       FROM search_results r
       JOIN search_requests q ON q.request_id = r.request_id
       WHERE q.status = 'completed'
       GROUP BY r.video_path
       ORDER BY avg_similarity DESC
       LIMIT 6`
    );

    const results = rows.map((r, i) => ({
      rank: i + 1,
      name: String(r.name || 'Unknown'),
      similarity: Number(r.avg_similarity || 0),
      path: String(r.path),
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
    }));

    return res.json({ status: 'completed', results });
  } catch (e) {
    console.error('[GET LATEST] error:', e.message);
    return res.status(500).json({ error: 'Lỗi server' });
  }
});

app.post('/update-db', async (req, res) => {
  try {
    // Gọi Python service qua HTTP
    const response = await axios.post(`${PYTHON_SERVICE_URL}/extract`, {}, {
      timeout: 3600000 // 1 hour timeout for extraction
    });
    
    res.json({ 
      success: true, 
      message: response.data.message,
      total_videos: response.data.total_videos
    });
  } catch (e) {
    console.error(`[UPDATE-DB] Error: ${e.message}`);
    if (e.response) {
      res.status(500).json({ error: e.response.data.error || 'Python service failed' });
    } else {
      res.status(500).json({ error: e.message || 'Python service failed' });
    }
  }
});

// STREAM VIDEO VỚI RANGE SUPPORT
app.get('/video', async (req, res) => {
  try {
    const qPath = req.query.path;
    if (!qPath) return res.status(400).json({ error: 'Missing path' });

    const rawPath = String(qPath);
    const candidate =  rawPath;
    const filePath = path.resolve(candidate);

    // Chỉ cho phép các thư mục video hợp lệ (kiểm tra DATA_DIR và APP_ROOT)
    const allowedDirs = [
      VIDEO_OUT_DIR,
      LIVESTREAM_DIR,
      UPLOAD_DIR,
      TEMPLATE_DIR,
      DATA_DIR  // Cho phép truy cập vào toàn bộ DATA_DIR
    ];
    const isAllowed = allowedDirs.some(dir => {
      const normalizedDir = path.resolve(dir);
      const normalizedPath = path.resolve(filePath);
      return normalizedPath.startsWith(normalizedDir + path.sep) || normalizedPath === normalizedDir;
    });
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
    // Xóa tất cả video trong thư mục livestream
    const deleted = await deleteVideosInDirectory(LIVESTREAM_DIR).catch(() => 0);
    return res.json({ success: true, deleted_videos: deleted });
  } catch (e) {
    console.error('[DB] Reset failed:', e.message);
    return res.status(500).json({ error: 'DB error' });
  }
});

// ==================== START ====================
let ingestTimer = null;

async function startLivestreamIngestWatcher() {
  if (ingestTimer) clearInterval(ingestTimer);
  let scanning = false;
  ingestTimer = setInterval(async () => {
    if (scanning) return;
    scanning = true;
    try {
      // Dọn dẹp: giữ lại tối đa 5 video mới nhất
      await enforceLivestreamRetention(5);
      // Lấy danh sách file video trong thư mục livestream
      const files = listVideoFiles(LIVESTREAM_DIR);
      if (!files.length) { scanning = false; return; }

      // Lấy các path đã có trong DB để tránh queue trùng
      const [rows] = await pool.query('SELECT query_path FROM search_requests');
      const existing = new Set(rows.map(r => String(r.query_path)));

      // Chỉ queue các file mới chưa có trong DB
      const newFiles = files.filter(f => !existing.has(f));
      for (const filePath of newFiles) {
        const rid = crypto.randomUUID();
        try {
          await pool.query(
            'INSERT INTO search_requests (query_path, request_id, status) VALUES (?, ?, ?)',
            [filePath, rid, 'pending']
          );
          setImmediate(() => runSearchJob(filePath, rid, false));
          console.log(`[WATCH] queued request_id=${rid} path=${filePath}`);
        } catch (e) {
          console.error('[WATCH] enqueue failed:', e.message);
        }
      }
    } catch (e) {
      console.error('[WATCH] error:', e.message);
    } finally {
      scanning = false;
    }
  }, 3000);
}

initDb().then(() => {
  // Bắt đầu watcher ingest thư mục livestream
  startLivestreamIngestWatcher();
  app.listen(PORT, HOST, () => {
    console.log(`Backend running at http://${HOST}:${PORT}`);
  });
}).catch(err => {
  console.error('Server failed:', err);
  process.exit(1);
});
