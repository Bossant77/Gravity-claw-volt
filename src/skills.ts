import * as fs from "fs/promises";
import * as path from "path";
import { log } from "./logger.js";
import { registerTool } from "./tools/registry.js";

const SKILLS_DIR = path.resolve(process.cwd(), "src/skills");

export interface SkillManifest {
  name: string;
  description: string;
  instructions: string; // The content of SKILL.md to be injected into the brain
  toolsLoaded: number;
}

const activeSkills = new Map<string, SkillManifest>();

/**
 * Returns a block of text containing instructions from all active skills.
 * To be injected into the agent's system prompt.
 */
export function getActiveSkillsContext(): string {
  if (activeSkills.size === 0) return "";

  let context = `\n\n=== INSTALLED SKILLS ===\nYou have the following specialized skills installed. When relevant, follow their exact instructions:\n`;
  for (const [skillId, manifest] of activeSkills.entries()) {
    context += `\n[Skill: ${manifest.name}]\n${manifest.instructions}\n`;
  }
  return context;
}

/**
 * Scans the src/skills folder, parses SKILL.md, and dynamically loads any tools inside.
 */
export async function loadSkills(): Promise<void> {
  log.info("🧩 Initializing Skill System loader...");
  
  try {
    // Ensure skills directory exists
    await fs.mkdir(SKILLS_DIR, { recursive: true });
    
    const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
    const skillDirs = entries.filter(e => e.isDirectory());
    
    let totalSkills = 0;
    let totalTools = 0;

    for (const d of skillDirs) {
      const skillPath = path.join(SKILLS_DIR, d.name);
      const manifest = await loadSingleSkill(skillPath, d.name);
      if (manifest) {
        activeSkills.set(d.name, manifest);
        totalSkills++;
        totalTools += manifest.toolsLoaded;
      }
    }

    log.info({ totalSkills, totalTools }, "🧩 Skill System active");
  } catch (err: any) {
    log.error({ err: err.message }, "Failed to load skills directory");
  }
}

async function loadSingleSkill(skillPath: string, skillId: string): Promise<SkillManifest | null> {
  try {
    // 1. Look for SKILL.md for instructions
    const skillMdPath = path.join(skillPath, "SKILL.md");
    let instructions = "";
    try {
      instructions = await fs.readFile(skillMdPath, "utf-8");
    } catch {
      log.warn({ skillId }, "No SKILL.md found for skill. It will have no behavioral instructions.");
    }
    
    // Parse name and description from JSON or use defaults based on folder name
    let name = skillId;
    let description = "A dynamically loaded skill";
    try {
      const metadataPath = path.join(skillPath, "skill.json");
      const metadataRaw = await fs.readFile(metadataPath, "utf-8");
      const metadata = JSON.parse(metadataRaw);
      if (metadata.name) name = metadata.name;
      if (metadata.description) description = metadata.description;
    } catch {
      // It's okay if skill.json doesn't exist, we fall back to defaults
    }

    // 2. Load Tools
    let toolsLoaded = 0;
    const toolsDir = path.join(skillPath, "tools");
    try {
      const toolFiles = await fs.readdir(toolsDir);
      for (const file of toolFiles) {
        if (file.endsWith(".ts") || file.endsWith(".js")) {
          const toolPath = path.join(toolsDir, file);
          const fileUrl = `file://${toolPath.replace(/\\/g, "/")}`; // Convert to file URL for dynamic import on Windows
          
          try {
            const module = await import(fileUrl);
            if (typeof module.register === "function") {
              // Extract the ToolConfig explicitly
              const toolConfig = module.register();
              registerTool(toolConfig);
              toolsLoaded++;
            }
          } catch (modErr: any) {
            log.error({ skillId, file, err: modErr.message }, "Failed to import tool module from skill");
          }
        }
      }
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        log.warn({ skillId, err: err.message }, "Error reading tools directory for skill");
      }
      // If ENOENT, the skill simply has no custom code tools, which is perfectly valid (instructions only).
    }

    log.info({ skillId, name, toolsLoaded }, "✅ Skill loaded successfully");

    return {
      name,
      description,
      instructions,
      toolsLoaded
    };

  } catch (err: any) {
    log.error({ skillId, err: err.message }, "Failed to load skill");
    return null;
  }
}

/**
 * Helper strictly for tools to fetch what's installed
 */
export function getInstalledSkills(): Omit<SkillManifest, "instructions">[] {
  return Array.from(activeSkills.values()).map(s => ({
    name: s.name,
    description: s.description,
    toolsLoaded: s.toolsLoaded
  }));
}
