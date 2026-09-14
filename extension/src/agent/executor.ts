/**
 * Local Browser Action Executor and Token Vault
 * Strictly adhering to 01_MASTER_SYSTEM_SPEC.md, 02_PRIVACY_FIREWALL_PLAN.md,
 * 03_BROWSER_AGENT_AND_AI_PLAN.md, and 04_ANTIGRAVITY_CODING_EXECUTION_PLAN.md (Phases A13, A14).
 *
 * Security Invariant:
 * The cloud server only ever sees and reasons with privacy-preserving tokens (e.g. "[EMAIL_1]").
 * The TokenVault resolves the token locally immediately before writing into the DOM.
 * Raw secrets are NEVER exposed in network payloads, server calls, or telemetry logs.
 */

import { PagePerception, ActionType, RiskLevel } from '../common/types.js';
import { ActionGuard, ActionGuardOptions } from './action-guard.js';
import { ValidatedAction, ValidatedActionTarget } from './action-schema.js';
import { TokenVault } from '../privacy/token-vault.js';
import { getElementByPerceptionId } from '../perception/dom.js';

export { TokenVault };

export interface ExecutionContext {
  document?: Document | any;
  window?: Window | any;
  tokenVault?: TokenVault;
  actionGuard?: ActionGuard;
}

export interface ExecutionResult {
  success: boolean;
  actionType: ActionType;
  targetId?: string;
  tokensResolved?: string[];
  valueSanitized?: string; // Safe placeholder for logs, NEVER raw secrets
  extractedData?: string;
  risk?: RiskLevel;
  requiresConfirmation?: boolean;
  error?: string;
  timestamp: number;
}

/**
 * Local browser action executor.
 * Dispatches vetted actions directly to local DOM elements.
 */
export class BrowserExecutor {
  private tokenVault: TokenVault;
  private actionGuard: ActionGuard;

  constructor(tokenVault?: TokenVault, actionGuard?: ActionGuard) {
    this.tokenVault = tokenVault ?? new TokenVault();
    this.actionGuard = actionGuard ?? new ActionGuard();
  }

  public getTokenVault(): TokenVault {
    return this.tokenVault;
  }

  public getActionGuard(): ActionGuard {
    return this.actionGuard;
  }

