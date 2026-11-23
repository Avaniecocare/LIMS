import { Injectable } from '@nestjs/common';
import { logger } from '../../common/logger.js';
import { taskLastSuccess } from '../../common/metrics.js';
import { QueueService } from '../../core/queue.service.js';

export interface ScheduledTask {
  name: string;
  /** cron, in Asia/Kolkata */
  pattern: string;
  run: () => Promise<unknown>;
}

/** Scheduled status checks and reminders, run by the worker through a BullMQ repeatable job. */
@Injectable()
export class SchedulerService {
  private readonly tasks = new Map<string, ScheduledTask>();

  constructor(private readonly queue: QueueService) {}

  register(task: ScheduledTask) {
    this.tasks.set(task.name, task);
  }

  async run(name: string) {
    const task = this.tasks.get(name);
    if (!task) return;
    const result = await task.run();
    taskLastSuccess.set({ task: name }, Date.now() / 1000);
    logger.info({ task: name, result }, 'scheduled task finished');
    return result;
  }

  /** Called once at worker start; BullMQ de-duplicates schedulers across workers. */
  async install() {
    for (const task of this.tasks.values()) {
      await this.queue.scheduled.upsertJobScheduler(task.name, { pattern: task.pattern, tz: 'Asia/Kolkata' }, { name: task.name });
    }
  }
}
