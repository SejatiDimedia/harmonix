"""Tests for Metric Watchdog & Alerting Engine with Scoped Architecture (FR-49)."""

import pytest
from src.watchdog.manager import (
    init_watchdog_tables,
    create_rule,
    list_rules,
    get_logs,
    evaluate_rule,
    delete_rule,
    get_triggered_count,
    WatchdogRuleCreate,
)
from src.agent.state import delete_session


@pytest.mark.asyncio
async def test_watchdog_scoped_rules_and_filtering():
    """Verify global vs session-scoped watchdog rules and contextual filtering."""
    await init_watchdog_tables()

    sess_1 = "ses_watchdog_test_1"
    sess_2 = "ses_watchdog_test_2"

    # 1. Create a global warehouse rule
    global_rule = await create_rule(
        WatchdogRuleCreate(
            rule_name="Global Test Rule",
            description="Warehouse-wide test rule",
            sql_query="SELECT 100 AS test_metric;",
            target_column="test_metric",
            operator=">",
            threshold_value=50.0,
            cron_interval_minutes=60,
            severity="warning",
            scope="global",
            session_id=None,
        )
    )
    assert global_rule.scope == "global"
    assert global_rule.session_id is None

    # 2. Create a session-scoped rule for sess_1
    sess_rule = await create_rule(
        WatchdogRuleCreate(
            rule_name="Session 1 Excel Alert",
            description="Ad-hoc Excel metric alert",
            sql_query="SELECT 15 AS excel_stock;",
            target_column="excel_stock",
            operator="<",
            threshold_value=20.0,
            cron_interval_minutes=30,
            severity="critical",
            scope="session",
            session_id=sess_1,
        )
    )
    assert sess_rule.scope == "session"
    assert sess_rule.session_id == sess_1

    try:
        # 3. Contextual list for sess_1 should include global rule AND sess_1 rule
        rules_sess_1 = await list_rules(session_id=sess_1)
        r_ids_1 = [r.id for r in rules_sess_1]
        assert global_rule.id in r_ids_1
        assert sess_rule.id in r_ids_1

        # 4. Contextual list for sess_2 should include global rule, but NOT sess_1 rule
        rules_sess_2 = await list_rules(session_id=sess_2)
        r_ids_2 = [r.id for r in rules_sess_2]
        assert global_rule.id in r_ids_2
        assert sess_rule.id not in r_ids_2

        # 5. Filter specifically by scope="global"
        global_only = await list_rules(scope="global")
        assert any(r.id == global_rule.id for r in global_only)
        assert not any(r.id == sess_rule.id for r in global_only)

        # 6. Filter specifically by scope="session" for sess_1
        sess_only = await list_rules(session_id=sess_1, scope="session")
        assert len(sess_only) >= 1
        assert any(r.id == sess_rule.id for r in sess_only)
        assert not any(r.id == global_rule.id for r in sess_only)

        # 7. Evaluate the session rule and verify log captures scope and session_id
        log_entry = await evaluate_rule(sess_rule.id)
        assert log_entry.is_triggered is True
        assert log_entry.scope == "session"
        assert log_entry.session_id == sess_1

        # 8. Check log filtering
        logs_sess_1 = await get_logs(limit=20, session_id=sess_1)
        assert any(l.rule_id == sess_rule.id for l in logs_sess_1)

        # 9. Verify triggered count for sess_1 includes the triggered sess_rule
        count_sess_1 = await get_triggered_count(session_id=sess_1)
        assert count_sess_1 >= 1

        # 10. Clean up session and verify session-scoped rule is removed
        await delete_session(sess_1)
        rules_after_delete = await list_rules(session_id=sess_1)
        assert not any(r.id == sess_rule.id for r in rules_after_delete)

    finally:
        # Clean up global test rule
        await delete_rule(global_rule.id)
