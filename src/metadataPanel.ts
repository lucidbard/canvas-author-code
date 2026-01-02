import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'

interface FrontmatterData {
  [key: string]: unknown
}

interface DocumentMetadata {
  type: 'page' | 'quiz' | 'assignment' | 'unknown'
  title: string
  filePath: string
  frontmatter: FrontmatterData
  rawContent: string
}

export class MetadataPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'canvasAuthorMetadata'
  private _view?: vscode.WebviewView
  private _currentDocument?: DocumentMetadata
  private _disposables: vscode.Disposable[] = []

  constructor(private readonly _extensionContext: vscode.ExtensionContext) {
    // Listen for active editor changes
    this._disposables.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        this._onActiveEditorChanged(editor)
      })
    )

    // Listen for document saves
    this._disposables.push(
      vscode.workspace.onDidSaveTextDocument(doc => {
        if (vscode.window.activeTextEditor?.document === doc) {
          this._onActiveEditorChanged(vscode.window.activeTextEditor)
        }
      })
    )
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionContext.extensionUri]
    }

    webviewView.webview.onDidReceiveMessage(async message => {
      switch (message.command) {
        case 'updateFrontmatter':
          await this._updateFrontmatter(message.key, message.value)
          break
        case 'addField':
          await this._addFrontmatterField(message.key, message.value)
          break
        case 'removeField':
          await this._removeFrontmatterField(message.key)
          break
      }
    })

    // Initialize with current editor
    this._onActiveEditorChanged(vscode.window.activeTextEditor)
  }

  private async _onActiveEditorChanged(editor?: vscode.TextEditor) {
    if (!editor || !this._view) {
      this._showNoDocument()
      return
    }

    const document = editor.document
    const filePath = document.uri.fsPath

    // Check if it's a markdown file in a canvas course
    if (!filePath.endsWith('.md')) {
      this._showNoDocument()
      return
    }

    // Check if it's in a canvas course folder
    const canvasConfig = this._findCanvasConfig(filePath)
    if (!canvasConfig) {
      this._showNoDocument()
      return
    }

    // Parse the document
    const metadata = this._parseDocument(document)
    this._currentDocument = metadata
    this._updateView(metadata)
  }

  private _findCanvasConfig(filePath: string): string | null {
    let dir = path.dirname(filePath)
    while (dir !== path.dirname(dir)) {
      const configPath = path.join(dir, '.canvas.json')
      if (fs.existsSync(configPath)) {
        return configPath
      }
      dir = path.dirname(dir)
    }
    return null
  }

  private _parseDocument(document: vscode.TextDocument): DocumentMetadata {
    const content = document.getText()
    const filePath = document.uri.fsPath
    const fileName = path.basename(filePath, '.md')

    // Determine type based on path
    let type: DocumentMetadata['type'] = 'unknown'
    if (filePath.includes('/quizzes/') || filePath.includes('\\quizzes\\')) {
      type = 'quiz'
    } else if (filePath.includes('/assignments/') || filePath.includes('\\assignments\\')) {
      type = 'assignment'
    } else {
      type = 'page'
    }

    // Parse YAML frontmatter
    const frontmatter: FrontmatterData = {}
    let title = fileName

    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
    if (frontmatterMatch) {
      const yamlContent = frontmatterMatch[1]
      // Simple YAML parsing for key: value pairs
      const lines = yamlContent.split('\n')
      for (const line of lines) {
        const match = line.match(/^(\w+):\s*(.*)$/)
        if (match) {
          const key = match[1]
          let value: unknown = match[2]

          // Try to parse as boolean/number
          if (value === 'true') value = true
          else if (value === 'false') value = false
          else if (!isNaN(Number(value)) && value !== '') value = Number(value)

          frontmatter[key] = value
          if (key === 'title') title = String(value)
        }
      }
    }

    return {
      type,
      title,
      filePath,
      frontmatter,
      rawContent: content
    }
  }

  private async _updateFrontmatter(key: string, value: unknown) {
    if (!this._currentDocument) return

    const editor = vscode.window.activeTextEditor
    if (!editor || editor.document.uri.fsPath !== this._currentDocument.filePath) return

    const document = editor.document
    const content = document.getText()

    // Update frontmatter
    this._currentDocument.frontmatter[key] = value
    const newContent = this._buildDocumentContent(content, this._currentDocument.frontmatter)

    const edit = new vscode.WorkspaceEdit()
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, document.lineCount, 0),
      newContent
    )
    await vscode.workspace.applyEdit(edit)
  }

  private async _addFrontmatterField(key: string, value: unknown) {
    if (!this._currentDocument) return
    this._currentDocument.frontmatter[key] = value
    await this._updateFrontmatter(key, value)
  }

  private async _removeFrontmatterField(key: string) {
    if (!this._currentDocument) return

    const editor = vscode.window.activeTextEditor
    if (!editor || editor.document.uri.fsPath !== this._currentDocument.filePath) return

    delete this._currentDocument.frontmatter[key]

    const document = editor.document
    const content = document.getText()
    const newContent = this._buildDocumentContent(content, this._currentDocument.frontmatter)

    const edit = new vscode.WorkspaceEdit()
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, document.lineCount, 0),
      newContent
    )
    await vscode.workspace.applyEdit(edit)

    this._updateView(this._currentDocument)
  }

  private _buildDocumentContent(originalContent: string, frontmatter: FrontmatterData): string {
    // Build YAML frontmatter
    const yamlLines = Object.entries(frontmatter).map(([key, value]) => {
      if (typeof value === 'string') {
        // Quote strings with special characters
        if (value.includes(':') || value.includes('#') || value.includes('\n')) {
          return `${key}: "${value.replace(/"/g, '\\"')}"`
        }
        return `${key}: ${value}`
      }
      return `${key}: ${value}`
    })
    const yaml = yamlLines.join('\n')

    // Replace or add frontmatter
    const frontmatterMatch = originalContent.match(/^---\n[\s\S]*?\n---\n?/)
    if (frontmatterMatch) {
      return `---\n${yaml}\n---\n` + originalContent.slice(frontmatterMatch[0].length)
    } else {
      return `---\n${yaml}\n---\n\n` + originalContent
    }
  }

  private _showNoDocument() {
    if (!this._view) return
    this._currentDocument = undefined
    this._view.webview.html = this._getEmptyHtml()
  }

  private _updateView(metadata: DocumentMetadata) {
    if (!this._view) return
    this._view.webview.html = this._getHtml(metadata)
  }

  private _getEmptyHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            padding: 16px;
        }
        .empty {
            text-align: center;
            color: var(--vscode-descriptionForeground);
            margin-top: 40px;
        }
        .icon {
            font-size: 32px;
            margin-bottom: 12px;
        }
    </style>
