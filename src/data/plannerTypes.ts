export const STARTER_DATA_VERSION = 1;

export const INBOX_LIST_ID = '10000000-0000-4000-8000-000000000001';

export const STARTER_AREAS = [
  { id: '20000000-0000-4000-8000-000000000001', name: 'Personal', color: '#5B67C8' },
  { id: '20000000-0000-4000-8000-000000000002', name: 'Household', color: '#3D9F98' },
  { id: '20000000-0000-4000-8000-000000000003', name: 'Coreframe', color: '#CE9138' },
  { id: '20000000-0000-4000-8000-000000000004', name: 'Projects', color: '#8C65B5' },
  { id: '20000000-0000-4000-8000-000000000005', name: 'Shopping', color: '#4C956C' },
] as const;

export const ENTITY_COLORS = [
  { value: '#5B67C8', label: 'Indigo' },
  { value: '#3D9F98', label: 'Teal' },
  { value: '#CE9138', label: 'Amber' },
  { value: '#8C65B5', label: 'Violet' },
  { value: '#4C956C', label: 'Green' },
  { value: '#CF5E62', label: 'Rose' },
] as const;

export type AreaRecord = {
  id: string;
  name: string;
  color: string;
  order: number;
  createdAt: string;
  modifiedAt: string;
  deletedAt?: string;
};

export type PlanListRecord = {
  id: string;
  areaId: string | null;
  name: string;
  color: string;
  order: number;
  systemType?: 'inbox';
  createdAt: string;
  modifiedAt: string;
  deletedAt?: string;
};

export type TaskStatus = 'inbox' | 'available' | 'completed';

export type TaskRecord = {
  id: string;
  title: string;
  listId: string;
  status: TaskStatus;
  order: number;
  createdAt: string;
  modifiedAt: string;
  completedClearedAt?: string;
  deletedAt?: string;
};

export type TaskStepRecord = {
  id: string;
  taskId: string;
  title: string;
  completed: boolean;
  order: number;
  createdAt: string;
  modifiedAt: string;
  deletedAt?: string;
};

export type TagRecord = {
  id: string;
  name: string;
  normalizedName: string;
  color: string;
  createdAt: string;
  modifiedAt: string;
  deletedAt?: string;
};

export type TaskTagRecord = {
  id: string;
  taskId: string;
  tagId: string;
  createdAt: string;
};

export type TaskRelationshipRecord = {
  id: string;
  predecessorTaskId: string;
  successorTaskId: string;
  createdAt: string;
  modifiedAt: string;
  deletedAt?: string;
};

export type PlannerSnapshot = {
  areas: AreaRecord[];
  lists: PlanListRecord[];
  tasks: TaskRecord[];
  taskSteps: TaskStepRecord[];
  tags: TagRecord[];
  taskTags: TaskTagRecord[];
  taskRelationships: TaskRelationshipRecord[];
  blockedByTaskId: Record<string, string[]>;
};
