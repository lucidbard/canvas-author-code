import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import * as child_process from 'child_process'
import { CanvasMcpClient } from './mcpClient'
import { CourseTreeProvider, CourseTreeItem, CourseInfo } from './courseTreeProvider'
import { OnboardingPanel } from './onboardingPanel'
import { CoursePickerPanel, Course as PickerCourse } from './coursePickerPanel'
import { MetadataPanel } from './metadataPanel'
import { RubricPreviewPanel } from './rubricPreviewPanel'
import { SubmissionsPanel } from './submissionsPanel'
import { CourseSettingsPanel } from './courseSettingsPanel'
import { QuizPreviewPanel } from './quizPreviewPanel'
import { ModuleEditorPanel } from './moduleEditorPanel'

// Response type interfaces
interface Course {
  id: string
  name: string
  course_code: string
}

// list_courses returns an array directly, not wrapped in an object
type ListCoursesResponse = Course[]

interface PullModulesResponse {
  modules_count: number
  items_count: number
  file: string
}

interface PushModulesResponse {
  created: Array<{ name: string; id: string }>
  updated: Array<{ name: string; id: string }>
  deleted: Array<{ name: string; id: string }>
  errors: Array<{ name?: string; error: string }>
}

interface ModuleStatusResponse {
  synced: Array<{ name: string }>
  canvas_only: Array<{ name: string }>
  local_only: Array<{ name: string }>
  summary: {
    synced_count: number
    canvas_only_count: number
    local_only_count: number
  }
}

interface PullQuizzesResponse {
  pulled: Array<{ title: string; file: string }>
  skipped: Array<{ title: string; reason: string }>
  errors: Array<{ title?: string; error: string }>
}

interface PushQuizzesResponse {
  created: Array<{ title: string; id: string }>
  updated: Array<{ title: string; id: string }>
  skipped: Array<{ title: string; reason: string }>
  errors: Array<{ title?: string; error: string }>
}

interface PullRubricsResponse {
  pulled: Array<{ assignment_name: string; file: string }>
  skipped: Array<{ assignment_name: string; reason: string }>
  no_rubric: Array<{ assignment_name: string }>
  errors: Array<{ assignment_name?: string; error: string }>
}

interface PushRubricsResponse {
  created: Array<{ assignment_name: string; rubric_id: string }>
  updated: Array<{ assignment_name: string; rubric_id: string }>
  skipped: Array<{ assignment_name: string; reason: string }>
  errors: Array<{ assignment_name?: string; error: string }>
}

interface RubricStatusResponse {
  synced: Array<{ assignment_name: string; status: string }>
  canvas_only: Array<{ assignment_name: string }>
  local_only: Array<{ assignment_name: string }>
  summary: {
    synced_count: number
    canvas_only_count: number
    local_only_count: number
  }
}

interface PullDiscussionsResponse {
  pulled: Array<{ title: string; file: string }>
  skipped: Array<{ title: string; reason: string }>
  errors: Array<{ title?: string; error: string }>
}

interface PushDiscussionsResponse {
  created: Array<{ title: string; id: string }>
  updated: Array<{ title: string; id: string }>
  skipped: Array<{ title: string; reason: string }>
  errors: Array<{ title?: string; error: string }>
}

interface DiscussionStatusResponse {
  synced: Array<{ title: string; status: string }>
  canvas_only: Array<{ title: string }>
  local_only: Array<{ title: string }>
  summary: {
    synced_count: number
    canvas_only_count: number
    local_only_count: number
  }
}

interface PullAnnouncementsResponse {
  pulled: Array<{ title: string; file: string }>
  skipped: Array<{ title: string; reason: string }>
  errors: Array<{ title?: string; error: string }>
}

interface PushAnnouncementsResponse {
  created: Array<{ title: string; id: string }>
  updated: Array<{ title: string; id: string }>
  skipped: Array<{ title: string; reason: string }>
  errors: Array<{ title?: string; error: string }>
}

let mcpClient: CanvasMcpClient | undefined
let courseTreeProvider: CourseTreeProvider
let extensionContext: vscode.ExtensionContext
let submissionsPanel: SubmissionsPanel | undefined

// Check if Canvas is configured
async function hasCanvasToken(context: vscode.ExtensionContext): Promise<boolean> {
  const token = await context.secrets.get('canvas-author.apiToken')
  const envToken = process.env.CANVAS_API_TOKEN
  return !!(token || envToken)
}

async function updateTokenContext(context: vscode.ExtensionContext) {
  const hasToken = await hasCanvasToken(context)
  await vscode.commands.executeCommand('setContext', 'canvas-author.hasToken', hasToken)
}

// Show onboarding panel if Canvas is not configured, returns true if connected
async function requireCanvasConnection(context: vscode.ExtensionContext, actionDescription: string): Promise<boolean> {
  const hasToken = await hasCanvasToken(context)
  if (!hasToken) {
    OnboardingPanel.createOrShow(context, `To ${actionDescription}, you need to connect to Canvas first.`)
    return false
  }
  return true
}

// Show onboarding panel when API calls fail (token may be invalid/expired)
async function handleConnectionFailure(context: vscode.ExtensionContext, actionDescription: string): Promise<void> {
  const choice = await vscode.window.showErrorMessage(
    'Could not connect to Canvas. Your token may be invalid or expired.',
    'Reconfigure Connection',
    'Cancel'
  )
  if (choice === 'Reconfigure Connection') {
    OnboardingPanel.createOrShow(context, `To ${actionDescription}, you need a valid Canvas connection.`)
  }
}

export async function activate(context: vscode.ExtensionContext) {
  console.log('Canvas Author extension is now active')

  // Store context for use in command handlers
  extensionContext = context

  // Check token status and set context
  await updateTokenContext(context)

  // Initialize MCP client with token from secret storage
  const storedToken = await context.secrets.get('canvas-author.apiToken')
  mcpClient = new CanvasMcpClient(storedToken)

  // Initialize course tree provider
  courseTreeProvider = new CourseTreeProvider(context)
  courseTreeProvider.setMcpClient(mcpClient)

  // Register tree view
  const treeView = vscode.window.createTreeView('canvasAuthorCourses', {
    treeDataProvider: courseTreeProvider,
    showCollapseAll: true
  })
  context.subscriptions.push(treeView)

  // Register submissions panel
  submissionsPanel = new SubmissionsPanel(
    context.extensionUri,
    context,
    () => courseTreeProvider.getAllCourses().map(c => ({ id: c.id, name: c.name }))
  )
  submissionsPanel.setMcpClient(mcpClient)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('canvasAuthorSubmissions', submissionsPanel)
  )

  // Register metadata panel
  const metadataPanel = new MetadataPanel(context)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('canvasAuthorMetadata', metadataPanel)
  )

  // Register commands
  context.subscriptions.push(
    // Original commands
    vscode.commands.registerCommand('canvas-author.init', initCourse),
    vscode.commands.registerCommand('canvas-author.pull', (item?: CourseTreeItem) => pullPages(item)),
    vscode.commands.registerCommand('canvas-author.push', (item?: CourseTreeItem) => pushPages(item)),
    vscode.commands.registerCommand('canvas-author.status', (item?: CourseTreeItem) => showStatus(item)),
    vscode.commands.registerCommand('canvas-author.listCourses', listCourses),
    vscode.commands.registerCommand('canvas-author.pullModules', (item?: CourseTreeItem) => pullModules(item)),
    vscode.commands.registerCommand('canvas-author.pushModules', (item?: CourseTreeItem) => pushModules(item)),
    vscode.commands.registerCommand('canvas-author.moduleStatus', (item?: CourseTreeItem) => showModuleStatus(item)),
    vscode.commands.registerCommand('canvas-author.pullQuizzes', (item?: CourseTreeItem) => pullQuizzes(item)),
    vscode.commands.registerCommand('canvas-author.pushQuizzes', (item?: CourseTreeItem) => pushQuizzes(item)),
    vscode.commands.registerCommand('canvas-author.pullRubrics', (item?: CourseTreeItem) => pullRubrics(item)),
    vscode.commands.registerCommand('canvas-author.pushRubrics', (item?: CourseTreeItem) => pushRubrics(item)),
    vscode.commands.registerCommand('canvas-author.rubricStatus', (item?: CourseTreeItem) => showRubricStatus(item)),
    vscode.commands.registerCommand('canvas-author.pullDiscussions', (item?: CourseTreeItem) => pullDiscussions(item)),
    vscode.commands.registerCommand('canvas-author.pushDiscussions', (item?: CourseTreeItem) => pushDiscussions(item)),
    vscode.commands.registerCommand('canvas-author.discussionStatus', (item?: CourseTreeItem) => showDiscussionStatus(item)),
    vscode.commands.registerCommand('canvas-author.pullAnnouncements', (item?: CourseTreeItem) => pullAnnouncements(item)),
    vscode.commands.registerCommand('canvas-author.pushAnnouncements', (item?: CourseTreeItem) => pushAnnouncements(item)),
    vscode.commands.registerCommand('canvas-author.createAnnouncement', (item?: CourseTreeItem) => createAnnouncement(item)),

    // Sidebar commands
    vscode.commands.registerCommand('canvas-author.addCourse', addCourse),
    vscode.commands.registerCommand('canvas-author.refreshCourses', refreshCoursesAndClient),
    vscode.commands.registerCommand('canvas-author.removeCourse', removeCourse),
    vscode.commands.registerCommand('canvas-author.openInExplorer', openInExplorer),
    vscode.commands.registerCommand('canvas-author.cloneFromRemote', cloneFromRemote),
    vscode.commands.registerCommand('canvas-author.configureMcp', configureMcpCommand),

    // New offline-first commands
    vscode.commands.registerCommand('canvas-author.configureCanvas', () => configureCanvas(context)),
    vscode.commands.registerCommand('canvas-author.createLocalCourse', createLocalCourse),
    vscode.commands.registerCommand('canvas-author.createPage', (item?: CourseTreeItem) => createPage(item)),
    vscode.commands.registerCommand('canvas-author.createQuiz', (item?: CourseTreeItem) => createQuiz(item)),
    vscode.commands.registerCommand('canvas-author.linkToCanvas', (item?: CourseTreeItem) => linkToCanvas(item, context)),
    vscode.commands.registerCommand('canvas-author.openSettings', (item?: CourseTreeItem) => openSettings(item)),
    vscode.commands.registerCommand('canvas-author.openAssignment', (item?: CourseTreeItem) => openAssignment(item, context)),
    vscode.commands.registerCommand('canvas-author.deleteAssignment', (item?: CourseTreeItem) => deleteAssignment(item)),
    vscode.commands.registerCommand('canvas-author.showAllSubmissions', (item?: CourseTreeItem) => showAllSubmissions(item)),
    vscode.commands.registerCommand('canvas-author.deletePage', (item?: CourseTreeItem) => deletePage(item)),
    vscode.commands.registerCommand('canvas-author.previewRubric', () => previewRubric(context)),
    vscode.commands.registerCommand('canvas-author.previewQuiz', (item?: CourseTreeItem) => previewQuiz(item, context)),
    vscode.commands.registerCommand('canvas-author.renameSubheader', (item?: CourseTreeItem) => renameSubheader(item)),
    vscode.commands.registerCommand('canvas-author.editModules', (item?: CourseTreeItem) => editModules(item, context)),
    vscode.commands.registerCommand('canvas-author.approveAndMergeWorktree', (item?: CourseTreeItem) => approveAndMergeWorktree(item)),
    vscode.commands.registerCommand('canvas-author.importWorktreesFromFolder', () => importWorktreesFromFolder()),
    vscode.commands.registerCommand('canvas-author.pushWorktreeBranches', () => pushWorktreeBranches()),
    vscode.commands.registerCommand('canvas-author.pullWorktreeBranches', () => pullWorktreeBranches()),
    vscode.commands.registerCommand('canvas-author.testMcpConnection', () => testMcpConnection()),

    // Onboarding command
    vscode.commands.registerCommand('canvas-author.showOnboarding', () => OnboardingPanel.createOrShow(context)),

    // Teleprompter command - start websocket server and open in browser
    vscode.commands.registerCommand('canvas-author.openTeleprompter', async (item?: CourseTreeItem) => {
      const courseDir = getCoursePath(item)
      if (!courseDir) {
        vscode.window.showErrorMessage('No course directory found')
        return
      }

      const courseMaterialsDir = path.join(courseDir, 'course-materials')
      if (!fs.existsSync(courseMaterialsDir)) {
        vscode.window.showErrorMessage('course-materials directory not found')
        return
      }

      const serverScript = path.join(courseMaterialsDir, 'teleprompter-server.py')
      if (!fs.existsSync(serverScript)) {
        vscode.window.showErrorMessage('teleprompter-server.py not found in course-materials')
        return
      }

      // Start Python websocket server (don't detach - we want to keep it attached)
      const serverProcess = child_process.spawn('python3', [serverScript], {
        cwd: courseMaterialsDir,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      // Log server output
      serverProcess.stdout?.on('data', (data) => {
        const output = data.toString()
        console.log(`Teleprompter: ${output}`)
        // Show important messages to user
        if (output.includes('All systems ready') || output.includes('WebSocket server')) {
          vscode.window.showInformationMessage('Teleprompter server ready with live reload')
        }
      })

      serverProcess.stderr?.on('data', (data) => {
        console.error(`Teleprompter error: ${data}`)
      })

      serverProcess.on('error', (err) => {
        vscode.window.showErrorMessage(`Teleprompter server failed to start: ${err.message}`)
      })

      serverProcess.on('exit', (code) => {
        if (code !== null && code !== 0) {
          vscode.window.showWarningMessage(`Teleprompter server exited with code ${code}`)
        }
      })

      // Wait a moment for server to start
      await new Promise(resolve => setTimeout(resolve, 1500))

      // Open in browser
      const url = 'http://localhost:8000/teleprompter.html'
      vscode.env.openExternal(vscode.Uri.parse(url))

      vscode.window.showInformationMessage('Teleprompter server started with live reload on http://localhost:8000')

      // Store process for cleanup
      context.subscriptions.push({
        dispose: () => {
          if (serverProcess && !serverProcess.killed) {
            serverProcess.kill('SIGTERM')
            console.log('Teleprompter server stopped')
          }
        }
      })
    })
  )

  // Show status bar item when in a Canvas course directory
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  )
  statusBarItem.text = '$(cloud) Canvas'
  statusBarItem.tooltip = 'Canvas Author - Click to sync'
  statusBarItem.command = 'canvas-author.status'

  // Show status bar if .canvas.json exists
  if (vscode.workspace.workspaceFolders) {
    const canvasConfig = await vscode.workspace.findFiles('.canvas.json', null, 1)
    if (canvasConfig.length > 0) {
      statusBarItem.show()
    }
  }

  context.subscriptions.push(statusBarItem)

  // Auto-detect and register courses from workspace
  await autoDetectCourses()
}

