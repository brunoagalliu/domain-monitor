const express = require('express');
const axios = require('axios');
const { requireAuth } = require('../lib/auth');

const router = express.Router();
const BASE = 'https://api.redtrack.io';

router.use((req, res, next) => {
  if (!requireAuth(req, res)) return;
  next();
});

async function rt(path) {
  const key = process.env.REDTRACK_API_KEY;
  if (!key) throw new Error('REDTRACK_API_KEY not configured');
  const { data } = await axios.get(`${BASE}${path}`, {
    params: { api_key: key },
    timeout: 10000,
  });
  return data;
}

function normalizeStream(s) {
  if (!s) return s;
  return { ...s, id: s.id || s._id };
}

async function fetchAllStreams() {
  const data = await rt('/streams?template=true&per=500');
  return (data.items || data || []).map(normalizeStream);
}

router.get('/landings', async (req, res) => {
  try { res.json(await rt('/landings')); }
  catch (err) { res.status(500).json({ message: err.message }); }
});

router.get('/offers', async (req, res) => {
  try { res.json(await rt('/offers')); }
  catch (err) { res.status(500).json({ message: err.message }); }
});

router.get('/campaigns', async (req, res) => {
  try { res.json(await rt('/campaigns')); }
  catch (err) { res.status(500).json({ message: err.message }); }
});

router.get('/streams', async (req, res) => {
  try { res.json(await fetchAllStreams()); }
  catch (err) { res.status(500).json({ message: err.message }); }
});

router.get('/streams/:id', async (req, res) => {
  try {
    const items = await fetchAllStreams();
    const stream = items.find(s => String(s.id) === req.params.id || String(s._id) === req.params.id);
    if (!stream) return res.status(404).json({ message: `Stream ${req.params.id} not found` });
    res.json(stream);
  } catch (err) {
    res.status(err.response?.status || 500).json({ message: err.response?.data?.error || err.message });
  }
});

router.post('/landings', async (req, res) => {
  const key = process.env.REDTRACK_API_KEY;
  if (!key) return res.status(500).json({ message: 'REDTRACK_API_KEY not configured' });
  try {
    const { data } = await axios.post(`${BASE}/landings`, req.body, {
      params: { api_key: key }, timeout: 10000,
    });
    res.status(201).json(data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ message: err.response?.data?.error || err.message });
  }
});

router.put('/streams/:id', async (req, res) => {
  const key = process.env.REDTRACK_API_KEY;
  if (!key) return res.status(500).json({ message: 'REDTRACK_API_KEY not configured' });
  try {
    const { type: _ignored, ...rest } = req.body;
    const { data } = await axios.put(`${BASE}/streams/${req.params.id}`, { ...rest, template: true }, {
      params: { api_key: key }, timeout: 10000,
    });
    res.json(normalizeStream(data));
  } catch (err) {
    res.status(err.response?.status || 500).json({ message: err.response?.data?.error || err.message });
  }
});

router.post('/streams', async (req, res) => {
  const key = process.env.REDTRACK_API_KEY;
  if (!key) return res.status(500).json({ message: 'REDTRACK_API_KEY not configured' });
  try {
    const { type: _ignored, ...rest } = req.body;
    const { data } = await axios.post(`${BASE}/streams`, { ...rest, template: true }, {
      params: { api_key: key }, timeout: 10000,
    });
    const normalized = normalizeStream(data);
    if (!normalized?.id) return res.status(500).json({ message: 'RedTrack did not return a stream ID.' });
    res.status(201).json(normalized);
  } catch (err) {
    res.status(err.response?.status || 500).json({ message: err.response?.data?.error || err.message });
  }
});

module.exports = { router, rt };
