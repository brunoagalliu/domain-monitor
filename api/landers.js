const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const unzipper = require('unzipper');
const { pool } = require('../db');
const { requireAuth } = require('../lib/auth');

const router = express.Router();
const LANDERS_DIR = path.join(__dirname, '../landers');

fs.mkdirSync(path.join(LANDERS_DIR, '_tmp'), { recursive: true });

const upload = multer({
  dest: path.join(LANDERS_DIR, '_tmp'),
  fileFilter: (req, file, cb) => {
    cb(null, file.originalname.toLowerCase().endsWith('.zip'));
  },
  limits: { fileSize: 100 * 1024 * 1024 },
});

router.use((req, res, next) => {
  if (!requireAuth(req, res)) return;
  next();
});

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM landers ORDER BY created_at DESC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'A .zip file is required.' });

  const rawName = path.basename(req.file.originalname, '.zip');
  const folderName = rawName.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const destFolder = path.join(LANDERS_DIR, folderName);

  try {
    if (fs.existsSync(destFolder)) fs.rmSync(destFolder, { recursive: true });
    fs.mkdirSync(destFolder, { recursive: true });

    await fs.createReadStream(req.file.path)
      .pipe(unzipper.Extract({ path: destFolder }))
      .promise();

    fs.unlinkSync(req.file.path);

    const entries = fs.readdirSync(destFolder);
    if (entries.length === 1) {
      const sub = path.join(destFolder, entries[0]);
      if (fs.statSync(sub).isDirectory()) {
        for (const e of fs.readdirSync(sub)) {
          fs.renameSync(path.join(sub, e), path.join(destFolder, e));
        }
        fs.rmdirSync(sub);
      }
    }

    const { rows: [row] } = await pool.query(
      `INSERT INTO landers (name, folder) VALUES ($1, $2)
       ON CONFLICT (folder) DO UPDATE SET name = $1, created_at = NOW()
       RETURNING *`,
      [folderName, folderName]
    );
    res.status(201).json(row);
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ message: err.message });
  }
});

// POST /api/landers/cpanel — create lander pointing to existing cPanel path
router.post('/cpanel', async (req, res) => {
  const { name, cpanel_path } = req.body;
  if (!name || !cpanel_path) return res.status(400).json({ message: 'name and cpanel_path are required' });
  try {
    const folder = name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const { rows: [row] } = await pool.query(
      `INSERT INTO landers (name, folder, cpanel_path)
       VALUES ($1, $2, $3)
       ON CONFLICT (folder) DO UPDATE SET name = $1, cpanel_path = $3, created_at = NOW()
       RETURNING *`,
      [name, folder, cpanel_path.trim()]
    );
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  const { category, cpanel_path, name } = req.body;
  try {
    const sets = [];
    const vals = [];
    let idx = 1;
    if ('category'    in req.body) { sets.push(`category = $${idx++}`);    vals.push(category || null); }
    if ('cpanel_path' in req.body) { sets.push(`cpanel_path = $${idx++}`); vals.push(cpanel_path || null); }
    if ('name'        in req.body) { sets.push(`name = $${idx++}`);        vals.push(name || null); }
    if (sets.length === 0) return res.status(400).json({ message: 'Nothing to update' });
    vals.push(req.params.id);
    const { rows: [row] } = await pool.query(
      `UPDATE landers SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
    );
    if (!row) return res.status(404).json({ message: 'Not found.' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { rows: [lander] } = await pool.query(`SELECT * FROM landers WHERE id = $1`, [req.params.id]);
    if (!lander) return res.status(404).json({ message: 'Not found.' });

    const folderPath = path.join(LANDERS_DIR, lander.folder);
    if (fs.existsSync(folderPath)) fs.rmSync(folderPath, { recursive: true });

    await pool.query(`DELETE FROM landers WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
