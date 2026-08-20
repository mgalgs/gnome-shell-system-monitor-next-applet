# Releasing

This project ships to [extensions.gnome.org][ego] (EGO). A release is one
command plus one manual upload.

## Prerequisites

Do these once:

- Install the Node dependencies: `npm install`. The release lints with the
  ESLint in `node_modules`.
- Set up a GPG signing key. The release signs the tag (`git tag -s`), so it
  cannot tag without a working key and agent.
- Get push access to `origin`.

The build tools `glib-compile-schemas` (from glib2) and `msgfmt` (from
gettext) must be on `PATH`.

## Cut a release

1. Merge every change for the release into `master`.
2. Check out `master` and pull, so it matches `origin/master`.
3. Run one command:

   ```bash
   make cut-release
   ```

   This derives the next version from the latest `v3.*` tag, runs all
   checks (whitespace, ESLint, shexli), builds the zip, verifies its
   contents and version, then creates and pushes a signed tag `v3.N`.

   - To set the version yourself: `make cut-release VERSION=37`.
   - To rehearse without tagging or pushing: `make cut-release.dry-run`.

4. Upload the zip. `make cut-release` prints the path and the link:

   ```
   Upload dist/system-monitor-next@paradoxxx.zero.gmail.com.zip at:
     https://extensions.gnome.org/upload/
   ```

   Open the link, sign in, and upload the zip. This step is manual because
   EGO needs your login.

   > A tag-triggered auto-uploader used to do this step. It is disabled:
   > `.github/workflows/uploader.yml.bak`. Re-enable it to drop the manual
   > upload.

## What `make cut-release` checks

The release stops with an error if any check fails:

- The current branch is not `master`.
- The working tree is dirty.
- `master` and `origin/master` differ.
- The computed tag already exists.
- ESLint, the whitespace check, or shexli finds a problem.
- The version inside the built zip does not match the tag.

## Version numbers

The tag is `v3.N`. The extension version in `metadata.json` is `N`. The
Makefile injects `N` at build time. In git, `metadata.json` keeps
`"version": -1`. Never edit that version by hand.

[ego]: https://extensions.gnome.org/