</head>
<body>
    <div class="empty">
        <div class="icon">📄</div>
        <p>Open a Canvas page, quiz, or assignment to view its metadata.</p>
    </div>
</body>
</html>`
  }

  private _getHtml(metadata: DocumentMetadata): string {
    const nonce = getNonce()
    const typeLabels: Record<string, string> = {
      page: '📄 Page',
      quiz: '❓ Quiz',
      assignment: '📝 Assignment',
      unknown: '📋 Document'
    }

    const typeFields = this._getFieldsForType(metadata.type)
    const fieldsHtml = typeFields.map(field => this._renderField(field, metadata.frontmatter)).join('')

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            padding: 12px;
            font-size: 13px;
        }
        .header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--vscode-widget-border);
        }
        .type-badge {
            font-size: 12px;
            padding: 2px 8px;
            border-radius: 10px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }
        .title {
            font-size: 14px;
            font-weight: 600;
            word-break: break-word;
        }
        .field-group {
            margin-bottom: 14px;
        }
        .field-label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 4px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .field-input {
            width: 100%;
            padding: 6px 8px;
            font-size: 13px;
            font-family: inherit;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
            border-radius: 3px;
            box-sizing: border-box;
        }
        .field-input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        select.field-input {
            cursor: pointer;
        }
        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .checkbox-group input {
            width: 16px;
            height: 16px;
            cursor: pointer;
        }
        .checkbox-group label {
            cursor: pointer;
        }
        .hint {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
        }
        .remove-btn {
            background: none;
            border: none;
            color: var(--vscode-errorForeground);
            cursor: pointer;
            font-size: 14px;
            padding: 0 4px;
            opacity: 0.7;
        }
        .remove-btn:hover {
            opacity: 1;
        }
        .add-field {
            margin-top: 16px;
            padding-top: 12px;
            border-top: 1px solid var(--vscode-widget-border);
        }
        .add-field-btn {
            width: 100%;
            padding: 8px;
            font-size: 12px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
        }
        .add-field-btn:hover {
            opacity: 0.9;
        }
        .custom-fields {
            margin-top: 16px;
            padding-top: 12px;
            border-top: 1px solid var(--vscode-widget-border);
        }
        .section-title {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 12px;
        }
    </style>
</head>
<body>
    <div class="header">
        <span class="type-badge">${typeLabels[metadata.type]}</span>
    </div>
    <div class="title">${escapeHtml(metadata.title)}</div>

    <div style="margin-top: 16px;">
        ${fieldsHtml}
    </div>

    ${this._renderCustomFields(metadata.frontmatter, typeFields)}

    <div class="add-field">
        <button class="add-field-btn" id="addFieldBtn">+ Add Custom Field</button>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        // Handle input changes
        document.querySelectorAll('.field-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const key = e.target.dataset.key;
                let value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
                
                // Parse numbers
                if (e.target.type === 'number') {
                    value = parseFloat(value) || 0;
                }
                
                vscode.postMessage({ command: 'updateFrontmatter', key, value });
            });
        });

        // Handle remove buttons
        document.querySelectorAll('.remove-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.key;
                if (confirm('Remove field "' + key + '"?')) {
                    vscode.postMessage({ command: 'removeField', key });
                }
            });
        });

        // Add field button
        document.getElementById('addFieldBtn').addEventListener('click', () => {
            const key = prompt('Enter field name:');
            if (key && key.trim()) {
                const value = prompt('Enter value:');
                vscode.postMessage({ command: 'addField', key: key.trim(), value: value || '' });
            }
        });
    </script>
</body>
</html>`
  }

  private _getFieldsForType(type: DocumentMetadata['type']): FieldDefinition[] {
    const commonFields: FieldDefinition[] = [
      { key: 'title', label: 'Title', type: 'text', hint: 'Display title' },
      { key: 'published', label: 'Published', type: 'boolean', hint: 'Visible to students' }
    ]

    switch (type) {
      case 'page':
        return [
          ...commonFields,
          { key: 'editing_roles', label: 'Editing Roles', type: 'select', options: ['teachers', 'students', 'members', 'public'] },
          { key: 'front_page', label: 'Front Page', type: 'boolean', hint: 'Set as course home page' }
        ]
      case 'quiz':
        return [
          ...commonFields,
          { key: 'quiz_type', label: 'Quiz Type', type: 'select', options: ['practice_quiz', 'graded_quiz', 'survey', 'graded_survey'] },
          { key: 'time_limit', label: 'Time Limit (min)', type: 'number' },
          { key: 'points_possible', label: 'Points', type: 'number' },
          { key: 'shuffle_answers', label: 'Shuffle Answers', type: 'boolean' },
          { key: 'allowed_attempts', label: 'Allowed Attempts', type: 'number', hint: '-1 for unlimited' },
          { key: 'show_correct_answers', label: 'Show Answers', type: 'boolean' }
        ]
      case 'assignment':
        return [
          ...commonFields,
          { key: 'points_possible', label: 'Points', type: 'number' },
          { key: 'due_at', label: 'Due Date', type: 'text', hint: 'ISO format: 2024-01-15T23:59:00Z' },
          { key: 'submission_types', label: 'Submission Types', type: 'text', hint: 'online_upload, online_text_entry, etc.' },
          { key: 'grading_type', label: 'Grading Type', type: 'select', options: ['points', 'percent', 'letter_grade', 'gpa_scale', 'pass_fail', 'not_graded'] }
        ]
      default:
        return commonFields
    }
  }

  private _renderField(field: FieldDefinition, frontmatter: FrontmatterData): string {
    const value = frontmatter[field.key]
    const hintHtml = field.hint ? `<div class="hint">${escapeHtml(field.hint)}</div>` : ''

    switch (field.type) {
      case 'boolean':
        return `
          <div class="field-group">
            <div class="checkbox-group">
              <input type="checkbox" class="field-input" data-key="${field.key}" 
                     id="field-${field.key}" ${value ? 'checked' : ''}>
              <label for="field-${field.key}">${escapeHtml(field.label)}</label>
            </div>
            ${hintHtml}
          </div>`

      case 'select':
        const options = (field.options || []).map(opt =>
          `<option value="${opt}" ${value === opt ? 'selected' : ''}>${opt}</option>`
        ).join('')
        return `
          <div class="field-group">
            <div class="field-label">${escapeHtml(field.label)}</div>
            <select class="field-input" data-key="${field.key}">
              <option value="">-- Select --</option>
              ${options}
            </select>
            ${hintHtml}
          </div>`

      case 'number':
        return `
          <div class="field-group">
            <div class="field-label">${escapeHtml(field.label)}</div>
            <input type="number" class="field-input" data-key="${field.key}" 
                   value="${value ?? ''}">
            ${hintHtml}
          </div>`

      default:
        return `
          <div class="field-group">
            <div class="field-label">${escapeHtml(field.label)}</div>
            <input type="text" class="field-input" data-key="${field.key}" 
                   value="${escapeHtml(String(value ?? ''))}">
            ${hintHtml}
          </div>`
    }
  }

  private _renderCustomFields(frontmatter: FrontmatterData, typeFields: FieldDefinition[]): string {
    const standardKeys = new Set(typeFields.map(f => f.key))
    const customEntries = Object.entries(frontmatter).filter(([key]) => !standardKeys.has(key))

    if (customEntries.length === 0) return ''

    const fieldsHtml = customEntries.map(([key, value]) => `
      <div class="field-group">
        <div class="field-label">
          ${escapeHtml(key)}
          <button class="remove-btn" data-key="${key}" title="Remove field">×</button>
        </div>
        <input type="text" class="field-input" data-key="${key}" 
               value="${escapeHtml(String(value ?? ''))}">
      </div>
    `).join('')

    return `
      <div class="custom-fields">
        <div class="section-title">Custom Fields</div>
        ${fieldsHtml}
      </div>`
  }

  dispose() {
    this._disposables.forEach(d => d.dispose())
  }
}

interface FieldDefinition {
  key: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'select'
  options?: string[]
  hint?: string
}

function getNonce(): string {
  let text = ''
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }
  return text
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }
  return text.replace(/[&<>"']/g, m => map[m])
}
