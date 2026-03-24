import * as fs from "fs/promises";
import * as path from "path";
import { log } from "./logger.js";

const BRAIN_DIR = "/home/claw/workspace/brain";
const GOALS_FILE = path.join(BRAIN_DIR, "goals.md");

export async function getGoalsContext(): Promise<string> {
  try {
    const goals = await fs.readFile(GOALS_FILE, "utf-8");
    if (!goals || goals.trim() === "") return "";
    
    return `\n\nCURRENT GOALS & INITIATIVES:\n${goals.trim()}\n(Use this context to decide on proactive actions and prioritize tasks).`;
  } catch (err: any) {
    // If it doesn't exist, we just return empty string
    if (err.code === "ENOENT") {
      // Create empty goals file for future use
      await fs.mkdir(BRAIN_DIR, { recursive: true }).catch(() => {});
      await fs.writeFile(GOALS_FILE, "# Volt Goals\n\nAdd short and long term goals here for Volt's Initiative Engine.", "utf-8").catch(() => {});
    }
    return "";
  }
}
