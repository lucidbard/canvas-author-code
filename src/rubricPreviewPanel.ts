import * as vscode from 'vscode'
import * as yaml from 'js-yaml'
import * as path from 'path'

interface RubricRating {
  id?: string
  description: string
  long_description?: string | null
  points: number
}

interface RubricCriterion {
  id?: string
  description: string
  long_description?: string | null
  points: number
  ratings?: RubricRating[]
}

interface Rubric {
  id?: number | string
  title?: string
  points_possible?: number
  free_form_criterion_comments?: boolean
  criteria: RubricCriterion[]
}

interface RubricFile {
  assignment_id?: number | string
  assignment_name?: string
  rubric: Rubric
}

export class RubricPreviewPanel {
  public static currentPanel: RubricPreviewPanel | undefined
  private readonly _panel: vscode.WebviewPanel
  private readonly _extensionUri: vscode.Uri
  private _disposables: vscode.Disposable[] = []
  private _currentRubricPath: string = ''
  private _currentAssignmentName: string = ''

  public static createOrShow(extensionUri: vscode.Uri, rubricPath: string, assignmentName: string) {
    const column = vscode.ViewColumn.Beside

    // If we already have a panel, show it
    if (RubricPreviewPanel.currentPanel) {
      RubricPreviewPanel.currentPanel._panel.reveal(column)
      RubricPreviewPanel.currentPanel._updateFromPath(rubricPath, assignmentName)
      return
    }

    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      'canvasRubricPreview',
      `Rubric: ${assignmentName}`,
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    )

