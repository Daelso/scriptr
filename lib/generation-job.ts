import { randomUUID } from "node:crypto";

type Job = { abort: AbortController; storySlug: string; chapterId: string };

const jobs = new Map<string, Job>();

export function registerJob(job: Job): string {
  const id = randomUUID();
  jobs.set(id, job);
  return id;
}

export function abortJob(id: string): boolean {
  const j = jobs.get(id);
  if (!j) return false;
  j.abort.abort();
  jobs.delete(id);
  return true;
}

export function clearJob(id: string) {
  jobs.delete(id);
}
