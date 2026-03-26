import { Users, Bot, Zap, Activity, ShieldCheck, AlertTriangle } from 'lucide-react';

export default function CrewView() {
  const agents = [
    { id: 'executive', name: 'Executive Council', role: 'Planner & Orchestrator', status: 'active', model: 'gemini-3.1-pro', load: '12%', tokens: '14.2k' },
    { id: 'coder', name: 'Code Architect', role: 'Developer', status: 'idle', model: 'gemini-3.1-pro', load: '0%', tokens: '45.1k' },
    { id: 'researcher', name: 'Researcher', role: 'Web & Docs Research', status: 'active', model: 'gemini-3-flash', load: '84%', tokens: '102.5k' },
    { id: 'memory', name: 'Memory Core', role: 'Vector Search & Recall', status: 'idle', model: 'gemini-3-flash', load: '2%', tokens: '8.3k' },
    { id: 'security', name: 'Guardrail', role: 'Output Validation', status: 'warning', model: 'gemini-3.1-flash-lite', load: '45%', tokens: '2.1k' },
    { id: 'terminal', name: 'Shell Ops', role: 'System Execution', status: 'idle', model: 'gemini-3-flash', load: '0%', tokens: '1.4k' },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-neon-cyan bg-neon-cyan/10 border-neon-cyan/50 shadow-[0_0_10px_rgba(0,240,255,0.2)]';
      case 'warning': return 'text-amber-400 bg-amber-400/10 border-amber-400/50 shadow-[0_0_10px_rgba(251,191,36,0.2)]';
      default: return 'text-slate-400 bg-slate-800/50 border-slate-700';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active': return <Activity className="w-3.5 h-3.5" />;
      case 'warning': return <AlertTriangle className="w-3.5 h-3.5" />;
      default: return <Bot className="w-3.5 h-3.5" />;
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between gap-3 mb-6 shrink-0 z-10">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-neon-purple" />
          <h1 className="font-mono text-lg text-slate-200 uppercase tracking-widest">Agent Crew</h1>
        </div>
        <div className="flex gap-4 font-mono text-xs">
          <div className="flex items-center gap-1.5 text-slate-400">
            <span className="w-2 h-2 rounded-full bg-neon-cyan shadow-[0_0_5px_#00f0ff]"></span> 2 Active
          </div>
          <div className="flex items-center gap-1.5 text-slate-400">
            <span className="w-2 h-2 rounded-full bg-slate-600"></span> 3 Idle
          </div>
          <div className="flex items-center gap-1.5 text-slate-400">
            <span className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_5px_#fbbf24]"></span> 1 Warning
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6 overflow-y-auto pb-6 relative z-10">
        {agents.map(agent => (
          <div key={agent.id} className="glass-panel rounded-xl p-5 flex flex-col group hover:border-slate-500 transition-all">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center border ${getStatusColor(agent.status)}`}>
                  {getStatusIcon(agent.status)}
                </div>
                <div>
                  <h3 className="text-white font-bold tracking-wide">{agent.name}</h3>
                  <p className="text-xs text-slate-500 uppercase tracking-wider font-mono">{agent.role}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
              <div className="bg-slate-900/50 rounded p-2 border border-white/5">
                <span className="block text-[10px] text-slate-500 font-mono mb-1 uppercase">Model</span>
                <div className="flex items-center gap-1.5 text-slate-300 text-xs">
                  <Zap className="w-3 h-3 text-emerald-400" />
                  {agent.model}
                </div>
              </div>
              <div className="bg-slate-900/50 rounded p-2 border border-white/5">
                <span className="block text-[10px] text-slate-500 font-mono mb-1 uppercase">Total Tokens</span>
                <span className="text-slate-300 text-xs font-mono">{agent.tokens}</span>
              </div>
            </div>

            <div className="mt-auto">
              <div className="flex justify-between text-xs mb-1.5 font-mono">
                <span className="text-slate-500">Current Load</span>
                <span className={agent.status === 'active' ? 'text-neon-cyan' : 'text-slate-400'}>{agent.load}</span>
              </div>
              <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                <div 
                  className={`h-full rounded-full transition-all duration-1000 ${agent.status === 'active' ? 'bg-neon-cyan shadow-[0_0_8px_#00f0ff]' : agent.status === 'warning' ? 'bg-amber-400' : 'bg-slate-600'}`} 
                  style={{ width: agent.load }}
                />
              </div>
            </div>
            
            {/* Quick Actions overlay via hover */}
            <div className="mt-4 pt-4 border-t border-white/5 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs py-1.5 rounded font-mono transition-colors">
                Configure
              </button>
              {agent.status === 'active' && (
                <button className="flex-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-xs py-1.5 rounded font-mono transition-colors">
                  Kill Task
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
