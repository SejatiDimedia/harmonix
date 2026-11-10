# Project Summary: Harmonix AI Data Analyst Platform

Concise Situation, Task, Action, and Result summary designed for resumes, professional profiles, and interview discussions.

### Situation
Business teams frequently experienced decision-making delays due to backlogged queues of ad-hoc report requests waiting on data analysts. Simultaneously, granting non-technical users direct database access or connecting generic commercial language models without safeguards posed severe risks of accidental data corruption, customer privacy leaks, and calculation hallucinations that could mislead strategic business choices.

### Task
Architect and implement a production-grade, self-service data analyst agent platform capable of translating natural language inquiries into precise analytical queries and visual charts, backed by strict read-only database enforcement, sensitive data protection, independent numerical verification against calculation hallucinations, and zero-cost compute efficiency.

### Action
Engineered a Python and FastAPI backend featuring a defense-in-depth harness, comprising a low-overhead pure asyncio agent loop, deterministic Abstract Syntax Tree validation via sqlglot to block data mutation and query injection, automatic sensitive data redaction, a non-blocking human approval gate for high-risk operations, and isolated subprocess execution for Python statistical calculations backed by kernel SIGKILL timeouts. Integrated a Maker-Checker architecture with an independent Auditor agent to verify narrative numerical consistency against raw query tables, hybrid metric glossary search via pgvector and BM25, and an interactive web interface powered by React and Apache ECharts.

### Result
Achieved a 100% safety pass rate across all adversarial benchmark scenarios, completely preventing data modification attempts and customer privacy exposures. Attained 95.6% tool-call correctness, 94.2% factual consistency between narrative outputs and raw query results, and execution accuracy of 82.2% on isolated baseline runs and 91.1% on cloud model benchmarks with P95 latency under 3.2 seconds. System robustness was validated across 196 automated tests with zero dollar operational inference costs via local models and free-tier cloud allocations.

