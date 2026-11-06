import { Button } from './ui/button'
import { Panel, PanelTitle } from './Page'
import type { FileControls } from '../screens/types'

export function IdealMatching({ files }: { files: FileControls }) {
  const used = new Set(Object.values(files.matching).filter(Boolean))
  return <Panel>
    <PanelTitle>Expert benchmark and learner matching</PanelTitle>
    <p className="m-0 text-sm text-muted-foreground">Upload an ideal-user CSV and choose one benchmark for each learner. Each ideal user can be assigned once. Unmatched learners are not graded.</p>
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label className="font-medium">Ideal gaze log
        <input className="ml-3 max-w-full" type="file" accept=".csv,.tsv,text/csv" disabled={files.reading || files.generating}
          onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) files.addIdeal(file) }} />
      </label>
      {files.ideal && <><span>{files.ideal.name}</span><Button variant="outline" disabled={files.reading || files.generating} onClick={files.removeIdeal}>Remove ideal log</Button></>}
      {files.gaze && <Button variant="outline" disabled={files.reading || files.generating} onClick={files.reprocess}>Reprocess files</Button>}
    </div>
    {files.reading && <p role="status" className="m-0 text-sm">Python is analyzing the files...</p>}
    {files.analysis && files.analysis.ideals.length > 0 && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {files.analysis.learners.map((learner) => <label key={learner.key} className="flex flex-col gap-2 text-sm">
        Learner {learner.userId}
        <select className="min-h-11 rounded-lg border bg-white px-3" disabled={files.reading || files.generating}
          value={files.matching[learner.key] ?? ''} onChange={(event) => files.setMatch(learner.key, event.target.value || null)}>
          <option value="">Unmatched</option>
          {files.analysis!.ideals.map((ideal) => <option key={ideal.key} value={ideal.key}
            disabled={used.has(ideal.key) && files.matching[learner.key] !== ideal.key}>{ideal.key}</option>)}
        </select>
      </label>)}
    </div>}
    {!files.analysis && <p className="m-0 text-xs text-muted-foreground">Upload a learner gaze log to analyze it with Python. The built-in demo is not sent to Claude.</p>}
    {files.analysis && !files.analysis.ideals.length && <p className="m-0 text-xs text-muted-foreground">Add an ideal log to enable Claude report generation in tab 3.</p>}
  </Panel>
}
