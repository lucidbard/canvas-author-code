import * as vscode from 'vscode'
import { CanvasMcpClient } from './mcpClient'

/**
 * Submission content viewer that opens as an editor tab.
 * Shows submission content only (rubric grading is in the bottom panel).
 */
export class GradingPanel {
  private static currentPanel: GradingPanel | undefined
  private readonly _panel: vscode.WebviewPanel
  private readonly _extensionUri: vscode.Uri
  private _disposables: vscode.Disposable[] = []
  private _mcpClient?: CanvasMcpClient
  private _outputChannel: vscode.OutputChannel

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel
    this._extensionUri = extensionUri
    this._outputChannel = vscode.window.createOutputChannel('Canvas Author - Submission')

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables)
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    mcpClient: CanvasMcpClient | undefined,
    courseId: string,
    assignmentId: string,
    assignmentName: string,
    userId: string,
    userName: string,
    cachedSubmission?: any
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined

    // If we already have a panel, show it
    if (GradingPanel.currentPanel) {
      GradingPanel.currentPanel._panel.reveal(column)
      GradingPanel.currentPanel.setMcpClient(mcpClient)
      GradingPanel.currentPanel.loadSubmission(courseId, assignmentId, userId, assignmentName, userName, cachedSubmission)
      return GradingPanel.currentPanel
    }

    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      'canvasGrading',
      `Grade: ${userName}`,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri]
      }
    )

    GradingPanel.currentPanel = new GradingPanel(panel, extensionUri)
    GradingPanel.currentPanel.setMcpClient(mcpClient)
    GradingPanel.currentPanel.loadSubmission(courseId, assignmentId, userId, assignmentName, userName, cachedSubmission)
    return GradingPanel.currentPanel
  }

  public setMcpClient(client: CanvasMcpClient | undefined) {
    this._mcpClient = client
  }

  private async loadSubmission(
    courseId: string,
    assignmentId: string,
    userId: string,
    assignmentName: string,
    userName: string,
    cachedSubmission?: any
  ) {
    this._outputChannel.appendLine(`Loading grading panel for ${userName}`)

    if (!this._mcpClient) {
      this._panel.webview.html = this.getErrorHtml('MCP client not available')
      return
    }

    // Show loading state
    this._panel.webview.html = this.getLoadingHtml(userName)

    try {
      // Use cached submission if available, otherwise fetch
      let submission: any
      if (cachedSubmission) {
        this._outputChannel.appendLine(`Using cached submission`)
        submission = cachedSubmission
      } else {
        this._outputChannel.appendLine(`Fetching submission from API`)
        submission = await this._mcpClient.callTool('get_submission', {
          course_id: courseId,
          assignment_id: assignmentId,
          user_id: userId,
          anonymize: false
        })
      }

      this._outputChannel.appendLine(`Loaded submission`)

      // If this is a discussion assignment, fetch discussion posts (unless already cached)
      const submissionData = submission as any
      this._outputChannel.appendLine(`Submission data keys: ${Object.keys(submissionData).join(', ')}`)
      this._outputChannel.appendLine(`Has body: ${!!submissionData.body}, body length: ${submissionData.body?.length || 0}`)
      this._outputChannel.appendLine(`Has url: ${!!submissionData.url}`)
      this._outputChannel.appendLine(`Has attachments: ${submissionData.attachments?.length || 0}`)
      this._outputChannel.appendLine(`Is discussion: ${submissionData.assignment?.is_discussion}`)
      this._outputChannel.appendLine(`Workflow state: ${submissionData.workflow_state}`)
      this._outputChannel.appendLine(`Discussion posts already cached: ${!!submissionData._discussionPostsCached}`)

      if (submissionData.assignment?.is_discussion &&
          submissionData.assignment?.discussion_topic_id &&
          !submissionData._discussionPostsCached) {
        try {
          this._outputChannel.appendLine(`Fetching discussion posts for topic ${submissionData.assignment.discussion_topic_id}`)
          const discussionPosts = await this._mcpClient.callTool('get_posts_by_user', {
            course_id: courseId,
            discussion_id: submissionData.assignment.discussion_topic_id
          }) as any

          // Extract this user's posts
          const userPosts = discussionPosts[userId]
          if (userPosts) {
            // Combine posts and replies into body
            const postTexts: string[] = []

            if (userPosts.posts && userPosts.posts.length > 0) {
              postTexts.push('<strong>Discussion Post:</strong>')
              userPosts.posts.forEach((post: any) => {
                this._outputChannel.appendLine(`Raw post message: ${post.message}`)
                const formattedMessage = this.convertMarkdownLinks(post.message)
                this._outputChannel.appendLine(`Formatted message: ${formattedMessage}`)
                postTexts.push(`<div style="margin: 10px 0;">${formattedMessage}</div>`)
              })
            }

            if (userPosts.replies && userPosts.replies.length > 0) {
              postTexts.push('<strong>Replies:</strong>')
              userPosts.replies.forEach((reply: any) => {
                const formattedMessage = this.convertMarkdownLinks(reply.message)
                postTexts.push(`<div style="margin: 10px 0;">${formattedMessage}</div>`)
              })
            }

            submissionData.body = postTexts.join('\n')
            this._outputChannel.appendLine(`Found ${userPosts.posts?.length || 0} posts and ${userPosts.replies?.length || 0} replies`)
          } else {
            this._outputChannel.appendLine(`No discussion posts found for user ${userId}`)
          }
        } catch (error) {
          this._outputChannel.appendLine(`Error fetching discussion posts: ${error}`)
        }
      }
      // Note: If discussion posts were cached (_discussionPostsCached=true),
      // the markdown conversion was already applied during caching

      // Render the submission content
      this._panel.webview.html = this.getSubmissionHtml(
        submissionData,
        assignmentName,
        userName
      )
    } catch (error) {
      this._outputChannel.appendLine(`Error loading: ${error}`)
      this._panel.webview.html = this.getErrorHtml(`Failed to load grading data: ${error}`)
    }
  }

  private getSubmissionHtml(submission: any, assignmentName: string, userName: string): string {
    const submittedAt = submission.submitted_at && submission.submitted_at !== 'None'
      ? new Date(submission.submitted_at).toLocaleString()
      : 'Not submitted'

    const body = submission.body || ''
    const url = submission.url || ''
    const attachments = submission.attachments || []
    const score = submission.score !== null && submission.score !== undefined ? submission.score : '—'
    const pointsPossible = submission.assignment?.points_possible || '?'
    const grade = submission.grade || '—'
    const status = submission.workflow_state || 'unknown'
    const isLate = submission.late ? '⚠️ Late' : ''
    const isMissing = submission.missing ? '❌ Missing' : ''

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 20px;
      color: var(--vscode-foreground);
      line-height: 1.6;
      max-width: 900px;
      margin: 0 auto;
    }
    .header {
      padding-bottom: 20px;
      border-bottom: 2px solid var(--vscode-panel-border);
      margin-bottom: 20px;
    }
    h1 {
      margin: 0 0 10px 0;
      font-size: 24px;
      font-weight: 600;
    }
    .meta {
      font-size: 14px;
      opacity: 0.9;
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
    }
    .meta-item {
      display: flex;
      gap: 8px;
    }
    .meta-label {
      font-weight: 600;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 12px;
      font-weight: 600;
    }
    .badge.late {
      background: var(--vscode-inputValidation-warningBackground);
      color: var(--vscode-inputValidation-warningForeground);
    }
    .badge.missing {
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
    }
    .content {
      margin-top: 30px;
    }
    .content h2 {
      font-size: 18px;
      margin-bottom: 15px;
      font-weight: 600;
    }
    .submission-body {
      background: var(--vscode-editor-background);
      padding: 20px;
      border-radius: 4px;
      border: 1px solid var(--vscode-panel-border);
      margin-bottom: 20px;
    }
    .attachments {
      margin-top: 20px;
    }
    .attachment {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px;
      background: var(--vscode-list-hoverBackground);
      border-radius: 4px;
      margin-bottom: 8px;
    }
    .attachment-icon {
      font-size: 20px;
    }
    .attachment-name {
      flex: 1;
      font-weight: 500;
    }
    .attachment-size {
      opacity: 0.7;
      font-size: 12px;
    }
    a {
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .url-submission {
      padding: 15px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      margin-bottom: 20px;
    }
    .no-submission {
      padding: 40px;
      text-align: center;
      opacity: 0.6;
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${this.escapeHtml(assignmentName)}</h1>
    <div class="meta">
      <div class="meta-item">
        <span class="meta-label">Student:</span>
        <span>${this.escapeHtml(userName)}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Submitted:</span>
        <span>${submittedAt}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Score:</span>
        <span>${score} / ${pointsPossible}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Grade:</span>
        <span>${grade}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Status:</span>
        <span>${status}</span>
      </div>
    </div>
    ${isLate ? '<span class="badge late">Late</span>' : ''}
    ${isMissing ? '<span class="badge missing">Missing</span>' : ''}
  </div>

  <div class="content">
    ${body ? `
      <h2>Submission</h2>
      <div class="submission-body">
        ${body}
      </div>
    ` : ''}

    ${url ? `
      <h2>URL Submission</h2>
      <div class="url-submission">
        <a href="${url}" target="_blank">${url}</a>
      </div>
    ` : ''}

    ${attachments.length > 0 ? `
      <div class="attachments">
        <h2>Attachments</h2>
        ${attachments.map((att: any) => `
          <div class="attachment">
            <span class="attachment-icon">📎</span>
            <span class="attachment-name">${this.escapeHtml(att.filename)}</span>
            <span class="attachment-size">${this.formatFileSize(att.size)}</span>
            <a href="${att.url}" target="_blank">Download</a>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${!body && !url && attachments.length === 0 ? `
      <div class="no-submission">No submission content</div>
    ` : ''}
  </div>
</body>
</html>`
  }

  private formatFileSize(bytes: number): string {
    if (!bytes) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  private convertMarkdownLinks(text: string): string {
    if (!text) return ''

    // Handle markdown IMAGES first (before links): ![alt](url){attributes}
    // Canvas images have attributes like {width="663" height="346" loading="lazy" api-endpoint="..." api-returntype="File"}
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)(\{[^}]+\})?/g, (match, alt, url, attributes) => {
      // Parse attributes if present
      let imgAttrs = `alt="${alt}"`
      if (attributes) {
        // Extract width, height, loading from Canvas attributes
        const widthMatch = attributes.match(/width="([^"]+)"/)
        const heightMatch = attributes.match(/height="([^"]+)"/)
        const loadingMatch = attributes.match(/loading="([^"]+)"/)

        if (widthMatch) imgAttrs += ` width="${widthMatch[1]}"`
        if (heightMatch) imgAttrs += ` height="${heightMatch[1]}"`
        if (loadingMatch) imgAttrs += ` loading="${loadingMatch[1]}"`
      }
      return `<img src="${url}" ${imgAttrs} style="max-width: 100%; height: auto;">`
    })

    // Handle markdown links with attributes: [text](url){target="_blank"}
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)\{target=["']?_blank["']?\}/g, '<a href="$2" target="_blank">$1</a>')

    // Standard markdown links: [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')

    // Convert plain URLs to links, but ONLY if they're not already inside an anchor tag or img tag
    // Split by anchor tags and img tags, process only the text between them
    const parts = text.split(/(<(?:a\s[^>]*>.*?<\/a>|img\s[^>]*>))/g)
    text = parts.map((part, index) => {
      // If this part is an anchor tag or img tag, leave it alone
      if (part.startsWith('<a ') || part.startsWith('<img ')) {
        return part
      }
      // Otherwise, convert plain URLs in this text segment
      return part.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank">$1</a>')
    }).join('')

    // Convert line breaks to <br>
    text = text.replace(/\n/g, '<br>')

    return text
  }

  private getLoadingHtml(userName: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 40px;
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
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="spinner"></div>
  <p>Loading grading interface for ${userName}...</p>
</body>
</html>`
  }

  private getErrorHtml(error: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 20px;
      color: var(--vscode-errorForeground);
    }
  </style>
</head>
<body>
  <h2>Error</h2>
  <p>${error}</p>
</body>
</html>`
  }

  public dispose() {
    GradingPanel.currentPanel = undefined

    this._panel.dispose()

    while (this._disposables.length) {
      const disposable = this._disposables.pop()
      if (disposable) {
        disposable.dispose()
      }
    }
  }
}
