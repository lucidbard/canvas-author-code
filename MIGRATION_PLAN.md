# Migration Plan: Rubric & AI-Assisted Grading Features

**From:** `~/canvas` (Flask web app)
**To:** `canvas-author-code` (VS Code extension)
**Date:** 2026-01-19

## Executive Summary

This document outlines the migration of rubric-based grading and AI-assisted draft generation from the standalone Canvas grading tool into the canvas-author-code VS Code extension.

**Core Features to Migrate:**
1. Rubric display and editing
2. AI-assisted grade draft generation (Claude, OpenAI, Ollama)
3. Draft grade management with versioning
4. Bulk submission processing
5. Canvas API integration for grading

---

## Architecture Comparison

### Current (~/canvas)
- **Type:** Flask/Quart web application
- **UI:** HTML/JavaScript with Bootstrap
- **Storage:** File-based JSON (data/ directory)
- **LLM:** Direct API clients for Claude/OpenAI/Ollama
- **Canvas:** canvasapi Python library

### Target (canvas-author-code)
- **Type:** VS Code extension
- **UI:** Webview panels + VS Code native UI
- **Storage:** Extension storage API + local files
- **LLM:** Anthropic SDK (already in package.json)
- **Canvas:** Existing MCP server tools

---

## Phase 1: Foundation (Week 1)

### 1.1 Data Structures

**Status:** ✅ Most structures already compatible

**Files to Port:**
- Rubric JSON schema (already in MCP server)
- Draft grade format (create new)
- Assignment configuration (extend existing)

**New Files:**
```
src/
├── grading/
│   ├── rubricManager.ts      # Rubric loading/parsing
│   ├── draftManager.ts        # Draft grade CRUD
│   ├── llmClient.ts           # LLM abstraction layer
│   └── types.ts               # TypeScript interfaces
```

**TypeScript Interfaces:**
```typescript
interface Rubric {
  id: string
  context_id: string
  data: RubricCriterion[]
  rubric_settings: RubricSettings
}

interface RubricCriterion {
  id: string
  description: string
  long_description?: string
  points: number
  ratings: RubricRating[]
}

interface RubricRating {
  id: string
  description: string
  long_description?: string
  points: number
}

interface DraftGrade {
  runs: DraftRun[]
  current_run: string
  official_rubric?: RubricAssessment
}

interface DraftRun {
  run_id: string
  model: string
  provider: 'anthropic' | 'openai' | 'ollama'
  timestamp: number
  rubric_assessment: RubricAssessment
  overall_comment?: string
  note_to_instructor?: string
  reasoning?: string
  instructor_modified: boolean
  source_run?: string
}

interface RubricAssessment {
  [criterion_id: string]: {
    points: number
    rating_id: string
    comments?: string
  }
}
```

### 1.2 MCP Server Extensions

**New Tools to Add:** (in `/home/john/canvas-author/canvas_author/server.py`)

```python
@mcp.tool()
def load_rubric_by_assignment(course_id: str, assignment_id: str) -> str:
    """Get rubric for an assignment from Canvas API or cache."""

@mcp.tool()
def submit_rubric_grade(
    course_id: str,
    assignment_id: str,
    user_id: str,
    rubric_assessment: dict,
    overall_comment: str = ""
) -> str:
    """Submit a rubric-based grade to Canvas."""
```

**Existing Tools to Enhance:**
- `get_submission()` - Add rubric_assessment to output
- `get_assignment()` - Include has_rubric field

---

## Phase 2: Rubric Panel (Week 2)

### 2.1 Rubric Display Panel

**Implementation:**
```
src/
├── rubricPanel.ts            # Main rubric panel webview
└── grading/
    └── rubricRenderer.ts     # HTML generation for rubrics
```

**Features:**
- Display rubric criteria with point values
- Read-only view of current rubric
- Link to Canvas for editing (later: inline editing)
- Show rubric for currently selected assignment

**UI Layout:**
```
┌─────────────────────────────────────┐
│ Rubric: Week 1 Discussion           │
│ Total Points: 5.0                    │
├─────────────────────────────────────┤
│ ▼ Completeness (1.0 pt)             │
│   • Full Marks (1.0) - Complete... │
│   • Partial (0.5) - Some gaps...   │
│   • Minimal (0.0) - Incomplete...  │
├─────────────────────────────────────┤
│ ▼ Depth of Analysis (1.0 pt)        │
│   • Excellent (1.0) - Thorough...  │
│   ...                                 │
└─────────────────────────────────────┘
```

