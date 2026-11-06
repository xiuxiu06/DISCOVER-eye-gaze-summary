import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'error'});
try {
 const {processLog}=await vite.ssrLoadModule('/src/processLog.ts');
 const meta=JSON.parse(readFileSync('public/data/meta.json','utf8'));
 const d=processLog(readFileSync('../data/raw/eye_gaze_tracking_050505092026.csv','utf8'),readFileSync('../data/lane_map.csv','utf8'),meta,'builtin.csv').dataset.advancedSummary;
 writeFileSync('public/gaze-summary-advanced.json',JSON.stringify({relevant_objects:d.relevant_objects,...Object.fromEntries(d.users.map(u=>['user'+u.userId,u.entries]))}));
 console.log('Uncondensed summary:',d.relevant_objects.length,'objects');
}finally{await vite.close()}
