import { Wrench, Terminal as TerminalIcon, Cpu } from 'lucide-react';

export default function FoundryView() {
  return (
    <div className="flex-1 grid grid-cols-12 gap-4 h-full">
      <div className="col-span-8 glass-panel rounded-xl p-6 flex flex-col h-full relative overflow-hidden">
        <div className="absolute top-0 left-0 w-64 h-64 bg-emerald-500/10 blur-[100px] rounded-full pointer-events-none" />
        
        <div className="flex items-center gap-3 mb-6 border-b border-white/5 pb-4 z-10">
          <Wrench className="w-5 h-5 text-emerald-400" />
          <h1 className="font-mono text-lg text-slate-200">Foundry Sandbox</h1>
        </div>

        <div className="flex-1 bg-[#0a0f18] rounded-lg border border-slate-800 overflow-hidden flex flex-col font-mono z-10">
          <div className="bg-slate-900 px-4 py-2 border-b border-slate-800 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/80"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/80"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/80"></span>
            <span className="ml-4 text-slate-500 text-xs text-center w-full block">new_tool_generator.ts</span>
          </div>
          <textarea 
            className="flex-1 bg-transparent p-4 text-slate-300 text-sm resize-none focus:outline-none"
            spellCheck={false}
            defaultValue={`// Generate tools dynamically using LLM\n\nexport const newTool = {\n   name: 'example_skill',\n   description: 'Executes safely',\n   run: async () => {\n      console.log("Foundry operational.");\n   }\n};`}
          />
        </div>
      </div>

      <div className="col-span-4 flex flex-col gap-4">
        <div className="glass-panel shrink-0 p-4 rounded-xl text-sm font-mono flex flex-col">
          <div className="flex items-center gap-2 mb-3 text-slate-300 border-b border-white/5 pb-2">
            <Cpu className="w-4 h-4 text-slate-400" />
            <h3 className="uppercase tracking-widest text-xs">Skill Inventory</h3>
          </div>
          <div className="space-y-2">
            {['run_shell_command', 'google_drive_read', 'check_tasks', 'self_edit'].map(t => (
              <div key={t} className="bg-slate-900/50 px-3 py-2 rounded flex items-center justify-between border border-transparent hover:border-slate-700 transition-colors">
                <span className="text-slate-400 font-mono text-xs">{t}</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              </div>
            ))}
          </div>
        </div>
        
        <div className="glass-panel flex-1 rounded-xl p-4 flex flex-col pb-0">
           <div className="flex items-center gap-2 mb-3 text-slate-300 border-b border-white/5 pb-2">
            <TerminalIcon className="w-4 h-4 text-slate-400" />
            <h3 className="uppercase tracking-widest text-xs">Compiler Output</h3>
          </div>
          <div className="text-emerald-500/80 text-xs font-mono">
            &gt; tsc && node build.js<br/>
            &gt; SUCCESS: Tool compiled.
          </div>
        </div>
      </div>
    </div>
  );
}
