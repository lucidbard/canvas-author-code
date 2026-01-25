import * as vscode from 'vscode'
import * as fs from 'fs'
import { CanvasMcpClient } from './mcpClient'

interface ReviewItem {
  id: string
  type: string
  title: string
  file_path: string
  review_status: string
  review_count: number
  has_human_review: boolean
}

export class ReviewPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'canvasAuthorReview'
  private _view?: vscode.WebviewView
  private _currentItem?: {
    worktreeName: string
    item: ReviewItem
    coursePath: string
    fullFilePath: string
  }
  private _mcpClient?: CanvasMcpClient

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {}

  public setMcpClient(client: CanvasMcpClient | undefined) {
    this._mcpClient = client
  }

  public async showItemReview(
    coursePath: string,
    worktreeName: string,
    item: ReviewItem
  ) {
    this._currentItem = {
      worktreeName,
      item,
      coursePath,
      fullFilePath: `${coursePath}/.canvas-author/worktrees/${worktreeName}/${item.file_path}`
    }

    if (this._view) {
      await this._update()
    }
  }

  public clear() {
    this._currentItem = undefined
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

    webviewView.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'submitReview':
            await this.submitReview(
              message.decision,
              message.comments,
              message.severity
            )
            break
          case 'viewFile':
            await this.viewFile()
            break
          case 'viewHistory':
            await this.viewHistory()
            break
        }
      },
      undefined,
      []
    )

    if (this._currentItem) {
      this._update()
    } else {
      webviewView.webview.html = this._getWelcomeHtml()
    }
  }

  private async submitReview(
    decision: string,
    comments: string,
    severity: string
  ) {
    if (!this._currentItem || !this._mcpClient) {
      return
    }

    try {
      // Get reviewer name from settings or use default
      const config = vscode.workspace.getConfiguration('canvas-author')
      const reviewerName = config.get<string>('reviewerName') || 'Human Reviewer'

      await this._mcpClient.callTool('submit_human_review', {
        course_path: this._currentItem.coursePath,
        worktree_name: this._currentItem.worktreeName,
        item_id: this._currentItem.item.id,
        item_title: this._currentItem.item.title,
        item_type: this._currentItem.item.type,
        canvas_id: this._currentItem.item.id.split(':')[1] || '',
        file_path: this._currentItem.item.file_path,
        reviewer_name: reviewerName,
        decision: decision,
        comments: comments,
        severity: severity
      })

      vscode.window.showInformationMessage(`Review submitted: ${decision}`)

      // Refresh the tree
      vscode.commands.executeCommand('canvas-author.refreshReviews')

      // Reload current item
      await this._update()
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to submit review: ${error}`)
    }
  }

  private async viewFile() {
    if (!this._currentItem) {
      return
    }

    try {
      const doc = await vscode.workspace.openTextDocument(this._currentItem.fullFilePath)
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside })
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to open file: ${error}`)
    }
  }

  private async viewHistory() {
    if (!this._currentItem || !this._mcpClient) {
      return
    }

    try {
      const result = await this._mcpClient.callTool('get_item_review_history', {
        course_path: this._currentItem.coursePath,
        item_id: this._currentItem.item.id,
        include_archived: true
      }) as any

      // Show history in a new document
      const historyDoc = await vscode.workspace.openTextDocument({
        content: JSON.stringify(result, null, 2),
        language: 'json'
      })
      await vscode.window.showTextDocument(historyDoc, { viewColumn: vscode.ViewColumn.Beside })
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to load history: ${error}`)
    }
  }

  private async _update() {
    if (!this._view || !this._currentItem) {
      return
    }

    const webview = this._view.webview

    if (!this._mcpClient) {
      webview.html = this._getErrorHtml('Canvas connection not available')
      return
    }

    try {
      // Load file content
      const content = fs.readFileSync(this._currentItem.fullFilePath, 'utf8')

      // Get review history
      const history = await this._mcpClient.callTool('get_item_review_history', {
        course_path: this._currentItem.coursePath,
        item_id: this._currentItem.item.id,
        include_archived: false
      }) as any

      webview.html = this._getReviewHtml(
        this._currentItem.item,
        content,
        history || []
      )
    } catch (error) {
      webview.html = this._getErrorHtml(`Failed to load item: ${error}`)
    }
  }

  private _getWelcomeHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Review</title>
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
        <div class="icon">📋</div>
        <p>Select an item from the To Review tree to begin reviewing</p>
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
    <title>Review Error</title>
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

  private _getReviewHtml(item: ReviewItem, content: string, history: any[]): string {
    const escapedContent = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Review: ${item.title}</title>
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

        .title {
            font-size: 16px;
            font-weight: 600;
            margin: 0 0 8px 0;
        }

        .meta {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        .actions {
            display: flex;
            gap: 8px;
            margin-top: 12px;
        }

        .button {
            padding: 6px 12px;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
        }

        .button-primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .button-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .content-preview {
            padding: 16px;
            max-height: 200px;
            overflow-y: auto;
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .content-preview pre {
            margin: 0;
            white-space: pre-wrap;
            font-size: 11px;
            line-height: 1.5;
        }

        .review-history {
            padding: 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .history-title {
            font-size: 14px;
            font-weight: 600;
            margin: 0 0 12px 0;
        }

        .review-item {
            padding: 8px;
            margin-bottom: 8px;
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 4px;
        }

        .reviewer {
            font-weight: 500;
            font-size: 12px;
        }

        .review-decision {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            margin-left: 8px;
        }

        .decision-approved {
            background-color: var(--vscode-inputValidation-warningBackground);
            color: var(--vscode-inputValidation-warningForeground);
        }

        .decision-rejected {
            background-color: var(--vscode-inputValidation-errorBackground);
            color: var(--vscode-inputValidation-errorForeground);
        }

        .decision-needs_revision {
            background-color: var(--vscode-inputValidation-infoBackground);
            color: var(--vscode-inputValidation-infoForeground);
        }

        .review-comment {
            font-size: 11px;
            margin-top: 4px;
            color: var(--vscode-descriptionForeground);
        }

        .review-form {
            padding: 16px;
        }

        .form-title {
            font-size: 14px;
            font-weight: 600;
            margin: 0 0 12px 0;
        }

        .form-group {
            margin-bottom: 12px;
        }

        .form-label {
            display: block;
            font-size: 12px;
            font-weight: 500;
            margin-bottom: 4px;
        }

        textarea {
            width: 100%;
            padding: 8px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            font-family: var(--vscode-font-family);
            font-size: 12px;
            resize: vertical;
            min-height: 80px;
        }

        select {
            padding: 6px 8px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            font-size: 12px;
        }

        .button-group {
            display: flex;
            gap: 8px;
        }

        .button-approve {
            background-color: var(--vscode-testing-iconPassed);
            color: white;
        }

        .button-reject {
            background-color: var(--vscode-testing-iconFailed);
            color: white;
        }

        .button-revision {
            background-color: var(--vscode-editorWarning-foreground);
            color: white;
        }
    </style>
    <script>
        const vscode = acquireVsCodeApi();

        function submitReview(decision) {
            const comments = document.getElementById('comments').value;
            const severity = document.getElementById('severity').value;

            vscode.postMessage({
                command: 'submitReview',
                decision: decision,
                comments: comments,
                severity: severity
            });
        }

        function viewFile() {
            vscode.postMessage({ command: 'viewFile' });
        }

        function viewHistory() {
            vscode.postMessage({ command: 'viewHistory' });
        }
    </script>
</head>
<body>
    <div class="header">
        <h2 class="title">${item.title}</h2>
        <div class="meta">
            ${item.type} • ${item.review_count} review${item.review_count !== 1 ? 's' : ''} • Status: ${item.review_status}
        </div>
        <div class="actions">
            <button class="button button-primary" onclick="viewFile()">Open File</button>
            <button class="button button-secondary" onclick="viewHistory()">View Full History</button>
        </div>
    </div>

    <div class="content-preview">
        <pre>${escapedContent.substring(0, 1000)}${escapedContent.length > 1000 ? '\n\n... (content truncated, click "Open File" to view all)' : ''}</pre>
    </div>

    ${history.length > 0 ? `
    <div class="review-history">
        <h3 class="history-title">Review History</h3>
        ${history.map((review: any) => `
            <div class="review-item">
                <div class="reviewer">
                    ${review.agent_id}
                    <span class="review-decision decision-${review.decision}">${review.decision}</span>
                </div>
                <div class="review-comment">${review.reasoning}</div>
            </div>
        `).join('')}
    </div>
    ` : ''}

    <div class="review-form">
        <h3 class="form-title">Add Review</h3>
        <div class="form-group">
            <label class="form-label" for="comments">Comments</label>
            <textarea id="comments" placeholder="Enter your review comments..."></textarea>
        </div>
        <div class="form-group">
            <label class="form-label" for="severity">Severity</label>
            <select id="severity">
                <option value="low">Low</option>
                <option value="medium" selected>Medium</option>
                <option value="high">High</option>
            </select>
        </div>
        <div class="button-group">
            <button class="button button-approve" onclick="submitReview('approved')">✓ Approve</button>
            <button class="button button-revision" onclick="submitReview('needs_revision')">⚠ Needs Revision</button>
            <button class="button button-reject" onclick="submitReview('rejected')">✗ Reject</button>
        </div>
    </div>
</body>
</html>`
  }
}
