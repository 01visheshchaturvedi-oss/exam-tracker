const fs = require('fs');

const backup = JSON.parse(fs.readFileSync('D:\\Claude Workspace\\exam tracker\\examrigor-backup.json','utf8'));
const logs = JSON.parse(backup.examrigor_logs).filter(l => l.id !== '1774065805329-of5wu4x9af');
const bm = JSON.parse(backup.examrigor_benchmarks);
bm['Quants Practice'] = {task_name:'Quants Practice',best_seconds:3631,last_seconds:7350,sessions:2};

const data = {
  examrigor_settings:    backup.examrigor_settings,
  examrigor_library:     backup.examrigor_library,
  examrigor_daily_tasks: backup.examrigor_daily_tasks,
  examrigor_logs:        JSON.stringify(logs),
  examrigor_benchmarks:  JSON.stringify(bm),
  examrigor_daily_goals: backup.examrigor_daily_goals,
  examrigor_reminders:   backup.examrigor_reminders || '[]',
  examrigor_telegram:    backup.examrigor_telegram || '{}'
};

const jsLines = Object.entries(data)
  .map(([k,v]) => `  localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
  .join('\n');

const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>ExamRigor Restore</title>
<style>
body{font-family:monospace;background:#0f172a;color:#fff;display:flex;align-items:center;
     justify-content:center;height:100vh;margin:0;flex-direction:column;}
.box{background:#1e293b;border:1px solid #334155;border-radius:12px;
     padding:40px;max-width:520px;text-align:center;}
h2{color:#10b981;margin:0 0 16px}
p{color:#94a3b8;margin:0 0 20px;line-height:1.6}
.ok{color:#10b981;font-size:1.1em;font-weight:bold}
.err{color:#ef4444}
a{color:#fff;text-decoration:none;display:inline-block;margin-top:20px;
  padding:12px 28px;background:#1d4ed8;border-radius:8px;font-size:1em;}
</style></head><body>
<div class="box">
  <h2>&#x2705; ExamRigor &mdash; Data Restore</h2>
  <p>Removing the 34h 35m ghost entry and restoring<br>all 34 real sessions cleanly into localStorage.</p>
  <div id="status">Working...</div>
</div>
<script>
try {
  localStorage.removeItem('examrigor_active_task');
  localStorage.removeItem('examrigor_paused_tasks');
  localStorage.removeItem('examrigor_last_stopped');
${jsLines}
  var logs = JSON.parse(localStorage.getItem('examrigor_logs') || '[]');
  var bad = logs.filter(function(l){ return l.id === '1774065805329-of5wu4x9af'; });
  if (bad.length > 0) throw new Error('Bad entry still present — contact support');
  document.getElementById('status').innerHTML =
    '<span class="ok">&#x2705; Done! ' + logs.length + ' clean sessions restored.<br>Ghost entry is gone.</span>' +
    '<br><a href="/">Open ExamRigor &rarr;</a>';
} catch(e) {
  document.getElementById('status').innerHTML = '<span class="err">Error: ' + e.message + '</span>';
}
</script></body></html>`;

fs.writeFileSync('D:\\Claude Workspace\\exam tracker\\public\\restore.html', html, 'utf8');
console.log('Done. Size:', fs.statSync('D:\\Claude Workspace\\exam tracker\\public\\restore.html').size, 'bytes');
console.log('Bad ID in final HTML:', html.includes('1774065805329') ? 'YES-ERROR' : 'NO-CLEAN');
