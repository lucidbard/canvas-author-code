import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'

interface QuizMetadata {
  title?: string
  quiz_id?: number | string
  course_id?: number | string
  time_limit?: number
  allowed_attempts?: number
  shuffle_answers?: boolean
  show_correct_answers?: boolean
  published?: boolean
  quiz_type?: string
  points_possible?: number
  due_at?: string
  lock_at?: string
  unlock_at?: string
  [key: string]: unknown
}

interface Answer {
  letter: string
  text: string
  correct: boolean
  matchTarget?: string
}

interface Question {
  number: number
  type: string
  text: string
  points: number
  answers: Answer[]
  correctFeedback?: string
  incorrectFeedback?: string
  neutralFeedback?: string
}

interface ParsedQuiz {
  metadata: QuizMetadata
  questions: Question[]
  instructions?: string
}

export class QuizPreviewPanel {
  public static currentPanel: QuizPreviewPanel | undefined
  private readonly _panel!: vscode.WebviewPanel
  private readonly _extensionUri!: vscode.Uri
  private _quizPath!: string
  private _currentQuiz: ParsedQuiz | null = null
  private _disposables: vscode.Disposable[] = []

  public static createOrShow(extensionUri: vscode.Uri, quizPath: string): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined

    if (QuizPreviewPanel.currentPanel) {
      QuizPreviewPanel.currentPanel._panel.reveal(column)
      QuizPreviewPanel.currentPanel.updateQuiz(quizPath)
      return
    }

    const quizName = path.basename(quizPath, '.md')

