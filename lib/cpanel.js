const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const https = require('https');

function getClient() {
  return axios.create({
    baseURL: `https://${process.env.CPANEL_HOST}/execute`,
    headers: { Authorization: `cpanel ${process.env.CPANEL_USER}:${process.env.CPANEL_TOKEN}` },
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    timeout: 120000,
  });
}

function walkDir(dir, base = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(full, base));
    } else {
      files.push({ full, relative: path.relative(base, full) });
    }
  }
  return files;
}

async function uploadLander(landerFolder, docRoot) {
  const client = getClient();
  const files = walkDir(landerFolder);

  if (files.length === 0) throw new Error('Lander folder is empty.');

  const byDir = {};
  for (const f of files) {
    const subDir = path.dirname(f.relative);
    const targetDir = subDir === '.' ? docRoot : `${docRoot}/${subDir}`;
    if (!byDir[targetDir]) byDir[targetDir] = [];
    byDir[targetDir].push(f);
  }

  for (const [targetDir, dirFiles] of Object.entries(byDir)) {
    const form = new FormData();
    form.append('dir', targetDir);
    dirFiles.forEach((f, i) => {
      form.append(`file-${i + 1}`, fs.createReadStream(f.full), {
        filename: path.basename(f.relative),
      });
    });

    const res = await client.post('/Fileman/upload_files', form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    if (res.data.status !== 1) {
      const errors = (res.data.errors || []).join(', ') || JSON.stringify(res.data);
      throw new Error(`cPanel upload failed for ${targetDir}: ${errors}`);
    }
  }
}

module.exports = { uploadLander };
