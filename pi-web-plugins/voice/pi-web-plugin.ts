import type { ComposerRuntimeContext, PiWebPlugin, PluginSettings } from "@gang-of-beads/pi-web/plugin-api";
import { createBrowserVoiceRecorder } from "./lib/browserVoiceRecorder.js";
import { LiveDictation } from "./lib/liveDictation.js";
import { captureMicrophoneSamples } from "./lib/microphoneSamples.js";
import { speechTokenRequester } from "./lib/speechTokenRequest.js";
import { VoiceController } from "./lib/voiceController.js";
import { draftWithDictation } from "./lib/dictationDraft.js";
import type { VoiceCaptureState } from "./lib/voiceCapture.js";
import { parseVoiceSettings } from "./voiceSettings.js";
import { dictationEnabled, dictationGlyph, dictationLabel, dictationOffered, dictationStatus } from "./composerVoice.js";
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

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Voice",
  activate: (context) => {
    let config: PiWebSpeechToTextConfig | undefined = parseVoiceSettings(context.settings);
    let state: VoiceCaptureState = { kind: "idle" };
    let dictationBase: string | undefined;
    let controller: VoiceController | undefined;

    const unsubscribe = context.on?.("settings-changed", (event: { settings: PluginSettings }) => {
      config = parseVoiceSettings(event.settings);
    });
    const requestToken = speechTokenRequester(context.fetchJson ?? (() => Promise.reject(new Error("This host does not offer plugin requests."))), context.runtimePluginId);

    function controllerFor(composer: ComposerRuntimeContext): VoiceController {
      controller ??= new VoiceController(
        {
          recorder: createBrowserVoiceRecorder(),
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
            state = next;
            if (next.kind !== "listening") dictationBase = undefined;
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
      );
      return controller;
    }

    return {
      contributions: {
        composer: [{
          id: "dictate",
          slot: "trailing",
          title: "Dictate",
          enabled: (composer) => dictationOffered(config) && dictationEnabled(state, composer),
          disabledReason: () => dictationOffered(config) ? undefined : "Dictation is not configured on this machine",
          status: () => dictationStatus(state),
          run: async (composer) => {
            if (!dictationOffered(config)) return;
            await controllerFor(composer).toggle(config);
          },
        }],
      },
      dispose: () => {
        unsubscribe?.();
        controller = undefined;
      },
    };
  },
};

export { dictationGlyph, dictationLabel };
export default plugin;
