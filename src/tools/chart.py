"""Tool for generating declarative chart specifications for front-end rendering (FR-07)."""

from typing import Any, Literal
from pydantic import BaseModel, Field
from src.tools.base import BaseTool


class MakeChartInput(BaseModel):
    """Input parameters for the make_chart tool."""

    chart_type: Literal["bar", "line", "pie", "scatter"] = Field(
        default="bar",
        description="Type of chart to render: 'bar' (categories/comparisons), 'line' (trends over time), 'pie' (proportions/shares), or 'scatter' (distributions).",
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
    data: list[dict[str, Any]] = Field(
        ...,
        description="List of data point objects/records to plot. Each object should have keys matching x_axis and y_axis.",
    )


class MakeChartTool(BaseTool):
    """Tool to create visual chart specifications from query observations."""

    name: str = "make_chart"
    description: str = (
        "Create an interactive visual chart (bar, line, pie, scatter) from query results or aggregated data. "
        "Use this tool when the user asks for a chart, graph, trend, visualization, or when presenting comparative metrics."
    )
    args_schema: type[BaseModel] = MakeChartInput

    async def execute(
        self,
        chart_type: str = "bar",
        title: str = "Chart",
        x_axis: str = "x",
        y_axis: str = "y",
        data: list[dict[str, Any]] | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Validate and return structured chart specification."""
        clean_type = str(chart_type).lower().strip()
        if clean_type not in ("bar", "line", "pie", "scatter"):
            clean_type = "bar"

        data_list = data or []
        if not isinstance(data_list, list):
            data_list = []

        sanitized_data = []
        for item in data_list:
            if isinstance(item, dict):
                sanitized_data.append(item)
            elif isinstance(item, (list, tuple)) and len(item) >= 2:
                sanitized_data.append({x_axis: item[0], y_axis: item[1]})

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
