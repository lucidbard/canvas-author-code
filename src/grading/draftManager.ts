/**
 * Draft Grade Manager
 *
 * Manages local draft grades via MCP server.
 * Supports versioning, AI-generated drafts, and manual edits.
 */

import { CanvasMcpClient } from '../mcpClient'
import {
  DraftGrade,
  DraftRun,
  DraftSummary,
  RubricAssessment,
  CanvasRubricSubmission
} from './types'

export class DraftManager {
  private _mcpClient: CanvasMcpClient

  constructor(mcpClient: CanvasMcpClient) {
    this._mcpClient = mcpClient
  }

  /**
   * Load a draft grade from local storage
   */
  async loadDraft(assignmentId: string, userId: string): Promise<DraftGrade | null> {
    try {
      const result = await this._mcpClient.callTool('load_draft_grade', {
        assignment_id: assignmentId,
        user_id: userId
      })

      // MCP returns null if no draft found
      if (result === null) {
        return null
      }

      return result as DraftGrade
    } catch (error) {
      console.error('Error loading draft:', error)
      throw error
    }
  }

  /**
   * Save a complete draft grade
   */
  async saveDraft(
    assignmentId: string,
    userId: string,
    draft: DraftGrade
  ): Promise<boolean> {
    try {
      const result = await this._mcpClient.callTool('save_draft_grade', {
        assignment_id: assignmentId,
        user_id: userId,
        draft_data: JSON.stringify(draft)
      }) as { success: boolean }

      return result.success
    } catch (error) {
      console.error('Error saving draft:', error)
      throw error
    }
  }

  /**
   * Add a new draft run (for AI regeneration or manual edits)
   */
  async addRun(
    assignmentId: string,
    userId: string,
    run: Partial<DraftRun>,
    setAsCurrent: boolean = true
  ): Promise<string | null> {
    try {
      // Ensure required fields
      const runData: Partial<DraftRun> = {
        rubric_assessment: run.rubric_assessment || {},
        instructor_modified: run.instructor_modified ?? false,
        model: run.model,
        provider: run.provider || 'manual',
        overall_comment: run.overall_comment,
        note_to_instructor: run.note_to_instructor,
        reasoning: run.reasoning,
        source_run: run.source_run
      }

      const result = await this._mcpClient.callTool('add_draft_run', {
        assignment_id: assignmentId,
        user_id: userId,
        run_data: JSON.stringify(runData),
        set_as_current: setAsCurrent
      }) as { success: boolean; run_id?: string }

      if (result.success && result.run_id) {
        return result.run_id
      }

      return null
    } catch (error) {
      console.error('Error adding draft run:', error)
      throw error
    }
  }

  /**
   * Get the current draft run
   */
  async getCurrentRun(assignmentId: string, userId: string): Promise<DraftRun | null> {
    try {
      const result = await this._mcpClient.callTool('get_current_draft_run', {
        assignment_id: assignmentId,
        user_id: userId
      })

      if (result === null) {
        return null
      }

      return result as DraftRun
    } catch (error) {
      console.error('Error getting current run:', error)
      throw error
    }
  }

  /**
   * Set a specific run as current
   */
  async setCurrentRun(
    assignmentId: string,
    userId: string,
    runId: string
  ): Promise<boolean> {
    try {
      const result = await this._mcpClient.callTool('set_current_draft_run', {
        assignment_id: assignmentId,
        user_id: userId,
        run_id: runId
      }) as { success: boolean }

      return result.success
    } catch (error) {
      console.error('Error setting current run:', error)
      throw error
    }
  }

  /**
   * Update an existing run
   */
  async updateRun(
    assignmentId: string,
    userId: string,
    runId: string,
    updates: Partial<DraftRun>
  ): Promise<boolean> {
    try {
      const result = await this._mcpClient.callTool('update_draft_run', {
        assignment_id: assignmentId,
        user_id: userId,
        run_id: runId,
        updates: JSON.stringify(updates)
      }) as { success: boolean }

      return result.success
    } catch (error) {
      console.error('Error updating run:', error)
      throw error
    }
  }

  /**
   * List all drafts for an assignment
   */
  async listDrafts(assignmentId: string): Promise<DraftSummary[]> {
    try {
      const result = await this._mcpClient.callTool('list_draft_grades', {
        assignment_id: assignmentId
      })

      return result as DraftSummary[]
    } catch (error) {
      console.error('Error listing drafts:', error)
      throw error
    }
  }

  /**
   * Delete a draft grade
   */
  async deleteDraft(assignmentId: string, userId: string): Promise<boolean> {
    try {
      const result = await this._mcpClient.callTool('delete_draft_grade', {
        assignment_id: assignmentId,
        user_id: userId
      }) as { success: boolean }

      return result.success
    } catch (error) {
      console.error('Error deleting draft:', error)
      throw error
    }
  }

  /**
   * Set the official rubric (formatted for Canvas API)
   */
  async setOfficialRubric(
    assignmentId: string,
    userId: string,
    rubricData: CanvasRubricSubmission
  ): Promise<boolean> {
    try {
      const result = await this._mcpClient.callTool('set_official_rubric', {
        assignment_id: assignmentId,
        user_id: userId,
        rubric_data: JSON.stringify(rubricData)
      }) as { success: boolean }

      return result.success
    } catch (error) {
      console.error('Error setting official rubric:', error)
      throw error
    }
  }

  /**
   * Helper: Create a new manual draft run from rubric assessment
   */
  async saveManualDraft(
    assignmentId: string,
    userId: string,
    rubricAssessment: RubricAssessment,
    overallComment?: string
  ): Promise<string | null> {
    return this.addRun(
      assignmentId,
      userId,
      {
        rubric_assessment: rubricAssessment,
        overall_comment: overallComment,
        provider: 'manual',
        instructor_modified: true
      },
      true
    )
  }

  /**
   * Helper: Load or create an empty draft
   */
  async loadOrCreateDraft(assignmentId: string, userId: string): Promise<DraftGrade> {
    const existing = await this.loadDraft(assignmentId, userId)
    if (existing) {
      return existing
    }

    // Create empty draft
    const emptyDraft: DraftGrade = {
      runs: [],
      current_run: null
    }

    return emptyDraft
  }
}
