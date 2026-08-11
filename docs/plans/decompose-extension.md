# Decompose the OpenAI Codex usage extension

- [x] 1. Establish the test harness and extract the normalized usage domain with tests for quota, windows, reset calculations, and durations.
- [x] 2. Extract the OpenAI usage client behind a small interface, with tests at the external HTTP/auth seam.
- [x] 3. Extract presentation rendering with tests for quota colors, the 90% reset display, and reset timestamps in the selected/user-local timezone.
- [x] 4. Extract the runtime controller that owns activation, refresh deduplication, timers, panel state, and shutdown.
- [x] 5. Reduce the Pi extension entrypoint to command/event registration and delegation.
- [x] 6. Update package metadata and documentation for the directory entrypoint and local-timezone behavior.
- [x] 7. Replace the global single-file extension with the directory form without loading duplicate copies.
- [x] 8. Verify tests, local extension loading, git-package loading, model visibility, commands, and shutdown.
- [x] 9. Bump the package version, commit, and push the refactor.
