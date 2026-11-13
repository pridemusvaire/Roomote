import type { AcpPlanTodo } from '@roomote/types';

import type { AcpSessionUpdate } from './acp-types';

const PLAN_STATUSES = ['pending', 'in_progress', 'completed'] as const;

export function toPlanTodos(
  entries: AcpSessionUpdate['entries'],
): AcpPlanTodo[] {
  return (entries ?? []).map((entry, index) => ({
    id: `plan-${index}`,
    content: entry.content,
    ...(entry.priority ? { priority: entry.priority } : {}),
    status:
      PLAN_STATUSES.find((status) => status === entry.status) ?? 'pending',
  }));
}
