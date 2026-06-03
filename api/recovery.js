const express = require('express');
const { execute } = require('../db');
const { requireAuth } = require('../lib/auth');

const router = express.Router();

router.use((req, res, next) => {
  if (!requireAuth(req, res)) return;
  next();
});

const VALID_STATUSES = ['cleaning', 'submitted', 'under_review', 'resolved'];

// GET /api/recovery/:domainId — recovery status + log
router.get('/:domainId', async (req, res) => {
  try {
    const { domainId } = req.params;
    const [[domain], logs] = await Promise.all([
      execute(`SELECT id, domain, recovery_status FROM domains WHERE id = $1 AND is_active = true`, [domainId])
        .then(([rows]) => rows),
      execute(
        `SELECT id, status, note, created_at FROM domain_recovery_logs WHERE domain_id = $1 ORDER BY created_at ASC`,
        [domainId]
      ).then(([rows]) => rows),
    ]);
    if (!domain) return res.status(404).json({ error: 'Domain not found' });
    res.json({ recovery_status: domain.recovery_status, logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/recovery/:domainId/log — add a log entry (optionally change status)
router.post('/:domainId/log', async (req, res) => {
  try {
    const { domainId } = req.params;
    const { status, note } = req.body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    await Promise.all([
      execute(`UPDATE domains SET recovery_status = $1 WHERE id = $2 AND is_active = true`, [status, domainId]),
      execute(
        `INSERT INTO domain_recovery_logs (domain_id, status, note) VALUES ($1, $2, $3)`,
        [domainId, status, note || null]
      ),
    ]);

    const [logs] = await execute(
      `SELECT id, status, note, created_at FROM domain_recovery_logs WHERE domain_id = $1 ORDER BY created_at ASC`,
      [domainId]
    );
    res.json({ recovery_status: status, logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/recovery/:domainId — clear recovery state
router.delete('/:domainId', async (req, res) => {
  try {
    const { domainId } = req.params;
    await Promise.all([
      execute(`UPDATE domains SET recovery_status = NULL WHERE id = $1`, [domainId]),
      execute(`DELETE FROM domain_recovery_logs WHERE domain_id = $1`, [domainId]),
    ]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
