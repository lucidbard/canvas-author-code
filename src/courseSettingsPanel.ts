import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'

interface CourseSettings {
  course_id?: string
  name?: string
  course_code?: string
  default_view?: string
  published?: boolean
  is_public?: boolean
  is_public_to_auth_users?: boolean
  public_syllabus?: boolean
  public_syllabus_to_auth?: boolean
  allow_student_forum_attachments?: boolean
  allow_student_discussion_editing?: boolean
  allow_student_wiki_edits?: boolean
  start_at?: string
  end_at?: string
  time_zone?: string
  license?: string
  restrict_enrollments_to_course_dates?: boolean
  hide_final_grades?: boolean
  grading_standard_id?: string
  [key: string]: unknown
}

interface FieldDefinition {
  key: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'select' | 'datetime'
  options?: string[]
  hint?: string
  section: 'general' | 'visibility' | 'dates' | 'students' | 'other'
}

export class CourseSettingsPanel {
  public static currentPanel: CourseSettingsPanel | undefined
  private readonly _panel: vscode.WebviewPanel
  private readonly _extensionUri: vscode.Uri
  private _coursePath: string
  private _courseId: string
  private _courseName: string
  private _disposables: vscode.Disposable[] = []

  public static createOrShow(
    extensionUri: vscode.Uri,
    coursePath: string,
    courseId: string,
    courseName: string
  ): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined

    // If panel already exists, show it
    if (CourseSettingsPanel.currentPanel) {
      CourseSettingsPanel.currentPanel._panel.reveal(column)
      CourseSettingsPanel.currentPanel.updateCourse(coursePath, courseId, courseName)
      return
    }

