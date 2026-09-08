"""Transfer monthly Node policy proposals as data between isolated workflow jobs."""

import argparse
import json
import os
import re
import stat
import subprocess
from pathlib import Path

ALLOWED_FILES = frozenset(
    {
        ".nvmrc",
        "package.json",
        "README.md",
        ".github/CONTRIBUTING.md",
        "NODE_VERSION_POLICY.md",
    }
)
# This is a workflow artifact limit; it does not constrain SDK request payloads.
MAX_PROPOSAL_BYTES = 1024 * 1024


def reject(message):
    raise ValueError(message)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            reject("Duplicate JSON key")
        result[key] = value
    return result


def parse_json(content):
    return json.loads(
        content,
        object_pairs_hook=unique_object,
        parse_constant=lambda _: reject("Non-finite JSON number"),
    )


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False)


def git(*args):
    return subprocess.check_output(["git", *args], text=True, encoding="utf-8").rstrip(
        "\n"
    )


def regular_file(path):
    """Do not follow links in either the file or its containing directories."""
    for parent in path.parents:
        if parent.is_symlink():
            reject("Symlinked parent directory")
    mode = path.lstat().st_mode
    if not stat.S_ISREG(mode) or mode & 0o111:
        reject("Proposal files must be regular, non-executable files")
    if path.stat().st_size > MAX_PROPOSAL_BYTES:
        reject("Proposal exceeds the workflow artifact size limit")


def text_bytes(content):
    if not isinstance(content, str) or "\0" in content:
        reject("Expected UTF-8 text without NUL bytes")
    encoded = content.encode("utf-8")
    if len(encoded) > MAX_PROPOSAL_BYTES:
        reject("Proposal exceeds the workflow artifact size limit")
    return encoded


def baseline_file(base_sha, filename):
    entry = git("ls-tree", base_sha, "--", filename)
    if not entry.startswith("100644 blob ") or entry.split("\t")[-1] != filename:
        reject("Baseline file must be a tracked regular file")
    return subprocess.check_output(["git", "show", f"{base_sha}:{filename}"]).decode(
        "utf-8"
    )


def verify(proposal, base_sha, root):
    if not isinstance(proposal, dict) or set(proposal) != {"base_sha", "files", "body"}:
        reject("Invalid proposal fields")
    if proposal["base_sha"] != base_sha:
        reject("Proposal does not match the workflow commit")
    files = proposal["files"]
    if not isinstance(files, dict) or not set(files) <= ALLOWED_FILES:
        reject("Proposal contains files outside the Node policy allowlist")
    body = text_bytes(proposal["body"])
    updates = {}
    for filename, content in files.items():
        text_bytes(content)
        regular_file(root / filename)
        baseline = baseline_file(base_sha, filename)
        if filename == ".nvmrc" and not re.fullmatch(r"[1-9][0-9]*\n?", content):
            reject(".nvmrc must contain one ASCII Node.js major version")
        if filename == "package.json":
            candidate = parse_json(content)
            expected = parse_json(baseline)
            if not isinstance(candidate, dict) or not isinstance(
                candidate.get("engines"), dict
            ):
                reject("Invalid package.json engines")
            node = candidate["engines"].get("node")
            if not isinstance(node, str) or not re.fullmatch(
                r">=[1-9][0-9]*\.0\.0", node
            ):
                reject("Invalid package.json engines.node")
            expected["engines"]["node"] = node
            # Canonical JSON distinguishes booleans and numbers, unlike Python equality.
            if canonical(candidate) != canonical(expected):
                reject("Only package.json engines.node may change")
            content = (
                json.dumps(expected, ensure_ascii=False, indent=2, allow_nan=False)
                + "\n"
            )
        if content != baseline:
            updates[filename] = text_bytes(content)
    return updates, body


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["export", "apply"])
    parser.add_argument("--base-sha", required=True)
    parser.add_argument("--proposal", required=True, type=Path)
    parser.add_argument("--body-output", type=Path)
    args = parser.parse_args()
    root = Path.cwd()
    if (
        not re.fullmatch(r"[0-9a-f]{40}", args.base_sha)
        or git("rev-parse", "HEAD") != args.base_sha
    ):
        reject("Checkout does not match the workflow commit")
    if Path(git("rev-parse", "--show-toplevel")) != root:
        reject("Run from the repository root")

    if args.command == "export":
        changed = git("diff", "--name-only", "-z", args.base_sha, "--").split("\0")
        untracked = git("ls-files", "--others", "--exclude-standard", "-z").split("\0")
        filenames = set(changed + untracked) - {""}
        if not filenames <= ALLOWED_FILES:
            reject("Working tree contains changes outside the Node policy allowlist")
        files = {}
        for filename in sorted(filenames):
            regular_file(root / filename)
            files[filename] = (root / filename).read_text(encoding="utf-8")
        proposal = {
            "base_sha": args.base_sha,
            "files": files,
            "body": os.environ.get("REVIEW_BODY", ""),
        }
        verify(proposal, args.base_sha, root)
        encoded = text_bytes(json.dumps(proposal, ensure_ascii=False, allow_nan=False))
        args.proposal.parent.mkdir(parents=True, exist_ok=True)
        args.proposal.write_bytes(encoded)
        return

    if git("status", "--porcelain", "--untracked-files=all"):
        reject("Apply requires a fresh, clean checkout")
    regular_file(args.proposal.absolute())
    proposal = parse_json(args.proposal.read_bytes().decode("utf-8"))
    updates, body = verify(proposal, args.base_sha, root)
    if args.body_output is None or args.body_output.resolve().is_relative_to(root):
        reject("The pull request body must be outside the checkout")
    for parent in args.body_output.absolute().parents:
        if parent.is_symlink() or not parent.is_dir():
            reject("Invalid pull request body directory")
    if args.body_output.exists() or args.body_output.is_symlink():
        regular_file(args.body_output.absolute())

    # Everything is validated before any approved file or PR body is materialized.
    for filename, content in updates.items():
        (root / filename).write_bytes(content)
    args.body_output.write_bytes(
        b"Automated monthly review of the Node.js support policy.\n\n"
        + body
        + b"\n\nBefore marking this draft ready, choose the release classification "
        b"required by `NODE_VERSION_POLICY.md` and update the title.\n"
    )
    if output := os.environ.get("GITHUB_OUTPUT"):
        with open(output, "a", encoding="utf-8") as stream:
            stream.write(f"changed={'true' if updates else 'false'}\n")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"Node review proposal rejected: {error}") from None
