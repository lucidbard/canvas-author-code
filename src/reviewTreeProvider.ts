import * as vscode from 'vscode'
import * as path from 'path'
import { CanvasMcpClient } from './mcpClient'

interface Worktree {
  name: string
  path: string
  file_count: number
  review_summary: {
    approved: number
    rejected: number
    needs_revision: number
    pending: number
  }
  has_reviews: boolean
}

interface WorktreeItem {
  id: string
  type: string
  title: string
  file_path: string
  review_status: string
  review_count: number
  has_human_review: boolean
}

export class ReviewTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly itemType: 'worktree' | 'item',
    public readonly worktreeName?: string,
    public readonly itemData?: WorktreeItem,
    public readonly coursePath?: string
  ) {
    super(label, collapsibleState)

    this.contextValue = itemType

    if (itemType === 'worktree') {
      this.iconPath = new vscode.ThemeIcon('git-branch')
    } else if (itemData) {
      // Set icon based on review status
      if (itemData.review_status === 'approved') {
        this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'))
      } else if (itemData.review_status === 'needs_revision') {
        this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'))
      } else if (itemData.has_human_review) {
        this.iconPath = new vscode.ThemeIcon('comment', new vscode.ThemeColor('editorInfo.foreground'))
      } else {
        this.iconPath = new vscode.ThemeIcon('circle-outline')
      }

      // Set description
      this.description = `${itemData.review_count} review${itemData.review_count !== 1 ? 's' : ''}`

      // Add tooltip
      this.tooltip = `${itemData.title}\nStatus: ${itemData.review_status}\nReviews: ${itemData.review_count}`
    }
  }
}

export class ReviewTreeProvider implements vscode.TreeDataProvider<ReviewTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ReviewTreeItem | undefined | null | void> = new vscode.EventEmitter<ReviewTreeItem | undefined | null | void>()
  readonly onDidChangeTreeData: vscode.Event<ReviewTreeItem | undefined | null | void> = this._onDidChangeTreeData.event

  private mcpClient?: CanvasMcpClient
  private coursePath?: string

  constructor() {}

  setMcpClient(client: CanvasMcpClient | undefined) {
    this.mcpClient = client
  }

  setCoursePath(path: string | undefined) {
    this.coursePath = path
    this.refresh()
  }

  refresh(): void {
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(element: ReviewTreeItem): vscode.TreeItem {
    return element
  }

  async getChildren(element?: ReviewTreeItem): Promise<ReviewTreeItem[]> {
    if (!this.mcpClient || !this.coursePath) {
      return []
    }

    if (!element) {
      // Root level - show worktrees
      return this.getWorktrees()
    } else if (element.itemType === 'worktree' && element.worktreeName) {
      // Show items in worktree
      return this.getWorktreeItems(element.worktreeName)
    }

    return []
  }

  private async getWorktrees(): Promise<ReviewTreeItem[]> {
    try {
      const result = await this.mcpClient!.callTool('list_worktrees_for_review', {
        course_path: this.coursePath
      }) as any

      const worktrees: Worktree[] = result.worktrees || []

      return worktrees.map(wt => {
        const summary = wt.review_summary
        const total = summary.approved + summary.rejected + summary.needs_revision + summary.pending
        const label = `${wt.name} (${summary.approved}/${total} approved)`

        return new ReviewTreeItem(
          label,
          vscode.TreeItemCollapsibleState.Collapsed,
          'worktree',
          wt.name,
          undefined,
          this.coursePath
        )
      })
    } catch (error) {
      console.error('Error loading worktrees:', error)
      return []
    }
  }

  private async getWorktreeItems(worktreeName: string): Promise<ReviewTreeItem[]> {
    try {
      const result = await this.mcpClient!.callTool('get_worktree_items', {
        course_path: this.coursePath!,
        worktree_name: worktreeName
      }) as any

      const items: WorktreeItem[] = result.items || []

      return items.map(item => {
        return new ReviewTreeItem(
          item.title,
          vscode.TreeItemCollapsibleState.None,
          'item',
          worktreeName,
          item,
          this.coursePath
        )
      })
    } catch (error) {
      console.error('Error loading worktree items:', error)
      return []
    }
  }
}
