import { Clock, Play, Pause, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function CronsView() {
  const crons = [
    { id: '1', name: 'Database Vector Vacuum', cron: '0 2 * * *', nextRun: 'in 4 hours', status: 'active', lastRunStatus: 'success' },
    { id: '2', name: 'Daily Briefing Generation', cron: '30 7 * * *', nextRun: 'in 9 hours', status: 'active', lastRunStatus: 'success' },
    { id: '3', name: 'Error Log Aggregation', cron: '0 * * * *', nextRun: 'in 15 mins', status: 'paused', lastRunStatus: 'error' },
    { id: '4', name: 'GitHub Repo Sync', cron: '*/15 * * * *', nextRun: 'in 2 mins', status: 'active', lastRunStatus: 'success' }
  ];

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 mb-6 shrink-0 z-10">
        <Clock className="w-5 h-5 text-amber-500" />
        <h1 className="font-mono text-lg text-slate-200 uppercase tracking-widest">Cron Manager</h1>
      </div>

      <div className="glass-panel rounded-xl flex-1 flex flex-col overflow-hidden z-10 border border-slate-800">
        <div className="grid grid-cols-12 gap-4 bg-slate-900 border-b border-slate-700 p-4 font-mono text-xs uppercase tracking-wider text-slate-400">
          <div className="col-span-1">Status</div>
          <div className="col-span-4">Job Name</div>
          <div className="col-span-2 text-center">Schedule (CRON)</div>
          <div className="col-span-2 text-center">Next Run</div>
          <div className="col-span-3 text-right">Actions</div>
        </div>
        
        <div className="flex-1 overflow-y-auto">
          {crons.map((job) => (
            <div key={job.id} className="grid grid-cols-12 gap-4 items-center border-b border-white/5 p-4 hover:bg-slate-800/30 transition-colors group">
              <div className="col-span-1 flex justify-center">
                {job.lastRunStatus === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-500" />
                )}
              </div>
              
              <div className="col-span-4">
                <div className="text-slate-200 font-medium">{job.name}</div>
                <div className="text-xs text-slate-500 font-mono mt-0.5">Last run: success</div>
              </div>
              
              <div className="col-span-2 flex justify-center">
                <span className="bg-slate-900 border border-slate-700 text-slate-300 font-mono px-2 py-1 rounded text-xs">
                  {job.cron}
                </span>
              </div>
              
              <div className="col-span-2 flex justify-center">
                <span className="text-amber-400/90 font-mono text-sm flex items-center gap-1.5">
                  <Clock className="w-3 h-3" /> {job.nextRun}
                </span>
              </div>
              
              <div className="col-span-3 flex justify-end gap-2 pr-2">
                <button 
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors
                    ${job.status === 'active' 
                      ? 'bg-slate-800 text-amber-400 hover:bg-slate-700' 
                      : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/30'}`}
                  title={job.status === 'active' ? 'Pause' : 'Resume'}
                >
                  {job.status === 'active' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
                <button 
                  className="bg-neon-cyan/10 border border-neon-cyan/20 text-neon-cyan hover:bg-neon-cyan/20 px-3 py-1.5 rounded-lg text-xs font-mono transition-colors"
                >
                  Run Now
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
