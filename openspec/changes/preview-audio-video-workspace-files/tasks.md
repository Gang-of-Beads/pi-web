## 1. Classification and limits

- [x] 1.1 Classify audio and video extensions as streamed preview media and extend the public `FileContentMediaType` union; verified `src/shared/workspaceFiles.test.ts` covers extension, media kind, source, and preview MIME type for each format.
- [x] 1.2 Add a media preview limit and a per-kind limit lookup, keeping the inline snapshot limit for every other kind; verified the lookup returns the streamed 512 MB limit for media and the unchanged 10 MB snapshot limit for images, and that the public API baseline diff is limited to the media type union.

## 2. Server transport

- [x] 2.1 Stream media preview bytes from the validated descriptor instead of snapshotting them, and apply the media limit; verified a video beyond the snapshot limit previews as a stream with its full length and an existing over-limit image still reports the 10 MB limit.
- [x] 2.2 Parse a single byte range, serve the requested slice, and fall back to the whole file for absent, empty, malformed, multi-range, suffix-zero, and past-end ranges; verified `parseWorkspaceFileRange` unit cases and end-to-end slice bodies.
- [x] 2.3 Emit `Accept-Ranges` for streamed previews, and status 206 with `Content-Range` and a matching `Content-Length` for a satisfied range, on both the project route and the `machines/local` alias; verified through injected requests.
- [x] 2.4 Serve media previews under a sandboxed policy that allows `media-src 'self'`, leaving `media-src 'none'` on image, HTML, and PDF previews; verified in the response policy tests.

## 3. Client

- [x] 3.1 Recognise the audio and video media kinds as preview kinds and render native `<video>`/`<audio>` players against the preview URL with metadata-only preload; verified rendered element attributes and that no frame or code viewer is emitted.
- [x] 3.2 Reuse the preview-failure state when the media element errors, so Open in new window and Download stay reachable; verified by dispatching a media error.
- [x] 3.3 Reflect the limit applying to the file's own kind in the too-large message; verified a clip beyond the media limit names 512 MB while an image beyond the snapshot limit still names 10 MB.

## 4. Follow-ups

- [ ] 4.1 Raise or specialise the federated preview response limit so a media preview on a remote machine is not refused at the snapshot size, or state the remote limitation in the UI before the request.
- [ ] 4.2 Consider `Cache-Control` for range responses: private media previews are currently cached for one hour, which is correct for content but delays reflecting an edited file of the same modification time.
