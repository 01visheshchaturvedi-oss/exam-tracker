const fs = require('fs');
const path = 'D:\\Claude Workspace\\exam tracker\\examrigor-backup.json';

// Read current backup (may still be corrupted)
const raw = fs.readFileSync(path, 'utf8');
const backup = JSON.parse(raw);

// Fix logs
const logs = JSON.parse(backup.examrigor_logs);
const cleanLogs = logs.filter(l => l.id !== '1774065805329-of5wu4x9af');

// Fix benchmarks
const bm = JSON.parse(backup.examrigor_benchmarks);
bm['Quants Practice'] = { task_name:'Quants Practice', best_seconds:3631, last_seconds:7350, sessions:2 };

// Write clean backup
const clean = {
  ...backup,
  examrigor_logs: JSON.stringify(cleanLogs),
  examrigor_benchmarks: JSON.stringify(bm),
  examrigor_active_task: 'null',
  _savedAt: new Date().toISOString()
};
fs.writeFileSync(path, JSON.stringify(clean, null, 2), 'utf8');

// Verify
const v = JSON.parse(fs.readFileSync(path,'utf8'));
const vLogs = JSON.parse(v.examrigor_logs);
const bad = vLogs.filter(l => l.id === '1774065805329-of5wu4x9af');
console.log('Bad entries remaining:', bad.length === 0 ? 'ZERO - CLEAN' : 'STILL THERE - ERROR');
console.log('Total logs:', vLogs.length);