async function refreshCoursesAndClient() {
  // Recreate MCP client with current token from secret storage
  const storedToken = await extensionContext.secrets.get('canvas-author.apiToken')
  mcpClient?.dispose()
  mcpClient = new CanvasMcpClient(storedToken)
  courseTreeProvider.setMcpClient(mcpClient)

  // Refresh the tree view
  courseTreeProvider.refresh()
}

async function autoDetectCourses() {
  if (!vscode.workspace.workspaceFolders) {
    return
  }

  for (const folder of vscode.workspace.workspaceFolders) {
    const canvasConfigPath = path.join(folder.uri.fsPath, '.canvas.json')
    if (fs.existsSync(canvasConfigPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(canvasConfigPath, 'utf8'))
        const courseInfo: CourseInfo = {
          id: config.course_id?.toString() || '',
          name: config.course_name || folder.name,
          courseCode: config.course_code || '',
          localPath: folder.uri.fsPath
        }

        if (courseInfo.id && !courseTreeProvider.getCourseById(courseInfo.id)) {
          courseTreeProvider.addCourse(courseInfo)
        }
      } catch (e) {
        console.error('Failed to parse .canvas.json:', e)
      }
    }
  }
}

async function gitCommit(filePath: string, message: string): Promise<void> {
  try {
    const { execSync } = require('child_process')
    const dir = path.dirname(filePath)

    // Stage the file change (or deletion)
    execSync(`git add "${filePath}"`, { cwd: dir })

    // Commit with the provided message
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: dir })
  } catch (err) {
    // Git might not be available or file not in a repo, silently fail
    console.log('Git commit failed, continuing without version control:', err)
  }
}

function getCoursePath(item?: CourseTreeItem): string | undefined {
  if (item?.courseInfo) {
    return item.courseInfo.localPath
  }

  const folders = vscode.workspace.workspaceFolders
  if (folders && folders.length > 0) {
    return folders[0].uri.fsPath
  }

  return undefined
}

function getCourseId(item?: CourseTreeItem): string | undefined {
  if (item?.courseInfo) {
    return item.courseInfo.id
  }

  // Try to read from .canvas.json in workspace
  const folders = vscode.workspace.workspaceFolders
  if (folders && folders.length > 0) {
    const configPath = path.join(folders[0].uri.fsPath, '.canvas.json')
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
        return config.course_id?.toString()
      } catch (e) {
        console.error('Failed to read course_id from .canvas.json:', e)
      }
    }
  }

  return undefined
}

async function addCourse() {
  const choice = await vscode.window.showQuickPick([
    { label: '$(cloud-download) From Canvas', description: 'Initialize a new course from Canvas', value: 'canvas' },
    { label: '$(folder) Existing Folder', description: 'Register an existing course folder', value: 'folder' },
    { label: '$(repo-clone) Clone from Git', description: 'Clone a course repo from GitHub/GitLab', value: 'clone' }
  ], {
    placeHolder: 'How would you like to add a course?'
  })

  if (!choice) {
    return
  }

  switch (choice.value) {
    case 'canvas':
      await initCourse()
      break
    case 'folder':
      await registerExistingFolder()
      break
    case 'clone':
      await cloneFromRemote()
      break
  }
}

async function registerExistingFolder() {
  const uri = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Select Course Folder'
  })

  if (!uri || uri.length === 0) {
    return
  }

  const folderPath = uri[0].fsPath
  const canvasConfigPath = path.join(folderPath, '.canvas.json')

  if (!fs.existsSync(canvasConfigPath)) {
    const init = await vscode.window.showWarningMessage(
      'This folder does not have a .canvas.json file. Initialize it as a Canvas course?',
      'Initialize', 'Cancel'
    )
    if (init === 'Initialize') {
      // Open the folder and initialize
      await vscode.commands.executeCommand('vscode.openFolder', uri[0])
      await initCourse()
    }
    return
  }

  try {
    const config = JSON.parse(fs.readFileSync(canvasConfigPath, 'utf8'))
    const courseInfo: CourseInfo = {
      id: config.course_id?.toString() || '',
      name: config.course_name || path.basename(folderPath),
      courseCode: config.course_code || '',
      localPath: folderPath
    }

    courseTreeProvider.addCourse(courseInfo)
    vscode.window.showInformationMessage(`Added course: ${courseInfo.name}`)
  } catch (e) {
    vscode.window.showErrorMessage(`Failed to read course config: ${e}`)
  }
}

async function cloneFromRemote() {
  const repoUrl = await vscode.window.showInputBox({
    prompt: 'Enter the Git repository URL',
    placeHolder: 'https://github.com/user/course-repo.git',
    validateInput: (value) => {
      if (!value) {
        return 'Repository URL is required'
      }
      if (!value.match(/^https?:\/\/.+\.git$|^git@.+:.+\.git$/)) {
        return 'Please enter a valid Git URL'
      }
      return undefined
    }
  })

  if (!repoUrl) {
    return
  }

  // Determine clone location
  const storageChoice = await vscode.window.showQuickPick([
    { label: 'Default Location', description: `~/.canvas-author/courses/`, value: 'default' },
    { label: 'Choose Location', description: 'Select a custom folder', value: 'custom' }
  ], {
    placeHolder: 'Where should the course be cloned?'
  })

  if (!storageChoice) {
    return
  }

  let targetDir: string
  const repoName = path.basename(repoUrl, '.git')

  if (storageChoice.value === 'default') {
    const defaultPath = path.join(courseTreeProvider.getStoragePath(), 'courses')
    if (!fs.existsSync(defaultPath)) {
      fs.mkdirSync(defaultPath, { recursive: true })
    }
    targetDir = path.join(defaultPath, repoName)
  } else {
    const uri = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Select Parent Folder'
    })

    if (!uri || uri.length === 0) {
      return
    }

    targetDir = path.join(uri[0].fsPath, repoName)
  }

  // Clone the repo
  try {
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Cloning ${repoName}...`,
      cancellable: false
    }, async () => {
      const terminal = vscode.window.createTerminal('Canvas Author')
      terminal.sendText(`git clone "${repoUrl}" "${targetDir}"`)
      terminal.show()

      // Wait for clone to complete (simple polling)
      await new Promise(resolve => setTimeout(resolve, 5000))
    })

    // Check if .canvas.json exists after clone
    const canvasConfigPath = path.join(targetDir, '.canvas.json')
    if (fs.existsSync(canvasConfigPath)) {
      const config = JSON.parse(fs.readFileSync(canvasConfigPath, 'utf8'))
      const courseInfo: CourseInfo = {
        id: config.course_id?.toString() || '',
        name: config.course_name || repoName,
        courseCode: config.course_code || '',
        localPath: targetDir,
        remoteUrl: repoUrl
      }

      courseTreeProvider.addCourse(courseInfo)
      vscode.window.showInformationMessage(`Cloned and registered: ${courseInfo.name}`)
    } else {
      vscode.window.showWarningMessage(
        'Repository cloned but no .canvas.json found. You may need to initialize it.'
      )
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to clone: ${error}`)
  }
}

async function removeCourse(item: CourseTreeItem) {
  if (!item.courseInfo) {
    return
  }

  const confirm = await vscode.window.showWarningMessage(
    `Remove "${item.courseInfo.name}" from the course list? (Files will not be deleted)`,
    'Remove', 'Cancel'
  )

  if (confirm === 'Remove') {
    courseTreeProvider.removeCourse(item.courseInfo.id)
    vscode.window.showInformationMessage(`Removed: ${item.courseInfo.name}`)
  }
}

async function openInExplorer(item: CourseTreeItem) {
  if (item.courseInfo) {
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(item.courseInfo.localPath))
  }
}

async function configureMcpForCopilot(targetDir: string) {
  const vscodeDir = path.join(targetDir, '.vscode')
  const mcpConfigPath = path.join(vscodeDir, 'mcp.json')

  // Create .vscode directory if it doesn't exist
  if (!fs.existsSync(vscodeDir)) {
    fs.mkdirSync(vscodeDir, { recursive: true })
  }

  // Create or update mcp.json for Copilot
  const mcpConfig = {
    servers: {
      "canvas-author": {
        command: "canvas-author",
        args: ["server"],
        env: {
          CANVAS_DOMAIN: "${env:CANVAS_DOMAIN}",
          CANVAS_API_TOKEN: "${env:CANVAS_API_TOKEN}"
        }
      }
    }
  }

  fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2))

  // Also add to .gitignore if it exists
  const gitignorePath = path.join(targetDir, '.gitignore')
  if (fs.existsSync(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, 'utf8')
    if (!gitignore.includes('.vscode/mcp.json')) {
      fs.appendFileSync(gitignorePath, '\n# MCP config (contains env var references)\n.vscode/mcp.json\n')
    }
  }
}

async function configureMcpCommand(item?: CourseTreeItem) {
  const coursePath = getCoursePath(item)
  if (!coursePath) {
    vscode.window.showErrorMessage('Please select a course or open a folder')
    return
  }

  await configureMcpForCopilot(coursePath)
  vscode.window.showInformationMessage('MCP configured for Copilot at .vscode/mcp.json')
}