    // Create a new panel
    const panel = vscode.window.createWebviewPanel(
      'courseSettings',
      'Settings: ' + courseName,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri]
      }
    )

    CourseSettingsPanel.currentPanel = new CourseSettingsPanel(
      panel,
      extensionUri,
      coursePath,
      courseId,
      courseName
    )
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    coursePath: string,
    courseId: string,
    courseName: string
  ) {
    this._panel = panel
    this._extensionUri = extensionUri
    this._coursePath = coursePath
    this._courseId = courseId
    this._courseName = courseName

    // Set initial content
    this._updateHtml()

    // Handle panel disposal
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables)

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {
          case 'saveSettings':
            await this._saveSettings(message.settings)
            break
          case 'openYaml':
            await this._openYamlFile()
            break
          case 'refresh':
            this._updateHtml()
            break
        }
      },
      null,
      this._disposables
    )
  }

  private updateCourse(coursePath: string, courseId: string, courseName: string): void {
    this._coursePath = coursePath
    this._courseId = courseId
    this._courseName = courseName
    this._panel.title = 'Settings: ' + courseName
    this._updateHtml()
  }

  private _loadSettings(): CourseSettings {
    const settingsPath = path.join(this._coursePath, 'course.yaml')
    if (!fs.existsSync(settingsPath)) {
      return {
        course_id: this._courseId,
        name: this._courseName
      }
    }

    try {
      const content = fs.readFileSync(settingsPath, 'utf8')
      return this._parseYaml(content)
    } catch (error) {
      console.error('Failed to parse course.yaml:', error)
      return {
        course_id: this._courseId,
        name: this._courseName
      }
    }
  }

  private _parseYaml(content: string): CourseSettings {
    const settings: CourseSettings = {}
    const lines = content.split('\n')
    let currentSection = ''

    for (const line of lines) {
      // Skip comments and empty lines
      if (line.trim().startsWith('#') || !line.trim()) {
        continue
      }

      // Check for top-level section (no indentation)
      const sectionMatch = line.match(/^(\w+):(\s*)$/)
      if (sectionMatch) {
        currentSection = sectionMatch[1]
        continue
      }

      // Check for indented key-value pair (under a section)
      const indentedMatch = line.match(/^(\s+)(\w+):\s*(.*)$/)
      if (indentedMatch) {
        const key = indentedMatch[2]
        let rawValue: string = indentedMatch[3].trim()
        let value: unknown = rawValue

        // Remove quotes if present
        if ((rawValue.startsWith('"') && rawValue.endsWith('"')) ||
          (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
          rawValue = rawValue.slice(1, -1)
          value = rawValue
        }

        // Parse boolean/number/null
        if (rawValue === 'true') value = true
        else if (rawValue === 'false') value = false
        else if (rawValue === 'null' || rawValue === '') value = undefined
        else if (!isNaN(Number(rawValue)) && rawValue !== '') value = Number(rawValue)

        // Store with section prefix for canvas section, flat for settings
        if (currentSection === 'canvas') {
          settings['canvas_' + key] = value
        } else if (currentSection === 'settings') {
          settings[key] = value
        } else if (currentSection === 'sync') {
          settings['sync_' + key] = value
        } else {
          settings[key] = value
        }
        continue
      }

      // Check for flat key-value pair (no indentation, has value)
      const flatMatch = line.match(/^(\w+):\s+(.+)$/)
      if (flatMatch) {
        const key = flatMatch[1]
        let rawValue: string = flatMatch[2].trim()
        let value: unknown = rawValue

        // Remove quotes if present
        if ((rawValue.startsWith('"') && rawValue.endsWith('"')) ||
          (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
          rawValue = rawValue.slice(1, -1)
          value = rawValue
        }

        // Parse boolean/number/null
        if (rawValue === 'true') value = true
        else if (rawValue === 'false') value = false
        else if (rawValue === 'null' || rawValue === '') value = undefined
        else if (!isNaN(Number(rawValue)) && rawValue !== '') value = Number(rawValue)

        settings[key] = value
      }
    }

    return settings
  }

  private _hasNestedStructure(content: string): boolean {
    return content.includes('\ncanvas:') || content.includes('\nsettings:') || content.startsWith('canvas:') || content.startsWith('settings:')
  }

  private async _saveSettings(settings: CourseSettings) {
    const settingsPath = path.join(this._coursePath, 'course.yaml')

    // Check if the existing file uses nested structure
    let useNestedStructure = false
    let existingContent = ''
    if (fs.existsSync(settingsPath)) {
      existingContent = fs.readFileSync(settingsPath, 'utf8')
      useNestedStructure = this._hasNestedStructure(existingContent)
    }

    let content: string
    if (useNestedStructure) {
      content = this._buildNestedYaml(settings, existingContent)
    } else {
      content = this._buildFlatYaml(settings)
    }

    fs.writeFileSync(settingsPath, content)

    vscode.window.showInformationMessage('Course settings saved!')
    this._updateHtml()
  }

  private _buildNestedYaml(settings: CourseSettings, existingContent: string): string {
    const lines: string[] = []
    const existingLines = existingContent.split('\n')
    let currentSection = ''
    let inSettings = false

    for (const line of existingLines) {
      // Check for top-level section
      const sectionMatch = line.match(/^(\w+):(\s*)$/)
      if (sectionMatch) {
        currentSection = sectionMatch[1]
        inSettings = currentSection === 'settings'
        lines.push(line)

        // If entering settings section, write all our settings
        if (inSettings) {
          const fieldDefs = this._getFieldDefinitions()
          for (const field of fieldDefs) {
            const value = settings[field.key]
            if (value !== undefined && value !== null) {
              lines.push('  ' + field.key + ': ' + this._formatYamlValue(value))
            }
          }
        }
        continue
      }

      // Skip existing settings section content (we replaced it above)
      if (inSettings && line.match(/^\s+\w+:/)) {
        continue
      }

      // If we hit another section or non-indented line, we're out of settings
      if (inSettings && line.match(/^\w/) && line.trim()) {
        inSettings = false
      }

      lines.push(line)
    }

    return lines.join('\n')
  }

  private _buildFlatYaml(settings: CourseSettings): string {
    const lines: string[] = [
      '# Course Settings for ' + this._courseName,
      '# This file stores course configuration that can be synced with Canvas',
      ''
    ]

    // Add settings in organized sections
    const sections = this._getFieldDefinitions()
    const sectionOrder: Array<FieldDefinition['section']> = ['general', 'visibility', 'dates', 'students', 'other']
    const sectionLabels: Record<string, string> = {
      general: 'General Settings',
      visibility: 'Visibility Settings',
      dates: 'Dates',
      students: 'Student Permissions',
      other: 'Other Settings'
    }

    for (const section of sectionOrder) {
      const sectionFields = sections.filter(f => f.section === section)
      if (sectionFields.length === 0) continue

      lines.push('# ' + sectionLabels[section])

      for (const field of sectionFields) {
        const value = settings[field.key]
        if (value !== undefined && value !== null && value !== '') {
          lines.push(field.key + ': ' + this._formatYamlValue(value))
        }
      }
      lines.push('')
    }

    // Add any custom fields not in our definitions
    const knownKeys = new Set(sections.map(f => f.key))
    const customEntries = Object.entries(settings).filter(([key]) => !knownKeys.has(key))

    if (customEntries.length > 0) {
      lines.push('# Custom Settings')
      for (const [key, value] of customEntries) {
        if (value !== undefined && value !== null && value !== '') {
          lines.push(key + ': ' + this._formatYamlValue(value))
        }
      }
    }

    return lines.join('\n')
  }

  private _formatYamlValue(value: unknown): string {
    if (typeof value === 'string') {
      // Quote strings with special characters
      if (value.includes(':') || value.includes('#') || value.includes("'") || value.includes('\n')) {
        return '"' + value.replace(/"/g, '\\"') + '"'
      }
      return "'" + value + "'"
    }
    return String(value)
  }

  private async _openYamlFile() {
    const settingsPath = path.join(this._coursePath, 'course.yaml')
    if (fs.existsSync(settingsPath)) {
      const doc = await vscode.workspace.openTextDocument(settingsPath)
      await vscode.window.showTextDocument(doc)
    }
  }

  private _getFieldDefinitions(): FieldDefinition[] {
    return [
      // General
      { key: 'id', label: 'Course ID', type: 'text', hint: 'Canvas course ID (read-only)', section: 'general' },
      { key: 'name', label: 'Course Name', type: 'text', hint: 'Display name of the course', section: 'general' },
      { key: 'course_code', label: 'Course Code', type: 'text', hint: 'Short identifier (e.g., CS101)', section: 'general' },
      { key: 'default_view', label: 'Default View', type: 'select', options: ['modules', 'syllabus', 'assignments', 'feed', 'wiki'], hint: 'Home page view', section: 'general' },
      { key: 'time_zone', label: 'Time Zone', type: 'text', hint: 'e.g., America/New_York', section: 'general' },
      { key: 'license', label: 'License', type: 'select', options: ['private', 'cc_by', 'cc_by_sa', 'cc_by_nc', 'cc_by_nc_sa', 'cc_by_nd', 'cc_by_nc_nd', 'public_domain'], section: 'general' },
      { key: 'workflow_state', label: 'Workflow State', type: 'select', options: ['unpublished', 'available', 'completed', 'deleted'], hint: 'Course publication state', section: 'general' },

      // Visibility
      { key: 'is_public', label: 'Public', type: 'boolean', hint: 'Visible to unauthenticated users', section: 'visibility' },
      { key: 'is_public_to_auth_users', label: 'Public to Authenticated Users', type: 'boolean', hint: 'Visible to authenticated users', section: 'visibility' },
      { key: 'public_syllabus', label: 'Public Syllabus', type: 'boolean', hint: 'Syllabus is public', section: 'visibility' },
      { key: 'public_syllabus_to_auth', label: 'Syllabus to Auth Users', type: 'boolean', hint: 'Syllabus visible to authenticated users', section: 'visibility' },
      { key: 'hide_final_grades', label: 'Hide Final Grades', type: 'boolean', hint: 'Hide final grades from students', section: 'visibility' },

      // Dates
      { key: 'start_at', label: 'Start Date', type: 'datetime', hint: 'Course start date (ISO format)', section: 'dates' },
      { key: 'end_at', label: 'End Date', type: 'datetime', hint: 'Course end date (ISO format)', section: 'dates' },
      { key: 'restrict_enrollments_to_course_dates', label: 'Restrict to Dates', type: 'boolean', hint: 'Restrict access to course dates', section: 'dates' },

      // Student Permissions
      { key: 'allow_student_forum_attachments', label: 'Forum Attachments', type: 'boolean', hint: 'Students can attach files in forums', section: 'students' },
      { key: 'allow_student_discussion_editing', label: 'Discussion Editing', type: 'boolean', hint: 'Students can edit discussions', section: 'students' },
      { key: 'allow_student_wiki_edits', label: 'Wiki Edits', type: 'boolean', hint: 'Students can edit wiki pages', section: 'students' },

      // Other
      { key: 'apply_assignment_group_weights', label: 'Apply Assignment Group Weights', type: 'boolean', hint: 'Weight assignment groups', section: 'other' },
      { key: 'grading_standard_id', label: 'Grading Standard ID', type: 'text', hint: 'Canvas grading standard ID', section: 'other' }
    ]
  }

  private _updateHtml() {
    const settings = this._loadSettings()
    this._panel.webview.html = this._getHtml(settings)
  }

  private _getHtml(settings: CourseSettings): string {
    const nonce = getNonce()
    const fields = this._getFieldDefinitions()

    const sectionOrder: Array<FieldDefinition['section']> = ['general', 'visibility', 'dates', 'students', 'other']
    const sectionLabels: Record<string, string> = {
      general: '📋 General',
      visibility: '👁️ Visibility',
      dates: '📅 Dates',
      students: '👥 Student Permissions',
      other: '⚙️ Other'
    }

    const sectionsHtml = sectionOrder.map(section => {
      const sectionFields = fields.filter(f => f.section === section)
      const fieldsHtml = sectionFields.map(field => this._renderField(field, settings)).join('')

      return `
        <div class="section">
          <div class="section-header">${sectionLabels[section]}</div>
          ${fieldsHtml}
        </div>
      `
    }).join('')

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <style>
        * {
            box-sizing: border-box;
        }
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 20px;
            max-width: 800px;
            margin: 0 auto;
        }
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--vscode-widget-border);
        }
        .header-title {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .header h1 {
            margin: 0;
            font-size: 20px;
            font-weight: 600;
        }
        .header-icon {
            font-size: 24px;
        }
        .header-actions {
            display: flex;
            gap: 8px;
        }
        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            font-family: inherit;
        }
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .section {
            margin-bottom: 24px;
            padding: 16px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 6px;
            border: 1px solid var(--vscode-widget-border);
        }
        .section-header {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 16px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--vscode-widget-border);
        }
        .field-group {
            margin-bottom: 14px;
        }
        .field-row {
            display: grid;
            grid-template-columns: 180px 1fr;
            gap: 12px;
            align-items: start;
        }
        .field-label {
            font-size: 13px;
            color: var(--vscode-foreground);
            padding-top: 8px;
        }
        .field-input-wrapper {
            display: flex;
            flex-direction: column;
        }
        .field-input {
            width: 100%;
            padding: 8px 10px;
            font-size: 13px;
            font-family: inherit;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
            border-radius: 4px;
        }
        .field-input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        .field-input:disabled {
            opacity: 0.7;
            cursor: not-allowed;
        }
        select.field-input {
            cursor: pointer;
        }
        .checkbox-row {
            display: flex;
            align-items: center;
            gap: 8px;
            padding-top: 6px;
        }
        .checkbox-row input[type="checkbox"] {
            width: 18px;
            height: 18px;
            cursor: pointer;
            accent-color: var(--vscode-focusBorder);
        }
        .checkbox-row label {
            cursor: pointer;
            font-size: 13px;
        }
        .hint {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
        }
        .status-bar {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            padding: 12px 20px;
            background: var(--vscode-editor-background);
            border-top: 1px solid var(--vscode-widget-border);
            display: flex;
            justify-content: flex-end;
            gap: 8px;
        }
        .content-wrapper {
            padding-bottom: 60px;
        }
        .yaml-link {
            font-size: 12px;
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
            text-decoration: underline;
        }
        .yaml-link:hover {
            color: var(--vscode-textLink-activeForeground);
        }
    </style>
