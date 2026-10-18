"""Tool for generating declarative chart specifications for front-end rendering (FR-07)."""

from typing import Any, Literal
from pydantic import BaseModel, Field
from src.tools.base import BaseTool


class MakeChartInput(BaseModel):
    """Input parameters for the make_chart tool."""

    chart_type: Literal["bar", "line", "pie", "scatter", "doughnut"] = Field(
        default="bar",
        description="Type of chart to render: 'bar' (categories/comparisons), 'line' (trends over time), 'pie' (proportions/shares), 'doughnut' (donut chart composition), or 'scatter' (distributions).",
    )
    title: str = Field(
        ...,
        description="Concise, descriptive title for the chart (e.g. 'Tren Penjualan Bulanan 2024' or 'Distribusi Pesanan per Kategori').",
    )
    x_axis: str = Field(
        ...,
        description="The field/column name representing the horizontal axis or category labels (e.g. 'product_category_name', 'bulan', 'order_status').",
    )
    y_axis: str = Field(
        ...,
        description="The field/column name representing the vertical axis or quantitative metric (e.g. 'total_orders', 'total_revenue', 'avg_price').",
    )
    data: Any = Field(
        ...,
        description="List of data point objects/records to plot, or raw data from run_sql. Each record has keys matching x_axis and y_axis.",
    )


class MakeChartTool(BaseTool):
    """Tool to create visual chart specifications from query observations."""

    name: str = "make_chart"
    description: str = (
        "Create an interactive visual chart (bar, line, pie, doughnut, scatter) from query results or aggregated data. "
        "Use this tool when the user asks for a chart, graph, trend, visualization, or when presenting comparative metrics."
    )
    args_schema: type[BaseModel] = MakeChartInput

    async def execute(
        self,
        chart_type: str = "bar",
        title: str = "Chart",
        x_axis: str = "x",
        y_axis: str = "y",
        data: Any = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Validate and return structured chart specification."""
        clean_type = str(chart_type).lower().strip()
        if clean_type in ("donut", "doughnut"):
            clean_type = "doughnut"
        elif clean_type == "bar":
            title_lower = str(title).lower()
            if any(w in title_lower for w in ("donat", "donut", "doughnut")):
                clean_type = "doughnut"
            elif any(w in title_lower for w in ("pie", "lingkaran", "proporsi", "porsi")):
                clean_type = "pie"
            elif any(w in title_lower for w in ("tren", "trend", "garis", "line")):
                clean_type = "line"
        elif clean_type not in ("bar", "line", "pie", "scatter", "doughnut"):
            clean_type = "bar"

        sanitized_data: list[dict[str, Any]] = []

        # Case 1: If data is a SQL query string (e.g. LLM passed SQL directly into data)
        if isinstance(data, str) and data.strip().upper().startswith("SELECT"):
            try:
                from src.tools.database import RunSQLTool
                sql_tool = RunSQLTool()
                sql_res = await sql_tool.execute(query=data.strip())
                if isinstance(sql_res, dict) and sql_res.get("status") == "success":
                    cols = sql_res.get("columns", [])
                    rows = sql_res.get("rows", [])
                    if len(cols) >= 2 and rows:
                        target_x = x_axis if x_axis in cols else cols[0]
                        target_y = y_axis if y_axis in cols else cols[1]
                        x_axis = target_x
                        y_axis = target_y
                        sanitized_data = [
                            {target_x: r[0], target_y: r[1]}
                            for r in rows
                        ]
            except Exception:
                pass

        # Case 2: If data is a JSON encoded string
        if not sanitized_data and isinstance(data, str):
            try:
                import json
                parsed_json = json.loads(data)
                if isinstance(parsed_json, list):
                    data = parsed_json
            except Exception:
                pass

        # Case 3: If data is a list of dicts or list of tuples/lists
        if not sanitized_data and isinstance(data, list):
            for item in data:
                if isinstance(item, dict):
                    sanitized_data.append(item)
                elif isinstance(item, (list, tuple)) and len(item) >= 2:
                    sanitized_data.append({x_axis: item[0], y_axis: item[1]})

        # Auto-detect or reconcile x_axis and y_axis from dictionary keys if needed
        if sanitized_data:
            first = sanitized_data[0]
            if isinstance(first, dict):
                keys = list(first.keys())
                if x_axis not in keys and len(keys) >= 1:
                    x_axis = keys[0]
                if y_axis not in keys and len(keys) >= 2:
                    y_axis = keys[1]

        chart_spec = {
            "chart_type": clean_type,
            "title": str(title).strip() or "Visualisasi Data",
            "x_axis": str(x_axis).strip() or "Kategori",
            "y_axis": str(y_axis).strip() or "Nilai",
            "data": sanitized_data,
        }

        return {
            "status": "success",
            "chart": chart_spec,
            "message": f"Berhasil membuat grafik '{chart_spec['title']}' ({clean_type}) dengan {len(sanitized_data)} titik data.",
        }
