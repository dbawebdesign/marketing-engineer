import type { AgentTemplate, System } from "./types";
import { customerTruth } from "./templates/customer-truth";

export const TEMPLATES: AgentTemplate[] = [customerTruth as unknown as AgentTemplate];

export function getTemplate(id: string): AgentTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function templatesFor(system: System) {
  return TEMPLATES.filter((t) => t.system === system);
}
