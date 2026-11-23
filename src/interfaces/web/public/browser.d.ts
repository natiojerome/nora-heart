/** Browser-only boundaries, checked without introducing a build framework. */
type HeartApiOptions = RequestInit & { quiet?: boolean };
interface HeartHttpOptions {
  csrf(): string;
  receivedCsrf(value: string): void;
  expired(): void;
  feedback(url: string, method: string): (error?: unknown) => void;
  fetch?: typeof fetch;
}
interface Window {
  heartPolicies?: { route(value: string): void; sync(): void; reset(): void };
  heartCapabilities?: { route(hash: string): void };
  heartConfiguration?: { route(hash: string): void };
  heartInstructions?: { route(value: string): void; reset(): void };
  heartIcons: { render(root?: ParentNode): void };
  heartHttp: {
    create(config: HeartHttpOptions): {
      api(url: string, options?: HeartApiOptions): Promise<any>;
      post(url: string, body?: unknown): Promise<any>;
    };
  };
}

interface Window {
  heartTasks?: { sync(): void; reset(): void; open(id: string): Promise<void> };
  heartControls?: { sync(): void };
  heartUI: { openEditor(id: string, focusId?: string): void };
  heartPlatform: { uuid(): string; copy(value: string): Promise<void> };
}
declare const state: { authenticated: boolean; tasksAvailable?: boolean };
declare function api(url: string, options?: HeartApiOptions): Promise<any>;
declare function post(url: string, body?: unknown): Promise<any>;
declare function errorText(error: unknown): string;
declare function message(text: string, error?: boolean): void;
declare function openConversation(id: string): Promise<void>;

interface HeartTaskElements {
  "tasks-badge": HTMLElement;
  "task-create": HTMLButtonElement;
  "tasks-refresh": HTMLButtonElement;
  "tasks-worker": HTMLElement;
  "tasks-status": HTMLElement;
  "task-cards": HTMLElement;
  "tasks-more": HTMLElement;
  "tasks-more-status": HTMLElement;
  "tasks-more-retry": HTMLButtonElement;
  "task-editor": HTMLDialogElement;
  "task-form": HTMLFormElement;
  "task-title": HTMLInputElement;
  "task-prompt": HTMLTextAreaElement;
  "task-search": HTMLInputElement;
  "task-conversation": HTMLSelectElement;
  "task-more-conversations": HTMLButtonElement;
  "task-frequency": HTMLSelectElement;
  "task-weekday-field": HTMLElement;
  "task-weekday": HTMLSelectElement;
  "task-date-field": HTMLElement;
  "task-date": HTMLInputElement;
  "task-time-field": HTMLElement;
  "task-time": HTMLInputElement;
  "task-timezone": HTMLInputElement;
  "task-timezones": HTMLElement;
  "task-missed": HTMLSelectElement;
  "task-notify": HTMLInputElement;
  "task-active": HTMLInputElement;
  "task-editor-status": HTMLElement;
  "task-save": HTMLButtonElement;
  "task-detail": HTMLDialogElement;
  "task-detail-summary": HTMLElement;
  "task-run-now": HTMLButtonElement;
  "task-toggle": HTMLButtonElement;
  "task-edit": HTMLButtonElement;
  "task-open-chat": HTMLButtonElement;
  "task-detail-status": HTMLElement;
  "task-history": HTMLElement;
  "task-history-more": HTMLButtonElement;
}

interface Window {
  heartProjects?: {
    open(id: string, target: HTMLElement): void;
    reset(): void;
  };
}
declare function loadProjects(): Promise<void>;
