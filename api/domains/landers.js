const express = require('express');
const path = require('path');
const axios = require('axios');
const { pool } = require('../../db');
const { uploadLander } = require('../../lib/cpanel');
const { ensureLanderInStream } = require('../../lib/rotator');
const { requireAuth } = require('../../lib/auth');

const router = express.Router({ mergeParams: true });
const LANDERS_DIR = path.join(__dirname, '../../landers');

router.use((req, res, next) => {
  if (!requireAuth(req, res)) return;
  next();
});

// GET /api/domains/:id/landers
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT dl.id, dl.domain_id, dl.lander_id,
         COALESCE(dl.subdirectory, dl.sub_directory, '') AS subdirectory,
         dl.redtrack_lander_id, dl.redtrack_lander_title, dl.created_at,
         l.name AS lander_name, l.folder AS lander_folder
       FROM domain_landers dl
       JOIN landers l ON dl.lander_id = l.id
       WHERE dl.domain_id = $1
       ORDER BY dl.created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/domains/:id/landers
router.post('/', async (req, res) => {
  const { lander_id, subdirectory = '' } = req.body;
  if (!lander_id) return res.status(400).json({ message: 'lander_id is required.' });
  try {
    const clean = subdirectory.trim().replace(/^\/|\/$/g, '');
    const { rows: [row] } = await pool.query(
      `INSERT INTO domain_landers (domain_id, lander_id, subdirectory, sub_directory)
       VALUES ($1, $2, $3, $3) RETURNING *,
         COALESCE(subdirectory, sub_directory, '') AS subdirectory`,
      [req.params.id, lander_id, clean]
    );
    res.status(201).json(row);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'A lander is already assigned to that path.' });
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/domains/:id/landers/:dlId  — link RT lander ID
router.patch('/:dlId', async (req, res) => {
  const { redtrack_lander_id, redtrack_lander_title } = req.body;
  try {
    const { rows: [dl] } = await pool.query(
      `UPDATE domain_landers
       SET redtrack_lander_id    = $1,
           redtrack_lander_title = $2
       WHERE id = $3 AND domain_id = $4
       RETURNING *,
         COALESCE(subdirectory, sub_directory, '') AS subdirectory`,
      [redtrack_lander_id || null, redtrack_lander_title || null, req.params.dlId, req.params.id]
    );
    if (!dl) return res.status(404).json({ message: 'Not found.' });

    const noSubdir = !dl.subdirectory || dl.subdirectory === '';
    if (noSubdir) {
      await pool.query(
        `UPDATE domains SET redtrack_lander_id = $1 WHERE id = $2`,
        [redtrack_lander_id || null, req.params.id]
      );
    }

    if (redtrack_lander_id) {
      const { rows: [domainRow] } = await pool.query(
        `SELECT d.rotator_status, f.redtrack_stream_id
         FROM domains d
         LEFT JOIN funnels f ON d.funnel_id = f.id
         WHERE d.id = $1`,
        [req.params.id]
      );
      if (domainRow?.redtrack_stream_id) {
        const weight = domainRow.rotator_status === 'active' ? 100 : 1;
        ensureLanderInStream(domainRow.redtrack_stream_id, redtrack_lander_id, weight)
          .catch(err => console.error('[link] ensureLanderInStream failed:', err.message));
      }
    }

    res.json(dl);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/domains/:id/landers/:dlId
router.delete('/:dlId', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM domain_landers WHERE id = $1 AND domain_id = $2`,
      [req.params.dlId, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/domains/:id/landers/:dlId/deploy
router.post('/:dlId/deploy', async (req, res) => {
  try {
    const { rows: [dl] } = await pool.query(
      `SELECT dl.*,
         COALESCE(dl.subdirectory, dl.sub_directory, '') AS subdirectory,
         l.folder AS lander_folder, d.doc_root, d.domain
       FROM domain_landers dl
       JOIN landers l ON dl.lander_id = l.id
       JOIN domains d ON dl.domain_id = d.id
       WHERE dl.id = $1 AND dl.domain_id = $2`,
      [req.params.dlId, req.params.id]
    );
    if (!dl) return res.status(404).json({ message: 'Not found.' });

    const targetRoot = dl.subdirectory
      ? `${dl.doc_root}/${dl.subdirectory}`
      : dl.doc_root;

    await uploadLander(path.join(LANDERS_DIR, dl.lander_folder), targetRoot);
    res.json({ ok: true, domain: dl.domain, path: dl.subdirectory || '/' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/domains/:id/landers/:dlId/publish  — create RT landing page
router.post('/:dlId/publish', async (req, res) => {
  try {
    const { rows: [dl] } = await pool.query(
      `SELECT dl.*,
         COALESCE(dl.subdirectory, dl.sub_directory, '') AS subdirectory,
         l.name AS lander_name, d.domain
       FROM domain_landers dl
       JOIN landers l ON dl.lander_id = l.id
       JOIN domains d ON dl.domain_id = d.id
       WHERE dl.id = $1 AND dl.domain_id = $2`,
      [req.params.dlId, req.params.id]
    );
    if (!dl) return res.status(404).json({ message: 'Not found.' });

    const defaultUrl = dl.subdirectory
      ? `https://${dl.domain}/${dl.subdirectory}`
      : `https://${dl.domain}`;
    const defaultTitle = `${dl.lander_name} - ${dl.domain}${dl.subdirectory ? '/' + dl.subdirectory : ''}`;

    const { title = defaultTitle, url = defaultUrl, type = 'l' } = req.body;

    const apiKey = process.env.REDTRACK_API_KEY;
    if (!apiKey) return res.status(500).json({ message: 'REDTRACK_API_KEY not configured.' });

    const { data: rtLander } = await axios.post(
      'https://api.redtrack.io/landings',
      { title, url, type },
      { params: { api_key: apiKey }, timeout: 10000 }
    );

    await pool.query(
      `UPDATE domain_landers SET redtrack_lander_id = $1, redtrack_lander_title = $2 WHERE id = $3`,
      [rtLander.id, rtLander.title || null, dl.id]
    );

    const noSubdir = !dl.subdirectory || dl.subdirectory === '';
    if (noSubdir) {
      await pool.query(
        `UPDATE domains SET redtrack_lander_id = $1 WHERE id = $2`,
        [rtLander.id, req.params.id]
      );
    }

    const { rows: [domainRow] } = await pool.query(
      `SELECT d.rotator_status, f.redtrack_stream_id
       FROM domains d
       LEFT JOIN funnels f ON d.funnel_id = f.id
       WHERE d.id = $1`,
      [req.params.id]
    );
    if (domainRow?.redtrack_stream_id) {
      const weight = domainRow.rotator_status === 'active' ? 100 : 1;
      ensureLanderInStream(domainRow.redtrack_stream_id, rtLander.id, weight)
        .catch(err => console.error('[publish] ensureLanderInStream failed:', err.message));
    }

    res.json({ ok: true, redtrack_lander: rtLander });
  } catch (err) {
    res.status(500).json({ message: err.response?.data?.error || err.message });
  }
});

module.exports = router;
