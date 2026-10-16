import type { SessionModel } from "../../shared/apiTypes";
import type { ChatLine } from "./components/shared";

/**
 * Pi 1.3 drops thinking produced by one model from requests to another (pi-ai `transformMessages`,
 * pi #10995), while PI WEB keeps showing it. A reader who switches models is told so once per
 * switch, and only when it is true: the loaded transcript holds visible thinking whose producing
 * model is known and is not the model switched to. Thinking whose model the line does not name
 * proves nothing, so it is not counted; neither is thinking on pages not loaded.
 */
export const MODEL_SWITCH_THINKING_NOTICE = "Earlier thinking from another model is not sent to the new model; it stays visible here.";

export function modelSwitchDropsThinking(lines: readonly ChatLine[], previous: SessionModel | undefined, next: SessionModel | undefined): boolean {
  if (next?.provider === undefined || next.id === undefined) return false;
  if (previous?.provider === next.provider && previous.id === next.id) return false;
  return lines.some((line) => line.role === "assistant" && thinkingFromOtherModel(line, next));
}

function thinkingFromOtherModel(line: ChatLine, next: SessionModel): boolean {
  const producer = line.meta?.model;
  if (producer?.provider === undefined || producer.id === undefined) return false;
  if (producer.provider === next.provider && producer.id === next.id) return false;
  return line.parts.some((part) => part.type === "thinking" && part.text.trim() !== "");
}
