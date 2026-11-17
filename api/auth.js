export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { password } = req.body;
  const validPass = process.env.APP_PASSWORD || '';

  if (password === validPass) {
    return res.status(200).json({ success: true });
  }
  return res.status(401).json({ success: false, message: 'Password tidak valid' });
}
