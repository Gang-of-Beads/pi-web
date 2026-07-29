export type SafeTunnelFrpcArchiveFormat = "tar.gz";

export interface SafeTunnelFrpcArtifact {
  readonly platform: NodeJS.Platform;
  readonly architecture: NodeJS.Architecture;
  readonly archiveFormat: SafeTunnelFrpcArchiveFormat;
  readonly archiveEntryPath: string;
  readonly downloadUrl: string;
  readonly executableSha256: string;
  readonly executableSize: number;
}

export interface SafeTunnelFrpcRelease {
  readonly version: string;
  readonly artifacts: readonly SafeTunnelFrpcArtifact[];
}

/**
 * Releases stay in preferred fallback order. When desiredVersion advances, keep
 * prior entries here while PI WEB should continue accepting their verified
 * installed binaries as an update-failure fallback.
 */
export interface SafeTunnelFrpcManifest {
  readonly desiredVersion: string;
  readonly releases: readonly SafeTunnelFrpcRelease[];
}

export const safeTunnelFrpcManifest: SafeTunnelFrpcManifest = {
  desiredVersion: "0.69.1",
  releases: [
    {
      version: "0.69.1",
      artifacts: [
        {
          platform: "linux",
          architecture: "arm64",
          archiveFormat: "tar.gz",
          archiveEntryPath: "frp_0.69.1_linux_arm64/frpc",
          downloadUrl: "https://github.com/fatedier/frp/releases/download/v0.69.1/frp_0.69.1_linux_arm64.tar.gz",
          executableSha256: "f93e758ea21099a8ac6b65791d1113e86ccb06bab03cc41575613726e375322d",
          executableSize: 15_007_928,
        },
      ],
    },
  ],
};

export function findSafeTunnelFrpcRelease(
  manifest: SafeTunnelFrpcManifest,
  version: string,
): SafeTunnelFrpcRelease | undefined {
  return manifest.releases.find((release) => release.version === version);
}

export function findSafeTunnelFrpcArtifact(
  release: SafeTunnelFrpcRelease,
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
): SafeTunnelFrpcArtifact | undefined {
  return release.artifacts.find((artifact) => (
    artifact.platform === platform && artifact.architecture === architecture
  ));
}
