module.exports = (req, res) => {
    res.json({
      message: '🛡️ Domain Safety Monitor API',
      status: 'running',
      endpoints: {
        'GET /api/domains': 'List all domains',
        'POST /api/domains': 'Add a domain',
        'DELETE /api/domains/[id]': 'Remove a domain',
        'POST /api/scan': 'Trigger manual scan',
        'GET /api/scans': 'Get recent scan results',
        'GET /api/stats': 'Get dashboard statistics',
        'GET /api/categories': 'Get all categories',
        'POST /api/categories': 'Add a new category'
      }
    });
  };