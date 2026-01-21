# Flask App Migration to MCP Draft Storage

**Date:** 2026-01-19
**Status:** Ready for Implementation

## Overview

This document explains how to migrate the Flask grading app (`~/canvas`) to use the new MCP server draft storage tools, enabling both the Flask app and VS Code extension to share the same draft grade data.

---

## Current Architecture

### Flask App (`~/canvas`)
- **Storage:** Direct file I/O to `~/canvas/data/<assignment_id>/drafts/`
- **Format:** JSON files `draft_grades_<user_id>.json`
- **Access:** Python `json` module with custom file handling

### VS Code Extension (`canvas-author-code`)
- **Storage:** MCP server tools (as of today)
- **Format:** Same JSON structure
- **Access:** TypeScript `DraftManager` class → MCP client → Python draft_storage module

### MCP Server (`canvas-author`)
- **Storage Module:** `canvas_author/draft_storage.py`
- **Default Location:** `~/canvas/data/` (same as Flask app!)
- **Tools:** `load_draft_grade`, `save_draft_grade`, `add_draft_run`, etc.

---

## Migration Strategy

Both apps will use the **same file storage location** (`~/canvas/data/`) but access it through different interfaces:

1. **VS Code Extension:** Already uses MCP tools ✅
2. **Flask App:** Will use MCP tools via Python subprocess calls

---

## Step 1: Add MCP Client to Flask App

Create `~/canvas/mcp_client.py`:

```python
"""
Simple MCP client for Flask app to use canvas-author MCP server.
Launches MCP server as subprocess and communicates via JSON-RPC.
"""

import json
import subprocess
from typing import Any, Dict, Optional


class MCPClient:
    """Client for calling canvas-author MCP tools."""

    def __init__(self):
        self.process = None

    def start(self):
        """Start the MCP server process."""
        if self.process is None:
            self.process = subprocess.Popen(
                ['python3', '-m', 'canvas_author.server'],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )

    def stop(self):
        """Stop the MCP server process."""
        if self.process:
            self.process.terminate()
            self.process = None

    def call_tool(self, tool_name: str, params: Dict[str, Any]) -> Any:
        """Call an MCP tool and return the result."""
        if not self.process:
            self.start()

        # Construct JSON-RPC request
        request = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": params
            }
        }

        # Send request
        self.process.stdin.write(json.dumps(request) + '\n')
        self.process.stdin.flush()

        # Read response
        response_line = self.process.stdout.readline()
        response = json.loads(response_line)

        # Parse result
        if 'result' in response:
            content = response['result']['content']
            if content[0]['type'] == 'text':
                result_text = content[0]['text']
                return json.loads(result_text)

        raise Exception(f"MCP call failed: {response.get('error', 'Unknown error')}")


# Global client instance
_mcp_client: Optional[MCPClient] = None


def get_mcp_client() -> MCPClient:
    """Get or create the global MCP client."""
    global _mcp_client
    if _mcp_client is None:
        _mcp_client = MCPClient()
    return _mcp_client
```

---

## Step 2: Create Draft Storage Wrapper

Create `~/canvas/draft_storage_mcp.py`:

```python
"""
Draft storage wrapper that uses MCP tools.
Drop-in replacement for existing draft storage code.
"""

from typing import Dict, Any, List, Optional
from mcp_client import get_mcp_client


def load_draft_grade(assignment_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    """Load a draft grade via MCP."""
    client = get_mcp_client()
    result = client.call_tool('load_draft_grade', {
        'assignment_id': assignment_id,
        'user_id': user_id
    })
    return result  # None if not found


def save_draft_grade(assignment_id: str, user_id: str, draft_data: Dict[str, Any]) -> bool:
    """Save a draft grade via MCP."""
    client = get_mcp_client()
    result = client.call_tool('save_draft_grade', {
        'assignment_id': assignment_id,
        'user_id': user_id,
        'draft_data': json.dumps(draft_data)
    })
    return result.get('success', False)


def add_draft_run(
    assignment_id: str,
    user_id: str,
    run_data: Dict[str, Any],
    set_as_current: bool = True
) -> Optional[str]:
    """Add a new draft run via MCP."""
    client = get_mcp_client()
    result = client.call_tool('add_draft_run', {
        'assignment_id': assignment_id,
        'user_id': user_id,
        'run_data': json.dumps(run_data),
        'set_as_current': set_as_current
    })
    if result.get('success'):
        return result.get('run_id')
    return None


def get_current_run(assignment_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    """Get the current draft run via MCP."""
    client = get_mcp_client()
    return client.call_tool('get_current_draft_run', {
        'assignment_id': assignment_id,
        'user_id': user_id
    })


def list_draft_grades(assignment_id: str) -> List[Dict[str, Any]]:
    """List all drafts for an assignment via MCP."""
    client = get_mcp_client()
    return client.call_tool('list_draft_grades', {
        'assignment_id': assignment_id
    })


def update_run(
    assignment_id: str,
    user_id: str,
    run_id: str,
    updates: Dict[str, Any]
) -> bool:
    """Update a draft run via MCP."""
    client = get_mcp_client()
    result = client.call_tool('update_draft_run', {
        'assignment_id': assignment_id,
        'user_id': user_id,
        'run_id': run_id,
        'updates': json.dumps(updates)
    })
    return result.get('success', False)
```

