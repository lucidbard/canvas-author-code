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
  private _rubricPanel?: any  // RubricPanel instance
  private _getMcpClient?: () => CanvasMcpClient | undefined
  private _outputChannel: vscode.OutputChannel
  private _getCourses?: () => Array<{ id: string; name: string }>

  // Submission cache: key is `${courseId}_${assignmentId}_${userId}`, value is full submission data
  private _submissionCache: Map<string, any> = new Map()
  private _cacheTimestamp?: number

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

  public setRubricPanel(rubricPanel: any, getMcpClient: () => CanvasMcpClient | undefined) {
    this._rubricPanel = rubricPanel
    this._getMcpClient = getMcpClient
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
          case 'openGradingPanel':
            await this.openGradingPanel(message.courseId, message.assignmentId, message.userId, message.assignmentName)
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

  private async openGradingPanel(
    courseId: string,
    assignmentId: string,
    userId: string,
    assignmentName: string
  ) {
    this._outputChannel.appendLine(`Opening grading panel: course=${courseId}, assignment=${assignmentId}, user=${userId}`)

    // Check cache first
    const cacheKey = `${courseId}_${assignmentId}_${userId}`
    let submission: any
    let userName = `User ${userId}`

    if (this._submissionCache.has(cacheKey)) {
      this._outputChannel.appendLine(`Using cached submission for ${cacheKey}`)
      submission = this._submissionCache.get(cacheKey)
      this._outputChannel.appendLine(`Cached submission type: ${typeof submission}`)
      this._outputChannel.appendLine(`Cached submission is array: ${Array.isArray(submission)}`)

      // Ensure submission is an object, not a string
      if (typeof submission === 'string') {
        try {
          submission = JSON.parse(submission)
          this._outputChannel.appendLine(`Parsed cached submission from JSON string`)
        } catch (e) {
          this._outputChannel.appendLine(`Failed to parse cached submission: ${e}`)
        }
      }

      userName = submission?.user?.name || userName
    } else {
      this._outputChannel.appendLine(`Cache miss for ${cacheKey}, fetching...`)
      try {
        submission = await this._mcpClient?.callTool('get_submission', {
          course_id: courseId,
          assignment_id: assignmentId,
          user_id: userId,
          anonymize: false
        })

        // Ensure submission is an object, not a string
        if (typeof submission === 'string') {
          try {
            submission = JSON.parse(submission)
          } catch (e) {
            this._outputChannel.appendLine(`Failed to parse submission: ${e}`)
          }
        }

        userName = (submission as any)?.user?.name || userName
        // Cache for future use
        this._submissionCache.set(cacheKey, submission)
      } catch (error) {
        this._outputChannel.appendLine(`Could not fetch submission: ${error}`)
      }
    }

    // Import and open the grading panel
    const { GradingPanel } = await import('./gradingPanel')

    // Open submission content in editor (pass cached submission if available)
    GradingPanel.createOrShow(
      this._extensionUri,
      this._mcpClient,
      courseId,
      assignmentId,
      assignmentName,
      userId,
      userName,
      submission
    )

    // Load rubric in bottom panel
    if (this._rubricPanel && this._getMcpClient) {
      this._rubricPanel.loadRubric(
        this._getMcpClient(),
        courseId,
        assignmentId,
        assignmentName,
        userId,
        userName
      )
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

    // Show loading state
    webview.html = this._getLoadingHtml(this._currentCourse.courseName)

    try {
      this._outputChannel.appendLine('Calling MCP tool: get_all_submissions_hierarchical')
      this._outputChannel.appendLine(`  course_id: ${this._currentCourse.courseId}`)

      // Fetch all submissions hierarchically (this will use cache if available, then update)
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

      // Preload all submission content in the background
      this._preloadSubmissions(this._currentCourse.courseId, assignments)
    } catch (error) {
      this._outputChannel.appendLine(`ERROR in _updateHierarchical: ${error}`)
      if (error instanceof Error) {
        this._outputChannel.appendLine(`Error stack: ${error.stack}`)
      }
      webview.html = this._getErrorHtml(`Failed to load submissions: ${error}`)
    }
  }

  private async _preloadSubmissions(courseId: string, assignments: AssignmentWithSubmissions[]) {
    if (!this._mcpClient) return

    this._outputChannel.appendLine('Starting background preload of all submissions...')
    const startTime = Date.now()

    // Clear old cache
    this._submissionCache.clear()
    this._cacheTimestamp = Date.now()

    // Collect all submission requests
    const requests: Array<{ courseId: string; assignmentId: string; userId: string; submittedAt?: string }> = []
    for (const assignment of assignments) {
      for (const submission of assignment.submissions) {
        if (submission.workflow_state !== 'unsubmitted') {
          const userId = typeof submission.user_id === 'string' ? submission.user_id : submission.user_id.toString()
          requests.push({
            courseId,
            assignmentId: assignment.id,
            userId,
            submittedAt: submission.submitted_at
          })
        }
      }
    }

    this._outputChannel.appendLine(`Preloading ${requests.length} submissions...`)

    // Load submissions in batches to avoid overwhelming the API
    const batchSize = 5
    let loaded = 0

    for (let i = 0; i < requests.length; i += batchSize) {
      const batch = requests.slice(i, i + batchSize)

      await Promise.all(batch.map(async (req) => {
        try {
          const cacheKey = `${req.courseId}_${req.assignmentId}_${req.userId}`

          let submission = await this._mcpClient!.callTool('get_submission', {
            course_id: req.courseId,
            assignment_id: req.assignmentId,
            user_id: req.userId,
            anonymize: false
          }) as any

          // Ensure submission is an object, not a string
          if (typeof submission === 'string') {
            try {
              submission = JSON.parse(submission)
              this._outputChannel.appendLine(`Parsed submission from JSON string for user ${req.userId}`)
            } catch (e) {
              this._outputChannel.appendLine(`Failed to parse submission JSON for user ${req.userId}: ${e}`)
              return
            }
          }

          // Log first submission details for debugging
          if (loaded === 0) {
            this._outputChannel.appendLine(`First submission type: ${typeof submission}`)
            this._outputChannel.appendLine(`First submission keys: ${Object.keys(submission).slice(0, 10).join(', ')}`)
            this._outputChannel.appendLine(`Has assignment: ${!!submission.assignment}`)
            this._outputChannel.appendLine(`Has body: ${!!submission.body}`)
          }

          // If this is a discussion assignment, fetch and populate discussion posts
          if (submission.assignment?.is_discussion && submission.assignment?.discussion_topic_id) {
            try {
              const discussionPosts = await this._mcpClient!.callTool('get_posts_by_user', {
                course_id: req.courseId,
                discussion_id: submission.assignment.discussion_topic_id
              }) as any

              const userPosts = discussionPosts[req.userId]
              if (userPosts) {
                const postTexts: string[] = []

                // Simple markdown link converter
                const convertLinks = (text: string): string => {
                  if (!text) return ''
                  // Handle markdown images: ![alt](url){attributes}
                  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)(\{[^}]+\})?/g, (match, alt, url, attributes) => {
                    let imgAttrs = `alt="${alt}"`
                    if (attributes) {
                      const widthMatch = attributes.match(/width="([^"]+)"/)
                      const heightMatch = attributes.match(/height="([^"]+)"/)
                      if (widthMatch) imgAttrs += ` width="${widthMatch[1]}"`
                      if (heightMatch) imgAttrs += ` height="${heightMatch[1]}"`
                    }
                    return `<img src="${url}" ${imgAttrs} style="max-width: 100%; height: auto;">`
                  })
                  // Handle markdown links with attributes
                  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)\{target=["']?_blank["']?\}/g, '<a href="$2" target="_blank">$1</a>')
                  // Standard markdown links
                  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
                  // Convert plain URLs
                  const parts = text.split(/(<(?:a\s[^>]*>.*?<\/a>|img\s[^>]*>))/g)
                  text = parts.map(part => {
                    if (part.startsWith('<a ') || part.startsWith('<img ')) return part
                    return part.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank">$1</a>')
                  }).join('')
                  // Convert line breaks
                  text = text.replace(/\n/g, '<br>')
                  return text
                }

                if (userPosts.posts && userPosts.posts.length > 0) {
                  postTexts.push('<strong>Discussion Post:</strong>')
                  userPosts.posts.forEach((post: any) => {
                    const converted = convertLinks(post.message)
                    postTexts.push(`<div style="margin: 10px 0;">${converted}</div>`)
                  })
                }

                if (userPosts.replies && userPosts.replies.length > 0) {
                  postTexts.push('<strong>Replies:</strong>')
                  userPosts.replies.forEach((reply: any) => {
                    const converted = convertLinks(reply.message)
                    postTexts.push(`<div style="margin: 10px 0;">${converted}</div>`)
                  })
                }

                submission.body = postTexts.join('\n')
                submission._discussionPostsCached = true
              }
            } catch (error) {
              this._outputChannel.appendLine(`Failed to fetch discussion posts for user ${req.userId}: ${error}`)
            }
          }

          this._submissionCache.set(cacheKey, submission)
          loaded++

          if (loaded % 10 === 0) {
            this._outputChannel.appendLine(`Preloaded ${loaded}/${requests.length} submissions...`)
          }
        } catch (error) {
          this._outputChannel.appendLine(`Failed to preload submission for user ${req.userId}: ${error}`)
        }
      }))
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    this._outputChannel.appendLine(`Preload complete: ${loaded}/${requests.length} submissions cached in ${elapsed}s`)
  }

  private _getLoadingHtml(courseName: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Loading Submissions</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
        }
        .spinner {
            border: 3px solid var(--vscode-editor-inactiveSelectionBackground);
            border-top: 3px solid var(--vscode-button-background);
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin-bottom: 16px;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .loading-text {
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="spinner"></div>
    <div class="loading-text">Loading submissions for ${courseName}...</div>
</body>
</html>`
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

        function openGrading(courseId, assignmentId, assignmentName, userId) {
            vscode.postMessage({
                command: 'openGradingPanel',
                courseId: courseId,
                assignmentId: assignmentId,
                assignmentName: assignmentName,
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
                        <div class="submission" onclick="openGrading('${this._currentCourse?.courseId}', '${assignment.id}', '${assignment.name}', '${userId}')">
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
