// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from 'openai/resource';
import * as JobsAPI from 'openai/resources/fine-tuning/jobs';

export class FineTuning extends APIResource {
  jobs: JobsAPI.Jobs = new JobsAPI.Jobs(this._client);
}

export namespace FineTuning {
  export import Jobs = JobsAPI.Jobs;
  export import FineTuningJob = JobsAPI.FineTuningJob;
  export import FineTuningJobEvent = JobsAPI.FineTuningJobEvent;
  export import FineTuningJobsPage = JobsAPI.FineTuningJobsPage;
  export import FineTuningJobEventsPage = JobsAPI.FineTuningJobEventsPage;
  export import JobCreateParams = JobsAPI.JobCreateParams;
  export import JobListParams = JobsAPI.JobListParams;
  export import JobListEventsParams = JobsAPI.JobListEventsParams;
}
