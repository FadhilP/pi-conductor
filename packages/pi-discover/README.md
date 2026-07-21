# pi-discover

General-purpose read-only `rg` and `fd` tools plus coordinated inactive-tool discovery for [Pi](https://pi.dev).

## Usage

`search_tools({ query, limit? })` keyword-ranks inactive eligible tools by name and description, then asks Pylon to activate up to six matches. The selected definitions become callable on the next model turn. `search_tools({ action: "reset" })` resets the coordinated selection.

Tool activation is intentionally delegated to Pylon through its discovery capability. Without that coordinator, `search_tools` reports that coordination is unavailable and changes no active tools.

`rg` and `fd` are read-only workspace searches. They use bounded output and direct models to built-in `grep` or `find` when their optional executables are unavailable.
