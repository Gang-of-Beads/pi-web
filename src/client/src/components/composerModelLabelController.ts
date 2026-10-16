import type { ReactiveController, ReactiveControllerHost } from "lit";

enum ModelLabelMode {
  Provider = "provider",
  Model = "model",
  ShortModel = "short-model",
}

const providerCharacters = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : undefined;

export function minimumReadableProviderPrefix(provider: string): string {
  if (provider === "" || providerCharacters === undefined) return "";
  const first = providerCharacters.segment(provider)[Symbol.iterator]().next();
  return first.done === true ? "" : `${first.value.segment}…`;
}

function modelLabelMode(width: number, naturalWidth: number, modelWidth: number, minimumLabelWidth: number, hasProvider: boolean): ModelLabelMode {
  const providerFits = width >= naturalWidth || (minimumLabelWidth > 0 && width >= minimumLabelWidth);
  if (hasProvider && providerFits) return ModelLabelMode.Provider;
  return width >= modelWidth ? ModelLabelMode.Model : ModelLabelMode.ShortModel;
}

/**
 * Owns caption fitting, not model selection. Intrinsic text probes detect font
 * changes even when the button is clamped; the hidden full caption preserves
 * its preferred width so removing a provider cannot make its absence permanent.
 * Full and shortest probes share the visible renderer, avoiding fragment-sum
 * rounding and different box shaping at the abbreviation threshold. Provider
 * shortening renders the measured literal text rather than a browser-generated
 * ellipsis, so contextual shaping is identical to the successful trial.
 */
export class ComposerModelLabelController implements ReactiveController {
  private label: HTMLElement | undefined;
  private identity: string | undefined;
  private observer: ResizeObserver | undefined;
  private currentMode = ModelLabelMode.Model;
  private fitted: { provider: string; model: string; text: string } | undefined;

  constructor(private readonly host: ReactiveControllerHost, private readonly getLabel: () => HTMLElement | null | undefined) {
    host.addController(this);
  }

  get mode(): ModelLabelMode {
    return this.currentMode;
  }

  providerCaption(provider: string, model: string): string {
    return this.fitted?.provider === provider && this.fitted.model === model ? this.fitted.text : provider;
  }

  hostUpdated(): void {
    const label = this.getLabel();
    if (label === null || label === undefined) {
      this.disconnect();
      return;
    }
    const natural = label.querySelector<HTMLElement>(".select-model-natural");
    const model = label.querySelector<HTMLElement>(".select-model-natural .select-model-id");
    const minimum = label.querySelector<HTMLElement>(".select-model-minimum-label");
    if (natural === null || model === null || minimum === null) return;
    if (label !== this.label) {
      this.disconnect();
      this.label = label;
      if (typeof ResizeObserver !== "undefined") {
        this.observer = new ResizeObserver(() => { this.measure(); });
        for (const element of [label, natural, model, minimum]) this.observer.observe(element);
      }
    }
    const identity = natural.textContent;
    if (identity === this.identity) return;
    this.identity = identity;
    this.measure();
  }

  hostDisconnected(): void {
    this.disconnect();
  }

  private disconnect(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.label = undefined;
    this.identity = undefined;
    this.fitted = undefined;
  }

  /** Trial text changes preserve Lit's marker nodes and are restored before observer delivery. */
  private fitProvider(provider: string, width: number, minimum: HTMLElement): string {
    const name = minimum.querySelector<HTMLElement>(".select-model-provider-name");
    const text = name === null ? undefined : Array.from(name.childNodes).find((node) => node instanceof Text);
    let selected = minimumReadableProviderPrefix(provider);
    if (text === undefined || providerCharacters === undefined) return selected;
    const characters = Array.from(providerCharacters.segment(provider), (part) => part.segment);
    const original = text.data;
    let low = 1;
    let high = characters.length - 1;
    try {
      while (low <= high) {
        const count = Math.floor((low + high) / 2);
        const candidate = `${characters.slice(0, count).join("")}…`;
        text.data = candidate;
        if (minimum.getBoundingClientRect().width <= width) {
          selected = candidate;
          low = count + 1;
        } else high = count - 1;
      }
      return selected;
    } finally {
      text.data = original;
    }
  }

  private measure(): void {
    const label = this.label;
    if (label?.isConnected !== true) return;
    const natural = label.querySelector<HTMLElement>(".select-model-natural");
    const model = label.querySelector<HTMLElement>(".select-model-natural .select-model-id");
    const minimum = label.querySelector<HTMLElement>(".select-model-minimum-label");
    if (natural === null || model === null || minimum === null) return;
    const width = label.getBoundingClientRect().width;
    if (width <= 0) return;
    const naturalWidth = natural.getBoundingClientRect().width;
    const provider = natural.querySelector<HTMLElement>(".select-model-provider-name")?.textContent ?? "";
    const modelId = model.textContent;
    const mode = modelLabelMode(width, naturalWidth, model.getBoundingClientRect().width, minimum.getBoundingClientRect().width, provider !== "");
    const text = mode === ModelLabelMode.Provider && width < naturalWidth ? this.fitProvider(provider, width, minimum) : provider;
    if (mode === this.currentMode && this.fitted?.provider === provider && this.fitted.model === modelId && this.fitted.text === text) return;
    this.currentMode = mode;
    this.fitted = { provider, model: modelId, text };
    this.host.requestUpdate();
  }
}
