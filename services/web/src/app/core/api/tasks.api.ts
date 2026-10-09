import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from './api-client';
import { TaskProgress } from './models';

/** tasks.controller.ts, task query endpoint `GET /api/tasks/:id`. */
@Injectable({ providedIn: 'root' })
export class TasksApi {
  private readonly api = inject(ApiClient);

  get(taskId: string): Observable<TaskProgress> {
    return this.api.get(`/api/tasks/${taskId}`);
  }
}
