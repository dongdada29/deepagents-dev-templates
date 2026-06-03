/**
 * Subagent Discovery
 *
 * Re-exports the file-based subagent discovery from runtime helpers.
 * Subagents are discovered from .agents/agents/ directories configured
 * via `agentsDirectories` in app-agent.config.json.
 *
 * Convention: each subagent is a subdirectory containing an AGENT.md file
 * with YAML frontmatter (name, description) and a body (systemPrompt).
 *
 * @example
 * .agents/agents/researcher/AGENT.md:
 *   ---
 *   name: researcher
 *   description: "Deep research assistant"
 *   ---
 *   You are a research assistant specialized in...
 */

export { discoverSubAgents, type DiscoveredSubAgent } from "../../runtime/helpers.js";