**VS Code Integration:**
```typescript
// Register webview view provider
const rubricPanel = new RubricPanel(context.extensionUri, context)
rubricPanel.setMcpClient(mcpClient)
context.subscriptions.push(
  vscode.window.registerWebviewViewProvider(
    'canvasAuthorRubric',
    rubricPanel
  )
)
```

**package.json:**
```json
{
  "views": {
    "canvas-author": [
      {
        "id": "canvasAuthorRubric",
        "name": "Rubric",
        "icon": "$(checklist)",
        "contextualTitle": "Canvas Author",
        "type": "webview"
      }
    ]
  }
}
```

### 2.2 Rubric-Aware Submission Viewer

**Enhancement to existing `submissionsPanel.ts`:**
- Show rubric alongside submission when viewing
- Display current rubric assessment if graded
- Add "Grade with Rubric" button

---

## Phase 3: Draft Grade Management (Week 3)

### 3.1 Draft Storage

**Location:** `~/.canvas-author/courses/{course_id}/drafts/`

**File Format:** `draft_grades_{assignment_id}_{user_id}.json`

**Manager Class:**
```typescript
export class DraftGradeManager {
  constructor(private coursePath: string) {}

  async loadDraft(assignmentId: string, userId: string): Promise<DraftGrade | null>
  async saveDraft(assignmentId: string, userId: string, run: DraftRun): Promise<void>
  async listDrafts(assignmentId: string): Promise<Map<string, DraftGrade>>
  async setCurrentRun(assignmentId: string, userId: string, runId: string): Promise<void>
  async markAsModified(assignmentId: string, userId: string, runId: string): Promise<void>
}
```

### 3.2 Draft Editor Panel

**New Webview Panel:**
```
src/
└── draftGradePanel.ts        # Draft grade editor
```

**UI Layout:**
```
┌──────────────────────────────────────────┐
│ Draft Grade: John Doe - Week 1           │
│ Model: claude-3-7-sonnet | Run: #1       │
├──────────────────────────────────────────┤
│ ▼ Completeness (1.0 pt)                  │
│   [v] Full Marks (1.0) ▼                 │
│   Comments:                               │
│   [The student provided comprehensive... │
├──────────────────────────────────────────┤
│ ▼ Depth of Analysis (1.0 pt)             │
│   [v] Excellent (1.0) ▼                  │
│   Comments:                               │
│   [Analysis demonstrates deep...         │
├──────────────────────────────────────────┤
│ Overall Comment:                          │
│ [Excellent work overall. The analysis... │
├──────────────────────────────────────────┤
│ Note to Instructor (private):            │
│ [Consider this as exemplar for...        │
├──────────────────────────────────────────┤
│ [Generate Draft] [Save] [Submit to Canvas]│
└──────────────────────────────────────────┘
```

**Features:**
- Dropdown selectors for each rubric criterion
- Live point calculation
- Comment fields per criterion
- Overall comment field
- Version history dropdown
- Save draft / Submit to Canvas buttons

---

## Phase 4: LLM Integration (Week 4)

### 4.1 LLM Abstraction Layer

**Implementation:**
```typescript
// src/grading/llmClient.ts

export interface LLMProvider {
  generate(prompt: string, onChunk: (text: string) => void): Promise<string>
  streamGenerate(
    prompt: string,
    callbacks: {
      onText: (text: string) => void
      onThinking?: (text: string) => void
      onComplete: () => void
      onError: (error: Error) => void
    }
  ): Promise<void>
}

export class AnthropicProvider implements LLMProvider {
  constructor(private apiKey: string) {}
  // Use @anthropic-ai/sdk from package.json
}

export class OpenAIProvider implements LLMProvider {
  constructor(private apiKey: string) {}
}

export class OllamaProvider implements LLMProvider {
  constructor(private baseUrl: string) {}
}

export class LLMClientFactory {
  static create(
    provider: 'anthropic' | 'openai' | 'ollama',
    config: LLMConfig
  ): LLMProvider
}
```

### 4.2 Prompt Template System

**Port from:** `/home/john/canvas/data/{assignment_id}/llm_prompt.txt`