async function configureCanvas(context: vscode.ExtensionContext) {
  // Get Canvas domain
  const domain = await vscode.window.showInputBox({
    prompt: 'Enter your Canvas LMS domain',
    placeHolder: 'canvas.instructure.com or myschool.instructure.com',
    value: vscode.workspace.getConfiguration('canvas-author').get('canvasDomain') || ''
  })

  if (!domain) {
    return
  }

  // Get API token
  const token = await vscode.window.showInputBox({
    prompt: 'Enter your Canvas API token',
    placeHolder: 'Generate at Canvas > Profile > Settings > New Access Token',
    password: true
  })

  if (!token) {
    return
  }

  // Save domain to settings
  await vscode.workspace.getConfiguration('canvas-author').update('canvasDomain', domain, true)

  // Save token to secret storage
  await context.secrets.store('canvas-author.apiToken', token)

  // Update context for welcome view
  await updateTokenContext(context)

  // Recreate MCP client with the new token
  mcpClient?.dispose()
  mcpClient = new CanvasMcpClient(token)
  courseTreeProvider.setMcpClient(mcpClient)

  // Refresh tree
  courseTreeProvider.refresh()

  vscode.window.showInformationMessage('Canvas connection configured! You can now import courses from Canvas.')
}

async function createLocalCourse() {
  // Get course name
  const courseName = await vscode.window.showInputBox({
    prompt: 'Enter a name for your course',
    placeHolder: 'Introduction to Computer Science'
  })

  if (!courseName) {
    return
  }

  // Get course code (optional)
  const courseCode = await vscode.window.showInputBox({
    prompt: 'Enter a course code (optional)',
    placeHolder: 'CS101'
  })

  // Ask where to store
  const storageChoice = await vscode.window.showQuickPick([
    { label: 'Default Location', description: '~/.canvas-author/courses/', value: 'default' },
    { label: 'Current Workspace', description: 'Create in current folder', value: 'workspace' },
    { label: 'Choose Location', description: 'Select a folder', value: 'custom' }
  ], {
    placeHolder: 'Where should the course be created?'
  })

  if (!storageChoice) {
    return
  }

  let targetDir: string
  const safeName = courseName.replace(/[^a-zA-Z0-9-_\s]/g, '').replace(/\s+/g, '-').toLowerCase()

  if (storageChoice.value === 'default') {
    const defaultPath = path.join(courseTreeProvider.getStoragePath(), 'courses')
    if (!fs.existsSync(defaultPath)) {
      fs.mkdirSync(defaultPath, { recursive: true })
    }
    targetDir = path.join(defaultPath, safeName)
  } else if (storageChoice.value === 'workspace') {
    const folders = vscode.workspace.workspaceFolders
    if (!folders) {
      vscode.window.showErrorMessage('Please open a folder first')
      return
    }
    targetDir = path.join(folders[0].uri.fsPath, safeName)
  } else {
    const uri = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Select Parent Folder'
    })

    if (!uri || uri.length === 0) {
      return
    }
    targetDir = path.join(uri[0].fsPath, safeName)
  }

  // Create course structure
  try {
    // Create directories
    fs.mkdirSync(targetDir, { recursive: true })
    fs.mkdirSync(path.join(targetDir, 'quizzes'), { recursive: true })

    // Create .canvas.json (local only, no course_id yet)
    const canvasConfig = {
      course_name: courseName,
      course_code: courseCode || '',
      local_only: true,
      created_at: new Date().toISOString()
    }
    fs.writeFileSync(
      path.join(targetDir, '.canvas.json'),
      JSON.stringify(canvasConfig, null, 2)
    )

    // Create modules.yaml template
    const modulesYaml = `modules:
- name: Week 1 - Introduction
  published: false
  items:
  - type: page
    page_url: welcome
  - type: page
    page_url: syllabus
`
    fs.writeFileSync(path.join(targetDir, 'modules.yaml'), modulesYaml)

    // Create welcome page
    const welcomePage = `---
title: Welcome
url: welcome
published: false
---

# Welcome to ${courseName}

Welcome to the course! This page will introduce you to the course content.

## Getting Started

Add your course introduction here.
`
    fs.writeFileSync(path.join(targetDir, 'welcome.md'), welcomePage)

    // Create syllabus page
    const syllabusPage = `---
title: Syllabus
url: syllabus
published: false
---

# ${courseName} Syllabus

## Course Description

Add your course description here.

## Learning Objectives

1. Objective one
2. Objective two
3. Objective three

## Grading

| Component | Weight |
|-----------|--------|
| Assignments | 40% |
| Quizzes | 20% |
| Final Exam | 40% |

## Schedule

| Week | Topic | Assignments |
|------|-------|-------------|
| 1 | Introduction | Reading 1 |
| 2 | Fundamentals | Assignment 1 |
`
    fs.writeFileSync(path.join(targetDir, 'syllabus.md'), syllabusPage)

    // Create .gitignore
    const gitignore = `.env
.vscode/mcp.json
`
    fs.writeFileSync(path.join(targetDir, '.gitignore'), gitignore)

    // Initialize git repo
    const terminal = vscode.window.createTerminal('Canvas Author')
    terminal.sendText(`cd "${targetDir}" && git init`)

    // Register the course (generate a local ID)
    const localId = `local-${Date.now()}`
    const courseInfo: CourseInfo = {
      id: localId,
      name: courseName,
      courseCode: courseCode || '',
      localPath: targetDir
    }
    courseTreeProvider.addCourse(courseInfo)

    // Configure MCP for Copilot
    await configureMcpForCopilot(targetDir)

    vscode.window.showInformationMessage(
      `Created local course: ${courseName}. Use "Link to Canvas" when ready to sync.`
    )

    // Open the course folder
    const openChoice = await vscode.window.showInformationMessage(
      'Open course folder in VS Code?',
      'Open', 'Open in New Window', 'No'
    )

    if (openChoice === 'Open') {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(targetDir), false)
    } else if (openChoice === 'Open in New Window') {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(targetDir), true)
    }

  } catch (error) {
    vscode.window.showErrorMessage(`Failed to create course: ${error}`)
  }
}

async function createPage(item?: CourseTreeItem) {
  const coursePath = getCoursePath(item)
  if (!coursePath) {
    vscode.window.showErrorMessage('Please select a course first')
    return
  }

  const title = await vscode.window.showInputBox({
    prompt: 'Enter page title',
    placeHolder: 'Week 1 Notes'
  })

  if (!title) {
    return
  }

  const url = title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-')
  const fileName = `${url}.md`
  const filePath = path.join(coursePath, fileName)

  if (fs.existsSync(filePath)) {
    vscode.window.showErrorMessage(`Page already exists: ${fileName}`)
    return
  }

  const content = `---
title: ${title}
url: ${url}
published: false
---

# ${title}

Add your content here.
`

  fs.writeFileSync(filePath, content)
  courseTreeProvider.refresh()

  // Open the file
  const doc = await vscode.workspace.openTextDocument(filePath)
  await vscode.window.showTextDocument(doc)

  vscode.window.showInformationMessage(`Created page: ${title}`)
}

async function createQuiz(item?: CourseTreeItem) {
  const coursePath = getCoursePath(item)
  if (!coursePath) {
    vscode.window.showErrorMessage('Please select a course first')
    return
  }

  const title = await vscode.window.showInputBox({
    prompt: 'Enter quiz title',
    placeHolder: 'Week 1 Quiz'
  })

  if (!title) {
    return
  }

  const url = title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-')
  const fileName = `${url}.md`
  const quizzesDir = path.join(coursePath, 'quizzes')

  if (!fs.existsSync(quizzesDir)) {
    fs.mkdirSync(quizzesDir, { recursive: true })
  }

  const filePath = path.join(quizzesDir, fileName)

  if (fs.existsSync(filePath)) {
    vscode.window.showErrorMessage(`Quiz already exists: ${fileName}`)
    return
  }

  const content = `---
title: ${title}
time_limit: 30
published: false
shuffle_answers: true
---

# ${title}

## Questions

### 1. [MC] Sample multiple choice question? (1 pt)

a. Wrong answer
*b. Correct answer
c. Another wrong answer
d. Also wrong

---

### 2. [TF] Sample true/false statement. (1 pt)

*a. True
b. False

---

### 3. [SA] Sample short answer question? (1 pt)

*correct answer
*also acceptable
`

  fs.writeFileSync(filePath, content)
  courseTreeProvider.refresh()

  // Open the file
  const doc = await vscode.workspace.openTextDocument(filePath)
  await vscode.window.showTextDocument(doc)

  vscode.window.showInformationMessage(`Created quiz: ${title}`)
}

