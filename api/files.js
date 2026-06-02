const express = require('express');
const axios   = require('axios');
const https   = require('https');
const FormData = require('form-data');
const { requireAuth } = require('../lib/auth');

const router = express.Router();

router.use((req, res, next) => {
  if (!requireAuth(req, res)) return;
  next();
});

function client() {
  return axios.create({
    baseURL: `https://${process.env.CPANEL_HOST}/execute`,
    headers: { Authorization: `cpanel ${process.env.CPANEL_USER}:${process.env.CPANEL_TOKEN}` },
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    timeout: 30000,
  });
}

function cpError(data) {
  return (data.errors || []).join(', ') || 'cPanel error';
}

// GET /api/files/list?dir=public_html/example.com
router.get('/list', async (req, res) => {
  const { dir } = req.query;
  if (!dir) return res.status(400).json({ message: 'dir is required' });
  try {
    const { data } = await client().get('/Fileman/list_files', { params: { dir, show_hidden: 1 } });
    if (data.status !== 1) return res.status(500).json({ message: cpError(data) });
    res.json(data.data);
  } catch (err) {
    res.status(500).json({ message: err.response?.data?.errors?.[0] || err.message });
  }
});

// GET /api/files/content?path=public_html/example.com/index.html
router.get('/content', async (req, res) => {
  const { path: filePath } = req.query;
  if (!filePath) return res.status(400).json({ message: 'path is required' });
  const lastSlash = filePath.lastIndexOf('/');
  const dir  = filePath.substring(0, lastSlash);
  const file = filePath.substring(lastSlash + 1);
  try {
    const { data } = await client().get('/Fileman/get_file_content', { params: { dir, file } });
    if (data.status !== 1) return res.status(500).json({ message: cpError(data) });
    res.json({ content: data.data?.content ?? '' });
  } catch (err) {
    res.status(500).json({ message: err.response?.data?.errors?.[0] || err.message });
  }
});

// POST /api/files/save  { path, content }
router.post('/save', async (req, res) => {
  const { path: filePath, content = '' } = req.body;
  if (!filePath) return res.status(400).json({ message: 'path is required' });
  const lastSlash = filePath.lastIndexOf('/');
  const dir  = filePath.substring(0, lastSlash);
  const file = filePath.substring(lastSlash + 1);
  try {
    const params = new URLSearchParams({ dir, file, content });
    const { data } = await client().post('/Fileman/save_file_content', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (data.status !== 1) return res.status(500).json({ message: cpError(data) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.response?.data?.errors?.[0] || err.message });
  }
});

// POST /api/files/create  { path }   — create empty file
router.post('/create', async (req, res) => {
  const { path: filePath } = req.body;
  if (!filePath) return res.status(400).json({ message: 'path is required' });
  const lastSlash = filePath.lastIndexOf('/');
  const dir  = filePath.substring(0, lastSlash);
  const file = filePath.substring(lastSlash + 1);
  try {
    const params = new URLSearchParams({ dir, file, content: '' });
    const { data } = await client().post('/Fileman/save_file_content', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (data.status !== 1) return res.status(500).json({ message: cpError(data) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.response?.data?.errors?.[0] || err.message });
  }
});

// POST /api/files/mkdir  { path }
router.post('/mkdir', async (req, res) => {
  const { path: dirPath } = req.body;
  if (!dirPath) return res.status(400).json({ message: 'path is required' });
  const lastSlash = dirPath.lastIndexOf('/');
  const parent = dirPath.substring(0, lastSlash);
  const name   = dirPath.substring(lastSlash + 1);
  try {
    const { data } = await client().post('/Fileman/mkdir', null, { params: { path: parent, name } });
    if (data.status !== 1) return res.status(500).json({ message: cpError(data) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.response?.data?.errors?.[0] || err.message });
  }
});

// POST /api/files/rename  { dir, oldName, newName }
router.post('/rename', async (req, res) => {
  const { dir, oldName, newName } = req.body;
  if (!dir || !oldName || !newName) return res.status(400).json({ message: 'dir, oldName, newName required' });
  try {
    const { data } = await client().post('/Fileman/rename', null, {
      params: { sourcefiles: `${dir}/${oldName}`, destfiles: `${dir}/${newName}` },
    });
    if (data.status !== 1) return res.status(500).json({ message: cpError(data) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.response?.data?.errors?.[0] || err.message });
  }
});

// POST /api/files/delete  { dir, names: [] }
router.post('/delete', async (req, res) => {
  const { dir, names } = req.body;
  if (!dir || !names?.length) return res.status(400).json({ message: 'dir and names[] required' });
  try {
    // cPanel expects repeated `files-n-file` params
    const params = new URLSearchParams({ dir });
    names.forEach((n, i) => params.append(`files-${i}-file`, n));
    const { data } = await client().post('/Fileman/unlink', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (data.status !== 1) return res.status(500).json({ message: cpError(data) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.response?.data?.errors?.[0] || err.message });
  }
});

// POST /api/files/upload  multipart, field "file", query ?dir=...
router.post('/upload', async (req, res) => {
  const { dir } = req.query;
  if (!dir) return res.status(400).json({ message: 'dir query param required' });
  // Pipe raw multipart body directly to cPanel
  // We expect the client to send multipart with field name "file-1"
  const form = new FormData();
  form.append('dir', dir);

  const multer = require('multer');
  const upload = multer({ storage: multer.memoryStorage() }).array('files');

  upload(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message });
    if (!req.files?.length) return res.status(400).json({ message: 'No files uploaded' });

    const f2 = new FormData();
    f2.append('dir', dir);
    req.files.forEach((f, i) => {
      f2.append(`file-${i + 1}`, f.buffer, { filename: f.originalname, contentType: f.mimetype });
    });

    try {
      const { data } = await client().post('/Fileman/upload_files', f2, {
        headers: f2.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      if (data.status !== 1) return res.status(500).json({ message: cpError(data) });
      res.json({ ok: true, uploaded: req.files.length });
    } catch (e) {
      res.status(500).json({ message: e.response?.data?.errors?.[0] || e.message });
    }
  });
});

module.exports = router;
