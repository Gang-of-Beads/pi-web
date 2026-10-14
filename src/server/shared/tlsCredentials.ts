import { X509Certificate, createPrivateKey } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { createSecureContext, type SecureContextOptions } from "node:tls";
import type { PiWebTlsConfig } from "../../config.js";
import { errorMessage } from "../../shared/unknownValues.js";

/**
 * The web/API's HTTPS certificate: read, checked, and swapped in place when the files change.
 *
 * PI WEB serves HTTPS only with a certificate the reader provides (`tls.certFile` and
 * `tls.keyFile`, or `PI_WEB_TLS_CERT` and `PI_WEB_TLS_KEY`). A certificate that cannot be used
 * stops the web/API from starting instead of letting it listen in plain HTTP, and a renewed one
 * replaces the running one without a restart (owner, 2026-10-14). The web/API serves with it and
 * `pi-web doctor` checks it, so it lives in `shared/`.
 */

export interface TlsCredentials {
  cert: Buffer;
  key: Buffer;
}

export interface TlsCertificateFacts {
  validTo: string;
  names: string;
}

/** A certificate or key PI WEB cannot serve, in a sentence that names the file. */
export class TlsCredentialsError extends Error {
  override name = "TlsCredentialsError";
}

/** How often the files are checked for a renewal; certificates live for months, a renewal is picked up within this. */
export const TLS_RELOAD_CHECK_MS = 10 * 60 * 1000;

/**
 * The pair, refused unless it can serve. `createSecureContext` alone accepts a key of another
 * algorithm than the certificate's (an RSA key left beside a `tailscale cert` ECDSA certificate):
 * OpenSSL files them in different slots and every handshake then fails, so the key is matched to
 * the certificate explicitly.
 */
export function readTlsCredentials(files: PiWebTlsConfig, now: Date = new Date()): TlsCredentials & TlsCertificateFacts {
  const cert = readPemFile(files.certFile, "certificate");
  const key = readPemFile(files.keyFile, "private key");
  const leaf = parseCertificate(cert, files.certFile);
  if (!keyMatches(leaf, key)) throw new TlsCredentialsError(`The HTTPS private key ${files.keyFile} does not belong to the certificate ${files.certFile}.`);
  try {
    createSecureContext({ cert, key });
  } catch (error) {
    throw new TlsCredentialsError(`PI WEB cannot use the HTTPS certificate ${files.certFile} with the key ${files.keyFile}: ${errorMessage(error)}`);
  }
  if (leaf.validToDate.getTime() <= now.getTime()) throw new TlsCredentialsError(`The HTTPS certificate ${files.certFile} expired on ${leaf.validTo}.`);
  return { cert, key, validTo: leaf.validTo, names: leaf.subjectAltName ?? leaf.subject };
}

function readPemFile(file: string, what: string): Buffer {
  try {
    return readFileSync(file);
  } catch (error) {
    throw new TlsCredentialsError(`PI WEB cannot read the HTTPS ${what} ${file}: ${errorMessage(error)}`);
  }
}

function parseCertificate(cert: Buffer, file: string): X509Certificate {
  try {
    return new X509Certificate(cert);
  } catch (error) {
    throw new TlsCredentialsError(`The HTTPS certificate ${file} is not a PEM certificate: ${errorMessage(error)}`);
  }
}

function keyMatches(leaf: X509Certificate, key: Buffer): boolean {
  try {
    return leaf.checkPrivateKey(createPrivateKey(key));
  } catch {
    return false;
  }
}

interface SecureContextTarget {
  setSecureContext(options: SecureContextOptions): void;
}

interface TlsReloadLog {
  info(message: string): void;
  error(message: string): void;
}

/**
 * Re-reads the certificate and key when either file changes and gives the running server the new
 * pair; open connections keep the one they started with. A pair that cannot be used - a renewal
 * caught between writing the certificate and writing the key, say - is logged and the running
 * certificate stays until the files change again. `served` is the files' signature taken before
 * the running pair was read, so a renewal landing during startup is still seen as a change.
 * Returns the stop function.
 */
export function watchTlsCredentials(server: SecureContextTarget, files: PiWebTlsConfig, served: string, log: TlsReloadLog, intervalMs: number = TLS_RELOAD_CHECK_MS): () => void {
  let seen = served;
  const timer = setInterval(() => {
    const current = tlsFileSignature(files);
    if (current === seen) return;
    seen = current;
    try {
      const credentials = readTlsCredentials(files);
      server.setSecureContext({ cert: credentials.cert, key: credentials.key });
      log.info(`HTTPS certificate reloaded from ${files.certFile}, valid until ${credentials.validTo}`);
    } catch (error) {
      log.error(`HTTPS certificate not reloaded; the running one stays: ${errorMessage(error)}`);
    }
  }, intervalMs);
  timer.unref();
  return () => { clearInterval(timer); };
}

/** What changes when either file is rewritten, replaced, or has its owner or mode fixed (ctime). */
export function tlsFileSignature(files: PiWebTlsConfig): string {
  return [files.certFile, files.keyFile].map((file) => {
    try {
      const stat = statSync(file);
      return `${String(stat.ino)}:${String(stat.size)}:${String(stat.mtimeMs)}:${String(stat.ctimeMs)}`;
    } catch {
      return "missing";
    }
  }).join("|");
}
