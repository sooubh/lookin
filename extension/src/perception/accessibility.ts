/**
 * Accessibility Computation Module
 * Calculates accessible roles, accessible names (AccName), and ARIA states
 * strictly adhering to W3C ARIA specifications and project requirements.
 */

export interface AccessibilityInfo {
  role: string;
  name: string;
  description?: string;
  disabled: boolean;
  hidden: boolean;
  expanded?: boolean;
  checked?: boolean;
  selected?: boolean;
  required?: boolean;
  invalid?: boolean;
  headingLevel?: number;
}

/**
 * Mapping of HTML element tag names to implicit ARIA roles.
 */
const TAG_TO_IMPLICIT_ROLE: Record<string, string> = {
  BUTTON: 'button',
  A: 'link', // When href is present
  SELECT: 'combobox',
  TEXTAREA: 'textbox',
  H1: 'heading',
  H2: 'heading',
  H3: 'heading',
  H4: 'heading',
  H5: 'heading',
  H6: 'heading',
  NAV: 'navigation',
  MAIN: 'main',
  HEADER: 'banner',
  FOOTER: 'contentinfo',
  ASIDE: 'complementary',
  FORM: 'form',
  IMG: 'img',
  SUMMARY: 'button',
  DETAILS: 'group',
  UL: 'list',
  OL: 'list',
  LI: 'listitem',
  TABLE: 'table',
  THEAD: 'rowgroup',
  TBODY: 'rowgroup',
  TFOOT: 'rowgroup',
  TR: 'row',
  TH: 'columnheader',
  TD: 'cell',
  P: 'paragraph',
  DIALOG: 'dialog',
  ARTICLE: 'article',
  SECTION: 'region',
};

/**
 * Mapping of input type attribute to ARIA role.
 */
const INPUT_TYPE_TO_ROLE: Record<string, string> = {
  button: 'button',
  submit: 'button',
  reset: 'button',
  checkbox: 'checkbox',
  radio: 'radio',
  search: 'searchbox',
  number: 'spinbutton',
  range: 'slider',
  file: 'button',
  image: 'button',
  hidden: '',
};

/**
 * Computes the accessible role of an element.
 * Prioritizes explicit ARIA role attribute, then falls back to implicit HTML role.
 */
export function computeAccessibleRole(element: Element): string {
  // 1. Explicit role attribute
  const explicitRole = element.getAttribute('role');
  if (explicitRole) {
    const primaryRole = explicitRole.trim().split(/\s+/)[0]?.toLowerCase();
    if (primaryRole) {
      return primaryRole;
    }
  }

  const tag = element.tagName.toUpperCase();

  // 2. Input elements depend on type
  if (tag === 'INPUT') {
    const inputType = (element.getAttribute('type') || 'text').toLowerCase();
    if (inputType in INPUT_TYPE_TO_ROLE) {
      return INPUT_TYPE_TO_ROLE[inputType];
    }
    return 'textbox';
  }

  // 3. Anchor tags are links only if they have an href attribute
  if (tag === 'A') {
    return element.hasAttribute('href') ? 'link' : 'generic';
  }

  // 4. Select elements
  if (tag === 'SELECT') {
    const isMultiple = element.hasAttribute('multiple');
    const size = parseInt(element.getAttribute('size') || '0', 10);
    return isMultiple || size > 1 ? 'listbox' : 'combobox';
  }

  // 5. Implicit role by tag name
  if (tag in TAG_TO_IMPLICIT_ROLE) {
    return TAG_TO_IMPLICIT_ROLE[tag];
  }

  return 'generic';
}

/**
 * Resolves accessible text from space-separated IDs referenced by aria-labelledby or aria-describedby.
 */
function getTextFromIdList(idListStr: string, contextDoc?: Document | null): string {
  if (!idListStr || !contextDoc) return '';
  const ids = idListStr.trim().split(/\s+/);
  const parts: string[] = [];

  for (const id of ids) {
    if (!id) continue;
    let targetEl: Element | null = null;
    if (typeof contextDoc.getElementById === 'function') {
      targetEl = contextDoc.getElementById(id);
    } else if (typeof contextDoc.querySelector === 'function') {
      try {
        targetEl = contextDoc.querySelector(`#${id}`);
      } catch {
        targetEl = null;
      }
    }

    if (targetEl) {
      const text = targetEl.textContent || '';
      const trimmed = text.trim().replace(/\s+/g, ' ');
      if (trimmed) {
        parts.push(trimmed);
      }
    }
  }

  return parts.join(' ');
}

/**
 * Finds associated `<label>` text for form controls and interactive elements
 * (via `for` attribute, enclosing label, or adjacent label sibling).
 */
