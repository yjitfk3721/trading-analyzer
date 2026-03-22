export default async function handler(req, res) {
    const { code } = req.query;
  
    try {
      const r = await fetch(`https://qt.gtimg.cn/q=${code}`);
      const text = await r.text();
  
      const arr = text.split('~');
      const price = parseFloat(arr[3]);
  
      const history = [];
      let base = price;
  
      for (let i = 0; i < 20; i++) {
        base = base * (0.995 + Math.random() * 0.01);
        history.unshift(base);
      }
  
      res.status(200).json({
        price,
        history
      });
  
    } catch (e) {
      res.status(500).json({ error: 'fetch failed' });
    }
  }