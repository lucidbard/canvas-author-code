import * as vscode from 'vscode'
import * as fs from 'fs'
import { CanvasMcpClient } from './mcpClient'

interface Submission {
  id?: string
  user_id: number | string
  user_name?: string
  user?: {
    id: string
    name: string
    sortable_name?: string
  }
  submitted_at?: string
  score?: number
  grade?: string
  workflow_state: string
  late?: boolean
}

export class SubmissionsPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'canvasAuthorSubmissions'
  private _view?: vscode.WebviewView
  private _currentAssignment?: { courseId: string; assignmentId: string; title: string }
  private _mcpClient?: CanvasMcpClient

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {}

  public setMcpClient(client: CanvasMcpClient | undefined) {
    this._mcpClient = client
  }

  public async showAssignmentSubmissions(courseId: string, assignmentId: string, title: string) {
    this._currentAssignment = { courseId, assignmentId, title }
    if (this._view) {
      await this._update()
    }
  }

  public clear() {
    this._currentAssignment = undefined
    if (this._view) {
      this._view.webview.html = this._getWelcomeHtml()
    }
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    }

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'openSubmission':
            await this.openSubmissionForGrading(message.submissionId)
            break
          case 'submitGrade':
            await this.submitGrade(message.userId, message.grade, message.comment)
            break
        }
      },
      undefined,
      []
    )

    if (this._currentAssignment) {
      this._update()
    } else {
      webviewView.webview.html = this._getWelcomeHtml()
    }
  }

  private async openSubmissionForGrading(userId: string) {
    if (!this._currentAssignment) {
      return
    }

    vscode.window.showInformationMessage(`Opening submission for grading: User ${userId}`)
    
    // TODO: Download and show submission content
    // This would fetch the submission text, attachments, etc.
  }

  private async submitGrade(userId: string, grade: string, comment: string) {
    if (!this._currentAssignment || !this._mcpClient) {
      return
    }

    try {
      // Submit grade via MCP
      await this._mcpClient.callTool('update_grade', {
        course_id: this._currentAssignment.courseId,
        assignment_id: this._currentAssignment.assignmentId,
        user_id: userId,
        grade: grade,
        comment: comment
      })

      vscode.window.showInformationMessage('Grade submitted successfully!')
      await this._update() // Refresh the list
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to submit grade: ${error}`)
    }
  }

  private async _update() {
    if (!this._view || !this._currentAssignment) {
      return
    }

    const webview = this._view.webview

    if (!this._mcpClient) {
      webview.html = this._getErrorHtml('Canvas connection not available')
      return
    }

    try {
      // Fetch non-anonymized submissions for local viewing
      const result = await this._mcpClient.callTool('list_submissions', {
        course_id: this._currentAssignment.courseId,
        assignment_id: this._currentAssignment.assignmentId,
        anonymize: false  // Keep full student info for local VSCode display
      })

      const submissions = Array.isArray(result) ? result : []
      webview.html = this._getSubmissionsHtml(submissions, this._currentAssignment.title)
    } catch (error) {
      webview.html = this._getErrorHtml(`Failed to load submissions: ${error}`)
    }
  }

  private _getWelcomeHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Submissions</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
        }
        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: var(--vscode-descriptionForeground);
        }
        .icon {
            font-size: 48px;
            margin-bottom: 16px;
        }
    </style>
</head>
<body>
    <div class="empty-state">
        <div class="icon">📝</div>
        <p>Select an assignment to view submissions</p>
    </div>
</body>
</html>`
  }

  private _getErrorHtml(error: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Submissions Error</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-errorForeground);
        }
    </style>
</head>
<body>
    <h3>Error</h3>
    <p>${error}</p>
