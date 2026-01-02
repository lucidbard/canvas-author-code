# Canvas Author for VS Code

Author and sync Canvas LMS content directly from VS Code, including wiki pages and modules.

## Features

- **Pull/Push Pages**: Download wiki pages from Canvas as Markdown files and push changes back
- **Pull/Push Modules**: Sync course modules via a `modules.yaml` file
- **Sync Status**: View which pages and modules are synced, local-only, or Canvas-only
- **Course Selection**: Initialize any course you have access to

## Prerequisites

- **Node.js** 18+ (for building the extension)
- **Python** 3.10+ with `canvas-author` installed
- **Canvas API token** (generate at Canvas > Profile > Settings > New Access Token)

## Installation

### From VS Code Marketplace (Recommended)

1. Open VS Code
2. Go to Extensions (`Ctrl+Shift+X`)
3. Search for "Canvas Author"
4. Click Install

### From Source

1. Clone the repository:
   ```bash
   git clone https://github.com/lucidbard/canvas-author-code.git
   cd canvas-author-code
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Compile the extension:
   ```bash
   npm run compile
   ```

4. Install the canvas-author Python package:
   ```bash
   pip install canvas-author
   ```

5. Set up Canvas credentials in a `.env` file in your course directory:
   ```bash
   CANVAS_API_TOKEN=your_token_here
   CANVAS_DOMAIN=your.canvas.domain.com
   ```

### Running in VS Code

1. Open the extension folder in VS Code
2. Press `F5` to launch a new Extension Development Host window
3. In the new window, open a folder for your course content
4. Run **Canvas: Initialize Course** from the command palette (`Ctrl+Shift+P`)

### Packaging for Distribution

```bash
# Install vsce if not already installed
npm install -g @vscode/vsce

# Package the extension
npx vsce package
```

This creates a `.vsix` file you can install via **Extensions > ... > Install from VSIX**.

## Setup

1. Open a folder where you want to store course content
2. Create a `.env` file with your credentials:
   ```
   CANVAS_API_TOKEN=your_token_here
   CANVAS_DOMAIN=your.canvas.domain.com
   ```
3. Run **Canvas: Initialize Course** from the command palette
4. Select your course from the list

## Commands

### Page Commands

| Command | Description |
|---------|-------------|
| `Canvas: Initialize Course` | Set up a folder for a Canvas course |
| `Canvas: Pull Pages` | Download wiki pages from Canvas as Markdown |
| `Canvas: Push Pages` | Upload local Markdown files to Canvas |
| `Canvas: Show Sync Status` | View page sync status |
| `Canvas: List Courses` | List available courses |

### Module Commands

| Command | Description |
|---------|-------------|
| `Canvas: Pull Modules` | Download modules to `modules.yaml` |
| `Canvas: Push Modules` | Push `modules.yaml` to Canvas |
| `Canvas: Show Module Status` | View module sync status |

## File Structure

After initialization, your folder will contain:

```
my-course/
  .canvas.json       # Course configuration
  .env               # Canvas credentials (gitignored)
  modules.yaml       # Module structure
  pages/
    page-title.md    # Wiki pages as Markdown
    another-page.md
```

## modules.yaml Format

The `modules.yaml` file defines your course module structure:

```yaml
modules:
  - name: Week 1 - Introduction
    published: true
    items:
      - type: page
        page_url: welcome
      - type: subheader
        title: Readings
      - type: external_url
        url: https://example.com
        title: External Resource
      - type: assignment
        content_id: "12345"
        title: Week 1 Assignment

  - name: Week 2 - Deep Dive
    published: false
    items:
      - type: page
        page_url: week-2-overview
      - type: quiz
        content_id: "67890"
        title: Week 2 Quiz
```

### Supported Item Types

| Type | Required Fields |
|------|-----------------|
| `page` | `page_url` |
| `assignment` | `content_id`, `title` |
| `quiz` | `content_id`, `title` |
| `file` | `content_id`, `title` |
| `discussion` | `content_id`, `title` |
| `external_url` | `url`, `title` |
| `external_tool` | `url`, `title` |
| `subheader` | `title` |

## Extension Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `canvas-author.pythonPath` | Path to Python with canvas-author | `python3` |
| `canvas-author.canvasDomain` | Your Canvas LMS domain | (empty) |

## Development

### Building

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode (auto-recompile on changes)
npm run watch

# Run linter
npm run lint
```

### Testing

```bash
# Run tests
npm test
```

### Project Structure

```
canvas-author-code/
  src/
    extension.ts    # Extension entry point, command handlers
    mcpClient.ts    # MCP client for canvas-author communication
    test/
      runTest.ts    # Test runner
      suite/
        extension.test.ts  # Extension tests
  package.json      # Extension manifest
  tsconfig.json     # TypeScript configuration
```

## How It Works

This extension communicates with the `canvas-author` Python package via the Model Context Protocol (MCP). When activated, it spawns `canvas-author server` as a subprocess and sends commands via JSON-RPC.

The workflow:
1. Extension spawns `python -m canvas_mcp.server` subprocess
2. Commands are sent as MCP tool calls over stdio
3. Results are returned as JSON and displayed in VS Code

## Troubleshooting

### "canvas-author not found"

Ensure canvas-author is installed in your Python environment:
```bash
pip install canvas-author
```

### "No courses found"

Check that your `.env` file contains valid credentials and is in the workspace folder or a parent directory.

### "Failed to connect to MCP server"

1. Check the Python path in settings
2. Ensure canvas-author is installed: `python -c "import canvas_mcp"`
3. Check the Output panel (View > Output > Canvas Author) for errors

## License

GPL-3.0-or-later - See [LICENSE](LICENSE) for details.
