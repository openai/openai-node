// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../../resource';
import * as JobsAPI from './jobs/jobs';

export class FineTuning extends APIResource {
  jobs: JobsAPI.Jobs = new JobsAPI.Jobs(this._client);
}

export namespace FineTuning {
  export import Jobs = JobsAPI.Jobs;
  export type FineTuningJob = JobsAPI.FineTuningJob;
  export type FineTuningJobEvent = JobsAPI.FineTuningJobEvent;
  export type FineTuningJobIntegration = JobsAPI.FineTuningJobIntegration;
  export type FineTuningJobWandbIntegration = JobsAPI.FineTuningJobWandbIntegration;
  export type FineTuningJobWandbIntegrationObject = JobsAPI.FineTuningJobWandbIntegrationObject;
  export import FineTuningJobsPage = JobsAPI.FineTuningJobsPage;
  export import FineTuningJobEventsPage = JobsAPI.FineTuningJobEventsPage;
  export type JobCreateParams = JobsAPI.JobCreateParams;
  export type JobListParams = JobsAPI.JobListParams;
  export type JobListEventsParams = JobsAPI.JobListEventsParams;
}
