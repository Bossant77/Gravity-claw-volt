import { Folder, FileCode, FileText, Settings, Search, FileJson } from 'lucide-react';

export default function WorkspaceView() {
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
       <div className="flex items-center gap-3 mb-6 shrink-0 z-10">
        <Folder className="w-5 h-5 text-indigo-400" />
        <h1 className="font-mono text-lg text-slate-200 uppercase tracking-widest">Workspace Browser</h1>
      </div>

      <div className="flex-1 grid grid-cols-12 gap-6 overflow-hidden min-h-0 z-10">
        {/* File Tree Sidebar */}
        <div className="col-span-3 glass-panel rounded-xl flex flex-col overflow-hidden border border-slate-800">
          <div className="p-3 border-b border-white/5 bg-slate-900/50">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input 
                type="text" 
                placeholder="Search workspace..." 
                className="w-full bg-slate-900 border border-slate-700 rounded text-xs px-8 py-1.5 focus:outline-none focus:border-indigo-500/50 text-slate-300 font-mono transition-colors"
              />
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-2 space-y-1 font-mono text-sm text-slate-400">
            {/* Folder: ROOT */}
            <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-800/50 cursor-pointer rounded text-slate-300">
              <Folder className="w-4 h-4 text-indigo-400" />
              <span>volt-workspace/</span>
            </div>
            
            {/* Files */}
            <div className="flex items-center gap-2 px-2 py-1.5 ml-4 hover:bg-slate-800/50 cursor-pointer rounded">
              <FileText className="w-3.5 h-3.5 text-slate-500" />
              <span>MEMORY.md</span>
            </div>
            <div className="flex items-center gap-2 px-2 py-1.5 ml-4 hover:bg-slate-800/50 cursor-pointer rounded">
              <FileText className="w-3.5 h-3.5 text-slate-500" />
              <span>SOUL.md</span>
            </div>
            <div className="flex items-center gap-2 px-2 py-1.5 ml-4 hover:bg-slate-800/50 cursor-pointer rounded bg-indigo-500/10 text-indigo-300">
              <FileJson className="w-3.5 h-3.5 text-yellow-500" />
              <span>openclaw.json</span>
            </div>
            
            <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-800/50 cursor-pointer rounded text-slate-300 mt-2">
              <Folder className="w-4 h-4 text-slate-500" />
              <span>scripts/</span>
            </div>
            <div className="flex items-center gap-2 px-2 py-1.5 ml-4 hover:bg-slate-800/50 cursor-pointer rounded">
              <FileCode className="w-3.5 h-3.5 text-teal-500" />
              <span>deploy.ts</span>
            </div>
          </div>
        </div>

        {/* Editor/Preview Area */}
        <div className="col-span-9 glass-panel rounded-xl flex flex-col overflow-hidden border border-slate-800">
          <div className="p-3 border-b border-white/5 bg-slate-900/50 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-mono text-slate-300">
              <span className="text-slate-500">volt-workspace/</span>openclaw.json
            </div>
            <div className="flex items-center gap-2">
              <button className="text-xs font-mono text-slate-500 hover:text-white transition-colors bg-slate-800 px-3 py-1 rounded">Save</button>
            </div>
          </div>
          
          <div className="flex-1 bg-[#0a0f18] p-4 overflow-auto">
            <textarea 
              className="w-full h-full bg-transparent text-slate-300 text-sm font-mono resize-none focus:outline-none"
              spellCheck={false}
              defaultValue={`{
  "agent_name": "Gravity Claw",
  "version": "1.0.0",
  "gateway_port": 3000,
  "telemetry": true,
  "council": {
    "enabled": true,
    "max_iterations": 10
  },
  "permissions": {
    "shell_exec": "approve_always",
    "git_commit": "auto"
  }
}`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
