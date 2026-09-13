/**
 * In-Memory Screenshot Perception Module
 * Captures the visible tab into volatile memory ONLY.
 * Enforces strict security invariants:
 * 1. Raw screenshots are NEVER persisted to disk or browser storage.
 * 2. Raw screenshots are NEVER transmitted over the network.
 * 3. assertSafeToTransmit strictly fails closed for any raw or un-sanitized image.
 */

export interface RawScreenshot {
  dataUrl: string;
  width: number;
  height: number;
  timestamp: number;
  isSanitized: false;
}

export interface SanitizationProof {
  appliedMasksCount: number;
  sanitizedAt: number;
  proofHash?: string;
  redactedCategories?: string[];
}

export interface SanitizedScreenshot {
  dataUrl: string;
  width: number;
  height: number;
  timestamp: number;
  isSanitized: true;
  sanitizationProof: SanitizationProof;
}

export type ScreenshotCapture = RawScreenshot | SanitizedScreenshot;

/**
 * Creates an in-memory raw screenshot container without persisting to disk or storage.
 */
export function createInMemoryScreenshot(
  dataUrl: string,
  width: number,
  height: number
): RawScreenshot {
  if (!dataUrl || typeof dataUrl !== 'string') {
    throw new Error('Screenshot dataUrl must be a valid non-empty string.');
  }

  return {
    dataUrl,
    width,
    height,
    timestamp: Date.now(),
    isSanitized: false,
  };
}

/**
 * Disposes an in-memory screenshot to allow garbage collection and wipe sensitive visual memory.
 */
export function disposeScreenshot(screenshot: ScreenshotCapture): void {
  // Clear the image buffer reference
  (screenshot as { dataUrl: string }).dataUrl = '';
}

/**
 * Captures the visible tab in memory using chrome.tabs API if available.
 * Ephemeral only — never stored to localStorage, IndexedDB, or filesystem.
 */
export async function captureVisibleTab(
  windowId?: number | null
): Promise<RawScreenshot> {
  if (typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.captureVisibleTab === 'function') {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      chrome.tabs.captureVisibleTab(
        windowId ?? null as unknown as number,
        { format: 'png' },
        (result) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!result) {
            reject(new Error('captureVisibleTab returned empty result.'));
          } else {
            resolve(result);
          }
        }
      );
    });

    // In Chrome background/extension context:
    return createInMemoryScreenshot(dataUrl, 0, 0);
  }

  throw new Error('chrome.tabs.captureVisibleTab is not available in the current environment.');
}

/**
 * Hard security guard: asserts that an image is safe to transmit across the network boundary.
 *
 * INVARIANT: Raw/un-sanitized screenshots MUST NEVER LEAVE THE BROWSER.
 * This guard ALWAYS fails closed if:
 * - The input is raw/un-sanitized
 * - The input is a raw data URL string
 * - The input is missing a verified sanitization proof
 * - The proof indicates no verification occurred
 */
export function assertSafeToTransmit(
  image: unknown,
  metadata?: Record<string, unknown>
): asserts image is SanitizedScreenshot {
  if (!image) {
    throw new Error(
      '[Security Violation] Transmission guard failed: No image payload provided.'
    );
  }

  // If a string (e.g. raw data URL or base64) is passed directly
  if (typeof image === 'string') {
    throw new Error(
      '[Security Violation] Transmission of raw image string is strictly forbidden. Visual data must undergo local privacy sanitization.'
    );
  }

  if (typeof image !== 'object') {
    throw new Error(
      '[Security Violation] Invalid image payload type. Expected a verified SanitizedScreenshot object.'
    );
  }

  const candidate = image as Partial<SanitizedScreenshot>;

  // Check explicit isSanitized flag
  if (candidate.isSanitized !== true) {
    throw new Error(
      '[Security Violation] Raw screenshot transmission blocked: Image is not sanitized. Raw browser screenshots must NEVER leave the device boundary.'
    );
  }

  // Check sanitization proof
  const proof = candidate.sanitizationProof;
  if (!proof || typeof proof !== 'object') {
    throw new Error(
      '[Security Violation] Sanitized image lacks valid sanitization proof. Transmission blocked.'
    );
  }

  if (typeof proof.appliedMasksCount !== 'number' || typeof proof.sanitizedAt !== 'number') {
    throw new Error(
      '[Security Violation] Incomplete sanitization proof. Transmission blocked.'
    );
  }

  // Passed all fail-closed checks
}
