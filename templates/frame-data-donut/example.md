## Example: KPI Attainment Distribution

This mirrors the Hermes Studio SCPM dashboard use case — showing how many KPIs hit each water level.

**Input:**
```json
{
  "data": {
    "title": "KPI Attainment",
    "unit": "%",
    "items": [
      { "label": "Exceed Target", "value": 28, "color": "#22C55E" },
      { "label": "Met Target", "value": 35, "color": "#3B82F6" },
      { "label": "Met Threshold", "value": 22, "color": "#EAB308" },
      { "label": "Below Threshold", "value": 15, "color": "#EF4444" }
    ],
    "centerLabel": "Items"
  },
  "background": "#0B1120"
}
```

**Result:** Four animated donut slices growing clockwise, center shows 100 items total, legend fades in with counts and percentages.

---

## Example: Revenue by Region

```json
{
  "data": {
    "title": "Revenue by Region",
    "unit": "K",
    "items": [
      { "label": "North America", "value": 420, "color": "#3B82F6" },
      { "label": "Europe", "value": 280, "color": "#22C55E" },
      { "label": "Asia Pacific", "value": 190, "color": "#EAB308" },
      { "label": "Latin America", "value": 75, "color": "#F97316" },
      { "label": "Middle East", "value": 35, "color": "#A855F7" }
    ],
    "centerLabel": "Revenue"
  }
}
```
