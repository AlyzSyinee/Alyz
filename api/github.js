import JSZip from 'jszip';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '25mb',
    },
  },
};

export default async function handler(req, res) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: 'GITHUB_TOKEN belum diset di ENV' });

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };

  if (req.method === 'GET') {
    const userRes = await fetch('https://api.github.com/user/repos?sort=updated&per_page=50', { headers });
    const repos = await userRes.json();
    return res.status(200).json(repos);
  }

  if (req.method === 'POST') {
    try {
      const { repoName, isPrivate, zipBase64 } = req.body;

      // 1. Get Authenticated Username
      const userReq = await fetch('https://api.github.com/user', { headers });
      const userData = await userReq.json();
      const owner = userData.login;

      // 2. Create Repository (auto_init true agar ada base commit)
      const createRes = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: repoName,
          private: Boolean(isPrivate),
          auto_init: true,
        }),
      });

      const repoData = await createRes.json();
      if (!createRes.ok) {
        return res.status(400).json({ error: repoData.message || 'Gagal membuat repository' });
      }

      // Tunggu sebentar agar inisialisasi branch main GitHub siap
      await new Promise((r) => setTimeout(r, 1500));

      // 3. Unarchive ZIP
      const zip = await JSZip.loadAsync(zipBase64, { base64: true });
      const treeItems = [];

      const fileEntries = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
      // Deteksi jika semua file terbungkus dalam 1 root folder di dalam zip
      const rootFolders = new Set(fileEntries.map((f) => f.split('/')[0]));
      const hasSingleRootFolder = rootFolders.size === 1 && fileEntries.every((f) => f.includes('/'));

      for (const filename of fileEntries) {
        if (filename.includes('__MACOSX') || filename.endsWith('.DS_Store')) continue;

        const contentBase64 = await zip.files[filename].async('base64');
        const cleanPath = hasSingleRootFolder ? filename.split('/').slice(1).join('/') : filename;
        if (!cleanPath) continue;

        const blobRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/git/blobs`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ content: contentBase64, encoding: 'base64' }),
        });
        const blobData = await blobRes.json();

        treeItems.push({
          path: cleanPath,
          mode: '100644',
          type: 'blob',
          sha: blobData.sha,
        });
      }

      // 4. Get Latest Commit SHA & Create New Tree
      const refRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/git/ref/heads/main`, { headers });
      const refData = await refRes.json();
      const latestCommitSha = refData.object.sha;

      const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/git/trees`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ base_tree: latestCommitSha, tree: treeItems }),
      });
      const treeData = await treeRes.json();

      // 5. Create Commit & Update Ref
      const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/git/commits`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: 'Initial deploy via ALYZ Control Hub',
          tree: treeData.sha,
          parents: [latestCommitSha],
        }),
      });
      const commitData = await commitRes.json();

      await fetch(`https://api.github.com/repos/${owner}/${repoName}/git/refs/heads/main`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ sha: commitData.sha }),
      });

      return res.status(200).json({
        success: true,
        repoUrl: repoData.html_url,
        fullName: repoData.full_name,
        filesCount: treeItems.length,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
}
