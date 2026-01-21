/**
 * TypeScript interfaces for rubric and draft grade data structures.
 * These match the Python MCP server's data formats.
 */

export interface RubricRating {
  id: string
  description: string
  long_description?: string
  points: number
}

export interface RubricCriterion {
  id: string
  description: string
  long_description?: string
  points: number
  ratings: RubricRating[]
  criterion_use_range?: boolean
}

export interface RubricSettings {
  id?: string
  title?: string
  points_possible?: number
  free_form_criterion_comments?: boolean
  use_for_grading?: boolean
}

export interface Rubric {
  id: string
  context_id: string
  context_type: string
  title?: string
  points_possible: number
  data: RubricCriterion[]
  rubric_settings?: RubricSettings
  free_form_criterion_comments?: boolean
}

/**
 * Rubric assessment for a single criterion
 */
export interface CriterionAssessment {
  points: string | number
  rating_id: string
  comments?: string
}

/**
 * Full rubric assessment (criterion_id -> assessment)
 */
export interface RubricAssessment {
  [criterionId: string]: CriterionAssessment
}

/**
 * A single draft run (one grading attempt, possibly AI-generated)
 */
export interface DraftRun {
  run_id: string | number
  model?: string
  provider?: 'anthropic' | 'openai' | 'ollama' | 'manual'
  timestamp?: number
  rubric_assessment: RubricAssessment
  overall_comment?: string
  note_to_instructor?: string
  reasoning?: string
  instructor_modified: boolean
  source_run?: string | number  // If this run was copied/modified from another
}

/**
 * Complete draft grade data for a student
 */
export interface DraftGrade {
  runs: DraftRun[]
  current_run: string | number | null
  official_rubric?: CanvasRubricSubmission
}

/**
 * Canvas API format for rubric submission
 */
export interface CanvasRubricSubmission {
  [key: string]: string | number
  // Example keys:
  // "rubric_assessment[_1679][points]": "1"
  // "rubric_assessment[_1679][rating_id]": "blank"
  // "rubric_assessment[_1679][comment]": "Good work"
  // "comment[text_comment]": "Overall feedback"
}

/**
 * Summary info about a draft grade
 */
export interface DraftSummary {
  user_id: string
  has_draft: boolean
  num_runs?: number
  current_run?: string | number
  has_official?: boolean
  error?: string
}
