import { Library, Search, FileText } from 'lucide-react';

export default function ArchiveView() {
  return (
    <div className="flex-1 glass-panel rounded-xl p-6 flex flex-col h-full overflow-hidden relative">
      <div className="flex items-center gap-3 mb-6 border-b border-white/5 pb-4">
        <Library className="w-5 h-5 text-neon-purple" />
        <h1 className="font-mono text-lg text-slate-200">Semantic Brain Archive</h1>
      </div>
      
      <div className="mb-6 relative">
        <input 
          type="text" 
          placeholder="Query Memory Clusters (PgVector)..." 
          className="w-full bg-slate-900/50 border border-slate-700 rounded-lg py-3 px-10 text-white font-mono text-sm focus:outline-none focus:border-neon-purple/50 transition-colors shadow-inner"
        />
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
      </div>

      <div className="grid grid-cols-3 gap-6 flex-1 overflow-auto">
        {[
          { title: "Project context", role: "core", content: "Volt is a multi-agent system..." },
          { title: "User preferences", role: "episodic", content: "Likes clean code, dark mode..." },
          { title: "Known bugs", role: "fact", content: "Needs #root height fix for CSS." }
        ].map((doc, i) => (
          <div key={i} className="bg-slate-900/30 border border-white/5 rounded-xl p-4 flex flex-col hover:bg-slate-900/60 transition-colors cursor-pointer group">
            <div className="flex items-center justify-between mb-3">
              <FileText className="w-4 h-4 text-slate-500 group-hover:text-neon-purple transition-colors" />
              <span className="text-[10px] uppercase tracking-widest text-slate-500 bg-slate-800 px-2 py-0.5 rounded">{doc.role}</span>
            </div>
            <h3 className="font-mono text-slate-300 mb-2 truncate">{doc.title}</h3>
            <p className="text-slate-400 text-sm line-clamp-3">{doc.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
