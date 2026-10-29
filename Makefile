.PHONY: run stop test lint build

run:
	@chmod +x run.sh
	@./run.sh

stop:
	@chmod +x stop.sh
	@./stop.sh

test:
	@.venv/bin/pytest tests/ -v

build:
	@cd frontend && npm run build
