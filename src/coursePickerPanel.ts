import * as vscode from 'vscode'

export interface Course {
  id: string
  name: string
  course_code: string
}

export class CoursePickerPanel {
  public static currentPanel: CoursePickerPanel | undefined
  private static readonly viewType = 'canvasCoursePicker'

  private readonly _panel: vscode.WebviewPanel
  private readonly _extensionContext: vscode.ExtensionContext
  private _disposables: vscode.Disposable[] = []
  private _onCourseSelected: ((course: Course) => void) | undefined

  public static createOrShow(
    context: vscode.ExtensionContext,
    courses: Course[],
    onCourseSelected: (course: Course) => void
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined

    // If we already have a panel, update it
    if (CoursePickerPanel.currentPanel) {
      CoursePickerPanel.currentPanel._panel.reveal(column)
      CoursePickerPanel.currentPanel._onCourseSelected = onCourseSelected
      CoursePickerPanel.currentPanel._updateCourses(courses)
      return
    }

    // Create a new panel
    const panel = vscode.window.createWebviewPanel(
      CoursePickerPanel.viewType,
      'Select a Course',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    )

    CoursePickerPanel.currentPanel = new CoursePickerPanel(panel, context, courses, onCourseSelected)
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    courses: Course[],
    onCourseSelected: (course: Course) => void
  ) {
    this._panel = panel
    this._extensionContext = context
    this._onCourseSelected = onCourseSelected

    // Set the webview's initial html content
    this._update(courses)

    // Listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables)

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'selectCourse':
            if (this._onCourseSelected) {
              this._onCourseSelected(message.course)
            }
            this.dispose()
            return
          case 'close':
            this.dispose()
            return
        }
      },
      null,
      this._disposables
    )
  }

  private _updateCourses(courses: Course[]) {
    this._panel.webview.postMessage({ command: 'updateCourses', courses })
  }

  public dispose() {
    CoursePickerPanel.currentPanel = undefined
    this._panel.dispose()
    while (this._disposables.length) {
      const d = this._disposables.pop()
      if (d) {
        d.dispose()
      }
    }
  }

  private _update(courses: Course[]) {
    this._panel.webview.html = this._getHtmlForWebview(courses)
  }

  private _getHtmlForWebview(courses: Course[]): string {
    const nonce = getNonce()
    const coursesJson = JSON.stringify(courses)

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>Select a Course</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px 40px;
            max-width: 800px;
            margin: 0 auto;
        }

        h1 {
            color: var(--vscode-textLink-foreground);
            font-size: 24px;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .icon {
            font-size: 32px;
        }

        .subtitle {
            color: var(--vscode-descriptionForeground);
            margin-bottom: 24px;
            font-size: 14px;
        }

        .search-box {
            margin-bottom: 20px;
        }

        .search-box input {
            width: 100%;
            padding: 10px 14px;
            font-size: 14px;
            font-family: inherit;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
            border-radius: 4px;
            box-sizing: border-box;
        }

        .search-box input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .search-box input::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }

        .course-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .course-item {
            display: flex;
            align-items: center;
            padding: 14px 16px;
            background-color: var(--vscode-list-hoverBackground);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.15s ease;
        }

        .course-item:hover {
            background-color: var(--vscode-list-activeSelectionBackground);
            border-color: var(--vscode-focusBorder);
        }

        .course-item:hover .course-name {
            color: var(--vscode-list-activeSelectionForeground);
        }

        .course-icon {
            font-size: 24px;
            margin-right: 14px;
            opacity: 0.8;
        }

        .course-info {
            flex: 1;
        }

        .course-name {
            font-size: 15px;
            font-weight: 500;
            margin-bottom: 4px;
            color: var(--vscode-foreground);
        }

        .course-code {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        .course-id {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            opacity: 0.7;
        }

        .no-courses {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }

        .no-courses .icon {
            font-size: 48px;
            margin-bottom: 16px;
            opacity: 0.5;
        }

        .loading {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }

        .hidden {
            display: none !important;
        }

        .actions {
            margin-top: 20px;
            display: flex;
            justify-content: flex-end;
        }

        .button {
            padding: 8px 16px;
            font-size: 13px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-family: inherit;
        }

        .button-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .button:hover {
            opacity: 0.9;
        }

        .course-count {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 12px;
        }
    </style>
</head>
<body>
    <h1>
        <span class="icon">📚</span>
        Select a Course
    </h1>
    <p class="subtitle">Choose a course from Canvas to add to your workspace</p>

    <div class="search-box">
        <input type="text" id="searchInput" placeholder="Search courses..." autofocus>
    </div>

    <div class="course-count" id="courseCount"></div>

    <div class="course-list" id="courseList"></div>

    <div class="no-courses hidden" id="noResults">
        <div class="icon">🔍</div>
        <div>No courses match your search</div>
    </div>

    <div class="actions">
        <button class="button button-secondary" id="cancelBtn">Cancel</button>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        let allCourses = ${coursesJson};

        function renderCourses(courses) {
            const list = document.getElementById('courseList');
            const noResults = document.getElementById('noResults');
            const countEl = document.getElementById('courseCount');

            if (courses.length === 0) {
                list.innerHTML = '';
                noResults.classList.remove('hidden');
                countEl.textContent = '';
                return;
            }

            noResults.classList.add('hidden');
            countEl.textContent = courses.length + ' course' + (courses.length !== 1 ? 's' : '') + ' found';

            list.innerHTML = courses.map(course => \`
                <div class="course-item" data-id="\${course.id}" data-name="\${escapeHtml(course.name)}" data-code="\${escapeHtml(course.course_code)}">
                    <span class="course-icon">📖</span>
                    <div class="course-info">
                        <div class="course-name">\${escapeHtml(course.name)}</div>
                        <div class="course-code">\${escapeHtml(course.course_code)}</div>
                    </div>
                    <div class="course-id">ID: \${course.id}</div>
                </div>
            \`).join('');

            // Add click handlers
            list.querySelectorAll('.course-item').forEach(item => {
                item.addEventListener('click', () => {
                    const course = {
                        id: item.dataset.id,
                        name: item.dataset.name,
                        course_code: item.dataset.code
                    };
                    vscode.postMessage({ command: 'selectCourse', course });
                });
            });
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function filterCourses(query) {
            if (!query) {
                return allCourses;
            }
            const lower = query.toLowerCase();
            return allCourses.filter(c => 
                c.name.toLowerCase().includes(lower) || 
                c.course_code.toLowerCase().includes(lower) ||
                c.id.includes(query)
            );
        }

        // Initial render
        renderCourses(allCourses);

        // Search handling
        document.getElementById('searchInput').addEventListener('input', (e) => {
            renderCourses(filterCourses(e.target.value));
        });

        // Cancel button
        document.getElementById('cancelBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'close' });
        });

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'updateCourses') {
                allCourses = message.courses;
                const searchInput = document.getElementById('searchInput');
                renderCourses(filterCourses(searchInput.value));
            }
        });
    </script>
</body>
</html>`
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
