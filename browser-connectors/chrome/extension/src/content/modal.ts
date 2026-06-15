// In-page UI rendered inside a shadow root so it can't be styled or scraped by
// the host page. It shows ONLY decision metadata — reason, risk level, and the
// finding categories that matched — never the prompt text or any finding
// preview. All dynamic values are set via textContent (no HTML injection).

export interface WarnContent {
  reason: string;
  riskLevel: string;
  categories: string[];
}

export interface BlockContent {
  /** Override for the toast title (e.g. high-risk warns escalated to a local block). */
  title?: string;
  reason: string;
  categories: string[];
}

export interface WarnNoticeContent {
  reason: string;
  categories: string[];
}

const STYLE = `
  :host { all: initial; }
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 2147483647;
    display: flex; align-items: center; justify-content: center; font-family: system-ui, sans-serif; }
  .card { background: #fff; color: #111; max-width: 460px; width: calc(100% - 40px);
    border-radius: 12px; padding: 20px 22px; box-shadow: 0 10px 40px rgba(0,0,0,.3); }
  .title { font-size: 16px; font-weight: 700; margin: 0 0 8px; }
  .risk { display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase;
    padding: 2px 8px; border-radius: 999px; background: #fde68a; color: #78350f; margin-bottom: 10px; }
  .risk.low { background: #dbeafe; color: #1e3a8a; }
  .risk.medium { background: #fde68a; color: #78350f; }
  .reason { font-size: 14px; line-height: 1.45; margin: 0 0 10px; }
  .cats { font-size: 12px; color: #555; margin: 0 0 16px; }
  .row { display: flex; gap: 10px; justify-content: flex-end; }
  button { font: inherit; font-size: 14px; padding: 8px 14px; border-radius: 8px; cursor: pointer; border: 1px solid #d1d5db; }
  .proceed { background: #b91c1c; color: #fff; border-color: #b91c1c; }
  .toast { position: fixed; right: 16px; bottom: 16px; max-width: 380px; background: #111; color: #fff;
    border-radius: 10px; padding: 12px 14px; z-index: 2147483647; font-family: system-ui, sans-serif; box-shadow: 0 8px 30px rgba(0,0,0,.4); }
  .toast .title { font-size: 14px; }
  .toast .reason { font-size: 12px; opacity: .85; margin: 4px 0 0; }
  .toast.warn { background: #fef3c7; color: #78350f; border: 1px solid #f59e0b; }
`;

function mountShadow(): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement('div');
  host.setAttribute('data-vguardrail', 'ui');
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  root.appendChild(style);
  document.body.appendChild(host);
  return { host, root };
}

function categoriesLabel(categories: string[]): string {
  return categories.length ? `Detected: ${categories.join(', ')}` : 'Policy warning';
}

/** Shows the WARN modal; resolves true (proceed) or false (cancel). */
export function showWarnModal(content: WarnContent): Promise<boolean> {
  const { host, root } = mountShadow();
  return new Promise<boolean>((resolve) => {
    const finish = (value: boolean): void => {
      host.remove();
      resolve(value);
    };

    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
    const card = document.createElement('div');
    card.className = 'card';

    const title = document.createElement('p');
    title.className = 'title';
    title.textContent = 'This prompt may violate policy';

    const risk = document.createElement('span');
    // Level-specific class tints the badge (low = blue, medium = amber).
    const level = content.riskLevel === 'low' ? 'low' : 'medium';
    risk.className = `risk ${level}`;
    risk.setAttribute('data-vg', 'risk');
    risk.textContent = `${content.riskLevel} risk`;

    const reason = document.createElement('p');
    reason.className = 'reason';
    reason.setAttribute('data-vg', 'reason');
    reason.textContent = content.reason || 'Submitting this prompt is flagged by your organization.';

    const cats = document.createElement('p');
    cats.className = 'cats';
    cats.setAttribute('data-vg', 'cats');
    cats.textContent = categoriesLabel(content.categories);

    const rowEl = document.createElement('div');
    rowEl.className = 'row';
    const cancel = document.createElement('button');
    cancel.setAttribute('data-vg', 'cancel');
    cancel.textContent = 'Cancel';
    const proceed = document.createElement('button');
    proceed.className = 'proceed';
    proceed.setAttribute('data-vg', 'proceed');
    proceed.textContent = 'Send anyway';
    cancel.addEventListener('click', () => finish(false));
    proceed.addEventListener('click', () => finish(true));

    rowEl.append(cancel, proceed);
    card.append(title, risk, reason, cats, rowEl);
    backdrop.appendChild(card);
    // Clicking the backdrop cancels (fail-safe toward not sending).
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) finish(false);
    });
    root.appendChild(backdrop);
  });
}

/** Shows a transient BLOCK notice (auto-dismisses). */
export function showBlockNotice(content: BlockContent): void {
  const { host, root } = mountShadow();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('data-vg', 'block');
  const title = document.createElement('p');
  title.className = 'title';
  title.textContent = content.title ?? 'Prompt blocked by policy';
  const reason = document.createElement('p');
  reason.className = 'reason';
  reason.textContent = content.reason || categoriesLabel(content.categories);
  toast.append(title, reason);
  root.appendChild(toast);
  setTimeout(() => host.remove(), 6000);
}

/** Shows a transient low-risk WARN notice (auto-dismisses; the prompt proceeds). */
export function showWarnNotice(content: WarnNoticeContent): void {
  const { host, root } = mountShadow();
  const toast = document.createElement('div');
  toast.className = 'toast warn';
  toast.setAttribute('data-vg', 'warn-notice');
  const title = document.createElement('p');
  title.className = 'title';
  title.textContent = 'Policy warning — prompt sent';
  const reason = document.createElement('p');
  reason.className = 'reason';
  reason.textContent = content.reason || categoriesLabel(content.categories);
  toast.append(title, reason);
  root.appendChild(toast);
  setTimeout(() => host.remove(), 6000);
}
