#!/usr/bin/env python3
"""Detect tracked environment files, recordings, and obvious secrets without printing values."""

from __future__ import annotations

import argparse
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKIP_PARTS = {
    ".git",
    ".idea",
    ".venv",
    "__pycache__",
    "build",
    "dist",
    "node_modules",
}
TEXT_SUFFIXES = {
    "",
    ".cjs",
    ".conf",
    ".html",
    ".ini",
    ".js",
    ".json",
    ".jsonl",
    ".md",
    ".mjs",
    ".py",
    ".sh",
    ".toml",
    ".ts",
    ".txt",
    ".yaml",
    ".yml",
}
# 녹음 원본과 변환본은 서버 volume에만 둔다(AGENTS.md 3.1).
AUDIO_SUFFIXES = {".ogg", ".opus", ".webm", ".wav", ".mp3", ".m4a", ".flac", ".pcm"}
SECRET_NAME = (
    r"[A-Za-z0-9_]*(?:password|passwd|api[_-]?key|api[_-]?token|auth[_-]?token"
    r"|secret[_-]?key|access[_-]?token|client[_-]?secret|bot[_-]?token|encryption[_-]?key)"
)
PLACEHOLDER = r"(?!\$\{|<|example|redacted|masked|changeme|dummy)"
RULES = (
    ("private-key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("github-token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{20,})")),
    ("anthropic-key", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}")),
    ("openai-key", re.compile(r"\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{32,}")),
    ("clickup-token", re.compile(r"\bpk_[0-9]+_[A-Za-z0-9]{20,}")),
    # Atlassian API 토큰(Confluence·Jira). 옛 ClickUp 토큰이 남아 있을 수 있어 ClickUp 규칙도 지우지 않는다.
    ("atlassian-token", re.compile(r"\bATATT[A-Za-z0-9_=-]{20,}")),
    ("discord-bot-token", re.compile(r"\b[MNO][A-Za-z0-9_-]{23,27}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}")),
    (
        "discord-webhook-url",
        re.compile(r"https://(?:\w+\.)?discord(?:app)?\.com/api/webhooks/[0-9]+/[A-Za-z0-9_-]+"),
    ),
    # 코드의 `token = process.env.DISCORD_TOKEN` 같은 참조는 잡지 않도록 따옴표로 감싼 값만 본다.
    (
        "assigned-secret",
        re.compile(
            rf"(?i)\b{SECRET_NAME}[\"']?\s*(?::\s*[\w\[\]|. ]+?\s*)?[:=]\s*[\"']"
            rf"{PLACEHOLDER}[^\s\"']{{12,}}[\"']"
        ),
    ),
    (
        "env-assigned-secret",
        re.compile(
            r"^\s*(?:export\s+)?[A-Z0-9_]*(?:PASSWORD|PASSWD|API_KEY|TOKEN"
            r"|SECRET|ENCRYPTION_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*"
            r"(?!\$\{|<|example|redacted|masked|changeme|dummy)[^\s#\"']{12,}"
        ),
    ),
)


def git_paths(*arguments: str) -> list[Path]:
    result = subprocess.run(
        ["git", *arguments],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        return []
    return [ROOT / line for line in result.stdout.splitlines() if line]


def staged_paths() -> list[Path]:
    result = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
        cwd=ROOT,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        return []
    return [
        ROOT / item.decode("utf-8", errors="surrogateescape")
        for item in result.stdout.split(b"\0")
        if item
    ]


def skipped(path: Path) -> bool:
    return bool(SKIP_PARTS.intersection(path.relative_to(ROOT).parts))


def candidate_paths(staged: bool) -> list[Path]:
    paths = staged_paths() if staged else git_paths("ls-files", "-co", "--exclude-standard")
    return sorted(
        {
            path
            for path in paths
            if path.is_file()
            and path.resolve() != Path(__file__).resolve()
            and not skipped(path)
            and path.suffix.lower() in TEXT_SUFFIXES
        }
    )


def tracked_paths(staged: bool) -> list[Path]:
    return staged_paths() if staged else git_paths("ls-files", "-co", "--exclude-standard")


def forbidden_files(staged: bool) -> list[str]:
    findings = []
    for path in tracked_paths(staged):
        relative = path.relative_to(ROOT)
        if path.name.startswith(".env") and path.name not in {".env.example", ".env.template", ".env.sample"}:
            findings.append(f"{relative}: tracked-env-file")
        elif path.suffix.lower() in AUDIO_SUFFIXES and not skipped(path):
            findings.append(f"{relative}: audio-file")
        elif "recordings" in relative.parts:
            findings.append(f"{relative}: recordings-dir")
    return findings


def read_lines(path: Path, staged: bool) -> list[str]:
    if not staged:
        return path.read_text(encoding="utf-8").splitlines()
    relative = path.relative_to(ROOT).as_posix()
    result = subprocess.run(
        ["git", "show", f":{relative}"],
        cwd=ROOT,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise OSError(f"unable to read staged file: {relative}")
    return result.stdout.decode("utf-8").splitlines()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--staged", action="store_true", help="inspect only the exact staged blobs")
    args = parser.parse_args()
    findings = forbidden_files(args.staged)
    paths = candidate_paths(args.staged)

    for path in paths:
        try:
            lines = read_lines(path, args.staged)
        except (UnicodeDecodeError, OSError):
            continue
        for line_number, line in enumerate(lines, start=1):
            for rule_name, pattern in RULES:
                if pattern.search(line):
                    findings.append(f"{path.relative_to(ROOT)}:{line_number}: {rule_name}")

    if findings:
        print("Preflight failed. Matched values are intentionally hidden.")
        for finding in findings:
            print(f"- {finding}")
        return 1

    scope = "staged" if args.staged else "repository"
    print(f"Preflight passed: {len(paths)} {scope} text files inspected.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