**Manager Class:**
```typescript
export class PromptManager {
  constructor(private coursePath: string) {}

  async loadTemplate(assignmentId: string): Promise<string>
  async saveTemplate(assignmentId: string, template: string): Promise<void>

  substituteVariables(
    template: string,
    vars: {
      student_post: string
      student_replies: string[]
      attachments: AttachmentInfo[]
      rubric: Rubric
    }
  ): string

  buildRubricPrompt(rubric: Rubric): string
}
```

**Template Format:**
```
You are an experienced instructor evaluating student work using the following rubric:

## Rubric Criteria

{{RUBRIC_CRITERIA}}

## Assignment Instructions

{{ASSIGNMENT_INSTRUCTIONS}}

## Student Submission

Main Post:
{{STUDENT_POST}}

Replies:
{{STUDENT_REPLIES}}

Attachments:
{{ATTACHMENTS}}

## Required Output Format

Provide your assessment as JSON:
{
  "rubric_assessment": {
    "criterion_id": {
      "points": 1.0,
      "rating_id": "rating_xyz",
      "comments": "Feedback..."
    }
  },
  "overall_comment": "...",
  "note_to_instructor": "...",
  "reasoning": "..."
}
```

### 4.3 Draft Generation Command

**VS Code Command:**
```typescript
vscode.commands.registerCommand(
  'canvas-author.generateDraftGrade',
  async (courseId, assignmentId, userId) => {
    // 1. Load submission
    // 2. Load rubric
    // 3. Load prompt template
    // 4. Substitute variables
    // 5. Stream LLM response
    // 6. Extract JSON
    // 7. Save draft
    // 8. Display in panel
  }
)
```

**UI Integration:**
- Add "Generate Draft" button to submission viewer
- Status bar progress indicator during generation
- Stream thinking/reasoning to output channel

---

## Phase 5: Bulk Processing (Week 5)

### 5.1 Bulk Grade Generation

**Task Queue:**
```typescript
export class BulkGradingJob {
  id: string
  assignmentId: string
  students: { userId: string; userName: string }[]
  model: string
  provider: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  progress: number
  results: Map<string, DraftRun | Error>
  createdAt: Date
}

export class BulkGradingQueue {
  private jobs: Map<string, BulkGradingJob>

  async createJob(
    assignmentId: string,
    students: string[],
    model: string,
    provider: string
  ): Promise<string>

  async processJob(jobId: string): Promise<void>
  getJob(jobId: string): BulkGradingJob | undefined
  listJobs(): BulkGradingJob[]
}
```

**UI:**
- Quick Pick for student selection (All / Ungraded / Custom)
- Progress notification during processing
- TreeView of bulk jobs with status
- Click job to see individual results

### 5.2 Background Processing

**Use VS Code API:**
```typescript
vscode.window.withProgress(
  {
    location: vscode.ProgressLocation.Notification,
    title: 'Generating draft grades',
    cancellable: true
  },
  async (progress, token) => {
    for (let i = 0; i < students.length; i++) {
      if (token.isCancellationRequested) break

      progress.report({
        increment: (100 / students.length),
        message: `Processing ${students[i].name}...`
      })

      await generateDraftForStudent(students[i])
    }
  }
)
```

---

## Phase 6: Grade Submission (Week 6)

### 6.1 Canvas API Integration

**MCP Tool Enhancement:**
```python
@mcp.tool()
def submit_rubric_grade(
    course_id: str,
    assignment_id: str,
    user_id: str,
    rubric_assessment: dict,
    overall_comment: str = "",
    posted_grade: Optional[str] = None
) -> str:
    """
    Submit a rubric-based grade to Canvas.

    Args:
        rubric_assessment: Dict mapping criterion_id to {points, rating_id, comments}
        overall_comment: Text comment for student
        posted_grade: Optional override for displayed grade
    """
    canvas = get_canvas_client()
    course = canvas.get_course(course_id)
    assignment = course.get_assignment(assignment_id)

    # Format for Canvas API
    submission_data = {
        "comment": {"text_comment": overall_comment},
        "rubric_assessment": {}
    }

    for criterion_id, assessment in rubric_assessment.items():
        submission_data["rubric_assessment"][criterion_id] = {
            "points": assessment["points"],
            "rating_id": assessment["rating_id"],
            "comments": assessment.get("comments", "")
        }

    if posted_grade:
        submission_data["posted_grade"] = posted_grade

    # Submit to Canvas
    submission = assignment.get_submission(user_id)
    submission.edit(**submission_data)

    return json.dumps({"status": "success", "user_id": user_id})
```

