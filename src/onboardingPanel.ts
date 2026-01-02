import * as vscode from 'vscode'

export class OnboardingPanel {
  public static currentPanel: OnboardingPanel | undefined
  private static readonly viewType = 'canvasOnboarding';

  private readonly _panel: vscode.WebviewPanel
  private readonly _extensionContext: vscode.ExtensionContext
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(context: vscode.ExtensionContext, message?: string) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined

    // If we already have a panel, show it
    if (OnboardingPanel.currentPanel) {
      OnboardingPanel.currentPanel._panel.reveal(column)
      if (message) {
        OnboardingPanel.currentPanel._updateMessage(message)
      }
      return
    }

    // Create a new panel
    const panel = vscode.window.createWebviewPanel(
      OnboardingPanel.viewType,
      'Connect to Canvas',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    )

    OnboardingPanel.currentPanel = new OnboardingPanel(panel, context, message)
  }

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, message?: string) {
    this._panel = panel
    this._extensionContext = context

    // Set the webview's initial html content
    this._update(message)

    // Listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables)

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'saveCredentials':
            // Save domain to settings
            await vscode.workspace.getConfiguration('canvas-author').update('canvasDomain', message.domain, true)
            // Save token to secret storage
            await context.secrets.store('canvas-author.apiToken', message.token)
            // Update context
            await vscode.commands.executeCommand('setContext', 'canvas-author.hasToken', true)
            // Notify webview of success
            this._panel.webview.postMessage({ command: 'configured' })
            // Refresh the tree and recreate MCP client via command
            await vscode.commands.executeCommand('canvas-author.refreshCourses')
            // Show success message
            vscode.window.showInformationMessage('Canvas connection configured! You can now import courses from Canvas.')
            // Close the panel after a brief delay to show success
            setTimeout(() => this.dispose(), 1500)
            return
          case 'createLocal':
            await vscode.commands.executeCommand('canvas-author.createLocalCourse')
            this.dispose()
            return
          case 'learnMore':
            vscode.env.openExternal(vscode.Uri.parse('https://community.canvaslms.com/t5/Admin-Guide/How-do-I-manage-API-access-tokens-as-an-admin/ta-p/89'))
            return
          case 'openCanvasSettings':
            // Open the user's Canvas settings page
            if (message.domain) {
              const url = `https://${message.domain}/profile/settings`
              vscode.env.openExternal(vscode.Uri.parse(url))
            }
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

  private _updateMessage(message: string) {
    this._panel.webview.postMessage({ command: 'updateMessage', message })
  }

  public dispose() {
    OnboardingPanel.currentPanel = undefined
    this._panel.dispose()
    while (this._disposables.length) {
      const d = this._disposables.pop()
      if (d) {
        d.dispose()
      }
    }
  }

  private async _update(contextMessage?: string) {
    const webview = this._panel.webview
    const domain = vscode.workspace.getConfiguration('canvas-author').get<string>('canvasDomain') || ''

    this._panel.webview.html = this._getHtmlForWebview(webview, domain, contextMessage)
  }

  private _getHtmlForWebview(webview: vscode.Webview, existingDomain: string, contextMessage?: string): string {
    const nonce = getNonce()

    const messageHtml = contextMessage
      ? `<div class="context-message">${escapeHtml(contextMessage)}</div>`
      : ''

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>Connect to Canvas</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px 40px;
            max-width: 600px;
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

        .context-message {
            background-color: var(--vscode-inputValidation-infoBackground);
            border: 1px solid var(--vscode-inputValidation-infoBorder);
            color: var(--vscode-inputValidation-infoForeground);
            padding: 12px 16px;
            border-radius: 4px;
            margin-bottom: 24px;
            font-size: 13px;
        }

        .success-message {
            background-color: var(--vscode-testing-iconPassed);
            color: var(--vscode-editor-background);
            padding: 12px 16px;
            border-radius: 4px;
            margin-bottom: 24px;
            font-size: 14px;
            display: none;
            align-items: center;
            gap: 8px;
        }

        .success-message.show {
            display: flex;
        }

        .section {
            margin-bottom: 32px;
        }

        .section-title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 12px;
            color: var(--vscode-foreground);
        }

        .section-desc {
            color: var(--vscode-descriptionForeground);
            font-size: 13px;
            margin-bottom: 16px;
            line-height: 1.5;
        }

        .button {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 10px 20px;
            font-size: 14px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-family: inherit;
            transition: opacity 0.2s;
        }

        .button:hover {
            opacity: 0.9;
        }

        .button-primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .button-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .button-link {
            background: none;
            color: var(--vscode-textLink-foreground);
            padding: 0;
            text-decoration: underline;
        }

        .button-link:hover {
            color: var(--vscode-textLink-activeForeground);
        }

        .divider {
            display: flex;
            align-items: center;
            margin: 32px 0;
            color: var(--vscode-descriptionForeground);
        }

        .divider::before,
        .divider::after {
            content: '';
            flex: 1;
            border-bottom: 1px solid var(--vscode-widget-border);
        }

        .divider span {
            padding: 0 16px;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .steps {
            list-style: none;
            padding: 0;
            margin: 0 0 20px 0;
        }

        .steps li {
            display: flex;
            align-items: flex-start;
            gap: 12px;
            margin-bottom: 12px;
            font-size: 13px;
            line-height: 1.5;
        }

        .step-number {
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            width: 24px;
            height: 24px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: 600;
            flex-shrink: 0;
        }

        .step-content {
            padding-top: 2px;
        }

        code {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 2px 6px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
        }

        .actions {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }

        .hidden {
            display: none;
        }

        .form-group {
            margin-bottom: 16px;
        }

        .form-group label {
            display: block;
            margin-bottom: 6px;
            font-size: 13px;
            font-weight: 500;
        }

        .form-group input {
            width: 100%;
            padding: 8px 12px;
            font-size: 14px;
            font-family: inherit;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
            border-radius: 4px;
            box-sizing: border-box;
        }

        .form-group input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .form-group input::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }

        .form-group .hint {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
        }

        .error-message {
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            color: var(--vscode-inputValidation-errorForeground);
            padding: 8px 12px;
            border-radius: 4px;
            margin-bottom: 16px;
            font-size: 13px;
            display: none;
        }

        .error-message.show {
            display: block;
        }
    </style>
</head>
<body>
    <h1>
        <span class="icon">📚</span>
        Canvas Author
    </h1>
    <p class="subtitle">Create and manage Canvas LMS content from VS Code</p>

    ${messageHtml}

    <div class="success-message" id="successMessage">
        ✓ Connected to Canvas successfully!
    </div>

    <div class="section" id="connectSection">
        <div class="section-title">Connect to Canvas LMS</div>
        <p class="section-desc">
            To sync content with Canvas, you'll need to connect your account using an API token.
        </p>

        <div class="error-message" id="errorMessage"></div>

        <div class="form-group">
            <label for="domainInput">Canvas Domain</label>
            <input type="text" id="domainInput" placeholder="myschool.instructure.com" value="${escapeHtml(existingDomain)}">
            <div class="hint">Your Canvas instance URL (without https://)</div>
        </div>

        <div class="form-group">
            <label for="tokenInput">API Token</label>
            <input type="password" id="tokenInput" placeholder="Paste your Canvas API token here">
            <div class="hint">
                <button class="button button-link" id="openCanvasBtn" style="font-size: 12px;">
                    Open Canvas Settings to generate a token →
                </button>
            </div>
        </div>

        <details style="margin-bottom: 20px;">
            <summary style="cursor: pointer; color: var(--vscode-descriptionForeground); font-size: 13px;">
                How to get an API token
            </summary>
            <ol class="steps" style="margin-top: 12px;">
                <li>
                    <span class="step-number">1</span>
                    <span class="step-content">
                        Log into your Canvas instance and go to <strong>Account → Settings</strong>
                    </span>
                </li>
                <li>
                    <span class="step-number">2</span>
                    <span class="step-content">
                        Scroll to <strong>Approved Integrations</strong> and click <strong>+ New Access Token</strong>
                    </span>
                </li>
                <li>
                    <span class="step-number">3</span>
                    <span class="step-content">
                        Give it a name like <code>Canvas Author</code> and generate the token
                    </span>
                </li>
                <li>
                    <span class="step-number">4</span>
                    <span class="step-content">
                        Copy the token and paste it above (you won't be able to see it again!)
                    </span>
                </li>
            </ol>
        </details>

        <div class="actions">
            <button class="button button-primary" id="saveBtn">
                Connect to Canvas
            </button>
            <button class="button button-link" id="learnMoreBtn">
                Learn more about API tokens
            </button>
        </div>
    </div>

    <div class="divider"><span>or</span></div>

    <div class="section">
        <div class="section-title">Work Offline</div>
        <p class="section-desc">
            You can create courses locally without a Canvas connection.
            Author your content in markdown and sync to Canvas later when you're ready.
        </p>

        <div class="actions">
            <button class="button button-secondary" id="createLocalBtn">
                Create Local Course
            </button>
        </div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        const domainInput = document.getElementById('domainInput');
        const tokenInput = document.getElementById('tokenInput');
        const saveBtn = document.getElementById('saveBtn');
        const errorMessage = document.getElementById('errorMessage');

        saveBtn.addEventListener('click', () => {
            const domain = domainInput.value.trim();
            const token = tokenInput.value.trim();

            // Validate inputs
            if (!domain) {
                showError('Please enter your Canvas domain');
                domainInput.focus();
                return;
            }

            if (!token) {
                showError('Please enter your API token');
                tokenInput.focus();
                return;
            }

            // Clean up domain (remove https:// if user included it)
            const cleanDomain = domain.replace(/^https?:\\/\\//, '').replace(/\\/$/, '');

            hideError();
            saveBtn.textContent = 'Connecting...';
            saveBtn.disabled = true;

            vscode.postMessage({ 
                command: 'saveCredentials',
                domain: cleanDomain,
                token: token
            });
        });

        document.getElementById('openCanvasBtn').addEventListener('click', () => {
            const domain = domainInput.value.trim().replace(/^https?:\\/\\//, '').replace(/\\/$/, '');
            if (domain) {
                vscode.postMessage({ command: 'openCanvasSettings', domain: domain });
            } else {
                showError('Please enter your Canvas domain first');
                domainInput.focus();
            }
        });

        document.getElementById('createLocalBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'createLocal' });
        });

        document.getElementById('learnMoreBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'learnMore' });
        });

        function showError(msg) {
            errorMessage.textContent = msg;
            errorMessage.classList.add('show');
        }

        function hideError() {
            errorMessage.classList.remove('show');
        }

        // Handle messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'configured':
                    document.getElementById('successMessage').classList.add('show');
                    document.getElementById('connectSection').classList.add('hidden');
                    break;
                case 'updateMessage':
                    const contextDiv = document.querySelector('.context-message');
                    if (contextDiv) {
                        contextDiv.textContent = message.message;
                    }
                    break;
                case 'error':
                    showError(message.message);
                    saveBtn.textContent = 'Connect to Canvas';
                    saveBtn.disabled = false;
                    break;
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

function escapeHtml(text: string): string {
  const map: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }
  return text.replace(/[&<>"']/g, m => map[m])
}
