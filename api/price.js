export default async function handler(req, res) {
    const code = req.query.code || 'sh518880';
  
    try {
      // 👉 获取实时价格
      const realtimeRes = await fetch(`https://qt.gtimg.cn/q=${code}`);
      const realtimeText = await realtimeRes.text();
      const realtimeData = realtimeText.split('~');
      const price = parseFloat(realtimeData[3]);
  
      // 👉 模拟历史（下一步再换真实）
      const history = [];
      for (let i = 0; i < 20; i++) {
        history.push(price * (0.95 + Math.random() * 0.1));
      }
  
      res.status(200).json({
        price,
        history
      });
  
    } catch (error) {
      res.status(500).json({ error: 'fetch failed' });
    }
  }