async function openSettings(item?: CourseTreeItem) {
  const courseInfo = item?.courseInfo
  if (!courseInfo) {
    vscode.window.showErrorMessage('Please select a course first')
    return
  }

  const settingsPath = path.join(courseInfo.localPath, 'course.yaml')

  // Check if course.yaml exists
  if (fs.existsSync(settingsPath)) {
    // Open the settings panel UI
    CourseSettingsPanel.createOrShow(
      extensionContext.extensionUri,
      courseInfo.localPath,
      courseInfo.id,
      courseInfo.name
    )
    return
  }

  // File doesn't exist - offer to pull settings from Canvas or create empty
  const choice = await vscode.window.showInformationMessage(
    'Course settings file (course.yaml) not found. Would you like to pull settings from Canvas?',
    'Pull Settings',
    'Create Empty',
    'Cancel'
  )

  if (choice === 'Cancel' || !choice) {
    return
  }

  if (choice === 'Pull Settings') {
    // Check if we can connect to Canvas
    if (!await requireCanvasConnection(extensionContext, 'pull course settings')) {
      return
    }

    if (!mcpClient) {
      vscode.window.showErrorMessage('Canvas connection not available')
      return
    }

    try {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Pulling course settings from Canvas...',
        cancellable: false
      }, async () => {
        const result = await mcpClient?.callTool('pull_course', {
          course_id: courseInfo.id,
          directory: courseInfo.localPath
        })
        console.log('Pull course result:', result)
        return result
      })

      courseTreeProvider.refresh()

      if (fs.existsSync(settingsPath)) {
        // Open the settings panel UI
        CourseSettingsPanel.createOrShow(
          extensionContext.extensionUri,
          courseInfo.localPath,
          courseInfo.id,
          courseInfo.name
        )
        vscode.window.showInformationMessage('Course settings pulled from Canvas')
      } else {
        vscode.window.showWarningMessage('Pull completed but course.yaml was not created')
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to pull settings: ${error}`)
    }
  } else if (choice === 'Create Empty') {
    // Create empty course.yaml with basic structure
    const content = `# Course Settings for ${courseInfo.name}
# This file stores course configuration that can be synced with Canvas

course_id: ${courseInfo.id}
name: ${courseInfo.name}
course_code: ${courseInfo.courseCode}
`

    fs.writeFileSync(settingsPath, content)
    courseTreeProvider.refresh()

    // Open the settings panel UI
    CourseSettingsPanel.createOrShow(
      extensionContext.extensionUri,
      courseInfo.localPath,
      courseInfo.id,
      courseInfo.name
    )
    vscode.window.showInformationMessage('Course settings created - use the form to configure and save')
  }
}

async function openAssignment(item?: CourseTreeItem, context?: vscode.ExtensionContext) {
  if (!item || !item.resourcePath || !item.courseInfo) {
    return
  }

  // Open the assignment file first
  const assignmentDoc = await vscode.workspace.openTextDocument(item.resourcePath)
  await vscode.window.showTextDocument(assignmentDoc, { viewColumn: vscode.ViewColumn.One })

  // Extract assignment_id from frontmatter to show submissions
  const content = fs.readFileSync(item.resourcePath, 'utf8')
  const assignmentIdMatch = content.match(/assignment_id:\s*['"]?(\d+)['"]?/)

  if (assignmentIdMatch && submissionsPanel && item.courseInfo) {
    const assignmentId = assignmentIdMatch[1]
    await submissionsPanel.showAssignmentSubmissions(item.courseInfo.id, assignmentId, item.label)
  }

  // Check if a rubric exists for this assignment
  const assignmentName = path.basename(item.resourcePath, '.md')
  const rubricsPath = path.join(item.courseInfo.localPath, 'rubrics')

  if (!fs.existsSync(rubricsPath)) {
    return
  }

  // Look for a rubric file matching the assignment name
  const possibleRubricPath = path.join(rubricsPath, `${assignmentName}.rubric.yaml`)

  if (fs.existsSync(possibleRubricPath) && context) {
    // Open rubric preview alongside the assignment
    RubricPreviewPanel.createOrShow(context.extensionUri, possibleRubricPath, item.label)
  } else {
    // Try to find any rubric file that references this assignment
    const rubricFiles = fs.readdirSync(rubricsPath).filter(f => f.endsWith('.rubric.yaml'))

    for (const rubricFile of rubricFiles) {
      const rubricPath = path.join(rubricsPath, rubricFile)
      const content = fs.readFileSync(rubricPath, 'utf8')

      // Check if this rubric's assignment_name matches
      const match = content.match(/assignment_name:\s*["']?([^"'\n]+)["']?/)
      if (match && match[1] === item.label) {
        if (context) {
          RubricPreviewPanel.createOrShow(context.extensionUri, rubricPath, item.label)
        }
        break
      }
    }
  }
}

async function showAllSubmissions(item?: CourseTreeItem) {
  if (!item || !item.courseInfo) {
    vscode.window.showErrorMessage('No course selected')
    return
  }

  if (!submissionsPanel) {
    vscode.window.showErrorMessage('Submissions panel not available')
    return
  }

  // Show the submissions view
  await vscode.commands.executeCommand('canvasAuthorSubmissions.focus')

  // Load all submissions for this course
  await submissionsPanel.showAllSubmissions(item.courseInfo.id, item.courseInfo.name)
}

async function deleteAssignment(item?: CourseTreeItem) {
  if (!item || !item.resourcePath || !item.courseInfo) {
    return
  }

  const confirmed = await vscode.window.showWarningMessage(
    `Delete assignment "${item.label}"? This will remove it locally and from Canvas.`,
    'Delete',
    'Cancel'
  )

  if (confirmed !== 'Delete') {
    return
  }

  try {
    // Extract assignment_id from frontmatter
    const content = fs.readFileSync(item.resourcePath, 'utf8')
    const assignmentIdMatch = content.match(/assignment_id:\s*['"]?(\d+)['"]?/)

    // Delete from Canvas if it has an assignment_id
    if (assignmentIdMatch && mcpClient) {
      const assignmentId = assignmentIdMatch[1]
      try {
        await mcpClient.callTool('delete_assignment', {
          course_id: item.courseInfo.id,
          assignment_id: assignmentId
        })
      } catch (err) {
        vscode.window.showWarningMessage(
          `Assignment already deleted from Canvas or error deleting: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }

    // Delete local file
    fs.unlinkSync(item.resourcePath)

    // Auto-commit the deletion
    await gitCommit(item.resourcePath, `Delete assignment: ${item.label}`)

    vscode.window.showInformationMessage(`Deleted assignment: ${item.label}`)

    // Refresh the tree
    courseTreeProvider?.refresh()
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to delete assignment: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function deletePage(item?: CourseTreeItem) {
  if (!item || !item.resourcePath || !item.courseInfo) {
    return
  }

  const confirmed = await vscode.window.showWarningMessage(
    `Delete page "${item.label}"? This will remove it locally and from Canvas.`,
    'Delete',
    'Cancel'
  )

  if (confirmed !== 'Delete') {
    return
  }

  try {
    // Extract page_id from frontmatter
    const content = fs.readFileSync(item.resourcePath, 'utf8')
    const pageIdMatch = content.match(/page_id:\s*['"]?(\d+)['"]?/)

    // Delete from Canvas if it has a page_id
    if (pageIdMatch && mcpClient) {
      const pageId = pageIdMatch[1]
      try {
        await mcpClient.callTool('delete_page', {
          course_id: item.courseInfo.id,
          page_id: pageId
        })
      } catch (err) {
        vscode.window.showWarningMessage(
          `Page already deleted from Canvas or error deleting: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }

    // Delete local file
    fs.unlinkSync(item.resourcePath)

    // Auto-commit the deletion
    await gitCommit(item.resourcePath, `Delete page: ${item.label}`)

    vscode.window.showInformationMessage(`Deleted page: ${item.label}`)

    // Refresh the tree
    courseTreeProvider?.refresh()
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to delete page: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function linkToCanvas(item: CourseTreeItem | undefined, context: vscode.ExtensionContext) {
  const coursePath = getCoursePath(item)
  if (!coursePath) {
    vscode.window.showErrorMessage('Please select a course first')
    return
  }

  // Check Canvas connection
  if (!await requireCanvasConnection(context, 'link this course to Canvas')) {
    return
  }

  // Get list of Canvas courses
  const courses = await listCoursesQuiet()
  if (!courses) {
    await handleConnectionFailure(context, 'link this course to Canvas')
    return
  }
  if (courses.length === 0) {
    vscode.window.showInformationMessage('No courses found in your Canvas account.')
    return
  }

  const choice = await vscode.window.showQuickPick([
    { label: '$(cloud-upload) Link to existing Canvas course', value: 'existing' },
    { label: '$(add) Create new Canvas course', value: 'new' }
  ], {
    placeHolder: 'How would you like to link this course?'
  })

  if (!choice) {
    return
  }

  if (choice.value === 'existing') {
    // Pick existing course
    const items = courses.map(c => ({
      label: c.name,
      description: c.course_code,
      detail: `ID: ${c.id}`,
      courseId: c.id
    }))

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select Canvas course to link'
    })

    if (!selected) {
      return
    }

    // Update .canvas.json with course_id
    const configPath = path.join(coursePath, '.canvas.json')
    let config: any = {}

    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    }

    config.course_id = selected.courseId
    config.local_only = false
    config.linked_at = new Date().toISOString()

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))

    // Update course registry
    if (item?.courseInfo) {
      const updatedInfo: CourseInfo = {
        ...item.courseInfo,
        id: selected.courseId
      }
      courseTreeProvider.removeCourse(item.courseInfo.id)
      courseTreeProvider.addCourse(updatedInfo)
    }

    vscode.window.showInformationMessage(
      `Linked to Canvas course: ${selected.label}. Use Push to upload content.`
    )

  } else {
    // Create new course (would need Canvas API support)
    vscode.window.showInformationMessage(
      'Creating new Canvas courses is not yet supported. Please create the course in Canvas first, then link to it.'
    )
  }
}

async function initCourse() {
  // Check Canvas connection
  if (!await requireCanvasConnection(extensionContext, 'import a course from Canvas')) {
    return
  }

  // Get list of courses first
  const courses = await listCoursesQuiet()
  if (!courses) {
    await handleConnectionFailure(extensionContext, 'import a course from Canvas')
    return
  }
  if (courses.length === 0) {
    vscode.window.showInformationMessage('No courses found in your Canvas account.')
    return
  }

  // Show course picker panel
  CoursePickerPanel.createOrShow(extensionContext, courses, async (selectedCourse) => {
    await initCourseWithSelection(selectedCourse)
  })
}

async function initCourseWithSelection(selected: { id: string; name: string; course_code: string }) {
  // Ask where to store the course
  const storageChoice = await vscode.window.showQuickPick([
    { label: 'Current Workspace', description: 'Initialize in current workspace folder', value: 'workspace' },
    { label: 'Default Location', description: `~/.canvas-author/courses/`, value: 'default' },
    { label: 'Choose Location', description: 'Select a custom folder', value: 'custom' }
  ], {
    placeHolder: 'Where should the course be stored?'
  })

  if (!storageChoice) {
    return
  }

  let targetDir: string

  if (storageChoice.value === 'workspace') {
    const folders = vscode.workspace.workspaceFolders
    if (!folders) {
      vscode.window.showErrorMessage('Please open a folder first')
      return
    }
    targetDir = folders[0].uri.fsPath
  } else if (storageChoice.value === 'default') {
    const defaultPath = path.join(courseTreeProvider.getStoragePath(), 'courses')
    if (!fs.existsSync(defaultPath)) {
      fs.mkdirSync(defaultPath, { recursive: true })
    }
    const safeName = selected.name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase()
    targetDir = path.join(defaultPath, `${safeName}-${selected.id}`)
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }
  } else {
    const uri = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Select Folder'
    })

    if (!uri || uri.length === 0) {
      return
    }
    targetDir = uri[0].fsPath
  }

  try {
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Initializing course: ${selected.name}`,
      cancellable: false
    }, async (progress) => {
      progress.report({ message: 'Creating course folder...' })

      await mcpClient?.callTool('init_course', {
        course_id: selected.id,
        directory: targetDir
      })

      progress.report({ message: 'Registering course...' })

      // Register the course
      const courseInfo: CourseInfo = {
        id: selected.id,
        name: selected.name,
        courseCode: selected.course_code,
        localPath: targetDir
      }
      courseTreeProvider.addCourse(courseInfo)

      progress.report({ message: 'Configuring MCP...' })

      // Configure MCP for Copilot
      await configureMcpForCopilot(targetDir)
    })

    vscode.window.showInformationMessage(`Initialized course: ${selected.name} (MCP configured for Copilot)`)
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to initialize: ${error}`)
  }
}

async function pullPages(item?: CourseTreeItem) {
  // Check Canvas connection
  if (!await requireCanvasConnection(extensionContext, 'pull pages from Canvas')) {
    return
  }

  const coursePath = getCoursePath(item)
  if (!coursePath) {
    vscode.window.showErrorMessage('Please select a course or open a folder')
    return
  }

  try {
    const courseId = await getCourseId(item)
    if (!courseId) {
      vscode.window.showErrorMessage('Could not determine course ID. Please check .canvas.json')
      return
    }

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Pulling pages from Canvas...',
      cancellable: false
    }, async () => {
      const result = await mcpClient?.callTool('pull_pages', {
        course_id: courseId,
        output_dir: coursePath
      })
      return result
    })
    vscode.window.showInformationMessage('Pages pulled successfully')
    courseTreeProvider.refresh()
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to pull pages: ${error}`)
  }
}

async function pushPages(item?: CourseTreeItem) {
  // Check Canvas connection
  if (!await requireCanvasConnection(extensionContext, 'push pages to Canvas')) {
    return
  }

  const coursePath = getCoursePath(item)
  if (!coursePath) {
    vscode.window.showErrorMessage('Please select a course or open a folder')
    return
  }

  try {
    const courseId = await getCourseId(item)
    if (!courseId) {
      vscode.window.showErrorMessage('Could not determine course ID. Please check .canvas.json')
      return
    }

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Pushing pages to Canvas...',
      cancellable: false
    }, async () => {
      const result = await mcpClient?.callTool('push_pages', {
        course_id: courseId,
        input_dir: coursePath
      })
      return result
    })
    vscode.window.showInformationMessage('Pages pushed successfully')
    courseTreeProvider.refresh()
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to push pages: ${error}`)
  }
}

async function showStatus(item?: CourseTreeItem) {
  // Check Canvas connection
  if (!await requireCanvasConnection(extensionContext, 'check sync status with Canvas')) {
    return
  }

  const coursePath = getCoursePath(item)
  if (!coursePath) {
    vscode.window.showErrorMessage('Please select a course or open a folder')
    return
  }

  const courseId = await getCourseId(item)
  if (!courseId) {
    vscode.window.showErrorMessage('Could not determine course ID. Please check .canvas.json')
    return
  }

  try {
    const result = await mcpClient?.callTool('sync_status', {
      course_id: courseId,
      local_dir: coursePath
    })

    // Show status in output channel
    const channel = vscode.window.createOutputChannel('Canvas Author')
    channel.clear()
    channel.appendLine('Canvas Sync Status')
    channel.appendLine('==================')
    channel.appendLine(JSON.stringify(result, null, 2))
    channel.show()
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to get status: ${error}`)
  }
}

