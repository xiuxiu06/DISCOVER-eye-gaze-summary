export interface LearnerReport {
  matched_ideal_user: string
  letter_grade: string
  numeric_score: number
  executive_summary: string
  criteria_breakdown: { criterion: string; grade: string; rationale: string }[]
  specific_observations: string[]
  strengths: string[]
  missed_or_delayed_checks: string[]
  follow_up_questions: string[]
  recommended_next_focus: string
}

export interface ClaudeReport {
  cohort_summary: string
  reports: Record<string, LearnerReport>
  model_used: string
  unmatched_learners: string[]
  raw_markdown_report?: string
}

/** Runtime validation at the HTTP and browser-storage boundaries. */
export function validateReport(value: unknown): ClaudeReport {
  const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
  const strings = (x: unknown) => Array.isArray(x) && x.every((entry) => typeof entry === 'string')
  const grade = (x: unknown) => typeof x === 'string' && /^[ABCDF][+-]?$/.test(x)
  if (!record(value) || !record(value.reports) || typeof value.cohort_summary !== 'string' ||
      typeof value.model_used !== 'string' || !strings(value.unmatched_learners)) throw new Error('Invalid report response.')
  if (value.raw_markdown_report !== undefined && typeof value.raw_markdown_report !== 'string') throw new Error('Invalid report fallback.')
  for (const [key, item] of Object.entries(value.reports)) {
    if (!/^user\d+$/.test(key) || !record(item) || typeof item.matched_ideal_user !== 'string' ||
        !/^idealUser\d+$/.test(item.matched_ideal_user) || !grade(item.letter_grade) ||
        typeof item.numeric_score !== 'number' || !Number.isFinite(item.numeric_score) || item.numeric_score < 0 || item.numeric_score > 100 ||
        typeof item.executive_summary !== 'string' || typeof item.recommended_next_focus !== 'string' ||
        !Array.isArray(item.criteria_breakdown) || !item.criteria_breakdown.length ||
        !item.criteria_breakdown.every((criterion) => record(criterion) && typeof criterion.criterion === 'string' && grade(criterion.grade) && typeof criterion.rationale === 'string') ||
        !['specific_observations', 'strengths', 'missed_or_delayed_checks', 'follow_up_questions'].every((field) => strings(item[field]))) {
      throw new Error('Invalid learner report: ' + key)
    }
  }
  if (!Object.keys(value.reports).length && !value.raw_markdown_report) throw new Error('Claude returned no report content.')
  return value as unknown as ClaudeReport
}
