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

interface AssignmentWithSubmissions {
  id: string
  name: string
  due_at?: string
  points_possible: number
  submission_counts: {
    total: number
    submitted: number
    graded: number
    needs_grading: number
    late: number
  }
  submissions: Submission[]
}

export class SubmissionsPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'canvasAuthorSubmissions'
  private _view?: vscode.WebviewView
  private _currentAssignment?: { courseId: string; assignmentId: string; title: string }
  private _currentCourse?: { courseId: string; courseName: string }
  private _viewMode: 'single' | 'hierarchical' = 'hierarchical'
  private _mcpClient?: CanvasMcpClient
  private _outputChannel: vscode.OutputChannel
  private _getCourses?: () => Array<{ id: string; name: string }>

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext,
    getCourses?: () => Array<{ id: string; name: string }>
  ) {
    this._outputChannel = vscode.window.createOutputChannel('Canvas Author - Submissions')
    this._getCourses = getCourses
  }

  public setMcpClient(client: CanvasMcpClient | undefined) {
    this._mcpClient = client
  }

  public async showAssignmentSubmissions(courseId: string, assignmentId: string, title: string) {
    this._currentAssignment = { courseId, assignmentId, title }
    this._viewMode = 'single'
    if (this._view) {
      await this._update()
    }
  }

  public async showAllSubmissions(courseId: string, courseName: string) {
    this._outputChannel.appendLine(`showAllSubmissions called: courseId=${courseId}, courseName=${courseName}`)
    this._outputChannel.appendLine(`View exists: ${!!this._view}`)
    this._currentCourse = { courseId, courseName }
    this._viewMode = 'hierarchical'
    if (this._view) {
      this._outputChannel.appendLine('Calling _updateHierarchical...')
      await this._updateHierarchical()
    } else {
      this._outputChannel.appendLine('View not ready yet, will update when resolveWebviewView is called')
    }
  }

  public clear() {
    this._currentAssignment = undefined
    this._currentCourse = undefined
    if (this._view) {
      this._view.webview.html = this._getWelcomeHtml()
    }
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._outputChannel.appendLine('resolveWebviewView called')
    this._outputChannel.appendLine(`View mode: ${this._viewMode}`)
    this._outputChannel.appendLine(`Current course: ${this._currentCourse ? JSON.stringify(this._currentCourse) : 'none'}`)
    this._outputChannel.appendLine(`Current assignment: ${this._currentAssignment ? JSON.stringify(this._currentAssignment) : 'none'}`)

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
            await this.openSubmissionForViewing(message.courseId, message.assignmentId, message.userId)
            break
          case 'submitGrade':
            await this.submitGrade(message.assignmentId, message.userId, message.grade, message.comment)
            break
          case 'toggleView':
            await this.toggleViewMode()
            break
        }
      },
      undefined,
      []
    )

    if (this._viewMode === 'hierarchical' && this._currentCourse) {
      this._outputChannel.appendLine('Triggering hierarchical update from resolveWebviewView')
      this._updateHierarchical()
    } else if (this._currentAssignment) {
      this._outputChannel.appendLine('Triggering single assignment update from resolveWebviewView')
      this._update()
    } else {
      // Auto-load single course if available
      if (this._getCourses) {
        const courses = this._getCourses()
        this._outputChannel.appendLine(`Found ${courses.length} courses`)
        if (courses.length === 1) {
          this._outputChannel.appendLine(`Auto-loading single course: ${courses[0].name}`)
          this._currentCourse = { courseId: courses[0].id, courseName: courses[0].name }
          this._viewMode = 'hierarchical'
          this._updateHierarchical()
          return
        }
      }
      this._outputChannel.appendLine('Showing welcome HTML (no pending data)')
      webviewView.webview.html = this._getWelcomeHtml()
    }
  }

  private async openSubmissionForViewing(courseId: string, assignmentId: string, userId: string) {
    this._outputChannel.appendLine(`Opening submission: course=${courseId}, assignment=${assignmentId}, user=${userId}`)

    if (!this._mcpClient) {
      vscode.window.showErrorMessage('Canvas connection not available')
      return
    }

    try {
      // Fetch the full submission details
      const result = await this._mcpClient.callTool('get_submission', {
        course_id: courseId,
        assignment_id: assignmentId,
        user_id: userId
      })

      this._outputChannel.appendLine(`Submission data: ${JSON.stringify(result, null, 2).substring(0, 500)}`)

      // Create a new document to display the submission
      const submission = result as any
      let content = ''

      // Build the submission content
      content += `# Submission for Assignment ${assignmentId}\n\n`
      content += `**Student:** ${submission.user?.name || `User ${userId}`}\n`
      content += `**Submitted:** ${submission.submitted_at ? new Date(submission.submitted_at).toLocaleString() : 'Not submitted'}\n`
      content += `**Score:** ${submission.score !== undefined ? submission.score : '—'} / ${submission.assignment?.points_possible || '?'}\n`
      content += `**Grade:** ${submission.grade || '—'}\n`
      content += `**Status:** ${submission.workflow_state}\n`
      if (submission.late) {
        content += `**⚠️ LATE SUBMISSION**\n`
      }
      content += `\n---\n\n`

      // Add submission body/content
      if (submission.body) {
        content += `## Submission Content\n\n${submission.body}\n\n`
      }

      // Add attachments
      if (submission.attachments && submission.attachments.length > 0) {
        content += `## Attachments\n\n`
        for (const att of submission.attachments) {
          content += `- [${att.filename}](${att.url})\n`
        }
        content += `\n`
      }

      // Add submission comments
      if (submission.submission_comments && submission.submission_comments.length > 0) {
        content += `## Comments\n\n`
        for (const comment of submission.submission_comments) {
          content += `**${comment.author_name}** (${new Date(comment.created_at).toLocaleString()}):\n`
          content += `${comment.comment}\n\n`
        }
      }

      // Add quiz submission data if available
      if (submission.submission_type === 'online_quiz' && submission.quiz_submission) {
        content += `## Quiz Submission\n\n`
        content += `**Attempt:** ${submission.quiz_submission.attempt || 1}\n`
        content += `**Time Spent:** ${submission.quiz_submission.time_spent ? `${submission.quiz_submission.time_spent} seconds` : 'N/A'}\n\n`

        // If we have quiz answers, display them
        if (submission.quiz_submission.questions) {
          content += `### Answers\n\n`
          for (const q of submission.quiz_submission.questions) {
            content += `**Q${q.position}: ${q.question_name || q.question_text}**\n`
            content += `Answer: ${q.answer || 'No answer'}\n`
            if (q.correct !== undefined) {
              content += q.correct ? `✓ Correct\n` : `✗ Incorrect\n`
            }
            content += `\n`
          }
        }
      }

      // Create and show the document
      const doc = await vscode.workspace.openTextDocument({
        content,
        language: 'markdown'
      })
      await vscode.window.showTextDocument(doc, { preview: true })

    } catch (error) {
      this._outputChannel.appendLine(`ERROR opening submission: ${error}`)
      vscode.window.showErrorMessage(`Failed to open submission: ${error}`)
    }
  }

  private async submitGrade(assignmentId: string, userId: string, grade: string, comment: string) {
    if (!this._mcpClient) {
      return
    }

    const courseId = this._currentAssignment?.courseId || this._currentCourse?.courseId
    if (!courseId) {
      return
    }

    try {
      // Submit grade via MCP
      await this._mcpClient.callTool('update_grade', {
        course_id: courseId,
        assignment_id: assignmentId,
        user_id: userId,
        grade: grade,
        comment: comment
      })

      vscode.window.showInformationMessage('Grade submitted successfully!')

      // Refresh the appropriate view
      if (this._viewMode === 'hierarchical') {
        await this._updateHierarchical()
      } else {
        await this._update()
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to submit grade: ${error}`)
    }
  }

  private async toggleViewMode() {
    if (this._viewMode === 'single' && this._currentAssignment) {
      // Switch to hierarchical view for the course
      this._currentCourse = {
        courseId: this._currentAssignment.courseId,
        courseName: 'Course'
      }
      this._viewMode = 'hierarchical'
      await this._updateHierarchical()
    } else if (this._viewMode === 'hierarchical' && this._currentCourse) {
      // Can't switch back without knowing which assignment to show
      // Just stay in hierarchical mode
      vscode.window.showInformationMessage('Click an assignment to view its submissions individually')
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

  private async _updateHierarchical() {
    this._outputChannel.appendLine('_updateHierarchical called')
    this._outputChannel.appendLine(`View exists: ${!!this._view}`)
    this._outputChannel.appendLine(`Current course: ${this._currentCourse ? JSON.stringify(this._currentCourse) : 'none'}`)

    if (!this._view || !this._currentCourse) {
      this._outputChannel.appendLine('Exiting early: view or currentCourse not set')
      return
    }

    const webview = this._view.webview

    if (!this._mcpClient) {
      this._outputChannel.appendLine('ERROR: MCP client not available')
      webview.html = this._getErrorHtml('Canvas connection not available')
      return
    }

    try {
      this._outputChannel.appendLine('Calling MCP tool: get_all_submissions_hierarchical')
      this._outputChannel.appendLine(`  course_id: ${this._currentCourse.courseId}`)

      // Fetch all submissions hierarchically
      const result = await this._mcpClient.callTool('get_all_submissions_hierarchical', {
        course_id: this._currentCourse.courseId,
        include_user: true,
        include_rubric: false
      })

      this._outputChannel.appendLine(`MCP call succeeded, result type: ${typeof result}`)
      this._outputChannel.appendLine(`Result is array: ${Array.isArray(result)}`)
      if (Array.isArray(result)) {
        this._outputChannel.appendLine(`Result length: ${result.length}`)
        if (result.length > 0) {
          this._outputChannel.appendLine(`First assignment: ${JSON.stringify(result[0], null, 2).substring(0, 500)}`)
        }
      } else {
        this._outputChannel.appendLine(`Result: ${JSON.stringify(result, null, 2).substring(0, 500)}`)
      }

      const assignments: AssignmentWithSubmissions[] = Array.isArray(result) ? result : []
      this._outputChannel.appendLine(`Rendering HTML with ${assignments.length} assignments`)
      webview.html = this._getHierarchicalSubmissionsHtml(assignments, this._currentCourse.courseName)
      this._outputChannel.appendLine('HTML rendering complete')
    } catch (error) {
      this._outputChannel.appendLine(`ERROR in _updateHierarchical: ${error}`)
      if (error instanceof Error) {
        this._outputChannel.appendLine(`Error stack: ${error.stack}`)
      }
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
        
        function submitGrade(assignmentId, userId) {
            const gradeInput = document.getElementById('grade-' + userId);
            const commentInput = document.getElementById('comment-' + userId);

            vscode.postMessage({
                command: 'submitGrade',
                assignmentId: assignmentId,
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
                        <button class="grade-button" onclick="submitGrade('${this._currentAssignment?.assignmentId}', '${userId}')">Submit</button>
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

  private _getHierarchicalSubmissionsHtml(assignments: AssignmentWithSubmissions[], courseName: string): string {
    const totalAssignments = assignments.length
    const totalSubmissions = assignments.reduce((sum, a) => sum + (a.submission_counts?.submitted || 0), 0)
    const totalNeedsGrading = assignments.reduce((sum, a) => sum + (a.submission_counts?.needs_grading || 0), 0)

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>All Submissions</title>
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
            position: sticky;
            top: 0;
            z-index: 100;
        }

        .course-title {
            font-size: 14px;
            font-weight: 600;
            margin: 0 0 12px 0;
            color: var(--vscode-foreground);
        }

        .global-stats {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
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

        .assignments-list {
            padding: 8px;
        }

        .assignment-container {
            margin-bottom: 8px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            overflow: hidden;
        }

        .assignment-header {
            padding: 12px;
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            cursor: pointer;
            transition: background-color 0.1s;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .assignment-header:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .assignment-title-section {
            flex: 1;
        }

        .assignment-title {
            font-weight: 600;
            margin-bottom: 4px;
        }

        .assignment-meta {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .assignment-stats {
            display: flex;
            gap: 12px;
            font-size: 12px;
        }

        .assignment-stat {
            text-align: center;
        }

        .assignment-stat-value {
            font-weight: 600;
            font-size: 16px;
        }

        .assignment-stat-label {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
        }

        .expand-icon {
            margin-left: 12px;
            transition: transform 0.2s;
        }

        .expand-icon.expanded {
            transform: rotate(90deg);
        }

        .submissions-section {
            display: none;
            border-top: 1px solid var(--vscode-panel-border);
        }

        .submissions-section.expanded {
            display: block;
        }

        .submission {
            padding: 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .submission:last-child {
            border-bottom: none;
        }

        .submission-content {
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
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
            margin-right: 4px;
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

        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: var(--vscode-descriptionForeground);
        }

        .submission-actions {
            display: flex;
            gap: 6px;
            margin-left: 12px;
        }

        .action-button {
            padding: 4px 10px;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 11px;
            font-weight: 500;
            transition: background-color 0.1s;
        }

        .view-button {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .view-button:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .action-button.grade-button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .action-button.grade-button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
    </style>
    <script>
        const vscode = acquireVsCodeApi();

        function toggleAssignment(assignmentId) {
            const section = document.getElementById('submissions-' + assignmentId);
            const icon = document.getElementById('icon-' + assignmentId);
            section.classList.toggle('expanded');
            icon.classList.toggle('expanded');
        }

        function toggleGradeForm(assignmentId, userId) {
            const form = document.getElementById('grade-form-' + assignmentId + '-' + userId);
            form.classList.toggle('active');
        }

        function submitGrade(assignmentId, userId) {
            const gradeInput = document.getElementById('grade-' + assignmentId + '-' + userId);
            const commentInput = document.getElementById('comment-' + assignmentId + '-' + userId);

            vscode.postMessage({
                command: 'submitGrade',
                assignmentId: assignmentId,
                userId: userId,
                grade: gradeInput.value,
                comment: commentInput.value
            });

            // Reset form
            gradeInput.value = '';
            commentInput.value = '';
            toggleGradeForm(assignmentId, userId);
        }

        function viewSubmission(courseId, assignmentId, userId) {
            vscode.postMessage({
                command: 'openSubmission',
                courseId: courseId,
                assignmentId: assignmentId,
                userId: userId
            });
        }
    </script>
</head>
<body>
    <div class="header">
        <h3 class="course-title">${courseName} - All Submissions</h3>
        <div class="global-stats">
            <div class="stat">
                <div class="stat-label">Assignments</div>
                <div class="stat-value">${totalAssignments}</div>
            </div>
            <div class="stat">
                <div class="stat-label">Submitted</div>
                <div class="stat-value">${totalSubmissions}</div>
            </div>
            <div class="stat">
                <div class="stat-label">Needs Grading</div>
                <div class="stat-value">${totalNeedsGrading}</div>
            </div>
        </div>
    </div>

    <div class="assignments-list">
        ${assignments.length === 0 ? `
            <div class="empty-state">
                <p>No assignments with submissions</p>
            </div>
        ` : assignments.map(assignment => {
            const counts = assignment.submission_counts || { submitted: 0, graded: 0, needs_grading: 0, total: 0, not_submitted: 0, pending_review: 0, late: 0, missing: 0 }
            return `
            <div class="assignment-container">
                <div class="assignment-header" onclick="toggleAssignment('${assignment.id}')">
                    <div class="assignment-title-section">
                        <div class="assignment-title">${assignment.name}</div>
                        <div class="assignment-meta">
                            ${assignment.due_at ? `Due: ${new Date(assignment.due_at).toLocaleDateString()}` : 'No due date'} •
                            ${assignment.points_possible} pts
                        </div>
                    </div>
                    <div class="assignment-stats">
                        <div class="assignment-stat">
                            <div class="assignment-stat-value">${counts.submitted}</div>
                            <div class="assignment-stat-label">Submitted</div>
                        </div>
                        <div class="assignment-stat">
                            <div class="assignment-stat-value">${counts.graded}</div>
                            <div class="assignment-stat-label">Graded</div>
                        </div>
                        <div class="assignment-stat">
                            <div class="assignment-stat-value">${counts.needs_grading}</div>
                            <div class="assignment-stat-label">To Grade</div>
                        </div>
                    </div>
                    <div class="expand-icon" id="icon-${assignment.id}">▶</div>
                </div>
                <div class="submissions-section" id="submissions-${assignment.id}">
                    ${assignment.submissions.length === 0 ? `
                        <div class="empty-state">
                            <p>No submissions yet</p>
                        </div>
                    ` : assignment.submissions.map(sub => {
                        const userName = sub.user?.name || sub.user_name || `User ${sub.user_id}`
                        const userId = sub.user?.id || sub.user_id
                        return `
                        <div class="submission">
                            <div class="submission-content">
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
                                <div class="submission-actions">
                                    <button class="action-button view-button" onclick="viewSubmission('${this._currentCourse?.courseId}', '${assignment.id}', '${userId}'); event.stopPropagation();">View</button>
                                    <button class="action-button grade-button" onclick="toggleGradeForm('${assignment.id}', '${userId}'); event.stopPropagation();">Grade</button>
                                </div>
                            </div>
                            <div class="grade-input-container" id="grade-form-${assignment.id}-${userId}">
                                <div class="grade-form">
                                    <input type="text" class="grade-input" id="grade-${assignment.id}-${userId}"
                                           placeholder="Grade" value="${sub.grade || sub.score || ''}" />
                                    <button class="grade-button" onclick="submitGrade('${assignment.id}', '${userId}')">Submit</button>
                                </div>
                                <textarea class="comment-input" id="comment-${assignment.id}-${userId}"
                                          placeholder="Comment (optional)"></textarea>
                            </div>
                        </div>
                    `}).join('')}
                </div>
            </div>
        `}).join('')}
    </div>
</body>
</html>`
  }
}