async function listCourses() {
  // Check Canvas connection
  if (!await requireCanvasConnection(extensionContext, 'list courses from Canvas')) {
    return
  }

  try {
    const courses = await listCoursesQuiet()
    if (!courses) {
      await handleConnectionFailure(extensionContext, 'list courses from Canvas')
      return
    }
    if (courses.length === 0) {
      vscode.window.showInformationMessage('No courses found in your Canvas account.')
      return
    }

    const channel = vscode.window.createOutputChannel('Canvas Author')
    channel.clear()
    channel.appendLine('Available Courses')
    channel.appendLine('=================')
    for (const course of courses) {
      channel.appendLine(`${course.id}: ${course.name} (${course.course_code})`)
    }
    channel.show()
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to list courses: ${error}`)
  }
}

async function listCoursesQuiet(): Promise<Course[] | undefined> {
  try {
    // Pass enrollment_state='all' to get all courses, not just currently active ones
    const result = await mcpClient?.callTool<ListCoursesResponse | { error: string; error_type?: string; message?: string }>('list_courses', { enrollment_state: 'all' })

    // Check if result is an error response
    if (result && typeof result === 'object' && 'error' in result) {
      const errorResult = result as { error: string; error_type?: string; message?: string }

      // Check for authentication errors
      if (errorResult.error_type === 'authentication' ||
        errorResult.error.toLowerCase().includes('expired') ||
        errorResult.error.toLowerCase().includes('invalid access token')) {
        const action = await vscode.window.showErrorMessage(
          errorResult.message || 'Your Canvas API token has expired. Please update your credentials.',
          'Update Token'
        )
        if (action === 'Update Token') {
          await vscode.commands.executeCommand('canvas-author.configureCanvas')
        }
        return undefined
      }

      console.error('Failed to list courses:', errorResult.error)
      vscode.window.showErrorMessage(`Failed to list courses: ${errorResult.error}`)
      return undefined
    }

    // result is now directly the array of courses
    return result as Course[]
  } catch (error) {
    console.error('Failed to list courses:', error)

    // Check if the error message indicates auth issues
    const errorMessage = error instanceof Error ? error.message : String(error)
    if (errorMessage.toLowerCase().includes('expired') ||
      errorMessage.toLowerCase().includes('invalid access token') ||
      errorMessage.toLowerCase().includes('401')) {
      const action = await vscode.window.showErrorMessage(
        'Your Canvas API token has expired. Please update your credentials.',
        'Update Token'
      )
      if (action === 'Update Token') {
        await vscode.commands.executeCommand('canvas-author.configureCanvas')
      }
    } else {
      vscode.window.showErrorMessage(`Failed to connect to Canvas: ${errorMessage}`)
    }
    return undefined
  }
}

async function pullModules(item?: CourseTreeItem) {
  // Check Canvas connection
  if (!await requireCanvasConnection(extensionContext, 'pull modules from Canvas')) {
    return
  }

  const coursePath = getCoursePath(item)
  if (!coursePath) {
    vscode.window.showErrorMessage('Please select a course or open a folder')
    return
  }

  const courseId = await getCourseId(item)
  if (!courseId) {
    vscode.window.showErrorMessage('Could not determine course ID. Please check .canvas.json')
    return
  }

  try {
    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Pulling modules from Canvas...',
      cancellable: false
    }, async () => {
      return await mcpClient?.callTool<PullModulesResponse>('pull_modules', {
        course_id: courseId,
        output_dir: coursePath
      })
    })

    const moduleCount = result?.modules_count ?? 0
    const itemCount = result?.items_count ?? 0
    vscode.window.showInformationMessage(
      `Pulled ${moduleCount} modules with ${itemCount} items to modules.yaml`
    )
    courseTreeProvider.refresh()
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to pull modules: ${error}`)
  }
}

async function pushModules(item?: CourseTreeItem) {
  // Check Canvas connection
  if (!await requireCanvasConnection(extensionContext, 'push modules to Canvas')) {
    return
  }

  const coursePath = getCoursePath(item)
  if (!coursePath) {
    vscode.window.showErrorMessage('Please select a course or open a folder')
    return
  }

  const courseId = await getCourseId(item)
  if (!courseId) {
    vscode.window.showErrorMessage('Could not determine course ID. Please check .canvas.json')
    return
  }

  // Ask about delete behavior
  const deleteChoice = await vscode.window.showQuickPick([
    { label: 'Keep', description: 'Keep modules in Canvas that are not in local file', value: false },
    { label: 'Delete', description: 'Delete modules in Canvas that are not in local file', value: true }
  ], {
    placeHolder: 'What to do with modules in Canvas not in modules.yaml?'
  })

  if (!deleteChoice) {
    return
  }

  try {
    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Pushing modules to Canvas...',
      cancellable: false
    }, async () => {
      return await mcpClient?.callTool<PushModulesResponse>('push_modules', {
        course_id: courseId,
        input_dir: coursePath,
        delete_missing: deleteChoice.value
      })
    })

    const created = result?.created?.length ?? 0
    const updated = result?.updated?.length ?? 0
    const deleted = result?.deleted?.length ?? 0
    const errors = result?.errors?.length ?? 0

    let message = `Modules: ${created} created, ${updated} updated`
    if (deleted > 0) {
      message += `, ${deleted} deleted`
    }
    if (errors > 0) {
      message += ` (${errors} errors)`
      vscode.window.showWarningMessage(message)
    } else {
      vscode.window.showInformationMessage(message)
    }
    courseTreeProvider.refresh()
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to push modules: ${error}`)
  }
}

async function showModuleStatus(item?: CourseTreeItem) {
  // Check Canvas connection
  if (!await requireCanvasConnection(extensionContext, 'check module status with Canvas')) {
    return
  }

  const coursePath = getCoursePath(item)
  if (!coursePath) {
    vscode.window.showErrorMessage('Please select a course or open a folder')
    return
  }

  const courseId = await getCourseId(item)
  if (!courseId) {
    vscode.window.showErrorMessage('Could not determine course ID. Please check .canvas.json')
    return
  }

  try {
    const result = await mcpClient?.callTool<ModuleStatusResponse>('module_sync_status', {
      course_id: courseId,
      local_dir: coursePath
    })

    const channel = vscode.window.createOutputChannel('Canvas Author')
    channel.clear()
    channel.appendLine('Canvas Module Sync Status')
    channel.appendLine('=========================')
    channel.appendLine('')

    const summary = result?.summary
    if (summary) {
      channel.appendLine(`Synced: ${summary.synced_count}`)
      channel.appendLine(`Canvas only: ${summary.canvas_only_count}`)
      channel.appendLine(`Local only: ${summary.local_only_count}`)
      channel.appendLine('')
    }

    if (result?.synced && result.synced.length > 0) {
      channel.appendLine('Synced Modules:')
      for (const m of result.synced) {
        channel.appendLine(`  + ${m.name}`)
      }
      channel.appendLine('')
    }

    if (result?.canvas_only && result.canvas_only.length > 0) {
      channel.appendLine('Canvas Only (not in local):')
      for (const m of result.canvas_only) {
        channel.appendLine(`  > ${m.name}`)
      }
      channel.appendLine('')
    }

    if (result?.local_only && result.local_only.length > 0) {
      channel.appendLine('Local Only (not in Canvas):')
      for (const m of result.local_only) {
        channel.appendLine(`  < ${m.name}`)
      }
    }

    channel.show()
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to get module status: ${error}`)
  }
}

async function pullQuizzes(item?: CourseTreeItem) {
  // Check Canvas connection
  if (!await requireCanvasConnection(extensionContext, 'pull quizzes from Canvas')) {
    return
  }

  const coursePath = getCoursePath(item)
  if (!coursePath) {
    vscode.window.showErrorMessage('Please select a course or open a folder')
    return
  }

  const courseId = await getCourseId(item)
  if (!courseId) {
    vscode.window.showErrorMessage('Could not determine course ID. Please check .canvas.json')
    return
  }

  try {
    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Pulling quizzes from Canvas...',
      cancellable: false
    }, async () => {
      return await mcpClient?.callTool<PullQuizzesResponse>('pull_quizzes', {
        course_id: courseId,
        output_dir: coursePath
      })
    })

    const pulled = result?.pulled?.length ?? 0
    const skipped = result?.skipped?.length ?? 0
    const errors = result?.errors?.length ?? 0

    let message = `Pulled ${pulled} quizzes`
    if (skipped > 0) {
      message += `, ${skipped} skipped`
    }
    if (errors > 0) {
      message += ` (${errors} errors)`
      vscode.window.showWarningMessage(message)
    } else {
      vscode.window.showInformationMessage(message)
    }
    courseTreeProvider.refresh()
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to pull quizzes: ${error}`)
  }
}

async function pushQuizzes(item?: CourseTreeItem) {
  // Check Canvas connection
  if (!await requireCanvasConnection(extensionContext, 'push quizzes to Canvas')) {
    return
  }

  const coursePath = getCoursePath(item)
  if (!coursePath) {
    vscode.window.showErrorMessage('Please select a course or open a folder')
    return
  }

  const courseId = await getCourseId(item)
  if (!courseId) {
    vscode.window.showErrorMessage('Could not determine course ID. Please check .canvas.json')
    return
  }

  try {
    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Pushing quizzes to Canvas...',
      cancellable: false
    }, async () => {
      return await mcpClient?.callTool<PushQuizzesResponse>('push_quizzes', {
        course_id: courseId,
        input_dir: coursePath
      })
    })

    const created = result?.created?.length ?? 0
    const updated = result?.updated?.length ?? 0
    const errors = result?.errors?.length ?? 0

    let message = `Quizzes: ${created} created, ${updated} updated`
    if (errors > 0) {
      message += ` (${errors} errors)`
      vscode.window.showWarningMessage(message)
    } else {
      vscode.window.showInformationMessage(message)
    }
    courseTreeProvider.refresh()
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to push quizzes: ${error}`)
  }
}

async function pullRubrics(item?: CourseTreeItem) {
  // Check Canvas connection
  if (!await requireCanvasConnection(extensionContext, 'pull rubrics from Canvas')) {
    return
  }

  const coursePath = getCoursePath(item)
  if (!coursePath) {
    vscode.window.showErrorMessage('Please select a course or open a folder')
    return
  }

  const courseId = await getCourseId(item)
  if (!courseId) {
    vscode.window.showErrorMessage('Could not determine course ID. Please check .canvas.json')
    return
  }

  try {
    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Pulling rubrics from Canvas...',
      cancellable: false
    }, async () => {
      return await mcpClient?.callTool<PullRubricsResponse>('pull_rubrics', {
        course_id: courseId,
        output_dir: coursePath
      })
    })

    const pulled = result?.pulled?.length ?? 0
    const skipped = result?.skipped?.length ?? 0
    const noRubric = result?.no_rubric?.length ?? 0
    const errors = result?.errors?.length ?? 0

    let message = `Pulled ${pulled} rubrics`
    if (skipped > 0) {
      message += `, ${skipped} skipped`
    }
    if (noRubric > 0) {
      message += ` (${noRubric} assignments have no rubric)`
    }
    if (errors > 0) {
      message += ` (${errors} errors)`
      vscode.window.showWarningMessage(message)
    } else {
      vscode.window.showInformationMessage(message)
    }
    courseTreeProvider.refresh()
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to pull rubrics: ${error}`)
  }
}

async function pushRubrics(item?: CourseTreeItem) {
  // Check Canvas connection
  if (!await requireCanvasConnection(extensionContext, 'push rubrics to Canvas')) {
    return
  }

  const coursePath = getCoursePath(item)
  if (!coursePath) {
    vscode.window.showErrorMessage('Please select a course or open a folder')
    return
  }

  const courseId = await getCourseId(item)
  if (!courseId) {
    vscode.window.showErrorMessage('Could not determine course ID. Please check .canvas.json')
    return
  }

  try {
    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Pushing rubrics to Canvas...',
      cancellable: false
    }, async () => {
      return await mcpClient?.callTool<PushRubricsResponse>('push_rubrics', {
        course_id: courseId,
        input_dir: coursePath
      })
    })

    const created = result?.created?.length ?? 0
    const updated = result?.updated?.length ?? 0
    const skipped = result?.skipped?.length ?? 0
    const errors = result?.errors?.length ?? 0

    let message = `Rubrics: ${created} created, ${updated} updated`
    if (skipped > 0) {
      message += `, ${skipped} skipped`
    }
    if (errors > 0) {
      message += ` (${errors} errors)`
      vscode.window.showWarningMessage(message)
    } else {
      vscode.window.showInformationMessage(message)
    }
    courseTreeProvider.refresh()
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to push rubrics: ${error}`)
  }
}

