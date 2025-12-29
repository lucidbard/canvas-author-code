# Canvas Author for VS Code

Author and sync Canvas LMS wiki pages directly from VS Code.

## Features

- **Pull Pages**: Download wiki pages from Canvas as Markdown files
- **Push Pages**: Upload local Markdown files to Canvas
- **Sync Status**: See which files are synced, local-only, or Canvas-only
- **Course Selection**: Initialize any course you have access to

## Requirements

- Python 3.10+ with `canvas-mcp` installed:
  ```bash
  pip install canvas-mcp
  ```
- Canvas API token (generate at Canvas → Profile → Settings → New Access Token)

## Setup

1. Install the extension
2. Set your Canvas domain in VS Code settings:
   - `canvas-author.canvasDomain`: Your Canvas domain (e.g., `canvas.instructure.com`)
3. Set your Canvas API token as an environment variable:
   ```bash
   export CANVAS_API_TOKEN=your_token_here
   ```
4. Open a folder and run **Canvas: Initialize Course** from the command palette

## Commands

| Command | Description |
|---------|-------------|
| `Canvas: Initialize Course` | Set up a folder for a Canvas course |
| `Canvas: Pull Pages` | Download wiki pages from Canvas |
| `Canvas: Push Pages` | Upload local Markdown to Canvas |
| `Canvas: Show Sync Status` | View sync status |
| `Canvas: List Courses` | List available courses |

## Extension Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `canvas-author.pythonPath` | Path to Python with canvas-mcp | `python3` |
| `canvas-author.canvasDomain` | Your Canvas LMS domain | (empty) |

## How It Works

This extension communicates with the `canvas-mcp` Python package via the Model Context Protocol (MCP). When activated, it spawns `canvas-mcp server` as a subprocess and sends commands via JSON-RPC.

## Development

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Watch mode
npm run watch

# Package extension
npx vsce package
```

## License

MIT
