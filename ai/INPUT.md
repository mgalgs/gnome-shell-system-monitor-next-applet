# Human input

- Don't refer to the new widget system as "modern" in the code, comments, or messages. The word "modern" should not be used. It needs to be removed.

- We need to add checks for whitespace issues (no trailing whitespace, etc). Perhaps a `make check` target that also does the eslint step and whatever else you recommend?

- There are quite a few eslint failures to fix. `make check` will help identify them.

- What about testing? What do you recommend? Can we add testing incrementally, starting with the new widget system (not adding tests for legacy code)? What are the main canonical options for testing a Gnome Shell extension?