async function showRubricStatus(item?: CourseTreeItem) {
  // Check Canvas connection
  if (!await requireCanvasConnection(extensionContext, 'check rubric status with Canvas')) {
    return
  }

  const coursePath = getCoursePath(item)
  if (!coursePath) {
    vscode.window.showErrorMessage('Please select a course or open a folder')
    return
  }

  const courseId = await getCourseId(item)
  if (!courseId) {
    vscode.window.showErrorMessage('Could not determine course ID. Please check .canvas.json')
    return
  }

  try {
    const result = await mcpClient?.callTool<RubricStatusResponse>('rubric_sync_status', {
      course_id: courseId,
      local_dir: coursePath
    })

    const channel = vscode.window.createOutputChannel('Canvas Author')
    channel.clear()
    channel.appendLine('Canvas Rubric Sync Status')
    channel.appendLine('=========================')
    channel.appendLine('')

    const summary = result?.summary
    if (summary) {
      channel.appendLine(`Synced: ${summary.synced_count}`)
      channel.appendLine(`Canvas only: ${summary.canvas_only_count}`)
      channel.appendLine(`Local only: ${summary.local_only_count}`)
      channel.appendLine('')
    }

    if (result?.synced && result.synced.length > 0) {
      channel.appendLine('Synced Rubrics:')
      for (const r of result.synced) {
        channel.appendLine(`  + ${r.assignment_name}`)
      }
      channel.appendLine('')
    }

    if (result?.canvas_only && result.canvas_only.length > 0) {
      channel.appendLine('Canvas Only (not in local):')
      for (const r of result.canvas_only) {
        channel.appendLine(`  > ${r.assignment_name}`)
      }
      channel.appendLine('')
    }

    if (result?.local_only && result.local_only.length > 0) {
      channel.appendLine('Local Only (not in Canvas):')
      for (const r of result.local_only) {
        channel.appendLine(`  < ${r.assignment_name}`)
      }
    }

    channel.show()
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to get rubric status: ${error}`)
  }
}

async function pullDiscussions(item?: CourseTreeItem) {
  // Check Canvas connection
  if (!await requireCanvasConnection(extensionContext, 'pull discussions from Canvas')) {
    return
  }

  const coursePath = getCoursePath(item)
  if (!coursePath) {
    vscode.window.showErrorMessage('Please select a course or open a folder')
    return
  }

  const courseId = await getCourseId(item)
  if (!courseId) {
    vscode.window.showErrorMessage('Could not determine course ID. Please check .canvas.json')
    return
  }

  try {
    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Pulling discussions from Canvas...',
      cancellable: false
    }, async () => {
      return await mcpClient?.callTool<PullDiscussionsResponse>('pull_discussions', {
        course_id: courseId,
        output_dir: coursePath
      })
    })

    const pulled = result?.pulled?.length ?? 0
    const skipped = result?.skipped?.length ?? 0
    const errors = result?.errors?.length ?? 0

    let message = `Pulled ${pulled} discussions`
    if (skipped > 0) {
      message += `, ${skipped} skipped`
    }
    if (errors > 0) {
      message += ` (${errors} errors)`
      vscode.window.showWarningMessage(message)
    } else {
      vscode.window.showInformationMessage(message)
    }
    courseTreeProvider.refresh()
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to pull discussions: ${error}`)
  }
}

async function pushDiscussions(item?: CourseTreeItem) {
  // Check Canvas connection
  if (!await requireCanvasConnection(extensionContext, 'push discussions to Canvas')) {
    return
  }

  const coursePath = getCoursePath(item)
  if (!coursePath) {
    vscode.window.showErrorMessage('Please select a course or open a folder')
    return
  }

  const courseId = await getCourseId(item)
  if (!courseId) {
    vscode.window.showErrorMessage('Could not determine course ID. Please check .canvas.json')
    return
  }

  try {
    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Pushing discussions to Canvas...',
      cancellable: false
    }, async () => {
      return await mcpClient?.callTool<PushDiscussionsResponse>('push_discussions', {
        course_id: courseId,
        input_dir: coursePath
      })
    })

    const created = result?.created?.length ?? 0
    const updated = result?.updated?.length ?? 0
    const skipped = result?.skipped?.length ?? 0
    const errors = result?.errors?.length ?? 0

    let message = `Discussions: ${created} created, ${updated} updated`
    if (skipped > 0) {
      message += `, ${skipped} skipped`
    }
    if (errors > 0) {
      message += ` (${errors} errors)`
      vscode.window.showWarningMessage(message)
    } else {
      vscode.window.showInformationMessage(message)
    }
    courseTreeProvider.refresh()
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to push discussions: ${error}`)
  }
}

async function showDiscussionStatus(item?: CourseTreeItem) {
  // Check Canvas connection
  if (!await requireCanvasConnection(extensionContext, 'check discussion status with Canvas')) {
    return
  }

  const coursePath = getCoursePath(item)
  if (!coursePath) {
    vscode.window.showErrorMessage('Please select a course or open a folder')
    return
  }

  const courseId = await getCourseId(item)
  if (!courseId) {
    vscode.window.showErrorMessage('Could not determine course ID. Please check .canvas.json')
    return
  }

  try {
    const result = await mcpClient?.callTool<DiscussionStatusResponse>('discussion_sync_status', {
      course_id: courseId,
      local_dir: coursePath
    })

    const channel = vscode.window.createOutputChannel('Canvas Author')
    channel.clear()
    channel.appendLine('Canvas Discussion Sync Status')
    channel.appendLine('=============================')
    channel.appendLine('')

    const summary = result?.summary
    if (summary) {
      channel.appendLine(`Synced: ${summary.synced_count}`)
      channel.appendLine(`Canvas only: ${summary.canvas_only_count}`)
      channel.appendLine(`Local only: ${summary.local_only_count}`)
      channel.appendLine('')
    }

    if (result?.synced && result.synced.length > 0) {
      channel.appendLine('Synced Discussions:')
      for (const d of result.synced) {
        channel.appendLine(`  + ${d.title}`)
      }
      channel.appendLine('')
    }

    if (result?.canvas_only && result.canvas_only.length > 0) {
      channel.appendLine('Canvas Only (not in local):')
      for (const d of result.canvas_only) {
        channel.appendLine(`  > ${d.title}`)
      }
      channel.appendLine('')
    }

    if (result?.local_only && result.local_only.length > 0) {
      channel.appendLine('Local Only (not in Canvas):')
      for (const d of result.local_only) {
        channel.appendLine(`  < ${d.title}`)
      }
    }

    channel.show()
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to get discussion status: ${error}`)
  }
}

async function pullAnnouncements(item?: CourseTreeItem) {
  // Check Canvas connection
  if (!await requireCanvasConnection(extensionContext, 'pull announcements from Canvas')) {
    return
  }

  const coursePath = getCoursePath(item)
  if (!coursePath) {
    vscode.window.showErrorMessage('Please select a course or open a folder')
    return
  }

  const courseId = await getCourseId(item)
  if (!courseId) {
    vscode.window.showErrorMessage('Could not determine course ID. Please check .canvas.json')
    return
  }

  try {
    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Pulling announcements from Canvas...',
      cancellable: false
    }, async () => {
      return await mcpClient?.callTool<PullAnnouncementsResponse>('pull_announcements', {
        course_id: courseId,
        output_dir: coursePath,
        limit: 50
      })
    })

    const pulled = result?.pulled?.length ?? 0
    const skipped = result?.skipped?.length ?? 0
    const errors = result?.errors?.length ?? 0

    let message = `Pulled ${pulled} announcements`
    if (skipped > 0) {
      message += `, ${skipped} skipped`
    }
    if (errors > 0) {
      message += ` (${errors} errors)`
      vscode.window.showWarningMessage(message)
    } else {
      vscode.window.showInformationMessage(message)
    }
    courseTreeProvider.refresh()
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to pull announcements: ${error}`)
  }
}

async function pushAnnouncements(item?: CourseTreeItem) {
  // Check Canvas connection
  if (!await requireCanvasConnection(extensionContext, 'push announcements to Canvas')) {
    return
  }

  const coursePath = getCoursePath(item)
  if (!coursePath) {
    vscode.window.showErrorMessage('Please select a course or open a folder')
    return
  }

  const courseId = await getCourseId(item)
  if (!courseId) {
    vscode.window.showErrorMessage('Could not determine course ID. Please check .canvas.json')
    return
  }

  try {
    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Pushing announcements to Canvas...',
      cancellable: false
    }, async () => {
      return await mcpClient?.callTool<PushAnnouncementsResponse>('push_announcements', {
        course_id: courseId,
        input_dir: coursePath
      })
    })

    const created = result?.created?.length ?? 0
    const updated = result?.updated?.length ?? 0
    const skipped = result?.skipped?.length ?? 0
    const errors = result?.errors?.length ?? 0

    let message = `Announcements: ${created} created, ${updated} updated`
    if (skipped > 0) {
      message += `, ${skipped} skipped`
    }
    if (errors > 0) {
      message += ` (${errors} errors)`
      vscode.window.showWarningMessage(message)
    } else {
      vscode.window.showInformationMessage(message)
    }
    courseTreeProvider.refresh()
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to push announcements: ${error}`)
  }
}

async function createAnnouncement(item?: CourseTreeItem) {
  const coursePath = getCoursePath(item)
  if (!coursePath) {
    vscode.window.showErrorMessage('Please select a course first')
    return
  }

  const title = await vscode.window.showInputBox({
    prompt: 'Enter announcement title',
    placeHolder: 'Week 1 Overview'
  })

  if (!title) {
    return
  }

  // Create announcements directory if it doesn't exist
  const announcementsDir = path.join(coursePath, 'announcements')
  if (!fs.existsSync(announcementsDir)) {
    fs.mkdirSync(announcementsDir, { recursive: true })
  }

  // Generate filename with date prefix
  const today = new Date().toISOString().split('T')[0]
  const slug = title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-')
  const fileName = `${today}-${slug}.announcement.md`
  const filePath = path.join(announcementsDir, fileName)

  if (fs.existsSync(filePath)) {
    vscode.window.showErrorMessage(`Announcement already exists: ${fileName}`)
    return
  }

  const content = `---
title: ${title}
posted_at: null
published: false
---

# ${title}

Add your announcement content here.
`

  fs.writeFileSync(filePath, content)
  courseTreeProvider.refresh()

  // Open the file
  const doc = await vscode.workspace.openTextDocument(filePath)
  await vscode.window.showTextDocument(doc)

  vscode.window.showInformationMessage(`Created announcement: ${title}`)
}

async function previewQuiz(item?: CourseTreeItem, context?: vscode.ExtensionContext) {
  if (!context) {
    vscode.window.showErrorMessage('Extension context not available')
    return
  }

  let quizPath: string | undefined

  // If called from tree view with a quiz item
  if (item && item.resourcePath) {
    quizPath = item.resourcePath
  } else {
    // If called from command palette, use active editor
    const activeEditor = vscode.window.activeTextEditor
    if (activeEditor) {
      const filePath = activeEditor.document.uri.fsPath
      // Check if this is a quiz file (in quizzes folder or has quiz frontmatter)
      if (filePath.includes('/quizzes/') || filePath.includes('\\quizzes\\')) {
        quizPath = filePath
      } else {
        // Check frontmatter for quiz_id
        const content = activeEditor.document.getText()
        if (content.includes('quiz_id:') || content.includes('quiz_type:')) {
          quizPath = filePath
        }
      }
    }
  }

  if (!quizPath) {
    vscode.window.showErrorMessage('Please select a quiz file to preview')
    return
  }

  // Show the preview
  QuizPreviewPanel.createOrShow(context.extensionUri, quizPath)
}

