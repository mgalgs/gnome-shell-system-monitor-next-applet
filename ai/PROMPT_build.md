0a. Study `ai/specs/*` with up to 500 parallel Sonnet subagents to learn the application specifications.
0b. Study @ai/PRD.md to understand product requirements, scope, and definitions.
0c. Study @ai/IMPLEMENTATION_PLAN.md.
0d. Study @ai/INPUT.md as well if it exists (human input).
0e. Reference @ai/TASK_widget-architecture-modernization.md for the original task definition, but the PRD and specs should be the main source source of truth. There might be holes though. Synthesize all information into the optimal solution and get clarification from the human when conflicts arise. Suggest fixes/updates to PRD, specs, or implementation plan if needed.
0f. For reference, the application source code is mostly in `system-monitor-next@paradoxxx.zero.gmail.com/*`. Build, locale, and other files are at the top level.

1. Your task is to implement functionality per the specifications using parallel subagents. Follow @ai/IMPLEMENTATION_PLAN.md and choose the most important item to address. Before making changes, search the codebase (don't assume not implemented) using Sonnet subagents. You may use up to 500 parallel Sonnet subagents for searches/reads and only 1 Sonnet subagent for build/tests. Use Opus subagents when complex reasoning is needed (debugging, architectural decisions).
2. The implementation should be broken into separate PRs for human review. Small PRs are preferred, with an upper limit of 1,000 lines unless explicit permission is granted (sometimes large deltas are unavoidable). Keep this in mind when choosing the scope of work for the current task.
3. Assume all work will be done on the current checked out branch. There's no need to investigate other branches.
4. After implementing functionality or resolving problems, run the tests for that unit of code that was improved. If functionality is missing then it's your job to add it as per the application specifications. Ultrathink.
5. When you discover issues, immediately update @ai/IMPLEMENTATION_PLAN.md with your findings using a subagent. When resolved, update and remove the item.
6. When the tests pass, update @ai/IMPLEMENTATION_PLAN.md.
7. Commit the changes with `git add` and `git commit`. You should create 2 commits: one for all changes under `ai/` (for work tracking) and a separate commit for the actual code changes.

9999. Assume that all background services (Postgres, Redis, etc) are already running (you don't need to start any services to be able to run tests).
99999. Important: When authoring documentation, capture the why — tests and implementation importance.
999999. Important: Single sources of truth, no migrations/adapters. If tests unrelated to your work fail, resolve them as part of the increment.
9999999. You may add extra logging if required to debug issues.
99999999. Keep @ai/IMPLEMENTATION_PLAN.md current with learnings using a subagent — future work depends on this to avoid duplicating efforts. Update especially after finishing your turn.
999999999. When you learn something new about how to run the application, update @AGENTS.md using a subagent but keep it brief. For example if you run commands multiple times before learning the correct command then that file should be updated.
9999999999. For any bugs you notice, resolve them or document them in @ai/IMPLEMENTATION_PLAN.md using a subagent even if it is unrelated to the current piece of work.
99999999999. Implement functionality completely. Placeholders and stubs waste efforts and time redoing the same work.
999999999999. When @ai/IMPLEMENTATION_PLAN.md becomes large periodically clean out the items that are completed from the file using a subagent.
9999999999999. If you find inconsistencies in the ai/specs/* then use an Opus 4.5 subagent with 'ultrathink' requested to update the specs.
99999999999999. IMPORTANT: Keep @AGENTS.md operational only — status updates and progress notes belong in `IMPLEMENTATION_PLAN.md`. A bloated AGENTS.md pollutes every future loop's context.
