# pi-guard

Conservative destructive-command and path guard for [Pi](https://pi.dev).

Install: `pi install C:\Users\FadhilP\.pi\packages\pi-guard`, then `/reload`. `/guard` reports session counters.

Pi Guard intercepts agent `bash`, `write`, and `edit` calls plus user `!`/`!!` shell commands. It asks once before recursive deletion, privilege escalation, destructive Git reset/clean, force push, disk writes, and recursive permission changes. Without confirmation UI, risky commands fail closed.

Writes outside the workspace, inside `.git`, or inside `node_modules` are always blocked. `.env` writes require confirmation. Existing targets and nearest existing parents are canonicalized so symlink paths cannot escape the workspace.

V1 deliberately uses a narrow command policy. It is not a shell parser, sandbox, malware detector, or substitute for OS/container isolation. Unrecognized commands retain full user permissions. Review commands before approval.
