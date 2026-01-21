import * as vscode from 'vscode'
import { CanvasMcpClient } from './mcpClient'
import { DraftManager } from './grading/draftManager'
import { DraftGrade } from './grading/types'

/**
 * Rubric grading panel that appears in the bottom panel area.
 * Uses button-based rating selection like the Flask app.
 */
export class RubricPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'canvasAuthorRubric'
  private _view?: vscode.WebviewView
  private readonly _extensionUri: vscode.Uri
  private _mcpClient?: CanvasMcpClient
  private _draftManager?: DraftManager
  private _outputChannel: vscode.OutputChannel

  // Current context
  private _courseId?: string
  private _assignmentId?: string
  private _userId?: string
  private _userName?: string
  private _assignmentName?: string
  private _rubric?: any
  private _currentDraft?: DraftGrade

  constructor(extensionUri: vscode.Uri) {
    this._extensionUri = extensionUri
    this._outputChannel = vscode.window.createOutputChannel('Canvas Author - Rubric')
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    }

    webviewView.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'saveDraft':
            await this.saveDraft(message.assessment)
            break
          case 'submitGrade':
            await this.submitGrade(message.assessment)
            break
        }
      }
    )

    // Show welcome message initially
    webviewView.webview.html = this.getWelcomeHtml()
  }

  public loadRubric(
    mcpClient: CanvasMcpClient | undefined,
    courseId: string,
    assignmentId: string,
    assignmentName: string,
    userId: string,
    userName: string
  ) {
    this._mcpClient = mcpClient
    if (mcpClient) {
      this._draftManager = new DraftManager(mcpClient)
    }
    this._courseId = courseId
    this._assignmentId = assignmentId
    this._assignmentName = assignmentName
    this._userId = userId
    this._userName = userName

    if (this._view) {
      this._loadRubricInternal()
    }
  }

  private async _loadRubricInternal() {
    if (!this._view) return

    if (!this._mcpClient || !this._courseId || !this._assignmentId || !this._userId || !this._userName || !this._assignmentName) {
      this._outputChannel.appendLine('Missing required context for loading rubric')
      return
    }

    this._view.webview.html = this.getLoadingHtml()

    try {
      // Fetch rubric
      this._rubric = await this._mcpClient.callTool('get_rubric', {
        course_id: this._courseId,
        assignment_id: this._assignmentId
      })

      this._outputChannel.appendLine(`Loaded rubric for ${this._assignmentName}`)

      // Load existing draft
      if (this._draftManager) {
        try {
          this._currentDraft = await this._draftManager.loadOrCreateDraft(this._assignmentId, this._userId)
          if (this._currentDraft.runs.length > 0) {
            this._outputChannel.appendLine(`Loaded draft with ${this._currentDraft.runs.length} run(s)`)
          }
        } catch (error) {
          this._outputChannel.appendLine(`Error loading draft: ${error}`)
        }
      }

      // Update view
      this._view.webview.html = this.getRubricHtml(this._rubric, this._userName, this._currentDraft)
    } catch (error) {
      this._outputChannel.appendLine(`Error loading rubric: ${error}`)
      this._view.webview.html = this.getErrorHtml(`Failed to load rubric: ${error}`)
    }
  }

  private async saveDraft(assessment: any) {
    this._outputChannel.appendLine('Saving draft grade...')

    if (!this._draftManager || !this._assignmentId || !this._userId) {
      vscode.window.showErrorMessage('Cannot save draft: missing context')
      return
    }

    try {
      const runId = await this._draftManager.addRun(
        this._assignmentId,
        this._userId,
        {
          rubric_assessment: assessment.rubric_assessment || {},
          overall_comment: assessment.overall_comment,
          provider: 'manual',
          instructor_modified: true
        },
        true
      )

      if (runId) {
        this._outputChannel.appendLine(`Saved draft run ${runId}`)
        vscode.window.showInformationMessage('Draft grade saved successfully')
      } else {
        throw new Error('Failed to create draft run')
      }
    } catch (error) {
      this._outputChannel.appendLine(`Error saving draft: ${error}`)
      vscode.window.showErrorMessage(`Failed to save draft: ${error}`)
    }
  }

  private async submitGrade(assessment: any) {
    const confirm = await vscode.window.showWarningMessage(
      'Submit this grade to Canvas?',
      { modal: true },
      'Submit'
    )

    if (confirm !== 'Submit') return

    this._outputChannel.appendLine('Submitting grade to Canvas...')

    if (!this._mcpClient || !this._courseId || !this._assignmentId || !this._userId) {
      vscode.window.showErrorMessage('Cannot submit grade: missing context')
      return
    }

    try {
      const rubricAssessment = assessment.rubric_assessment || {}
      let totalPoints = 0
      for (const criterionId in rubricAssessment) {
        const points = parseFloat(rubricAssessment[criterionId].points || '0')
        totalPoints += points
      }

      await this._mcpClient.callTool('update_grade', {
        course_id: this._courseId,
        assignment_id: this._assignmentId,
        user_id: this._userId,
        grade: totalPoints.toString(),
        comment: assessment.overall_comment || ''
      })

      this._outputChannel.appendLine(`Grade submitted: ${totalPoints} points`)
      vscode.window.showInformationMessage(`Grade submitted to Canvas: ${totalPoints} points`)

      if (this._draftManager) {
        try {
          const canvasRubric: any = {}
          for (const criterionId in rubricAssessment) {
            const assess = rubricAssessment[criterionId]
            canvasRubric[`rubric_assessment[${criterionId}][points]`] = assess.points
            canvasRubric[`rubric_assessment[${criterionId}][rating_id]`] = assess.rating_id
            if (assess.comments) {
              canvasRubric[`rubric_assessment[${criterionId}][comments]`] = assess.comments
            }
          }
          if (assessment.overall_comment) {
            canvasRubric['comment[text_comment]'] = assessment.overall_comment
          }

          await this._draftManager.setOfficialRubric(
            this._assignmentId,
            this._userId,
            canvasRubric
          )
          this._outputChannel.appendLine('Saved official rubric to draft')
        } catch (error) {
          this._outputChannel.appendLine(`Warning: Could not save official rubric: ${error}`)
        }
      }
    } catch (error) {
      this._outputChannel.appendLine(`Error submitting grade: ${error}`)
      vscode.window.showErrorMessage(`Failed to submit grade: ${error}`)
    }
  }

  private getWelcomeHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 20px;
      color: var(--vscode-foreground);
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      text-align: center;
    }
    .welcome {
      opacity: 0.7;
    }
  </style>
