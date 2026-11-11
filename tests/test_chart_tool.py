"""Unit tests for the Dynamic Chart Tool (FR-07) and its agent integrations."""

import pytest
from src.agent.langgraph_agent import LangGraphAgent
from src.agent.manual_loop import ManualAgentLoop
from src.agent.models import AgentFinalResponse
from src.llm.provider import LLMResponse, MockLLMProvider, ToolCall
from src.tools.chart import MakeChartTool


@pytest.mark.asyncio
async def test_make_chart_tool_direct_execution():
    """Verify MakeChartTool parses and formats data properly for bar charts."""
    tool = MakeChartTool()
    assert tool.name == "make_chart"

    result = await tool.execute(
        chart_type="bar",
        title="Top 3 Kategori Produk",
        x_axis="category",
        y_axis="total_sales",
        data=[
            {"category": "beleza_saude", "total_sales": 12500},
            {"category": "relogios_presentes", "total_sales": 9800},
            {"category": "cama_mesa_banho", "total_sales": 7200},
        ],
    )

    assert result["status"] == "success"
    chart = result["chart"]
    assert chart["chart_type"] == "bar"
    assert chart["title"] == "Top 3 Kategori Produk"
    assert chart["x_axis"] == "category"
    assert chart["y_axis"] == "total_sales"
    assert len(chart["data"]) == 3
    assert chart["data"][0]["category"] == "beleza_saude"
    assert chart["data"][0]["total_sales"] == 12500


@pytest.mark.asyncio
async def test_make_chart_tool_fallback_behavior():
    """Verify fallback when chart_type is unrecognized or data format differs."""
    tool = MakeChartTool()

    # Unrecognized chart_type defaults to 'bar'
    result = await tool.execute(
        chart_type="3d_bubble",
        title="  Penjualan Trend  ",
        x_axis="bulan",
        y_axis="omset",
        data=[("Jan", 100), ("Feb", 200)],  # tuple input
    )

    assert result["status"] == "success"
    chart = result["chart"]
    assert chart["chart_type"] == "bar"
    assert chart["title"] == "Penjualan Trend"
    assert len(chart["data"]) == 2
    assert chart["data"][0] == {"bulan": "Jan", "omset": 100}
    assert chart["data"][1] == {"bulan": "Feb", "omset": 200}


@pytest.mark.asyncio
async def test_manual_loop_captures_chart():
    """Verify ManualAgentLoop captures chart specifications into AgentFinalResponse."""
    chart_tool_call = ToolCall(
        id="call_chart_1",
        name="make_chart",
        arguments={
            "chart_type": "line",
            "title": "Tren Penjualan Bulanan",
            "x_axis": "bulan",
            "y_axis": "total_omzet",
            "data": [
                {"bulan": "2024-01", "total_omzet": 50000000},
                {"bulan": "2024-02", "total_omzet": 75000000},
            ],
        },
    )

    canned_responses = [
        LLMResponse(
            content="Membuat grafik tren penjualan bulanan.",
            tool_calls=[chart_tool_call],
        ),
        LLMResponse(
            content="Berikut adalah visualisasi tren penjualan bulanan yang menunjukkan kenaikan signifikan.",
            tool_calls=[],
        ),
    ]

    mock_llm = MockLLMProvider(canned_responses=canned_responses)
    agent = ManualAgentLoop(llm=mock_llm, max_steps=5)

    events = []
    async for event in agent.run(user_query="Buatkan grafik tren penjualan bulanan"):
        events.append(event)

    final_event = next(e for e in events if e["event"] == "final_result")
    final_data = final_event["data"]

    assert "charts" in final_data
    assert len(final_data["charts"]) == 1
    captured = final_data["charts"][0]
    assert captured["chart_type"] == "line"
    assert captured["title"] == "Tren Penjualan Bulanan"
    assert len(captured["data"]) == 2


@pytest.mark.asyncio
async def test_langgraph_captures_chart():
    """Verify LangGraphAgent captures chart specifications into AgentFinalResponse."""
    chart_tool_call = ToolCall(
        id="call_chart_lg",
        name="make_chart",
        arguments={
            "chart_type": "pie",
            "title": "Proporsi Status Pesanan",
            "x_axis": "order_status",
            "y_axis": "count",
            "data": [
                {"order_status": "delivered", "count": 95},
                {"order_status": "shipped", "count": 5},
            ],
        },
    )

    canned_responses = [
        LLMResponse(
            content="Memvisualisasikan proporsi status pesanan dalam grafik pie.",
            tool_calls=[chart_tool_call],
            model="mock-langgraph",
        ),
        LLMResponse(
            content="Mayoritas pesanan berstatus delivered (95%).",
            tool_calls=[],
            model="mock-langgraph",
        ),
    ]

    mock_llm = MockLLMProvider(canned_responses=canned_responses)
    agent = LangGraphAgent(llm=mock_llm, max_steps=5)

    response = await agent.run(user_query="Tampilkan proporsi pesanan dalam grafik")

    assert isinstance(response, AgentFinalResponse)
    assert len(response.charts) == 1
    assert response.charts[0].chart_type == "pie"
    assert response.charts[0].title == "Proporsi Status Pesanan"
    assert len(response.charts[0].data) == 2


