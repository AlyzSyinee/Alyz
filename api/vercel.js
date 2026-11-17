export default async function handler(req, res) {
  const token = process.env.VERCEL_TOKEN;
  if (!token) return res.status(500).json({ error: 'VERCEL_TOKEN belum diset di ENV' });

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  // GET: Ambil daftar project Vercel yang sudah ada atau cek status deployment
  if (req.method === 'GET') {
    const { deploymentId } = req.query;
    if (deploymentId) {
      const depRes = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}`, { headers });
      const depData = await depRes.json();
      return res.status(200).json(depData);
    }

    const projRes = await fetch('https://api.vercel.com/v9/projects?limit=50', { headers });
    const projData = await projRes.json();
    return res.status(200).json(projData.projects || []);
  }

  // POST: Import Repo ke Vercel + Set Domain + Trigger Deploy
  if (req.method === 'POST') {
    try {
      const { projectName, repoFullName, repoId, domainName } = req.body;
      const cleanName = projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

      // 1. Create Project terhubung ke GitHub Repo
      const createProjRes = await fetch('https://api.vercel.com/v10/projects', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: cleanName,
          gitRepository: {
            type: 'github',
            repo: repoFullName,
          },
        }),
      });
      const projData = await createProjRes.json();
      if (!createProjRes.ok && projData.error?.code !== 'project_already_exists') {
        return res.status(400).json({ error: projData.error?.message || 'Gagal import ke Vercel' });
      }

      const targetProjectId = projData.id || cleanName;

      // 2. Tambahkan Custom Subdomain (*.vercel.app atau domain lain) jika diisi
      if (domainName) {
        const cleanDomain = domainName.includes('.') ? domainName : `${domainName}.vercel.app`;
        await fetch(`https://api.vercel.com/v10/projects/${targetProjectId}/domains`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: cleanDomain }),
        });
      }

      // 3. Trigger Deployment
      const deployRes = await fetch('https://api.vercel.com/v13/deployments', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: cleanName,
          gitSource: {
            type: 'github',
            repoId: Number(repoId),
            ref: 'main',
          },
        }),
      });
      const deployData = await deployRes.json();

      return res.status(200).json({
        success: true,
        projectId: targetProjectId,
        deploymentId: deployData.id,
        url: domainName ? (domainName.includes('.') ? domainName : `${domainName}.vercel.app`) : `${cleanName}.vercel.app`,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // PATCH: Edit nama atau domain project yang sudah diimport
  if (req.method === 'PATCH') {
    const { projectId, newDomain, newName } = req.body;
    if (newName) {
      await fetch(`https://api.vercel.com/v9/projects/${projectId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ name: newName }),
      });
    }
    if (newDomain) {
      const cleanDomain = newDomain.includes('.') ? newDomain : `${newDomain}.vercel.app`;
      await fetch(`https://api.vercel.com/v10/projects/${projectId}/domains`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: cleanDomain }),
      });
    }
    return res.status(200).json({ success: true });
  }
}
