# pi-continuity

Opt-in read-only planning gate, structured clarification, visible todos, external workspace memory, compact ephemeral context. Plan mode starts only through explicit `/plan`; natural-language keywords and `continuity_update set_plan` cannot activate the gate. For ordinary non-trivial multi-step work, the model calls `continuity_update set_plan` directly to create an executing todo list without requiring `/plan` or approval.

Commands: `/plan [goal|approve|cancel|status]`, `/todos`, `/memory status|show|compact|forget workspace`. Task widget shows all stored todos while agent is working and clears when turn settles; todo descriptions are capped at 120 characters. `/todos` remains available afterward. Continuity does not add footer status.

State lives under `${PI_CODING_AGENT_DIR:-~/.pi/agent}/pi-continuity`, never project. Direct execution task lists do not restrict tools. `/plan` permits only `read`, `grep`, `find`, `ls`, `continuity_update`, `repo_scout`, and `advisor`; `/plan approve` restores only tools Continuity removed. Replanning preserves matching todo progress; completion requires every todo done. Memory candidates can be stored with or without active plan work and automatically compact when each agent turn settles; `/memory compact` remains available for immediate manual compaction. No model call occurs. Compacted facts survive reload, enter current-workspace context, and can surface from nearest parent workspace when relevant. Persisted work and memory are schema-validated; malformed files are quarantined. Writes use unique temporary files and short cross-process locks. Pi owns sessions and compaction.

Install: `pi install C:\Users\FadhilP\.pi\packages\pi-continuity`. Edit source then `/reload`.

Extensions execute with full user permissions. V1: no branch-aware active work, shell in plan mode, cloud sync, or interactive clarification in print/JSON modes.