    RubricPreviewPanel.currentPanel = new RubricPreviewPanel(panel, extensionUri, rubricPath, assignmentName)
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, rubricPath: string, assignmentName: string) {
    this._panel = panel
    this._extensionUri = extensionUri
    this._currentRubricPath = rubricPath
    this._currentAssignmentName = assignmentName

    // Set the webview's initial html content
    this._updateFromPath(rubricPath, assignmentName)

    // Listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables)

    // Watch for file changes via FileSystemWatcher
    const fileWatcher = vscode.workspace.createFileSystemWatcher(rubricPath)
    fileWatcher.onDidChange(() => {
      this._updateFromPath(this._currentRubricPath, this._currentAssignmentName)
    }, null, this._disposables)
    this._disposables.push(fileWatcher)

    // Also watch for document changes (live updates while editing)
    vscode.workspace.onDidChangeTextDocument(
      (e) => {
        if (e.document.uri.fsPath === this._currentRubricPath) {
          this._updateFromDocument(e.document)
        }
      },
      null,
      this._disposables
    )

    // Handle active editor changes to other rubric files
    vscode.window.onDidChangeActiveTextEditor(
      (editor) => {
        if (editor && editor.document.fileName.endsWith('.rubric.yaml')) {
          const newPath = editor.document.uri.fsPath
          if (newPath !== this._currentRubricPath) {
            // Extract assignment name
            let newAssignmentName = path.basename(newPath, '.rubric.yaml')
            try {
              const content = editor.document.getText()
              const data = yaml.load(content) as RubricFile
              if (data && data.assignment_name) {
                newAssignmentName = data.assignment_name
              }
            } catch (e) {
              // Ignore parse errors
            }
            this._updateFromPath(newPath, newAssignmentName)
          }
        }
      },
      null,
      this._disposables
    )
  }

  private _updateFromPath(rubricPath: string, assignmentName: string) {
    this._currentRubricPath = rubricPath
    this._currentAssignmentName = assignmentName
    this._panel.title = `Rubric: ${assignmentName}`

    // Try to get the document if it's open in an editor
    const openDoc = vscode.workspace.textDocuments.find(
      doc => doc.uri.fsPath === rubricPath
    )

    if (openDoc) {
      this._updateFromDocument(openDoc)
    } else {
      // Read from file system
      vscode.workspace.fs.readFile(vscode.Uri.file(rubricPath)).then(
        (content) => {
          this._updateContent(content.toString())
        },
        (error) => {
          this._panel.webview.html = this._getErrorHtml(`Failed to load rubric: ${error}`)
        }
      )
    }
  }

  private _updateFromDocument(document: vscode.TextDocument) {
    const content = document.getText()
    this._updateContent(content)
  }

  private _updateContent(content: string) {
    try {
      const rubricData = yaml.load(content) as RubricFile

      if (!rubricData || !rubricData.rubric) {
        this._panel.webview.html = this._getErrorHtml('Invalid rubric structure. Missing "rubric" field.')
        return
      }

      if (!rubricData.rubric.criteria || !Array.isArray(rubricData.rubric.criteria)) {
        this._panel.webview.html = this._getErrorHtml('Invalid rubric structure. Missing or invalid "criteria" array.')
        return
      }

      // Update assignment name if found
      if (rubricData.assignment_name && rubricData.assignment_name !== this._currentAssignmentName) {
        this._currentAssignmentName = rubricData.assignment_name
        this._panel.title = `Rubric: ${rubricData.assignment_name}`
      }

      this._panel.webview.html = this._getHtmlForWebview(this._panel.webview, rubricData)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      this._panel.webview.html = this._getErrorHtml(`YAML Parse Error: ${errorMsg}`)
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview, data: RubricFile): string {
    const nonce = getNonce()
    const rubric = data.rubric
    const title = rubric.title || data.assignment_name || 'Assignment Rubric'
    const totalPoints = rubric.points_possible || rubric.criteria.reduce((sum, c) => sum + (c.points || 0), 0)

    const criteriaHtml = rubric.criteria.map((criterion, index) => {
      const ratingsHtml = criterion.ratings && criterion.ratings.length > 0
        ? criterion.ratings.map(rating => `
            <div class="rating">
              <div class="rating-points">${rating.points} pts</div>
              <div class="rating-desc">${escapeHtml(rating.description)}</div>
              ${rating.long_description ? `<div class="rating-long">${escapeHtml(rating.long_description)}</div>` : ''}
            </div>
          `).join('')
        : '<div class="no-ratings">No ratings defined</div>'

      return `
        <div class="criterion">
          <div class="criterion-header">
            <span class="criterion-title">${escapeHtml(criterion.description)}</span>
            <span class="criterion-points">${criterion.points} pts</span>
          </div>
          ${criterion.long_description ? `<div class="criterion-long-desc">${escapeHtml(criterion.long_description)}</div>` : ''}
          <div class="ratings">
            ${ratingsHtml}
          </div>
        </div>
      `
    }).join('')

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>Rubric Preview</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            margin: 0;
        }

        .rubric-container {
            max-width: 900px;
            margin: 0 auto;
        }

        .rubric-header {
            background: linear-gradient(135deg, #0374B5 0%, #025d91 100%);
            color: white;
            padding: 16px 20px;
            border-radius: 8px 8px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .rubric-title {
            font-size: 18px;
            font-weight: 600;
            margin: 0;
        }

        .rubric-total {
            font-size: 14px;
            background: rgba(255,255,255,0.2);
            padding: 6px 12px;
            border-radius: 4px;
        }

        .criterion {
            border: 1px solid var(--vscode-widget-border);
            border-top: none;
            background: var(--vscode-editor-background);
        }

        .criterion:last-child {
            border-radius: 0 0 8px 8px;
        }

        .criterion-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            background: var(--vscode-sideBar-background);
            border-bottom: 1px solid var(--vscode-widget-border);
        }

        .criterion-title {
            font-weight: 600;
            font-size: 14px;
        }

        .criterion-points {
            color: #0374B5;
            font-weight: 600;
            font-size: 13px;
        }

        .criterion-long-desc {
            padding: 8px 16px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            background: var(--vscode-textBlockQuote-background);
            border-bottom: 1px solid var(--vscode-widget-border);
        }

        .ratings {
            display: flex;
            flex-wrap: wrap;
            padding: 0;
        }

        .rating {
            flex: 1;
            min-width: 120px;
            padding: 12px;
            border-right: 1px solid var(--vscode-widget-border);
            text-align: center;
        }

        .rating:last-child {
            border-right: none;
        }

        .rating-points {
            font-weight: 600;
            color: #0374B5;
            margin-bottom: 6px;
            font-size: 14px;
        }

        .rating-desc {
            font-size: 12px;
            color: var(--vscode-foreground);
        }

        .rating-long {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
        }

        .no-ratings {
            padding: 12px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            font-size: 12px;
            width: 100%;
        }

        .assignment-info {
            margin-bottom: 16px;
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }

        .free-form-notice {
            margin-top: 16px;
            padding: 10px 16px;
            background: var(--vscode-textBlockQuote-background);
            border-radius: 4px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-state {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
            border: 1px solid var(--vscode-widget-border);
            border-top: none;
            border-radius: 0 0 8px 8px;
        }

        @media print {
            body {
                background: white;
                color: black;
            }
            .rubric-header {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
        }
    </style>
</head>
<body>
    <div class="rubric-container">
        ${data.assignment_name ? `<div class="assignment-info">Assignment: ${escapeHtml(data.assignment_name)}</div>` : ''}

        <div class="rubric-header">
            <h1 class="rubric-title">${escapeHtml(title)}</h1>
            <span class="rubric-total">Total: ${totalPoints} pts</span>
        </div>

        ${rubric.criteria.length === 0 ? `
            <div class="empty-state">
                <p>No criteria defined in this rubric.</p>
                <p style="font-size: 12px;">Add criteria to the YAML file to see them here.</p>
            </div>
        ` : criteriaHtml}

        ${rubric.free_form_criterion_comments ? `
            <div class="free-form-notice">
                Free-form comments are enabled for this rubric.
            </div>
        ` : ''}
    </div>
</body>
</html>`
  }

  private _getErrorHtml(error: string): string {
    const nonce = getNonce()
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>Rubric Preview - Error</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
        }
        .error {
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            color: var(--vscode-inputValidation-errorForeground);
            padding: 16px 20px;
            border-radius: 4px;
        }
        .error-title {
            font-weight: 600;
            margin-bottom: 8px;
        }
    </style>
</head>
<body>
    <div class="error">
        <div class="error-title">Error Loading Rubric</div>
        <div>${escapeHtml(error)}</div>
    </div>
</body>
</html>`
  }

  public dispose() {
    RubricPreviewPanel.currentPanel = undefined

    this._panel.dispose()

    while (this._disposables.length) {
      const disposable = this._disposables.pop()
      if (disposable) {
        disposable.dispose()
      }
    }
  }
}

function getNonce() {
  let text = ''
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }
  return text
}

function escapeHtml(text: string): string {
  if (!text) return ''
  const map: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }
  return String(text).replace(/[&<>"']/g, m => map[m])
}
