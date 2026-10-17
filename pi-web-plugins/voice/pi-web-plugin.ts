import type { ComposerRuntimeContext, PiWebPlugin, PluginSettings } from "@gang-of-beads/pi-web/plugin-api";
import { createBrowserVoiceRecorder } from "./lib/browserVoiceRecorder.js";
import { LiveDictation } from "./lib/liveDictation.js";
import { captureMicrophoneSamples } from "./lib/microphoneSamples.js";
import { speechTokenRequester } from "./lib/speechTokenRequest.js";
import { VoiceController } from "./lib/voiceController.js";
import { draftWithDictation } from "./lib/dictationDraft.js";
import { isVoiceCaptureActive, type VoiceCaptureState } from "./lib/voiceCapture.js";
import { parseVoiceSettings } from "./voiceSettings.js";
import { dictationEnabled, dictationLabel, dictationOffered, dictationStatus } from "./composerVoice.js";
import type { PiWebSpeechToTextConfig } from "./lib/voiceConfig.js";

/**
 * Voice as a plugin.
 *
 * Everything dictation needs now arrives through published seams: the control
 * is a composer contribution, its live report is a composer status line, its
 * text lands through the same insert path the keyboard uses, and its
 * configuration is the plugin's own namespaced block rather than a pair of
 * keys the core contract had to name.
 */

/**
 * One dictation and the composer context it was started from. The context is
 * bound to the machine and session the composer showed at that click, so the
 * run's text and its status stay with that session when the composer moves on.
 * A run is found by its context's scope as the context reports it now: a
 * session that was still starting reports its real id once it has one, and
 * stays the same session.
 */
interface DictationRun {
  readonly composer: ComposerRuntimeContext;
  readonly controller: VoiceController;
  state: VoiceCaptureState;
}

function composerScopeKey(composer: Pick<ComposerRuntimeContext, "machineId" | "sessionId">): string {
  return JSON.stringify([composer.machineId ?? null, composer.sessionId ?? null]);
}

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Voice",
  activate: (context) => {
    let config: PiWebSpeechToTextConfig | undefined = parseVoiceSettings(context.settings);
    const runs = new Set<DictationRun>();

    function runOf(composer: ComposerRuntimeContext): DictationRun | undefined {
      const key = composerScopeKey(composer);
      return [...runs].find((run) => composerScopeKey(run.composer) === key);
    }

    const unsubscribe = context.on?.("settings-changed", (event: { settings: PluginSettings }) => {
      config = parseVoiceSettings(event.settings);
    });
    const requestToken = speechTokenRequester(context.callOperation ?? (() => Promise.reject(new Error("This host does not offer plugin requests."))));

    function startRun(composer: ComposerRuntimeContext): DictationRun {
      const previous = runOf(composer);
      if (previous !== undefined) runs.delete(previous);
      let dictationBase: string | undefined;
      const run: DictationRun = {
        composer,
        state: { kind: "idle" },
        controller: new VoiceController(
          {
            recorder: createBrowserVoiceRecorder(),
            requestToken,
            createLiveDictation: (onText, onError) => new LiveDictation({
              requestToken,
              openSocket: (url) => new WebSocket(url),
              captureAudio: captureMicrophoneSamples,
              onText,
              onError,
              newRequestId: () => crypto.randomUUID().replaceAll("-", ""),
            }),
          },
          {
            onState: (next) => {
              run.state = next;
              if (next.kind !== "listening") dictationBase = undefined;
              if (next.kind === "idle") runs.delete(run);
              composer.requestUpdate();
            },
            onTranscript: (text) => {
              dictationBase = undefined;
              composer.insertText(text);
            },
            onLiveTranscript: (text) => {
              dictationBase ??= composer.draft;
              composer.replaceDraft(draftWithDictation(dictationBase, text));
            },
          },
        ),
      };
      composer.signal?.addEventListener("abort", () => { void run.controller.stop(); }, { once: true });
      runs.add(run);
      return run;
    }

    function runFor(composer: ComposerRuntimeContext): DictationRun {
      const current = runOf(composer);
      return current !== undefined && isVoiceCaptureActive(current.state) ? current : startRun(composer);
    }

    return {
      contributions: {
        composer: [{
          id: "dictate",
          slot: "trailing",
          title: "Dictate",
          icon: context.svg`<svg class="prompt-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0"></path><path d="M12 18v3"></path></svg>`,
          available: () => dictationOffered(config),
          enabled: (composer) => dictationEnabled(runOf(composer)?.state ?? { kind: "idle" }, composer),
          status: (composer) => {
            const run = runOf(composer);
            return run === undefined ? undefined : dictationStatus(run.state);
          },
          run: async (composer) => {
            if (!dictationOffered(config) || composer.signal?.aborted === true) return;
            await runFor(composer).controller.toggle(config);
          },
        }],
      },
      dispose: () => {
        unsubscribe?.();
        for (const run of runs.values()) void run.controller.stop();
        runs.clear();
      },
    };
  },
};

export { dictationLabel };
export default plugin;
