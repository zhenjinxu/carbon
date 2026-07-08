/**
 * Status display utilities with Chinese translations.
 * Maps internal English status codes to bilingual display text.
 */

// ── Job Status ───────────────────────────────────────────────────────────────

const JOB_STATUS_ZH: Record<string, string> = {
  Draft: "草稿",
  Planned: "已计划",
  Ready: "就绪",
  "In Progress": "生产中",
  Paused: "已暂停",
  Completed: "已完成",
  Closed: "已关闭",
  Cancelled: "已取消",
  Overdue: "逾期",
  "Due Today": "今日到期"
};

export function jobStatusText(status: string): string {
  return JOB_STATUS_ZH[status] ?? status;
}

// ── Job Operation Status ─────────────────────────────────────────────────────

const JOB_OPERATION_STATUS_ZH: Record<string, string> = {
  Todo: "待办",
  Ready: "就绪",
  Waiting: "等待中",
  "In Progress": "生产中",
  Paused: "已暂停",
  Done: "已完成",
  Canceled: "已取消"
};

export function jobOperationStatusText(status: string): string {
  return JOB_OPERATION_STATUS_ZH[status] ?? status;
}

// ── General Status (for work centers, equipment, etc.) ───────────────────────

const GENERAL_STATUS_ZH: Record<string, string> = {
  Active: "活跃",
  Inactive: "未激活",
  Ready: "就绪",
  Released: "已下达",
  Blocked: "已锁定",
  Idle: "空闲",
  Running: "运行中",
  Maintenance: "维护中"
};

export function generalStatusText(status: string): string {
  return GENERAL_STATUS_ZH[status] ?? status;
}
