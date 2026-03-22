export default async function handler(req, res) {
    const code = req.query.code || 'sh518880';
  
    try {
      const response = await fetch(`https://qt.gtimg.cn/q=${code}`);
      const text = await response.text();
  
      const data = text.split('~');
  
      const price = parseFloat(data[3]);
  
      res.status(200).json({
        price,
      });
    } catch (error) {
      res.status(500).json({ error: 'fetch failed' });
    }
  }
  