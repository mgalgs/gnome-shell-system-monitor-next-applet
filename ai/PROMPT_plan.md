0a. Study `ai/specs/*` with up to 250 parallel Sonnet subagents to learn the application specifications.
0b. Study @ai/PRD.md to understand product requirements, scope, and definitions.
0c. Study @ai/IMPLEMENTATION_PLAN.md (if present) to understand the plan so far.
0d. Study @ai/INPUT.md as well if it exists (human input).
0e. Reference @ai/TASK_widget-architecture-modernization.md for the original task definition, but the PRD and specs should be the main source source of truth. There might be holes though. Synthesize all information into the optimal solution and get clarification from the human when conflicts arise.
0f. For reference, the application source code is mostly in `system-monitor-next@paradoxxx.zero.gmail.com/*`. Build, locale, and other files are at the top level.

1. Study @ai/IMPLEMENTATION_PLAN.md (if present; it may be incorrect) and use up to 500 Sonnet subagents to study existing source code in the working tree and compare it against `ai/specs/*`. Use an Opus subagent to analyze findings, prioritize tasks, and create/update @ai/IMPLEMENTATION_PLAN.md as a bullet point list sorted in priority of items yet to be implemented. Ultrathink. Consider searching for TODO, minimal implementations, placeholders, skipped/flaky tests, and inconsistent patterns. Study @ai/IMPLEMENTATION_PLAN.md to determine starting point for research and keep it up to date with items considered complete/incomplete using subagents.

IMPORTANT: Plan only. Do NOT implement anything. Do NOT assume functionality is missing; confirm with code search first. Prefer consolidated, idiomatic implementations over ad-hoc copies.

CRITICAL CONSTRAINT: Treat the working tree as if it has no git history. If `ls` or `cat` can't show it, it doesn't exist. Do NOT examine git history, remote branches, stashes, or any code not present in the current checkout. If a model/service/file doesn't exist in the working directory right now, mark it as NOT IMPLEMENTED regardless of what git history might show. DO NOT investigate or reference work on any other branch. Only use the current working tree.

ULTIMATE GOAL: We want to improve developer experience (devex) and provide a better framework for widget implementations, without re-writing the entire application. Wiring the new modular architecture in to the existing implementation with minimal changes to the existing implementation so that we can gradually migrate widgets to the new framework incrementally and based on need for support for new features, which will be easier to add to the new framework.

Consider missing elements and plan accordingly. If an element is missing, search first to confirm it doesn't exist, then if needed author the specification at `ai/specs/FILENAME.md`. If you create a new element then document the plan to implement it in @ai/IMPLEMENTATION_PLAN.md using a subagent.