</head>
<body>
    <div class="content-wrapper">
        <div class="header">
            <div class="header-title">
                <span class="header-icon">⚙️</span>
                <div>
                    <h1>Course Settings</h1>
                    <span class="yaml-link" id="openYaml">Edit raw YAML file</span>
                </div>
            </div>
        </div>

        <form id="settingsForm">
            ${sectionsHtml}
        </form>
    </div>

    <div class="status-bar">
        <button type="button" class="btn btn-secondary" id="refreshBtn">Refresh</button>
        <button type="button" class="btn btn-primary" id="saveBtn">Save Settings</button>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        function collectSettings() {
            const settings = {};
            document.querySelectorAll('.field-input').forEach(input => {
                const key = input.dataset.key;
                let value;
                
                if (input.type === 'checkbox') {
                    value = input.checked;
                } else if (input.type === 'number') {
                    value = input.value ? parseFloat(input.value) : undefined;
                } else {
                    value = input.value || undefined;
                }
                
                if (value !== undefined) {
                    settings[key] = value;
                }
            });
            return settings;
        }

        document.getElementById('saveBtn').addEventListener('click', () => {
            const settings = collectSettings();
            vscode.postMessage({ command: 'saveSettings', settings });
        });

        document.getElementById('refreshBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'refresh' });
        });

        document.getElementById('openYaml').addEventListener('click', () => {
            vscode.postMessage({ command: 'openYaml' });
        });

        // Enable save with Ctrl+S
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                const settings = collectSettings();
                vscode.postMessage({ command: 'saveSettings', settings });
            }
        });
    </script>
