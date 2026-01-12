import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'

interface RubricCriterion {
  id?: string
  description: string
  long_description?: string
  points: number
  ratings: RubricRating[]
}

interface RubricRating {
  id?: string
  description: string
  long_description?: string
  points: number
}

interface RubricData {
  title?: string
  assignment_name?: string
  points_possible?: number
  criteria: RubricCriterion[]
}

export class RubricPreviewPanel {
  public static currentPanel: RubricPreviewPanel | undefined
  private readonly _panel: vscode.WebviewPanel
  private readonly _extensionUri: vscode.Uri
  private _disposables: vscode.Disposable[] = []
  private _currentRubricPath: string = ''
  private _currentAssignmentName: string = ''

  public static createOrShow(extensionUri: vscode.Uri, rubricPath: string, assignmentName: string) {
    const column = vscode.ViewColumn.Two

    // If we already have a panel, show it
    if (RubricPreviewPanel.currentPanel) {
      RubricPreviewPanel.currentPanel._panel.reveal(column)
      RubricPreviewPanel.currentPanel._update(rubricPath, assignmentName)
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
    this._update(rubricPath, assignmentName)

    // Listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables)

    // Watch for file changes
    const fileWatcher = vscode.workspace.createFileSystemWatcher(rubricPath)
    fileWatcher.onDidChange(() => {
      this._update(this._currentRubricPath, this._currentAssignmentName)
    }, null, this._disposables)
    this._disposables.push(fileWatcher)
  }

  private _update(rubricPath: string, assignmentName: string) {
    const webview = this._panel.webview
    this._currentRubricPath = rubricPath
    this._currentAssignmentName = assignmentName
    this._panel.title = `Rubric: ${assignmentName}`

    try {
      const rubricData = this._parseRubricFile(rubricPath)
      this._panel.webview.html = this._getHtmlForWebview(webview, rubricData)
    } catch (error) {
      this._panel.webview.html = this._getErrorHtml(`Failed to load rubric: ${error}`)
    }
  }

  private _parseRubricFile(rubricPath: string): RubricData {
    const content = fs.readFileSync(rubricPath, 'utf8')
    
    // Parse YAML manually (simple parser)
    const lines = content.split('\n')
    const rubric: RubricData = { criteria: [] }
    let currentCriterion: RubricCriterion | null = null
    let inRatings = false

    for (const line of lines) {
      const trimmed = line.trim()
      
      if (trimmed.startsWith('title:') || trimmed.startsWith('assignment_name:')) {
        const value = trimmed.split(':', 2)[1].trim().replace(/^["']|["']$/g, '')
        if (trimmed.startsWith('title:')) rubric.title = value
        if (trimmed.startsWith('assignment_name:')) rubric.assignment_name = value
      } else if (trimmed.startsWith('points_possible:')) {
        rubric.points_possible = parseFloat(trimmed.split(':', 2)[1].trim())
      } else if (trimmed.startsWith('- description:')) {
        // New criterion
        if (currentCriterion) {
          rubric.criteria.push(currentCriterion)
        }
        currentCriterion = {
          description: trimmed.substring(14).trim().replace(/^["']|["']$/g, ''),
          points: 0,
          ratings: []
        }
        inRatings = false
      } else if (currentCriterion && trimmed.startsWith('points:') && !inRatings) {
        currentCriterion.points = parseFloat(trimmed.split(':', 2)[1].trim())
      } else if (currentCriterion && trimmed.startsWith('long_description:') && !inRatings) {
        currentCriterion.long_description = trimmed.split(':', 2)[1].trim().replace(/^["']|["']$/g, '')
      } else if (trimmed === 'ratings:') {
        inRatings = true
      } else if (inRatings && currentCriterion && trimmed.startsWith('- description:')) {
        currentCriterion.ratings.push({
          description: trimmed.substring(14).trim().replace(/^["']|["']$/g, ''),
          points: 0
        })
      } else if (inRatings && currentCriterion && currentCriterion.ratings.length > 0 && trimmed.startsWith('points:')) {
        const lastRating = currentCriterion.ratings[currentCriterion.ratings.length - 1]
        lastRating.points = parseFloat(trimmed.split(':', 2)[1].trim())
      } else if (inRatings && currentCriterion && currentCriterion.ratings.length > 0 && trimmed.startsWith('long_description:')) {
        const lastRating = currentCriterion.ratings[currentCriterion.ratings.length - 1]
        lastRating.long_description = trimmed.split(':', 2)[1].trim().replace(/^["']|["']$/g, '')
      }
    }

    if (currentCriterion) {
      rubric.criteria.push(currentCriterion)
    }

    return rubric
  }

  private _getHtmlForWebview(webview: vscode.Webview, rubricData: RubricData): string {
    const totalPoints = rubricData.points_possible || rubricData.criteria.reduce((sum, c) => sum + c.points, 0)

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Rubric Preview</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            padding: 20px;
            margin: 0;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }
        
        .rubric-header {
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 2px solid var(--vscode-panel-border);
        }
        
        .rubric-title {
            font-size: 24px;
            font-weight: 600;
            margin: 0 0 10px 0;
        }
        
        .rubric-points {
            font-size: 14px;
            color: var(--vscode-descriptionForeground);
        }
        
        .rubric-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
            border: 1px solid var(--vscode-panel-border);
        }
        
        .rubric-table th {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            padding: 12px;
            text-align: left;
            font-weight: 600;
            border: 1px solid var(--vscode-panel-border);
        }
        
        .rubric-table td {
            padding: 12px;
            border: 1px solid var(--vscode-panel-border);
            vertical-align: top;
        }
        
        .criterion-header {
            font-weight: 600;
            margin-bottom: 6px;
        }
        
        .criterion-description {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 8px;
        }
        
        .criterion-points {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            font-weight: 600;
        }
        
        .rating {
            background-color: var(--vscode-editor-background);
            padding: 8px;
            margin-bottom: 6px;
            border-radius: 3px;
            border-left: 3px solid var(--vscode-textLink-foreground);
        }
        
        .rating:last-child {
            margin-bottom: 0;
        }
        
        .rating-header {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            margin-bottom: 4px;
        }
        
        .rating-name {
            font-weight: 500;
        }
        
        .rating-points {
            font-size: 12px;
            font-weight: 600;
            color: var(--vscode-textLink-foreground);
        }
        
        .rating-description {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        
        .empty-state {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="rubric-header">
        <h1 class="rubric-title">${rubricData.title || rubricData.assignment_name || 'Assignment Rubric'}</h1>
        <div class="rubric-points">Total Points: ${totalPoints}</div>
    </div>
    
    ${rubricData.criteria.length === 0 ? `
        <div class="empty-state">
            <p>No criteria defined in this rubric.</p>
        </div>
    ` : `
        <table class="rubric-table">
            <thead>
                <tr>
                    <th style="width: 30%;">Criterion</th>
                    <th style="width: 70%;">Ratings</th>
                </tr>
            </thead>
            <tbody>
                ${rubricData.criteria.map(criterion => `
                    <tr>
                        <td>
                            <div class="criterion-header">${criterion.description}</div>
                            ${criterion.long_description ? `<div class="criterion-description">${criterion.long_description}</div>` : ''}
                            <div class="criterion-points">${criterion.points} pts</div>
                        </td>
                        <td>
                            ${criterion.ratings.map(rating => `
                                <div class="rating">
                                    <div class="rating-header">
                                        <span class="rating-name">${rating.description}</span>
                                        <span class="rating-points">${rating.points} pts</span>
                                    </div>
                                    ${rating.long_description ? `<div class="rating-description">${rating.long_description}</div>` : ''}
                                </div>
                            `).join('')}
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `}
</body>
</html>`
  }

  private _getErrorHtml(error: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Rubric Error</title>
</head>
<body>
    <h1>Error Loading Rubric</h1>
    <p>${error}</p>
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
