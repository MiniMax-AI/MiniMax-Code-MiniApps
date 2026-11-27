# 核算器输入

`python3 scripts/calculate_metrics.py input.json` 输出 JSON。金额以明确的 currency/unit 为同一单位；stores 每条 name 唯一。sales 必填，target、previous_sales、year_ago_sales 可省略；某列部分缺失则该列聚合为 null。daily_sales/category_sales 是同周期同口径的金额数组，仅用于对账。数值可以用十进制字符串，计算前不四舍五入。缺失数据不要补零。零分母比率为 null，展示“不适用”。

示例（全部虚构）：
```json
{"period":"2026-10","currency":"CNY","unit":"元","stores":[{"name":"演示A店","sales":"120000","target":"150000","previous_sales":"100000"},{"name":"演示B店","sales":"80000","target":"100000","previous_sales":"90000"},{"name":"演示C店","sales":"50000","target":"50000","previous_sales":"60000"}],"daily_sales":["100000","150000"],"category_sales":["150000","100000"]}
```

输出应为销售额 250000.00、目标 300000.00、达成率 83.33%、环比 0.00%、同比未提供。