</body>
</html>`
  }

  private _renderField(field: FieldDefinition, settings: CourseSettings): string {
    const value = settings[field.key]
    const hintHtml = field.hint ? `<div class="hint">${escapeHtml(field.hint)}</div>` : ''
    const isReadOnly = field.key === 'course_id'

    switch (field.type) {
      case 'boolean':
        return `
          <div class="field-group">
            <div class="field-row">
              <div class="field-label"></div>
              <div class="field-input-wrapper">
                <div class="checkbox-row">
                  <input type="checkbox" class="field-input" data-key="${field.key}" 
                         id="field-${field.key}" ${value ? 'checked' : ''}>
                  <label for="field-${field.key}">${escapeHtml(field.label)}</label>
                </div>
                ${hintHtml}
              </div>
            </div>
          </div>`

      case 'select':
        const options = (field.options || []).map(opt =>
          `<option value="${opt}" ${value === opt ? 'selected' : ''}>${opt}</option>`
        ).join('')
        return `
          <div class="field-group">
            <div class="field-row">
              <div class="field-label">${escapeHtml(field.label)}</div>
              <div class="field-input-wrapper">
                <select class="field-input" data-key="${field.key}">
                  <option value="">-- Select --</option>
                  ${options}
                </select>
                ${hintHtml}
              </div>
            </div>
          </div>`

      case 'number':
        return `
          <div class="field-group">
            <div class="field-row">
              <div class="field-label">${escapeHtml(field.label)}</div>
              <div class="field-input-wrapper">
                <input type="number" class="field-input" data-key="${field.key}" 
                       value="${value ?? ''}">
                ${hintHtml}
              </div>
            </div>
          </div>`

      case 'datetime':
        return `
          <div class="field-group">
            <div class="field-row">
              <div class="field-label">${escapeHtml(field.label)}</div>
              <div class="field-input-wrapper">
                <input type="datetime-local" class="field-input" data-key="${field.key}" 
                       value="${this._formatDatetimeLocal(String(value ?? ''))}">
                ${hintHtml}
              </div>
            </div>
          </div>`

      default:
        return `
          <div class="field-group">
            <div class="field-row">
              <div class="field-label">${escapeHtml(field.label)}</div>
              <div class="field-input-wrapper">
                <input type="text" class="field-input" data-key="${field.key}" 
                       value="${escapeHtml(String(value ?? ''))}" ${isReadOnly ? 'disabled' : ''}>
                ${hintHtml}
              </div>
            </div>
          </div>`
    }
  }

  private _formatDatetimeLocal(isoString: string): string {
    if (!isoString) return ''
    try {
      const date = new Date(isoString)
      if (isNaN(date.getTime())) return ''
      return date.toISOString().slice(0, 16)
    } catch {
      return ''
    }
  }

  public dispose() {
    CourseSettingsPanel.currentPanel = undefined
    this._panel.dispose()
    while (this._disposables.length) {
      const disposable = this._disposables.pop()
      if (disposable) {
        disposable.dispose()
      }
    }
  }
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
