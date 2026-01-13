import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import * as yaml from 'js-yaml'

interface ModuleItem {
  title?: string
  type?: string
  page_url?: string
  url?: string
  content_id?: string
  indent?: number
  position?: number
}

interface Module {
  name: string
  published?: boolean
  position?: number
  unlock_at?: string | null
  require_sequential_progress?: boolean
  items?: ModuleItem[]
}

interface ModulesData {
  modules: Module[]
}

export class ModuleEditorPanel {
  public static currentPanel: ModuleEditorPanel | undefined
  private readonly _panel: vscode.WebviewPanel
  private readonly _extensionUri: vscode.Uri
  private _modulesPath: string
  private _courseName: string
  private _disposables: vscode.Disposable[] = []

  public static createOrShow(extensionUri: vscode.Uri, modulesPath: string, courseName: string): void {
    const column = vscode.ViewColumn.One

    if (ModuleEditorPanel.currentPanel) {
      ModuleEditorPanel.currentPanel._panel.reveal(column)
      ModuleEditorPanel.currentPanel.updateModules(modulesPath, courseName)
      return
    }

    const panel = vscode.window.createWebviewPanel(
      'moduleEditor',
      'Modules: ' + courseName,
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri]
      }
    )

    ModuleEditorPanel.currentPanel = new ModuleEditorPanel(panel, extensionUri, modulesPath, courseName)
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    modulesPath: string,
    courseName: string
  ) {
    this._panel = panel
    this._extensionUri = extensionUri
    this._modulesPath = modulesPath
    this._courseName = courseName

    this._updateHtml()

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables)

    this._panel.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {
          case 'save':
            await this._saveModules(message.data)
            break
          case 'refresh':
            this._updateHtml()
            break
          case 'openFile':
            await this._openModulesFile()
            break
        }
      },
      null,
      this._disposables
    )
  }

  public updateModules(modulesPath: string, courseName: string): void {
    this._modulesPath = modulesPath
    this._courseName = courseName
    this._panel.title = 'Modules: ' + courseName
    this._updateHtml()
  }

  private async _openModulesFile(): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(this._modulesPath)
    await vscode.window.showTextDocument(doc)
  }

  private async _saveModules(data: ModulesData): Promise<void> {
    try {
      const yamlContent = yaml.dump(data, {
        lineWidth: -1,
        noRefs: true,
        sortKeys: false
      })
      fs.writeFileSync(this._modulesPath, yamlContent, 'utf8')
      vscode.window.showInformationMessage('Modules saved successfully!')
      this._updateHtml()
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to save modules: ${error}`)
    }
  }

  private _updateHtml(): void {
    const modulesData = this._loadModules()
    this._panel.webview.html = this._getHtml(modulesData)
  }

  private _loadModules(): ModulesData {
    if (!fs.existsSync(this._modulesPath)) {
      return { modules: [] }
    }

    try {
      const content = fs.readFileSync(this._modulesPath, 'utf8')
      const data = yaml.load(content) as ModulesData
      return data || { modules: [] }
    } catch (error) {
      console.error('Failed to load modules:', error)
      return { modules: [] }
    }
  }

  private _getHtml(data: ModulesData): string {
    const nonce = getNonce()

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 20px;
            margin: 0;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .title {
            font-size: 18px;
            font-weight: 600;
        }
        .actions {
            display: flex;
            gap: 8px;
        }
        .btn {
            padding: 6px 12px;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 13px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .modules-container {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        .module {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            background: var(--vscode-editor-background);
        }
        .module.dragging {
            opacity: 0.5;
        }
        .module-header {
            display: flex;
            align-items: center;
            padding: 12px;
            background: var(--vscode-sideBar-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            cursor: move;
        }
        .module-header:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .drag-handle {
            margin-right: 8px;
            cursor: grab;
            opacity: 0.5;
        }
        .drag-handle:active {
            cursor: grabbing;
        }
        .module-name {
            flex: 1;
            font-weight: 500;
            outline: none;
            background: transparent;
            border: 1px solid transparent;
            color: var(--vscode-foreground);
            padding: 4px;
            border-radius: 3px;
        }
        .module-name:hover, .module-name:focus {
            border-color: var(--vscode-focusBorder);
        }
        .module-published {
            margin-left: 8px;
        }
        .module-actions {
            display: flex;
            gap: 4px;
            margin-left: 8px;
        }
        .icon-btn {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 3px;
        }
        .icon-btn:hover {
            background: var(--vscode-toolbar-hoverBackground);
        }
        .module-items {
            padding: 8px;
            min-height: 40px;
        }
        .module-item {
            display: flex;
            align-items: center;
            padding: 8px;
            margin: 4px 0;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            cursor: move;
        }
        .module-item:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .module-item.dragging {
            opacity: 0.5;
        }
        .item-indent {
            display: flex;
            gap: 4px;
            margin-right: 8px;
        }
        .indent-btn {
            width: 20px;
            height: 20px;
            padding: 0;
            font-size: 11px;
        }
        .item-type {
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 11px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            margin-right: 8px;
            min-width: 70px;
            text-align: center;
        }
        .item-title {
            flex: 1;
            outline: none;
            background: transparent;
            border: 1px solid transparent;
            color: var(--vscode-foreground);
            padding: 4px;
            border-radius: 3px;
        }
        .item-title:hover, .item-title:focus {
            border-color: var(--vscode-focusBorder);
        }
        .add-item-btn {
            width: 100%;
            padding: 8px;
            margin-top: 8px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px dashed var(--vscode-panel-border);
            border-radius: 3px;
            cursor: pointer;
        }
        .add-item-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .add-module-btn {
            width: 100%;
            padding: 12px;
            margin-top: 16px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px dashed var(--vscode-panel-border);
            border-radius: 3px;
            cursor: pointer;
            font-size: 14px;
        }
        .add-module-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .dropdown {
            padding: 4px 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            margin-right: 8px;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="title">Module Editor - ${escapeHtml(this._courseName)}</div>
        <div class="actions">
            <button class="btn btn-secondary" onclick="openFile()">Open YAML</button>
            <button class="btn btn-secondary" onclick="refresh()">Refresh</button>
            <button class="btn" onclick="saveModules()">Save</button>
        </div>
    </div>

    <div class="modules-container" id="modulesContainer">
        <!-- Modules will be rendered by JavaScript -->
    </div>

    <button class="add-module-btn" onclick="addModule()">+ Add Module</button>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        let modulesData = ${JSON.stringify(data.modules)};

        // Drag and drop for modules
        let draggedModuleIndex = null;
        let draggedItemIndex = null;
        let draggedFromModule = null;

        function initDragAndDrop() {
            const modules = document.querySelectorAll('.module');
            modules.forEach((module, index) => {
                const header = module.querySelector('.module-header');
                header.addEventListener('dragstart', (e) => {
                    draggedModuleIndex = index;
                    module.classList.add('dragging');
                    e.dataTransfer.effectAllowed = 'move';
                });
                header.addEventListener('dragend', () => {
                    module.classList.remove('dragging');
                    draggedModuleIndex = null;
                });
                header.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    if (draggedModuleIndex !== null && draggedModuleIndex !== index) {
                        const rect = module.getBoundingClientRect();
                        const midpoint = rect.top + rect.height / 2;
                        if (e.clientY < midpoint) {
                            module.style.borderTop = '2px solid var(--vscode-focusBorder)';
                            module.style.borderBottom = '';
                        } else {
                            module.style.borderBottom = '2px solid var(--vscode-focusBorder)';
                            module.style.borderTop = '';
                        }
                    }
                });
                header.addEventListener('dragleave', () => {
                    module.style.borderTop = '';
                    module.style.borderBottom = '';
                });
                header.addEventListener('drop', (e) => {
                    e.preventDefault();
                    module.style.borderTop = '';
                    module.style.borderBottom = '';
                    
                    if (draggedModuleIndex !== null && draggedModuleIndex !== index) {
                        const rect = module.getBoundingClientRect();
                        const midpoint = rect.top + rect.height / 2;
                        const targetIndex = e.clientY < midpoint ? index : index + 1;
                        
                        const [movedModule] = modulesData.splice(draggedModuleIndex, 1);
                        const newIndex = draggedModuleIndex < targetIndex ? targetIndex - 1 : targetIndex;
                        modulesData.splice(newIndex, 0, movedModule);
                        
                        renderModules();
                    }
                });
            });

            // Drag and drop for items
            const items = document.querySelectorAll('.module-item');
            items.forEach((item) => {
                const moduleIndex = parseInt(item.dataset.moduleIndex);
                const itemIndex = parseInt(item.dataset.itemIndex);
                
                item.addEventListener('dragstart', (e) => {
                    draggedFromModule = moduleIndex;
                    draggedItemIndex = itemIndex;
                    item.classList.add('dragging');
                    e.dataTransfer.effectAllowed = 'move';
                });
                item.addEventListener('dragend', () => {
                    item.classList.remove('dragging');
                    draggedItemIndex = null;
                    draggedFromModule = null;
                });
                item.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    if (draggedItemIndex !== null && draggedFromModule === moduleIndex) {
                        const rect = item.getBoundingClientRect();
                        const midpoint = rect.top + rect.height / 2;
                        if (e.clientY < midpoint) {
                            item.style.borderTop = '2px solid var(--vscode-focusBorder)';
                            item.style.borderBottom = '';
                        } else {
                            item.style.borderBottom = '2px solid var(--vscode-focusBorder)';
                            item.style.borderTop = '';
                        }
                    }
                });
                item.addEventListener('dragleave', () => {
                    item.style.borderTop = '';
                    item.style.borderBottom = '';
                });
                item.addEventListener('drop', (e) => {
                    e.preventDefault();
                    item.style.borderTop = '';
                    item.style.borderBottom = '';
                    
                    if (draggedItemIndex !== null && draggedFromModule === moduleIndex && draggedItemIndex !== itemIndex) {
                        const rect = item.getBoundingClientRect();
                        const midpoint = rect.top + rect.height / 2;
                        const targetIndex = e.clientY < midpoint ? itemIndex : itemIndex + 1;
                        
                        const items = modulesData[moduleIndex].items;
                        const [movedItem] = items.splice(draggedItemIndex, 1);
                        const newIndex = draggedItemIndex < targetIndex ? targetIndex - 1 : targetIndex;
                        items.splice(newIndex, 0, movedItem);
                        
                        renderModules();
                    }
                });
            });
        }

        function renderModules() {
            const container = document.getElementById('modulesContainer');
            container.innerHTML = modulesData.map((module, moduleIndex) => \`
                <div class="module" draggable="true">
                    <div class="module-header">
                        <span class="drag-handle">⋮⋮</span>
                        <input 
                            type="text" 
                            class="module-name" 
                            value="\${escapeHtml(module.name)}"
                            onchange="updateModuleName(\${moduleIndex}, this.value)"
                        />
                        <label class="module-published">
                            <input 
                                type="checkbox" 
                                \${module.published ? 'checked' : ''}
                                onchange="toggleModulePublished(\${moduleIndex})"
                            />
                            Published
                        </label>
                        <div class="module-actions">
                            <button class="icon-btn" onclick="moveModule(\${moduleIndex}, -1)" title="Move Up">↑</button>
                            <button class="icon-btn" onclick="moveModule(\${moduleIndex}, 1)" title="Move Down">↓</button>
                            <button class="icon-btn" onclick="deleteModule(\${moduleIndex})" title="Delete">🗑</button>
                        </div>
                    </div>
                    <div class="module-items">
                        \${(module.items || []).map((item, itemIndex) => \`
                            <div class="module-item" draggable="true" data-module-index="\${moduleIndex}" data-item-index="\${itemIndex}">
                                <span class="drag-handle">⋮</span>
                                <div class="item-indent">
                                    <button class="icon-btn indent-btn" onclick="changeIndent(\${moduleIndex}, \${itemIndex}, -1)" title="Outdent">←</button>
                                    <button class="icon-btn indent-btn" onclick="changeIndent(\${moduleIndex}, \${itemIndex}, 1)" title="Indent">→</button>
                                </div>
                                <select class="dropdown item-type" onchange="updateItemType(\${moduleIndex}, \${itemIndex}, this.value)">
                                    <option value="Page" \${item.type === 'Page' ? 'selected' : ''}>Page</option>
                                    <option value="SubHeader" \${item.type === 'SubHeader' ? 'selected' : ''}>SubHeader</option>
                                    <option value="Assignment" \${item.type === 'Assignment' ? 'selected' : ''}>Assignment</option>
                                    <option value="Quiz" \${item.type === 'Quiz' ? 'selected' : ''}>Quiz</option>
                                    <option value="Discussion" \${item.type === 'Discussion' ? 'selected' : ''}>Discussion</option>
                                    <option value="ExternalUrl" \${item.type === 'ExternalUrl' ? 'selected' : ''}>External URL</option>
                                    <option value="File" \${item.type === 'File' ? 'selected' : ''}>File</option>
                                </select>
                                <input 
                                    type="text" 
                                    class="item-title" 
                                    value="\${escapeHtml(item.title || item.page_url || '')}"
                                    onchange="updateItemTitle(\${moduleIndex}, \${itemIndex}, this.value)"
                                    placeholder="Item title"
                                />
                                <span style="margin-left: 8px; opacity: 0.7; font-size: 11px;">Indent: \${item.indent || 0}</span>
                                <div class="module-actions">
                                    <button class="icon-btn" onclick="deleteItem(\${moduleIndex}, \${itemIndex})" title="Delete">🗑</button>
                                </div>
                            </div>
                        \`).join('')}
                        <button class="add-item-btn" onclick="addItem(\${moduleIndex})">+ Add Item</button>
                    </div>
                </div>
            \`).join('');
            
            initDragAndDrop();
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function addModule() {
            modulesData.push({
                name: 'New Module',
                published: false,
                items: []
            });
            renderModules();
        }

        function deleteModule(index) {
            if (confirm('Delete this module?')) {
                modulesData.splice(index, 1);
                renderModules();
            }
        }

        function moveModule(index, direction) {
            const newIndex = index + direction;
            if (newIndex < 0 || newIndex >= modulesData.length) return;
            [modulesData[index], modulesData[newIndex]] = [modulesData[newIndex], modulesData[index]];
            renderModules();
        }

        function updateModuleName(index, name) {
            modulesData[index].name = name;
        }

        function toggleModulePublished(index) {
            modulesData[index].published = !modulesData[index].published;
        }

        function addItem(moduleIndex) {
            if (!modulesData[moduleIndex].items) {
                modulesData[moduleIndex].items = [];
            }
            modulesData[moduleIndex].items.push({
                type: 'Page',
                title: 'New Item',
                indent: 0
            });
            renderModules();
        }

        function deleteItem(moduleIndex, itemIndex) {
            modulesData[moduleIndex].items.splice(itemIndex, 1);
            renderModules();
        }

        function updateItemType(moduleIndex, itemIndex, type) {
            modulesData[moduleIndex].items[itemIndex].type = type;
        }

        function updateItemTitle(moduleIndex, itemIndex, title) {
            modulesData[moduleIndex].items[itemIndex].title = title;
        }

        function changeIndent(moduleIndex, itemIndex, delta) {
            const item = modulesData[moduleIndex].items[itemIndex];
            const currentIndent = item.indent || 0;
            const newIndent = Math.max(0, Math.min(3, currentIndent + delta));
            item.indent = newIndent;
            renderModules();
        }

        function saveModules() {
            // Update positions
            modulesData.forEach((module, index) => {
                module.position = index + 1;
                if (module.items) {
                    module.items.forEach((item, itemIndex) => {
                        item.position = itemIndex + 1;
                    });
                }
            });

            vscode.postMessage({
                command: 'save',
                data: { modules: modulesData }
            });
        }

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }

        function openFile() {
            vscode.postMessage({ command: 'openFile' });
        }

        // Initialize
        renderModules();
    </script>
</body>
</html>`
  }

  public dispose(): void {
    ModuleEditorPanel.currentPanel = undefined

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
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
