export default async function handler(req, res) {
  
  
  // 👉 ETF代码映射（自动补全市场前缀）
const ETF_MAP = {
    "518880": "sh518880", // 黄金ETF
    "159915": "sz159915", // 创业板ETF
    "588000": "sh588000"  // 科创板ETF
  };
  
  const rawCode = req.query.code;
  const code = ETF_MAP[rawCode];
  
  if (!code) {
    return res.status(400).json({ error: "不支持的ETF代码" });
  }
  
    try {
      const r = await fetch(`https://qt.gtimg.cn/q=${code}`);
      const text = await r.text();
  
      const klineRes = await fetch(东方财富URL);
      const klineData = await klineRes.json();
      const klines = klineData.data.klines;

      const history = klines.map(item => {
        const parts = item.split(',');
        return parseFloat(parts[2]); // 收盘价
      });

      const arr = text.split('~');
      const price = parseFloat(arr[3]);
  
   
  
      res.status(200).json({
        price,
        history
      });
  
    } catch (e) {
      res.status(500).json({ error: 'fetch failed' });
    }
  }