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
      let base = price;
      
      // 👉 往前推20天（模拟合理趋势）
      for (let i = 0; i < 20; i++) {
        base = base * (0.995 + Math.random() * 0.01); // 小波动
        history.unshift(base);
      }
  
    } catch (error) {
      res.status(500).json({ error: 'fetch failed' });
    }
  }