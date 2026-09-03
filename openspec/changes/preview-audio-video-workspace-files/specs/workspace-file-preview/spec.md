## Purpose

Let a browser render and play workspace files that PI WEB can serve safely, with per-kind size limits, streamed transport for large payloads, and response containment that keeps preview bytes from becoming active same-origin content.

## ADDED Requirements

### Requirement: Audio and video workspace files preview as media
The workspace file preview route SHALL classify common audio and video formats as browser-previewable media and SHALL report the media kind to the client so it can choose a player instead of a download prompt.

#### Scenario: Preview a video file
- **WHEN** a client requests a preview for a workspace file with a video extension
- **THEN** the response carries the video MIME type, reports the `video` media kind, and stays sandboxed with media allowed from the preview's own origin

#### Scenario: Preview an audio file
- **WHEN** a client requests a preview for a workspace file with an audio extension
- **THEN** the response carries the audio MIME type and reports the `audio` media kind

#### Scenario: Existing preview kinds keep their containment
- **WHEN** a client requests a preview for an image, HTML, or PDF file
- **THEN** the response policy is unchanged from before media support and still denies media loading entirely

### Requirement: Media previews are streamed under a media-sized limit
Preview bytes for audio and video SHALL stream from the validated file descriptor rather than being read into memory as one snapshot, and SHALL be allowed up to a limit sized for media. Previews that are snapshotted SHALL keep the pre-existing inline preview limit.

#### Scenario: Video larger than the snapshot limit still previews
- **WHEN** a client requests a preview for a video file larger than the inline snapshot limit but within the media limit
- **THEN** the preview is served as a stream with the full byte length advertised

#### Scenario: File beyond the applicable limit
- **WHEN** a client requests a preview for a file that exceeds the limit applying to its own kind
- **THEN** the request fails with an error naming the limit that applies to that kind

#### Scenario: Client reflects the applicable limit
- **WHEN** the viewer shows a file that exceeds the limit applying to its own kind
- **THEN** the message names that kind's limit, and Open in new window and Download remain available

### Requirement: Streamed previews answer byte-range requests
The preview route SHALL advertise range requests for streamed responses and SHALL answer a single satisfiable byte range with partial content, so a media element can seek without refetching the whole file.

#### Scenario: Seek inside a clip
- **WHEN** a client requests a preview with a single satisfiable `Range` header
- **THEN** the response uses status 206, reports the served slice against the whole file in `Content-Range`, and sends exactly those bytes

#### Scenario: Range absent, malformed, or unsatisfiable
- **WHEN** a client requests a preview with no `Range` header, a malformed one, a multi-range value, or a start past the end of the file
- **THEN** the whole file is served with status 200 rather than failing the request

#### Scenario: Media element reports an unusable codec
- **WHEN** the browser cannot decode the requested media
- **THEN** the viewer surfaces its existing preview-failure state for that selection and keeps Open in new window and Download reachable
