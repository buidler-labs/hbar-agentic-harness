import type { AgentConfig, AgentProvider } from "../types.js";
import { CommandAgentProvider } from "./commandAgentProvider.js";

export function createAgentProvider(config: AgentConfig): AgentProvider {
  switch (config.provider) {
    case "command":
      return new CommandAgentProvider(config);
  }

  throw new Error(`Unsupported agent provider config: ${JSON.stringify(config)}`);
}

export { CommandAgentProvider };
