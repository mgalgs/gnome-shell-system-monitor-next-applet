# Contributing

## Patch Quality Standards

This project follows the patch discipline of well-maintained open source projects (Linux kernel, Python, Git). Patches should be clean, reviewable, and tell a coherent story.

### Commit Structure

Each commit must:

- **Be a single logical change.** One bug fix, one new feature, one refactor — not a mix. If you find a pre-existing bug while working on something else, fix it in a separate commit.
- **Build and run cleanly.** Every commit in the series must pass `make clean build` and `npm run lint` (no new errors). A reviewer should be able to check out any commit and have a working extension.
- **Have correct dependency order.** If commit B depends on code introduced in commit A, A must come first. The series should read like a tutorial: each commit builds on the last.

### Commit Messages

Follow the `subsystem: summary` format:

```
widgets: Extract all widgets to separate files

Move each widget class from the monolithic extension.js into individual
files under widgets/. No behavior changes — pure code motion.

The battery widget's dependency on build_menu_info is resolved by
exporting it from base.js rather than extension.js.
```

Rules:
- **Subsystem prefix** — use the component name: `base:`, `widgets:`, `extension:`, `schemas:`, `prefs:`, `docs:`, `build:`
- **Summary line** — imperative mood, lowercase after prefix, under 72 characters
- **Body** — explain *why*, not *what* (the diff shows what). Wrap at 72 characters. Include motivation, tradeoffs, and anything a reviewer would ask about.
- **No project-phase tags** — use component names, not internal tracking labels like `widget-mod:` or `phase-2:`

### Patch Series

When submitting a multi-commit branch:

- **No intermediate scaffolding.** Don't add a file in commit 3 that only exists to be replaced in commit 7. Every commit should make sense on its own.
- **No internal tracking artifacts.** Planning docs, AI conversation logs, and scratch files don't belong in commits. Useful content from planning should land as documentation or commit messages.
- **Clean history.** The series should look like it was written by someone who knew the final design from the start, even if the actual development was exploratory. Use `git rebase -i` to squash fixups, reorder for logical flow, and rewrite messages.
- **Reviewable diffs.** A reviewer reading the series top-to-bottom should understand the design as it unfolds. Each commit's diff should be small enough to review in one sitting.

### What NOT to Commit

- AI conversation logs, planning documents, or task tracking files
- Intermediate states that only exist as stepping stones (add a bridge in one commit, remove it in another)
- Changes to files that are immediately overwritten in the next commit
- Generated files (build artifacts, compiled schemas) unless required by the build system

## Development Workflow

### Building and Testing

```bash
make clean build          # Build the extension
npm run lint              # Run ESLint
```

### VM Testing

Every user-facing change must be VM tested before merging:

```bash
./testing/vm/vm-test.sh --vm gssmn-fedora42 --label my-change
```

This deploys the extension to an isolated VM, enables it, and checks for crashes, JS errors, and visual regressions. See `testing/vm/README.md` for setup.

### Code Style

- ESLint config is in `eslint.config.js` (flat config, ES2022, 4-space indent, single quotes)
- No comments unless the *why* is non-obvious
- Prefer simple code over clever code
- Don't add abstractions for hypothetical future use

## Widget Development

See [docs/widget-authoring.md](docs/widget-authoring.md) for the widget framework API and examples.
