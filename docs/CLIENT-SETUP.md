# Client setup

Freevibes is a **stdio** MCP server. Every client below launches it the same way:

```bash
node /absolute/path/to/freevibes/dist/index.js
```

Build first (`npm install && npm run build`), then either run the installer or
edit the config by hand.

```bash
node dist/install/cli.js install            # dry run
node dist/install/cli.js install --write    # apply
node dist/install/cli.js install --client muse-code --write
```

The installer backs up any file it modifies as `<file>.freevibes-backup-<timestamp>`
and preserves unrelated keys.

> After configuring, **restart the client**. Most read MCP config only at startup.

---

## Claude Code

Config: `~/.claude.json`

```json
{
  "mcpServers": {
    "freevibes": {
      "command": "node",
      "args": ["/absolute/path/to/freevibes/dist/index.js"]
    }
  }
}
```

Or use the CLI, which is the safer route:

```bash
claude mcp add freevibes -- node /absolute/path/to/freevibes/dist/index.js
```

## Claude Desktop

| Platform | Path |
| --- | --- |
| Linux | `~/.config/Claude/claude_desktop_config.json` |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

Same `mcpServers` shape as above.

## Muse Code

Config: `~/.config/muse/settings.json` (or `$XDG_CONFIG_HOME/muse/settings.json`)

```json
{
  "schema_version": 1,
  "mcp_servers": {
    "freevibes": {
      "transport": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/freevibes/dist/index.js"],
      "mode": "optional",
      "enabled": true
    }
  }
}
```

Notes:

- `schema_version` must be `1`. Muse Code fails every command if it is missing or
  unrecognised, so the installer adds it to a new file and refuses to touch one
  with a different version.
- `mode: "optional"` means a failed server start warns instead of aborting the
  run. Freevibes starts fine even while generation is blocked, so either mode
  works; `optional` is the safer default.
- Restart Muse Code, then run `/mcp` to confirm the server and its nine tools.

## Codex CLI

Config: `~/.codex/config.toml`

```toml
[mcp_servers.freevibes]
command = "node"
args = ["/absolute/path/to/freevibes/dist/index.js"]
```

The installer wraps this in a managed block so re-running it replaces the entry
instead of appending a duplicate.

## Cursor

Config: `~/.cursor/mcp.json` — same `mcpServers` shape as Claude.

## Zed

Config: `~/.config/zed/settings.json` (or `$XDG_CONFIG_HOME/zed/settings.json`)

```json
{
  "context_servers": {
    "freevibes": {
      "command": {
        "path": "node",
        "args": ["/absolute/path/to/freevibes/dist/index.js"]
      }
    }
  }
}
```

## VS Code

Config: `.vscode/mcp.json` in the workspace.

```json
{
  "servers": {
    "freevibes": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/freevibes/dist/index.js"]
    }
  }
}
```

## Antigravity and other clients

No configuration path is published for Antigravity, so the installer does not
guess one and will not write to it. Add the standard stdio entry to its MCP
settings by hand:

```json
{
  "mcpServers": {
    "freevibes": {
      "command": "node",
      "args": ["/absolute/path/to/freevibes/dist/index.js"]
    }
  }
}
```

If a client uses a different key (`servers`, `context_servers`, `mcp_servers`),
keep its key and copy the `command`/`args` pair.

---

## Verifying

```bash
node dist/install/cli.js doctor
```

Then ask your agent: *"What can Freevibes do?"* It should call
`freevibes_get_capabilities` and report that generation is **blocked**, with the
reason. That is correct behaviour today — see
[META-FEASIBILITY.md](META-FEASIBILITY.md).

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Server not listed | Client not restarted | Restart the client |
| Tools listed, generation fails | Expected: provider is blocked | Read `freevibes_get_capabilities` |
| `MCP error -32000: Connection closed` | Wrong path to `dist/index.js` | Use an absolute path; check `npm run build` ran |
| Agent sees no tools | Config under the wrong key | Check the client's key name above |
| Muse Code refuses to start | `schema_version` missing or not `1` | Set `"schema_version": 1` |
| Garbled protocol errors | Something wrote to stdout | Set `FREEVIBES_LOG_LEVEL=silent` to confirm |