---

## Step 3: Update Flask Routes

In your Flask app (e.g., `~/canvas/app.py`), replace direct file I/O with MCP wrapper:

### Before:
```python
import json
from pathlib import Path

# Load draft
draft_path = Path(f"data/{assignment_id}/drafts/draft_grades_{user_id}.json")
if draft_path.exists():
    with open(draft_path, 'r') as f:
        draft = json.load(f)
```

### After:
```python
from draft_storage_mcp import load_draft_grade, save_draft_grade, add_draft_run

# Load draft
draft = load_draft_grade(assignment_id, user_id)
if draft is None:
    draft = {'runs': [], 'current_run': None}
```

---

## Step 4: Migration Checklist

- [ ] Create `mcp_client.py` in `~/canvas/`
- [ ] Create `draft_storage_mcp.py` in `~/canvas/`
- [ ] Update Flask routes to use `draft_storage_mcp` instead of direct file I/O
- [ ] Test draft loading in Flask app
- [ ] Test draft saving in Flask app
- [ ] Test creating new runs in Flask app
- [ ] Verify VS Code extension can read Flask-created drafts
- [ ] Verify Flask app can read VS Code-created drafts

---

## Benefits After Migration

1. **Shared Storage:** Both apps use same draft files
2. **No Conflicts:** MCP server handles file locking
3. **Consistent API:** Same tools for both apps
4. **Easy Testing:** Can test draft storage independent of UI
5. **Future-Proof:** Easy to add mobile app or CLI later

---

## Alternative: Keep Direct File I/O (For Now)

If you prefer to migrate incrementally:

1. **Phase 1:** VS Code uses MCP tools (already done ✅)
2. **Phase 2:** Flask keeps direct file I/O (no changes needed)
3. **Phase 3:** Later, migrate Flask to MCP when convenient

**This works fine** because:
- Both use same file format
- Both use same storage location (`~/canvas/data/`)
- Conflicts unlikely unless both apps open same draft simultaneously

---

## Testing Both Apps Together

1. **Start VS Code extension** - MCP server starts automatically
2. **Open a submission** in VS Code - creates draft in `~/canvas/data/<assignment_id>/drafts/`
3. **Save a draft** - should see new run in JSON file
4. **Open Flask app** - should see same draft
5. **Edit in Flask** - VS Code should see changes on reload
6. **Edit in VS Code** - Flask should see changes on reload

---

## Troubleshooting

### Issue: Flask can't find drafts
**Solution:** Check that both apps use same base path:
- VS Code: `~/canvas/data/` (via MCP server default)
- Flask: Should also use `~/canvas/data/`

### Issue: JSON format mismatch
**Solution:** Both apps use identical structure:
```json
{
  "runs": [...],
  "current_run": "...",
  "official_rubric": {...}
}
```

### Issue: MCP server not responding
**Solution:** Check MCP server is running:
```bash
ps aux | grep canvas_author
```

---

## Next Steps

1. Implement MCP client in Flask app
2. Update Flask routes to use MCP wrapper
3. Test cross-app draft editing
4. Add AI-assisted grading to VS Code extension (Phase 4 of MIGRATION_PLAN.md)
5. Add bulk processing features

---

## Questions?

- **Where are drafts stored?** `~/canvas/data/<assignment_id>/drafts/draft_grades_<user_id>.json`
- **Can I still use Flask without VS Code?** Yes, Flask can still do direct file I/O
- **Can I still use VS Code without Flask?** Yes, VS Code works independently via MCP
- **Will this break existing drafts?** No, same file format and location
- **Do I need to migrate Flask immediately?** No, gradual migration is fine

---

## Summary

**Current Status:**
- ✅ MCP server has draft storage tools
- ✅ VS Code extension uses draft manager
- ✅ Both apps can share `~/canvas/data/` storage

**Recommended Next Step:**
Test the VS Code draft functionality, then decide whether to migrate Flask app now or later. Both approaches work fine!
