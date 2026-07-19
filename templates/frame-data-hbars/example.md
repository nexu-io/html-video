## Example: Department KPIs (Top/Bottom Split)

```json
{
  "data": {
    "title": "Q2 Department Scores",
    "items": [
      { "label": "Engineering", "value": 94 },
      { "label": "Product", "value": 89 },
      { "label": "Design", "value": 85 },
      { "label": "Marketing", "value": 72 },
      { "label": "Sales", "value": 68 },
      { "label": "Operations", "value": 55 },
      { "label": "Support", "value": 48 }
    ],
    "splitAt": 3,
    "unit": "pts"
  }
}
```

## Example: SCPM Department Ranking

```json
{
  "data": {
    "title": "仓储部门均分排名",
    "items": [
      { "label": "华北仓储", "value": 0.72 },
      { "label": "华东仓储", "value": 0.68 },
      { "label": "华南仓储", "value": 0.61 },
      { "label": "西南仓储", "value": 0.47 },
      { "label": "西北仓储", "value": 0.35 }
    ],
    "splitAt": 3,
    "unit": ""
  },
  "accent": "#3B82F6",
  "accentSecondary": "#EF4444"
}
```