@pytest.mark.asyncio
async def test_make_chart_json_string_input():
    """Verify MakeChartTool can parse data passed as a JSON string."""
    tool = MakeChartTool()
    result = await tool.execute(
        chart_type="bar",
        title="Distribusi Status",
        x_axis="status",
        y_axis="total",
        data='[{"status": "delivered", "total": 90}, {"status": "canceled", "total": 10}]',
    )
    assert result["status"] == "success"
    assert len(result["chart"]["data"]) == 2
    assert result["chart"]["data"][0]["status"] == "delivered"


@pytest.mark.asyncio
async def test_manual_loop_chart_auto_fallback_from_table():
    """Verify ManualAgentLoop auto-fills chart data when make_chart receives empty data but run_sql provided rows."""
    run_sql_call = ToolCall(
        id="call_sql_1",
        name="run_sql",
        arguments={"query": "SELECT product_category_name, COUNT(*) as total FROM analytics.products GROUP BY product_category_name"},
    )
    # LLM called make_chart with empty data (or SQL string)
    chart_tool_call = ToolCall(
        id="call_chart_empty",
        name="make_chart",
        arguments={
            "chart_type": "bar",
            "title": "Perbandingan Total Pesanan per Kategori",
            "x_axis": "product_category_name",
            "y_axis": "total_orders",
            "data": [],
        },
    )

    canned_responses = [
        LLMResponse(
            content="Menjalankan query SQL untuk data produk.",
            tool_calls=[run_sql_call],
        ),
        LLMResponse(
            content="Membuat grafik dari data produk.",
            tool_calls=[chart_tool_call],
        ),
        LLMResponse(
            content="Berikut ringkasan grafiknya.",
            tool_calls=[],
        ),
    ]

    mock_llm = MockLLMProvider(canned_responses=canned_responses)
    agent = ManualAgentLoop(llm=mock_llm, max_steps=5)

    events = []
    async for event in agent.run(user_query="Buatkan grafik perbandingan pesanan per kategori"):
        events.append(event)

    final_event = next(e for e in events if e["event"] == "final_result")
    final_data = final_event["data"]

    assert len(final_data["charts"]) >= 1
    ch = final_data["charts"][0]
    # Chart data was populated from the captured table!
    assert len(ch["data"]) > 0
    assert ch["data"][0]["product_category_name"] is not None or "(NULL)" in str(ch["data"][0])


@pytest.mark.asyncio
async def test_manual_loop_reconciles_pie_and_doughnut_when_omitted():
    """Verify that when make_chart omits chart_type (defaulting to bar), but user asked for pie, it is reconciled to pie."""
    chart_tool_call = ToolCall(
        id="call_chart_no_type",
        name="make_chart",
        arguments={
            "title": "Distribusi Status Pesanan",
            "x_axis": "order_status",
            "y_axis": "count",
            "data": [
                {"order_status": "Delivered", "count": 8},
                {"order_status": "Shipped", "count": 1},
            ],
        },
    )

    canned_responses = [
        LLMResponse(content="Membuat grafik status pesanan.", tool_calls=[chart_tool_call]),
        LLMResponse(content="Berikut hasilnya.", tool_calls=[]),
    ]

    mock_llm = MockLLMProvider(canned_responses=canned_responses)
    agent = ManualAgentLoop(llm=mock_llm, max_steps=5)

    events = []
    async for event in agent.run(user_query="Buatkan pie chart untuk persentase distribusi status pesanan"):
        events.append(event)

    final_event = next(e for e in events if e["event"] == "final_result")
    final_charts = final_event["data"]["charts"]
    assert len(final_charts) == 1
    assert final_charts[0]["chart_type"] == "pie"