</body>
</html>`
  }

  private _getSubmissionsHtml(submissions: Submission[], assignmentTitle: string): string {
    const submitted = submissions.filter(s => s.workflow_state === 'submitted' || s.workflow_state === 'graded')
    const graded = submissions.filter(s => s.workflow_state === 'graded')
    const late = submissions.filter(s => s.late)

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Submissions</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 0;
            margin: 0;
            color: var(--vscode-foreground);
        }
        
        .header {
            padding: 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-editor-background);
        }
        
        .assignment-title {
            font-size: 14px;
            font-weight: 600;
            margin: 0 0 12px 0;
            color: var(--vscode-foreground);
        }
        
        .stats {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
        }
        
        .stat {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            padding: 8px;
            border-radius: 4px;
        }
        
        .stat-label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 2px;
        }
        
        .stat-value {
            font-size: 18px;
            font-weight: 600;
        }
        
        .submissions-list {
            padding: 8px;
        }
        
        .submission {
            padding: 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            cursor: pointer;
            transition: background-color 0.1s;
        }
        
        .submission:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        
        .submission-content {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .submission-user {
            flex: 1;
        }
        
        .user-name {
            font-weight: 500;
            margin-bottom: 2px;
        }
        
        .submission-time {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
        
        .submission-grade {
            text-align: right;
            margin-left: 12px;
        }
        
        .grade-value {
            font-weight: 600;
            font-size: 14px;
        }
        
        .status-badge {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            margin-top: 4px;
        }
        
        .status-submitted {
            background-color: var(--vscode-inputValidation-infoBackground);
            color: var(--vscode-inputValidation-infoForeground);
        }
        
        .status-graded {
            background-color: var(--vscode-inputValidation-warningBackground);
            color: var(--vscode-inputValidation-warningForeground);
        }
        
        .status-late {
            background-color: var(--vscode-inputValidation-errorBackground);
            color: var(--vscode-inputValidation-errorForeground);
        }
        
        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: var(--vscode-descriptionForeground);
        }
        
        .grade-input-container {
            margin-top: 8px;
            padding: 8px;
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 4px;
            display: none;
        }
        
        .grade-input-container.active {
            display: block;
        }
        
        .grade-form {
            display: flex;
            gap: 4px;
            margin-bottom: 4px;
        }
        
        .grade-input {
            flex: 1;
            padding: 4px 8px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            font-size: 12px;
        }
        
        .grade-button {
            padding: 4px 12px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 2px;
            cursor: pointer;
            font-size: 12px;
        }
        
        .grade-button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .comment-input {
            width: 100%;
            padding: 4px 8px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            font-size: 12px;
            resize: vertical;
            min-height: 50px;
        }
    </style>
    <script>
        const vscode = acquireVsCodeApi();
        
        function toggleGradeForm(userId) {
            const form = document.getElementById('grade-form-' + userId);
            form.classList.toggle('active');
        }
        
        function submitGrade(userId) {
            const gradeInput = document.getElementById('grade-' + userId);
            const commentInput = document.getElementById('comment-' + userId);
            
            vscode.postMessage({
                command: 'submitGrade',
                userId: userId,
                grade: gradeInput.value,
                comment: commentInput.value
            });
            
            // Reset form
            gradeInput.value = '';
            commentInput.value = '';
            toggleGradeForm(userId);
        }
    </script>
</head>
<body>
    <div class="header">
        <h3 class="assignment-title">${assignmentTitle}</h3>
        <div class="stats">
            <div class="stat">
                <div class="stat-label">Submitted</div>
                <div class="stat-value">${submitted.length}</div>
            </div>
            <div class="stat">
                <div class="stat-label">Graded</div>
                <div class="stat-value">${graded.length}</div>
            </div>
            <div class="stat">
                <div class="stat-label">Late</div>
                <div class="stat-value">${late.length}</div>
            </div>
            <div class="stat">
                <div class="stat-label">Total</div>
                <div class="stat-value">${submissions.length}</div>
            </div>
        </div>
    </div>
    
    <div class="submissions-list">
        ${submissions.length === 0 ? `
            <div class="empty-state">
                <p>No submissions yet</p>
            </div>
        ` : submissions.map(sub => {
            const userName = sub.user?.name || sub.user_name || `User ${sub.user_id}`
            const userId = sub.user?.id || sub.user_id
            return `
            <div class="submission">
                <div class="submission-content" onclick="toggleGradeForm('${userId}')">
                    <div class="submission-user">
                        <div class="user-name">${userName}</div>
                        ${sub.submitted_at && sub.submitted_at !== 'None' ? `<div class="submission-time">${new Date(sub.submitted_at).toLocaleString()}</div>` : ''}
                        ${sub.workflow_state === 'graded' ? '<span class="status-badge status-graded">Graded</span>' : 
                          sub.workflow_state === 'submitted' ? '<span class="status-badge status-submitted">Submitted</span>' : ''}
                        ${sub.late ? '<span class="status-badge status-late">Late</span>' : ''}
                    </div>
                    ${sub.score !== undefined || sub.grade ? `
                    <div class="submission-grade">
                        <div class="grade-value">${sub.grade || sub.score || '—'}</div>
                    </div>
                    ` : ''}
                </div>
                <div class="grade-input-container" id="grade-form-${userId}">
                    <div class="grade-form">
                        <input type="text" class="grade-input" id="grade-${userId}" 
                               placeholder="Grade" value="${sub.grade || sub.score || ''}" />
                        <button class="grade-button" onclick="submitGrade('${userId}')">Submit</button>
                    </div>
                    <textarea class="comment-input" id="comment-${userId}" 
                              placeholder="Comment (optional)"></textarea>
                </div>
            </div>
        `}).join('')}
    </div>
</body>
</html>`
  }
}
