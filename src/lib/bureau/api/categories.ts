/**
 * Les types de membres et leurs montants (§4, §17.10).
 */

import { request } from './core';
import type { Category, CategoryInput } from '../types';

/* ──────────────────────────── Catégories ──────────────────────────── */

export function listCategories(signal?: AbortSignal) {
  return request<Category[]>('membership/categories', { signal });
}

export function createCategory(input: CategoryInput) {
  return request<Category>('membership/categories', { method: 'POST', json: input });
}

export function updateCategory(
  id: number,
  input: Partial<CategoryInput> & { is_active?: boolean },
) {
  return request<Category>(`membership/categories/${id}`, {
    method: 'PUT',
    json: input,
  });
}

export function deleteCategory(id: number) {
  return request<{ deleted: boolean }>(`membership/categories/${id}`, {
    method: 'DELETE',
  });
}