### 6.2 Submission Workflow

**Command:**
```typescript
async function submitGradeToCanvas(
  courseId: string,
  assignmentId: string,
  userId: string,
  draft: DraftRun
) {
  // 1. Confirm with user
  const confirm = await vscode.window.showWarningMessage(
    'Submit this grade to Canvas?',
    { modal: true },
    'Submit'
  )

  if (confirm !== 'Submit') return

  // 2. Call MCP tool
  await mcpClient.callTool('submit_rubric_grade', {
    course_id: courseId,
    assignment_id: assignmentId,
    user_id: userId,
    rubric_assessment: draft.rubric_assessment,
    overall_comment: draft.overall_comment || ''
  })

  // 3. Update draft with official_rubric
  await draftManager.markAsSubmitted(assignmentId, userId, draft.run_id)

  // 4. Refresh submissions panel
  submissionsPanel.refresh()

  vscode.window.showInformationMessage('Grade submitted to Canvas')
}
```

---

## Phase 7: UI Polish (Week 7)

### 7.1 Quick Actions

**Command Palette Commands:**
- `Canvas: Generate Draft Grade for Current Submission`
- `Canvas: Submit Grade to Canvas`
- `Canvas: View Rubric`
- `Canvas: Edit Draft Grade`
- `Canvas: Bulk Generate Draft Grades`
- `Canvas: View Bulk Processing Jobs`

### 7.2 Context Menus

**Submissions Tree:**
- Right-click submission → "Generate Draft Grade"
- Right-click submission → "View/Edit Draft"
- Right-click submission → "Submit to Canvas"

**Assignment Tree:**
- Right-click assignment → "Bulk Generate Drafts"
- Right-click assignment → "View Rubric"

### 7.3 Status Bar

**Indicators:**
- Current grading mode (if active)
- Drafts pending (count)
- Bulk jobs running (progress)

### 7.4 Settings

**Extension Settings:**
```json
{
  "canvas-author.grading.defaultProvider": "anthropic",
  "canvas-author.grading.anthropicModel": "claude-3-7-sonnet-20250219",
  "canvas-author.grading.openaiModel": "gpt-4",
  "canvas-author.grading.ollamaUrl": "http://localhost:11434",
  "canvas-author.grading.ollamaModel": "llama3",
  "canvas-author.grading.streamResponse": true,
  "canvas-author.grading.showThinking": true,
  "canvas-author.grading.autosaveDrafts": true,
  "canvas-author.grading.confirmBeforeSubmit": true
}
```

---

## Migration Checklist

### Phase 1: Foundation ✅ (Week 1)
- [ ] Create TypeScript interfaces for rubric/draft data
- [ ] Port rubric JSON schema from canvas-author MCP
- [ ] Create draft grade manager class
- [ ] Add MCP tools: load_rubric_by_assignment, submit_rubric_grade
- [ ] Write unit tests for data structures

### Phase 2: Rubric Panel (Week 2)
- [ ] Create rubric webview panel
- [ ] Implement rubric HTML renderer
- [ ] Add "Rubric" view to Canvas Author sidebar
- [ ] Connect to MCP server for rubric loading
- [ ] Test with real Canvas course

### Phase 3: Draft Management (Week 3)
- [ ] Implement draft storage in ~/.canvas-author/courses/
- [ ] Create draft grade editor panel
- [ ] Add version history UI
- [ ] Implement save/load/update operations
- [ ] Test draft persistence

### Phase 4: LLM Integration (Week 4)
- [ ] Create LLM abstraction layer
- [ ] Implement Anthropic provider (use existing SDK)
- [ ] Implement OpenAI provider
- [ ] Implement Ollama provider
- [ ] Port prompt template system
- [ ] Add prompt variable substitution
- [ ] Test draft generation end-to-end

### Phase 5: Bulk Processing (Week 5)
- [ ] Create bulk grading job queue
- [ ] Implement background processing with progress
- [ ] Add bulk job management UI
- [ ] Create job results TreeView
- [ ] Test with large student sets

### Phase 6: Grade Submission (Week 6)
- [ ] Enhance MCP submit_rubric_grade tool
- [ ] Implement submission confirmation dialog
- [ ] Add "Submit to Canvas" command
- [ ] Update drafts with official_rubric
- [ ] Test submission to Canvas

