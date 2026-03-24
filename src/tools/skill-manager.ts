import { SchemaType } from "@google/generative-ai";
import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs/promises";
import { log } from "../logger.js";
import { registerTool, type ToolConfig } from "../tools/registry.js";
import { getInstalledSkills, loadSkills } from "../skills.js";

const execAsync = promisify(exec);

export function registerListSkills(): ToolConfig {
  return {
    name: "list_skills",
    description: "Lists all currently installed skills and their loaded tools in the ecosystem.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
      required: [],
    },
    requiresConfirmation: false,
    handler: async () => {
      const skills = getInstalledSkills();
      if (skills.length === 0) {
        return { result: "No skills are currently installed." };
      }

      let res = `Installed Skills (${skills.length}):\n\n`;
      for (const s of skills) {
        res += `- **${s.name}**: ${s.description} (${s.toolsLoaded} tools)\n`;
      }
      return { result: res };
    },
  };
}

export function registerInstallSkill(): ToolConfig {
  return {
    name: "install_skill",
    description: "Installs a new skill from a Git repository URL into the src/skills folder and reloads the skill engine. Only provide valid git URLs.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        gitUrl: {
          type: SchemaType.STRING,
          description: "The HTTPS URL of the Git repository to install"
        },
        skillDirName: {
          type: SchemaType.STRING,
          description: "Optional custom name for the folder inside src/skills. Defaults to repo name."
        }
      },
      required: ["gitUrl"],
    },
    requiresConfirmation: true, // It clones external code, user should confirm
    handler: async (args: Record<string, unknown>) => {
      const { gitUrl, skillDirName } = args as { gitUrl: string; skillDirName?: string };
      
      const skillsDir = path.resolve(process.cwd(), "src/skills");
      await fs.mkdir(skillsDir, { recursive: true });

      let targetFolderName = skillDirName;
      if (!targetFolderName) {
        // Extract repo name from URL
        const parsed = path.basename(gitUrl, ".git");
        targetFolderName = parsed || "unknown-skill";
      }

      const clonePath = path.join(skillsDir, targetFolderName);

      try {
        const checkExists = await fs.stat(clonePath).catch(() => null);
        if (checkExists) {
          return { result: `Error: A skill or folder already exists at ${clonePath}. Please choose a different skillDirName or update the existing one.` };
        }

        log.info({ gitUrl, clonePath }, "Cloning new skill");
        const { stdout, stderr } = await execAsync(`git clone ${gitUrl} "${clonePath}"`);

        // Reload skills to immediately register the new tools and instructions
        await loadSkills();

        return { 
          result: `Successfully installed skill '${targetFolderName}'.\n\nOutput:\n${stdout}\n${stderr}\nLocal path: ${clonePath}\nThe Skill Engine has been reloaded and instructions injected into my context.`
        };
      } catch (err: any) {
        log.error({ err: err.message, gitUrl }, "Failed to install skill");
        return { result: `Failed to install skill: ${err.message}` };
      }
    },
  };
}