    const panel = vscode.window.createWebviewPanel(
      'quizEditor',
      'Quiz: ' + quizName,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri]
      }
    )

    QuizPreviewPanel.currentPanel = new QuizPreviewPanel(panel, extensionUri, quizPath)
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    quizPath: string
  ) {
    this._panel = panel
    this._extensionUri = extensionUri
    this._quizPath = quizPath

    this._updateHtml()

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables)

    this._panel.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {
          case 'openMarkdown':
            await this._openMarkdownFile()
            break
          case 'refresh':
            this._updateHtml()
            break
          case 'saveQuiz':
            await this._saveQuiz(message.quiz)
            break
          case 'updateMetadata':
            await this._updateMetadata(message.key, message.value)
            break
          case 'updateQuestion':
            await this._updateQuestion(message.questionIndex, message.question)
            break
          case 'addQuestion':
            await this._addQuestion(message.type)
            break
          case 'deleteQuestion':
            await this._deleteQuestion(message.questionIndex)
            break
          case 'moveQuestion':
            await this._moveQuestion(message.questionIndex, message.direction)
            break
          case 'addAnswer':
            await this._addAnswer(message.questionIndex)
            break
          case 'deleteAnswer':
            await this._deleteAnswer(message.questionIndex, message.answerIndex)
            break
          case 'toggleCorrect':
            await this._toggleCorrect(message.questionIndex, message.answerIndex)
            break
        }
      },
      null,
      this._disposables
    )
  }

  public updateQuiz(quizPath: string): void {
    this._quizPath = quizPath
    const quizName = path.basename(quizPath, '.md')
    this._panel.title = 'Quiz: ' + quizName
    this._updateHtml()
  }

  private async _openMarkdownFile(): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(this._quizPath)
    await vscode.window.showTextDocument(doc)
  }

  private async _saveQuiz(quiz: ParsedQuiz): Promise<void> {
    const markdown = this._generateMarkdown(quiz)
    fs.writeFileSync(this._quizPath, markdown)
    this._currentQuiz = quiz
    vscode.window.showInformationMessage('Quiz saved!')
  }

  private async _updateMetadata(key: string, value: unknown): Promise<void> {
    if (!this._currentQuiz) return
    this._currentQuiz.metadata[key] = value
    await this._saveQuiz(this._currentQuiz)
    this._updateHtml()
  }

  private async _updateQuestion(index: number, question: Question): Promise<void> {
    if (!this._currentQuiz) return
    this._currentQuiz.questions[index] = question
    await this._saveQuiz(this._currentQuiz)
    this._updateHtml()
  }

  private async _addQuestion(type: string): Promise<void> {
    if (!this._currentQuiz) return
    const newNumber = this._currentQuiz.questions.length + 1
    const newQuestion: Question = {
      number: newNumber,
      type: type,
      text: 'New question',
      points: 1,
      answers: type === 'ESS' ? [] : [
        { letter: 'a', text: 'Answer 1', correct: true },
        { letter: 'b', text: 'Answer 2', correct: false }
      ]
    }
    this._currentQuiz.questions.push(newQuestion)
    await this._saveQuiz(this._currentQuiz)
    this._updateHtml()
  }

  private async _deleteQuestion(index: number): Promise<void> {
    if (!this._currentQuiz) return
    this._currentQuiz.questions.splice(index, 1)
    this._currentQuiz.questions.forEach((q, i) => q.number = i + 1)
    await this._saveQuiz(this._currentQuiz)
    this._updateHtml()
  }

  private async _moveQuestion(index: number, direction: 'up' | 'down'): Promise<void> {
    if (!this._currentQuiz) return
    const questions = this._currentQuiz.questions
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= questions.length) return

    [questions[index], questions[newIndex]] = [questions[newIndex], questions[index]]
    questions.forEach((q, i) => q.number = i + 1)
    await this._saveQuiz(this._currentQuiz)
    this._updateHtml()
  }

  private async _addAnswer(questionIndex: number): Promise<void> {
    if (!this._currentQuiz) return
    const question = this._currentQuiz.questions[questionIndex]
    const nextLetter = String.fromCharCode(97 + question.answers.length)
    question.answers.push({
      letter: nextLetter,
      text: 'New answer',
      correct: false
    })
    await this._saveQuiz(this._currentQuiz)
    this._updateHtml()
  }

  private async _deleteAnswer(questionIndex: number, answerIndex: number): Promise<void> {
    if (!this._currentQuiz) return
    const question = this._currentQuiz.questions[questionIndex]
    question.answers.splice(answerIndex, 1)
    question.answers.forEach((a, i) => a.letter = String.fromCharCode(97 + i))
    await this._saveQuiz(this._currentQuiz)
    this._updateHtml()
  }

  private async _toggleCorrect(questionIndex: number, answerIndex: number): Promise<void> {
    if (!this._currentQuiz) return
    const question = this._currentQuiz.questions[questionIndex]
    const answer = question.answers[answerIndex]

    if (question.type === 'MC' || question.type === 'TF') {
      question.answers.forEach(a => a.correct = false)
      answer.correct = true
    } else {
      answer.correct = !answer.correct
    }

    await this._saveQuiz(this._currentQuiz)
    this._updateHtml()
  }

  private _generateMarkdown(quiz: ParsedQuiz): string {
    const lines: string[] = []

    lines.push('---')
    for (const [key, value] of Object.entries(quiz.metadata)) {
      if (value !== undefined && value !== null && value !== '') {
        if (typeof value === 'string') {
          lines.push(key + ': "' + value + '"')
        } else {
          lines.push(key + ': ' + value)
        }
      }
    }
    lines.push('---')
    lines.push('')

    lines.push('# ' + (quiz.metadata.title || 'Quiz'))
    lines.push('')

    if (quiz.instructions) {
      lines.push('## Instructions')
      lines.push('')
      lines.push(quiz.instructions)
      lines.push('')
      lines.push('---')
      lines.push('')
    }

    lines.push('## Questions')
    lines.push('')

    for (const q of quiz.questions) {
      const pointsStr = q.points === 1 ? '(1 pt)' : '(' + q.points + ' pts)'
      lines.push('### ' + q.number + '. [' + q.type + '] ' + q.text + ' ' + pointsStr)
      lines.push('')

      if (q.type === 'MAT') {
        for (const a of q.answers) {
          lines.push(a.letter + '. ' + a.text + ' = ' + (a.matchTarget || ''))
        }
      } else if (q.type === 'SA' || q.type === 'FIB' || q.type === 'NUM') {
        for (const a of q.answers) {
          lines.push('*' + a.text)
        }
      } else if (q.type !== 'ESS') {
        for (const a of q.answers) {
          const prefix = a.correct ? '*' : ''
          lines.push(prefix + a.letter + '. ' + a.text)
        }
      }

      if (q.correctFeedback) {
        lines.push('')
        lines.push('> Correct: ' + q.correctFeedback)
      }
      if (q.incorrectFeedback) {
        lines.push('> Incorrect: ' + q.incorrectFeedback)
      }
      if (q.neutralFeedback && !q.correctFeedback && !q.incorrectFeedback) {
        lines.push('')
        lines.push('> ' + q.neutralFeedback)
      }

      lines.push('')
      lines.push('---')
      lines.push('')
    }

    return lines.join('\n')
  }

  private _parseQuiz(content: string): ParsedQuiz {
    const metadata: QuizMetadata = {}
    let questions: Question[] = []
    let instructions: string | undefined

    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
    if (frontmatterMatch) {
      const yamlContent = frontmatterMatch[1]
      const yamlLines = yamlContent.split('\n')
      for (const line of yamlLines) {
        const match = line.match(/^(\w+):\s*(.*)$/)
        if (match) {
          const key = match[1]
          let rawValue = match[2].trim()
          let value: unknown = rawValue

          if ((rawValue.startsWith('"') && rawValue.endsWith('"')) ||
            (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
            rawValue = rawValue.slice(1, -1)
            value = rawValue
          }

          if (rawValue === 'true') value = true
          else if (rawValue === 'false') value = false
          else if (rawValue === 'null' || rawValue === '') value = undefined
          else if (!isNaN(Number(rawValue)) && rawValue !== '') value = Number(rawValue)

          metadata[key] = value
        }
      }
    }

    const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/)
    const body = bodyMatch ? bodyMatch[1] : content

    const instructionsMatch = body.match(/## Instructions\n([\s\S]*?)(?=\n---|\n## Questions)/i)
    if (instructionsMatch) {
      instructions = instructionsMatch[1].trim()
    }

    questions = this._parseQuestions(body)

    return { metadata, questions, instructions }
  }

  private _parseQuestions(body: string): Question[] {
    const questions: Question[] = []
    const questionPattern = /^###\s+(\d+)\.\s*(?:\[([A-Z]{2,3})\]\s*)?(.+?)(?:\((\d+(?:\.\d+)?)\s*pts?\))?\s*$/gm

    const matches = [...body.matchAll(questionPattern)]

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]
      const start = match.index! + match[0].length
      const end = i + 1 < matches.length ? matches[i + 1].index! : body.length
      const questionContent = body.slice(start, end).trim()

      const number = parseInt(match[1])
      const type = match[2] || 'MC'
      const text = match[3].trim()
      const points = match[4] ? parseFloat(match[4]) : 1.0

      const { answers, correctFeedback, incorrectFeedback, neutralFeedback } =
        this._parseAnswers(questionContent, type)

      questions.push({
        number, type, text, points, answers,
        correctFeedback, incorrectFeedback, neutralFeedback
      })
    }

    return questions
  }

  private _parseAnswers(content: string, type: string): {
    answers: Answer[],
    correctFeedback?: string,
    incorrectFeedback?: string,
    neutralFeedback?: string
  } {
    const answers: Answer[] = []
    let correctFeedback: string | undefined
    let incorrectFeedback: string | undefined
    let neutralFeedback: string | undefined

    const lines = content.split('\n')

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      if (trimmed.startsWith('>')) {
        const feedbackText = trimmed.slice(1).trim()
        if (feedbackText.toLowerCase().startsWith('correct:')) {
          correctFeedback = feedbackText.slice(8).trim()
        } else if (feedbackText.toLowerCase().startsWith('incorrect:')) {
          incorrectFeedback = feedbackText.slice(10).trim()
        } else {
          neutralFeedback = neutralFeedback ? neutralFeedback + ' ' + feedbackText : feedbackText
        }
        continue
      }

      if (trimmed === '---' || trimmed.startsWith('#')) continue

      if (type === 'MAT') {
        const matchingMatch = trimmed.match(/^([a-z])\.\s*(.+?)\s*=\s*(.+)$/i)
        if (matchingMatch) {
          answers.push({
            letter: matchingMatch[1].toLowerCase(),
            text: matchingMatch[2].trim(),
            correct: true,
            matchTarget: matchingMatch[3].trim()
          })
        }
        continue
      }

      if (type === 'SA' || type === 'FIB' || type === 'NUM') {
        if (trimmed.startsWith('*')) {
          answers.push({
            letter: String(answers.length + 1),
            text: trimmed.slice(1).trim(),
            correct: true
          })
        }
        continue
      }

      const mcMatch = trimmed.match(/^(\*)?([a-z])\.\s*(.+)$/i)
      if (mcMatch) {
        answers.push({
          letter: mcMatch[2].toLowerCase(),
          text: mcMatch[3].trim(),
          correct: mcMatch[1] === '*'
        })
      }
    }

    return { answers, correctFeedback, incorrectFeedback, neutralFeedback }
  }

  private _updateHtml(): void {
    if (!fs.existsSync(this._quizPath)) {
      this._panel.webview.html = this._getErrorHtml('Quiz file not found')
      return
    }

    try {
      const content = fs.readFileSync(this._quizPath, 'utf8')
      this._currentQuiz = this._parseQuiz(content)
      this._panel.webview.html = this._getHtml(this._currentQuiz)
    } catch (error) {
      this._panel.webview.html = this._getErrorHtml('Failed to parse quiz: ' + error)
    }
  }

  private _getErrorHtml(message: string): string {
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:20px;text-align:center;}.error{color:var(--vscode-errorForeground);margin-top:40px;}</style></head><body><div class="error"><h2>Error</h2><p>' + escapeHtml(message) + '</p></div></body></html>'
  }

  private _getHtml(quiz: ParsedQuiz): string {
    const nonce = getNonce()
    const { metadata, questions } = quiz
    const totalPoints = questions.reduce((sum, q) => sum + q.points, 0)

    const questionsHtml = questions.map((q, idx) => this._renderEditableQuestion(q, idx)).join('')

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
            max-width: 1000px;
            margin: 0 auto;
            line-height: 1.5;
        }
        .header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            margin-bottom: 20px;
            padding-bottom: 16px;
            border-bottom: 2px solid var(--vscode-widget-border);
        }
        .header-left { flex: 1; }
        .title-input {
            font-size: 22px;
            font-weight: 600;
            background: transparent;
            border: 1px solid transparent;
            color: var(--vscode-foreground);
            width: 100%;
            padding: 4px 8px;
            border-radius: 4px;
        }
        .title-input:hover, .title-input:focus {
            border-color: var(--vscode-input-border);
            background: var(--vscode-input-background);
        }
        .header-actions { display: flex; gap: 8px; align-items: center; }
        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            font-family: inherit;
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }
        .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
        .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .btn-sm { padding: 4px 8px; font-size: 12px; }
        .btn-icon { padding: 4px 6px; min-width: 28px; justify-content: center; }
        
        .meta-section {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 12px;
            margin-bottom: 24px;
            padding: 16px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 8px;
            border: 1px solid var(--vscode-widget-border);
        }
        .meta-field { display: flex; flex-direction: column; gap: 4px; }
        .meta-label { font-size: 11px; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
        .meta-input {
            padding: 6px 8px;
            font-size: 13px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
        }
        .meta-input:focus { outline: none; border-color: var(--vscode-focusBorder); }
        .meta-checkbox { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
        .meta-checkbox input { width: 16px; height: 16px; }
        
        .add-question-bar {
            display: flex;
            gap: 8px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }
        
        .question {
            margin-bottom: 20px;
            padding: 16px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 8px;
            border: 1px solid var(--vscode-widget-border);
        }
        .question-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 12px;
        }
        .question-number {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            width: 32px;
            height: 32px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 600;
            flex-shrink: 0;
        }
        .question-type-select {
            padding: 4px 8px;
            font-size: 12px;
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 4px;
        }
        .question-points {
            display: flex;
            align-items: center;
            gap: 4px;
            margin-left: auto;
        }
        .points-input { width: 60px; text-align: center; }
        .question-actions { display: flex; gap: 4px; }
        
        .question-text-input {
            width: 100%;
            padding: 10px 12px;
            font-size: 14px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            margin-bottom: 12px;
            resize: vertical;
            min-height: 60px;
            font-family: inherit;
        }
        
        .answers { margin-left: 44px; }
        .answer {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 12px;
            margin-bottom: 6px;
            border-radius: 6px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border);
        }
        .answer.correct {
            border-color: var(--vscode-charts-green, #4caf50);
            background: rgba(76, 175, 80, 0.1);
        }
        .answer-correct-btn {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            border: 2px solid var(--vscode-widget-border);
            background: transparent;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            font-size: 12px;
        }
        .answer-correct-btn.checked {
            background: var(--vscode-charts-green, #4caf50);
            border-color: var(--vscode-charts-green, #4caf50);
            color: white;
        }
        .answer-letter { font-weight: 600; color: var(--vscode-descriptionForeground); min-width: 20px; }
        .answer-text-input {
            flex: 1;
            padding: 6px 8px;
            font-size: 13px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-family: inherit;
        }
        .answer-delete { opacity: 0.6; }
        .answer-delete:hover { opacity: 1; }
        
        .add-answer-btn {
            margin-left: 44px;
            margin-top: 8px;
        }
        
        .feedback-section {
            margin-top: 12px;
            margin-left: 44px;
            padding: 12px;
            background: var(--vscode-textBlockQuote-background);
            border-radius: 4px;
        }
        .feedback-field { margin-bottom: 8px; }
        .feedback-label { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
        .feedback-input {
            width: 100%;
            padding: 6px 8px;
            font-size: 12px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-family: inherit;
        }
        
        .matching-input { width: 40%; }
        .matching-arrow { color: var(--vscode-descriptionForeground); padding: 0 8px; }
        
        .summary {
            padding: 12px 16px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 8px;
            text-align: center;
            margin-top: 20px;
        }
        
        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 12px;
            margin-left: 12px;
        }
        .status-published { background: rgba(76, 175, 80, 0.2); color: var(--vscode-charts-green, #4caf50); }
        .status-unpublished { background: rgba(255, 152, 0, 0.2); color: var(--vscode-charts-orange, #ff9800); }
        
        .essay-notice {
            padding: 16px;
            border: 2px dashed var(--vscode-widget-border);
            border-radius: 6px;
            color: var(--vscode-descriptionForeground);
            text-align: center;
            font-style: italic;
            margin-left: 44px;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-left">
            <input type="text" class="title-input" id="quizTitle" value="${escapeHtml(String(metadata.title || 'Untitled Quiz'))}" placeholder="Quiz Title">
            ${metadata.published
        ? '<span class="status-badge status-published">Published</span>'
        : '<span class="status-badge status-unpublished">Draft</span>'}
        </div>
        <div class="header-actions">
            <button class="btn btn-secondary" id="refreshBtn">Refresh</button>
            <button class="btn btn-secondary" id="editMarkdownBtn">Edit Markdown</button>
        </div>
    </div>

    <div class="meta-section">
        <div class="meta-field">
            <label class="meta-label">Quiz Type</label>
            <select class="meta-input" id="quizType">
                <option value="practice_quiz" ${metadata.quiz_type === 'practice_quiz' ? 'selected' : ''}>Practice Quiz</option>
                <option value="graded_quiz" ${metadata.quiz_type === 'graded_quiz' ? 'selected' : ''}>Graded Quiz</option>
                <option value="survey" ${metadata.quiz_type === 'survey' ? 'selected' : ''}>Survey</option>
                <option value="graded_survey" ${metadata.quiz_type === 'graded_survey' ? 'selected' : ''}>Graded Survey</option>
            </select>
        </div>
        <div class="meta-field">
            <label class="meta-label">Time Limit (minutes)</label>
            <input type="number" class="meta-input" id="timeLimit" value="${metadata.time_limit || ''}" placeholder="No limit">
        </div>
        <div class="meta-field">
            <label class="meta-label">Allowed Attempts</label>
            <input type="number" class="meta-input" id="allowedAttempts" value="${metadata.allowed_attempts || ''}" placeholder="-1 = unlimited">
        </div>
        <div class="meta-field">
            <div class="meta-checkbox">
                <input type="checkbox" id="shuffleAnswers" ${metadata.shuffle_answers ? 'checked' : ''}>
                <label for="shuffleAnswers">Shuffle Answers</label>
            </div>
            <div class="meta-checkbox">
                <input type="checkbox" id="showCorrectAnswers" ${metadata.show_correct_answers !== false ? 'checked' : ''}>
                <label for="showCorrectAnswers">Show Correct Answers</label>
            </div>
            <div class="meta-checkbox">
                <input type="checkbox" id="published" ${metadata.published ? 'checked' : ''}>
                <label for="published">Published</label>
            </div>
        </div>
    </div>

    <div class="add-question-bar">
        <span style="color: var(--vscode-descriptionForeground); margin-right: 8px;">Add Question:</span>
        <button class="btn btn-secondary btn-sm" onclick="addQuestion('MC')">+ Multiple Choice</button>
        <button class="btn btn-secondary btn-sm" onclick="addQuestion('MA')">+ Multiple Answers</button>
        <button class="btn btn-secondary btn-sm" onclick="addQuestion('TF')">+ True/False</button>
        <button class="btn btn-secondary btn-sm" onclick="addQuestion('SA')">+ Short Answer</button>
        <button class="btn btn-secondary btn-sm" onclick="addQuestion('ESS')">+ Essay</button>
        <button class="btn btn-secondary btn-sm" onclick="addQuestion('NUM')">+ Numerical</button>
        <button class="btn btn-secondary btn-sm" onclick="addQuestion('MAT')">+ Matching</button>
    </div>

    <div class="questions" id="questionsContainer">
        ${questionsHtml}
    </div>

    <div class="summary">
        <strong>Quiz Summary:</strong> ${questions.length} questions | ${totalPoints} total points
        ${metadata.time_limit ? ' | ' + metadata.time_limit + ' minutes' : ''}
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        
        document.getElementById('quizTitle').addEventListener('change', (e) => {
            vscode.postMessage({ command: 'updateMetadata', key: 'title', value: e.target.value });
        });
        
        document.getElementById('quizType').addEventListener('change', (e) => {
            vscode.postMessage({ command: 'updateMetadata', key: 'quiz_type', value: e.target.value });
        });
        document.getElementById('timeLimit').addEventListener('change', (e) => {
            const val = e.target.value ? parseInt(e.target.value) : null;
            vscode.postMessage({ command: 'updateMetadata', key: 'time_limit', value: val });
        });
        document.getElementById('allowedAttempts').addEventListener('change', (e) => {
            const val = e.target.value ? parseInt(e.target.value) : null;
            vscode.postMessage({ command: 'updateMetadata', key: 'allowed_attempts', value: val });
        });
        document.getElementById('shuffleAnswers').addEventListener('change', (e) => {
            vscode.postMessage({ command: 'updateMetadata', key: 'shuffle_answers', value: e.target.checked });
        });
        document.getElementById('showCorrectAnswers').addEventListener('change', (e) => {
            vscode.postMessage({ command: 'updateMetadata', key: 'show_correct_answers', value: e.target.checked });
        });
        document.getElementById('published').addEventListener('change', (e) => {
            vscode.postMessage({ command: 'updateMetadata', key: 'published', value: e.target.checked });
        });
        
        document.getElementById('refreshBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'refresh' });
        });
        document.getElementById('editMarkdownBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'openMarkdown' });
        });
        
        function addQuestion(type) {
            vscode.postMessage({ command: 'addQuestion', type: type });
        }
        
        function deleteQuestion(index) {
            if (confirm('Delete this question?')) {
                vscode.postMessage({ command: 'deleteQuestion', questionIndex: index });
            }
        }
        
        function moveQuestion(index, direction) {
            vscode.postMessage({ command: 'moveQuestion', questionIndex: index, direction: direction });
        }
        
        function updateQuestionText(index, text) {
            const question = getQuestionData(index);
            question.text = text;
            vscode.postMessage({ command: 'updateQuestion', questionIndex: index, question: question });
        }
        
        function updateQuestionType(index, type) {
            const question = getQuestionData(index);
            question.type = type;
            vscode.postMessage({ command: 'updateQuestion', questionIndex: index, question: question });
        }
        
        function updateQuestionPoints(index, points) {
            const question = getQuestionData(index);
            question.points = parseFloat(points) || 1;
            vscode.postMessage({ command: 'updateQuestion', questionIndex: index, question: question });
        }
        
        function addAnswer(index) {
            vscode.postMessage({ command: 'addAnswer', questionIndex: index });
        }
        
        function deleteAnswer(qIndex, aIndex) {
            vscode.postMessage({ command: 'deleteAnswer', questionIndex: qIndex, answerIndex: aIndex });
        }
        
        function toggleCorrect(qIndex, aIndex) {
            vscode.postMessage({ command: 'toggleCorrect', questionIndex: qIndex, answerIndex: aIndex });
        }
        
        function updateAnswerText(qIndex, aIndex, text) {
            const question = getQuestionData(qIndex);
            question.answers[aIndex].text = text;
            vscode.postMessage({ command: 'updateQuestion', questionIndex: qIndex, question: question });
        }
        
        function updateMatchTarget(qIndex, aIndex, text) {
            const question = getQuestionData(qIndex);
            question.answers[aIndex].matchTarget = text;
            vscode.postMessage({ command: 'updateQuestion', questionIndex: qIndex, question: question });
        }
        
        function updateFeedback(qIndex, type, text) {
            const question = getQuestionData(qIndex);
            question[type] = text || undefined;
            vscode.postMessage({ command: 'updateQuestion', questionIndex: qIndex, question: question });
        }
        
        function getQuestionData(index) {
            const questionEl = document.querySelector('[data-question-index="' + index + '"]');
            return JSON.parse(questionEl.dataset.question);
        }
    </script>
</body>
</html>`
  }

  private _renderEditableQuestion(q: Question, idx: number): string {
    const typeOptions = [
      { value: 'MC', label: 'Multiple Choice' },
      { value: 'MA', label: 'Multiple Answers' },
      { value: 'TF', label: 'True/False' },
      { value: 'SA', label: 'Short Answer' },
      { value: 'ESS', label: 'Essay' },
      { value: 'FIB', label: 'Fill in Blank' },
      { value: 'MAT', label: 'Matching' },
      { value: 'NUM', label: 'Numerical' }
    ]

    const typeOptionsHtml = typeOptions.map(t =>
      '<option value="' + t.value + '" ' + (q.type === t.value ? 'selected' : '') + '>' + t.label + '</option>'
    ).join('')

    let answersHtml = ''

    if (q.type === 'ESS') {
      answersHtml = '<div class="essay-notice">Essay question - students will provide a written response</div>'
    } else if (q.type === 'MAT') {
      answersHtml = q.answers.map((a, aIdx) =>
        '<div class="answer correct">' +
        '<span class="answer-letter">' + a.letter + '.</span>' +
        '<input type="text" class="answer-text-input matching-input" value="' + escapeHtml(a.text) + '" ' +
        'onchange="updateAnswerText(' + idx + ', ' + aIdx + ', this.value)">' +
        '<span class="matching-arrow">→</span>' +
        '<input type="text" class="answer-text-input matching-input" value="' + escapeHtml(a.matchTarget || '') + '" ' +
        'onchange="updateMatchTarget(' + idx + ', ' + aIdx + ', this.value)">' +
        '<button class="btn btn-icon btn-secondary answer-delete" onclick="deleteAnswer(' + idx + ', ' + aIdx + ')">×</button>' +
        '</div>'
      ).join('')
    } else if (q.type === 'SA' || q.type === 'FIB' || q.type === 'NUM') {
      answersHtml = '<div style="color: var(--vscode-descriptionForeground); margin-bottom: 8px; font-size: 12px;">Accepted answers (all are correct):</div>' +
        q.answers.map((a, aIdx) =>
          '<div class="answer correct">' +
          '<span class="answer-correct-btn checked">✓</span>' +
          '<input type="text" class="answer-text-input" value="' + escapeHtml(a.text) + '" ' +
          'onchange="updateAnswerText(' + idx + ', ' + aIdx + ', this.value)">' +
          '<button class="btn btn-icon btn-secondary answer-delete" onclick="deleteAnswer(' + idx + ', ' + aIdx + ')">×</button>' +
          '</div>'
        ).join('')
    } else {
      answersHtml = q.answers.map((a, aIdx) =>
        '<div class="answer ' + (a.correct ? 'correct' : '') + '">' +
        '<button class="answer-correct-btn ' + (a.correct ? 'checked' : '') + '" onclick="toggleCorrect(' + idx + ', ' + aIdx + ')">' +
        (a.correct ? '✓' : '') +
        '</button>' +
        '<span class="answer-letter">' + a.letter + '.</span>' +
        '<input type="text" class="answer-text-input" value="' + escapeHtml(a.text) + '" ' +
        'onchange="updateAnswerText(' + idx + ', ' + aIdx + ', this.value)">' +
        '<button class="btn btn-icon btn-secondary answer-delete" onclick="deleteAnswer(' + idx + ', ' + aIdx + ')">×</button>' +
        '</div>'
      ).join('')
    }

    const feedbackHtml =
      '<div class="feedback-section">' +
      '<div class="feedback-field">' +
      '<div class="feedback-label">✓ Correct Feedback</div>' +
      '<input type="text" class="feedback-input" value="' + escapeHtml(q.correctFeedback || '') + '" ' +
      'onchange="updateFeedback(' + idx + ', \'correctFeedback\', this.value)" placeholder="Shown when answer is correct">' +
      '</div>' +
      '<div class="feedback-field">' +
      '<div class="feedback-label">✕ Incorrect Feedback</div>' +
      '<input type="text" class="feedback-input" value="' + escapeHtml(q.incorrectFeedback || '') + '" ' +
      'onchange="updateFeedback(' + idx + ', \'incorrectFeedback\', this.value)" placeholder="Shown when answer is incorrect">' +
      '</div>' +
      '<div class="feedback-field">' +
      '<div class="feedback-label">General Feedback</div>' +
      '<input type="text" class="feedback-input" value="' + escapeHtml(q.neutralFeedback || '') + '" ' +
      'onchange="updateFeedback(' + idx + ', \'neutralFeedback\', this.value)" placeholder="Always shown after answering">' +
      '</div>' +
      '</div>'

    const questionDataEscaped = escapeHtml(JSON.stringify(q))

    return '<div class="question" data-question-index="' + idx + '" data-question="' + questionDataEscaped + '">' +
      '<div class="question-header">' +
      '<span class="question-number">' + q.number + '</span>' +
      '<select class="question-type-select" onchange="updateQuestionType(' + idx + ', this.value)">' +
      typeOptionsHtml +
      '</select>' +
      '<div class="question-points">' +
      '<input type="number" class="meta-input points-input" value="' + q.points + '" step="0.5" min="0" ' +
      'onchange="updateQuestionPoints(' + idx + ', this.value)">' +
      '<span>pts</span>' +
      '</div>' +
      '<div class="question-actions">' +
      '<button class="btn btn-icon btn-secondary" onclick="moveQuestion(' + idx + ', \'up\')" title="Move up">↑</button>' +
      '<button class="btn btn-icon btn-secondary" onclick="moveQuestion(' + idx + ', \'down\')" title="Move down">↓</button>' +
      '<button class="btn btn-icon btn-secondary" onclick="deleteQuestion(' + idx + ')" title="Delete">🗑</button>' +
      '</div>' +
      '</div>' +
      '<textarea class="question-text-input" onchange="updateQuestionText(' + idx + ', this.value)">' + escapeHtml(q.text) + '</textarea>' +
      '<div class="answers">' +
      answersHtml +
      '</div>' +
      (q.type !== 'ESS' ? '<button class="btn btn-secondary btn-sm add-answer-btn" onclick="addAnswer(' + idx + ')">+ Add Answer</button>' : '') +
      feedbackHtml +
      '</div>'
  }

  public dispose(): void {
    QuizPreviewPanel.currentPanel = undefined
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
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }
  return text.replace(/[&<>"']/g, m => map[m])
}
