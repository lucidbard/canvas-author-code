import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { CanvasMcpClient } from './mcpClient'

// Sync status icons
const ICONS = {
  synced: new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed')),
  modified: new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground')),
  localOnly: new vscode.ThemeIcon('cloud-upload', new vscode.ThemeColor('gitDecoration.untrackedResourceForeground')),
  canvasOnly: new vscode.ThemeIcon('cloud-download', new vscode.ThemeColor('gitDecoration.deletedResourceForeground')),
  course: new vscode.ThemeIcon('book'),
  pages: new vscode.ThemeIcon('file-text'),
  quizzes: new vscode.ThemeIcon('tasklist'),
  assignments: new vscode.ThemeIcon('note'),
  modules: new vscode.ThemeIcon('list-tree'),
  rubrics: new vscode.ThemeIcon('checklist'),
  settings: new vscode.ThemeIcon('gear'),
  page: new vscode.ThemeIcon('markdown'),
  quiz: new vscode.ThemeIcon('question'),
  assignment: new vscode.ThemeIcon('edit'),
  module: new vscode.ThemeIcon('folder'),
  rubric: new vscode.ThemeIcon('list-ordered'),
  addCourse: new vscode.ThemeIcon('add')
}

export type SyncStatus = 'synced' | 'modified' | 'localOnly' | 'canvasOnly' | 'unknown'

export interface CourseInfo {
  id: string
  name: string
  courseCode: string
  localPath: string
  remoteUrl?: string
}

export interface CourseRegistry {
  courses: CourseInfo[]
  defaultStoragePath: string
}

export class CourseTreeItem extends vscode.TreeItem {
  public externalUrl?: string  // For external URL module items

  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly itemType: 'course' | 'category' | 'page' | 'quiz' | 'assignment' | 'module' | 'moduleItem' | 'rubric' | 'settings' | 'addCourse',
    public readonly courseInfo?: CourseInfo,
    public readonly resourcePath?: string,
    public readonly syncStatus?: SyncStatus,
    public readonly moduleName?: string  // For module items to know which module they belong to
  ) {
    super(label, collapsibleState)
    this.contextValue = itemType
    this.setIcon()
    this.setTooltip()
    this.setCommand()
  }

  private setIcon() {
    switch (this.itemType) {
      case 'course':
        this.iconPath = ICONS.course
        break
      case 'category':
        if (this.label === 'Pages') this.iconPath = ICONS.pages
        else if (this.label === 'Assignments') this.iconPath = ICONS.assignments
        else if (this.label === 'Quizzes') this.iconPath = ICONS.quizzes
        else if (this.label === 'Modules') this.iconPath = ICONS.modules
        else if (this.label === 'Rubrics') this.iconPath = ICONS.rubrics
        else if (this.label === 'Settings') this.iconPath = ICONS.settings
        break
      case 'page':
        this.iconPath = this.getSyncIcon() || ICONS.page
        break
      case 'assignment':
        this.iconPath = this.getSyncIcon() || ICONS.assignment
        break
      case 'quiz':
        this.iconPath = this.getSyncIcon() || ICONS.quiz
        break
      case 'rubric':
        this.iconPath = this.getSyncIcon() || ICONS.rubric
        break
      case 'module':
        this.iconPath = ICONS.module
        break
      case 'moduleItem':
        // Module items get icons based on their type (stored in description)
        if (this.description === 'page') this.iconPath = ICONS.page
        else if (this.description === 'assignment') this.iconPath = ICONS.assignment
        else if (this.description === 'quiz') this.iconPath = ICONS.quiz
        else if (this.description === 'discussion') this.iconPath = new vscode.ThemeIcon('comment-discussion')
        else if (this.description === 'external_url' || this.description === 'externalurl') this.iconPath = new vscode.ThemeIcon('link-external')
        else if (this.description === 'subheader') this.iconPath = new vscode.ThemeIcon('symbol-namespace')
        else this.iconPath = new vscode.ThemeIcon('circle-outline')
        break
      case 'settings':
        this.iconPath = ICONS.settings
        break
      case 'addCourse':
        this.iconPath = ICONS.addCourse
        break
    }
  }

  private getSyncIcon(): vscode.ThemeIcon | undefined {
    switch (this.syncStatus) {
      case 'synced': return ICONS.synced
      case 'modified': return ICONS.modified
      case 'localOnly': return ICONS.localOnly
      case 'canvasOnly': return ICONS.canvasOnly
      default: return undefined
    }
  }

  private setTooltip() {
    if (this.syncStatus) {
      const statusText: Record<SyncStatus, string> = {
        synced: 'Synced with Canvas',
        modified: 'Modified locally',
        localOnly: 'Local only - not in Canvas',
        canvasOnly: 'Canvas only - not downloaded',
        unknown: 'Sync status unknown'
      }
      this.tooltip = statusText[this.syncStatus] || this.label
    }
    if (this.resourcePath) {
      this.tooltip = `${this.tooltip || this.label}\n${this.resourcePath}`
    }
  }

  private setCommand() {
    if (this.itemType === 'settings') {
      // Settings uses a special command that handles file creation
      this.command = {
        command: 'canvas-author.openSettings',
        title: 'Open Settings',
        arguments: [this]
      }
    } else if (this.itemType === 'assignment' && this.resourcePath) {
      // Assignments use a custom command to potentially open with rubric
      this.command = {
        command: 'canvas-author.openAssignment',
        title: 'Open Assignment',
        arguments: [this]
      }
    } else if (this.itemType === 'quiz' && this.resourcePath) {
      // Quizzes use a custom preview command
      this.command = {
        command: 'canvas-author.previewQuiz',
        title: 'Preview Quiz',
        arguments: [this]
      }
    } else if (this.resourcePath && this.itemType === 'page') {
      // Open pages in markdown preview mode
      this.command = {
        command: 'markdown.showPreview',
        title: 'Open Preview',
        arguments: [vscode.Uri.file(this.resourcePath)]
      }
    } else if (this.resourcePath && this.itemType === 'moduleItem') {
      // Module items that are pages should also open in preview
      if (this.description === 'page') {
        this.command = {
          command: 'markdown.showPreview',
          title: 'Open Preview',
          arguments: [vscode.Uri.file(this.resourcePath)]
        }
      } else {
        this.command = {
          command: 'vscode.open',
          title: 'Open File',
          arguments: [vscode.Uri.file(this.resourcePath)]
        }
      }
    } else if (this.resourcePath && this.itemType === 'rubric') {
      this.command = {
        command: 'vscode.open',
        title: 'Open File',
        arguments: [vscode.Uri.file(this.resourcePath)]
      }
    } else if (this.itemType === 'moduleItem' && this.externalUrl) {
      // Open external URLs in simple browser
      this.command = {
        command: 'simpleBrowser.api.open',
        title: 'Open URL',
        arguments: [this.externalUrl, { viewColumn: vscode.ViewColumn.Beside }]
      }
    } else if (this.itemType === 'addCourse') {
      this.command = {
        command: 'canvas-author.addCourse',
        title: 'Add Course'
      }
    }
  }
}

