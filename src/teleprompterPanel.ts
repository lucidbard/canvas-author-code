import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'

export class TeleprompterPanel {
  public static currentPanel: TeleprompterPanel | undefined
  private static readonly viewType = 'canvasTeleprompter'

  private readonly _panel: vscode.WebviewPanel
  private readonly _extensionContext: vscode.ExtensionContext
  private _disposables: vscode.Disposable[] = []
  private _courseDirectory: string | undefined

  public static createOrShow(context: vscode.ExtensionContext, courseDirectory?: string) {
    const column = vscode.ViewColumn.Two

    // If we already have a panel, show it
    if (TeleprompterPanel.currentPanel) {
      TeleprompterPanel.currentPanel._panel.reveal(column)
      if (courseDirectory) {
        TeleprompterPanel.currentPanel._courseDirectory = courseDirectory
      }
      return
    }

    // Create a new panel
    const panel = vscode.window.createWebviewPanel(
      TeleprompterPanel.viewType,
      'Teleprompter',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(context.extensionPath, 'media')),
          courseDirectory ? vscode.Uri.file(courseDirectory) : vscode.Uri.file(context.extensionPath)
        ]
      }
    )

    TeleprompterPanel.currentPanel = new TeleprompterPanel(panel, context, courseDirectory)
  }

  public static sendCommand(command: 'start' | 'stop' | 'next' | 'prev' | 'video1' | 'video2') {
    if (TeleprompterPanel.currentPanel) {
      TeleprompterPanel.currentPanel._panel.webview.postMessage({ type: command })
    } else {
      vscode.window.showWarningMessage('Teleprompter is not open. Run "Canvas Author: Open Teleprompter" first.')
    }
  }

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, courseDirectory?: string) {
    this._panel = panel
    this._extensionContext = context
    this._courseDirectory = courseDirectory

    // Set the webview's initial html content
    this._update()

    // Listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables)

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      message => {
        switch (message.type) {
          case 'alert':
            vscode.window.showInformationMessage(message.text)
            return
          case 'error':
            vscode.window.showErrorMessage(message.text)
            return
          case 'save':
            this._saveSlideNotes(message.video, message.slide, message.notes)
            return
        }
      },
      null,
      this._disposables
    )
  }

  private async _saveSlideNotes(video: string, slide: number, notes: string) {
    if (!this._courseDirectory) {
      vscode.window.showErrorMessage('No course directory set for teleprompter')
      return
    }

    const courseMatDir = path.join(this._courseDirectory, 'course-materials')
    const filePath = path.join(courseMatDir, video, `slide-${slide}.txt`)

    try {
      const content = fs.readFileSync(filePath, 'utf8')

      // Replace speaker notes section
      let newContent
      if (content.includes('Speaker Notes:')) {
        const parts = content.split('Speaker Notes:')
        newContent = parts[0] + 'Speaker Notes:\n' + notes
      } else {
        newContent = content + '\n\nSpeaker Notes:\n' + notes
      }

      fs.writeFileSync(filePath, newContent, 'utf8')
      vscode.window.showInformationMessage(`Saved slide ${slide}`)
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to save: ${error}`)
    }
  }

  private _update() {
    this._panel.webview.html = this._getHtmlForWebview()
  }

  private _getHtmlForWebview(): string {
    const teleprompterPath = path.join(this._courseDirectory || '', 'course-materials', 'teleprompter.html')

    // Try to read the teleprompter.html file
    if (fs.existsSync(teleprompterPath)) {
      let html = fs.readFileSync(teleprompterPath, 'utf8')

      // Replace relative paths with webview URIs
      if (this._courseDirectory) {
        const courseMatUri = this._panel.webview.asWebviewUri(
          vscode.Uri.file(path.join(this._courseDirectory, 'course-materials'))
        )

        // Replace fetch paths for slide files
        html = html.replace(/fetch\(`video/g, `fetch(\`${courseMatUri}/video`)

        // Replace image src for slide previews
        html = html.replace(/slidePreviewImg\.src = `video/g, `slidePreviewImg.src = \`${courseMatUri}/video`)
      }

      // Inject message passing for save operations
      html = html.replace(
        /fetch\('\/save-notes'/g,
        `// Use VSCode postMessage instead\n        window.vscode.postMessage({ type: 'save', video: \`video\${currentVideo}\`, slide: currentSlide + 1, notes: notes }); return { ok: true }; // fetch('/save-notes'`
      )

      // Add vscode API
      html = html.replace(
        /<script>/,
        `<script>
        const vscode = acquireVsCodeApi();

        // Listen for commands from extension
        window.addEventListener('message', event => {
          const message = event.data;
          switch (message.type) {
            case 'start':
              if (!isListening) toggleVoice();
              break;
            case 'stop':
              if (isListening) toggleVoice();
              break;
            case 'next':
              nextSlide();
              break;
            case 'prev':
              prevSlide();
              break;
            case 'video1':
              document.getElementById('videoSelector').value = '1';
              document.getElementById('videoSelector').dispatchEvent(new Event('change'));
              break;
            case 'video2':
              document.getElementById('videoSelector').value = '2';
              document.getElementById('videoSelector').dispatchEvent(new Event('change'));
              break;
          }
        });
        </script>
        <script>`
      )

      return html
    }

    // Fallback if file doesn't exist
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Teleprompter</title>
      </head>
      <body>
        <h1>Teleprompter Not Found</h1>
        <p>Could not find teleprompter.html in course-materials directory.</p>
        <p>Expected location: ${teleprompterPath}</p>
      </body>
      </html>
    `
  }

  public dispose() {
    TeleprompterPanel.currentPanel = undefined

    // Clean up resources
    this._panel.dispose()

    while (this._disposables.length) {
      const disposable = this._disposables.pop()
      if (disposable) {
        disposable.dispose()
      }
    }
  }
}
