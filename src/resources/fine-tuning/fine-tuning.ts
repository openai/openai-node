// File generated from our OpenAPI spec by Stainless.

import { APIResource } from 'openai/resource';
import * as JobsAPI from 'openai/resources/fine-tuning/jobs';

export class FineTuning extends APIResource {
  jobs: JobsAPI.Jobs = new JobsAPI.Jobs(this.client);
}

export namespace FineTuning {
  export import Jobs = JobsAPI.Jobs;
  export type FineTuningJob = JobsAPI.FineTuningJob;
  export type FineTuningJobEvent = JobsAPI.FineTuningJobEvent;
  export import FineTuningJobsPage = JobsAPI.FineTuningJobsPage;
  export import FineTuningJobEventsPage = JobsAPI.FineTuningJobEventsPage;
  export type JobCreateParams = JobsAPI.JobCreateParams;
  export type JobListParams = JobsAPI.JobListParams;
  export type JobListEventsParams = JobsAPI.JobListEventsParams;
}
