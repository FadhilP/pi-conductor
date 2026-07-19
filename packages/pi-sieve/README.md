# pi-sieve

Outbound bulky tool-output limiting for [Pi](https://pi.dev).

## Installation

```sh
pi install git:github.com/FadhilP/pylon
```

This installs the complete Pylon bundle, including pi-sieve. Run `/reload` after installation.

## Usage

```text
/sieve status
/sieve disable
/sieve enable
/sieve observe
/sieve active enable
/sieve active disable
/sieve threshold 12000
/sieve threshold reset
/sieve reset-stats
```

Pi Sieve is enabled by default. Its global mode and telemetry reset with each runtime. The configured threshold and active-pruning decision persist across restarts in `<agent-dir>/pi-sieve/config.json`. `observe` performs the same classification as `enable`, but does not change outbound context. `disable` neither classifies nor changes context. Thresholds are integer JavaScript-character counts from 1,000 through 50,000; the default is 8,192.

Active-result pruning defaults on. `/sieve active enable` and `/sieve active disable` save that decision for future runtimes. In global `enabled` mode, eligible text-only age-0 results strictly over the configured threshold are capped to that threshold including a recovery marker. Successful output retains balanced head and tail text; errors retain tail text. Active pruning uses the same eligible source tools as age pruning: `bash`, `grep`, `find`, `ls`, `rg`, and `fd`; `read` remains excluded. The full original remains in the stored session, while only the omitted text is exposed during the current user turn through `sieve_recall`, keyed by the exact `toolCallId` shown in the marker. Multiple source text blocks are treated as one concatenated text stream. Results without a unique non-empty tool-call ID, or whose recovery marker leaves no retained payload, fail open and remain unchanged. Recalled output remains visible at age 0, then follows the original source tool's normal age, budget, and giant-error pruning rules. Failed or malformed recalls and recalls of ineligible source tools remain unchanged. The recall tool is active only when both active-result pruning and global `enabled` mode are active. Reloading clears its in-memory current-turn recovery index, not the saved setting.

`/sieve threshold <value>` and `/sieve threshold reset` also persist. `status` reports the latest call and cumulative telemetry: scanned results, actual or observe-projected transformations (including age-threshold, budget, giant-error, and active-threshold classifications), estimated gross and net tokens saved, each skip reason, and active recall volume. Token estimates use four JavaScript characters per token; exact provider tokenization varies. `reset-stats` clears only telemetry; it preserves mode and saved settings.

Pi Sieve creates an outbound context view; it never modifies stored session messages.

## Policy

Only `bash`, `grep`, `find`, `ls`, `rg`, and `fd` results are eligible; `read` results are never changed. Results must contain only text blocks. Their age is the number of user messages after the result. With active-result pruning disabled, age 0 is preserved. With active-result pruning enabled by default, eligible age-0 successes and errors strictly over the configured threshold are partially retained with a recall marker. At age 1, successful output is capped at the configured threshold when active-result pruning is enabled. When active-result pruning is disabled, only output strictly over three times the configured threshold is capped to that size. At ages 2–5 the configured threshold applies, and at age 6+ it is halved (minimum 1,000 characters). Equality is retained.

Eligible successful output at ages 2+ shares a retained-source budget of three times the configured threshold. It is evaluated newest-to-oldest. Results are retained whole when they fit; otherwise, available budget keeps balanced head and tail text around an omission marker. Once no useful retained-source budget remains, older results use marker-only output. Marker overhead is outside the retained-source budget. Any replacement that would be as large as its source fails open. Age-1 output remains outside this cumulative budget.

Old eligible text-only errors remain intact except giant errors strictly over `max(32,000, 4 × threshold)` characters. Those are replaced by a compact error marker followed by the final 2,048 source characters. Errors do not consume the successful-output budget. Non-text, malformed, mixed-content, and empty errors stay unchanged.

Without active-result pruning, age 0 is preserved and fewer than two user messages means nothing is transformed. Active-result pruning can operate on the first user turn. Tool results are never deleted, stored messages stay untouched, and all non-content message fields remain intact.
