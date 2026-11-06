import { Panel, PanelTitle } from './Page'
import type { ClaudeReport as Report } from '../reportTypes'

export function ClaudeReportContent({ report, userKey }: { report: Report; userKey: string }) {
  const learner = report.reports[userKey]
  const lists = learner ? [
    ['Specific observations', learner.specific_observations], ['Strengths', learner.strengths],
    ['Missed or delayed checks', learner.missed_or_delayed_checks], ['Debrief questions', learner.follow_up_questions],
  ] as const : []
  return <div className="flex flex-col gap-5" data-testid="claude-report">
    <Panel>
      <PanelTitle>Cohort summary - whole recording</PanelTitle>
      <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed">{report.cohort_summary || 'No cohort summary returned.'}</p>
      <p className="m-0 text-xs text-muted-foreground">AI-generated interpretation for instructor review. Scores are debrief suggestions, not validated clinical competency assessments. Head gaze (headset-forward ray), not eye tracking. {report.model_used && <>Model: {report.model_used}.</>}</p>
      {report.unmatched_learners.length > 0 && <p className="m-0 text-xs text-muted-foreground">Unmatched: {report.unmatched_learners.join(', ')}</p>}
    </Panel>
    {report.raw_markdown_report && <Panel><PanelTitle>Unstructured AI response</PanelTitle>
      <p className="m-0 text-sm text-muted-foreground">Claude returned text instead of structured report fields. You can retry generation.</p>
      <pre className="m-0 whitespace-pre-wrap break-words font-sans text-sm">{report.raw_markdown_report}</pre>
    </Panel>}
    {learner ? <>
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><PanelTitle>Executive summary</PanelTitle><p className="mb-0 text-xs text-muted-foreground">Benchmark: {learner.matched_ideal_user}</p></div>
          <div className="rounded-xl bg-[#F0E6FA] px-5 py-3 text-center"><span className="text-3xl font-semibold">{learner.letter_grade}</span><span className="ml-3 text-sm">{learner.numeric_score}/100</span><div className="text-xs">AI suggested grade</div></div>
        </div>
        <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed">{learner.executive_summary}</p>
      </Panel>
      <Panel><PanelTitle>Rubric breakdown</PanelTitle>
        <div className="grid gap-4 lg:grid-cols-2">{learner.criteria_breakdown.map((criterion, index) => <div key={index} className="rounded-lg border p-4">
          <div className="flex items-start justify-between gap-3"><h3 className="m-0 text-sm font-semibold">{criterion.criterion}</h3><strong className="rounded bg-[#E4EFFA] px-2 py-1 text-sm">{criterion.grade}</strong></div>
          <p className="mb-0 whitespace-pre-wrap text-sm leading-relaxed">{criterion.rationale}</p>
        </div>)}</div>
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2">{lists.map(([title, entries]) => <Panel key={title}><PanelTitle>{title}</PanelTitle>
        {entries.length ? <ul className="m-0 list-disc space-y-2 pl-5 text-sm leading-relaxed">{entries.map((text, index) => <li key={index}>{text}</li>)}</ul> : <p className="m-0 text-sm text-muted-foreground">None provided.</p>}
      </Panel>)}</div>
      <Panel><PanelTitle>Recommended next focus</PanelTitle><p className="m-0 whitespace-pre-wrap text-sm leading-relaxed">{learner.recommended_next_focus}</p></Panel>
    </> : !report.raw_markdown_report && <Panel><PanelTitle>No report for {userKey}</PanelTitle>
      <p className="m-0 text-sm">{report.unmatched_learners.includes(userKey) ? 'This learner has no matched ideal user. Choose a match in tab 1 and generate a new report.' : 'Claude did not return a report for this learner. Other learners’ reports have not been substituted. Retry generation if this learner was matched.'}</p>
    </Panel>}
  </div>
}
