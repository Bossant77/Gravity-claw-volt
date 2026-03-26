import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { gateway } from "./gateway.js";
import { log } from "./logger.js";
import { resolve } from "path";
import os from "os";
import { runAgent } from "./agent.js";

const PORT = process.env.PORT || 3000;

export const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

/**
 * Socket.IO configuration & Event routing from Gateway
 */
io.on("connection", (socket) => {
  log.info({ socketId: socket.id }, "Mission Control UI connected via WebSocket");

  // Send a welcome ping
  socket.emit("system:status", { status: "online", phase: "Listen" });

  // Handle incoming chat messages from Web UI
  socket.on("user:message", async (data) => {
    const { text, mode, tools } = data;
    log.info({ text, mode, socketId: socket.id }, "Received web UI message");
    
    gateway.dispatchIncomingMessage("web", socket.id, text);
    try {
      let replyText = "";
      if (mode === "council") {
        const { runCouncilDebate } = await import("./council.js");
        const allowedTools = Array.isArray(tools) ? tools : [];
        replyText = await runCouncilDebate(socket.id, text, allowedTools);
      } else {
        const reply = await runAgent(123456789, text, undefined, false); // isInitiative = false
        replyText = reply.text;
      }
      gateway.dispatchOutgoingMessage(socket.id, replyText);
    } catch (err: any) {
      log.error({ err }, "Web UI runAgent error");
      gateway.dispatchOutgoingMessage(socket.id, `Error: ${err.message}`);
    }
  });

  socket.on("disconnect", () => {
    log.info({ socketId: socket.id }, "Mission Control UI disconnected");
  });
});

// Route Gateway events to the WebSocket clients
gateway.on("agent:thought", (data) => {
  io.emit("gateway:event", { type: "thought", payload: data, timestamp: new Date().toISOString() });
});

gateway.on("council:debate", (data) => {
  io.emit("gateway:event", { type: "council", payload: data, timestamp: new Date().toISOString() });
});

gateway.on("action:pending", (data) => {
  io.emit("gateway:event", { type: "action", payload: data, timestamp: new Date().toISOString() });
});

gateway.on("message:outgoing", (data) => {
  io.emit("gateway:event", { type: "reply", payload: data, timestamp: new Date().toISOString() });
});

gateway.on("message:incoming", (data) => {
  io.emit("gateway:event", { type: "user_prompt", payload: data, timestamp: new Date().toISOString() });
});

/**
 * REST Endpoints
 */
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.post("/api/trigger", (req, res) => {
  const { action } = req.body;
  if (action === "test_council") {
    gateway.dispatchIncomingMessage("web", "UI_TEST", "Test the AI Council debate logic");
  }
  res.json({ success: true, action });
});

/**
 * Initialize Server & Telemetry Heartbeat
 */
export function startServer() {
  httpServer.listen(PORT, () => {
    log.info(`Mission Control Server running at http://localhost:${PORT}`);
  });

  // OS Telemetry Stream
  setInterval(() => {
    const stats = {
      cpuLoad: os.loadavg()[0].toFixed(2) + "%",
      memoryUsage: `${Math.round((os.totalmem() - os.freemem())/1024/1024)} MB / ${Math.round(os.totalmem()/1024/1024)} MB`,
      uptime: `${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`,
      vectorDocs: "Syncing..." // Placehoder until we wire pgvector
    };
    io.emit("system:telemetry", stats);
  }, 3000);
}
