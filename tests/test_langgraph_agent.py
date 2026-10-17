"""Unit tests for LangGraph Agent implementation (FR-03)."""

import pytest

from src.agent.langgraph_agent import LangGraphAgent
from src.agent.models import AgentFinalResponse
from src.llm.provider import LLMResponse, MockLLMProvider, ToolCall


@pytest.mark.asyncio
async def test_langgraph_agent_full_flow():
    """Test full LangGraph execution flow: plan -> schema -> query -> synthesize."""
    canned_responses = [
        # Step 1: Request schema
        LLMResponse(
            content="Mencari skema tabel yang relevan.",
            tool_calls=[
                ToolCall(
                    id="call_schema",
                    name="get_schema",
                    arguments={"table_names": ["products"]},
                )
            ],
            model="mock-langgraph",
        ),
        # Step 2: Request run_sql
        LLMResponse(
            content="Menjalankan query SQL untuk menghitung total produk per kategori.",
            tool_calls=[
                ToolCall(
                    id="call_sql",
                    name="run_sql",
                    arguments={
                        "query": "SELECT product_category_name, COUNT(*) as total FROM analytics.products GROUP BY product_category_name"
                    },
                )
            ],
            model="mock-langgraph",
        ),
        # Step 3: Final answer
        LLMResponse(
            content="Berdasarkan data produk analitik, kategori produk didominasi oleh Elektronik dan Fashion.",
            tool_calls=[],
            model="mock-langgraph",
        ),
    ]

    mock_llm = MockLLMProvider(canned_responses)
    agent = LangGraphAgent(llm=mock_llm, max_steps=5)

    response = await agent.run(user_query="Kategori produk apa yang paling banyak?")

    assert isinstance(response, AgentFinalResponse)
    assert "Elektronik dan Fashion" in response.answer_text
    assert len(response.sql_queries) == 1
    assert "SELECT product_category_name" in response.sql_queries[0]
    assert len(response.tables) == 1
    assert "product_category_name" in response.tables[0].columns


@pytest.mark.asyncio
async def test_langgraph_agent_blocks_malicious_ddl():
    """Test that LangGraph agent intercepts and blocks malicious DDL via AST guardrail."""
    canned_responses = [
        LLMResponse(
            content="Mencoba menghapus tabel.",
            tool_calls=[
                ToolCall(
                    id="call_drop",
                    name="run_sql",
                    arguments={"query": "DROP TABLE analytics.orders;"},
                )
            ],
            model="mock-langgraph",
        ),
        LLMResponse(
            content="Maaf, operasi penulisan atau DDL tidak diizinkan oleh kebijakan keamanan.",
            tool_calls=[],
            model="mock-langgraph",
        ),
    ]

    mock_llm = MockLLMProvider(canned_responses)
    agent = LangGraphAgent(llm=mock_llm, max_steps=4)

    response = await agent.run(user_query="Hapus semua pesanan!")

    assert isinstance(response, AgentFinalResponse)
    assert len(response.sql_queries) == 0  # Blocked from executing!
    assert "tidak diizinkan" in response.answer_text


@pytest.mark.asyncio
async def test_langgraph_agent_approval_gate():
    """Test that LangGraph agent halts execution when query touches sensitive data without approval."""
    canned_responses = [
        LLMResponse(
            content="Mengambil data sensitif pelanggan.",
            tool_calls=[
                ToolCall(
                    id="call_sensitive",
                    name="run_sql",
                    arguments={"query": "SELECT customer_id, customer_email, customer_phone FROM analytics.customers"},
                )
            ],
            model="mock-langgraph",
        ),
    ]

    mock_llm = MockLLMProvider(canned_responses)
    agent = LangGraphAgent(llm=mock_llm, max_steps=3)

    # First run without approval
    response = await agent.run(
        user_query="Tampilkan email dan telepon semua pelanggan",
        is_approved=False,
    )

    assert "PERHATIAN: Query membutuhkan persetujuan" in response.answer_text
    assert len(response.sql_queries) == 0  # Halted before execution!


@pytest.mark.asyncio
async def test_langgraph_agent_calculate_tool_and_history():
    """Test that LangGraph agent can execute Python calculation tool and retain chat history."""
    canned_responses = [
        LLMResponse(
            content="Melakukan perhitungan pertumbuhan persentase di Python sandbox.",
            tool_calls=[
                ToolCall(
                    id="call_calc",
                    name="calculate",
                    arguments={"code": "growth = ((1500 - 1200) / 1200) * 100\nresult = round(growth, 2)"},
                )
            ],
            model="mock-langgraph",
        ),
        LLMResponse(
            content="Pertumbuhan pesanan periode ini adalah sebesar 25.0%.",
            tool_calls=[],
            model="mock-langgraph",
        ),
    ]

    mock_llm = MockLLMProvider(canned_responses)
    agent = LangGraphAgent(llm=mock_llm, max_steps=4)

    chat_history = [
        {"role": "user", "content": "Berapa pesanan bulan lalu?"},
        {"role": "assistant", "content": "Bulan lalu ada 1200 pesanan."},
    ]

    response = await agent.run(
        user_query="Berapa persentase pertumbuhan jika bulan ini 1500 pesanan?",
        chat_history=chat_history,
    )

    assert "25.0%" in response.answer_text
    assert response.total_steps > 0