async function previewRubric(context: vscode.ExtensionContext) {
  const activeEditor = vscode.window.activeTextEditor

  if (!activeEditor) {
    vscode.window.showErrorMessage('Please open a rubric file first')
    return
  }

  const filePath = activeEditor.document.uri.fsPath

  // Check if this is a rubric file
  if (!filePath.endsWith('.rubric.yaml')) {
    vscode.window.showErrorMessage('This command only works with .rubric.yaml files')
    return
  }

  // Extract assignment name from the file
  const fileName = path.basename(filePath, '.rubric.yaml')

  // Try to read assignment_name from the file content
  let assignmentName = fileName
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    const match = content.match(/assignment_name:\s*["']?([^"'\n]+)["']?/)
    if (match) {
      assignmentName = match[1]
    }
  } catch (error) {
    console.error('Failed to read rubric file:', error)
  }

  // Show the preview
  RubricPreviewPanel.createOrShow(context.extensionUri, filePath, assignmentName)
}

async function renameSubheader(item?: CourseTreeItem) {
  if (!item || !item.courseInfo || !item.moduleName || !item.isSubheader) {
    vscode.window.showErrorMessage('Invalid subheader item')
    return
  }

  const newTitle = await vscode.window.showInputBox({
    prompt: 'Enter new title for subheader',
    value: item.label,
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return 'Title cannot be empty'
      }
      return null
    }
  })

  if (!newTitle || newTitle === item.label) {
    return
  }

  const modulesPath = path.join(item.courseInfo.localPath, 'modules.yaml')
  if (!fs.existsSync(modulesPath)) {
    vscode.window.showErrorMessage('modules.yaml not found')
    return
  }

  try {
    const content = fs.readFileSync(modulesPath, 'utf8')
    const lines = content.split('\n')
    let inTargetModule = false
    let foundItem = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      
      // Check if we're entering the target module
      if (line.match(/^\s*-\s*name:\s*/)) {
        const moduleName = line.replace(/^\s*-\s*name:\s*['"]?/, '').replace(/['"]?\s*$/, '')
        inTargetModule = moduleName === item.moduleName
      }

      // If in the target module and found a subheader with the old title
      if (inTargetModule && line.match(/^\s*-\s*title:\s*/)) {
        const currentTitle = line.replace(/^\s*-\s*title:\s*/, '').trim()
        if (currentTitle === item.label || currentTitle === `"${item.label}"` || currentTitle === `'${item.label}'`) {
          // Check if next line is type: SubHeader or type: subheader
          if (i + 1 < lines.length) {
            const nextLine = lines[i + 1]
            if (nextLine.match(/^\s*type:\s*(SubHeader|subheader)/i)) {
              // Update the title
              const indent = line.match(/^\s*/)?.[0] || '  '
              lines[i] = `${indent}- title: ${newTitle}`
              foundItem = true
              break
            }
          }
        }
      }
    }

    if (foundItem) {
      fs.writeFileSync(modulesPath, lines.join('\n'))
      vscode.window.showInformationMessage(`Subheader renamed to "${newTitle}"`)
      courseTreeProvider.refresh()
    } else {
      vscode.window.showWarningMessage('Could not find subheader in modules.yaml')
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to rename subheader: ${error}`)
  }
}

async function editModules(item?: CourseTreeItem, context?: vscode.ExtensionContext) {
  if (!item || !item.courseInfo) {
    vscode.window.showErrorMessage('No course selected')
    return
  }

  const modulesPath = path.join(item.courseInfo.localPath, 'modules.yaml')
  
  // Create modules.yaml if it doesn't exist
  if (!fs.existsSync(modulesPath)) {
    const createNew = await vscode.window.showInformationMessage(
      'No modules.yaml file found. Create one?',
      'Create',
      'Cancel'
    )
    if (createNew !== 'Create') {
      return
    }
    fs.writeFileSync(modulesPath, 'modules: []\n', 'utf8')
  }

  ModuleEditorPanel.createOrShow(extensionContext.extensionUri, modulesPath, item.courseInfo.name)
}

async function approveAndMergeWorktree(item?: CourseTreeItem) {
  /**
   * Approve all reviews for a worktree and merge it back to main branch.
   * Deletes the worktree and archives review history.
   */
  const coursePath = getCoursePath(item)
  if (!coursePath) {
    vscode.window.showErrorMessage('Please select a course or open a folder')
    return
  }

  try {
    // Get list of worktrees
    const { execSync } = require('child_process')
    const worktreeOutput = execSync('git worktree list --porcelain', {
      cwd: coursePath,
      encoding: 'utf8'
    })

    const worktrees: string[] = []
    for (const line of worktreeOutput.split('\n').filter((l: string) => l.trim())) {
      if (line.startsWith('worktree ')) {
        const worktreePath = line.substring(9)
        const worktreeName = path.basename(worktreePath)
        worktrees.push(worktreeName)
      }
    }

    if (worktrees.length === 0) {
      vscode.window.showInformationMessage('No active worktrees found')
      return
    }

    // If called from a worktree item, pre-select it
    let selectedWorktree = item?.worktreeName
    
    // If not pre-selected, let user select which worktree to merge
    if (!selectedWorktree) {
      selectedWorktree = await vscode.window.showQuickPick(worktrees, {
        placeHolder: 'Select a worktree to approve and merge'
      })
    }

    if (!selectedWorktree) {
      return
    }

    // Show confirmation dialog
    const confirmMerge = await vscode.window.showWarningMessage(
      `Merge worktree "${selectedWorktree}" to main and delete it?`,
      'Merge & Delete',
      'Cancel'
    )

    if (confirmMerge !== 'Merge & Delete') {
      return
    }

    // Call MCP tool to approve and merge
    const result = await mcpClient?.callTool('approve_and_merge_worktree', {
      course_path: coursePath,
      worktree_name: selectedWorktree,
      approved_by_agent_id: 'human-approver',
      review_summary: 'Approved by human reviewer'
    }) as any

    if (result && result.status === 'success') {
      vscode.window.showInformationMessage(
        `✓ Successfully merged worktree "${selectedWorktree}" to main.\nReviews archived. Check Canvas sync status.`,
        'Check Canvas Sync'
      ).then(selection => {
        if (selection === 'Check Canvas Sync') {
          showStatus(item)
        }
      })

      // Refresh tree
      if (courseTreeProvider && 'refreshCourses' in courseTreeProvider) {
        (courseTreeProvider as any).refreshCourses()
      }
    } else if (result && result.status === 'merge_conflict') {
      vscode.window.showErrorMessage(
        `Merge conflict detected in worktree "${selectedWorktree}".\nResolve conflicts in git and try again.`
      )
    } else {
      vscode.window.showErrorMessage(`Failed to merge worktree: ${result && result.error ? result.error : 'Unknown error'}`)
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Error: ${error}`)
  }
}

async function importWorktreesFromFolder() {
  /**
   * Scan local .canvas-author/worktrees/ directory and attach any worktrees found.
   * Worktrees created by agents are stored here (gitignored).
   */
  const { execSync } = require('child_process')
  
  // Try to detect current workspace as repo root
  let repoRoot: string | undefined
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    const wsFolder = vscode.workspace.workspaceFolders[0].uri.fsPath
    if (fs.existsSync(path.join(wsFolder, '.git'))) {
      repoRoot = wsFolder
    }
  }

  // If no workspace repo found, ask user to select
  if (!repoRoot) {
    const repoUri = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Select Repository Root'
    })

    if (!repoUri || repoUri.length === 0) {
      return
    }

    repoRoot = repoUri[0].fsPath
  }

  // Validate that it's a git repository
  if (!fs.existsSync(path.join(repoRoot, '.git'))) {
    vscode.window.showErrorMessage(`Selected folder is not a git repository: ${repoRoot}`)
    return
  }

  // Check for local worktrees directory
  const worktreesRoot = path.join(repoRoot, '.canvas-author', 'worktrees')
  if (!fs.existsSync(worktreesRoot)) {
    vscode.window.showInformationMessage(`No .canvas-author/worktrees directory found in ${repoRoot}`)
    return
  }

  try {
    // Current registered worktrees
    let listOut: string
    try {
      listOut = execSync('git worktree list --porcelain', { cwd: repoRoot, encoding: 'utf8' })
    } catch (gitError) {
      const msg = gitError instanceof Error ? gitError.message : String(gitError)
      vscode.window.showErrorMessage(`Failed to list git worktrees in ${repoRoot}: ${msg}`)
      return
    }
    
    const registeredPaths = new Set<string>()
    for (const line of listOut.split('\n')) {
      if (line.startsWith('worktree ')) {
        registeredPaths.add(line.substring(9).trim())
      }
    }

    // Iterate subdirectories under .canvas-author/worktrees/
    const entries = fs.readdirSync(worktreesRoot, { withFileTypes: true })
    const attached: string[] = []
    const already: string[] = []
    const skipped: string[] = []
    const errors: string[] = []

    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      const wtPath = path.join(worktreesRoot, ent.name)

      // If already registered, skip
      if (registeredPaths.has(wtPath)) {
        already.push(wtPath)
        continue
      }

      // Detect branch from HEAD
      let branch: string | undefined
      try {
        const headFilePath = path.join(wtPath, '.git', 'HEAD')
        if (fs.existsSync(headFilePath)) {
          const head = fs.readFileSync(headFilePath, 'utf8').trim()
          const m = head.match(/^ref:\s*refs\/heads\/(.+)$/)
          if (m) branch = m[1]
        } else {
          // Worktree layout may be a .git file pointing to gitdir
          const dotGit = path.join(wtPath, '.git')
          if (fs.existsSync(dotGit) && fs.statSync(dotGit).isFile()) {
            const content = fs.readFileSync(dotGit, 'utf8')
            // If it's a worktree already, it should point to repo .git/worktrees
            if (/gitdir:\s*/.test(content)) {
              already.push(wtPath)
              continue
            }
          }
        }
      } catch (e) {
        // Could not read HEAD
      }

      if (!branch) {
        skipped.push(wtPath)
        continue
      }

      // Attach as worktree to repo
      try {
        execSync(`git worktree add --force "${wtPath}" "${branch}"`, { cwd: repoRoot, stdio: 'pipe' })
        attached.push(`${ent.name} ← ${branch}`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        errors.push(`${ent.name}: ${msg}`)
      }
    }

    const lines: string[] = []
    if (attached.length) lines.push(`Attached: ${attached.length}\n` + attached.map(a => `  + ${a}`).join('\n'))
    if (already.length) lines.push(`Already registered: ${already.length}\n` + already.map(a => `  = ${a}`).join('\n'))
    if (skipped.length) lines.push(`Skipped (no branch detected): ${skipped.length}\n` + skipped.map(a => `  ~ ${a}`).join('\n'))
    if (errors.length) lines.push(`Errors: ${errors.length}\n` + errors.map(a => `  ! ${a}`).join('\n'))

    vscode.window.showInformationMessage(`Import complete. Attached ${attached.length}, already registered ${already.length}, skipped ${skipped.length}.`)

    const channel = vscode.window.createOutputChannel('Canvas Author')
    channel.clear()
    channel.appendLine('Import Worktrees Report')
    channel.appendLine('=======================')
    channel.appendLine(`Repository: ${repoRoot}`)
    channel.appendLine(`Local worktrees directory: ${worktreesRoot}`)
    channel.appendLine('')
    channel.appendLine(lines.join('\n\n'))
    channel.show()
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    vscode.window.showErrorMessage(`Failed to import worktrees: ${msg}`)
  }
}

