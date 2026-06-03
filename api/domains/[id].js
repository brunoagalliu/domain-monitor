const { execute: dbExecute, pool } = require('../../db');
const db = { execute: dbExecute };
const { requireAuth } = require('../../lib/auth');
const { uploadLander } = require('../../lib/cpanel');
const path = require('path');

const LANDERS_DIR = process.env.LANDERS_DIR || path.join(__dirname, '../../landers');

// Map incoming field names from rotator frontend → actual DB column names
const FIELD_MAP = {
  status:   'rotator_status',
  priority: 'rotator_priority',
};

const ROTATOR_ALLOWED = [
  'doc_root', 'role', 'redtrack_lander_id', 'notes', 'category',
  'lander_id', 'funnel_id', 'banned_at', 'domain_type',
  // mapped below:
  'status', 'priority',
];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!requireAuth(req, res)) return;

  const id = req.params?.id || req.query.id;
  if (!id) return res.status(400).json({ error: 'Domain ID is required' });

  // PATCH — update domain fields
  if (req.method === 'PATCH') {
    try {
      const body = req.body || {};

      // Monitor-side: toggle is_priority
      if ('is_priority' in body && Object.keys(body).length === 1) {
        const { is_priority } = body;
        if (typeof is_priority !== 'boolean') {
          return res.status(400).json({ error: 'is_priority (boolean) is required' });
        }
        const [, result] = await db.execute(
          'UPDATE domains SET is_priority = $1 WHERE id = $2 AND is_active = true',
          [is_priority, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Domain not found' });
        return res.status(200).json({ success: true, id: parseInt(id), is_priority });
      }

      // Rotator-side: update any allowed field
      const fields = [];
      const values = [];
      let idx = 1;

      for (const key of ROTATOR_ALLOWED) {
        if (!(key in body)) continue;
        const col = FIELD_MAP[key] || key;
        fields.push(`${col} = $${idx++}`);
        values.push(body[key] ?? null);
      }

      // Also allow is_priority in mixed updates
      if ('is_priority' in body) {
        fields.push(`is_priority = $${idx++}`);
        values.push(Boolean(body.is_priority));
      }

      if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
      values.push(id);

      const [rows] = await db.execute(
        `UPDATE domains SET ${fields.join(', ')} WHERE id = $${idx} AND is_active = true RETURNING *`,
        values
      );
      if (!rows.length) return res.status(404).json({ error: 'Domain not found' });
      return res.status(200).json(rows[0]);
    } catch (error) {
      console.error('Error patching domain:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  // POST /deploy — deploy lander via cPanel
  if (req.method === 'POST' && req.path === '/deploy') {
    try {
      const [domains] = await db.execute(
        `SELECT d.*, l.folder AS lander_folder FROM domains d LEFT JOIN landers l ON d.lander_id = l.id WHERE d.id = $1`,
        [id]
      );
      const domain = domains[0];
      if (!domain) return res.status(404).json({ message: 'Domain not found.' });
      if (!domain.lander_folder) return res.status(400).json({ message: 'No lander assigned to this domain.' });
      if (!domain.doc_root) return res.status(400).json({ message: `Domain "${domain.domain}" has no cPanel doc root set. Edit the domain to add it.` });

      await uploadLander(path.join(LANDERS_DIR, domain.lander_folder), domain.doc_root);
      res.json({ ok: true, domain: domain.domain });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
    return;
  }

  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // DELETE — soft-delete the domain
  try {
    const [, result] = await db.execute(
      'UPDATE domains SET is_active = false WHERE id = $1',
      [id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Domain not found' });
    return res.status(200).json({ message: 'Domain removed successfully', id: parseInt(id) });
  } catch (error) {
    console.error('Error deleting domain:', error);
    return res.status(500).json({ error: error.message, code: error.code });
  }
};