  /**
   * Validates and executes a proposed action.
   */
  public async execute(
    rawAction: unknown,
    perception: PagePerception,
    context?: ExecutionContext,
    options?: ActionGuardOptions
  ): Promise<ExecutionResult> {
    const vault = context?.tokenVault ?? this.tokenVault;
    const guard = context?.actionGuard ?? this.actionGuard;
    const doc = context?.document ?? (typeof document !== 'undefined' ? document : undefined);
    const win = context?.window ?? (typeof window !== 'undefined' ? window : undefined);

    // 1. Validate action against ActionGuard
    const guardResult = guard.validateAction(rawAction, perception, options);
    if (!guardResult.allowed) {
      return {
        success: false,
        actionType: guardResult.action?.type || 'wait',
        risk: guardResult.risk,
        requiresConfirmation: guardResult.requiresConfirmation,
        error: guardResult.error || guardResult.reason,
        timestamp: Date.now(),
      };
    }

    const action = guardResult.action;

    // 2. Resolve target element from local DOM if target is required
    let targetEl: any = null;
    if (this.requiresDomTarget(action.type)) {
      if (!doc) {
        return {
          success: false,
          actionType: action.type,
          error: 'No DOM document available in execution context',
          timestamp: Date.now(),
        };
      }

      targetEl = this.findDomElement(doc, action.target, guardResult.matchedElement?.id);
      if (!targetEl) {
        return {
          success: false,
          actionType: action.type,
          error: `DOM element for target "${action.target?.id || action.target?.text || 'target'}" could not be located in document`,
          timestamp: Date.now(),
        };
      }
    }

    // 3. Execute action
    try {
      switch (action.type) {
        case 'click': {
          if (typeof targetEl.scrollIntoView === 'function') {
            targetEl.scrollIntoView({ block: 'center', inline: 'center' });
          }
          if (typeof targetEl.click === 'function') {
            targetEl.click();
          } else if (typeof targetEl.dispatchEvent === 'function') {
            const clickEvent = typeof MouseEvent !== 'undefined'
              ? new MouseEvent('click', { bubbles: true, cancelable: true })
              : { type: 'click', bubbles: true };
            targetEl.dispatchEvent(clickEvent);
          }
          return {
            success: true,
            actionType: 'click',
            targetId: targetEl.id || action.target?.id,
            risk: action.risk,
            timestamp: Date.now(),
          };
        }

        case 'type':
        case 'fill': {
          const rawValue = action.value || '';
          // Resolve tokens right before DOM write
          let resolvedText = rawValue;
          let tokensResolved: string[] = [];
          if (vault && typeof (vault as any).resolveTokens === 'function') {
            const res = (vault as any).resolveTokens(rawValue);
            resolvedText = res.resolvedText;
            tokensResolved = res.tokensResolved || [];
          } else if (vault && typeof (vault as any).detokenizeText === 'function') {
            resolvedText = (vault as any).detokenizeText(rawValue);
            const matches = rawValue.match(/\[([A-Z0-9_]+)\]/g) || [];
            tokensResolved = matches;
          }

          if (typeof targetEl.focus === 'function') {
            targetEl.focus();
          }

          // Set element value
          targetEl.value = resolvedText;

          // Dispatch input and change events for reactive frameworks
          if (typeof targetEl.dispatchEvent === 'function') {
            const inputEvent = typeof Event !== 'undefined'
              ? new Event('input', { bubbles: true })
              : { type: 'input', bubbles: true };
            const changeEvent = typeof Event !== 'undefined'
              ? new Event('change', { bubbles: true })
              : { type: 'change', bubbles: true };
            targetEl.dispatchEvent(inputEvent);
            targetEl.dispatchEvent(changeEvent);
          }

          return {
            success: true,
            actionType: action.type,
            targetId: targetEl.id || action.target?.id,
            tokensResolved,
            valueSanitized: rawValue, // Returns the safe tokenized version for logging
            risk: action.risk,
            timestamp: Date.now(),
          };
        }

        case 'select': {
          if (typeof targetEl.focus === 'function') {
            targetEl.focus();
          }
          targetEl.value = action.value || '';
          if (typeof targetEl.dispatchEvent === 'function') {
            const changeEvent = typeof Event !== 'undefined'
              ? new Event('change', { bubbles: true })
              : { type: 'change', bubbles: true };
            targetEl.dispatchEvent(changeEvent);
          }
          return {
            success: true,
            actionType: 'select',
            targetId: targetEl.id || action.target?.id,
            risk: action.risk,
            timestamp: Date.now(),
          };
        }

        case 'focus': {
          if (typeof targetEl.focus === 'function') {
            targetEl.focus();
          }
          return {
            success: true,
            actionType: 'focus',
            targetId: targetEl.id || action.target?.id,
            risk: action.risk,
            timestamp: Date.now(),
          };
        }

        case 'extract': {
          let extractedData = '';
          if (targetEl.value !== undefined) {
            extractedData = String(targetEl.value);
          } else if (targetEl.innerText !== undefined) {
            extractedData = String(targetEl.innerText);
          } else if (targetEl.textContent !== undefined) {
            extractedData = String(targetEl.textContent);
          }

          return {
            success: true,
            actionType: 'extract',
            targetId: targetEl.id || action.target?.id,
            extractedData: extractedData.trim(),
            risk: action.risk,
            timestamp: Date.now(),
          };
        }

        case 'scroll': {
          const distance = action.distance ?? 300;
          let top = 0;
          let left = 0;
          if (action.direction === 'down') top = distance;
          else if (action.direction === 'up') top = -distance;
          else if (action.direction === 'right') left = distance;
          else if (action.direction === 'left') left = -distance;

          if (win && typeof win.scrollBy === 'function') {
            win.scrollBy({ top, left, behavior: 'smooth' });
          }
          return {
            success: true,
            actionType: 'scroll',
            risk: action.risk,
            timestamp: Date.now(),
          };
        }

        case 'navigate': {
          if (win && win.location) {
            win.location.href = action.url!;
          }
          return {
            success: true,
            actionType: 'navigate',
            risk: action.risk,
            timestamp: Date.now(),
          };
        }

        case 'wait': {
          const duration = action.durationMs ?? 1000;
          await new Promise((resolve) => setTimeout(resolve, duration));
          return {
            success: true,
            actionType: 'wait',
            risk: action.risk,
            timestamp: Date.now(),
          };
        }

        default: {
          return {
            success: false,
            actionType: action.type,
            error: `Unsupported action type "${action.type}"`,
            timestamp: Date.now(),
          };
        }
      }
    } catch (err) {
      return {
        success: false,
        actionType: action.type,
        error: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      };
    }
  }

  private requiresDomTarget(type: ActionType): boolean {
    return ['click', 'type', 'fill', 'select', 'focus', 'extract'].includes(type);
  }

  private findDomElement(
    doc: Document | any,
    target?: ValidatedActionTarget,
    matchedId?: string
  ): any {
    if (!target && !matchedId) return null;

    // 1. By perception element registry lookup
    if (matchedId) {
      const el = getElementByPerceptionId(matchedId);
      if (el) return el;
    }
    if (target?.id) {
      const el = getElementByPerceptionId(target.id);
      if (el) return el;
    }

    // 2. By matched ID as HTML id attribute
    if (matchedId && typeof doc.getElementById === 'function') {
      const el = doc.getElementById(matchedId);
      if (el) return el;
    }

    // 3. By target.id as HTML id attribute
    if (target?.id && typeof doc.getElementById === 'function') {
      const el = doc.getElementById(target.id);
      if (el) return el;
    }

    // 3. By selector
    if (target?.selector && typeof doc.querySelector === 'function') {
      try {
        const el = doc.querySelector(target.selector);
        if (el) return el;
      } catch {
        // Ignore invalid selectors
      }
    }

    // 4. By querySelector searching role and text or input names
    if (target?.text && typeof doc.querySelectorAll === 'function') {
      const candidates = doc.querySelectorAll('button, a, input, select, textarea, [role="button"]');
      const lower = target.text.toLowerCase().trim();
      for (const el of Array.from(candidates) as any[]) {
        const text = (el.innerText || el.textContent || el.value || el.placeholder || '').toLowerCase().trim();
        if (text === lower || text.includes(lower)) {
          return el;
        }
      }
    }

    return null;
  }
}