async function pushWorktreeBranches() {
  /**
   * Push all worktree branches to remote so they can be pulled on another computer.
   */
  const { execSync } = require('child_process')
  
  // Try to detect current workspace as repo root
  let repoRoot: string | undefined
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    const wsFolder = vscode.workspace.workspaceFolders[0].uri.fsPath
    if (fs.existsSync(path.join(wsFolder, '.git'))) {
      repoRoot = wsFolder
    }
  }

  if (!repoRoot) {
    const repoUri = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Select Repository Root'
    })

    if (!repoUri || repoUri.length === 0) {
      return
    }

    repoRoot = repoUri[0].fsPath
  }

  if (!fs.existsSync(path.join(repoRoot, '.git'))) {
    vscode.window.showErrorMessage(`Selected folder is not a git repository: ${repoRoot}`)
    return
  }

  try {
    // Get all worktrees and their branches
    const listOut = execSync('git worktree list --porcelain', { cwd: repoRoot, encoding: 'utf8' })
    const worktrees: Array<{ path: string, branch: string }> = []
    
    let currentWorktree: any = {}
    for (const line of listOut.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (currentWorktree.path) {
          worktrees.push(currentWorktree)
        }
        currentWorktree = { path: line.substring(9).trim() }
      } else if (line.startsWith('branch ')) {
        currentWorktree.branch = line.substring(7).trim().replace('refs/heads/', '')
      }
    }
    if (currentWorktree.path) {
      worktrees.push(currentWorktree)
    }

    // Filter to only worktrees (not main)
    const worktreeBranches = worktrees
      .filter(wt => wt.branch && wt.branch !== 'main' && wt.branch !== 'master')
      .map(wt => wt.branch)

    if (worktreeBranches.length === 0) {
      vscode.window.showInformationMessage('No worktree branches to push')
      return
    }

    // Show confirmation
    const confirm = await vscode.window.showInformationMessage(
      `Push ${worktreeBranches.length} worktree branch(es) to remote?\n${worktreeBranches.join(', ')}`,
      'Push',
      'Cancel'
    )

    if (confirm !== 'Push') {
      return
    }

    // Push each branch
    const pushed: string[] = []
    const errors: string[] = []

    for (const branch of worktreeBranches) {
      try {
        execSync(`git push origin ${branch}`, { cwd: repoRoot, stdio: 'pipe' })
        pushed.push(branch)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        errors.push(`${branch}: ${msg}`)
      }
    }

    const channel = vscode.window.createOutputChannel('Canvas Author')
    channel.clear()
    channel.appendLine('Push Worktree Branches')
    channel.appendLine('=====================')
    channel.appendLine(`Repository: ${repoRoot}`)
    channel.appendLine('')
    if (pushed.length) {
      channel.appendLine(`Pushed ${pushed.length} branches:`)
      pushed.forEach(b => channel.appendLine(`  ✓ ${b}`))
    }
    if (errors.length) {
      channel.appendLine('')
      channel.appendLine(`Errors (${errors.length}):`)
      errors.forEach(e => channel.appendLine(`  ✗ ${e}`))
    }
    channel.show()

    vscode.window.showInformationMessage(`Pushed ${pushed.length} worktree branch(es) to remote`)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    vscode.window.showErrorMessage(`Failed to push worktree branches: ${msg}`)
  }
}

async function pullWorktreeBranches() {
  /**
   * Pull worktree branches from remote and recreate them as local worktrees.
   */
  const { execSync } = require('child_process')
  
  // Try to detect current workspace as repo root
  let repoRoot: string | undefined
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    const wsFolder = vscode.workspace.workspaceFolders[0].uri.fsPath
    if (fs.existsSync(path.join(wsFolder, '.git'))) {
      repoRoot = wsFolder
    }
  }

  if (!repoRoot) {
    const repoUri = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Select Repository Root'
    })

    if (!repoUri || repoUri.length === 0) {
      return
    }

    repoRoot = repoUri[0].fsPath
  }

  if (!fs.existsSync(path.join(repoRoot, '.git'))) {
    vscode.window.showErrorMessage(`Selected folder is not a git repository: ${repoRoot}`)
    return
  }

  try {
    // Fetch from remote
    vscode.window.showInformationMessage('Fetching from remote...')
    execSync('git fetch origin', { cwd: repoRoot, stdio: 'pipe' })

    // Get remote branches
    const remoteBranchesOut = execSync('git branch -r', { cwd: repoRoot, encoding: 'utf8' })
    const remoteBranches = remoteBranchesOut
      .split('\n')
      .map((b: string) => b.trim())
      .filter((b: string) => b.startsWith('origin/') && !b.includes('HEAD') && !b.endsWith('/main') && !b.endsWith('/master'))
      .map((b: string) => b.replace('origin/', ''))

    if (remoteBranches.length === 0) {
      vscode.window.showInformationMessage('No remote worktree branches found')
      return
    }

    // Get existing local worktrees
    const listOut = execSync('git worktree list --porcelain', { cwd: repoRoot, encoding: 'utf8' })
    const existingBranches = new Set<string>()
    for (const line of listOut.split('\n')) {
      if (line.startsWith('branch ')) {
        const branch = line.substring(7).trim().replace('refs/heads/', '')
        existingBranches.add(branch)
      }
    }

    // Filter to branches not already checked out
    const branchesToPull = remoteBranches.filter((b: string) => !existingBranches.has(b))

    if (branchesToPull.length === 0) {
      vscode.window.showInformationMessage('All remote worktree branches are already checked out')
      return
    }

    // Show selection
    const selectedBranches = await vscode.window.showQuickPick(branchesToPull, {
      canPickMany: true,
      placeHolder: 'Select branches to recreate as local worktrees'
    })

    if (!selectedBranches || selectedBranches.length === 0) {
      return
    }

    // Create worktrees
    const worktreesDir = path.join(repoRoot, '.canvas-author', 'worktrees')
    fs.mkdirSync(worktreesDir, { recursive: true })

    const created: string[] = []
    const errors: string[] = []

    for (const branch of selectedBranches) {
      const wtPath = path.join(worktreesDir, branch)
      
      try {
        // Create local branch tracking remote
        try {
          execSync(`git branch ${branch} origin/${branch}`, { cwd: repoRoot, stdio: 'pipe' })
        } catch (e) {
          // Branch might already exist locally, that's ok
        }

        // Create worktree
        execSync(`git worktree add "${wtPath}" ${branch}`, { cwd: repoRoot, stdio: 'pipe' })
        created.push(branch)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        errors.push(`${branch}: ${msg}`)
      }
    }

    const channel = vscode.window.createOutputChannel('Canvas Author')
    channel.clear()
    channel.appendLine('Pull Worktree Branches')
    channel.appendLine('=====================')
    channel.appendLine(`Repository: ${repoRoot}`)
    channel.appendLine(`Worktrees directory: ${worktreesDir}`)
    channel.appendLine('')
    if (created.length) {
      channel.appendLine(`Created ${created.length} worktrees:`)
      created.forEach(b => channel.appendLine(`  ✓ ${b}`))
    }
    if (errors.length) {
      channel.appendLine('')
      channel.appendLine(`Errors (${errors.length}):`)
      errors.forEach(e => channel.appendLine(`  ✗ ${e}`))
    }
    channel.show()

    vscode.window.showInformationMessage(`Created ${created.length} worktree(s)`)
    
    // Refresh the tree
    vscode.commands.executeCommand('canvas-author.refreshCourses')
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    vscode.window.showErrorMessage(`Failed to pull worktree branches: ${msg}`)
  }
}

async function testMcpConnection() {
  const channel = vscode.window.createOutputChannel('Canvas Author - MCP Diagnostics')
  channel.clear()
  channel.show()

  channel.appendLine('Canvas Author MCP Diagnostics')
  channel.appendLine('============================\n')

  if (!mcpClient) {
    channel.appendLine('❌ MCP client not initialized')
    channel.appendLine('\nTroubleshooting:')
    channel.appendLine('1. Make sure Python is installed (python3 --version)')
    channel.appendLine('2. Install canvas-author package: pip install canvas-author')
    channel.appendLine('3. Check VS Code settings for canvas-author.pythonPath')
    channel.appendLine('4. View MCP server logs in "Canvas Author MCP" output channel')
    vscode.window.showErrorMessage('MCP client not initialized. Check "Canvas Author - MCP Diagnostics" output for details.')
    return
  }

  channel.appendLine('✓ MCP client initialized\n')

  try {
    channel.appendLine('Fetching available tools...\n')
    const toolsResult = await mcpClient.listTools() as any

    if (toolsResult?.tools && Array.isArray(toolsResult.tools)) {
      channel.appendLine(`Found ${toolsResult.tools.length} tools:\n`)

      const requiredTools = [
        'get_item_review_history',
        'approve_and_merge_worktree',
        'pull_pages',
        'push_pages',
        'pull_assignments',
        'push_assignments',
        'pull_quizzes',
        'push_quizzes',
        'pull_modules',
        'push_modules',
        'pull_rubrics',
        'push_rubrics',
        'pull_discussions',
        'push_discussions',
        'pull_announcements',
        'push_announcements'
      ]

      const availableToolNames = toolsResult.tools.map((t: any) => t.name)

      // Show all available tools
      for (const tool of toolsResult.tools) {
        const isRequired = requiredTools.includes(tool.name)
        const marker = isRequired ? '✓' : ' '
        channel.appendLine(`${marker} ${tool.name}`)
        if (tool.description) {
          channel.appendLine(`   ${tool.description}`)
        }
        channel.appendLine('')
      }

      // Check for missing required tools
      const missingTools = requiredTools.filter(t => !availableToolNames.includes(t))
      if (missingTools.length > 0) {
        channel.appendLine('\n⚠️  Missing optional tools (advanced features may not work):')
        for (const tool of missingTools) {
          channel.appendLine(`   - ${tool}`)
        }

        // Check if review tools are missing
        const reviewTools = ['get_item_review_history', 'approve_and_merge_worktree']
        const missingReviewTools = reviewTools.filter(t => !availableToolNames.includes(t))
        if (missingReviewTools.length > 0) {
          const config = vscode.workspace.getConfiguration('canvas-author')
          const reviewEnabled = config.get<boolean>('enableReviewWorkflow', true)

          channel.appendLine('\nReview Workflow Status:')
          if (reviewEnabled) {
            channel.appendLine('   ⚠️  Review workflow is ENABLED but tools are missing')
            channel.appendLine('   → Consider disabling: Settings → Canvas Author → Enable Review Workflow')
          } else {
            channel.appendLine('   ✓ Review workflow is disabled (recommended when tools unavailable)')
          }
        }
      } else {
        channel.appendLine('\n✓ All required tools are available!')

        const config = vscode.workspace.getConfiguration('canvas-author')
        const reviewEnabled = config.get<boolean>('enableReviewWorkflow', true)
        channel.appendLine(`\nReview Workflow: ${reviewEnabled ? 'Enabled ✓' : 'Disabled'}`)
        if (!reviewEnabled) {
          channel.appendLine('   To enable: Settings → Canvas Author → Enable Review Workflow')
        }
      }

      vscode.window.showInformationMessage(`MCP server OK: ${toolsResult.tools.length} tools available`)
    } else {
      channel.appendLine('⚠️  No tools returned from MCP server')
      channel.appendLine(`Raw response: ${JSON.stringify(toolsResult, null, 2)}`)
      vscode.window.showWarningMessage('MCP server responded but returned no tools')
    }
  } catch (error) {
    channel.appendLine(`\n❌ Error fetching tools: ${error}`)
    channel.appendLine('\nThis could mean:')
    channel.appendLine('1. MCP server crashed or failed to start')
    channel.appendLine('2. Communication error between extension and server')
    channel.appendLine('3. Check "Canvas Author MCP" output channel for server logs')
    vscode.window.showErrorMessage(`MCP connection test failed: ${error}`)
  }
}

