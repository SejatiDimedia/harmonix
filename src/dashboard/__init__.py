"""Dashboard management package for Live BI Dashboard Canvas (FR-37)."""

from src.dashboard.manager import (
    DashboardWidgetModel,
    PinWidgetInput,
    init_dashboard_table,
    pin_widget,
    get_dashboard_widgets,
    delete_dashboard_widget,
    refresh_dashboard_widgets,
)

__all__ = [
    "DashboardWidgetModel",
    "PinWidgetInput",
    "init_dashboard_table",
    "pin_widget",
    "get_dashboard_widgets",
    "delete_dashboard_widget",
    "refresh_dashboard_widgets",
]
