import { SUPPORTED_VERSIONS } from './guard.js';

// Read the actual host's public API; do not infer a version from tool shape,
// environment variables, an installed user's profile, or a bundled fallback.
export async function detectRuntimeVersion(loadHost = () => import('@deepseek-ai/dsh-app-boot')) {
  try {
    const host = await loadHost();
    if (typeof host.getDshRuntimeVersion !== 'function') return { supported: false, reason: 'version-api-unavailable' };
    const version = await host.getDshRuntimeVersion();
    if (typeof version !== 'string' || !version) return { supported: false, reason: 'invalid-runtime-version' };
    return { version, supported: SUPPORTED_VERSIONS.includes(version), reason: SUPPORTED_VERSIONS.includes(version) ? 'supported' : 'unsupported-runtime-version' };
  } catch {
    // Version detection must never crash the host or guess a compatible branch.
    return { supported: false, reason: 'version-detection-failed' };
  }
}

export function readFlag(value, fallback = true) {
  try {
    const current = value && typeof value.get === 'function' ? value.get() : value;
    return typeof current === 'boolean' ? current : fallback;
  } catch {
    // A disposed/unavailable volatile view must not break the native tool.
    return false;
  }
}
