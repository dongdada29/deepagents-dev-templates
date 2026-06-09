export type FieldType = "enum" | "number" | "string" | "boolean" | "string[]";

export interface EditableField {
  id: string;
  section: string;
  configPath: string;
  type: FieldType;
  label: string;
  enumValues?: string[];
  min?: number;
  max?: number;
}

function f(field: Omit<EditableField, "id">): EditableField {
  return { id: field.configPath, ...field };
}

export const EDITABLE_CONFIG_FIELDS: EditableField[] = [
  f({ section: "meta", configPath: "agent.name", type: "string", label: "Name" }),
  f({ section: "meta", configPath: "agent.description", type: "string", label: "Description" }),
  f({ section: "meta", configPath: "agent.version", type: "string", label: "Version" }),
  f({ section: "meta", configPath: "agent.outputStyle", type: "string", label: "Output style" }),

  f({ section: "model", configPath: "model.provider", type: "enum", label: "Provider", enumValues: ["anthropic", "openai"] }),
  f({ section: "model", configPath: "model.name", type: "string", label: "Model name" }),
  f({ section: "model", configPath: "model.baseUrl", type: "string", label: "Base URL" }),
  f({ section: "model", configPath: "model.settings.temperature", type: "number", label: "Temperature", min: 0, max: 2 }),
  f({ section: "model", configPath: "model.settings.maxTokens", type: "number", label: "Max tokens", min: 1 }),

  f({ section: "permissions", configPath: "permissions.mode", type: "enum", label: "Mode", enumValues: ["yolo", "ask", "plan"] }),
  f({ section: "permissions", configPath: "permissions.interruptOn", type: "string[]", label: "Interrupt on" }),
  f({ section: "permissions", configPath: "permissions.allowedPaths", type: "string[]", label: "Allowed paths" }),
  f({ section: "permissions", configPath: "permissions.deniedPaths", type: "string[]", label: "Denied paths" }),

  f({ section: "middleware", configPath: "middleware.stuckLoopDetection.enabled", type: "boolean", label: "Stuck-loop detection" }),
  f({ section: "middleware", configPath: "middleware.periodicReminder.enabled", type: "boolean", label: "Periodic reminder" }),
  f({ section: "middleware", configPath: "middleware.costTracking.enabled", type: "boolean", label: "Cost tracking" }),
  f({ section: "middleware", configPath: "compaction.enabled", type: "boolean", label: "Compaction" }),
  f({ section: "middleware", configPath: "eviction.enabled", type: "boolean", label: "Eviction" }),

  f({ section: "memory", configPath: "memory.enabled", type: "boolean", label: "Memory" }),
  f({ section: "memory", configPath: "memory.addCacheControl", type: "boolean", label: "Cache control" }),

  f({ section: "skills", configPath: "skills.directories", type: "string[]", label: "Skill directories" }),
];

export function findField(configPath: string): EditableField | undefined {
  return EDITABLE_CONFIG_FIELDS.find((field) => field.configPath === configPath);
}
