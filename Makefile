.PHONY: help setup check ci psx-check gix-doctor

PIPELINE_REF := f4e05487193a653ecb96cd09f9a6b2da7ba4822f

help:
	@printf "%s\n" "setup       Install pinned Pipeline and pnpm dependencies" "check       Run repository validation" "ci          Run all configured quality gates" "psx-check   Check repository structure" "gix-doctor  Diagnose Git-flow setup"

setup:
	python -m pip install "git+https://github.com/m-mdy-m/pipeline.git@$(PIPELINE_REF)"
	pnpm install --frozen-lockfile

check:
	pipeline run check

ci:
	pipeline run ci

psx-check:
	psx check

gix-doctor:
	gix doctor