@pytest.mark.asyncio
async def test_chart_deduplication():
    """Verify that if make_chart is called multiple times with the same title, only the latest chart is kept."""
    chart_call_1 = ToolCall(
        id="call_c1",
        name="make_chart",
        arguments={
            "title": "Distribusi Status Pesanan",
            "x_axis": "order_status",
            "y_axis": "count",
            "data": [{"order_status": "Delivered", "count": 100}],
        },
    )
    chart_call_2 = ToolCall(
        id="call_c2",
        name="make_chart",
        arguments={
            "title": "Distribusi Status Pesanan",
            "x_axis": "order_status",
            "y_axis": "count",
            "data": [{"order_status": "Delivered", "count": 8}],
        },
    )

    canned_responses = [
        LLMResponse(content="Langkah 1", tool_calls=[chart_call_1]),
        LLMResponse(content="Langkah 2", tool_calls=[chart_call_2]),
        LLMResponse(content="Selesai", tool_calls=[]),
    ]

    mock_llm = MockLLMProvider(canned_responses=canned_responses)
    agent = ManualAgentLoop(llm=mock_llm, max_steps=5)

    events = []
    async for event in agent.run(user_query="Buatkan chart donat status pesanan"):
        events.append(event)

    final_event = next(e for e in events if e["event"] == "final_result")
    final_charts = final_event["data"]["charts"]
    # Only 1 deduplicated chart with the latest data and doughnut type
    assert len(final_charts) == 1
    assert final_charts[0]["chart_type"] == "doughnut"
    assert final_charts[0]["data"][0]["count"] == 8


@pytest.mark.asyncio
async def test_auto_synthesize_pie_chart_from_sql_only():
    """Verify that if LLM only calls run_sql and never calls make_chart, agent auto-synthesizes a pie chart without col_y error."""
    run_sql_call = ToolCall(
        id="call_sql_order_status",
        name="run_sql",
        arguments={"query": "SELECT order_status, COUNT(*) AS count FROM analytics.orders GROUP BY order_status"},
    )

    canned_responses = [
        LLMResponse(
            content="Mengeksekusi SQL untuk mendapatkan distribusi pesanan.",
            tool_calls=[run_sql_call],
        ),
        LLMResponse(
            content="Berikut ringkasan pesanan.",
            tool_calls=[],
        ),
    ]

    mock_llm = MockLLMProvider(canned_responses=canned_responses)
    agent = ManualAgentLoop(llm=mock_llm, max_steps=5)

    events = []
    async for event in agent.run(user_query="Buatkan pie chart untuk persentase distribusi status pesanan (delivered, shipped, canceled)"):
        events.append(event)

    final_event = next(e for e in events if e["event"] == "final_result")
    final_charts = final_event["data"]["charts"]
    assert len(final_charts) == 1
    assert final_charts[0]["chart_type"] == "pie"
    assert len(final_charts[0]["data"]) > 0


@pytest.mark.asyncio
async def test_make_chart_multi_series_preservation():
    """Verify MakeChartTool and ObservationProcessor preserve all series for multi-entity comparison."""
    tool = MakeChartTool()
    multi_data = [
        {"month": "2025-06", "client_id": "ORG-101", "total_api_calls": 5000},
        {"month": "2025-06", "client_id": "ORG-104", "total_api_calls": 4200},
        {"month": "2025-07", "client_id": "ORG-101", "total_api_calls": 5300},
        {"month": "2025-07", "client_id": "ORG-104", "total_api_calls": 4400},
    ]
    res = await tool.execute(
        chart_type="line",
        title="Monthly API Calls: ORG-101 vs ORG-104",
        x_axis="month",
        y_axis="total_api_calls",
        data=multi_data,
    )
    assert res["status"] == "success"
    chart = res["chart"]
    assert chart["chart_type"] == "line"
    assert len(chart["data"]) == 4
    # All rows and keys are preserved
    assert any(d.get("client_id") == "ORG-101" for d in chart["data"])
    assert any(d.get("client_id") == "ORG-104" for d in chart["data"])


@pytest.mark.asyncio
async def test_no_chart_when_not_requested():
    """Verify that if user asks a standard query without chart keywords, no chart is generated."""
    run_sql_call = ToolCall(
        id="call_sql_sales",
        name="run_sql",
        arguments={"query": "SELECT category, SUM(amount) AS total FROM analytics.sales GROUP BY category"},
    )
    canned_responses = [
        LLMResponse(content="Running query.", tool_calls=[run_sql_call]),
        LLMResponse(content="Berikut ringkasan total penjualan per kategori.", tool_calls=[]),
    ]
    mock_llm = MockLLMProvider(canned_responses=canned_responses)
    agent = ManualAgentLoop(llm=mock_llm, max_steps=5)

    events = []
    async for event in agent.run(user_query="Berapa total penjualan dan analisis per kategori?"):
        events.append(event)

    final_event = next(e for e in events if e["event"] == "final_result")
    final_charts = final_event["data"]["charts"]
    assert len(final_charts) == 0





