import { Terminal as TerminalIcon, Disc, Send, Globe, Folder, TerminalSquare, Maximize2, Cpu } from 'lucide-react';
import { useRef, useEffect, useState } from 'react';

// Extract human-readable text from a gateway event payload
function formatPayload(ev: any): string {
  const p = ev.payload;
  if (!p) return '';
  if (typeof p === 'string') return p;

  if (ev.type === 'user_prompt' && p.text) return p.text;
  if (ev.type === 'reply' && p.text) return p.text;
  if (ev.type === 'thought') return `${p.action || ''}: ${p.detail || ''}`;
  if (ev.type === 'council') return `[${p.agentId}] ${p.status}: ${p.message || ''}`;
  if (ev.type === 'action') return `⚠ ${p.toolName}(${JSON.stringify(p.args || {})})`;

  return p.text || p.detail || p.message || JSON.stringify(p);
}

function typeLabel(type: string): string {
  const map: Record<string, string> = {
    user_prompt: 'YOU',
    reply: 'VOLT',
    thought: 'SYSTEM',
    council: 'COUNCIL',
    action: 'ACTION',
  };
  return map[type] || type.toUpperCase();
}

export default function DashboardView({ events, stats, onSendMessage }: any) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [chatInput, setChatInput] = useState("");
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  const [enabledTools, setEnabledTools] = useState<string[]>(['web_search', 'read_file', 'write_file', 'run_shell_command']);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && chatInput.trim()) {
      onSendMessage(chatInput, { mode: 'council', tools: enabledTools });
      setChatInput("");
    }
  };

  const handleSendClick = () => {
    if (chatInput.trim()) {
      onSendMessage(chatInput, { mode: 'council', tools: enabledTools });
      setChatInput("");
    }
  };

  const toggleTool = (toolsString: string) => {
    const toolsToCheck = toolsString.split(',');
    setEnabledTools(prev => {
      const isEnabled = toolsToCheck.every(t => prev.includes(t));
      if (isEnabled) {
        return prev.filter(t => !toolsToCheck.includes(t));
      } else {
        return [...prev, ...toolsToCheck];
      }
    });
  };

  useEffect(() => {
    if (events.length > 0) {
      const last = events[events.length - 1];
      if (last.type === 'council') {
        if (last.payload.status === 'agreed') {
           setTimeout(() => setActiveAgent(null), 1000);
        } else {
           setActiveAgent(last.payload.agentId);
        }
      }
    }
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [events]);

  return (
    <div className="w-full h-full flex flex-col gap-6 overflow-hidden relative text-on-surface">
      {/* Top Section: Council Matrix and Skill Hub */}
      <div className="flex-1 flex gap-6 overflow-hidden min-h-0">
        
        {/* Central Area: AI Council Live Room */}
        <div className="flex-[2] relative flex flex-col items-center justify-center rounded-xl bg-surface-container-low/30 border border-outline-variant/20 overflow-hidden shadow-inner shrink-0 min-w-0">
          <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle at center, #00f2ff 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
          
          {/* SVG Network Connections */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
            <line stroke="rgba(0,242,255,0.15)" strokeDasharray="8 4" strokeWidth="2" x1="50%" x2="35%" y1="30%" y2="60%" />
            <line stroke="rgba(0,242,255,0.15)" strokeDasharray="8 4" strokeWidth="2" x1="50%" x2="65%" y1="30%" y2="60%" />
            <line stroke="rgba(0,242,255,0.15)" strokeDasharray="8 4" strokeWidth="2" x1="35%" x2="65%" y1="60%" y2="60%" />
          </svg>

          <div className="relative z-10 w-full h-full flex items-center justify-center">
            {/* Planner Node */}
            <div className={`absolute top-[20%] left-1/2 -translate-x-1/2 flex flex-col items-center transition-all duration-500 ${activeAgent === 'Planner' ? 'scale-110 drop-shadow-[0_0_20px_#00f2ff]' : 'opacity-60 grayscale'}`}>
              <div className={`w-20 h-20 rounded-full border border-primary-container/50 bg-surface-container-highest p-1 mb-3 ${activeAgent === 'Planner' ? 'neural-glow-cyan' : ''}`}>
                <img alt="Planner Agent" src="https://lh3.googleusercontent.com/aida-public/AB6AXuByuDyp32rtGPflSzgDi2y7UyXvVnVIo49TLrLG3uG_cpjZypP1UV7FmY27mHPL2BER9U45VCs7h7rH9ElIwxioPt7JxW--Sx0I-psSo5clgqYIQrbN2Np9w6zbR0aQnlGjcBDUV-ohGm2RVtLwv3k4mIWMU3RPuB0ZQRPfrEVqZx3SSOQIDURz1TCXCE3Ek7dp7Ig6FdBpaikZMZGthYKBKu0vLUq1PcN-QaOVvYQU12DK72KdZ-BWRixtOuH5XWFMfDkprDoh7pov" 
                     className="w-full h-full rounded-full object-cover transition-all" />
              </div>
              <span className="font-mono text-[10px] tracking-[0.2em] text-primary-container uppercase">Planner</span>
            </div>

            {/* Critic Node */}
            <div className={`absolute top-[55%] left-[30%] -translate-x-1/2 flex flex-col items-center transition-all duration-500 ${activeAgent === 'Critic' ? 'scale-110 drop-shadow-[0_0_20px_#a855f7]' : 'opacity-60 grayscale'}`}>
              <div className={`w-20 h-20 rounded-full border border-secondary/50 bg-surface-container-highest p-1 mb-3 ${activeAgent === 'Critic' ? 'neural-glow-purple' : ''}`}>
                <img alt="Critic Agent" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCjyTzWwKRZNT3hpe9Su2ERpx3SuZfg95YUSBJ2PFTfeIrdeIiq4SwwLd189N5gnpeL0fQoL1hFjZDxHdiXIaqI9vs0lCKsOoE0l1P35sUoxbTo6Ftp0W5QJAACJW8kaM8D9KcB3Ydw10wslHImxae4rHb2lrZr3K6JBgK-q16qCe2Fr8FhJiY2XGUGr6Ah7pX2bJCmjq3zIU75Bt-yMlgymLW-b3iPUusHZkq0-FccUKR-ppfjdbsFs2ZJslQyH18BpSfeHHbroQlC" 
                     className="w-full h-full rounded-full object-cover transition-all" />
              </div>
              <span className="font-mono text-[10px] tracking-[0.2em] text-secondary uppercase">Critic</span>
            </div>

            {/* Coder Node */}
            <div className={`absolute top-[55%] left-[70%] -translate-x-1/2 flex flex-col items-center transition-all duration-500 ${activeAgent === 'Coder' ? 'scale-110 drop-shadow-[0_0_20px_#ffffff]' : 'opacity-60 grayscale'}`}>
              <div className={`w-20 h-20 rounded-full border border-tertiary/50 bg-surface-container-highest p-1 mb-3 ${activeAgent === 'Coder' ? 'neural-glow-white' : ''}`}>
                <img alt="Coder Agent" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCP3crA--FZbTmolkgWlzyxTM_Rh5UmYSF9nQb_ozcXXKFIOmF7wF4CxJ0JSJW5LYVLRpECwOF-Ersf7bKtp5Xnu5OXAX55oI7UPL2bH33yS2erCxmQ-7fwxDHj15_6-ECytCtNNFAnbx-SNjHSclalntafn6gPxOrW_Uw579LoyNWb7_FpspDitD2I25ARlvnZXbW4HGiipJ851fkH9cxy5L5RYadlB6rsbegL-K90otq0x8VjaI9v56Ywcl9_en1WxCSnS7vergZy" 
                     className="w-full h-full rounded-full object-cover transition-all" />
              </div>
              <span className="font-mono text-[10px] tracking-[0.2em] text-tertiary uppercase">Coder</span>
            </div>
          </div>

          {/* Floating Mission Status */}
          <div className="absolute top-4 left-6 flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-primary-container shadow-[0_0_8px_#00f2ff] animate-pulse" />
            <span className="font-mono text-[10px] tracking-widest text-primary-container uppercase">Mission: Neural_Sync_v2</span>
          </div>
        </div>

        {/* Right Panel: Skill Hub */}
        <div className="flex-1 flex flex-col gap-6 shrink-0 min-w-0">
          <div className="p-5 rounded-xl bg-surface-container-low/80 border border-outline-variant/10 flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            <h3 className="font-mono text-xs font-bold tracking-widest text-primary-container uppercase mb-6 flex items-center gap-2">
              <Cpu className="w-4 h-4" />
              Skill Hub
            </h3>
            
            <div className="space-y-4">
              <div className="group p-4 rounded-lg bg-surface-container border border-outline-variant/5 hover:border-primary-container/30 transition-all duration-300">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <Globe className="w-4 h-4 text-primary-container" />
                    <span className="text-sm font-sans font-medium text-white">Web Search</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={enabledTools.includes('web_search')} onChange={() => toggleTool('web_search')} />
                    <div className="w-9 h-5 bg-surface-container-highest rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-container/60 shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)]"></div>
                  </label>
                </div>
                <p className="text-[11px] text-on-surface-variant leading-relaxed">Real-time retrieval of global data and documentation.</p>
              </div>

              <div className="group p-4 rounded-lg bg-surface-container border border-outline-variant/5 hover:border-primary-container/30 transition-all duration-300">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <Folder className="w-4 h-4 text-primary-container" />
                    <span className="text-sm font-sans font-medium text-white">Filesystem</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={enabledTools.includes('read_file')} onChange={() => toggleTool('read_file,write_file')} />
                    <div className="w-9 h-5 bg-surface-container-highest rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-container/60 shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)]"></div>
                  </label>
                </div>
                <p className="text-[11px] text-on-surface-variant leading-relaxed">Direct read/write access to project directory tree.</p>
              </div>

              <div className="group p-4 rounded-lg bg-surface-container border border-outline-variant/5 hover:border-primary-container/30 transition-all duration-300">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <TerminalSquare className="w-4 h-4 text-primary-container" />
                    <span className="text-sm font-sans font-medium text-white">Code Interpreter</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={enabledTools.includes('run_shell_command')} onChange={() => toggleTool('run_shell_command')} />
                    <div className="w-9 h-5 bg-surface-container-highest rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-container/60 shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)]"></div>
                  </label>
                </div>
                <p className="text-[11px] text-on-surface-variant leading-relaxed">Sandboxed environment for executing internal tool scripts.</p>
              </div>
            </div>
          </div>

          {/* Resource Usage Bar */}
          <div className="p-5 rounded-xl bg-gradient-to-br from-primary-container/10 to-secondary/10 border border-outline-variant/10 shrink-0">
            <div className="flex justify-between items-center mb-3">
              <span className="text-[10px] font-mono uppercase tracking-widest text-primary-container">Resource Usage</span>
              <span className="text-[10px] font-mono text-primary-container">{stats.cpuLoad}</span>
            </div>
            <div className="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden shadow-inner">
              <div className="h-full bg-primary-container shadow-[0_0_10px_rgba(0,242,255,0.8)]" style={{ width: stats.cpuLoad }}></div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Section: Live Terminal / Event Log */}
      <div className="h-64 shrink-0 rounded-xl bg-[#0a0f16]/90 border border-outline-variant/20 flex flex-col overflow-hidden shadow-2xl relative">
        <div className="absolute top-0 right-[-10%] w-64 h-64 bg-amber-500/5 blur-3xl rounded-full pointer-events-none" />
        
        {/* Terminal Header */}
        <div className="bg-surface-container-low px-4 py-3 border-b border-outline-variant/10 flex justify-between items-center shrink-0 z-10 relative">
          <div className="flex gap-2.5">
            <div className="w-3 h-3 rounded-full bg-error/40 border border-error/50"></div>
            <div className="w-3 h-3 rounded-full bg-secondary/40 border border-secondary/50"></div>
            <div className="w-3 h-3 rounded-full bg-primary-container/40 border border-primary-container/50"></div>
          </div>
          <span className="font-mono text-[10px] tracking-[0.2em] text-on-surface-variant uppercase">Volt_Neural_Stream.log</span>
          <Maximize2 className="w-4 h-4 text-on-surface-variant cursor-pointer hover:text-white transition-colors" />
        </div>

        {/* Terminal Output */}
        <div className="flex-1 p-5 font-mono text-[11.5px] space-y-2 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-white/20 z-10 relative">
          {events.length === 0 ? (
            <div className="text-slate-600 h-full flex flex-col items-center justify-center">
              <Disc className="w-6 h-6 mb-3 animate-spin-slow opacity-30" />
              <p className="font-mono text-xs">Waiting for agent telemetry payload...</p>
            </div>
          ) : (
            events.map((ev: any, i: number) => {
              const isUser = ev.type === 'user_prompt';
              const isReply = ev.type === 'reply';
              const isSystem = ev.type === 'council' || ev.type === 'thought';
              
              return (
              <div key={i} className="flex gap-4">
                <span className="text-on-surface-variant/30 shrink-0 w-16">{new Date(ev.timestamp).toLocaleTimeString([], {hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit'})}</span>
                <span className={`shrink-0 w-20 ${isUser ? 'text-amber-400' : isReply ? 'text-neon-cyan' : isSystem ? 'text-secondary' : 'text-[#00FF41]'}`}>
                  [{typeLabel(ev.type)}]
                </span>
                <span className={`flex-1 break-words ${isUser ? 'text-amber-100' : isReply ? 'text-white' : 'text-on-surface-variant'}`}>
                  {formatPayload(ev)}
                </span>
              </div>
            )})
          )}
          <div ref={bottomRef} className="h-1" />
        </div>

        {/* Chat Input Inside Terminal */}
        <div className="bg-[#05080c] border-t border-outline-variant/20 p-2 flex items-center shadow-inner z-10 relative shrink-0">
          <TerminalIcon className="w-4 h-4 text-primary-container/50 ml-2 shrink-0" />
          <input 
            type="text" 
            className="flex-1 bg-transparent text-primary-container px-3 py-1.5 text-sm focus:outline-none placeholder-primary-container/20 font-mono"
            placeholder="Initialize AI Council Debate..."
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button onClick={handleSendClick} className="p-2 text-primary-container/60 hover:text-primary-container transition-colors shrink-0">
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>

    </div>
  );
}
