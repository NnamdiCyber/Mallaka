/** Supported locales. Only English is complete (README 9). Others are placeholders pending native review. */
export type Locale = "en" | "ha" | "yo" | "ig" | "pcm";

/** README 9 notifier templates, plus `otp` which the API needs for phone login. */
export type TemplateId =
  | "payment_received"
  | "due_soon"
  | "grace_entered"
  | "pre_lock"
  | "lock_engaged"
  | "unlock_confirmed"
  | "lease_completed"
  | "otp";

export type TemplateParams = Record<string, string>;

/** A locale table. Missing ids fall back to English. */
export type LocaleTable = Partial<Record<TemplateId, string>>;

/** A channel driver. SMS today; WhatsApp and push can implement the same interface. */
export interface NotificationDriver {
  readonly name: string;
  send(to: string, text: string): Promise<void>;
}
