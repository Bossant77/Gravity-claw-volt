import { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { 
  Server, Zap, LayoutDashboard, Brain, Wrench, Settings as SettingsIcon,
  ListTodo, Users, LineChart, Clock, Folder
} from 'lucide-react';
import DashboardView from './views/DashboardView';
import ArchiveView from './views/ArchiveView';
import FoundryView from './views/FoundryView';
import TasksView from './views/TasksView';
import CrewView from './views/CrewView';
import AnalyticsView from './views/AnalyticsView';
import CronsView from './views/CronsView';
import WorkspaceView from './views/WorkspaceView';

interface GatewayEvent {
  type: string;
  payload: any;
  timestamp: string;
}

export default function App() {
  const [events, setEvents] = useState<GatewayEvent[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [stats, setStats] = useState({
    uptime: '0h',
    memoryUsage: '0 MB',
    vectorDocs: 0,
    cpuLoad: '0%'
  });

  useEffect(() => {
    const newSocket = io('http://localhost:3000');
    
    newSocket.on('connect', () => {
      console.log('Connected to Gateway');
      setIsConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from Gateway');
      setIsConnected(false);
    });

    newSocket.on('gateway:event', (event: GatewayEvent) => {
      setEvents(prev => [...prev.slice(-99), event]);
    });

    newSocket.on('system:telemetry', (data: any) => {
      setStats(prev => ({ ...prev, ...data }));
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  const handleSendMessage = (text: string, options?: { mode?: string, tools?: string[] }) => {
    if (socket && text.trim()) {
      socket.emit('user:message', { text, ...options });
    }
  };

  const navItems = [
    { id: 'dashboard', label: 'Monitor', icon: LayoutDashboard },
    { id: 'tasks', label: 'Tasks', icon: ListTodo },
    { id: 'crew', label: 'Crew', icon: Users },
    { id: 'analytics', label: 'Analytics', icon: LineChart },
    { id: 'crons', label: 'Scheduler', icon: Clock },
    { id: 'workspace', label: 'Files', icon: Folder },
    { id: 'archive', label: 'Memory Storage', icon: Brain },
    { id: 'foundry', label: 'Foundry', icon: Wrench },
    { id: 'settings', label: 'Config', icon: SettingsIcon },
  ];

  return (
    <div className="fixed inset-0 flex flex-col bg-[#030712] font-sans text-slate-300 overflow-hidden">
      
      {/* Top Navbar */}
      <header className="h-14 shrink-0 border-b border-white/5 bg-[#0a0e14] flex items-center justify-between px-6 z-20">
        <div className="flex items-center gap-3">
          <Zap className={`w-5 h-5 ${isConnected ? 'text-neon-cyan drop-shadow-[0_0_8px_rgba(0,240,255,0.8)]' : 'text-slate-600'}`} />
          <h1 className="font-mono text-lg tracking-wider font-bold text-white uppercase text-glow-cyan">
            Gravity Claw <span className="text-slate-500 font-normal ml-2">Mission Control</span>
          </h1>
        </div>
        
        <div className="flex items-center gap-6 font-mono text-xs uppercase tracking-widest text-slate-400">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 shadow-[0_0_8px_#22c55e]' : 'bg-red-500 shadow-[0_0_8px_#ef4444]'}`}></span>
            {isConnected ? 'NODE: ONLINE' : 'NODE: OFFLINE'}
          </div>
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4" /> LOCAL_VPS
          </div>
        </div>
      </header>

      {/* Main Body */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        
        {/* Left Sidebar */}
        <aside className="w-20 shrink-0 border-r border-white/5 bg-[#0a0e14] flex flex-col items-center py-4 gap-2 z-20 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:-none] [scrollbar-width:none]">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                title={item.label}
                className={`relative p-3 rounded-xl transition-all duration-300 group
                  ${isActive ? 'bg-cyan-950/40 text-neon-cyan' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'}`}
              >
                <Icon className={`w-6 h-6 ${isActive ? 'drop-shadow-[0_0_6px_rgba(0,240,255,0.8)]' : ''}`} />
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-neon-cyan rounded-r-md drop-shadow-[0_0_8px_rgba(0,240,255,1)]" />
                )}
              </button>
            )
          })}
        </aside>

        {/* Content Area */}
        <main className="flex-1 relative overflow-hidden">
          <div className="absolute inset-4 flex flex-col overflow-hidden">
            {activeTab === 'dashboard' && <DashboardView events={events} isConnected={isConnected} stats={stats} onSendMessage={handleSendMessage} />}
            {activeTab === 'tasks' && <TasksView />}
            {activeTab === 'crew' && <CrewView />}
            {activeTab === 'analytics' && <AnalyticsView />}
            {activeTab === 'crons' && <CronsView />}
            {activeTab === 'workspace' && <WorkspaceView />}
            {activeTab === 'archive' && <ArchiveView />}
            {activeTab === 'foundry' && <FoundryView />}
            {activeTab === 'settings' && (
              <div className="flex-1 flex flex-col gap-6 max-w-2xl mx-auto h-full py-4">
                <h2 className="font-mono text-lg text-white uppercase tracking-widest">System Configuration</h2>
                
                <div className="glass-panel rounded-xl p-6 space-y-4">
                  <h3 className="font-mono text-sm uppercase text-slate-400 tracking-wider border-b border-white/5 pb-2">Connection</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><span className="text-slate-500">Gateway</span></div>
                    <div className="font-mono flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 shadow-[0_0_6px_#22c55e]' : 'bg-red-500'}`}></span>
                      {isConnected ? 'Connected' : 'Disconnected'}
                    </div>
                    <div><span className="text-slate-500">Socket URL</span></div>
                    <div className="font-mono text-white">ws://localhost:3000</div>
                    <div><span className="text-slate-500">Uptime</span></div>
                    <div className="font-mono text-white">{stats.uptime}</div>
                    <div><span className="text-slate-500">Memory</span></div>
                    <div className="font-mono text-white">{stats.memoryUsage}</div>
                  </div>
                </div>

                <div className="glass-panel rounded-xl p-6 space-y-4">
                  <h3 className="font-mono text-sm uppercase text-slate-400 tracking-wider border-b border-white/5 pb-2">Agent Identity</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><span className="text-slate-500">Name</span></div>
                    <div className="font-mono text-white">Gravity Claw</div>
                    <div><span className="text-slate-500">Level</span></div>
                    <div className="font-mono text-neon-cyan">9 — Self-Evolution</div>
                    <div><span className="text-slate-500">Architecture</span></div>
                    <div className="font-mono text-white">Gemini 3.1 Pro + Multi-Agent Council</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

    </div>
  );
}