export function getFormLabelText(element: Element, contextDoc?: Document | null): string {
  const elementId = element.getAttribute('id');
  if (elementId && contextDoc) {
    let labelEl: Element | null = null;
    if (typeof contextDoc.querySelector === 'function') {
      try {
        labelEl = contextDoc.querySelector(`label[for="${elementId}"]`);
      } catch {
        labelEl = null;
      }
    }
    if (labelEl) {
      const text = labelEl.textContent || '';
      const trimmed = text.trim().replace(/\s+/g, ' ');
      if (trimmed) return trimmed;
    }
  }

  // Check enclosing <label>
  let parent = element.parentElement;
  while (parent) {
    if (parent.tagName.toUpperCase() === 'LABEL') {
      const clone = parent.textContent || '';
      const trimmed = clone.trim().replace(/\s+/g, ' ');
      if (trimmed) return trimmed;
    }
    parent = parent.parentElement;
  }

  // Check adjacent sibling <label> (common pattern for checkboxes and radio buttons)
  const isCheckOrRadio =
    element.getAttribute('type') === 'checkbox' ||
    element.getAttribute('type') === 'radio' ||
    element.getAttribute('role') === 'checkbox' ||
    element.getAttribute('role') === 'radio';

  let next = element.nextElementSibling;
  if (next && next.tagName.toUpperCase() === 'LABEL') {
    const forAttr = next.getAttribute('for');
    if (!forAttr && isCheckOrRadio) {
      const text = (next.textContent || '').trim().replace(/\s+/g, ' ');
      if (text) return text;
    } else if (forAttr && elementId && forAttr === elementId) {
      const text = (next.textContent || '').trim().replace(/\s+/g, ' ');
      if (text) return text;
    }
  }
  let prev = element.previousElementSibling;
  if (prev && prev.tagName.toUpperCase() === 'LABEL') {
    const forAttr = prev.getAttribute('for');
    if (!forAttr && isCheckOrRadio) {
      const text = (prev.textContent || '').trim().replace(/\s+/g, ' ');
      if (text) return text;
    } else if (forAttr && elementId && forAttr === elementId) {
      const text = (prev.textContent || '').trim().replace(/\s+/g, ' ');
      if (text) return text;
    }
  }

  return '';
}

/**
 * Computes accessible name following W3C Accessible Name Computation algorithm.
 * Priority:
 * 1. aria-labelledby
 * 2. aria-label
 * 3. Associated <label> (for form controls and interactive widgets)
 * 4. Button/Input value or alt
 * 5. Text content (for buttons, links, headings)
 * 6. placeholder attribute
 * 7. title attribute
 * 8. Fallback: name attribute
 */
export function computeAccessibleName(element: Element, doc?: Document): string {
  const contextDoc = doc || (element.ownerDocument as Document | undefined) || null;

  // 1. aria-labelledby
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy && contextDoc) {
    const text = getTextFromIdList(labelledBy, contextDoc);
    if (text) return text;
  }

  // 2. aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) {
    return ariaLabel.trim().replace(/\s+/g, ' ');
  }

  const tag = element.tagName.toUpperCase();
  const role = (element.getAttribute('role') || '').toLowerCase();

  // 3. Form control label (label[for], enclosing label, or adjacent label)
  const isFormControl =
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    role === 'checkbox' ||
    role === 'radio' ||
    role === 'textbox' ||
    role === 'combobox' ||
    role === 'switch';

  if (isFormControl) {
    const labelText = getFormLabelText(element, contextDoc);
    if (labelText) return labelText;
  }

  // 4. Input values / alt attributes
  if (tag === 'INPUT') {
    const type = (element.getAttribute('type') || 'text').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'reset') {
      const val = element.getAttribute('value');
      if (val && val.trim()) return val.trim();
      return type.charAt(0).toUpperCase() + type.slice(1);
    }
    if (type === 'image') {
      const alt = element.getAttribute('alt');
      if (alt && alt.trim()) return alt.trim();
    }
  }

  if (tag === 'IMG') {
    const alt = element.getAttribute('alt');
    if (alt && alt.trim()) return alt.trim();
  }

  // 5. Element text content (for buttons, links, headings, summary, etc.)
  const textualTags = new Set(['BUTTON', 'A', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SUMMARY', 'OPTION', 'P', 'SPAN']);
  if (textualTags.has(tag) || role === 'button' || role === 'link' || role === 'tab') {
    const rawText = element.textContent || '';
    const trimmed = rawText.trim().replace(/\s+/g, ' ');
    if (trimmed) return trimmed;
  }

  // 6. placeholder
  const placeholder = element.getAttribute('placeholder');
  if (placeholder && placeholder.trim()) {
    return placeholder.trim();
  }

  // 7. title
  const title = element.getAttribute('title');
  if (title && title.trim()) {
    return title.trim();
  }

  // 8. Fallback: name attribute for form fields
  const nameAttr = element.getAttribute('name');
  if (nameAttr && nameAttr.trim()) {
    return nameAttr.trim();
  }

  // Default fallback for any remaining textContent
  const fallbackText = (element.textContent || '').trim().replace(/\s+/g, ' ');
  return fallbackText;
}

/**
 * Discovers nearby semantic context (fieldset legend, container heading, or region label).
 */
export function computeNearbyContext(element: Element, doc?: Document | null): string | undefined {
  const contextDoc = doc || (element.ownerDocument as Document | undefined) || null;

  // 1. Enclosing fieldset legend
  if (typeof element.closest === 'function') {
    try {
      const fieldset = element.closest('fieldset');
      if (fieldset) {
        const legend = fieldset.querySelector('legend');
        if (legend && legend.textContent?.trim()) {
          return legend.textContent.trim().replace(/\s+/g, ' ');
        }
      }
    } catch {
      // Ignore if closest is not implemented in synthetic trees
    }
  }

  // 2. Traverse ancestor containers for legend, heading, or region label
  let curr = element.parentElement;
  while (curr && curr.tagName.toUpperCase() !== 'BODY' && curr.tagName.toUpperCase() !== 'HTML') {
    const tag = curr.tagName.toUpperCase();

    if (tag === 'FIELDSET') {
      const legend = typeof curr.querySelector === 'function' ? curr.querySelector('legend') : null;
      if (legend && legend.textContent?.trim()) {
        return legend.textContent.trim().replace(/\s+/g, ' ');
      }
    }

    const ariaLabel = curr.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) {
      return ariaLabel.trim().replace(/\s+/g, ' ');
    }

    const labelledBy = curr.getAttribute('aria-labelledby');
    if (labelledBy && contextDoc) {
      const labelText = getTextFromIdList(labelledBy, contextDoc);
      if (labelText) return labelText;
    }

    if (tag === 'FORM' || tag === 'SECTION' || tag === 'ARTICLE' || (tag === 'DIV' && curr.getAttribute('role') === 'region')) {
      if (typeof curr.querySelector === 'function') {
        const heading = curr.querySelector('h1, h2, h3, h4, h5, h6');
        if (heading && heading.textContent?.trim()) {
          const hText = heading.textContent.trim().replace(/\s+/g, ' ');
          if (hText.length < 80) {
            return hText;
          }
        }
      }
    }

    curr = curr.parentElement;
  }

  return undefined;
}

