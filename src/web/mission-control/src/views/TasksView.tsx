import { ListTodo, Plus, MoreHorizontal, Clock } from 'lucide-react';

export default function TasksView() {
  const columns = [
    { id: 'inbox', title: 'Inbox / Pending', color: 'border-slate-700' },
    { id: 'active', title: 'In Progress', color: 'border-neon-cyan/50' },
    { id: 'done', title: 'Completed', color: 'border-emerald-500/50' }
  ];

  const mockTasks = [
    { id: 1, title: 'Analyze system logs for anomalies', priority: 'high', assignee: 'Executive', status: 'active', time: '2h ago' },
    { id: 2, title: 'Draft weekly summary report', priority: 'medium', assignee: 'Researcher', status: 'inbox', time: '1d ago' },
    { id: 3, title: 'Update vector memory core', priority: 'high', assignee: 'Coder', status: 'done', time: '3h ago' }
  ];

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between gap-3 mb-6 shrink-0">
        <div className="flex items-center gap-2">
          <ListTodo className="w-5 h-5 text-neon-cyan" />
          <h1 className="font-mono text-lg text-slate-200 uppercase tracking-widest">Tasks Overview</h1>
        </div>
        <button className="bg-neon-cyan/10 hover:bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30 px-4 py-1.5 rounded text-sm font-mono flex items-center gap-2 transition-colors">
          <Plus className="w-4 h-4" /> New Task
        </button>
      </div>

      <div className="flex-1 grid grid-cols-3 gap-6 overflow-hidden min-h-0">
        {columns.map(col => (
          <div key={col.id} className={`glass-panel rounded-xl flex flex-col overflow-hidden border-t-2 ${col.color}`}>
            <div className="p-4 border-b border-white/5 flex items-center justify-between shrink-0">
              <h2 className="font-mono text-sm uppercase text-slate-300 tracking-wider font-bold">{col.title}</h2>
              <span className="bg-slate-800 text-slate-400 text-xs px-2 py-0.5 rounded-full font-mono">
                {mockTasks.filter(t => t.status === col.id || (col.id === 'active' && t.status === 'active')).length}
              </span>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
              {mockTasks.filter(t => t.status === col.id || (col.id === 'active' && t.status === 'active')).map(task => (
                <div key={task.id} className="bg-slate-900/80 border border-slate-700/50 rounded-lg p-3 hover:border-slate-500 transition-colors cursor-pointer group">
                  <div className="flex items-start justify-between mb-2">
                    <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${
                      task.priority === 'high' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
                    }`}>
                      {task.priority}
                    </span>
                    <button className="text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity hover:text-white">
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>
                  <h3 className="text-sm text-slate-200 mb-3">{task.title}</h3>
                  <div className="flex items-center justify-between text-xs font-mono text-slate-500">
                    <div className="flex items-center gap-1.5">
                      <div className="w-5 h-5 rounded bg-slate-800 flex items-center justify-center text-[10px] text-cyan-400 border border-slate-700">
                        {task.assignee.charAt(0)}
                      </div>
                      <span className="text-slate-400">{task.assignee}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {task.time}
                    </div>
                  </div>
                </div>
              ))}
              
              {mockTasks.filter(t => t.status === col.id || (col.id === 'active' && t.status === 'active')).length === 0 && (
                <div className="h-24 border-2 border-dashed border-slate-700/50 rounded-lg flex items-center justify-center text-slate-600 text-sm font-mono">
                  Drop tasks here
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