### Phase 7: UI Polish (Week 7)
- [ ] Add all command palette commands
- [ ] Implement context menu actions
- [ ] Create status bar indicators
- [ ] Add extension settings
- [ ] Write user documentation
- [ ] Create demo video

---

## File Structure (After Migration)

```
canvas-author-code/
├── src/
│   ├── grading/
│   │   ├── rubricManager.ts           # Rubric CRUD operations
│   │   ├── draftManager.ts            # Draft grade storage
│   │   ├── llmClient.ts               # LLM abstraction
│   │   ├── promptManager.ts           # Prompt templates
│   │   ├── bulkGradingQueue.ts        # Bulk processing
│   │   └── types.ts                   # TypeScript interfaces
│   ├── rubricPanel.ts                 # Rubric display webview
│   ├── draftGradePanel.ts             # Draft editor webview
│   ├── bulkJobsPanel.ts               # Bulk jobs TreeView
│   └── extension.ts                   # Register new commands
├── package.json                       # Add views, commands, settings
└── README.md                          # Update with grading features
```

---

## Dependencies to Add

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.52.0",  // Already present
    "openai": "^4.0.0",               // For OpenAI integration
    "axios": "^1.6.0"                 // For Ollama HTTP requests
  }
}
```

---

## Testing Strategy

### Unit Tests
- Rubric parsing/serialization
- Draft grade CRUD operations
- Prompt template substitution
- LLM client mocking

### Integration Tests
- MCP server communication
- Canvas API submission
- Draft storage persistence
- Bulk job processing

### Manual Testing
- Real Canvas course with rubrics
- Multiple students
- Different LLM providers
- Draft editing and submission

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| LLM API costs | High | Add cost tracking, confirmation dialogs |
| Canvas API rate limits | Medium | Implement exponential backoff, caching |
| Draft data loss | High | Auto-save, versioning, backup |
| Slow bulk processing | Medium | Progress indicators, cancellation |
| Complex UI in VS Code | Medium | Iterative design, user feedback |

---

## Success Metrics

1. **Rubric Panel**
   - ✅ Displays all rubric criteria accurately
   - ✅ Loads in <500ms

2. **Draft Generation**
   - ✅ Generates draft in <10s per student
   - ✅ JSON extraction success rate >95%
   - ✅ Drafts auto-saved after generation

3. **Grade Submission**
   - ✅ Successfully submits to Canvas
   - ✅ Rubric assessment appears in Canvas
   - ✅ Confirmation required before submit

4. **Bulk Processing**
   - ✅ Handles 50+ students without crashing
   - ✅ Progress updates every student
   - ✅ Failed students logged with errors

---

## Future Enhancements (Post-MVP)

1. **Advanced Features**
   - Rubric editing directly in VS Code
   - Grade analytics dashboard
   - Comparison of AI vs instructor grades
   - Rubric templates library

2. **Workflow Improvements**
   - Keyboard shortcuts for common actions
   - Inline comments in submission viewer
   - Side-by-side rubric & submission view
   - Grade distribution visualization

3. **Collaboration**
   - Share drafts with other instructors
   - Peer review workflow
   - Moderation queue for bulk grades

4. **AI Improvements**
   - Fine-tuned models on past grades
   - Multi-model ensemble grading
   - Confidence scores for AI assessments
   - Detect hallucinations/inconsistencies

---

## References

**Source Code:**
- `/home/john/canvas/` - Original grading tool
- `/home/john/canvas-author/` - MCP server
- `/home/john/canvas-author-code/` - VS Code extension

**Key Files:**
- `~/canvas/server/app.py` - Flask routes and LLM integration
- `~/canvas/server/canvas.py` - Canvas API and rubric handling
- `~/canvas/static/js/grading.js` - Frontend grading UI
- `~/canvas/data/{assignment_id}/llm_prompt.txt` - Prompt templates

**Documentation:**
- Canvas API: https://canvas.instructure.com/doc/api/
- Anthropic API: https://docs.anthropic.com/
- VS Code Extension API: https://code.visualstudio.com/api

---

**Last Updated:** 2026-01-19
**Author:** AI Assistant (Claude Sonnet 4.5)
**Next Review:** After Phase 1 completion