export class CourseTreeProvider implements vscode.TreeDataProvider<CourseTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<CourseTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private registry: CourseRegistry
  private registryPath: string
  private fileWatchers: Map<string, vscode.FileSystemWatcher> = new Map();
  private mcpClient: CanvasMcpClient | undefined
  private syncedCategories: Set<string> = new Set(); // Track what's been synced this session
  private metadataCache: Map<string, any> = new Map(); // Cache for lightweight sync data
  private syncTimer: NodeJS.Timeout | undefined
  private gitWorktrees: Set<string> = new Set(); // Cached git worktree paths

  constructor(private context: vscode.ExtensionContext) {
    this.registryPath = path.join(this.getStoragePath(), 'registry.json')
    this.registry = this.loadRegistry()
    this.setupFileWatchers()
    // Set hasCourses context immediately from cached registry
    this.updateHasCoursesContext()
    // Start periodic lightweight sync every 5 minutes
    this.startPeriodicSync()
  }

  private startPeriodicSync() {
    // Do an initial sync after 10 seconds
    setTimeout(() => this.performLightweightSync(), 10000)

    // Then sync every 5 minutes
    this.syncTimer = setInterval(() => {
      this.performLightweightSync()
    }, 5 * 60 * 1000)
  }

  private async performLightweightSync() {
    if (!this.mcpClient || this.registry.courses.length === 0) {
      return
    }

    console.log('Performing lightweight metadata sync...')

    for (const course of this.registry.courses) {
      try {
        // Sync metadata for pages, quizzes, and assignments
        await this.syncCategoryMetadata(course, 'pages')
        await this.syncCategoryMetadata(course, 'quizzes')
        await this.syncCategoryMetadata(course, 'assignments')
      } catch (error) {
        console.error(`Lightweight sync failed for course ${course.id}:`, error)
      }
    }

    // Refresh the tree to show updated status
    this.refresh()
  }

  private async syncCategoryMetadata(course: CourseInfo, category: string) {
    try {
      let toolName = ''
      switch (category) {
        case 'pages':
          toolName = 'list_pages'
          break
        case 'quizzes':
          toolName = 'list_quizzes'
          break
        case 'assignments':
          toolName = 'list_assignments'
          break
        default:
          return
      }

      const result = await this.mcpClient?.callTool(toolName, { course_id: course.id })
      if (result) {
        const cacheKey = `${course.id}:${category}`
        this.metadataCache.set(cacheKey, result)
      }
    } catch (error) {
      console.error(`Failed to sync ${category} metadata:`, error)
    }
  }

  getMetadataForItem(courseId: string, category: string, itemId: string): any {
    const cacheKey = `${courseId}:${category}`
    const metadata = this.metadataCache.get(cacheKey)
    if (!metadata || !Array.isArray(metadata)) {
      return null
    }

    return metadata.find((item: any) =>
      item.page_id === itemId ||
      item.quiz_id === itemId ||
      item.assignment_id === itemId ||
      item.id === itemId
    )
  }

  private updateHasCoursesContext() {
    vscode.commands.executeCommand('setContext', 'canvas-author.hasCourses', this.registry.courses.length > 0)
  }

  setMcpClient(client: CanvasMcpClient | undefined) {
    this.mcpClient = client
  }

  getStoragePath(): string {
    return path.join(os.homedir(), '.canvas-author')
  }

  private loadRegistry(): CourseRegistry {
    const storagePath = this.getStoragePath()

    // Ensure storage directory exists
    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true })
    }

    if (fs.existsSync(this.registryPath)) {
      try {
        const data = fs.readFileSync(this.registryPath, 'utf8')
        return JSON.parse(data)
      } catch (e) {
        console.error('Failed to load registry:', e)
      }
    }

    return {
      courses: [],
      defaultStoragePath: path.join(storagePath, 'courses')
    }
  }

  saveRegistry() {
    try {
      fs.writeFileSync(this.registryPath, JSON.stringify(this.registry, null, 2))
    } catch (e) {
      console.error('Failed to save registry:', e)
    }
  }

  private setupFileWatchers() {
    // Watch for changes in registered course directories
    for (const course of this.registry.courses) {
      this.watchCourse(course.localPath)
    }
  }

  private watchCourse(coursePath: string) {
    if (this.fileWatchers.has(coursePath)) {
      return
    }

    const pattern = new vscode.RelativePattern(coursePath, '**/*.{md,yaml,json}')
    const watcher = vscode.workspace.createFileSystemWatcher(pattern)

    watcher.onDidChange(() => this.refresh())
    watcher.onDidCreate(() => this.refresh())
    watcher.onDidDelete(() => this.refresh())

    this.fileWatchers.set(coursePath, watcher)
  }

  refresh(): void {
    this.updateHasCoursesContext()
    this._onDidChangeTreeData.fire(undefined)
  }

  getTreeItem(element: CourseTreeItem): vscode.TreeItem {
    return element
  }

  async getChildren(element?: CourseTreeItem): Promise<CourseTreeItem[]> {
    if (!element) {
      // Root level: show courses and "Add Course" item
      return this.getCourses()
    }

    if (element.itemType === 'course' && element.courseInfo) {
      // Course level: show categories
      return this.getCourseCategories(element.courseInfo)
    }

    if (element.itemType === 'category' && element.courseInfo) {
      // Category level: show items
      return this.getCategoryItems(element.label, element.courseInfo)
    }

    if (element.itemType === 'module' && element.courseInfo) {
      // Module level: show module items
      return this.getModuleItemChildren(element.label, element.courseInfo)
    }

    return []
  }

  private getCourses(): CourseTreeItem[] {
    const items: CourseTreeItem[] = []

    // Add registered courses
    for (const course of this.registry.courses) {
      items.push(new CourseTreeItem(
        course.name,
        vscode.TreeItemCollapsibleState.Collapsed,
        'course',
        course
      ))
    }

    return items
  }

  private getCourseCategories(course: CourseInfo): CourseTreeItem[] {
    return [
      new CourseTreeItem('Pages', vscode.TreeItemCollapsibleState.Collapsed, 'category', course),
      new CourseTreeItem('Assignments', vscode.TreeItemCollapsibleState.Collapsed, 'category', course),
      new CourseTreeItem('Quizzes', vscode.TreeItemCollapsibleState.Collapsed, 'category', course),
      new CourseTreeItem('Modules', vscode.TreeItemCollapsibleState.Collapsed, 'category', course),
      new CourseTreeItem('Rubrics', vscode.TreeItemCollapsibleState.Collapsed, 'category', course),
      new CourseTreeItem('Settings', vscode.TreeItemCollapsibleState.None, 'settings', course,
        path.join(course.localPath, 'course.yaml'))
    ]
  }

  private async getCategoryItems(category: string, course: CourseInfo): Promise<CourseTreeItem[]> {
    let items: CourseTreeItem[] = []
    const coursePath = course.localPath
    const syncKey = `${course.id}:${category}`

    switch (category) {
      case 'Pages':
        items = await this.getPageItems(coursePath, course)
        // Auto-sync if empty and not already synced this session
        if (items.length === 0 && !this.syncedCategories.has(syncKey)) {
          await this.autoSyncCategory('pull_pages', course.id, coursePath, 'output_dir')
          this.syncedCategories.add(syncKey)
          items = await this.getPageItems(coursePath, course)
        }
        break
      case 'Assignments':
        items = await this.getAssignmentItems(coursePath, course)
        if (items.length === 0 && !this.syncedCategories.has(syncKey)) {
          await this.autoSyncCategory('pull_assignments', course.id, coursePath, 'output_dir')
          this.syncedCategories.add(syncKey)
          items = await this.getAssignmentItems(coursePath, course)
        }
        break
      case 'Quizzes':
        items = await this.getQuizItems(coursePath, course)
        if (items.length === 0 && !this.syncedCategories.has(syncKey)) {
          await this.autoSyncCategory('pull_quizzes', course.id, coursePath, 'output_dir')
          this.syncedCategories.add(syncKey)
          items = await this.getQuizItems(coursePath, course)
        }
        break
      case 'Modules':
        items = await this.getModuleItems(coursePath, course)
        if (items.length === 0 && !this.syncedCategories.has(syncKey)) {
          await this.autoSyncCategory('pull_modules', course.id, coursePath, 'output_dir')
          this.syncedCategories.add(syncKey)
          items = await this.getModuleItems(coursePath, course)
        }
        break
      case 'Rubrics':
        items = await this.getRubricItems(coursePath, course)
        if (items.length === 0 && !this.syncedCategories.has(syncKey)) {
          await this.autoSyncCategory('pull_rubrics', course.id, coursePath, 'output_dir')
          this.syncedCategories.add(syncKey)
          items = await this.getRubricItems(coursePath, course)
        }
        break
    }

    return items
  }

  private async autoSyncCategory(toolName: string, courseId: string, coursePath: string, dirParam: string): Promise<void> {
    if (!this.mcpClient) {
      console.log(`Auto-sync skipped for ${toolName}: no MCP client`)
      return
    }

    console.log(`Auto-sync starting: ${toolName} with course_id=${courseId}, ${dirParam}=${coursePath}`)

    try {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Syncing ${toolName.replace('pull_', '')} from Canvas...`,
        cancellable: false
      }, async () => {
        const result = await this.mcpClient?.callTool(toolName, {
          course_id: courseId,
          [dirParam]: coursePath
        })
        console.log(`Auto-sync result for ${toolName}:`, JSON.stringify(result))
        return result
      })
    } catch (error) {
      console.error(`Auto-sync failed for ${toolName}: ${error}`)
      vscode.window.showWarningMessage(`Failed to sync ${toolName.replace('pull_', '')}: ${error}`)
    }
  }

  private async getPageItems(coursePath: string, course: CourseInfo): Promise<CourseTreeItem[]> {
    const items: CourseTreeItem[] = []
    const seenPaths = new Set<string>()

    // Get git worktrees to exclude them
    const worktreeNames = this.getGitWorktrees(coursePath)
    const excludeDirs = ['quizzes', 'assignments', 'modules', 'rubrics', ...worktreeNames]

    // Check if there's a pages subdirectory
    const pagesDir = path.join(coursePath, 'pages')
    let mdFiles: string[] = []

    if (fs.existsSync(pagesDir)) {
      // If pages/ subdirectory exists, use files from there
      mdFiles = this.findFiles(pagesDir, '.md', [])
        .filter(f => !f.endsWith('.quiz.md'))
    } else {
      // Otherwise, find .md files in root course directory only (not subdirectories)
      // Exclude quizzes, assignments, modules, rubrics folders, git worktrees, and any .quiz.md files
      mdFiles = this.findFiles(coursePath, '.md', excludeDirs)
        .filter(f => !f.endsWith('.quiz.md') && path.dirname(f) === coursePath)
    }

    for (const file of mdFiles) {
      // Skip if we've already processed this file
      if (seenPaths.has(file)) {
        continue
      }
      seenPaths.add(file)

      const fileName = path.basename(file, '.md')
      const title = this.extractTitleFromFrontmatter(file) || fileName
      const status = await this.getFileSyncStatus(file, course)
      const published = this.extractPublishedStatus(file)
      const item = new CourseTreeItem(
        title,
        vscode.TreeItemCollapsibleState.None,
        'page',
        course,
        file,
        status
      )
      if (published !== null) {
        item.description = published ? '$(check) Published' : '$(circle-slash) Unpublished'
      }
      items.push(item)
    }

    return items
  }

  private async getAssignmentItems(coursePath: string, course: CourseInfo): Promise<CourseTreeItem[]> {
    const items: CourseTreeItem[] = []
    const assignmentsPath = path.join(coursePath, 'assignments')

    if (fs.existsSync(assignmentsPath)) {
      const assignmentFiles = this.findFiles(assignmentsPath, '.md')

      for (const file of assignmentFiles) {
        const fileName = path.basename(file, '.md')
        const title = this.extractTitleFromFrontmatter(file) || fileName
        const status = await this.getFileSyncStatus(file, course)
        const published = this.extractPublishedStatus(file)
        const assignmentId = this.extractAssignmentId(file)

        const item = new CourseTreeItem(
          title,
          vscode.TreeItemCollapsibleState.None,
          'assignment',
          course,
          file,
          status
        )

        // Get submission count from metadata if available
        let descriptionParts: string[] = []
        if (assignmentId) {
          const metadata = this.getMetadataForItem(course.id, 'assignments', assignmentId)
          if (metadata && metadata.submission_count !== undefined) {
            descriptionParts.push(`${metadata.submission_count} submissions`)
          }
        }
        if (published !== null) {
          descriptionParts.push(published ? '$(check)' : '$(circle-slash)')
        }
        if (descriptionParts.length > 0) {
          item.description = descriptionParts.join(' • ')
        }

        items.push(item)
      }
    }

    return items
  }

  private async getQuizItems(coursePath: string, course: CourseInfo): Promise<CourseTreeItem[]> {
    const items: CourseTreeItem[] = []
    const quizzesPath = path.join(coursePath, 'quizzes')

    // Look for .quiz.md files in the quizzes subfolder
    if (fs.existsSync(quizzesPath)) {
      const quizFiles = this.findFiles(quizzesPath, '.quiz.md')

      for (const file of quizFiles) {
        // Remove both .quiz.md extension
        const fileName = path.basename(file, '.quiz.md')
        const title = this.extractTitleFromFrontmatter(file) || fileName
        const status = await this.getFileSyncStatus(file, course)
        const published = this.extractPublishedStatus(file)

        const item = new CourseTreeItem(
          title,
          vscode.TreeItemCollapsibleState.None,
          'quiz',
          course,
          file,
          status
        )
        if (published !== null) {
          item.description = published ? '$(check) Published' : '$(circle-slash) Unpublished'
        }
        items.push(item)
      }
    }

    return items
  }

  private async getModuleItems(coursePath: string, course: CourseInfo): Promise<CourseTreeItem[]> {
    const items: CourseTreeItem[] = []
    const modulesPath = path.join(coursePath, 'modules.yaml')

    if (fs.existsSync(modulesPath)) {
      try {
        const content = fs.readFileSync(modulesPath, 'utf8')
        const modules = this.parseModulesYaml(content)

        for (const mod of modules) {
          const hasItems = mod.items && mod.items.length > 0
          items.push(new CourseTreeItem(
            mod.name,
            hasItems ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
            'module',
            course
          ))
        }
      } catch (e) {
        console.error('Failed to parse modules.yaml:', e)
      }
    }

    return items
  }

  private async getRubricItems(coursePath: string, course: CourseInfo): Promise<CourseTreeItem[]> {
    const items: CourseTreeItem[] = []
    const rubricsPath = path.join(coursePath, 'rubrics')

    if (!fs.existsSync(rubricsPath)) {
      return items
    }

    // Find all .rubric.yaml files
    const rubricFiles = this.findFiles(rubricsPath, '.rubric.yaml')

    for (const file of rubricFiles) {
      try {
        const content = fs.readFileSync(file, 'utf8')
        const rubricInfo = this.parseRubricYaml(content)
        const status = await this.getRubricSyncStatus(file, content)

        // Create label with assignment name and criteria count
        let label = rubricInfo.assignmentName || path.basename(file, '.rubric.yaml')
        if (rubricInfo.criteriaCount > 0) {
          label += ` (${rubricInfo.criteriaCount} criteria)`
        }

        const item = new CourseTreeItem(
          label,
          vscode.TreeItemCollapsibleState.None,
          'rubric',
          course,
          file,
          status
        )
        // Store assignment name in description for display
        if (rubricInfo.assignmentName) {
          item.description = `${rubricInfo.pointsPossible || 0} pts`
        }
        items.push(item)
      } catch (e) {
        console.error(`Failed to parse rubric file ${file}:`, e)
        // Still add the file even if parsing fails
        items.push(new CourseTreeItem(
          path.basename(file, '.rubric.yaml'),
          vscode.TreeItemCollapsibleState.None,
          'rubric',
          course,
          file,
          'unknown'
        ))
      }
    }

    return items
  }

  private parseRubricYaml(content: string): { assignmentName?: string; criteriaCount: number; pointsPossible?: number; rubricId?: string } {
    // Simple YAML parser for rubric structure
    const result: { assignmentName?: string; criteriaCount: number; pointsPossible?: number; rubricId?: string } = {
      criteriaCount: 0
    }

    // Extract assignment_name
    const nameMatch = content.match(/^assignment_name:\s*['"]?(.+?)['"]?\s*$/m)
    if (nameMatch) {
      result.assignmentName = nameMatch[1]
    }

    // Extract rubric.id
    const idMatch = content.match(/^\s+id:\s*['"]?(\d+)['"]?\s*$/m)
    if (idMatch) {
      result.rubricId = idMatch[1]
    }

    // Extract points_possible
    const pointsMatch = content.match(/^\s+points_possible:\s*(\d+(?:\.\d+)?)\s*$/m)
    if (pointsMatch) {
      result.pointsPossible = parseFloat(pointsMatch[1])
    }

    // Count criteria (lines that start with "  - id:" or "  - description:" under criteria)
    const criteriaMatches = content.match(/^\s{2,4}- (?:id:|description:)/gm)
    if (criteriaMatches) {
      result.criteriaCount = criteriaMatches.length
    }

    return result
  }

  private async getRubricSyncStatus(filePath: string, content: string): Promise<SyncStatus> {
    // Check if file has rubric.id in content (indicates it's been synced)
    if (content.includes('id:') && content.match(/^\s+id:\s*['"]?\d+['"]?\s*$/m)) {
      // Has a rubric ID, so it's been synced
      // TODO: Check if modified by comparing with Canvas
      return 'synced'
    }
    return 'localOnly'
  }

  private getModuleItemChildren(moduleName: string, course: CourseInfo): CourseTreeItem[] {
    const items: CourseTreeItem[] = []
    const modulesPath = path.join(course.localPath, 'modules.yaml')

    if (!fs.existsSync(modulesPath)) {
      return items
    }

    try {
      const content = fs.readFileSync(modulesPath, 'utf8')
      const modules = this.parseModulesYaml(content)
      const targetModule = modules.find(m => m.name === moduleName)

      if (targetModule && targetModule.items) {
        for (const item of targetModule.items) {
          const label = item.title || item.page_url || item.url || 'Unknown'
          const itemType = item.type || 'unknown'

          // Find the local file path if it's a page
          let resourcePath: string | undefined
          if (itemType === 'page' && item.page_url) {
            // Check pages/ subdirectory first, then fall back to root
            const pagesSubdirPath = path.join(course.localPath, 'pages', `${item.page_url}.md`)
            const rootPath = path.join(course.localPath, `${item.page_url}.md`)

            if (fs.existsSync(pagesSubdirPath)) {
              resourcePath = pagesSubdirPath
            } else if (fs.existsSync(rootPath)) {
              resourcePath = rootPath
            }
          }

          const treeItem = new CourseTreeItem(
            label,
            vscode.TreeItemCollapsibleState.None,
            'moduleItem',
            course,
            resourcePath,
            undefined,
            moduleName
          )
          // Store item type in description for icon selection
          treeItem.description = itemType
          // Set external URL for link items
          if (itemType === 'external_url' && item.url) {
            treeItem.externalUrl = item.url
          }
          items.push(treeItem)
        }
      }
    } catch (e) {
      console.error('Failed to parse module items:', e)
    }

    return items
  }

  private parseModulesYaml(content: string): Array<{ name: string; published?: boolean; items?: Array<{ type?: string; title?: string; page_url?: string; url?: string; content_id?: string }> }> {
    // Simple YAML parser for modules structure
    const modules: Array<{ name: string; published?: boolean; items?: Array<{ type?: string; title?: string; page_url?: string; url?: string; content_id?: string }> }> = []

    const lines = content.split('\n')
    let currentModule: { name: string; published?: boolean; items?: Array<{ type?: string; title?: string; page_url?: string; url?: string; content_id?: string }> } | null = null
    let currentItem: { type?: string; title?: string; page_url?: string; url?: string; content_id?: string } | null = null
    let inItems = false
    let inModulesList = false

    for (const line of lines) {
      // Check for modules: key at root level
      if (line.match(/^modules:\s*$/)) {
        inModulesList = true
        continue
      }

      // Module start - handle both root level (- name:) and nested under modules: (  - name:)
      const moduleMatch = line.match(/^-\s*name:\s*(.+)$/) || line.match(/^\s+-\s*name:\s*(.+)$/)
      if (moduleMatch) {
        if (currentItem && currentModule) {
          currentModule.items!.push(currentItem)
          currentItem = null
        }
        if (currentModule) {
          modules.push(currentModule)
        }
        let moduleName = moduleMatch[1].trim()
        // Remove surrounding quotes if present
        moduleName = moduleName.replace(/^["']|["']$/g, '')
        currentModule = { name: moduleName, items: [] }
        inItems = false
        continue
      }

      // Published field
      const publishedMatch = line.match(/^\s+published:\s*(true|false)\s*$/)
      if (publishedMatch && currentModule) {
        currentModule.published = publishedMatch[1] === 'true'
        continue
      }

      // Items start
      if (line.match(/^\s+items:\s*$/) && currentModule) {
        inItems = true
        currentModule.items = []
        continue
      }

      // Item start - type field
      const typeMatch = line.match(/^\s+-\s*type:\s*(.+)$/)
      if (typeMatch && currentModule && inItems) {
        if (currentItem) {
          currentModule.items!.push(currentItem)
        }
        // Normalize type to lowercase for consistency
        currentItem = { type: typeMatch[1].trim().toLowerCase() }
        continue
      }

      // Item properties
      if (currentItem && inItems) {
        const pageUrlMatch = line.match(/^\s+page_url:\s*(.+)$/)
        const titleMatch = line.match(/^\s+title:\s*(.+)$/)
        const urlMatch = line.match(/^\s+url:\s*(.+)$/)
        const contentIdMatch = line.match(/^\s+content_id:\s*(.+)$/)

        if (pageUrlMatch) {
          currentItem.page_url = pageUrlMatch[1].trim().replace(/^["']|["']$/g, '')
        }
        if (titleMatch) {
          currentItem.title = titleMatch[1].trim().replace(/^["']|["']$/g, '')
        }
        if (urlMatch) {
          currentItem.url = urlMatch[1].trim().replace(/^["']|["']$/g, '')
        }
        if (contentIdMatch) {
          currentItem.content_id = contentIdMatch[1].trim().replace(/^["']|["']$/g, '')
        }
      }
    }

    // Don't forget the last module and item
    if (currentItem && currentModule) {
      currentModule.items!.push(currentItem)
    }
    if (currentModule) {
      modules.push(currentModule)
    }

    return modules
  }

  private getGitWorktrees(coursePath: string): string[] {
    /**
     * Detect git worktrees in the course directory.
     * Git worktrees are stored as directories and should be excluded from file searches.
     */
    try {
      const { execSync } = require('child_process')

      // Check if we're in a git repository
      try {
        execSync('git rev-parse --git-dir', { cwd: coursePath, stdio: 'pipe' })
      } catch {
        // Not a git repo, no worktrees to worry about
        return []
      }

      // Get git worktrees listing
      const output = execSync('git worktree list --porcelain', {
        cwd: coursePath,
        encoding: 'utf8'
      })

      const worktrees: string[] = []
      const lines = output.split('\n').filter((l: string) => l.trim())

      for (const line of lines) {
        // Each worktree line starts with "worktree" followed by the path
        if (line.startsWith('worktree ')) {
          const worktreePath = line.substring(9) // Remove "worktree " prefix
          const worktreeName = path.basename(worktreePath)
          worktrees.push(worktreeName)
        }
      }

      return worktrees
    } catch (err) {
      // Silently fail if git is unavailable or command fails
      return []
    }
  }

  private findFiles(dir: string, extension: string, excludeDirs: string[] = []): string[] {
    const files: string[] = []

    if (!fs.existsSync(dir)) {
      return files
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        if (!excludeDirs.includes(entry.name) && !entry.name.startsWith('.')) {
          files.push(...this.findFiles(fullPath, extension, excludeDirs))
        }
      } else if (entry.isFile() && entry.name.endsWith(extension)) {
        files.push(fullPath)
      }
    }

    return files
  }

  private extractTitleFromFrontmatter(filePath: string): string | null {
    try {
      const content = fs.readFileSync(filePath, 'utf8')

      // Match YAML frontmatter between --- markers
      const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
      if (!frontmatterMatch) {
        return null
      }

      const frontmatter = frontmatterMatch[1]

      // Extract title field (handles quoted and unquoted values)
      const titleMatch = frontmatter.match(/^title:\s*(.+)$/m)
      if (titleMatch) {
        let title = titleMatch[1].trim()
        // Remove quotes if present
        title = title.replace(/^["']|["']$/g, '')
        return title
      }

      return null
    } catch (e) {
      return null
    }
  }

  private extractTitleFromYaml(filePath: string): string | null {
    try {
      const content = fs.readFileSync(filePath, 'utf8')

      // Extract title or name field from YAML
      const titleMatch = content.match(/^(?:title|name):\s*(.+)$/m)
      if (titleMatch) {
        let title = titleMatch[1].trim()
        // Remove quotes if present
        title = title.replace(/^["']|["']$/g, '')
        return title
      }

      return null
    } catch (e) {
      return null
    }
  }

  private extractPublishedStatus(filePath: string): boolean | null {
    try {
      const content = fs.readFileSync(filePath, 'utf8')
      const match = content.match(/published:\s*(true|false)/i)
      if (match) {
        return match[1].toLowerCase() === 'true'
      }
      return null
    } catch (e) {
      return null
    }
  }

  private extractAssignmentId(filePath: string): string | null {
    try {
      const content = fs.readFileSync(filePath, 'utf8')
      const match = content.match(/assignment_id:\s*['"]?(\d+)['"]?/)
      return match ? match[1] : null
    } catch (e) {
      return null
    }
  }

  private async getFileSyncStatus(filePath: string, course: CourseInfo): Promise<SyncStatus> {
    try {
      const content = fs.readFileSync(filePath, 'utf8')

      // Extract IDs from frontmatter
      const pageIdMatch = content.match(/page_id:\s*['"]?(\d+)['"]?/)
      const quizIdMatch = content.match(/quiz_id:\s*['"]?(\d+)['"]?/)
      const assignmentIdMatch = content.match(/assignment_id:\s*['"]?(\d+)['"]?/)

      const itemId = pageIdMatch?.[1] || quizIdMatch?.[1] || assignmentIdMatch?.[1]

      if (!itemId) {
        return 'localOnly'
      }

      // Determine category
      let category = 'pages'
      if (quizIdMatch) category = 'quizzes'
      else if (assignmentIdMatch) category = 'assignments'

      // Check cached metadata for published status
      const metadata = this.getMetadataForItem(course.id, category, itemId)

      // Check if modified since last sync by comparing updated_at
      const updatedMatch = content.match(/updated_at:\s*['"]?([^'"\n]+)['"]?/)
      if (updatedMatch) {
        const canvasDate = new Date(updatedMatch[1])
        const fileStats = fs.statSync(filePath)
        if (fileStats.mtime > canvasDate) {
          return 'modified'
        }
      }

      // Check if published status matches (if we have metadata)
      if (metadata) {
        const localPublished = content.match(/published:\s*(true|false)/)?.[1] === 'true'
        const canvasPublished = metadata.published === true

        if (localPublished !== canvasPublished) {
          return 'modified'
        }
      }

      return 'synced'
    } catch (e) {
      return 'unknown'
    }
  }

  // Public methods for managing courses

  addCourse(course: CourseInfo) {
    // Check if already registered
    const existing = this.registry.courses.find(c => c.id === course.id)
    if (existing) {
      // Update path if different
      existing.localPath = course.localPath
      existing.remoteUrl = course.remoteUrl
    } else {
      this.registry.courses.push(course)
    }

    this.saveRegistry()
    this.watchCourse(course.localPath)
    this.refresh()
  }

  removeCourse(courseId: string) {
    const index = this.registry.courses.findIndex(c => c.id === courseId)
    if (index >= 0) {
      const course = this.registry.courses[index]
      const watcher = this.fileWatchers.get(course.localPath)
      if (watcher) {
        watcher.dispose()
        this.fileWatchers.delete(course.localPath)
      }
      this.registry.courses.splice(index, 1)
      this.saveRegistry()
      this.refresh()
    }
  }

  getCourseByPath(localPath: string): CourseInfo | undefined {
    return this.registry.courses.find(c => c.localPath === localPath)
  }

  getCourseById(id: string): CourseInfo | undefined {
    return this.registry.courses.find(c => c.id === id)
  }

  getAllCourses(): CourseInfo[] {
    return [...this.registry.courses]
  }

  dispose() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer)
    }
    for (const watcher of this.fileWatchers.values()) {
      watcher.dispose()
    }
    this.fileWatchers.clear()
  }
}
