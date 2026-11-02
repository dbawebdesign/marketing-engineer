import type { AgentTemplate, System } from "./types";
import { customerTruth } from "./templates/customer-truth";
import { founderContent } from "./templates/founder-content";
import { outboundSignal } from "./templates/outbound-signal";
import { creativeTesting } from "./templates/creative-testing";
import { aiSearch } from "./templates/ai-search";
import { growthCockpit } from "./templates/growth-cockpit";

export const TEMPLATES: AgentTemplate[] = [customerTruth, founderContent, outboundSignal, creativeTesting, aiSearch, growthCockpit] as unknown as AgentTemplate[];

export function getTemplate(id: string): AgentTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function templatesFor(system: System) {
  return TEMPLATES.filter((t) => t.system === system);
}
