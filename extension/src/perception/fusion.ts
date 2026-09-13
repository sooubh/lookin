/**
 * Perception Fusion Module
 * Combines DOM elements, viewport coordinates, and page metadata into
 * a unified, structured PagePerception object conforming strictly to types.ts.
 */

import { PagePerception, PerceptionElement } from '../common/types.js';
import { extractDomElements, DomExtractionOptions } from './dom.js';

export interface PerceptionFusionOptions {
  document?: Document;
  window?: Window;
  domElements?: PerceptionElement[];
  viewport?: { width: number; height: number };
  url?: string;
  title?: string;
  filterInvisible?: boolean;
  sortNaturalReadingOrder?: boolean;
}

/**
 * Produces a structured PagePerception object.
 */
export function fusePerception(options: PerceptionFusionOptions = {}): PagePerception {
  const doc = options.document || (typeof document !== 'undefined' ? document : null);
  const win = options.window || (doc?.defaultView || (typeof window !== 'undefined' ? window : null));

  // 1. Resolve Viewport
  let viewport = options.viewport;
  if (!viewport) {
    const width = win?.innerWidth || (doc?.documentElement ? doc.documentElement.clientWidth : 0) || 1280;
    const height = win?.innerHeight || (doc?.documentElement ? doc.documentElement.clientHeight : 0) || 800;
    viewport = { width, height };
  }

  // 2. Resolve URL and Title
  const url = options.url || (win?.location?.href || (doc && 'location' in doc ? (doc as unknown as { location: Location }).location?.href : '')) || '';
  const title = options.title || doc?.title || '';

  // 3. Resolve Elements
  let elements: PerceptionElement[];
  if (options.domElements) {
    elements = [...options.domElements];
  } else if (doc) {
    const extractionOpts: DomExtractionOptions = {
      document: doc,
      window: win || undefined,
    };
    elements = extractDomElements(extractionOpts);
  } else {
    elements = [];
  }

  // 4. Optionally filter invisible elements (default keeps both visible and invisible with visible flag)
  if (options.filterInvisible) {
    elements = elements.filter((el) => el.visible);
  }

  // 5. Sort elements into natural reading order (top-to-bottom, left-to-right)
  const shouldSort = options.sortNaturalReadingOrder !== false;
  if (shouldSort) {
    elements.sort((a, b) => {
      const [ax, ay] = a.bbox;
      const [bx, by] = b.bbox;

      // Group elements on roughly the same horizontal line (within 8px)
      if (Math.abs(ay - by) > 8) {
        return ay - by;
      }
      return ax - bx;
    });
  }

  return {
    viewport,
    url,
    title,
    elements,
    timestamp: Date.now(),
  };
}
