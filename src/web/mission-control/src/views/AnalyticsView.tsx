import { LineChart, DollarSign, Zap, TrendingUp, BarChart3 } from 'lucide-react';

export default function AnalyticsView() {
  const agentCosts = [
    { name: 'Executive Council', cost: 12.45, pct: 30 },
    { name: 'Code Architect', cost: 18.20, pct: 45 },
    { name: 'Researcher', cost: 8.50, pct: 20 },
    { name: 'Memory Core', cost: 2.10, pct: 5 }
  ];

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 mb-6 shrink-0 z-10">
        <LineChart className="w-5 h-5 text-fuchsia-500" />
        <h1 className="font-mono text-lg text-slate-200 uppercase tracking-widest">Cost & Analytics</h1>
      </div>

      <div className="grid grid-cols-3 gap-6 mb-6 shrink-0 z-10">
        <div className="glass-panel p-5 rounded-xl border-t-2 border-fuchsia-500">
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-400 font-mono text-xs uppercase tracking-wider">Total Est. Cost</span>
            <DollarSign className="w-4 h-4 text-fuchsia-500" />
          </div>
          <div className="text-3xl font-bold text-white mb-1">$42.85</div>
          <div className="flex items-center gap-1 text-emerald-400 text-xs font-mono">
            <TrendingUp className="w-3 h-3" /> +12% this week
          </div>
        </div>
        
        <div className="glass-panel p-5 rounded-xl border-t-2 border-neon-cyan">
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-400 font-mono text-xs uppercase tracking-wider">Tokens In/Out</span>
            <Zap className="w-4 h-4 text-neon-cyan" />
          </div>
          <div className="text-3xl font-bold text-white mb-1">1.2M</div>
          <div className="flex gap-3 text-xs font-mono mt-1">
            <span className="text-slate-500">In: <span className="text-slate-300">950k</span></span>
            <span className="text-slate-500">Out: <span className="text-neon-cyan">250k</span></span>
          </div>
        </div>

        <div className="glass-panel p-5 rounded-xl border-t-2 border-emerald-500">
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-400 font-mono text-xs uppercase tracking-wider">Cache Savings</span>
            <BarChart3 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-3xl font-bold text-white mb-1">$14.20</div>
          <div className="text-slate-500 text-xs font-mono mt-1">
            Gemini Context Caching active
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 flex-1 min-h-0 z-10">
        <div className="glass-panel rounded-xl p-6 flex flex-col">
           <h2 className="font-mono text-sm uppercase text-slate-300 tracking-wider mb-6 pb-2 border-b border-white/5">Cost by Agent</h2>
           <div className="space-y-4 flex-1 overflow-y-auto pr-2">
             {agentCosts.map(agent => (
               <div key={agent.name} className="flex flex-col gap-2">
                 <div className="flex items-center justify-between text-sm">
                   <span className="text-slate-300">{agent.name}</span>
                   <span className="font-mono text-fuchsia-400">${agent.cost.toFixed(2)}</span>
                 </div>
                 <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden">
                   <div 
                     className="h-full bg-fuchsia-500 rounded-full"
                     style={{ width: `${agent.pct}%` }}
                   />
                 </div>
               </div>
             ))}
           </div>
        </div>

        <div className="glass-panel rounded-xl p-6 flex flex-col items-center justify-center relative overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-fuchsia-500/10 blur-[50px] rounded-full pointer-events-none" />
           <h2 className="font-mono text-sm uppercase text-slate-300 tracking-wider w-full absolute top-6 left-6">Trend Chart Placeholder</h2>
           <div className="text-slate-600 font-mono text-sm flex items-center justify-center h-full w-full border-2 border-dashed border-slate-700/50 rounded-lg">
             [ Chart Component (Recharts/ChartJS) ]
           </div>
        </div>
      </div>
    </div>
  );
}
