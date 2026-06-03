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

async function copyCpanelDir(sourcePath, destPath) {
  const cpClient = getClient();

  async function recurse(src, dst) {
    const listRes = await cpClient.get('/Fileman/list_files', { params: { dir: src, show_hidden: 1 } });
    if (listRes.data.status !== 1) {
      throw new Error(`Cannot list ${src}: ${(listRes.data.errors || []).join(', ')}`);
    }

    const items  = listRes.data.data || [];
    const files  = items.filter(i => i.type === 'file');
    const dirs   = items.filter(i => i.type === 'dir' && i.file !== '.' && i.file !== '..');

    if (files.length > 0) {
      const params = new URLSearchParams();
      files.forEach((f, i) => {
        params.append(`files-${i}-filename`,   `${src}/${f.file}`);
        params.append(`files-${i}-destfolder`, dst);
      });
      const copyRes = await cpClient.post('/Fileman/copy_files', params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      if (copyRes.data.status !== 1) {
        throw new Error(`Copy failed: ${(copyRes.data.errors || []).join(', ')}`);
      }
    }

    for (const dir of dirs) {
      const subSrc = `${src}/${dir.file}`;
      const subDst = `${dst}/${dir.file}`;
      const lastSlash = subDst.lastIndexOf('/');
      await cpClient.post('/Fileman/mkdir', null, {
        params: { path: subDst.substring(0, lastSlash), name: subDst.substring(lastSlash + 1) },
      }).catch(() => {});
      await recurse(subSrc, subDst);
    }
  }

  const lastSlash = destPath.lastIndexOf('/');
  await cpClient.post('/Fileman/mkdir', null, {
    params: { path: destPath.substring(0, lastSlash), name: destPath.substring(lastSlash + 1) },
  }).catch(() => {});

  await recurse(sourcePath, destPath);
}

module.exports = { uploadLander, copyCpanelDir };