/**
 * Returns comprehensive accessibility metadata for an element.
 */
export function getAccessibilityInfo(element: Element, doc?: Document): AccessibilityInfo {
  const role = computeAccessibleRole(element);
  const name = computeAccessibleName(element, doc);
  const contextDoc = doc || (element.ownerDocument as Document | undefined) || null;

  // Disabled check
  const hasDisabledAttr = element.hasAttribute('disabled');
  const hasAriaDisabled = element.getAttribute('aria-disabled') === 'true';
  const isElementDisabled = Boolean((element as unknown as { disabled?: boolean }).disabled);
  const disabled = hasDisabledAttr || hasAriaDisabled || isElementDisabled;

  // Hidden check
  const hasHiddenAttr = element.hasAttribute('hidden');
  const hasAriaHidden = element.getAttribute('aria-hidden') === 'true';
  const hidden = hasHiddenAttr || hasAriaHidden;

  const info: AccessibilityInfo = {
    role,
    name,
    disabled,
    hidden,
  };

  // Description from aria-describedby or title
  const describedBy = element.getAttribute('aria-describedby');
  if (describedBy && contextDoc) {
    const desc = getTextFromIdList(describedBy, contextDoc);
    if (desc) info.description = desc;
  } else {
    const title = element.getAttribute('title');
    if (title && title.trim() && title.trim() !== name) {
      info.description = title.trim();
    }
  }

  // ARIA State attributes
  if (element.hasAttribute('aria-expanded')) {
    info.expanded = element.getAttribute('aria-expanded') === 'true';
  }

  if (element.hasAttribute('aria-checked')) {
    info.checked = element.getAttribute('aria-checked') === 'true';
  } else if ('checked' in element) {
    info.checked = Boolean((element as unknown as { checked?: boolean }).checked);
  }

  if (element.hasAttribute('aria-selected')) {
    info.selected = element.getAttribute('aria-selected') === 'true';
  } else if ('selected' in element) {
    info.selected = Boolean((element as unknown as { selected?: boolean }).selected);
  }

  if (element.hasAttribute('required') || element.getAttribute('aria-required') === 'true') {
    info.required = true;
  }

  if (element.getAttribute('aria-invalid') === 'true') {
    info.invalid = true;
  }

  // Heading level
  const tag = element.tagName.toUpperCase();
  if (/^H[1-6]$/.test(tag)) {
    info.headingLevel = parseInt(tag.charAt(1), 10);
  } else if (element.hasAttribute('aria-level')) {
    const parsedLevel = parseInt(element.getAttribute('aria-level') || '', 10);
    if (!isNaN(parsedLevel)) {
      info.headingLevel = parsedLevel;
    }
  }

  return info;
}