</head>
<body>
  <div class="welcome">
    <p>Select a submission to view its rubric</p>
  </div>
</body>
</html>`
  }

  private getLoadingHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      color: var(--vscode-foreground);
    }
    .spinner {
      border: 3px solid var(--vscode-editor-inactiveSelectionBackground);
      border-top: 3px solid var(--vscode-button-background);
      border-radius: 50%;
      width: 30px;
      height: 30px;
      animation: spin 1s linear infinite;
      margin-right: 10px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .loading {
      display: flex;
      align-items: center;
    }
  </style>
</head>
<body>
  <div class="loading">
    <div class="spinner"></div>
    <span>Loading rubric...</span>
  </div>
</body>
</html>`
  }

  private getErrorHtml(error: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 20px;
      color: var(--vscode-errorForeground);
    }
  </style>
</head>
<body>
  <h3>Error Loading Rubric</h3>
  <p>${this.escapeHtml(error)}</p>
</body>
</html>`
  }

  private getRubricHtml(rubric: any, userName: string, draft?: DraftGrade): string {
    const criteria = rubric?.data || []
    const pointsPossible = rubric?.points_possible || 0

    // Get the most recent draft run if available
    const latestRun = draft?.runs && draft.runs.length > 0 ? draft.runs[draft.runs.length - 1] : null
    const draftAssessment = latestRun?.rubric_assessment || {}
    const draftComment = latestRun?.overall_comment || ''

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 15px;
      color: var(--vscode-foreground);
      margin: 0;
      font-size: 13px;
    }
    .header {
      padding: 10px 0;
      border-bottom: 1px solid var(--vscode-panel-border);
      margin-bottom: 15px;
    }
    .header h3 {
      margin: 0 0 5px 0;
      font-size: 14px;
      font-weight: 600;
    }
    .points-summary {
      font-size: 13px;
      opacity: 0.9;
      font-weight: 600;
    }
    .criterion {
      margin-bottom: 20px;
      padding-bottom: 15px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .criterion:last-of-type {
      border-bottom: none;
    }
    .criterion-header {
      font-weight: 600;
      margin-bottom: 10px;
      font-size: 13px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .criterion-points {
      opacity: 0.7;
      font-size: 12px;
    }
    .criterion-description {
      font-size: 11px;
      opacity: 0.7;
      margin-bottom: 8px;
      font-style: italic;
    }
    .rating-buttons {
      display: flex;
      gap: 4px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }
    .rating-btn {
      flex: 1;
      min-width: 0;
      padding: 6px 8px;
      font-size: 11px;
      cursor: pointer;
      border: 1px solid var(--vscode-button-border);
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border-radius: 3px;
      transition: all 0.2s;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .rating-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .rating-btn.selected {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-background);
      font-weight: 600;
    }
    .point-override {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 8px;
      font-size: 12px;
    }
    .point-override input {
      width: 60px;
      padding: 4px 6px;
      font-size: 12px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
    }
    .point-override label {
      opacity: 0.8;
    }
    .comment-toggle {
      padding: 4px 8px;
      font-size: 11px;
      cursor: pointer;
      border: 1px solid var(--vscode-button-border);
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border-radius: 3px;
      margin-bottom: 8px;
    }
    .comment-toggle:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .comment-input {
      width: 100%;
      min-height: 60px;
      padding: 6px;
      font-size: 11px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      font-family: var(--vscode-font-family);
      resize: vertical;
      margin-top: 8px;
    }
    .comment-section {
      display: none;
    }
    .comment-section.visible {
      display: block;
    }
    .overall-comment {
      margin: 20px 0;
      padding-top: 15px;
      border-top: 2px solid var(--vscode-panel-border);
    }
    .overall-comment label {
      display: block;
      font-weight: 600;
      margin-bottom: 8px;
      font-size: 13px;
    }
    .overall-comment textarea {
      width: 100%;
      min-height: 80px;
      padding: 8px;
      font-size: 12px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      font-family: var(--vscode-font-family);
      resize: vertical;
    }
    .action-bar {
      display: flex;
      gap: 10px;
      padding: 15px 0 5px 0;
      border-top: 2px solid var(--vscode-panel-border);
    }
    .btn {
      padding: 8px 16px;
      font-size: 12px;
      cursor: pointer;
      border: none;
      border-radius: 2px;
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
  </style>
</head>
<body>
  <div class="header">
    <h3>Grading: ${this.escapeHtml(userName)}</h3>
    <div class="points-summary"><span id="totalPoints">0</span> / ${pointsPossible} pts</div>
  </div>

  <div id="criteria">
    ${criteria.map((criterion: any) => `
      <div class="criterion" data-criterion-id="${criterion.id}">
        <div class="criterion-header">
          <span>${this.escapeHtml(criterion.description)}</span>
          <span class="criterion-points">${criterion.points} pts</span>
        </div>
        ${criterion.long_description ? `<div class="criterion-description">${this.escapeHtml(criterion.long_description)}</div>` : ''}

        <div class="rating-buttons">
          ${criterion.ratings.map((rating: any) => `
            <button
              class="rating-btn"
              data-criterion-id="${criterion.id}"
              data-rating-id="${rating.id}"
              data-points="${rating.points}"
              onclick="selectRating('${criterion.id}', '${rating.id}', ${rating.points})">
              ${this.escapeHtml(rating.description)} (${rating.points})
            </button>
          `).join('')}
        </div>

        <div class="point-override">
          <label>Points:</label>
          <input
            type="number"
            id="points_${criterion.id}"
            data-criterion-id="${criterion.id}"
            step="0.1"
            min="0"
            max="${criterion.points}"
            placeholder="${criterion.points}"
            onchange="updateTotal()">
          <span>/ ${criterion.points}</span>
        </div>

        <button class="comment-toggle" onclick="toggleComment('${criterion.id}')">
          Add Comment
        </button>
        <div class="comment-section" id="comment_section_${criterion.id}">
          <textarea
            class="comment-input"
            id="comment_${criterion.id}"
            data-criterion-id="${criterion.id}"
            placeholder="Comments for this criterion..."></textarea>
        </div>

        <input type="hidden" id="rating_${criterion.id}" data-criterion-id="${criterion.id}">
      </div>
    `).join('')}
  </div>

  <div class="overall-comment">
    <label>Overall Feedback</label>
    <textarea id="overallComment" placeholder="Overall comments for the student..."></textarea>
  </div>

  <div class="action-bar">
    <button class="btn btn-secondary" onclick="saveDraft()">Save Draft</button>
    <button class="btn btn-primary" onclick="submitGrade()">Submit to Canvas</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    function selectRating(criterionId, ratingId, points) {
      // Remove selected class from all buttons in this criterion
      const buttons = document.querySelectorAll(\`button[data-criterion-id="\${criterionId}"]\`);
      buttons.forEach(btn => btn.classList.remove('selected'));

      // Add selected class to clicked button
      const selectedBtn = event.target;
      selectedBtn.classList.add('selected');

      // Update hidden input for rating
      document.getElementById(\`rating_\${criterionId}\`).value = ratingId;

      // Update points input
      document.getElementById(\`points_\${criterionId}\`).value = points;

      updateTotal();
    }

    function toggleComment(criterionId) {
      const section = document.getElementById(\`comment_section_\${criterionId}\`);
      const btn = event.target;

      if (section.classList.contains('visible')) {
        section.classList.remove('visible');
        btn.textContent = 'Add Comment';
      } else {
        section.classList.add('visible');
        btn.textContent = 'Hide Comment';
      }
    }

    function updateTotal() {
      let total = 0;
      document.querySelectorAll('input[id^="points_"]').forEach(input => {
        const points = parseFloat(input.value || '0');
        if (!isNaN(points)) {
          total += points;
        }
      });
      document.getElementById('totalPoints').textContent = total.toFixed(1);
    }

    function collectAssessment() {
      const rubric_assessment = {};

      document.querySelectorAll('.criterion').forEach(criterion => {
        const criterionId = criterion.dataset.criterionId;
        const pointsInput = document.getElementById(\`points_\${criterionId}\`);
        const ratingInput = document.getElementById(\`rating_\${criterionId}\`);
        const commentInput = document.getElementById(\`comment_\${criterionId}\`);

        const points = pointsInput.value || '0';
        const ratingId = ratingInput.value || 'blank';
        const comments = commentInput ? commentInput.value : '';

        rubric_assessment[criterionId] = {
          points: points,
          rating_id: ratingId,
          comments: comments
        };
      });

      return {
        rubric_assessment: rubric_assessment,
        overall_comment: document.getElementById('overallComment').value
      };
    }

    function saveDraft() {
      vscode.postMessage({
        command: 'saveDraft',
        assessment: collectAssessment()
      });
    }

    function submitGrade() {
      vscode.postMessage({
        command: 'submitGrade',
        assessment: collectAssessment()
      });
    }

    // Load draft data if available
    function loadDraftData() {
      const draftData = ${JSON.stringify(draftAssessment)};
      const draftComment = ${JSON.stringify(draftComment)};

      // Populate rubric assessments
      for (const criterionId in draftData) {
        const assessment = draftData[criterionId];

        // Set points
        const pointsInput = document.getElementById(\`points_\${criterionId}\`);
        if (pointsInput && assessment.points) {
          pointsInput.value = assessment.points;
        }

        // Set rating (select the button)
        if (assessment.rating_id) {
          document.getElementById(\`rating_\${criterionId}\`).value = assessment.rating_id;

          // Highlight the selected rating button
          const ratingBtn = document.querySelector(\`button[data-criterion-id="\${criterionId}"][data-rating-id="\${assessment.rating_id}"]\`);
          if (ratingBtn) {
            ratingBtn.classList.add('selected');
          }
        }

        // Set comment if present
        if (assessment.comments) {
          const commentInput = document.getElementById(\`comment_\${criterionId}\`);
          if (commentInput) {
            commentInput.value = assessment.comments;
            // Show comment section
            const commentSection = document.getElementById(\`comment_section_\${criterionId}\`);
            if (commentSection) {
              commentSection.classList.add('visible');
              // Update toggle button text
              const toggleBtn = commentSection.previousElementSibling;
              if (toggleBtn && toggleBtn.classList.contains('comment-toggle')) {
                toggleBtn.textContent = 'Hide Comment';
              }
            }
          }
        }
      }

      // Populate overall comment
      if (draftComment) {
        document.getElementById('overallComment').value = draftComment;
      }

      // Update total after loading data
      updateTotal();
    }

    // Load draft data on page load
    if (${latestRun !== null}) {
      loadDraftData();
    }
  </script>
</body>
</html>`
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

}
